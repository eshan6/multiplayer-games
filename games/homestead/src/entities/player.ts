/**
 * You: on foot, in the saddle, or indoors.
 *
 * `step()` moves you one frame from what the keys ask for and resolves what
 * you bump into. Outdoors that is the terrain, trees, buildings and fences;
 * indoors it is the walls of the room and the furniture in it.
 */
import * as THREE from 'three';
import { ROOM, type AvatarId } from '../game/catalog';
import type { Input } from '../input';
import { WORLD, waterDepth } from '../world/land';
import type { Obstacle, Wall } from '../world/scatter';
import type { Terrain } from '../world/terrain';
import { Avatar } from './avatar';
import { angleTo, type Creature } from './creature';

export const PACE = { stroll: 2.1, jog: 4.7, sprint: 6.6, amble: 2.3, canter: 6.4, gallop: 11.5, reverse: -1.3 } as const;

/** A horse will wade this deep and no deeper; on foot, you stop at the knees. */
const WADE = { ride: 0.55, foot: 0.4 };
const SEAT = { lift: -0.43, back: 0.05, lean: 0.06 };

export interface Solid {
  obstacles: Obstacle[];
  walls: Wall[];
}

/** Push a point out of every circle and away from every wall segment. */
function resolve(x: number, z: number, girth: number, lists: Solid[]): [number, number] {
  for (const solid of lists) {
    for (const o of solid.obstacles) {
      const dx = x - o.x;
      const dz = z - o.z;
      const min = o.r + girth;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min || d2 === 0) continue;
      const d = Math.sqrt(d2);
      x = o.x + (dx / d) * min;
      z = o.z + (dz / d) * min;
    }
    for (const w of solid.walls) {
      const wx = w.x2 - w.x1;
      const wz = w.z2 - w.z1;
      const t = THREE.MathUtils.clamp(((x - w.x1) * wx + (z - w.z1) * wz) / (wx * wx + wz * wz || 1), 0, 1);
      const cx = w.x1 + wx * t;
      const cz = w.z1 + wz * t;
      const dx = x - cx;
      const dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= girth * girth || d2 === 0) continue;
      const d = Math.sqrt(d2);
      x = cx + (dx / d) * girth;
      z = cz + (dz / d) * girth;
    }
  }
  return [x, z];
}

export class Player {
  readonly avatar: Avatar;
  /** Where you are: outdoors in the world, or indoors in room coordinates. */
  readonly position = new THREE.Vector3(3, 0, 5);
  heading = Math.PI;
  speed = 0;
  indoors = false;
  /** When on, you stroll (or the horse walks) instead of the default pace. */
  easy = false;
  /** The animal you are riding. */
  mount: { id: string; horse: Creature } | null = null;
  private steer = 0;
  private bob: number | null = null;
  private readonly seat = new THREE.Vector3();
  private seatBone: THREE.Object3D | undefined;
  private idleFor = 0;

  constructor(avatar: AvatarId) {
    this.avatar = new Avatar(avatar);
  }

  ride(id: string, horse: Creature) {
    this.mount = { id, horse };
    this.seatBone = horse.bone('Torso2') ?? horse.bone('Torso');
    this.bob = null;
    this.heading = horse.heading;
    this.speed = 0;
    this.avatar.riding = true;
    this.position.copy(horse.root.position);
    horse.root.add(this.avatar.root);
    this.avatar.heading = 0;
  }

  /** Step down on the horse's near side. */
  dismount(scene: THREE.Object3D) {
    if (!this.mount) return;
    const h = this.mount.horse;
    h.speed = 0;
    h.setGait('idle');
    scene.add(this.avatar.root);
    this.avatar.riding = false;
    this.position.set(h.root.position.x + Math.cos(h.heading) * 1.5, 0, h.root.position.z - Math.sin(h.heading) * 1.5);
    this.heading = h.heading;
    this.speed = 0;
    this.mount = null;
  }

  /**
   * @param cameraYaw which way the camera is looking from, so that on foot
   *   "forward" means away from the camera
   */
  step(dt: number, input: Input, cameraYaw: number, terrain: Terrain, solids: Solid[]) {
    const forward = input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
    const side = input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
    const fast = input.held('ShiftLeft', 'ShiftRight');
    if (this.mount) this.stepRiding(dt, forward, side, fast, terrain, solids);
    else this.stepWalking(dt, forward, side, fast, cameraYaw, terrain, solids);
  }

  private stepWalking(dt: number, forward: number, side: number, fast: boolean, cameraYaw: number, terrain: Terrain, solids: Solid[]) {
    // The camera looks along (-sin yaw, -cos yaw); that is "forward" on foot.
    const fx = -Math.sin(cameraYaw);
    const fz = -Math.cos(cameraYaw);
    let mx = fx * forward - fz * side;
    let mz = fz * forward + fx * side;
    const len = Math.hypot(mx, mz);
    const want = len > 0 ? (fast ? PACE.sprint : this.easy ? PACE.stroll : PACE.jog) : 0;
    if (len > 0) {
      mx /= len;
      mz /= len;
      const turn = angleTo(this.heading, Math.atan2(mx, mz));
      this.heading += turn * (1 - Math.exp(-dt * 13));
    }
    const rate = want > this.speed ? 22 : 30;
    this.speed += THREE.MathUtils.clamp(want - this.speed, -rate * dt, rate * dt);

    const p = this.position;
    let nx = p.x + Math.sin(this.heading) * this.speed * dt;
    let nz = p.z + Math.cos(this.heading) * this.speed * dt;
    if (this.indoors) {
      [nx, nz] = resolve(nx, nz, 0.3, solids);
      nx = THREE.MathUtils.clamp(nx, -ROOM.width / 2 + 0.35, ROOM.width / 2 - 0.35);
      nz = THREE.MathUtils.clamp(nz, -ROOM.depth / 2 + 0.35, ROOM.depth / 2 - 0.35);
      p.set(nx, 0, nz);
    } else {
      [nx, nz] = this.bound(p, nx, nz, 0.35, WADE.foot, terrain, solids);
      p.set(nx, terrain.height(nx, nz), nz);
    }
    this.avatar.root.position.copy(p);
    this.avatar.heading = this.heading;
    this.avatar.speed = this.speed;
    this.avatar.update(dt);
  }

