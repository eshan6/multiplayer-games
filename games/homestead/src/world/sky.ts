/**
 * The sky, the sun and moon, and every light in the scene — all driven by one
 * number: the hour of the day.
 *
 * The look of each hour is a keyframe in `KEYS`. Nothing else in the game sets
 * a light colour; they read what this file resolved for the current hour.
 * Weather will plug in here later as a second set of keys to blend toward.
 */
import * as THREE from 'three';
import { rng } from '../noise';

interface Key {
  hour: number;
  /** Direct light from the sun (or the moon, after dark). */
  sun: number;
  sunPower: number;
  /** Hemisphere fill: colour from above and bounce from below. */
  skyFill: number;
  groundFill: number;
  fillPower: number;
  /** Sky dome gradient. */
  zenith: number;
  horizon: number;
  fog: number;
  /** How strongly the sun's side of the horizon glows. */
  glow: number;
  stars: number;
  exposure: number;
}

/* prettier-ignore */
const KEYS: Key[] = [
  { hour: 0,    sun: 0x9db4ff, sunPower: 0.42, skyFill: 0x30457f, groundFill: 0x101a2e, fillPower: 0.95, zenith: 0x040a1e, horizon: 0x1a2a55, fog: 0x14203f, glow: 0.0, stars: 1.0, exposure: 1.05 },
  { hour: 4.6,  sun: 0x9db4ff, sunPower: 0.38, skyFill: 0x34497f, groundFill: 0x121c30, fillPower: 0.95, zenith: 0x071230, horizon: 0x2a3a66, fog: 0x1c2a4c, glow: 0.0, stars: 0.9, exposure: 1.05 },
  { hour: 5.8,  sun: 0xff8a52, sunPower: 0.5,  skyFill: 0x8a8fbc, groundFill: 0x4a4048, fillPower: 1.35,  zenith: 0x27407c, horizon: 0xf4a27e, fog: 0xc79a94, glow: 0.9, stars: 0.15, exposure: 1.0 },
  { hour: 6.8,  sun: 0xffb37a, sunPower: 1.9,  skyFill: 0xb7c4dc, groundFill: 0x5f6a45, fillPower: 1.4, zenith: 0x3a6fc0, horizon: 0xffd0a3, fog: 0xe9c9ae, glow: 1.0, stars: 0.0, exposure: 1.0 },
  { hour: 9,    sun: 0xfff0d2, sunPower: 2.9,  skyFill: 0xcbdcf2, groundFill: 0x6f8048, fillPower: 1.3,  zenith: 0x3f8ae0, horizon: 0xc4e4f7, fog: 0xcfe6f3, glow: 0.35, stars: 0.0, exposure: 1.0 },
  { hour: 13,   sun: 0xfff7e8, sunPower: 3.2,  skyFill: 0xd0e0f4, groundFill: 0x74864a, fillPower: 1.35, zenith: 0x3a86e2, horizon: 0xc9e6f8, fog: 0xd3e8f4, glow: 0.25, stars: 0.0, exposure: 1.0 },
  { hour: 16.5, sun: 0xffe2b0, sunPower: 3.0,  skyFill: 0xcdd6ea, groundFill: 0x72804a, fillPower: 1.25, zenith: 0x3a82dc, horizon: 0xd6e6f2, fog: 0xe3e2d2, glow: 0.5, stars: 0.0, exposure: 1.0 },
  { hour: 18.3, sun: 0xffb866, sunPower: 2.7,  skyFill: 0xc6c2d2, groundFill: 0x6c6a45, fillPower: 1.3,  zenith: 0x3f77cc, horizon: 0xffd9a6, fog: 0xf2cb9c, glow: 1.0, stars: 0.0, exposure: 1.02 },
  { hour: 19.4, sun: 0xff7a3a, sunPower: 1.7,  skyFill: 0xa79cc0, groundFill: 0x6a5248, fillPower: 1.55,  zenith: 0x2f437f, horizon: 0xff9763, fog: 0xd98f78, glow: 1.0, stars: 0.05, exposure: 1.05 },
  { hour: 20.2, sun: 0xd0607a, sunPower: 0.25, skyFill: 0x666aa6, groundFill: 0x332c44, fillPower: 1.25, zenith: 0x121c44, horizon: 0x7a5a86, fog: 0x4f4672, glow: 0.6, stars: 0.5, exposure: 1.08 },
  { hour: 21.2, sun: 0x9db4ff, sunPower: 0.36, skyFill: 0x34497f, groundFill: 0x121c30, fillPower: 0.95, zenith: 0x071230, horizon: 0x24335f, fog: 0x1a2748, glow: 0.0, stars: 0.9, exposure: 1.05 },
  { hour: 24,   sun: 0x9db4ff, sunPower: 0.42, skyFill: 0x30457f, groundFill: 0x101a2e, fillPower: 0.95, zenith: 0x040a1e, horizon: 0x1a2a55, fog: 0x14203f, glow: 0.0, stars: 1.0, exposure: 1.05 },
];

/** Sunrise and sunset, in hours. The sun's arc is fitted between them. */
/** Half-width of the square of ground that receives shadows, centred on the rider. */
const SHADOW_REACH = 50;

