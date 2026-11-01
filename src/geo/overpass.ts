import type { LatLng } from './geo';
import type { MapFeature } from '../game/landmarks';

/** Public Overpass API (OpenStreetMap query service). Light use only; one query per trip. */
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/** Picks at most `max` evenly spread points from a polyline. */
export function decimate(coords: LatLng[], max: number): LatLng[] {
  if (coords.length <= max) return coords.slice();
  const out: LatLng[] = [];
  for (let i = 0; i < max; i++) out.push(coords[Math.round((i * (coords.length - 1)) / (max - 1))]);
  return out;
}

/**
 * Simplifies a polyline so it stays within `tolerance` metres of the real
 * road (Douglas-Peucker), using at most `max` points. Keeps "around" queries
 * accurate on long, winding routes where even spacing would cut corners.
 */
export function simplify(coords: LatLng[], max = 300, tolerance = 250): LatLng[] {
  if (coords.length <= 2) return coords.slice();
  const lat0 = coords[0].lat;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const pts = coords.map((c) => ({ x: c.lng * kx, y: c.lat * 110_540 }));
  let tol = tolerance;
  for (;;) {
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack: [number, number][] = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop()!;
      const A = pts[a];
      const B = pts[b];
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const len2 = dx * dx + dy * dy || 1;
      let worst = -1;
      let worstD = tol;
      for (let i = a + 1; i < b; i++) {
        const t = Math.max(0, Math.min(1, ((pts[i].x - A.x) * dx + (pts[i].y - A.y) * dy) / len2));
        const d = Math.hypot(pts[i].x - (A.x + t * dx), pts[i].y - (A.y + t * dy));
        if (d > worstD) {
          worstD = d;
          worst = i;
        }
      }
      if (worst > 0) {
        keep[worst] = 1;
        stack.push([a, worst], [worst, b]);
      }
    }
    const out = coords.filter((_, i) => keep[i]);
    if (out.length <= max) return out;
    tol *= 1.6;
  }
}

/** One query for everything worth seeing near the route line. */
export function buildOverpassQuery(coords: LatLng[]): string {
  const line = simplify(coords)
    .map((c) => `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`)
    .join(',');
  const near = (r: number) => `(around:${r},${line})`;
  return `[out:json][timeout:25];
(
  way["waterway"~"^(river|canal)$"]["name"]${near(2500)};
  node["natural"~"^(peak|volcano)$"]["name"]${near(15000)};
  nwr["tourism"~"^(attraction|viewpoint|theme_park)$"]["name"]${near(2500)};
  nwr["historic"~"^(monument|memorial|castle|fort|ruins|battlefield)$"]["name"]${near(2500)};
  nwr["man_made"~"^(tower|lighthouse|water_tower|windmill)$"]["name"]${near(2500)};
  node["place"~"^(city|town)$"]["name"]${near(3000)};
  node["place"="village"]["name"]${near(1200)};
);
out geom 700;`;
}

/** Gas stations close to the road. A separate query so a long route's stations can't crowd out its sights. */
export function buildFuelQuery(coords: LatLng[]): string {
  const line = simplify(coords, 300, 150)
    .map((c) => `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`)
    .join(',');
  return `[out:json][timeout:25];
nwr["amenity"="fuel"](around:350,${line});
out center tags 600;`;
}

const TRUCK_BRANDS = /\b(love'?s|pilot|flying j|petro|ta\b|travelcenters|travel center|travel plaza|truck ?stop|kwik trip|buc-ee'?s|sapp bros)/i;

interface OsmElement {
  type: 'node' | 'way' | 'relation';
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

function kindFor(tags: Record<string, string>): MapFeature['kind'] | null {
  if (tags.amenity === 'fuel') return 'fuel';
  if (tags.waterway) return 'river';
  if (tags.natural === 'peak' || tags.natural === 'volcano') return 'peak';
  if (tags.place) return 'citysign';
  if (tags.man_made === 'lighthouse') return 'lighthouse';
  if (tags.man_made === 'water_tower') return 'watertower';
  if (tags.man_made === 'windmill') return 'windmill';
  if (tags.man_made === 'tower') return 'tower';
  if (tags.historic === 'castle' || tags.historic === 'fort' || tags.historic === 'ruins') return 'castle';
  if (tags.historic) return 'monument';
  if (tags.tourism === 'viewpoint') return 'viewpoint';
  if (tags.tourism) return 'attraction';
  return null;
}

export function parseOverpass(json: { elements?: OsmElement[] }): MapFeature[] {
  const out: MapFeature[] = [];
  for (const e of json.elements ?? []) {
    const tags = e.tags ?? {};
    const kind = kindFor(tags);
    let name = tags['name:en'] || tags.name;
    if (kind === 'fuel') name = name || tags.brand || tags.operator;
    if (!kind || !name) continue;
    if (kind === 'river') {
      if (e.geometry?.length) out.push({ kind, name, line: e.geometry.map((g) => ({ lat: g.lat, lng: g.lon })) });
      continue;
    }
    let point: LatLng | undefined;
    if (e.lat !== undefined && e.lon !== undefined) point = { lat: e.lat, lng: e.lon };
    else if (e.center) point = { lat: e.center.lat, lng: e.center.lon };
    else if (e.bounds) point = { lat: (e.bounds.minlat + e.bounds.maxlat) / 2, lng: (e.bounds.minlon + e.bounds.maxlon) / 2 };
    else if (e.geometry?.length) {
      const g = e.geometry;
      point = { lat: g.reduce((s, p) => s + p.lat, 0) / g.length, lng: g.reduce((s, p) => s + p.lon, 0) / g.length };
    }
    if (!point) continue;
    if (kind === 'fuel') {
      const truck = tags.hgv === 'yes' || TRUCK_BRANDS.test(`${name} ${tags.brand ?? ''}`);
      out.push({ kind, name, point, ...(truck ? { truck: true } : {}) });
    } else out.push({ kind, name, point });
  }
  return out;
}

/** Fetches landmarks and gas stations near a route. Never throws: a trip without real map data still works. */
export async function fetchMapFeatures(coords: LatLng[], timeoutMs = 20000): Promise<MapFeature[]> {
  const [sights, fuel] = await Promise.all([runQuery(buildOverpassQuery(coords), timeoutMs), runQuery(buildFuelQuery(coords), timeoutMs)]);
  return [...sights, ...fuel];
}

async function runQuery(query: string, timeoutMs: number): Promise<MapFeature[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      body: new URLSearchParams({ data: query }),
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    return parseOverpass(await res.json());
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
