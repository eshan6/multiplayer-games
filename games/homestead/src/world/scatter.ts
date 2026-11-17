/**
 * Everything that grows: woods, hedgerow bushes, drifts of flowers, boulders.
 *
 * Placement is decided here from the land's own functions plus a seeded
 * shuffle, then handed to `Batcher`, which turns "this model, here, this big"
 * into as few draw calls as it can.
 */
import * as THREE from 'three';
import { modelOf, type Assets, type Model, type Pack } from '../assets';
import { fbm, hash2, noise2, rng, smoothstep } from '../noise';
import { POND, WORLD, laneDistance, waterDepth, woodland } from './land';
import type { Terrain } from './terrain';

/** A solid thing you cannot walk or ride through, as a circle on the ground. */
export interface Obstacle {
  x: number;
  z: number;
  r: number;
}

/** A straight barrier, as a segment on the ground. */
export interface Wall {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

/**
 * Collects placements and builds instanced meshes from them.
 *
 * Instances are grouped by map sector as well as by model. One InstancedMesh
 * is culled as a single object, so without sectors every tree in the world
 * would be drawn — and drawn again into the shadow map — whenever any one of
 * them was on screen.
 */
/** Beyond this, trees are drawn with their far version. Metres from you to the edge of a sector. */
const LOD_DISTANCE = 46;

export class Batcher {
  private readonly bins = new Map<string, { model: Model; sector: string; matrices: THREE.Matrix4[]; tints: THREE.Color[]; shadows: boolean; lod: '' | 'near' | 'far' }>();

  /**
   * @param sectorSize edge of a culling sector, in metres
   * @param drawDistance hide a sector once the rider is further than this from it
   */
  constructor(
    private readonly sectorSize: number,
    private readonly drawDistance = Infinity,
  ) {}

  /**
   * @param far a lighter version of the model, drawn instead of it once the
   *   sector is beyond `LOD_DISTANCE`. Never casts shadows: the shadow map
   *   does not reach that far.
   */
  add(model: Model, matrix: THREE.Matrix4, tint: THREE.Color, shadows = true, far?: Model) {
    const sx = Math.floor(matrix.elements[12]! / this.sectorSize);
    const sz = Math.floor(matrix.elements[14]! / this.sectorSize);
    const sector = `${sx},${sz}`;
    const put = (m: Model, castShadows: boolean, lod: '' | 'near' | 'far') => {
      const key = `${m.name}|${sector}|${castShadows ? 1 : 0}|${lod}`;
      let bin = this.bins.get(key);
      if (!bin) {
        bin = { model: m, sector, matrices: [], tints: [], shadows: castShadows, lod };
        this.bins.set(key, bin);
      }
      bin.matrices.push(matrix.clone());
      bin.tints.push(tint.clone());
    };
    put(model, shadows, far ? 'near' : '');
    if (far) put(far, false, 'far');
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
        mesh.userData.lod = bin.lod;
        if (bin.lod === 'far') mesh.visible = false;
        group.add(mesh);
      }
    }
    group.userData.drawDistance = this.drawDistance;
    return group;
  }

  /** Swap each sector between its near and far versions by how far it is from you. */
  static lod(group: THREE.Group, you: THREE.Vector3) {
    for (const child of group.children) {
      const lod = child.userData.lod as string;
      if (!lod) continue;
      const sphere = (child as THREE.InstancedMesh).boundingSphere!;
      const near = sphere.center.distanceTo(you) - sphere.radius * 0.55 < LOD_DISTANCE;
      child.visible = lod === 'near' ? near : !near;
    }
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
  /** Where trees stand and how wide their crowns are, for shading the ground under them. */
  canopy: { x: number; z: number; r: number }[];
  /** Call each frame so small plants far from you are skipped. */
  update(you: THREE.Vector3): void;
}

const variants = (name: string, n: number) => Array.from({ length: n }, (_, i) => `${name}_${i}`);

