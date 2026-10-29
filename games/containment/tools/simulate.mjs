// Headless balance harness. Plays whole games with scripted strategies against
// the real engine, extracted from ../index.html, and prints win rates.
//
//   node games/containment/tools/simulate.mjs [games-per-cell] [pathogen,...] [difficulty,...]
//
// Strategies:
//   idle     never acts. Must lose every time, or the pathogens are toothless.
//   casual   buys whatever it can afford in random order, reacts late, misses bubbles.
//   expert   a sensible human plan: detect, contain early, fund the vaccine, share it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.CONTAINMENT_HTML || path.join(here, '..', 'index.html'), 'utf8');
const block = id => {
  const m = html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`));
  if (!m) throw new Error(`no ${id} block`);
  return m[1];
};
const ctx = { module: { exports: {} } };
vm.createContext(ctx);
vm.runInContext(block('mapdata') + '\n;this.MAP=MAP;', ctx);
vm.runInContext(block('engine'), ctx);
const C = ctx.module.exports;
const MAP = ctx.MAP;

export function makeBot(kind, seed) {
  let x = seed * 7919 + 13;
  const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const EXPERT_ORDER = ['d1', 'd3', 'c1', 'r1', 'd2', 'c2', 'c3', 's1', 'c14', 'c4', 's13', 'r3', 'c8', 'd5', 'c6', 'c7', 't1',
    'c11', 'c13', 't14', 'r4', 'r6', 't12', 'd4', 'c5', 'c15', 's4', 'r5', 'd7', 't3', 'd13', 's2', 'r10', 'r7', 'r9', 'r8', 'd8',
    't2', 's3', 's11', 's7', 'c16', 'd10', 'c10', 't4', 'd9', 'c9', 't5', 't6', 's6', 'r12', 's12', 's5', 'r11', 'd6', 't7',
    's10', 's8', 't15', 't9', 't8', 't11', 't13', 'r13', 's9', 's14', 'd14', 't10', 'r14', 'r2', 'd11', 'd12', 'c12'];
  const order = kind === 'casual' ? [...EXPERT_ORDER].sort(() => rnd() - .5) : EXPERT_ORDER;
  const collect = kind === 'expert' ? .85 : .45;
  const seen = new Set();
  return function act(g) {
    if (kind === 'idle') {
      if (g.s.pendingEvent) for (let j = g.eventCard().choices.length - 1; j >= 0 && g.s.pendingEvent; j--) g.resolveEvent(j);
      return;
    }
    // Bubbles: a human taps most of them, not all.
    for (const b of [...g.s.bubbles]) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      if (rnd() < collect) g.collectBubble(b.id);
    }
    if (g.s.pendingEvent) {
      const card = g.eventCard();
      let k = card.choices.length - 1;
      if (kind === 'expert') {
        const i = card.choices.findIndex(c => c.cost && g.canAfford(c.cost) && (c.cost.authority || 0) <= 3);
        if (i >= 0 && g.s.pendingEvent.id !== 'challenge' && g.s.pendingEvent.id !== 'pharma') k = i;
        if (g.s.pendingEvent.id === 'pharma' || g.s.pendingEvent.id === 'donor') k = 0;
      } else k = Math.floor(rnd() * card.choices.length);
      if (!g.resolveEvent(k)) for (let j = card.choices.length - 1; j >= 0 && g.s.pendingEvent; j--) g.resolveEvent(j);
    }
    for (const id of order) {
      if (g.s.upgrades.includes(id) || !g.upgradeVisible(id)) continue;
      if (!g.upgradeAvailable(id)) continue;
      if (g.s.funding >= g.upgradeCost(id)) g.buyUpgrade(id);
      break; // save up for the next item in the plan
    }
    if (kind === 'casual' && g.s.day % 3) return; // reacts in fits and starts
    const late = kind === 'expert' ? 1 : 4;
    // Worst-hit regions get attention (and Authority) first.
    const regions = g.R.filter(r => r.st.detected).sort((x, y) => y.st.repActive - x.st.repActive);
    for (const r of regions) {
      const st = r.st, a = g.activePerM(r) / late;
      const on = id => { if (st.m[id] == null && g.s.authority >= C.MEASURE[id].cost) g.setMeasure(r.i, id, true); };
      const off = id => { if (st.m[id] != null) g.setMeasure(r.i, id, false); };
      if (a > 300 && st.fatigue < .5 && !st.rogue) on('lockdown');
      if (st.m.lockdown != null && (a < 60 || st.fatigue > .75)) off('lockdown');
      if (a > 20) on('masks');
      if (a > 60) on('distancing'); else if (a < 2 && st.m.lockdown == null) off('distancing');
      if (g.P.mode === 'vector' && a > 10) on('vector');
      if (a > 3 && a < 200) on('tracing'); else if (a > 400) off('tracing');
      if (a > 2 && r.meta.pop > 20e6) on('testing');
      if (a > 150 && st.fatigue < .45) on('schools'); else if (a < 40 || st.fatigue > .65) off('schools');
      if (st.overload > .05) on('hospital');
      if (r.meta.air >= 2 && a > 100 && g.s.day < 250) on('flights'); else if (a < 20) off('flights');
      if (g.s.vaccine.approved && a > 5) on('vaxdrive');
      if (a > 10) on('gatherings'); else if (a < 1) off('gatherings');
      if (a > .5 && a < 40 && !st.rogue) on('cordon'); else if (a > 120 || st.fatigue > .7) off('cordon');
      if (g.P.mode === 'contact' && a > .5) on('burials');
      if (a > 15) on('sickpay');
      if (a > 120 || st.overload > .02) on('shield');
      if (r.meta.air >= 2 && a > 30 && g.s.day < 300) on('travelq');
    }
    // Field teams go where they help most; an expert re-posts them every few weeks.
    if (g.s.day % (kind === 'expert' ? 20 : 45) === 0) {
      const det = g.R.filter(r => r.st.detected && r.st.repActive > 0);
      const best = { 
        epi: det.slice().sort((x, y) => y.st.repActive * (1.2 - x.meta.wealth) - x.st.repActive * (1.2 - y.meta.wealth))[0],
        med: g.R.filter(r => r.st.overload > 0).sort((x, y) => y.st.overload * y.meta.pop - x.st.overload * x.meta.pop)[0],
        vax: g.s.vaccine.approved ? det.slice().sort((x, y) => (y.st.repActive / y.meta.pop - y.st.vaxCov) - (x.st.repActive / x.meta.pop - x.st.vaxCov))[0] : null,
        com: det.slice().sort((x, y) => x.st.trust - y.st.trust)[0],
      };
      for (const T of C.TEAMS) {
        const target = kind === 'casual' ? det[Math.floor(rnd() * det.length)] : best[T.id];
        if (!target) continue;
        const t = g.teamFor(T.id, target.i);
        if (t && (t.r < 0 || kind === 'expert') && !g.teamsIn(target.i).some(x => x.type === T.id)) g.sendTeam(t.k, target.i);
      }
    }
  };
}

export function play(pathogen, difficulty, kind, seed) {
  const g = C.Game.create(MAP, { pathogen, difficulty, seed });
  const bot = makeBot(kind, seed);
  while (!g.s.over) { bot(g); g.step(); }
  const t = g.s.lastStats;
  return {
    win: g.s.over.win, reason: g.s.over.reason, day: g.s.day, deaths: t.deaths, limit: g.deathLimit,
    trust: g.globalTrust(), econ: g.globalEconomy(), vaxDay: g.s.vaccine.day, traits: Object.keys(g.s.traits).length,
    spent: g.s.spent, upgrades: g.s.upgrades.length, grade: g.grade(),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const N = +(process.argv[2] || 12);
  const paths = (process.argv[3] || C.PATHOGENS.map(p => p.id).join(',')).split(',');
  const diffs = (process.argv[4] || 'recruit,regular,hardened').split(',');
  const kinds = (process.env.BOTS || 'idle,casual,expert').split(',');
  for (const p of paths) {
    const base = C.Game.baseline(MAP, { pathogen: p, difficulty: 'regular', seed: 1 });
    console.log(`\n${p}: unchecked baseline ${(base.deaths / 1e6).toFixed(0)}M deaths over ${base.days} days`);
    for (const d of diffs) for (const k of kinds) {
      const rs = [];
      for (let i = 0; i < N; i++) rs.push(play(p, d, k, 1000 + i * 17));
      const wins = rs.filter(r => r.win);
      const avg = (a, f) => a.length ? a.reduce((s, r) => s + f(r), 0) / a.length : NaN;
      const reasons = {};
      rs.filter(r => !r.win).forEach(r => { reasons[r.reason] = (reasons[r.reason] || 0) + 1; });
      console.log(`  ${d.padEnd(9)} ${k.padEnd(7)} win ${String(Math.round(100 * wins.length / N)).padStart(3)}%`
        + `  day ${avg(rs, r => r.day).toFixed(0).padStart(4)}  deaths ${(avg(rs, r => r.deaths / r.limit) * 100).toFixed(0).padStart(3)}% of limit`
        + `  vax d${avg(rs.filter(r => r.vaxDay > 0), r => r.vaxDay).toFixed(0)}  traits ${avg(rs, r => r.traits).toFixed(1)}`
        + `  trust ${avg(rs, r => r.trust).toFixed(2)}  upg ${avg(rs, r => r.upgrades).toFixed(0)}`
        + `  stars ${avg(wins, r => r.grade).toFixed(1)}  ${JSON.stringify(reasons)}`);
    }
  }
}
