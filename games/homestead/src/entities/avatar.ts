/**
 * A person: yours, or your partner's.
 *
 * The model arrives a moment after the avatar is created (each outfit is
 * fetched only when someone wears it), so an Avatar is usable at once and
 * simply has nothing to draw until its model lands.
 *
 * Movement is a blend, not a switch. Idle, walk, jog and sprint all play at
 * once, weighted by how fast the person is going, and all four are driven
 * from one shared step phase whose rate follows the ground speed: so feet
 * plant where they land instead of skating, and a person speeding up from a
 * walk into a run changes gait mid-stride rather than popping between two.
 *
 * On top of that:
 * - a lean into turns and a dip on hard starts and stops,
 * - the head turns to whatever you are about to use, within what a neck can do,
 * - performances: a named piece of work (chopping, watering, planting...)
 *   played over the legs and arms, with a tool in hand while it lasts,
 * - a seat in the saddle, from a driving pose with the legs opened round the
 *   horse's barrel.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { loadAvatar } from '../assets';
import type { AvatarId } from '../game/catalog';
import { prop, type PropName } from './props';

export type Clip =
  | 'Idle'
  | 'Walk'
  | 'Jog'
  | 'Sprint'
  | 'Interact'
  | 'PickUp'
  | 'Fix'
  | 'Crouch'
  | 'SitDown'
  | 'Sit'
  | 'StandUp'
  | 'Reins'
  | 'Talk'
  | 'Scrub'
  | 'Dance'
  | 'Harvest'
  | 'Plant'
  | 'Water'
  | 'Chop'
  | 'Carry'
  | 'Eat'
  | 'Open'
  | 'Throw'
  | 'FoldArms'
  | 'GetUp'
  | 'Nod'
  | 'Lantern';

/** Each gait, and the ground speed (m/s) its clip covers at normal rate. */
const GAITS: [Clip, number][] = [
  ['Idle', 0],
  ['Walk', 1.2],
  ['Jog', 3.3],
  ['Sprint', 6.0],
];

/** A piece of work, played over everything else. */
export interface Performance {
  clip: Clip;
  /** How long it lasts. A looping clip repeats until then; a single one is timed to fit. */
  seconds: number;
  loop?: boolean;
  /** Playback rate for a looping clip. */
  rate?: number;
  /** Start this far into the clip, in seconds (to skip a wind-up). */
  from?: number;
  /** Held in the right hand while it lasts; `left` in the left. */
  right?: PropName;
  left?: PropName;
}

/**
 * Where a rider's legs go, in the body's own frame (+X to the rider's left,
 * +Y up, +Z ahead), for the left side; the right mirrors it. Thighs straddle
 * the barrel, out and down and a little forward; shins hang down the horse's
 * flank with the heel drawn back, as a rider's do.
 */
const SADDLE = { thigh: new THREE.Vector3(0.52, -0.62, 0.5).normalize(), shin: new THREE.Vector3(0.14, -0.95, -0.22).normalize() };

export const AVATAR_HEIGHT = 1.74;

interface Playing {
  def: Performance;
  action: THREE.AnimationAction;
  left: number;
  weight: number;
  props: THREE.Object3D[];
}

const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

export class Avatar {
  /** Stands on the ground at the feet. Move and turn this. */
  readonly root = new THREE.Group();
  heading = 0;
  speed = 0;
  riding = false;
  /** Sitting on a chair or at a table: the seated loop instead of the legs. */
  seated = false;
  /** A point in world space to look toward, or null to look ahead. */
  look: THREE.Vector3 | null = null;

  /** Leans and dips; the model hangs from this. */
  private readonly body = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private readonly actions = new Map<Clip, THREE.AnimationAction>();
  private phase = 0;
  private lastHeading = 0;
  private lastSpeed = 0;
  private roll = 0;
  private pitch = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private playing: Playing | null = null;
  private fading: Playing[] = [];
  private bones: Record<string, THREE.Bone | undefined> = {};
  private wearing: AvatarId | null = null;

  constructor(id: AvatarId) {
    this.root.add(this.body);
    this.wear(id);
  }

  /** Change outfit. Safe to call with what is already worn. */
  wear(id: AvatarId) {
    if (id === this.wearing) return;
    this.wearing = id;
    loadAvatar(id)
      .then((source) => {
        // Someone can change their mind while the model is on its way.
        if (this.wearing !== id) return;
        this.stopPerformance(true);
        this.body.clear();
        const model = cloneSkinned(source.scene);
        const box = new THREE.Box3().setFromObject(model);
        const scale = AVATAR_HEIGHT / (box.max.y - box.min.y);
        model.scale.setScalar(scale);
        model.position.y = -box.min.y * scale;
        this.body.add(model);

        this.bones = {};
        for (const name of ['pelvis', 'spine_02', 'spine_03', 'neck_01', 'Head', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'hand_l', 'hand_r']) {
          this.bones[name] = model.getObjectByName(name) as THREE.Bone | undefined;
        }

        this.mixer = new THREE.AnimationMixer(model);
        this.actions.clear();
        for (const clip of source.clips) {
          const action = this.mixer.clipAction(clip);
          this.actions.set(clip.name as Clip, action);
        }
        // The gaits and the seats always run; their weights decide what shows.
        for (const name of [...GAITS.map((g) => g[0]), 'Reins', 'Sit'] as Clip[]) {
          const a = this.actions.get(name);
          if (!a) continue;
          a.play();
          a.setEffectiveWeight(0);
          // Their clocks are set by hand from the shared phase.
          if (name !== 'Idle' && name !== 'Reins' && name !== 'Sit') a.timeScale = 0;
        }
      })
      .catch((err) => console.warn('[homestead] avatar failed to load', err));
  }

