/**
 * Everything a player can do to the world, as plain functions over a `Store`.
 *
 * Each returns an `Outcome`: whether it happened, a line to show the player,
 * and any points it earned. Nothing here knows about meshes, keys or the
 * camera — which is what lets the tests play the whole game without a screen.
 */
import {
  ANIMALS,
  BED_SLOTS,
  CARE,
  COMFORT_COOLDOWN,
  COMFORT_POINTS,
  CROPS,
  FLOORS,
  FURNITURE,
  GOALS,
  ITEMS,
  MINUTE,
  NODES,
  RECIPES,
  SHARE_MEAL_POINTS,
  STRUCTURES,
  TOGETHER_BONUS,
  WALLS,
  WATER_LASTS,
  WATER_POINTS,
  type AnimalKind,
  type AvatarId,
  type Bundle,
  type CropId,
  type FurnitureId,
  type ItemId,
  type NodeKind,
  type RecipeId,
  type StructureId,
  type Weather,
} from './catalog';
import {
  animalsOf,
  currentGoal,
  describe,
  emptyLedger,
  goalProgress,
  hasAll,
  have,
  level,
  meta,
  myLedger,
  needs,
  newId,
  nodeReady,
  points,
  produceReady,
  ripeness,
  roomFor,
  shiftToHour,
  slotId,
  type Animal,
  type Ledger,
  type Store,
} from './world';

export interface Outcome {
  ok: boolean;
  /** Shown to the player. */
  say: string;
  points?: number;
  /** True when the together bonus applied. */
  together?: boolean;
}

const no = (say: string): Outcome => ({ ok: false, say });

/** The context an action happens in: when, and whether your partner is beside you. */
export interface Moment {
  now: number;
  together: boolean;
}

function edit(store: Store, change: (l: Ledger) => void, now: number) {
  const l = structuredClone(myLedger(store));
  change(l);
  l.seenAt = now;
  store.put('ledgers', store.self, l);
}

function earn(store: Store, m: Moment, base: number, tally: Record<string, number> = {}, gain: Bundle = {}, use: Bundle = {}): { points: number; together: boolean } {
  const bonus = m.together && base > 0;
  const pts = Math.round(base * (bonus ? 1 + TOGETHER_BONUS : 1));
  edit(
    store,
    (l) => {
      l.earned += pts;
      for (const [k, n] of Object.entries(tally)) l.counts[k] = (l.counts[k] ?? 0) + n;
      for (const [k, n] of Object.entries(gain) as [ItemId, number][]) {
        l.items[k] = (l.items[k] ?? 0) + n;
        l.counts[`got:${k}`] = (l.counts[`got:${k}`] ?? 0) + n;
      }
      for (const [k, n] of Object.entries(use) as [ItemId, number][]) l.items[k] = (l.items[k] ?? 0) - n;
    },
    m.now,
  );
  claimGoals(store, m.now);
  return { points: pts, together: bonus };
}

function spend(store: Store, now: number, cost: number, materials: Bundle | undefined, tally: Record<string, number> = {}) {
  edit(
    store,
    (l) => {
      l.spent += cost;
      for (const [k, n] of Object.entries(materials ?? {}) as [ItemId, number][]) l.items[k] = (l.items[k] ?? 0) - n;
      for (const [k, n] of Object.entries(tally)) l.counts[k] = (l.counts[k] ?? 0) + n;
    },
    now,
  );
}

/** Award any goal whose count has been reached. Goals are claimed in order. */
export function claimGoals(store: Store, now: number): string[] {
  const claimed: string[] = [];
  for (;;) {
    const i = currentGoal(store);
    if (i < 0) break;
    const g = GOALS[i]!;
    if (goalProgress(store, i) < g.count) break;
    store.put('goals', String(i), { at: now, by: store.self });
    edit(store, (l) => (l.earned += g.reward), now);
    claimed.push(g.text);
  }
  return claimed;
}

// ------------------------------------------------------------- arriving ----

/** First visit to a brand-new world: pitch camp. Safe to call every time. */
export function settle(store: Store, now: number) {
  if (!store.all('meta').has('world')) {
    store.put('meta', 'world', { createdAt: now, weather: 'clear', clockShift: 0, wall: 0, floor: 0, comforts: {} });
    store.put('structures', 'camp-tent', { kind: 'tent', x: -3.5, z: -4, rot: 0.5, at: now, by: store.self });
    store.put('structures', 'camp-fire', { kind: 'campfire', x: 1.5, z: 0.5, rot: 0, at: now, by: store.self });
    const fresh = (kind: AnimalKind, name: string, coat: number): Animal => ({ kind, name, home: '', coat, fedAt: 0, washedAt: 0, playedAt: 0, collectedAt: now });
    store.put('animals', 'dog', fresh('dog', 'Biscuit', 0));
    store.put('animals', 'horse-a', fresh('horse', 'Chestnut', 0));
    store.put('animals', 'horse-b', fresh('horse', 'Willow', 0.6));
  }
}

