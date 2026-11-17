/**
 * The animals you keep: the dog, the horses, and whatever the two of you have
 * built a home for.
 *
 * Which animals exist, and when each last ate, is shared state. Where each is
 * standing this second is not: every player's game walks them about for
 * itself, round the building they live in. A ridden horse is the exception —
 * it goes where its rider goes.
 */
import * as THREE from 'three';
import type { Assets } from '../assets';
import * as act from '../game/actions';
import { ANIMALS, CARE, type AnimalKind } from '../game/catalog';
import { needs, type Animal, type Needs, type Store } from '../game/world';
import type { Spot } from '../interact';
import { rng } from '../noise';
import { waterDepth } from '../world/land';
import type { Terrain } from '../world/terrain';
import { Creature, angleTo, type CreatureSpec, type Gait } from './creature';
import { Hen } from './hen';

type Body = Creature | Hen;
type Mood = 'stand' | 'graze' | 'wander' | 'heel' | 'point' | 'beg';

interface Beast {
  id: string;
  doc: Animal;
  body: Body;
  mood: Mood;
  timer: number;
  tx: number;
  tz: number;
  bubble: THREE.Sprite;
  walk: number;
  run: number;
  /** Seconds until the dog next thinks about finding something. */
  nose: number;
}

const SPECS: Record<Exclude<AnimalKind, 'hen'>, CreatureSpec & { walk: number; run: number; roam: number }> = {
  horse: { height: 2.3, walkPace: 1.9, runPace: 9.2, walk: 1.1, run: 4, roam: 9 },
  cow: { height: 1.75, walkPace: 1.25, runPace: 6, walk: 0.75, run: 3, roam: 8 },
  dog: { height: 0.74, walkPace: 1.35, runPace: 6.5, walk: 1.5, run: 13.5, roam: 6 },
  pig: { height: 0.82, walkPace: 0.9, runPace: 3, walk: 0.7, run: 2.4, roam: 5 },
};

/** Coat colours, chosen by each animal's `coat` number. sRGB. */
const HORSE_COATS: Record<string, number>[] = [
  {},
  { Main: 0xcfcac2, Main_Dark: 0x8d8a86, Main_Light: 0xe9e6e0, Hair: 0x6a6763, Muzzle: 0x8b7f7a },
  { Main: 0x3b2b24, Main_Dark: 0x241a16, Main_Light: 0x5a4336, Hair: 0x15100e, Muzzle: 0x2a1f1b },
  { Main: 0xc79a5c, Main_Dark: 0x9a7240, Main_Light: 0xe9d8b4, Hair: 0xefe2c4, Muzzle: 0x9a7f6a },
  { Main: 0x8a4a2c, Main_Dark: 0x5f3220, Main_Light: 0xb06a44, Hair: 0x2a1c16, Muzzle: 0x4a3a34 },
];
const COW_COATS: Record<string, number>[] = [{}, { Main: 0x6b4a36, Main_Light: 0xe9e2d6 }, { Main: 0x2f2a28, Main_Light: 0xf0ebe2 }, { Main: 0xc98a5a, Main_Light: 0xf1e4cf }];
const PIG_COATS: Record<string, number>[] = [{}, { 'Material.003': 0xd9988f }, { 'Material.003': 0xe9bfae }, { 'Material.003': 0x8f6a5c }];

const pickCoat = <T,>(list: T[], coat: number): T => list[Math.floor(coat * list.length) % list.length]!;

