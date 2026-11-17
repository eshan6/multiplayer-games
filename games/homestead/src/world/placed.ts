/**
 * Turning a catalogue entry into something you can see.
 *
 * Buildings are constructed here, piece by piece, out of scanned materials:
 * a rubble-stone plinth, limewashed plaster between oak posts, a thatched
 * roof. Building them in code rather than loading models keeps every wall the
 * right size for its texture, lets a barn and a hen coop share one vocabulary,
 * and costs nothing to download. Smaller things — a barrel, a bench, a
 * lantern — are photoscanned models.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { modelOf, type Assets, type Model } from '../assets';
import { BED_SLOTS, type Shape } from '../game/catalog';
import { rng } from '../noise';
import { scanGlass, surface } from '../scans';

/** One mesh per part, sharing the model's geometry and materials. */
export function instantiate(model: Model, scale: number): THREE.Group {
  const g = new THREE.Group();
  for (const part of model.parts) {
    const mesh = new THREE.Mesh(part.geometry, part.material);
    mesh.castShadow = part.castShadow;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  g.scale.setScalar(scale);
  return g;
}

export function fitScale(model: Model, fit: { axis: 'x' | 'y' | 'z'; size: number }): number {
  return fit.size / model.size[fit.axis];
}

// ---------------------------------------------------------------- materials ----

/** A material and how many metres one repeat of its texture should cover. */
interface Stuff {
  material: THREE.Material;
  tile: number;
}
let stuff: Record<string, Stuff> | null = null;
function materials(assets: Assets): Record<string, Stuff> {
  if (stuff) return stuff;
  const plain = (color: number, roughness = 0.9, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
  stuff = {
    stone: { material: surface('rustic_stone_wall'), tile: 1.7 },
    blocks: { material: surface('medieval_blocks_02'), tile: 1.6 },
    plaster: { material: surface('plastered_wall_04', { tint: 0xf3e6cb }), tile: 2.4 },
    timber: { material: surface('dark_wooden_planks', { tint: 0xb89878 }), tile: 1.3 },
    planks: { material: surface('weathered_planks', { tint: 0xd9c8b0 }), tile: 1.7 },
    door: { material: surface('wood_planks', { tint: 0xa98a68 }), tile: 1.5 },
    thatch: { material: surface('thatch_roof_angled', { tint: 0xd8c79a }), tile: 2.6 },
    tiles: { material: surface('clay_roof_tiles_02'), tile: 1.9 },
    soil: { material: surface('farm_soil'), tile: 1.6 },
    cobble: { material: surface('stone_pathway'), tile: 1.5 },
    canvas: { material: surface('rough_linen', { tint: 0xe8dcc0 }), tile: 0.9 },
    stripe: { material: surface('fabric_pattern_07', { tint: 0xe9d7c0 }), tile: 0.9 },
    straw: { material: surface('thatch_roof_angled', { tint: 0xf2d98a }), tile: 1.2 },
    blue: { material: surface('rough_linen', { tint: 0x7d94a8 }), tile: 0.6 },
    iron: { material: plain(0x2c2a28, 0.55, { metalness: 0.8 }), tile: 1 },
    dark: { material: plain(0x0d0c0b, 1), tile: 1 },
    ember: { material: plain(0x1a1512, 1, { emissive: 0xff5a1e, emissiveIntensity: 0.6 }), tile: 1 },
    water: { material: plain(0x3d6f78, 0.08), tile: 1 },
    glass: { material: assets.windowGlow, tile: 1 },
    lamp: { material: scanGlass, tile: 1 },
  };
  for (const s of Object.values(stuff)) {
    // Thin canvas and roof slabs are seen from underneath too.
    if (s.material instanceof THREE.MeshStandardMaterial && (s === stuff.canvas || s === stuff.stripe)) s.material.side = THREE.DoubleSide;
  }
  return stuff;
}

// ------------------------------------------------------------------ the kit ----

const tmp = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const ONE = new THREE.Vector3(1, 1, 1);

/**
 * Collects shapes by material and welds each material's shapes into one mesh,
 * so a cottage of two hundred beams and boards is a dozen draw calls.
 */
class Kit {
  private readonly bins = new Map<string, THREE.BufferGeometry[]>();
  private readonly extras: THREE.Object3D[] = [];

  constructor(private readonly stuff: Record<string, Stuff>) {}

  private push(mat: string, geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
    tmp.compose(new THREE.Vector3(x, y, z), tmpQ.setFromEuler(tmpE.set(rx, ry, rz, 'YXZ')), ONE);
    geo.applyMatrix4(tmp);
    const list = this.bins.get(mat);
    if (list) list.push(geo);
    else this.bins.set(mat, [geo]);
  }

  /** A box whose texture keeps its real-world scale on every face. Positioned by the centre of its base. */
  box(mat: string, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0): this {
    const geo = new THREE.BoxGeometry(w, h, d);
    const tile = this.stuff[mat]!.tile;
    const uv = geo.getAttribute('uv');
    // Faces come in the order +x, -x, +y, -y, +z, -z, four vertices each.
    const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) {
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        uv.setXY(i, (uv.getX(i) * dims[f]![0]) / tile, (uv.getY(i) * dims[f]![1]) / tile);
      }
    }
    geo.translate(0, h / 2, 0);
    this.push(mat, geo, x, y, z, rx, ry, rz);
    return this;
  }

  /** An upright cylinder, standing on its base. */
  cyl(mat: string, rTop: number, rBottom: number, h: number, x: number, y: number, z: number, sides = 10, rx = 0, rz = 0, open = false): this {
    const geo = new THREE.CylinderGeometry(rTop, rBottom, h, sides, 1, open);
    const tile = this.stuff[mat]!.tile;
    const uv = geo.getAttribute('uv');
    const round = Math.PI * (rTop + rBottom);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * round) / tile, (uv.getY(i) * h) / tile);
    geo.translate(0, h / 2, 0);
    this.push(mat, geo, x, y, z, rx, 0, rz);
    return this;
  }

  /** A flat polygon from points given in order, with texture coordinates from its own plane. */
  poly(mat: string, points: [number, number, number][], twoSided = false): this {
    const tile = this.stuff[mat]!.tile;
    const a = new THREE.Vector3(...points[0]!);
    const u = new THREE.Vector3(...points[1]!).sub(a).normalize();
    const n = new THREE.Vector3().crossVectors(u, new THREE.Vector3(...points[2]!).sub(a)).normalize();
    const v = new THREE.Vector3().crossVectors(n, u);
    const pos: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    for (const p of points) {
      pos.push(...p);
      const rel = new THREE.Vector3(...p).sub(a);
      uvs.push(rel.dot(u) / tile, rel.dot(v) / tile);
    }
    for (let i = 1; i < points.length - 1; i++) idx.push(0, i, i + 1);
    if (twoSided) {
      // The back face needs vertices of its own: shared ones would average
      // the two opposite normals to zero, which lights as NaN.
      const base = points.length;
      for (let i = 0; i < points.length; i++) {
        pos.push(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
        uvs.push(uvs[i * 2]!, uvs[i * 2 + 1]!);
      }
      for (let i = 1; i < points.length - 1; i++) idx.push(base, base + i + 1, base + i);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.push(mat, geo, 0, 0, 0);
    return this;
  }

  /**
   * A pitched roof over a rectangle: two slabs meeting at a ridge that runs
   * along X, overhanging the walls all round.
   */
  roof(mat: string, w: number, d: number, eave: number, rise: number, x: number, z: number, overhang = 0.45, thick = 0.16): this {
    const run = d / 2 + overhang;
    const slope = Math.hypot(run, (rise * run) / (d / 2));
    const pitch = Math.atan2(rise, d / 2);
    for (const side of [1, -1]) {
      // Each slab is laid flat, then tipped about the ridge.
      const geo = new THREE.BoxGeometry(w + overhang * 2, thick, slope);
      const tile = this.stuff[mat]!.tile;
      const uv = geo.getAttribute('uv');
      const dims: [number, number][] = [[slope, thick], [slope, thick], [w, slope], [w, slope], [w, thick], [w, thick]];
      for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) uv.setXY(f * 4 + k, (uv.getX(f * 4 + k) * dims[f]![0]) / tile, (uv.getY(f * 4 + k) * dims[f]![1]) / tile);
      geo.translate(0, thick / 2, (slope / 2) * side);
      // Tip the slab down from the ridge toward its eave.
      this.push(mat, geo, x, eave + rise, z, pitch * side, 0, 0);
    }
    return this;
  }

  /** Something that is not part of the welded shell: a scanned prop, a light. */
  add(object: THREE.Object3D, x = 0, y = 0, z = 0, ry = 0): this {
    object.position.set(x, y, z);
    object.rotation.y = ry;
    this.extras.push(object);
    return this;
  }

  build(shadows = true): THREE.Group {
    const group = new THREE.Group();
    for (const [mat, list] of this.bins) {
      const mesh = new THREE.Mesh(mergeGeometries(list, false), this.stuff[mat]!.material);
      const quiet = mat === 'glass' || mat === 'lamp' || mat === 'water' || mat === 'ember';
      mesh.castShadow = shadows && !quiet;
      mesh.receiveShadow = !quiet;
      group.add(mesh);
    }
    for (const extra of this.extras) group.add(extra);
    return group;
  }
}

