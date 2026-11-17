/**
 * Inside the cottage: one room, yours to furnish.
 *
 * It is a separate scene with its own light. The walls are single-sided and
 * face inward, so whichever ones stand between the camera and the room are
 * simply not drawn — the room opens like a doll's house from any angle.
 */
import * as THREE from 'three';
import type { Assets } from './assets';
import { surface } from './scans';
import * as act from './game/actions';
import { FLOORS, FURNITURE, ROOM, WALLS, furnitureDef, type FurnitureId } from './game/catalog';
import { meta, type Furniture, type Store } from './game/world';
import type { Spot } from './interact';
import { shapeObject } from './world/placed';
import type { Obstacle } from './world/scatter';

export interface InteriorUi {
  moment(): act.Moment;
  say(out: act.Outcome, at?: THREE.Vector3): void;
  openCook(at: 'fire' | 'stove'): void;
  leaveHouse(): void;
}

/** Where you stand when you come in, and where the way out is. */
export const DOOR = { x: -ROOM.width / 2 + 0.9, z: ROOM.depth / 2 - 1.6 };

/** A plane whose texture repeats every `tile` metres, so boards and plaster keep their real size. */
function tiled(w: number, h: number, tile: number): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * h) / tile);
  return g;
}

export class Interior {
  readonly scene = new THREE.Scene();
  obstacles: Obstacle[] = [];
  private readonly pieces = new Map<string, { doc: Furniture; group: THREE.Group }>();
  private readonly floor: THREE.MeshStandardMaterial;
  private readonly wall: THREE.MeshStandardMaterial;
  private readonly glass: THREE.MeshBasicMaterial;
  private readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  private readonly fill = new THREE.HemisphereLight(0xfff3df, 0x6a5a4a, 0.5);
  private readonly hearth = new THREE.PointLight(0xffa860, 0, 14, 1.6);
  private stale = true;
  private time = 0;

