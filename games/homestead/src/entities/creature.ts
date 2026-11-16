/**
 * A skinned animal standing on the ground: one model, its animation clips, and
 * the small amount of logic every four-legged thing shares — cross-fading
 * between gaits, turning toward where it is going, keeping its feet on a slope.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { Animated } from '../assets';
import type { Terrain } from '../world/terrain';

export type Gait = 'idle' | 'idleAlt' | 'low' | 'eat' | 'walk' | 'run';

/** The kits name the same clip slightly differently from animal to animal. */
const CLIP_NAMES: Record<Gait, string[]> = {
  idle: ['Idle'],
  idleAlt: ['Idle_2'],
  low: ['Idle_Headlow', 'Idle_2_HeadLow'],
  eat: ['Eating'],
  walk: ['Walk'],
  run: ['Gallop'],
};

export interface CreatureSpec {
  /** Height of the standing model in metres; the source files have no common scale. */
  height: number;
  /** Ground speed, in m/s, at which each clip's feet stop sliding when played at normal rate. */
  walkPace: number;
  runPace: number;
  /** Replace named material colours (sRGB hex) — how one model becomes a bay and a grey. */
  recolour?: Record<string, number>;
}

const tmpNormal = new THREE.Vector3();
const tmpForward = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const FORWARD_AXIS = new THREE.Vector3(0, 0, 1);

export class Creature {
  /** Sits on the ground at the animal's feet. Move and turn this. */
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  /** Heading in radians about Y; 0 faces +Z. */
  heading = 0;
  /** Current ground speed in m/s, signed. Drives the gait's playback rate. */
  speed = 0;
  gait: Gait = 'idle';

  private readonly actions = new Map<Gait, THREE.AnimationAction>();
  private readonly tilt = new THREE.Quaternion();

  constructor(
    source: Animated,
    readonly spec: CreatureSpec,
  ) {
    this.model = cloneSkinned(source.scene);
    if (spec.recolour) {
      const made = new Map<THREE.Material, THREE.Material>();
      this.model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const src = mesh.material as THREE.MeshLambertMaterial;
        const hex = spec.recolour![src.name];
        if (hex === undefined) return;
        let m = made.get(src);
        if (!m) {
          m = src.clone();
          (m as THREE.MeshLambertMaterial).color.setHex(hex);
          made.set(src, m);
        }
        mesh.material = m;
      });
    }
    const box = new THREE.Box3().setFromObject(this.model);
    const scale = spec.height / (box.max.y - box.min.y);
    this.model.scale.setScalar(scale);
    this.model.position.y = -box.min.y * scale;
    this.root.add(this.model);

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const gait of Object.keys(CLIP_NAMES) as Gait[]) {
      const clip = source.clips.find((c) => CLIP_NAMES[gait].includes(c.name));
      if (!clip) continue;
      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      action.setEffectiveWeight(0);
      action.play();
      this.actions.set(gait, action);
    }
    this.actions.get('idle')?.setEffectiveWeight(1);
    // Start every animal at a different point in its loop, or a herd moves in step.
    this.mixer.setTime(Math.random() * 10);
  }

  /** Cross-fade to a gait. Asking for the current gait is free. */
  setGait(gait: Gait, fade = 0.3) {
    if (gait === this.gait || !this.actions.has(gait)) return;
    const from = this.actions.get(this.gait);
    const to = this.actions.get(gait)!;
    to.enabled = true;
    to.time = gait === 'walk' || gait === 'run' ? to.time : 0;
    to.setEffectiveTimeScale(1);
    to.setEffectiveWeight(1);
    if (from) to.crossFadeFrom(from, fade, false);
    this.gait = gait;
  }

  /** Bone lookup by the name it has in the source file. */
  bone(name: string): THREE.Object3D | undefined {
    return this.model.getObjectByName(name);
  }

  /**
   * Advance animation and settle the body onto the terrain.
   * @param lean extra roll in radians, for banking into a turn
   */
  update(dt: number, terrain: Terrain, lean = 0) {
    const walk = this.actions.get('walk');
    const run = this.actions.get('run');
    // Match the legs to the ground actually covered, so hooves do not skate.
    if (walk && this.gait === 'walk') walk.setEffectiveTimeScale(THREE.MathUtils.clamp(Math.abs(this.speed) / this.spec.walkPace, 0.5, 2.2) * Math.sign(this.speed || 1));
    if (run && this.gait === 'run') run.setEffectiveTimeScale(THREE.MathUtils.clamp(this.speed / this.spec.runPace, 0.55, 1.5));
    this.mixer.update(dt);

    const p = this.root.position;
    p.y = terrain.height(p.x, p.z);

    // Stand square to the slope rather than bolt upright on it.
    terrain.normal(p.x, p.z, tmpNormal);
    tmpNormal.lerp(THREE.Object3D.DEFAULT_UP, 0.35).normalize();
    tmpForward.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    tmpRight.crossVectors(tmpNormal, tmpForward).normalize();
    tmpForward.crossVectors(tmpRight, tmpNormal).normalize();
    tmpMatrix.makeBasis(tmpRight, tmpNormal, tmpForward);
    tmpQuat.setFromRotationMatrix(tmpMatrix);
    if (lean) tmpQuat.multiply(this.tilt.setFromAxisAngle(FORWARD_AXIS, lean));
    this.root.quaternion.slerp(tmpQuat, 1 - Math.exp(-dt * 9));
  }
}

/** Shortest signed angle from `a` to `b`. */
export function angleTo(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
