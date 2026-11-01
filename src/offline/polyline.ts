import type { LatLng } from '../geo/geo';

/**
 * Douglas–Peucker simplification of a lat/lng polyline. Tolerance is in
 * metres. OSRM gives every curve of every on-ramp; the game rescales and
 * smooths routes anyway, so a few tens of metres of tolerance is invisible
 * and shrinks a cross-country route by 90% or more.
 */
export function simplifyLatLng(points: LatLng[], toleranceM: number): LatLng[] {
  if (points.length < 3) return points.slice();
  const k = Math.cos((points[0].lat * Math.PI) / 180);
  const tol = toleranceM / 111_195;
  const tol2 = tol * tol;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const ax = points[i].lng * k, ay = points[i].lat;
    const dx = points[j].lng * k - ax, dy = points[j].lat - ay;
    const len2 = dx * dx + dy * dy || 1e-18;
    let best = -1;
    let bestD = tol2;
    for (let m = i + 1; m < j; m++) {
      const px = points[m].lng * k, py = points[m].lat;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const d = (ax + dx * t - px) ** 2 + (ay + dy * t - py) ** 2;
      if (d > bestD) {
        bestD = d;
        best = m;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([i, best], [best, j]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Packs a polyline into delta-encoded integers (1e-5 degrees, about 1 m), which compresses well as JSON. */
export function packLatLng(points: LatLng[]): number[] {
  const out: number[] = [];
  let px = 0;
  let py = 0;
  for (const p of points) {
    const x = Math.round(p.lng * 1e5);
    const y = Math.round(p.lat * 1e5);
    out.push(x - px, y - py);
    px = x;
    py = y;
  }
  return out;
}

export function unpackLatLng(packed: number[]): LatLng[] {
  const out: LatLng[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i + 1 < packed.length; i += 2) {
    x += packed[i];
    y += packed[i + 1];
    out.push({ lng: x / 1e5, lat: y / 1e5 });
  }
  return out;
}
