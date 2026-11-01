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

/**
 * Builds Overpass selectors for "near this route". A single around-filter on a
 * long line makes the server test every matching object in the world against
 * every segment, which times out on long trips; splitting the line into pieces
 * and narrowing each piece by its bounding box first keeps queries fast.
 */
function nearRoute(coords: LatLng[], max: number, tolerance: number) {
  const pts = simplify(coords, max, tolerance);
  const pieces: LatLng[][] = [];
  for (let i = 0; i < pts.length - 1; i += 12) pieces.push(pts.slice(i, i + 13));
  if (!pieces.length) pieces.push(pts);
  return (type: 'node' | 'way' | 'nwr', filter: string, radius: number): string => {
    // Pad the box by the search radius (degrees; longitude scaled for latitude).
    return pieces
      .map((p) => {
        const lat = p[0].lat;
        const dLat = radius / 111_000;
        const dLng = radius / (111_000 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
        const s = Math.min(...p.map((c) => c.lat)) - dLat;
        const n = Math.max(...p.map((c) => c.lat)) + dLat;
        const w = Math.min(...p.map((c) => c.lng)) - dLng;
        const e = Math.max(...p.map((c) => c.lng)) + dLng;
        const line = p.map((c) => `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`).join(',');
        return `${type}${filter}(${s.toFixed(3)},${w.toFixed(3)},${n.toFixed(3)},${e.toFixed(3)})(around:${radius},${line});`;
      })
      .join('\n');
  };
}

/** Rivers, mountains and towns near the route. */
export function buildOverpassQuery(coords: LatLng[]): string {
  const near = nearRoute(coords, 120, 400);
  return `[out:json][timeout:40];
(
${near('way', '["waterway"="river"]["name"]', 1500)}
${near('node', '["natural"~"^(peak|volcano)$"]["name"]', 8000)}
${near('node', '["place"~"^(city|town)$"]["name"]', 3000)}
${near('node', '["place"="village"]["name"]', 1200)}
);
out geom 700;`;
}

/** Sights right by the road: attractions, monuments, towers. */
export function buildSightsQuery(coords: LatLng[]): string {
  const near = nearRoute(coords, 120, 400);
  return `[out:json][timeout:40];
(
${near('node', '["tourism"~"^(attraction|viewpoint|theme_park)$"]["name"]', 2000)}
${near('node', '["historic"~"^(monument|memorial|castle|fort|ruins|battlefield)$"]["name"]', 2000)}
${near('node', '["man_made"~"^(tower|lighthouse|water_tower|windmill)$"]["name"]', 2000)}
);
out 400;`;
}

/** Gas stations close to the road. A separate query so a long route's stations can't crowd out its sights. */
export function buildFuelQuery(coords: LatLng[]): string {
  const near = nearRoute(coords, 240, 150);
  return `[out:json][timeout:40];
(
${near('nwr', '["amenity"="fuel"]', 350)}
);
out center tags 600;`;
}

const TRUCK_BRANDS = /\b(love'?s|pilot|flying j|petro|ta\b|travelcenters|travel center|travel plaza|truck ?stop|kwik trip|buc-ee'?s|sapp bros)/i;

export interface OsmElement {
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

/** A Wikipedia (or Wikidata) page for a map feature, from its tags. */
export function wikiUrl(tags: Record<string, string>): string | undefined {
  const m = tags.wikipedia?.match(/^([a-z-]{2,12}):(.+)$/);
  if (m) return `https://${m[1]}.wikipedia.org/wiki/${encodeURIComponent(m[2].trim().replace(/ /g, '_'))}`;
  if (/^Q\d+$/.test(tags.wikidata ?? '')) return `https://www.wikidata.org/wiki/${tags.wikidata}`;
  return undefined;
}

/** Cities (or towns of 50,000 or more) get wider interstates around them. */
function isBigPlace(tags: Record<string, string>): boolean {
  const pop = parseInt((tags.population ?? '').replace(/[, ]/g, ''), 10);
  return tags.place === 'city' || pop >= 50_000;
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
      const wiki = wikiUrl(tags);
      if (e.geometry?.length) out.push({ kind, name, line: e.geometry.map((g) => ({ lat: g.lat, lng: g.lon })), ...(wiki ? { wiki } : {}) });
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
    } else {
      const wiki = wikiUrl(tags);
      out.push({ kind, name, point, ...(kind === 'citysign' && isBigPlace(tags) ? { big: true } : {}), ...(wiki ? { wiki } : {}) });
    }
  }
  return out;
}

/** Fetches landmarks and gas stations near a route. Never throws: a trip without real map data still works. */
export async function fetchMapFeatures(coords: LatLng[], timeoutMs = 45000): Promise<MapFeature[]> {
  // Three smaller queries finish where one big one times out. The public server
  // runs two at a time per user, so the third starts when the first is done.
  const towns = runQuery(buildOverpassQuery(coords), timeoutMs);
  const sights = runQuery(buildSightsQuery(coords), timeoutMs);
  const fuel = towns.then(() => runQuery(buildFuelQuery(coords), timeoutMs));
  return (await Promise.all([towns, sights, fuel])).flat();
}

async function runQuery(query: string, timeoutMs: number): Promise<MapFeature[]> {
  const json = await overpassJson(query, timeoutMs);
  return json ? parseOverpass(json) : [];
}

/** Runs an Overpass query and returns the raw answer, or null on any failure. */
export async function overpassJson(query: string, timeoutMs: number, retry = true): Promise<{ elements?: OsmElement[] } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      body: new URLSearchParams({ data: query }),
      signal: ctrl.signal,
    });
    // Busy (429) or overloaded (504): wait a moment and try once more.
    if ((res.status === 429 || res.status === 504) && retry) {
      clearTimeout(timer);
      await new Promise((r) => setTimeout(r, 4000));
      return overpassJson(query, timeoutMs, false);
    }
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
