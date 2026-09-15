import { describe, expect, it } from 'vitest';
import { Match, type Effect } from '../src/server/engine/match.js';
import { mulberry32 } from '../src/server/engine/rng.js';
import { makeBank, makeConfig, realBank, realConfig } from './helpers.js';
import type { MatchResult, PlayerSlot, PublicQuestion, RevealPayload } from '../src/shared/protocol.js';

const pick = <T extends Effect['type']>(effects: Effect[], type: T) =>
  effects.filter((e) => e.type === type) as Extract<Effect, { type: T }>[];

/**
 * Drives a match without sockets. `latency` is per slot in ms one-way, so tests
 * can reproduce the India/Germany asymmetry exactly.
 */
function harness(opts: {
  categoryId?: string;
  mix?: 'casual' | 'balanced' | 'tough';
  latency?: Record<PlayerSlot, number>;
  seed?: number;
  config?: ReturnType<typeof makeConfig>;
  bank?: ReturnType<typeof makeBank>;
} = {}) {
  const config = opts.config ?? realConfig();
  const bank = opts.bank ?? realBank();
  const latency = opts.latency ?? { a: 20, b: 20 };
  let now = 1_000_000;

  const match = new Match({
    config,
    bank,
    categoryId: opts.categoryId ?? 'science',
    mix: opts.mix ?? 'balanced',
    seen: new Map(),
    rng: mulberry32(opts.seed ?? 7),
    latency: (slot) => latency[slot],
  });

  const log: Effect[] = [];
  const run = (effects: Effect[]) => {
    log.push(...effects);
    return effects;
  };

  return {
    match,
    config,
    get now() {
      return now;
    },
    set now(v: number) {
      now = v;
    },
    advance(ms: number) {
      now += ms;
      return run(match.tick(now));
    },
    /** Advance in small steps so every scheduled transition fires in order. */
    advanceThrough(ms: number, step = 50) {
      const out: Effect[] = [];
      for (let i = 0; i < ms; i += step) {
        now += step;
        out.push(...run(match.tick(now)));
      }
      return out;
    },
    start: () => run(match.start(now)),
    ack: (slot: PlayerSlot, qid: string) => run(match.ack(slot, qid, now)),
    submit: (slot: PlayerSlot, qid: string, choice: number, at?: number) =>
      run(match.submit(slot, qid, choice, now, at ?? now)),
    log,
  };
}

/** Plays one question to its reveal, with both players answering. */
function playQuestion(
  h: ReturnType<typeof harness>,
  q: PublicQuestion,
  answers: { a: number | null; b: number | null },
): RevealPayload {
  h.ack('a', q.id);
  const armed = pick(h.ack('b', q.id), 'armed')[0]!;
  h.now = armed.payload.armAt + 10;
  if (answers.a !== null) h.submit('a', q.id, answers.a);
  const effects = answers.b !== null ? h.submit('b', q.id, answers.b) : [];
  let reveal = pick(effects, 'reveal')[0];
  if (!reveal) {
    h.now = armed.payload.deadlineAt + h.config.timing.maxLatencyGraceMs + 10;
    reveal = pick(h.match.tick(h.now), 'reveal')[0]!;
  }
  return reveal.payload;
}

