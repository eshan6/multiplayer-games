/**
 * The shape of the land, as pure functions of (x, z).
 *
 * Nothing here touches the renderer. The terrain mesh, the grass, where trees
 * may stand, where a horse may walk and how high its hooves are all ask these
 * same functions, so they can never disagree with one another. When the game
 * gets a server it will import this file too and reach the same answers.
 *
 * Units are metres. +Y is up. The homestead sits at the origin.
 */
import { clamp, fbm, lerp, noise2, smoothstep } from '../noise';

export const WORLD = {
  seed: 7,
  /** Riding is fenced in by a soft boundary at this distance from home. */
  playRadius: 168,
  /** The terrain mesh reaches further, so the horizon is hills rather than an edge. */
  meshHalfSize: 300,
  /** Flat ground the cottage and yard stand on. */
  yardRadius: 24,
  yardHeight: 6.2,
} as const;

export const POND = { x: -40, z: 30, radius: 15, depth: 2.3 } as const;

/**
 * The lane, as a polyline. It leaves the cottage door, drops off the yard and
 * wanders out across the meadows to the edge of the world.
 */
const LANE_CONTROL: [number, number][] = [
  [4, 9],
  [4.5, 16],
  [10, 30],
  [26, 46],
  [40, 70],
  [36, 98],
  [16, 122],
  [8, 150],
  [22, 185],
  [30, 230],
];

