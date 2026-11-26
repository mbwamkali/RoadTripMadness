import type { LatLng } from '../geo/geo';
import { overpassJson } from '../geo/overpass';
import { parseTownOsm, TOWN_RADIUS_M, townQuery, type TownMapData } from './layout';
import { loadSquares } from '../geo/streetTiles';
import { addMapLog, secs } from '../geo/mapLog';
import { loadRoadIndex, roadsUrl } from '../offline/roadNet';

/** Street-square classes as OpenStreetMap road types (side streets all count as residential). */
const SQUARE_CLASS = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential'];

/**
 * The town's streets and places from the road build's street squares
 * (version 2 squares carry the places). Null when the build has no squares
 * with places, or one can't be read, so the town falls back to Overpass.
 */
export async function townFromSquares(p: LatLng): Promise<TownMapData | null> {
  const t0 = Date.now();
  const index = await loadRoadIndex().catch(() => null);
  const info = index?.streets;
  if (!info || info.version < 2) return null;
  const got = await loadSquares([p], TOWN_RADIUS_M, info, roadsUrl);
  const line = `street squares ${got ? 'ok' : 'failed'} ${secs(Date.now() - t0)}`;
  if (!got) {
    addMapLog({ at: t0, what: 'town', result: 'failed', ms: Date.now() - t0, tries: [line] });
    return null;
  }
  const q = index.q;
  const kx = 111_320 * Math.cos((p.lat * Math.PI) / 180);
  const ky = 110_540;
  const local = (x: number, y: number) => ({ x: (x / q - p.lng) * kx, y: (y / q - p.lat) * ky });
  const near = (v: { x: number; y: number }) => Math.hypot(v.x, v.y) <= TOWN_RADIUS_M;
  const out: TownMapData = { streets: [], pois: [] };
  const seen = new Set<string>();
  for (const w of got.ways) {
    // Same road types as the Overpass town query: primary down to side streets.
    if (w.cls < 2) continue;
    const pts = w.pts.map(([x, y]) => local(x, y));
    if (!pts.some(near)) continue;
    const key = `${w.pts[0]},${w.pts[w.pts.length - 1]},${w.pts.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.streets.push({ name: w.name, cls: SQUARE_CLASS[w.cls], pts });
  }
  for (const pl of got.places) {
    const at = local(pl.x, pl.y);
    if (near(at)) out.pois.push({ kind: pl.kind, name: pl.name, ...at });
  }
  addMapLog({ at: t0, what: 'town', near: `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`, result: 'found', ms: Date.now() - t0, bytes: got.bytes, tries: [line], note: `${out.streets.length} streets, ${out.pois.length} places` });
  return out;
}

/**
 * Looks up a town's real streets and shops (one small Overpass query per
 * town, started when the town comes into view down the road) and keeps the
 * answer on the device, so a town looks the same next time and works offline.
 * No answer in time means the town is laid out from made-up data instead.
 */

const CACHE = 'rtm-towns-v1';
/** How long one lookup may take before the town is made up instead (ms). */
export const TOWN_LOOKUP_MS = 15_000;
/** Towns kept on the device. */
export const TOWNS_KEPT = 40;

/** Test trips (?test=..., not &town=real) skip the lookup and lay towns out from made-up data straight away. */
export const townLookup = { off: false };

const memory = new Map<string, TownMapData | null>();
const pending = new Map<string, Promise<TownMapData | null>>();

const keyOf = (p: LatLng) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;
const urlOf = (k: string) => `https://rtm.local/towns/${k}.json`;

/** What we already know about the town at `p`, without waiting (undefined: not looked up yet). */
export function knownTown(p: LatLng): TownMapData | null | undefined {
  return memory.get(keyOf(p));
}

/** The town's map data, from memory, the device, or one Overpass lookup. */
export function lookupTown(p: LatLng): Promise<TownMapData | null> {
  const k = keyOf(p);
  if (memory.has(k)) return Promise.resolve(memory.get(k)!);
  if (townLookup.off) {
    memory.set(k, null);
    return Promise.resolve(null);
  }
  let job = pending.get(k);
  if (!job) {
    job = (async () => {
      const saved = await readSaved(k);
      if (saved) return saved;
      const fromSquares = await townFromSquares(p);
      if (fromSquares) {
        void save(k, fromSquares);
        return fromSquares;
      }
      const json = await overpassJson(townQuery(p), TOWN_LOOKUP_MS, 'town');
      if (!json) return null;
      const data = parseTownOsm(json, p);
      void save(k, data);
      return data;
    })()
      .catch(() => null)
      .then((d) => {
        memory.set(k, d);
        pending.delete(k);
        return d;
      });
    pending.set(k, job);
  }
  return job;
}

async function readSaved(k: string): Promise<TownMapData | null> {
  try {
    if (typeof caches === 'undefined') return null;
    const c = await caches.open(CACHE);
    const r = await c.match(urlOf(k));
    return r ? ((await r.json()) as TownMapData) : null;
  } catch {
    return null;
  }
}

async function save(k: string, data: TownMapData): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    const c = await caches.open(CACHE);
    await c.put(urlOf(k), new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } }));
    // Keep the newest few dozen.
    const keys = await c.keys();
    for (const old of keys.slice(0, Math.max(0, keys.length - TOWNS_KEPT))) await c.delete(old);
  } catch {
    // Storage full or blocked: the town still plays, it just isn't kept.
  }
}
