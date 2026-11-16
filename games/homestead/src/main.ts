/**
 * Boot and the frame loop. Builds the world once, then each frame:
 * read input → move the rider → let the animals think → update the sky → draw.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import './ui.css';
import { loadAssets, wind } from './assets';
import { FollowCamera } from './camera';
import { Animals } from './entities/animals';
import { Rider } from './entities/rider';
import { Input } from './input';
import { Hud } from './ui';
import { Effects } from './world/fx';
import { Grass } from './world/grass';
import { buildHomestead } from './world/homestead';
import { scatter } from './world/scatter';
import { Sky } from './world/sky';
import { Terrain } from './world/terrain';
import { Water } from './world/water';

/** Let the page paint before a long synchronous step. */
const breathe = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function boot() {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const hud = new Hud();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Neutral keeps colours as painted; filmic curves grey out the saturated
  // greens and warm light this look depends on.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const follow = new FollowCamera();
  const input = new Input(canvas);

  hud.loading('Gathering the animals', 0.05);
  const assets = await loadAssets((done, total) => hud.loading('Gathering the animals', 0.05 + 0.5 * (done / total)));

  hud.loading('Raising the hills', 0.6);
  await breathe();
  const terrain = new Terrain();
  scene.add(terrain.mesh);

  hud.loading('Planting the woods', 0.78);
  await breathe();
  const sky = new Sky(scene);
  const plants = scatter(assets, terrain);
  const home = buildHomestead(assets, terrain);
  const water = new Water(terrain);
  const grass = new Grass(terrain);
  const effects = new Effects(home.chimney, home.fire, home.door, terrain);
  scene.add(plants.group, home.group, water.mesh, grass.group, effects.group);

  const rider = new Rider(assets);
  rider.position.set(4, 0, 17);
  rider.horse.heading = 0.5;
  scene.add(rider.horse.root);
  const animals = new Animals(assets, terrain);
  scene.add(animals.group);
  const solid = { obstacles: [...plants.obstacles, ...home.obstacles], walls: home.walls };

  // ---- drawing ---------------------------------------------------------------
  // Rendered into a floating-point buffer so the sun, the fire and lit windows
  // can be brighter than white and bloom; tone mapping happens at the very end.
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, follow.camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.7, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let detail: 'high' | 'low' = 'high';
  const applyDetail = () => {
    const high = detail === 'high';
    const ratio = Math.min(window.devicePixelRatio, high ? 2 : 1);
    renderer.setPixelRatio(ratio);
    composer.setPixelRatio(ratio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    composer.setSize(window.innerWidth, window.innerHeight);
    follow.camera.aspect = window.innerWidth / window.innerHeight;
    follow.camera.updateProjectionMatrix();
    grass.quality = high ? 1 : 0.5;
    bloom.enabled = high;
    sky.sun.shadow.mapSize.setScalar(high ? 2048 : 1024);
    sky.sun.shadow.map?.dispose();
    sky.sun.shadow.map = null;
    hud.setDetail(detail);
  };
  window.addEventListener('resize', applyDetail);
  applyDetail();

  hud.bindClock(sky);
  hud.onDetail = () => {
    detail = detail === 'high' ? 'low' : 'high';
    applyDetail();
  };
  input.onPress = (code) => {
    if (code === 'KeyC') rider.ambling = !rider.ambling;
    if (code === 'KeyH') hud.toggle();
    if (code === 'KeyP') hud.toggleClock(sky);
  };

  // Warm the grass round the start so the first frame is not bare earth.
  for (let i = 0; i < 40; i++) grass.update(rider.position);

  const clock = new THREE.Clock();
  let slowFrames = 0;
  // `?manual` hands the clock to whoever is driving the page (the screenshot
  // tooling): nothing advances until step() is called.
  const manual = new URLSearchParams(location.search).has('manual');
  const advance = (dt: number) => {

    rider.step(dt, rider.intent(input), terrain, solid);
    animals.update(dt, rider.position, Math.abs(rider.horse.speed), rider.horse.heading);
    follow.update(dt, input, rider.position, rider.horse.heading, rider.horse.speed, terrain);
    input.endFrame();

    wind.uTime.value += dt;
    sky.update(dt, rider.position, follow.camera);
    grass.update(rider.position);
    plants.update(rider.position);
    water.update(dt, sky);
    effects.update(dt, sky, renderer.domElement.height, follow.camera.fov);
    // Windows are dark by day and lit from dusk.
    assets.windowGlow.emissiveIntensity = 2.6 * THREE.MathUtils.smoothstep(1 - sky.daylight, 0.25, 0.75);
    renderer.toneMappingExposure = sky.exposure;
    hud.tick(sky);

    composer.render(dt);
  };
  const frame = () => {
    // Clamp the step: after a tab switch the gap can be seconds long.
    const raw = clock.getDelta();
    advance(Math.min(raw, 0.05));

    // If the machine cannot keep up, step the detail down once, on its own.
    if (detail === 'high' && clock.elapsedTime > 4) {
      slowFrames = raw > 1 / 28 ? slowFrames + 1 : Math.max(0, slowFrames - 2);
      if (slowFrames > 90) {
        detail = 'low';
        applyDetail();
      }
    }
    requestAnimationFrame(frame);
  };

  hud.loading('Ready', 1);
  // Hooks for automated screenshots and for poking at the world from the console.
  Object.assign(window, {
    homestead: { scene, renderer, sky, rider, follow, animals, terrain, hud, composer, input, step: advance },
  });
  requestAnimationFrame(() => {
    if (manual) advance(1 / 60);
    else frame();
    hud.ready();
  });
}

boot().catch((err) => {
  console.error(err);
  const text = document.getElementById('loading-text');
  if (text) text.textContent = `Something went wrong: ${err instanceof Error ? err.message : String(err)}`;
});