  /** True while a performance holds the body. */
  get busy(): boolean {
    return this.playing !== null;
  }

  /**
   * Play a piece of work over whatever the body is doing.
   * @returns how long it will hold the body, in seconds
   */
  perform(def: Performance): number {
    const action = this.actions.get(def.clip);
    if (!action) return def.seconds;
    this.stopPerformance(false);
    const clip = action.getClip();
    action.reset();
    action.enabled = true;
    if (def.loop) {
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.timeScale = def.rate ?? 1;
    } else {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      // Timed to fit, but never so fast it looks like a twitch or so slow it drags.
      action.timeScale = THREE.MathUtils.clamp((clip.duration - (def.from ?? 0)) / def.seconds, 0.6, 1.6);
    }
    action.time = def.from ?? 0;
    action.setEffectiveWeight(0);
    action.play();
    const props: THREE.Object3D[] = [];
    if (def.right && this.bones.hand_r) props.push(this.grip(def.right, this.bones.hand_r, 'right'));
    if (def.left && this.bones.hand_l) props.push(this.grip(def.left, this.bones.hand_l, 'left'));
    this.playing = { def, action, left: def.seconds, weight: 0, props };
    return def.seconds;
  }

  /** Let go of whatever is in the hands (a thrown stick leaves the hand mid-move). */
  dropProps() {
    if (!this.playing) return;
    for (const o of this.playing.props) o.removeFromParent();
    this.playing.props = [];
  }

  /** End the current performance early (walking away, getting on a horse). */
  stopPerformance(now: boolean) {
    const p = this.playing;
    if (!p) return;
    this.playing = null;
    for (const o of p.props) o.removeFromParent();
    p.props = [];
    if (now) {
      p.action.stop();
      return;
    }
    this.fading.push(p);
  }

  private grip(name: PropName, hand: THREE.Bone, side: 'left' | 'right'): THREE.Object3D {
    const o = prop(name, side);
    // Undo the model's overall scale so a prop keeps its real size.
    const s = 1 / (this.body.children[0]?.scale.x ?? 1);
    o.scale.multiplyScalar(s);
    hand.add(o);
    return o;
  }

  update(dt: number) {
    this.root.rotation.y = this.heading;
    if (!this.mixer) return;

    // ---- performance weights --------------------------------------------------
    const p = this.playing;
    if (p) {
      p.left -= dt;
      p.weight = Math.min(1, p.weight + dt / 0.22);
      if (p.left <= 0) this.stopPerformance(false);
    }
    for (const f of this.fading) f.weight = Math.max(0, f.weight - dt / 0.3);
    this.fading = this.fading.filter((f) => {
      f.action.setEffectiveWeight(f.weight);
      if (f.weight > 0) return true;
      f.action.stop();
      return false;
    });
    const over = this.playing ? this.playing.weight : 0;
    this.playing?.action.setEffectiveWeight(over);
    const fadingWeight = this.fading.reduce((n, f) => n + f.weight, 0);
    const base = Math.max(0, 1 - over - fadingWeight);

    // ---- what the legs do -----------------------------------------------------
    const s = Math.abs(this.speed);
    const seat = this.riding ? 'Reins' : this.seated ? 'Sit' : null;
    for (const name of ['Reins', 'Sit'] as Clip[]) this.actions.get(name)?.setEffectiveWeight(seat === name ? base : 0);
    let i = 0;
    while (i < GAITS.length - 2 && s > GAITS[i + 1]![1]) i++;
    const [aClip, aV] = GAITS[i]!;
    const [bClip, bV] = GAITS[i + 1]!;
    const t = seat ? 0 : THREE.MathUtils.clamp((s - aV) / (bV - aV), 0, 1);
    for (const [name] of GAITS) {
      const w = seat ? 0 : name === aClip ? 1 - t : name === bClip ? t : 0;
      this.actions.get(name)?.setEffectiveWeight(w * base);
    }
    // One step phase for every gait: the rate is what each clip would need to
    // cover this ground, blended the same way the clips are.
    const rate = (clip: Clip, v: number) => {
      const d = this.actions.get(clip)?.getClip().duration ?? 1;
      return v > 0 ? s / v / d : 0;
    };
    const cycles = aV === 0 ? rate(bClip, bV) : THREE.MathUtils.lerp(rate(aClip, aV), rate(bClip, bV), t);
    this.phase = (this.phase + cycles * dt) % 1;
    for (const [name] of GAITS) {
      if (name === 'Idle') continue;
      const a = this.actions.get(name);
      if (a) a.time = this.phase * a.getClip().duration;
    }
    this.mixer.update(dt);

    // ---- lean -----------------------------------------------------------------
    // Into the turn, harder the faster; forward when setting off, back when pulling up.
    const turnRate = dt > 0 ? angleDiff(this.heading, this.lastHeading) / dt : 0;
    const accel = dt > 0 ? (s - this.lastSpeed) / dt : 0;
    this.lastHeading = this.heading;
    this.lastSpeed = s;
    const k = 1 - Math.exp(-dt * 8);
    const grounded = !this.riding && !this.seated;
    this.roll += ((grounded ? THREE.MathUtils.clamp(-turnRate * s * 0.025, -0.22, 0.22) : 0) - this.roll) * k;
    this.pitch += ((grounded ? THREE.MathUtils.clamp(accel * 0.012, -0.08, 0.1) : 0) - this.pitch) * k;
    this.body.rotation.set(this.pitch * (1 - over), 0, this.roll * (1 - over));

    if (this.riding) this.openKnees(base);
    this.turnHead(dt, over);
  }

