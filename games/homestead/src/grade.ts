/**
 * The last touch before the picture is shown: a gentle film grade.
 *
 * Runs on the tone-mapped image. Lifts contrast a little in the midtones,
 * pushes shadows a touch cool and highlights a touch warm (the way daylight
 * and skylight actually differ), and darkens the corners so the eye settles
 * in the middle. Each is small; together they are the difference between a
 * render and a photograph of a place.
 */
import * as THREE from 'three';

export const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.32 },
    uContrast: { value: 1.14 },
    uSaturation: { value: 1.08 },
    uSplit: { value: 0.035 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uContrast;
    uniform float uSaturation;
    uniform float uSplit;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // Contrast about mid-grey, as an S-curve rather than a straight stretch.
      c = mix(c, smoothstep(0.0, 1.0, c), uContrast - 1.0);
      c = mix(vec3(luma), c, uSaturation);
      // Split tone: cool in the shadows, warm in the highlights.
      c += uSplit * mix(vec3(-0.25, 0.0, 0.35), vec3(0.4, 0.12, -0.3), smoothstep(0.15, 0.85, luma));
      // Vignette: a soft oval falloff.
      vec2 d = (vUv - 0.5) * vec2(1.0, 0.82);
      c *= 1.0 - uVignette * smoothstep(0.32, 0.85, length(d) * 1.4);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
};
