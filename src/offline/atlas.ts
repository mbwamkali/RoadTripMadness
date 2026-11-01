import { haversineMeters, type LatLng } from '../geo/geo';
import type { Place } from '../geo/geocode';
import type { MapFeature } from '../game/landmarks';
import type { RawRoute, RawStep } from '../geo/route';

/**
 * The offline road atlas: a compact network of US interstates and major
 * highways, with cities and points of interest, built from Natural Earth by
 * scripts/build-atlas.mjs. It lets the game plan city-to-city trips on the
 * device with no connection, a bit like picking a route on a road atlas.
 */

/** The JSON shape written by scripts/build-atlas.mjs. Coordinates are integers in 1/q degrees. */
export interface AtlasFile {
  version: 1;
  attribution: string;
  q: number;
  classes: string[];
  refs: string[];
  /** Flat [lng, lat, lng, lat, ...]. */
  nodes: number[];
  /** [nodeA, nodeB, class, refIndex, lengthMeters, delta-encoded inner shape points from A]. */
  edges: [number, number, number, number, number, number[]][];
  /** [name, state, lng, lat, population], biggest first. */
  cities: [string, string, number, number, number][];
  poiKinds: string[];
  /** [name, kindIndex, lng, lat]. */
  pois: [string, number, number, number][];
}

export interface AtlasCity extends LatLng {
  name: string;
  state: string;
  pop: number;
}

export interface AtlasPoi extends LatLng {
  name: string;
  kind: 'park' | 'peak' | 'river';
}

/** Rough cruising speed by road class, in km/h: interstate, major, secondary, other. */
const SPEEDS_KMH = [105, 88, 75, 60];
/** Off-network stretch from the start or end to the nearest highway: slower, and roads wind. */
const CONNECTOR_KMH = 50;
const CONNECTOR_WIND = 1.25;
/** How far from the network a start or end may be. */
export const MAX_CONNECTOR_M = 90_000;

export class Atlas {
  readonly attribution: string;
  readonly cities: AtlasCity[];
  readonly pois: AtlasPoi[];
  private readonly f: AtlasFile;
  private readonly lng: Float64Array;
  private readonly lat: Float64Array;
  /** CSR adjacency: edges touching node n are adjEdge[adjStart[n] .. adjStart[n+1]). */
  private readonly adjStart: Int32Array;
  private readonly adjEdge: Int32Array;
  private readonly cost: Float64Array;

