/**
 * Everything that grows: woods, hedgerow bushes, drifts of flowers, boulders.
 *
 * Placement is decided here from the land's own functions plus a seeded
 * shuffle, then handed to `Batcher`, which turns "this model, here, this big"
 * into as few draw calls as it can.
 */
import * as THREE from 'three';
import type { Assets, Model } from '../assets';
import { fbm, hash2, noise2, rng, smoothstep } from '../noise';
import { COTTAGE, POND, WORLD, inPaddock, inPlot, laneDistance, waterDepth, woodland } from './land';
import type { Terrain } from './terrain';

/** A solid thing a horse cannot ride through, as a circle on the ground. */
export interface Obstacle {
  x: number;
  z: number;
  r: number;
}

/**
 * Collects placements and builds instanced meshes from them.
 *
 * Instances are grouped by map sector as well as by model. One InstancedMesh
 * is culled as a single object, so without sectors every tree in the world
 * would be drawn — and drawn again into the shadow map — whenever any one of
 * them was on screen.
 */
export class Batcher {
  private readonly bins = new Map<string, { model: Model; sector: string; matrices: THREE.Matrix4[]; tints: THREE.Color[]; shadows: boolean }>();

  /**
   * @param sectorSize edge of a culling sector, in metres
   * @param drawDistance hide a sector once the rider is further than this from it
   */
  constructor(
    private readonly sectorSize: number,
    private readonly drawDistance = Infinity,
  ) {}

  add(model: Model, matrix: THREE.Matrix4, tint: THREE.Color, shadows = true) {
    const sx = Math.floor(matrix.elements[12]! / this.sectorSize);
    const sz = Math.floor(matrix.elements[14]! / this.sectorSize);
    const sector = `${sx},${sz}`;
    const key = `${model.name}|${sector}|${shadows ? 1 : 0}`;
    let bin = this.bins.get(key);
    if (!bin) {
      bin = { model, sector, matrices: [], tints: [], shadows };
      this.bins.set(key, bin);
    }
    bin.matrices.push(matrix.clone());
    bin.tints.push(tint.clone());
  }

  build(): THREE.Group {
    const group = new THREE.Group();
    for (const bin of this.bins.values()) {
      for (const part of bin.model.parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, bin.matrices.length);
        for (let i = 0; i < bin.matrices.length; i++) {
          mesh.setMatrixAt(i, bin.matrices[i]!);
          mesh.setColorAt(i, bin.tints[i]!);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        // Wind moves foliage a little outside its resting bounds.
        mesh.boundingSphere!.radius += 1.5;
        mesh.castShadow = bin.shadows && part.castShadow;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        group.add(mesh);
      }
    }
    group.userData.drawDistance = this.drawDistance;
    return group;
  }

  /** Hide the sectors of `group` that are too far from the rider to be worth drawing. */
  static cull(group: THREE.Group, rider: THREE.Vector3) {
    const limit = group.userData.drawDistance as number;
    if (!Number.isFinite(limit)) return;
    for (const child of group.children) {
      const sphere = (child as THREE.InstancedMesh).boundingSphere!;
      child.visible = sphere.center.distanceTo(rider) - sphere.radius < limit;
    }
  }
}

const WHITE = new THREE.Color(1, 1, 1);

export interface Scattered {
  group: THREE.Group;
  obstacles: Obstacle[];
  /** Call each frame so small plants far from the rider are skipped. */
  update(rider: THREE.Vector3): void;
}

