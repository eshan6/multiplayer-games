/**
 * The two places a world can live.
 *
 * `LocalStore` keeps it in this browser: one player, nothing to set up.
 * `SharedStore` keeps it in the page's shared database and live room, so two
 * people who open the same link are in the same world, see each other move,
 * and find it as they left it.
 *
 * Both hold a full mirror of every collection in memory and apply your own
 * writes to it at once, so the game never waits on the network to show you
 * what you just did.
 */
import { COLLECTIONS, type CollectionName, type Collections, type Peer, type Presence, type Store } from './world';

type Mirror = { [K in CollectionName]: Map<string, Collections[K]> };
type Listener = (name: CollectionName, id: string) => void;

const emptyMirror = (): Mirror => Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()])) as Mirror;

abstract class BaseStore implements Store {
  abstract readonly self: string;
  abstract readonly shared: boolean;
  protected readonly mirror = emptyMirror();
  private readonly listeners = new Set<Listener>();

  all<K extends CollectionName>(name: K): ReadonlyMap<string, Collections[K]> {
    return this.mirror[name];
  }

  put<K extends CollectionName>(name: K, id: string, doc: Collections[K]): void {
    this.mirror[name].set(id, doc);
    this.notify(name, id);
    this.write(name, id, doc);
  }

  drop(name: CollectionName, id: string): void {
    if (!this.mirror[name].delete(id)) return;
    this.notify(name, id);
    this.write(name, id, null);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  protected notify(name: CollectionName, id: string) {
    for (const fn of this.listeners) fn(name, id);
  }

  protected abstract write(name: CollectionName, id: string, doc: object | null): void;
  abstract present(p: Presence): void;
  abstract peers(): Peer[];
}

/** Lives only in memory. The tests use it; nothing else should. */
export class MemoryStore extends BaseStore {
  readonly shared = false;
  constructor(readonly self = 'tester') {
    super();
  }
  protected write() {}
  present() {}
  peers(): Peer[] {
    return [];
  }
}

const SAVE_KEY = 'homestead.world.v1';
const SELF_KEY = 'homestead.self';

/** One player, saved in this browser. */
export class LocalStore extends BaseStore {
  readonly shared = false;
  readonly self: string;
  private saving = 0;