const SUNRISE = 5.6;
const SUNSET = 19.9;

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // pinned to the far plane
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform vec3 uMoonDir;
  uniform float uGlow;
  uniform float uStars;
  uniform float uSunDisc;
  uniform float uMoonDisc;
  uniform float uTime;
  varying vec3 vDir;

  float hash(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    vec3 d = normalize(vDir);
    float up = clamp(d.y, -0.15, 1.0);

    // Horizon → zenith, with most of the change low down, the way a real sky does it.
    float t = pow(smoothstep(-0.04, 0.8, up), 0.5);
    vec3 col = mix(uHorizon, uZenith, t);

    // The sun's side of the sky glows warm near the horizon.
    float toSun = max(dot(d, uSunDir), 0.0);
    float low = 1.0 - smoothstep(0.0, 0.55, up);
    col += uSunColor * uGlow * (pow(toSun, 6.0) * 0.32 * low + pow(toSun, 48.0) * 0.35);

    // Sun disc with a soft halo.
    float sd = dot(d, uSunDir);
    col += uSunColor * uSunDisc * (smoothstep(0.99935, 0.99975, sd) * 14.0 + pow(max(sd, 0.0), 900.0) * 1.6);

    // Moon: a pale disc, a little larger than life.
    float md = dot(d, uMoonDir);
    col += vec3(0.85, 0.9, 1.0) * uMoonDisc * (smoothstep(0.99925, 0.9996, md) * 2.4 + pow(max(md, 0.0), 500.0) * 0.25);

    // Stars: a hashed grid on the dome, twinkling.
    if (uStars > 0.01 && d.y > 0.0) {
      vec3 g = floor(d * 260.0);
      float h = hash(g);
      float star = step(0.9965, h);
      float tw = 0.65 + 0.35 * sin(uTime * (1.5 + h * 4.0) + h * 80.0);
      vec3 f = fract(d * 260.0) - 0.5;
      star *= smoothstep(0.45, 0.0, length(f));
      col += vec3(0.9, 0.95, 1.0) * star * tw * uStars * smoothstep(0.0, 0.25, d.y) * 1.6;
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Sky {
  /** 0..24. */
  hour = 17.9;
  /** Game hours per real second while the clock runs. */
  rate = 24 / 600;
  running = true;

  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly fill = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  readonly fog = new THREE.Fog(0xffffff, 75, 440);

  /** Direction *towards* whichever body is lighting the scene. */
  readonly lightDir = new THREE.Vector3(0, 1, 0);
  readonly sunDir = new THREE.Vector3();
  /** 1 by day, 0 at night, smooth through dusk and dawn. */
  daylight = 1;
  exposure = 1;

  private readonly dome: THREE.Mesh;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly clouds = new THREE.Group();
  private readonly cloudMaterial: THREE.MeshLambertMaterial;
  private readonly moonDir = new THREE.Vector3();
  private readonly tmpA = new THREE.Color();
  private readonly tmpB = new THREE.Color();
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uSunDir: { value: this.sunDir },
      uMoonDir: { value: this.moonDir },
      uGlow: { value: 0 },
      uStars: { value: 0 },
      uSunDisc: { value: 1 },
      uMoonDisc: { value: 0 },
      uTime: { value: 0 },
    };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: true,
        fog: false,
      }),
    );
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    // Shadows: one cascade that follows the rider. Big enough to cover the
    // cottage from across the yard, small enough to stay crisp.
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = -SHADOW_REACH;
    cam.right = SHADOW_REACH;
    cam.top = SHADOW_REACH;
    cam.bottom = -SHADOW_REACH;
    cam.near = 1;
    cam.far = 420;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.06;
    this.sun.shadow.radius = 2.2;
    scene.add(this.sun, this.sun.target, this.fill);
    scene.fog = this.fog;

    this.cloudMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, fog: false, flatShading: false });
    this.buildClouds();
    this.clouds.name = 'clouds';
    scene.add(this.clouds);

    this.resolve();
  }

  /** Puffy low-poly clouds: a few squashed spheres welded into one shape each. */
  private buildClouds() {
    const rand = rng(404);
    const sphere = new THREE.IcosahedronGeometry(1, 2);
    for (let i = 0; i < 22; i++) {
      const cloud = new THREE.Group();
      const puffs = 4 + Math.floor(rand() * 5);
      const length = 44 + rand() * 60;
      for (let p = 0; p < puffs; p++) {
        const m = new THREE.Mesh(sphere, this.cloudMaterial);
        const along = (p / (puffs - 1) - 0.5) * length;
        const bulge = 1 - Math.abs(p / (puffs - 1) - 0.5) * 1.2;
        const r = (12 + rand() * 13) * (0.55 + bulge * 0.6);
        m.position.set(along + (rand() - 0.5) * 9, r * 0.28 + (rand() - 0.5) * 3, (rand() - 0.5) * 20);
        m.scale.set(r * 1.25, r * 0.62, r);
        cloud.add(m);
      }
      const angle = rand() * Math.PI * 2;
      const dist = 240 + rand() * 330;
      cloud.position.set(Math.cos(angle) * dist, 95 + rand() * 85, Math.sin(angle) * dist);
      cloud.rotation.y = rand() * Math.PI;
      cloud.userData.speed = 1.1 + rand() * 1.3;
      this.clouds.add(cloud);
    }
  }

  /** Advance the clock and re-resolve the lighting. `focus` is what the shadows follow. */
  update(dt: number, focus: THREE.Vector3, camera: THREE.Camera) {
    this.time += dt;
    if (this.running) this.hour = (this.hour + dt * this.rate) % 24;
    this.resolve();

    this.dome.position.copy(camera.position);
    this.dome.scale.setScalar(900);

    // Keep the shadow camera on the rider, snapped to whole shadow texels so
    // shadow edges do not crawl as the camera moves.
    const texel = (SHADOW_REACH * 2) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx, focus.y, fz).addScaledVector(this.lightDir, 190);

    for (const cloud of this.clouds.children) {
      cloud.position.x += (cloud.userData.speed as number) * dt;
      if (cloud.position.x > 620) cloud.position.x = -620;
    }
    this.clouds.position.set(camera.position.x * 0.9, 0, camera.position.z * 0.9);
  }

  /** Jump the clock without waiting for a frame (used by the time-of-day buttons). */
  setHour(hour: number) {
    this.hour = ((hour % 24) + 24) % 24;
    this.resolve();
  }

  private resolve() {
    const h = this.hour;
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1]!.hour <= h) i++;
    const a = KEYS[i]!;
    const b = KEYS[i + 1]!;
    const t = (h - a.hour) / (b.hour - a.hour);
    const mix = (ka: number, kb: number, into: THREE.Color) =>
      into.copy(this.tmpA.setHex(ka)).lerp(this.tmpB.setHex(kb), t);
    const num = (ka: number, kb: number) => ka + (kb - ka) * t;

    // The sun's arc: up in the east, over the south, down in the west, tilted
    // so shadows always have some length to them.
    const dayT = (h - SUNRISE) / (SUNSET - SUNRISE);
    const ang = dayT * Math.PI;
    this.sunDir.set(Math.cos(ang) * 0.92, Math.sin(ang) * 0.9, 0.42 - 0.2 * Math.sin(ang)).normalize();
    // The moon keeps the opposite appointment, on a slightly different tilt.
    const nightT = ((h - SUNSET + 24) % 24) / (24 - (SUNSET - SUNRISE));
    const mang = nightT * Math.PI;
    this.moonDir.set(Math.cos(mang) * 0.85, Math.sin(mang) * 0.8 + 0.12, -0.5).normalize();

    const sunUp = this.sunDir.y;
    this.daylight = THREE.MathUtils.smoothstep(sunUp, -0.08, 0.16);
    // Whichever body is higher lights the scene. The keyframes take the direct
    // light almost to nothing at the handover, which hides the switch.
    const useSun = sunUp > -0.02;
    this.lightDir.copy(useSun ? this.sunDir : this.moonDir);
    // Never let the light come in flatter than this, or shadows smear across the map.
    if (this.lightDir.y < 0.12) {
      this.lightDir.y = 0.12;
      this.lightDir.normalize();
    }

    mix(a.sun, b.sun, this.sun.color);
    // Dip the direct light to nothing for the instant the sun hands over to
    // the moon, so shadows fade out and back in rather than jumping across.
    const handover = THREE.MathUtils.smoothstep(Math.abs(sunUp + 0.02), 0, 0.05);
    this.sun.intensity = num(a.sunPower, b.sunPower) * handover;
    mix(a.skyFill, b.skyFill, this.fill.color);
    mix(a.groundFill, b.groundFill, this.fill.groundColor);
    this.fill.intensity = num(a.fillPower, b.fillPower);
    mix(a.fog, b.fog, this.fog.color);
    this.exposure = num(a.exposure, b.exposure);

    const u = this.uniforms;
    mix(a.zenith, b.zenith, u.uZenith!.value as THREE.Color);
    mix(a.horizon, b.horizon, u.uHorizon!.value as THREE.Color);
    (u.uSunColor!.value as THREE.Color).copy(this.sun.color);
    if (!useSun) mix(a.horizon, b.horizon, u.uSunColor!.value as THREE.Color);
    u.uGlow!.value = num(a.glow, b.glow);
    u.uStars!.value = num(a.stars, b.stars);
    u.uSunDisc!.value = THREE.MathUtils.smoothstep(sunUp, -0.06, 0.02);
    u.uMoonDisc!.value = THREE.MathUtils.smoothstep(this.moonDir.y, -0.02, 0.08) * (1 - this.daylight);
    u.uTime!.value = this.time;

    // Clouds take the sun's colour by day and sink into the sky colour at night.
    this.cloudMaterial.color.copy(this.fill.color).lerp(this.tmpA.setHex(0xffffff), 0.35 + 0.5 * this.daylight);
    this.cloudMaterial.emissive.copy(u.uHorizon!.value as THREE.Color).multiplyScalar(0.28 + 0.22 * this.daylight);
  }
}
