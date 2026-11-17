/**
 * The shared world: what is stored, and everything that can be worked out
 * from it.
 *
 * The design rests on one idea. **Nothing is ever ticked.** A crop does not
 * have a "growth" number that something increments; it has the moment it was
 * planted, and how grown it is right now is arithmetic on the clock. A hen
 * does not get hungrier each frame; it remembers when it last ate. That is
 * why the place carries on while both of you are away, why two players never
 * disagree about how ripe a tomato is, and why there is no server loop.
 *
 * Storage is a handful of collections of small documents (see `Store`). Each
 * document has one natural writer at a time, so "last write wins" is always
 * the right answer — with one exception, the shared purse, handled by giving
 * each player their own ledger and adding them up.
 */
import {
  ANIMALS,
  BED_SLOTS,
  CROPS,
  DAY_MS,
  GOALS,
  ITEMS,
  LEVELS,
  MINUTE,
  NODES,
  SEASONS,
  SEASON_DAYS,
  START_POINTS,
  STRUCTURES,
  WATER_LASTS,
  type AnimalKind,
  type AvatarId,
  type Bundle,
  type CropId,
  type FurnitureId,
  type ItemId,
  type NodeKind,
  type StructureId,
  type Weather,
} from './catalog';

// ------------------------------------------------------------ documents ----

/** One per player. Summed across players, these are the shared purse and pantry. */
export interface Ledger {
  name: string;
  avatar: AvatarId;
  earned: number;
  spent: number;
  /** Net change this player has made to each pantry item. May go negative. */
  items: Partial<Record<ItemId, number>>;
  /** Running counts the goals watch ("cooked", "built:fence", …). */
  counts: Record<string, number>;
  seenAt: number;
}

export interface Meta {
  createdAt: number;
  weather: Weather;
  /** Added to the wall clock, so "sleep until morning" moves time for both of you. */
  clockShift: number;
  wall: number;
  floor: number;
  /** When each comfort (bed, bath, table) was last enjoyed. */
  comforts: Record<string, number>;
}

export interface Structure {
  kind: StructureId;
  x: number;
  z: number;
  rot: number;
  at: number;
  by: string;
}

export interface Furniture {
  kind: FurnitureId;
  x: number;
  z: number;
  rot: number;
}

export interface Animal {
  kind: AnimalKind;
  name: string;
  /** Structure it lives in, or '' for the dog. */
  home: string;
  /** A hue shift so two hens are not twins. 0..1. */
  coat: number;
  fedAt: number;
  washedAt: number;
  playedAt: number;
  collectedAt: number;
}

export interface Crop {
  kind: CropId;
  plantedAt: number;
  wateredAt: number;
  /** Milliseconds of watered growing already banked from earlier waterings. */
  watered: number;
}

export interface Collections {
  meta: Meta;
  ledgers: Ledger;
  structures: Structure;
  furniture: Furniture;
  animals: Animal;
  /** Keyed `${bedId}:${slot}`. */
  crops: Crop;
  /** Keyed by node id; value is when it was last gathered. */
  nodes: { at: number };
  /** Keyed by goal index; exists once claimed. */
  goals: { at: number; by: string };
}

export type CollectionName = keyof Collections;
export const COLLECTIONS: CollectionName[] = ['meta', 'ledgers', 'structures', 'furniture', 'animals', 'crops', 'nodes', 'goals'];

// ---------------------------------------------------------------- store ----

/** What one player is doing right now. Never stored; shared live. */
export interface Presence {
  name: string;
  avatar: AvatarId;
  x: number;
  z: number;
  heading: number;
  speed: number;
  /** Id of the animal being ridden, or ''. */
  riding: string;
  indoors: boolean;
  /** The move being performed (entities/moves.ts), or ''. Only ever shown, never trusted. */
  doing: string;
}

export interface Peer extends Presence {
  id: string;
}

/**
 * Where the world is kept. The game only ever talks to this interface, so the
 * same rules run against browser storage when you play alone and against the
 * shared database when you play together.
 */
export interface Store {
  /** This player's id: stable across visits. */
  readonly self: string;
  /** True when other people can be in this world with you. */
  readonly shared: boolean;
  /** Live mirror of a collection. Read it freely; never mutate it. */
  all<K extends CollectionName>(name: K): ReadonlyMap<string, Collections[K]>;
  put<K extends CollectionName>(name: K, id: string, doc: Collections[K]): void;
  drop(name: CollectionName, id: string): void;
  /** Called whenever any document changes, from here or from the other player. */
  subscribe(fn: (name: CollectionName, id: string) => void): () => void;
  present(p: Presence): void;
  peers(): Peer[];
}

