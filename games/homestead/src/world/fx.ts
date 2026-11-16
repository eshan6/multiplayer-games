/**
 * Small living details: smoke, fire, fireflies, rain, and the puff of hearts
 * when an animal is pleased with you.
 *
 * Everything is point sprites animated in the vertex shader from a
 * per-particle seed, so none of it costs per-frame work on the CPU.
 */
import * as THREE from 'three';
import { rng } from '../noise';
import { POND } from './land';
import type { Sky } from './sky';
import type { Terrain } from './terrain';

const SOFT_DOT = /* glsl */ `
  varying vec4 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.0, d);
    gl_FragColor = vec4(vColor.rgb, vColor.a * a * a);
    if (gl_FragColor.a < 0.004) discard;
  }
`;

/** A heart, drawn from two circles and a wedge. */
const HEART = /* glsl */ `
  varying vec4 vColor;
  void main() {
    vec2 p = (gl_PointCoord - 0.5) * 2.2;
    p.y = -p.y + 0.25;
    float a = atan(p.x, p.y) / 3.141593;
    float r = length(p);
    float h = abs(a);
    float edge = (13.0 * h - 22.0 * h * h + 10.0 * h * h * h) / (6.0 - 5.0 * h);
    float inside = smoothstep(edge + 0.06, edge - 0.06, r);
    gl_FragColor = vec4(vColor.rgb, vColor.a * inside);
    if (gl_FragColor.a < 0.01) discard;
  }
`;

type Uniforms = Record<string, THREE.IUniform>;

function points(count: number, vertex: string, fragment: string, uniforms: Uniforms, blending: THREE.Blending, seedOf?: (i: number, rand: () => number) => number[]) {
  const rand = rng(count * 31 + 7);
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) seed.set(seedOf ? seedOf(i, rand) : [i / count, rand(), rand(), rand()], i * 4);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const p = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms, vertexShader: vertex, fragmentShader: fragment, transparent: true, depthWrite: false, blending }));
  p.frustumCulled = false;
  return p;
}

const HEAD = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uScale;
  uniform vec3 uOrigin;
  varying vec4 vColor;
`;

const SMOKE = /* glsl */ `${HEAD}
  uniform vec3 uSmoke;
  void main() {
    float life = fract(uTime * 0.085 + aSeed.x);
    vec3 p = uOrigin;
    p.y += life * 8.5;
    p.x += life * life * 5.0 + sin(life * 7.0 + aSeed.y * 6.28) * 0.35 * life;
    p.z += life * life * 2.2 + cos(life * 5.0 + aSeed.z * 6.28) * 0.35 * life;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uScale * (0.55 + life * 2.4) / -mv.z;
    vColor = vec4(uSmoke, smoothstep(0.0, 0.08, life) * (1.0 - life) * 0.5);
  }
`;

const FLAME = /* glsl */ `${HEAD}
  void main() {
    float life = fract(uTime * (0.9 + aSeed.w * 0.6) + aSeed.x);
    float ang = aSeed.y * 6.28318;
    float rad = (1.0 - life) * 0.32 * aSeed.z;
    vec3 p = uOrigin;
    p.x += cos(ang) * rad + sin(uTime * 6.0 + aSeed.y * 9.0) * 0.04;
    p.z += sin(ang) * rad;
    p.y += life * (0.9 + aSeed.w * 0.7);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uScale * (0.5 * (1.0 - life) + 0.08) / -mv.z;
    vec3 hot = mix(vec3(1.0, 0.86, 0.45), vec3(1.0, 0.32, 0.06), life);
    vColor = vec4(hot * 1.5, (1.0 - life) * 0.75);
  }
`;

const SPARK = /* glsl */ `${HEAD}
  void main() {
    float life = fract(uTime * (0.22 + aSeed.w * 0.15) + aSeed.x);
    vec3 p = uOrigin;
    p.x += sin(life * 9.0 + aSeed.y * 6.28) * 0.5 * life + (aSeed.y - 0.5) * 0.5;
    p.z += cos(life * 7.0 + aSeed.z * 6.28) * 0.5 * life + (aSeed.z - 0.5) * 0.5;
    p.y += 0.4 + life * 3.4;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uScale * 0.05 / -mv.z;
    vColor = vec4(vec3(1.0, 0.6, 0.2) * 2.5, (1.0 - life) * smoothstep(0.0, 0.1, life));
  }
