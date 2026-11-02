import { haversineMeters, type LatLng } from './geo';
import { OVERPASS_URL, type OsmElement } from './overpass';
import { nodeKey, type RoadFile } from '../offline/roadNet';

/**
 * Local streets at each end of a trip (own routing, phase 3).
 *
 * The road files only hold highways, so a trip from a home address used to
 * start with a straight line to the nearest highway. Here the game asks the
 * public Overpass server once per trip for the streets around the start and
 * the end, and turns the answer into a small road file in the same format as
 * the tiles. The router then uses it like any other file: streets join the
 * highways at the junctions they share (same OpenStreetMap node, so the same
 * integer coordinates). If the lookup fails, the trip keeps the straight link.
 */

/** Road classes in a local file. The first three match the backbone and tiles. */
export const LOCAL_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'];

const CLASS_OF: Record<string, number> = {
  motorway: 0,
  motorway_link: 0,
  trunk: 1,
  trunk_link: 1,
  primary: 2,
  primary_link: 2,
  secondary: 3,
  secondary_link: 3,
  tertiary: 4,
  tertiary_link: 4,
  unclassified: 5,
  residential: 5,
  living_street: 5,
};

/** Side streets this close to the start or end are fetched. */
export const MINOR_RADIUS_M = 2_000;
/** Secondary and tertiary roads reach further, so the side streets connect to the highway map. */
export const MIDDLE_RADIUS_M = 4_000;
/**
 * Trunk and primary roads are in the highway map already, but only with
 * nodes at their own junctions; a local copy gives the junctions where
 * smaller streets meet them part way along. Motorways only meet streets at
 * ramps, whose ends are in the highway map, so they aren't fetched.
 */
export const MAJOR_RADIUS_M = 3_000;
/** How long trip planning waits for the street lookup before going without it (the player can skip sooner). */
export const LOCAL_TIMEOUT_MS = 20_000;

const OPEN = '[access!~"^(private|no)$"][area!="yes"]';

/**
 * The Overpass query for the streets around one place. `out geom` puts each
 * way's points inline, which is about a third smaller than listing the
 * nodes separately; streets are matched to each other and to the highway
 * map by their coordinates, so node ids aren't needed.
 */
export function buildLocalStreetsQuery(p: LatLng): string {
  const at = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  return `[out:json][timeout:25];
(
way(around:${MINOR_RADIUS_M},${at})[highway~"^(unclassified|residential|living_street)$"]${OPEN};
way(around:${MIDDLE_RADIUS_M},${at})[highway~"^(secondary|tertiary)(_link)?$"]${OPEN};
way(around:${MAJOR_RADIUS_M},${at})[highway~"^(trunk|primary)(_link)?$"]${OPEN};
);
out geom qt;`;
}

/** Python's round(): halves go to the even number. Matches scripts/build-osm-roads.py so shared nodes line up. */
export function pyRound(v: number): number {
  const f = Math.floor(v);
  const d = v - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** '25 mph' -> 40, '50' -> 50, anything else -> 0. Same as the build script. */
export function parseSpeed(v: string | undefined): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh)?\s*$/.exec(v ?? '');
  if (!m) return 0;
  const n = parseFloat(m[1]);
  return pyRound(m[2] === 'mph' ? n * 1.609344 : n);
}

function parseLanes(v: string | undefined): number {
  const n = parseInt((v ?? '').split(';')[0], 10);
  return n > 0 && n < 20 ? n : 0;
}

interface Way {
  cls: number;
  oneway: boolean;
  ref: string;
  name: string;
  speed: number;
  lanes: number;
  /** Points in 1/q degrees; their coordinate keys identify them. */
  pts: [number, number][];
}

type OverpassWay = OsmElement & { id: number; nodes?: number[] };

/**
 * Turns an Overpass answer into a road file. Takes ways with inline
 * geometry (`out geom`) or ways followed by their nodes. Ways are split
 * where they meet, like the build script does. With `joinWith`, parts that
 * never reach one of its nodes are dropped (see keepJoined).
 */
