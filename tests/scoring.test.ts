import { describe, expect, it } from 'vitest';
import {
  guessExpectedValue,
  liveValue,
  scoreAnswer,
  speedFactor,
  stakeFor,
} from '../src/server/engine/scoring.js';
import { validateConfig } from '../src/server/config.js';
import { makeConfig, realConfig } from './helpers.js';

const config = realConfig();

const WINDOW = config.timing.answerWindowMs;

describe('scoring', () => {
  it('awards the tier floor for a correct answer on the buzzer', () => {
    expect(scoreAnswer(config, 'easy', 2, 2, WINDOW)).toMatchObject({ correct: true, delta: 10 });
    expect(scoreAnswer(config, 'medium', 0, 0, WINDOW)).toMatchObject({ correct: true, delta: 15 });
    expect(scoreAnswer(config, 'hard', 3, 3, WINDOW)).toMatchObject({ correct: true, delta: 20 });
  });

  it('awards floor plus the full bonus for an instant correct answer', () => {
    expect(scoreAnswer(config, 'easy', 2, 2, 0)).toMatchObject({ delta: 16, speedPoints: 6 });
    expect(scoreAnswer(config, 'medium', 0, 0, 0)).toMatchObject({ delta: 24, speedPoints: 9 });
    expect(scoreAnswer(config, 'hard', 3, 3, 0)).toMatchObject({ delta: 32, speedPoints: 12 });
  });

  it('deducts the tier penalty for a wrong answer, however fast it arrives', () => {
    expect(scoreAnswer(config, 'easy', 1, 2, 0)).toMatchObject({ correct: false, delta: -5 });
    expect(scoreAnswer(config, 'medium', 1, 2, 0)).toMatchObject({ correct: false, delta: -7 });
    expect(scoreAnswer(config, 'hard', 1, 2, 0)).toMatchObject({ correct: false, delta: -10 });
    // Answering wrong instantly must not earn a speed bonus.
    expect(scoreAnswer(config, 'hard', 1, 2, 0).speedPoints).toBe(0);
  });

  it('scores no answer at zero, which beats guessing wrong', () => {
    for (const tier of ['easy', 'medium', 'hard'] as const) {
      const abstain = scoreAnswer(config, tier, null, 1, null);
      expect(abstain).toEqual({ correct: false, delta: 0, speedPoints: 0, answered: false });
      expect(abstain.delta).toBeGreaterThan(scoreAnswer(config, tier, 0, 1, 0).delta);
    }
  });

  it('keeps even the slowest correct answer worth more than abstaining', () => {
    for (const tier of ['easy', 'medium', 'hard'] as const) {
      const slowest = scoreAnswer(config, tier, 1, 1, WINDOW);
      expect(slowest.delta).toBeGreaterThan(0);
      expect(slowest.delta).toBeGreaterThan(scoreAnswer(config, tier, null, 1, null).delta);
    }
  });
});

describe('speed bonus', () => {
  it('pays the full bonus inside the reading window', () => {
    expect(speedFactor(config, 0)).toBe(1);
    expect(speedFactor(config, config.scoring.speed.fullBonusMs)).toBe(1);
    expect(scoreAnswer(config, 'hard', 1, 1, 900).delta).toBe(32);
  });

  it('decays to zero bonus exactly at the deadline', () => {
    expect(speedFactor(config, WINDOW)).toBe(0);
    expect(scoreAnswer(config, 'hard', 1, 1, WINDOW).speedPoints).toBe(0);
  });

  it('never rises again — later is never worth more than sooner', () => {
    let previous = Infinity;
    for (let t = 0; t <= WINDOW; t += 250) {
      const delta = scoreAnswer(config, 'hard', 1, 1, t).delta;
      expect(delta).toBeLessThanOrEqual(previous);
      previous = delta;
    }
  });

  it('gives the faster of two correct answers strictly more', () => {
    const fast = scoreAnswer(config, 'hard', 1, 1, 1500).delta;
    const slow = scoreAnswer(config, 'hard', 1, 1, 12000).delta;
    expect(fast).toBeGreaterThan(slow);
  });

  it('clamps a negative elapsed time rather than paying over the maximum', () => {
    const scored = scoreAnswer(config, 'hard', 1, 1, -500);
    expect(scored.delta).toBe(32);
    expect(scored.speedPoints).toBe(12);
  });

  it('scores the floor when timing is unavailable, never the maximum', () => {
    expect(scoreAnswer(config, 'hard', 1, 1, null)).toMatchObject({ delta: 20, speedPoints: 0 });
  });

  it("ease-out holds value longer early than linear's straight ramp", () => {
    const eased = makeConfig({
      scoring: {
        correct: { easy: 10, medium: 15, hard: 20 },
        speedBonus: { easy: 6, medium: 9, hard: 12 },
        wrong: { easy: -5, medium: -7, hard: -10 },
        noAnswer: { easy: 0, medium: 0, hard: 0 },
        speed: { fullBonusMs: 1000, curve: 'ease-out' },
      },
    });
    // At the midpoint a squared falloff is still above the straight line.
    const mid = WINDOW / 2;
    expect(speedFactor(eased, mid)).toBeLessThan(speedFactor(config, mid));
    // ...but both start and end at the same places.
    expect(speedFactor(eased, 0)).toBe(1);
    expect(speedFactor(eased, WINDOW)).toBe(0);
  });

  it('exposes the live value the UI counts down', () => {
    expect(liveValue(config, 'hard', 0)).toBe(32);
    expect(liveValue(config, 'hard', WINDOW)).toBe(20);
    expect(liveValue(config, 'hard', WINDOW / 2)).toBeLessThan(32);
    expect(liveValue(config, 'hard', WINDOW / 2)).toBeGreaterThan(20);
  });

  it('exposes both ends of the stake so the UI can show a range', () => {
    expect(stakeFor(config, 'hard')).toEqual({ correct: 20, fastest: 32, wrong: -10 });
  });

  it('leaves a blind guess negative-expected-value at every tier', () => {
    // The bonus only ever applies to a correct answer, so it cannot rescue a
    // guess: the expected value is unchanged from flat scoring at the floor.
    for (const tier of ['easy', 'medium', 'hard'] as const) {
      expect(guessExpectedValue(config, tier)).toBeLessThan(0);
    }
  });

  it('makes a blind guess negative-expected-value at every tier', () => {
    expect(guessExpectedValue(config, 'easy')).toBeCloseTo(-1.25, 5);
    expect(guessExpectedValue(config, 'medium')).toBeCloseTo(-1.5, 5);
    expect(guessExpectedValue(config, 'hard')).toBeCloseTo(-2.5, 5);
    for (const tier of ['easy', 'medium', 'hard'] as const) {
      expect(guessExpectedValue(config, tier)).toBeLessThan(0);
    }
  });

  it('swings the gap by base plus penalty when one is right and one is wrong', () => {
    const right = scoreAnswer(config, 'hard', 2, 2, WINDOW);
    const wrong = scoreAnswer(config, 'hard', 1, 2, WINDOW);
    expect(right.delta - wrong.delta).toBe(30);
  });
});

