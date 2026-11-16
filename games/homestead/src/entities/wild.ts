/**
 * The animals nobody owns: deer in the meadow below the north wood, and a
 * fox that keeps to the trees. They graze and wander, and bolt if you come at
 * them — sooner at a gallop than at a walk.
 */
import * as THREE from 'three';
import type { Assets } from '../assets';
import { rng } from '../noise';
import { waterDepth } from '../world/land';
import type { Terrain } from '../world/terrain';
import { Creature, angleTo, type CreatureSpec } from './creature';

interface Wildling {
  creature: Creature;
  mood: 'stand' | 'graze' | 'wander' | 'flee';
  timer: number;
  tx: number;
  tz: number;
  home: { x: number; z: number; r: number };
  walk: number;
  run: number;
  /** How close you can get before it runs. */
  nerve: number;
}

const DEER: CreatureSpec = { height: 1.7, walkPace: 1.5, runPace: 9 };
const FOX: CreatureSpec = { height: 0.62, walkPace: 1.2, runPace: 7 };

export class Wild {
  readonly group = new THREE.Group();
  private readonly all: Wildling[] = [];
  private readonly rand = rng(909);

  constructor(
    assets: Assets,
    private readonly terrain: Terrain,
  ) {
    this.group.name = 'wild';
    const add = (creature: Creature, home: Wildling['home'], walk: number, run: number, nerve: number) => {
      const w: Wildling = { creature, mood: 'stand', timer: this.rand() * 4, tx: 0, tz: 0, home, walk, run, nerve };
      this.roam(w);
      creature.root.position.set(w.tx, 0, w.tz);
      creature.heading = this.rand() * Math.PI * 2;
      this.all.push(w);
      this.group.add(creature.root);
    };
    for (const herd of [
      { x: -58, z: -62, r: 22, n: 3 },
      { x: 78, z: 64, r: 20, n: 2 },
    ]) {
      for (let i = 0; i < herd.n; i++) add(new Creature(assets.deer, { ...DEER, height: 1.55 + i * 0.12 }), herd, 1.2, 10.5, 13);
    }
    add(new Creature(assets.fox, FOX), { x: -96, z: 22, r: 26 }, 1.4, 9, 17);
    add(new Creature(assets.fox, FOX), { x: 30, z: -104, r: 24 }, 1.4, 9, 17);
  }

  private roam(w: Wildling) {
    for (let tries = 0; tries < 10; tries++) {
      const a = this.rand() * Math.PI * 2;
      const d = Math.sqrt(this.rand()) * w.home.r;
      const x = w.home.x + Math.cos(a) * d;
      const z = w.home.z + Math.sin(a) * d;
      if (waterDepth(x, z, this.terrain.height(x, z)) > -0.5) continue;
      w.tx = x;
      w.tz = z;
      return;
    }
    w.tx = w.home.x;
    w.tz = w.home.z;
  }

  update(dt: number, you: { x: number; z: number; speed: number }) {
    for (const w of this.all) {
      const c = w.creature;
      const p = c.root.position;
      const near = Math.hypot(you.x - p.x, you.z - p.z);
      w.timer -= dt;

      // A quiet approach is tolerated better than a gallop.
      const alarm = w.nerve + Math.min(Math.abs(you.speed), 11) * 1.1;
      if (near < alarm) {
        if (w.mood !== 'flee' || w.timer <= 0) {
          const ax = p.x - you.x;
          const az = p.z - you.z;
          const len = Math.hypot(ax, az) || 1;
          const j = (this.rand() - 0.5) * 0.9;
          w.tx = p.x + ((ax * Math.cos(j) - az * Math.sin(j)) / len) * 34;
          w.tz = p.z + ((ax * Math.sin(j) + az * Math.cos(j)) / len) * 34;
          w.mood = 'flee';
          w.timer = 2.2;
        }
      } else if (w.mood === 'flee') {
        if (near > alarm + 16 || Math.hypot(w.tx - p.x, w.tz - p.z) < 2) {
          w.mood = 'stand';
          w.timer = 3 + this.rand() * 3;
        }
      } else if (w.timer <= 0) {
        const r = this.rand();
        if (w.mood === 'wander' || r < 0.5) {
          w.mood = r < 0.3 ? 'stand' : 'graze';
          w.timer = w.mood === 'graze' ? 7 + this.rand() * 12 : 2.5 + this.rand() * 4;
        } else {
          w.mood = 'wander';
          this.roam(w);
          w.timer = 20;
        }
      }

      const dx = w.tx - p.x;
      const dz = w.tz - p.z;
      const dist = Math.hypot(dx, dz);
      let want = w.mood === 'flee' ? w.run : w.mood === 'wander' ? w.walk : 0;
      if (w.mood === 'wander' && dist < 0.8) {
        w.mood = 'stand';
        w.timer = 2 + this.rand() * 3;
        want = 0;
      }
      const rate = want > c.speed ? 7 : 10;
      c.speed += THREE.MathUtils.clamp(want - c.speed, -rate * dt, rate * dt);
      if (c.speed > 0.05 && dist > 0.05) {
        const turn = angleTo(c.heading, Math.atan2(dx, dz));
        c.heading += THREE.MathUtils.clamp(turn, -3.4 * dt, 3.4 * dt);
        const facing = Math.max(0.25, Math.cos(turn));
        p.x += Math.sin(c.heading) * c.speed * facing * dt;
        p.z += Math.cos(c.heading) * c.speed * facing * dt;
      }
      c.setGait(c.speed > w.walk * 2.1 ? 'run' : c.speed > 0.12 ? 'walk' : w.mood === 'graze' ? 'eat' : 'idle', 0.3);
      c.update(dt, this.terrain);
    }
  }
}
