/**
 * Third-person camera: sits behind and above the rider, swings round with the
 * horse, and lets you drag to look about. It never goes underground.
 */
import * as THREE from 'three';
import type { Input } from './input';
import type { Terrain } from './world/terrain';
import { angleTo } from './entities/creature';

export class FollowCamera {
  readonly camera = new THREE.PerspectiveCamera(52, 1, 0.3, 1400);
  /** Angle round the rider; 0 looks along +Z. */
  yaw = Math.PI;
  /** Angle above the horizon. */
  pitch = 0.2;
  distance = 9.5;
  /** Seconds since the player last dragged; the camera drifts back behind after a pause. */
  private idle = 10;
  private readonly focus = new THREE.Vector3();
  private readonly want = new THREE.Vector3();
  private started = false;

  update(dt: number, input: Input, target: THREE.Vector3, heading: number, speed: number, terrain: Terrain) {
    if (input.dragging && (input.dragX || input.dragY)) {
      this.yaw -= input.dragX * 0.0052;
      this.pitch = THREE.MathUtils.clamp(this.pitch + input.dragY * 0.004, -0.12, 1.25);
      this.idle = 0;
    } else {
      this.idle += dt;
    }
    if (input.wheel) this.distance = THREE.MathUtils.clamp(this.distance * Math.exp(input.wheel * 0.0011), 4, 26);

    // Once you let go and ride on, the view eases back to over the horse's shoulder.
    if (this.idle > 1.6 && Math.abs(speed) > 0.6) {
      const behind = heading + Math.PI;
      const pull = Math.min(Math.abs(speed) / 6, 1.4) * (speed < 0 ? 0.3 : 1);
      this.yaw += angleTo(this.yaw, behind) * (1 - Math.exp(-dt * 1.5 * pull));
    }

    // Look a little above the saddle, and lead slightly when moving fast.
    this.want.copy(target);
    this.want.y += 1.9;
    this.want.x += Math.sin(heading) * speed * 0.14;
    this.want.z += Math.cos(heading) * speed * 0.14;
    if (!this.started) {
      this.focus.copy(this.want);
      this.started = true;
    }
    this.focus.lerp(this.want, 1 - Math.exp(-dt * 9));

    const cp = Math.cos(this.pitch);
    const cam = this.camera.position;
    cam.set(
      this.focus.x + Math.sin(this.yaw) * cp * this.distance,
      this.focus.y + Math.sin(this.pitch) * this.distance,
      this.focus.z + Math.cos(this.yaw) * cp * this.distance,
    );
    const floor = terrain.height(cam.x, cam.z) + 0.7;
    if (cam.y < floor) cam.y = floor;
    this.camera.lookAt(this.focus);

    // A gallop widens the view a touch; you feel the speed more than see it.
    const fov = 52 + THREE.MathUtils.smoothstep(Math.abs(speed), 6, 11.5) * 7;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 3));
      this.camera.updateProjectionMatrix();
    }
  }
}
