#!/usr/bin/env node
/**
 * Builds the offline US road atlas (public/data/atlas-us.json) from Natural
 * Earth 1:10m data, which is public domain.
 *
 *   sh scripts/fetch-natural-earth.sh data-src/ne
 *   node scripts/build-atlas.mjs data-src/ne public/data/atlas-us.json
 *
 * What it does:
 *  1. Keeps US highways (interstates, US and state highways), drops ferries
 *     and roads under construction.
 *  2. Finds junctions: shared vertices, crossings between different roads,
 *     and dangling road ends that stop just short of another road.
 *  3. Splits roads at junctions into graph edges, keeps the largest connected
 *     network (the lower 48), and simplifies each edge's shape.
 *  4. Adds cities (with population), national parks, peaks and the points
 *     where highways cross named rivers.
 *
 * The output format is decoded by src/offline/atlas.ts. Coordinates are
 * integers in 1e-4 degrees (about 11 m), which is plenty for the game.
 */
import fs from 'node:fs';
import path from 'node:path';

const [, , srcDir = 'data-src/ne', outFile = 'public/data/atlas-us.json'] = process.argv;
const read = (f) => JSON.parse(fs.readFileSync(path.join(srcDir, f), 'utf8'));

const Q = 1e4; // quantization: 1e-4 degree
const q = (v) => Math.round(v * Q);
const LOWER48 = { minLng: -125.5, maxLng: -66, minLat: 24, maxLat: 49.6 };
const inLower48 = ([x, y]) => x >= LOWER48.minLng && x <= LOWER48.maxLng && y >= LOWER48.minLat && y <= LOWER48.maxLat;

// ------------------------------------------------------------------ helpers

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
function haversine(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Douglas–Peucker in degree space (with longitude scaled by cos(lat)). */
function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const k = Math.cos(rad(pts[0][1]));
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const ax = pts[i][0] * k, ay = pts[i][1], bx = pts[j][0] * k, by = pts[j][1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-18;
    let best = -1, bestD = tol * tol;
    for (let m = i + 1; m < j; m++) {
      const px = pts[m][0] * k, py = pts[m][1];
      let t = ((px - ax) * dx + (py - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + dx * t - px, ey = ay + dy * t - py;
      const d = ex * ex + ey * ey;
      if (d > bestD) (bestD = d), (best = m);
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([i, best], [best, j]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Segment intersection; returns [t, u] params or null. */
function intersect(p1, p2, p3, p4) {
  const d1x = p2[0] - p1[0], d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0], d2y = p4[1] - p3[1];
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-14) return null;
  const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / den;
  const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return [Math.max(0, Math.min(1, t)), Math.max(0, Math.min(1, u))];
}

/** Uniform grid over segments for fast neighbour queries. */
class SegGrid {
  constructor(cell) {
    this.cell = cell;
    this.map = new Map();
  }
  key(cx, cy) {
    return cx * 100003 + cy;
  }
  add(item, a, b, pad = 0) {
    const c = this.cell;
    const x0 = Math.floor((Math.min(a[0], b[0]) - pad) / c), x1 = Math.floor((Math.max(a[0], b[0]) + pad) / c);
    const y0 = Math.floor((Math.min(a[1], b[1]) - pad) / c), y1 = Math.floor((Math.max(a[1], b[1]) + pad) / c);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const k = this.key(x, y);
        let list = this.map.get(k);
        if (!list) this.map.set(k, (list = []));
        list.push(item);
      }
  }
  near(p, pad) {
    const c = this.cell;
    const out = new Set();
    for (let x = Math.floor((p[0] - pad) / c); x <= Math.floor((p[0] + pad) / c); x++)
      for (let y = Math.floor((p[1] - pad) / c); y <= Math.floor((p[1] + pad) / c); y++) for (const it of this.map.get(this.key(x, y)) ?? []) out.add(it);
    return out;
  }
}

// ------------------------------------------------------------------ roads

const CLASS = { interstate: 0, major: 1, secondary: 2, road: 3 };
function roadClass(p) {
  if (p.level === 'Interstate' || p.expressway === 1) return CLASS.interstate;
  if (p.type === 'Major Highway' || p.type === 'Beltway' || p.type === 'Bypass') return CLASS.major;
  if (p.type === 'Secondary Highway') return CLASS.secondary;
  return CLASS.road;
}
function roadRef(p) {
  const n = (p.label || p.name || '').trim();
  if (!n) return '';
  if (!/^\d+[A-Z]?$/.test(n)) return n;
  if (p.level === 'Interstate') return `I-${n}`;
  if (p.level === 'Federal') return `US ${n}`;
  if (p.level === 'State') return `SR ${n}`;
  return `Hwy ${n}`;
}

const roads = read('ne_10m_roads.geojson');
const lines = [];
for (const f of roads.features) {
  const p = f.properties;
  if (p.sov_a3 !== 'USA' || /Ferry/.test(p.type) || p.level === 'U/C') continue;
  const parts = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const part of parts) {
    const pts = part.map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]).filter((pt, i, a) => i === 0 || pt[0] !== a[i - 1][0] || pt[1] !== a[i - 1][1]);
    if (pts.length < 2 || !pts.some(inLower48)) continue;
    lines.push({ pts, cls: roadClass(p), ref: roadRef(p), splits: [] });
  }
}
console.log(`roads: ${lines.length} lines`);

