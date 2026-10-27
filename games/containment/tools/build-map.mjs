// Regenerates the embedded map data in ../index.html (the `MAP` script block).
//
// The game itself has no build step and no network; this script only exists so
// the geometry is reproducible. It needs three packages that are deliberately
// NOT dependencies of this repo:
//
//   mkdir /tmp/mapgen && cd /tmp/mapgen && npm init -y
//   npm i world-atlas@2.0.2 topojson-client@3.1.0 topojson-simplify@3.0.3 d3-geo@3.1.1
//   NODE_PATH=/tmp/mapgen/node_modules node games/containment/tools/build-map.mjs
//
// Source: Natural Earth 1:50m admin-0 countries (public domain) via world-atlas.
// Countries are merged into the game's ~57 playable regions, projected with
// Natural Earth I, simplified, and written out as SVG path strings so the
// browser can hand them straight to Path2D.

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const topo = require('topojson-client');
const simp = require('topojson-simplify');
const d3 = require('d3-geo');
const world = require('world-atlas/countries-50m.json');

const here = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.join(here, '..', 'index.html');

// Region id -> member countries (Natural Earth short names).
// The gameplay attributes of each region live in the engine, keyed by the same id.
const REGIONS = {
  CAN: ['Canada', 'St. Pierre and Miquelon'],
  GRL: ['Greenland'],
  USA: ['United States of America', 'Bermuda'],
  MEX: ['Mexico'],
  CAM: ['Guatemala', 'Belize', 'Honduras', 'El Salvador', 'Nicaragua', 'Costa Rica', 'Panama'],
  CRB: ['Cuba', 'Haiti', 'Dominican Rep.', 'Jamaica', 'Bahamas', 'Puerto Rico', 'Trinidad and Tobago',
    'Cayman Is.', 'Turks and Caicos Is.', 'U.S. Virgin Is.', 'British Virgin Is.', 'Anguilla', 'Montserrat',
    'Antigua and Barb.', 'St. Kitts and Nevis', 'Dominica', 'Saint Lucia', 'St. Vin. and Gren.', 'Grenada',
    'Barbados', 'Aruba', 'Curaçao', 'St-Martin', 'St-Barthélemy', 'Sint Maarten'],
  COL: ['Colombia'],
  VEN: ['Venezuela', 'Guyana', 'Suriname'],
  AND: ['Peru', 'Ecuador', 'Bolivia'],
  BRA: ['Brazil'],
  ARG: ['Argentina', 'Uruguay', 'Paraguay'],
  CHL: ['Chile'],
  GBR: ['United Kingdom', 'Ireland', 'Isle of Man', 'Jersey', 'Guernsey'],
  FRA: ['France', 'Monaco', 'Andorra'],
  IBE: ['Spain', 'Portugal'],
  BNL: ['Belgium', 'Netherlands', 'Luxembourg'],
  DEU: ['Germany', 'Switzerland', 'Austria', 'Liechtenstein'],
  ITA: ['Italy', 'San Marino', 'Vatican', 'Malta'],
  NOR: ['Norway', 'Sweden', 'Finland', 'Denmark', 'Iceland', 'Faeroe Is.', 'Åland'],
  POL: ['Poland', 'Lithuania', 'Latvia', 'Estonia'],
  CEU: ['Czechia', 'Slovakia', 'Hungary'],
  BLK: ['Romania', 'Moldova', 'Bulgaria', 'Greece', 'Serbia', 'Croatia', 'Bosnia and Herz.', 'Albania',
    'Macedonia', 'Slovenia', 'Montenegro', 'Kosovo', 'Cyprus', 'N. Cyprus'],
  UKR: ['Ukraine', 'Belarus'],
  RUS: ['Russia'],
  TUR: ['Turkey'],
  CAU: ['Georgia', 'Armenia', 'Azerbaijan'],
  LEV: ['Syria', 'Iraq', 'Jordan', 'Israel', 'Palestine', 'Lebanon'],
  ARA: ['Saudi Arabia', 'Yemen', 'Oman', 'United Arab Emirates', 'Qatar', 'Kuwait', 'Bahrain'],
  IRN: ['Iran'],
  CAS: ['Kazakhstan', 'Uzbekistan', 'Turkmenistan', 'Kyrgyzstan', 'Tajikistan'],
  PAK: ['Pakistan', 'Afghanistan'],
  IND: ['India', 'Nepal', 'Bhutan', 'Sri Lanka', 'Maldives', 'Siachen Glacier'],
  BGD: ['Bangladesh'],
  CHN: ['China', 'Hong Kong', 'Macao'],
  MNG: ['Mongolia'],
  KOR: ['South Korea', 'North Korea'],
  JPN: ['Japan'],
  TWN: ['Taiwan'],
  SEA: ['Myanmar', 'Thailand', 'Laos', 'Cambodia', 'Vietnam'],
  MYS: ['Malaysia', 'Singapore', 'Brunei'],
  IDN: ['Indonesia', 'Timor-Leste'],
  PHL: ['Philippines'],
  AUS: ['Australia'],
  NZL: ['New Zealand'],
  PAC: ['Papua New Guinea', 'Solomon Is.', 'Vanuatu', 'Fiji', 'New Caledonia', 'Samoa', 'Tonga'],
  MAG: ['Morocco', 'W. Sahara', 'Algeria', 'Tunisia', 'Libya'],
  EGY: ['Egypt'],
  SAH: ['Mauritania', 'Mali', 'Niger', 'Chad', 'Burkina Faso'],
  WAF: ['Senegal', 'Gambia', 'Guinea-Bissau', 'Guinea', 'Sierra Leone', 'Liberia', "Côte d'Ivoire", 'Ghana',
    'Togo', 'Benin', 'Cabo Verde'],
  NGA: ['Nigeria'],
  SDN: ['Sudan', 'S. Sudan'],
  HRN: ['Ethiopia', 'Eritrea', 'Djibouti', 'Somalia', 'Somaliland'],
  EAF: ['Kenya', 'Uganda', 'Tanzania', 'Rwanda', 'Burundi'],
  CAF: ['Dem. Rep. Congo', 'Congo', 'Gabon', 'Eq. Guinea', 'Cameroon', 'Central African Rep.',
    'São Tomé and Principe'],
  ZAM: ['Angola', 'Zambia', 'Malawi', 'Mozambique'],
  ZAF: ['South Africa', 'Lesotho', 'eSwatini', 'Namibia', 'Botswana', 'Zimbabwe'],
  MDG: ['Madagascar', 'Comoros', 'Mauritius', 'Seychelles'],
};

