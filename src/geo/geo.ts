/** Geometry helpers: lat/lng math, local projection and polyline sampling. */

export interface LatLng {
  lat: number;
  lng: number;
}

/** A point in the local game plane, in meters. x = east, y = north. */
export interface Vec2 {
  x: number;
  y: number;
}

const EARTH_RADIUS_M = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Equirectangular projection around an origin. Accurate enough for a game:
 * we only need a continuous plane that keeps the route's shape.
 */
export function makeProjection(origin: LatLng) {
  const cosLat = Math.cos(toRad(origin.lat));
  return {
    toLocal(p: LatLng): Vec2 {
      return {
        x: toRad(p.lng - origin.lng) * EARTH_RADIUS_M * cosLat,
        y: toRad(p.lat - origin.lat) * EARTH_RADIUS_M,
      };
    },
    toLatLng(v: Vec2): LatLng {
      return {
        lat: origin.lat + (v.y / EARTH_RADIUS_M) * (180 / Math.PI),
        lng: origin.lng + (v.x / (EARTH_RADIUS_M * cosLat)) * (180 / Math.PI),
      };
    },
  };
}

export function cumulativeDistances(points: Vec2[]): number[] {
  const out = new Array<number>(points.length);
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    out[i] = total;
  }
  return out;
}

/** Drops consecutive duplicate points (zero-length segments break headings). */
export function dedupe(points: Vec2[], minGap = 0.5): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minGap) out.push(p);
  }
  return out;
}

/** Resamples a polyline to evenly spaced points, which keeps the road mesh and car motion smooth. */
export function resample(points: Vec2[], spacing: number): Vec2[] {
  if (points.length < 2) return points.slice();
  const cum = cumulativeDistances(points);
  const total = cum[cum.length - 1];
  const n = Math.max(2, Math.ceil(total / spacing) + 1);
  const out: Vec2[] = [];
  let seg = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.min(total, (i * total) / (n - 1));
    while (seg < cum.length - 2 && cum[seg + 1] < d) seg++;
    const segLen = cum[seg + 1] - cum[seg] || 1;
    const t = (d - cum[seg]) / segLen;
    out.push({
      x: points[seg].x + (points[seg + 1].x - points[seg].x) * t,
      y: points[seg].y + (points[seg + 1].y - points[seg].y) * t,
    });
  }
  return out;
}

/** Chaikin corner cutting: rounds off the sharp corners that a raw road polyline has. */
export function chaikin(points: Vec2[], iterations = 2): Vec2[] {
  let pts = points;
  for (let k = 0; k < iterations; k++) {
    if (pts.length < 3) return pts;
    const next: Vec2[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

/** A sampled path with O(log n) lookups of position and heading by distance. */
export class Path {
  readonly points: Vec2[];
  readonly cum: number[];
  readonly length: number;

  constructor(points: Vec2[]) {
    if (points.length < 2) throw new Error('A path needs at least two points');
    this.points = points;
    this.cum = cumulativeDistances(points);
    this.length = this.cum[this.cum.length - 1];
  }

  private segmentAt(d: number): number {
    let lo = 0;
    let hi = this.cum.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cum[mid] <= d) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  pointAt(distance: number): Vec2 {
    const d = Math.max(0, Math.min(this.length, distance));
    const i = this.segmentAt(d);
    const a = this.points[i];
    const b = this.points[i + 1];
    const len = this.cum[i + 1] - this.cum[i] || 1;
    const t = (d - this.cum[i]) / len;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  /** Unit direction of travel at a distance, averaged over a short window to avoid jitter. */
  directionAt(distance: number, window = 6): Vec2 {
    const a = this.pointAt(distance - window);
    const b = this.pointAt(distance + window);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  }

  /** Distance along the path of the vertex closest to p (used to place OSRM maneuvers). */
  nearestDistance(p: Vec2): number {
    let best = Infinity;
    let bestD = 0;
    for (let i = 0; i < this.points.length; i++) {
      const q = this.points[i];
      const dd = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (dd < best) {
        best = dd;
        bestD = this.cum[i];
      }
    }
    return bestD;
  }
}