// ---------------------------------------------------------------- buildings ----

/** The cottage's dimensions, which the door, the chimney smoke and collision all read. */
export const COTTAGE = { width: 8.6, depth: 6.4, wall: 2.85, plinth: 0.45, rise: 3.1, chimney: [-3.2, 7.4, -0.6] as [number, number, number] } as const;

/** A window: frame, glass, glazing bars, and a pair of shutters. Faces +Z before `ry`. */
function windowOn(kit: Kit, x: number, y: number, z: number, ry: number, w = 1.0, h = 1.1, shutters = true) {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  const at = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
  let [px, pz] = at(0, 0.02);
  kit.box('timber', w + 0.2, h + 0.2, 0.1, px, y - 0.1, pz, ry);
  [px, pz] = at(0, 0.06);
  kit.box('glass', w, h, 0.04, px, y, pz, ry);
  [px, pz] = at(0, 0.09);
  kit.box('timber', 0.05, h, 0.03, px, y, pz, ry);
  kit.box('timber', w, 0.05, 0.03, px, y + h / 2 - 0.025, pz, ry);
  [px, pz] = at(0, 0.12);
  kit.box('timber', w + 0.34, 0.07, 0.2, px, y - 0.14, pz, ry);
  if (shutters) {
    for (const side of [-1, 1]) {
      [px, pz] = at(side * (w / 2 + 0.3), 0.07);
      kit.box('door', 0.46, h + 0.06, 0.05, px, y - 0.03, pz, ry + side * 0.12);
    }
  }
}

