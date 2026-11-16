/**
 * The ground you ride on: one mesh, one baked colour texture.
 *
 * `land.ts` says what the land *should* be; this file samples it onto a grid
 * and from then on the grid is the truth. `Terrain.height()` interpolates the
 * same triangles the mesh draws, so a hoof, a tree root and a blade of grass
 * all meet the surface exactly instead of hovering a few centimetres off the
 * analytic curve.
 */
import * as THREE from 'three';
import { WORLD, groundColor, heightAt } from './land';

const HALF = WORLD.meshHalfSize;
const CELL = 2.5;
const N = (HALF * 2) / CELL; // cells per side
const V = N + 1; // vertices per side
const TEX = 1024;

export class Terrain {
  readonly mesh: THREE.Mesh;
  private readonly heights = new Float32Array(V * V);

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
        uv[i * 2] = ix / N;
        uv[i * 2 + 1] = 1 - iz / N;
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

    const material = new THREE.MeshLambertMaterial({ map: this.bakeColour() });
    this.mesh = new THREE.Mesh(geo, material);
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
    return out
      .set(this.height(x - e, z) - this.height(x + e, z), 2 * e, this.height(x, z - e) - this.height(x, z + e))
      .normalize();
  }

  private bakeColour(): THREE.Texture {
    const data = new Uint8Array(TEX * TEX * 4);
    const rgb: [number, number, number] = [0, 0, 0];
    for (let py = 0; py < TEX; py++) {
      const z = -HALF + ((py + 0.5) / TEX) * HALF * 2;
      for (let px = 0; px < TEX; px++) {
        const x = -HALF + ((px + 0.5) / TEX) * HALF * 2;
        groundColor(x, z, this.height(x, z), rgb);
        // DataTexture rows run bottom-up; the mesh's v is flipped to match.
        const i = ((TEX - 1 - py) * TEX + px) * 4;
        data[i] = rgb[0] * 255;
        data[i + 1] = rgb[1] * 255;
        data[i + 2] = rgb[2] * 255;
        data[i + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, TEX, TEX, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    return tex;
  }
}
