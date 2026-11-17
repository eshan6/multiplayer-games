/**
 * Placing things: a translucent preview follows the pointer over the ground,
 * green where it can go and red where it cannot; a click sets it down.
 *
 * The same tool works outdoors (buildings, fences, trees) and indoors
 * (furniture), and doubles as the way to move or remove what is already there.
 */
import * as THREE from 'three';
import type { Assets } from './assets';
import * as act from './game/actions';
import { ROOM, STRUCTURES, furnitureDef, type FurnitureId, type StructureId } from './game/catalog';
import type { Store } from './game/world';
import { furnitureObject, type Interior } from './interior';
import { WORLD, waterDepth } from './world/land';
import { ghostify, shapeObject } from './world/placed';
import type { Obstacle } from './world/scatter';
import type { Structures } from './world/structures';
import type { Terrain } from './world/terrain';

export type Tool =
  | { type: 'structure'; kind: StructureId }
  | { type: 'furniture'; kind: FurnitureId }
  | { type: 'move'; id: string; kind: FurnitureId }
  | { type: 'remove' }
  | { type: 'pick' };

const OK = new THREE.MeshBasicMaterial({ color: 0x8fe08a, transparent: true, opacity: 0.55, depthWrite: false });
const BAD = new THREE.MeshBasicMaterial({ color: 0xf07a6a, transparent: true, opacity: 0.55, depthWrite: false });

/** How far from yourself you can build. */
const REACH = 24;