function cottage(assets: Assets): THREE.Group {
  const k = new Kit(materials(assets));
  const { width: w, depth: d, wall, plinth, rise } = COTTAGE;
  const hw = w / 2;
  const hd = d / 2;
  const top = plinth + wall;
  const beam = 0.2;

  k.box('stone', w + 0.24, plinth, d + 0.24, 0, 0, 0);
  k.box('plaster', w, wall, 0.3, 0, plinth, hd - 0.15).box('plaster', w, wall, 0.3, 0, plinth, -hd + 0.15);
  k.box('plaster', 0.3, wall, d - 0.6, hw - 0.15, plinth, 0).box('plaster', 0.3, wall, d - 0.6, -hw + 0.15, plinth, 0);
  for (const side of [1, -1]) {
    const x = side * hw;
    k.poly('plaster', [[x, top, -hd], [x, top, hd], [x, top + rise, 0]], true);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box('timber', beam, wall, beam, sx * (hw - 0.06), plinth, sz * (hd - 0.06));
  for (const sz of [-1, 1]) {
    const z = sz * (hd + 0.01);
    k.box('timber', w, beam, 0.1, 0, plinth, z).box('timber', w, beam, 0.1, 0, top - beam, z);
    for (const x of [-2.8, -1.25, 1.25, 2.8]) k.box('timber', 0.16, wall, 0.1, x, plinth, z);
    for (const sx of [-1, 1]) k.box('timber', 0.13, 2.0, 0.1, sx * 3.55, plinth + 0.75, z, 0, 0, sx * 0.62);
  }
  for (const sx of [-1, 1]) {
    const x = sx * (hw + 0.01);
    k.box('timber', 0.1, beam, d, x, plinth, 0).box('timber', 0.1, beam, d, x, top - beam, 0);
    for (const z of [-1.3, 1.3]) k.box('timber', 0.1, wall + rise * 0.55, 0.16, x, plinth, z);
    k.box('timber', 0.1, wall + rise - 0.3, 0.16, x, plinth, 0);
    const len = Math.hypot(hd, rise) + 0.5;
    for (const sz of [-1, 1]) k.box('timber', 0.12, 0.18, len, x, top + rise / 2 - 0.2, sz * hd * 0.5, 0, sz * Math.atan2(rise, hd));
  }
  k.roof('thatch', w, d, top - 0.05, rise + 0.08, 0, 0, 0.6, 0.34);
  k.box('thatch', w + 1.3, 0.3, 0.7, 0, top + rise + 0.05, 0);

  // The chimney, in stone, up the west gable and clear of the ridge.
  const [cx, cy, cz] = COTTAGE.chimney;
  k.box('stone', 1.0, cy, 1.2, cx - 0.9, 0, cz).box('stone', 1.16, 0.2, 1.36, cx - 0.9, cy, cz).box('dark', 0.6, 0.06, 0.8, cx - 0.9, cy + 0.2, cz);

  // The door, with a stone step and a small thatched hood on brackets.
  const z = hd + 0.02;
  k.box('timber', 1.36, 2.2, 0.12, 0, plinth, z).box('door', 1.1, 2.05, 0.1, 0, plinth, z + 0.05);
  for (const y of [0.45, 1.05, 1.65]) k.box('iron', 0.9, 0.05, 0.02, -0.05, plinth + y, z + 0.11);
  k.box('iron', 0.06, 0.16, 0.05, 0.4, plinth + 1.0, z + 0.12);
  k.box('blocks', 1.9, plinth, 0.9, 0, 0, hd + 0.55).box('blocks', 1.5, plinth * 0.5, 0.5, 0, 0, hd + 1.15);
  k.box('thatch', 2.1, 0.18, 1.1, 0, plinth + 2.45, hd + 0.5, 0, 0.42);
  for (const sx of [-1, 1]) k.box('timber', 0.1, 0.1, 0.8, sx * 0.86, plinth + 2.05, hd + 0.35, 0, 0.7);

  windowOn(k, -2.05, plinth + 1.05, hd, 0);
  windowOn(k, 2.05, plinth + 1.05, hd, 0);
  windowOn(k, -2.05, plinth + 1.05, -hd, Math.PI, 1.0, 1.1, false);
  windowOn(k, 2.05, plinth + 1.05, -hd, Math.PI, 1.0, 1.1, false);
  windowOn(k, hw, plinth + 1.05, 0.6, Math.PI / 2);
  windowOn(k, hw, top + 0.9, 0, Math.PI / 2, 0.7, 0.8, false);

  // Window boxes under the front windows, planted up.
  const flowers = ['periwinkle_plant_0', 'celandine_01_1', 'periwinkle_plant_2', 'celandine_01_3'];
  for (const sx of [-1, 1]) {
    k.box('planks', 1.2, 0.22, 0.28, sx * 2.05, plinth + 0.62, hd + 0.17).box('soil', 1.1, 0.02, 0.2, sx * 2.05, plinth + 0.84, hd + 0.17);
    flowers.forEach((name, i) => k.add(instantiate(modelOf(assets, 'wild', name), 1.5), sx * 2.05 + (i - 1.5) * 0.27, plinth + 0.84, hd + 0.17, i));
  }
  return k.build();
}

function barn(assets: Assets, w: number, d: number, wall: number, rise: number, roof: 'tiles' | 'thatch', doors: number): THREE.Group {
  const k = new Kit(materials(assets));
  const hw = w / 2;
  const hd = d / 2;
  k.box('stone', w + 0.16, 0.35, d + 0.16, 0, 0, 0);
  k.box('planks', w, wall, 0.14, 0, 0.35, hd - 0.07).box('planks', w, wall, 0.14, 0, 0.35, -hd + 0.07);
  k.box('planks', 0.14, wall, d, hw - 0.07, 0.35, 0).box('planks', 0.14, wall, d, -hw + 0.07, 0.35, 0);
  const top = 0.35 + wall;
  for (const side of [1, -1]) k.poly('planks', [[side * hw, top, -hd], [side * hw, top, hd], [side * hw, top + rise, 0]], true);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box('timber', 0.2, wall, 0.2, sx * (hw - 0.02), 0.35, sz * (hd - 0.02));
  for (const sz of [-1, 1]) k.box('timber', w + 0.1, 0.18, 0.12, 0, top - 0.18, sz * (hd + 0.02));
  k.roof(roof, w, d, top - 0.04, rise + 0.06, 0, 0, 0.5, 0.2);
  // Doors: boarded, with a Z-brace, standing a little open.
  const dw = Math.min(1.5, (w - 1.2) / doors);
  for (let i = 0; i < doors; i++) {
    const x = (i - (doors - 1) / 2) * (dw + 0.08);
    k.box('dark', dw, 2.3, 0.04, x, 0.35, hd - 0.02);
    k.box('door', dw, 2.25, 0.08, x - 0.08, 0.35, hd + 0.2, i % 2 ? 0.35 : -0.3);
  }
  k.box('timber', dw * doors + 0.5, 0.2, 0.14, 0, 0.35 + 2.3, hd + 0.03);
  // Iron strap hinges, two to a door.
  for (let i = 0; i < doors; i++) {
    const x = (i - (doors - 1) / 2) * (dw + 0.08) - 0.08;
    for (const y of [0.75, 2.05]) k.box('iron', dw * 0.62, 0.05, 0.02, x, 0.35 + y, hd + 0.25, i % 2 ? 0.35 : -0.3);
  }
  // A loft hatch in the gable.
  k.box('dark', 0.04, 0.8, 0.8, hw + 0.01, top + 0.2, 0).box('timber', 0.06, 0.95, 0.95, hw - 0.01, top + 0.12, 0);
  // Board-and-batten: a narrow strip over every joint of the cladding.
  for (let x = -hw + 0.35; x < hw - 0.2; x += 0.42) {
    if (Math.abs(x) < (dw * doors) / 2 + 0.15) continue;
    k.box('timber', 0.05, wall - 0.1, 0.03, x, 0.4, hd + 0.01);
  }
  for (let x = -hw + 0.35; x < hw - 0.2; x += 0.42) k.box('timber', 0.05, wall - 0.1, 0.03, x, 0.4, -hd - 0.01);
  // Fascia boards under the eaves, and a small window in the back wall.
  for (const sz of [-1, 1]) k.box('timber', w + 1.0, 0.16, 0.05, 0, top - 0.06, sz * (hd + 0.52));
  k.box('dark', 0.7, 0.5, 0.03, hw * 0.5, 1.5, -hd - 0.03).box('timber', 0.82, 0.08, 0.06, hw * 0.5, 1.46, -hd - 0.05).box('timber', 0.82, 0.08, 0.06, hw * 0.5, 2.0, -hd - 0.05);
  // Outside the door: a hay rack on the wall, a water trough, straw trodden out.
  k.box('timber', 1.4, 0.06, 0.08, -hw + 1.0, 1.55, hd + 0.08).box('timber', 1.4, 0.06, 0.08, -hw + 1.0, 0.95, hd + 0.35);
  for (let i = 0; i < 8; i++) k.box('timber', 0.03, 0.66, 0.03, -hw + 0.4 + i * 0.17, 0.95, hd + 0.2, 0, -0.42);
  k.box('straw', 1.2, 0.38, 0.22, -hw + 1.0, 1.08, hd + 0.2, 0, -0.42);
  k.box('planks', 1.6, 0.42, 0.55, hw - 1.1, 0, hd + 0.75).box('water', 1.44, 0.02, 0.4, hw - 1.1, 0.36, hd + 0.75);
  k.box('straw', dw * doors + 0.4, 0.03, 1.1, 0, 0, hd + 0.75);
  return k.build();
}

function coop(assets: Assets): THREE.Group {
  const k = new Kit(materials(assets));
  const w = 2.3;
  const d = 1.7;
  const floor = 0.6;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box('timber', 0.12, floor + 1.25, 0.12, sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06));
  k.box('planks', w, 0.08, d, 0, floor, 0);
  k.box('planks', w, 1.15, 0.07, 0, floor + 0.08, -d / 2 + 0.04).box('planks', w, 1.15, 0.07, 0, floor + 0.08, d / 2 - 0.04);
  k.box('planks', 0.07, 1.15, d, w / 2 - 0.04, floor + 0.08, 0).box('planks', 0.07, 1.15, d, -w / 2 + 0.04, floor + 0.08, 0);
  for (const side of [1, -1]) k.poly('planks', [[side * w / 2, floor + 1.23, -d / 2], [side * w / 2, floor + 1.23, d / 2], [side * w / 2, floor + 1.83, 0]], true);
  k.roof('tiles', w, d, floor + 1.2, 0.62, 0, 0, 0.25, 0.08);
  // The pop-hole and its ramp.
  k.box('dark', 0.42, 0.5, 0.03, 0.35, floor + 0.08, d / 2 + 0.005);
  k.box('door', 0.4, 0.05, 1.3, 0.35, floor * 0.46, d / 2 + 0.6, 0, 0.47);
  for (let i = 0; i < 4; i++) k.box('timber', 0.4, 0.03, 0.04, 0.35, floor * 0.86 - i * 0.14, d / 2 + 0.16 + i * 0.28);
  // Nest boxes hung on the side.
  k.box('planks', 0.5, 0.5, 1.1, -w / 2 - 0.25, floor + 0.3, 0).box('door', 0.56, 0.05, 1.2, -w / 2 - 0.27, floor + 0.8, 0, 0, 0, 0.25);
  k.box('iron', 0.03, 0.12, 0.03, -w / 2 - 0.52, floor + 0.62, 0.3).box('iron', 0.03, 0.12, 0.03, -w / 2 - 0.52, floor + 0.62, -0.3);
  // A wired run in front: posts, a top rail, and the mesh as fine wires.
  const runD = 2.2;
  const runW = w + 0.4;
  for (const sx of [-1, 0, 1]) k.box('timber', 0.08, 1.1, 0.08, sx * runW / 2, 0, d / 2 + runD);
  for (const sx of [-1, 1]) k.box('timber', 0.08, 1.1, 0.08, sx * runW / 2, 0, d / 2 + 0.1);
  for (const sz of [d / 2 + runD]) k.box('timber', runW, 0.06, 0.06, 0, 1.06, sz);
  for (const sx of [-1, 1]) k.box('timber', 0.06, 0.06, runD, sx * runW / 2, 1.06, d / 2 + 0.1 + runD / 2);
  for (let y = 0.08; y < 1.05; y += 0.13) {
    k.box('iron', runW, 0.008, 0.008, 0, y, d / 2 + runD);
    for (const sx of [-1, 1]) k.box('iron', 0.008, 0.008, runD, sx * runW / 2, y, d / 2 + 0.1 + runD / 2);
  }
  for (let x = -runW / 2; x <= runW / 2; x += 0.16) k.box('iron', 0.008, 1.05, 0.008, x, 0.02, d / 2 + runD);
  for (const sx of [-1, 1]) for (let z = 0.1; z <= runD; z += 0.16) k.box('iron', 0.008, 1.05, 0.008, sx * runW / 2, 0.02, d / 2 + z);
  // Inside the run: a perch, a grain feeder, a water dish, scattered straw.
  k.box('timber', 1.2, 0.05, 0.05, -0.4, 0.45, d / 2 + 1.3).box('timber', 0.05, 0.45, 0.05, -0.95, 0, d / 2 + 1.3).box('timber', 0.05, 0.45, 0.05, 0.15, 0, d / 2 + 1.3);
  k.cyl('iron', 0.12, 0.14, 0.3, 0.75, 0, d / 2 + 1.5, 12).cyl('iron', 0.2, 0.2, 0.04, 0.75, 0, d / 2 + 1.5, 14);
  k.cyl('planks', 0.18, 0.16, 0.06, -0.2, 0, d / 2 + 0.75, 12).cyl('water', 0.15, 0.15, 0.01, -0.2, 0.05, d / 2 + 0.75, 12);
  k.box('straw', runW - 0.2, 0.02, runD - 0.2, 0, 0, d / 2 + 0.1 + runD / 2);
  k.box('timber', w + 0.5, 0.08, 0.1, 0, floor + 1.83, 0);
  return k.build();
}

