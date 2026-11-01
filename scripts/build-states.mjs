// Builds public/data/states-us.json: simplified US state outlines for
// state-line signs and exit numbers. Source: Natural Earth admin-1 (public domain).
//
//   curl -fsSL -o data-src/ne/ne_50m_admin_1_states_provinces.geojson \
//     https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson
//   node scripts/build-states.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = process.argv[2] || 'data-src/ne/ne_50m_admin_1_states_provinces.geojson';
const OUT = 'public/data/states-us.json';
const Q = 1000; // about 100 m
const TOL = 0.01; // degrees

function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    let best = -1;
    let far = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / len;
      if (d > far) {
        far = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const geo = JSON.parse(readFileSync(SRC, 'utf8'));
const states = [];
for (const f of geo.features) {
  if (f.properties.iso_a2 !== 'US') continue;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const rings = [];
  for (const poly of polys) {
    // Closed rings: simplify each half so the start and end aren't the same point.
    const r = poly[0];
    const mid = r.length >> 1;
    const ring = [...dp(r.slice(0, mid + 1), TOL), ...dp(r.slice(mid), TOL).slice(1)];
    if (ring.length < 4) continue;
    rings.push(ring.flatMap(([x, y]) => [Math.round(x * Q), Math.round(y * Q)]));
  }
  states.push([f.properties.name, f.properties.postal, rings]);
}
writeFileSync(OUT, JSON.stringify({ attribution: 'Natural Earth (public domain)', q: Q, states }));
console.log(`${states.length} states -> ${OUT}`);
