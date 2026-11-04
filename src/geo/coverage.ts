import type { LatLng } from './geo';
import type { StateMap } from './states';

/**
 * Where trips can be planned: the contiguous US (the lower 48 states and DC).
 * The monthly road build and the offline atlas cover exactly this, so places
 * outside it (Alaska, Hawaii, Puerto Rico, Canada, Mexico and the rest of the
 * world) are kept out of search and "My location".
 */
export const LOWER48 = { minLng: -125.5, maxLng: -66, minLat: 24, maxLat: 49.6 };

export const COVERAGE_NOTE = 'Trips only work in the lower 48 US states (not Alaska, Hawaii, Canada or Mexico).';

/** Rough box test, good enough to drop far-away search results. */
export const inLower48Box = (p: LatLng): boolean =>
  p.lng >= LOWER48.minLng && p.lng <= LOWER48.maxLng && p.lat >= LOWER48.minLat && p.lat <= LOWER48.maxLat;

/** Nominatim parameters that keep place search inside the lower 48. */
export const NOMINATIM_COVERAGE = `countrycodes=us&viewbox=${LOWER48.minLng},${LOWER48.maxLat},${LOWER48.maxLng},${LOWER48.minLat}&bounded=1`;

const NOT_COVERED = new Set(['AK', 'HI']);
/** About 11 km: the state outlines are simplified, so coastal and border towns can sit just outside them. */
const SLACK = 0.1;

/**
 * Whether a point is inside the play area. With the state outlines loaded it
 * checks the point and four nearby points against the lower 48 states, so
 * Toronto or Tijuana is out but Key West or a beach town is in. Without them
 * it falls back to the box.
 */
export function inPlayArea(p: LatLng, states: StateMap | null): boolean {
  if (!inLower48Box(p)) return false;
  if (!states) return true;
  const probes: LatLng[] = [
    p,
    { lat: p.lat + SLACK, lng: p.lng },
    { lat: p.lat - SLACK, lng: p.lng },
    { lat: p.lat, lng: p.lng + SLACK },
    { lat: p.lat, lng: p.lng - SLACK },
  ];
  for (const q of probes) {
    const s = states.stateAt(q);
    if (s) return !NOT_COVERED.has(s.code);
  }
  return false;
}