  constructor() {
    super();
    let self = 'me';
    try {
      self = localStorage.getItem(SELF_KEY) ?? `p${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(SELF_KEY, self);
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null') as Record<string, Record<string, unknown>> | null;
      if (saved) {
        for (const name of COLLECTIONS) {
          for (const [id, doc] of Object.entries(saved[name] ?? {})) (this.mirror[name] as Map<string, unknown>).set(id, doc);
        }
      }
    } catch {
      // Private windows and embedded previews can refuse storage. The game
      // still runs; it just will not be there next time.
    }
    this.self = self;
  }

  protected write() {
    // Many writes arrive together (a harvest touches a crop, a ledger and a
    // goal); save once they have settled.
    clearTimeout(this.saving);
    this.saving = window.setTimeout(() => {
      try {
        const out: Record<string, Record<string, unknown>> = {};
        for (const name of COLLECTIONS) out[name] = Object.fromEntries(this.mirror[name]);
        localStorage.setItem(SAVE_KEY, JSON.stringify(out));
      } catch {
        // See above.
      }
    }, 300);
  }

  present() {}
  peers(): Peer[] {
    return [];
  }

  /** Throw the saved world away. Used by "start over". */
  static erase() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // Nothing to erase.
    }
  }
}

// ---------------------------------------------------------------------------
// The shared world. `window.claude` is provided by the page's host when the
// game is opened from its published link; none of it exists in local dev.
// ---------------------------------------------------------------------------

interface DocSnap {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}
interface DocRef {
  set(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
}
interface Db {
  collection(path: string): {
    doc(id: string): DocRef;
    onSnapshot(next: (snap: { docs: DocSnap[] }) => void, error?: (e: { code: string; message: string }) => void): () => void;
  };
}
interface RoomPeer {
  peer: string;
  by: string | null;
  isMe: boolean;
  presence: Readonly<Record<string, unknown>>;
}
interface Room {
  presence(patch: Record<string, unknown>): Promise<void>;
  peers(): readonly RoomPeer[];
}
interface User {
  id(): Promise<string | null>;
  name(): Promise<string>;
}
interface Host {
  use(name: 'db'): Promise<Db | null>;
  use(name: 'room'): Promise<Room | null>;
  use(name: 'user'): Promise<User | null>;
}

export class SharedStore extends BaseStore {
  readonly shared = true;
  /** Set if a write was refused: this viewer can look but not change things. */
  readOnly = false;
  private readonly pending = new Map<string, { name: CollectionName; id: string; doc: object | null }>();
  private readonly busy = new Set<string>();

  private constructor(
    readonly self: string,
    readonly suggestedName: string,
    private readonly db: Db,
    private readonly room: Room | null,
  ) {
    super();
  }

  /**
   * Connect to the page's shared database, or resolve null if this page is
   * not being served with one (local dev, signed-out viewers).
   */
  static async connect(): Promise<SharedStore | null> {
    const host = (window as unknown as { claude?: Host }).claude;
    if (!host?.use) return null;
    const [db, room, user] = await Promise.all([host.use('db'), host.use('room'), host.use('user')]);
    if (!db) return null;
    const id = (await user?.id().catch(() => null)) ?? null;
    if (!id) return null;
    const name = (await user?.name().catch(() => '')) ?? '';
    const store = new SharedStore(id, name, db, room);
    await store.load();
    return store;
  }

  /** Subscribe to every collection and wait for each one's first answer. */
  private load(): Promise<void> {
    const first = COLLECTIONS.map(
      (name) =>
        new Promise<void>((resolve) => {
          // Never hang the loading screen on one slow collection.
          const giveUp = setTimeout(resolve, 10_000);
          const done = () => {
            clearTimeout(giveUp);
            resolve();
          };
          this.db.collection(name).onSnapshot((snap) => {
            this.absorb(name, snap.docs);
            done();
          }, done);
        }),
    );
    return Promise.all(first).then(() => undefined);
  }

  /** Bring the mirror into line with what the database now holds. */
  private absorb(name: CollectionName, docs: DocSnap[]) {
    const map = this.mirror[name] as Map<string, unknown>;
    const seen = new Set<string>();
    for (const d of docs) {
      const data = d.data();
      if (!d.exists || !data) continue;
      seen.add(d.id);
      // A write of ours still on its way out is newer than what just came in.
      if (this.pending.has(`${name}/${d.id}`) || this.busy.has(`${name}/${d.id}`)) continue;
      if (JSON.stringify(map.get(d.id)) === JSON.stringify(data)) continue;
      map.set(d.id, data);
      this.notify(name, d.id);
    }
    for (const id of [...map.keys()]) {
      if (seen.has(id) || this.pending.has(`${name}/${id}`) || this.busy.has(`${name}/${id}`)) continue;
      map.delete(id);
      this.notify(name, id);
    }
  }

  protected write(name: CollectionName, id: string, doc: object | null) {
    this.pending.set(`${name}/${id}`, { name, id, doc });
    void this.flush(`${name}/${id}`);
  }

  /** One write at a time per document; a newer one waits and then replaces it. */
  private async flush(key: string) {
    if (this.busy.has(key)) return;
    const job = this.pending.get(key);
    if (!job) return;
    this.pending.delete(key);
    this.busy.add(key);
    try {
      const ref = this.db.collection(job.name).doc(job.id);
      if (job.doc) await ref.set(job.doc as Record<string, unknown>);
      else await ref.delete();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'not_granted' || code === 'revoked') this.readOnly = true;
      console.warn('[homestead] could not save', key, err);
    } finally {
      this.busy.delete(key);
      if (this.pending.has(key)) void this.flush(key);
    }
  }

  present(p: Presence) {
    // The host coalesces these; calling every frame is what it is built for.
    void this.room?.presence({ ...p, id: this.self }).catch(() => undefined);
  }

  peers(): Peer[] {
    const out: Peer[] = [];
    for (const peer of this.room?.peers() ?? []) {
      if (peer.isMe) continue;
      const p = peer.presence as Partial<Peer>;
      // What arrives here was written by someone else's page: check its shape
      // before trusting any of it.
      if (typeof p.x !== 'number' || typeof p.z !== 'number' || typeof p.heading !== 'number') continue;
      out.push({
        id: typeof p.id === 'string' ? p.id : peer.peer,
        name: typeof p.name === 'string' ? p.name.slice(0, 24) : 'Someone',
        avatar: (typeof p.avatar === 'string' ? p.avatar : 'f_adventurer') as Peer['avatar'],
        x: p.x,
        z: p.z,
        heading: p.heading,
        speed: typeof p.speed === 'number' ? p.speed : 0,
        riding: typeof p.riding === 'string' ? p.riding : '',
        indoors: p.indoors === true,
      });
    }
    return out;
  }
}