`;

const HEARTS = /* glsl */ `${HEAD}
  uniform float uBorn;
  uniform vec3 uTint;
  void main() {
    float age = (uTime - uBorn) * 0.7 - aSeed.x * 0.35;
    float life = clamp(age, 0.0, 1.0);
    vec3 p = uOrigin;
    p.x += (aSeed.y - 0.5) * 1.1 + sin(age * 5.0 + aSeed.z * 6.28) * 0.12;
    p.z += (aSeed.z - 0.5) * 1.1;
    p.y += life * 1.6;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uScale * 0.34 * (0.6 + aSeed.w * 0.5) / -mv.z;
    vColor = vec4(uTint, step(0.0, age) * (1.0 - life * life));
  }
`;

const RAIN = /* glsl */ `${HEAD}
  uniform float uAmount;
  void main() {
    // A box of rain that travels with the camera and wraps round on itself.
    vec3 box = vec3(46.0, 26.0, 46.0);
    vec3 p = vec3(aSeed.y, aSeed.x, aSeed.z) * box;
    p.y -= uTime * (19.0 + aSeed.w * 7.0);
    p.x += uTime * 2.2;
    p = mod(p - uOrigin, box) - box * 0.5 + uOrigin;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uScale * 0.07 / -mv.z;
    vColor = vec4(vec3(0.82, 0.88, 0.95), step(aSeed.w, uAmount) * 0.55);
  }
`;

const STREAK = /* glsl */ `
  varying vec4 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float a = smoothstep(0.08, 0.0, abs(c.x + c.y * 0.12)) * smoothstep(0.5, 0.2, abs(c.y));
    gl_FragColor = vec4(vColor.rgb, vColor.a * a);
    if (gl_FragColor.a < 0.01) discard;
  }
