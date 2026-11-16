/**
 * Loads every model and texture, and decides how each one is drawn.
 *
 * The GLBs carry geometry and material *names* only (see tools/). This file is
 * where a name becomes a look: which leaves get which texture and tint, which
 * surfaces sway in the wind, which windows glow after dark.
 *
 * Loading goes through `bytes()` rather than letting the loaders fetch, because
 * the single-file build inlines every asset as a data: URI and a strict page
 * CSP may refuse to `fetch()` those. Decoding them by hand works everywhere.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';

import natureUrl from './assets/nature.glb?url';
import propsUrl from './assets/props.glb?url';
import horseUrl from './assets/horse.glb?url';
import cowUrl from './assets/cow.glb?url';
import dogUrl from './assets/dog.glb?url';
import deerUrl from './assets/deer.glb?url';
import riderUrl from './assets/rider.glb?url';

import leavesNormalUrl from './assets/leaves_normal.webp?url';
import leavesBirchUrl from './assets/leaves_birch.webp?url';
import leavesMapleUrl from './assets/leaves_maple.webp?url';
import leavesPineUrl from './assets/leaves_pine.webp?url';
import leavesBushUrl from './assets/leaves_bush.webp?url';
import flowersUrl from './assets/flowers.webp?url';
import barkNormalUrl from './assets/bark_normal.webp?url';
import barkBirchUrl from './assets/bark_birch.webp?url';
import barkMapleUrl from './assets/bark_maple.webp?url';
import barkPineUrl from './assets/bark_pine.webp?url';

/** Shared by every material that moves with the wind. */
export const wind = {
  uTime: { value: 0 },
  uStrength: { value: 1 },
};

async function bytes(url: string): Promise<ArrayBuffer> {
  if (url.startsWith('data:')) {
    const b64 = url.slice(url.indexOf(',') + 1);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url}: ${res.status}`);
  return res.arrayBuffer();
}

const gltfLoader = new GLTFLoader();
async function loadGltf(url: string): Promise<GLTF> {
  return gltfLoader.parseAsync(await bytes(url), '');
}

function loadTexture(url: string, repeat = false): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false; // glTF convention
      tex.anisotropy = 4;
      if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.needsUpdate = true;
      resolve(tex);
    };
    img.onerror = () => reject(new Error('Could not decode a texture'));
    img.src = url;
  });
}

/** One drawable piece of a model: a geometry and the material it wants. */
export interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Leaves and flowers do not block a horse; trunks and rocks do. */
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

export interface Assets {
  nature: Map<string, Model>;
  props: Map<string, Model>;
  horse: Animated;
  cow: Animated;
  dog: Animated;
  deer: Animated;
  rider: Animated;
  /** Materials whose glow follows the hour (cottage windows, the fire). */
  windowGlow: THREE.MeshLambertMaterial;
  fireGlow: THREE.MeshBasicMaterial;
}

/**
 * Leaf tints, sRGB. The leaf textures are flat shapes; all colour comes from
 * here, which is exactly the hook the seasons will pull on later.
 */
const LEAF_TINT = {
  normal: 0x6fb03c,
  birch: 0xa3cc58,
  maple: 0x67b045,
  // The pine sheet keeps its own colours (needles and twig); this only cools them.
  pine: 0x9fcf9a,
  bush: 0x69aa3c,
};

/** Adds wind sway to a material that draws foliage. */
function sway(material: THREE.Material, amount: number, flutter: number) {
  material.onBeforeCompile = (shader) => {
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
          float phase = uTime * 1.25 + root.x * 0.31 + root.z * 0.27;
          // The whole crown leans and recovers…
          float lean = (sin(phase) + 0.45 * sin(phase * 2.3 + 1.7)) * ${amount.toFixed(4)} * h * uStrength;
          transformed.x += lean;
          transformed.z += lean * 0.55;
          // …while individual leaves shiver on top of it.
          float f = sin(uTime * 3.1 + position.x * 5.0 + position.y * 4.0 + position.z * 5.0 + root.x) * ${flutter.toFixed(4)} * uStrength;
          transformed += normal * f;
        }`,
      );
  };
  material.customProgramCacheKey = () => `sway:${amount}:${flutter}`;
}

