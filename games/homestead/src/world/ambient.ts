/**
 * Life in the air: birds wheeling high over the valley by day, butterflies
 * low over the meadow. Each is two triangles whose wingtips are flapped in
 * the vertex shader; a whole flock is one draw call.
 */
import * as THREE from 'three';
import { rng } from '../noise';
import type { Terrain } from './terrain';

const VERT = /* glsl */ `
  attribute float aTip;
  attribute vec4 aPath;   // xyz: centre of its circuit, w: radius
  attribute vec4 aSeed;   // x: phase, y: speed, z: size, w: flap rate
  attribute vec3 aTint;
  uniform float uTime;
  uniform float uDay;
  varying vec3 vTint;
  varying float vShow;
  void main() {
    float t = uTime * aSeed.y + aSeed.x * 6.2832;
    // A circuit, with a slower weave laid over it so no two laps match.
    vec3 centre = aPath.xyz + vec3(sin(t * 0.37 + aSeed.x * 9.0), 0.0, cos(t * 0.29)) * aPath.w * 0.35;
    vec3 at = centre + vec3(cos(t), sin(t * 2.3 + aSeed.x * 4.0) * 0.12, sin(t)) * aPath.w;
    vec3 fwd = normalize(vec3(-sin(t), 0.0, cos(t)));
    vec3 right = vec3(fwd.z, 0.0, -fwd.x);
    float flap = sin(uTime * aSeed.w + aSeed.x * 20.0);
    vec3 local = right * position.x + fwd * position.z + vec3(0.0, abs(position.x) * flap * 0.9 * aTip + position.y, 0.0);
    vec4 mv = viewMatrix * vec4(at + local * aSeed.z, 1.0);
    gl_Position = projectionMatrix * mv;
    vTint = aTint;
    vShow = uDay;
  }
`;
const FRAG = /* glsl */ `
  varying vec3 vTint;
  varying float vShow;
  void main() {
    if (vShow < 0.02) discard;
    gl_FragColor = vec4(vTint * (0.35 + 0.65 * vShow), 1.0);
  }
`;

function flock(count: number, place: (i: number, rand: () => number) => { path: number[]; seed: number[]; tint: number }, uniforms: Record<string, THREE.IUniform>): THREE.Mesh {
  const rand = rng(count * 13 + 5);
  // Body at the origin, a wingtip either side, a tail behind.
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 0, 0, 0.35, 0, 0, -0.3, 1, 0, 0], 3));
  wing.setAttribute('aTip', new THREE.Float32BufferAttribute([1, 0, 0, 1], 1));
  wing.setIndex([0, 1, 2, 1, 3, 2]);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = wing.index;
  geo.setAttribute('position', wing.getAttribute('position'));
  geo.setAttribute('aTip', wing.getAttribute('aTip'));
  const path = new Float32Array(count * 4);
  const seed = new Float32Array(count * 4);
  const tint = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const p = place(i, rand);
    path.set(p.path, i * 4);
    seed.set(p.seed, i * 4);
    c.setHex(p.tint);
    tint.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('aPath', new THREE.InstancedBufferAttribute(path, 4));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
  geo.instanceCount = count;
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, fog: false }));
  mesh.frustumCulled = false;
  return mesh;
}

export class Ambient {
  readonly group = new THREE.Group();
  private readonly uniforms = { uTime: { value: 0 }, uDay: { value: 1 } };

  constructor(terrain: Terrain) {
    this.group.name = 'ambient';
    // Three loose flocks, each circling its own patch of sky.
    const flocks = [
      { x: -40, z: -70, y: 62 },
      { x: 90, z: 30, y: 78 },
      { x: -10, z: 110, y: 54 },
    ];
    this.group.add(
      flock(
        30,
        (i, r) => {
          const f = flocks[i % flocks.length]!;
          return { path: [f.x + (r() - 0.5) * 26, f.y + (r() - 0.5) * 12, f.z + (r() - 0.5) * 26, 34 + r() * 30], seed: [r(), 0.1 + r() * 0.07, 0.8 + r() * 0.5, 6 + r() * 3], tint: 0x2a2a30 };
        },
        this.uniforms,
      ),
    );
    const wings = [0xf2a03c, 0xf7e27a, 0xfdfbf2, 0x8fb8e8, 0xe98ab0];
    this.group.add(
      flock(
        90,
        (i, r) => {
          const a = r() * Math.PI * 2;
          const d = 8 + Math.sqrt(r()) * 95;
          const x = Math.cos(a) * d;
          const z = Math.sin(a) * d;
          return { path: [x, terrain.height(x, z) + 0.7 + r() * 1.1, z, 1.2 + r() * 2.6], seed: [r(), 0.35 + r() * 0.5, 0.11 + r() * 0.06, 16 + r() * 8], tint: wings[i % wings.length]! };
        },
        this.uniforms,
      ),
    );
  }

  /** @param daylight birds and butterflies go to roost as it falls */
  update(dt: number, daylight: number, rain: number) {
    this.uniforms.uTime.value += dt;
    this.uniforms.uDay.value = daylight * (1 - rain);
  }
}