  constructor(
    private readonly assets: Assets,
    private readonly store: Store,
    private readonly ui: InteriorUi,
  ) {
    const { width: w, depth: d, height: h } = ROOM;
    this.scene.background = new THREE.Color(0x14110e);

    // Copies of their own, so painting the room does not repaint the cottage outside.
    this.floor = surface('plank_flooring_02', { own: 'room' });
    const floor = new THREE.Mesh(tiled(w, d, 2.2), this.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    // The ground the cottage stands on, so the room does not float in a void.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x1f1b16, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    this.scene.add(ground);

    this.wall = surface('plastered_wall_04', { own: 'room' });
    const skirting = surface('dark_wooden_planks', { tint: 0xb89878 });
    const frame = skirting;
    this.glass = new THREE.MeshBasicMaterial({ color: 0xbfe0ff });
    const wallAt = (len: number, x: number, z: number, yaw: number, windows: number[], door?: number) => {
      const g = new THREE.Group();
      const plane = new THREE.Mesh(tiled(len, h, 2.4), this.wall);
      plane.position.y = h / 2;
      plane.receiveShadow = true;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.16), skirting);
      board.position.set(0, 0.08, 0.01);
      const rail = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.1), frame);
      rail.position.set(0, h - 0.05, 0.012);
      g.add(plane, board, rail);
      for (const at of windows) {
        const f = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.4), frame);
        f.position.set(at, 1.75, 0.015);
        const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.2), this.glass);
        pane.position.set(at, 1.75, 0.02);
        const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 1.2), frame);
        bar.position.set(at, 1.75, 0.025);
        const bar2 = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.06), frame);
        bar2.position.set(at, 1.75, 0.025);
        g.add(f, pane, bar, bar2);
      }
      if (door !== undefined) {
        const leaf = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 2.2), frame);
        leaf.position.set(door, 1.1, 0.015);
        const knob = new THREE.Mesh(new THREE.CircleGeometry(0.05, 10), new THREE.MeshStandardMaterial({ color: 0xd9b45a, metalness: 1, roughness: 0.35 }));
        knob.position.set(door + 0.4, 1.05, 0.02);
        g.add(leaf, knob);
      }
      g.position.set(x, 0, z);
      g.rotation.y = yaw;
      this.scene.add(g);
    };
    // Oak posts in the corners and a beam along each wall at the eaves.
    const oak = surface('dark_wooden_planks', { tint: 0xa08060 });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.24, h, 0.24), oak);
        post.position.set(sx * (w / 2 - 0.12), h / 2, sz * (d / 2 - 0.12));
        post.castShadow = true;
        this.scene.add(post);
      }
    }
    // Each wall's plane faces into the room.
    wallAt(w, 0, -d / 2, 0, [-2.6, 2.6]);
    wallAt(w, 0, d / 2, Math.PI, [0]);
    wallAt(d, -w / 2, 0, Math.PI / 2, [-1.2], d / 2 - 1.6);
    wallAt(d, w / 2, 0, -Math.PI / 2, [0]);

    this.sun.position.set(4, 9, 6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const cam = this.sun.shadow.camera;
    cam.left = -8;
    cam.right = 8;
    cam.top = 8;
    cam.bottom = -8;
    cam.far = 30;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    this.hearth.position.set(0, 1.2, 0);
    this.scene.add(this.sun, this.fill, this.hearth);

    store.subscribe((name) => {
      if (name === 'furniture' || name === 'meta') this.stale = true;
    });
  }

  private sync() {
    const world = meta(this.store);
    this.wall.color.setHex(WALLS[world.wall]?.tint ?? WALLS[0].tint);
    this.floor.color.setHex(FLOORS[world.floor]?.tint ?? FLOORS[0].tint);

    const docs = this.store.all('furniture');
    for (const [id, piece] of this.pieces) {
      const doc = docs.get(id);
      if (doc && doc.kind === piece.doc.kind) continue;
      this.scene.remove(piece.group);
      this.pieces.delete(id);
    }
    for (const [id, doc] of docs) {
      if (!(doc.kind in FURNITURE)) continue;
      let piece = this.pieces.get(id);
      if (!piece) {
        piece = { doc, group: furnitureObject(this.assets, doc.kind) };
        this.scene.add(piece.group);
        this.pieces.set(id, piece);
      }
      piece.doc = doc;
      piece.group.position.set(doc.x, furnitureDef(doc.kind).flat ? 0.005 : 0, doc.z);
      piece.group.rotation.y = doc.rot;
    }
    this.obstacles = [];
    let warm = false;
    for (const { doc } of this.pieces.values()) {
      const def = furnitureDef(doc.kind);
      if (def.solid > 0 && !def.flat) this.obstacles.push({ x: doc.x, z: doc.z, r: def.solid * 0.8 });
      if (doc.kind === 'fireplace') {
        this.hearth.position.set(doc.x, 0.9, doc.z);
        warm = true;
      }
    }
    this.hearth.userData.lit = warm;
  }

  /**
   * @param daylight 0 at night .. 1 by day
   * @param skyColour what the windows look out on
   */
  update(dt: number, daylight: number, skyColour: THREE.Color) {
    this.time += dt;
    if (this.stale) {
      this.stale = false;
      this.sync();
    }
    this.glass.color.copy(skyColour).multiplyScalar(0.55 + 0.75 * daylight);
    // Daylight comes in at the windows: soft, and much dimmer than outside.
    this.sun.intensity = 0.15 + 1.25 * daylight;
    this.sun.color.setHex(0xfff1d8).lerp(skyColour, 0.25);
    // By night the room is lit from within: lamps, and the fire if there is one.
    this.fill.intensity = 0.18 + 0.22 * daylight;
    this.assets.lampGlow.emissiveIntensity = 0.5 + 1.6 * (1 - daylight);
    const flicker = 0.85 + 0.1 * Math.sin(this.time * 11.3) + 0.06 * Math.sin(this.time * 23.7);
    this.hearth.intensity = this.hearth.userData.lit ? (6 + 12 * (1 - daylight)) * flicker : 0;
  }

  spots(): Spot[] {
    const ui = this.ui;
    const out: Spot[] = [{ x: DOOR.x - 0.5, z: DOOR.z, reach: 1.7, title: 'Door', height: 1.6, actions: [{ key: 'E', label: 'Go outside', run: () => ui.leaveHouse() }] }];
    for (const { doc } of this.pieces.values()) {
      const def = furnitureDef(doc.kind);
      if (!def.use) continue;
      const here = new THREE.Vector3(doc.x, 1.4, doc.z);
      const one = (label: string, fn: () => act.Outcome): Spot => ({
        x: doc.x,
        z: doc.z,
        reach: def.solid + 1.2,
        title: def.name,
        height: 1.2,
        actions: [{ key: 'E', label, run: () => ui.say(fn(), here) }],
      });
      if (def.use === 'cook') {
        out.push({ x: doc.x, z: doc.z, reach: def.solid + 1.2, title: def.name, height: 1.2, actions: [{ key: 'E', label: 'Cook', run: () => ui.openCook(doc.kind === 'stove' ? 'stove' : 'fire') }] });
      } else if (def.use === 'sleep') out.push(one('Sleep until morning', () => act.sleep(this.store, ui.moment())));
      else if (def.use === 'bathe') out.push(one('Have a bath', () => act.bathe(this.store, ui.moment())));
      else if (def.use === 'eat') out.push(one('Sit down to a meal', () => act.shareMeal(this.store, ui.moment())));
      else if (def.use === 'sit') out.push(one('Sit a while', () => act.sit(this.store, ui.moment())));
    }
    return out;
  }

  /** The piece of furniture nearest a point, for moving and selling. */
  near(x: number, z: number, within: number): { id: string; doc: Furniture } | null {
    let best: { id: string; doc: Furniture } | null = null;
    let bestD = within;
    for (const [id, { doc }] of this.pieces) {
      const d = Math.hypot(doc.x - x, doc.z - z);
      if (d < bestD) {
        bestD = d;
        best = { id, doc };
      }
    }
    return best;
  }
}

export function furnitureObject(assets: Assets, kind: FurnitureId): THREE.Group {
  return shapeObject(assets, furnitureDef(kind).shape);
}