  constructor(file: AtlasFile) {
    if (file.version !== 1) throw new Error('Unsupported atlas version');
    this.f = file;
    this.attribution = file.attribution;
    const n = file.nodes.length / 2;
    this.lng = new Float64Array(n);
    this.lat = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.lng[i] = file.nodes[i * 2] / file.q;
      this.lat[i] = file.nodes[i * 2 + 1] / file.q;
    }
    const deg = new Int32Array(n + 1);
    for (const e of file.edges) {
      deg[e[0] + 1]++;
      deg[e[1] + 1]++;
    }
    for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
    this.adjStart = deg.slice();
    this.adjEdge = new Int32Array(deg[n]);
    const fill = deg.slice();
    this.cost = new Float64Array(file.edges.length);
    file.edges.forEach((e, i) => {
      this.adjEdge[fill[e[0]]++] = i;
      this.adjEdge[fill[e[1]]++] = i;
      this.cost[i] = e[4] / ((SPEEDS_KMH[e[2]] ?? 60) / 3.6);
    });
    this.cities = file.cities.map(([name, state, x, y, pop]) => ({ name, state, pop, lng: x / file.q, lat: y / file.q }));
    this.pois = file.pois.map(([name, k, x, y]) => ({ name, kind: file.poiKinds[k] as AtlasPoi['kind'], lng: x / file.q, lat: y / file.q }));
  }

  get nodeCount(): number {
    return this.lng.length;
  }

  node(i: number): LatLng {
    return { lat: this.lat[i], lng: this.lng[i] };
  }

  /** The shape of an edge, from the given end node to the other. */
  edgeCoords(ei: number, fromNode: number): LatLng[] {
    const [a, b, , , , d] = this.f.edges[ei];
    const out: LatLng[] = [this.node(a)];
    let x = this.f.nodes[a * 2];
    let y = this.f.nodes[a * 2 + 1];
    for (let i = 0; i < d.length; i += 2) {
      x += d[i];
      y += d[i + 1];
      out.push({ lng: x / this.f.q, lat: y / this.f.q });
    }
    out.push(this.node(b));
    return fromNode === a ? out : out.reverse();
  }

  edgeRef(ei: number): string {
    return this.f.refs[this.f.edges[ei][3]] ?? '';
  }

  edgeMeters(ei: number): number {
    return this.f.edges[ei][4];
  }

  /** Nodes within maxMeters of p, closest first. */
  nearestNodes(p: LatLng, k: number, maxMeters = MAX_CONNECTOR_M): { node: number; meters: number }[] {
    // Cheap degree box first, exact distance after.
    const dLat = maxMeters / 111_000;
    const dLng = dLat / Math.max(0.2, Math.cos((p.lat * Math.PI) / 180));
    const found: { node: number; meters: number }[] = [];
    for (let i = 0; i < this.lng.length; i++) {
      if (Math.abs(this.lat[i] - p.lat) > dLat || Math.abs(this.lng[i] - p.lng) > dLng) continue;
      const m = haversineMeters(p, this.node(i));
      if (m <= maxMeters) found.push({ node: i, meters: m });
    }
    found.sort((a, b) => a.meters - b.meters);
    return found.slice(0, k);
  }

  /**
   * Fastest route between two points over the atlas network (A*). The start
   * and end connect to a few nearby highway nodes by straight stretches.
   */
  route(start: LatLng, end: LatLng): AtlasPath {
    const from = this.nearestNodes(start, 6);
    const to = this.nearestNodes(end, 6);
    if (!from.length) throw new Error('The start is too far from any highway in the offline atlas.');
    if (!to.length) throw new Error('The destination is too far from any highway in the offline atlas.');
    const connectorCost = (m: number) => (m * CONNECTOR_WIND) / (CONNECTOR_KMH / 3.6);
    const maxSpeed = SPEEDS_KMH[0] / 3.6;
    const n = this.nodeCount;
    const g = new Float64Array(n).fill(Infinity);
    const prevEdge = new Int32Array(n).fill(-1);
    const prevNode = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const exitCost = new Float64Array(n).fill(Infinity);
    for (const t of to) exitCost[t.node] = Math.min(exitCost[t.node], connectorCost(t.meters));
    const heap = new MinHeap();
    const h = (i: number) => haversineMeters(this.node(i), end) / maxSpeed;
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
      if (exitCost[u] < Infinity && g[u] + exitCost[u] < best) {
        best = g[u] + exitCost[u];
        bestNode = u;
      }
      for (let k = this.adjStart[u]; k < this.adjStart[u + 1]; k++) {
        const ei = this.adjEdge[k];
        const e = this.f.edges[ei];
        const v = e[0] === u ? e[1] : e[0];
        const ng = g[u] + this.cost[ei];
        if (ng < g[v]) {
          g[v] = ng;
          prevEdge[v] = ei;
          prevNode[v] = u;
          heap.push(v, ng + h(v));
        }
      }
    }
    if (bestNode < 0) throw new Error('No road between those places in the offline atlas.');
    const legs: { edge: number; from: number }[] = [];
    for (let v = bestNode; prevEdge[v] >= 0; v = prevNode[v]) legs.push({ edge: prevEdge[v], from: prevNode[v] });
    legs.reverse();
    const firstNode = legs.length ? legs[0].from : bestNode;
    return {
      start,
      end,
      firstNode,
      lastNode: bestNode,
      legs,
      seconds: best,
      startConnectorM: haversineMeters(start, this.node(firstNode)),
      endConnectorM: haversineMeters(end, this.node(bestNode)),
    };
  }

  /** Plans a trip and returns it as the game's raw route. */
  planTrip(start: LatLng, end: LatLng, startLabel: string, endLabel: string): RawRoute {
    const p = this.route(start, end);
    const coords: LatLng[] = [start];
    const push = (c: LatLng) => {
      const last = coords[coords.length - 1];
      if (Math.abs(last.lat - c.lat) > 1e-6 || Math.abs(last.lng - c.lng) > 1e-6) coords.push(c);
    };
    push(this.node(p.firstNode));
    const steps: RawStep[] = [];
    let meters = p.startConnectorM * CONNECTOR_WIND + p.endConnectorM * CONNECTOR_WIND;
    let prevRef = '';
    for (const leg of p.legs) {
      const shape = this.edgeCoords(leg.edge, leg.from);
      const ref = this.edgeRef(leg.edge);
      if (ref && ref !== prevRef && coords.length >= 2) {
        const turn = turnModifier(coords[coords.length - 2], coords[coords.length - 1], shape[1]);
        steps.push({ location: shape[0], name: ref, type: 'turn', modifier: turn });
      }
      if (ref) prevRef = ref;
      for (let i = 1; i < shape.length; i++) push(shape[i]);
      meters += this.edgeMeters(leg.edge);
    }
    push(end);
    if (coords.length < 2) throw new Error('Start and end are the same place');
    steps.push(...this.townsAlong(coords, start, end));
    return {
      features: this.featuresAlong(coords),
      source: 'offline',
      startLabel,
      endLabel,
      coords,
      realMeters: meters,
      realSeconds: p.seconds,
      steps,
      attribution: `${this.attribution}. Planned on this device.`,
    };
  }

  /** Cities beside the route become named turn-offs, on the side of the road they are on. */
  townsAlong(coords: LatLng[], start: LatLng, end: LatLng, maxMeters = 12_000): RawStep[] {
    const near = nearRoute(coords, this.cities, maxMeters);
    return near
      .filter((c) => haversineMeters(c.item, start) > 15_000 && haversineMeters(c.item, end) > 15_000)
      .map((c) => ({ location: c.at, name: c.item.name, type: 'town', modifier: c.side }));
  }

  /**
   * Landmarks from the atlas for a route: towns, parks, peaks and river
   * crossings, in the same shape as the OpenStreetMap landmark fetch. Used
   * when that fetch can't run (offline) or finds nothing.
   */
  featuresAlong(coords: LatLng[]): MapFeature[] {
    const out: MapFeature[] = [];
    for (const c of nearRoute(coords, this.cities, 4_000)) out.push({ kind: 'citysign', name: c.item.name, point: c.item, ...(c.item.pop >= 50_000 ? { big: true } : {}) });
    const parks = this.pois.filter((p) => p.kind === 'park');
    const peaks = this.pois.filter((p) => p.kind === 'peak');
    const rivers = this.pois.filter((p) => p.kind === 'river');
    for (const c of nearRoute(coords, parks, 20_000)) out.push({ kind: 'attraction', name: c.item.name, point: c.item });
    for (const c of nearRoute(coords, peaks, 60_000)) out.push({ kind: 'peak', name: c.item.name, point: c.item });
    // River crossings are points in the atlas; draw each as a short line across the road.
    for (const c of nearRoute(coords, rivers, 2_500)) {
      const k = Math.cos((c.at.lat * Math.PI) / 180);
      const len = Math.hypot(c.dir.x, c.dir.y) || 1;
      const px = -c.dir.y / len;
      const py = c.dir.x / len;
      const span = 0.03; // degrees, about 3 km each way
      out.push({
        kind: 'river',
        name: c.item.name,
        line: [
          { lat: c.at.lat - py * span, lng: c.at.lng - (px * span) / k },
          { lat: c.at.lat + py * span, lng: c.at.lng + (px * span) / k },
        ],
      });
    }
    return out;
  }

  /** Offline place search over the atlas cities and parks. */
  search(query: string, limit = 6): Place[] {
    const raw = query.trim().toLowerCase();
    if (!raw) return [];
    const [namePart, statePart] = raw.split(',').map((s) => s.trim());
    const score = (name: string): number => {
      const n = name.toLowerCase();
      if (n === namePart) return 3;
      if (n.startsWith(namePart)) return 2;
      if (n.includes(namePart)) return 1;
      return 0;
    };
    const out: { place: Place; s: number; pop: number }[] = [];
    for (const c of this.cities) {
      const s = score(c.name);
      if (!s) continue;
      if (statePart && !c.state.toLowerCase().startsWith(statePart)) continue;
      out.push({ place: { lat: c.lat, lng: c.lng, label: `${c.name}, ${c.state}` }, s: s + 0.5, pop: c.pop });
    }
    for (const p of this.pois) {
      if (p.kind !== 'park') continue;
      const s = score(p.name);
      if (s) out.push({ place: { lat: p.lat, lng: p.lng, label: p.name }, s, pop: 0 });
    }
    out.sort((a, b) => b.s - a.s || b.pop - a.pop);
    return out.slice(0, limit).map((o) => o.place);
  }
}

