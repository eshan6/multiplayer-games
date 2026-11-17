/**
 * Your partner, as you see them: an avatar that follows the position their
 * game is broadcasting, eased so that thirty updates a second looks like
 * someone walking rather than someone teleporting.
 */
import * as THREE from 'three';
import type { Peer, Store } from '../game/world';
import type { Terrain } from '../world/terrain';
import { Avatar } from './avatar';
import { angleTo } from './creature';
import { MOVES, isMove } from './moves';
import { seatRider } from './player';
import type { Stock } from './stock';

interface Shown {
  avatar: Avatar;
  x: number;
  z: number;
  heading: number;
  speed: number;
  riding: string;
  indoors: boolean;
  bob: number | null;
  scratch: THREE.Vector3;
  doing: string;
}

export class Peers {
  private readonly shown = new Map<string, Shown>();

  constructor(
    private readonly store: Store,
    private readonly stock: Stock,
    private readonly terrain: Terrain,
  ) {}

  /** Everyone else, for the "who is here" list and the together bonus. */
  list(): Peer[] {
    return this.store.peers();
  }

  /** True when a partner is in the same place as you and within `range` metres. */
  near(x: number, z: number, indoors: boolean, range: number): boolean {
    return this.list().some((p) => p.indoors === indoors && (indoors || Math.hypot(p.x - x, p.z - z) < range));
  }

  /**
   * @param outdoors scene that holds people who are outside
   * @param indoorsScene scene that holds people who are in the cottage
   */
  update(dt: number, outdoors: THREE.Object3D, indoorsScene: THREE.Object3D) {
    const peers = this.list();
    const live = new Set(peers.map((p) => p.id));
    for (const [id, s] of this.shown) {
      if (live.has(id)) continue;
      s.avatar.root.removeFromParent();
      if (s.riding) this.stock.ridden.delete(s.riding);
      this.shown.delete(id);
    }
    for (const p of peers) {
      let s = this.shown.get(p.id);
      if (!s) {
        s = { avatar: new Avatar(p.avatar), x: p.x, z: p.z, heading: p.heading, speed: 0, riding: '', indoors: p.indoors, bob: null, scratch: new THREE.Vector3(), doing: '' };
        this.shown.set(p.id, s);
      }
      s.avatar.wear(p.avatar);
      // Ease toward where they say they are; snap if they are suddenly far
      // (they went through the door, or the connection hiccupped).
      const far = Math.hypot(p.x - s.x, p.z - s.z) > 12 || p.indoors !== s.indoors;
      const k = far ? 1 : 1 - Math.exp(-dt * 12);
      s.x += (p.x - s.x) * k;
      s.z += (p.z - s.z) * k;
      s.heading += angleTo(s.heading, p.heading) * k;
      s.speed += (p.speed - s.speed) * k;
      s.indoors = p.indoors;

      // Whatever they are doing, play it here too: by name, from our own list.
      if (p.doing !== s.doing) {
        s.doing = p.doing;
        if (isMove(p.doing)) s.avatar.perform(MOVES[p.doing]);
      }
      if (s.riding !== p.riding) {
        if (s.riding) this.stock.ridden.delete(s.riding);
        s.riding = p.riding;
        s.bob = null;
        if (p.riding) this.stock.ridden.add(p.riding);
      }
      const horse = p.riding ? this.stock.creature(p.riding) : null;
      if (horse && !p.indoors) {
        // Their horse goes where they do, and they sit on it.
        horse.root.position.x = s.x;
        horse.root.position.z = s.z;
        horse.heading = s.heading;
        horse.speed = s.speed;
        horse.setGait(Math.abs(s.speed) < 0.12 ? 'idle' : Math.abs(s.speed) < 3.6 ? 'walk' : 'run', 0.28);
        horse.update(dt, this.terrain);
        if (s.avatar.root.parent !== horse.root) horse.root.add(s.avatar.root);
        const shown = s;
        seatRider(s.avatar, horse, horse.bone('Torso2') ?? horse.bone('Torso'), s.scratch, { seatHeight: (next, d) => (shown.bob = shown.bob === null ? next : shown.bob + (next - shown.bob) * (1 - Math.exp(-d * 22))) }, dt, THREE.MathUtils.smoothstep(Math.abs(s.speed), 2, 11.5), 0);
        continue;
      }
      const scene = p.indoors ? indoorsScene : outdoors;
      if (s.avatar.root.parent !== scene) scene.add(s.avatar.root);
      s.avatar.riding = false;
      s.avatar.root.rotation.set(0, 0, 0);
      s.avatar.root.position.set(s.x, p.indoors ? 0 : this.terrain.height(s.x, s.z), s.z);
      s.avatar.heading = s.heading;
      s.avatar.speed = s.speed;
      s.avatar.update(dt);
    }
  }
}
