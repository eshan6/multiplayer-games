/**
 * The whole game, played without a screen. These pin the rules the catalogue
 * promises: the shared purse adds up, time is arithmetic, and nothing can be
 * had for free.
 */
import { describe, expect, it } from 'vitest';
import * as act from '../src/game/actions';
import { ANIMALS, CROPS, DAY_MS, GOALS, MINUTE, START_POINTS, STRUCTURES, WATER_LASTS } from '../src/game/catalog';
import { MemoryStore } from '../src/game/stores';
import { clock, currentGoal, emptyLedger, have, level, meta, needs, points, produceReady, ripeness, type Store } from '../src/game/world';

const T0 = 1_800_000_000_000;
const at = (minutes: number, together = false): act.Moment => ({ now: T0 + minutes * MINUTE, together });

function fresh(): MemoryStore {
  const s = new MemoryStore('ann');
  act.settle(s, T0);
  act.join(s, 'Ann', 'f_adventurer', T0);
  return s;
}

/** Hand the player points and items directly, to set a scene. */
function grant(s: Store, pts: number, items: Record<string, number> = {}) {
  const l = structuredClone(s.all('ledgers').get(s.self) ?? emptyLedger());
  l.earned += pts;
  for (const [k, n] of Object.entries(items)) (l.items as Record<string, number>)[k] = ((l.items as Record<string, number>)[k] ?? 0) + n;
  s.put('ledgers', s.self, l);
}

describe('arriving', () => {
  it('pitches a camp with a dog and two horses, once', () => {
    const s = fresh();
    expect([...s.all('structures').values()].map((x) => x.kind).sort()).toEqual(['campfire', 'tent']);
    expect([...s.all('animals').values()].map((x) => x.kind).sort()).toEqual(['dog', 'horse', 'horse']);
    act.settle(s, T0 + 5);
    expect(s.all('structures').size).toBe(2);
    expect(points(s)).toBe(START_POINTS);
  });
});

describe('the clock', () => {
  it('starts at eight on day one and turns over each real day-length', () => {
    const s = fresh();
    expect(clock(meta(s), T0).hour).toBeCloseTo(8);
    expect(clock(meta(s), T0).day).toBe(1);
    expect(clock(meta(s), T0 + DAY_MS).day).toBe(2);
    expect(clock(meta(s), T0 + DAY_MS / 2).hour).toBeCloseTo(20);
  });

  it('sleeping moves it to morning for everyone', () => {
    const s = fresh();
    const out = act.sleep(s, at(10 * 24 * 0.5));
    expect(out.ok).toBe(true);
    expect(clock(meta(s), at(10 * 24 * 0.5).now).hour).toBeCloseTo(6.5);
  });
});

describe('the shared purse', () => {
  it('is the sum of both ledgers, and either player can spend it', () => {
    const ann = fresh();
    grant(ann, 100, { wood: 4 });
    // Ben joins the same world: same documents, different self.
    const ben = new MemoryStore('ben');
    for (const name of ['meta', 'ledgers', 'structures', 'animals'] as const) {
      for (const [id, doc] of ann.all(name)) ben.put(name, id, structuredClone(doc) as never);
    }
    act.join(ben, 'Ben', 'm_farmer', T0);
    expect(points(ben)).toBe(START_POINTS + 100);
    expect(have(ben, 'wood')).toBe(4);
    // Ben spends wood Ann gathered: his own ledger goes negative, the total is right.
    expect(act.build(ben, at(1), 'bench', 5, 5, 0).ok).toBe(true);
    expect(have(ben, 'wood')).toBe(2);
    expect(ben.all('ledgers').get('ben')!.items.wood).toBe(-2);
    expect(points(ben)).toBe(START_POINTS + 100 - STRUCTURES.bench.cost);
  });

  it('pays half as much again when you do things together', () => {
    const s = fresh();
    const alone = act.gather(s, at(0), 'n1', 'log');
    const together = act.gather(s, at(0, true), 'n2', 'log');
    expect(together.points).toBe(Math.round(alone.points! * 1.5));
    expect(together.together).toBe(true);
  });
});

describe('gathering', () => {
  it('empties a spot until it regrows', () => {
    const s = fresh();
    expect(act.gather(s, at(0), 'n1', 'log').ok).toBe(true);
    expect(have(s, 'wood')).toBe(2);
    expect(act.gather(s, at(1), 'n1', 'log').ok).toBe(false);
    expect(act.gather(s, at(8), 'n1', 'log').ok).toBe(true);
  });
});