// Land crossings the topology does not show as shared borders.
const EXTRA_LINKS = [['GBR', 'FRA']]; // the Channel Tunnel

const W = 2000;
const countries = world.objects.countries;
const byName = new Map();
for (const g of countries.geometries) byName.set(g.properties.name, g);

const regionOf = new Map();
for (const [rid, names] of Object.entries(REGIONS)) {
  for (const n of names) {
    if (!byName.has(n)) throw new Error(`unknown country ${n}`);
    regionOf.set(n, rid);
  }
}

// France's overseas departments sit in the same MultiPolygon as the mainland.
// Split them out so French Guiana plays as South America, not Europe.
function splitFrance() {
  const fr = byName.get('France');
  const keep = [], guiana = [], caribbean = [];
  for (const poly of fr.arcs) {
    const f = topo.feature(world, { type: 'Polygon', arcs: poly });
    const [lon, lat] = d3.geoCentroid(f);
    if (lon > -10 && lon < 20 && lat > 40) keep.push(poly);
    else if (lon < -50 && lon > -56 && lat > 0) guiana.push(poly);
    else if (lon < -55 && lat > 10) caribbean.push(poly);
  }
  fr.type = 'MultiPolygon'; fr.arcs = keep;
  const mk = (name, polys) => ({ type: 'MultiPolygon', arcs: polys, properties: { name } });
  countries.geometries.push(mk('French Guiana', guiana), mk('French Antilles', caribbean));
  regionOf.set('French Guiana', 'VEN');
  regionOf.set('French Antilles', 'CRB');
}
splitFrance();