function sty(assets: Assets): THREE.Group {
  const k = new Kit(materials(assets));
  // A lean-to shelter, open to the front…
  k.box('planks', 3.4, 1.7, 0.1, 0, 0, -1.3).box('planks', 0.1, 1.5, 2.0, -1.65, 0, -0.3).box('planks', 0.1, 1.5, 2.0, 1.65, 0, -0.3);
  for (const sx of [-1, 1]) k.box('timber', 0.14, 1.35, 0.14, sx * 1.6, 0, 0.7);
  k.box('thatch', 3.9, 0.22, 2.8, 0, 1.45, -0.25, 0, 0.16);
  k.box('straw', 2.9, 0.12, 1.6, 0, 0, -0.4);
  // …and a low stone yard in front of it.
  k.box('stone', 0.34, 0.75, 3.0, -2.1, 0, 2.2).box('stone', 0.34, 0.75, 3.0, 2.1, 0, 2.2).box('stone', 1.5, 0.75, 0.34, -1.5, 0, 3.6).box('stone', 1.5, 0.75, 0.34, 1.5, 0, 3.6);
  // Coping stones along the wall tops.
  k.box('blocks', 0.42, 0.08, 3.08, -2.1, 0.75, 2.2).box('blocks', 0.42, 0.08, 3.08, 2.1, 0.75, 2.2).box('blocks', 1.58, 0.08, 0.42, -1.5, 0.75, 3.6).box('blocks', 1.58, 0.08, 0.42, 1.5, 0.75, 3.6);
  // A five-bar gate in the gap, hung on a post, standing ajar.
  k.box('timber', 0.14, 1.05, 0.14, -0.72, 0, 3.6).box('timber', 0.14, 1.05, 0.14, 0.72, 0, 3.6);
  for (const y of [0.15, 0.33, 0.51, 0.69, 0.87]) k.box('door', 1.3, 0.07, 0.04, -0.05, y, 3.95, -0.55);
  k.box('door', 1.55, 0.07, 0.04, -0.05, 0.5, 3.95, -0.55, 0, 0.62);
  k.box('iron', 0.06, 0.05, 0.12, -0.66, 0.3, 3.62).box('iron', 0.06, 0.05, 0.12, -0.66, 0.8, 3.62);
  // Wallowing mud, a stone feeding trough, and a heap of straw bedding.
  k.box('soil', 2.6, 0.03, 1.6, 0.2, 0, 2.4);
  k.box('stone', 1.3, 0.3, 0.45, 1.2, 0, 1.3).box('dark', 1.1, 0.02, 0.3, 1.2, 0.29, 1.3).box('soil', 1.0, 0.02, 0.25, 1.2, 0.27, 1.3);
  k.box('straw', 1.0, 0.25, 0.8, -1.1, 0, -0.6, 0.3);
  k.box('timber', 3.9, 0.12, 0.14, 0, 1.6, 0.85);
  return k.build();
}

