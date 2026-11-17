/**
 * Everything the two of you have built outdoors, drawn from the shared world.
 *
 * This file never decides anything. It watches the `structures` and `crops`
 * collections and makes the scene match: a new document appears, a building
 * appears; a crop's planting time passes a threshold, its model changes. That
 * is the whole of how your partner's fence shows up on your screen.
 */
import * as THREE from 'three';
import { modelOf, type Assets } from '../assets';
import * as act from '../game/actions';
import { BED_SLOTS, CROPS, STRUCTURES, type CropId, type StructureId } from '../game/catalog';
import { cropStage, isWatered, ripeness, slotId, type Crop, type Store, type Structure } from '../game/world';
import type { Spot } from '../interact';
import type { Effects, Flame } from './fx';
import { BED_SLOT_AT, COTTAGE, instantiate, scaffold, shapeObject } from './placed';
import type { Footprint } from './clearing';
import type { Obstacle, Wall } from './scatter';
import type { Terrain } from './terrain';

interface Built {
  doc: Structure;
  group: THREE.Group;
  flame?: Flame;
  smoke?: THREE.Object3D;
  /** For vegetable beds: what each slot is currently showing. */
  slots?: { key: string; holder: THREE.Group }[];
  /** The ground it stands on, in its own space. */
  foot: { cx: number; cz: number; hw: number; hd: number };
  /** Going up: the building's own model rising inside scaffolding. */
  raising?: { model: THREE.Object3D; scaffold: THREE.Object3D | null; seconds: number; dust: number };
}

/**
 * How long a building takes to go up, by its size. Worked out from when it
 * was placed, as everything in this world is, so both of you see the same
 * stage of it and a building placed while you were away is simply finished.
 */
function raiseSeconds(size: number): number {
  return size > 2.6 ? 4 + size * 0.45 : 1.2;
}

/** What the game needs to open when a spot's action is not a one-step thing. */
export interface StructureUi {
  moment(): act.Moment;
  say(out: act.Outcome, at?: THREE.Vector3): void;
  openCook(at: 'fire' | 'stove'): void;
  openPlant(bed: string, slot: number): void;
  enterHouse(): void;
}

const CROP_SCALE = 0.62;
const up = new THREE.Vector3(0, 1, 0);

export class Structures {
  readonly group = new THREE.Group();
  /** Rebuilt whenever something is built or removed. */
  obstacles: Obstacle[] = [];
  walls: Wall[] = [];
  private readonly built = new Map<string, Built>();
  private stale = true;
  private cropClock = 0;

  constructor(
    private readonly assets: Assets,
    private readonly terrain: Terrain,
    private readonly store: Store,
    private readonly fx: Effects,
    private readonly ui: StructureUi,
  ) {
    this.group.name = 'structures';
    store.subscribe((name) => {
      if (name === 'structures' || name === 'crops') this.stale = true;
    });
  }

  /** World position of a structure's local point. */
  private at(s: Structure, lx: number, ly: number, lz: number): THREE.Vector3 {
    return new THREE.Vector3(lx, ly, lz).applyAxisAngle(up, s.rot).add(new THREE.Vector3(s.x, this.terrain.height(s.x, s.z), s.z));
  }