describe('question delivery and the synchronised start', () => {
  it('delivers the first question face-down without an answer index', () => {
    const h = harness();
    const q = pick(h.start(), 'deliver')[0]!.question;
    expect(q.options).toHaveLength(4);
    expect(Object.keys(q)).not.toContain('answer');
    expect(JSON.stringify(q)).not.toMatch(/"answer"/);
    expect(q.index).toBe(1);
    expect(q.total).toBe(20);
  });

  it('does not arm until both players have acknowledged', () => {
    const h = harness();
    const q = pick(h.start(), 'deliver')[0]!.question;
    expect(pick(h.ack('a', q.id), 'armed')).toHaveLength(0);
    expect(pick(h.ack('b', q.id), 'armed')).toHaveLength(1);
  });

  it('schedules the reveal past the slower player, so the faster one gains no reading time', () => {
    const h = harness({ latency: { a: 15, b: 190 } });
    const q = pick(h.start(), 'deliver')[0]!.question;
    h.ack('a', q.id);
    const armed = pick(h.ack('b', q.id), 'armed')[0]!.payload;
    // armAt must clear the slowest trip, not the average.
    expect(armed.armAt - h.now).toBeGreaterThanOrEqual(190);
    expect(armed.deadlineAt - armed.armAt).toBe(20000);
  });

  it('gives both players the identical window, whatever their latency', () => {
    const h = harness({ latency: { a: 5, b: 300 } });
    const q = pick(h.start(), 'deliver')[0]!.question;
    h.ack('a', q.id);
    const armed = pick(h.ack('b', q.id), 'armed')[0]!.payload;
    expect(armed.durationMs).toBe(20000);
    expect(armed.deadlineAt - armed.armAt).toBe(armed.durationMs);
  });

  it('arms anyway if a client never acknowledges, instead of hanging', () => {
    const h = harness();
    const q = pick(h.start(), 'deliver')[0]!.question;
    h.ack('a', q.id);
    expect(pick(h.advance(3999), 'armed')).toHaveLength(0);
    expect(pick(h.advance(2), 'armed')).toHaveLength(1);
  });
});

describe('answer locking and latency grace', () => {
  it('ignores a second answer — locked in is locked in', () => {
    const h = harness();
    const q = pick(h.start(), 'deliver')[0]!.question;
    h.ack('a', q.id);
    const armed = pick(h.ack('b', q.id), 'armed')[0]!.payload;
    h.now = armed.armAt + 100;

    expect(pick(h.submit('a', q.id, 0), 'accepted')).toHaveLength(1);
    expect(pick(h.submit('a', q.id, 3), 'accepted')).toHaveLength(0);
    h.submit('b', q.id, 1);
    const reveal = pick(h.log, 'reveal')[0]!.payload;
    expect(reveal.answers.find((r) => r.slot === 'a')!.choice).toBe(0);
  });

  it('rejects an answer that arrives before the shared start instant', () => {
    const h = harness();
    const q = pick(h.start(), 'deliver')[0]!.question;
    h.ack('a', q.id);
    const armed = pick(h.ack('b', q.id), 'armed')[0]!.payload;
    h.now = armed.armAt - 50;
    expect(pick(h.submit('a', q.id, 0), 'accepted')).toHaveLength(0);
  });

  it('accepts a distant player answer still in flight past the deadline', () => {
    const h = harness({ latency: { a: 10, b: 180 } });
    const q = pick(h.start(), 'deliver')[0]!.question;
    h.ack('a', q.id);
    const armed = pick(h.ack('b', q.id), 'armed')[0]!.payload;

    // B answered on the buzzer; the packet lands 180ms later.
    h.now = armed.deadlineAt + 150;
    expect(pick(h.submit('b', q.id, 1), 'accepted')).toHaveLength(1);
  });

  it('does not extend grace beyond the configured cap', () => {
    const h = harness({ latency: { a: 10, b: 5000 } });
    const q = pick(h.start(), 'deliver')[0]!.question;
    h.ack('a', q.id);
    const armed = pick(h.ack('b', q.id), 'armed')[0]!.payload;
    h.now = armed.deadlineAt + 401;
    expect(pick(h.submit('b', q.id, 1), 'accepted')).toHaveLength(0);
  });

  it('gives the close player no grace they did not earn', () => {
    const h = harness({ latency: { a: 5, b: 5 } });
    const q = pick(h.start(), 'deliver')[0]!.question;
    h.ack('a', q.id);
    const armed = pick(h.ack('b', q.id), 'armed')[0]!.payload;
    h.now = armed.deadlineAt + 50;
    expect(pick(h.submit('a', q.id, 1), 'accepted')).toHaveLength(0);
  });

  it('rejects an out-of-range choice index', () => {
    const h = harness();
    const q = pick(h.start(), 'deliver')[0]!.question;
    h.ack('a', q.id);
    const armed = pick(h.ack('b', q.id), 'armed')[0]!.payload;
    h.now = armed.armAt + 10;
    expect(pick(h.submit('a', q.id, 4), 'accepted')).toHaveLength(0);
    expect(pick(h.submit('a', q.id, -1), 'accepted')).toHaveLength(0);
  });

  it('ignores an answer for a question that is not live', () => {
    const h = harness();
    const q = pick(h.start(), 'deliver')[0]!.question;
    h.ack('a', q.id);
    const armed = pick(h.ack('b', q.id), 'armed')[0]!.payload;
    h.now = armed.armAt + 10;
    expect(pick(h.submit('a', 'SCI-9999', 0), 'accepted')).toHaveLength(0);
  });

  it('reveals as soon as both have locked in, without waiting out the clock', () => {
    const h = harness();
    const q = pick(h.start(), 'deliver')[0]!.question;
    h.ack('a', q.id);
    const armed = pick(h.ack('b', q.id), 'armed')[0]!.payload;
    h.now = armed.armAt + 500;
    h.submit('a', q.id, 0);
    const effects = h.submit('b', q.id, 1);
    expect(pick(effects, 'reveal')).toHaveLength(1);
    expect(h.now).toBeLessThan(armed.deadlineAt);
  });

  it('scores an unanswered question as zero when the clock runs out', () => {
    const h = harness();
    const q = pick(h.start(), 'deliver')[0]!.question;
    const reveal = playQuestion(h, q, { a: null, b: null });
    expect(reveal.answers.every((r) => r.choice === null && r.delta === 0)).toBe(true);
    expect(reveal.scores).toEqual({ a: 0, b: 0 });
  });

  it('only reveals the answer after the question closes', () => {
    const h = harness();
    const q = pick(h.start(), 'deliver')[0]!.question;
    const reveal = playQuestion(h, q, { a: 0, b: 1 });

    // Everything that crossed the wire before the reveal must be answer-free.
    const beforeClose = h.log.slice(
      0,
      h.log.findIndex((e) => e.type === 'reveal'),
    );
    expect(beforeClose.length).toBeGreaterThan(0);
    expect(JSON.stringify(beforeClose)).not.toMatch(/"answer":/);
    expect(typeof reveal.answer).toBe('number');
  });
});

