/**
 * Plays the game through its real keys, buttons and clicks, headless, and
 * prints what happened at each step: walk, gather, ride, build, plant, water,
 * harvest, cook, build the cottage, go inside, furnish, come out, feed the dog.
 *
 *     npm run dev            # in one terminal
 *     node tools/playthrough.mjs
 *
 * Needs Playwright with a Chromium it can launch. It is a check to run by
 * hand after changing how things are wired together, not part of `npm test`.
 */
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://localhost:5174/?manual', { waitUntil: 'load' });
await page.waitForFunction(() => window.homestead, null, { timeout: 180000 });
const result = await page.evaluate(async () => {
  const g = window.homestead, s = g.store;
  const key = (code) => { window.dispatchEvent(new KeyboardEvent('keydown', { code })); window.dispatchEvent(new KeyboardEvent('keyup', { code })); };
  const run = (n = 4, dt = 0.05) => { for (let i = 0; i < n; i++) g.step(dt); };
  const prompt = () => document.getElementById('prompt').hidden ? null : document.getElementById('prompt-title').textContent + ' | ' + document.getElementById('prompt-actions').textContent;
  const have = (item) => [...s.all('ledgers').values()].reduce((n, l) => n + (l.items[item] ?? 0), 0);
  const out = {};
  const camp = [...s.all('structures')].find(([, d]) => d.kind === 'campfire')[1];
  run();

  try { // 1.  Walk: hold W for a second on foot.
  const z0 = g.player.position.z;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
  run(20);
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
  out.walked = +(Math.hypot(g.player.position.z - z0)).toFixed(1);
  } catch (e) { out['error1'] = String(e.message || e); }

  try { // 2. Gather: stand at the first fallen branch and press E.
  const nodes = g.scene.getObjectByName('nodes');
  // Find a ready branch by asking for the nearest thing the dog would point at.
  let found = null;
  for (let r = 14; r < 60 && !found; r += 4) for (let a = 0; a < 6.3 && !found; a += 0.2) {
    g.player.position.x = Math.cos(a) * r; g.player.position.z = Math.sin(a) * r; run(3);
    const p = prompt(); if (p && /Fallen branch|Loose stones|Berry bush|Mushrooms/.test(p)) found = p;
  }
  out.foundPrompt = found;
  const before = have('wood') + have('stone') + have('berries') + have('mushroom');
  key('KeyE'); run(3);
  out.gathered = have('wood') + have('stone') + have('berries') + have('mushroom') - before;
  } catch (e) { out['error2'] = String(e.message || e); }

  try { // 3. Ride: go to a horse, press F, ride forward, press F again.
  const horse = g.stock.position('horse-a');
  g.player.position.x = horse.x + 1.2; g.player.position.z = horse.z; run(3);
  out.horsePrompt = prompt();
  key('KeyF'); run(3);
  out.mounted = !!g.player.mount;
  const hx = g.player.position.x, hz = g.player.position.z;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })); run(30);
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
  out.rode = +Math.hypot(g.player.position.x - hx, g.player.position.z - hz).toFixed(1);
  out.ridingPrompt = prompt();
  key('KeyF'); run(3);
  out.dismounted = !g.player.mount;
  } catch (e) { out['error3'] = String(e.message || e); }

  try { // 4. Build by pointing and clicking, like a player would.
  const l = structuredClone(s.all('ledgers').get(s.self)); l.earned += 2000; l.items.wood = 60; l.items.stone = 40; l.items.carrot = 6; l.items.mushroom = 4; s.put('ledgers', s.self, l);
  g.player.position.x = 6; g.player.position.z = 10; g.follow.yaw = 0; g.follow.pitch = 0.5; g.follow.distance = 10; g.follow.started = false; run(3);
  const count = () => s.all('structures').size;
  const n0 = count();
  key('KeyB'); run(2);
  out.sheetOpen = !document.getElementById('sheet').hidden && document.getElementById('sheet-title').textContent;
  // Choose "Vegetable bed" from the Farm tab by clicking the real buttons.
  [...document.querySelectorAll('#sheet-tabs button')].find((b) => b.textContent === 'Farm').click();
  [...document.querySelectorAll('#sheet-body .card')].find((b) => b.textContent.includes('Vegetable bed')).click();
  g.input.pointer.x = 0.25; g.input.pointer.y = -0.2; run(3);
  out.hint = document.getElementById('tool-hint').textContent;
  g.input.clicked = true; run(1); run(3);
  out.builtBed = count() - n0;
  key('Escape'); run(2);
  out.toolAway = document.getElementById('tool-hint').hidden;
  } catch (e) { out['error4'] = String(e.message || e); }

  try { // 5. Plant in the new bed through the seed sheet, then water, then harvest later.
  const [bedId, bed] = [...s.all('structures')].find(([, d]) => d.kind === 'bed');
  g.player.position.x = bed.x - 1.25; g.player.position.z = bed.z - 0.62; run(4);
  out.bedPrompt = prompt();
  key('KeyE'); run(2);
  [...document.querySelectorAll('#sheet-body .card')].find((b) => b.textContent.includes('Carrots')).click(); run(4);
  out.planted = s.all('crops').size;
  out.cropPrompt = prompt();
  key('KeyE'); run(3);
  out.watered = [...s.all('crops').values()][0]?.wateredAt > 0;
  g.debug.timeShift += 6 * 60000; run(12, 0.1);
  out.ripePrompt = prompt();
  const c0 = have('carrot'); key('KeyE'); run(3);
  out.harvested = have('carrot') - c0;
  } catch (e) { out['error5'] = String(e.message || e); }

  try { // 6. Cook over the fire.
  g.player.position.x = camp.x + 1.4; g.player.position.z = camp.z; run(4);
  out.firePrompt = prompt();
  key('KeyE'); run(2);
  const meals0 = have('meal');
  [...document.querySelectorAll('#sheet-body .card')].find((b) => b.textContent.includes('Roasted mushrooms')).click(); run(2);
  out.cooked = have('meal') - meals0;
  key('Escape'); run(2);
  } catch (e) { out['error6'] = String(e.message || e); }

  try { // 7. Build the cottage, go in by its door, furnish, come out.
  g.pick({ type: 'structure', kind: 'cottage' });
  g.player.position.x = -8; g.player.position.z = -6; g.follow.yaw = 0; g.follow.pitch = 0.6; g.follow.distance = 14; g.follow.started = false; run(3);
  g.input.pointer.x = 0; g.input.pointer.y = 0.3; run(3);
  out.cottageHint = document.getElementById('tool-hint').textContent;
  g.input.clicked = true; run(1); key('Escape'); run(4);
  out.cottage = [...s.all('structures').values()].some((d) => d.kind === 'cottage');
  const door = g.structures.door();
  if (door) { g.player.position.x = door.x; g.player.position.z = door.z; run(4); }
  out.doorPrompt = prompt();
  key('KeyE'); run(4);
  out.indoors = g.player.indoors;
  key('KeyB'); run(2);
  out.indoorSheet = document.getElementById('sheet-title').textContent + ': ' + [...document.querySelectorAll('#sheet-tabs button')].map((b) => b.textContent).join(',');
  [...document.querySelectorAll('#sheet-tabs button')].find((b) => b.textContent === 'Kitchen').click();
  [...document.querySelectorAll('#sheet-body .card')].find((b) => b.textContent.includes('Stove')).click();
  g.input.pointer.x = 0; g.input.pointer.y = 0; run(3);
  g.input.clicked = true; run(1); key('Escape'); run(3);
  out.furniture = s.all('furniture').size;
  const stove = [...s.all('furniture').values()][0];
  if (stove) { g.player.position.x = stove.x + 1; g.player.position.z = stove.z + 0.6; run(4); }
  out.stovePrompt = prompt();
  g.player.position.x = -4.6; g.player.position.z = 2.65; run(4);
  out.exitPrompt = prompt();
  key('KeyE'); run(4);
  out.outdoorsAgain = !g.player.indoors;
  } catch (e) { out['error7'] = String(e.message || e); }

  try { // 8. Feed the dog.
  const dog = g.stock.position('dog');
  g.player.position.x = dog.x + 0.8; g.player.position.z = dog.z; run(3);
  out.dogPrompt = prompt();
  const fed0 = s.all('animals').get('dog').fedAt; key('KeyE'); run(2);
  out.fedDog = s.all('animals').get('dog').fedAt > fed0;
  } catch (e) { out['error8'] = String(e.message || e); }

  out.points = document.getElementById('basket-points').textContent;
  out.goal = document.getElementById('goal').textContent;
  out.level = document.getElementById('basket-level').textContent;
  return out;
});
console.log(JSON.stringify(result, null, 1));
console.log(logs.slice(0, 12).join('\n') || 'no console errors');
await browser.close();
