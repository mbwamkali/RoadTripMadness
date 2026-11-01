import type { LatLng } from './geo';
import type { RawRoute, RawStep } from './route';

/**
 * Public OSRM demo server. Fine for development and light play; a released
 * game should point this at its own OSRM instance or a commercial routing API.
 */
export const OSRM_BASE = 'https://router.project-osrm.org';

interface OsrmManeuver {
  location: [number, number];
  type: string;
  modifier?: string;
}

interface OsrmStep {
  name?: string;
  ref?: string;
  maneuver: OsrmManeuver;
  intersections?: { classes?: string[] }[];
}

export interface OsrmResponse {
  code: string;
  message?: string;
  routes?: {
    distance: number;
    duration: number;
    geometry: { type: 'LineString'; coordinates: [number, number][] };
    legs: { steps?: OsrmStep[] }[];
  }[];
}

export function osrmRouteUrl(start: LatLng, end: LatLng, base = OSRM_BASE): string {
  const coords = `${start.lng.toFixed(6)},${start.lat.toFixed(6)};${end.lng.toFixed(6)},${end.lat.toFixed(6)}`;
  return `${base}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true&alternatives=false`;
}

/** Turns an OSRM response into the game's raw route shape. Throws with a readable message on failure. */
export function parseOsrm(json: OsrmResponse, startLabel: string, endLabel: string): RawRoute {
  if (json.code !== 'Ok' || !json.routes?.length) {
    if (json.code === 'NoRoute') throw new Error('There is no driving route between those places.');
    throw new Error(json.message || `Routing failed (${json.code}).`);
  }
  const r = json.routes[0];
  const steps: RawStep[] = [];
  for (const leg of r.legs) {
    for (const s of leg.steps ?? []) {
      const [lng, lat] = s.maneuver.location;
      steps.push({
        location: { lat, lng },
        name: [s.name, s.ref].filter(Boolean).join(' ').trim(),
        type: s.maneuver.type,
        modifier: s.maneuver.modifier,
        ...(s.intersections?.some((i) => i.classes?.includes('motorway')) ? { motorway: true } : {}),
      });
    }
  }
  return {
    source: 'osrm',
    startLabel,
    endLabel,
    coords: r.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
    realMeters: r.distance,
    realSeconds: r.duration,
    steps,
    attribution: 'Route © OpenStreetMap contributors, OSRM',
  };
}

export async function fetchRoute(start: LatLng, end: LatLng, startLabel: string, endLabel: string): Promise<RawRoute> {
  const res = await fetch(osrmRouteUrl(start, end));
  if (!res.ok && res.status !== 400) throw new Error(`Routing server answered ${res.status}.`);
  return parseOsrm((await res.json()) as OsrmResponse, startLabel, endLabel);
}
