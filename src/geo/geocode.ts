import type { LatLng } from './geo';
import { inLower48Box, NOMINATIM_COVERAGE } from './coverage';
import { servers } from './servers';

export interface Place extends LatLng {
  label: string;
}

/**
 * Nominatim (OpenStreetMap) search. Their usage policy allows light use at
 * no more than one request per second and no autocomplete, so the UI only
 * searches when the player presses Search. Results are kept to the lower
 * 48 US states, the only places trips can be planned (see coverage.ts).
 */
let lastRequest = 0;

/**
 * Searches are remembered on the device for SEARCH_CACHE_DAYS, so asking
 * again never reaches Nominatim (their usage policy asks apps to cache).
 */
export const SEARCH_CACHE_DAYS = 30;
const SEARCH_CACHE_KEY = 'rtm-search-cache';
const SEARCH_CACHE_MAX = 100;

type SearchCache = Record<string, { at: number; places: Place[] }>;

const normQuery = (q: string) => q.trim().toLowerCase().replace(/\s+/g, ' ');

function readSearchCache(): SearchCache {
  try {
    const c = JSON.parse(localStorage.getItem(SEARCH_CACHE_KEY) ?? '{}') as SearchCache;
    return c && typeof c === 'object' ? c : {};
  } catch {
    return {};
  }
}

/** A remembered answer for this search, if it is recent enough. */
export function cachedSearch(query: string, now = Date.now()): Place[] | null {
  const hit = readSearchCache()[normQuery(query)];
  return hit && now - hit.at < SEARCH_CACHE_DAYS * 86_400_000 ? hit.places : null;
}

/** Remembers an answer, keeping the newest SEARCH_CACHE_MAX searches. */
export function rememberSearch(query: string, places: Place[], now = Date.now()): void {
  try {
    const c = readSearchCache();
    c[normQuery(query)] = { at: now, places };
    const keep = Object.entries(c)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, SEARCH_CACHE_MAX);
    localStorage.setItem(SEARCH_CACHE_KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch {
    /* storage full or blocked: just not remembered */
  }
}

export async function searchPlaces(query: string): Promise<Place[]> {
  const q = query.trim();
  if (!q) return [];
  const known = cachedSearch(q);
  if (known) return known;
  const wait = lastRequest + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
  const url = `${servers().nominatim}?format=jsonv2&limit=5&${NOMINATIM_COVERAGE}&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Place search failed (${res.status}).`);
  const rows = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  const places = rows
    .map((r) => ({ lat: Number(r.lat), lng: Number(r.lon), label: shortLabel(r.display_name) }))
    .filter(inLower48Box);
  rememberSearch(q, places);
  return places;
}

/** "Denver, Colorado, United States" from Nominatim's long display names. */
export function shortLabel(displayName: string): string {
  const parts = displayName.split(',').map((p) => p.trim()).filter((p) => p && !/^\d[\d -]*$/.test(p));
  return parts.slice(0, 3).join(', ');
}

export function currentPosition(): Promise<Place> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This device has no location service.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, label: 'My location' }),
      () => reject(new Error('Could not get your location.')),
      { timeout: 10000, maximumAge: 600000 },
    );
  });
}