/**
 * Foliage cards are flat; lit with their real normals a tree looks like a pile
 * of playing cards. Pointing every normal outward from the middle of the crown
 * shades the canopy as one soft, rounded mass instead.
 */
function roundNormals(geometry: THREE.BufferGeometry, upBias: number) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const centre = box.getCenter(new THREE.Vector3());
  centre.y = THREE.MathUtils.lerp(box.min.y, box.max.y, 0.35);
  const reach = box.getSize(new THREE.Vector3()).length() * 0.5 || 1;
  const pos = geometry.getAttribute('position');
  const normals = new Float32Array(pos.count * 3);
  const shade = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).sub(centre);
    // Leaves deep inside the crown and low down sit in the canopy's own
    // shade. Baking that in is what gives a tree volume when the sun is flat.
    const outward = THREE.MathUtils.smoothstep(v.length() / reach, 0.15, 0.8);
    const high = THREE.MathUtils.smoothstep(pos.getY(i), box.min.y, box.max.y);
    const s = THREE.MathUtils.lerp(0.58, 1.06, outward * 0.65 + high * 0.35);
    shade[i * 3] = shade[i * 3 + 1] = shade[i * 3 + 2] = s;
    v.normalize();
    v.y += upBias;
    v.normalize();
    normals[i * 3] = v.x;
    normals[i * 3 + 1] = v.y;
    normals[i * 3 + 2] = v.z;
  }
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(shade, 3));
}

function foliageMaterial(map: THREE.Texture, tint: number, amount: number, flutter: number) {
  const m = new THREE.MeshLambertMaterial({
    map,
    color: tint,
    vertexColors: true,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    // With MSAA on, this turns the hard cut-out edge of every leaf into a smooth one.
    alphaToCoverage: true,
  });
  sway(m, amount, flutter);
  // Both faces of a leaf card share the rounded normal: do not flip it for back faces.
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    base.call(m, shader, renderer);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
      // Sample a sharper mip than the GPU would pick. A leaf sheet averaged
      // down to a few texels has soft, low alpha everywhere, and cutting that
      // at a threshold turns distant crowns blocky.
      .replace('#include <map_fragment>', 'diffuseColor *= texture2D(map, vMapUv, -1.2);');
  };
  m.customProgramCacheKey = () => `foliage:${amount}:${flutter}`;
  return m;
}

/** One single-material piece of a model, as tagged by the Blender export. */
interface Piece {
  model: string;
  material: string;
  /** Base colour, linear RGB. */
  colour: THREE.Color;
  geometry: THREE.BufferGeometry;
}

/**
 * Read every piece out of a static GLB as plain float geometry in the model's
 * own space, grouped by the model it belongs to.
 *
 * The GLBs are quantised: positions are 16-bit integers and the node above
 * them carries the transform that turns them back into metres. Instancing
 * wants neither, so that transform is baked in here once.
 */
function piecesOf(gltf: GLTF): Map<string, Piece[]> {
  const out = new Map<string, Piece[]>();
  gltf.scene.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const tag = mesh.userData as { model?: string; material?: string; colour?: number[] };
    if (!tag.model || !tag.material) throw new Error(`untagged mesh in asset: ${mesh.name}`);
    const src = mesh.geometry;
    const geometry = new THREE.BufferGeometry();
    const pos = src.getAttribute('position');
    const outPos = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      outPos[i * 3] = v.x;
      outPos[i * 3 + 1] = v.y;
      outPos[i * 3 + 2] = v.z;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
    const nor = src.getAttribute('normal');
    if (nor) {
      normalMatrix.getNormalMatrix(mesh.matrixWorld);
      const outNor = new Float32Array(nor.count * 3);
      for (let i = 0; i < nor.count; i++) {
        v.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
        outNor[i * 3] = v.x;
        outNor[i * 3 + 1] = v.y;
        outNor[i * 3 + 2] = v.z;
      }
      geometry.setAttribute('normal', new THREE.BufferAttribute(outNor, 3));
    }
    const uv = src.getAttribute('uv');
    if (uv) {
      const outUv = new Float32Array(uv.count * 2);
      for (let i = 0; i < uv.count; i++) {
        outUv[i * 2] = uv.getX(i);
        outUv[i * 2 + 1] = uv.getY(i);
      }
      geometry.setAttribute('uv', new THREE.BufferAttribute(outUv, 2));
    }
    if (src.index) geometry.setIndex(src.index);
    const c = tag.colour ?? [1, 1, 1];
    const piece: Piece = {
      model: tag.model,
      material: tag.material,
      colour: new THREE.Color(c[0] ?? 1, c[1] ?? 1, c[2] ?? 1),
      geometry,
    };
    const list = out.get(tag.model);
    if (list) list.push(piece);
    else out.set(tag.model, [piece]);
  });
  return out;
}