const grid = new SegGrid(0.1);
lines.forEach((ln, li) => {
  for (let s = 0; s < ln.pts.length - 1; s++) grid.add([li, s], ln.pts[s], ln.pts[s + 1], 0.03);
});

// Crossings between different roads become junctions.
let crossings = 0;
const seenPair = new Set();
for (const list of grid.map.values()) {
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const [la, sa] = list[i];
      const [lb, sb] = list[j];
      if (la === lb) continue;
      const pk = la < lb ? `${la}:${sa}:${lb}:${sb}` : `${lb}:${sb}:${la}:${sa}`;
      if (seenPair.has(pk)) continue;
      seenPair.add(pk);
      const A = lines[la], B = lines[lb];
      const hit = intersect(A.pts[sa], A.pts[sa + 1], B.pts[sb], B.pts[sb + 1]);
      if (!hit) continue;
      const x = A.pts[sa][0] + (A.pts[sa + 1][0] - A.pts[sa][0]) * hit[0];
      const y = A.pts[sa][1] + (A.pts[sa + 1][1] - A.pts[sa][1]) * hit[0];
      A.splits.push({ seg: sa, t: hit[0], pt: [x, y] });
      B.splits.push({ seg: sb, t: hit[1], pt: [x, y] });
      crossings++;
    }
}
console.log(`crossings: ${crossings}`);

// Road ends that stop just short of another road get joined to it (up to ~3 km).
const SNAP = 0.03;
let snapped = 0;
lines.forEach((ln, li) => {
  for (const end of [0, ln.pts.length - 1]) {
    const p = ln.pts[end];
    let best = null;
    let bestD = SNAP * SNAP;
    for (const [lj, s] of grid.near(p, SNAP)) {
      if (lj === li) continue;
      const a = lines[lj].pts[s], b = lines[lj].pts[s + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1e-18)));
      const x = a[0] + dx * t, y = a[1] + dy * t;
      const d = (x - p[0]) ** 2 + (y - p[1]) ** 2;
      if (d < bestD) (bestD = d), (best = { lj, s, t, pt: [x, y] });
    }
    if (!best) continue;
    if (bestD > 1e-10) snapped++;
    lines[best.lj].splits.push({ seg: best.s, t: best.t, pt: best.pt });
    ln.pts[end] = best.pt;
  }
});
console.log(`snapped road ends: ${snapped}`);

// Insert split points and split roads into edges between junction nodes.
const nodeIndex = new Map();
const nodes = [];
const nodeKey = (p) => `${q(p[0])},${q(p[1])}`;
function nodeId(p) {
  const k = nodeKey(p);
  let id = nodeIndex.get(k);
  if (id === undefined) {
    id = nodes.length;
    nodes.push([q(p[0]), q(p[1])]);
    nodeIndex.set(k, id);
  }
  return id;
}