export function localStreetsFile(
  json: { elements?: OsmElement[] },
  q: number,
  attribution: string,
  joinWith: RoadFile[] | null = null,
): RoadFile {
  const where = new Map<number, [number, number]>();
  for (const e of (json.elements ?? []) as OverpassWay[])
    if (e.type === 'node' && e.lat !== undefined && e.lon !== undefined) where.set(e.id, [pyRound(e.lon * q), pyRound(e.lat * q)]);
  const ways: Way[] = [];
  for (const e of (json.elements ?? []) as OverpassWay[]) {
    if (e.type !== 'way') continue;
    const t = e.tags ?? {};
    const cls = CLASS_OF[t.highway];
    if (cls === undefined) continue;
    // A point the answer left out (null in the geometry, or a missing node) splits the way there.
    const raw: ([number, number] | null)[] = e.geometry
      ? e.geometry.map((g) => (g ? [pyRound(g.lon * q), pyRound(g.lat * q)] : null))
      : (e.nodes ?? []).map((id) => where.get(id) ?? null);
    if (t.oneway === '-1') raw.reverse();
    const oneway =
      ['yes', '1', 'true', '-1'].includes(t.oneway) ||
      ((t.highway === 'motorway' || t.highway === 'motorway_link') && t.oneway !== 'no') ||
      t.junction === 'roundabout' ||
      t.junction === 'circular';
    const base = { cls, oneway, ref: t.ref ?? '', name: t.name ?? '', speed: parseSpeed(t.maxspeed), lanes: parseLanes(t.lanes) };
    let run: [number, number][] = [];
    for (const p of [...raw, null]) {
      if (p) run.push(p);
      else {
        if (run.length > 1) ways.push({ ...base, pts: run });
        run = [];
      }
    }
  }

  // A way is split at any point it shares with another way (or itself), and at its ends.
  const key = (p: [number, number]) => nodeKey(p[0], p[1]);
  const uses = new Map<number, number>();
  for (const w of ways) w.pts.forEach((p, i) => uses.set(key(p), (uses.get(key(p)) ?? 0) + (i === 0 || i === w.pts.length - 1 ? 2 : 1)));
  const pieces: { w: Way; pts: [number, number][] }[] = [];
  for (const w of ways) {
    let cur: [number, number][] = [w.pts[0]];
    for (let i = 1; i < w.pts.length; i++) {
      cur.push(w.pts[i]);
      if (i < w.pts.length - 1 && (uses.get(key(w.pts[i])) ?? 0) > 1) {
        pieces.push({ w, pts: cur });
        cur = [w.pts[i]];
      }
    }
    if (cur.length > 1) pieces.push({ w, pts: cur });
  }

  const nodeIx = new Map<number, number>();
  const nodes: number[] = [];
  const ix = (p: [number, number]) => {
    const k = key(p);
    let i = nodeIx.get(k);
    if (i === undefined) {
      i = nodes.length / 2;
      nodeIx.set(k, i);
      nodes.push(p[0], p[1]);
    }
    return i;
  };
  const refs: string[] = [];
  const names: string[] = [];
  const refIx = new Map<string, number>();
  const nameIx = new Map<string, number>();
  const intern = (str: string, list: string[], map: Map<string, number>) => {
    let i = map.get(str);
    if (i === undefined) {
      i = list.length;
      map.set(str, i);
      list.push(str);
    }
    return i;
  };
  const edges: RoadFile['edges'] = [];
  for (const { w, pts } of pieces) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (key(a) === key(b) && pts.length < 3) continue;
    let meters = 0;
    for (let i = 1; i < pts.length; i++) meters += haversineMeters({ lng: pts[i - 1][0] / q, lat: pts[i - 1][1] / q }, { lng: pts[i][0] / q, lat: pts[i][1] / q });
    const deltas: number[] = [];
    let [x, y] = a;
    for (const [px, py] of pts.slice(1, -1)) {
      if (px === x && py === y) continue;
      deltas.push(px - x, py - y);
      x = px;
      y = py;
    }
    edges.push([ix(a), ix(b), w.cls, intern(w.ref, refs, refIx), intern(w.name, names, nameIx), Math.round(meters), w.oneway ? 1 : 0, w.speed, w.lanes, deltas]);
  }
  const file: RoadFile = { version: 2, kind: 'local', q, attribution, classes: LOCAL_CLASSES, refs, names, nodes, edges };
  if (!joinWith) return file;
  const keys = new Set<number>();
  for (const f of joinWith) for (let i = 0; i < f.nodes.length; i += 2) keys.add(nodeKey(f.nodes[i], f.nodes[i + 1]));
  return keepJoined(file, (x, y) => keys.has(nodeKey(x, y))) ?? { ...file, nodes: [], edges: [] };
}

/**
 * Drops the parts of a local street file that never reach the highway map
 * (`isJoined` says whether a point is one of its nodes), so a route can't
 * start somewhere it can't leave. Null when nothing is left.
 */
export function keepJoined(file: RoadFile, isJoined: (x: number, y: number) => boolean): RoadFile | null {
  const n = file.nodes.length / 2;
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  for (const e of file.edges) parent[find(e[0])] = find(e[1]);
  const joined = new Set<number>();
  for (let i = 0; i < n; i++) if (isJoined(file.nodes[i * 2], file.nodes[i * 2 + 1])) joined.add(find(i));
  if (!joined.size) return null;
  const edges = file.edges.filter((e) => joined.has(find(e[0])));
  return edges.length === file.edges.length ? file : { ...file, edges };
}

