/**
 * Third-person camera: sits behind and above you, lets you drag to look
 * about, and never goes underground. Riding, it swings round to follow the
 * horse; on foot it stays where you put it, because "forward" is measured
 * from it and a camera that turned by itself would turn you with it.
 */
import * as THREE from 'three';
import { angleTo } from './entities/creature';
import type { Input } from './input';
import type { Terrain } from './world/terrain';

export type View = 'ride' | 'foot' | 'room';

const VIEW = {
  ride: { height: 1.9, near: 4, far: 26, floor: -0.12, start: 9.5 },
  foot: { height: 1.45, near: 2.6, far: 20, floor: -0.05, start: 6.2 },
  room: { height: 1.0, near: 5, far: 15, floor: 0.42, start: 10.5 },
} as const;

export class FollowCamera {
  readonly camera = new THREE.PerspectiveCamera(52, 1, 0.3, 1600);
  /** Angle round you; 0 looks along +Z. */
  yaw = 0;
  /** Angle above the horizon. */
  pitch = 0.24;
  distance: number = VIEW.foot.start;
  private idle = 10;
  private readonly focus = new THREE.Vector3();
  private readonly want = new THREE.Vector3();
  private view: View = 'foot';
  private started = false;

  /** Jump straight to the target next frame instead of easing (after going through a door). */
  cut(view: View) {
    this.started = false;
    if (view !== this.view) {
      this.view = view;
      this.distance = VIEW[view].start;
      if (view === 'room') {
        this.pitch = 0.72;
        this.yaw = 0;
      } else if (this.pitch > 0.6) this.pitch = 0.24;
    }
  }

  update(dt: number, input: Input, view: View, target: THREE.Vector3, heading: number, speed: number, terrain: Terrain | null) {
    if (view !== this.view) {
      // Mounting or dismounting: keep looking the same way, change the framing.
      this.distance = VIEW[view].start;
      this.view = view;
    }
    const v = VIEW[view];
    if (input.dragging && (input.dragX || input.dragY)) {
      this.yaw -= input.dragX * 0.0052;
      this.pitch = THREE.MathUtils.clamp(this.pitch + input.dragY * 0.004, v.floor, 1.3);
      this.idle = 0;
    } else {
      this.idle += dt;
    }
    if (input.wheel) this.distance = THREE.MathUtils.clamp(this.distance * Math.exp(input.wheel * 0.0011), v.near, v.far);
    this.pitch = Math.max(this.pitch, v.floor);

    // In the saddle, once you let go and ride on, the view eases back to over the horse's shoulder.
    if (view === 'ride' && this.idle > 1.6 && Math.abs(speed) > 0.6) {
      const pull = Math.min(Math.abs(speed) / 6, 1.4) * (speed < 0 ? 0.3 : 1);
      this.yaw += angleTo(this.yaw, heading + Math.PI) * (1 - Math.exp(-dt * 1.5 * pull));
    }

    this.want.copy(target);
    this.want.y += v.height;
    if (view === 'ride') {
      // Lead slightly when moving fast.
      this.want.x += Math.sin(heading) * speed * 0.14;
      this.want.z += Math.cos(heading) * speed * 0.14;
    }
    if (!this.started) {
      this.focus.copy(this.want);
      this.started = true;
    }
    this.focus.lerp(this.want, 1 - Math.exp(-dt * 9));

    const cp = Math.cos(this.pitch);
    const cam = this.camera.position;
    cam.set(this.focus.x + Math.sin(this.yaw) * cp * this.distance, this.focus.y + Math.sin(this.pitch) * this.distance, this.focus.z + Math.cos(this.yaw) * cp * this.distance);
    if (terrain) {
      const floor = terrain.height(cam.x, cam.z) + 0.6;
      if (cam.y < floor) cam.y = floor;
    }
    this.camera.lookAt(this.focus);

    // A gallop widens the view a touch; you feel the speed more than see it.
    const fov = view === 'room' ? 44 : 52 + THREE.MathUtils.smoothstep(Math.abs(speed), 6, 11.5) * 7;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 3));
      this.camera.updateProjectionMatrix();
    }
  }
}
