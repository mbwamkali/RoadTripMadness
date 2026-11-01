import type { RouteData } from '../geo/route';

/**
 * Road types along the route, from the real road names: interstates and
 * freeways are divided with four lanes each way, US and state highways have
 * four lanes in total, and everything else is one lane each way.
 */
export type RoadClass = 'interstate' | 'highway' | 'local';

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
  interstate: { lanes: 4, median: 3.5, laneWidth: 3.6 },
  highway: { lanes: 2, median: 0, laneWidth: 3.6 },
  local: { lanes: 1, median: 0, laneWidth: 4.5 },
};

/** Distance from the centre line to the outer edge of the pavement. */
export const edgeOf = (cls: RoadClass) => PROFILES[cls].median + PROFILES[cls].lanes * PROFILES[cls].laneWidth;

/** Which lane the car drives in: the right lane, or second from the right on an interstate. */
export function laneOffset(cls: RoadClass): number {
  const p = PROFILES[cls];
  const lane = cls === 'interstate' ? p.lanes - 2 : p.lanes - 1;
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
  return out;
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