describe('building', () => {
  it('refuses what you cannot afford and names what is missing', () => {
    const s = fresh();
    const out = act.build(s, at(0), 'cottage', 0, 0, 0);
    expect(out.ok).toBe(false);
    expect(out.say).toMatch(/points/);
    grant(s, 500);
    expect(act.build(s, at(0), 'cottage', 0, 0, 0).say).toMatch(/logs/);
  });

  it('allows one cottage only, and takes its price', () => {
    const s = fresh();
    grant(s, 600, { wood: 30, stone: 20 });
    const before = points(s);
    expect(act.build(s, at(0), 'cottage', 0, 0, 0).ok).toBe(true);
    expect(points(s)).toBeGreaterThanOrEqual(before - STRUCTURES.cottage.cost);
    expect(act.build(s, at(0), 'cottage', 9, 9, 0).ok).toBe(false);
  });

  it('a coop arrives with its hens, and cannot be pulled down around them', () => {
    const s = fresh();
    grant(s, 400, { wood: 10 });
    expect(act.build(s, at(0), 'coop', 8, 8, 0).ok).toBe(true);
    const coop = [...s.all('structures')].find(([, x]) => x.kind === 'coop')![0];
    const hens = [...s.all('animals').values()].filter((a) => a.kind === 'hen');
    expect(hens).toHaveLength(3);
    expect(new Set(hens.map((h) => h.name)).size).toBe(3);
    expect(act.demolish(s, at(1), coop).ok).toBe(false);
  });

  it('gives half the points back when something is taken down', () => {
    const s = fresh();
    grant(s, 100);
    act.build(s, at(0), 'barrel', 3, 3, 0);
    const id = [...s.all('structures')].find(([, x]) => x.kind === 'barrel')![0];
    const before = points(s);
    expect(act.demolish(s, at(1), id).ok).toBe(true);
    expect(points(s)).toBe(before + Math.floor(STRUCTURES.barrel.cost / 2));
  });

  it('keeps seeds for later crops back too', () => {
    const s = fresh();
    expect(act.plant(s, at(0), 'bed1', 0, 'pumpkin').ok).toBe(false);
    expect(act.plant(s, at(0), 'bed1', 0, 'carrot').ok).toBe(true);
  });

  it('keeps later things locked until the two of you have got that far', () => {
    const s = fresh();
    grant(s, 0);
    expect(level(s).index).toBe(0);
    expect(act.whyNotBuild(s, 'byre')).toMatch(/Not yet/);
  });
});

describe('crops', () => {
  it('take twice as long unwatered', () => {
    const s = fresh();
    act.plant(s, at(0), 'bed1', 0, 'carrot');
    act.plant(s, at(0), 'bed1', 1, 'carrot');
    act.water(s, at(0), 'bed1', 1);
    const dry = s.all('crops').get('bed1:0')!;
    const wet = s.all('crops').get('bed1:1')!;
    const t = at(CROPS.carrot.minutes).now;
    expect(ripeness(wet, t)).toBeCloseTo(1);
    expect(ripeness(dry, t)).toBeCloseTo(0.5);
    expect(ripeness(dry, at(CROPS.carrot.minutes * 2).now)).toBeCloseTo(1);
  });

  it('keep growing while nobody is there', () => {
    const s = fresh();
    grant(s, 3000);
    expect(act.plant(s, at(0), 'bed1', 0, 'pumpkin').ok).toBe(true);
    // A week later, with the game closed the whole time.
    expect(ripeness(s.all('crops').get('bed1:0')!, T0 + 7 * 24 * 60 * MINUTE)).toBe(1);
  });

  it('bank earlier waterings rather than losing them', () => {
    const s = fresh();
    grant(s, 3000);
    act.plant(s, at(0), 'bed1', 0, 'pumpkin');
    act.water(s, at(0), 'bed1', 0);
    const lasts = WATER_LASTS / MINUTE;
    act.water(s, at(lasts + 5), 'bed1', 0);
    const crop = s.all('crops').get('bed1:0')!;
    expect(crop.watered).toBe(WATER_LASTS);
    // lasts wet + 5 dry + 3 wet so far.
    const now = at(lasts + 8).now;
    expect(ripeness(crop, now)).toBeCloseTo((lasts + 8 + lasts + 3) / 2 / CROPS.pumpkin.minutes);
  });

  it('cannot be harvested early, and pay out once', () => {
    const s = fresh();
    act.plant(s, at(0), 'bed1', 0, 'carrot');
    expect(act.harvest(s, at(1), 'bed1', 0).ok).toBe(false);
    expect(act.harvest(s, at(30), 'bed1', 0).ok).toBe(true);
    expect(have(s, 'carrot')).toBe(CROPS.carrot.yield);
    expect(act.harvest(s, at(31), 'bed1', 0).ok).toBe(false);
  });
});