  /** Collide, stay in the world, and keep out of deep water. */
  private bound(p: THREE.Vector3, nx: number, nz: number, girth: number, wade: number, terrain: Terrain, solids: Solid[]): [number, number] {
    [nx, nz] = resolve(nx, nz, girth, solids);
    const out = Math.hypot(nx, nz);
    if (out > WORLD.playRadius) {
      nx *= WORLD.playRadius / out;
      nz *= WORLD.playRadius / out;
    }
    const tooDeep = (x: number, z: number) => waterDepth(x, z, terrain.height(x, z)) > wade;
    if (tooDeep(nx, nz)) {
      if (!tooDeep(nx, p.z)) nz = p.z;
      else if (!tooDeep(p.x, nz)) nx = p.x;
      else return [p.x, p.z];
    }
    return [nx, nz];
  }

  private stepRiding(dt: number, forward: number, side: number, fast: boolean, terrain: Terrain, solids: Solid[]) {
    const h = this.mount!.horse;
    const want = forward > 0 ? (fast ? PACE.gallop : this.easy ? PACE.amble : PACE.canter) : forward < 0 ? PACE.reverse : 0;
    // A horse gathers speed over a few strides and pulls up rather quicker.
    const rate = Math.abs(want) > Math.abs(h.speed) ? 5.5 : 9;
    h.speed += THREE.MathUtils.clamp(want - h.speed, -rate * dt, rate * dt);

    // Turning is tight at a walk and wide at a gallop.
    this.steer += (side - this.steer) * (1 - Math.exp(-dt * 7));
    const quick = THREE.MathUtils.smoothstep(Math.abs(h.speed), 2, PACE.gallop);
    // Backing up steers the other way, as it does on anything with a front end.
    h.heading -= this.steer * THREE.MathUtils.lerp(2.1, 1.25, quick) * dt * (h.speed < -0.1 ? -1 : 1);

    const p = h.root.position;
    const [nx, nz] = this.bound(p, p.x + Math.sin(h.heading) * h.speed * dt, p.z + Math.cos(h.heading) * h.speed * dt, 0.75, WADE.ride, terrain, solids);
    // If something stopped us, the horse should slow rather than gallop on the spot.
    const moved = Math.hypot(nx - p.x, nz - p.z);
    const asked = Math.abs(h.speed) * dt;
    if (asked > 1e-5 && moved < asked * 0.5) h.speed *= Math.pow(0.02, dt);
    p.x = nx;
    p.z = nz;

    const s = Math.abs(h.speed);
    if (s < 0.12) {
      this.idleFor += dt;
      // Left standing, a horse does not hold a pose: it drops its head to graze.
      h.setGait(this.idleFor > 9 ? 'eat' : this.idleFor > 5 ? 'idleAlt' : 'idle', 0.6);
    } else {
      this.idleFor = 0;
      h.setGait(s < 3.6 ? 'walk' : 'run', 0.28);
    }
    h.update(dt, terrain, -this.steer * 0.16 * quick);

    this.position.copy(p);
    this.heading = h.heading;
    this.speed = h.speed;
    seatRider(this.avatar, h, this.seatBone, this.seat, this, dt, quick, this.steer);
  }

  /** Holds the saddle height between frames. */
  seatHeight(next: number, dt: number): number {
    this.bob = this.bob === null ? next : this.bob + (next - this.bob) * (1 - Math.exp(-dt * 22));
    return this.bob;
  }
}

/** Keep a rider in the saddle as the horse's back rises and falls. */
export function seatRider(avatar: Avatar, horse: Creature, seatBone: THREE.Object3D | undefined, scratch: THREE.Vector3, smooth: { seatHeight(next: number, dt: number): number }, dt: number, quick: number, steer: number) {
  let y = 1.35;
  let z = 0;
  if (seatBone) {
    horse.root.updateMatrixWorld(true);
    seatBone.getWorldPosition(scratch);
    horse.root.worldToLocal(scratch);
    // Follow the back's height closely, but never its sideways wobble.
    y = smooth.seatHeight(scratch.y, dt);
    z = scratch.z;
  }
  avatar.root.position.set(0, y + SEAT.lift, z + SEAT.back);
  avatar.root.rotation.set(SEAT.lean + quick * 0.22, 0, steer * 0.12 * quick);
  avatar.heading = 0;
  avatar.riding = true;
  avatar.update(dt);
  // Avatar.update turns the root to its heading; restore the lean it overwrote.
  avatar.root.rotation.set(SEAT.lean + quick * 0.22, 0, steer * 0.12 * quick);
}