// Vertices shared by different roads are junctions too.
const vertexUse = new Map();
for (const ln of lines) {
  ln.full = [];
  ln.junction = [];
  const splits = ln.splits.sort((a, b) => a.seg - b.seg || a.t - b.t);
  let k = 0;
  for (let s = 0; s < ln.pts.length; s++) {
    ln.full.push(ln.pts[s]);
    ln.junction.push(s === 0 || s === ln.pts.length - 1);
    while (k < splits.length && splits[k].seg === s) {
      ln.full.push(splits[k].pt);
      ln.junction.push(true);
      k++;
    }
  }
  const seen = new Set();
  for (const p of ln.full) {
    const key = nodeKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    vertexUse.set(key, (vertexUse.get(key) ?? 0) + 1);
  }
}

const rawEdges = [];
for (const ln of lines) {
  let cur = [ln.full[0]];
  for (let i = 1; i < ln.full.length; i++) {
    const p = ln.full[i];
    const prev = cur[cur.length - 1];
    if (nodeKey(p) !== nodeKey(prev)) cur.push(p);
    const isJ = ln.junction[i] || vertexUse.get(nodeKey(p)) > 1;
    if (isJ && cur.length >= 2) {
      rawEdges.push({ a: nodeId(cur[0]), b: nodeId(cur[cur.length - 1]), pts: cur, cls: ln.cls, ref: ln.ref });
      cur = [p];
    }
  }
}

// Keep the largest connected network.
const adj = nodes.map(() => []);
rawEdges.forEach((e, i) => {
  if (e.a === e.b) return;
  adj[e.a].push(i);
  adj[e.b].push(i);
});
const comp = new Int32Array(nodes.length).fill(-1);
const sizes = [];
for (let s = 0; s < nodes.length; s++) {
  if (comp[s] >= 0) continue;
  const c = sizes.length;
  let size = 0;
  const stack = [s];
  comp[s] = c;
  while (stack.length) {
    const n = stack.pop();
    size++;
    for (const ei of adj[n]) {
      const e = rawEdges[ei];
      const m = e.a === n ? e.b : e.a;
      if (comp[m] < 0) (comp[m] = c), stack.push(m);
    }
  }
  sizes.push(size);
}
const main = sizes.indexOf(Math.max(...sizes));
console.log(`components: ${sizes.length}, main has ${sizes[main]} of ${nodes.length} nodes`);

const keptNodes = [];
const remap = new Int32Array(nodes.length).fill(-1);
nodes.forEach((n, i) => {
  if (comp[i] === main) (remap[i] = keptNodes.length), keptNodes.push(n);
});

const refs = [''];
const refIndex = new Map([['', 0]]);
const refId = (r) => {
  if (!refIndex.has(r)) refIndex.set(r, refs.push(r) - 1);
  return refIndex.get(r);
};

const edges = [];
let totalKm = 0;
let ptCount = 0;
for (const e of rawEdges) {
  if (e.a === e.b || comp[e.a] !== main) continue;
  const pts = simplify(e.pts, 0.0012);
  let len = 0;
  for (let i = 1; i < e.pts.length; i++) len += haversine(e.pts[i - 1], e.pts[i]);
  totalKm += len / 1000;
  const a = remap[e.a], b = remap[e.b];
  const flat = [];
  let px = keptNodes[a][0], py = keptNodes[a][1];
  for (let i = 1; i < pts.length - 1; i++) {
    const x = q(pts[i][0]), y = q(pts[i][1]);
    flat.push(x - px, y - py);
    px = x;
    py = y;
  }
  ptCount += flat.length / 2;
  edges.push([a, b, e.cls, refId(e.ref), Math.round(len), flat]);
}
console.log(`edges: ${edges.length}, ${Math.round(totalKm)} km of road, ${ptCount} shape points`);

