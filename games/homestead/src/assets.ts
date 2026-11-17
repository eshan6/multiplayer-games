/**
 * Loads what the world is made of, and decides how each thing is drawn.
 *
 * Three sources:
 *
 *   trees      grown at load by world/trees.ts
 *   wild       photoscanned plants, rocks and props (scans.ts)
 *   animals    the rigged, animated animals and the avatars, plus the crops
 *
 * Furniture is a fourth pack, fetched the first time someone goes indoors.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadPack, scanGlass } from './scans';
import { growTrees, type Species } from './world/trees';

import horseUrl from './assets/horse.glb?url';
import cowUrl from './assets/cow.glb?url';
import dogUrl from './assets/dog.glb?url';
import deerUrl from './assets/deer.glb?url';
import foxUrl from './assets/fox.glb?url';
import pigUrl from './assets/pig.glb?url';
import cropsUrl from './assets/crops.glb?url';

/** Shared by every material that moves with the wind. */
export const wind = {
  uTime: { value: 0 },
  uStrength: { value: 1 },
};

function fromBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function bytes(url: string): Promise<ArrayBuffer> {
  if (url.startsWith('data:')) return fromBase64(url.slice(url.indexOf(',') + 1));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url}: ${res.status}`);
  // The published page's host serves text and images but not .glb, so
  // tools/pack_for_page.mjs ships each model as base64 in a .txt beside it.
  if (/\.txt(\?|$)/.test(url)) return fromBase64(await res.text());
  return res.arrayBuffer();
}

const gltfLoader = new GLTFLoader();
async function loadGltf(url: string): Promise<GLTF> {
  return gltfLoader.parseAsync(await bytes(url), '');
}

/** One drawable piece of a model: a geometry and the material it wants. */
export interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  castShadow: boolean;
}

export interface Model {
  name: string;
  parts: Part[];
  /** Size of the model at scale 1, for placement decisions. */
  size: THREE.Vector3;
}

export interface Animated {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
}

export type Pack = 'tree' | 'wild' | 'crops' | 'home';

export interface Assets {
  tree: Map<string, Model>;
  wild: Map<string, Model>;
  crops: Map<string, Model>;
  /** Furniture. Empty until `loadHome` has resolved. */
  home: Map<string, Model>;
  horse: Animated;
  cow: Animated;
  dog: Animated;
  deer: Animated;
  fox: Animated;
  pig: Animated;
  /** Cottage windows: lit from dusk. */
  windowGlow: THREE.MeshStandardMaterial;
  /** Lantern panes and lampshades: lit after dark. */
  lampGlow: THREE.MeshStandardMaterial;
  /** Leaf materials by species, so the seasons can recolour the woods. */
  foliage: Record<Species, THREE.MeshStandardMaterial>;
}

/** Find a model by name, or fail loudly: a typo in the catalogue should not be a silent gap. */
export function modelOf(assets: Assets, pack: Pack, name: string): Model {
  const found = assets[pack].get(name);
  if (!found) throw new Error(`no model "${name}" in ${pack}`);
  return found;
}

/** Fetch the furniture. Safe to call more than once. */
export async function loadHome(assets: Assets): Promise<void> {
  if (assets.home.size) return;
  for (const [name, model] of await loadPack('home')) assets.home.set(name, model);
}

/**
 * The animal and crop kits are low-polygon models shaded flat, which reads as
 * a toy next to scanned grass. Welding their vertices and recomputing normals
 * makes each a smooth form, and a physically based material lets the sky
 * light it like everything else.
 */
function smooth(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  // The kits are stored quantised and interleaved; welding needs plain arrays.
  // Normalised integers become floats; true integers (bone indices) keep their type.
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geometry.attributes)) {
    if (name === 'normal') continue;
    const integer = !attr.normalized && !(attr.array instanceof Float32Array);
    const Ctor = integer ? (attr.array.constructor as new (n: number) => THREE.TypedArray) : Float32Array;
    const out = new Ctor(attr.count * attr.itemSize);
    for (let i = 0; i < attr.count; i++) for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c);
    g.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
  }
  if (geometry.index) g.setIndex(geometry.index.clone());
  for (const group of geometry.groups) g.addGroup(group.start, group.count, group.materialIndex);
  const merged = mergeVertices(g, 1e-4);
  merged.computeVertexNormals();
  return merged;
}

function skinMaterials(overrides: Record<string, number> = {}) {
  const cache = new Map<string, THREE.MeshStandardMaterial>();
  return (name: string, colour: THREE.Color): THREE.MeshStandardMaterial => {
    let m = cache.get(name);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: colour.clone(), name, roughness: 0.82, metalness: 0 });
      const override = overrides[name];
      if (override !== undefined) m.color.setHex(override);
      cache.set(name, m);
    }
    return m;
  };
}

function prepareAnimated(gltf: GLTF, overrides: Record<string, number> = {}): Animated {
  const material = skinMaterials(overrides);
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    const src = mesh.material as THREE.MeshStandardMaterial;
    mesh.material = material(src.name, src.color);
    mesh.geometry = smooth(mesh.geometry);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Skinned bounds come from the rest pose; a galloping horse leaves them.
    mesh.frustumCulled = false;
  });
  return { scene: gltf.scene, clips: gltf.animations };
}

/** Read the crops pack: tagged, single-material pieces (see tools/build_static_assets.py). */
function cropModels(gltf: GLTF): Map<string, Model> {
  const material = skinMaterials();
  const groups = new Map<string, Part[]>();
  gltf.scene.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const tag = mesh.userData as { model?: string; material?: string; colour?: number[] };
    if (!tag.model || !tag.material) return;
    const pos = mesh.geometry.getAttribute('position');
    const p = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).toArray(p, i * 3);
    const baked = new THREE.BufferGeometry();
    baked.setAttribute('position', new THREE.BufferAttribute(p, 3));
    if (mesh.geometry.index) baked.setIndex(mesh.geometry.index);
    const geometry = mergeVertices(baked, 1e-4);
    geometry.computeVertexNormals();
    const c = tag.colour ?? [1, 1, 1];
    const part: Part = { geometry, material: material(tag.material, new THREE.Color(c[0] ?? 1, c[1] ?? 1, c[2] ?? 1)), castShadow: true };
    const list = groups.get(tag.model);
    if (list) list.push(part);
    else groups.set(tag.model, [part]);
  });
  const out = new Map<string, Model>();
  for (const [name, parts] of groups) {
    const box = new THREE.Box3();
    for (const part of parts) {
      part.geometry.computeBoundingBox();
      box.union(part.geometry.boundingBox!);
    }
    out.set(name, { name, parts, size: box.getSize(new THREE.Vector3()) });
  }
  return out;
}

export async function loadAssets(onProgress: (done: number, total: number) => void): Promise<Assets> {
  let done = 0;
  const jobs: Promise<unknown>[] = [];
  const track = <T>(p: Promise<T>): Promise<T> => {
    jobs.push(p);
    p.then(() => onProgress(++done, jobs.length));
    return p;
  };
  const glb = {
    crops: track(loadGltf(cropsUrl)),
    horse: track(loadGltf(horseUrl)),
    cow: track(loadGltf(cowUrl)),
    dog: track(loadGltf(dogUrl)),
    deer: track(loadGltf(deerUrl)),
    fox: track(loadGltf(foxUrl)),
    pig: track(loadGltf(pigUrl)),
  };
  const wild = track(loadPack('wild'));
  onProgress(0, jobs.length);

  const forest = growTrees();
  const assets: Assets = {
    tree: forest.models,
    wild: await wild,
    crops: cropModels(await glb.crops),
    home: new Map(),
    horse: prepareAnimated(await glb.horse),
    cow: prepareAnimated(await glb.cow),
    dog: prepareAnimated(await glb.dog),
    deer: prepareAnimated(await glb.deer),
    fox: prepareAnimated(await glb.fox),
    pig: prepareAnimated(await glb.pig, { 'Material.003': 0xe7a9a2, Material: 0x8a5a4a }),
    windowGlow: new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: 0.12, metalness: 0, emissive: 0xffb45e, emissiveIntensity: 0 }),
    lampGlow: scanGlass,
    foliage: forest.leaves,
  };
  await Promise.all(jobs);
  return assets;
}

// Avatars are fetched only when somebody is wearing them: six would add five
// megabytes to every visit, and a session needs two.
const AVATAR_URLS = import.meta.glob('./assets/avatar_*.glb', { query: '?url', import: 'default' }) as Record<string, () => Promise<string>>;
const avatarCache = new Map<string, Promise<Animated>>();

export function loadAvatar(id: string): Promise<Animated> {
  let pending = avatarCache.get(id);
  if (!pending) {
    const url = AVATAR_URLS[`./assets/avatar_${id}.glb`];
    if (!url) return Promise.reject(new Error(`no avatar "${id}"`));
    pending = url()
      .then(loadGltf)
      .then((gltf) => prepareAnimated(gltf));
    avatarCache.set(id, pending);
  }
  return pending;
}
