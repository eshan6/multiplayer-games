import { describe, expect, it } from 'vitest';
import { freshness, selectQuestions } from '../src/server/engine/selection.js';
import { mulberry32 } from '../src/server/engine/rng.js';
import { makeBank, makeConfig, realBank, realConfig, tierCounts } from './helpers.js';

const rng = () => mulberry32(20260915);

describe('difficulty mixing', () => {
  const bank = realBank();
  const config = realConfig();

  it.each(['casual', 'balanced', 'tough'] as const)(
    'hits the exact %s mix on a category with room to spare',
    (mix) => {
      const res = selectQuestions({
        bank,
        config,
        categoryId: 'science',
        mix: config.difficultyMixes[mix],
        seen: new Map(),
        rng: rng(),
      });
      expect(res.questions).toHaveLength(20);
      expect(tierCounts(res.questions)).toEqual(config.difficultyMixes[mix]);
      expect(res.notes).toHaveLength(0);
      expect(res.shortfall).toBe(0);
    },
  );

  it('never repeats a question inside one match', () => {
    const res = selectQuestions({
      bank,
      config,
      categoryId: 'business',
      mix: config.difficultyMixes.tough,
      seen: new Map(),
      rng: rng(),
    });
    expect(new Set(res.questions.map((q) => q.id)).size).toBe(20);
  });

  it('draws only from the requested category', () => {
    const res = selectQuestions({
      bank,
      config,
      categoryId: 'food',
      mix: config.difficultyMixes.balanced,
      seen: new Map(),
      rng: rng(),
    });
    expect(res.questions.every((q) => q.category === 'food')).toBe(true);
  });

  it('honours the exclude set, so sudden death cannot replay the main 20', () => {
    const first = selectQuestions({
      bank,
      config,
      categoryId: 'games',
      mix: config.difficultyMixes.balanced,
      seen: new Map(),
      rng: rng(),
    });
    const used = new Set(first.questions.map((q) => q.id));
    const extra = selectQuestions({
      bank,
      config,
      categoryId: 'games',
      mix: { easy: 0, medium: 1, hard: 0 },
      seen: new Map(),
      rng: rng(),
      exclude: used,
    });
    expect(used.has(extra.questions[0]!.id)).toBe(false);
  });

  it('is deterministic for a given seed and varies across seeds', () => {
    const pick = (seed: number) =>
      selectQuestions({
        bank,
        config,
        categoryId: 'tech',
        mix: config.difficultyMixes.balanced,
        seen: new Map(),
        rng: mulberry32(seed),
      }).questions.map((q) => q.id);
    expect(pick(1)).toEqual(pick(1));
    expect(pick(1)).not.toEqual(pick(2));
  });
});

describe('tier fill-down when a category is structurally thin', () => {
  const config = makeConfig();

  it('fills missing hard slots from the fallback tier and says so', () => {
    // 4 hard available, 12 wanted.
    const bank = makeBank({ thin: { easy: 60, medium: 40, hard: 4 } });
    const res = selectQuestions({
      bank,
      config,
      categoryId: 'thin',
      mix: config.difficultyMixes.tough,
      seen: new Map(),
      rng: rng(),
    });
    expect(res.questions).toHaveLength(20);
    expect(res.shortfall).toBe(0);
    const counts = tierCounts(res.questions);
    expect(counts.hard).toBe(4);
    expect(counts.medium + counts.easy).toBe(16);
    expect(res.notes.some((n) => n.tier === 'hard' && n.fromTier === 'medium')).toBe(true);
  });

  it('reports a shortfall rather than crashing when the whole category is too small', () => {
    const bank = makeBank({ tiny: { easy: 3, medium: 2, hard: 1 } });
    const res = selectQuestions({
      bank,
      config,
      categoryId: 'tiny',
      mix: config.difficultyMixes.balanced,
      seen: new Map(),
      rng: rng(),
    });
    expect(res.questions).toHaveLength(6);
    expect(res.shortfall).toBe(14);
    expect(res.notes.some((n) => /does not hold enough questions/.test(n.message))).toBe(true);
  });

  it('lets a thin tier claim its own questions before a fat tier borrows them', () => {
    // Hard is scarce; medium is plentiful. Hard must not lose its 12 to medium's fill-down.
    const bank = makeBank({ skew: { easy: 100, medium: 100, hard: 12 } });
    const res = selectQuestions({
      bank,
      config,
      categoryId: 'skew',
      mix: config.difficultyMixes.tough,
      seen: new Map(),
      rng: rng(),
    });
    expect(tierCounts(res.questions).hard).toBe(12);
  });

  it('throws on an unknown category rather than returning nothing', () => {
    const bank = makeBank({ a: { easy: 5, medium: 5, hard: 5 } });
    expect(() =>
      selectQuestions({
        bank,
        config,
        categoryId: 'ghost',
        mix: config.difficultyMixes.casual,
        seen: new Map(),
        rng: rng(),
      }),
    ).toThrow(/unknown category/);
  });
});