describe('scoring across a full match', () => {
  it('tracks running scores and finishes after the configured question count', () => {
    const h = harness({ mix: 'casual' });
    let effects = h.start();
    let played = 0;
    let over: MatchResult | null = null;

    for (let i = 0; i < 40 && !over; i++) {
      const delivered = pick(effects, 'deliver')[0];
      if (!delivered) break;
      played++;
      const q = delivered.question;
      // A answers correctly by construction is impossible (no answer on the
      // wire), so both pick option 0 and we read the result from the reveal.
      playQuestion(h, q, { a: 0, b: 1 });
      effects = h.advanceThrough(h.config.timing.revealDurationMs + h.config.timing.interQuestionMs + 100);
      over = pick(effects, 'over')[0]?.result ?? null;
    }

    expect(played).toBeGreaterThanOrEqual(20);
    expect(over).not.toBeNull();
    expect(over!.rows.length).toBeGreaterThanOrEqual(20);
    expect(over!.rows.slice(0, 20).every((r) => !r.suddenDeath)).toBe(true);
  });

  it('applies negative marking to the running total', () => {
    const h = harness();
    const q = pick(h.start(), 'deliver')[0]!.question;
    const reveal = playQuestion(h, q, { a: 0, b: 1 });
    const wrongA = reveal.answers.find((r) => r.slot === 'a')!;
    const wrongB = reveal.answers.find((r) => r.slot === 'b')!;
    // Exactly one of them can be right; the other must have lost points.
    const losers = [wrongA, wrongB].filter((r) => !r.correct);
    expect(losers.length).toBeGreaterThanOrEqual(1);
    for (const l of losers) expect(l.delta).toBeLessThan(0);
  });

  it('records elapsed time from the shared start, not from delivery', () => {
    const h = harness({ latency: { a: 10, b: 200 } });
    const q = pick(h.start(), 'deliver')[0]!.question;
    h.ack('a', q.id);
    const armed = pick(h.ack('b', q.id), 'armed')[0]!.payload;
    h.now = armed.armAt + 3000;
    h.submit('a', q.id, 0);
    h.submit('b', q.id, 1);
    const reveal = pick(h.log, 'reveal')[0]!.payload;
    expect(reveal.answers.find((r) => r.slot === 'a')!.elapsedMs).toBe(3000);
  });
});

