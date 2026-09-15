import { validateConfig, type GameConfig } from '../src/server/config.js';
import { validateBank, type QuizBank } from '../src/server/bank.js';
import { loadConfig } from '../src/server/config.js';
import { loadBank } from '../src/server/bank.js';
import type { Difficulty } from '../src/shared/protocol.js';

let cachedBank: QuizBank | null = null;
let cachedConfig: GameConfig | null = null;

/** The real shipped bank. Tests assert against actual data, not a toy fixture. */
export function realBank(): QuizBank {
  if (!cachedBank) cachedBank = loadBank().bank;
  return cachedBank;
}

export function realConfig(): GameConfig {
  if (!cachedConfig) cachedConfig = loadConfig();
  return cachedConfig;
}

/** Build a synthetic bank with exact tier counts, for testing scarcity precisely. */
export function makeBank(spec: Record<string, { easy: number; medium: number; hard: number }>): QuizBank {
  const categories = Object.entries(spec).map(([id, tiers]) => ({
    id,
    name: id,
    count: tiers.easy + tiers.medium + tiers.hard,
    ...tiers,
  }));
  const questions: unknown[] = [];
  for (const [id, tiers] of Object.entries(spec)) {
    for (const tier of ['easy', 'medium', 'hard'] as Difficulty[]) {
      for (let i = 0; i < tiers[tier]; i++) {
        questions.push({
          id: `${id}-${tier}-${String(i).padStart(4, '0')}`,
          category: id,
          difficulty: tier,
          question: `${id} ${tier} question ${i}?`,
          options: ['alpha', 'bravo', 'charlie', 'delta'],
          answer: i % 4,
        });
      }
    }
  }
  return validateBank({ version: 1, categories, questions });
}

export function makeConfig(overrides: Record<string, unknown> = {}): GameConfig {
  const base = {
    questionsPerMatch: 20,
    difficultyMixes: {
      casual: { easy: 12, medium: 6, hard: 2 },
      balanced: { easy: 6, medium: 9, hard: 5 },
      tough: { easy: 2, medium: 6, hard: 12 },
    },
    scoring: {
      correct: { easy: 10, medium: 15, hard: 20 },
      speedBonus: { easy: 6, medium: 9, hard: 12 },
      wrong: { easy: -5, medium: -7, hard: -10 },
      noAnswer: { easy: 0, medium: 0, hard: 0 },
      speed: { fullBonusMs: 1000, curve: 'linear' },
    },
    timing: {
      answerWindowMs: 20000,
      untimedBackstopMs: 300000,
      defaultTimed: true,
      ackTimeoutMs: 4000,
      armBufferMs: 120,
      maxLatencyGraceMs: 400,
      revealDurationMs: 3500,
      interQuestionMs: 900,
      disconnectGraceMs: 240000,
      clockSyncSamples: 5,
    },
    suddenDeath: { maxRounds: 15, mix: { easy: 0, medium: 1, hard: 0 } },
    selection: {
      tierShortfallPolicy: 'prefer-fresh',
      fallbackOrder: { hard: ['medium', 'easy'], medium: ['hard', 'easy'], easy: ['medium', 'hard'] },
    },
    room: {
      codeLength: 4,
      codeAlphabet: 'ACDEFGHJKLMNPQRTUVWXY34679',
      maxRooms: 200,
      idleRoomTtlMs: 7200000,
    },
  };
  return validateConfig({ ...base, ...overrides });
}

export function tierCounts(questions: { difficulty: Difficulty }[]): Record<Difficulty, number> {
  const out: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
  for (const q of questions) out[q.difficulty]++;
  return out;
}
