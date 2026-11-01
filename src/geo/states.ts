import type { LatLng, Path } from './geo';
import { makeProjection } from './geo';
import type { RouteData } from './route';

/**
 * US state outlines (simplified Natural Earth, public domain) for state-line
 * signs and interstate exit numbers. The file is static and cached for
 * offline play; everything here works on the device.
 */
export interface StatesFile {
  q: number;
  /** [name, postal code, outer rings as flat [lng, lat, ...] integers]. */
  states: [string, string, number[][]][];
}

export interface UsState {
  name: string;
  code: string;
}

interface Ring {
  pts: Float64Array;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface Entry extends UsState {
  rings: Ring[];
}

export class StateMap {
  private entries: Entry[];

  constructor(file: StatesFile) {
    this.entries = file.states.map(([name, code, rings]) => ({
      name,
      code,
      rings: rings.map((flat) => {
        const pts = Float64Array.from(flat, (v) => v / file.q);
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < pts.length; i += 2) {
          minX = Math.min(minX, pts[i]);
          maxX = Math.max(maxX, pts[i]);
          minY = Math.min(minY, pts[i + 1]);
          maxY = Math.max(maxY, pts[i + 1]);
        }
        return { pts, minX, maxX, minY, maxY };
      }),
    }));
  }

  private entryAt(p: LatLng): Entry | null {
    for (const e of this.entries) for (const r of e.rings) if (inRing(r, p.lng, p.lat)) return e;
    return null;
  }

  /** The state a point is in, or null outside the US (or offshore). */
  stateAt(p: LatLng): UsState | null {
    const e = this.entryAt(p);
    return e ? { name: e.name, code: e.code } : null;
  }

  /**
   * Interstate exit number at a point. US exits are numbered by miles from
   * where the interstate enters the state: from the west border for
   * east-west (even-numbered) interstates, from the south for north-south
   * (odd) ones. Measured straight across the state and stretched a little
   * for the road's bends.
   */
  exitNumber(p: LatLng, interstate: number): number | null {
    const e = this.entryAt(p);
    if (!e) return null;
    const eastWest = interstate % 2 === 0;
    let border = -Infinity;
    for (const r of e.rings) {
      const pts = r.pts;
      for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
        const [ax, ay, bx, by] = [pts[j], pts[j + 1], pts[i], pts[i + 1]];
        if (eastWest) {
          // Where the ring crosses this latitude, west of the point.
          if (ay > p.lat !== by > p.lat) {
            const x = ax + ((p.lat - ay) / (by - ay)) * (bx - ax);
            if (x <= p.lng) border = Math.max(border, x);
          }
        } else if (ax > p.lng !== bx > p.lng) {
          const y = ay + ((p.lng - ax) / (bx - ax)) * (by - ay);
          if (y <= p.lat) border = Math.max(border, y);
        }
      }
    }
    if (!Number.isFinite(border)) return null;
    const degMiles = 69.17;
    const miles = eastWest ? (p.lng - border) * degMiles * Math.cos((p.lat * Math.PI) / 180) : (p.lat - border) * degMiles;
    return Math.max(1, Math.round(miles * 1.08));
  }
}

function inRing(r: Ring, x: number, y: number): boolean {
  if (x < r.minX || x > r.maxX || y < r.minY || y > r.maxY) return false;
  const pts = r.pts;
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const yi = pts[i + 1];
    const yj = pts[j + 1];
    if (yi > y !== yj > y && x < ((pts[j] - pts[i]) * (y - yi)) / (yj - yi) + pts[i]) inside = !inside;
  }
  return inside;
}

let loaded: StateMap | null = null;
let loading: Promise<StateMap | null> | null = null;

export const stateMap = (): StateMap | null => loaded;
export function setStateMap(m: StateMap | null): void {
  loaded = m;
}

/** Loads the state outlines once (from the network or the offline cache). Never throws. */
export function loadStateMap(url = `${import.meta.env.BASE_URL}data/states-us.json`): Promise<StateMap | null> {
  loading ??= fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .then((f: StatesFile | null) => (loaded = f ? new StateMap(f) : null))
    .catch(() => null);
  return loading;
}

/** Converts a distance along the game path back to a real lat/lng. */
export function latLngAt(route: RouteData, path: Path, d: number): LatLng {
  const proj = makeProjection(route.start);
  const p = path.pointAt(d);
  return proj.toLatLng({ x: p.x * route.scale, y: p.y * route.scale });
}

export interface StateLine {
  /** Distance along the path where the route enters the state. */
  at: number;
  name: string;
  code: string;
}

/**
 * Where the route crosses into each state (the first entry is the starting
 * state, at 0). Samples the path and narrows each crossing down to a few units.
 */
export function stateLines(route: RouteData, path: Path, map: StateMap): StateLine[] {
  const proj = makeProjection(route.start);
  const at = (d: number) => {
    const p = path.pointAt(d);
    return map.stateAt(proj.toLatLng({ x: p.x * route.scale, y: p.y * route.scale }));
  };
  const out: StateLine[] = [];
  // About every 2 km of real road, and at least every 60 game units.
  const step = Math.max(10, Math.min(60, 2000 / route.scale));
  let prev = at(0);
  let prevD = 0;
  if (prev) out.push({ at: 0, ...prev });
  for (let d = step; d <= path.length + step; d += step) {
    const dd = Math.min(d, path.length);
    const cur = at(dd);
    // Offshore or in a gap between outlines: keep the last state.
    if (cur && cur.code !== prev?.code) {
      let lo = prevD;
      let hi = dd;
      while (hi - lo > 2) {
        const mid = (lo + hi) / 2;
        if (at(mid)?.code === cur.code) hi = mid;
        else lo = mid;
      }
      out.push({ at: hi, ...cur });
      prev = cur;
    }
    prevD = dd;
    if (dd === path.length) break;
  }
  return out;
}

/** The interstate number in a road name ("I 40" → 40), if any. */
export function interstateNumber(name: string | null | undefined): number | null {
  const m = name?.match(/\bI[- ]?(\d{1,3})\b/);
  return m ? parseInt(m[1], 10) : null;
}
