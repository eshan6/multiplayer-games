/**
 * The ground: one mesh, dressed in photographed textures.
 *
 * `land.ts` says what the land *should* be; this file samples it onto a grid
 * and from then on the grid is the truth. `Terrain.height()` interpolates the
 * same triangles the mesh draws, so a hoof, a tree root and a blade of grass
 * all meet the surface exactly.
 *
 * What it looks like comes from three scanned ground textures — dense turf,
 * leaf litter under the trees, the stony dirt of the lane — blended per pixel
 * by a control map painted from the land's own functions. Each has a normal
 * map and a roughness map, so the ground catches light like ground. A second
 * low-resolution map carries the broad colour of the place, so a hillside is
 * not one photograph repeated a thousand times.
 */
import * as THREE from 'three';
import { surfaceMaps } from '../scans';
import { WORLD, grassDensity, groundColor, heightAt, laneMask, woodland } from './land';

const HALF = WORLD.meshHalfSize;
const CELL = 2.5;
const N = (HALF * 2) / CELL; // cells per side
const V = N + 1; // vertices per side
const CONTROL = 1024;
const MACRO = 512;
/** Metres one repeat of a ground texture covers. */
const TILE = 3.2;

export class Terrain {
  readonly mesh: THREE.Mesh;
  private readonly heights = new Float32Array(V * V);
  private readonly control = new Uint8Array(CONTROL * CONTROL * 4);
  private readonly controlTexture: THREE.DataTexture;

