/**
 * Turning a catalogue entry into something you can see.
 *
 * Most things are a model from one of the kits, scaled to a sensible size.
 * A few — the tent, a vegetable bed, a lantern — are simple enough to build
 * here from boxes and cones, which keeps them out of the download.
 */
import * as THREE from 'three';
import { modelOf, type Assets, type Model } from '../assets';
import { BED_SLOTS, type Shape } from '../game/catalog';
import { rng } from '../noise';

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

const mat = (color: number, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
const M = {
  canvas: mat(0xe8dcc0, { side: THREE.DoubleSide }),
  canvasDark: mat(0xb9a988, { side: THREE.DoubleSide }),
  wood: mat(0x7a5236),
  woodPale: mat(0xa9805a),
  soil: mat(0x5a3f2c),
  soilWet: mat(0x3d2a1e),
  stone: mat(0xa9a59a, { flatShading: true }),
  straw: mat(0xd9bd62),
  cloth: mat(0x7d94a8),
  iron: mat(0x3a3836),
  water: mat(0x6fb7c4),
};

function box(w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function tent(): THREE.Group {
  const g = new THREE.Group();
  const w = 1.5;
  const h = 1.85;
  const l = 1.7;
  // Two sloping canvas walls and a closed back, as one piece of cloth.
  const v = new Float32Array([
    -w, 0, -l, 0, h, -l, -w, 0, l, 0, h, -l, 0, h, l, -w, 0, l, // left slope
    w, 0, -l, w, 0, l, 0, h, -l, 0, h, -l, w, 0, l, 0, h, l, // right slope
    -w, 0, -l, w, 0, -l, 0, h, -l, // back
  ]);
  const cloth = new THREE.BufferGeometry();
  cloth.setAttribute('position', new THREE.BufferAttribute(v, 3));
  cloth.computeVertexNormals();
  const shell = new THREE.Mesh(cloth, M.canvas);
  shell.castShadow = true;
  shell.receiveShadow = true;
  // The front: two flaps tied back from the opening.
  const flap = (side: number) => {
    const f = new THREE.BufferGeometry();
    f.setAttribute('position', new THREE.BufferAttribute(new Float32Array([side * w, 0, l, side * w * 0.55, 0, l, 0, h, l]), 3));
    f.computeVertexNormals();
    const m = new THREE.Mesh(f, M.canvasDark);
    m.castShadow = true;
    return m;
  };
  const pole = (z: number) => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, h + 0.25, 6), M.wood);
    p.position.set(0, (h + 0.25) / 2, z);
    p.castShadow = true;
    return p;
  };
  const bedroll = box(0.7, 0.14, 1.9, M.cloth, -0.45, 0.02, 0);
  const bedroll2 = box(0.7, 0.14, 1.9, mat(0xa86a5a), 0.45, 0.02, 0);
  g.add(shell, flap(1), flap(-1), pole(l), pole(-l), bedroll, bedroll2, box(w * 2 - 0.1, 0.03, l * 2 - 0.1, M.canvasDark));
  return g;
}

/** Where each crop slot sits inside a vegetable bed, in the bed's own space. */
export const BED_SLOT_AT: [number, number][] = Array.from({ length: BED_SLOTS }, (_, i) => [((i % 3) - 1) * 1.25, i < 3 ? -0.62 : 0.62]);
export const BED_SIZE = { x: 4.1, z: 2.7 };

function vegetableBed(): THREE.Group {
  const g = new THREE.Group();
  const rand = rng(31);
  // Raised rows of earth, with a plank edge.
  for (let r = 0; r < 4; r++) {
    const z = (r - 1.5) * 0.6;
    const row = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, BED_SIZE.x - 0.3, 5, 1, false, 0, Math.PI), M.soil);
    row.rotation.z = Math.PI / 2;
    row.rotation.y = Math.PI;
    row.rotation.x = -Math.PI / 2;
    row.position.set(0, 0.03 + rand() * 0.02, z);
    row.receiveShadow = true;
    g.add(row);
  }
  g.add(box(BED_SIZE.x, 0.05, BED_SIZE.z, M.soil, 0, 0, 0));
  g.add(box(BED_SIZE.x + 0.16, 0.2, 0.08, M.woodPale, 0, 0, BED_SIZE.z / 2), box(BED_SIZE.x + 0.16, 0.2, 0.08, M.woodPale, 0, 0, -BED_SIZE.z / 2));
  g.add(box(0.08, 0.2, BED_SIZE.z, M.woodPale, BED_SIZE.x / 2, 0, 0), box(0.08, 0.2, BED_SIZE.z, M.woodPale, -BED_SIZE.x / 2, 0, 0));
  return g;
}