export const newId = (self: string) => `${self.slice(0, 5)}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

// ---------------------------------------------------------------- clock ----

const DEFAULT_META: Meta = { createdAt: 0, weather: 'clear', clockShift: 0, wall: 0, floor: 0, comforts: {} };

export function meta(store: Store): Meta {
  return store.all('meta').get('world') ?? DEFAULT_META;
}

export interface Clock {
  /** 0..24. */
  hour: number;
  /** Day 1 is the day the two of you arrived. */
  day: number;
  season: (typeof SEASONS)[number];
  /** 0..4, continuous: 0 = start of spring, 1.5 = high summer. */
  seasonAt: number;
}

/** The world starts at eight in the morning of day one. */
const START_HOUR = 8;

export function clock(m: Meta, now: number): Clock {
  const t = now + m.clockShift - m.createdAt + (START_HOUR / 24) * DAY_MS;
  const days = t / DAY_MS;
  const seasonAt = (days / SEASON_DAYS) % SEASONS.length;
  return {
    hour: (((days % 1) + 1) % 1) * 24,
    day: Math.floor(days) + 1,
    season: SEASONS[Math.floor(seasonAt)]!,
    seasonAt,
  };
}

/** How far to shift the clock so that it reads `hour` next. */
export function shiftToHour(m: Meta, now: number, hour: number): number {
  const current = clock(m, now).hour;
  const ahead = (hour - current + 24) % 24;
  return m.clockShift + (ahead / 24) * DAY_MS;
}

// ---------------------------------------------------- purse and pantry ----

export const emptyLedger = (name = 'Someone', avatar: AvatarId = 'f_adventurer'): Ledger => ({
  name,
  avatar,
  earned: 0,
  spent: 0,
  items: {},
  counts: {},
  seenAt: 0,
});

export function myLedger(store: Store): Ledger {
  return store.all('ledgers').get(store.self) ?? emptyLedger();
}

export function points(store: Store): number {
  let total = START_POINTS;
  for (const l of store.all('ledgers').values()) total += l.earned - l.spent;
  return Math.max(0, Math.round(total));
}

export function lifetime(store: Store): number {
  let total = 0;
  for (const l of store.all('ledgers').values()) total += l.earned;
  return Math.round(total);
}

export function level(store: Store): { index: number; title: string; next: number | null; earned: number } {
  const earned = lifetime(store);
  let index = 0;
  for (let i = 0; i < LEVELS.length; i++) if (earned >= LEVELS[i]!.at) index = i;
  return { index, title: LEVELS[index]!.title, next: LEVELS[index + 1]?.at ?? null, earned };
}

export function have(store: Store, item: ItemId): number {
  let n = 0;
  for (const l of store.all('ledgers').values()) n += l.items[item] ?? 0;
  return Math.max(0, n);
}

export function pantry(store: Store): [ItemId, number][] {
  return (Object.keys(ITEMS) as ItemId[]).map((id) => [id, have(store, id)] as [ItemId, number]).filter(([, n]) => n > 0);
}

export function hasAll(store: Store, bundle: Bundle | undefined): boolean {
  if (!bundle) return true;
  return (Object.entries(bundle) as [ItemId, number][]).every(([id, n]) => have(store, id) >= n);
}

export function count(store: Store, key: string): number {
  let n = 0;
  for (const l of store.all('ledgers').values()) n += l.counts[key] ?? 0;
  return n;
}

/** Describes a bundle in words: "2 logs, 1 stone". */
export function describe(bundle: Bundle | undefined): string {
  if (!bundle) return '';
  return (Object.entries(bundle) as [ItemId, number][])
    .map(([id, n]) => `${n} ${n === 1 ? ITEMS[id].name : ITEMS[id].many}`)
    .join(', ');
}

// ---------------------------------------------------------------- crops ----

/** 0 just planted → 1 ready to harvest. */
export function ripeness(crop: Crop, now: number): number {
  const def = CROPS[crop.kind];
  const elapsed = Math.max(0, now - crop.plantedAt);
  const wetNow = Math.min(Math.max(0, now - crop.wateredAt), WATER_LASTS);
  const wet = Math.min(elapsed, crop.watered + (crop.wateredAt ? wetNow : 0));
  // Dry ground grows at half pace: every watered minute counts double.
  const grown = (elapsed + wet) / 2;
  return Math.min(1, grown / (def.minutes * MINUTE));
}

export function isWatered(crop: Crop, now: number): boolean {
  return crop.wateredAt > 0 && now - crop.wateredAt < WATER_LASTS;
}

/** Which of the four models to show. */
export function cropStage(crop: Crop, now: number): 1 | 2 | 3 | 4 {
  const r = ripeness(crop, now);
  return r >= 1 ? 4 : r >= 0.6 ? 3 : r >= 0.25 ? 2 : 1;
}

export const slotId = (bed: string, slot: number) => `${bed}:${slot}`;

export function bedSlots(store: Store, bed: string): (Crop | undefined)[] {
  const crops = store.all('crops');
  return Array.from({ length: BED_SLOTS }, (_, i) => crops.get(slotId(bed, i)));
}

// -------------------------------------------------------------- animals ----

export interface Needs {
  food: number;
  clean: number;
  fun: number;
  /** The lowest of the three: how the animal is doing overall. */
  mood: number;
}

const need = (since: number, spanMinutes: number, now: number) =>
  since === 0 ? 0.5 : Math.max(0, Math.min(1, 1 - (now - since) / (spanMinutes * MINUTE)));

export function needs(a: Animal, now: number): Needs {
  const def = ANIMALS[a.kind];
  const food = need(a.fedAt, def.hungerSpan, now);
  const clean = need(a.washedAt, def.cleanSpan, now);
  const fun = need(a.playedAt, def.playSpan, now);
  return { food, clean, fun, mood: Math.min(food, clean, fun) };
}

/** How many eggs (or pails, or truffles) are waiting to be collected. */
export function produceReady(a: Animal, now: number): number {
  const def = ANIMALS[a.kind];
  if (!('produce' in def) || !def.produce) return 0;
  // A hungry animal stops laying: nothing accrues past the point it ran out.
  const fedUntil = a.fedAt + def.hungerSpan * MINUTE;
  const until = Math.min(now, fedUntil);
  const n = Math.floor(Math.max(0, until - a.collectedAt) / (def.produce.every * MINUTE));
  return Math.min(def.produce.holds, n);
}

export function animalsOf(store: Store, home: string): [string, Animal][] {
  return [...store.all('animals')].filter(([, a]) => a.home === home);
}

export function roomFor(store: Store, kind: AnimalKind): string | null {
  const def = ANIMALS[kind];
  if (!def.home) return '';
  for (const [id, s] of store.all('structures')) {
    if (s.kind !== def.home) continue;
    const living = animalsOf(store, id).filter(([, a]) => ANIMALS[a.kind].home === def.home).length;
    if (living < def.perHome) return id;
  }
  return null;
}

// ---------------------------------------------------------------- nodes ----

export function nodeReady(store: Store, id: string, kind: NodeKind, now: number): boolean {
  const last = store.all('nodes').get(id)?.at ?? 0;
  return now - last >= NODES[kind].regrow * MINUTE;
}

// ---------------------------------------------------------------- goals ----

export function goalProgress(store: Store, index: number): number {
  const g = GOALS[index]!;
  if (g.watch === 'homely') {
    const kinds = new Set([...store.all('furniture').values()].map((f) => f.kind));
    const has = (ids: string[]) => ids.some((k) => kinds.has(k as FurnitureId));
    return Number(has(['bed_double', 'bed_twin'])) + Number(has(['table', 'round_table'])) + Number(has(['stove']));
  }
  if (g.watch === 'garden') {
    let n = 0;
    for (const s of store.all('structures').values()) if (STRUCTURES[s.kind].group === 'Garden') n++;
    return n;
  }
  if (g.watch.startsWith('built:')) {
    const kind = g.watch.slice(6);
    let n = 0;
    for (const s of store.all('structures').values()) if (s.kind === kind) n++;
    return n;
  }
  return count(store, g.watch);
}

/** The first goal nobody has claimed yet, or -1 when they are all done. */
export function currentGoal(store: Store): number {
  const done = store.all('goals');
  for (let i = 0; i < GOALS.length; i++) if (!done.has(String(i))) return i;
  return -1;
}