  private add(id: string, doc: Structure, now: number) {
    const def = STRUCTURES[doc.kind];
    const model = shapeObject(this.assets, def.shape);
    // Measured on its own, before it is placed: in its own space.
    const box = new THREE.Box3().setFromObject(model);
    // The model sits in a holder so it can rise inside the scaffold without
    // moving anything else the structure owns.
    const group = new THREE.Group();
    group.add(model);
    group.position.set(doc.x, this.terrain.height(doc.x, doc.z), doc.z);
    group.rotation.y = doc.rot;
    const foot = { cx: (box.max.x + box.min.x) / 2, cz: (box.max.z + box.min.z) / 2, hw: (box.max.x - box.min.x) / 2, hd: (box.max.z - box.min.z) / 2 };
    const b: Built = { doc, group, foot };
    const size = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    const seconds = raiseSeconds(size);
    if (now - doc.at < seconds * 1000 && now >= doc.at - 1000) {
      const frame = size > 2.6 ? scaffold(this.assets, box.max.x - box.min.x, box.max.z - box.min.z, box.max.y - box.min.y) : null;
      if (frame) {
        frame.position.set((box.max.x + box.min.x) / 2, 0, (box.max.z + box.min.z) / 2);
        group.add(frame);
      }
      b.raising = { model, scaffold: frame, seconds, dust: 0 };
    }
    if (doc.kind === 'campfire') {
      b.flame = this.fx.fire(this.at(doc, 0, 0.32, 0));
      this.group.add(b.flame.group);
    }
    if (doc.kind === 'cottage') {
      b.smoke = this.fx.smoke(this.at(doc, ...this.chimney()));
      this.group.add(b.smoke);
    }
    if (doc.kind === 'bed') {
      b.slots = Array.from({ length: BED_SLOTS }, (_, i) => {
        const holder = new THREE.Group();
        holder.position.set(BED_SLOT_AT[i]![0], 0.12, BED_SLOT_AT[i]![1]);
        group.add(holder);
        return { key: '', holder };
      });
    }
    this.group.add(group);
    this.built.set(id, b);
  }

  private remove(id: string) {
    const b = this.built.get(id);
    if (!b) return;
    this.group.remove(b.group);
    if (b.flame) {
      this.group.remove(b.flame.group);
      this.fx.release(b.flame);
    }
    if (b.smoke) this.group.remove(b.smoke);
    this.built.delete(id);
  }

  /** Top of the cottage's chimney, in the cottage's own space. */
  private chimney(): [number, number, number] {
    const [x, y, z] = COTTAGE.chimney;
    return [x - 0.9, y + 0.3, z];
  }

  /** Half-depth of the cottage, for finding its door. */
  private cottageDepth(): number {
    return COTTAGE.depth / 2;
  }

  /** Where the cottage door is, if there is a cottage. */
  door(): THREE.Vector3 | null {
    for (const b of this.built.values()) if (b.doc.kind === 'cottage') return this.at(b.doc, 0, 0, this.cottageDepth() + 1.3);
    return null;
  }

  /** Where a structure stands, by id. */
  position(id: string): { x: number; z: number } | null {
    return this.built.get(id)?.doc ?? null;
  }

  update(dt: number, now: number) {
    if (this.stale) {
      this.stale = false;
      const docs = this.store.all('structures');
      for (const id of [...this.built.keys()]) {
        const doc = docs.get(id);
        const have = this.built.get(id)!.doc;
        if (!doc || doc.x !== have.x || doc.z !== have.z || doc.rot !== have.rot || doc.kind !== have.kind) this.remove(id);
      }
      for (const [id, doc] of docs) if (!this.built.has(id) && doc.kind in STRUCTURES) this.add(id, doc, now);
      this.collide();
      this.cropClock = 0;
    }
    for (const b of this.built.values()) if (b.raising) this.raise(b, dt, now);
    // Crops change slowly; looking twice a second is plenty.
    this.cropClock -= dt;
    if (this.cropClock <= 0) {
      this.cropClock = 0.5;
      this.growCrops(now);
    }
  }

