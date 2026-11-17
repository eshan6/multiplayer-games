/**
 * The sky, the sun and moon, the weather, and every light in the scene — all
 * driven by one number: the hour of the day.
 *
 * The air is a physical model (Preetham's, as shipped with three.js): give it
 * where the sun is and it works out the colour of every part of the sky,
 * including the red of a low sun and the glare round a high one. Over that
 * goes a layer of procedural cloud, and under it, at night, stars and a moon.
 *
 * The same sky is then captured into an environment map, so everything in the
 * world is lit and reflected by the sky that is actually overhead. That is
 * the largest single reason a surface here looks like a material rather than
 * a colour.
 */
import * as THREE from 'three';
import { Sky as Air } from 'three/addons/objects/Sky.js';
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

/** Half-width of the square of ground that receives shadows, centred on you. */
const SHADOW_REACH = 52;

/** Sunrise and sunset, in hours. The sun's arc is fitted between them. */
const SUNRISE = 5.6;
const SUNSET = 19.9;

/** Added to the physical sky shader: night, overcast, stars and the moon. */
const NIGHT_UNIFORMS = /* glsl */ `
  uniform float uDay;
  uniform float uGain;
  uniform float uOvercast;
  uniform float uStars;
  uniform float uMoon;
  uniform float uTime;
  uniform vec3 uNightZenith;
  uniform vec3 uNightHorizon;
  uniform vec3 uGrey;
  uniform vec3 uMoonDir;
  float starHash(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }
`;
const NIGHT_BODY = /* glsl */ `
  vec3 dir = normalize(vWorldPosition - cameraPosition);
  float up = clamp(dir.y, 0.0, 1.0);
  retColor *= uGain;
  vec3 night = mix(uNightHorizon, uNightZenith, pow(up, 0.45));
  retColor = mix(night, retColor, uDay);
  retColor = mix(retColor, uGrey * (0.75 + 0.5 * up), uOvercast * 0.85);
  if (uStars > 0.01 && dir.y > 0.0) {
    vec3 cell = floor(dir * 300.0);
    float h = starHash(cell);
    float star = step(0.9972, h) * smoothstep(0.45, 0.0, length(fract(dir * 300.0) - 0.5));
    float twinkle = 0.65 + 0.35 * sin(uTime * (1.5 + h * 4.0) + h * 80.0);
    retColor += vec3(0.9, 0.95, 1.0) * star * twinkle * uStars * smoothstep(0.0, 0.25, dir.y) * 2.2;
  }
  float md = dot(dir, uMoonDir);
  retColor += vec3(0.86, 0.9, 1.0) * uMoon * (smoothstep(0.99935, 0.99965, md) * 3.0 + pow(max(md, 0.0), 420.0) * 0.3);
  gl_FragColor = vec4( retColor, 1.0 );
`;

const CLOUD_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;
const CLOUD_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uCover;
  uniform vec3 uLit;
  uniform vec3 uShade;
  uniform vec3 uSunDir;
  varying vec3 vDir;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
      sum += noise(p) * amp;
      p = p * 2.03 + vec2(17.1, 9.2);
      amp *= 0.5;
    }
    return sum;
  }
  void main() {
    vec3 d = normalize(vDir);
    if (d.y < 0.015) discard;
    // Project the dome onto a flat layer: clouds bunch toward the horizon as real ones do.
    vec2 uv = d.xz / (d.y + 0.16) * 1.15 + vec2(uTime * 0.006, uTime * 0.0025);
    float n = fbm(uv) + 0.35 * fbm(uv * 3.1 + 7.0) - 0.17;
    float edge = mix(0.62, 0.24, uCover);
    float density = smoothstep(edge, edge + 0.26, n);
    if (density < 0.004) discard;
    // Cheap self-shadowing: a cloud is brighter on the side its sun is on.
    vec2 toSun = normalize(uSunDir.xz + vec2(0.0001)) * 0.11;
    float toward = fbm(uv + toSun) + 0.35 * fbm((uv + toSun) * 3.1 + 7.0) - 0.17;
    float light = clamp(0.62 + (n - toward) * 2.8, 0.0, 1.0);
    // Thick cloud is darker underneath.
    light *= mix(1.0, 0.72, smoothstep(0.5, 1.0, density) * uCover);
    vec3 col = mix(uShade, uLit, light);
    float fade = smoothstep(0.015, 0.2, d.y);
    gl_FragColor = vec4(col, density * fade);
  }
