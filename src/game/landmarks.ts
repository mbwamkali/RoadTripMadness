import { makeProjection, type LatLng, type Path, type Vec2 } from '../geo/geo';
import type { RouteData } from '../geo/route';
import type { Stop } from './stops';
import { hashString, makeRng, pick, range, type Rng } from './rng';

/**
 * Things to look at along the road. Real ones come from OpenStreetMap; the
 * gaps between them are filled with made-up roadside sights.
 */
export type LandmarkKind =
  | 'river'
  | 'peak'
  | 'monument'
  | 'tower'
  | 'lighthouse'
  | 'castle'
  | 'attraction'
  | 'viewpoint'
  | 'citysign'
  | 'watertower'
  | 'windmill'
  | 'billboard'
  | 'giant'
  | 'mountains';

export interface Landmark {
  /** Distance along the game path. */
  at: number;
  /** -1 = left of the road, 1 = right. */
  side: -1 | 1;
  /** How far from the road centre to draw it, in game units. */
  offset: number;
  kind: LandmarkKind;
  name: string;
  /** True when it came from real map data. */
  real: boolean;
  /** Rivers: angle between the river and the road, in radians. */
  angle?: number;
}

export const LANDMARK_TITLES: Record<LandmarkKind, string> = {
  river: 'River',
  peak: 'Mountain',
  monument: 'Monument',
  tower: 'Tower',
  lighthouse: 'Lighthouse',
  castle: 'Historic site',
  attraction: 'Attraction',
  viewpoint: 'Scenic view',
  citysign: 'Town',
  watertower: 'Water tower',
  windmill: 'Windmill',
  billboard: 'Billboard',
  giant: 'Roadside attraction',
  mountains: 'Mountains',
};

export const LANDMARK_ICONS: Record<LandmarkKind, string> = {
  river: '🌉',
  peak: '⛰️',
  monument: '🗿',
  tower: '📡',
  lighthouse: '🗼',
  castle: '🏰',
  attraction: '⭐',
  viewpoint: '📷',
  citysign: '🏙️',
  watertower: '💧',
  windmill: '🌬️',
  billboard: '🪧',
  giant: '🤠',
  mountains: '🏔️',
};

/** Kinds that are big enough to announce in the HUD as you pass. */
export const ANNOUNCED: ReadonlySet<LandmarkKind> = new Set(['river', 'peak', 'monument', 'tower', 'lighthouse', 'castle', 'attraction', 'viewpoint', 'citysign', 'giant']);

// ------------------------------------------------------------ real map features

export interface MapFeature {
  kind: LandmarkKind;
  name: string;
  /** A point feature, or the centre of an area. */
  point?: LatLng;
  /** A line feature (rivers). */
  line?: LatLng[];
}

/** Projects a lat/lng into the route's game plane (same projection buildRouteData used). */
export function routeProjector(route: RouteData) {
  const proj = makeProjection(route.start);
  return (p: LatLng): Vec2 => {
    const m = proj.toLocal(p);
    return { x: m.x / route.scale, y: m.y / route.scale };
  };
}

/** Distance along the path and signed sideways offset (+ = right) of a point. */
export function locate(path: Path, p: Vec2, hint?: PathIndex): { at: number; lateral: number } {
  const at = hint ? hint.nearestDistance(p) : path.nearestDistance(p);
  const q = path.pointAt(at);
  const f = path.directionAt(at);
  return { at, lateral: (p.x - q.x) * f.y - (p.y - q.y) * f.x };
}

/** A grid over the path's points for fast nearest-point and crossing lookups. */
export class PathIndex {
  private cells = new Map<string, number[]>();
  constructor(
    private path: Path,
    private cell = 60,
  ) {
    path.points.forEach((p, i) => {
      const k = this.key(p.x, p.y);
      const list = this.cells.get(k);
      if (list) list.push(i);
      else this.cells.set(k, [i]);
    });
  }

