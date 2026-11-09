import { makeRng } from './rng';

/**
 * Roads that cross the trip: overpasses on freeways, flat crossings with a
 * light on other roads (decisions.md "Overpasses and cross streets"). You
 * can't turn onto them; they are there so the road doesn't feel like it runs
 * through empty land. Real ones come from the road files (offline/roadNet.ts
 * crossingsAlong); where there are none (offline and classic trips, long empty
 * stretches) a few made-up ones fill in.
 */
export interface RoadCrossing {
  /** Game distance where the crossing road meets the trip. */
  at: number;
  /** 'over': the crossing road goes over on a bridge. 'flat': it meets the trip at a light or stop sign. */
  kind: 'over' | 'flat';
  name: string;
  /** Angle of the crossing road away from square to the trip (radians, + leans forward on the right). */
  angle: number;
  /** Flat crossings: 0 = carries on across, 1 = only runs off to the right, -1 = only to the left. */
  side: -1 | 0 | 1;
  /** A wide road: a wider bridge, or a traffic light rather than stop signs. */
  big: boolean;
  /** Made up to fill a gap (no real road there). */
  madeUp?: boolean;
}

/** Real crossings kept with the route (and saves): at most one per this many game units, the best first. */
export const CANDIDATE_GAP = 250;
/** Shortest gap (game units) between two crossings drawn: out in the country, and in town. */
export const MIN_GAP = 600;
export const MIN_GAP_TOWN = 400;
/** Kept clear of the start and end of the trip. */
export const ENDS = 300;
/** A stretch with no real crossing this long (game units) gets made-up ones; a trip with no real data, past FILL_GAP_MADE_UP. */
export const FILL_GAP = 3000;
export const FILL_GAP_MADE_UP = 1400;
/** Steepest skew drawn (radians); real crossings at a sharper angle are drawn at this. */
export const MAX_SKEW = 0.6;

/** Made-up names: plain country and small-town roads, never a real place. */
const NAMES = ['County Rd {n}', 'Farm Rd {n}', 'Ranch Rd {n}', 'Old Mill Rd', 'Section Line Rd', 'Airport Rd', 'Church St', 'School Rd', 'Depot St', 'Lake Rd', 'Quarry Rd', 'Orchard Rd', 'Water Tower Rd', 'Grange Rd', 'Elm St', 'Oak St', 'Cedar Ln', 'Rodeo Rd'];

export interface RawPlaced {
  at: number;
  kind: 'over' | 'flat';
  name: string;
  angle: number;
  side: -1 | 0 | 1;
  big: boolean;
  /** Higher is kept first: big, named roads. */
  score: number;
}

/** Thins the real crossings along a route to the best one per CANDIDATE_GAP (kept with the route). */
export function crossingCandidates(raw: RawPlaced[], pathLength: number): RoadCrossing[] {
  const keep: RawPlaced[] = [];
  for (const r of [...raw].sort((a, b) => b.score - a.score)) {
    if (r.at < ENDS || r.at > pathLength - ENDS) continue;
    if (keep.some((k) => Math.abs(k.at - r.at) < CANDIDATE_GAP)) continue;
    keep.push(r);
  }
  return keep
    .sort((a, b) => a.at - b.at)
    .map(({ score: _s, ...c }) => ({ ...c, angle: Math.max(-MAX_SKEW, Math.min(MAX_SKEW, c.angle)) }));
}

export interface CrossingPlan {
  /** Where the trip's road ends (the finish). */
  length: number;
  /** No crossing here (turn-offs, bridges, tunnels, sights, exit signs). */
  blocked: (d: number) => boolean;
  /** 0 open country .. 1 downtown. */
  urban: (d: number) => number;
  /** A divided freeway here: crossings go over it. */
  divided: (d: number) => boolean;
  /** No real road data on this trip: made-up ones all the way. */
  madeUpAll: boolean;
  seed: number;
}