export function scatter(assets: Assets, terrain: Terrain): Scattered {
  const batch = new Batcher(64);
  // Flowers and ground plants are too small to see from far off, so they get
  // finer sectors and a draw distance.
  const small = new Batcher(32, 105);
  // The treeline beyond where you can ride is only ever seen from far off:
  // big sectors, the kit's lightest models, no shadows.
  const backdrop = new Batcher(160);
  const obstacles: Obstacle[] = [];
  const rand = rng(WORLD.seed * 101 + 3);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const tint = new THREE.Color();
  const model = (name: string): Model => {
    const found = assets.nature.get(name);
    if (!found) throw new Error(`nature model missing: ${name}`);
    return found;
  };

  const place = (
    name: string,
    x: number,
    z: number,
    scale: number,
    opts: { sink?: number; tintSpread?: number; shadows?: boolean; squash?: number; into?: Batcher } = {},
  ) => {
    const y = terrain.height(x, z) - (opts.sink ?? 0);
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    pos.set(x, y, z);
    scl.set(scale, scale * (opts.squash ?? 1), scale);
    m.compose(pos, q, scl);
    const spread = opts.tintSpread ?? 0;
    // Each plant is a slightly different green: a touch yellower or bluer, lighter or darker.
    const warm = (rand() - 0.5) * spread;
    const light = 1 + (rand() - 0.5) * spread;
    tint.setRGB(light * (1 + warm), light, light * (1 - warm * 0.8));
    (opts.into ?? batch).add(model(name), m, spread ? tint : WHITE, opts.shadows ?? true);
  };

  /** True where nothing should be planted: buildings, water, lanes, fields. */
  const reserved = (x: number, z: number, margin: number) =>
    laneDistance(x, z) < 2.6 + margin ||
    inPaddock(x, z, 1.5 + margin) ||
    inPlot(x, z, 1 + margin) ||
    Math.hypot(x - COTTAGE.x, z - COTTAGE.z) < 13 + margin ||
    waterDepth(x, z, terrain.height(x, z)) > -0.25;

  // ---- woods ---------------------------------------------------------------
  const BROADLEAF = ['NormalTree_1', 'NormalTree_2', 'NormalTree_3', 'NormalTree_4', 'NormalTree_5', 'MapleTree_1', 'MapleTree_2', 'MapleTree_5'];
  const BIRCH = ['BirchTree_2', 'BirchTree_3', 'BirchTree_5'];
  const PINE = ['PineTree_1', 'PineTree_2', 'PineTree_4'];
  const pick = (list: string[]) => list[Math.floor(rand() * list.length)]!;

  // Woods you can ride through. A jittered grid, filled more or less fully
  // according to how deep in the wood each cell is.
  const STEP = 9.5;
  const inner = WORLD.playRadius + 14;
  for (let gz = -inner; gz <= inner; gz += STEP) {
    for (let gx = -inner; gx <= inner; gx += STEP) {
      const x = gx + (rand() - 0.5) * STEP * 0.9;
      const z = gz + (rand() - 0.5) * STEP * 0.9;
      if (Math.hypot(x, z) > inner) continue;
      const w = woodland(x, z);
      // Open meadow still gets the odd lone tree; woods get most of their grid filled.
      const chance = w < 0.05 ? 0.014 : 0.1 + w * 0.4;
      if (rand() > chance) continue;
      if (reserved(x, z, 2)) continue;

      // Which kind of wood this is varies slowly across the map.
      const kind = fbm(x / 120, z / 120, 2, 555);
      let name: string;
      if (kind > 0.16) name = rand() < 0.75 ? pick(PINE) : pick(BROADLEAF);
      else if (kind < -0.18) name = rand() < 0.6 ? pick(BIRCH) : pick(BROADLEAF);
      else name = rand() < 0.85 ? pick(BROADLEAF) : pick(BIRCH);

      const scale = (name.startsWith('Pine') ? 2.2 : name.startsWith('Birch') ? 1.75 : 1.9) * (0.8 + rand() * 0.55);
      place(name, x, z, scale, { sink: 0.15, tintSpread: 0.22 });
      obstacles.push({ x, z, r: 0.55 * (scale / 1.9) });
    }
  }

  // The backdrop: wooded hills ringing the world.
  const FAR = ['NormalTree_5', 'MapleTree_4', 'PineTree_5'];
  const FAR_STEP = 13;
  const outer = 268;
  for (let gz = -outer; gz <= outer; gz += FAR_STEP) {
    for (let gx = -outer; gx <= outer; gx += FAR_STEP) {
      const x = gx + (rand() - 0.5) * FAR_STEP * 0.9;
      const z = gz + (rand() - 0.5) * FAR_STEP * 0.9;
      const d = Math.hypot(x, z);
      if (d < inner || d > outer || rand() > 0.82) continue;
      const kind = fbm(x / 120, z / 120, 2, 555);
      const name = kind > 0.16 && rand() < 0.8 ? FAR[2]! : FAR[Math.floor(rand() * 2)]!;
      place(name, x, z, (name.startsWith('Pine') ? 3.6 : 3.3) * (0.8 + rand() * 0.6), { sink: 0.3, tintSpread: 0.25, shadows: false, into: backdrop });
    }
  }

  // A few trees placed by hand, because a home wants a tree to sit under.
  const feature: [string, number, number, number][] = [
    ['NormalTree_1', -11.5, 2.5, 2.5],
    ['NormalTree_2', 12.5, -15, 2.2],
    ['BirchTree_3', -27, 20, 1.9],
    ['BirchTree_5', -30.5, 16.5, 1.7],
    ['MapleTree_2', -52, 41, 2.1],
    ['NormalTree_4', 20, 21, 2.0],
    ['MapleTree_1', 49, -30, 2.2],
    ['NormalTree_3', 47, 5, 1.9],
  ];
  for (const [name, x, z, scale] of feature) {
    place(name, x, z, scale, { sink: 0.15, tintSpread: 0.12 });
    obstacles.push({ x, z, r: 0.7 });
  }

  // ---- bushes --------------------------------------------------------------
  const BUSHES = ['Bush', 'Bush_Flowers', 'Bush_Large', 'Bush_Large_Flowers', 'Bush_Small'];
  for (let i = 0; i < 520; i++) {
    const a = rand() * Math.PI * 2;
    const d = 18 + Math.sqrt(rand()) * 190;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    // Bushes like the edge of a wood and the side of a lane.
    const w = woodland(x, z);
    const edge = 1 - Math.abs(w - 0.35) * 2.2;
    const byLane = 1 - smoothstep(3.5, 8.5, laneDistance(x, z));
    if (rand() > Math.max(edge * 0.8, byLane * 0.55, 0.05)) continue;
    if (reserved(x, z, 1)) continue;
    place(pick(BUSHES), x, z, 1.25 + rand() * 0.9, { sink: 0.08, tintSpread: 0.2 });
  }

  // ---- flowers -------------------------------------------------------------
  // Flowers grow in drifts: each kind has its own noise field, and blooms
  // where that field runs high.
  const FLOWERS = ['Flower_1_Clump', 'Flower_2_Clump', 'Flower_3_Clump', 'Flower_4_Clump', 'Flower_5_Clump'];
  const FSTEP = 1.7;
  const freach = WORLD.playRadius;
  for (let gz = -freach; gz <= freach; gz += FSTEP) {
    for (let gx = -freach; gx <= freach; gx += FSTEP) {
      const jx = gx + (hash2(gx * 10, gz * 10, 21) - 0.5) * FSTEP;
      const jz = gz + (hash2(gx * 10, gz * 10, 22) - 0.5) * FSTEP;
      if (Math.hypot(jx, jz) > freach) continue;
      for (let f = 0; f < FLOWERS.length; f++) {
        const field = noise2(jx / 21, jz / 21, 300 + f * 13) + noise2(jx / 6, jz / 6, 400 + f * 7) * 0.35;
        if (field < 0.6) continue;
        if (hash2(gx * 10, gz * 10, 30 + f) > (field - 0.6) * 2.2) continue;
        if (woodland(jx, jz) > 0.5 || reserved(jx, jz, -1.2)) continue;
        place(FLOWERS[f]!, jx, jz, 1.0 + rand() * 0.7, { shadows: false, into: small });
        break;
      }
    }
  }

  // Leafy ground plants, mostly under the trees and by the water.
  const PLANTS = ['Plant_1', 'Plant_2', 'Plant_Flowers', 'Grass_Large'];
  for (let i = 0; i < 900; i++) {
    const a = rand() * Math.PI * 2;
    const d = 14 + Math.sqrt(rand()) * 160;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const byPond = 1 - smoothstep(POND.radius, POND.radius + 9, Math.hypot(x - POND.x, z - POND.z));
    if (rand() > Math.max(woodland(x, z) * 0.7, byPond, 0.08)) continue;
    if (reserved(x, z, 0)) continue;
    place(pick(PLANTS), x, z, 0.8 + rand() * 0.7, { tintSpread: 0.18, shadows: false, into: small });
  }

  // ---- rocks ---------------------------------------------------------------
  const ROCKS = ['Rock_1', 'Rock_2', 'Rock_4', 'Rock_5'];
  for (let i = 0; i < 150; i++) {
    const a = rand() * Math.PI * 2;
    const d = 20 + Math.sqrt(rand()) * 200;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (reserved(x, z, 1.5)) continue;
    // Outcrops come in clusters: one big stone and a couple of small companions.
    const big = 0.9 + rand() * 1.5;
    place(pick(ROCKS), x, z, big, { sink: 0.25 * big, squash: 0.75 });
    if (d < WORLD.playRadius) obstacles.push({ x, z, r: 0.55 * big });
    const mates = Math.floor(rand() * 3);
    for (let k = 0; k < mates; k++) {
      const s = 0.35 + rand() * 0.5;
      place(pick(ROCKS), x + (rand() - 0.5) * 3.5, z + (rand() - 0.5) * 3.5, s, { sink: 0.2 * s, squash: 0.8 });
    }
  }
  // Stones round the pond's edge.
  for (let i = 0; i < 16; i++) {
    const a = rand() * Math.PI * 2;
    const r = POND.radius * (0.92 + rand() * 0.2);
    const s = 0.5 + rand() * 0.8;
    place(pick(ROCKS), POND.x + Math.cos(a) * r, POND.z + Math.sin(a) * r, s, { sink: 0.3 * s, squash: 0.7 });
  }

  const group = new THREE.Group();
  group.name = 'plants';
  const smallGroup = small.build();
  group.add(batch.build(), smallGroup, backdrop.build());
  return { group, obstacles, update: (rider) => Batcher.cull(smallGroup, rider) };
}
