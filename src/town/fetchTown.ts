import type { LatLng } from '../geo/geo';
import { overpassJson } from '../geo/overpass';
import { parseTownOsm, townQuery, type TownMapData } from './layout';

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
  let job = pending.get(k);
  if (!job) {
    job = (async () => {
      const saved = await readSaved(k);
      if (saved) return saved;
      const json = await overpassJson(townQuery(p), TOWN_LOOKUP_MS);
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
