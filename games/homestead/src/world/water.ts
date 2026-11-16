/**
 * The pond. A flat sheet whose colour, foam and sparkle are all painted by a
 * shader from one baked fact per vertex: how deep the water is there.
 */
import * as THREE from 'three';
import { POND, WATER_LEVEL } from './land';
import type { Sky } from './sky';
import type { Terrain } from './terrain';

export class Water {
  readonly mesh: THREE.Mesh;
  private readonly uniforms = {
    uTime: { value: 0 },
    uShallow: { value: new THREE.Color(0x6fc3b4) },
    uDeep: { value: new THREE.Color(0x1f6f8f) },
    uSky: { value: new THREE.Color() },
    uSun: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3() },
    uLight: { value: 1 },
    fogColor: { value: new THREE.Color() },
    fogNear: { value: 1 },
    fogFar: { value: 1000 },
  };

  constructor(terrain: Terrain) {
    const size = POND.radius * 3.2;
    const segs = 56;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);
    geo.translate(POND.x, WATER_LEVEL, POND.z);
    const pos = geo.getAttribute('position');
    const depth = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      depth[i] = WATER_LEVEL - terrain.height(pos.getX(i), pos.getZ(i));
    }
    geo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aDepth;
        varying float vDepth;
        varying vec3 vWorld;
        varying float vFogDepth;
        void main() {
          vDepth = aDepth;
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          vec4 mv = viewMatrix * world;
          vFogDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uShallow;
        uniform vec3 uDeep;
        uniform vec3 uSky;
        uniform vec3 uSun;
        uniform vec3 uSunDir;
        uniform float uLight;
        uniform vec3 fogColor;
        uniform float fogNear;
        uniform float fogFar;
        varying float vDepth;
        varying vec3 vWorld;
        varying float vFogDepth;

        // Cheap moving ripple pattern: three sine sets crossing each other.
        float ripples(vec2 p, float t) {
          float a = sin(p.x * 1.9 + t * 1.1) * sin(p.y * 2.3 - t * 0.9);
          float b = sin((p.x + p.y) * 1.3 - t * 0.7);
          float c = sin((p.x - p.y) * 3.1 + t * 1.6);
          return a * 0.5 + b * 0.3 + c * 0.2;
        }

        void main() {
          if (vDepth < -0.02) discard;
          float t = uTime;
          float r = ripples(vWorld.xz, t);

          // Clear at the margin, deepening to blue-green in the middle.
          float d = smoothstep(0.0, 1.5, vDepth);
          vec3 col = mix(uShallow, uDeep, d) * uLight;

          // The surface mirrors more sky the more it is seen edge-on.
          vec3 view = normalize(cameraPosition - vWorld);
          vec3 n = normalize(vec3(r * 0.12, 1.0, ripples(vWorld.zx + 4.0, t) * 0.12));
          float fres = pow(1.0 - max(dot(view, n), 0.0), 3.0);
          col = mix(col, uSky, 0.18 + 0.6 * fres);

          // Sun glitter.
          vec3 h = normalize(view + uSunDir);
          col += uSun * pow(max(dot(n, h), 0.0), 220.0) * 1.4;

          // A line of foam where water meets land, breathing in and out.
          float edge = 1.0 - smoothstep(0.0, 0.16 + 0.05 * sin(t * 1.3 + vWorld.x * 0.7), vDepth);
          float lap = smoothstep(0.55, 0.9, sin(vDepth * 26.0 - t * 2.0) * 0.5 + 0.5) * (1.0 - smoothstep(0.1, 0.5, vDepth));
          col = mix(col, vec3(1.0) * (0.55 + 0.45 * uLight), clamp(edge * 0.85 + lap * 0.25, 0.0, 1.0));

          float alpha = mix(0.55, 0.93, d);
          alpha = max(alpha, edge);
          float fog = smoothstep(fogNear, fogFar, vFogDepth);
          gl_FragColor = vec4(mix(col, fogColor, fog), alpha);
        }
      `,
    });
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.name = 'pond';
    this.mesh.renderOrder = 2;
  }

  update(dt: number, sky: Sky) {
    const u = this.uniforms;
    u.uTime.value += dt;
    u.uSky.value.copy(sky.fog.color);
    u.uSun.value.copy(sky.sun.color).multiplyScalar(Math.min(sky.sun.intensity / 3, 1));
    u.uSunDir.value.copy(sky.lightDir);
    u.uLight.value = 0.22 + 0.78 * sky.daylight;
    u.fogColor.value.copy(sky.fog.color);
    u.fogNear.value = sky.fog.near;
    u.fogFar.value = sky.fog.far;
  }
}