/** The crossings to draw on a trip: real ones spaced out, made-up ones in the long gaps. */
export function planCrossings(candidates: RoadCrossing[], plan: CrossingPlan): RoadCrossing[] {
  const gapAt = (d: number) => (plan.urban(d) >= 0.4 ? MIN_GAP_TOWN : MIN_GAP);
  const inRange = (d: number) => d >= ENDS && d <= plan.length - ENDS;
  const out: RoadCrossing[] = [];
  const fits = (d: number) => inRange(d) && !plan.blocked(d) && !out.some((o) => Math.abs(o.at - d) < Math.max(gapAt(d), gapAt(o.at)));
  // Big roads first, then in order along the trip.
  const order = [...candidates].sort((a, b) => Number(b.big) - Number(a.big) || a.at - b.at);
  for (const c of order) {
    if (!fits(c.at)) continue;
    // A freeway never meets a road at a light.
    out.push(c.kind === 'flat' && plan.divided(c.at) ? { ...c, kind: 'over', side: 0 } : c);
  }
  // Fill long gaps with made-up crossings.
  const rng = makeRng(plan.seed ^ 0x5c7055);
  const fill = plan.madeUpAll ? FILL_GAP_MADE_UP : FILL_GAP;
  const marks = [ENDS, ...out.map((o) => o.at).sort((a, b) => a - b), plan.length - ENDS];
  for (let i = 0; i < marks.length - 1; i++) {
    const gap = marks[i + 1] - marks[i];
    if (gap <= fill) continue;
    const n = Math.floor(gap / (fill * 0.75));
    for (let j = 1; j < n; j++) {
      const base = marks[i] + (gap * j) / n + (rng() - 0.5) * 200;
      // Shuffle along a little to get clear of a turn-off or bridge.
      const d = [0, 120, -120, 240, -240].map((s) => base + s).find(fits);
      if (d === undefined) continue;
      const over = plan.divided(d);
      const flatSide: -1 | 0 | 1 = rng() < 0.7 ? 0 : rng() < 0.5 ? -1 : 1;
      out.push({
        at: d,
        kind: over ? 'over' : 'flat',
        name: NAMES[Math.floor(rng() * NAMES.length)].replace('{n}', String(1 + Math.floor(rng() * 60))),
        angle: (rng() - 0.5) * 0.5,
        side: over ? 0 : flatSide,
        big: over ? rng() < 0.4 : false,
        madeUp: true,
      });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The crossing at a distance, if one is within `pad`. */
export function crossingAt(list: RoadCrossing[] | undefined, d: number, pad: number): RoadCrossing | null {
  for (const c of list ?? []) if (Math.abs(c.at - d) <= pad) return c;
  return null;
}

const ABBREV: [RegExp, string][] = [
  [/\bRoad\b/g, 'Rd'],
  [/\bStreet\b/g, 'St'],
  [/\bAvenue\b/g, 'Ave'],
  [/\bBoulevard\b/g, 'Blvd'],
  [/\bHighway\b/g, 'Hwy'],
  [/\bLane\b/g, 'Ln'],
  [/\bDrive\b/g, 'Dr'],
  [/\bParkway\b/g, 'Pkwy'],
  [/\bExpressway\b/g, 'Expy'],
  [/\bFreeway\b/g, 'Fwy'],
  [/\bTurnpike\b/g, 'Tpke'],
  [/\bNorth\b/g, 'N'],
  [/\bSouth\b/g, 'S'],
  [/\bEast\b/g, 'E'],
  [/\bWest\b/g, 'W'],
];
/** A route number at the end of a road's name ("I 70", "US 183", "TX 21 Bus"). */
const REF_TAIL = /\s((?:I|US|[A-Z]{2}|CR|SR)\s?[0-9]+[A-Z]?(?:\s(?:Bus|Business|Alt|Bypass|Spur|Toll|Loop))*)$/;

/** What fits on a sign: abbreviated, and just the route number when the full name is long. */
export function signName(name: string, max = 20): string {
  let s = name.trim();
  for (const [re, to] of ABBREV) s = s.replace(re, to);
  if (s.length <= max) return s;
  const m = s.match(REF_TAIL);
  if (m) {
    const street = s.slice(0, m.index).trim();
    return street && street.length <= max ? street : m[1];
  }
  return s.length <= max + 6 ? s : `${s.slice(0, max).trim()}…`;
}