  /** Put a seated pose's legs either side of a horse. */
  private openKnees(w: number) {
    const frame = this.root.getWorldQuaternion(new THREE.Quaternion());
    for (const side of ['l', 'r'] as const) {
      const mirror = side === 'l' ? 1 : -1;
      const thigh = this.bones[`thigh_${side}`];
      const calf = this.bones[`calf_${side}`];
      if (!thigh || !calf) continue;
      aimBone(thigh, new THREE.Vector3(SADDLE.thigh.x * mirror, SADDLE.thigh.y, SADDLE.thigh.z).applyQuaternion(frame), w);
      aimBone(calf, new THREE.Vector3(SADDLE.shin.x * mirror, SADDLE.shin.y, SADDLE.shin.z).applyQuaternion(frame), w);
    }
  }

  /** Turn the head toward what is being looked at, as far as a neck goes. */
  private turnHead(dt: number, busy: number) {
    const head = this.bones.Head;
    const neck = this.bones.neck_01;
    if (!head || !neck) return;
    let yaw = 0;
    let pitch = 0;
    if (this.look && busy < 0.5) {
      head.getWorldPosition(tmpV);
      tmpV2.copy(this.look).sub(tmpV);
      // Into the body's own frame (+Z ahead), whatever it stands or sits on.
      tmpV2.applyQuaternion(this.root.getWorldQuaternion(tmpQ).invert());
      const flat = Math.hypot(tmpV2.x, tmpV2.z);
      yaw = Math.atan2(tmpV2.x, tmpV2.z);
      pitch = Math.atan2(-tmpV2.y, flat);
      // Behind you, you turn round rather than wring your neck.
      if (Math.abs(yaw) > 1.9) yaw = 0;
      yaw = THREE.MathUtils.clamp(yaw, -1.1, 1.1);
      pitch = THREE.MathUtils.clamp(pitch, -0.45, 0.6);
    }
    const k = 1 - Math.exp(-dt * 6);
    this.lookYaw += (yaw - this.lookYaw) * k;
    this.lookPitch += (pitch - this.lookPitch) * k;
    if (Math.abs(this.lookYaw) < 1e-3 && Math.abs(this.lookPitch) < 1e-3) return;
    // Shared between neck and head, turned about the body's up and side axes.
    const rootQ = this.root.getWorldQuaternion(tmpQ2);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rootQ);
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(rootQ);
    for (const [bone, share] of [
      [neck, 0.4],
      [head, 0.6],
    ] as [THREE.Bone, number][]) {
      rotateWorldAxis(bone, up, this.lookYaw * share);
      rotateWorldAxis(bone, side, this.lookPitch * share);
    }
  }
}

/**
 * Swing a bone so it points along `dir` (world space), `w` of the way. Bones
 * run along their own +Y.
 */
function aimBone(bone: THREE.Object3D, dir: THREE.Vector3, w: number) {
  if (!bone.parent || w <= 0) return;
  const world = bone.getWorldQuaternion(new THREE.Quaternion());
  const now = new THREE.Vector3(0, 1, 0).applyQuaternion(world);
  const swing = new THREE.Quaternion().setFromUnitVectors(now, dir.clone().normalize());
  if (w < 1) swing.slerp(new THREE.Quaternion(), 1 - w);
  // world' = swing * world; local' = parent⁻¹ * world'
  const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(parent.invert().multiply(swing.multiply(world)));
}

/** Turn a bone by `angle` about an axis in world space. */
function rotateWorldAxis(bone: THREE.Object3D, worldAxis: THREE.Vector3, angle: number) {
  if (!angle || !bone.parent) return;
  bone.parent.getWorldQuaternion(tmpQ);
  // The axis in the parent's frame: a turn applied there, before the bone's own rotation.
  const local = tmpV2.copy(worldAxis).applyQuaternion(tmpQ.invert()).normalize();
  bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(local, angle));
}

function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
