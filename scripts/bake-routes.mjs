#!/usr/bin/env node
/**
 * Pre-bakes the classic road trips that ship with the game, so they always
 * work offline. Asks the public OSRM server for each route once (a handful of
 * requests, well within its usage policy), slims the geometry and writes
 * public/data/routes/<id>.json in the same format as saved trips.
 *
 *   node scripts/bake-routes.mjs
 *
 * Needs network access to router.project-osrm.org. Route data
 * © OpenStreetMap contributors (ODbL), credited in the game.
 * Add towns along each route from the offline atlas (run build-atlas first).
 */
import fs from 'node:fs';

const OSRM = process.env.OSRM_BASE || 'https://router.project-osrm.org';
const OUT = 'public/data/routes';

/** Keep in sync with src/offline/curated.ts. */
const ROUTES = [
  {
    id: 'route-66',
    start: 'Chicago, IL',
    end: 'Santa Monica, CA',
    via: [
      [41.8786, -87.6251], [39.8017, -89.6436], [38.627, -90.1994], [37.209, -93.2923], [37.0842, -94.5133], [36.154, -95.9928],
      [35.4676, -97.5164], [35.222, -101.8313], [35.1717, -103.725], [35.0844, -106.6504], [35.5281, -108.7426], [34.9022, -110.1582],
      [35.1983, -111.6513], [35.1894, -114.053], [34.8958, -117.0173], [34.1083, -117.2898], [34.0094, -118.4973],
    ],
  },
  {
    id: 'pacific-coast',
    start: 'San Francisco, CA',
    end: 'San Diego, CA',
    via: [
      [37.7749, -122.4194], [37.4636, -122.4286], [36.9741, -122.0308], [36.6002, -121.8947], [36.2704, -121.8081], [35.6439, -121.19],
      [35.3658, -120.8499], [34.4208, -119.6982], [34.0259, -118.7798], [34.0094, -118.4973], [33.6595, -117.9988], [32.7157, -117.1611],
    ],
  },
  { id: 'coast-to-coast', start: 'New York, NY', end: 'Los Angeles, CA', via: [[40.7128, -74.006], [34.0522, -118.2437]] },
  {
    id: 'overseas-highway',
    start: 'Miami, FL',
    end: 'Key West, FL',
    via: [[25.7617, -80.1918], [25.0865, -80.4473], [24.7136, -81.0904], [24.5551, -81.78]],
  },
  { id: 'vegas-run', start: 'Los Angeles, CA', end: 'Las Vegas, NV', via: [[34.0522, -118.2437], [36.1147, -115.1728]] },
];

// ---------------------------------------------------------------- helpers (mirrors src/offline/polyline.ts)

function simplify(points, toleranceM) {
  if (points.length < 3) return points.slice();
  const k = Math.cos((points[0].lat * Math.PI) / 180);
  const tol2 = (toleranceM / 111195) ** 2;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const ax = points[i].lng * k, ay = points[i].lat;
    const dx = points[j].lng * k - ax, dy = points[j].lat - ay;
    const len2 = dx * dx + dy * dy || 1e-18;
    let best = -1, bestD = tol2;
    for (let m = i + 1; m < j; m++) {
      const px = points[m].lng * k, py = points[m].lat;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const d = (ax + dx * t - px) ** 2 + (ay + dy * t - py) ** 2;
      if (d > bestD) (bestD = d), (best = m);
    }
    if (best >= 0) (keep[best] = 1), stack.push([i, best], [best, j]);
  }
  return points.filter((_, i) => keep[i]);
}

function pack(points) {
  const out = [];
  let px = 0, py = 0;
  for (const p of points) {
    const x = Math.round(p.lng * 1e5), y = Math.round(p.lat * 1e5);
    out.push(x - px, y - py);
    px = x;
    py = y;
  }
  return out;
}

const hav = (a, b) => {
  const r = (d) => (d * Math.PI) / 180;
  const s = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(s)));
};

/** Atlas cities beside the route become named turn-offs (same logic as Atlas.townsAlong). */
function townsAlong(coords, atlas) {
  if (!atlas) return [];
  const cities = atlas.cities.map(([name, state, x, y]) => ({ name, state, lng: x / atlas.q, lat: y / atlas.q }));
  const out = [];
  for (const c of cities) {
    const k = Math.cos((c.lat * Math.PI) / 180);
    let best = Infinity, at = null, cross = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i], b = coords[i + 1];
      if (Math.abs(a.lat - c.lat) > 0.5) continue;
      const ax = a.lng * k, ay = a.lat, dx = b.lng * k - ax, dy = b.lat - ay, px = c.lng * k, py = c.lat;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1e-18)));
      const d = (ax + dx * t - px) ** 2 + (ay + dy * t - py) ** 2;
      if (d < best) (best = d), (at = { lng: (ax + dx * t) / k, lat: ay + dy * t }), (cross = dx * (py - ay) - dy * (px - ax));
    }
    if (!at || hav(at, c) > 12000) continue;
    if (hav(c, coords[0]) < 15000 || hav(c, coords[coords.length - 1]) < 15000) continue;
    out.push({ location: at, name: c.name, type: 'town', modifier: cross > 0 ? 'left' : 'right' });
  }
  return out;
}

// ---------------------------------------------------------------- bake

const atlas = fs.existsSync('public/data/atlas-us.json') ? JSON.parse(fs.readFileSync('public/data/atlas-us.json', 'utf8')) : null;
fs.mkdirSync(OUT, { recursive: true });
for (const r of ROUTES) {
  const coords = r.via.map(([lat, lng]) => `${lng},${lat}`).join(';');
  const url = `${OSRM}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true&continue_straight=true`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.code !== 'Ok') throw new Error(`${r.id}: ${json.code} ${json.message ?? ''}`);
  const route = json.routes[0];
  const line = route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
  const slim = simplify(line, 25);
  const steps = [];
  for (const leg of route.legs)
    for (const s of leg.steps) {
      const name = [s.name, s.ref].filter(Boolean).join(' ').trim();
      if (!name || !s.maneuver.modifier || !/left|right/.test(s.maneuver.modifier)) continue;
      const [lng, lat] = s.maneuver.location;
      steps.push({ location: { lat: +lat.toFixed(5), lng: +lng.toFixed(5) }, name, type: s.maneuver.type, modifier: s.maneuver.modifier });
    }
  steps.push(...townsAlong(slim, atlas));
  const stored = {
    source: 'curated',
    startLabel: r.start,
    endLabel: r.end,
    realMeters: Math.round(route.distance),
    realSeconds: Math.round(route.duration),
    steps,
    attribution: 'Route © OpenStreetMap contributors, OSRM',
    packed: pack(slim),
  };
  fs.writeFileSync(`${OUT}/${r.id}.json`, JSON.stringify(stored));
  console.log(`${r.id}: ${Math.round(route.distance / 1000)} km, ${(route.duration / 3600).toFixed(1)} h, ${line.length} → ${slim.length} points, ${steps.length} steps, ${(fs.statSync(`${OUT}/${r.id}.json`).size / 1024).toFixed(0)} KB`);
  await new Promise((ok) => setTimeout(ok, 1500));
}
