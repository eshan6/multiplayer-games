/**
 * The home itself: cottage, yard, paddock fence, well, fire.
 *
 * For the sample this is laid out by hand. It is deliberately written as a
 * list of "this piece, here, facing this way" — which is exactly the shape the
 * building system will need when the two of you place the pieces instead.
 */
import * as THREE from 'three';
import type { Assets, Model } from '../assets';
import { rng } from '../noise';
import { COTTAGE, PADDOCK, PLOT } from './land';
import { Batcher, type Obstacle } from './scatter';
import type { Terrain } from './terrain';

/** A straight barrier a horse cannot cross, as a segment on the ground. */
export interface Wall {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export interface Homestead {
  group: THREE.Group;
  obstacles: Obstacle[];
  walls: Wall[];
  /** World positions other systems hang effects on. */
  chimney: THREE.Vector3;
  fire: THREE.Vector3;
  door: THREE.Vector3;
}

/** The village kit is modelled small; this brings a doorway to about two metres. */
const KIT_SCALE = 2.9;
const WHITE = new THREE.Color(1, 1, 1);

export function buildHomestead(assets: Assets, terrain: Terrain): Homestead {
  const batch = new Batcher(1000);
  const obstacles: Obstacle[] = [];
  const walls: Wall[] = [];
  const rand = rng(88);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const prop = (name: string): Model => {
    const found = assets.props.get(name);
    if (!found) throw new Error(`prop missing: ${name}`);
    return found;
  };

  const place = (name: string, x: number, z: number, facing: number, scale = KIT_SCALE, lift = 0) => {
    pos.set(x, terrain.height(x, z) + lift, z);
    q.setFromAxisAngle(up, facing);
    scl.setScalar(scale);
    m.compose(pos, q, scl);
    batch.add(prop(name), m, WHITE);
    return pos.clone();
  };

  // ---- cottage -------------------------------------------------------------
  const cottage = prop('House_1');
  const base = place('House_1', COTTAGE.x, COTTAGE.z, COTTAGE.facing);
  const w = cottage.size.x * KIT_SCALE;
  const d = cottage.size.z * KIT_SCALE;
  // Blocked as a row of circles along the building's length: cheap, and round
  // corners mean a horse slides past instead of catching on them.
  const along = new THREE.Vector3(Math.sin(COTTAGE.facing), 0, Math.cos(COTTAGE.facing));
  const r = Math.min(w, d) * 0.5;
  const span = Math.max(w, d) * 0.5 - r;
  const axis = d > w ? along : new THREE.Vector3(along.z, 0, -along.x);
  for (let i = -1; i <= 1; i++) {
    obstacles.push({ x: base.x + axis.x * span * i, z: base.z + axis.z * span * i, r: r + 0.3 });
  }
  const local = (lx: number, ly: number, lz: number) =>
    new THREE.Vector3(lx, ly, lz).applyAxisAngle(up, COTTAGE.facing).add(base);
  const chimney = local(...chimneyTop(cottage));
  const door = local(0, 1.2, d * 0.5 + 1.2);

  // ---- yard ----------------------------------------------------------------
  const yard: [string, number, number, number, number?][] = [
    ['Well', -8.5, 7, 0.4],
    ['Cart', 9.5, 2.5, -0.9],
    ['Barrel', 4.2, -2.2, 0.3],
    ['Barrel', 5.1, -1.3, 1.4],
    ['Crate', 5.6, -3.0, 0.5],
    ['Hay', 12.5, -4.5, 0.7],
    ['Hay', 13.4, -6.4, 2.0],
    ['Bags', -4.6, -1.6, -0.5],
    ['Bench_1', -3.4, 4.6, 2.2],
  ];
  for (const [name, x, z, facing] of yard) {
    const p = place(name, x, z, facing);
    const size = prop(name).size;
    obstacles.push({ x: p.x, z: p.z, r: Math.max(size.x, size.z) * KIT_SCALE * 0.42 });
  }

  // The fire, with a bench angled toward it.
  const fire = place('Bonfire_Lit', -6.5, 13.5, 0, KIT_SCALE * 1.25);
  fire.y += 0.45;
  obstacles.push({ x: fire.x, z: fire.z, r: 0.9 });
  const bench = place('Bench_1', -9.6, 15.2, 1.05);
  obstacles.push({ x: bench.x, z: bench.z, r: 0.9 });

  // ---- paddock -------------------------------------------------------------
  const fence = prop('Fence');
  const panel = fence.size.x * KIT_SCALE;
  const run = (x1: number, z1: number, x2: number, z2: number, gate?: [number, number]) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.max(1, Math.round(len / panel));
    const facing = Math.atan2(-(z2 - z1), x2 - x1);
    const stretch = len / n / panel;
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      const mid = (t0 + t1) / 2;
      if (gate && mid > gate[0] && mid < gate[1]) continue;
      const x = x1 + (x2 - x1) * mid;
      const z = z1 + (z2 - z1) * mid;
      pos.set(x, terrain.height(x, z) - 0.04, z);
      q.setFromAxisAngle(up, facing);
      // Panels are stretched a hair so a run closes exactly at its corner.
      scl.set(KIT_SCALE * stretch, KIT_SCALE * 1.15, KIT_SCALE);
      m.compose(pos, q, scl);
      batch.add(fence, m, WHITE);
      walls.push({
        x1: x1 + (x2 - x1) * t0,
        z1: z1 + (z2 - z1) * t0,
        x2: x1 + (x2 - x1) * t1,
        z2: z1 + (z2 - z1) * t1,
      });
    }
  };
  const px0 = PADDOCK.x - PADDOCK.hx;
  const px1 = PADDOCK.x + PADDOCK.hx;
  const pz0 = PADDOCK.z - PADDOCK.hz;
  const pz1 = PADDOCK.z + PADDOCK.hz;
  run(px0, pz0, px1, pz0);
  run(px1, pz0, px1, pz1);
  run(px1, pz1, px0, pz1);
  // The west side has the gate, left open, facing the yard.
  run(px0, pz1, px0, pz0, [0.38, 0.62]);

  // ---- the first plot ------------------------------------------------------
  const plot = buildPlot(terrain, rand);

  const group = new THREE.Group();
  group.name = 'homestead';
  group.add(batch.build(), plot);
  return { group, obstacles, walls, chimney, fire, door };
}

