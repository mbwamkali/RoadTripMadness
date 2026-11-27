import { haversineMeters, type LatLng } from './geo';
import { overpassJson, type OsmElement } from './overpass';
import type { Way } from './localStreets';
import { loadSquares } from './streetTiles';
import { addMapLog, secs } from './mapLog';
import { loadRoadIndex, roadsUrl } from '../offline/roadNet';

/**
 * Names of the streets that cross the route at each turn-off ("Main St").
 * Behind an interface so the live Overpass lookup can later be swapped for
 * the static road files without touching the game.
 */
export interface StreetSource {
  /** For each point, the nearest named street other than `skip[i]`, or null. */
  streetsNear(points: LatLng[], skip: string[]): Promise<(string | null)[]>;
}

const KINDS = 'primary|secondary|tertiary|unclassified|residential|trunk';
const RADIUS = 600;

export function buildStreetsQuery(points: LatLng[]): string {
  const parts = points.map((p) => `way(around:${RADIUS},${p.lat.toFixed(5)},${p.lng.toFixed(5)})[highway~"^(${KINDS})$"][name];`);
  return `[out:json][timeout:25];(${parts.join('')});out tags center;`;
}

const WEIGHT: Record<string, number> = { trunk: 0.5, primary: 0.5, secondary: 0.65, tertiary: 0.8, unclassified: 1, residential: 1.3 };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

interface Candidate {
  name: string;
  ref: string;
  weight: number;
  /** Where the street is: its centre (Overpass) or its points (street squares). */
  at: LatLng[];
}

/** Picks, for each point, the closest named street whose name isn't the road being driven. */
export function pickStreets(elements: OsmElement[], points: LatLng[], skip: string[]): (string | null)[] {
  return pickFrom(
    elements
      .filter((e) => e.tags?.name && e.center)
      .map((e) => ({ name: e.tags!.name, ref: e.tags!.ref ?? '', weight: WEIGHT[e.tags!.highway] ?? 1, at: [{ lat: e.center!.lat, lng: e.center!.lon }] })),
    points,
    skip,
  );
}

/** Street-square classes (1 trunk ... 5 side streets) as Overpass road types, for the weights. */
const SQUARE_WEIGHT = [1, 0.5, 0.5, 0.65, 0.8, 1.15];

/** pickStreets for streets read from the street squares (src/geo/streetTiles.ts). */
export function pickStreetsFromWays(ways: Way[], points: LatLng[], skip: string[], q = 100_000): (string | null)[] {
  // Only streets with a point roughly within reach of a turn-off (about 1.1 km), so big squares stay quick.
  const near = (x: number, y: number) => points.some((p) => Math.abs(y / q - p.lat) < 0.01 && Math.abs(x / q - p.lng) < 0.013);
  return pickFrom(
    ways.filter((w) => w.name && w.pts.some(([x, y]) => near(x, y))).map((w) => ({ name: w.name, ref: w.ref, weight: SQUARE_WEIGHT[w.cls] ?? 1, at: w.pts.map(([x, y]) => ({ lat: y / q, lng: x / q })) })),
    points,
    skip,
  );
}

function pickFrom(ways: Candidate[], points: LatLng[], skip: string[]): (string | null)[] {
  return points.map((p, i) => {
    const avoid = norm(skip[i] ?? '');
    let best: { name: string; d: number } | null = null;
    for (const w of ways) {
      const n = norm(w.name);
      if (avoid && (n.includes(avoid) || avoid.includes(n) || (w.ref && avoid.includes(norm(w.ref))))) continue;
      let real = Infinity;
      for (const a of w.at) real = Math.min(real, haversineMeters(p, a));
      // Bigger roads win over a slightly closer side street.
      const d = real * w.weight;
      if (real <= RADIUS * 1.5 && (!best || d < best.d)) best = { name: w.name, d };
    }
    return best?.name ?? null;
  });
}

/**
 * Street names from the road build's street squares, or one Overpass lookup
 * when the build has none (or a square can't be read). Every lookup goes in
 * the map lookup log.
 */
export const overpassStreets: StreetSource = {
  async streetsNear(points, skip) {
    if (!points.length) return [];
    const t0 = Date.now();
    const index = await loadRoadIndex().catch(() => null);
    if (index?.streets) {
      const got = await loadSquares(points, RADIUS * 1.5, index.streets, roadsUrl);
      const line = `street squares ${got ? 'ok' : 'failed'} ${secs(Date.now() - t0)}${got ? ` (${got.squares} squares)` : ''}`;
      if (got) {
        const names = pickStreetsFromWays(got.ways, points, skip, index.q);
        addMapLog({ at: t0, what: 'street names', result: 'found', ms: Date.now() - t0, bytes: got.bytes, tries: [line], note: `${names.filter(Boolean).length} of ${points.length} turn-offs named` });
        return names;
      }
    }
    const json = await overpassJson(buildStreetsQuery(points), 30000, 'street names');
    return json ? pickStreets(json.elements ?? [], points, skip) : points.map(() => null);
  },
};