export function scatter(assets: Assets, terrain: Terrain): Scattered {
  const batch = new Batcher(64);
  // Flowers and ground plants are too small to see from far off, so they get
  // finer sectors and a draw distance.
  const small = new Batcher(32, 85);
  // The treeline beyond where you can go is only ever seen from far off:
  // big sectors, the lightest trees, no shadows.
  const backdrop = new Batcher(160);
  const obstacles: Obstacle[] = [];
  const canopy: { x: number; z: number; r: number }[] = [];
  const rand = rng(WORLD.seed * 101 + 3);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const tint = new THREE.Color();
  const pick = (list: string[]) => list[Math.floor(rand() * list.length)]!;

  const place = (pack: Pack, name: string, x: number, z: number, scale: number, opts: { sink?: number; tintSpread?: number; shadows?: boolean; into?: Batcher; far?: Model } = {}): Model => {
    const model = modelOf(assets, pack, name);
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    pos.set(x, terrain.height(x, z) - (opts.sink ?? 0), z);
    scl.setScalar(scale);
    m.compose(pos, q, scl);
    const spread = opts.tintSpread ?? 0;
    // Each plant is a slightly different green: a touch yellower or bluer, lighter or darker.
    const warm = (rand() - 0.5) * spread;
    const light = 1 + (rand() - 0.5) * spread;
    tint.setRGB(light * (1 + warm), light, light * (1 - warm * 0.8));
    (opts.into ?? batch).add(model, m, spread ? tint : WHITE, opts.shadows ?? true, opts.far);
    return model;
  };

  /** True where nothing should be planted: water, the lane, and the hilltop you will build on. */
  const reserved = (x: number, z: number, margin: number) =>
    laneDistance(x, z) < 2.6 + margin || Math.hypot(x, z) < WORLD.yardRadius + 4 + margin || waterDepth(x, z, terrain.height(x, z)) > -0.25;

  // ---- woods ---------------------------------------------------------------
  const OAKS = ['oak_a', 'oak_b', 'oak_c', 'ash_a', 'ash_b'];
  const ASPENS = ['aspen_a', 'aspen_b'];
  const PINES = ['pine_a', 'pine_b'];
  const tree = (name: string, x: number, z: number, scale: number, far = false) => {
    const model = place('tree', name, x, z, scale, { sink: 0.2, tintSpread: 0.2, shadows: !far, into: far ? backdrop : batch, far: far ? undefined : modelOf(assets, 'tree', `${name}_lo`) });
    if (far) return;
    obstacles.push({ x, z, r: 0.45 * scale + 0.15 });
    canopy.push({ x, z, r: Math.max(model.size.x, model.size.z) * scale * 0.42 });
  };

  // A jittered grid, filled more or less fully according to how deep in the wood each cell is.
  const STEP = 10;
  const inner = WORLD.playRadius + 14;
  for (let gz = -inner; gz <= inner; gz += STEP) {
    for (let gx = -inner; gx <= inner; gx += STEP) {
      const x = gx + (rand() - 0.5) * STEP * 0.9;
      const z = gz + (rand() - 0.5) * STEP * 0.9;
      if (Math.hypot(x, z) > inner) continue;
      const w = woodland(x, z);
      // Open meadow still gets the odd lone tree; woods get most of their grid filled.
      if (rand() > (w < 0.05 ? 0.012 : 0.1 + w * 0.42) || reserved(x, z, 2)) continue;
      // Which kind of wood this is varies slowly across the map.
      const kind = fbm(x / 120, z / 120, 2, 555);
      const name = kind > 0.16 ? (rand() < 0.75 ? pick(PINES) : pick(OAKS)) : kind < -0.18 ? (rand() < 0.6 ? pick(ASPENS) : pick(OAKS)) : rand() < 0.85 ? pick(OAKS) : pick(ASPENS);
      tree(name, x, z, 0.8 + rand() * 0.45);
    }
  }
  // A few placed by hand, because a home wants a tree to sit under.
  for (const [name, x, z, scale] of [
    ['oak_a', -27, -9, 1.1],
    ['oak_b', 22, -25, 1.05],
    ['aspen_a', -27, 20, 1],
    ['aspen_b', -30.5, 16.5, 0.9],
    ['ash_a', -52, 41, 1],
    ['oak_c', 20, 26, 1.1],
    ['ash_b', 49, -30, 1.05],
    ['oak_a', 47, 5, 0.9],
  ] as [string, number, number, number][]) {
    tree(name, x, z, scale);
  }

  // The backdrop: wooded hills ringing the world.
  const FAR_STEP = 13;
  const outer = 268;
  for (let gz = -outer; gz <= outer; gz += FAR_STEP) {
    for (let gx = -outer; gx <= outer; gx += FAR_STEP) {
      const x = gx + (rand() - 0.5) * FAR_STEP * 0.9;
      const z = gz + (rand() - 0.5) * FAR_STEP * 0.9;
      const d = Math.hypot(x, z);
      if (d < inner || d > outer || rand() > 0.82) continue;
      const kind = fbm(x / 120, z / 120, 2, 555);
      tree(kind > 0.16 && rand() < 0.8 ? 'far_pine' : rand() < 0.6 ? 'far_oak' : 'far_aspen', x, z, 1 + rand() * 0.5, true);
    }
  }

  // ---- the understorey -------------------------------------------------------
  const around = (count: number, minR: number, maxR: number, each: (x: number, z: number, w: number) => void) => {
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const d = minR + Math.sqrt(rand()) * (maxR - minR);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      each(x, z, woodland(x, z));
    }
  };
  // Bushes like the edge of a wood and the side of a lane.
  const BUSHES = ['bush_a', 'bush_b', 'bush_c'];
  around(420, 20, 200, (x, z, w) => {
    const edge = 1 - Math.abs(w - 0.35) * 2.2;
    const byLane = 1 - smoothstep(3.5, 8.5, laneDistance(x, z));
    if (rand() > Math.max(edge * 0.8, byLane * 0.5, 0.04) || reserved(x, z, 1)) return;
    if (rand() < 0.55) place('wild', pick(variants('shrub_02', 4)), x, z, 0.7 + rand() * 0.5, { sink: 0.1, tintSpread: 0.16 });
    else {
      const bush = pick(BUSHES);
      place('tree', bush, x, z, 0.8 + rand() * 0.6, { sink: 0.1, tintSpread: 0.2, far: modelOf(assets, 'tree', `${bush}_lo`) });
    }
  });
  // Ferns and nettles under the trees.
  around(1500, 24, 175, (x, z, w) => {
    if (w < 0.35 || rand() > w || reserved(x, z, 0)) return;
    const r = rand();
    if (r < 0.6) place('wild', pick(variants('fern_02', 4)), x, z, 0.9 + rand() * 0.7, { tintSpread: 0.15, shadows: false, into: small });
    else if (r < 0.8) place('wild', pick(variants('nettle_plant', 6)), x, z, 2.2 + rand() * 1.4, { tintSpread: 0.15, shadows: false, into: small });
    else place('wild', pick(variants('shrub_03', 4)), x, z, 1.2 + rand() * 0.8, { tintSpread: 0.15, shadows: false, into: small });
  });
  // Old stumps and the odd fallen trunk.
  around(60, 40, 170, (x, z, w) => {
    if (w < 0.4 || reserved(x, z, 2)) return;
    if (rand() < 0.6) {
      place('wild', 'tree_stump_01', x, z, 0.7 + rand() * 0.5, { sink: 0.05 });
      obstacles.push({ x, z, r: 0.6 });
    } else place('wild', 'dead_tree_trunk', x, z, 1.4 + rand() * 0.8, { sink: 0.04 });
  });

  // ---- flowers ---------------------------------------------------------------
  // Each kind has its own noise field, and blooms where that field runs high:
  // drifts of dandelion here, a bank of periwinkle there.
  const FLOWERS: [string, number, number][] = [
    ['dandelion_01', 5, 1.5],
    ['celandine_01', 5, 1.5],
    ['periwinkle_plant', 6, 1.3],
    ['weed_plant_02', 5, 1.6],
  ];
  const FSTEP = 1.9;
  const freach = WORLD.playRadius;
  for (let gz = -freach; gz <= freach; gz += FSTEP) {
    for (let gx = -freach; gx <= freach; gx += FSTEP) {
      const jx = gx + (hash2(gx * 10, gz * 10, 21) - 0.5) * FSTEP;
      const jz = gz + (hash2(gx * 10, gz * 10, 22) - 0.5) * FSTEP;
      if (Math.hypot(jx, jz) > freach) continue;
      for (let f = 0; f < FLOWERS.length; f++) {
        const field = noise2(jx / 21, jz / 21, 300 + f * 13) + noise2(jx / 6, jz / 6, 400 + f * 7) * 0.35;
        if (field < 0.58 || hash2(gx * 10, gz * 10, 30 + f) > (field - 0.58) * 2.4) continue;
        if (woodland(jx, jz) > 0.5 || reserved(jx, jz, -1.2)) continue;
        const [name, n, size] = FLOWERS[f]!;
        place('wild', pick(variants(name, n)), jx, jz, size * (0.85 + rand() * 0.5), { shadows: false, into: small });
        break;
      }
    }
  }
  // Tufts of longer grass, everywhere but thickest by the water.
  around(2600, 10, 165, (x, z, w) => {
    const byPond = 1 - smoothstep(POND.radius, POND.radius + 10, Math.hypot(x - POND.x, z - POND.z));
    if (w > 0.6 || rand() > Math.max(0.45, byPond) || reserved(x, z, -1.5)) return;
    place('wild', pick(variants('grass_medium_02', 5)), x, z, 1.5 + rand() * 1.4, { tintSpread: 0.2, shadows: false, into: small });
  });

  // ---- rocks -----------------------------------------------------------------
  const ROCKS = [...variants('rock_moss_set_01', 6), ...variants('rock_moss_set_02', 7)];
  around(130, 22, 215, (x, z) => {
    if (reserved(x, z, 1.5)) return;
    // Outcrops come in clusters: one big stone and a couple of small companions.
    const big = 0.7 + rand() * 1.3;
    place('wild', pick(ROCKS), x, z, big, { sink: 0.12 * big });
    if (Math.hypot(x, z) < WORLD.playRadius) obstacles.push({ x, z, r: 0.55 * big });
    for (let k = Math.floor(rand() * 3); k > 0; k--) {
      const s = 0.3 + rand() * 0.4;
      place('wild', pick(ROCKS), x + (rand() - 0.5) * 3.5, z + (rand() - 0.5) * 3.5, s, { sink: 0.08 * s });
    }
  });
  // Stones round the pond's edge.
  for (let i = 0; i < 18; i++) {
    const a = rand() * Math.PI * 2;
    const r = POND.radius * (0.92 + rand() * 0.2);
    const s = 0.4 + rand() * 0.6;
    place('wild', pick(ROCKS), POND.x + Math.cos(a) * r, POND.z + Math.sin(a) * r, s, { sink: 0.15 * s });
  }

  const group = new THREE.Group();
  group.name = 'plants';
  const smallGroup = small.build();
  group.add(batch.build(), smallGroup, backdrop.build());
  const main = group.children[0] as THREE.Group;
  return {
    group,
    obstacles,
    canopy,
    update: (you) => {
      Batcher.cull(smallGroup, you);
      Batcher.lod(main, you);
    },
  };
}
