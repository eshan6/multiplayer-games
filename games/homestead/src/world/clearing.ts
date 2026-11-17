/**
 * Ground that buildings have claimed.
 *
 * Grass does not grow through a floor, and the ground round a sty is mud,
 * not meadow. Each built thing has a footprint (its own rectangle, turned with
 * it); this paints those into a mask the grass shrinks under and the terrain
 * wears to bare earth with.
 */

export interface Footprint {
  /** Where the structure stands, and how it is turned (as its group's rotation.y). */
  x: number;
  z: number;
  rot: number;
  /** The rectangle, in the structure's own space: centre and half-sizes. */
  cx: number;
  cz: number;
  hw: number;
  hd: number;
  /** 0..1: how completely the ground is cleared (a fence barely; a sty yard fully). */
  strength: number;
}

/**
 * Paint footprints into a square single-channel mask covering `-half..half`
 * metres on both axes, taking the larger of what is there and what is
 * painted. `margin` grows each rectangle; `soft` is the fade beyond that.
 * `channel`/`stride` let it write into one channel of an RGBA buffer.
 */
export function paintFootprints(out: Uint8Array, size: number, half: number, prints: Footprint[], margin: number, soft: number, stride = 1, channel = 0) {
  const perPx = (half * 2) / size;
  for (const p of prints) {
    const c = Math.cos(p.rot);
    const s = Math.sin(p.rot);
    // The rectangle's centre in the world.
    const wx = p.x + p.cx * c + p.cz * s;
    const wz = p.z - p.cx * s + p.cz * c;
    const reach = Math.hypot(p.hw, p.hd) + margin + soft;
    const x0 = Math.max(0, Math.floor((wx - reach + half) / perPx));
    const x1 = Math.min(size - 1, Math.ceil((wx + reach + half) / perPx));
    const z0 = Math.max(0, Math.floor((wz - reach + half) / perPx));
    const z1 = Math.min(size - 1, Math.ceil((wz + reach + half) / perPx));
    for (let pz = z0; pz <= z1; pz++) {
      const dz = (pz + 0.5) * perPx - half - wz;
      for (let px = x0; px <= x1; px++) {
        const dx = (px + 0.5) * perPx - half - wx;
        // Into the rectangle's own frame: the inverse of the structure's turn.
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        const d = Math.max(Math.abs(lx) - p.hw - margin, Math.abs(lz) - p.hd - margin);
        if (d >= soft) continue;
        const t = d <= 0 ? 1 : 1 - d / soft;
        const v = Math.round(255 * p.strength * t * t * (3 - 2 * t));
        const i = (pz * size + px) * stride + channel;
        if (v > out[i]!) out[i] = v;
      }
    }
  }
}
