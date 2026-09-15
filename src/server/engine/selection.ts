/**
 * Question selection: difficulty mixing, tier fill-down, and repeat avoidance.
 *
 * Two distinct scarcity problems are handled here, and conflating them is the
 * usual bug:
 *
 *   1. STRUCTURAL shortage — the category simply does not hold enough questions
 *      at a tier. Business has 41 hard questions, so a 20-question 'tough' match
 *      (12 hard) always fits, but a hypothetical mix wanting 50 hard never would.
 *
 *   2. FRESHNESS shortage — the tier has enough questions, but this pair has
 *      already seen them. Business hard runs dry after 3 'tough' matches.
 *
 * Both are resolved by walking an ordered list of candidate pools. The order
 * depends on config.selection.tierShortfallPolicy:
 *
 *   'prefer-fresh'      unseen@tier -> unseen@fallbacks -> seen@tier -> seen@fallbacks
 *                       Keeps questions new; bends the difficulty mix.
 *   'prefer-difficulty' unseen@tier -> seen@tier -> unseen@fallbacks -> seen@fallbacks
 *                       Keeps the mix exact; repeats questions.
 *
 * Unseen pools are drawn at random. Seen pools are drawn oldest-seen-first, so
 * recycling always reaches for the question you are least likely to remember.
 */
import type { GameConfig, TierCounts } from '../config.js';
import type { BankQuestion, QuizBank } from '../bank.js';
import type { Difficulty, FreshnessMeta } from '../../shared/protocol.js';
import { DIFFICULTIES } from '../../shared/protocol.js';
import { shuffled, type Rng } from './rng.js';

/** questionId -> epoch ms this pair last saw it. */
export type SeenMap = ReadonlyMap<string, number>;

export interface SelectionNote {
  tier: Difficulty;
  /** Where the questions actually came from. */
  source: 'unseen-tier' | 'unseen-fallback' | 'seen-tier' | 'seen-fallback';
  fromTier: Difficulty;
  count: number;
  message: string;
}

export interface SelectionResult {
  questions: BankQuestion[];
  notes: SelectionNote[];
  /** Set when the category could not supply the requested number of questions at all. */
  shortfall: number;
}

interface Pool {
  source: SelectionNote['source'];
  fromTier: Difficulty;
  questions: BankQuestion[];
}

function buildPools(
  bank: QuizBank,
  categoryId: string,
  tier: Difficulty,
  seen: SeenMap,
  config: GameConfig,
  rng: Rng,
  excluded: ReadonlySet<string>,
): Pool[] {
  const tiers = bank.index.get(categoryId);
  if (!tiers) return [];

  const split = (t: Difficulty) => {
    const unseen: BankQuestion[] = [];
    const seenQs: BankQuestion[] = [];
    for (const q of tiers[t]) {
      if (excluded.has(q.id)) continue;
      if (seen.has(q.id)) seenQs.push(q);
      else unseen.push(q);
    }
    // Unseen order is arbitrary, so randomise. Seen order is meaningful:
    // oldest first, with the id as a stable tiebreak for equal timestamps.
    seenQs.sort((x, y) => {
      const d = (seen.get(x.id) ?? 0) - (seen.get(y.id) ?? 0);
      return d !== 0 ? d : x.id.localeCompare(y.id);
    });
    return { unseen: shuffled(unseen, rng), seen: seenQs };
  };

  const own = split(tier);
  const fallbacks = config.selection.fallbackOrder[tier].map((t) => ({ tier: t, ...split(t) }));

  const unseenTier: Pool = { source: 'unseen-tier', fromTier: tier, questions: own.unseen };
  const seenTier: Pool = { source: 'seen-tier', fromTier: tier, questions: own.seen };
  const unseenFallbacks: Pool[] = fallbacks.map((f) => ({
    source: 'unseen-fallback',
    fromTier: f.tier,
    questions: f.unseen,
  }));
  const seenFallbacks: Pool[] = fallbacks.map((f) => ({
    source: 'seen-fallback',
    fromTier: f.tier,
    questions: f.seen,
  }));

  if (config.selection.tierShortfallPolicy === 'prefer-difficulty') {
    return [unseenTier, seenTier, ...interleave(unseenFallbacks, seenFallbacks)];
  }
  return [unseenTier, ...unseenFallbacks, seenTier, ...seenFallbacks];
}

