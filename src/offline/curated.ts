import type { RawRoute } from '../geo/route';
import { unpackLatLng } from './polyline';
import { atlasFeatures } from './planner';

/**
 * Classic road trips that ship with the game, pre-baked from OpenStreetMap
 * by scripts/bake-routes.mjs into public/data/routes/. They always work
 * offline. Keep the ids in sync with that script.
 */
export interface CuratedRoute {
  id: string;
  title: string;
  blurb: string;
  km: number;
}

export const CURATED_ROUTES: CuratedRoute[] = [
  { id: 'route-66', title: 'Route 66', blurb: 'Chicago to Santa Monica on the Mother Road, through Tulsa, Amarillo and Flagstaff.', km: 3503 },
  { id: 'pacific-coast', title: 'Pacific Coast Highway', blurb: 'San Francisco to San Diego along the cliffs of Big Sur.', km: 923 },
  { id: 'coast-to-coast', title: 'New York to Los Angeles', blurb: 'The full cross-country haul, sea to shining sea.', km: 4497 },
  { id: 'overseas-highway', title: 'Overseas Highway', blurb: 'Miami to Key West, island-hopping over open water.', km: 257 },
  { id: 'vegas-run', title: 'Vegas Run', blurb: 'Los Angeles to Las Vegas across the Mojave. Short and nasty.', km: 426 },
];

/** The stored shape: a RawRoute with packed geometry (same as saved trips). */
export type PackedRoute = Omit<RawRoute, 'coords'> & { packed: number[] };

export function unpackRoute(stored: PackedRoute): RawRoute {
  const { packed, ...rest } = stored;
  return { ...rest, coords: unpackLatLng(packed) };
}

export async function loadCuratedRoute(id: string): Promise<RawRoute> {
  const url = new URL(`data/routes/${id}.json`, document.baseURI).href;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load that route (${res.status}).`);
  const raw = unpackRoute((await res.json()) as PackedRoute);
  // Landmarks come from the bundled atlas, so classic trips have real sights offline too.
  if (!raw.features?.length) raw.features = await atlasFeatures(raw);
  return raw;
}
