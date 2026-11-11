import { haversineMeters, type LatLng } from '../geo/geo';
import type { FeatureFile } from './features';
import type { RawCrossing } from './roadNet';

/**
 * Step 2 of "Overpasses and cross streets" (decisions.md): the monthly road
 * build bakes where main streets (OSM secondary) cross the highways, and which
 * highway is on top where two cross (scripts/osm_features.py). This adds the
 * streets that lie on a trip's own road to the crossings the router found
 * (offline/roadNet.ts crossingsAlong), and turns a bridge round where the
 * trip's road is the one on top.
 */

/** A baked point counts as on the trip's road this close to its line (metres)... */
export const ON_ROUTE_M = 30;
/** ...and only when its highway runs the same way as the trip there (|sine| below this). */
const SAME_WAY_SIN = 0.35;
/** A baked street this close to a crossing the router already found is the same one. */
const SAME_PLACE_M = 120;
/** A baked bridge this close to a router crossing tells which road is on top. */
const BRIDGE_M = 40;

const CELL = 0.005;
const key = (cx: number, cy: number) => (cx + 50_000) * 100_000 + (cy + 50_000);

/** Nearest stretch of the route to a point: distance and the route's planar direction (radians) there. */
function routeIndex(coords: LatLng[]) {
  const cells = new Map<number, number[]>();
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i], b = coords[i + 1];
    for (let cx = Math.floor(Math.min(a.lng, b.lng) / CELL) - 1; cx <= Math.floor(Math.max(a.lng, b.lng) / CELL) + 1; cx++) {
      for (let cy = Math.floor(Math.min(a.lat, b.lat) / CELL) - 1; cy <= Math.floor(Math.max(a.lat, b.lat) / CELL) + 1; cy++) {
        const k = key(cx, cy);
        let list = cells.get(k);
        if (!list) cells.set(k, (list = []));
        list.push(i);
      }
    }
  }
  return (p: LatLng): { meters: number; dir: number } | null => {
    const k = Math.cos((p.lat * Math.PI) / 180);
    let best: { meters: number; dir: number } | null = null;
    for (const i of cells.get(key(Math.floor(p.lng / CELL), Math.floor(p.lat / CELL))) ?? []) {
      const a = coords[i], b = coords[i + 1];
      const ax = (a.lng - p.lng) * k, ay = a.lat - p.lat;
      const dx = (b.lng - a.lng) * k, dy = b.lat - a.lat;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1e-18)));
      const m = Math.hypot(ax + dx * t, ay + dy * t) * 111_000;
      if (!best || m < best.meters) best = { meters: m, dir: Math.atan2(dy, dx) };
    }
    return best;
  };
}

const sameWay = (a: number, b: number) => Math.abs(Math.sin(a - b)) < SAME_WAY_SIN;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** A point `m` metres from p in a planar direction (radians, east 0, counter-clockwise). */
function offset(p: LatLng, dir: number, m: number): LatLng {
  return { lat: p.lat + (Math.sin(dir) * m) / 111_000, lng: p.lng + (Math.cos(dir) * m) / (111_000 * Math.cos((p.lat * Math.PI) / 180)) };
}

export function applyBakedCrossings(found: RawCrossing[], files: FeatureFile[], coords: LatLng[]): RawCrossing[] {
  if (coords.length < 2) return found;
  const near = routeIndex(coords);
  // Which road is on top where the router found a bridge.
  const bridges: { at: LatLng; deg: number }[] = [];
  for (const f of files) for (const [x, y, deg] of f.bridges ?? []) bridges.push({ at: { lng: x / f.q, lat: y / f.q }, deg });
  const out = found.map((c) => {
    if (c.kind !== 'over') return c;
    const here = near(c.location);
    if (!here) return c;
    const b = bridges.find((br) => haversineMeters(br.at, c.location) < BRIDGE_M);
    return b && sameWay(rad(b.deg), here.dir) ? { ...c, kind: 'under' as const } : c;
  });
  // Main streets on the trip's own road.
  for (const f of files) {
    for (const [x, y, mainDeg, crossDeg, kind, both, lanes, name] of f.crossings ?? []) {
      const at = { lng: x / f.q, lat: y / f.q };
      const here = near(at);
      if (!here || here.meters > ON_ROUTE_M || !sameWay(rad(mainDeg), here.dir)) continue;
      if (out.some((c) => haversineMeters(c.location, at) < SAME_PLACE_M)) continue;
      out.push({
        location: at,
        toward: offset(at, rad(crossDeg), 50),
        name,
        kind: kind === 1 ? 'over' : kind === 2 ? 'under' : 'flat',
        cls: 3,
        lanes,
        both: both === 1,
      });
    }
  }
  return out;
}