`;

export class Sky {
  /** 0..24. Set from the world's clock each frame. */
  hour = 17.9;
  /** 0 clear .. 1 fully overcast, and 0 .. 1 mist. Eased toward by `setWeather`. */
  overcast = 0;
  mist = 0;
  private wantOvercast = 0;
  private wantMist = 0;

  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly fill = new THREE.HemisphereLight(0xffffff, 0x444444, 0.3);
  readonly fog = new THREE.Fog(0xffffff, 70, 330);

  /** Direction *towards* whichever body is lighting the scene. */
  readonly lightDir = new THREE.Vector3(0, 1, 0);
  readonly sunDir = new THREE.Vector3();
  /** 1 by day, 0 at night, smooth through dusk and dawn. */
  daylight = 1;
  exposure = 1;

  private readonly air = new Air();
  private readonly clouds: THREE.Mesh;
  private readonly cloudUniforms: Record<string, THREE.IUniform>;
  private readonly mountains: THREE.Mesh;
  private readonly moonDir = new THREE.Vector3();
  private readonly horizon = new THREE.Color();
  private readonly zenith = new THREE.Color();
  private readonly tmpA = new THREE.Color();
  private readonly tmpB = new THREE.Color();
  private time = 0;

  // The sky captured for lighting: a second copy of the air and clouds, in a
  // scene of their own, photographed into a cube map every so often.
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly envScene = new THREE.Scene();
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private envClock = 0;
  private envHour = -99;
  private envCover = -99;

  constructor(
    private readonly scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
  ) {
    // ---- the air ---------------------------------------------------------------
    const mat = this.air.material as THREE.ShaderMaterial;
    Object.assign(mat.uniforms, {
      uDay: { value: 1 },
      uGain: { value: 1 },
      uOvercast: { value: 0 },
      uStars: { value: 0 },
      uMoon: { value: 0 },
      uTime: { value: 0 },
      uNightZenith: { value: new THREE.Color() },
      uNightHorizon: { value: new THREE.Color() },
      uGrey: { value: new THREE.Color() },
      uMoonDir: { value: this.moonDir },
    });
    mat.fragmentShader = mat.fragmentShader.replace('void main() {', `${NIGHT_UNIFORMS}\nvoid main() {`).replace('gl_FragColor = vec4( retColor, 1.0 );', NIGHT_BODY);
    mat.uniforms.mieCoefficient!.value = 0.004;
    mat.uniforms.mieDirectionalG!.value = 0.82;
    this.air.scale.setScalar(5000);
    this.air.frustumCulled = false;
    this.air.renderOrder = -10;
    scene.add(this.air);

    // ---- cloud -----------------------------------------------------------------
    this.cloudUniforms = {
      uTime: { value: 0 },
      uCover: { value: 0.3 },
      uLit: { value: new THREE.Color() },
      uShade: { value: new THREE.Color() },
      uSunDir: { value: this.sunDir },
    };
    const cloudMaterial = new THREE.ShaderMaterial({
      uniforms: this.cloudUniforms,
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), cloudMaterial);
    this.clouds.scale.setScalar(3000);
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = -8;
    this.clouds.name = 'clouds';
    this.mountains = this.buildMountains();
    scene.add(this.mountains, this.clouds);

    const envAir = new THREE.Mesh(this.air.geometry, mat);
    envAir.scale.setScalar(900);
    const envClouds = new THREE.Mesh(this.clouds.geometry, cloudMaterial);
    envClouds.scale.setScalar(600);
    this.envScene.add(envAir, envClouds);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    // ---- light -----------------------------------------------------------------
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const cam = this.sun.shadow.camera;
    cam.left = -SHADOW_REACH;
    cam.right = SHADOW_REACH;
    cam.top = SHADOW_REACH;
    cam.bottom = -SHADOW_REACH;
    cam.near = 1;
    cam.far = 420;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.05;
    this.sun.shadow.radius = 1.6;
    scene.add(this.sun, this.sun.target, this.fill);
    scene.fog = this.fog;

    this.resolve();
  }

  /**
   * A far ring of mountains, drawn as flat silhouettes in the sky's own
   * colours. They give the valley an edge, and the eye somewhere to rest.
   */
  private buildMountains(): THREE.Mesh {
    const rand = rng(1717);
    const segs = 180;
    const pos: number[] = [];
    const shade: number[] = [];
    const idx: number[] = [];
    // Two ranges: a nearer, lower, darker one and a higher paler one behind it.
    for (const [radius, base, peak, tone] of [
      [760, 30, 120, 0.72],
      [900, 60, 230, 1.0],
    ] as const) {
      const start = pos.length / 3;
      let h1 = 0;
      let h2 = 0;
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        // A wandering ridge line: slow swells with sharper peaks riding on them.
        h1 = Math.sin(a * 3 + radius) * 0.5 + Math.sin(a * 7.3 + 1.7) * 0.3 + Math.sin(a * 17 + radius * 0.01) * 0.2;
        h2 = h2 * 0.6 + (rand() - 0.5) * 0.5;
        const top = base + (0.5 + 0.5 * h1) * peak * (0.75 + h2 * 0.5);
        const x = Math.cos(a) * radius;
        const z = Math.sin(a) * radius;
        pos.push(x, -40, z, x, top, z);
        shade.push(tone * 0.82, tone);
        if (i < segs) {
          const k = start + i * 2;
          idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aShade', new THREE.Float32BufferAttribute(shade, 1));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { uNear: { value: new THREE.Color() }, uFar: { value: new THREE.Color() } },
        vertexShader: /* glsl */ `
          attribute float aShade;
          varying float vShade;
          void main() {
            vShade = aShade;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uNear;
          uniform vec3 uFar;
          varying float vShade;
          void main() {
            gl_FragColor = vec4(mix(uNear, uFar, smoothstep(0.6, 1.0, vShade)), 1.0);
          }
        `,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = -9;
    mesh.name = 'mountains';
    return mesh;
  }

  /** Ease toward a kind of weather. */
  setWeather(kind: 'clear' | 'cloudy' | 'rain' | 'mist') {
    this.wantOvercast = kind === 'clear' ? 0 : kind === 'cloudy' ? 0.6 : kind === 'rain' ? 1 : 0.45;
    this.wantMist = kind === 'mist' ? 1 : kind === 'rain' ? 0.35 : 0;
  }

  /** Advance and re-resolve the lighting. `focus` is what the shadows follow. */
  update(dt: number, focus: THREE.Vector3, camera: THREE.Camera) {
    this.time += dt;
    const ease = 1 - Math.exp(-dt * 0.5);
    this.overcast += (this.wantOvercast - this.overcast) * ease;
    this.mist += (this.wantMist - this.mist) * ease;
    this.resolve();

    this.air.position.copy(camera.position);
    this.clouds.position.copy(camera.position);
    this.mountains.position.set(camera.position.x, 0, camera.position.z);

    // Keep the shadow camera on you, snapped to whole shadow texels so
    // shadow edges do not crawl as the camera moves.
    const texel = (SHADOW_REACH * 2) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx, focus.y, fz).addScaledVector(this.lightDir, 190);

    // Re-photograph the sky for lighting when it has changed enough to matter.
    this.envClock -= dt;
    const moved = Math.abs(this.hour - this.envHour) > 0.06 || Math.abs(this.overcast - this.envCover) > 0.04;
    if (moved && this.envClock <= 0) {
      this.envClock = 1.2;
      this.envHour = this.hour;
      this.envCover = this.overcast;
      const next = this.pmrem.fromScene(this.envScene, 0, 1, 2000);
      this.scene.environment = next.texture;
      // Skylight fills the shadows but should not flatten them.
      this.scene.environmentIntensity = 0.75;
      this.envTarget?.dispose();
      this.envTarget = next;
    }
  }

  /** Jump the clock without waiting for a frame. */
  setHour(hour: number) {
    this.hour = ((hour % 24) + 24) % 24;
    this.envHour = -99;
    this.resolve();
  }

  private resolve() {
    const h = this.hour;
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1]!.hour <= h) i++;
    const a = KEYS[i]!;
    const b = KEYS[i + 1]!;
    const t = (h - a.hour) / (b.hour - a.hour);
    const mix = (ka: number, kb: number, into: THREE.Color) => into.copy(this.tmpA.setHex(ka)).lerp(this.tmpB.setHex(kb), t);
    const num = (ka: number, kb: number) => ka + (kb - ka) * t;

    // The sun's arc: up in the east, over the south, down in the west, tilted
    // so shadows always have some length to them.
    const ang = ((h - SUNRISE) / (SUNSET - SUNRISE)) * Math.PI;
    this.sunDir.set(Math.cos(ang) * 0.92, Math.sin(ang) * 0.9, 0.42 - 0.2 * Math.sin(ang)).normalize();
    // The moon keeps the opposite appointment, on a slightly different tilt.
    const mang = (((h - SUNSET + 24) % 24) / (24 - (SUNSET - SUNRISE))) * Math.PI;
    this.moonDir.set(Math.cos(mang) * 0.85, Math.sin(mang) * 0.8 + 0.12, -0.5).normalize();

    const sunUp = this.sunDir.y;
    this.daylight = THREE.MathUtils.smoothstep(sunUp, -0.08, 0.16);
    // Whichever body is higher lights the scene.
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
    this.sun.intensity = num(a.sunPower, b.sunPower) * 1.25 * handover;
    mix(a.skyFill, b.skyFill, this.fill.color);
    mix(a.groundFill, b.groundFill, this.fill.groundColor);
    // Most ambient light now comes from the captured sky; this is only a floor
    // under it, so the darkest shadow at night is still readable.
    this.fill.intensity = num(a.fillPower, b.fillPower) * (0.16 + 0.3 * (1 - this.daylight));
    mix(a.fog, b.fog, this.fog.color);
    this.exposure = num(a.exposure, b.exposure);
    mix(a.zenith, b.zenith, this.zenith);
    mix(a.horizon, b.horizon, this.horizon);

    // ---- the air ---------------------------------------------------------------
    const o = this.overcast;
    const u = (this.air.material as THREE.ShaderMaterial).uniforms;
    (u.sunPosition!.value as THREE.Vector3).copy(this.sunDir);
    // Hazier air scatters more: a white-ish sky and a softer sun.
    u.turbidity!.value = THREE.MathUtils.lerp(2.2, 9, Math.max(o, this.mist));
    u.rayleigh!.value = THREE.MathUtils.lerp(1.6, 2.8, THREE.MathUtils.smoothstep(sunUp, 0.3, 0.0));
    u.uDay!.value = THREE.MathUtils.smoothstep(sunUp, -0.16, 0.04);
    // The physical model is in absolute units; this brings it to the same
    // exposure as the rest of the scene. Too high and the sky goes white.
    u.uGain!.value = 0.42;
    u.uOvercast!.value = o;
    u.uStars!.value = num(a.stars, b.stars) * (1 - o);
    u.uMoon!.value = THREE.MathUtils.smoothstep(this.moonDir.y, -0.02, 0.08) * (1 - this.daylight) * (1 - o);
    u.uTime!.value = this.time;
    (u.uNightZenith!.value as THREE.Color).setHex(0x03060f);
    (u.uNightHorizon!.value as THREE.Color).setHex(0x101c38);
    const grey = (u.uGrey!.value as THREE.Color).setHex(0xaab2b8).multiplyScalar(0.1 + 0.75 * this.daylight);

    // ---- weather ---------------------------------------------------------------
    if (o > 0.002 || this.mist > 0.002) {
      this.fog.color.lerp(grey, Math.max(o * 0.6, this.mist * 0.7));
      this.sun.intensity *= 1 - 0.7 * o;
      this.zenith.lerp(grey, o * 0.78);
      this.horizon.lerp(grey, o * 0.6);
    }
    // Clear air: only the far hills go blue with distance.
    this.fog.near = THREE.MathUtils.lerp(THREE.MathUtils.lerp(140, 60, o), 6, this.mist);
    this.fog.far = THREE.MathUtils.lerp(THREE.MathUtils.lerp(900, 420, o), 95, this.mist);

    // ---- cloud -----------------------------------------------------------------
    const c = this.cloudUniforms;
    c.uTime!.value = this.time;
    c.uCover!.value = 0.24 + 0.76 * o;
    // Sunlit tops take the sun's colour; undersides take the sky's.
    (c.uLit!.value as THREE.Color)
      .copy(this.sun.color)
      .multiplyScalar(0.25 + 0.95 * this.daylight)
      .lerp(this.tmpA.setRGB(1, 1, 1), 0.25 * this.daylight)
      .multiplyScalar(1 - 0.35 * o);
    (c.uShade!.value as THREE.Color)
      .copy(this.fill.color)
      .multiplyScalar(0.12 + 0.62 * this.daylight)
      .multiplyScalar(1 - 0.3 * o);

    // The mountains are painted in the sky's own colours, so they sit in it.
    const mu = (this.mountains.material as THREE.ShaderMaterial).uniforms;
    (mu.uFar!.value as THREE.Color).copy(this.horizon).lerp(this.zenith, 0.42);
    (mu.uNear!.value as THREE.Color).copy(mu.uFar!.value as THREE.Color).lerp(this.fog.color, 0.35).multiplyScalar(0.8);
  }
}
