import type { LatLng } from './geo';
import { inLower48Box, NOMINATIM_COVERAGE } from './coverage';

export interface Place extends LatLng {
  label: string;
}

/**
 * Nominatim (OpenStreetMap) search. Their usage policy allows light use at
 * no more than one request per second and no autocomplete, so the UI only
 * searches when the player presses Search. Results are kept to the lower
 * 48 US states, the only places trips can be planned (see coverage.ts).
 */
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

let lastRequest = 0;

export async function searchPlaces(query: string): Promise<Place[]> {
  const q = query.trim();
  if (!q) return [];
  const wait = lastRequest + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
  const url = `${NOMINATIM}?format=jsonv2&limit=5&${NOMINATIM_COVERAGE}&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Place search failed (${res.status}).`);
  const rows = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  return rows
    .map((r) => ({ lat: Number(r.lat), lng: Number(r.lon), label: shortLabel(r.display_name) }))
    .filter(inLower48Box);
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