export class Builder {
  tool: Tool | null = null;
  /** Why the preview is red, if it is. Shown to the player. */
  problem = '';
  private ghost: THREE.Object3D | null = null;
  private readonly marker: THREE.Mesh;
  private rot = 0;
  private readonly at = new THREE.Vector3();
  private hasPoint = false;
  private valid = false;
  private target: { id: string; x: number; z: number } | null = null;
  private readonly ray = new THREE.Raycaster();
  private readonly floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(
    private readonly assets: Assets,
    private readonly store: Store,
    private readonly terrain: Terrain,
    private readonly structures: Structures,
    private readonly interior: Interior,
    private readonly fixed: Obstacle[],
  ) {
    // A ring on the ground that marks what "take down" or "move" would act on.
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.05, 28), BAD);
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.marker.renderOrder = 4;
  }

  use(tool: Tool | null, scene: THREE.Object3D) {
    this.ghost?.removeFromParent();
    this.ghost = null;
    this.marker.removeFromParent();
    this.tool = tool;
    this.problem = '';
    this.target = null;
    if (!tool) return;
    scene.add(this.marker);
    this.marker.visible = false;
    if (tool.type === 'structure') this.ghost = shapeObject(this.assets, STRUCTURES[tool.kind].shape);
    else if (tool.type === 'furniture' || tool.type === 'move') this.ghost = furnitureObject(this.assets, tool.kind);
    if (this.ghost) {
      ghostify(this.ghost, OK);
      this.ghost.visible = false;
      scene.add(this.ghost);
    }
    if (tool.type !== 'move') this.rot = 0;
  }

  /** Quarter turns indoors, finer outdoors. */
  rotate(indoors: boolean) {
    this.rot = (this.rot + (indoors ? Math.PI / 2 : Math.PI / 12)) % (Math.PI * 2);
  }

  /** Where the pointer's ray meets the ground. */
  private aim(ndc: THREE.Vector2, camera: THREE.Camera, indoors: boolean): boolean {
    this.ray.setFromCamera(ndc, camera);
    const { origin, direction } = this.ray.ray;
    if (indoors) return this.ray.ray.intersectPlane(this.floorPlane, this.at) !== null;
    if (direction.y > -0.02) return false;
    // March down the ray until it goes underground, then close in on the crossing.
    let prev = 0;
    for (let t = 1; t < 140; t += 1) {
      const x = origin.x + direction.x * t;
      const z = origin.z + direction.z * t;
      if (origin.y + direction.y * t <= this.terrain.height(x, z)) {
        let lo = prev;
        let hi = t;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          const mx = origin.x + direction.x * mid;
          const mz = origin.z + direction.z * mid;
          if (origin.y + direction.y * mid <= this.terrain.height(mx, mz)) hi = mid;
          else lo = mid;
        }
        this.at.set(origin.x + direction.x * hi, 0, origin.z + direction.z * hi);
        this.at.y = this.terrain.height(this.at.x, this.at.z);
        return true;
      }
      prev = t;
    }
    return false;
  }

  /** Call each frame while a tool is active. */
  update(ndc: THREE.Vector2, camera: THREE.Camera, you: THREE.Vector3, indoors: boolean) {
    const tool = this.tool;
    if (!tool) return;
    this.hasPoint = this.aim(ndc, camera, indoors);
    this.valid = false;
    this.problem = '';
    this.target = null;
    this.marker.visible = false;
    if (this.ghost) this.ghost.visible = this.hasPoint;
    if (!this.hasPoint) return;

    if (tool.type === 'remove' || tool.type === 'pick') {
      const hit = indoors ? this.interior.near(this.at.x, this.at.z, 1.6) : tool.type === 'remove' ? this.structures.near(this.at.x, this.at.z, 3) : null;
      if (hit) {
        const p = 'doc' in hit ? hit.doc : hit;
        this.target = { id: hit.id, x: p.x, z: p.z };
        this.marker.visible = true;
        this.marker.material = tool.type === 'remove' ? BAD : OK;
        this.marker.position.set(p.x, (indoors ? 0 : this.terrain.height(p.x, p.z)) + 0.06, p.z);
        this.valid = true;
      }
      return;
    }

    let x = this.at.x;
    let z = this.at.z;
    let rot = this.rot;
    if (indoors) {
      // Furniture sits on a quarter-metre grid: easier to line a chair up with a table.
      x = Math.round(x * 4) / 4;
      z = Math.round(z * 4) / 4;
      const def = furnitureDef((tool as { kind: FurnitureId }).kind);
      const edge = Math.max(def.solid * 0.7, 0.2);
      x = THREE.MathUtils.clamp(x, -ROOM.width / 2 + edge, ROOM.width / 2 - edge);
      z = THREE.MathUtils.clamp(z, -ROOM.depth / 2 + edge, ROOM.depth / 2 - edge);
      this.valid = true;
      if (!def.flat && def.solid > 0) {
        const skip = tool.type === 'move' ? tool.id : '';
        for (const [id, f] of this.store.all('furniture')) {
          if (id === skip || furnitureDef(f.kind).flat) continue;
          if (Math.hypot(f.x - x, f.z - z) < (furnitureDef(f.kind).solid + def.solid) * 0.62) {
            this.valid = false;
            this.problem = 'Something is in the way.';
          }
        }
      }
    } else if (tool.type === 'structure') {
      const def = STRUCTURES[tool.kind];
      if ('snaps' in def && def.snaps) [x, z, rot] = this.snap(tool.kind, def.snaps, x, z, rot);
      this.valid = this.fits(tool.kind, x, z, you);
    }
    if (this.ghost) {
      this.ghost.position.set(x, indoors ? 0.01 : this.terrain.height(x, z) + 0.02, z);
      this.ghost.rotation.y = rot;
      ghostify(this.ghost, this.valid ? OK : BAD);
    }
    this.at.x = x;
    this.at.z = z;
    this.placeRot = rot;
  }

  private placeRot = 0;

  /**
   * Continue a run of fence or path: if the pointer is near the end of an
   * existing piece, the new one starts exactly there, in line with it unless
   * you have turned it.
   */
  private snap(kind: StructureId, length: number, x: number, z: number, rot: number): [number, number, number] {
    let best: [number, number, number] | null = null;
    let bestD = 1.6;
    const along = kind === 'fence' ? (r: number): [number, number] => [Math.cos(r), -Math.sin(r)] : (r: number): [number, number] => [Math.sin(r), Math.cos(r)];
    for (const n of this.structures.neighbours(kind, x, z, length * 1.6)) {
      const [nx, nz] = along(n.rot);
      for (const end of [1, -1]) {
        const ex = n.x + nx * (length / 2) * end;
        const ez = n.z + nz * (length / 2) * end;
        // Straight on by default; a turn of the piece makes a corner here instead.
        const turned = Math.abs(Math.sin(rot - n.rot)) > 0.2;
        const r = turned ? rot : n.rot;
        const [dx, dz] = along(r);
        for (const sign of turned ? [1, -1] : [end]) {
          const cx = ex + dx * (length / 2) * sign;
          const cz = ez + dz * (length / 2) * sign;
          const d = Math.hypot(cx - x, cz - z);
          if (d < bestD) {
            bestD = d;
            best = [cx, cz, r];
          }
        }
      }
    }
    return best ?? [x, z, rot];
  }

  private fits(kind: StructureId, x: number, z: number, you: THREE.Vector3): boolean {
    const def = STRUCTURES[kind];
    const fail = (why: string) => {
      this.problem = why;
      return false;
    };
    if (Math.hypot(x - you.x, z - you.z) > REACH) return fail('Too far away. Walk closer.');
    if (Math.hypot(x, z) > WORLD.playRadius - 6) return fail('That is the edge of your land.');
    const margin = Math.max(def.solid, 0.4);
    for (const [dx, dz] of [[0, 0], [margin, 0], [-margin, 0], [0, margin], [0, -margin]] as const) {
      if (waterDepth(x + dx, z + dz, this.terrain.height(x + dx, z + dz)) > -0.15) return fail('Too wet.');
    }
    if (def.solid > 0) {
      for (const o of [...this.fixed, ...this.structures.obstacles]) {
        if (Math.abs(o.x - x) > 12 || Math.abs(o.z - z) > 12) continue;
        if (Math.hypot(o.x - x, o.z - z) < o.r + def.solid * 0.85) return fail('Something is in the way.');
      }
    }
    const why = act.whyNotBuild(this.store, kind);
    return why ? fail(why) : true;
  }

  /** Where the tool is pointing, if anywhere. */
  spot(): { x: number; z: number } | null {
    return this.hasPoint ? { x: this.at.x, z: this.at.z } : null;
  }

  /** The player clicked. Returns what happened, or null if the click meant nothing. */
  click(m: act.Moment, scene: THREE.Object3D): act.Outcome | null {
    const tool = this.tool;
    if (!tool || !this.hasPoint) return null;
    if (tool.type === 'remove') {
      if (!this.target) return null;
      return this.store.all('furniture').has(this.target.id) ? act.removeFurniture(this.store, m, this.target.id) : act.demolish(this.store, m, this.target.id);
    }
    if (tool.type === 'pick') {
      const f = this.target && this.store.all('furniture').get(this.target.id);
      if (!f || !this.target) return null;
      this.rot = f.rot;
      this.use({ type: 'move', id: this.target.id, kind: f.kind }, scene);
      return null;
    }
    if (!this.valid) return { ok: false, say: this.problem || 'It will not go there.' };
    if (tool.type === 'structure') return act.build(this.store, m, tool.kind, this.at.x, this.at.z, this.placeRot);
    if (tool.type === 'furniture') return act.furnish(this.store, m, tool.kind, this.at.x, this.at.z, this.placeRot);
    act.moveFurniture(this.store, tool.id, this.at.x, this.at.z, this.placeRot);
    this.use({ type: 'pick' }, scene);
    return { ok: true, say: 'Moved.' };
  }
}
