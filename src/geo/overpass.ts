import type { LatLng } from './geo';
import type { LandmarkKind, MapFeature } from '../game/landmarks';

/** Public Overpass API (OpenStreetMap query service). Light use only; one query per trip. */
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/** Picks at most `max` evenly spread points from a polyline. */
export function decimate(coords: LatLng[], max: number): LatLng[] {
  if (coords.length <= max) return coords.slice();
  const out: LatLng[] = [];
  for (let i = 0; i < max; i++) out.push(coords[Math.round((i * (coords.length - 1)) / (max - 1))]);
  return out;
}

/** One query for everything worth seeing near the route line. */
export function buildOverpassQuery(coords: LatLng[]): string {
  const line = decimate(coords, 90)
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
);
out geom 700;`;
}

interface OsmElement {
  type: 'node' | 'way' | 'relation';
  lat?: number;
  lon?: number;
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

function kindFor(tags: Record<string, string>): LandmarkKind | null {
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
    const name = tags['name:en'] || tags.name;
    if (!kind || !name) continue;
    if (kind === 'river') {
      if (e.geometry?.length) out.push({ kind, name, line: e.geometry.map((g) => ({ lat: g.lat, lng: g.lon })) });
      continue;
    }
    let point: LatLng | undefined;
    if (e.lat !== undefined && e.lon !== undefined) point = { lat: e.lat, lng: e.lon };
    else if (e.bounds) point = { lat: (e.bounds.minlat + e.bounds.maxlat) / 2, lng: (e.bounds.minlon + e.bounds.maxlon) / 2 };
    else if (e.geometry?.length) {
      const g = e.geometry;
      point = { lat: g.reduce((s, p) => s + p.lat, 0) / g.length, lng: g.reduce((s, p) => s + p.lon, 0) / g.length };
    }
    if (point) out.push({ kind, name, point });
  }
  return out;
}

/** Fetches landmarks near a route. Never throws: a trip without real landmarks still works. */
export async function fetchMapFeatures(coords: LatLng[], timeoutMs = 20000): Promise<MapFeature[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      body: new URLSearchParams({ data: buildOverpassQuery(coords) }),
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