  /** A building going up: walls rise course by course; the scaffold comes down at the end. */
  private raise(b: Built, dt: number, now: number) {
    const r = b.raising!;
    const t = THREE.MathUtils.clamp((now - b.doc.at) / (r.seconds * 1000), 0, 1);
    // Quick at first, settling into place: and in visible steps, like courses laid.
    const eased = 1 - Math.pow(1 - t, 2.2);
    const stepped = r.scaffold ? Math.min(1, Math.floor(eased * 9 + 0.6) / 9 * 0.85 + eased * 0.15) : eased;
    r.model.scale.set(1, Math.max(0.02, stepped), 1);
    r.dust -= dt;
    if (r.dust <= 0 && t < 0.95) {
      r.dust = r.scaffold ? 0.9 : 0.5;
      const a = Math.random() * Math.PI * 2;
      const at = new THREE.Vector3(Math.cos(a) * 1.2, 0.15, Math.sin(a) * 1.2).applyAxisAngle(up, b.doc.rot).add(b.group.position);
      this.fx.burst('dust', at);
    }
    if (t >= 1) {
      r.model.scale.set(1, 1, 1);
      if (r.scaffold) b.group.remove(r.scaffold);
      b.raising = undefined;
    }
  }

  /** Bumped whenever the set of footprints changes. */
  clearings = 0;

  /** The ground every building claims, for the grass and the terrain. */
  footprints(): Footprint[] {
    const out: Footprint[] = [];
    for (const { doc, foot } of this.built.values()) {
      const def = STRUCTURES[doc.kind];
      // Trees and shrubs you plant grow out of the meadow; they claim nothing.
      if ('pack' in def.shape && def.shape.pack === 'tree') continue;
      const light = doc.kind === 'fence' || doc.kind === 'lantern' || doc.kind === 'scarecrow';
      out.push({ x: doc.x, z: doc.z, rot: doc.rot, ...foot, strength: light ? 0.55 : 1 });
    }
    return out;
  }

  private collide() {
    this.clearings++;
    this.obstacles = [];
    this.walls = [];
    for (const { doc } of this.built.values()) {
      const def = STRUCTURES[doc.kind];
      if (doc.kind === 'cottage') {
        // A row of circles along the building's length: round corners let
        // you slide past rather than snag.
        // A row of circles along the building's length: round corners let
        // you slide past rather than snag.
        for (const k of [-2.4, 0, 2.4]) {
          const p = this.at(doc, k, 0, 0);
          this.obstacles.push({ x: p.x, z: p.z, r: 3.3 });
        }
      } else if (doc.kind === 'fence') {
        const half = (def as { snaps: number }).snaps / 2;
        const a = this.at(doc, -half, 0, 0);
        const b = this.at(doc, half, 0, 0);
        this.walls.push({ x1: a.x, z1: a.z, x2: b.x, z2: b.z });
      } else if (def.solid > 0) {
        this.obstacles.push({ x: doc.x, z: doc.z, r: def.solid });
      }
    }
  }

  private growCrops(now: number) {
    const crops = this.store.all('crops');
    for (const [id, b] of this.built) {
      if (!b.slots) continue;
      b.slots.forEach((slot, i) => {
        const crop = crops.get(slotId(id, i));
        const key = crop ? `${crop.kind}${cropStage(crop, now)}` : '';
        if (key === slot.key) return;
        slot.key = key;
        slot.holder.clear();
        if (!crop) return;
        const model = modelOf(this.assets, 'crops', `${CROPS[crop.kind].model}_${cropStage(crop, now)}`);
        const plant = instantiate(model, CROP_SCALE * 1.15);
        plant.rotation.y = i * 1.7;
        // Crops are small and many; their shadows cost more than they show.
        plant.traverse((o) => (o.castShadow = false));
        slot.holder.add(plant);
      });
    }
  }