export function join(store: Store, name: string, avatar: AvatarId, now: number) {
  const mine = store.all('ledgers').get(store.self);
  const l = mine ? structuredClone(mine) : emptyLedger();
  l.name = name.trim().slice(0, 24) || 'Someone';
  l.avatar = avatar;
  l.seenAt = now;
  store.put('ledgers', store.self, l);
}

// ------------------------------------------------------------- gathering ----

export function gather(store: Store, m: Moment, id: string, kind: NodeKind): Outcome {
  if (!nodeReady(store, id, kind, m.now)) return no('Nothing left here yet.');
  const def = NODES[kind];
  store.put('nodes', id, { at: m.now });
  const got = earn(store, m, def.points, {}, { [def.gives]: def.amount });
  return { ok: true, say: `+${def.amount} ${def.amount === 1 ? ITEMS[def.gives].name : ITEMS[def.gives].many}`, ...got };
}

// -------------------------------------------------------------- building ----

export function canAfford(store: Store, cost: number, materials?: Bundle): string | null {
  if (points(store) < cost) return `That needs ${cost} points; the basket holds ${points(store)}.`;
  if (!hasAll(store, materials)) return `That also needs ${describe(materials)}.`;
  return null;
}

export function whyNotBuild(store: Store, kind: StructureId): string | null {
  const def = STRUCTURES[kind];
  if (level(store).index < def.level) return 'Not yet: keep building your life here first.';
  if ('limit' in def && def.limit) {
    let n = 0;
    for (const s of store.all('structures').values()) if (s.kind === kind) n++;
    if (n >= def.limit) return `You already have ${def.limit === 1 ? 'one' : def.limit}.`;
  }
  return canAfford(store, def.cost, 'materials' in def ? def.materials : undefined);
}

export function build(store: Store, m: Moment, kind: StructureId, x: number, z: number, rot: number): Outcome {
  const why = whyNotBuild(store, kind);
  if (why) return no(why);
  const def = STRUCTURES[kind];
  const id = newId(store.self);
  store.put('structures', id, { kind, x, z, rot, at: m.now, by: store.self });
  spend(store, m.now, def.cost, 'materials' in def ? def.materials : undefined);
  if ('brings' in def && def.brings) {
    for (let i = 0; i < def.brings.count; i++) adopt(store, m.now, def.brings.kind, id);
  }
  claimGoals(store, m.now);
  return { ok: true, say: `${def.name} built.` };
}

/** Take something down. Half its points come back; materials do not. */
export function demolish(store: Store, m: Moment, id: string): Outcome {
  const s = store.all('structures').get(id);
  if (!s) return no('Nothing there.');
  if (animalsOf(store, id).length > 0) return no('Animals live there.');
  const def = STRUCTURES[s.kind];
  store.drop('structures', id);
  for (let i = 0; i < BED_SLOTS; i++) store.drop('crops', slotId(id, i));
  edit(store, (l) => (l.spent -= Math.floor(def.cost / 2)), m.now);
  return { ok: true, say: `${def.name} removed. ${Math.floor(def.cost / 2)} points back.` };
}

function adopt(store: Store, now: number, kind: AnimalKind, home: string) {
  const def = ANIMALS[kind];
  const taken = new Set([...store.all('animals').values()].map((a) => a.name));
  const name = def.names.find((n) => !taken.has(n)) ?? `${def.names[0]} ${taken.size}`;
  store.put('animals', newId(store.self) + Math.floor(Math.random() * 36).toString(36), {
    kind,
    name,
    home,
    coat: Math.random(),
    fedAt: 0,
    washedAt: 0,
    playedAt: 0,
    collectedAt: now,
  });
}

export function buyAnimal(store: Store, m: Moment, kind: AnimalKind): Outcome {
  const def = ANIMALS[kind];
  const home = roomFor(store, kind);
  if (home === null) return no(`No room: build ${def.home ? `a ${STRUCTURES[def.home as StructureId].name.toLowerCase()}` : 'somewhere for it'} first.`);
  const why = canAfford(store, def.cost);
  if (why) return no(why);
  adopt(store, m.now, kind, home);
  spend(store, m.now, def.cost, undefined);
  return { ok: true, say: `A new ${def.name} has joined the family.` };
}

// --------------------------------------------------------------- farming ----