export interface AtlasPath {
  start: LatLng;
  end: LatLng;
  firstNode: number;
  lastNode: number;
  legs: { edge: number; from: number }[];
  seconds: number;
  startConnectorM: number;
  endConnectorM: number;
}

/** Left or right turn from heading a→b onto b→c. */
export function turnModifier(a: LatLng, b: LatLng, c: LatLng): string {
  const k = Math.cos((b.lat * Math.PI) / 180);
  const h1 = Math.atan2(b.lat - a.lat, (b.lng - a.lng) * k);
  const h2 = Math.atan2(c.lat - b.lat, (c.lng - b.lng) * k);
  let d = ((h2 - h1) * 180) / Math.PI;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  if (Math.abs(d) < 20) return d > 0 ? 'slight left' : 'slight right';
  return d > 0 ? 'left' : 'right';
}

/** Items within maxMeters of a polyline, with the closest point and which side of the road they are on. */
export function nearRoute<T extends LatLng>(
  coords: LatLng[],
  items: T[],
  maxMeters: number,
): { item: T; at: LatLng; side: 'left' | 'right'; dir: { x: number; y: number } }[] {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const c of coords) {
    minLat = Math.min(minLat, c.lat);
    maxLat = Math.max(maxLat, c.lat);
    minLng = Math.min(minLng, c.lng);
    maxLng = Math.max(maxLng, c.lng);
  }
  const pad = maxMeters / 80_000;
  const out: { item: T; at: LatLng; side: 'left' | 'right'; dir: { x: number; y: number } }[] = [];
  for (const it of items) {
    if (it.lat < minLat - pad || it.lat > maxLat + pad || it.lng < minLng - pad || it.lng > maxLng + pad) continue;
    const k = Math.cos((it.lat * Math.PI) / 180);
    let best = Infinity;
    let at: LatLng = coords[0];
    let cross = 0;
    let dir = { x: 1, y: 0 };
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i];
      const b = coords[i + 1];
      // Skip segments that are clearly too far away.
      if (Math.min(a.lat, b.lat) - pad > it.lat || Math.max(a.lat, b.lat) + pad < it.lat) continue;
      const ax = a.lng * k, ay = a.lat, bx = b.lng * k, by = b.lat, px = it.lng * k, py = it.lat;
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1e-18)));
      const cx = ax + dx * t, cy = ay + dy * t;
      const d2 = (px - cx) ** 2 + (py - cy) ** 2;
      if (d2 < best) {
        best = d2;
        at = { lng: cx / k, lat: cy };
        cross = dx * (py - ay) - dy * (px - ax);
        dir = { x: dx, y: dy };
      }
    }
    if (haversineMeters(at, it) <= maxMeters) out.push({ item: it, at, side: cross > 0 ? 'left' : 'right', dir });
  }
  return out;
}

export class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(id: number, key: number): void {
    const ids = this.ids, keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): [number, number] {
    const ids = this.ids, keys = this.keys;
    const top: [number, number] = [ids[0], keys[0]];
    const id = ids.pop()!;
    const key = keys.pop()!;
    if (ids.length) {
      let i = 0;
      const n = ids.length;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= key) break;
        ids[i] = ids[c];
        keys[i] = keys[c];
        i = c;
      }
      ids[i] = id;
      keys[i] = key;
    }
    return top;
  }
}

// ------------------------------------------------------------------ loading

let loading: Promise<Atlas> | null = null;

/** Loads the bundled atlas once. The service worker keeps it cached for offline use. */
export function loadAtlas(): Promise<Atlas> {
  if (!loading) {
    const url = new URL('data/atlas-us.json', document.baseURI).href;
    loading = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Offline atlas missing (${r.status}).`);
        return r.json() as Promise<AtlasFile>;
      })
      .then((f) => new Atlas(f))
      .catch((e) => {
        loading = null;
        throw e;
      });
  }
  return loading;
}