const dropNames = new Set(['Antarctica', 'Fr. S. Antarctic Lands', 'Heard I. and McDonald Is.', 'S. Geo. and the Is.']);
countries.geometries = countries.geometries.filter(g => !dropNames.has(g.properties.name));

// Simplify (Visvalingam weights on the sphere), keeping small islands that belong to a region.
const pre = simp.presimplify(world, simp.sphericalTriangleArea);
const simplified = simp.simplify(pre, simp.quantile(pre, 0.22));
const geoms = simplified.objects.countries.geometries;

const projection = d3.geoNaturalEarth1();
const land = topo.feature(simplified, simplified.objects.countries);
projection.fitWidth(W, land);
const [[, y0], [, y1]] = d3.geoPath(projection).bounds(land);
projection.translate([projection.translate()[0], projection.translate()[1] - y0 + 4]);
const H = Math.ceil(y1 - y0 + 8);

// Record a projected geometry as a compact relative SVG path string.
function toPath(geo, { minArea = 0 } = {}) {
  const rings = [];
  let cur = null;
  const ctx = {
    moveTo(x, y) { cur = [[x, y]]; rings.push(cur); },
    lineTo(x, y) { cur.push([x, y]); },
    closePath() { if (cur) cur.closed = true; },
    arc() {},
  };
  d3.geoPath(projection, ctx)(geo);
  let out = '';
  for (const r of rings) {
    if (r.closed && minArea > 0) {
      let a = 0;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
      if (Math.abs(a / 2) < minArea) continue;
    }
    let px = Math.round(r[0][0]), py = Math.round(r[0][1]);
    let s = `M${px} ${py}`;
    let pts = 0;
    for (let i = 1; i < r.length; i++) {
      const x = Math.round(r[i][0]), y = Math.round(r[i][1]);
      const dx = x - px, dy = y - py;
      if (!dx && !dy) continue;
      s += `l${dx} ${dy}`.replace(/ -/g, '-');
      px = x; py = y; pts++;
    }
    if (pts < 2) continue;
    if (r.closed) s += 'z';
    out += s;
  }
  return out;
}

const pathGen = d3.geoPath(projection);
const regionIds = Object.keys(REGIONS);
const regions = [];
const features = {};

for (const rid of regionIds) {
  const members = geoms.filter(g => regionOf.get(g.properties.name) === rid);
  const merged = topo.merge(simplified, members);
  features[rid] = merged;
  // Label anchor: centroid of the largest polygon, so Alaska does not drag the USA label into Canada.
  let best = null, bestA = -1;
  for (const poly of merged.coordinates) {
    const f = { type: 'Polygon', coordinates: poly };
    const a = pathGen.area(f);
    if (a > bestA) { bestA = a; best = f; }
  }
  const [cx, cy] = pathGen.centroid(best);
  const area = pathGen.area(merged);
  // Keep tiny rings only when the region would otherwise vanish.
  const minArea = area > 400 ? 3 : 0;
  regions.push({ id: rid, d: toPath(merged, { minArea }), c: [Math.round(cx), Math.round(cy)], a: Math.round(area) });
}

// Hand-tuned label anchors where the largest-polygon centroid lands somewhere odd.
const ANCHOR = {};

const unassigned = geoms.filter(g => !regionOf.has(g.properties.name));
const neutral = unassigned.length ? toPath(topo.merge(simplified, unassigned)) : '';