  constructor() {
    const pos = new Float32Array(V * V * 3);
    const uv = new Float32Array(V * V * 2);
    for (let iz = 0; iz < V; iz++) {
      for (let ix = 0; ix < V; ix++) {
        const x = -HALF + ix * CELL;
        const z = -HALF + iz * CELL;
        const h = heightAt(x, z);
        const i = iz * V + ix;
        this.heights[i] = h;
        pos[i * 3] = x;
        pos[i * 3 + 1] = h;
        pos[i * 3 + 2] = z;
        // Texture coordinates are world metres: the ground textures tile across it.
        uv[i * 2] = x / TILE;
        uv[i * 2 + 1] = z / TILE;
      }
    }
    // Every quad is split along the same diagonal; height() relies on it.
    const index = new Uint32Array(N * N * 6);
    let k = 0;
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const a = iz * V + ix;
        const b = a + 1;
        const c = a + V;
        const d = c + 1;
        index[k++] = a;
        index[k++] = c;
        index[k++] = b;
        index[k++] = b;
        index[k++] = c;
        index[k++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    this.controlTexture = this.bakeControl();
    this.mesh = new THREE.Mesh(geo, this.material(this.bakeMacro()));
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';
  }

  /** Ground height at (x, z), matching the rendered triangles. */
  height(x: number, z: number): number {
    const fx = Math.min(Math.max((x + HALF) / CELL, 0), N - 1e-4);
    const fz = Math.min(Math.max((z + HALF) / CELL, 0), N - 1e-4);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const u = fx - ix;
    const v = fz - iz;
    const i = iz * V + ix;
    const a = this.heights[i]!;
    const b = this.heights[i + 1]!;
    const c = this.heights[i + V]!;
    const d = this.heights[i + V + 1]!;
    // Triangles are (a, c, b) and (b, c, d): split on the b–c diagonal.
    return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }

  /** Surface normal at (x, z). */
  normal(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const e = 1.0;
    return out.set(this.height(x - e, z) - this.height(x + e, z), 2 * e, this.height(x, z - e) - this.height(x, z + e)).normalize();
  }

  /**
   * Darken the ground under things that stand on it. Real shadows only reach
   * a little way from the camera; this is what keeps a distant wood from
   * looking as though it floats on a lit lawn.
   */
  shade(spots: { x: number; z: number; r: number }[]) {
    const scale = CONTROL / (HALF * 2);
    for (const s of spots) {
      const cx = (s.x + HALF) * scale;
      const cy = (s.z + HALF) * scale;
      const r = Math.max(2, s.r * scale);
      for (let py = Math.max(0, Math.floor(cy - r)); py <= Math.min(CONTROL - 1, Math.ceil(cy + r)); py++) {
        for (let px = Math.max(0, Math.floor(cx - r)); px <= Math.min(CONTROL - 1, Math.ceil(cx + r)); px++) {
          const d = Math.hypot(px - cx, py - cy) / r;
          if (d >= 1) continue;
          const i = (py * CONTROL + px) * 4 + 2;
          this.control[i] = Math.max(this.control[i]!, Math.round((1 - d * d) * 200));
        }
      }
    }
    this.controlTexture.needsUpdate = true;
  }

  /**
   * Where the lane runs (red) and where the woods stand (green). Blue is
   * shade, painted later. Alpha is how thickly grass grows, so the ground can
   * darken under the sward exactly where grass cards are drawn.
   */
  private bakeControl(): THREE.DataTexture {
    for (let py = 0; py < CONTROL; py++) {
      const z = -HALF + ((py + 0.5) / CONTROL) * HALF * 2;
      for (let px = 0; px < CONTROL; px++) {
        const x = -HALF + ((px + 0.5) / CONTROL) * HALF * 2;
        const i = (py * CONTROL + px) * 4;
        this.control[i] = laneMask(x, z) * 255;
        this.control[i + 1] = woodland(x, z) * 255;
        this.control[i + 3] = grassDensity(x, z, this.height(x, z)) * 255;
      }
    }
    const tex = new THREE.DataTexture(this.control, CONTROL, CONTROL, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  /** The broad colour of the land: sunlit meadow, damp hollow, sandy shore. */
  private bakeMacro(): THREE.DataTexture {
    const data = new Uint8Array(MACRO * MACRO * 4);
    const rgb: [number, number, number] = [0, 0, 0];
    for (let py = 0; py < MACRO; py++) {
      const z = -HALF + ((py + 0.5) / MACRO) * HALF * 2;
      for (let px = 0; px < MACRO; px++) {
        const x = -HALF + ((px + 0.5) / MACRO) * HALF * 2;
        groundColor(x, z, this.height(x, z), rgb);
        const i = (py * MACRO + px) * 4;
        data[i] = rgb[0] * 255;
        data[i + 1] = rgb[1] * 255;
        data[i + 2] = rgb[2] * 255;
        data[i + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, MACRO, MACRO, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  private material(macro: THREE.Texture): THREE.MeshStandardMaterial {
    const meadow = surfaceMaps('lawn');
    const wood = surfaceMaps('forest_floor');
    const lane = surfaceMaps('stony_dirt_path');
    const m = new THREE.MeshStandardMaterial({ map: meadow.diff, normalMap: meadow.nor, roughness: 1, metalness: 0 });
    m.normalScale.setScalar(1.1);
    const extra = {
      tMeadowArm: { value: meadow.arm },
      tWoodD: { value: wood.diff },
      tWoodN: { value: wood.nor },
      tWoodArm: { value: wood.arm },
      tLaneD: { value: lane.diff },
      tLaneN: { value: lane.nor },
      tLaneArm: { value: lane.arm },
      tControl: { value: this.controlTexture },
      tMacro: { value: macro },
    };
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, extra);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vLand;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvLand = (position.xz + ${HALF.toFixed(1)}) / ${(HALF * 2).toFixed(1)};`);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          uniform sampler2D tMeadowArm;
          uniform sampler2D tWoodD;
          uniform sampler2D tWoodN;
          uniform sampler2D tWoodArm;
          uniform sampler2D tLaneD;
          uniform sampler2D tLaneN;
          uniform sampler2D tLaneArm;
          uniform sampler2D tControl;
          uniform sampler2D tMacro;
          varying vec2 vLand;
          vec3 gArm;
          vec3 gNormal;`,
        )
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
          vec4 ctl = texture2D(tControl, vLand);
          vec3 macro = texture2D(tMacro, vLand).rgb;
          // Far from the camera a tiling texture shows its repeat. Blend toward
          // the same texture at a much larger scale, which has none to show.
          vec2 near = vMapUv;
          vec2 wide = vMapUv * 0.19 + 0.37;
          float far = smoothstep(14.0, 85.0, length(vViewPosition));
          // The turf scan is darker than the land colour it is pulled toward; bring it level.
          vec3 dMeadow = mix(texture2D(map, near).rgb, texture2D(map, wide).rgb, 0.25 + 0.6 * far) * 1.38;
          // The scanned leaf litter is bright and dry; a wood floor in leaf is dark and damp.
          vec3 dWood = mix(texture2D(tWoodD, near).rgb, texture2D(tWoodD, wide).rgb, 0.25 + 0.6 * far) * vec3(0.5, 0.55, 0.42);
          // The scanned path is wet, dark earth; this lane is dry and trodden pale.
          vec3 dLane = texture2D(tLaneD, near * 0.8).rgb * vec3(1.45, 1.38, 1.25);
          // The edge of the wood and of the lane follows the texture's own
          // detail, so one material frays into the next instead of fading.
          float grain = dot(dMeadow, vec3(0.33)) * 1.6 - 0.25;
          float wWood = smoothstep(0.3, 0.7, ctl.g + (grain - 0.5) * 0.35);
          float wLane = smoothstep(0.15, 0.6, ctl.r + (grain - 0.5) * 0.7);
          vec3 albedo = mix(dMeadow, dWood, wWood);
          // Keep the photograph's detail but pull its overall colour to the land's.
          float luma = dot(albedo, vec3(0.3, 0.59, 0.11));
          albedo = mix(albedo, macro * (luma / 0.19), 0.62);
          albedo = mix(albedo, dLane * vec3(1.05, 0.98, 0.9), wLane);
          albedo *= mix(1.0, 0.5, ctl.b);
          // Where grass cards stand, what shows between them is the bottom of
          // the sward, in the blades' shade. Past the range the cards are
          // drawn to, the ground is the sward's sunlit top.
          float sward = smoothstep(0.2, 0.8, ctl.a) * (1.0 - wWood) * (1.0 - smoothstep(46.0, 64.0, length(vViewPosition)));
          albedo *= mix(vec3(1.0), vec3(0.66, 0.7, 0.5), sward);
          diffuseColor.rgb *= albedo;

          gArm = mix(mix(texture2D(tMeadowArm, near).rgb, texture2D(tWoodArm, near).rgb, wWood), texture2D(tLaneArm, near * 0.8).rgb, wLane);
          gNormal = mix(mix(texture2D(normalMap, near).xyz, texture2D(tWoodN, near).xyz, wWood), texture2D(tLaneN, near * 0.8).xyz, wLane);
          // Relief fades with distance: far ground should be smooth, not noisy.
          gNormal = mix(gNormal, vec3(0.5, 0.5, 1.0), far * 0.75);
          diffuseColor.rgb *= mix(1.0, gArm.r, 0.7);
          `,
        )
        // Turf is a mass of blades at every angle: it never shows a sheen. The
        // scan's roughness map is for a flat photograph and turned the meadow
        // frosty toward the sun, so only the wood floor and lane use theirs.
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * mix(1.0, mix(gArm.g, 1.0, 0.25), max(wWood, wLane));')
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `
          vec3 mapN = gNormal * 2.0 - 1.0;
          mapN.xy *= normalScale;
          normal = normalize(tbn * mapN);`,
        );
    };
    m.customProgramCacheKey = () => 'terrain';
    return m;
  }
}
