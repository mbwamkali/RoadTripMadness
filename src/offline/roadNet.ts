import { haversineMeters, type LatLng } from '../geo/geo';
import type { RawRoute, RawStep } from '../geo/route';
import type { OsmElement } from '../geo/overpass';
import { joinLocalStreets } from '../geo/localStreets';
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
  kind: 'backbone' | 'tile' | 'local';
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

/**
 * Cruising speed when OpenStreetMap gives no speed limit, by class: motorway,
 * trunk, primary, and for local streets (src/geo/localStreets.ts) secondary,
 * tertiary and minor streets.
 */
const DEFAULT_KMH = [105, 88, 72, 64, 56, 40];
/** Traffic averages about this share of the speed limit (OSRM's trip times agreed within about 5% when compared). */
const PACE = 0.8;
/** Off-network stretch from the start or end to the nearest road: slower, and roads wind. */
const CONNECTOR_KMH = 40;
const CONNECTOR_WIND = 1.3;
/** Search radius for the nearest roads, tried in order. */
const CONNECTOR_RADII_M = [15_000, 40_000, 90_000];
/** When the nearest junction is further than this, the start or end also looks for a closer point along a road. */
const SNAP_TO_EDGE_M = 300;
/** Grid cell for the nearest-node lookup, in degrees. */
const CELL_DEG = 0.1;
/** Turn-offs closer together than this are merged into the later one. */
const MIN_STEP_GAP_M = 250;