export function plant(store: Store, m: Moment, bed: string, slot: number, kind: CropId): Outcome {
  const id = slotId(bed, slot);
  if (store.all('crops').has(id)) return no('Something is already growing there.');
  if (level(store).index < CROPS[kind].level) return no('You have not found those seeds yet.');
  store.put('crops', id, { kind, plantedAt: m.now, wateredAt: 0, watered: 0 });
  const got = earn(store, m, 1, { planted: 1 });
  return { ok: true, say: `${CROPS[kind].name} planted.`, ...got };
}

export function water(store: Store, m: Moment, bed: string, slot: number): Outcome {
  const id = slotId(bed, slot);
  const crop = store.all('crops').get(id);
  if (!crop) return no('Nothing planted there.');
  if (crop.wateredAt && m.now - crop.wateredAt < WATER_LASTS * 0.5) return no('The soil is still damp.');
  // Bank what the previous watering contributed before starting a new one.
  const banked = crop.wateredAt ? Math.min(m.now - crop.wateredAt, WATER_LASTS) : 0;
  store.put('crops', id, { ...crop, watered: crop.watered + banked, wateredAt: m.now });
  const got = earn(store, m, WATER_POINTS, { watered: 1 });
  return { ok: true, say: 'Watered.', ...got };
}

export function harvest(store: Store, m: Moment, bed: string, slot: number): Outcome {
  const id = slotId(bed, slot);
  const crop = store.all('crops').get(id);
  if (!crop) return no('Nothing planted there.');
  if (ripeness(crop, m.now) < 1) return no('Not ready yet.');
  const def = CROPS[crop.kind];
  store.drop('crops', id);
  const got = earn(store, m, def.points, { harvested: 1 }, { [crop.kind]: def.yield });
  return { ok: true, say: `+${def.yield} ${ITEMS[crop.kind].many}`, ...got };
}

// --------------------------------------------------------------- animals ----

export function feed(store: Store, m: Moment, id: string): Outcome {
  const a = store.all('animals').get(id);
  if (!a) return no('Who?');
  if (needs(a, m.now).food > CARE.wanted) return no(`${a.name} is not hungry.`);
  const food = (ANIMALS[a.kind].diet as ItemId[]).find((item) => have(store, item) > 0);
  // An animal that went hungry stopped producing. Feeding it restarts the
  // wait from now, keeping whatever was already there to collect.
  const def = ANIMALS[a.kind];
  const lapsed = a.fedAt + def.hungerSpan * MINUTE < m.now;
  const every = 'produce' in def && def.produce ? def.produce.every * MINUTE : 0;
  const collectedAt = lapsed ? m.now - produceReady(a, m.now) * every : a.collectedAt;
  store.put('animals', id, { ...a, fedAt: m.now, collectedAt });
  const got = earn(store, m, food ? CARE.feed.points : CARE.feed.forage, { cared: 1 }, {}, food ? { [food]: 1 } : {});
  return { ok: true, say: food ? `${a.name} ate a ${ITEMS[food].name}.` : `${a.name} had some grass. Proper food is worth more.`, ...got };
}

export function wash(store: Store, m: Moment, id: string): Outcome {
  const a = store.all('animals').get(id);
  if (!a) return no('Who?');
  if (needs(a, m.now).clean > CARE.wanted) return no(`${a.name} is clean enough.`);
  store.put('animals', id, { ...a, washedAt: m.now });
  const got = earn(store, m, CARE.wash.points, { cared: 1 });
  return { ok: true, say: `${a.name} is clean.`, ...got };
}

export function play(store: Store, m: Moment, id: string): Outcome {
  const a = store.all('animals').get(id);
  if (!a) return no('Who?');
  if (needs(a, m.now).fun > CARE.wanted) return no(`${a.name} has had enough for now.`);
  store.put('animals', id, { ...a, playedAt: m.now });
  const got = earn(store, m, CARE.play.points, { cared: 1 });
  return { ok: true, say: a.kind === 'dog' ? `${a.name} fetched it.` : `${a.name} enjoyed that.`, ...got };
}

/** Collect everything the animals of one building have produced. */
export function collect(store: Store, m: Moment, home: string): Outcome {
  const gain: Bundle = {};
  let pts = 0;
  for (const [id, a] of animalsOf(store, home)) {
    const n = produceReady(a, m.now);
    const def = ANIMALS[a.kind];
    if (!n || !('produce' in def) || !def.produce) continue;
    gain[def.produce.item] = (gain[def.produce.item] ?? 0) + n;
    pts += n * def.produce.points;
    store.put('animals', id, { ...a, collectedAt: m.now });
  }
  if (!pts) return no('Nothing to collect yet.');
  const got = earn(store, m, pts, { collected: 1 }, gain);
  return { ok: true, say: `Collected ${describe(gain)}.`, ...got };
}

