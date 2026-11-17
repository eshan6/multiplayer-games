/** The parts of n8ao (ships without types) that the game uses. */
declare module 'n8ao' {
  import type { Camera, Scene } from 'three';
  import { Pass } from 'three/addons/postprocessing/Pass.js';
  export class N8AOPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    scene: Scene;
    camera: Camera;
    configuration: {
      aoRadius: number;
      distanceFalloff: number;
      intensity: number;
      halfRes: boolean;
      gammaCorrection: boolean;
      screenSpaceRadius: boolean;
      transparencyAware: boolean;
      accumulate: boolean;
    };
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
    setSize(width: number, height: number): void;
  }
}
