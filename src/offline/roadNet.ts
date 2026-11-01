import { haversineMeters, type LatLng } from '../geo/geo';
import type { RawRoute, RawStep } from '../geo/route';
import { MinHeap, nearRoute, turnModifier } from './atlas';

/**
 * The game's own road network, built from OpenStreetMap by
 * scripts/build-osm-roads.py and published on the site under data/osm/:
 * a national backbone of interstates and major highways, plus 2° tiles of
 * US and state routes. The phone loads the backbone and the tiles around the
 * start and the end, and finds the fastest route itself, so no routing
 * server is needed. See docs/DESIGN.md ("Road files from OpenStreetMap").
 */

/** One road file (backbone or tile), version 2. See scripts/build-osm-roads.py for the format. */
export interface RoadFile {
  version: 2;
  kind: 'backbone' | 'tile';
  q: number;
  attribution: string;
  classes: string[];
  refs: string[];
  names: string[];
  /** Flat [lng, lat, ...] in 1/q degrees. Nodes with equal integers are the same place in every file. */
  nodes: number[];
  /** [a, b, class, refIndex, nameIndex, meters, flags, speedKmh, lanes, deltas]. flags bit 0: one way a→b. */
  edges: [number, number, number, number, number, number, number, number, number, number[]][];
  /** Backbone only: [node, exit number, exit name]. */
  exits?: [number, string, string][];
}

export interface RoadIndex {
  version: 2;
  built: string;
  attribution: string;
  q: number;
  tileDeg: number;
  backbone: { file: string; gzipBytes: number; km: number };
  towns: { file: string; count: number };
  tiles: [number, number, number][];
}

export interface TownsFile {
  version: 2;
  q: number;
  kinds: string[];
  /** [name, kindIndex (0 city, 1 town), lng, lat, population], biggest first. */
  towns: [string, number, number, number, number][];
}

export interface Town extends LatLng {
  name: string;
  city: boolean;
  pop: number;
}

/** Cruising speed when OpenStreetMap gives no speed limit, by class: motorway, trunk, primary. */
const DEFAULT_KMH = [105, 88, 72];
/** Traffic averages about this share of the speed limit (matches OSRM's trip times within about 5%). */
const PACE = 0.8;
/** Off-network stretch from the start or end to the nearest road: slower, and roads wind. */
const CONNECTOR_KMH = 40;
const CONNECTOR_WIND = 1.3;
/** Search radius for the nearest roads, tried in order. */
const CONNECTOR_RADII_M = [15_000, 40_000, 90_000];
/** Grid cell for the nearest-node lookup, in degrees. */
const CELL_DEG = 0.1;
/** Turn-offs closer together than this are merged into the later one. */
const MIN_STEP_GAP_M = 250;

const nodeKey = (x: number, y: number) => (x + 2e7) * 4e7 + (y + 2e7);

export class RoadNet {
  readonly attribution: string;
  private readonly q: number;
  private readonly files: RoadFile[];
  /** Node coordinates in 1/q degrees. */
  private readonly nx: Int32Array;
  private readonly ny: Int32Array;
  /** Edge endpoints in merged node numbers, and where each edge came from. */
  private readonly ea: Int32Array;
  private readonly eb: Int32Array;
  private readonly eFile: Int32Array;
  private readonly eIx: Int32Array;
  private readonly cost: Float64Array;
  private readonly maxSpeedMs: number;
  /** CSR adjacency over directed moves: from node n, edges adjEdge[adjStart[n] .. adjStart[n+1]). */
  private readonly adjStart: Int32Array;
  private readonly adjEdge: Int32Array;
  private readonly grid = new Map<number, number[]>();
  private readonly exitAt = new Map<number, [string, string]>();
  readonly towns: Town[];