const regionKey = g => regionOf.get(g.properties.name) || '_';
const borders = toPath(topo.mesh(simplified, simplified.objects.countries,
  (a, b) => a !== b && regionKey(a) !== regionKey(b)));
const inner = toPath(topo.mesh(simplified, simplified.objects.countries,
  (a, b) => a !== b && regionKey(a) === regionKey(b)));

// Land adjacency between regions, from shared topology arcs.
const nb = topo.neighbors(geoms);
const adj = new Set();
geoms.forEach((g, i) => {
  for (const j of nb[i]) {
    const a = regionKey(g), b = regionKey(geoms[j]);
    if (a !== b && a !== '_' && b !== '_') adj.add([a, b].sort().join('-'));
  }
});
for (const [a, b] of EXTRA_LINKS) adj.add([a, b].sort().join('-'));

// Stipple points for the infection overlay, sampled on a jittered grid inside each region.
let seed = 1234567;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const dots = {};
// invert() happily returns coordinates for points off the edge of the globe; reject those.
const onSphere = (ll, x, y) => { const p = projection(ll); return p && Math.hypot(p[0] - x, p[1] - y) < 0.5; };
for (const r of regions) dots[r.id] = [];
const STEP = 9;
for (let y = 0; y < H; y += STEP) {
  for (let x = 0; x < W; x += STEP) {
    const px = x + rnd() * STEP, py = y + rnd() * STEP;
    const ll = projection.invert([px, py]);
    if (!ll || !onSphere(ll, px, py)) continue;
    for (const rid of regionIds) {
      if (d3.geoContains(features[rid], ll)) { dots[rid].push(Math.round(px), Math.round(py)); break; }
    }
  }
}
// Small regions get a denser pass so they still read on the map.
for (const r of regions) {
  if (dots[r.id].length / 2 >= 24) continue;
  const b = pathGen.bounds(features[r.id]);
  const step = Math.max(2, Math.sqrt(((b[1][0] - b[0][0]) * (b[1][1] - b[0][1])) / 110));
  for (let y = b[0][1]; y < b[1][1]; y += step) {
    for (let x = b[0][0]; x < b[1][0]; x += step) {
      const px = x + rnd() * step, py = y + rnd() * step;
      const ll = projection.invert([px, py]);
      if (ll && d3.geoContains(features[r.id], ll)) dots[r.id].push(Math.round(px), Math.round(py));
    }
  }
}
// Shuffle pairs so "show the first k" spreads evenly over the region.
for (const rid of regionIds) {
  const d = dots[rid];
  for (let i = d.length / 2 - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [d[2 * i], d[2 * j]] = [d[2 * j], d[2 * i]];
    [d[2 * i + 1], d[2 * j + 1]] = [d[2 * j + 1], d[2 * i + 1]];
  }
}

// Graticule for the ocean, so the sea reads as a globe rather than a flat fill.
const grat = toPath(d3.geoGraticule().step([30, 30])());
const sphere = toPath({ type: 'Sphere' });

const MAP = {
  w: W, h: H,
  sphere, grat, neutral, borders, inner,
  regions: regions.map(r => ({ id: r.id, d: r.d, c: ANCHOR[r.id] || r.c, a: r.a, dots: dots[r.id] })),
  adj: [...adj].sort().map(s => s.split('-')),
};

const json = JSON.stringify(MAP);
const html = readFileSync(HTML, 'utf8');
const start = '<script id="mapdata">';
const i = html.indexOf(start), j = html.indexOf('</script>', i);
if (i < 0) throw new Error('no mapdata block in index.html');
writeFileSync(HTML, html.slice(0, i + start.length) + '\nconst MAP=' + json + ';\n' + html.slice(j));
console.log(`regions ${regions.length}, ${(json.length / 1024).toFixed(0)} KB, ${H}px tall, dots ${Object.values(dots).reduce((a, d) => a + d.length / 2, 0)}`);
console.log('adjacency', MAP.adj.length);