describe('animals', () => {
  it('get hungry on the clock, and feeding uses real food when there is some', () => {
    const s = fresh();
    grant(s, 0, { carrot: 1 });
    act.feed(s, at(0), 'horse-a');
    expect(have(s, 'carrot')).toBe(0);
    const horse = () => s.all('animals').get('horse-a')!;
    expect(needs(horse(), at(0).now).food).toBe(1);
    expect(needs(horse(), at(ANIMALS.horse.hungerSpan / 2).now).food).toBeCloseTo(0.5);
    expect(needs(horse(), at(ANIMALS.horse.hungerSpan * 3).now).food).toBe(0);
    // Not hungry yet: nothing to gain by feeding again.
    expect(act.feed(s, at(1), 'horse-a').ok).toBe(false);
    // Nothing in the pantry it eats: it grazes, for fewer points.
    const out = act.feed(s, at(ANIMALS.horse.hungerSpan), 'horse-a');
    expect(out.ok).toBe(true);
    expect(out.points).toBeLessThan(6);
  });

  it('hens lay only while fed, and hold a few eggs until collected', () => {
    const s = fresh();
    grant(s, 400, { wood: 10 });
    act.build(s, at(0), 'coop', 8, 8, 0);
    const coop = [...s.all('structures')].find(([, x]) => x.kind === 'coop')![0];
    const [henId] = [...s.all('animals')].find(([, a]) => a.kind === 'hen')!;
    const hen = () => s.all('animals').get(henId)!;
    // Never fed: no eggs, however long you wait.
    expect(produceReady(hen(), at(500).now)).toBe(0);
    act.feed(s, at(0), henId);
    expect(produceReady(hen(), at(ANIMALS.hen.produce.every).now)).toBe(1);
    // Capped, and stops when the feed runs out.
    expect(produceReady(hen(), at(5000).now)).toBe(ANIMALS.hen.produce.holds);
    const out = act.collect(s, at(ANIMALS.hen.produce.every * 2), coop);
    expect(out.ok).toBe(true);
    expect(have(s, 'egg')).toBe(2);
    expect(act.collect(s, at(ANIMALS.hen.produce.every * 2 + 1), coop).ok).toBe(false);
  });

  it('need somewhere to live before you can bring one home', () => {
    const s = fresh();
    grant(s, 1000);
    expect(act.buyAnimal(s, at(0), 'pig').ok).toBe(false);
  });
});

describe('cooking', () => {
  it('uses up the ingredients and makes meals', () => {
    const s = fresh();
    grant(s, 0, { mushroom: 2 });
    expect(act.cook(s, at(0), 'roast_mushrooms', 'fire').ok).toBe(true);
    expect(have(s, 'mushroom')).toBe(0);
    expect(have(s, 'meal')).toBe(1);
    expect(act.cook(s, at(0), 'roast_mushrooms', 'fire').ok).toBe(false);
  });

  it('keeps stove recipes off the campfire', () => {
    const s = fresh();
    grant(s, 0, { wheat: 3 });
    expect(act.cook(s, at(0), 'bread', 'fire').ok).toBe(false);
    expect(act.cook(s, at(0), 'bread', 'stove').ok).toBe(true);
  });

  it('a shared meal needs a meal, and cannot be repeated straight away', () => {
    const s = fresh();
    expect(act.shareMeal(s, at(0)).ok).toBe(false);
    grant(s, 0, { meal: 3 });
    expect(act.shareMeal(s, at(0, true)).ok).toBe(true);
    expect(have(s, 'meal')).toBe(1);
    expect(act.shareMeal(s, at(1, true)).ok).toBe(false);
  });
});

describe('goals', () => {
  it('are claimed in order, each exactly once', () => {
    const s = fresh();
    expect(currentGoal(s)).toBe(0);
    const before = points(s);
    act.gather(s, at(0), 'a', 'log');
    act.gather(s, at(0), 'b', 'log');
    expect(currentGoal(s)).toBe(0);
    act.gather(s, at(0), 'c', 'log');
    expect(currentGoal(s)).toBe(1);
    expect(points(s)).toBe(before + 9 + GOALS[0]!.reward);
    act.gather(s, at(0), 'd', 'log');
    expect(points(s)).toBe(before + 12 + GOALS[0]!.reward);
  });

  it('every goal watches something the game actually counts', () => {
    const known = /^(got:\w+|built:\w+|cooked|harvested|shared|cared|homely|garden)$/;
    for (const g of GOALS) expect(g.watch).toMatch(known);
    for (const g of GOALS) if (g.watch.startsWith('built:')) expect(STRUCTURES).toHaveProperty(g.watch.slice(6));
  });
});

describe('the catalogue', () => {
  it('houses every animal that has a home in a building that exists', () => {
    for (const def of Object.values(ANIMALS)) if (def.home) expect(STRUCTURES).toHaveProperty(def.home);
  });
});
