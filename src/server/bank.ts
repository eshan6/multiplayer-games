/**
 * Loads data/quiz_bank.json, validates it, and indexes it by category+tier.
 *
 * The bank is read-only input. Nothing in this codebase writes to it, and
 * nothing generates questions. If validation fails the process exits — a quiz
 * game running on a half-valid bank is worse than one that refuses to start.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DIFFICULTIES } from '../shared/protocol.js';
import type { CategoryMeta, Difficulty } from '../shared/protocol.js';

export interface BankQuestion {
  id: string;
  category: string;
  difficulty: Difficulty;
  question: string;
  options: string[];
  /** 0-based index of the correct option. Server-side only, never serialised to a client. */
  answer: number;
}

export interface QuizBank {
  version: number;
  categories: CategoryMeta[];
  questions: BankQuestion[];
  /** categoryId -> difficulty -> questions, in bank order. */
  index: Map<string, Record<Difficulty, BankQuestion[]>>;
  byId: Map<string, BankQuestion>;
}

export class BankValidationError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(
      `quiz bank failed validation with ${problems.length} problem(s):\n` +
        problems.map((p) => `  - ${p}`).join('\n'),
    );
    this.name = 'BankValidationError';
    this.problems = problems;
  }
}

const MAX_REPORTED = 25;

export function validateBank(raw: unknown): QuizBank {
  const problems: string[] = [];
  const push = (p: string) => {
    if (problems.length < MAX_REPORTED) problems.push(p);
    else if (problems.length === MAX_REPORTED) problems.push('…further problems suppressed');
  };

  if (typeof raw !== 'object' || raw === null) throw new BankValidationError(['bank root is not an object']);
  const root = raw as Record<string, unknown>;

  if (!Array.isArray(root.categories)) throw new BankValidationError(['categories is not an array']);
  if (!Array.isArray(root.questions)) throw new BankValidationError(['questions is not an array']);

  const categories: CategoryMeta[] = [];
  const seenCategoryIds = new Set<string>();
  for (const [i, c] of (root.categories as unknown[]).entries()) {
    const cat = c as Record<string, unknown>;
    if (typeof cat?.id !== 'string' || cat.id.length === 0) {
      push(`categories[${i}].id is not a non-empty string`);
      continue;
    }
    if (seenCategoryIds.has(cat.id)) {
      push(`duplicate category id "${cat.id}"`);
      continue;
    }
    seenCategoryIds.add(cat.id);
    categories.push({
      id: cat.id,
      name: typeof cat.name === 'string' ? cat.name : cat.id,
      count: typeof cat.count === 'number' ? cat.count : 0,
      easy: typeof cat.easy === 'number' ? cat.easy : 0,
      medium: typeof cat.medium === 'number' ? cat.medium : 0,
      hard: typeof cat.hard === 'number' ? cat.hard : 0,
    });
  }

  const byId = new Map<string, BankQuestion>();
  const questions: BankQuestion[] = [];

  for (const [i, q] of (root.questions as unknown[]).entries()) {
    const row = q as Record<string, unknown>;
    const at = `questions[${i}]`;
    const id = row?.id;

    if (typeof id !== 'string' || id.length === 0) {
      push(`${at}.id is not a non-empty string`);
      continue;
    }
    if (byId.has(id)) {
      push(`duplicate question id "${id}" (first seen earlier, again at ${at})`);
      continue;
    }
    if (typeof row.category !== 'string' || !seenCategoryIds.has(row.category)) {
      push(`${at} (${id}) has category "${String(row.category)}" which is not a declared category`);
      continue;
    }
    if (!DIFFICULTIES.includes(row.difficulty as Difficulty)) {
      push(`${at} (${id}) has difficulty "${String(row.difficulty)}"`);
      continue;
    }
    if (typeof row.question !== 'string' || row.question.trim().length === 0) {
      push(`${at} (${id}) has an empty question`);
      continue;
    }
    if (!Array.isArray(row.options)) {
      push(`${at} (${id}) options is not an array`);
      continue;
    }
    const options = row.options as unknown[];
    if (options.length !== 4) {
      push(`${at} (${id}) has ${options.length} options, expected exactly 4`);
      continue;
    }
    if (options.some((o) => typeof o !== 'string' || o.trim().length === 0)) {
      push(`${at} (${id}) has a non-string or empty option`);
      continue;
    }
    const normalised = (options as string[]).map((o) => o.trim().toLowerCase());
    if (new Set(normalised).size !== 4) {
      push(`${at} (${id}) has duplicate options: ${JSON.stringify(options)}`);
      continue;
    }
    if (
      typeof row.answer !== 'number' ||
      !Number.isInteger(row.answer) ||
      row.answer < 0 ||
      row.answer >= options.length
    ) {
      push(`${at} (${id}) answer index ${String(row.answer)} is out of range 0..${options.length - 1}`);
      continue;
    }

    const parsed: BankQuestion = {
      id,
      category: row.category,
      difficulty: row.difficulty as Difficulty,
      question: row.question,
      options: options as string[],
      answer: row.answer,
    };
    byId.set(id, parsed);
    questions.push(parsed);
  }

  if (problems.length > 0) throw new BankValidationError(problems);
  if (questions.length === 0) throw new BankValidationError(['bank contains no valid questions']);

  const index = new Map<string, Record<Difficulty, BankQuestion[]>>();
  for (const cat of categories) {
    index.set(cat.id, { easy: [], medium: [], hard: [] });
  }
  for (const q of questions) {
    index.get(q.category)![q.difficulty].push(q);
  }

  // Declared counts are metadata; the questions array is the truth. Reconcile so
  // the UI's freshness meter never disagrees with what selection can actually draw.
  const reconciled = categories.map((cat) => {
    const tiers = index.get(cat.id)!;
    return {
      ...cat,
      count: tiers.easy.length + tiers.medium.length + tiers.hard.length,
      easy: tiers.easy.length,
      medium: tiers.medium.length,
      hard: tiers.hard.length,
    };
  });

  return {
    version: typeof root.version === 'number' ? root.version : 0,
    categories: reconciled,
    questions,
    index,
    byId,
  };
}

/** Differences between the bank's declared counts and its actual rows. Logged, not fatal. */
export function reconcileWarnings(raw: unknown, bank: QuizBank): string[] {
  const declared = (raw as { categories?: CategoryMeta[] }).categories ?? [];
  const warnings: string[] = [];
  for (const d of declared) {
    const actual = bank.categories.find((c) => c.id === d.id);
    if (!actual) continue;
    for (const key of ['count', 'easy', 'medium', 'hard'] as const) {
      if (typeof d[key] === 'number' && d[key] !== actual[key]) {
        warnings.push(
          `category "${d.id}" declares ${key}=${d[key]} but contains ${actual[key]}; using the actual count`,
        );
      }
    }
  }
  const declaredTotal = (raw as { total?: number }).total;
  if (typeof declaredTotal === 'number' && declaredTotal !== bank.questions.length) {
    warnings.push(`bank declares total=${declaredTotal} but contains ${bank.questions.length} questions`);
  }
  return warnings;
}

export function loadBank(path = resolve(process.cwd(), 'data/quiz_bank.json')): {
  bank: QuizBank;
  warnings: string[];
} {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new BankValidationError([`could not read ${path}: ${(err as Error).message}`]);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new BankValidationError([`could not parse ${path}: ${(err as Error).message}`]);
  }
  const bank = validateBank(raw);
  return { bank, warnings: reconcileWarnings(raw, bank) };
}