export function produceWaiting(store: Store, home: string, now: number): number {
  let n = 0;
  for (const [, a] of animalsOf(store, home)) n += produceReady(a, now);
  return n;
}

// --------------------------------------------------------------- cooking ----

export function canCook(store: Store, recipe: RecipeId, at: 'fire' | 'stove'): boolean {
  const r = RECIPES[recipe];
  return (at === 'stove' || r.at === 'fire') && hasAll(store, r.needs);
}

export function cook(store: Store, m: Moment, recipe: RecipeId, at: 'fire' | 'stove'): Outcome {
  const r = RECIPES[recipe];
  if (at === 'fire' && r.at === 'stove') return no('That needs a proper stove.');
  if (!hasAll(store, r.needs)) return no(`You need ${describe(r.needs)}.`);
  const got = earn(store, m, r.points, { cooked: 1 }, { meal: r.meals }, r.needs);
  return { ok: true, say: `${r.name}, ready.`, ...got };
}

// ---------------------------------------------------------------- comforts ----

function comfort(store: Store, m: Moment, key: string, base: number, say: string, tally: Record<string, number> = {}, use: Bundle = {}): Outcome {
  const world = meta(store);
  const last = world.comforts[key] ?? 0;
  if (m.now - last < COMFORT_COOLDOWN * MINUTE) return no('Lovely, but you only just did.');
  store.put('meta', 'world', { ...world, comforts: { ...world.comforts, [key]: m.now } });
  const got = earn(store, m, base, tally, {}, use);
  return { ok: true, say, ...got };
}

export function shareMeal(store: Store, m: Moment): Outcome {
  if (have(store, 'meal') < 1) return no('Nothing cooked. Make something first.');
  return comfort(store, m, 'meal', SHARE_MEAL_POINTS, m.together ? 'You sat down to eat together.' : 'A quiet meal. Better with company.', { shared: 1 }, { meal: m.together ? 2 : 1 });
}

export function bathe(store: Store, m: Moment): Outcome {
  return comfort(store, m, 'bath', COMFORT_POINTS, 'A long hot bath.');
}

export function sit(store: Store, m: Moment): Outcome {
  return comfort(store, m, 'sit', Math.round(COMFORT_POINTS / 2), m.together ? 'You sat together a while.' : 'You put your feet up.');
}

/** Sleep moves the clock to morning for everyone. */
export function sleep(store: Store, m: Moment): Outcome {
  const world = meta(store);
  const out = comfort(store, m, 'sleep', COMFORT_POINTS, 'You slept until morning.');
  if (out.ok) store.put('meta', 'world', { ...meta(store), clockShift: shiftToHour(world, m.now, 6.5) });
  return out;
}

// --------------------------------------------------------------- the house ----

export function furnish(store: Store, m: Moment, kind: FurnitureId, x: number, z: number, rot: number): Outcome {
  const def = FURNITURE[kind];
  if (level(store).index < def.level) return no('Not yet.');
  const why = canAfford(store, def.cost);
  if (why) return no(why);
  store.put('furniture', newId(store.self), { kind, x, z, rot });
  spend(store, m.now, def.cost, undefined);
  claimGoals(store, m.now);
  return { ok: true, say: `${def.name} placed.` };
}

export function moveFurniture(store: Store, id: string, x: number, z: number, rot: number) {
  const f = store.all('furniture').get(id);
  if (f) store.put('furniture', id, { ...f, x, z, rot });
}

export function removeFurniture(store: Store, m: Moment, id: string): Outcome {
  const f = store.all('furniture').get(id);
  if (!f) return no('Nothing there.');
  store.drop('furniture', id);
  const back = Math.floor(FURNITURE[f.kind].cost / 2);
  edit(store, (l) => (l.spent -= back), m.now);
  return { ok: true, say: `${FURNITURE[f.kind].name} sold. ${back} points back.` };
}

export function paint(store: Store, m: Moment, what: 'wall' | 'floor', index: number): Outcome {
  const options = what === 'wall' ? WALLS : FLOORS;
  const choice = options[index];
  if (!choice) return no('No such colour.');
  const world = meta(store);
  if (world[what] === index) return no('That is what you have.');
  const why = canAfford(store, choice.cost);
  if (why) return no(why);
  store.put('meta', 'world', { ...world, [what]: index });
  spend(store, m.now, choice.cost, undefined);
  return { ok: true, say: `${choice.name}. Much better.` };
}

export function setWeather(store: Store, weather: Weather) {
  store.put('meta', 'world', { ...meta(store), weather });
}