// ------------------------------------------------------------------ lookup, cache and progress

/** What a street lookup is doing, for the trip planner's progress list. */
export interface StreetStatus {
  state: 'cached' | 'waiting' | 'receiving' | 'done' | 'failed';
  /** Bytes of the answer received so far. */
  bytes: number;
  /** When the request went out (ms since epoch). */
  started: number;
}

export interface StreetLookup {
  status: StreetStatus;
  /** The streets around the place (all of them, not yet joined), or null if the lookup failed. */
  file: Promise<RoadFile | null>;
}

const CACHE_NAME = 'rtm-streets-v1';
const INDEX_KEY = 'rtm-streets-index';
/** A saved lookup is reused for places within this distance of where it was made. */
const REUSE_M = 250;
const MAX_SAVED = 15;
const MAX_AGE_MS = 60 * 24 * 3600 * 1000;

interface SavedPlace {
  lat: number;
  lng: number;
  url: string;
  at: number;
}

function savedIndex(): SavedPlace[] {
  try {
    const list = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]') as SavedPlace[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeIndex(list: SavedPlace[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked: the lookups just aren't remembered */
  }
}

/** A saved street file for a place, if one was made close by recently. */
async function savedStreets(p: LatLng): Promise<RoadFile | null> {
  if (typeof caches === 'undefined') return null;
  const hit = savedIndex().find((s) => Date.now() - s.at < MAX_AGE_MS && haversineMeters(s, p) <= REUSE_M);
  if (!hit) return null;
  try {
    const res = await (await caches.open(CACHE_NAME)).match(hit.url);
    return res ? ((await res.json()) as RoadFile) : null;
  } catch {
    return null;
  }
}

/** Remembers the streets around a place, keeping the most recent MAX_SAVED places. */
async function saveStreets(p: LatLng, file: RoadFile): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(CACHE_NAME);
    const url = `${location.origin}/__streets/${p.lat.toFixed(4)}_${p.lng.toFixed(4)}.json`;
    await cache.put(url, new Response(JSON.stringify(file), { headers: { 'Content-Type': 'application/json' } }));
    const list = [{ lat: p.lat, lng: p.lng, url, at: Date.now() }, ...savedIndex().filter((s) => s.url !== url)];
    for (const old of list.splice(MAX_SAVED)) await cache.delete(old.url);
    writeIndex(list);
  } catch {
    /* not remembered; next time it's looked up again */
  }
}

/** Runs the Overpass query, reporting bytes as they arrive. Null on any failure. */
async function fetchStreets(p: LatLng, status: StreetStatus, signal: AbortSignal): Promise<{ elements?: OsmElement[] } | null> {
  try {
    const res = await fetch(OVERPASS_URL, { method: 'POST', body: new URLSearchParams({ data: buildLocalStreetsQuery(p) }), signal });
    if (!res.ok || !res.body) return null;
    status.state = 'receiving';
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      status.bytes += value.length;
    }
    const all = new Uint8Array(status.bytes);
    let at = 0;
    for (const c of chunks) {
      all.set(c, at);
      at += c.length;
    }
    return JSON.parse(new TextDecoder().decode(all)) as { elements?: OsmElement[] };
  } catch {
    return null;
  }
}

const lookups = new Map<string, StreetLookup>();

/**
 * The street lookup for a place, started now if it isn't running yet. The
 * setup screen calls this as soon as a place is picked, so the answer is
 * often in by the time the player presses Plan. A place looked up before
 * (within 250 m, in the last 60 days) comes from the device instead.
 */
export function lookupStreets(p: LatLng, q: number, attribution: string): StreetLookup {
  const id = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
  const running = lookups.get(id);
  if (running && running.status.state !== 'failed') return running;
  const status: StreetStatus = { state: 'waiting', bytes: 0, started: Date.now() };
  const ctrl = new AbortController();
  const giveUp = setTimeout(() => ctrl.abort(), 90_000);
  const file = (async () => {
    const saved = await savedStreets(p);
    if (saved) {
      status.state = 'cached';
      return saved;
    }
    const json = await fetchStreets(p, status, ctrl.signal);
    clearTimeout(giveUp);
    if (!json) {
      status.state = 'failed';
      return null;
    }
    const f = localStreetsFile(json, q, attribution);
    status.state = 'done';
    if (f.edges.length) void saveStreets(p, f);
    return f.edges.length ? f : null;
  })();
  const lookup = { status, file };
  lookups.set(id, lookup);
  return lookup;
}
