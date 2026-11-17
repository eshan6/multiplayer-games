/**
 * Things you can walk up to and do something with.
 *
 * Every system that has such things (structures, animals, crops, furniture)
 * hands back a list of `Spot`s; this picks the one nearest the player and the
 * HUD shows its actions. Nothing here knows what any action does.
 */
import type { MoveName } from './entities/moves';

export type ActionKey = 'E' | 'R' | 'T' | 'F';

export interface SpotAction {
  key: ActionKey;
  label: string;
  /** Greyed out, with this as the reason, instead of hidden. */
  blocked?: string;
  /**
   * How it looks: the player walks up, plays this, and `run` happens at the
   * moment the deed is done. Without one, `run` happens on the key press.
   */
  move?: MoveName;
  run(): void;
}

export interface Spot {
  x: number;
  z: number;
  /** How close you must be, in metres. */
  reach: number;
  title: string;
  /** A second line: how the animal is feeling, how ripe the crop is. */
  detail?: string;
  /** Height above the ground of the thing, for placing the marker. */
  height?: number;
  actions: SpotAction[];
}

export const KEY_CODES: Record<ActionKey, string> = { E: 'KeyE', R: 'KeyR', T: 'KeyT', F: 'KeyF' };

/** The spot the player is closest to and within reach of, if any. */
export function nearest(spots: Spot[], x: number, z: number): Spot | null {
  let best: Spot | null = null;
  let bestScore = Infinity;
  for (const s of spots) {
    const d = Math.hypot(s.x - x, s.z - z);
    if (d > s.reach) continue;
    // Small things win over the big thing they stand next to.
    const score = d / s.reach + s.reach * 0.05;
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}