function stable(assets: Assets): THREE.Group {
  const k = new Kit(materials(assets));
  const w = 9;
  const d = 4.2;
  k.box('stone', w + 0.2, 0.3, d + 0.2, 0, 0, 0);
  k.box('planks', w, 2.5, 0.14, 0, 0.3, -d / 2 + 0.07).box('planks', 0.14, 2.5, d, w / 2 - 0.07, 0.3, 0).box('planks', 0.14, 2.5, d, -w / 2 + 0.07, 0.3, 0);
  for (const side of [1, -1]) k.poly('planks', [[side * w / 2, 2.8, -d / 2], [side * w / 2, 2.8, d / 2], [side * w / 2, 4.2, 0]], true);
  // Three stalls: posts, partitions, and a half-door on each.
  for (let i = 0; i <= 3; i++) {
    const x = -w / 2 + (i * w) / 3;
    k.box('timber', 0.2, 2.5, 0.2, x === -w / 2 ? x + 0.1 : x === w / 2 ? x - 0.1 : x, 0.3, d / 2 - 0.1);
    if (i > 0 && i < 3) k.box('planks', 0.1, 1.6, d - 0.3, x, 0.3, 0);
  }
  for (let i = 0; i < 3; i++) {
    const x = -w / 2 + ((i + 0.5) * w) / 3;
    k.box('door', w / 3 - 0.5, 1.2, 0.08, x - 0.1, 0.3, d / 2 + 0.25, i === 1 ? -0.5 : 0.25);
    k.box('straw', w / 3 - 0.4, 0.12, d - 0.8, x, 0.3, -0.1);
  }
  k.box('timber', w + 0.1, 0.22, 0.2, 0, 2.6, d / 2 - 0.1);
  k.roof('tiles', w, d, 2.76, 1.44, 0, 0, 0.55, 0.2);
  // In each stall: a hay rack on the back wall, a bucket, and the doors' iron.
  for (let i = 0; i < 3; i++) {
    const x = -w / 2 + ((i + 0.5) * w) / 3;
    k.box('timber', 1.3, 0.06, 0.1, x, 1.75, -d / 2 + 0.2).box('timber', 1.3, 0.06, 0.1, x, 1.15, -d / 2 + 0.45);
    for (let j = 0; j < 8; j++) k.box('timber', 0.03, 0.66, 0.03, x - 0.6 + j * 0.17, 1.15, -d / 2 + 0.32, 0, 0.42);
    k.box('straw', 1.15, 0.4, 0.25, x, 1.25, -d / 2 + 0.32, 0, 0.42);
    k.cyl('planks', 0.16, 0.13, 0.3, x + 1.0, 0.3, -d / 2 + 0.35, 12).cyl('water', 0.145, 0.145, 0.01, x + 1.0, 0.56, -d / 2 + 0.35, 12);
    for (const y of [0.45, 1.25]) k.box('iron', (w / 3 - 0.5) * 0.55, 0.05, 0.02, x - 0.35, 0.3 + y, d / 2 + 0.3, i === 1 ? -0.5 : 0.25);
  }
  // A saddle on a rack by the end wall, and a lucky horseshoe over the middle door.
  k.box('timber', 0.08, 1.0, 0.08, w / 2 - 0.4, 0.3, d / 2 - 0.5).box('timber', 0.6, 0.08, 0.08, w / 2 - 0.4, 1.3, d / 2 - 0.5, Math.PI / 2);
  k.box('door', 0.42, 0.18, 0.62, w / 2 - 0.4, 1.32, d / 2 - 0.5, Math.PI / 2, 0, 0.12).box('dark', 0.06, 0.4, 0.04, w / 2 - 0.2, 0.95, d / 2 - 0.5);
  k.box('iron', 0.2, 0.03, 0.02, 0, 2.45, d / 2 + 0.01).box('iron', 0.03, 0.16, 0.02, -0.09, 2.3, d / 2 + 0.01).box('iron', 0.03, 0.16, 0.02, 0.09, 2.3, d / 2 + 0.01);
  // Battens on the back and end walls.
  for (let x = -w / 2 + 0.3; x < w / 2 - 0.2; x += 0.45) k.box('timber', 0.05, 2.4, 0.03, x, 0.35, -d / 2 - 0.01);
  for (const sx of [-1, 1]) for (let z = -d / 2 + 0.3; z < d / 2 - 0.2; z += 0.45) k.box('timber', 0.03, 2.4, 0.05, sx * (w / 2 + 0.01), 0.35, z);
  return k.build();
}

