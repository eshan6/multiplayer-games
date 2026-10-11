import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PairStore, pairIdFor } from '../src/server/store/pairStore.js';

const dirs: string[] = [];
function tempStorePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'standoff-store-'));
  dirs.push(dir);
  return join(dir, 'pair-history.json');
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('pair history', () => {
  it('remembers what a pair has seen, per category', () => {
    const path = tempStorePath();
    const store = new PairStore(path, 2, 0);
    store.markSeen('pair', 'science', ['SCI-0001', 'SCI-0002'], 1000);
    store.flush();

    const reopened = new PairStore(path, 2, 0);
    const seen = reopened.seenFor('pair', 'science');
    expect(seen.get('SCI-0001')).toBe(1000);
    expect(seen.size).toBe(2);
    // ...and does not bleed into a different category.
    expect(reopened.seenFor('pair', 'history').size).toBe(0);
  });

  it('survives a reopen with the same bank edition', () => {
    const path = tempStorePath();
    const a = new PairStore(path, 2, 0);
    a.markSeen('pair', 'science', ['SCI-0001'], 1000);
    a.close();
    expect(new PairStore(path, 2, 0).seenFor('pair', 'science').size).toBe(1);
  });

  /**
   * The reason this guard exists: bank v2 reused 2796 of its 2802 ids for
   * completely different questions. Carrying history across that edition would
   * hide brand-new questions as "already seen".
   */
  it('discards history recorded against a different bank edition', () => {
    const path = tempStorePath();
    const old = new PairStore(path, 1, 0);
    old.markSeen('pair', 'science', ['SCI-0001', 'SCI-0002'], 1000);
    old.close();

    const upgraded = new PairStore(path, 2, 0);
    expect(upgraded.seenFor('pair', 'science').size).toBe(0);
  });

  it('discards history from a file that predates edition tracking', () => {
    const path = tempStorePath();
    writeFileSync(path, JSON.stringify({ version: 1, pairs: { pair: { science: { 'SCI-0001': 1 } } } }));
    expect(new PairStore(path, 2, 0).seenFor('pair', 'science').size).toBe(0);
  });

  it('records the edition it wrote, so the next boot can check it', () => {
    const path = tempStorePath();
    const store = new PairStore(path, 2, 0);
    store.markSeen('pair', 'science', ['SCI-0001'], 1000);
    store.close();
    expect(JSON.parse(readFileSync(path, 'utf8')).bankVersion).toBe(2);
  });

  it('starts empty rather than throwing on a corrupt file', () => {
    const path = tempStorePath();
    writeFileSync(path, '{ not json');
    expect(() => new PairStore(path, 2, 0)).not.toThrow();
    expect(new PairStore(path, 2, 0).seenFor('pair', 'science').size).toBe(0);
  });

  it('identifies a pair by name regardless of order, case or spacing', () => {
    expect(pairIdFor('Anya', 'Bharat')).toBe(pairIdFor('Bharat', 'Anya'));
    expect(pairIdFor('  anya ', 'BHARAT')).toBe(pairIdFor('Anya', 'Bharat'));
  });

  it('forgets one category without touching the others', () => {
    const path = tempStorePath();
    const store = new PairStore(path, 2, 0);
    store.markSeen('pair', 'science', ['SCI-0001'], 1000);
    store.markSeen('pair', 'history', ['HIS-0001'], 1000);
    store.reset('pair', 'science');
    expect(store.seenFor('pair', 'science').size).toBe(0);
    expect(store.seenFor('pair', 'history').size).toBe(1);
  });
});