/**
 * Where smoke should leave the cottage: the middle of its highest stonework,
 * in the cottage's own space at kit scale. Found from the model rather than
 * typed in, so swapping the cottage for another moves the smoke with it.
 */
function chimneyTop(cottage: Model): [number, number, number] {
  const v = new THREE.Vector3();
  let top = -Infinity;
  const stone = cottage.parts.filter((p) => p.material.name.startsWith('Stone'));
  for (const part of stone) {
    part.geometry.computeBoundingBox();
    top = Math.max(top, part.geometry.boundingBox!.max.y);
  }
  let sx = 0;
  let sz = 0;
  let n = 0;
  for (const part of stone) {
    const pos = part.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (v.y > top - 0.04) {
        sx += v.x;
        sz += v.z;
        n++;
      }
    }
  }
  if (n === 0) return [0, cottage.size.y * KIT_SCALE, 0];
  return [(sx / n) * KIT_SCALE, top * KIT_SCALE, (sz / n) * KIT_SCALE];
}

/** Tilled earth: raised rows running the length of the plot. */
function buildPlot(terrain: Terrain, rand: () => number): THREE.Mesh {
  const rows = 7;
  const segs = 14;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const soilDark = new THREE.Color(0x4a3323);
  const soilLight = new THREE.Color(0x7a5a3c);
  const c = new THREE.Color();
  const rowWidth = (PLOT.hz * 2) / rows;
  for (let r = 0; r < rows; r++) {
    const zc = PLOT.z - PLOT.hz + (r + 0.5) * rowWidth;
    // Each row is a low ridge: furrow, crest, furrow.
    const profile: [number, number][] = [
      [-0.5, 0.0],
      [-0.2, 0.17],
      [0.2, 0.17],
      [0.5, 0.0],
    ];
    const start = positions.length / 3;
    for (let s = 0; s <= segs; s++) {
      const x = PLOT.x - PLOT.hx + (s / segs) * PLOT.hx * 2;
      const wobble = (rand() - 0.5) * 0.04;
      for (const [pz, py] of profile) {
        const z = zc + pz * rowWidth;
        positions.push(x, terrain.height(x, z) + 0.03 + py + (py > 0 ? wobble : 0), z);
        c.copy(soilDark).lerp(soilLight, py > 0 ? 0.75 + rand() * 0.25 : rand() * 0.2);
        colors.push(c.r, c.g, c.b);
      }
    }
    const per = profile.length;
    for (let s = 0; s < segs; s++) {
      for (let p = 0; p < per - 1; p++) {
        const a = start + s * per + p;
        const b = a + per;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = 'plot';
  return mesh;
}
