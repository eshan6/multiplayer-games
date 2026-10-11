/**
 * Which questions a pair has already seen, per category.
 *
 * A JSON file on disk. The whole dataset is two people's question history —
 * kilobytes — so a database would be ceremony. Writes are debounced and atomic
 * (write temp, rename) so a crash mid-write cannot leave a truncated file that
 * would wipe the history on next boot.
 *
 * There are no accounts, so a "pair" is identified by the two display names,
 * normalised and sorted. Set PAIR_ID in the environment to pin it explicitly if
 * you want history to survive renaming yourselves.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** categoryId -> questionId -> epoch ms last seen. */
type CategoryHistory = Record<string, Record<string, number>>;
interface StoreShape {
  version: 1;
  /**
   * The quiz bank this history was recorded against.
   *
   * History keys on question id, and a new bank edition can REUSE an id for a
   * completely different question — bank v2 did exactly that for 2796 of its
   * 2802 ids. Carrying the history across that would suppress brand-new
   * questions as "already seen", which is worse than having no history at all.
   */
  bankVersion: number;
  pairs: Record<string, CategoryHistory>;
}

const EMPTY: StoreShape = { version: 1, bankVersion: 0, pairs: {} };

export function pairIdFor(nameA: string, nameB: string): string {
  const envPin = process.env.PAIR_ID?.trim();
  if (envPin) return envPin;
  const norm = (n: string) => n.trim().toLowerCase().replace(/\s+/g, ' ');
  return [norm(nameA), norm(nameB)].sort().join('::');
}

export class PairStore {
  private data: StoreShape = structuredClone(EMPTY);
  private flushTimer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(
    private readonly path: string,
    /** Edition of the loaded bank. History from another edition is discarded. */
    private readonly bankVersion: number,
    private readonly flushDelayMs = 400,
  ) {
    this.data.bankVersion = bankVersion;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as StoreShape;
      if (parsed && typeof parsed === 'object' && parsed.pairs && typeof parsed.pairs === 'object') {
        const storedFor = typeof parsed.bankVersion === 'number' ? parsed.bankVersion : 0;
        if (storedFor !== this.bankVersion) {
          // Ids are not stable across bank editions, so the history means
          // nothing here. Drop it rather than hide fresh questions behind it.
          console.warn(
            `[store] history was recorded against quiz bank v${storedFor} but v${this.bankVersion} ` +
              `is loaded; discarding it. Question ids are reused between editions, so keeping it ` +
              `would mark new questions as already seen.`,
          );
          this.dirty = true;
          return;
        }
        this.data = { version: 1, bankVersion: this.bankVersion, pairs: parsed.pairs };
      }
    } catch (err) {
      // A corrupt history file must not stop two people playing. Start fresh
      // and say so loudly; the only thing lost is repeat avoidance.
      console.error(
        `[store] ${this.path} is unreadable (${(err as Error).message}); starting with empty history`,
      );
    }
  }

  /** questionId -> last seen, for one pair in one category. */
  seenFor(pairId: string, categoryId: string): ReadonlyMap<string, number> {
    const raw = this.data.pairs[pairId]?.[categoryId] ?? {};
    return new Map(Object.entries(raw));
  }

  markSeen(pairId: string, categoryId: string, questionIds: readonly string[], at: number): void {
    if (questionIds.length === 0) return;
    const pair = (this.data.pairs[pairId] ??= {});
    const cat = (pair[categoryId] ??= {});
    for (const id of questionIds) cat[id] = at;
    this.scheduleFlush();
  }

  /** Forget a pair's history for one category, or all of them. */
  reset(pairId: string, categoryId?: string): void {
    if (!this.data.pairs[pairId]) return;
    if (categoryId) delete this.data.pairs[pairId][categoryId];
    else delete this.data.pairs[pairId];
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, this.flushDelayMs);
    this.flushTimer.unref?.();
  }

  flush(): void {
    if (!this.dirty) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data), 'utf8');
      renameSync(tmp, this.path);
      this.dirty = false;
    } catch (err) {
      console.error(`[store] could not write ${this.path}: ${(err as Error).message}`);
    }
  }

  close(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.flush();
  }
}

export function defaultStorePath(): string {
  const dir = process.env.DATA_DIR ?? resolve(process.cwd(), '.data');
  return resolve(dir, 'pair-history.json');
}