function catmullRom(points: [number, number][], samplesPerSpan: number): [number, number][] {
  const out: [number, number][] = [];
  const at = (i: number) => points[clamp(i, 0, points.length - 1)]!;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    for (let s = 0; s < samplesPerSpan; s++) {
      const t = s / samplesPerSpan;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

export const LANE = catmullRom(LANE_CONTROL, 10);

function distToPolyline(x: number, z: number, line: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const px = a[0] + dx * t - x;
    const pz = a[1] + dz * t - z;
    const d = px * px + pz * pz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/**
 * Distance to the nearest lane, baked onto a 1 m grid at startup. The exact
 * query walks every segment, which is fine once per metre but not once per
 * blade of grass.
 */
const FIELD_HALF = 240;
const FIELD_N = FIELD_HALF * 2 + 1;
const laneField = new Float32Array(FIELD_N * FIELD_N);
{
  // Only cells near a lane need the exact distance; everything else is "far".
  laneField.fill(99);
  const mark = (line: [number, number][]) => {
    for (const [px, pz] of line) {
      const x0 = Math.max(0, Math.floor(px + FIELD_HALF - 9));
      const x1 = Math.min(FIELD_N - 1, Math.ceil(px + FIELD_HALF + 9));
      const z0 = Math.max(0, Math.floor(pz + FIELD_HALF - 9));
      const z1 = Math.min(FIELD_N - 1, Math.ceil(pz + FIELD_HALF + 9));
      for (let iz = z0; iz <= z1; iz++) {
        for (let ix = x0; ix <= x1; ix++) {
          const i = iz * FIELD_N + ix;
          if (laneField[i]! < 98) continue;
          const wx = ix - FIELD_HALF;
          const wz = iz - FIELD_HALF;
          laneField[i] = distToPolyline(wx, wz, LANE);
        }
      }
    }
  };
  mark(LANE);
}

/** Distance in metres to the nearest lane centreline (saturates at ~9). */
export function laneDistance(x: number, z: number): number {
  const fx = clamp(x + FIELD_HALF, 0, FIELD_N - 1.001);
  const fz = clamp(z + FIELD_HALF, 0, FIELD_N - 1.001);
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const u = fx - ix;
  const v = fz - iz;
  const i = iz * FIELD_N + ix;
  const a = laneField[i]!;
  const b = laneField[i + 1]!;
  const c = laneField[i + FIELD_N]!;
  const d = laneField[i + FIELD_N + 1]!;
  return Math.min(9, lerp(lerp(a, b, u), lerp(c, d, u), v));
}

/** 1 on the worn middle of a lane, fading to 0 at its grassy edge. */
export function laneMask(x: number, z: number): number {
  const wobble = noise2(x * 0.35, z * 0.35, 91) * 0.35;
  return 1 - smoothstep(1.0 + wobble, 2.6 + wobble, laneDistance(x, z));
}

/** Rolling hills before anything is levelled or dug. */
function rawHeight(x: number, z: number): number {
  const s = WORLD.seed;
  const broad = fbm(x / 150, z / 150, 3, s) * 13;
  const mid = noise2(x / 46, z / 46, s + 5) * 2.4;
  const fine = noise2(x / 15, z / 15, s + 9) * 0.4;
  // The homestead crowns a wide, gentle rise so the land falls away from the door.
  const d = Math.hypot(x, z);
  const rise = 6 * Math.exp(-(d * d) / (95 * 95));
  return broad + mid + fine + rise;
}

/** Ground height in metres at any point. */
export function heightAt(x: number, z: number): number {
  let h = rawHeight(x, z);

  // Level the yard.
  const d = Math.hypot(x, z);
  h = lerp(WORLD.yardHeight, h, smoothstep(WORLD.yardRadius, WORLD.yardRadius + 30, d));

  // Scoop out the pond.
  // The bank wanders in and out, so the pond is a pond and not a dish.
  const pondD = Math.hypot(x - POND.x, z - POND.z) * (1 + 0.2 * noise2(x / 11, z / 11, 123) + 0.07 * noise2(x / 4, z / 4, 124));
  const bowl = 1 - smoothstep(0, POND.radius * 1.5, pondD);
  h = lerp(h, pondRim, smoothstep(POND.radius * 2.4, POND.radius * 1.05, pondD));
  h -= POND.depth * bowl * bowl * (3 - 2 * bowl);

  // The lane is trodden a little below the turf.
  h -= 0.1 * laneMask(x, z);

  // Past the edge of the playable land, the ground climbs into far hills.
  h += smoothstep(WORLD.playRadius + 6, 300, d) * (26 + noise2(x / 60, z / 60, 31) * 11);
  return h;
}

/** Height the pond's rim is levelled to; the water sits just below it. */
const pondRim = rawHeightAtPondRim();
function rawHeightAtPondRim(): number {
  let sum = 0;
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    sum += rawHeight(POND.x + Math.cos(a) * POND.radius * 1.6, POND.z + Math.sin(a) * POND.radius * 1.6);
  }
  return sum / n - 0.4;
}
export const WATER_LEVEL = pondRim - 0.55;

/**
 * How far under the pond's surface the ground at (x, z) is; negative on dry
 * land. `h` is the ground height there. Valleys elsewhere on the map dip
 * below the pond's level without being under water, so height alone is not
 * the test — it has to be the pond's own hollow.
 */
export function waterDepth(x: number, z: number, h: number): number {
  if (Math.hypot(x - POND.x, z - POND.z) > POND.radius * 2.3) return -10;
  return WATER_LEVEL - h;
}

/** 0 in open meadow → 1 deep in the woods. */
export function woodland(x: number, z: number): number {
  const d = Math.hypot(x, z);
  const n = fbm(x / 95, z / 95, 3, WORLD.seed + 40);
  // Woods gather to the north and west and thin out to nothing by the cottage.
  const bias = smoothstep(10, -90, z) * 0.34 + smoothstep(-20, -120, x) * 0.3;
  const base = smoothstep(0.02, 0.3, n + bias - 0.16);
  const nearHome = smoothstep(46, 82, d);
  // Beyond the play boundary it is wood all round: that is what bounds the world.
  const rim = smoothstep(WORLD.playRadius - 28, WORLD.playRadius + 4, d);
  return clamp(Math.max(base * nearHome, rim), 0, 1);
}

/**
 * How thickly grass grows here, 0..1. `h` is the ground height at the point —
 * callers already have it, and recomputing it per blade is the expensive part.
 */
export function grassDensity(x: number, z: number, h: number): number {
  let g = 1 - laneMask(x, z);
  // The camp on the hilltop is trodden short.
  g *= 0.45 + 0.55 * smoothstep(3, 12, Math.hypot(x, z));
  // Thinner under the trees, and none below the waterline.
  g *= 1 - 0.55 * woodland(x, z);
  g *= smoothstep(0.02, -0.35, waterDepth(x, z, h));
  return g;
}

/**
 * Ground colour, sRGB 0..1. The terrain texture and the root of every grass
 * blade both come from here, which is why the grass melts into the hillside
 * instead of sitting on it like a rug. `h` is the ground height at the point.
 */
export function groundColor(x: number, z: number, h: number, out: [number, number, number]): [number, number, number] {
  const n1 = fbm(x / 34, z / 34, 3, WORLD.seed + 60) * 0.5 + 0.5;
  const n2 = noise2(x / 7, z / 7, WORLD.seed + 61) * 0.5 + 0.5;
  // Sunlit meadow ↔ deeper, damper green.
  // Deep meadow green, varying between richer and drier patches.
  let r = lerp(0.2, 0.33, n1) - n2 * 0.03;
  let g = lerp(0.36, 0.45, n1) - n2 * 0.04;
  let b = lerp(0.1, 0.14, n1) - n2 * 0.03;

  const w = woodland(x, z);
  // Under the trees: dark, mossy, leaf-littered.
  r = lerp(r, 0.2, w * 0.75);
  g = lerp(g, 0.24, w * 0.75);
  b = lerp(b, 0.12, w * 0.75);

  // Damp, darker earth at the water's edge, then pale sand beneath it.
  const shore = smoothstep(-0.42, -0.02, waterDepth(x, z, h));
  r = lerp(r, 0.5, shore);
  g = lerp(g, 0.45, shore);
  b = lerp(b, 0.3, shore);

  const lane = laneMask(x, z);
  const dirtN = noise2(x * 0.9, z * 0.9, 77) * 0.03;
  r = lerp(r, 0.5 + dirtN, lane);
  g = lerp(g, 0.42 + dirtN, lane);
  b = lerp(b, 0.3 + dirtN, lane);

  out[0] = r;
  out[1] = g;
  out[2] = b;
  return out;
}