export const nodeKey = (x: number, y: number) => (x + 2e7) * 4e7 + (y + 2e7);

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
  private readonly oneway: Uint8Array;
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
    const oneway = (this.oneway = new Uint8Array(edgeCount));
    let maxKmh = DEFAULT_KMH[0];
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

  /**
   * The closest points along roads to p, for long roads with no junction
   * nearby (a start in Big Sur is 30 km from the nearest one). An edge can
   * only come within maxMeters of p if its start node is within maxMeters
   * plus its length, which rules out almost every edge cheaply.
   */
  nearestOnEdges(p: LatLng, maxMeters: number, k = 4): EdgeSnap[] {
    const kx = 111_320 * Math.cos((p.lat * Math.PI) / 180);
    const ky = 110_540;
    const found: EdgeSnap[] = [];
    for (let ei = 0; ei < this.ea.length; ei++) {
      const a = this.ea[ei];
      const rough = Math.hypot((this.nx[a] / this.q - p.lng) * kx, (this.ny[a] / this.q - p.lat) * ky);
      if (rough - this.edgeMeters(ei) * 1.05 > maxMeters) continue;
      const shape = this.edgeCoords(ei, a);
      let best = Infinity;
      let bestI = 0;
      let bestT = 0;
      for (let i = 0; i < shape.length - 1; i++) {
        const ax = (shape[i].lng - p.lng) * kx, ay = (shape[i].lat - p.lat) * ky;
        const dx = (shape[i + 1].lng - shape[i].lng) * kx, dy = (shape[i + 1].lat - shape[i].lat) * ky;
        const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(ax + dx * t, ay + dy * t);
        if (d < best) [best, bestI, bestT] = [d, i, t];
      }
      if (best > maxMeters) continue;
      const A = shape[bestI], B = shape[bestI + 1];
      const at = { lat: A.lat + (B.lat - A.lat) * bestT, lng: A.lng + (B.lng - A.lng) * bestT };
      const toA = [...shape.slice(0, bestI + 1), at];
      const toB = [at, ...shape.slice(bestI + 1)];
      const share = lineMeters(toA) / (lineMeters(toA) + lineMeters(toB) || 1);
      found.push({ edge: ei, at, meters: best, toA, toB, share });
    }
    found.sort((x, y) => x.meters - y.meters);
    return found.slice(0, k);
  }

  /** Fastest route between two points (A*). The start and end join the network by short straight stretches. */
  route(start: LatLng, end: LatLng): RoadPath {
    const from = this.nearestWithin(start, true);
    const to = this.nearestWithin(end, false);
    const maxR = CONNECTOR_RADII_M[CONNECTOR_RADII_M.length - 1];
    const fromEdges = (from[0]?.meters ?? Infinity) > SNAP_TO_EDGE_M ? this.nearestOnEdges(start, Math.min(from[0]?.meters ?? maxR, maxR)) : [];
    const toEdges = (to[0]?.meters ?? Infinity) > SNAP_TO_EDGE_M ? this.nearestOnEdges(end, Math.min(to[0]?.meters ?? maxR, maxR)) : [];
    if (!from.length && !fromEdges.length) throw new Error('The start is too far from any highway in the road files.');
    if (!to.length && !toEdges.length) throw new Error('The destination is too far from any highway in the road files.');
    const connectorCost = (m: number) => (m * CONNECTOR_WIND) / (CONNECTOR_KMH / 3.6);
    const n = this.nodeCount;
    const g = new Float64Array(n).fill(Infinity);
    const prevEdge = new Int32Array(n).fill(-1);
    const prevNode = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    /** How the trip reaches the network: a node, or a point along a road and on to a node. */
    const seedShape = new Map<number, RoadPart>();
    const exitCost = new Map<number, number>();
    const exitShape = new Map<number, RoadPart>();
    const addExit = (node: number, c: number, part: RoadPart | null) => {
      if (c >= (exitCost.get(node) ?? Infinity)) return;
      exitCost.set(node, c);
      if (part) exitShape.set(node, part);
      else exitShape.delete(node);
    };
    for (const t of to) addExit(t.node, connectorCost(t.meters), null);
    for (const sn of toEdges) {
      const c = connectorCost(sn.meters);
      // Drive from the edge's start up to the point, or (two-way roads) back from its end.
      addExit(this.ea[sn.edge], c + this.cost[sn.edge] * sn.share, { edge: sn.edge, shape: sn.toA });
      if (!this.oneway[sn.edge]) addExit(this.eb[sn.edge], c + this.cost[sn.edge] * (1 - sn.share), { edge: sn.edge, shape: sn.toB.slice().reverse() });
    }
    const endX = end.lng, endY = end.lat;
    const h = (i: number) => haversineMeters({ lat: this.ny[i] / this.q, lng: this.nx[i] / this.q }, { lat: endY, lng: endX }) / this.maxSpeedMs;
    const heap = new MinHeap();
    const seed = (node: number, c: number, part: RoadPart | null) => {
      if (c >= g[node]) return;
      g[node] = c;
      if (part) seedShape.set(node, part);
      else seedShape.delete(node);
      heap.push(node, c + h(node));
    };
    for (const sn of from) seed(sn.node, connectorCost(sn.meters), null);
    for (const sn of fromEdges) {
      const c = connectorCost(sn.meters);
      seed(this.eb[sn.edge], c + this.cost[sn.edge] * (1 - sn.share), { edge: sn.edge, shape: sn.toB });
      if (!this.oneway[sn.edge]) seed(this.ea[sn.edge], c + this.cost[sn.edge] * sn.share, { edge: sn.edge, shape: sn.toA.slice().reverse() });
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
    const startPart = seedShape.get(firstNode) ?? null;
    const endPart = exitShape.get(bestNode) ?? null;
    return {
      firstNode,
      lastNode: bestNode,
      legs,
      seconds: best,
      startPart,
      endPart,
      startConnectorM: haversineMeters(start, startPart ? startPart.shape[0] : this.node(firstNode)),
      endConnectorM: haversineMeters(end, endPart ? endPart.shape[endPart.shape.length - 1] : this.node(bestNode)),
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

  /** What a road sign would call this edge: name and route number. */
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

  /** Plans a trip and returns it as the game's raw route. */
  planTrip(start: LatLng, end: LatLng, startLabel: string, endLabel: string): RawRoute {
    const p = this.route(start, end);
    const coords: LatLng[] = [start];
    const push = (c: LatLng) => {
      const last = coords[coords.length - 1];
      if (Math.abs(last.lat - c.lat) > 1e-6 || Math.abs(last.lng - c.lng) > 1e-6) coords.push(c);
    };
    const steps: RawStep[] = [];
    let meters = (p.startConnectorM + p.endConnectorM) * CONNECTOR_WIND;
    let prevName = '';
    let sinceStep = Infinity;
    const exits: NonNullable<RawRoute['exits']> = [];
    const limits: NonNullable<RawRoute['limits']> = [];
    let lastKmh = -1;
    // The trip in pieces: maybe part of a road to the first junction, whole roads, maybe part of one at the end.
    const pieces: { edge: number; from: number; shape: LatLng[]; meters: number }[] = [];
    if (p.startPart) pieces.push({ edge: p.startPart.edge, from: -1, shape: p.startPart.shape, meters: lineMeters(p.startPart.shape) });
    else push(this.node(p.firstNode));
    for (const leg of p.legs) pieces.push({ edge: leg.edge, from: leg.from, shape: this.edgeCoords(leg.edge, leg.from), meters: this.edgeMeters(leg.edge) });
    if (p.endPart) pieces.push({ edge: p.endPart.edge, from: -1, shape: p.endPart.shape, meters: lineMeters(p.endPart.shape) });
    for (const leg of pieces) {
      // Exits passed on a motorway: the node where this leg starts.
      const exit = leg.from >= 0 && this.edgeClass(leg.edge) === 0 ? this.exitAt.get(leg.from) : undefined;
      if (exit) exits.push({ location: this.node(leg.from), ref: exit[0], name: exit[1] });
      const kmh = this.edgeSpeed(leg.edge);
      if (kmh !== lastKmh && (kmh > 0 || lastKmh > 0)) limits.push({ location: leg.shape[0], kmh });
      lastKmh = kmh;
      const shape = leg.shape;
      if (coords.length < 2) push(shape[0]);
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
      const m = leg.meters;
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

/** Part of one road, driven along `shape`: from a point on it to a junction, or from a junction to a point. */
export interface RoadPart {
  edge: number;
  shape: LatLng[];
}

/** The closest point on an edge to some place. toA runs from the edge's start node to the point, toB on to its end node. */
export interface EdgeSnap {
  edge: number;
  at: LatLng;
  meters: number;
  toA: LatLng[];
  toB: LatLng[];
  /** How far along the edge the point is, 0 to 1. */
  share: number;
}

function lineMeters(line: LatLng[]): number {
  let m = 0;
  for (let i = 1; i < line.length; i++) m += haversineMeters(line[i - 1], line[i]);
  return m;
}

export interface RoadPath {
  firstNode: number;
  lastNode: number;
  legs: { edge: number; from: number }[];
  seconds: number;
  startPart: RoadPart | null;
  endPart: RoadPart | null;
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
 *
 * `streets` is a running lookup of the local streets around the points
 * (src/geo/localStreets.ts). When it answers, its streets are joined on;
 * when it fails, the network is just the highways.
 */
export async function loadRoadNet(
  points: LatLng[],
  progress: (message: string) => void = () => {},
  streets: Promise<{ elements?: OsmElement[] } | null> | null = null,
): Promise<RoadNet & { localStreets: boolean }> {
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
  const files = [backbone, ...tiles];
  let local: RoadFile | null = null;
  if (streets) {
    progress('Finding the local streets…');
    const json = await streets.catch(() => null);
    local = json ? joinLocalStreets(json, files) : null;
  }
  return Object.assign(new RoadNet(local ? [...files, local] : files, towns), { localStreets: !!local });
}