function well(assets: Assets): THREE.Group {
  const k = new Kit(materials(assets));
  k.cyl('stone', 0.95, 1.0, 0.85, 0, 0, 0, 14).cyl('dark', 0.72, 0.72, 0.02, 0, 0.84, 0, 14).cyl('water', 0.7, 0.7, 0.02, 0, 0.5, 0, 14);
  for (const sx of [-1, 1]) k.box('timber', 0.14, 2.3, 0.14, sx * 0.86, 0.3, 0);
  k.cyl('timber', 0.07, 0.07, 1.9, 0.95, 1.75, 0, 8, 0, Math.PI / 2);
  k.roof('tiles', 2.0, 1.5, 2.5, 0.6, 0, 0, 0.2, 0.08);
  for (const side of [1, -1]) k.poly('planks', [[side * 1.0, 2.5, -0.75], [side * 1.0, 2.5, 0.75], [side * 1.0, 3.1, 0]], true);
  k.add(instantiate(modelOf(assets, 'wild', 'wooden_bucket_01'), 1.0), 0.55, 0.85, 0.72, 0.6);
  // Rope wound on the windlass, hanging into the shaft; a crank handle; a mossy coping ring.
  k.cyl('straw', 0.11, 0.11, 0.7, 0.35, 1.75, 0, 12, 0, Math.PI / 2);
  k.cyl('straw', 0.012, 0.012, 1.1, 0, 0.66, 0.0, 5);
  k.box('iron', 0.04, 0.32, 0.04, 1.02, 1.6, 0).box('iron', 0.04, 0.04, 0.22, 1.02, 1.6, 0.1);
  k.cyl('blocks', 1.02, 1.02, 0.1, 0, 0.85, 0, 16);
  k.box('timber', 2.3, 0.08, 0.1, 0, 3.08, 0);
  return k.build();
}

function tent(assets: Assets): THREE.Group {
  const k = new Kit(materials(assets));
  const w = 1.6;
  const h = 1.9;
  const l = 1.8;
  k.poly('canvas', [[-w, 0, -l], [-w, 0, l], [0, h, l], [0, h, -l]], true).poly('canvas', [[w, 0, l], [w, 0, -l], [0, h, -l], [0, h, l]], true);
  k.poly('canvas', [[w, 0, -l], [-w, 0, -l], [0, h, -l]], true);
  // The door flaps, tied back.
  for (const side of [-1, 1]) k.poly('canvas', [[side * w, 0, l], [side * w * 0.5, 0, l + 0.02], [0, h, l]], true);
  for (const z of [-l, l]) k.cyl('timber', 0.035, 0.04, h + 0.3, 0, 0, z, 6);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl('timber', 0.03, 0.03, 0.35, sx * (w + 0.35), 0, sz * l, 5, 0, sx * 0.5);
  k.box('blue', 0.75, 0.13, 1.9, -0.5, 0.03, 0).box('stripe', 0.75, 0.13, 1.9, 0.5, 0.03, 0).box('canvas', w * 2 - 0.2, 0.03, l * 2 - 0.2, 0, 0, 0);
  return k.build();
}

/** Where each crop slot sits inside a vegetable bed, in the bed's own space. */
export const BED_SLOT_AT: [number, number][] = Array.from({ length: BED_SLOTS }, (_, i) => [((i % 3) - 1) * 1.25, i < 3 ? -0.62 : 0.62]);
export const BED_SIZE = { x: 4.1, z: 2.7 };

function vegetableBed(assets: Assets): THREE.Group {
  const k = new Kit(materials(assets));
  // Raised and filled: the scanned soil has its own clods and furrows.
  k.box('soil', BED_SIZE.x, 0.24, BED_SIZE.z, 0, 0, 0);
  for (const sz of [-1, 1]) k.box('planks', BED_SIZE.x + 0.2, 0.3, 0.07, 0, 0, sz * (BED_SIZE.z / 2 + 0.03));
  for (const sx of [-1, 1]) k.box('planks', 0.07, 0.3, BED_SIZE.z, sx * (BED_SIZE.x / 2 + 0.03), 0, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box('timber', 0.1, 0.4, 0.1, sx * (BED_SIZE.x / 2 + 0.03), 0, sz * (BED_SIZE.z / 2 + 0.03));
  // Drills hoed along each row of planting, and a string line on pegs.
  for (const z of [-0.62, 0.62]) for (const dz of [-0.16, 0.16]) k.box('soil', BED_SIZE.x - 0.25, 0.06, 0.16, 0, 0.22, z + dz, 0, 0, 0);
  for (const sx of [-1, 1]) k.box('timber', 0.03, 0.42, 0.03, sx * (BED_SIZE.x / 2 - 0.12), 0.18, 0);
  k.box('canvas', BED_SIZE.x - 0.24, 0.006, 0.006, 0, 0.55, 0);
  return k.build(false);
}

function fence(assets: Assets): THREE.Group {
  const k = new Kit(materials(assets));
  // Split rails nailed to round posts, each post weathered to a point.
  for (const x of [-1.15, 1.15]) k.cyl('timber', 0.055, 0.065, 1.15, x, 0, 0, 7).cyl('timber', 0.005, 0.055, 0.1, x, 1.15, 0, 7);
  for (const y of [0.32, 0.66, 0.98]) k.box('planks', 2.36, 0.1, 0.045, 0, y, 0.06, 0, 0, (y - 0.66) * 0.02);
  for (const x of [-1.15, 1.15]) for (const y of [0.37, 0.71, 1.03]) k.box('iron', 0.018, 0.018, 0.02, x, y, 0.085);
  return k.build();
}

function path(assets: Assets): THREE.Group {
  return new Kit(materials(assets)).box('cobble', 1.45, 0.07, 2.84, 0, 0, 0).build(false);
}

function lantern(assets: Assets): THREE.Group {
  const k = new Kit(materials(assets));
  k.box('timber', 0.12, 2.4, 0.12, 0, 0, 0).box('timber', 0.6, 0.08, 0.08, 0.28, 2.25, 0).box('timber', 0.07, 0.5, 0.07, 0.16, 1.9, 0, 0, 0, -0.7);
  k.add(instantiate(modelOf(assets, 'wild', 'wooden_lantern_01'), 0.85), 0.5, 1.72, 0);
  return k.build();
}

function scarecrow(assets: Assets): THREE.Group {
  const k = new Kit(materials(assets));
  k.cyl('timber', 0.045, 0.05, 2.0, 0, 0, 0, 6).box('timber', 1.5, 0.07, 0.07, 0, 1.5, 0);
  k.cyl('blue', 0.1, 0.36, 0.9, 0, 0.7, 0, 8).cyl('straw', 0.19, 0.17, 0.3, 0, 1.68, 0, 8).cyl('planks', 0.36, 0.36, 0.03, 0, 1.98, 0, 12).cyl('planks', 0.08, 0.2, 0.3, 0, 2.0, 0, 8);
  for (const side of [-1, 1]) k.cyl('straw', 0.02, 0.09, 0.26, side * 0.9, 1.4, 0, 5, 0, side * -Math.PI / 2);
  return k.build();
}

function flowerBed(assets: Assets): THREE.Group {
  const k = new Kit(materials(assets));
  const rand = rng(77);
  k.cyl('soil', 1.25, 1.3, 0.14, 0, 0, 0, 16);
  const rocks = ['rock_moss_set_01_1', 'rock_moss_set_02_3', 'rock_moss_set_01_4', 'rock_moss_set_02_5'];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const stone = instantiate(modelOf(assets, 'wild', rocks[i % rocks.length]!), 0.2 + rand() * 0.1);
    k.add(stone, Math.cos(a) * 1.3, 0, Math.sin(a) * 1.3, rand() * 6);
  }
  const blooms = ['periwinkle_plant_0', 'celandine_01_0', 'dandelion_01_1', 'periwinkle_plant_3', 'celandine_01_2', 'dandelion_01_3', 'periwinkle_plant_5'];
  for (let i = 0; i < 16; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * 0.95;
    k.add(instantiate(modelOf(assets, 'wild', blooms[i % blooms.length]!), 1.5 + rand() * 0.8), Math.cos(a) * r, 0.12, Math.sin(a) * r, rand() * 6);
  }
  return k.build(false);
}

