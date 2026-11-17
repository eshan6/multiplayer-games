/**
 * The year turning. One number — how far through the four seasons the world
 * is — recolours every leaf, the meadow, and the ground under it.
 *
 * This works because the leaf textures are white silhouettes and all colour
 * comes from a tint: a season is just a different set of tints, blended.
 */
import * as THREE from 'three';
import type { Assets } from '../assets';
import type { Grass } from './grass';

type Species = keyof Assets['foliage'];


/** Leaf colour per species for spring, summer, autumn, winter. sRGB. */
const LEAVES: Record<Species, [number, number, number, number]> = {
  oak: [0x86ab52, 0x7a9a4e, 0xc28a3c, 0x8a7d5c],
  ash: [0x8cb256, 0x80a24e, 0xd6b84a, 0x958c62],
  aspen: [0x94bc58, 0x8aad52, 0xe8c040, 0x9c9060],
  // Evergreen: barely changes.
  pine: [0x7c9a68, 0x6f8f62, 0x6b8a5e, 0x667f62],
  bush: [0x98b85e, 0x86a154, 0xb07a3a, 0x7f7656],
};

/** What the meadow and the ground are multiplied by. Linear, 1 = as painted. */
const MEADOW: [number, number, number][] = [
  [0.98, 1.02, 0.95],
  [1, 1, 1],
  [1.2, 0.98, 0.66],
  [0.98, 0.98, 0.94],
];

const a = new THREE.Color();
const b = new THREE.Color();

export class Seasons {
  private last = -1;
  private readonly tint = new THREE.Color();

  constructor(
    private readonly assets: Assets,
    private readonly grass: Grass,
    private readonly ground: THREE.MeshStandardMaterial,
  ) {}

  /** @param at 0..4: 0 is the first day of spring, 1.5 high summer, 2.5 mid-autumn. */
  update(at: number) {
    if (Math.abs(at - this.last) < 0.002) return;
    this.last = at;
    // Each season holds for most of its length and turns into the next at the end.
    const i = Math.floor(at) % 4;
    const j = (i + 1) % 4;
    const t = THREE.MathUtils.smoothstep(at - Math.floor(at), 0.62, 1);
    for (const species of Object.keys(LEAVES) as Species[]) {
      this.assets.foliage[species].color.copy(a.setHex(LEAVES[species][i]!)).lerp(b.setHex(LEAVES[species][j]!), t);
    }
    const m = MEADOW[i]!;
    const n = MEADOW[j]!;
    this.tint.setRGB(m[0] + (n[0] - m[0]) * t, m[1] + (n[1] - m[1]) * t, m[2] + (n[2] - m[2]) * t);
    this.grass.setSeason(this.tint);
    this.ground.color.copy(this.tint);
  }
}