  constructor(files: RoadFile[], towns: TownsFile | null = null) {
    if (!files.length) throw new Error('No road files');
    for (const f of files) if (f.version !== 2) throw new Error('Unsupported road file version');
    this.files = files;
    this.q = files[0].q;
    this.attribution = files[0].attribution;

    // Merge nodes across files by their exact integer coordinates.
    const ids = new Map<number, number>();
    const xs: number[] = [];
    const ys: number[] = [];
    const localToGlobal = files.map((f) => {
      const map = new Int32Array(f.nodes.length / 2);
      for (let i = 0; i < map.length; i++) {
        const x = f.nodes[i * 2];
        const y = f.nodes[i * 2 + 1];
        const k = nodeKey(x, y);
        let id = ids.get(k);
        if (id === undefined) {
          id = xs.length;
          ids.set(k, id);
          xs.push(x);
          ys.push(y);
        }
        map[i] = id;
      }
      return map;
    });
    this.nx = Int32Array.from(xs);
    this.ny = Int32Array.from(ys);

    let edgeCount = 0;
    for (const f of files) edgeCount += f.edges.length;
    this.ea = new Int32Array(edgeCount);
    this.eb = new Int32Array(edgeCount);
    this.eFile = new Int32Array(edgeCount);
    this.eIx = new Int32Array(edgeCount);
    this.cost = new Float64Array(edgeCount);
    const oneway = new Uint8Array(edgeCount);
    let maxKmh = Math.max(...DEFAULT_KMH);
    let ei = 0;
    files.forEach((f, fi) => {
      const map = localToGlobal[fi];
      f.edges.forEach((e, i) => {
        this.ea[ei] = map[e[0]];
        this.eb[ei] = map[e[1]];
        this.eFile[ei] = fi;
        this.eIx[ei] = i;
        const kmh = e[7] > 0 ? Math.min(e[7], 140) : DEFAULT_KMH[e[2]] ?? 60;
        maxKmh = Math.max(maxKmh, kmh);
        this.cost[ei] = e[5] / ((kmh * PACE) / 3.6);
        oneway[ei] = e[6] & 1;
        ei++;
      });
      for (const [n, ref, name] of f.exits ?? []) if (ref) this.exitAt.set(map[n], [ref, name]);
    });
    this.maxSpeedMs = (maxKmh * PACE) / 3.6;

    // Directed adjacency: a one-way edge can only be driven a→b.
    const n = xs.length;
    const deg = new Int32Array(n + 1);
    for (let i = 0; i < edgeCount; i++) {
      deg[this.ea[i] + 1]++;
      if (!oneway[i]) deg[this.eb[i] + 1]++;
    }
    for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
    this.adjStart = deg.slice();
    this.adjEdge = new Int32Array(deg[n]);
    const fill = deg.slice();
    for (let i = 0; i < edgeCount; i++) {
      this.adjEdge[fill[this.ea[i]]++] = i;
      if (!oneway[i]) this.adjEdge[fill[this.eb[i]]++] = i;
    }

    // Only nodes you can drive away from are useful starts; any node can be an end.
    for (let i = 0; i < n; i++) {
      const c = this.cellOf(this.nx[i] / this.q, this.ny[i] / this.q);
      let list = this.grid.get(c);
      if (!list) this.grid.set(c, (list = []));
      list.push(i);
    }

    this.towns = (towns?.towns ?? []).map(([name, kind, x, y, pop]) => ({ name, city: kind === 0, pop, lng: x / towns!.q, lat: y / towns!.q }));
  }

  get nodeCount(): number {
    return this.nx.length;
  }

  get edgeCount(): number {
    return this.ea.length;
  }

  node(i: number): LatLng {
    return { lat: this.ny[i] / this.q, lng: this.nx[i] / this.q };
  }

  private cellOf(lng: number, lat: number): number {
    return Math.floor(lng / CELL_DEG) * 100_000 + Math.floor(lat / CELL_DEG);
  }

  private canLeave(i: number): boolean {
    return this.adjStart[i + 1] > this.adjStart[i];
  }

