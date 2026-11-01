import { haversineMeters, type LatLng } from './geo';
import { overpassJson, type OsmElement } from './overpass';

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

/** Picks, for each point, the closest named street whose name isn't the road being driven. */
export function pickStreets(elements: OsmElement[], points: LatLng[], skip: string[]): (string | null)[] {
  const ways = elements
    .filter((e) => e.tags?.name && e.center)
    .map((e) => ({ name: e.tags!.name, ref: e.tags!.ref ?? '', weight: WEIGHT[e.tags!.highway] ?? 1, at: { lat: e.center!.lat, lng: e.center!.lon } }));
  return points.map((p, i) => {
    const avoid = norm(skip[i] ?? '');
    let best: { name: string; d: number } | null = null;
    for (const w of ways) {
      const n = norm(w.name);
      if (avoid && (n.includes(avoid) || avoid.includes(n) || (w.ref && avoid.includes(norm(w.ref))))) continue;
      const real = haversineMeters(p, w.at);
      // Bigger roads win over a slightly closer side street.
      const d = real * w.weight;
      if (real <= RADIUS * 1.5 && (!best || d < best.d)) best = { name: w.name, d };
    }
    return best?.name ?? null;
  });
}

export const overpassStreets: StreetSource = {
  async streetsNear(points, skip) {
    if (!points.length) return [];
    const json = await overpassJson(buildStreetsQuery(points), 30000);
    return json ? pickStreets(json.elements ?? [], points, skip) : points.map(() => null);
  },
};