function sizeOf(parts: Part[]): THREE.Vector3 {
  const box = new THREE.Box3();
  for (const p of parts) {
    p.geometry.computeBoundingBox();
    box.union(p.geometry.boundingBox!);
  }
  return box.getSize(new THREE.Vector3());
}

/** Flat Lambert colours, one shared material per name. Overrides are sRGB hex. */
function palette(overrides: Record<string, number> = {}) {
  const cache = new Map<string, THREE.MeshLambertMaterial>();
  return (name: string, colour: THREE.Color): THREE.MeshLambertMaterial => {
    let m = cache.get(name);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: colour.clone(), name });
      const override = overrides[name];
      if (override !== undefined) m.color.setHex(override);
      cache.set(name, m);
    }
    return m;
  };
}

function prepareAnimated(gltf: GLTF, overrides: Record<string, number> = {}): Animated {
  const material = palette(overrides);
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material as THREE.MeshStandardMaterial;
    mesh.material = material(src.name, src.color);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Skinned bounds come from the rest pose; a galloping horse leaves them.
    mesh.frustumCulled = false;
  });
  return { scene: gltf.scene, clips: gltf.animations };
}

export async function loadAssets(onProgress: (done: number, total: number) => void): Promise<Assets> {
  let done = 0;
  const jobs: Promise<unknown>[] = [];
  const track = <T>(p: Promise<T>): Promise<T> => {
    jobs.push(p);
    p.then(() => onProgress(++done, jobs.length));
    return p;
  };

  const tex = {
    leavesNormal: track(loadTexture(leavesNormalUrl)),
    leavesBirch: track(loadTexture(leavesBirchUrl)),
    leavesMaple: track(loadTexture(leavesMapleUrl)),
    leavesPine: track(loadTexture(leavesPineUrl)),
    leavesBush: track(loadTexture(leavesBushUrl)),
    flowers: track(loadTexture(flowersUrl)),
    barkNormal: track(loadTexture(barkNormalUrl, true)),
    barkBirch: track(loadTexture(barkBirchUrl, true)),
    barkMaple: track(loadTexture(barkMapleUrl, true)),
    barkPine: track(loadTexture(barkPineUrl, true)),
  };
  const glb = {
    nature: track(loadGltf(natureUrl)),
    props: track(loadGltf(propsUrl)),
    horse: track(loadGltf(horseUrl)),
    cow: track(loadGltf(cowUrl)),
    dog: track(loadGltf(dogUrl)),
    deer: track(loadGltf(deerUrl)),
    rider: track(loadGltf(riderUrl)),
  };
  onProgress(0, jobs.length);

  // --- nature -------------------------------------------------------------
  const leaves = {
    normal: foliageMaterial(await tex.leavesNormal, LEAF_TINT.normal, 0.012, 0.035),
    birch: foliageMaterial(await tex.leavesBirch, LEAF_TINT.birch, 0.016, 0.045),
    maple: foliageMaterial(await tex.leavesMaple, LEAF_TINT.maple, 0.012, 0.035),
    pine: foliageMaterial(await tex.leavesPine, LEAF_TINT.pine, 0.008, 0.02),
    bush: foliageMaterial(await tex.leavesBush, LEAF_TINT.bush, 0.02, 0.03),
  };
  const flowers = foliageMaterial(await tex.flowers, 0xffffff, 0.05, 0.02);
  const bark = {
    normal: new THREE.MeshLambertMaterial({ map: await tex.barkNormal, color: 0xb8a48c }),
    birch: new THREE.MeshLambertMaterial({ map: await tex.barkBirch, color: 0xf2efe6 }),
    maple: new THREE.MeshLambertMaterial({ map: await tex.barkMaple, color: 0xc8a890 }),
    pine: new THREE.MeshLambertMaterial({ map: await tex.barkPine, color: 0xcdb39a }),
  };
  for (const b of Object.values(bark)) sway(b, 0.012, 0);
  // Plain pale stone. The kit's rock texture is near-black and reads as a hole
  // in the grass at this scale; the facets carry the shape well enough alone.
  const rock = new THREE.MeshLambertMaterial({ color: 0xb3ada0, flatShading: true });

  type Species = keyof typeof leaves & keyof typeof bark;
  const speciesOf = (model: string): Species =>
    model.startsWith('Birch') ? 'birch' : model.startsWith('Maple') ? 'maple' : model.startsWith('Pine') ? 'pine' : 'normal';

  const nature = new Map<string, Model>();
  for (const [name, pieces] of piecesOf(await glb.nature)) {
    const parts: Part[] = [];
    const isTree = name.includes('Tree');
    for (const { material: srcName, geometry } of pieces) {
      let material: THREE.Material;
      let castShadow = true;
      if (srcName.includes('Leaves') && isTree) {
        roundNormals(geometry, 0.6);
        material = leaves[speciesOf(name)];
      } else if (srcName.includes('Bark') || srcName.includes('Trunk')) {
        material = bark[speciesOf(name)];
      } else if (srcName === 'Bush_Leaves') {
        roundNormals(geometry, 0.8);
        material = leaves.bush;
        castShadow = name.startsWith('Bush');
      } else if (srcName === 'Flowers') {
        roundNormals(geometry, 1.6);
        material = flowers;
        castShadow = false;
      } else if (srcName.startsWith('Rock')) {
        material = rock;
      } else {
        roundNormals(geometry, 1.6);
        material = leaves.bush;
        castShadow = false;
      }
      parts.push({ geometry, material, castShadow });
    }
    nature.set(name, { name, parts, size: sizeOf(parts) });
  }

  // --- props ----------------------------------------------------------------
  // The village kit's palette, nudged warmer: honey plaster, russet tiles.
  const propMaterial = palette({
    Plaster: 0xe9d9ae,
    RoofTiles: 0xa5503a,
    RoofTiles_Red: 0xa5503a,
    Wood: 0x6f4a2f,
    Wood_Light: 0x8f6540,
    Wood_Side: 0xb89363,
    Stone: 0x857f76,
    Stone_Dark: 0x968f84,
    Stone_Light: 0xb5aea2,
    Bag: 0xb39a6c,
  });
  const windowGlow = new THREE.MeshLambertMaterial({ color: 0x2b2a33, emissive: 0xffb45e, emissiveIntensity: 0 });
  const fireGlow = new THREE.MeshBasicMaterial({ color: 0xffa040 });
  const props = new Map<string, Model>();
  for (const [name, pieces] of piecesOf(await glb.props)) {
    const parts: Part[] = pieces.map(({ material: srcName, colour, geometry }) => ({
      geometry,
      material: srcName === 'Windows' ? windowGlow : srcName === 'Fire' ? fireGlow : propMaterial(srcName, colour),
      castShadow: srcName !== 'Fire',
    }));
    props.set(name, { name, parts, size: sizeOf(parts) });
  }

  const assets: Assets = {
    nature,
    props,
    horse: prepareAnimated(await glb.horse),
    cow: prepareAnimated(await glb.cow),
    dog: prepareAnimated(await glb.dog),
    deer: prepareAnimated(await glb.deer),
    rider: prepareAnimated(await glb.rider),
    windowGlow,
    fireGlow,
  };
  await Promise.all(jobs);
  return assets;
}
