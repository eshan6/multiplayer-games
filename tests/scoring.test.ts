import { describe, expect, it } from 'vitest';
import { guessExpectedValue, scoreAnswer, stakeFor } from '../src/server/engine/scoring.js';
import { validateConfig } from '../src/server/config.js';
import { makeConfig, realConfig } from './helpers.js';

const config = realConfig();

describe('scoring', () => {
  it('awards the tier value for a correct answer', () => {
    expect(scoreAnswer(config, 'easy', 2, 2)).toEqual({ correct: true, delta: 10, answered: true });
    expect(scoreAnswer(config, 'medium', 0, 0)).toEqual({ correct: true, delta: 15, answered: true });
    expect(scoreAnswer(config, 'hard', 3, 3)).toEqual({ correct: true, delta: 20, answered: true });
  });

  it('deducts the tier penalty for a wrong answer', () => {
    expect(scoreAnswer(config, 'easy', 1, 2)).toEqual({ correct: false, delta: -5, answered: true });
    expect(scoreAnswer(config, 'medium', 1, 2)).toEqual({ correct: false, delta: -7, answered: true });
    expect(scoreAnswer(config, 'hard', 1, 2)).toEqual({ correct: false, delta: -10, answered: true });
  });

  it('scores no answer at zero, which beats guessing wrong', () => {
    for (const tier of ['easy', 'medium', 'hard'] as const) {
      const abstain = scoreAnswer(config, tier, null, 1);
      expect(abstain).toEqual({ correct: false, delta: 0, answered: false });
      expect(abstain.delta).toBeGreaterThan(scoreAnswer(config, tier, 0, 1).delta);
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

  it('exposes the stake so the risk is visible before committing', () => {
    expect(stakeFor(config, 'hard')).toEqual({ correct: 20, wrong: -10 });
  });

  it('scores a score swing symmetrically for both players', () => {
    const a = scoreAnswer(config, 'hard', 2, 2);
    const b = scoreAnswer(config, 'hard', 1, 2);
    expect(a.delta - b.delta).toBe(30);
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

  it('rejects positive scoring for a wrong answer', () => {
    expect(() =>
      makeConfig({
        scoring: {
          correct: { easy: 10, medium: 15, hard: 20 },
          wrong: { easy: 5, medium: -7, hard: -10 },
          noAnswer: { easy: 0, medium: 0, hard: 0 },
        },
      }),
    ).toThrow(/must be zero or negative/);
  });

  it('rejects a missing difficulty tier', () => {
    expect(() =>
      makeConfig({
        scoring: {
          correct: { easy: 10, medium: 15 },
          wrong: { easy: -5, medium: -7, hard: -10 },
          noAnswer: { easy: 0, medium: 0, hard: 0 },
        },
      }),
    ).toThrow(/scoring\.correct\.hard is missing/);
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
