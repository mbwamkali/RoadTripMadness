/**
 * Pre-bakes the classic road trips that ship with the game, so they always
 * work offline. Plans each one with the game's own router (src/offline/roadNet.ts)
 * over the published OpenStreetMap road files, leg by leg through its via
 * points, slims the geometry and writes public/data/routes/<id>.json in the
 * same format as saved trips.
 *
 *   npx vite-node scripts/bake-routes.ts                 # road files from the live site
 *   ROADS=dist/data/osm npx vite-node scripts/bake-routes.ts   # or from a folder
 *
 * Route data © OpenStreetMap contributors (ODbL), credited in the game.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { LatLng } from '../src/geo/geo';
import type { RawRoute, RawStep } from '../src/geo/route';
import { packLatLng, simplifyLatLng } from '../src/offline/polyline';
import { RoadNet, tilesFor, type RoadFile, type RoadIndex, type TownsFile } from '../src/offline/roadNet';

const ROADS = process.env.ROADS || 'https://mbwamkali.github.io/RoadTripMadness/data/osm';
const OUT = 'public/data/routes';

/** Keep in sync with src/offline/curated.ts. Via points are [lat, lng], start and end included. */
const ROUTES: { id: string; start: string; end: string; via: [number, number][] }[] = [
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

async function readJson<T>(file: string): Promise<T> {
  if (/^https?:/.test(ROADS)) {
    const r = await fetch(`${ROADS}/${file}`);
    if (!r.ok) throw new Error(`${file}: ${r.status}`);
    return (await r.json()) as T;
  }
  return JSON.parse(fs.readFileSync(path.join(ROADS, file), 'utf8')) as T;
}

const round = (p: LatLng): LatLng => ({ lat: +p.lat.toFixed(5), lng: +p.lng.toFixed(5) });

const index = await readJson<RoadIndex>('index.json');
const backbone = await readJson<RoadFile>(index.backbone.file);
const towns = await readJson<TownsFile>(index.towns.file);
const allVia = ROUTES.flatMap((r) => r.via.map(([lat, lng]) => ({ lat, lng })));
const tiles = await Promise.all(tilesFor(index, allVia).map(([x, y]) => readJson<RoadFile>(`tiles/${x}_${y}.json`)));
const net = new RoadNet([backbone, ...tiles], towns);
console.log(`road files built ${index.built}: backbone + ${tiles.length} tiles`);

fs.mkdirSync(OUT, { recursive: true });
for (const r of ROUTES) {
  const pts = r.via.map(([lat, lng]) => ({ lat, lng }));
  const coords: LatLng[] = [];
  const steps: RawStep[] = [];
  const exits: NonNullable<RawRoute['exits']> = [];
  const limits: NonNullable<RawRoute['limits']> = [];
  let meters = 0;
  let seconds = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const leg = net.planTrip(pts[i], pts[i + 1], r.start, r.end);
    coords.push(...(coords.length ? leg.coords.slice(1) : leg.coords));
    // Towns are added once for the whole trip below; a new leg doesn't repeat the road it's already on.
    for (const s of leg.steps) if (s.type !== 'town' && s.name !== steps[steps.length - 1]?.name) steps.push(s);
    exits.push(...(leg.exits ?? []));
    for (const l of leg.limits ?? []) if (l.kmh !== limits[limits.length - 1]?.kmh) limits.push(l);
    meters += leg.realMeters;
    seconds += leg.realSeconds;
  }
  steps.push(...net.townsAlong(coords, pts[0], pts[pts.length - 1]));
  const slim = simplifyLatLng(coords, 25);
  const stored = {
    source: 'curated',
    startLabel: r.start,
    endLabel: r.end,
    realMeters: Math.round(meters),
    realSeconds: Math.round(seconds),
    steps: steps.map((s) => ({ ...s, location: round(s.location) })),
    exits: exits.map((e) => ({ ...e, location: round(e.location) })),
    limits: limits.map((l) => ({ ...l, location: round(l.location) })),
    attribution: `Route ${net.attribution}, planned with the game's own router`,
    packed: packLatLng(slim),
  };
  fs.writeFileSync(`${OUT}/${r.id}.json`, JSON.stringify(stored));
  console.log(
    `${r.id}: ${Math.round(meters / 1000)} km, ${(seconds / 3600).toFixed(1)} h, ${coords.length} → ${slim.length} points, ` +
      `${steps.length} steps, ${exits.length} exits, ${(fs.statSync(`${OUT}/${r.id}.json`).size / 1024).toFixed(0)} KB`,
  );
}
