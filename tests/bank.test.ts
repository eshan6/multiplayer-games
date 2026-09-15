import { describe, expect, it } from 'vitest';
import { validateBank, BankValidationError } from '../src/server/bank.js';
import { realBank } from './helpers.js';

const validRow = {
  id: 'X-0001',
  category: 'c',
  difficulty: 'easy',
  question: 'Is this a question?',
  options: ['a', 'b', 'c', 'd'],
  answer: 2,
};
const wrap = (rows: unknown[]) => ({
  version: 1,
  categories: [{ id: 'c', name: 'C', count: rows.length, easy: 0, medium: 0, hard: 0 }],
  questions: rows,
});

describe('bank validation', () => {
  it('accepts a well-formed bank', () => {
    const bank = validateBank(wrap([validRow]));
    expect(bank.questions).toHaveLength(1);
    expect(bank.index.get('c')!.easy).toHaveLength(1);
  });

  it('rejects duplicate question ids', () => {
    expect(() => validateBank(wrap([validRow, { ...validRow }]))).toThrow(/duplicate question id/);
  });

  it('rejects an answer index out of range', () => {
    expect(() => validateBank(wrap([{ ...validRow, answer: 4 }]))).toThrow(/out of range/);
    expect(() => validateBank(wrap([{ ...validRow, answer: -1 }]))).toThrow(/out of range/);
  });

  it('rejects a non-integer answer index', () => {
    expect(() => validateBank(wrap([{ ...validRow, answer: 1.5 }]))).toThrow(/out of range/);
  });

  it('rejects anything other than exactly four options', () => {
    expect(() => validateBank(wrap([{ ...validRow, options: ['a', 'b', 'c'] }]))).toThrow(/expected exactly 4/);
    expect(() => validateBank(wrap([{ ...validRow, options: ['a', 'b', 'c', 'd', 'e'] }]))).toThrow(
      /expected exactly 4/,
    );
  });

  it('rejects duplicate options, including case and whitespace variants', () => {
    expect(() => validateBank(wrap([{ ...validRow, options: ['a', 'A', 'c', 'd'] }]))).toThrow(
      /duplicate options/,
    );
    expect(() => validateBank(wrap([{ ...validRow, options: ['a ', 'a', 'c', 'd'] }]))).toThrow(
      /duplicate options/,
    );
  });

  it('rejects a question in an undeclared category', () => {
    expect(() => validateBank(wrap([{ ...validRow, category: 'nope' }]))).toThrow(/not a declared category/);
  });

  it('rejects an unknown difficulty', () => {
    expect(() => validateBank(wrap([{ ...validRow, difficulty: 'brutal' }]))).toThrow(/difficulty/);
  });

  it('collects several problems rather than stopping at the first', () => {
    try {
      validateBank(wrap([{ ...validRow, answer: 9 }, { ...validRow, id: 'X-2', options: ['a'] }]));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BankValidationError);
      expect((err as BankValidationError).problems.length).toBe(2);
    }
  });
});

describe('the shipped quiz_bank.json', () => {
  const bank = realBank();

  it('loads and validates', () => {
    expect(bank.questions.length).toBe(2808);
    expect(bank.categories).toHaveLength(10);
  });

  it('has no duplicate ids', () => {
    expect(new Set(bank.questions.map((q) => q.id)).size).toBe(bank.questions.length);
  });

  it('has no duplicate question text', () => {
    const texts = bank.questions.map((q) => q.question.trim().toLowerCase());
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('indexes every question under its category and tier', () => {
    const indexed = [...bank.index.values()].reduce(
      (n, tiers) => n + tiers.easy.length + tiers.medium.length + tiers.hard.length,
      0,
    );
    expect(indexed).toBe(bank.questions.length);
  });

  it('matches the category counts the brief specified', () => {
    const actual = Object.fromEntries(bank.categories.map((c) => [c.id, c.count]));
    expect(actual).toEqual({
      popculture: 318,
      science: 305,
      mind: 291,
      business: 284,
      wildcards: 275,
      history: 274,
      geography: 274,
      food: 272,
      games: 260,
      tech: 255,
    });
  });

  it('still has business hard as the thinnest tier in the bank', () => {
    const business = bank.categories.find((c) => c.id === 'business')!;
    expect(business.hard).toBe(41);
    const thinnest = Math.min(...bank.categories.map((c) => Math.min(c.easy, c.medium, c.hard)));
    expect(thinnest).toBe(business.hard);
  });
});