  /** Up to k road nodes within maxMeters of p, closest first. */
  nearestNodes(p: LatLng, k: number, maxMeters: number, leaving = false): { node: number; meters: number }[] {
    const dLat = maxMeters / 111_000;
    const dLng = dLat / Math.max(0.2, Math.cos((p.lat * Math.PI) / 180));
    const out: { node: number; meters: number }[] = [];
    for (let cx = Math.floor((p.lng - dLng) / CELL_DEG); cx <= Math.floor((p.lng + dLng) / CELL_DEG); cx++) {
      for (let cy = Math.floor((p.lat - dLat) / CELL_DEG); cy <= Math.floor((p.lat + dLat) / CELL_DEG); cy++) {
        for (const i of this.grid.get(cx * 100_000 + cy) ?? []) {
          if (leaving && !this.canLeave(i)) continue;
          const m = haversineMeters(p, this.node(i));
          if (m <= maxMeters) out.push({ node: i, meters: m });
        }
      }
    }
    out.sort((a, b) => a.meters - b.meters);
    return out.slice(0, k);
  }

  private nearestWithin(p: LatLng, leaving: boolean): { node: number; meters: number }[] {
    for (const r of CONNECTOR_RADII_M) {
      const found = this.nearestNodes(p, 8, r, leaving);
      if (found.length) return found;
    }
    return [];
  }

  private other(ei: number, from: number): number {
    return this.ea[ei] === from ? this.eb[ei] : this.ea[ei];
  }

  /** Fastest route between two points (A*). The start and end join the network by short straight stretches. */
  route(start: LatLng, end: LatLng): RoadPath {
    const from = this.nearestWithin(start, true);
    const to = this.nearestWithin(end, false);
    if (!from.length) throw new Error('The start is too far from any highway in the road files.');
    if (!to.length) throw new Error('The destination is too far from any highway in the road files.');
    const connectorCost = (m: number) => (m * CONNECTOR_WIND) / (CONNECTOR_KMH / 3.6);
    const n = this.nodeCount;
    const g = new Float64Array(n).fill(Infinity);
    const prevEdge = new Int32Array(n).fill(-1);
    const prevNode = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const exitCost = new Map<number, number>();
    for (const t of to) exitCost.set(t.node, Math.min(exitCost.get(t.node) ?? Infinity, connectorCost(t.meters)));
    const endX = end.lng, endY = end.lat;
    const h = (i: number) => haversineMeters({ lat: this.ny[i] / this.q, lng: this.nx[i] / this.q }, { lat: endY, lng: endX }) / this.maxSpeedMs;
    const heap = new MinHeap();
    for (const s of from) {
      const c = connectorCost(s.meters);
      if (c < g[s.node]) {
        g[s.node] = c;
        heap.push(s.node, c + h(s.node));
      }
    }
    let best = Infinity;
    let bestNode = -1;
    while (heap.size) {
      const [u, f] = heap.pop();
      if (f >= best) break;
      if (closed[u]) continue;
      closed[u] = 1;
      const ec = exitCost.get(u);
      if (ec !== undefined && g[u] + ec < best) {
        best = g[u] + ec;
        bestNode = u;
      }
      for (let k = this.adjStart[u]; k < this.adjStart[u + 1]; k++) {
        const ei = this.adjEdge[k];
        const v = this.other(ei, u);
        const ng = g[u] + this.cost[ei];
        if (ng < g[v]) {
          g[v] = ng;
          prevEdge[v] = ei;
          prevNode[v] = u;
          heap.push(v, ng + h(v));
        }
      }
    }
    if (bestNode < 0) throw new Error('No road between those places in the road files.');
    const legs: { edge: number; from: number }[] = [];
    for (let v = bestNode; prevEdge[v] >= 0; v = prevNode[v]) legs.push({ edge: prevEdge[v], from: prevNode[v] });
    legs.reverse();
    const firstNode = legs.length ? legs[0].from : bestNode;
    return {
      firstNode,
      lastNode: bestNode,
      legs,
      seconds: best,
      startConnectorM: haversineMeters(start, this.node(firstNode)),
      endConnectorM: haversineMeters(end, this.node(bestNode)),
    };
  }

