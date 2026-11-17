/**
 * Grass: tens of thousands of real blades, drawn only near the rider.
 *
 * The world is cut into square tiles. A tile's blades are generated the first
 * time the rider comes near, kept while they stay near, and dropped when they
 * ride away. Every blade's position comes from a hash of its own coordinates,
 * so a tile regrows identically each time and nothing swims as you move.
 *
 * Each blade stores where it stands and what colour the ground beneath it is.
 * The vertex shader does the rest: shape, wind, and bending away from hooves.
 */
import * as THREE from 'three';
import { wind } from '../assets';
import { hash2 } from '../noise';
import { grassDensity, groundColor } from './land';
import type { Terrain } from './terrain';

const TILE = 16;
/** Blades per tile at full density. */
const BLADES = 12000;
/** Tiles further than this from the rider are not drawn. */
const RANGE = 60;
/** Stop building new tiles after this long in one frame, and carry on next frame. */
const BUDGET_MS = 5;

interface Tile {
  mesh: THREE.Mesh;
  geometry: THREE.InstancedBufferGeometry;
  count: number;
}

function bladeGeometry(): THREE.BufferGeometry {
  // A single tapering blade, two segments tall, in a unit box:
  // x across (-0.5..0.5), y up (0..1). The shader gives it its real size.
  const rows = 3;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1);
    const w = (1 - t * t) * 0.5 + 0.015;
    pos.push(-w, t, 0, w, t, 0);
  }
  for (let r = 0; r < rows - 1; r++) {
    const a = r * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export class Grass {
  readonly group = new THREE.Group();
  /** 0..1 multiplier on how many blades are drawn. Lowered on slow machines. */
  quality = 1;

  private readonly tiles = new Map<string, Tile>();
  private readonly blade = bladeGeometry();
  private readonly material: THREE.MeshStandardMaterial;
  private readonly uniforms = {
    uRider: { value: new THREE.Vector3() },
    uFade: { value: new THREE.Vector2(RANGE * 0.62, RANGE * 0.98) },
    uTip: { value: new THREE.Color(0xa8b860) },
    uSeason: { value: new THREE.Color(1, 1, 1) },
  };

  constructor(private readonly terrain: Terrain) {
    this.group.name = 'grass';
    // Standard, not Lambert: the ambient light now comes from the captured
    // sky, and only physically based materials receive it.
    this.material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.82, metalness: 0 });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = wind.uTime;
      shader.uniforms.uStrength = wind.uStrength;
      shader.uniforms.uRider = this.uniforms.uRider;
      shader.uniforms.uFade = this.uniforms.uFade;
      shader.uniforms.uTip = this.uniforms.uTip;
      shader.uniforms.uSeason = this.uniforms.uSeason;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          attribute vec4 aRoot;   // xyz: where the blade stands, w: facing
          attribute vec4 aLook;   // rgb: ground colour (linear), a: height
          uniform float uTime;
          uniform float uStrength;
          uniform vec3 uRider;
          uniform vec2 uFade;
          varying vec3 vGrass;
          varying float vTip;`,
        )
        // Light every blade as if it were the ground it grows from. Per-blade
        // normals would make a meadow glitter like tinsel.
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
          float t = position.y;
          float height = aLook.a;
          // Blades thin out and shrink toward the edge of the drawn area, so
          // the meadow fades into the hillside instead of ending at a line.
          float dist = distance(aRoot.xz, cameraPosition.xz);
          float fade = 1.0 - smoothstep(uFade.x, uFade.y, dist);
          height *= 0.35 + 0.65 * fade;
          float width = mix(0.05, 0.16, smoothstep(8.0, uFade.y, dist)) * fade;

          float c = cos(aRoot.w);
          float s = sin(aRoot.w);
          vec3 transformed = vec3(position.x * width * c, t * height, position.x * width * s);

          // Wind: a slow swell that rolls across the field, and a quicker shiver.
          float swell = sin(uTime * 1.1 + aRoot.x * 0.11 + aRoot.z * 0.07);
          float gust = sin(uTime * 2.7 + aRoot.x * 0.53 - aRoot.z * 0.41 + aRoot.w);
          float bend = (0.05 + 0.17 * swell + 0.07 * gust) * uStrength;
          // A fixed lean of its own, so a still day does not look combed.
          vec2 lean = vec2(cos(aRoot.w * 3.7), sin(aRoot.w * 2.9)) * 0.22;
          vec2 push = (vec2(0.8, 0.6) * bend + lean) * height;

          // Hooves part the grass.
          vec2 away = aRoot.xz - uRider.xz;
          float near = 1.0 - smoothstep(0.3, 1.7, length(away));
          push += normalize(away + 0.0001) * near * 0.55;

          float curve = t * t;
          transformed.xz += push * curve;
          transformed.y -= dot(push, push) * curve * 0.5 / max(height, 0.05);
          transformed += aRoot.xyz;

          vTip = t;
          vGrass = aLook.rgb;
          `,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec3 uTip;
          uniform vec3 uSeason;
          varying vec3 vGrass;
          varying float vTip;`,
        )
        // Both faces of a blade are lit alike; a flipped normal would turn half the field dark.
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
        .replace(
          '#include <color_fragment>',
          /* glsl */ `
          // Root: the ground's own colour, a touch darker where blades crowd.
          // Tip: lifted toward a sunlit yellow-green.
          // Roots sit in the shade of the blades round them.
          vec3 rootCol = vGrass * 0.42;
          vec3 tipCol = mix(vGrass * 1.02, uTip, 0.2);
          diffuseColor.rgb = mix(rootCol, tipCol, vTip) * uSeason;
          `,
        );
    };
    this.material.customProgramCacheKey = () => 'grass';
  }

  /** Tint the whole meadow: how the seasons reach the grass. Linear RGB multiplier. */
  setSeason(tint: THREE.Color) {
    this.uniforms.uSeason.value.copy(tint);
  }

  /** Build, show and drop tiles around the rider. Call once a frame. */
  update(rider: THREE.Vector3) {
    this.uniforms.uRider.value.copy(rider);
    const cx = Math.floor(rider.x / TILE);
    const cz = Math.floor(rider.z / TILE);
    const reach = Math.ceil(RANGE / TILE);
    const start = performance.now();
    const wanted = new Set<string>();

    // Nearest tiles first: if the budget runs out, it is the far ones that wait.
    const order: [number, number, number][] = [];
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const tx = cx + dx;
        const tz = cz + dz;
        const mx = (tx + 0.5) * TILE - rider.x;
        const mz = (tz + 0.5) * TILE - rider.z;
        const d = Math.hypot(mx, mz);
        if (d < RANGE + TILE * 0.7) order.push([tx, tz, d]);
      }
    }
    order.sort((a, b) => a[2] - b[2]);

    for (const [tx, tz, d] of order) {
      const key = `${tx},${tz}`;
      wanted.add(key);
      let tile = this.tiles.get(key);
      if (!tile) {
        if (performance.now() - start > BUDGET_MS && this.tiles.size > 0) continue;
        tile = this.build(tx, tz);
        this.tiles.set(key, tile);
        this.group.add(tile.mesh);
      }
      // Blades are stored in shuffled order, so drawing the first N is an even thinning.
      const lod = d < 18 ? 1 : d < 30 ? 0.4 : d < 44 ? 0.16 : 0.07;
      tile.geometry.instanceCount = Math.floor(tile.count * lod * this.quality);
    }

    for (const [key, tile] of this.tiles) {
      if (wanted.has(key)) continue;
      this.group.remove(tile.mesh);
      tile.geometry.dispose();
      this.tiles.delete(key);
    }
  }

  private build(tx: number, tz: number): Tile {
    const root = new Float32Array(BLADES * 4);
    const look = new Float32Array(BLADES * 4);
    const rgb: [number, number, number] = [0, 0, 0];
    const colour = new THREE.Color();
    let n = 0;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < BLADES; i++) {
      const x = (tx + hash2(i, tx * 7919 + tz, 1)) * TILE;
      const z = (tz + hash2(i, tx * 7919 + tz, 2)) * TILE;
      const y = this.terrain.height(x, z);
      const density = grassDensity(x, z, y);
      if (hash2(i, tx * 7919 + tz, 3) > density) continue;
      groundColor(x, z, y, rgb);
      colour.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
      const vary = hash2(i, tx * 7919 + tz, 4);
      root[n * 4] = x;
      root[n * 4 + 1] = y - 0.02;
      root[n * 4 + 2] = z;
      root[n * 4 + 3] = hash2(i, tx * 7919 + tz, 5) * Math.PI * 2;
      // Darker and less yellow than the painted ground colour: under a real sky
      // a field is mostly the deep green of blades in each other's shade.
      // A blade in ten is dry straw-gold, as in any real field.
      const dry = hash2(i, tx * 7919 + tz, 6) < 0.1;
      const k = 0.8 + vary * 0.45;
      look[n * 4] = dry ? 0.32 : colour.r * k * 0.9;
      look[n * 4 + 1] = dry ? 0.27 : colour.g * k;
      look[n * 4 + 2] = dry ? 0.1 : colour.b * k * 0.7;
      // Mostly short turf, with the odd tall tuft; shorter where it is sparse.
      // A meadow, not a lawn: mostly ankle height, with seed heads standing above.
      look[n * 4 + 3] = (0.16 + vary * vary * 0.36) * (0.55 + 0.45 * density);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      n++;
    }

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = this.blade.index;
    geometry.setAttribute('position', this.blade.getAttribute('position'));
    geometry.setAttribute('aRoot', new THREE.InstancedBufferAttribute(root.subarray(0, n * 4), 4));
    geometry.setAttribute('aLook', new THREE.InstancedBufferAttribute(look.subarray(0, n * 4), 4));
    geometry.instanceCount = n;
    if (n === 0) {
      minY = 0;
      maxY = 0;
    }
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3((tx + 0.5) * TILE, (minY + maxY) / 2, (tz + 0.5) * TILE),
      Math.hypot(TILE * 0.72, (maxY - minY) / 2 + 1),
    );

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    return { mesh, geometry, count: n };
  }
}
