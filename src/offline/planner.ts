import type { Place } from '../geo/geocode';
import { searchPlaces } from '../geo/geocode';
import type { LatLng } from '../geo/geo';
import { LOCAL_TIMEOUT_MS, lookupStreets, type StreetLookup } from '../geo/localStreets';
import { fetchMapFeatures } from '../geo/overpass';
import type { RawRoute } from '../geo/route';
import { loadAtlas } from './atlas';
import { loadRouteFeatures } from './features';
import { loadHighways, loadRoadIndex, nextFrame, type RoadFile } from './roadNet';
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

/** The stages of planning a trip, shown as a list on the setup screen. */
export type StepId = 'map' | 'streets' | 'network' | 'route' | 'landmarks';
export interface PlanStep {
  id: StepId;
  state: 'active' | 'done' | 'skipped';
  /** What is happening now, with real numbers ("3.1 of 9.8 MB", "waiting for the server, 4 s"). */
  detail?: string;
  /** 0 to 1 when the step can measure itself (the map download). */
  fraction?: number;
}
/** Planning progress: a short message, and the step it belongs to when there is one. */
export type PlanProgress = (message: string, step?: PlanStep) => void;

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

/**
 * Starts the street lookup for a place as soon as it's picked, so it's often
 * done by the time the player presses Plan. Does nothing offline.
 */
export function prefetchStreets(p: LatLng): void {
  if (isOffline()) return;
  loadRoadIndex()
    .then((index) => lookupStreets(p, index.q, index.attribution))
    .catch(() => {});
}

/** Waits for the street lookups, showing what they're doing, until they finish, the player skips, or LOCAL_TIMEOUT_MS. */
async function waitForStreets(lookups: StreetLookup[], progress: PlanProgress, skipHook?: ScoutHook, waitMs = LOCAL_TIMEOUT_MS): Promise<RoadFile[] | null> {
  const show = () => {
    const st = lookups.map((l) => l.status);
    const kb = Math.round(st.reduce((n, s) => n + s.bytes, 0) / 1000);
    const secs = Math.round((Date.now() - Math.min(...st.map((s) => s.started))) / 1000);
    const detail = st.every((s) => s.state === 'cached')
      ? 'saved from last time'
      : st.some((s) => s.state === 'receiving')
        ? `${kb} KB received`
        : st.some((s) => s.state === 'waiting')
          ? `waiting for the street server, ${secs} s`
          : 'reading';
    progress('Finding the local streets…', { id: 'streets', state: 'active', detail });
  };
  show();
  const tick = setInterval(show, 250);
  let skip = () => {};
  const skipped = new Promise<null>((resolve) => (skip = () => resolve(null)));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), waitMs)));
  skipHook?.(skip);
  try {
    const files = await Promise.race([Promise.all(lookups.map((l) => l.file)), skipped, late]);
    return files ? files.filter((f): f is RoadFile => !!f) : null;
  } finally {
    clearInterval(tick);
    clearTimeout(timer);
    skipHook?.(null);
  }
}

export async function planTrip(
  from: Place,
  to: Place,
  progress: PlanProgress = () => {},
  scout?: ScoutHook,
  skipStreets?: ScoutHook,
): Promise<{ raw: RawRoute; via: PlannedVia; note?: string }> {
  const problems: string[] = [];
  const own = async () => {
    const index = await loadRoadIndex();
    // The street lookups (often started when the places were picked) run while the highway map loads.
    const lookups = isOffline() ? [] : [from, to].map((p) => lookupStreets(p, index.q, index.attribution));
    progress('Loading the highway map…', { id: 'map', state: 'active', detail: 'checking' });
    const highways = await loadHighways([from, to], (m) =>
      progress('Loading the highway map…', { id: 'map', state: 'active', detail: m.message, ...(m.total && m.received ? { fraction: m.received / m.total } : {}) }),
    );
    progress('Highway map ready', { id: 'map', state: 'done' });
    let streets: RoadFile[] = [];
    if (!lookups.length) progress('No connection, so no local streets', { id: 'streets', state: 'skipped', detail: 'offline' });
    else {
      const got = await waitForStreets(lookups, progress, skipStreets);
      if (got?.length) {
        streets = got;
        const n = got.reduce((k, f) => k + f.edges.length, 0);
        progress('Local streets found', { id: 'streets', state: 'done', detail: `${n.toLocaleString()} street pieces` });
      } else progress('Going without local streets', { id: 'streets', state: 'skipped', detail: got ? 'none found' : 'skipped, or the server was too slow' });
    }
    progress('Building the road network…', { id: 'network', state: 'active' });
    await nextFrame();
    const net = highways.withStreets(streets);
    progress('Road network built', { id: 'network', state: 'done' });
    progress('Finding the fastest route…', { id: 'route', state: 'active' });
    await nextFrame();
    const raw = net.planTrip(from, to, from.label, to.label);
    progress('Route found', { id: 'route', state: 'done', detail: `${Math.round(raw.realMeters / 1000).toLocaleString()} km` });
    await addFeatures(raw, (msg) => progress(msg, { id: 'landmarks', state: 'active' }), scout);
    progress('Landmarks ready', { id: 'landmarks', state: 'done', detail: `${raw.features?.length ?? 0} found` });
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
