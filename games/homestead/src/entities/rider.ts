/**
 * You, on your horse.
 *
 * `intent()` turns keys into "how fast and which way do I want to go";
 * `step()` moves the horse by that intent and resolves what it bumps into.
 * They are separate on purpose: when a second rider arrives over the network,
 * her horse will run the same `step()` from intents that came down a socket.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { Animated, Assets } from '../assets';
import type { Input } from '../input';
import type { Wall } from '../world/homestead';
import { WORLD, waterDepth } from '../world/land';
import type { Obstacle } from '../world/scatter';
import type { Terrain } from '../world/terrain';
import { Creature } from './creature';

export const PACE = {
  amble: 2.3,
  canter: 6.4,
  gallop: 11.5,
  reverse: -1.3,
} as const;

/** How far the horse's body is from an obstacle's edge before it stops. */
const GIRTH = 0.75;
/** A horse will wade this deep and no deeper. */
const WADE_DEPTH = 0.55;

export interface Intent {
  /** Target ground speed in m/s. */
  speed: number;
  /** -1 (left) .. 1 (right). */
  turn: number;
}

export interface Solid {
  obstacles: Obstacle[];
  walls: Wall[];
}

export class Rider {
  readonly horse: Creature;
  readonly figure: THREE.Object3D;
  /** When on, W holds a walk instead of a canter. */
  ambling = false;
  /** Smoothed turn input, also used to bank the horse and lean the rider. */
  private steer = 0;
  private idleFor = 0;
  private readonly seatBone: THREE.Object3D | undefined;
  private readonly seat = new THREE.Vector3();
  private readonly pose: PoseBone[];
  private bob: number | null = null;

  constructor(assets: Assets, recolour?: Record<string, number>) {
    this.horse = new Creature(assets.horse, { height: 2.35, walkPace: 1.9, runPace: 9.2, recolour });
    this.seatBone = this.horse.bone('Torso2') ?? this.horse.bone('Torso');
    this.figure = seatFigure(assets.rider);
    this.horse.root.add(this.figure);
    this.pose = ridingPose(this.figure);
  }

  get position(): THREE.Vector3 {
    return this.horse.root.position;
  }

  intent(input: Input): Intent {
    const forward = input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
    const turn = input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
    let speed = 0;
    if (forward > 0) speed = input.held('ShiftLeft', 'ShiftRight') ? PACE.gallop : this.ambling ? PACE.amble : PACE.canter;
    else if (forward < 0) speed = PACE.reverse;
    return { speed, turn };
  }

