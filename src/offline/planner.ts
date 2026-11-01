import type { Place } from '../geo/geocode';
import { searchPlaces } from '../geo/geocode';
import { fetchRoute } from '../geo/osrm';
import { fetchMapFeatures } from '../geo/overpass';
import type { RawRoute } from '../geo/route';
import { loadAtlas } from './atlas';
import { loadRoadNet } from './roadNet';
import { tripCache } from './tripCache';

/**
 * Trip planning, best first:
 *  1. Our own road files from OpenStreetMap (data/osm/), routed on the device.
 *     They are cached after first use, so this also works offline.
 *  2. The public OSRM server, if the road files can't be loaded (for example
 *     in local development before a road build). Add ?router=osrm to the page
 *     address to use it first, for comparing routes.
 *  3. A saved trip between the same places.
 *  4. The bundled Natural Earth highway atlas.
 */

export type PlannedVia = 'roads' | 'online' | 'saved' | 'atlas';

export const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

const preferOsrm = () => typeof location !== 'undefined' && new URLSearchParams(location.search).get('router') === 'osrm';

/** Landmarks for a planned route: the live OpenStreetMap lookup when online, plus the atlas's sights when that finds none. */
async function addFeatures(raw: RawRoute, progress: (message: string) => void): Promise<void> {
  if (!isOffline()) {
    progress('Scouting landmarks along the way…');
    raw.features = await fetchMapFeatures(raw.coords);
  }
  // Gas stations alone don't make a trip interesting; borrow the atlas's sights if the lookup found none.
  if (!raw.features?.some((f) => f.kind !== 'fuel')) raw.features = [...(raw.features ?? []), ...(await atlasFeatures(raw))];
}

export async function planTrip(
  from: Place,
  to: Place,
  progress: (message: string) => void = () => {},
): Promise<{ raw: RawRoute; via: PlannedVia; note?: string }> {
  const problems: string[] = [];
  const own = async () => {
    const net = await loadRoadNet([from, to], progress);
    progress('Finding the fastest route…');
    const raw = net.planTrip(from, to, from.label, to.label);
    await addFeatures(raw, progress);
    tripCache.save(raw, { start: from, end: to });
    return { raw, via: 'roads' as const };
  };
  const osrm = async () => {
    const raw = await fetchRoute(from, to, from.label, to.label);
    await addFeatures(raw, progress);
    tripCache.save(raw, { start: from, end: to });
    return { raw, via: 'online' as const };
  };
  const order = preferOsrm() ? [osrm, own] : [own, osrm];
  for (const plan of order) {
    if (plan === osrm && isOffline()) continue;
    try {
      return await plan();
    } catch (e) {
      const msg = (e as Error).message;
      // A real "no route" answer is final; anything else means try the next way.
      if (/no driving route/i.test(msg)) throw e;
      problems.push(msg);
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
    throw new Error([...problems, `The offline atlas couldn't help either: ${(e as Error).message}`].join(' '));
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