/** Draws the three "I need something" bubbles once, as textures. */
function bubbleTextures(): Record<keyof Omit<Needs, 'mood'> | 'find', THREE.Texture> {
  const make = (draw: (c: CanvasRenderingContext2D) => void) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 96;
    const c = canvas.getContext('2d')!;
    c.fillStyle = 'rgba(255,252,244,0.96)';
    c.beginPath();
    c.arc(48, 42, 36, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.moveTo(36, 72);
    c.lineTo(48, 94);
    c.lineTo(60, 72);
    c.fill();
    draw(c);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return {
    // A bowl.
    food: make((c) => {
      c.fillStyle = '#c9743c';
      c.beginPath();
      c.arc(48, 40, 21, 0, Math.PI);
      c.fill();
      c.fillRect(25, 35, 46, 6);
    }),
    // A drop of water.
    clean: make((c) => {
      c.fillStyle = '#4a9fd0';
      c.beginPath();
      c.moveTo(48, 16);
      c.bezierCurveTo(72, 44, 66, 64, 48, 64);
      c.bezierCurveTo(30, 64, 24, 44, 48, 16);
      c.fill();
    }),
    // A ball.
    fun: make((c) => {
      c.fillStyle = '#e0584a';
      c.beginPath();
      c.arc(48, 42, 19, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#fff6ea';
      c.lineWidth = 4;
      c.beginPath();
      c.arc(48, 42, 19, -0.9, 0.9);
      c.stroke();
    }),
    // "Over here!"
    find: make((c) => {
      c.fillStyle = '#d9a52a';
      c.fillRect(43, 18, 10, 30);
      c.beginPath();
      c.arc(48, 60, 6, 0, Math.PI * 2);
      c.fill();
    }),
  };
}

export interface StockUi {
  moment(): act.Moment;
  say(out: act.Outcome, at?: THREE.Vector3): void;
  hearts(at: THREE.Vector3): void;
  mount(id: string): void;
  /** Where animals with this home stand about, or null if it is gone. */
  homeAt(id: string): { x: number; z: number } | null;
  /** Something ready to gather near a point, for the dog to find. */
  findNear(x: number, z: number): { x: number; z: number } | null;
}

/** Where animals with no building of their own are kept: tethered beside the camp. */
const HITCH = { x: 10, z: -6 };

export class Stock {
  readonly group = new THREE.Group();
  private readonly beasts = new Map<string, Beast>();
  private readonly textures = bubbleTextures();
  private readonly rand = rng(2024);
  private stale = true;
  /** Animals being ridden, by anyone: these are moved by their rider. */
  readonly ridden = new Set<string>();

  constructor(
    private readonly assets: Assets,
    private readonly terrain: Terrain,
    private readonly store: Store,
    private readonly ui: StockUi,
  ) {
    this.group.name = 'animals';
    store.subscribe((name) => {
      if (name === 'animals' || name === 'structures') this.stale = true;
    });
  }

  private make(id: string, doc: Animal): Beast {
    let body: Body;
    let walk = 0.5;
    let run = 1.6;
    if (doc.kind === 'hen') {
      body = new Hen(doc.coat);
    } else {
      const spec = SPECS[doc.kind];
      const recolour = doc.kind === 'horse' ? pickCoat(HORSE_COATS, doc.coat) : doc.kind === 'cow' ? pickCoat(COW_COATS, doc.coat) : doc.kind === 'pig' ? pickCoat(PIG_COATS, doc.coat) : undefined;
      body = new Creature(this.assets[doc.kind], { ...spec, recolour });
      walk = spec.walk;
      run = spec.run;
    }
    const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.textures.food, depthWrite: false }));
    const tall = doc.kind === 'hen' ? 0.75 : SPECS[doc.kind as Exclude<AnimalKind, 'hen'>].height + 0.45;
    bubble.position.y = tall;
    bubble.scale.setScalar(doc.kind === 'hen' ? 0.34 : 0.62);
    bubble.visible = false;
    body.root.add(bubble);
    const home = this.homeOf(doc);
    const a = this.rand() * Math.PI * 2;
    const r = 2 + this.rand() * 4;
    body.root.position.set(home.x + Math.cos(a) * r, 0, home.z + Math.sin(a) * r);
    body.heading = this.rand() * Math.PI * 2;
    this.group.add(body.root);
    return { id, doc, body, mood: 'stand', timer: this.rand() * 4, tx: body.root.position.x, tz: body.root.position.z, bubble, walk, run, nose: 20 + this.rand() * 30 };
  }

  private homeOf(doc: Animal): { x: number; z: number } {
    if (doc.kind === 'dog') return { x: 1, z: 3 };
    return (doc.home && this.ui.homeAt(doc.home)) || HITCH;
  }

  creature(id: string): Creature | null {
    const b = this.beasts.get(id)?.body;
    return b instanceof Creature ? b : null;
  }

  position(id: string): THREE.Vector3 | null {
    return this.beasts.get(id)?.body.root.position ?? null;
  }

  private sync() {
    const docs = this.store.all('animals');
    for (const [id, b] of this.beasts) {
      if (docs.has(id)) continue;
      this.group.remove(b.body.root);
      this.beasts.delete(id);
    }
    for (const [id, doc] of docs) {
      const have = this.beasts.get(id);
      if (have) have.doc = doc;
      else if (doc.kind in ANIMALS) this.beasts.set(id, this.make(id, doc));
    }
  }

  /**
   * @param me where the local player is, and how they are moving
   */
  update(dt: number, now: number, me: { x: number; z: number; heading: number; speed: number; indoors: boolean }) {
    if (this.stale) {
      this.stale = false;
      this.sync();
    }
    for (const b of this.beasts.values()) {
      const n = needs(b.doc, now);
      this.showBubble(b, n);
      if (this.ridden.has(b.id)) {
        b.bubble.visible = false;
        continue;
      }
      b.timer -= dt;
      if (b.doc.kind === 'dog') this.thinkDog(b, dt, me, n);
      else this.thinkGrazer(b);
      this.move(b, dt);
      b.body.update(dt, this.terrain);
    }
  }

  private showBubble(b: Beast, n: Needs) {
    if (b.mood === 'point') {
      b.bubble.material.map = this.textures.find;
      b.bubble.visible = true;
      return;
    }
    // Only speak up when something is actually wrong, and say the worst thing.
    if (n.mood > 0.3) {
      b.bubble.visible = false;
      return;
    }
    const worst = n.food <= n.clean && n.food <= n.fun ? 'food' : n.clean <= n.fun ? 'clean' : 'fun';
    b.bubble.material.map = this.textures[worst];
    b.bubble.visible = true;
  }

  /** stand → graze → wander → stand, round wherever it lives. */
  private thinkGrazer(b: Beast) {
    if (b.timer > 0) return;
    const r = this.rand();
    if (b.mood === 'wander' || r < 0.5) {
      b.mood = r < 0.3 ? 'stand' : 'graze';
      b.timer = b.mood === 'graze' ? 6 + this.rand() * 10 : 2 + this.rand() * 4;
      return;
    }
    const home = this.homeOf(b.doc);
    const roam = b.doc.kind === 'hen' ? 4.5 : SPECS[b.doc.kind as Exclude<AnimalKind, 'hen'>].roam;
    for (let tries = 0; tries < 8; tries++) {
      const a = this.rand() * Math.PI * 2;
      // Stand about in front of the building rather than inside its walls.
      const d = 2.6 + Math.sqrt(this.rand()) * roam;
      const x = home.x + Math.cos(a) * d;
      const z = home.z + Math.sin(a) * d;
      if (waterDepth(x, z, this.terrain.height(x, z)) > -0.3) continue;
      b.tx = x;
      b.tz = z;
      b.mood = 'wander';
      b.timer = 25;
      return;
    }
  }

  /**
   * The dog has its own ideas. It keeps to your heel when you are out; when it
   * wants something it sits in front of you and says so; and every so often it
   * runs off to something worth gathering and waits for you there.
   */
  private thinkDog(b: Beast, dt: number, me: { x: number; z: number; heading: number; speed: number; indoors: boolean }, n: Needs) {
    const p = b.body.root.position;
    const away = Math.hypot(me.x - p.x, me.z - p.z);
    if (me.indoors) {
      // You have gone inside: wait by the fire.
      if (b.mood !== 'stand' && b.mood !== 'wander') {
        b.mood = 'wander';
        b.tx = 2.5;
        b.tz = 2.5;
        b.timer = 30;
      }
      return;
    }
    if (b.mood === 'point') {
      // Waiting at something it found. Give up if you never come.
      if (away < 3.2 || b.timer <= 0) {
        b.mood = 'heel';
        b.nose = 35 + this.rand() * 40;
      }
      return;
    }
    if (away > 90) {
      b.mood = 'stand';
      return;
    }
    b.nose -= dt;
    if (b.nose <= 0 && away < 12 && me.speed < 7) {
      const found = this.ui.findNear(p.x, p.z);
      b.nose = 30 + this.rand() * 30;
      if (found) {
        b.mood = 'point';
        b.tx = found.x + 0.9;
        b.tz = found.z + 0.6;
        b.timer = 22;
        return;
      }
    }
    // Wanting something: come round in front of you and sit.
    if (n.mood < 0.3 && me.speed < 0.5) {
      b.mood = 'beg';
      b.tx = me.x + Math.sin(me.heading) * 1.6;
      b.tz = me.z + Math.cos(me.heading) * 1.6;
      return;
    }
    b.mood = 'heel';
    const side = 1.5 + Math.min(me.speed, 8) * 0.08;
    const back = 0.9 + Math.min(me.speed, 11) * 0.12;
    b.tx = me.x + Math.cos(me.heading) * side - Math.sin(me.heading) * back;
    b.tz = me.z - Math.sin(me.heading) * side - Math.cos(me.heading) * back;
  }

  private move(b: Beast, dt: number) {
    const c = b.body;
    const p = c.root.position;
    const dx = b.tx - p.x;
    const dz = b.tz - p.z;
    const dist = Math.hypot(dx, dz);

    let want = 0;
    if (b.mood === 'wander') {
      want = b.walk;
      if (dist < 0.6) {
        b.mood = 'stand';
        b.timer = 1.5 + this.rand() * 3;
      }
    } else if (b.mood === 'heel' || b.mood === 'point' || b.mood === 'beg') {
      // Speed scales with how far behind it is: a walk when close, flat out when not.
      want = dist < 0.6 ? 0 : THREE.MathUtils.clamp(dist * 2.4, b.walk * 0.8, b.run);
    }

    const rate = want > c.speed ? 7 : 10;
    c.speed += THREE.MathUtils.clamp(want - c.speed, -rate * dt, rate * dt);
    if (c.speed > 0.05 && dist > 0.05) {
      const turn = angleTo(c.heading, Math.atan2(dx, dz));
      const maxTurn = (b.doc.kind === 'dog' ? 7 : b.doc.kind === 'hen' ? 5 : 3.2) * dt;
      c.heading += THREE.MathUtils.clamp(turn, -maxTurn, maxTurn);
      // Do not stride off at full speed while still facing the wrong way.
      const facing = Math.max(0.25, Math.cos(turn));
      p.x += Math.sin(c.heading) * c.speed * facing * dt;
      p.z += Math.cos(c.heading) * c.speed * facing * dt;
    }

    let gait: Gait = 'idle';
    if (c.speed > b.walk * 2.1) gait = 'run';
    else if (c.speed > 0.1) gait = 'walk';
    else if (b.mood === 'graze') gait = 'eat';
    else if (b.mood === 'beg' || b.mood === 'point') gait = 'idleAlt';
    c.setGait(gait, 0.3);
  }

  /** The animals near a point that the player could tend. */
  spots(now: number, x: number, z: number): Spot[] {
    const out: Spot[] = [];
    for (const b of this.beasts.values()) {
      if (this.ridden.has(b.id)) continue;
      const p = b.body.root.position;
      if (Math.abs(p.x - x) > 6 || Math.abs(p.z - z) > 6) continue;
      const def = ANIMALS[b.doc.kind];
      const n = needs(b.doc, now);
      const wants: string[] = [];
      if (n.food < CARE.wanted) wants.push(n.food < 0.3 ? 'hungry' : 'peckish');
      if (n.clean < CARE.wanted) wants.push(n.clean < 0.3 ? 'filthy' : 'a bit grubby');
      if (n.fun < CARE.wanted) wants.push(n.fun < 0.3 ? 'bored' : 'restless');
      const here = () => p.clone().setY(p.y + (b.doc.kind === 'hen' ? 0.6 : 1.6));
      const care = (fn: typeof act.feed) => () => {
        const outcome = fn(this.store, this.ui.moment(), b.id);
        this.ui.say(outcome, here());
        if (outcome.ok) this.ui.hearts(here());
      };
      const spot: Spot = {
        x: p.x,
        z: p.z,
        reach: b.doc.kind === 'hen' ? 1.5 : b.doc.kind === 'horse' || b.doc.kind === 'cow' ? 2.8 : 2.0,
        title: `${b.doc.name} the ${def.name}`,
        detail: wants.length ? wants.join(', ') : 'content',
        height: b.doc.kind === 'hen' ? 0.6 : 1.6,
        actions: [
          { key: 'E', label: 'Feed', move: b.doc.kind === 'hen' ? 'scatter' : 'feed', blocked: n.food > CARE.wanted ? 'Not hungry' : undefined, run: care(act.feed) },
          { key: 'R', label: b.doc.kind === 'hen' ? 'Dust off' : 'Wash', move: b.doc.kind === 'hen' ? 'groom' : 'wash', blocked: n.clean > CARE.wanted ? 'Clean' : undefined, run: care(act.wash) },
          { key: 'T', label: b.doc.kind === 'dog' ? 'Throw a stick' : b.doc.kind === 'horse' ? 'Groom' : 'Pet', move: b.doc.kind === 'dog' ? 'throw' : b.doc.kind === 'horse' ? 'groom' : 'pet', blocked: n.fun > CARE.wanted ? 'Had enough' : undefined, run: care(act.play) },
        ],
      };
      if ('rideable' in def && def.rideable) spot.actions.push({ key: 'F', label: 'Ride', run: () => this.ui.mount(b.id) });
      out.push(spot);
    }
    return out;
  }
}
