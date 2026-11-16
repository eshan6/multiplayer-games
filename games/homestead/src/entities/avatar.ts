/**
 * A person: yours, or your partner's.
 *
 * The model arrives a moment after the avatar is created (each outfit is
 * fetched only when someone wears it), so an Avatar is usable at once and
 * simply has nothing to draw until its model lands.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { loadAvatar } from '../assets';
import type { AvatarId } from '../game/catalog';

type Clip = 'Idle' | 'Walk' | 'Run' | 'Interact' | 'Wave';

/**
 * The character kits have no riding animation, so the seat is posed by hand:
 * each entry is a bone and how far to turn it from its rest pose (radians,
 * about the bone's own X, Y, Z).
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

export const AVATAR_HEIGHT = 1.74;

export class Avatar {
  /** Stands on the ground at the feet. Move and turn this. */
  readonly root = new THREE.Group();
  heading = 0;
  speed = 0;
  riding = false;
  private mixer: THREE.AnimationMixer | null = null;
  private readonly actions = new Map<Clip, THREE.AnimationAction>();
  private current: Clip = 'Idle';
  private oneShot = 0;
  private rest: { bone: THREE.Object3D; q: THREE.Quaternion }[] = [];
  private seat: { bone: THREE.Object3D; q: THREE.Quaternion }[] = [];
  private wearing: AvatarId | null = null;

  constructor(id: AvatarId) {
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
        this.root.clear();
        const body = cloneSkinned(source.scene);
        const box = new THREE.Box3().setFromObject(body);
        const scale = AVATAR_HEIGHT / (box.max.y - box.min.y);
        body.scale.setScalar(scale);
        body.position.y = -box.min.y * scale;
        this.root.add(body);

        this.mixer = new THREE.AnimationMixer(body);
        this.actions.clear();
        for (const name of ['Idle', 'Walk', 'Run', 'Interact', 'Wave'] as Clip[]) {
          const clip = source.clips.find((c) => c.name === name);
          if (!clip) continue;
          const action = this.mixer.clipAction(clip);
          if (name === 'Interact' || name === 'Wave') {
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = false;
          } else {
            action.play();
            action.setEffectiveWeight(name === 'Idle' ? 1 : 0);
          }
          this.actions.set(name, action);
        }
        this.current = 'Idle';

        this.rest = [];
        body.traverse((o) => {
          if ((o as THREE.Bone).isBone) this.rest.push({ bone: o, q: o.quaternion.clone() });
        });
        const turn = new THREE.Quaternion();
        const euler = new THREE.Euler();
        this.seat = [];
        for (const [name, [x, y, z]] of Object.entries(RIDING)) {
          // GLTFLoader strips dots from node names: "UpperLeg.L" arrives as "UpperLegL".
          const bone = body.getObjectByName(name.replace('.', ''));
          if (bone) this.seat.push({ bone, q: bone.quaternion.clone().multiply(turn.setFromEuler(euler.set(x, y, z))) });
        }
      })
      .catch((err) => console.warn('[homestead] avatar failed to load', err));
  }

  /** Play a short gesture over whatever the body is doing. */
  gesture(name: 'Interact' | 'Wave' = 'Interact') {
    const action = this.actions.get(name);
    if (!action || this.riding) return;
    action.reset().setEffectiveWeight(1).fadeIn(0.12).play();
    this.oneShot = action.getClip().duration;
  }

  private to(clip: Clip) {
    if (clip === this.current) return;
    const from = this.actions.get(this.current);
    const next = this.actions.get(clip);
    if (!next) return;
    next.enabled = true;
    next.setEffectiveTimeScale(1).setEffectiveWeight(1);
    if (from) next.crossFadeFrom(from, 0.22, false);
    this.current = clip;
  }

  update(dt: number) {
    this.root.rotation.y = this.heading;
    if (!this.mixer) return;
    if (this.riding) {
      // In the saddle: hold the seat, over the rest pose rather than whatever
      // step the legs were in the middle of.
      for (const r of this.rest) r.bone.quaternion.copy(r.q);
      for (const s of this.seat) s.bone.quaternion.copy(s.q);
      return;
    }
    const s = Math.abs(this.speed);
    this.to(s < 0.15 ? 'Idle' : s < 3.3 ? 'Walk' : 'Run');
    // Match the stride to the ground covered so feet do not slide.
    this.actions.get('Walk')?.setEffectiveTimeScale(THREE.MathUtils.clamp(s / 1.9, 0.6, 1.8));
    this.actions.get('Run')?.setEffectiveTimeScale(THREE.MathUtils.clamp(s / 4.6, 0.75, 1.5));
    if (this.oneShot > 0) {
      this.oneShot -= dt;
      if (this.oneShot <= 0.15) this.actions.get('Interact')?.fadeOut(0.15);
    }
    this.mixer.update(dt);
  }
}
