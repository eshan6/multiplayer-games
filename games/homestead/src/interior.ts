/**
 * Inside the cottage: one room, yours to furnish.
 *
 * It is a separate scene with its own light. The walls are single-sided and
 * face inward, so whichever ones stand between the camera and the room are
 * simply not drawn — the room opens like a doll's house from any angle.
 */
import * as THREE from 'three';
import { modelOf, type Assets } from './assets';
import * as act from './game/actions';
import { FLOORS, FURNITURE, ROOM, WALLS, furnitureDef, type FurnitureId } from './game/catalog';
import { meta, type Furniture, type Store } from './game/world';
import type { Spot } from './interact';
import { fitScale, instantiate } from './world/placed';
import type { Obstacle } from './world/scatter';

export interface InteriorUi {
  moment(): act.Moment;
  say(out: act.Outcome, at?: THREE.Vector3): void;
  openCook(at: 'fire' | 'stove'): void;
  leaveHouse(): void;
}

/** Where you stand when you come in, and where the way out is. */
export const DOOR = { x: -ROOM.width / 2 + 0.9, z: ROOM.depth / 2 - 1.6 };

function plankTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d')!;
  // Boards of slightly different shades, with dark joints and the odd butt end.
  const boards = 8;
  for (let i = 0; i < boards; i++) {
    const shade = 205 + Math.floor(Math.sin(i * 12.9898) * 43758.5453 % 1 * 40);
    g.fillStyle = `rgb(${shade},${shade},${shade})`;
    g.fillRect((i * 512) / boards, 0, 512 / boards, 512);
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect((i * 512) / boards, 0, 2, 512);
    g.fillRect((i * 512) / boards, ((i * 197) % 512), 512 / boards, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(ROOM.width / 2.4, ROOM.depth / 2.4);
  t.anisotropy = 8;
  return t;
}

export class Interior {
  readonly scene = new THREE.Scene();
  obstacles: Obstacle[] = [];
  private readonly pieces = new Map<string, { doc: Furniture; group: THREE.Group }>();
  private readonly floor: THREE.MeshLambertMaterial;
  private readonly wall: THREE.MeshLambertMaterial;
  private readonly glass: THREE.MeshBasicMaterial;
  private readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  private readonly fill = new THREE.HemisphereLight(0xfff3df, 0x6a5a4a, 1.2);
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

    this.floor = new THREE.MeshLambertMaterial({ map: plankTexture() });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), this.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    // The ground the cottage stands on, so the room does not float in a void.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshLambertMaterial({ color: 0x1f1b16 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    this.scene.add(ground);

    this.wall = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const skirting = new THREE.MeshLambertMaterial({ color: 0x6f4a30 });
    const frame = new THREE.MeshLambertMaterial({ color: 0x5c3d28 });
    this.glass = new THREE.MeshBasicMaterial({ color: 0xbfe0ff });
    const wallAt = (len: number, x: number, z: number, yaw: number, windows: number[], door?: number) => {
      const g = new THREE.Group();
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(len, h), this.wall);
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
        const knob = new THREE.Mesh(new THREE.CircleGeometry(0.05, 10), new THREE.MeshLambertMaterial({ color: 0xd9b45a }));
        knob.position.set(door + 0.4, 1.05, 0.02);
        g.add(leaf, knob);
      }
      g.position.set(x, 0, z);
      g.rotation.y = yaw;
      this.scene.add(g);
    };
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
    this.sun.intensity = 0.35 + 2.3 * daylight;
    this.sun.color.setHex(0xfff1d8).lerp(skyColour, 0.25);
    // By night the room is lit from within: lamps, and the fire if there is one.
    this.fill.intensity = 0.75 + 0.55 * daylight;
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
  const def = FURNITURE[kind];
  const model = modelOf(assets, 'furniture', def.model);
  const wrap = new THREE.Group();
  wrap.add(instantiate(model, fitScale(model, def.fit)));
  return wrap;
}