describe('tie-breaks', () => {
  /** Plays a whole match where both players always answer identically -> guaranteed tie. */
  function playTiedMatch(mix: 'casual' | 'balanced' | 'tough' = 'casual') {
    const h = harness({ mix, seed: 99 });
    let effects = h.start();
    let over: MatchResult | null = null;
    const delivered: PublicQuestion[] = [];

    for (let i = 0; i < 60 && !over; i++) {
      const d = pick(effects, 'deliver')[0];
      if (!d) break;
      delivered.push(d.question);
      // Identical answers keep the scores level through the main 20.
      playQuestion(h, d.question, { a: 0, b: 0 });
      effects = h.advanceThrough(h.config.timing.revealDurationMs + h.config.timing.interQuestionMs + 100);
      over = pick(effects, 'over')[0]?.result ?? null;
    }
    return { h, over, delivered };
  }

  it('goes to sudden death when the main 20 end level', () => {
    const { over, delivered } = playTiedMatch();
    expect(over).not.toBeNull();
    expect(over!.scores.a).toBe(over!.scores.b);
    // Identical answers can never break the tie, so it must run to the cap.
    expect(delivered.length).toBeGreaterThan(20);
    expect(delivered.some((q) => q.suddenDeath)).toBe(true);
  });

  it('marks sudden-death questions and never reuses a main-round question', () => {
    const { over, delivered } = playTiedMatch();
    const ids = delivered.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(over!.rows.filter((r) => r.suddenDeath).length).toBe(delivered.length - 20);
  });

  it('stops at the configured sudden-death cap and records a draw', () => {
    const { over } = playTiedMatch();
    expect(over!.winner).toBeNull();
    expect(over!.decidedBySuddenDeath).toBe(false);
  });

  it('ends immediately with a winner when the main 20 are decisive', () => {
    const h = harness({ mix: 'casual', seed: 3 });
    let effects = h.start();
    let over: MatchResult | null = null;
    let count = 0;

    for (let i = 0; i < 40 && !over; i++) {
      const d = pick(effects, 'deliver')[0];
      if (!d) break;
      count++;
      const q = d.question;
      // A always picks 0, B always picks 1: with shuffled answers they diverge.
      playQuestion(h, q, { a: 0, b: 1 });
      effects = h.advanceThrough(h.config.timing.revealDurationMs + h.config.timing.interQuestionMs + 100);
      over = pick(effects, 'over')[0]?.result ?? null;
    }

    expect(over).not.toBeNull();
    if (over!.scores.a !== over!.scores.b) {
      expect(count).toBe(20);
      expect(over!.winner).toBe(over!.scores.a > over!.scores.b ? 'a' : 'b');
    }
  });

  it('records a draw when the category has nothing left for sudden death', () => {
    // Exactly 20 questions in the category, all consumed by the main round.
    const bank = makeBank({ tiny: { easy: 20, medium: 0, hard: 0 } });
    const config = makeConfig({
      questionsPerMatch: 20,
      difficultyMixes: {
        casual: { easy: 20, medium: 0, hard: 0 },
        balanced: { easy: 20, medium: 0, hard: 0 },
        tough: { easy: 20, medium: 0, hard: 0 },
      },
    });
    const h = harness({ bank, config, categoryId: 'tiny', mix: 'casual' });
    let effects = h.start();
    let over: MatchResult | null = null;

    for (let i = 0; i < 30 && !over; i++) {
      const d = pick(effects, 'deliver')[0];
      if (!d) break;
      playQuestion(h, d.question, { a: 0, b: 0 });
      effects = h.advanceThrough(config.timing.revealDurationMs + config.timing.interQuestionMs + 100);
      over = pick(effects, 'over')[0]?.result ?? null;
    }
    expect(over).not.toBeNull();
    expect(over!.winner).toBeNull();
    expect(over!.rows).toHaveLength(20);
  });
});