  /** Everything here the player could walk up to and use. */
  spots(now: number): Spot[] {
    const out: Spot[] = [];
    const ui = this.ui;
    const crops = this.store.all('crops');
    for (const [id, b] of this.built) {
      const { doc } = b;
      const def = STRUCTURES[doc.kind];
      if ('cook' in def && def.cook) {
        out.push({ x: doc.x, z: doc.z, reach: 2.6, title: def.name, height: 1, actions: [{ key: 'E', label: 'Cook', run: () => ui.openCook('fire') }] });
      }
      if ('enter' in def && def.enter) {
        const door = this.at(doc, 0, 0, this.cottageDepth() + 0.6);
        out.push({ x: door.x, z: door.z, reach: 2.6, title: 'Your cottage', height: 2, actions: [{ key: 'E', label: 'Go inside', run: () => ui.enterHouse() }] });
      }
      if ('brings' in def && def.brings) {
        const waiting = act.produceWaiting(this.store, id, now);
        const lives = act_animals(this.store, id);
        out.push({
          x: doc.x,
          z: doc.z,
          reach: def.solid + 2.4,
          title: def.name,
          detail: lives,
          height: 2,
          actions: [
            {
              key: 'E',
              label: waiting ? `Collect (${waiting})` : 'Collect',
              move: 'collect',
              blocked: waiting ? undefined : 'Nothing to collect yet',
              run: () => ui.say(act.collect(this.store, ui.moment(), id), new THREE.Vector3(doc.x, this.terrain.height(doc.x, doc.z) + 1.5, doc.z)),
            },
          ],
        });
      }
      if (b.slots) {
        for (let i = 0; i < BED_SLOTS; i++) {
          const p = this.at(doc, BED_SLOT_AT[i]![0], 0, BED_SLOT_AT[i]![1]);
          out.push(this.cropSpot(id, i, crops.get(slotId(id, i)), p, now));
        }
      }
    }
    return out;
  }

  private cropSpot(bed: string, slot: number, crop: Crop | undefined, p: THREE.Vector3, now: number): Spot {
    const ui = this.ui;
    const here = p.clone().setY(p.y + 0.8);
    if (!crop) {
      return { x: p.x, z: p.z, reach: 1.15, title: 'Empty row', height: 0.4, actions: [{ key: 'E', label: 'Plant', run: () => ui.openPlant(bed, slot) }] };
    }
    const def = CROPS[crop.kind as CropId];
    const ripe = ripeness(crop, now);
    if (ripe >= 1) {
      return { x: p.x, z: p.z, reach: 1.15, title: def.name, detail: 'Ready', height: 0.8, actions: [{ key: 'E', label: 'Harvest', move: 'harvest', run: () => ui.say(act.harvest(this.store, ui.moment(), bed, slot), here) }] };
    }
    const wet = isWatered(crop, now);
    return {
      x: p.x,
      z: p.z,
      reach: 1.15,
      title: def.name,
      detail: `${Math.round(ripe * 100)}% grown${wet ? '' : ', dry'}`,
      height: 0.8,
      actions: [{ key: 'E', label: 'Water', move: 'water', blocked: wet ? 'Soil is damp' : undefined, run: () => ui.say(act.water(this.store, ui.moment(), bed, slot), here) }],
    };
  }

  /** Structures near a point, for the "take down" tool. */
  near(x: number, z: number, within: number): { id: string; kind: StructureId; x: number; z: number } | null {
    let best: { id: string; kind: StructureId; x: number; z: number } | null = null;
    let bestD = within;
    for (const [id, b] of this.built) {
      const d = Math.hypot(b.doc.x - x, b.doc.z - z);
      if (d < bestD) {
        bestD = d;
        best = { id, kind: b.doc.kind, x: b.doc.x, z: b.doc.z };
      }
    }
    return best;
  }

  /** Same-kind pieces near a point, for snapping fences and paths end to end. */
  neighbours(kind: StructureId, x: number, z: number, within: number): Structure[] {
    const out: Structure[] = [];
    for (const b of this.built.values()) if (b.doc.kind === kind && Math.hypot(b.doc.x - x, b.doc.z - z) < within) out.push(b.doc);
    return out;
  }

  object(id: string): THREE.Object3D | undefined {
    return this.built.get(id)?.group;
  }
}

function act_animals(store: Store, home: string): string {
  const names = [...store.all('animals').values()].filter((a) => a.home === home).map((a) => a.name);
  if (!names.length) return 'Empty';
  return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}