describe('config validation guards the rules', () => {
  it('rejects a mix that does not sum to questionsPerMatch', () => {
    expect(() =>
      makeConfig({
        difficultyMixes: {
          casual: { easy: 12, medium: 6, hard: 2 },
          balanced: { easy: 6, medium: 9, hard: 5 },
          tough: { easy: 2, medium: 6, hard: 99 },
        },
      }),
    ).toThrow(/sums to 107 but questionsPerMatch is 20/);
  });

  const scoringWith = (patch: Record<string, unknown>) => ({
    correct: { easy: 10, medium: 15, hard: 20 },
    speedBonus: { easy: 6, medium: 9, hard: 12 },
    wrong: { easy: -5, medium: -7, hard: -10 },
    noAnswer: { easy: 0, medium: 0, hard: 0 },
    speed: { fullBonusMs: 1000, curve: 'linear' },
    ...patch,
  });

  it('rejects positive scoring for a wrong answer', () => {
    expect(() =>
      makeConfig({ scoring: scoringWith({ wrong: { easy: 5, medium: -7, hard: -10 } }) }),
    ).toThrow(/must be zero or negative/);
  });

  it('rejects a missing difficulty tier', () => {
    expect(() => makeConfig({ scoring: scoringWith({ correct: { easy: 10, medium: 15 } }) })).toThrow(
      /scoring\.correct\.hard is missing/,
    );
  });

  it('rejects a negative speed bonus', () => {
    expect(() =>
      makeConfig({ scoring: scoringWith({ speedBonus: { easy: -1, medium: 9, hard: 12 } }) }),
    ).toThrow(/scoring\.speedBonus\.easy must be >= 0/);
  });

  it('rejects an unknown speed curve', () => {
    expect(() =>
      makeConfig({ scoring: scoringWith({ speed: { fullBonusMs: 1000, curve: 'bouncy' } }) }),
    ).toThrow(/must be 'linear' or 'ease-out'/);
  });

  it('rejects a full-bonus window that swallows the whole answer window', () => {
    expect(() =>
      makeConfig({ scoring: scoringWith({ speed: { fullBonusMs: 20000, curve: 'linear' } }) }),
    ).toThrow(/must be shorter than/);
  });

  it('rejects a sudden-death mix that is not exactly one question', () => {
    expect(() => makeConfig({ suddenDeath: { maxRounds: 5, mix: { easy: 1, medium: 1, hard: 0 } } })).toThrow(
      /must sum to exactly 1/,
    );
  });

  it('rejects a fallback order that points a tier at itself', () => {
    expect(() =>
      makeConfig({
        selection: {
          tierShortfallPolicy: 'prefer-fresh',
          fallbackOrder: { hard: ['hard'], medium: ['easy'], easy: ['medium'] },
        },
      }),
    ).toThrow(/must not contain hard itself/);
  });

  it('rejects an ambiguous room code alphabet', () => {
    expect(() =>
      makeConfig({
        room: { codeLength: 4, codeAlphabet: 'AABCDEFGH', maxRooms: 10, idleRoomTtlMs: 120000 },
      }),
    ).toThrow(/must not repeat characters/);
  });

  it('rejects a non-object root', () => {
    expect(() => validateConfig(null)).toThrow(/must be an object/);
  });

  it('accepts the shipped rules.json', () => {
    expect(realConfig().questionsPerMatch).toBe(20);
    expect(realConfig().difficultyMixes.tough).toEqual({ easy: 2, medium: 6, hard: 12 });
  });
});