describe('pause and resume', () => {
  it('stops the clock while paused and returns the same time remaining', () => {
    const h = harness();
    const q = pick(h.start(), 'deliver')[0]!.question;
    h.ack('a', q.id);
    const armed = pick(h.ack('b', q.id), 'armed')[0]!.payload;

    h.now = armed.armAt + 5000; // 15s left
    h.match.pause(h.now);
    h.now += 120_000; // two minutes away
    expect(h.match.tick(h.now)).toHaveLength(0); // frozen
    h.match.resume(h.now);

    // 15s should still be on the clock, so an answer now is accepted.
    h.now += 14_000;
    expect(pick(h.submit('a', q.id, 0), 'accepted')).toHaveLength(1);
    // And 2s later the window is genuinely shut.
    h.now += 2_500;
    expect(pick(h.submit('b', q.id, 0), 'accepted')).toHaveLength(0);
  });

  it('keeps an answer locked in across a pause', () => {
    const h = harness();
    const q = pick(h.start(), 'deliver')[0]!.question;
    h.ack('a', q.id);
    const armed = pick(h.ack('b', q.id), 'armed')[0]!.payload;
    h.now = armed.armAt + 1000;
    h.submit('a', q.id, 2);

    h.match.pause(h.now);
    h.now += 60_000;
    h.match.resume(h.now);
    expect(h.match.lockedSlots.a).toBe(true);
    expect(pick(h.submit('a', q.id, 3), 'accepted')).toHaveLength(0);
  });

  it('rejects answers submitted while paused', () => {
    const h = harness();
    const q = pick(h.start(), 'deliver')[0]!.question;
    h.ack('a', q.id);
    const armed = pick(h.ack('b', q.id), 'armed')[0]!.payload;
    h.now = armed.armAt + 100;
    h.match.pause(h.now);
    expect(pick(h.submit('a', q.id, 0), 'accepted')).toHaveLength(0);
  });

  it('preserves scores across a pause', () => {
    const h = harness();
    const q1 = pick(h.start(), 'deliver')[0]!.question;
    const reveal = playQuestion(h, q1, { a: 0, b: 1 });
    const scoreBefore = { ...reveal.scores };

    h.match.pause(h.now);
    h.now += 90_000;
    h.match.resume(h.now);
    expect(h.match.scores).toEqual(scoreBefore);
  });

  it('can replay the live question to a client that reconnected', () => {
    const h = harness();
    const q = pick(h.start(), 'deliver')[0]!.question;
    h.ack('a', q.id);
    h.ack('b', q.id);
    const replay = h.match.replayLive()!;
    expect(replay.question.id).toBe(q.id);
    expect(replay.armed).not.toBeNull();
    expect(JSON.stringify(replay.question)).not.toMatch(/"answer"/);
  });
});

describe('repeat avoidance inside a single match', () => {
  it('marks each question seen as it is revealed, not when it is selected', () => {
    const h = harness();
    const q = pick(h.start(), 'deliver')[0]!.question;
    expect(pick(h.log, 'seen')).toHaveLength(0);
    playQuestion(h, q, { a: 0, b: 0 });
    const seen = pick(h.log, 'seen');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.questionIds).toEqual([q.id]);
  });

  it('reports only played questions as seen when a match is abandoned', () => {
    const h = harness();
    const q = pick(h.start(), 'deliver')[0]!.question;
    playQuestion(h, q, { a: 0, b: 0 });
    expect(h.match.seenSoFar()).toEqual([q.id]);
  });
});
