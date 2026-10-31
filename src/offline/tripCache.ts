import type { LatLng } from '../geo/geo';
import type { RawRoute } from '../geo/route';
import { hashString } from '../game/rng';
import { packLatLng, simplifyLatLng, unpackLatLng } from './polyline';

/**
 * Saved trips. Every route planned online is kept on the device in a slimmed
 * form so it can be replayed, or finished, with no connection.
 *
 * Each trip lives under its own localStorage key, with a small index listing
 * them, so saving one trip never rewrites the others. The oldest trips are
 * dropped when there are too many or storage is full.
 */

export interface SavedTripMeta {
  id: string;
  startLabel: string;
  endLabel: string;
  source: RawRoute['source'];
  km: number;
  hours: number;
  savedAt: number;
  playedAt: number;
}

/** A RawRoute with its geometry packed. Any other fields (for example landmark features) are kept as they are. */
type StoredRoute = Omit<RawRoute, 'coords'> & { packed: number[] };

const INDEX_KEY = 'rtm-trips-v1';
const TRIP_KEY = (id: string) => `rtm-trip-v1:${id}`;
export const MAX_TRIPS = 25;
/** Geometry tolerance when saving. The game smooths routes far more than this. */
const SAVE_TOLERANCE_M = 25;

/** The bit of storage we use. localStorage in the browser; a Map in tests. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Same start, end and labels give the same id, so re-planning a trip refreshes it instead of duplicating it. */
export function tripId(start: LatLng, end: LatLng, startLabel: string, endLabel: string): string {
  const r = (v: number) => v.toFixed(3);
  return hashString(`${r(start.lat)},${r(start.lng)};${r(end.lat)},${r(end.lng)};${startLabel};${endLabel}`).toString(36);
}

const round = (p: LatLng): LatLng => ({ lat: Math.round(p.lat * 1e5) / 1e5, lng: Math.round(p.lng * 1e5) / 1e5 });

/** Landmark features can carry long river lines; only where they cross the road matters, so slim them too. */
function slimFeature(f: NonNullable<RawRoute['features']>[number]): NonNullable<RawRoute['features']>[number] {
  return {
    ...f,
    ...(f.point ? { point: round(f.point) } : {}),
    ...(f.line ? { line: simplifyLatLng(f.line, 60).map(round) } : {}),
  };
}

export class TripCache {
  constructor(private readonly store: KeyValueStore | null = defaultStore()) {}

  list(): SavedTripMeta[] {
    if (!this.store) return [];
    try {
      const raw = this.store.getItem(INDEX_KEY);
      const list = raw ? (JSON.parse(raw) as SavedTripMeta[]) : [];
      return list.sort((a, b) => b.playedAt - a.playedAt);
    } catch {
      return [];
    }
  }

  private writeIndex(list: SavedTripMeta[]): void {
    this.store?.setItem(INDEX_KEY, JSON.stringify(list));
  }

  /**
   * Saves a route. Pass the places the player picked, so `find` can match the
   * trip later (the route itself starts where the router snapped to a road).
   * Returns its id, or null when storage is unavailable. Never throws.
   */
  save(raw: RawRoute, places?: { start: LatLng; end: LatLng }, now = Date.now()): string | null {
    if (!this.store || raw.coords.length < 2) return null;
    const start = places?.start ?? raw.coords[0];
    const end = places?.end ?? raw.coords[raw.coords.length - 1];
    const id = tripId(start, end, raw.startLabel, raw.endLabel);
    const { coords, ...rest } = raw;
    const stored: StoredRoute = { ...rest, packed: packLatLng(simplifyLatLng(coords, SAVE_TOLERANCE_M)) };
    if (raw.features) stored.features = raw.features.map(slimFeature);
    const body = JSON.stringify(stored);
    const meta: SavedTripMeta = {
      id,
      startLabel: raw.startLabel,
      endLabel: raw.endLabel,
      source: raw.source,
      km: Math.round(raw.realMeters / 100) / 10,
      hours: Math.round(raw.realSeconds / 360) / 10,
      savedAt: now,
      playedAt: now,
    };
    const list = this.list().filter((t) => t.id !== id);
    list.unshift(meta);
    while (list.length > MAX_TRIPS) this.dropTrip(list.pop()!.id);
    // If storage is full, drop the least recently played trips until it fits.
    for (;;) {
      try {
        this.store.setItem(TRIP_KEY(id), body);
        this.writeIndex(list);
        return id;
      } catch {
        if (list.length <= 1) {
          this.dropTrip(id);
          this.writeIndex(list.filter((t) => t.id !== id));
          return null;
        }
        this.dropTrip(list.pop()!.id);
      }
    }
  }

  /** Loads a saved trip, ready for buildRouteData. Marks it as just played. */
  load(id: string, now = Date.now()): RawRoute | null {
    if (!this.store) return null;
    try {
      const body = this.store.getItem(TRIP_KEY(id));
      if (!body) return null;
      const { packed, ...rest } = JSON.parse(body) as StoredRoute;
      const list = this.list();
      const meta = list.find((t) => t.id === id);
      if (meta) {
        meta.playedAt = now;
        this.writeIndex(list);
      }
      return { ...rest, coords: unpackLatLng(packed) } as RawRoute;
    } catch {
      return null;
    }
  }

  /** Finds a saved trip between the same places, used when planning fails offline. */
  find(start: LatLng, end: LatLng, startLabel: string, endLabel: string): RawRoute | null {
    const id = tripId(start, end, startLabel, endLabel);
    return this.list().some((t) => t.id === id) ? this.load(id) : null;
  }

  remove(id: string): void {
    this.dropTrip(id);
    this.writeIndex(this.list().filter((t) => t.id !== id));
  }

  private dropTrip(id: string): void {
    try {
      this.store?.removeItem(TRIP_KEY(id));
    } catch {
      /* ignore */
    }
  }
}

export const tripCache = new TripCache();