describe('repeat avoidance', () => {
  const config = makeConfig();

  it('prefers unseen questions over seen ones', () => {
    const bank = makeBank({ c: { easy: 40, medium: 40, hard: 40 } });
    const all = bank.index.get('c')!;
    // Mark every hard question except 12 as seen.
    const seen = new Map<string, number>();
    all.hard.slice(12).forEach((q, i) => seen.set(q.id, 1000 + i));
    const expectedFresh = new Set(all.hard.slice(0, 12).map((q) => q.id));

    const res = selectQuestions({
      bank,
      config,
      categoryId: 'c',
      mix: config.difficultyMixes.tough,
      seen,
      rng: rng(),
    });
    const hardPicked = res.questions.filter((q) => q.difficulty === 'hard').map((q) => q.id);
    expect(hardPicked).toHaveLength(12);
    expect(hardPicked.every((id) => expectedFresh.has(id))).toBe(true);
    expect(res.notes).toHaveLength(0);
  });

  it('recycles oldest-seen first once a tier is exhausted', () => {
    // Only 3 hard questions, all seen, at clearly ordered times.
    const bank = makeBank({ c: { easy: 40, medium: 40, hard: 3 } });
    const hard = bank.index.get('c')!.hard;
    const seen = new Map<string, number>([
      [hard[0]!.id, 3000], // newest
      [hard[1]!.id, 1000], // oldest
      [hard[2]!.id, 2000],
    ]);
    // prefer-difficulty keeps the hard slot at the hard tier, which forces a
    // recycle and lets us see which of the three it reached for.
    const strict = makeConfig({
      selection: {
        tierShortfallPolicy: 'prefer-difficulty',
        fallbackOrder: { hard: ['medium', 'easy'], medium: ['hard', 'easy'], easy: ['medium', 'hard'] },
      },
    });
    const picked = selectQuestions({
      bank,
      config: strict,
      categoryId: 'c',
      mix: { easy: 0, medium: 0, hard: 1 },
      seen,
      rng: rng(),
    });
    expect(picked.questions[0]!.id).toBe(hard[1]!.id);
    expect(picked.notes.some((n) => n.source === 'seen-tier')).toBe(true);
  });

  it("prefer-fresh spills into an adjacent tier's unseen pool instead of repeating", () => {
    const bank = makeBank({ business: { easy: 128, medium: 115, hard: 41 } });
    const hard = bank.index.get('business')!.hard;
    const seen = new Map(hard.map((q, i) => [q.id, 1000 + i] as const));

    const res = selectQuestions({
      bank,
      config: makeConfig(),
      categoryId: 'business',
      mix: config.difficultyMixes.tough,
      seen,
      rng: rng(),
    });
    // Every hard question is burned, so none of the 20 should be a repeat.
    expect(res.questions.some((q) => seen.has(q.id))).toBe(false);
    expect(tierCounts(res.questions).hard).toBe(0);
    expect(res.notes.some((n) => n.source === 'unseen-fallback')).toBe(true);
  });

  it('prefer-difficulty keeps the mix exact by repeating instead', () => {
    const bank = makeBank({ business: { easy: 128, medium: 115, hard: 41 } });
    const hard = bank.index.get('business')!.hard;
    const seen = new Map(hard.map((q, i) => [q.id, 1000 + i] as const));
    const strict = makeConfig({
      selection: {
        tierShortfallPolicy: 'prefer-difficulty',
        fallbackOrder: { hard: ['medium', 'easy'], medium: ['hard', 'easy'], easy: ['medium', 'hard'] },
      },
    });
    const res = selectQuestions({
      bank,
      config: strict,
      categoryId: 'business',
      mix: strict.difficultyMixes.tough,
      seen,
      rng: rng(),
    });
    expect(tierCounts(res.questions).hard).toBe(12);
    expect(res.notes.some((n) => n.source === 'seen-tier')).toBe(true);
  });
});

describe('business hard is the pressure case the brief called out', () => {
  const bank = realBank();
  const config = realConfig();

  it('supports exactly 3 fully-unseen tough matches before the hard tier runs dry', () => {
    const seen = new Map<string, number>();
    let freshHardMatches = 0;

    for (let match = 0; match < 6; match++) {
      const res = selectQuestions({
        bank,
        config,
        categoryId: 'business',
        mix: config.difficultyMixes.tough,
        seen,
        rng: mulberry32(match + 1),
      });
      const repeated = res.questions.filter((q) => seen.has(q.id));
      expect(repeated).toHaveLength(0); // prefer-fresh must never repeat while anything is unseen
      if (tierCounts(res.questions).hard === 12) freshHardMatches++;
      res.questions.forEach((q, i) => seen.set(q.id, match * 100 + i));
    }

    expect(freshHardMatches).toBe(3);
  });

  it('reports freshness that shrinks as matches are played', () => {
    const seen = new Map<string, number>();
    const before = freshness(bank, 'business', seen);
    expect(before.total).toBe(284);
    expect(before.fresh).toBe(284);
    expect(before.byTier.hard).toEqual({ total: 41, fresh: 41 });

    const res = selectQuestions({
      bank,
      config,
      categoryId: 'business',
      mix: config.difficultyMixes.tough,
      seen,
      rng: rng(),
    });
    res.questions.forEach((q, i) => seen.set(q.id, i));

    const after = freshness(bank, 'business', seen);
    expect(after.fresh).toBe(264);
    expect(after.byTier.hard.fresh).toBe(29);
  });
});