  /** The shape of an edge, driven from the given end node to the other. */
  edgeCoords(ei: number, fromNode: number): LatLng[] {
    const f = this.files[this.eFile[ei]];
    const e = f.edges[this.eIx[ei]];
    const q = f.q;
    let x = f.nodes[e[0] * 2];
    let y = f.nodes[e[0] * 2 + 1];
    const out: LatLng[] = [{ lng: x / q, lat: y / q }];
    const d = e[9];
    for (let i = 0; i < d.length; i += 2) {
      x += d[i];
      y += d[i + 1];
      out.push({ lng: x / q, lat: y / q });
    }
    out.push({ lng: f.nodes[e[1] * 2] / q, lat: f.nodes[e[1] * 2 + 1] / q });
    return this.ea[ei] === fromNode ? out : out.reverse();
  }

  /** What a road sign would call this edge: name and route number, like OSRM's step names. */
  edgeName(ei: number): string {
    const f = this.files[this.eFile[ei]];
    const e = f.edges[this.eIx[ei]];
    const ref = f.refs[e[3]].split(';')[0].trim();
    return [f.names[e[4]], ref].filter(Boolean).join(' ').trim();
  }

  edgeClass(ei: number): number {
    return this.files[this.eFile[ei]].edges[this.eIx[ei]][2];
  }

  edgeMeters(ei: number): number {
    return this.files[this.eFile[ei]].edges[this.eIx[ei]][5];
  }

  edgeLanes(ei: number): number {
    return this.files[this.eFile[ei]].edges[this.eIx[ei]][8];
  }

  /** Posted speed limit in km/h, or 0 when OpenStreetMap doesn't say. */
  edgeSpeed(ei: number): number {
    return this.files[this.eFile[ei]].edges[this.eIx[ei]][7];
  }

  /** Plans a trip and returns it in the same shape the game gets from OSRM. */
  planTrip(start: LatLng, end: LatLng, startLabel: string, endLabel: string): RawRoute {
    const p = this.route(start, end);
    const coords: LatLng[] = [start];
    const push = (c: LatLng) => {
      const last = coords[coords.length - 1];
      if (Math.abs(last.lat - c.lat) > 1e-6 || Math.abs(last.lng - c.lng) > 1e-6) coords.push(c);
    };
    push(this.node(p.firstNode));
    const steps: RawStep[] = [];
    let meters = (p.startConnectorM + p.endConnectorM) * CONNECTOR_WIND;
    let prevName = '';
    let sinceStep = Infinity;
    const exits: NonNullable<RawRoute['exits']> = [];
    const limits: NonNullable<RawRoute['limits']> = [];
    let lastKmh = -1;
    for (const leg of p.legs) {
      // Exits passed on a motorway: the node where this leg starts.
      const exit = this.edgeClass(leg.edge) === 0 ? this.exitAt.get(leg.from) : undefined;
      if (exit) exits.push({ location: this.node(leg.from), ref: exit[0], name: exit[1] });
      const kmh = this.edgeSpeed(leg.edge);
      if (kmh !== lastKmh && (kmh > 0 || lastKmh > 0)) limits.push({ location: this.node(leg.from), kmh });
      lastKmh = kmh;
      const shape = this.edgeCoords(leg.edge, leg.from);
      const name = this.edgeName(leg.edge);
      // Ramps usually have no name; the turn-off is named after the road they lead to.
      if (name && name !== prevName && coords.length >= 2) {
        const step: RawStep = {
          location: shape[0],
          name,
          type: 'turn',
          modifier: turnModifier(coords[coords.length - 2], coords[coords.length - 1], shape[1]),
          ...(this.edgeClass(leg.edge) === 0 ? { motorway: true } : {}),
        };
        if (sinceStep < MIN_STEP_GAP_M && steps.length && steps[steps.length - 1].type === 'turn') steps[steps.length - 1] = step;
        else steps.push(step);
        sinceStep = 0;
      }
      if (name) prevName = name;
      for (let i = 1; i < shape.length; i++) push(shape[i]);
      const m = this.edgeMeters(leg.edge);
      meters += m;
      sinceStep += m;
    }
    push(end);
    if (coords.length < 2) throw new Error('Start and end are the same place');
    steps.push(...this.townsAlong(coords, start, end));
    return {
      source: 'osm',
      startLabel,
      endLabel,
      coords,
      realMeters: meters,
      realSeconds: p.seconds,
      steps,
      ...(exits.length ? { exits } : {}),
      ...(limits.length ? { limits } : {}),
      attribution: `Route ${this.attribution}, planned on this device`,
    };
  }