function trough(assets: Assets): THREE.Group {
  const k = new Kit(materials(assets));
  k.box('planks', 1.7, 0.08, 0.7, 0, 0.18, 0);
  for (const sz of [-1, 1]) k.box('planks', 1.7, 0.42, 0.07, 0, 0.18, sz * 0.32);
  for (const sx of [-1, 1]) k.box('planks', 0.07, 0.42, 0.7, sx * 0.82, 0.18, 0);
  k.box('water', 1.56, 0.02, 0.56, 0, 0.5, 0);
  for (const x of [-0.6, 0.6]) k.box('timber', 0.1, 0.2, 0.76, x, 0, 0);
  return k.build();
}

function campfire(assets: Assets): THREE.Group {
  const k = new Kit(materials(assets));
  k.add(instantiate(modelOf(assets, 'wild', 'stone_fire_pit'), 1.0));
  k.cyl('ember', 0.42, 0.42, 0.05, 0, 0.1, 0, 12);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    k.cyl('timber', 0.06, 0.07, 0.75, Math.cos(a) * 0.14, 0.12, Math.sin(a) * 0.14, 6, Math.cos(a) * 0.95, -Math.sin(a) * 0.95);
  }
  return k.build();
}

function cart(assets: Assets): THREE.Group {
  const k = new Kit(materials(assets));
  k.box('planks', 1.1, 0.07, 1.9, 0, 0.62, 0);
  for (const sx of [-1, 1]) k.box('planks', 0.06, 0.4, 1.9, sx * 0.55, 0.62, 0);
  k.box('planks', 1.1, 0.4, 0.06, 0, 0.62, -0.95);
  for (const sx of [-1, 1]) {
    k.cyl('timber', 0.48, 0.48, 0.08, sx * 0.66, 0.5, 0.1, 14, 0, Math.PI / 2);
    k.cyl('iron', 0.08, 0.08, 0.14, sx * 0.72, 0.5, 0.1, 8, 0, Math.PI / 2);
    k.box('timber', 0.06, 0.06, 1.5, sx * 0.45, 0.55, 1.6, 0, 0.12);
  }
  k.box('timber', 0.08, 0.6, 0.08, 0, 0, 1.0);
  return k.build();
}

function hay(assets: Assets): THREE.Group {
  const k = new Kit(materials(assets));
  k.cyl('straw', 0.6, 0.6, 1.15, 0.575, 0.6, 0, 16, 0, Math.PI / 2);
  return k.build();
}

function gazebo(assets: Assets): THREE.Group {
  const k = new Kit(materials(assets));
  k.cyl('planks', 2.5, 2.5, 0.22, 0, 0, 0, 6);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    k.box('timber', 0.16, 2.6, 0.16, Math.cos(a) * 2.2, 0.22, Math.sin(a) * 2.2, -a);
    k.box('timber', 2.3, 0.14, 0.12, Math.cos(a + Math.PI / 6) * 1.95, 2.7, Math.sin(a + Math.PI / 6) * 1.95, -(a + Math.PI / 6) + Math.PI / 2);
  }
  k.cyl('tiles', 0.12, 3.0, 1.7, 0, 2.8, 0, 6);
  return k.build();
}

function market(assets: Assets): THREE.Group {
  const k = new Kit(materials(assets));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box('timber', 0.1, sz > 0 ? 2.1 : 2.5, 0.1, sx * 1.3, 0, sz * 0.8);
  k.box('planks', 2.9, 0.07, 1.4, 0, 0.9, 0.1).box('stripe', 3.1, 0.05, 2.1, 0, 2.3, 0, 0, 0.24);
  k.add(instantiate(modelOf(assets, 'wild', 'wooden_crate_01'), 1.0), -0.6, 0.97, 0.1, 0.3).add(instantiate(modelOf(assets, 'wild', 'wicker_basket_01'), 1.3), 0.7, 0.97, 0.2, 1);
  return k.build();
}

// ---------------------------------------------------------------- furniture ----

function rug(assets: Assets, kind: 'long' | 'square' | 'round'): THREE.Group {
  const k = new Kit(materials(assets));
  if (kind === 'round') k.cyl('stripe', 1.0, 1.0, 0.02, 0, 0, 0, 28);
  else if (kind === 'long') k.box('stripe', 1.5, 0.02, 2.4, 0, 0, 0);
  else k.box('blue', 2.6, 0.02, 2.6, 0, 0, 0);
  return k.build(false);
}

