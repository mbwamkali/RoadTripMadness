import type { Place } from '../geo/geocode';
import { searchPlaces } from '../geo/geocode';
import { fetchLocalStreets } from '../geo/localStreets';
import { fetchMapFeatures } from '../geo/overpass';
import type { RawRoute } from '../geo/route';
import { loadAtlas } from './atlas';
import { loadRouteFeatures } from './features';
import { loadRoadNet } from './roadNet';
import { tripCache } from './tripCache';

/**
 * Trip planning, best first:
 *  1. Our own road files from OpenStreetMap (data/osm/), routed on the device.
 *     They are cached after first use, so this also works offline. When
 *     online, the local streets at each end are looked up too, so the trip
 *     starts on the right street; without them it starts with a straight
 *     link to the nearest highway.
 *  2. A saved trip between the same places.
 *  3. The bundled Natural Earth highway atlas.
 * No routing server is used. In local development without a road build,
 * download the release into public/data/osm (see docs/DESIGN.md).
 */

export type PlannedVia = 'roads' | 'saved' | 'atlas';

export const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/** How long trip planning waits for the live landmark lookup before starting without it. */
export const SCOUT_WAIT_MS = 8_000;

/**
 * Lets the setup screen offer a Skip button while landmarks are being scouted:
 * called with a skip function when scouting starts, and with null when it ends.
 */
export type ScoutHook = (skip: (() => void) | null) => void;

/**
 * Landmarks for a planned route. First choice is the landmark files baked into
 * the road build (src/offline/features.ts): quick, and cached for offline use.
 * Only when this build has none does it ask the public Overpass server live,
 * and that can take a minute or more when the server is busy, so planning
 * waits at most SCOUT_WAIT_MS (or until the player skips). When neither finds
 * any sights, the atlas's sights fill in.
 */
export async function addFeatures(raw: RawRoute, progress: (message: string) => void, scout?: ScoutHook, waitMs = SCOUT_WAIT_MS): Promise<void> {
  progress('Scouting landmarks along the way…');
  const baked = await loadRouteFeatures(raw.coords);
  if (baked) raw.features = baked;
  else if (!isOffline()) {
    let skip = () => {};
    const skipped = new Promise<null>((resolve) => (skip = () => resolve(null)));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), waitMs)));
    scout?.(skip);
    try {
      const found = await Promise.race([fetchMapFeatures(raw.coords), skipped, late]);
      if (found) raw.features = found;
    } finally {
      clearTimeout(timer);
      scout?.(null);
    }
  }
  // Gas stations alone don't make a trip interesting; borrow the atlas's sights if the lookup found none.
  if (!raw.features?.some((f) => f.kind !== 'fuel')) raw.features = [...(raw.features ?? []), ...(await atlasFeatures(raw))];
}

export async function planTrip(
  from: Place,
  to: Place,
  progress: (message: string) => void = () => {},
  scout?: ScoutHook,
): Promise<{ raw: RawRoute; via: PlannedVia; note?: string }> {
  const problems: string[] = [];
  const own = async () => {
    // The street lookup runs while the road files load.
    const streets = isOffline() ? null : fetchLocalStreets([from, to]);
    const net = await loadRoadNet([from, to], progress, streets);
    progress('Finding the fastest route…');
    const raw = net.planTrip(from, to, from.label, to.label);
    await addFeatures(raw, progress, scout);
    tripCache.save(raw, { start: from, end: to });
    return { raw, via: 'roads' as const };
  };
  try {
    return await own();
  } catch (e) {
    problems.push((e as Error).message);
  }
  const saved = tripCache.find(from, to, from.label, to.label);
  if (saved) return { raw: saved, via: 'saved', note: isOffline() ? 'No connection, so this is the copy saved on your device.' : "The road map couldn't load, so this is the copy saved on your device." };
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
