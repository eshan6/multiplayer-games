/**
 * Photoscanned materials and models (Poly Haven, CC0), and how they are drawn.
 *
 * Everything here is physically based: a colour map, a normal map, and one
 * texture packing ambient occlusion, roughness and metalness. Lit by the sky
 * and the sun, that is most of what makes a surface read as real.
 *
 * Two kinds of thing come out of this file:
 *
 *   surface(name)   a tiling material — plaster, roof tiles, floorboards — for
 *                   whatever the game builds out of boxes and planes
 *   loadPack(name)  a set of scanned models: plants, rocks, props, furniture
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { wind, type Model, type Part } from './assets';

import wildUrl from './assets/scan/scan_wild.glb?url';

const TEXTURES = import.meta.glob('./assets/scan/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const HOME_PACK = () => import('./assets/scan/scan_home.glb?url').then((m) => m.default);

/** How sharp textures stay at glancing angles. Set once the renderer exists. */
let anisotropy = 8;
export function setAnisotropy(n: number) {
  anisotropy = n;
}

const textureCache = new Map<string, { tex: THREE.Texture; ready: Promise<THREE.Texture> }>();
const pending = new Set<Promise<unknown>>();

/**
 * A texture, and a promise of it with its image loaded. Materials take a
 * texture only once it is ready: an empty texture samples as black, which
 * would show as a black surface (and, as an occlusion map, a black shadow)
 * for the moment the image takes to arrive.
 */
function texture(file: string, colour: boolean, repeat: boolean): { tex: THREE.Texture; ready: Promise<THREE.Texture> } | null {
  const url = TEXTURES[`./assets/scan/${file}.webp`];
  if (!url) return null;
  const key = `${file}|${repeat}`;
  const cached = textureCache.get(key);
  if (cached) return cached;
  const tex = new THREE.Texture();
  tex.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.flipY = false;
  tex.anisotropy = anisotropy;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const ready = new Promise<THREE.Texture>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      tex.image = img;
      tex.needsUpdate = true;
      resolve(tex);
    };
    img.onerror = () => reject(new Error(`Could not load ${file}`));
    img.src = url;
  });
  pending.add(ready);
  void ready.catch(() => undefined).finally(() => pending.delete(ready));
  const entry = { tex, ready };
  textureCache.set(key, entry);
  return entry;
}

/**
 * The grass card atlas (tools/build_grass_atlas.py): eight painted clumps of
 * blades, colour in RGB and coverage in alpha. Clamped, not tiled, so mip
 * levels do not bleed one card's roots into the next card's tips.
 */
export function grassCards(): { tex: THREE.Texture; ready: Promise<THREE.Texture> } {
  const entry = texture('grass_cards', true, false);
  if (!entry) throw new Error('grass_cards.webp is missing from src/assets/scan');
  return entry;
}

/** Resolves once every texture asked for so far has arrived (or `ms` has passed). */
export function texturesReady(ms = 20000): Promise<void> {
  const all = Promise.allSettled([...pending]).then(() => undefined);
  return Promise.race([all, new Promise<void>((r) => setTimeout(r, ms))]);
}

export interface PbrOptions {
  /** Multiplies the colour map. sRGB hex. */
  tint?: number;
  /** Tiles: for surfaces rather than unwrapped models. */
  repeat?: boolean;
  /** Leaves and blades: drawn from both sides, swaying, with the atlas's black background cut away. */
  foliage?: boolean;
  /** How strongly the normal map shows. */
  relief?: number;
  roughness?: number;
  metalness?: number;
  /** A private copy, not shared with anything else using the same textures (so it can be recoloured). */
  own?: string;
}

const materialCache = new Map<string, THREE.MeshStandardMaterial>();

/** A physically based material from a texture set named `key`. */
export function pbr(key: string, opts: PbrOptions = {}): THREE.MeshStandardMaterial {
  const id = `${key}|${JSON.stringify(opts)}`;
  const cached = materialCache.get(id);
  if (cached) return cached;
  const arm = texture(`${key}_arm`, false, !!opts.repeat);
  const normal = texture(`${key}_nor`, false, !!opts.repeat);
  const colour = texture(`${key}_diff`, true, !!opts.repeat);
  const m = new THREE.MeshStandardMaterial({
    name: key,
    color: opts.tint ?? 0xffffff,
    roughness: opts.roughness ?? 1,
    // Until the maps arrive: a plain, unshiny surface. The metalness map is
    // black for everything but metal, so 1 then lets it decide.
    metalness: 0,
    side: opts.foliage ? THREE.DoubleSide : THREE.FrontSide,
  });
  void colour?.ready.then((t) => {
    m.map = t;
    m.needsUpdate = true;
  });
  void normal?.ready.then((t) => {
    m.normalMap = t;
    m.normalScale.setScalar(opts.relief ?? 1);
    m.needsUpdate = true;
  });
  void arm?.ready.then((t) => {
    m.aoMap = t;
    m.roughnessMap = t;
    if (!opts.foliage) {
      m.metalnessMap = t;
      m.metalness = opts.metalness ?? 1;
    }
    m.needsUpdate = true;
  });
  if (opts.foliage) foliage(m);
  materialCache.set(id, m);
  return m;
}

/** The raw maps of a tiling surface, for shaders that blend several (the terrain). */
export function surfaceMaps(name: string): { diff: THREE.Texture; nor: THREE.Texture; arm: THREE.Texture } {
  const get = (tag: string, colour: boolean) => {
    const t = texture(`surface_${name}_${tag}`, colour, true);
    if (!t) throw new Error(`no surface texture ${name}_${tag}`);
    return t.tex;
  };
  return { diff: get('diff', true), nor: get('nor', false), arm: get('arm', false) };
}

