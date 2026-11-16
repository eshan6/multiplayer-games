/**
 * Small living details: chimney smoke, the fire in the yard, fireflies at dusk.
 *
 * All three are point sprites animated entirely in the vertex shader from a
 * per-particle seed, so they cost no per-frame work on the CPU at all.
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

function points(count: number, seeds: (i: number, rand: () => number) => [number, number, number, number], vertex: string, uniforms: Record<string, THREE.IUniform>, blending: THREE.Blending) {
  const rand = rng(count * 31 + 7);
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) seed.set(seeds(i, rand), i * 4);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vertex,
    fragmentShader: SOFT_DOT,
    transparent: true,
    depthWrite: false,
    blending,
  });
  const p = new THREE.Points(geo, mat);
  p.frustumCulled = false;
  return p;
}

export class Effects {
  readonly group = new THREE.Group();
  readonly fireLight = new THREE.PointLight(0xff8a3c, 0, 22, 1.6);
  readonly doorLight = new THREE.PointLight(0xffb060, 0, 16, 1.8);

  private readonly uniforms = {
    uTime: { value: 0 },
    uScale: { value: 600 },
    uSmoke: { value: new THREE.Color() },
    uNight: { value: 0 },
  };
  private time = 0;

  constructor(chimney: THREE.Vector3, fire: THREE.Vector3, door: THREE.Vector3, terrain: Terrain) {
    const u = this.uniforms;

    // Smoke: each puff rises, drifts downwind, swells and fades, then loops.
    const smoke = points(
      26,
      (i, rand) => [i / 26, rand(), rand(), rand()],
      /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform float uScale;
        uniform vec3 uSmoke;
        varying vec4 vColor;
        void main() {
          float life = fract(uTime * 0.085 + aSeed.x);
          vec3 p = vec3(${chimney.x.toFixed(3)}, ${chimney.y.toFixed(3)}, ${chimney.z.toFixed(3)});
          p.y += life * 8.5;
          p.x += life * life * 5.0 + sin(life * 7.0 + aSeed.y * 6.28) * 0.35 * life;
          p.z += life * life * 2.2 + cos(life * 5.0 + aSeed.z * 6.28) * 0.35 * life;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uScale * (0.55 + life * 2.4) / -mv.z;
          float a = smoothstep(0.0, 0.08, life) * (1.0 - life) * 0.5;
          vColor = vec4(uSmoke, a);
        }
      `,
      { uTime: u.uTime, uScale: u.uScale, uSmoke: u.uSmoke },
      THREE.NormalBlending,
    );

    // Flames: quick, bright, additive, tapering to a point.
    const flames = points(
      34,
      (i, rand) => [i / 34, rand(), rand(), rand()],
      /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform float uScale;
        varying vec4 vColor;
        void main() {
          float life = fract(uTime * (0.9 + aSeed.w * 0.6) + aSeed.x);
          float ang = aSeed.y * 6.28318;
          float rad = (1.0 - life) * 0.32 * aSeed.z;
          vec3 p = vec3(${fire.x.toFixed(3)}, ${fire.y.toFixed(3)}, ${fire.z.toFixed(3)});
          p.x += cos(ang) * rad + sin(uTime * 6.0 + aSeed.y * 9.0) * 0.04;
          p.z += sin(ang) * rad;
          p.y += life * (0.9 + aSeed.w * 0.7);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uScale * (0.5 * (1.0 - life) + 0.08) / -mv.z;
          vec3 hot = mix(vec3(1.0, 0.86, 0.45), vec3(1.0, 0.32, 0.06), life);
          vColor = vec4(hot * 1.5, (1.0 - life) * 0.75);
        }
      `,
      { uTime: u.uTime, uScale: u.uScale },
      THREE.AdditiveBlending,
    );

    // Sparks that lift off the fire and wink out.
    const sparks = points(
      14,
      (i, rand) => [i / 14, rand(), rand(), rand()],
      /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform float uScale;
        varying vec4 vColor;
        void main() {
          float life = fract(uTime * (0.22 + aSeed.w * 0.15) + aSeed.x);
          vec3 p = vec3(${fire.x.toFixed(3)}, ${fire.y.toFixed(3)}, ${fire.z.toFixed(3)});
          p.x += sin(life * 9.0 + aSeed.y * 6.28) * 0.5 * life + (aSeed.y - 0.5) * 0.5;
          p.z += cos(life * 7.0 + aSeed.z * 6.28) * 0.5 * life + (aSeed.z - 0.5) * 0.5;
          p.y += 0.4 + life * 3.4;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uScale * 0.05 / -mv.z;
          vColor = vec4(vec3(1.0, 0.6, 0.2) * 2.5, (1.0 - life) * smoothstep(0.0, 0.1, life));
        }
      `,
      { uTime: u.uTime, uScale: u.uScale },
      THREE.AdditiveBlending,
    );

    // Fireflies: scattered through the meadow by the pond and the yard, each
    // wandering a slow loop and pulsing on its own rhythm. Out only after dark.
    const rand = rng(5150);
    const homes: number[] = [];
    const flyCount = 140;
    for (let i = 0; i < flyCount; i++) {
      const nearPond = rand() < 0.55;
      const cx = nearPond ? POND.x : 6;
      const cz = nearPond ? POND.z : 18;
      const a = rand() * Math.PI * 2;
      const r = (nearPond ? POND.radius * 0.8 : 6) + rand() * 30;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      homes.push(x, terrain.height(x, z) + 0.5 + rand() * 1.6, z);
    }
    const flies = points(
      flyCount,
      (_i, r) => [r(), r(), r(), r()],
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
      { uTime: u.uTime, uScale: u.uScale, uNight: u.uNight },
      THREE.AdditiveBlending,
    );
    flies.geometry.setAttribute('aHome', new THREE.BufferAttribute(new Float32Array(homes), 3));

    this.fireLight.position.copy(fire).add(new THREE.Vector3(0, 0.7, 0));
    this.doorLight.position.copy(door).add(new THREE.Vector3(0, 1.4, 0.3));
    this.group.add(smoke, flames, sparks, flies, this.fireLight, this.doorLight);
    this.group.name = 'effects';
  }

  update(dt: number, sky: Sky, viewportHeight: number, fov: number) {
    this.time += dt;
    const u = this.uniforms;
    u.uTime.value = this.time;
    // Converts a size in metres into pixels at a given depth.
    u.uScale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    const night = 1 - sky.daylight;
    u.uNight.value = THREE.MathUtils.smoothstep(night, 0.35, 0.9);
    // Smoke is lit by whatever the sky is doing: bright by day, a dim blue-grey at night.
    u.uSmoke.value.copy(sky.fill.color).multiplyScalar(0.45 + 0.55 * sky.daylight).lerp(sky.fog.color, 0.3);

    // Firelight flickers: two sines and a little noise is enough to read as flame.
    const flicker = 0.82 + 0.1 * Math.sin(this.time * 11.3) + 0.08 * Math.sin(this.time * 23.7 + 1.3);
    this.fireLight.intensity = (4 + 26 * night) * flicker;
    this.doorLight.intensity = 14 * THREE.MathUtils.smoothstep(night, 0.3, 0.8);
  }
}