  /** Cities and towns beside the route become named turn-offs, on the side of the road they are on. */
  townsAlong(coords: LatLng[], start: LatLng, end: LatLng, maxMeters = 8_000): RawStep[] {
    const big = this.towns.filter((t) => t.city || t.pop >= 5_000);
    return nearRoute(coords, big, maxMeters)
      .filter((c) => haversineMeters(c.item, start) > 15_000 && haversineMeters(c.item, end) > 15_000)
      .map((c) => ({ location: c.at, name: c.item.name, type: 'town', modifier: c.side }));
  }

}

export interface RoadPath {
  firstNode: number;
  lastNode: number;
  legs: { edge: number; from: number }[];
  seconds: number;
  startConnectorM: number;
  endConnectorM: number;
}

// ------------------------------------------------------------------ loading

/** The tiles a trip needs: the 3 × 3 squares around the start and around the end. */
export function tilesFor(index: RoadIndex, points: LatLng[]): [number, number][] {
  const have = new Set(index.tiles.map(([x, y]) => `${x}_${y}`));
  const want = new Map<string, [number, number]>();
  for (const p of points) {
    const tx = Math.floor(p.lng / index.tileDeg);
    const ty = Math.floor(p.lat / index.tileDeg);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const k = `${tx + dx}_${ty + dy}`;
        if (have.has(k)) want.set(k, [tx + dx, ty + dy]);
      }
  }
  return [...want.values()];
}

const roadsUrl = (path: string) => new URL(`data/osm/${path}`, document.baseURI).href;

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Road file missing (${r.status}): ${url.split('/').pop()}`);
  return (await r.json()) as T;
}

let indexLoad: Promise<RoadIndex> | null = null;
let backboneLoad: Promise<{ built: string; file: RoadFile; towns: TownsFile | null }> | null = null;
const tileLoads = new Map<string, Promise<RoadFile>>();

/** The road index. Fetched fresh when online (the service worker falls back to its copy offline). */
export function loadRoadIndex(): Promise<RoadIndex> {
  if (!indexLoad) {
    indexLoad = getJson<RoadIndex>(roadsUrl('index.json')).catch((e) => {
      indexLoad = null;
      throw e;
    });
  }
  return indexLoad;
}

/**
 * Loads the backbone and the tiles around the given points and builds a road
 * network from them. File URLs carry the build date, so the service worker
 * keeps one copy of each build and a new build replaces it cleanly.
 */
export async function loadRoadNet(points: LatLng[], progress: (message: string) => void = () => {}): Promise<RoadNet> {
  const index = await loadRoadIndex();
  const v = encodeURIComponent(index.built);
  if (!backboneLoad || (await backboneLoad.catch(() => null))?.built !== index.built) {
    progress(`Loading the highway map (${(index.backbone.gzipBytes / 1e6).toFixed(0)} MB the first time)…`);
    tileLoads.clear();
    backboneLoad = Promise.all([
      getJson<RoadFile>(roadsUrl(`${index.backbone.file}?v=${v}`)),
      getJson<TownsFile>(roadsUrl(`${index.towns.file}?v=${v}`)).catch(() => null),
    ]).then(([file, towns]) => ({ built: index.built, file, towns }));
    backboneLoad.catch(() => (backboneLoad = null));
  }
  const { file: backbone, towns } = await backboneLoad;
  const tiles = await Promise.all(
    tilesFor(index, points).map(([x, y]) => {
      const name = `tiles/${x}_${y}.json`;
      let load = tileLoads.get(name);
      if (!load) {
        load = getJson<RoadFile>(roadsUrl(`${name}?v=${v}`));
        load.catch(() => tileLoads.delete(name));
        tileLoads.set(name, load);
      }
      return load;
    }),
  );
  return new RoadNet([backbone, ...tiles], towns);
}