/** A tiling surface. One `uv` unit is one repeat of the texture. */
export function surface(name: string, opts: PbrOptions = {}): THREE.MeshStandardMaterial {
  return pbr(`surface_${name}`, { ...opts, repeat: true });
}

/**
 * Make a scanned plant behave like one: sway in the wind, be lit softly from
 * both sides, and drop the atlas background where a simplified leaf's edge
 * strays onto it.
 */
function foliage(m: THREE.MeshStandardMaterial) {
  m.metalness = 0;
  m.metalnessMap = null;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = wind.uTime;
    shader.uniforms.uStrength = wind.uStrength;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uStrength;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vec3 root = instanceMatrix[3].xyz;
          #else
            vec3 root = modelMatrix[3].xyz;
          #endif
          float h = max(position.y, 0.0);
          float phase = uTime * 1.6 + root.x * 0.7 + root.z * 0.6;
          float lean = (sin(phase) + 0.4 * sin(phase * 2.7 + 1.3)) * 0.09 * h * uStrength;
          transformed.x += lean;
          transformed.z += lean * 0.6;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      /* glsl */ `#include <map_fragment>
      // The plant atlases have a black background and no alpha channel.
      if (max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)) < 0.035) discard;`,
    );
  };
  m.customProgramCacheKey = () => 'scan-foliage';
}

const loader = new GLTFLoader();

async function bytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url}: ${res.status}`);
  // See tools/pack_for_page.mjs: the published page ships models as base64 text.
  if (/\.txt(\?|$)/.test(url)) {
    const bin = atob(await res.text());
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  return res.arrayBuffer();
}

const glass = new THREE.MeshStandardMaterial({ color: 0xffe2b0, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.35, emissive: 0xffb45e, emissiveIntensity: 0 });
/** Lantern and lamp glass: the game lights these after dark. */
export const scanGlass = glass;

/** Names of the plants in the packs, whose materials sway and are double-sided. */
const FOLIAGE = /^(grass_|fern_|dandelion_|celandine_|periwinkle_|nettle_|weed_|shrub_|potted_plant)/;

const packs = new Map<string, Promise<Map<string, Model>>>();

/** Load a pack of scanned models. Each call after the first returns the same promise. */
export function loadPack(name: 'wild' | 'home'): Promise<Map<string, Model>> {
  let pending = packs.get(name);
  if (!pending) {
    pending = (name === 'wild' ? Promise.resolve(wildUrl) : HOME_PACK()).then(bytes).then((buf) => loader.parseAsync(buf, '')).then((gltf) => {
      const groups = new Map<string, Part[]>();
      gltf.scene.updateMatrixWorld(true);
      const v = new THREE.Vector3();
      const nm = new THREE.Matrix3();
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        // The model tag sits on the node; a multi-material mesh is a group of meshes under it.
        let tagged: THREE.Object3D | null = mesh;
        while (tagged && !tagged.userData.model) tagged = tagged.parent;
        const model = tagged?.userData.model as string | undefined;
        if (!model) return;
        const src = mesh.geometry;
        // Bake the node transform (and the quantisation the pack is stored with) into plain floats.
        const geometry = new THREE.BufferGeometry();
        const pos = src.getAttribute('position');
        const p = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).toArray(p, i * 3);
        geometry.setAttribute('position', new THREE.BufferAttribute(p, 3));
        const nor = src.getAttribute('normal');
        if (nor) {
          nm.getNormalMatrix(mesh.matrixWorld);
          const n = new Float32Array(nor.count * 3);
          for (let i = 0; i < nor.count; i++) v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize().toArray(n, i * 3);
          geometry.setAttribute('normal', new THREE.BufferAttribute(n, 3));
        }
        const uv = src.getAttribute('uv');
        if (uv) {
          const t = new Float32Array(uv.count * 2);
          for (let i = 0; i < uv.count; i++) {
            t[i * 2] = uv.getX(i);
            t[i * 2 + 1] = uv.getY(i);
          }
          geometry.setAttribute('uv', new THREE.BufferAttribute(t, 2));
        }
        if (src.index) geometry.setIndex(src.index);
        const key = (mesh.material as THREE.Material).name;
        const leafy = FOLIAGE.test(model);
        const material = key === 'glass' ? glass : pbr(key, { foliage: leafy });
        const part: Part = { geometry, material, castShadow: key !== 'glass' && !/^(grass_|dandelion_|celandine_|weed_)/.test(model) };
        const list = groups.get(model);
        if (list) list.push(part);
        else groups.set(model, [part]);
      });
      const out = new Map<string, Model>();
      for (const [model, parts] of groups) {
        // Stand every model on the origin, centred on its own footprint.
        const box = new THREE.Box3();
        for (const part of parts) {
          part.geometry.computeBoundingBox();
          box.union(part.geometry.boundingBox!);
        }
        const c = box.getCenter(new THREE.Vector3());
        for (const part of parts) {
          part.geometry.translate(-c.x, -box.min.y, -c.z);
          part.geometry.computeBoundingBox();
          part.geometry.computeBoundingSphere();
        }
        out.set(model, { name: model, parts, size: box.getSize(new THREE.Vector3()) });
      }
      return out;
    });
    packs.set(name, pending);
  }
  return pending;
}
