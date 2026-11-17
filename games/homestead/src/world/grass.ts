/**
 * Grass, drawn the way open-world games draw it: thick clumps of cards.
 *
 * A single blade per instance cannot make a meadow. Even forty thousand of
 * them leave ground showing between every one, and a modelled blade is a flat
 * green sliver. What reads as a field from horseback is what those games do:
 * cards. Each clump is three crossed quads carrying a painted picture of a
 * couple of hundred blades (tools/build_grass_atlas.py), planted two or three
 * to the square metre so the ground vanishes beneath them.
 *
 * What makes cards look like grass instead of like cards:
 *
 * - Lit as the ground is lit. Every vertex takes the upward normal, so a
 *   clump shades as one mass with the hillside instead of each card catching
 *   the sun at its own angle and flickering as you turn.
 * - Light through the blades. Looking toward a low sun, the tips glow, as
 *   thin leaves do. Only where the sun actually reaches: the shadow map is
 *   respected.
 * - Alpha that holds up at distance. Mipmapping averages a blade's edge
 *   into the empty air beside it until the cut-out test removes it entirely,
 *   and far grass thins to nothing. Alpha is boosted with the mip level, so a
 *   clump keeps its body however small it gets.
 * - Thinning without popping. Every clump has a rank; at distance the high
 *   ranks shrink away smoothly and the survivors grow to cover the ground
 *   they left.
 * - Patches. Height, kind (lawn, meadow, seeding, gone to straw, tussock)
 *   and colour follow slow noise across the land, so the field has drifts and
 *   hollows instead of an even nap. Colour also follows the ground beneath,
 *   so the grass melts into the terrain at the edge of the drawn range.
 *
 * Tiles stream in around the rider exactly as before. Every clump's position
 * comes from a hash of its own coordinates, so a tile regrows identically.
 */
import * as THREE from 'three';
import { wind } from '../assets';
import { fbm, hash2, noise2, smoothstep } from '../noise';
import { grassCards } from '../scans';
import { WORLD, grassDensity, groundColor } from './land';
import type { Terrain } from './terrain';

const TILE = 16;
/** Clumps per square metre at full density. */
const PER_M2 = 4;
const CLUMPS = Math.round(TILE * TILE * PER_M2);
/** Tiles further than this from the rider are not drawn. */
const RANGE = 64;
/** Stop building new tiles after this long in one frame, and carry on next frame. */
const BUDGET_MS = 5;

/** Card slots in the atlas, matching tools/build_grass_atlas.py. */
const CARD = { meadow: [0, 1, 2, 3], lawn: 4, seeding: 5, late: 6, tussock: 7 } as const;

/** The meadow colour the atlas was painted at; ground colour is tinted relative to it. */
const PAINTED = [0.27, 0.405, 0.12] as const;

/**
 * Fraction of clumps kept at a distance. Must match the shader's `keep()`.
 * Near the rider every clump; by the edge of the range, one in eight, each
 * grown to cover for the others.
 */
function kept(d: number): number {
  return 1 - 0.88 * smoothstep(9, RANGE * 0.92, d);
}

interface Tile {
  mesh: THREE.Mesh;
  geometry: THREE.InstancedBufferGeometry;
  count: number;
}

/**
 * Three quads crossed at sixty degrees, each a unit wide and a unit tall,
 * leaning a little,
 * four rows high so wind can curve them. `uv.x` runs across a card, `uv.y` up.
 */
