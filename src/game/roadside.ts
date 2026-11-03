import { classAt, type RoadClass, type RoadSegment } from './roads';

/**
 * What runs alongside the lanes: paved shoulders with rumble strips on the
 * bigger roads, sidewalks through towns, and a median that suits the road
 * (grass out in the country, a concrete barrier on city freeways). Also the
 * numbers on the signs: mile markers that follow the real exits, speed
 * limit signs where the limit changes, and distance signs to the next towns.
 * Pure logic so it can be tested; the drive view draws it.
 */

/** Paved shoulder width (game units) outside the last lane. Local roads have none (gravel only). */
export const SHOULDER: Record<RoadClass, number> = { interstate: 3, metro: 3, highway: 2.4, local: 0 };

/** Sidewalks are this wide, raised on a curb, through towns. */
export const SIDEWALK = 3.2;
export const CURB_HEIGHT = 0.2;

export type MedianKind = 'none' | 'grass' | 'barrier';

/** Grass between the carriageways in the country; a concrete barrier on city freeways. */
export function medianKind(cls: RoadClass): MedianKind {
  if (cls === 'interstate') return 'grass';
  if (cls === 'metro') return 'barrier';
  return 'none';
}

/**
 * The paved shoulder at a distance, easing in and out over about 80 units
 * either side as the road type changes so it never jumps.
 */
export function shoulderAt(segments: RoadSegment[], d: number): number {
  let sum = 0;
  for (let i = -4; i <= 4; i++) sum += SHOULDER[classAt(segments, d + i * 20)];
  return sum / 9;
}

/** The exit number on a sign, as a plain number ("42B" is exit 42). */
export function exitNumberOf(ref: string): number | null {
  const m = /^\s*(\d{1,3})/.exec(ref);
  return m ? Number(m[1]) : null;
}

const METERS_PER_MILE = 1609.34;

/**
 * The mile marker at a game distance. Interstate exits in almost every
 * state are numbered by mile, so the markers follow the real exits the
 * route passes: between two exits the mile is counted between their
 * numbers; next to one exit it counts on from it (in the direction the
 * estimate says the miles run). With no real exits nearby it falls back to
 * the estimate from the state border. `scale` is metres per game unit.
 */
export function milepost(
  d: number,
  exits: { at: number; ref: string }[] | undefined,
  scale: number,
  estimate: (d: number) => number | null,
): number | null {
  const unitsPerMile = METERS_PER_MILE / Math.max(1e-6, scale);
  // Only exits within about 25 real miles tell us anything here.
  const reach = 25 * unitsPerMile;
  const numbered = (exits ?? [])
    .map((e) => ({ at: e.at, n: exitNumberOf(e.ref) }))
    .filter((e): e is { at: number; n: number } => e.n !== null && Math.abs(e.at - d) < reach);
  let before: { at: number; n: number } | null = null;
  let after: { at: number; n: number } | null = null;
  for (const e of numbered) {
    if (e.at <= d && (!before || e.at > before.at)) before = e;
    if (e.at > d && (!after || e.at < after.at)) after = e;
  }
  if (before && after && after.at > before.at) {
    const miles = (after.at - before.at) / unitsPerMile;
    const step = after.n - before.n;
    // Two exits whose numbers differ by about the miles between them: count between them.
    if (step !== 0 && Math.abs(Math.abs(step) - miles) <= Math.max(2, miles * 0.4)) {
      return Math.max(0, Math.round(before.n + ((d - before.at) / (after.at - before.at)) * step));
    }
  }
  const near = before && after ? (d - before.at < after.at - d ? before : after) : (before ?? after);
  const est = estimate(d);
  if (near) {
    const estNear = estimate(near.at);
    // Count on from the nearest exit, the way the estimate says the miles run.
    const sign = est !== null && estNear !== null && est !== estNear ? Math.sign(est - estNear) : 1;
    return Math.max(0, Math.round(near.n + (sign * (d - near.at)) / unitsPerMile));
  }
  return est;
}

/** Where the speed limit changes between `from` and `to` (checked every `step` units). */
export function limitChanges(from: number, to: number, limitAt: (d: number) => number, step = 20): { at: number; mph: number }[] {
  const out: { at: number; mph: number }[] = [];
  let last = limitAt(Math.max(0, from - step));
  for (let d = from; d < to; d += step) {
    const mph = limitAt(d);
    if (mph !== last) out.push({ at: d, mph });
    last = mph;
  }
  return out;
}

/** The lines on a green distance sign: the next towns ahead and the destination, nearest first, in whole miles. */
export function distanceSignLines(
  at: number,
  towns: { at: number; name: string }[],
  end: { at: number; name: string },
  milesBetween: (a: number, b: number) => number,
  max = 3,
): { name: string; miles: number }[] {
  const ahead = towns
    .filter((t) => t.at > at + 50 && t.at < end.at - 50)
    .sort((a, b) => a.at - b.at)
    .slice(0, max - 1)
    .map((t) => ({ name: t.name, miles: Math.max(1, Math.round(milesBetween(at, t.at))) }));
  const lines = [...ahead, { name: end.name, miles: Math.max(1, Math.round(milesBetween(at, end.at))) }];
  // Never the same name twice (the last town can be the destination).
  return lines.filter((l, i) => lines.findIndex((x) => x.name === l.name) === i);
}

/** How sharply the road turns (radians) between two travel directions. */
export function turnAngle(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y));
}