// Edge segments of the kept network, for POI work below.
const netGrid = new SegGrid(0.1);
const nodeLL = (i) => [keptNodes[i][0] / Q, keptNodes[i][1] / Q];
function edgeCoords(e) {
  const out = [nodeLL(e[0])];
  let x = keptNodes[e[0]][0], y = keptNodes[e[0]][1];
  for (let i = 0; i < e[5].length; i += 2) {
    x += e[5][i];
    y += e[5][i + 1];
    out.push([x / Q, y / Q]);
  }
  out.push(nodeLL(e[1]));
  return out;
}
edges.forEach((e, ei) => {
  const c = edgeCoords(e);
  for (let s = 0; s < c.length - 1; s++) netGrid.add([ei, c[s], c[s + 1]], c[s], c[s + 1], 0);
});
function distToNetwork(p, pad) {
  let best = Infinity;
  for (const [, a, b] of netGrid.near(p, pad)) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1e-18)));
    best = Math.min(best, haversine(p, [a[0] + dx * t, a[1] + dy * t]));
  }
  return best;
}

// ------------------------------------------------------------------ places

const STATES = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE',
  'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
  'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR',
  Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT',
  Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
};

const cities = [];
for (const f of read('ne_10m_populated_places_simple.geojson').features) {
  const p = f.properties;
  if (p.adm0_a3 !== 'USA') continue;
  const ll = f.geometry.coordinates;
  if (!inLower48(ll) || distToNetwork(ll, 0.6) > 60000) continue;
  cities.push([p.nameascii || p.name, STATES[p.adm1name] ?? '', q(ll[0]), q(ll[1]), p.pop_max]);
}
cities.sort((a, b) => b[4] - a[4]);
console.log(`cities: ${cities.length}`);

const POI_KINDS = ['park', 'peak', 'river'];
const pois = [];
for (const f of read('ne_10m_parks_and_protected_lands_point.geojson').features) {
  const ll = f.geometry.coordinates;
  if (!inLower48(ll) || distToNetwork(ll, 1) > 80000) continue;
  const p = f.properties;
  pois.push([p.unit_name || p.name, 0, q(ll[0]), q(ll[1])]);
}
for (const f of read('ne_10m_geography_regions_elevation_points.geojson').features) {
  const ll = f.geometry.coordinates;
  const p = f.properties;
  if (!inLower48(ll) || p.featurecla !== 'mountain' || !p.name || distToNetwork(ll, 1) > 60000) continue;
  pois.push([p.elevation ? `${p.name} (${p.elevation} m)` : p.name, 1, q(ll[0]), q(ll[1])]);
}

// River crossings: where a kept highway edge crosses a named river.
const rivers = [...read('ne_10m_rivers_lake_centerlines.geojson').features, ...read('ne_10m_rivers_north_america.geojson').features].filter(
  (f) => f.properties.name && f.properties.featurecla !== 'Lake Centerline' && (f.properties.scalerank ?? 99) <= 10,
);
const riverHits = [];
for (const f of rivers) {
  const parts = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const name = f.properties.name;
  for (const part of parts) {
    for (let s = 0; s < part.length - 1; s++) {
      const a = part[s], b = part[s + 1];
      if (!inLower48(a)) continue;
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const pad = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2 + 0.01;
      for (const [, c, d] of netGrid.near(mid, pad)) {
        const hit = intersect(a, b, c, d);
        if (!hit) continue;
        const pt = [a[0] + (b[0] - a[0]) * hit[0], a[1] + (b[1] - a[1]) * hit[0]];
        if (riverHits.some((r) => r.name === name && haversine(r.pt, pt) < 15000)) continue;
        riverHits.push({ name, pt });
      }
    }
  }
}
for (const r of riverHits) {
  const label = /River|Creek|Fork|Bayou/.test(r.name) ? r.name : `${r.name} River`;
  pois.push([label, 2, q(r.pt[0]), q(r.pt[1])]);
}
console.log(`pois: ${pois.length} (${riverHits.length} river crossings)`);

const atlas = {
  version: 1,
  attribution: 'Offline atlas: Natural Earth (public domain)',
  q: Q,
  classes: ['interstate', 'major', 'secondary', 'road'],
  refs,
  nodes: keptNodes.flat(),
  edges,
  cities,
  poiKinds: POI_KINDS,
  pois,
};
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(atlas));
console.log(`wrote ${outFile}: ${(fs.statSync(outFile).size / 1024).toFixed(0)} KB`);
