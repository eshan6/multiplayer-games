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
import { BED_SLOT_AT, instantiate, shapeObject, wetPatch } from './placed';
import type { Obstacle, Wall } from './scatter';
import type { Terrain } from './terrain';

interface Built {
  doc: Structure;
  group: THREE.Group;
  flame?: Flame;
  smoke?: THREE.Object3D;
  /** For vegetable beds: what each slot is currently showing. */
  slots?: { key: string; holder: THREE.Group }[];
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

  private add(id: string, doc: Structure) {
    const def = STRUCTURES[doc.kind];
    const group = shapeObject(this.assets, def.shape);
    group.position.set(doc.x, this.terrain.height(doc.x, doc.z), doc.z);
    group.rotation.y = doc.rot;
    const b: Built = { doc, group };
    if (doc.kind === 'campfire') {
      b.flame = this.fx.fire(this.at(doc, 0, 0.5, 0));
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

  /** Top of the cottage's chimney in its own space: the middle of its highest stonework. */
  private chimneyAt: [number, number, number] | null = null;
  private chimney(): [number, number, number] {
    if (this.chimneyAt) return this.chimneyAt;
    const model = modelOf(this.assets, 'props', 'House_1');
    const shape = STRUCTURES.cottage.shape;
    const scale = 'scale' in shape ? (shape.scale ?? 1) : 1;
    const stone = model.parts.filter((p) => p.material.name.startsWith('Stone'));
    let top = -Infinity;
    for (const p of stone) top = Math.max(top, p.geometry.boundingBox!.max.y);
    const v = new THREE.Vector3();
    let sx = 0;
    let sz = 0;
    let n = 0;
    for (const p of stone) {
      const pos = p.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        if (v.y > top - 0.04) {
          sx += v.x;
          sz += v.z;
          n++;
        }
      }
    }
    this.chimneyAt = n ? [(sx / n) * scale, top * scale, (sz / n) * scale] : [0, model.size.y * scale, 0];
    return this.chimneyAt;
  }

  /** Half-depth of the cottage, for finding its door. */
  private cottageDepth(): number {
    const shape = STRUCTURES.cottage.shape;
    return (modelOf(this.assets, 'props', 'House_1').size.z * ('scale' in shape ? (shape.scale ?? 1) : 1)) / 2;
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
      for (const [id, doc] of docs) if (!this.built.has(id) && doc.kind in STRUCTURES) this.add(id, doc);
      this.collide();
      this.cropClock = 0;
    }
    // Crops change slowly; looking twice a second is plenty.
    this.cropClock -= dt;
    if (this.cropClock <= 0) {
      this.cropClock = 0.5;
      this.growCrops(now);
    }
  }

  private collide() {
    this.obstacles = [];
    this.walls = [];
    for (const { doc } of this.built.values()) {
      const def = STRUCTURES[doc.kind];
      if (doc.kind === 'cottage') {
        // A row of circles along the building's length: round corners let
        // you slide past rather than snag.
        const d = this.cottageDepth();
        for (const k of [-0.55, 0, 0.55]) {
          const p = this.at(doc, 0, 0, d * k);
          this.obstacles.push({ x: p.x, z: p.z, r: 2.9 });
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
        const key = crop ? `${crop.kind}${cropStage(crop, now)}${isWatered(crop, now) ? 'w' : ''}` : '';
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
        if (isWatered(crop, now)) {
          const wet = wetPatch();
          wet.position.y = 0.2;
          slot.holder.add(wet);
        }
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
      return { x: p.x, z: p.z, reach: 1.15, title: def.name, detail: 'Ready', height: 0.8, actions: [{ key: 'E', label: 'Harvest', run: () => ui.say(act.harvest(this.store, ui.moment(), bed, slot), here) }] };
    }
    const wet = isWatered(crop, now);
    return {
      x: p.x,
      z: p.z,
      reach: 1.15,
      title: def.name,
      detail: `${Math.round(ripe * 100)}% grown${wet ? '' : ', dry'}`,
      height: 0.8,
      actions: [{ key: 'E', label: 'Water', blocked: wet ? 'Soil is damp' : undefined, run: () => ui.say(act.water(this.store, ui.moment(), bed, slot), here) }],
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
