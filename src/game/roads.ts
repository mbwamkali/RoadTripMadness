import type { RouteData } from '../geo/route';

/**
 * Road types along the route, from the real road names: interstates and
 * freeways are divided, two lanes each way in the country and four each way
 * near cities ('metro'); US and state highways have four lanes in total; and
 * everything else is one lane each way.
 */
export type RoadClass = 'interstate' | 'metro' | 'highway' | 'local';

/** Divided roads (a median between the directions; exits on the right). */
export const isDivided = (cls: RoadClass) => cls === 'interstate' || cls === 'metro';

export interface RoadSegment {
  from: number;
  to: number;
  cls: RoadClass;
}

export interface RoadProfile {
  /** Lanes in each direction. */
  lanes: number;
  /** Half-width of the grass median (0 = undivided). */
  median: number;
  laneWidth: number;
}

export const PROFILES: Record<RoadClass, RoadProfile> = {
  interstate: { lanes: 2, median: 3.5, laneWidth: 3.6 },
  metro: { lanes: 4, median: 3.5, laneWidth: 3.6 },
  highway: { lanes: 2, median: 0, laneWidth: 3.6 },
  local: { lanes: 1, median: 0, laneWidth: 4.5 },
};

/**
 * How fast the car cruises on each road type, as a share of the base cruise
 * speed, and the usual US speed limit shown on the HUD (mph).
 */
export const SPEED: Record<RoadClass, { factor: number; mph: number }> = {
  interstate: { factor: 1.15, mph: 75 },
  metro: { factor: 1, mph: 65 },
  highway: { factor: 0.9, mph: 55 },
  local: { factor: 0.7, mph: 35 },
};

/** Distance from the centre line to the outer edge of the pavement. */
export const edgeOf = (cls: RoadClass) => PROFILES[cls].median + PROFILES[cls].lanes * PROFILES[cls].laneWidth;

/** Which lane the car drives in: the right lane, or second from the right on a city interstate. */
export function laneOffset(cls: RoadClass): number {
  const p = PROFILES[cls];
  const lane = cls === 'metro' ? p.lanes - 2 : p.lanes - 1;
  return p.median + (lane + 0.5) * p.laneWidth;
}

const INTERSTATE = /\bI[- ]?\d{1,3}\b(?! ?(Bus|Business))/;
const FREEWAY = /\b(Freeway|Expressway|Turnpike|Thruway|Tollway|Interstate)\b/i;
const NUMBERED = /\b(US|SR|[A-Z]{2})[- ]?\d{1,3}[A-Z]?\b|\bI[- ]?\d{1,3} ?(Bus|Business)\b/;
const BIG_STREET = /\b(Highway|Hwy|Parkway|Pkwy)\b/i;

export function classifyRoad(name: string, motorway = false): RoadClass {
  if (motorway || INTERSTATE.test(name) || FREEWAY.test(name)) return 'interstate';
  if (NUMBERED.test(name) || BIG_STREET.test(name)) return 'highway';
  return 'local';
}

/**
 * Stretches of the path near a city, where interstates have four lanes each
 * way: the start and end of the trip, and every city (50,000+ people) passed.
 * About 12 km of real road either side, kept within what's visible in the game.
 */
export function urbanZones(route: RouteData, pathLength: number): { from: number; to: number }[] {
  const r = Math.max(300, Math.min(900, 12_000 / (route.scale || 15)));
  const centres = [0, pathLength, ...(route.landmarks ?? []).filter((l) => l.kind === 'citysign' && l.big).map((l) => l.at)];
  const zones = centres.map((c) => ({ from: Math.max(0, c - r), to: Math.min(pathLength, c + r) })).sort((a, b) => a.from - b.from);
  const out: { from: number; to: number }[] = [];
  for (const z of zones) {
    const prev = out[out.length - 1];
    if (prev && z.from <= prev.to) prev.to = Math.max(prev.to, z.to);
    else out.push({ ...z });
  }
  return out;
}

/** Splits interstate stretches into city (four lanes each way) and country (two) pieces. */
function widenNearCities(segs: RoadSegment[], zones: { from: number; to: number }[]): RoadSegment[] {
  const out: RoadSegment[] = [];
  for (const s of segs) {
    if (s.cls !== 'interstate') {
      out.push(s);
      continue;
    }
    let at = s.from;
    for (const z of zones) {
      const a = Math.max(at, z.from);
      const b = Math.min(s.to, z.to);
      if (b <= a) continue;
      if (a > at) out.push({ from: at, to: a, cls: 'interstate' });
      out.push({ from: a, to: b, cls: 'metro' });
      at = b;
    }
    if (at < s.to) out.push({ from: at, to: s.to, cls: 'interstate' });
  }
  return out;
}

/** Splits the path into stretches of one road class, ignoring blips too short to see (ramps, quick jogs). */
export function roadSegments(route: RouteData, pathLength: number, minLength = 250): RoadSegment[] {
  const raw: RoadSegment[] = [];
  let cls: RoadClass = 'local';
  let at = 0;
  let started = false;
  for (const st of route.steps) {
    if (st.type === 'town' || st.type === 'arrive') continue;
    // Ramps are short; keep whatever road we're coming from until the merge.
    if (/ramp/.test(st.type) && !st.name) continue;
    const next = classifyRoad(st.name, st.motorway);
    if (!started) {
      cls = next;
      started = true;
      continue;
    }
    if (next === cls) continue;
    const d = Math.max(0, Math.min(pathLength, st.at));
    if (d > at) raw.push({ from: at, to: d, cls });
    at = d;
    cls = next;
  }
  raw.push({ from: at, to: pathLength, cls });
  // Absorb short pieces into their neighbours.
  const out: RoadSegment[] = [];
  for (const s of raw) {
    const prev = out[out.length - 1];
    if (prev && (prev.cls === s.cls || s.to - s.from < minLength)) prev.to = s.to;
    else if (prev && prev.to - prev.from < minLength && out.length === 1 && prev.from === 0) {
      prev.to = s.to;
      prev.cls = s.cls;
    } else out.push({ ...s });
  }
  // Merge again after splitting so tiny city/country slivers don't flicker the width.
  const merged: RoadSegment[] = [];
  for (const s of widenNearCities(out, urbanZones(route, pathLength))) {
    const prev = merged[merged.length - 1];
    if (prev && (prev.cls === s.cls || s.to - s.from < minLength / 2)) prev.to = s.to;
    else merged.push({ ...s });
  }
  return merged;
}

/** Looks up the road class at a distance (segments are sorted). */
export function classAt(segments: RoadSegment[], d: number): RoadClass {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid].from <= d) lo = mid;
    else hi = mid - 1;
  }
  return segments[lo]?.cls ?? 'local';
}

/** Pavement edge with a smooth taper where the road widens or narrows. */
export function edgeAt(segments: RoadSegment[], d: number, taper = 60): number {
  const i = segments.findIndex((s) => d >= s.from && d < s.to);
  const s = segments[i < 0 ? segments.length - 1 : i];
  if (!s) return edgeOf('local');
  let e = edgeOf(s.cls);
  const prev = segments[i - 1];
  const next = segments[i + 1];
  if (prev && d - s.from < taper) e = lerp(edgeOf(prev.cls), e, 0.5 + (d - s.from) / taper / 2);
  if (next && s.to - d < taper) e = lerp(edgeOf(next.cls), e, 0.5 + (s.to - d) / taper / 2);
  return e;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));