function fireplace(assets: Assets): THREE.Group {
  const k = new Kit(materials(assets));
  k.box('stone', 2.0, 1.35, 0.6, 0, 0, 0).box('dark', 1.1, 0.9, 0.3, 0, 0.12, 0.17).box('ember', 0.8, 0.12, 0.2, 0, 0.12, 0.2);
  k.box('timber', 2.3, 0.14, 0.75, 0, 1.35, 0.02).box('stone', 1.3, 1.6, 0.5, 0, 1.49, -0.05).box('blocks', 2.4, 0.08, 0.5, 0, 0, 0.5);
  return k.build();
}

function tub(assets: Assets): THREE.Group {
  const k = new Kit(materials(assets));
  k.cyl('planks', 0.62, 0.55, 0.7, 0, 0, 0, 16, 0, 0, true).cyl('planks', 0.55, 0.55, 0.06, 0, 0, 0, 16).cyl('water', 0.58, 0.58, 0.02, 0, 0.55, 0, 16);
  for (const y of [0.15, 0.55]) k.cyl('iron', 0.63, 0.61, 0.04, 0, y, 0, 16, 0, 0, true);
  return k.build();
}

function washstand(assets: Assets): THREE.Group {
  const k = new Kit(materials(assets));
  k.box('planks', 1.0, 0.06, 0.55, 0, 0.82, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box('timber', 0.07, 0.82, 0.07, sx * 0.44, 0, sz * 0.22);
  k.box('planks', 0.9, 0.04, 0.45, 0, 0.25, 0);
  k.add(instantiate(modelOf(assets, 'wild', 'wooden_bucket_01'), 0.9), 0, 0.88, 0).add(instantiate(modelOf(assets, 'wild', 'watering_can_metal_01'), 1.0), 0.05, 0.29, 0, 1.2);
  return k.build();
}

function floorLamp(assets: Assets): THREE.Group {
  const k = new Kit(materials(assets));
  k.cyl('iron', 0.16, 0.2, 0.04, 0, 0, 0, 12).cyl('iron', 0.018, 0.018, 1.45, 0, 0.04, 0, 6).cyl('lamp', 0.13, 0.24, 0.3, 0, 1.4, 0, 14, 0, 0, true);
  return k.build();
}

/** Build the visible object for any catalogue shape, at its real size. */
export function shapeObject(assets: Assets, shape: Shape): THREE.Group {
  if ('built' in shape) {
    switch (shape.built) {
      case 'cottage':
        return cottage(assets);
      case 'byre':
        return barn(assets, 6.4, 5.0, 2.7, 1.9, 'tiles', 2);
      case 'coop':
        return coop(assets);
      case 'sty':
        return sty(assets);
      case 'stable':
        return stable(assets);
      case 'well':
        return well(assets);
      case 'tent':
        return tent(assets);
      case 'bed':
        return vegetableBed(assets);
      case 'fence':
        return fence(assets);
      case 'path':
        return path(assets);
      case 'lantern':
        return lantern(assets);
      case 'scarecrow':
        return scarecrow(assets);
      case 'flowerbed':
        return flowerBed(assets);
      case 'trough':
        return trough(assets);
      case 'campfire':
        return campfire(assets);
      case 'cart':
        return cart(assets);
      case 'hay':
        return hay(assets);
      case 'gazebo':
        return gazebo(assets);
      case 'market':
        return market(assets);
      case 'rug_long':
        return rug(assets, 'long');
      case 'rug_square':
        return rug(assets, 'square');
      case 'rug_round':
        return rug(assets, 'round');
      case 'fireplace':
        return fireplace(assets);
      case 'tub':
        return tub(assets);
      case 'washstand':
        return washstand(assets);
      case 'floor_lamp':
        return floorLamp(assets);
    }
  }
  const model = modelOf(assets, shape.pack, shape.model);
  const wrap = new THREE.Group();
  wrap.add(instantiate(model, shape.fit ? fitScale(model, shape.fit) : (shape.scale ?? 1)));
  return wrap;
}

/**
 * Timber scaffolding round a footprint `w` by `d` and `h` high: standards at
 * the corners and every couple of metres, ledgers every metre and a quarter,
 * a few boards to stand on, and a brace or two. For buildings going up.
 */
export function scaffold(assets: Assets, w: number, d: number, h: number): THREE.Group {
  const k = new Kit(materials(assets));
  const hw = w / 2 + 0.45;
  const hd = d / 2 + 0.45;
  const top = h + 0.6;
  const along = (len: number) => Math.max(1, Math.round(len / 2.2));
  for (const [ax, len, fixed] of [
    ['x', hw * 2, hd],
    ['x', hw * 2, -hd],
    ['z', hd * 2, hw],
    ['z', hd * 2, -hw],
  ] as ['x' | 'z', number, number][]) {
    const n = along(len);
    for (let i = 0; i <= n; i++) {
      const t = -len / 2 + (i * len) / n;
      const [x, z] = ax === 'x' ? [t, fixed] : [fixed, t];
      k.cyl('timber', 0.045, 0.05, top, x, 0, z, 6);
    }
    for (let y = 1.2; y < top; y += 1.25) {
      // Cylinders stand on their base and are tipped about it: start them at one end.
      if (ax === 'x') k.cyl('timber', 0.035, 0.035, len, len / 2, y, fixed, 6, 0, Math.PI / 2);
      else k.cyl('timber', 0.035, 0.035, len, fixed, y, -len / 2, 6, Math.PI / 2, 0);
    }
    // One long brace across each face.
    const diag = Math.hypot(len, top);
    const lean = Math.atan2(len, top);
    if (ax === 'x') k.cyl('timber', 0.03, 0.03, diag, -len / 2, 0, fixed, 6, 0, -lean);
    else k.cyl('timber', 0.03, 0.03, diag, fixed, 0, -len / 2, 6, lean, 0);
  }
  for (let y = 1.2; y < top; y += 2.5) {
    k.box('planks', hw * 2, 0.04, 0.32, 0, y + 0.04, hd - 0.1).box('planks', hw * 2, 0.04, 0.32, 0, y + 0.04, -hd + 0.1);
  }
  return k.build(false);
}

/** Recolour everything under `root` with one translucent material, for placement previews. */
export function ghostify(root: THREE.Object3D, material: THREE.Material) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = material;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  });
}

