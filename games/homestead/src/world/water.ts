/**
 * The pond: a still sheet of water that reflects the sky actually overhead.
 *
 * It is a physically based surface with almost no roughness, so the scene's
 * captured sky does the reflecting. Two layers of a real water normal map,
 * drifting in different directions, break that reflection into ripples. How
 * deep the water is at each point, baked once, decides how clear it is: a
 * pale margin you can see the bottom through, deepening to dark green-blue.
 */
import * as THREE from 'three';
import { wind } from '../assets';
import { POND, WATER_LEVEL } from './land';
import type { Sky } from './sky';
import type { Terrain } from './terrain';

import normalsUrl from '../assets/scan/waternormals.jpg?url';

export class Water {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshStandardMaterial;

  constructor(terrain: Terrain) {
    const size = POND.radius * 3.4;
    const segs = 64;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);
    geo.translate(POND.x, WATER_LEVEL, POND.z);
    const pos = geo.getAttribute('position');
    const depth = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) depth[i] = WATER_LEVEL - terrain.height(pos.getX(i), pos.getZ(i));
    geo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
    // Normal-map coordinates in metres.
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 9, pos.getZ(i) / 9);

    const normals = new THREE.TextureLoader().load(normalsUrl);
    normals.wrapS = normals.wrapT = THREE.RepeatWrapping;
    this.material = new THREE.MeshStandardMaterial({
      color: 0x1d3a3c,
      roughness: 0.04,
      metalness: 0,
      normalMap: normals,
      transparent: true,
      depthWrite: false,
    });
    this.material.normalScale.setScalar(0.35);
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = wind.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aDepth;\nvarying float vDepth;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDepth = aDepth;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vDepth;')
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `
          vec3 n1 = texture2D(normalMap, vNormalMapUv + vec2(uTime * 0.012, uTime * 0.008)).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(normalMap, vNormalMapUv * 1.9 + vec2(-uTime * 0.009, uTime * 0.014)).xyz * 2.0 - 1.0;
          vec3 mapN = normalize(vec3(n1.xy + n2.xy, n1.z * n2.z));
          mapN.xy *= normalScale;
          normal = normalize(tbn * mapN);`,
        )
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
          if (vDepth < -0.02) discard;
          float deep = smoothstep(0.0, 1.6, vDepth);
          // Shallow water is clear and takes the colour of the silt under it.
          diffuseColor.rgb = mix(vec3(0.32, 0.36, 0.26), diffuseColor.rgb, deep);
          diffuseColor.a = mix(0.35, 0.94, deep);`,
        )
        .replace(
          '#include <opaque_fragment>',
          /* glsl */ `
          // Seen edge-on, water is a mirror; looking straight down, you see in.
          float facing = abs(dot(normalize(vViewPosition), normal));
          float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
          diffuseColor.a = clamp(max(diffuseColor.a, fresnel), 0.0, 1.0);
          #include <opaque_fragment>`,
        );
    };
    this.material.customProgramCacheKey = () => 'pond';
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'pond';
    this.mesh.renderOrder = 2;
    this.mesh.receiveShadow = true;
  }

  update(_dt: number, sky: Sky) {
    // Rain roughens the surface; a still evening leaves it glassy.
    this.material.normalScale.setScalar(0.3 + 0.5 * sky.overcast);
  }
}