  step(dt: number, intent: Intent, terrain: Terrain, solid: Solid) {
    const h = this.horse;

    // A horse gathers speed over a few strides and pulls up rather quicker.
    const gaining = Math.abs(intent.speed) > Math.abs(h.speed);
    const rate = gaining ? 5.5 : 9;
    h.speed += THREE.MathUtils.clamp(intent.speed - h.speed, -rate * dt, rate * dt);

    // Turning is tight at a walk and wide at a gallop.
    this.steer += (intent.turn - this.steer) * (1 - Math.exp(-dt * 7));
    const fast = THREE.MathUtils.smoothstep(Math.abs(h.speed), 2, PACE.gallop);
    const turnRate = THREE.MathUtils.lerp(2.1, 1.25, fast);
    // Backing up steers the other way, as it does on anything with a front end.
    h.heading -= this.steer * turnRate * dt * (h.speed < -0.1 ? -1 : 1);

    const p = h.root.position;
    let nx = p.x + Math.sin(h.heading) * h.speed * dt;
    let nz = p.z + Math.cos(h.heading) * h.speed * dt;

    // --- what is in the way ---------------------------------------------------
    for (const o of solid.obstacles) {
      const dx = nx - o.x;
      const dz = nz - o.z;
      const min = o.r + GIRTH;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min || d2 === 0) continue;
      const d = Math.sqrt(d2);
      nx = o.x + (dx / d) * min;
      nz = o.z + (dz / d) * min;
    }
    for (const w of solid.walls) {
      const wx = w.x2 - w.x1;
      const wz = w.z2 - w.z1;
      const t = THREE.MathUtils.clamp(((nx - w.x1) * wx + (nz - w.z1) * wz) / (wx * wx + wz * wz), 0, 1);
      const cx = w.x1 + wx * t;
      const cz = w.z1 + wz * t;
      const dx = nx - cx;
      const dz = nz - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= GIRTH * GIRTH || d2 === 0) continue;
      const d = Math.sqrt(d2);
      nx = cx + (dx / d) * GIRTH;
      nz = cz + (dz / d) * GIRTH;
    }
    // The woods close in at the edge of the world.
    const out = Math.hypot(nx, nz);
    if (out > WORLD.playRadius) {
      nx *= WORLD.playRadius / out;
      nz *= WORLD.playRadius / out;
    }
    // Deep water: try sliding along it on each axis before giving up the step.
    const tooDeep = (x: number, z: number) => waterDepth(x, z, terrain.height(x, z)) > WADE_DEPTH;
    if (tooDeep(nx, nz)) {
      if (!tooDeep(nx, p.z)) nz = p.z;
      else if (!tooDeep(p.x, nz)) nx = p.x;
      else {
        nx = p.x;
        nz = p.z;
      }
    }

    // If something stopped us, the horse should slow rather than gallop on the spot.
    const moved = Math.hypot(nx - p.x, nz - p.z);
    const wanted = Math.abs(h.speed) * dt;
    if (wanted > 1e-5 && moved < wanted * 0.5) h.speed *= Math.pow(0.02, dt);
    p.x = nx;
    p.z = nz;

    // --- gait ---------------------------------------------------------------------
    const s = Math.abs(h.speed);
    if (s < 0.12) {
      this.idleFor += dt;
      // Left standing, a horse does not hold a pose: it drops its head to graze.
      h.setGait(this.idleFor > 9 ? 'eat' : this.idleFor > 5 ? 'idleAlt' : 'idle', 0.6);
    } else {
      this.idleFor = 0;
      h.setGait(s < 3.6 ? 'walk' : 'run', 0.28);
    }

    h.update(dt, terrain, -this.steer * 0.16 * fast);
    this.seatRider(dt, fast);
  }

  /** Keep the rider in the saddle as the horse's back rises and falls. */
  private seatRider(dt: number, fast: number) {
    const h = this.horse;
    if (this.seatBone) {
      h.root.updateMatrixWorld(true);
      this.seatBone.getWorldPosition(this.seat);
      h.root.worldToLocal(this.seat);
      // Follow the back's height closely, but never its sideways wobble.
      this.bob = this.bob === null ? this.seat.y : this.bob + (this.seat.y - this.bob) * (1 - Math.exp(-dt * 22));
      this.figure.position.set(0, this.bob + SEAT.lift, this.seat.z + SEAT.back);
    }
    // Lean into the pace and into the turn.
    const lean = SEAT.lean + fast * 0.22;
    this.figure.rotation.set(lean, 0, this.steer * 0.12 * fast);
    for (const b of this.pose) b.apply();
  }
}

/** Where the rider sits relative to the horse's back bone, in metres. */
const SEAT = { lift: 0.43, back: 0.05, lean: 0.06 };

interface PoseBone {
  apply(): void;
}

function seatFigure(source: Animated): THREE.Object3D {
  const figure = new THREE.Group();
  const body = cloneSkinned(source.scene);
  const box = new THREE.Box3().setFromObject(body);
  const scale = 1.72 / (box.max.y - box.min.y);
  body.scale.setScalar(scale);
  // The figure's origin is the rider's hips, so it pivots where it sits.
  body.position.y = -(box.min.y + (box.max.y - box.min.y) * 0.5) * scale;
  figure.add(body);
  return figure;
}

/**
 * The character kit has no riding animation, so the seat is posed by hand:
 * each entry is a bone and how far to turn it from its rest pose (radians,
 * about the bone's own X, Y, Z). Applied every frame over the rest pose.
 */
const RIDING: Record<string, [number, number, number]> = {
  'UpperLeg.L': [-0.62, 0, -0.34],
  'UpperLeg.R': [-0.62, 0, 0.34],
  'LowerLeg.L': [0.78, 0, 0],
  'LowerLeg.R': [0.78, 0, 0],
  'Foot.L': [-0.15, 0, 0],
  'Foot.R': [-0.15, 0, 0],
  'UpperArm.L': [0.45, 0, 0],
  'UpperArm.R': [0.45, 0, 0],
  'LowerArm.L': [-1.0, 0, 0],
  'LowerArm.R': [-1.0, 0, 0],
  Abdomen: [0.05, 0, 0],
  Head: [-0.06, 0, 0],
};

function ridingPose(figure: THREE.Object3D): PoseBone[] {
  const out: PoseBone[] = [];
  const offset = new THREE.Quaternion();
  const euler = new THREE.Euler();
  for (const [name, [x, y, z]] of Object.entries(RIDING)) {
    // GLTFLoader strips dots from node names: "UpperLeg.L" arrives as "UpperLegL".
    const bone = figure.getObjectByName(name.replace('.', ''));
    if (!bone) continue;
    const rest = bone.quaternion.clone();
    const posed = rest.clone().multiply(offset.setFromEuler(euler.set(x, y, z)));
    out.push({ apply: () => bone.quaternion.copy(posed) });
  }
  return out;
}
