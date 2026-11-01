import { haversineMeters, type LatLng } from './geo';
import { overpassJson, type OsmElement } from './overpass';
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
/** Bigger roads reach further, so the streets connect to the highway map. */
export const MAJOR_RADIUS_M = 6_000;
/** How long the trip planner waits for the lookup before using the straight link. */
export const LOCAL_TIMEOUT_MS = 12_000;

const OPEN = '[access!~"^(private|no)$"][area!="yes"]';

/** One Overpass query for the streets around every given point. */
export function buildLocalStreetsQuery(points: LatLng[]): string {
  const parts = points.flatMap((p) => {
    const at = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
    return [
      `way(around:${MINOR_RADIUS_M},${at})[highway~"^(unclassified|residential|living_street)$"]${OPEN};`,
      `way(around:${MAJOR_RADIUS_M},${at})[highway~"^(motorway|trunk|primary|secondary|tertiary)(_link)?$"]${OPEN};`,
    ];
  });
  return `[out:json][timeout:25];\n(\n${parts.join('\n')}\n);\nout body qt;\n>;\nout skel qt;`;
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
  nodes: number[];
}

/**
 * Turns an Overpass answer (ways with tags, then their nodes) into a road
 * file. Ways are split where they meet, like the build script does. Parts
 * that never reach a node in `joinKeys` (the highway map's nodes) are dropped,
 * so a route can't start somewhere it can't leave.
 */
export function localStreetsFile(
  json: { elements?: OsmElement[] },
  q: number,
  attribution: string,
  joinWith: RoadFile[] | null = null,
): RoadFile {
  const where = new Map<number, [number, number]>();
  const ways: Way[] = [];
  for (const e of (json.elements ?? []) as (OsmElement & { id: number; nodes?: number[] })[]) {
    if (e.type === 'node' && e.lat !== undefined && e.lon !== undefined) where.set(e.id, [pyRound(e.lon * q), pyRound(e.lat * q)]);
    if (e.type !== 'way' || !e.nodes || e.nodes.length < 2) continue;
    const t = e.tags ?? {};
    const cls = CLASS_OF[t.highway];
    if (cls === undefined) continue;
    let nodes = e.nodes;
    if (t.oneway === '-1') nodes = nodes.slice().reverse();
    const oneway =
      ['yes', '1', 'true', '-1'].includes(t.oneway) ||
      ((t.highway === 'motorway' || t.highway === 'motorway_link') && t.oneway !== 'no') ||
      t.junction === 'roundabout' ||
      t.junction === 'circular';
    ways.push({ cls, oneway, ref: t.ref ?? '', name: t.name ?? '', speed: parseSpeed(t.maxspeed), lanes: parseLanes(t.lanes), nodes });
  }

  // A way is split at any node it shares with another way (or itself), and at its ends.
  const uses = new Map<number, number>();
  for (const w of ways) w.nodes.forEach((n, i) => uses.set(n, (uses.get(n) ?? 0) + (i === 0 || i === w.nodes.length - 1 ? 2 : 1)));

  interface Piece {
    w: Way;
    pts: [number, number][];
    a: number;
    b: number;
  }
  const pieces: Piece[] = [];
  for (const w of ways) {
    let cur: [number, number][] = [];
    let start = -1;
    for (let i = 0; i < w.nodes.length; i++) {
      const id = w.nodes[i];
      const p = where.get(id);
      if (!p) {
        // A node the answer left out: end this piece here.
        if (cur.length > 1) pieces.push({ w, pts: cur, a: start, b: w.nodes[i - 1] });
        cur = [];
        continue;
      }
      if (!cur.length) start = id;
      cur.push(p);
      if (cur.length > 1 && (uses.get(id) ?? 0) > 1) {
        pieces.push({ w, pts: cur, a: start, b: id });
        cur = [p];
        start = id;
      }
    }
    if (cur.length > 1) pieces.push({ w, pts: cur, a: start, b: w.nodes[w.nodes.length - 1] });
  }

  // Keep only the parts connected to the highway map (when we know it).
  const keyOf = (id: number) => nodeKey(...where.get(id)!);
  let keep = pieces;
  if (joinWith) {
    const local = new Set<number>();
    for (const p of pieces) local.add(keyOf(p.a)).add(keyOf(p.b));
    const joinKeys = new Set<number>();
    for (const f of joinWith)
      for (let i = 0; i < f.nodes.length; i += 2) {
        const k = nodeKey(f.nodes[i], f.nodes[i + 1]);
        if (local.has(k)) joinKeys.add(k);
      }
    const parent = new Map<number, number>();
    const find = (x: number): number => {
      let r = x;
      while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
      parent.set(x, r);
      return r;
    };
    for (const p of pieces) {
      if (!parent.has(p.a)) parent.set(p.a, p.a);
      if (!parent.has(p.b)) parent.set(p.b, p.b);
      parent.set(find(p.a), find(p.b));
    }
    const joined = new Set<number>();
    for (const id of parent.keys()) if (joinKeys.has(keyOf(id))) joined.add(find(id));
    keep = pieces.filter((p) => joined.has(find(p.a)));
  }

  const nodeIx = new Map<number, number>();
  const nodes: number[] = [];
  const ix = (id: number) => {
    let i = nodeIx.get(id);
    if (i === undefined) {
      i = nodes.length / 2;
      nodeIx.set(id, i);
      nodes.push(...where.get(id)!);
    }
    return i;
  };
  const refs: string[] = [];
  const names: string[] = [];
  const refIx = new Map<string, number>();
  const nameIx = new Map<string, number>();
  const intern = (s: string, list: string[], map: Map<string, number>) => {
    let i = map.get(s);
    if (i === undefined) {
      i = list.length;
      map.set(s, i);
      list.push(s);
    }
    return i;
  };
  const edges: RoadFile['edges'] = [];
  for (const { w, pts, a, b } of keep) {
    if (a === b && pts.length < 3) continue;
    let meters = 0;
    for (let i = 1; i < pts.length; i++) meters += haversineMeters({ lng: pts[i - 1][0] / q, lat: pts[i - 1][1] / q }, { lng: pts[i][0] / q, lat: pts[i][1] / q });
    const deltas: number[] = [];
    let [x, y] = pts[0];
    for (const [px, py] of pts.slice(1, -1)) {
      if (px === x && py === y) continue;
      deltas.push(px - x, py - y);
      x = px;
      y = py;
    }
    edges.push([ix(a), ix(b), w.cls, intern(w.ref, refs, refIx), intern(w.name, names, nameIx), Math.round(meters), w.oneway ? 1 : 0, w.speed, w.lanes, deltas]);
  }
  return { version: 2, kind: 'local', q, attribution, classes: LOCAL_CLASSES, refs, names, nodes, edges };
}

/** Asks Overpass for the streets around the given points. Null on any failure (no connection, server busy, too slow). */
export function fetchLocalStreets(points: LatLng[], timeoutMs = LOCAL_TIMEOUT_MS): Promise<{ elements?: OsmElement[] } | null> {
  return overpassJson(buildLocalStreetsQuery(points), timeoutMs, false);
}

/** The fetched streets as a road file joined to `base`, or null when none of them reach it. */
export function joinLocalStreets(json: { elements?: OsmElement[] }, base: RoadFile[]): RoadFile | null {
  const file = localStreetsFile(json, base[0].q, base[0].attribution, base);
  return file.edges.length ? file : null;
}