function clumpGeometry(): THREE.BufferGeometry {
  const rows = 4;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let q = 0; q < 3; q++) {
    const a = (q * Math.PI) / 3;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // Each card leans a little off vertical, alternately, so that from the
    // saddle a clump covers the ground round its root rather than standing
    // up from it as a thin star.
    const lean = (q === 1 ? -0.3 : 0.3) * (q === 2 ? -0.8 : 1);
    const base = pos.length / 3;
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      for (const u of [0, 1]) {
        const x = u - 0.5;
        pos.push(x * c - s * lean * t, t, x * s + c * lean * t);
        uv.push(u, t);
      }
    }
    for (let r = 0; r < rows; r++) {
      const i = base + r * 2;
      idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export class Grass {
  readonly group = new THREE.Group();
  /** 0..1 multiplier on how many clumps are drawn. Lowered on slow machines. */
  quality = 1;

  private readonly tiles = new Map<string, Tile>();
  private readonly clump = clumpGeometry();
  private readonly material: THREE.MeshStandardMaterial;
  private readonly uniforms = {
    uRider: { value: new THREE.Vector3() },
    uFade: { value: new THREE.Vector2(RANGE * 0.7, RANGE * 0.99) },
    uSeason: { value: new THREE.Color(1, 1, 1) },
    uCards: { value: null as THREE.Texture | null },
    uQuality: { value: 1 },
  };

  constructor(private readonly terrain: Terrain) {
    this.group.name = 'grass';
    // Nothing is drawn until the cards have arrived: an empty texture would
    // sample as solid black squares.
    this.group.visible = false;
    const cards = grassCards();
    this.uniforms.uCards.value = cards.tex;
    void cards.ready.then(() => (this.group.visible = true));

    this.material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.92, metalness: 0, alphaTest: 0.5 });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = wind.uTime;
      shader.uniforms.uStrength = wind.uStrength;
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          attribute vec4 aRoot;   // xyz: where the clump stands, w: facing
          attribute vec4 aLook;   // rgb: tint (linear), a: height in metres
          attribute vec3 aCard;   // x: atlas card, y: width, z: rank 0..1
          uniform float uTime;
          uniform float uStrength;
          uniform float uQuality;
          uniform vec3 uRider;
          uniform vec2 uFade;
          varying vec3 vTint;
          varying vec2 vCardUv;
          varying float vTip;

          // Must match kept() in grass.ts.
          float keep(float d) {
            return 1.0 - 0.88 * smoothstep(9.0, ${(RANGE * 0.92).toFixed(1)}, d);
          }`,
        )
        // The clump is lit as the ground beneath it is: one mass, not a fan
        // of mirrors each catching the sun at its own angle.
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
          float t = uv.y;
          float dist = distance(aRoot.xz, cameraPosition.xz);

          // Thin with distance: low ranks stay and grow to cover for the high
          // ranks, which shrink away rather than vanish in a frame.
          // Low detail thins the far grass, never the grass at your feet.
          float frac = keep(dist) * mix(1.0, uQuality, smoothstep(4.0, 24.0, dist));
          float alive = clamp((frac - aCard.z) / 0.06, 0.0, 1.0);
          float grow = inversesqrt(max(frac, 0.12));
          // And at the very edge of the drawn range, everything sinks into the turf.
          float edge = 1.0 - smoothstep(uFade.x, uFade.y, dist);

          float height = aLook.a * alive * edge * mix(1.0, grow, 0.55);
          float width = aCard.y * alive * mix(1.0, grow, 0.85);

          float c = cos(aRoot.w);
          float s = sin(aRoot.w);
          vec3 p = vec3(position.x * c - position.z * s, 0.0, position.x * s + position.z * c);
          vec3 transformed = vec3(p.x * width, t * height, p.z * width);

          // Wind: a slow swell that rolls across the field in waves, and a
          // quicker shiver of its own.
          float swell = sin(uTime * 1.05 + aRoot.x * 0.13 + aRoot.z * 0.08);
          float gust = sin(uTime * 2.6 + aRoot.x * 0.6 - aRoot.z * 0.45 + aRoot.w * 3.0);
          float bend = (0.06 + 0.16 * swell + 0.06 * gust) * uStrength;
          vec2 push = vec2(0.8, 0.6) * bend * height;

          // Hooves and feet part the grass.
          vec2 away = aRoot.xz - uRider.xz;
          float near = 1.0 - smoothstep(0.3, 1.3, length(away));
          push += normalize(away + 0.0001) * near * 0.4 * height;

          float curve = t * t;
          transformed.xz += push * curve;
          transformed.y -= dot(push, push) * curve * 0.5 / max(height, 0.05);
          transformed += aRoot.xyz;

          // Atlas: two cards across, four down; image row 0 is the top.
          float card = aCard.x;
          vec2 cell = vec2(mod(card, 2.0), floor(card / 2.0));
          vCardUv = vec2((cell.x + mix(0.004, 0.996, uv.x)) * 0.5, (cell.y + 1.0 - mix(0.0, 0.985, t)) * 0.25);
          vTip = t;
          vTint = aLook.rgb;
          `,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          uniform sampler2D uCards;
          uniform vec3 uSeason;
          varying vec3 vTint;
          varying vec2 vCardUv;
          varying float vTip;`,
        )
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
        .replace(
          '#include <color_fragment>',
          /* glsl */ `
          vec4 texel = texture2D(uCards, vCardUv);
          // Keep a blade's body as it shrinks: a mip level averages it with
          // the air round it, so lift alpha to match before the cut-out test.
          vec2 px = vCardUv * 2048.0;
          vec2 ddx = dFdx(px);
          vec2 ddy = dFdy(px);
          float mip = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
          diffuseColor.a = texel.a * (1.0 + mip * 0.28);
          diffuseColor.rgb = texel.rgb * vTint * uSeason;
          `,
        )
        .replace(
          '#include <lights_fragment_end>',
          /* glsl */ `#include <lights_fragment_end>
          #if NUM_DIR_LIGHTS > 0
          {
            // Sunlight through the blades. directLight still holds the sun
            // from the loop above, with its shadow already applied.
            vec3 toSun = directionalLights[0].direction;
            vec3 toEye = normalize(vViewPosition);
            float behind = pow(saturate(dot(-toEye, toSun)), 3.0);
            float through = behind * smoothstep(0.15, 1.0, vTip);
            reflectedLight.directDiffuse += directLight.color * diffuseColor.rgb * vec3(1.0, 1.06, 0.7) * through * 0.4;
          }
          #endif`,
        );
    };
    this.material.customProgramCacheKey = () => 'grass-cards';
  }

  /** Tint the whole meadow: how the seasons reach the grass. Linear RGB multiplier. */
  setSeason(tint: THREE.Color) {
    this.uniforms.uSeason.value.copy(tint);
  }

  /** Build, show and drop tiles around the rider. Call once a frame. */
  update(rider: THREE.Vector3) {
    this.uniforms.uRider.value.copy(rider);
    this.uniforms.uQuality.value = this.quality;
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
      // Clumps are stored by rank, so drawing the first N is the same thinning
      // the shader does; this only saves the vertex work for the ones it hides.
      // The camera trails the rider, so judge by the tile's nearest corner.
      const nearest = Math.max(0, d - TILE * 0.72 - 6);
      const quality = 1 + (this.quality - 1) * smoothstep(4, 24, nearest);
      tile.geometry.instanceCount = Math.min(tile.count, Math.ceil(tile.count * (kept(nearest) * quality + 0.07)));
    }

    for (const [key, tile] of this.tiles) {
      if (wanted.has(key)) continue;
      this.group.remove(tile.mesh);
      tile.geometry.dispose();
      this.tiles.delete(key);
    }
  }

  private build(tx: number, tz: number): Tile {
    const root = new Float32Array(CLUMPS * 4);
    const look = new Float32Array(CLUMPS * 4);
    const card = new Float32Array(CLUMPS * 3);
    const rgb: [number, number, number] = [0, 0, 0];
    const colour = new THREE.Color();
    const seed = tx * 7919 + tz;
    const S = WORLD.seed;
    let n = 0;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < CLUMPS; i++) {
      const x = (tx + hash2(i, seed, 1)) * TILE;
      const z = (tz + hash2(i, seed, 2)) * TILE;
      const y = this.terrain.height(x, z);
      const density = grassDensity(x, z, y);
      // Where grass grows thinner (the trodden camp, the verge of the lane,
      // the shore) it grows shorter, not sparser: a few scattered cards on
      // open turf read from the saddle as little flat stars. Clumps only
      // thin out where it is nearly bare, by which point they are tiny.
      if (hash2(i, seed, 3) > smoothstep(0.08, 0.35, density)) continue;

      // Slow drifts across the land: where the grass grows long, where it
      // has gone to seed, where it has dried.
      const lush = fbm(x / 22, z / 22, 3, S + 90) * 0.5 + 0.5;
      const dryness = noise2(x / 31, z / 31, S + 91) * 0.5 + 0.5;
      const vary = hash2(i, seed, 4);
      const pick = hash2(i, seed, 6);

      let kind: number;
      let height: number;
      let width: number;
      if (lush < 0.3) {
        kind = CARD.lawn;
        height = 0.3 + vary * 0.16;
      } else if (dryness > 0.68 && pick < 0.55) {
        kind = CARD.late;
        height = 0.42 + vary * 0.22;
      } else if (lush > 0.66 && pick < 0.35) {
        kind = CARD.seeding;
        height = 0.6 + vary * 0.3;
      } else if (pick > 0.94) {
        kind = CARD.tussock;
        height = 0.38 + vary * 0.2;
      } else {
        kind = CARD.meadow[Math.floor(hash2(i, seed, 7) * 4)]!;
        height = 0.3 + lush * 0.28 + vary * 0.16;
      }
      height *= 0.2 + 0.8 * smoothstep(0.3, 0.95, density);
      // The card is twice as wide as it is tall; keep blades their painted shape.
      width = height * 2 * (0.85 + hash2(i, seed, 8) * 0.3);

      // Tint the painted blades toward the ground colour here, so drifts of
      // richer and paler green carry on from the terrain into the grass.
      groundColor(x, z, y, rgb);
      colour.setRGB(rgb[0] / PAINTED[0], rgb[1] / PAINTED[1], rgb[2] / PAINTED[2], THREE.SRGBColorSpace);
      // Brightness drifts too, in patches a few metres across, and each
      // clump differs a little from its neighbours.
      const patch = fbm(x / 9, z / 9, 2, S + 92) * 0.5 + 0.5;
      const k = (0.7 + hash2(i, seed, 9) * 0.22) * (0.82 + patch * 0.3);
      root[n * 4] = x;
      root[n * 4 + 1] = y - 0.03;
      root[n * 4 + 2] = z;
      root[n * 4 + 3] = hash2(i, seed, 5) * Math.PI * 2;
      // A little less saturated than the ground: under the open sky a field
      // reads softer than a photograph of one blade.
      const grey = (colour.r + colour.g + colour.b) / 3;
      look[n * 4] = Math.min(colour.r * 0.85 + grey * 0.15, 1.6) * k;
      look[n * 4 + 1] = Math.min(colour.g * 0.85 + grey * 0.15, 1.6) * k;
      look[n * 4 + 2] = Math.min(colour.b * 0.85 + grey * 0.15, 1.6) * k;
      look[n * 4 + 3] = height;
      card[n * 3] = kind;
      card[n * 3 + 1] = width;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      n++;
    }
    // Rank in placement order: placement is already a hash, so the first N
    // clumps are an even scatter over the tile at any N.
    for (let j = 0; j < n; j++) card[j * 3 + 2] = (j + 0.5) / n;

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = this.clump.index;
    geometry.setAttribute('position', this.clump.getAttribute('position'));
    geometry.setAttribute('uv', this.clump.getAttribute('uv'));
    geometry.setAttribute('aRoot', new THREE.InstancedBufferAttribute(root.subarray(0, n * 4), 4));
    geometry.setAttribute('aLook', new THREE.InstancedBufferAttribute(look.subarray(0, n * 4), 4));
    geometry.setAttribute('aCard', new THREE.InstancedBufferAttribute(card.subarray(0, n * 3), 3));
    geometry.instanceCount = n;
    if (n === 0) {
      minY = 0;
      maxY = 0;
    }
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3((tx + 0.5) * TILE, (minY + maxY) / 2, (tz + 0.5) * TILE),
      Math.hypot(TILE * 0.72 + 1.5, (maxY - minY) / 2 + 1.5),
    );

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    return { mesh, geometry, count: n };
  }
}
