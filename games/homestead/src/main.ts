/**
 * Boot and the frame loop.
 *
 * Builds the countryside once, connects to wherever the world is kept, and
 * then each frame: read input → move you → let the animals think → make the
 * scene match the shared world → draw.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import './ui.css';
import { loadAssets, wind } from './assets';
import { Builder, type Tool } from './build';
import { FollowCamera, type View } from './camera';
import { Peers } from './entities/peers';
import { Player } from './entities/player';
import { Stock } from './entities/stock';
import { Wild } from './entities/wild';
import * as act from './game/actions';
import { AVATARS, DAY_MS, FURNITURE, GOALS, STRUCTURES, TOGETHER_RANGE, type AvatarId } from './game/catalog';
import { LocalStore, SharedStore } from './game/stores';
import { clock, level, meta, myLedger, type Store } from './game/world';
import { Input } from './input';
import { KEY_CODES, nearest, type ActionKey, type Spot } from './interact';
import { DOOR, Interior } from './interior';
import { Hud } from './ui';
import { Ambient } from './world/ambient';
import { Effects } from './world/fx';
import { Grass } from './world/grass';
import { Nodes } from './world/nodes';
import { scatter } from './world/scatter';
import { Seasons } from './world/seasons';
import { Sky } from './world/sky';
import { Structures } from './world/structures';
import { Terrain } from './world/terrain';
import { Water } from './world/water';

/** Let the page paint before a long synchronous step. */
const breathe = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function boot() {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const params = new URLSearchParams(location.search);
  // `?manual` hands the clock to whoever is driving the page (the screenshot
  // tooling): nothing advances until step() is called, and nobody is asked
  // their name.
  const manual = params.has('manual');

  const store: Store = (await SharedStore.connect().catch(() => null)) ?? new LocalStore();
  // Tests can move the clock; the game itself never does.
  const debug = { timeShift: 0 };
  const now = () => Date.now() + debug.timeShift;

  let tool: Tool | null = null;
  const hud = new Hud(store, {
    pick: (t) => pick(t),
    cook: (recipe, at) => say(act.cook(store, moment(), recipe, at)),
    plant: (bed, slot, crop) => say(act.plant(store, moment(), bed, slot, crop)),
    buyAnimal: (kind) => say(act.buyAnimal(store, moment(), kind)),
    paint: (what, index) => say(act.paint(store, moment(), what, index)),
    weather: (w) => act.setWeather(store, w),
    detail: () => {
      detail = detail === 'high' ? 'low' : 'high';
      applyDetail();
    },
    startOver: () => {
      if (store.shared) return hud.toast('A shared world cannot be erased from here.', { bad: true });
      LocalStore.erase();
      location.reload();
    },
  });

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
  const water = new Water(terrain);
  const grass = new Grass(terrain);
  const fx = new Effects(terrain);
  const ambient = new Ambient(terrain);
  const seasons = new Seasons(assets, grass, terrain.mesh.material as THREE.MeshLambertMaterial);
  scene.add(plants.group, water.mesh, grass.group, fx.group, ambient.group);

  // ---- the shared world ------------------------------------------------------
  hud.loading('Pitching camp', 0.9);
  // Pitch camp only in a world known to be empty. If the shared world did not
  // answer in time, assuming it is new would overwrite the real one's clock.
  const known = !(store instanceof SharedStore) || store.loaded.has('meta');
  if (known) act.settle(store, now());
  const mine = myLedger(store);
  const suggested = mine.name !== 'Someone' ? mine.name : store instanceof SharedStore ? store.suggestedName : '';
  const who = manual
    ? { name: suggested || 'Tester', avatar: (params.get('avatar') as AvatarId) || mine.avatar }
    : await hud.welcome(suggested, mine.avatar in AVATARS ? mine.avatar : 'f_adventurer', store.shared);
  act.join(store, who.name, who.avatar, now());
  if (manual) document.getElementById('hud')!.hidden = false;
  if (!known) hud.toast('The shared world is slow to answer. What you do may not be saved.', { bad: true });

  const player = new Player(who.avatar);
  scene.add(player.avatar.root);
  const outdoors = new THREE.Vector3();

  // What the world's systems call back into.
  const moment = (): act.Moment => ({ now: now(), together: peers.near(player.position.x, player.position.z, player.indoors, TOGETHER_RANGE) });
  const say = (out: act.Outcome) => {
    hud.say(out);
    if (out.ok) player.avatar.gesture();
  };
  const bridge = {
    moment,
    say,
    hearts: (at: THREE.Vector3) => fx.hearts(at),
    openCook: (at: 'fire' | 'stove') => hud.cook(at),
    openPlant: (bed: string, slot: number) => hud.plant(bed, slot),
    enterHouse: () => goIndoors(),
    leaveHouse: () => goOutdoors(),
    mount: (id: string) => {
      const horse = stock.creature(id);
      if (!horse || stock.ridden.has(id) || player.mount) return;
      stock.ridden.add(id);
      player.ride(id, horse);
    },
    homeAt: (id: string) => structures.position(id),
    findNear: (x: number, z: number) => nodes.nearestReady(x, z, 28),
  };

  const structures = new Structures(assets, terrain, store, fx, bridge);
  const nodes = new Nodes(assets, terrain, store, plants.obstacles, bridge);
  const stock = new Stock(assets, terrain, store, bridge);
  const wild = new Wild(assets, terrain);
  const peers = new Peers(store, stock, terrain);
  const interior = new Interior(assets, store, bridge);
  const builder = new Builder(assets, store, terrain, structures, interior, plants.obstacles);
  scene.add(structures.group, nodes.group, stock.group, wild.group);
  const indoorFx = new Effects(null);
  interior.scene.add(indoorFx.group);

  const activeScene = () => (player.indoors ? interior.scene : scene);
  function pick(next: Tool | null) {
    tool = next;
    builder.use(next, activeScene());
  }
  function getDown() {
    if (!player.mount) return;
    stock.ridden.delete(player.mount.id);
    player.dismount(scene);
  }
  function goIndoors() {
    getDown();
    pick(null);
    hud.close();
    outdoors.copy(player.position);
    player.indoors = true;
    player.position.set(DOOR.x + 0.6, 0, DOOR.z);
    player.heading = Math.PI / 2;
    interior.scene.add(player.avatar.root);
    follow.cut('room');
  }
  function goOutdoors() {
    pick(null);
    hud.close();
    player.indoors = false;
    const door = structures.door();
    player.position.copy(door ?? outdoors);
    scene.add(player.avatar.root);
    follow.cut('foot');
  }

  // Tell the player when something on the list is done, or a new chapter starts.
  let seenLevel = level(store).index;
  const seenGoals = new Set(store.all('goals').keys());
  store.subscribe((name, id) => {
    if (name === 'goals' && !seenGoals.has(id) && store.all('goals').has(id)) {
      seenGoals.add(id);
      const g = GOALS[Number(id)];
      if (g) hud.toast(`Done: ${g.text}`, { points: g.reward, big: true });
    }
    if (name === 'ledgers') {
      const lv = level(store);
      if (lv.index > seenLevel) hud.toast(lv.title, { big: true });
      seenLevel = lv.index;
    }
  });

  // ---- drawing ---------------------------------------------------------------
  // Rendered into a floating-point buffer so the sun, the fire and lit windows
  // can be brighter than white and bloom; tone mapping happens at the very end.
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  const renderPass = new RenderPass(scene, follow.camera);
  composer.addPass(renderPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.7, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let detail: 'high' | 'low' = 'high';
  function applyDetail() {
    const high = detail === 'high';
    // Sharpness is the last thing to give up: a soft picture reads as a cheap
    // one. Low detail trims grass and shadows before it trims pixels.
    const ratio = Math.min(window.devicePixelRatio, high ? 2 : 1.5);
    renderer.setPixelRatio(ratio);
    composer.setPixelRatio(ratio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    composer.setSize(window.innerWidth, window.innerHeight);
    follow.camera.aspect = window.innerWidth / window.innerHeight;
    follow.camera.updateProjectionMatrix();
    grass.quality = high ? 1 : 0.45;
    bloom.enabled = high;
    sky.sun.shadow.mapSize.setScalar(high ? 2048 : 1024);
    sky.sun.shadow.map?.dispose();
    sky.sun.shadow.map = null;
    hud.setDetail(detail);
  }
  window.addEventListener('resize', applyDetail);
  applyDetail();

  // ---- keys ------------------------------------------------------------------
  let spot: Spot | null = null;
  input.onPress = (code) => {
    if (code === 'Escape') {
      if (tool) pick(null);
      else hud.close();
      return;
    }
    if (code === 'KeyB') return hud.toggle('build');
    if (code === 'KeyI') return hud.toggle('pantry');
    if (code === 'KeyH') return hud.toggle('help');
    if (code === 'KeyU') return hud.hideBar();
    if (code === 'KeyC') {
      player.easy = !player.easy;
      return;
    }
    if (tool) {
      if (code === 'KeyR') builder.rotate(player.indoors);
      return;
    }
    for (const key of Object.keys(KEY_CODES) as ActionKey[]) {
      if (KEY_CODES[key] !== code) continue;
      const action = spot?.actions.find((a) => a.key === key);
      if (action?.blocked) hud.toast(action.blocked, { bad: true });
      else action?.run();
    }
  };

  // Warm the grass round the start so the first frame is not bare earth.
  for (let i = 0; i < 40; i++) grass.update(player.position);

  const pointer = new THREE.Vector2();
  const roomView = new THREE.Vector3();
  let rain = 0;
  let spotClock = 0;
  const advance = (dt: number) => {
    const t = now();
    const world = meta(store);
    const time = clock(world, t);
    const indoors = player.indoors;

    // ---- you -------------------------------------------------------------------
    const solids = indoors ? [{ obstacles: interior.obstacles, walls: [] }] : [{ obstacles: plants.obstacles, walls: [] }, { obstacles: structures.obstacles, walls: structures.walls }];
    player.step(dt, input, follow.yaw, terrain, solids);
    const view: View = indoors ? 'room' : player.mount ? 'ride' : 'foot';
    // Indoors the camera frames the room more than it chases you round it.
    const lookAt = indoors ? roomView.copy(player.position).multiplyScalar(0.4) : player.position;
    follow.update(dt, input, view, lookAt, player.heading, player.speed, indoors ? null : terrain);
    store.present({ name: who.name, avatar: who.avatar, x: player.position.x, z: player.position.z, heading: player.heading, speed: player.speed, riding: player.mount?.id ?? '', indoors });

    // ---- everyone else ---------------------------------------------------------
    const me = { x: indoors ? outdoors.x : player.position.x, z: indoors ? outdoors.z : player.position.z, heading: player.heading, speed: player.speed, indoors };
    structures.update(dt, t);
    nodes.update(dt, t);
    stock.update(dt, t, me);
    wild.update(dt, me);
    peers.update(dt, scene, interior.scene);

    // ---- what you are standing next to ----------------------------------------
    spotClock -= dt;
    if (spotClock <= 0) {
      spotClock = 0.1;
      const px = player.position.x;
      const pz = player.position.z;
      if (tool) spot = null;
      else if (player.mount) {
        const name = store.all('animals').get(player.mount.id)?.name ?? 'your horse';
        spot = { x: px, z: pz, reach: 1, title: `Riding ${name}`, actions: [{ key: 'F', label: 'Get down', run: getDown }] };
      } else spot = nearest(indoors ? interior.spots() : [...structures.spots(t), ...nodes.spots(px, pz), ...stock.spots(t, px, pz)], px, pz);
      hud.prompt(spot);
    }

    // ---- building ---------------------------------------------------------------
    if (tool) {
      builder.update(pointer.set(input.pointer.x, input.pointer.y), follow.camera, player.position, indoors);
      const name = tool.type === 'structure' ? STRUCTURES[tool.kind].name : tool.type === 'furniture' || tool.type === 'move' ? FURNITURE[tool.kind].name : '';
      const hint =
        tool.type === 'remove' ? 'Click something to take it away  ·  Esc to stop' : tool.type === 'pick' ? 'Click a piece to pick it up  ·  Esc to stop' : `${name}: click to place  ·  R to turn  ·  Esc when done`;
      hud.toolHint(builder.problem || hint, !!builder.problem);
      if (input.clicked) {
        const out = builder.click(moment(), activeScene());
        if (out) say(out);
        tool = builder.tool;
      }
    } else hud.toolHint(null);
    input.endFrame();

    // ---- the world itself -------------------------------------------------------
    sky.hour = time.hour;
    sky.setWeather(world.weather);
    rain += ((world.weather === 'rain' ? 1 : 0) - rain) * (1 - Math.exp(-dt * 0.6));
    seasons.update(time.seasonAt);
    wind.uTime.value += dt;
    wind.uStrength.value = 1 + rain * 0.9 + sky.overcast * 0.3;
    const night = 1 - sky.daylight;
    const lit = THREE.MathUtils.smoothstep(night, 0.25, 0.75);
    renderPass.scene = activeScene();
    if (indoors) {
      interior.update(dt, sky.daylight, sky.fog.color);
      indoorFx.update(dt, null, follow.camera, renderer.domElement.height);
      renderer.toneMappingExposure = 1;
    } else {
      sky.update(dt, player.position, follow.camera);
      grass.update(player.position);
      plants.update(player.position);
      water.update(dt, sky);
      ambient.update(dt, sky.daylight, rain);
      fx.update(dt, sky, follow.camera, renderer.domElement.height, rain);
      // Windows and lanterns are dark by day and lit from dusk.
      assets.windowGlow.emissiveIntensity = 2.6 * lit;
      assets.lampGlow.emissiveIntensity = 2.4 * lit;
      renderer.toneMappingExposure = sky.exposure;
    }
    hud.tick(t, peers.list().map((p) => p.name), indoors);
    composer.render(dt);
  };

  const timer = new THREE.Clock();
  let slow = 0;
  const frame = () => {
    // Clamp the step: after a tab switch the gap can be seconds long.
    const raw = timer.getDelta();
    advance(Math.min(raw, 0.05));
    // If the machine cannot keep up, step the detail down once, on its own.
    if (detail === 'high' && timer.elapsedTime > 5) {
      slow = raw > 1 / 24 ? slow + 1 : Math.max(0, slow - 2);
      if (slow > 100) {
        detail = 'low';
        applyDetail();
      }
    }
    requestAnimationFrame(frame);
  };

  hud.loading('Ready', 1);
  // Hooks for automated screenshots and for poking at the world from the console.
  Object.assign(window, {
    homestead: {
      scene, renderer, sky, player, follow, stock, terrain, hud, composer, input, store, act, debug, interior, structures, builder,
      step: advance, pick, goIndoors, goOutdoors, moment, mount: bridge.mount,
      /** Move the test clock so the world reads this hour. */
      setHour: (hour: number) => {
        const current = clock(meta(store), now()).hour;
        debug.timeShift += ((((hour - current) % 24) + 24) % 24) / 24 * DAY_MS;
      },
    },
  });
  requestAnimationFrame(() => {
    if (manual) advance(1 / 60);
    else frame();
    document.getElementById('loading')!.classList.add('done');
  });
}

boot().catch((err) => {
  console.error(err);
  const text = document.getElementById('loading-text');
  if (text) text.textContent = `Something went wrong: ${err instanceof Error ? err.message : String(err)}`;
});
