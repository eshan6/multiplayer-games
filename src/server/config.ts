/**
 * Loads config/rules.json and validates it hard at boot.
 *
 * Game rules do not live anywhere else. If you find a magic number in the
 * engine, it is a bug — move it here.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DIFFICULTIES, SUPPORTED_MIXES } from '../shared/protocol.js';
import type { Difficulty, MixName } from '../shared/protocol.js';

export type TierCounts = Record<Difficulty, number>;

export interface GameConfig {
  questionsPerMatch: number;
  difficultyMixes: Record<MixName, TierCounts>;
  scoring: {
    correct: TierCounts;
    wrong: TierCounts;
    noAnswer: TierCounts;
  };
  timing: {
    answerWindowMs: number;
    ackTimeoutMs: number;
    armBufferMs: number;
    maxLatencyGraceMs: number;
    revealDurationMs: number;
    interQuestionMs: number;
    disconnectGraceMs: number;
    clockSyncSamples: number;
  };
  suddenDeath: {
    maxRounds: number;
    mix: TierCounts;
  };
  selection: {
    tierShortfallPolicy: 'prefer-fresh' | 'prefer-difficulty';
    fallbackOrder: Record<Difficulty, Difficulty[]>;
  };
  room: {
    codeLength: number;
    codeAlphabet: string;
    maxRooms: number;
    idleRoomTtlMs: number;
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(`config/rules.json is invalid: ${message}`);
    this.name = 'ConfigError';
  }
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireInt(value: unknown, path: string, opts: { min?: number; max?: number } = {}): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new ConfigError(`${path} must be an integer, got ${JSON.stringify(value)}`);
  }
  if (opts.min !== undefined && value < opts.min) {
    throw new ConfigError(`${path} must be >= ${opts.min}, got ${value}`);
  }
  if (opts.max !== undefined && value > opts.max) {
    throw new ConfigError(`${path} must be <= ${opts.max}, got ${value}`);
  }
  return value;
}

function requireTierCounts(value: unknown, path: string, opts: { min?: number } = {}): TierCounts {
  const raw = requireObject(value, path);
  const out = {} as TierCounts;
  for (const tier of DIFFICULTIES) {
    if (!(tier in raw)) throw new ConfigError(`${path}.${tier} is missing`);
    out[tier] = requireInt(raw[tier], `${path}.${tier}`, opts);
  }
  return out;
}

export function validateConfig(raw: unknown): GameConfig {
  const root = requireObject(raw, 'root');

  const questionsPerMatch = requireInt(root.questionsPerMatch, 'questionsPerMatch', { min: 1, max: 200 });

  const mixesRaw = requireObject(root.difficultyMixes, 'difficultyMixes');
  const difficultyMixes = {} as Record<MixName, TierCounts>;
  for (const mix of SUPPORTED_MIXES) {
    if (!(mix in mixesRaw)) throw new ConfigError(`difficultyMixes.${mix} is missing`);
    const counts = requireTierCounts(mixesRaw[mix], `difficultyMixes.${mix}`, { min: 0 });
    const sum = counts.easy + counts.medium + counts.hard;
    if (sum !== questionsPerMatch) {
      throw new ConfigError(
        `difficultyMixes.${mix} sums to ${sum} but questionsPerMatch is ${questionsPerMatch}. ` +
          `Adjust the mix or questionsPerMatch so they agree.`,
      );
    }
    difficultyMixes[mix] = counts;
  }

  const scoringRaw = requireObject(root.scoring, 'scoring');
  const scoring = {
    correct: requireTierCounts(scoringRaw.correct, 'scoring.correct'),
    wrong: requireTierCounts(scoringRaw.wrong, 'scoring.wrong'),
    noAnswer: requireTierCounts(scoringRaw.noAnswer, 'scoring.noAnswer'),
  };
  for (const tier of DIFFICULTIES) {
    if (scoring.correct[tier] <= 0) {
      throw new ConfigError(`scoring.correct.${tier} must be positive, got ${scoring.correct[tier]}`);
    }
    if (scoring.wrong[tier] > 0) {
      throw new ConfigError(
        `scoring.wrong.${tier} must be zero or negative (negative marking), got ${scoring.wrong[tier]}`,
      );
    }
  }

  const timingRaw = requireObject(root.timing, 'timing');
  const timing = {
    answerWindowMs: requireInt(timingRaw.answerWindowMs, 'timing.answerWindowMs', { min: 1000 }),
    ackTimeoutMs: requireInt(timingRaw.ackTimeoutMs, 'timing.ackTimeoutMs', { min: 0 }),
    armBufferMs: requireInt(timingRaw.armBufferMs, 'timing.armBufferMs', { min: 0, max: 5000 }),
    maxLatencyGraceMs: requireInt(timingRaw.maxLatencyGraceMs, 'timing.maxLatencyGraceMs', {
      min: 0,
      max: 5000,
    }),
    revealDurationMs: requireInt(timingRaw.revealDurationMs, 'timing.revealDurationMs', { min: 0 }),
    interQuestionMs: requireInt(timingRaw.interQuestionMs, 'timing.interQuestionMs', { min: 0 }),
    disconnectGraceMs: requireInt(timingRaw.disconnectGraceMs, 'timing.disconnectGraceMs', { min: 0 }),
    clockSyncSamples: requireInt(timingRaw.clockSyncSamples, 'timing.clockSyncSamples', {
      min: 1,
      max: 25,
    }),
  };

  const sdRaw = requireObject(root.suddenDeath, 'suddenDeath');
  const sdMix = requireTierCounts(sdRaw.mix, 'suddenDeath.mix', { min: 0 });
  if (sdMix.easy + sdMix.medium + sdMix.hard !== 1) {
    throw new ConfigError('suddenDeath.mix must sum to exactly 1 — sudden death is one question at a time');
  }
  const suddenDeath = {
    maxRounds: requireInt(sdRaw.maxRounds, 'suddenDeath.maxRounds', { min: 1, max: 100 }),
    mix: sdMix,
  };

  const selRaw = requireObject(root.selection, 'selection');
  const policy = selRaw.tierShortfallPolicy;
  if (policy !== 'prefer-fresh' && policy !== 'prefer-difficulty') {
    throw new ConfigError(
      `selection.tierShortfallPolicy must be 'prefer-fresh' or 'prefer-difficulty', got ${JSON.stringify(policy)}`,
    );
  }
  const fbRaw = requireObject(selRaw.fallbackOrder, 'selection.fallbackOrder');
  const fallbackOrder = {} as Record<Difficulty, Difficulty[]>;
  for (const tier of DIFFICULTIES) {
    const list = fbRaw[tier];
    if (!Array.isArray(list) || list.some((t) => !DIFFICULTIES.includes(t as Difficulty))) {
      throw new ConfigError(`selection.fallbackOrder.${tier} must be an array of difficulty names`);
    }
    if (list.includes(tier)) {
      throw new ConfigError(`selection.fallbackOrder.${tier} must not contain ${tier} itself`);
    }
    fallbackOrder[tier] = list as Difficulty[];
  }

  const roomRaw = requireObject(root.room, 'room');
  const codeAlphabet = roomRaw.codeAlphabet;
  if (typeof codeAlphabet !== 'string' || codeAlphabet.length < 8) {
    throw new ConfigError('room.codeAlphabet must be a string of at least 8 characters');
  }
  if (new Set(codeAlphabet).size !== codeAlphabet.length) {
    throw new ConfigError('room.codeAlphabet must not repeat characters');
  }
  const room = {
    codeLength: requireInt(roomRaw.codeLength, 'room.codeLength', { min: 3, max: 10 }),
    codeAlphabet,
    maxRooms: requireInt(roomRaw.maxRooms, 'room.maxRooms', { min: 1 }),
    idleRoomTtlMs: requireInt(roomRaw.idleRoomTtlMs, 'room.idleRoomTtlMs', { min: 60000 }),
  };

  return {
    questionsPerMatch,
    difficultyMixes,
    scoring,
    timing,
    suddenDeath,
    selection: { tierShortfallPolicy: policy, fallbackOrder },
    room,
  };
}

export function loadConfig(path = resolve(process.cwd(), 'config/rules.json')): GameConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new ConfigError(`could not read ${path}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`could not parse ${path}: ${(err as Error).message}`);
  }
  return validateConfig(parsed);
}
