/**
 * Things a person holds while they work: an axe, a watering can, a bucket...
 *
 * Each is built in its own grip frame: the fist at the origin, a handle
 * running up +Y out of the top of the fist, and the working end (axe head,
 * spout) toward +X. `prop()` then turns that frame into the hand bone's, so
 * the same axe sits right in either hand. The models are small and simple:
 * they are seen at arm's length for a few seconds, mostly in motion.
 */
import * as THREE from 'three';

export type PropName = 'axe' | 'hammer' | 'can' | 'bucket' | 'stick' | 'brush' | 'basket' | 'pouch' | 'bowl' | 'spoon' | 'ladle' | 'scoop';

const mat = (color: number, roughness: number, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const M = {
  wood: mat(0x7c5a38, 0.72),
  darkWood: mat(0x4e3622, 0.78),
  bark: mat(0x5b4a3a, 0.95),
  iron: mat(0x55585c, 0.5, 0.85),
  edge: mat(0xa9adb1, 0.28, 0.95),
  zinc: mat(0x8f979c, 0.36, 0.9),
  wicker: mat(0xa98450, 0.86),
  linen: mat(0xb3a58a, 0.95),
  grain: mat(0xc9a75e, 0.9),
  bristle: mat(0x3a2c20, 0.95),
  water: new THREE.MeshStandardMaterial({ color: 0x6f8d96, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.7 }),
  stew: mat(0x7a4a24, 0.4),
};

function piece(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  return m;
}

const rod = (r: number, len: number, mat: THREE.Material, y0 = 0, taper = 1) => piece(new THREE.CylinderGeometry(r * taper, r, len, 10), mat, 0, y0 + len / 2);

/** A turned vessel from a profile of [radius, height] points, open at the top. */
function vessel(profile: [number, number][], material: THREE.Material): THREE.Mesh {
  const g = new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    20,
  );
  const m = piece(g, material);
  (m.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  return m;
}

const BUILD: Record<PropName, () => THREE.Object3D> = {
  axe() {
    const g = new THREE.Group();
    g.add(rod(0.017, 0.74, M.wood, -0.1, 0.85));
    // Head: an iron poll and a bright, flared edge toward +X.
    g.add(piece(new THREE.BoxGeometry(0.075, 0.07, 0.035), M.iron, 0.01, 0.58));
    const blade = new THREE.Shape();
    blade.moveTo(0, -0.03);
    blade.lineTo(0.1, -0.06);
    blade.quadraticCurveTo(0.125, 0, 0.1, 0.07);
    blade.lineTo(0, 0.035);
    blade.closePath();
    const bg = new THREE.ExtrudeGeometry(blade, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.003, bevelSegments: 1 });
    bg.translate(0, 0, -0.006);
    g.add(piece(bg, M.edge, 0.04, 0.575));
    return g;
  },
  hammer() {
    const g = new THREE.Group();
    g.add(rod(0.014, 0.34, M.wood, -0.06, 0.9));
    g.add(piece(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 12), M.iron, 0, 0.27, 0, 0, 0, Math.PI / 2));
    return g;
  },
  can() {
    // Carried by the top handle; the spout reaches forward.
    const g = new THREE.Group();
    const body = vessel([[0, -0.3], [0.1, -0.3], [0.105, -0.12], [0.085, -0.07], [0.04, -0.06]], M.zinc);
    g.add(body);
    g.add(piece(new THREE.TorusGeometry(0.06, 0.009, 6, 16, Math.PI), M.zinc, 0, -0.06, 0, 0, Math.PI / 2, 0));
    g.add(piece(new THREE.CylinderGeometry(0.012, 0.022, 0.32, 10), M.zinc, 0.17, -0.17, 0, 0, 0, -1.0));
    g.add(piece(new THREE.CylinderGeometry(0.035, 0.016, 0.04, 12), M.zinc, 0.31, -0.06, 0, 0, 0, -1.0));
    // A two-gallon can, not a bath: drawn full size above, then brought down.
    g.scale.setScalar(0.72);
    return g;
  },
  bucket() {
    const g = new THREE.Group();
    g.add(vessel([[0, -0.32], [0.1, -0.32], [0.13, -0.1]], M.wood));
    g.add(piece(new THREE.CylinderGeometry(0.105, 0.105, 0.01, 18), M.water, 0, -0.14));
    for (const y of [-0.3, -0.13]) g.add(piece(new THREE.TorusGeometry(y < -0.2 ? 0.103 : 0.127, 0.006, 4, 24), M.iron, 0, y, 0, Math.PI / 2));
    g.add(piece(new THREE.TorusGeometry(0.125, 0.004, 4, 20, Math.PI), M.iron, 0, -0.1, 0, 0, Math.PI / 2, 0));
    return g;
  },
  stick() {
    const g = new THREE.Group();
    g.add(rod(0.016, 0.62, M.bark, -0.2, 0.7));
    g.add(piece(new THREE.CylinderGeometry(0.006, 0.009, 0.12, 6), M.bark, 0.035, 0.22, 0, 0, 0, -0.7));
    return g;
  },
  brush() {
    const g = new THREE.Group();
    g.add(piece(new THREE.BoxGeometry(0.05, 0.16, 0.035), M.darkWood, 0, 0.02));
    g.add(piece(new THREE.BoxGeometry(0.045, 0.15, 0.03), M.bristle, 0.035, 0.02));
    return g;
  },
  basket() {
    const g = new THREE.Group();
    g.add(vessel([[0, -0.3], [0.12, -0.3], [0.16, -0.12]], M.wicker));
    g.add(piece(new THREE.TorusGeometry(0.14, 0.012, 6, 20, Math.PI), M.wicker, 0, -0.12, 0, 0, Math.PI / 2, 0));
    return g;
  },
  pouch() {
    const g = new THREE.Group();
    const s = piece(new THREE.SphereGeometry(0.07, 12, 10), M.linen, 0, -0.07);
    s.scale.set(1, 1.25, 0.9);
    g.add(s);
    g.add(piece(new THREE.CylinderGeometry(0.02, 0.03, 0.04, 8), M.linen, 0, 0.0));
    return g;
  },
  bowl() {
    const g = new THREE.Group();
    g.add(vessel([[0, -0.03], [0.05, -0.03], [0.085, 0.02]], M.wood));
    g.add(piece(new THREE.CylinderGeometry(0.075, 0.075, 0.008, 16), M.stew, 0, 0.005));
    return g;
  },
  spoon() {
    const g = new THREE.Group();
    g.add(rod(0.006, 0.17, M.wood, -0.03));
    const bowl = piece(new THREE.SphereGeometry(0.022, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.wood, 0, 0.15, 0, Math.PI);
    bowl.scale.set(1, 0.5, 1.4);
    g.add(bowl);
    return g;
  },
  ladle() {
    const g = new THREE.Group();
    g.add(rod(0.008, 0.38, M.wood, -0.05));
    g.add(piece(new THREE.SphereGeometry(0.045, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M.wood, 0, 0.35));
    return g;
  },
  scoop() {
    // A shallow wooden scoop heaped with grain, for the hens.
    const g = new THREE.Group();
    g.add(vessel([[0, -0.02], [0.06, -0.02], [0.075, 0.03]], M.wood));
    const heap = piece(new THREE.SphereGeometry(0.065, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.grain, 0, 0.01);
    heap.scale.y = 0.45;
    g.add(heap);
    return g;
  },
};

/**
 * From the grip frame to each hand bone's own axes. Both hand bones run along
 * +Y from the wrist to the knuckles, with +Z out of the thumb side (where a
 * held handle comes out of the fist) and the palm toward -X on the right hand,
 * +X on the left (measured from the avatars' bind pose). So: a handle up the
 * prop's +Y leaves the fist on the thumb side, and the working end along the
 * prop's +X points where the knuckles do, which is where a hammer strikes.
 */
const GRIP_BASIS = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)));
export const GRIP = {
  /** Fist centre from the wrist, toward the knuckles. */
  reach: 0.075,
  /** And toward the palm. */
  palm: 0.035,
};

/** A new copy of a prop, ready to be added to a hand bone. */
export function prop(name: PropName, side: 'left' | 'right'): THREE.Object3D {
  const inner = BUILD[name]();
  const holder = new THREE.Group();
  holder.name = `prop:${name}`;
  inner.quaternion.copy(GRIP_BASIS);
  inner.position.set(side === 'right' ? -GRIP.palm : GRIP.palm, GRIP.reach, 0);
  holder.add(inner);
  return holder;
}