function lantern(assets: Assets): THREE.Group {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.3, 6), M.wood);
  post.position.y = 1.15;
  post.castShadow = true;
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.24), assets.lampGlow);
  lamp.position.set(0.42, 1.98, 0);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.14, 4), M.iron);
  cap.position.set(0.42, 2.2, 0);
  cap.rotation.y = Math.PI / 4;
  g.add(post, box(0.5, 0.05, 0.05, M.wood, 0.22, 2.24, 0), lamp, cap, box(0.26, 0.03, 0.26, M.iron, 0.42, 1.8, 0));
  return g;
}

function scarecrow(): THREE.Group {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 2.0, 6), M.wood);
  post.position.y = 1;
  post.castShadow = true;
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.9, 7), M.cloth);
  body.position.y = 1.15;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.19, 1), M.straw);
  head.position.y = 1.86;
  head.castShadow = true;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 10), M.woodPale);
  brim.position.y = 2.0;
  const crown = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.3, 8), M.woodPale);
  crown.position.y = 2.15;
  g.add(post, box(1.5, 0.07, 0.07, M.wood, 0, 1.5, 0), body, head, brim, crown);
  for (const side of [-1, 1]) {
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 5), M.straw);
    tuft.position.set(side * 0.78, 1.53, 0);
    tuft.rotation.z = side * -Math.PI / 2;
    g.add(tuft);
  }
  return g;
}

function flowerBed(assets: Assets): THREE.Group {
  const g = new THREE.Group();
  const rand = rng(77);
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.3, 0.12, 14), M.soil);
  soil.position.y = 0.06;
  soil.receiveShadow = true;
  g.add(soil);
  const stone = new THREE.DodecahedronGeometry(0.17, 0);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const s = new THREE.Mesh(stone, M.stone);
    s.position.set(Math.cos(a) * 1.3, 0.08, Math.sin(a) * 1.3);
    s.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    s.scale.setScalar(0.8 + rand() * 0.5);
    g.add(s);
  }
  const kinds = ['Flower_1_Clump', 'Flower_2_Clump', 'Flower_3_Clump', 'Flower_4_Clump', 'Flower_5_Clump'];
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * 0.95;
    const f = instantiate(modelOf(assets, 'nature', kinds[i % kinds.length]!), 1.1 + rand() * 0.5);
    f.position.set(Math.cos(a) * r, 0.1, Math.sin(a) * r);
    f.rotation.y = rand() * Math.PI * 2;
    g.add(f);
  }
  return g;
}

function trough(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(1.7, 0.1, 0.7, M.wood, 0, 0.18, 0));
  g.add(box(1.7, 0.42, 0.08, M.woodPale, 0, 0.18, 0.31), box(1.7, 0.42, 0.08, M.woodPale, 0, 0.18, -0.31));
  g.add(box(0.08, 0.42, 0.7, M.woodPale, 0.81, 0.18, 0), box(0.08, 0.42, 0.7, M.woodPale, -0.81, 0.18, 0));
  const w = box(1.56, 0.03, 0.56, M.water, 0, 0.5, 0);
  w.castShadow = false;
  g.add(w);
  for (const x of [-0.6, 0.6]) g.add(box(0.1, 0.2, 0.74, M.wood, x, 0, 0));
  return g;
}

/** A patch of darkened earth shown under a crop that has been watered. */
export function wetPatch(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CircleGeometry(0.5, 12), M.soilWet);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.34;
  return m;
}

/** Build the visible object for any catalogue shape, at its real size. */
export function shapeObject(assets: Assets, shape: Shape): THREE.Group {
  if ('built' in shape) {
    switch (shape.built) {
      case 'tent':
        return tent();
      case 'bed':
        return vegetableBed();
      case 'lantern':
        return lantern(assets);
      case 'scarecrow':
        return scarecrow();
      case 'flowerbed':
        return flowerBed(assets);
      case 'trough':
        return trough();
    }
  }
  const model = modelOf(assets, shape.pack, shape.model);
  const wrap = new THREE.Group();
  wrap.add(instantiate(model, shape.fit ? fitScale(model, shape.fit) : (shape.scale ?? 1)));
  return wrap;
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