  private key(x: number, y: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`;
  }

  /** Index of the nearest path point within `radius`, or -1. */
  nearestIndex(p: Vec2, radius: number): number {
    const r = Math.ceil(radius / this.cell);
    const cx = Math.floor(p.x / this.cell);
    const cy = Math.floor(p.y / this.cell);
    let best = -1;
    let bestD = radius * radius;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (const i of this.cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          const q = this.path.points[i];
          const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
          if (d <= bestD) {
            bestD = d;
            best = i;
          }
        }
      }
    }
    return best;
  }

  nearestDistance(p: Vec2): number {
    const i = this.nearestIndex(p, this.cell * 3);
    return i >= 0 ? this.path.cum[i] : this.path.nearestDistance(p);
  }
}

/** Where a line (river) crosses the road: distances along the path plus the crossing angle. */
export function lineCrossings(path: Path, index: PathIndex, line: Vec2[]): { at: number; angle: number }[] {
  const out: { at: number; angle: number }[] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(len / 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const j = index.nearestIndex(p, 3);
      if (j < 0) continue;
      const at = path.cum[j];
      if (out.some((c) => Math.abs(c.at - at) < 150)) continue;
      const f = path.directionAt(at);
      const rx = (b.x - a.x) / (len || 1);
      const ry = (b.y - a.y) / (len || 1);
      out.push({ at, angle: Math.acos(Math.max(-1, Math.min(1, Math.abs(rx * f.x + ry * f.y)))) });
    }
  }
  return out;
}

/** Turns map features into landmarks placed along the road. */
export function placeFeatures(route: RouteData, path: Path, features: MapFeature[]): Landmark[] {
  const project = routeProjector(route);
  const index = new PathIndex(path);
  const out: Landmark[] = [];
  for (const f of features) {
    if (f.kind === 'river' && f.line) {
      for (const c of lineCrossings(path, index, f.line.map(project))) {
        out.push({ at: c.at, side: 1, offset: 0, kind: 'river', name: f.name, real: true, angle: c.angle });
      }
      continue;
    }
    if (!f.point) continue;
    const { at, lateral } = locate(path, project(f.point), index);
    const far = Math.abs(lateral);
    // The world is shrunk, so pull things in close enough to see; peaks stay on the horizon.
    if (f.kind === 'peak') {
      if (far > 1500) continue;
      out.push({ at, side: lateral < 0 ? -1 : 1, offset: Math.max(350, Math.min(900, far)), kind: 'peak', name: f.name, real: true });
    } else if (f.kind === 'citysign') {
      if (far > 250) continue;
      out.push({ at, side: 1, offset: 9, kind: 'citysign', name: f.name, real: true });
    } else {
      if (far > 400) continue;
      out.push({ at, side: lateral < 0 ? -1 : 1, offset: Math.max(28, Math.min(110, far)), kind: f.kind, name: f.name, real: true });
    }
  }
  return thin(out.sort((a, b) => a.at - b.at), path.length);
}

/** Keeps landmarks from bunching up; rivers always stay. */
function thin(list: Landmark[], length: number): Landmark[] {
  const kept: Landmark[] = [];
  const seen = new Set<string>();
  for (const l of list) {
    if (l.at < 120 || l.at > length - 120) continue;
    const key = `${l.kind}:${l.name}`;
    if (l.kind !== 'river' && seen.has(key)) continue;
    const gap = l.kind === 'river' || l.kind === 'peak' ? 0 : 220;
    if (gap && kept.some((k) => k.kind !== 'river' && k.kind !== 'peak' && Math.abs(k.at - l.at) < gap)) continue;
    if (l.kind === 'river' && kept.some((k) => k.kind === 'river' && Math.abs(k.at - l.at) < 120)) continue;
    seen.add(key);
    kept.push(l);
  }
  return kept;
}

// ------------------------------------------------------------ made-up sights

const CREEKS = ['Rattlesnake Creek', 'Muddy Fork', 'Coyote Wash', 'Silver Run', 'Bone Creek', 'Old Mill River', 'Crooked Creek', 'Dead Horse Creek', 'Blue Hole River', 'Lost Dog Creek'];
const GIANTS = [
  "World's Largest Fork",
  'Giant Concrete Armadillo',
  'Big Fiberglass Cowboy',
  'The Mystery Spot',
  'UFO Crash Site Museum',
  'Two-Story Coffee Pot',
  'Giant Rubber Duck',
  'Dinosaur Park',
  'Upside-Down House',
  'Big Steel Rooster',
];
export const BILLBOARDS = [
  'ZOMBIES? TRY OUR GARLIC FRIES',
  'LAST GAS FOR 50 MILES (PROBABLY)',
  'JESSE\'S AMMO & BAIT',
  'SEEN A CAT UFO? CALL 1-800-MEOW',
  'MOTEL: CLEAN-ISH ROOMS',
  'REPENT. ALSO, REFUEL.',
  'FIREWORKS 4 LESS',
  'BEEF JERKY NEXT EXIT',
];

/**
 * Fills the stretches between real landmarks so there is always something
 * coming up: creeks with bridges, water towers, windmills, billboards,
 * roadside oddities, and mountains on the horizon. Also adds town signs.
 */
export function fillLandmarks(route: RouteData, pathLength: number, stops: Stop[], real: Landmark[], seed: number): Landmark[] {
  const rng = makeRng(seed ^ hashString(`landmarks:${route.startLabel}`));
  used.clear();
  const all = real.slice();
  const near = (d: number, gap: number) => all.some((l) => l.kind !== 'peak' && l.kind !== 'mountains' && Math.abs(l.at - d) < gap);

  all.push({ at: 60, side: -1, offset: 9, kind: 'citysign', name: `Leaving ${route.startLabel.split(',')[0]}`, real: true });
  all.push({ at: pathLength - 160, side: 1, offset: 9, kind: 'citysign', name: `Welcome to ${route.endLabel.split(',')[0]}`, real: true });
  for (const s of stops) {
    if (s.kind === 'town' || s.kind === 'mall') {
      all.push({ at: s.at - 220, side: s.side === 'right' ? 1 : -1, offset: 9, kind: 'citysign', name: `${s.name}`, real: false });
    }
  }

  let d = range(rng, 300, 600);
  let made = 0;
  while (d < pathLength - 300) {
    if (!near(d, 260) && !stops.some((s) => Math.abs(s.at - d) < 120)) {
      const kind = pickSight(rng, made);
      all.push(makeSight(rng, kind, d));
      made++;
    }
    d += range(rng, 450, 800);
  }
  // Distant mountain ranges every so often, for a sense of scale.
  for (let m = range(rng, 800, 2000); m < pathLength; m += range(rng, 2500, 5000)) {
    all.push({ at: m, side: rng() < 0.5 ? -1 : 1, offset: range(rng, 600, 900), kind: 'mountains', name: '', real: false });
  }
  return all.sort((a, b) => a.at - b.at);
}

function pickSight(rng: Rng, n: number): LandmarkKind {
  if (n % 4 === 2) return 'river';
  const r = rng();
  if (r < 0.25) return 'billboard';
  if (r < 0.45) return 'watertower';
  if (r < 0.62) return 'windmill';
  if (r < 0.82) return 'giant';
  return 'viewpoint';
}

const used = new Set<string>();
/** Picks a name not used yet on this trip, if one is left. */
function fresh(rng: Rng, names: readonly string[]): string {
  const left = names.filter((n) => !used.has(n));
  const name = pick(rng, left.length ? left : names);
  used.add(name);
  return name;
}

function makeSight(rng: Rng, kind: LandmarkKind, at: number): Landmark {
  const side: -1 | 1 = rng() < 0.5 ? -1 : 1;
  switch (kind) {
    case 'river':
      return { at, side, offset: 0, kind, name: fresh(rng, CREEKS), real: false, angle: range(rng, 1.1, Math.PI / 2) };
    case 'billboard':
      return { at, side, offset: range(rng, 16, 24), kind, name: fresh(rng, BILLBOARDS), real: false };
    case 'giant':
      return { at, side, offset: range(rng, 25, 40), kind, name: fresh(rng, GIANTS), real: false };
    case 'viewpoint':
      return { at, side, offset: 14, kind, name: 'Scenic overlook', real: false };
    default:
      return { at, side, offset: range(rng, 30, 70), kind, name: '', real: false };
  }
}