`;

export interface Flame {
  group: THREE.Group;
  light: THREE.PointLight | null;
}

export class Effects {
  readonly group = new THREE.Group();
  private readonly shared = {
    uTime: { value: 0 },
    uScale: { value: 600 },
    uSmoke: { value: new THREE.Color() },
    uNight: { value: 0 },
  };
  private readonly rainUniforms: Uniforms;
  private readonly bursts: { points: THREE.Points; until: number }[] = [];
  private readonly lights: THREE.PointLight[] = [];
  private time = 0;
  private night = 0;

  constructor(terrain: Terrain | null) {
    this.group.name = 'effects';
    const u = this.shared;

    this.rainUniforms = { uTime: u.uTime, uScale: u.uScale, uOrigin: { value: new THREE.Vector3() }, uAmount: { value: 0 } };
    const rain = points(2600, RAIN, STREAK, this.rainUniforms, THREE.NormalBlending, (_i, r) => [r(), r(), r(), r()]);
    rain.renderOrder = 5;
    this.group.add(rain);

    if (terrain) {
      // Fireflies: scattered round the pond and the yard, each wandering a slow
      // loop and pulsing on its own rhythm. Out only after dark.
      const rand = rng(5150);
      const homes: number[] = [];
      const count = 170;
      for (let i = 0; i < count; i++) {
        const nearPond = rand() < 0.5;
        const cx = nearPond ? POND.x : 4;
        const cz = nearPond ? POND.z : 10;
        const a = rand() * Math.PI * 2;
        const r = (nearPond ? POND.radius * 0.8 : 6) + rand() * 34;
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        homes.push(x, terrain.height(x, z) + 0.5 + rand() * 1.6, z);
      }
      const flies = points(
        count,
        /* glsl */ `
          attribute vec4 aSeed;
          attribute vec3 aHome;
          uniform float uTime;
          uniform float uScale;
          uniform float uNight;
          varying vec4 vColor;
          void main() {
            float t = uTime * (0.25 + aSeed.x * 0.3);
            vec3 p = aHome;
            p.x += sin(t + aSeed.y * 6.28) * 1.6 + sin(t * 2.3 + aSeed.z * 6.28) * 0.5;
            p.y += sin(t * 1.7 + aSeed.w * 6.28) * 0.5;
            p.z += cos(t * 0.9 + aSeed.z * 6.28) * 1.6 + cos(t * 2.1 + aSeed.x * 6.28) * 0.5;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            float pulse = smoothstep(0.2, 1.0, sin(uTime * (1.2 + aSeed.w * 1.4) + aSeed.y * 30.0) * 0.5 + 0.5);
            gl_PointSize = uScale * 0.11 * (0.6 + pulse * 0.6) / -mv.z;
            vColor = vec4(vec3(0.85, 1.0, 0.35) * 2.4, pulse * uNight);
          }
        `,
        SOFT_DOT,
        { uTime: u.uTime, uScale: u.uScale, uNight: u.uNight },
        THREE.AdditiveBlending,
        (_i, r) => [r(), r(), r(), r()],
      );
      flies.geometry.setAttribute('aHome', new THREE.BufferAttribute(new Float32Array(homes), 3));
      this.group.add(flies);
    }
  }

  private local(origin: THREE.Vector3, extra: Uniforms = {}): Uniforms {
    return { uTime: this.shared.uTime, uScale: this.shared.uScale, uOrigin: { value: origin.clone() }, ...extra };
  }

  /** A fire at `at`: flames, sparks, and (for the first few) real light. */
  fire(at: THREE.Vector3, withLight = true): Flame {
    const group = new THREE.Group();
    group.add(points(34, FLAME, SOFT_DOT, this.local(at), THREE.AdditiveBlending), points(14, SPARK, SOFT_DOT, this.local(at), THREE.AdditiveBlending));
    let light: THREE.PointLight | null = null;
    // Real lights are costly; only a handful of fires get one.
    if (withLight && this.lights.length < 3) {
      light = new THREE.PointLight(0xff8a3c, 0, 22, 1.6);
      light.position.copy(at).add(new THREE.Vector3(0, 0.7, 0));
      this.lights.push(light);
      group.add(light);
    }
    return { group, light };
  }

  release(flame: Flame) {
    if (!flame.light) return;
    const i = this.lights.indexOf(flame.light);
    if (i >= 0) this.lights.splice(i, 1);
  }

  /** Chimney smoke rising from `at`. */
  smoke(at: THREE.Vector3): THREE.Points {
    return points(26, SMOKE, SOFT_DOT, this.local(at, { uSmoke: this.shared.uSmoke }), THREE.NormalBlending);
  }

  /** A puff of hearts (or any tint) above something that has just been made happy. */
  hearts(at: THREE.Vector3, tint = 0xff6f8f) {
    const p = points(7, HEARTS, HEART, this.local(at, { uBorn: { value: this.time }, uTint: { value: new THREE.Color(tint) } }), THREE.NormalBlending, (_i, r) => [r(), r(), r(), r()]);
    p.renderOrder = 6;
    this.group.add(p);
    this.bursts.push({ points: p, until: this.time + 2.2 });
  }

  /**
   * @param rain 0 (dry) .. 1 (pouring)
   * @param night 0 (day) .. 1 (night)
   */
  update(dt: number, sky: Sky | null, camera: THREE.PerspectiveCamera, viewportHeight: number, rain = 0) {
    this.time += dt;
    const u = this.shared;
    u.uTime.value = this.time;
    // Converts a size in metres into pixels at a given depth.
    u.uScale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    this.night = sky ? 1 - sky.daylight : 0.6;
    u.uNight.value = THREE.MathUtils.smoothstep(this.night, 0.35, 0.9);
    if (sky) u.uSmoke.value.copy(sky.fill.color).multiplyScalar(0.45 + 0.55 * sky.daylight).lerp(sky.fog.color, 0.3);
    (this.rainUniforms.uOrigin!.value as THREE.Vector3).copy(camera.position);
    this.rainUniforms.uAmount!.value = rain;

    // Firelight flickers: two sines is enough to read as flame.
    const flicker = 0.82 + 0.1 * Math.sin(this.time * 11.3) + 0.08 * Math.sin(this.time * 23.7 + 1.3);
    for (const light of this.lights) light.intensity = (5 + 26 * this.night) * flicker;

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      if (this.time < b.until) continue;
      this.group.remove(b.points);
      b.points.geometry.dispose();
      (b.points.material as THREE.Material).dispose();
      this.bursts.splice(i, 1);
    }
  }
}