/** [a1,a2] + [b1,b2] -> [a1,b1,a2,b2] — walk each fallback tier fully before the next. */
function interleave(a: Pool[], b: Pool[]): Pool[] {
  const out: Pool[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i]!);
    if (b[i]) out.push(b[i]!);
  }
  return out;
}

function describe(source: SelectionNote['source'], tier: Difficulty, from: Difficulty, n: number): string {
  switch (source) {
    case 'unseen-tier':
      return `${n} unseen ${tier}`;
    case 'unseen-fallback':
      return `${n} ${tier} slot(s) filled with unseen ${from} — the ${tier} tier had no unseen questions left`;
    case 'seen-tier':
      return `${n} ${tier} question(s) recycled (oldest seen first) — the ${tier} tier is exhausted for this pair`;
    case 'seen-fallback':
      return `${n} ${tier} slot(s) filled with previously seen ${from} — both tiers are exhausted for this pair`;
  }
}

/**
 * Pick questions for one match.
 *
 * Tiers are filled scarcest-pool-first so that a thin tier (Business hard) gets
 * first claim on its own questions before a fatter tier can borrow them.
 */
export function selectQuestions(opts: {
  bank: QuizBank;
  config: GameConfig;
  categoryId: string;
  mix: TierCounts;
  seen: SeenMap;
  rng: Rng;
  /** Already used in this match — never draw the same question twice in one sitting. */
  exclude?: ReadonlySet<string>;
}): SelectionResult {
  const { bank, config, categoryId, mix, seen, rng } = opts;
  const tiers = bank.index.get(categoryId);
  if (!tiers) {
    throw new Error(`unknown category "${categoryId}"`);
  }

  const used = new Set<string>(opts.exclude ?? []);
  const notes: SelectionNote[] = [];
  const picked: BankQuestion[] = [];

  const order = DIFFICULTIES.filter((t) => mix[t] > 0).sort((x, y) => tiers[x].length - tiers[y].length);

  for (const tier of order) {
    let need = mix[tier];
    const pools = buildPools(bank, categoryId, tier, seen, config, rng, used);

    for (const pool of pools) {
      if (need === 0) break;
      let taken = 0;
      for (const q of pool.questions) {
        if (need === 0) break;
        if (used.has(q.id)) continue;
        used.add(q.id);
        picked.push(q);
        need--;
        taken++;
      }
      if (taken > 0 && pool.source !== 'unseen-tier') {
        notes.push({
          tier,
          source: pool.source,
          fromTier: pool.fromTier,
          count: taken,
          message: describe(pool.source, tier, pool.fromTier, taken),
        });
      }
    }

    if (need > 0) {
      notes.push({
        tier,
        source: 'seen-fallback',
        fromTier: tier,
        count: 0,
        message: `could not fill ${need} ${tier} slot(s): category "${categoryId}" does not hold enough questions`,
      });
    }
  }

  const total = DIFFICULTIES.reduce((s, t) => s + mix[t], 0);
  return {
    questions: shuffled(picked, rng),
    notes,
    shortfall: total - picked.length,
  };
}

/** How much of a category this pair has not yet seen. Drives the freshness meter. */
export function freshness(bank: QuizBank, categoryId: string, seen: SeenMap): FreshnessMeta {
  const tiers = bank.index.get(categoryId);
  if (!tiers) throw new Error(`unknown category "${categoryId}"`);

  const byTier = {} as FreshnessMeta['byTier'];
  let total = 0;
  let fresh = 0;
  for (const tier of DIFFICULTIES) {
    const all = tiers[tier];
    const unseen = all.filter((q) => !seen.has(q.id)).length;
    byTier[tier] = { total: all.length, fresh: unseen };
    total += all.length;
    fresh += unseen;
  }
  return { categoryId, total, fresh, byTier };
}
