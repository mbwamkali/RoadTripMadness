import type { Place } from '../geo/geocode';
import { searchPlaces } from '../geo/geocode';
import { fetchRoute } from '../geo/osrm';
import { fetchMapFeatures } from '../geo/overpass';
import type { RawRoute } from '../geo/route';
import { loadAtlas } from './atlas';
import { tripCache } from './tripCache';

/**
 * Online-first planning with offline fallbacks:
 *  1. Ask OSRM for the fastest route, and save it for later.
 *  2. Offline (or OSRM unreachable): reuse a saved trip between the same places.
 *  3. Otherwise plan it on the device with the bundled road atlas.
 */

export type PlannedVia = 'online' | 'saved' | 'atlas';

export const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

export async function planTrip(
  from: Place,
  to: Place,
  progress: (message: string) => void = () => {},
): Promise<{ raw: RawRoute; via: PlannedVia; note?: string }> {
  let onlineError: Error | null = null;
  if (!isOffline()) {
    try {
      const raw = await fetchRoute(from, to, from.label, to.label);
      progress('Scouting landmarks along the way…');
      raw.features = await fetchMapFeatures(raw.coords);
      // Gas stations alone don't make a trip interesting; borrow the atlas's sights if the lookup found none.
      if (!raw.features.some((f) => f.kind !== 'fuel')) raw.features = [...raw.features, ...(await atlasFeatures(raw))];
      tripCache.save(raw, { start: from, end: to });
      return { raw, via: 'online' };
    } catch (e) {
      onlineError = e as Error;
      // A real "no route" answer from the server is final; anything else is a connection problem.
      if (/no driving route/i.test(onlineError.message)) throw onlineError;
    }
  }
  const saved = tripCache.find(from, to, from.label, to.label);
  if (saved) return { raw: saved, via: 'saved', note: 'No connection, so this is the copy saved on your device.' };
  try {
    const atlas = await loadAtlas();
    const raw = atlas.planTrip(from, to, from.label, to.label);
    tripCache.save(raw, { start: from, end: to });
    return { raw, via: 'atlas', note: 'Planned offline with the built-in highway atlas. The road follows the major highways.' };
  } catch (e) {
    throw new Error(onlineError ? `${onlineError.message} The offline atlas couldn't help either: ${(e as Error).message}` : (e as Error).message);
  }
}

/** Landmarks from the bundled atlas, when the OpenStreetMap landmark lookup can't help. */
export async function atlasFeatures(raw: RawRoute): Promise<NonNullable<RawRoute['features']>> {
  try {
    return (await loadAtlas()).featuresAlong(raw.coords);
  } catch {
    return [];
  }
}

/** Place search: Nominatim online, the atlas's cities and parks when offline or when Nominatim fails. */
export async function searchAnywhere(query: string): Promise<{ places: Place[]; offline: boolean }> {
  if (!isOffline()) {
    try {
      return { places: await searchPlaces(query), offline: false };
    } catch {
      /* fall through to the atlas */
    }
  }
  const atlas = await loadAtlas();
  return { places: atlas.search(query), offline: true };
}
