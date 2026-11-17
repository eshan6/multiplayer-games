/**
 * How each thing you do looks: which animation, with what in hand, for how
 * long, and at what moment in it the thing actually happens (the axe bites,
 * the water reaches the soil). The world changes at that moment, not when the
 * key is pressed, so the toast and the points land with the action.
 *
 * Nothing here changes the game. A move is played by whoever does it and, by
 * name, on their partner's screen.
 */
import type { BurstKind } from '../world/fx';
import type { Performance } from './avatar';

export type MoveName =
  | 'chop'
  | 'stones'
  | 'pick'
  | 'forage'
  | 'plant'
  | 'water'
  | 'harvest'
  | 'feed'
  | 'scatter'
  | 'wash'
  | 'groom'
  | 'pet'
  | 'throw'
  | 'collect'
  | 'cookFire'
  | 'cookStove'
  | 'build'
  | 'eat'
  | 'place'
  | 'wave';

export interface Move extends Performance {
  /** What the work indicator says while it plays. */
  verb: string;
  /** Seconds in, when the deed is done. */
  contact: number;
  /** How far from the thing to stand while doing it, in metres. */
  stand: number;
  /** Let go of the right-hand prop at contact (a thrown stick). */
  release?: boolean;
  /** Thrown up from the work: at these seconds in, at this height above the ground. */
  fx?: { kind: BurstKind; at: number[]; y: number };
}

export const MOVES: Record<MoveName, Move> = {
  // Fallen branches are cut into lengths you can carry.
  chop: { verb: 'Cutting wood', clip: 'Chop', loop: true, rate: 1.05, seconds: 2.9, right: 'axe', contact: 2.5, stand: 0.95, fx: { kind: 'chips', at: [0.55, 1.5, 2.45], y: 0.25 } },
  stones: { verb: 'Gathering stones', clip: 'Harvest', seconds: 2.3, contact: 1.4, stand: 0.7, fx: { kind: 'dust', at: [1.2], y: 0.1 } },
  pick: { verb: 'Picking berries', clip: 'PickUp', seconds: 1.5, contact: 0.8, left: 'basket', stand: 0.75, fx: { kind: 'leaves', at: [0.75], y: 0.9 } },
  forage: { verb: 'Gathering mushrooms', clip: 'Harvest', seconds: 2.3, contact: 1.4, left: 'basket', stand: 0.65, fx: { kind: 'leaves', at: [1.3], y: 0.15 } },
  plant: { verb: 'Sowing', clip: 'Plant', seconds: 2.7, contact: 2.0, left: 'pouch', stand: 0.7, fx: { kind: 'soil', at: [1.1, 1.9], y: 0.25 } },
  water: { verb: 'Watering', clip: 'Water', seconds: 3.3, contact: 1.6, right: 'can', stand: 0.85, fx: { kind: 'water', at: [1.0, 1.3, 1.6, 1.9, 2.2], y: 0.45 } },
  harvest: { verb: 'Harvesting', clip: 'Harvest', seconds: 2.4, contact: 1.5, left: 'basket', stand: 0.65, fx: { kind: 'soil', at: [1.35], y: 0.2 } },
  feed: { verb: 'Feeding', clip: 'Interact', seconds: 1.9, contact: 1.0, right: 'bucket', stand: 1.05 },
  scatter: { verb: 'Scattering grain', clip: 'Plant', seconds: 2.4, contact: 1.4, left: 'scoop', stand: 0.9, fx: { kind: 'grain', at: [0.9, 1.4], y: 0.6 } },
  wash: { verb: 'Washing', clip: 'Scrub', loop: true, rate: 1.6, seconds: 3.0, contact: 2.4, right: 'brush', stand: 0.95, fx: { kind: 'suds', at: [0.6, 1.2, 1.8, 2.4], y: 0.9 } },
  groom: { verb: 'Brushing', clip: 'Scrub', loop: true, rate: 1.3, seconds: 3.0, contact: 2.4, right: 'brush', stand: 1.0, fx: { kind: 'dust', at: [1.0, 2.2], y: 1.0 } },
  pet: { verb: 'Making a fuss', clip: 'Interact', seconds: 1.8, contact: 1.0, stand: 0.85 },
  throw: { verb: 'Throwing the stick', clip: 'Throw', seconds: 1.4, contact: 0.72, right: 'stick', release: true, stand: 1.4 },
  collect: { verb: 'Collecting', clip: 'PickUp', seconds: 1.6, contact: 0.9, left: 'basket', stand: 1.2 },
  cookFire: { verb: 'Cooking over the fire', clip: 'Crouch', loop: true, rate: 1, seconds: 2.8, contact: 2.2, right: 'ladle', stand: 1.0 },
  cookStove: { verb: 'Cooking', clip: 'Scrub', loop: true, rate: 0.9, seconds: 2.6, contact: 2.0, right: 'ladle', stand: 0.75 },
  build: { verb: 'Building', clip: 'Fix', seconds: 3.4, from: 0.6, contact: 2.6, right: 'hammer', stand: 1.6, fx: { kind: 'chips', at: [0.9, 1.8, 2.7], y: 0.3 } },
  eat: { verb: 'Eating', clip: 'Eat', seconds: 2.4, contact: 1.6, left: 'bowl', right: 'spoon', stand: 0.6 },
  place: { verb: 'Setting it down', clip: 'PickUp', seconds: 1.1, contact: 0.6, stand: 0.9 },
  wave: { verb: 'Waving', clip: 'Nod', seconds: 1.4, contact: 0.2, stand: 0 },
};

export const isMove = (s: unknown): s is MoveName => typeof s === 'string' && s in MOVES;
