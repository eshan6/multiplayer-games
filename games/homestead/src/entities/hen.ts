/**
 * A hen, built from a few rounded shapes and animated in code: she bobs her
 * head when she walks and tips forward to peck. None of the animal kits has a
 * chicken, and at thirty centimetres tall a hand-built one sits happily
 * beside them.
 */
import * as THREE from 'three';
import type { Terrain } from '../world/terrain';
import type { Gait } from './creature';

const FEATHERS = [0xf3ead8, 0xb9773f, 0x8a5a36, 0x3b3532, 0xe0c090, 0xd9d2c4];
const comb = new THREE.MeshStandardMaterial({ color: 0xc8362e, roughness: 0.7 });
const beak = new THREE.MeshStandardMaterial({ color: 0xe9a53a, roughness: 0.6 });
const eye = new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 0.2 });
const bodyGeo = new THREE.IcosahedronGeometry(1, 2);
const coneGeo = new THREE.ConeGeometry(1, 1, 6);
const legGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.14, 4);

export class Hen {
  readonly root = new THREE.Group();
  heading = 0;
  speed = 0;
  gait: Gait = 'idle';
  private readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legs: THREE.Mesh[] = [];
  private t = Math.random() * 10;

  constructor(coat: number) {
    const feather = new THREE.MeshStandardMaterial({ color: FEATHERS[Math.floor(coat * FEATHERS.length) % FEATHERS.length], roughness: 0.95 });
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, parent: THREE.Object3D = this.body) => {
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(sx, sy, sz);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    part(bodyGeo, feather, 0.13, 0.12, 0.17, 0, 0, 0);
    // Tail, fanned up and back.
    const tail = part(coneGeo, feather, 0.07, 0.16, 0.035, 0, 0.1, -0.17);
    tail.rotation.x = -0.75;
    part(bodyGeo, feather, 0.045, 0.075, 0.1, 0.115, 0, -0.01);
    part(bodyGeo, feather, 0.045, 0.075, 0.1, -0.115, 0, -0.01);

    this.head.position.set(0, 0.13, 0.13);
    part(bodyGeo, feather, 0.062, 0.07, 0.062, 0, 0.03, 0, this.head);
    const b = part(coneGeo, beak, 0.022, 0.05, 0.022, 0, 0.02, 0.075, this.head);
    b.rotation.x = Math.PI / 2;
    part(bodyGeo, comb, 0.014, 0.03, 0.04, 0, 0.1, 0.005, this.head);
    part(bodyGeo, comb, 0.014, 0.022, 0.016, 0, -0.025, 0.055, this.head);
    part(bodyGeo, eye, 0.011, 0.011, 0.011, 0.05, 0.045, 0.03, this.head);
    part(bodyGeo, eye, 0.011, 0.011, 0.011, -0.05, 0.045, 0.03, this.head);
    this.body.add(this.head);
    this.body.position.y = 0.24;
    this.root.add(this.body);

    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, beak);
      leg.position.set(side * 0.05, 0.07, 0);
      this.root.add(leg);
      this.legs.push(leg);
    }
    this.root.scale.setScalar(1.5);
  }

  setGait(gait: Gait) {
    this.gait = gait;
  }

  bone(): undefined {
    return undefined;
  }

  update(dt: number, terrain: Terrain) {
    this.t += dt * (2 + Math.abs(this.speed) * 9);
    const p = this.root.position;
    p.y = terrain.height(p.x, p.z);
    this.root.rotation.y = this.heading;

    const walking = Math.abs(this.speed) > 0.05;
    const pecking = this.gait === 'eat';
    // A hen's head moves in jerks: forward, hold, forward.
    const jerk = walking ? Math.max(0, Math.sin(this.t)) * 0.035 : 0;
    this.head.position.z = 0.13 + jerk;
    const peck = pecking ? Math.max(0, Math.sin(this.t * 1.6)) : 0;
    this.body.rotation.x += ((pecking ? 0.55 + peck * 0.5 : 0) - this.body.rotation.x) * (1 - Math.exp(-dt * 12));
    this.body.position.y = 0.24 + (walking ? Math.abs(Math.sin(this.t)) * 0.012 : 0) - this.body.rotation.x * 0.03;
    this.legs[0]!.rotation.x = walking ? Math.sin(this.t) * 0.6 : 0;
    this.legs[1]!.rotation.x = walking ? -Math.sin(this.t) * 0.6 : 0;
  }
}
