/**
 * Runs the game against a stand-in for the published page's shared database
 * and live room, with a second player already in the world, and prints what
 * was written, who was seen, and whether a change made "by the other player"
 * arrived. Also saves screenshots of the welcome screen and the interface.
 *
 *     npm run dev            # in one terminal
 *     mkdir -p shots && node tools/shared_check.mjs
 *
 * Needs Playwright. The real host cannot be reached from a test, so this is
 * the nearest thing to exercising `SharedStore` before publishing.
 */
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const mock = () => {
  const cols = new Map();
  const subs = new Map();
  const col = (n) => cols.get(n) ?? cols.set(n, new Map()).get(n);
  const fire = (n) => {
    const docs = [...col(n)].map(([id, data]) => ({ id, exists: true, data: () => structuredClone(data) }));
    for (const fn of subs.get(n) ?? []) setTimeout(() => fn({ docs }), 5);
  };
  window.__db = cols;
  window.__theirs = (n, id, data) => { if (data) col(n).set(id, data); else col(n).delete(id); fire(n); };
  window.__writes = 0;
  const db = {
    collection: (n) => ({
      doc: (id) => ({
        set: async (data) => { window.__writes++; col(n).set(id, structuredClone(data)); fire(n); },
        delete: async () => { window.__writes++; col(n).delete(id); fire(n); },
      }),
      onSnapshot: (next) => { (subs.get(n) ?? subs.set(n, []).get(n)).push(next); fire(n); return () => {}; },
    }),
  };
  window.__peer = { id: 'u2', name: 'Robin', avatar: 'm_farmer', x: 7, z: 9, heading: 2.4, speed: 0, riding: '', indoors: false };
  window.__mine = null;
  const room = {
    presence: async (p) => { window.__mine = p; },
    peers: () => [{ peer: 'me', by: 'u1', isMe: true, presence: window.__mine ?? {} }, { peer: 'p2', by: 'u2', isMe: false, presence: window.__peer }],
  };
  const user = { id: async () => 'u1', name: async () => 'Alex' };
  window.claude = { use: async (n) => ({ db, room, user })[n] ?? null };
};
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const logs = [];
const open = async (url) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.addInitScript(mock);
  await page.goto(url, { waitUntil: 'load' });
  return page;
};

// 1. The welcome screen, as a shared world presents it.
let page = await open('http://localhost:5174/');
await page.waitForSelector('#welcome:not([hidden])', { timeout: 180000 });
await page.waitForTimeout(800);
await page.screenshot({ path: 'shots/ui_welcome.png' });
console.log('welcome name prefilled:', await page.inputValue('#welcome-name'), '| note:', (await page.textContent('#welcome-mode')).slice(0, 40));
await page.close();

// 2. In the world, with a partner.
page = await open('http://localhost:5174/?manual');
await page.waitForFunction(() => window.homestead, null, { timeout: 180000 });
const report = await page.evaluate(async () => {
  const g = window.homestead;
  g.setHour(16.5);
  for (let i = 0; i < 4; i++) { g.step(1 / 30); await new Promise((r) => setTimeout(r, 60)); }
  await new Promise((r) => setTimeout(r, 2500));   // let the partner's avatar load
  g.player.position.x = 4; g.player.position.z = 7; g.follow.yaw = 3.6; g.follow.pitch = 0.2; g.follow.distance = 8; g.follow.started = false;
  for (let i = 0; i < 4; i++) g.step(1 / 30);
  const before = g.store.all('ledgers').get('u1').earned;
  // Gather beside the partner: the together bonus should apply.
  const out = g.act.gather(g.store, g.moment(), 'log0', 'log');
  g.hud.say(out);
  g.step(1 / 30);
  await new Promise((r) => setTimeout(r, 300));
  return {
    shared: g.store.shared, self: g.store.self,
    collections: Object.fromEntries([...window.__db].map(([k, v]) => [k, v.size])),
    writes: window.__writes,
    peers: g.store.peers().map((p) => p.name),
    together: g.moment().together, gather: out, earned: g.store.all('ledgers').get('u1').earned - before,
    presence: window.__mine && Object.keys(window.__mine).join(','),
    people: document.getElementById('world-people').textContent,
  };
});
console.log(JSON.stringify(report, null, 1));
await page.screenshot({ path: 'shots/ui_world.png', timeout: 120000 });
await page.evaluate(() => { window.homestead.hud.toggle('build'); window.homestead.step(1 / 30); });
await page.screenshot({ path: 'shots/ui_build.png', timeout: 120000 });
await page.evaluate(() => { const g = window.homestead; g.hud.close(); g.pick({ type: 'structure', kind: 'bed' }); g.input.pointer.x = 0.1; g.input.pointer.y = -0.35; g.step(1 / 30); g.step(1 / 30); });
await page.screenshot({ path: 'shots/ui_place.png', timeout: 120000 });
// 3. A change made by the partner arrives through the database, not through us.
const arrived = await page.evaluate(async () => {
  const g = window.homestead;
  window.__theirs('structures', 'theirs', { kind: 'bench', x: 9, z: 9, rot: 0, at: Date.now(), by: 'u2' });
  window.__theirs('ledgers', 'u2', { name: 'Robin', avatar: 'm_farmer', earned: 70, spent: 0, items: { wood: 5 }, counts: {}, seenAt: Date.now() });
  await new Promise((r) => setTimeout(r, 200));
  const saw = g.store.all('structures').has('theirs');
  const purse = [g.act.canAfford(g.store, 100), g.store.all('ledgers').size];
  window.__theirs('structures', 'theirs', null);
  await new Promise((r) => setTimeout(r, 200));
  g.step(1 / 30);
  return { sawTheirs: saw, goneAfterRemoval: !g.store.all('structures').has('theirs'), purse, basket: document.getElementById('basket-points').textContent };
});
console.log(JSON.stringify(arrived));
console.log(logs.slice(0, 12).join('\n') || 'no console errors');
await browser.close();
