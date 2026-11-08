import { makeProjection, type LatLng, type Path, type Vec2 } from '../geo/geo';
import type { RouteData } from '../geo/route';
import type { Stop } from './stops';
import { hashString, makeRng, pick, range, type Rng } from './rng';
import { biomeAtDistance, biomeSpans, type BiomeId, type BiomeSpan } from './biomes';

/**
 * Things to look at along the road. Real ones come from OpenStreetMap; the
 * gaps between them are filled with made-up roadside sights.
 */
export type LandmarkKind =
  | 'river'
  | 'peak'
  | 'hill'
  | 'monument'
  | 'tower'
  | 'lighthouse'
  | 'castle'
  | 'attraction'
  | 'viewpoint'
  | 'citysign'
  | 'stateline'
  | 'roadsign'
  | 'watertower'
  | 'windmill'
  | 'billboard'
  | 'giant'
  | 'mountains'
  | 'farmstead'
  | 'grain'
  | 'lookout'
  | 'mesa'
  | 'ghosttown';

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
  /** Road signs: which way the route goes there. */
  arrow?: 'left' | 'right' | 'straight';
  /** Town signs: a city, where interstates widen. */
  big?: boolean;
  /** Wikipedia page from the map data. */
  wiki?: string;
  /** Peaks: real height in metres, when the map has it. */
  ele?: number;
}

export const LANDMARK_TITLES: Record<LandmarkKind, string> = {
  river: 'River',
  peak: 'Mountain',
  hill: 'Hill',
  monument: 'Monument',
  tower: 'Tower',
  lighthouse: 'Lighthouse',
  castle: 'Historic site',
  attraction: 'Attraction',
  viewpoint: 'Scenic view',
  citysign: 'Town',
  stateline: 'State line',
  roadsign: 'Road sign',
  watertower: 'Water tower',
  windmill: 'Windmill',
  billboard: 'Billboard',
  giant: 'Roadside attraction',
  mountains: 'Mountains',
  farmstead: 'Farm',
  grain: 'Grain elevator',
  lookout: 'Fire lookout',
  mesa: 'Butte',
  ghosttown: 'Ghost town',
};

export const LANDMARK_ICONS: Record<LandmarkKind, string> = {
  river: '🌉',
  peak: '⛰️',
  hill: '🌳',
  monument: '🗿',
  tower: '📡',
  lighthouse: '🗼',
  castle: '🏰',
  attraction: '⭐',
  viewpoint: '📷',
  citysign: '🏙️',
  stateline: '🗺️',
  roadsign: '🛣️',
  watertower: '💧',
  windmill: '🌬️',
  billboard: '🪧',
  giant: '🤠',
  mountains: '🏔️',
  farmstead: '🚜',
  grain: '🌾',
  lookout: '🔥',
  mesa: '🏜️',
  ghosttown: '👻',
};

/** Kinds that are big enough to announce in the HUD as you pass. */
export const ANNOUNCED: ReadonlySet<LandmarkKind> = new Set(['river', 'peak', 'hill', 'monument', 'tower', 'lighthouse', 'castle', 'attraction', 'viewpoint', 'citysign', 'stateline', 'giant', 'grain', 'lookout', 'mesa', 'ghosttown']);

// ------------------------------------------------------------ real map features

export interface MapFeature {
  /** 'fuel' features are real gas stations; they become stops, not scenery. */
  kind: LandmarkKind | 'fuel';
  name: string;
  /** Fuel: a truck stop (big rigs welcome). */
  truck?: boolean;
  /** Towns: a city (50,000 people or more). */
  big?: boolean;
  /** Its Wikipedia page, when the map links one. */
  wiki?: string;
  /** A point feature, or the centre of an area. */
  point?: LatLng;
  /** A line feature (rivers). */
  line?: LatLng[];
  /** Peaks: height in metres, when the map has it. */
  ele?: number;
}

/**
 * Where to read about a real landmark: its Wikipedia page from the map, or a
 * Wikipedia search for it. Made-up scenery has none.
 */
export function readMoreUrl(l: Landmark, state?: string): string | null {
  if (!l.real || l.kind === 'roadsign' || l.kind === 'mountains') return null;
  if (l.wiki) return l.wiki;
  const name = l.name.replace(/^(Leaving|Welcome to) /, '');
  const q = l.kind === 'citysign' && state ? `${name}, ${state}` : name;
  return `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`;
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
    if (f.kind === 'fuel') continue;
    if (f.kind === 'river' && f.line) {
      for (const c of lineCrossings(path, index, f.line.map(project))) {
        out.push({ at: c.at, side: 1, offset: 0, kind: 'river', name: f.name, real: true, angle: c.angle, ...(f.wiki ? { wiki: f.wiki } : {}) });
      }
      continue;
    }
    if (!f.point) continue;
    const { at, lateral } = locate(path, project(f.point), index);
    const far = Math.abs(lateral);
    // The world is shrunk, so pull things in close enough to see; peaks stay on the horizon.
    if (f.kind === 'peak') {
      if (far > 1500) continue;
      out.push({ at, side: lateral < 0 ? -1 : 1, offset: Math.max(350, Math.min(900, far)), kind: 'peak', name: f.name, real: true, ...(f.wiki ? { wiki: f.wiki } : {}), ...(f.ele != null ? { ele: f.ele } : {}) });
    } else if (f.kind === 'citysign') {
      if (far > 250) continue;
      out.push({ at, side: 1, offset: 9, kind: 'citysign', name: f.name, real: true, ...(f.big ? { big: true } : {}), ...(f.wiki ? { wiki: f.wiki } : {}) });
    } else {
      if (far > 400) continue;
      out.push({ at, side: lateral < 0 ? -1 : 1, offset: Math.max(28, Math.min(110, far)), kind: f.kind, name: f.name, real: true, ...(f.wiki ? { wiki: f.wiki } : {}) });
    }
  }
  return thin(out.sort((a, b) => a.at - b.at), path.length);
}

/** A real gas station beside the route. */
export interface FuelStation {
  at: number;
  side: 'left' | 'right';
  name: string;
  truck: boolean;
}

/** Places real gas stations along the path, at most one every few hundred units (truck stops win). */
export function placeFuel(route: RouteData, path: Path, features: MapFeature[], gap = 300): FuelStation[] {
  const project = routeProjector(route);
  const index = new PathIndex(path);
  const all: FuelStation[] = [];
  for (const f of features) {
    if (f.kind !== 'fuel' || !f.point) continue;
    const { at, lateral } = locate(path, project(f.point), index);
    // The world is shrunk ~50x, so "beside the road" is a few units.
    if (Math.abs(lateral) > 40 || at < 300 || at > path.length - 500) continue;
    all.push({ at, side: lateral < 0 ? 'left' : 'right', name: f.name, truck: !!f.truck });
  }
  all.sort((a, b) => a.at - b.at);
  const out: FuelStation[] = [];
  for (const s of all) {
    const last = out[out.length - 1];
    if (last && s.at - last.at < gap) {
      if (s.truck && !last.truck) out[out.length - 1] = s;
      continue;
    }
    out.push(s);
  }
  return out;
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

const BUTTES = ['Coffin Butte', 'Red Table Mesa', 'Smokestack Rock', 'Buzzard Roost', 'Anvil Butte', 'Sentinel Mesa', 'Blackjack Mesa', 'Castle Butte'];
const GHOST_TOWNS = ['Cutthroat Gulch', 'Last Chance', 'Busted Flats', 'Tin Cup', 'Bitter Wells', 'Hangtown', 'Silverbell', 'Dry Diggings'];
const CO_OPS = ['Farmers Co-op', 'Prairie Grain Co.', 'Harvest Gold Co-op', 'County Elevator', 'Golden Belt Grain', 'Plains Co-op'];
const LOOKOUTS = ['Bald Knob Lookout', 'Eagle Peak Lookout', 'Smokey Ridge Lookout', 'Hogback Lookout', 'Sheep Mountain Lookout', 'Lone Pine Lookout'];
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
/** Regions with real mountains (made-up ranges show only here). */
export const MOUNTAIN_LAND: ReadonlySet<BiomeId> = new Set(['mountains', 'pinewoods', 'tundra', 'sagebrush', 'desert']);

/** A real map "peak" that is a mountain, not a hill: in mountain country, tall enough, not called a mound or hill. */
export function isMountain(l: Pick<Landmark, 'name' | 'ele'>, biome: BiomeId | null): boolean {
  if (/\b(mound|hill|knob|knoll|hummock)s?\b/i.test(l.name)) return false;
  if (l.ele != null && l.ele < 600) return false;
  return biome == null || MOUNTAIN_LAND.has(biome);
}

export function fillLandmarks(route: RouteData, pathLength: number, stops: Stop[], real: Landmark[], seed: number): Landmark[] {
  const rng = makeRng(seed ^ hashString(`landmarks:${route.startLabel}`));
  used.clear();
  let spans: BiomeSpan[] | null = null;
  try {
    spans = route.points?.length ? biomeSpans(route) : null;
  } catch {
    spans = null;
  }
  // Mountains only where the land has them: a "peak" in flat country (a mound near Houston) is a hill.
  const biome = (d: number) => (spans ? biomeAtDistance(spans, d) : null);
  const all = real.map((l) => (l.kind === 'peak' && !isMountain(l, biome(l.at)) ? { ...l, kind: 'hill' as const, offset: Math.min(l.offset, 260) } : l));
  const near = (d: number, gap: number) => all.some((l) => l.kind !== 'peak' && l.kind !== 'hill' && l.kind !== 'mountains' && Math.abs(l.at - d) < gap);

  all.push({ at: 60, side: -1, offset: 9, kind: 'citysign', name: `Leaving ${route.startLabel.split(',')[0]}`, real: true });
  all.push({ at: pathLength - 160, side: 1, offset: 9, kind: 'citysign', name: `Welcome to ${route.endLabel.split(',')[0]}`, real: true });
  for (const s of stops) {
    // Real towns already have their own sign from the map data.
    if (all.some((l) => l.kind === 'citysign' && l.name === s.name && Math.abs(l.at - s.at) < 600)) continue;
    if (s.kind === 'town' || s.kind === 'mall') {
      all.push({ at: s.at - 220, side: s.side === 'right' ? 1 : -1, offset: 9, kind: 'citysign', name: `${s.name}`, real: false });
    }
  }

  // "Welcome to Arizona" right at each state line.
  for (const st of (route.states ?? []).slice(1)) {
    if (st.at < 80 || st.at > pathLength - 200) continue;
    const sign: Landmark = { at: st.at, side: 1, offset: 9, kind: 'stateline', name: st.name, real: true };
    while (all.some((l) => l.kind === 'citysign' && Math.abs(l.at - sign.at) < 50)) sign.at += 50;
    all.push(sign);
  }

  // Road signs go where they won't hide behind a town sign.
  for (const sign of roadSigns(route, pathLength)) {
    while (all.some((l) => (l.kind === 'citysign' || l.kind === 'stateline' || l.kind === 'billboard') && Math.abs(l.at - sign.at) < 60)) sign.at -= 60;
    all.push(sign);
  }

  // With little real map data (offline, or a quiet stretch of map), made-up
  // sights come closer together so the road never feels empty.
  const realSights = real.filter((l) => l.kind !== 'citysign' && l.kind !== 'roadsign' && l.kind !== 'stateline').length;
  const sparse = realSights / Math.max(1, pathLength / 1000) < 0.4;
  const [gapMin, gapMax] = sparse ? [320, 560] : [450, 800];
  let d = range(rng, 300, 600);
  let made = 0;
  while (d < pathLength - 300) {
    if (!near(d, 260) && !stops.some((s) => Math.abs(s.at - d) < 120)) {
      const kind = pickSight(rng, made, spans ? biomeAtDistance(spans, d) : null);
      all.push(makeSight(rng, kind, d));
      made++;
    }
    d += range(rng, gapMin, gapMax);
  }
  // Distant mountain ranges every so often, for a sense of scale.
  for (let m = range(rng, 800, 2000); m < pathLength; m += range(rng, 2500, 5000)) {
    const b = biome(m);
    if (b && !MOUNTAIN_LAND.has(b)) continue;
    all.push({ at: m, side: rng() < 0.5 ? -1 : 1, offset: range(rng, 600, 900), kind: 'mountains', name: '', real: false });
  }
  return all.sort((a, b) => a.at - b.at);
}

/**
 * Green signs where the real route changes road ("Left onto Main Street",
 * "I 40"), so you can follow the actual roads you're driving on.
 */
const REF = /\b(I|US|SR|[A-Z]{2})[- ]?\d{1,3}[A-Z]?(?: (?:Bus|Hist|Alt|Byp|Spur|Loop))?\b/;

/**
 * Tidies a routing road name for a sign: "Officer David Haynes Memorial
 * Highway I 44; MO 43" becomes "I 44", "Stevenson Expressway I 55" stays.
 */
export function signName(raw: string): string {
  const name = raw.replace(/\s+/g, ' ').trim();
  const m = name.match(REF);
  if (!m) return name;
  const ref = m[0].replace(/ (Bus|Hist|Alt|Byp|Spur|Loop)$/, ' $1');
  const text = name
    .slice(0, m.index)
    .replace(/[;,]\s*$/, '')
    .trim();
  if (!text || text.length > 22 || /memorial|trail|veterans/i.test(text)) return ref;
  return `${text} ${ref}`;
}

export function roadSigns(route: RouteData, pathLength: number): Landmark[] {
  const out: Landmark[] = [];
  let last = '';
  for (const st of route.steps) {
    if (st.type === 'town' || st.type === 'arrive' || st.type === 'depart') {
      if (st.type === 'depart' && st.name) last = signName(st.name);
      continue;
    }
    const name = signName(st.name);
    if (!name || name === last) continue;
    last = name;
    const at = st.at - 40;
    if (at < 150 || at > pathLength - 250) continue;
    // In cities the turns come thick and fast; keep only signs you can read.
    if (out.length && at - out[out.length - 1].at < 260) out.pop();
    const m = st.modifier ?? '';
    const arrow = m.includes('left') ? 'left' : m.includes('right') ? 'right' : 'straight';
    out.push({ at, side: 1, offset: 9, kind: 'roadsign', name, real: true, arrow });
  }
  // Dropping crowded signs can leave the same road twice in a row.
  return out.filter((l, i) => i === 0 || l.name !== out[i - 1].name);
}

/** The real road the car is on at a distance, from the routing steps. */
export function roadAt(route: RouteData, at: number): string {
  let name = '';
  for (const st of route.steps) {
    if (st.at > at) break;
    if (st.name && st.type !== 'town' && st.type !== 'arrive') name = signName(st.name);
  }
  return name;
}

/** Made-up sights that suit the land: buttes and ghost towns in the desert, grain elevators on the plains, fire lookouts in the woods. */
const SIGHTS_BY_BIOME: Partial<Record<BiomeId, [LandmarkKind, number][]>> = {
  desert: [['mesa', 3], ['ghosttown', 2], ['giant', 2], ['billboard', 2], ['windmill', 1]],
  sagebrush: [['mesa', 2], ['ghosttown', 2], ['windmill', 2], ['billboard', 1], ['giant', 1]],
  prairie: [['grain', 3], ['farmstead', 2], ['windmill', 2], ['watertower', 2], ['billboard', 1]],
  farmland: [['farmstead', 3], ['grain', 3], ['watertower', 2], ['billboard', 1], ['giant', 1]],
  forest: [['lookout', 2], ['farmstead', 1], ['watertower', 1], ['viewpoint', 2], ['billboard', 1]],
  pinewoods: [['lookout', 3], ['viewpoint', 2], ['giant', 1], ['billboard', 1]],
  mountains: [['lookout', 3], ['viewpoint', 3], ['ghosttown', 1]],
  tundra: [['lookout', 2], ['viewpoint', 2], ['ghosttown', 1]],
};

function pickSight(rng: Rng, n: number, biome: BiomeId | null = null): LandmarkKind {
  if (n % 4 === 2) return 'river';
  const table = biome && SIGHTS_BY_BIOME[biome];
  if (table && rng() < 0.75) {
    const total = table.reduce((a, [, w]) => a + w, 0);
    let r = rng() * total;
    for (const [k, w] of table) if ((r -= w) < 0) return k;
  }
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
    case 'mesa':
      return { at, side, offset: range(rng, 160, 320), kind, name: fresh(rng, BUTTES), real: false };
    case 'ghosttown':
      return { at, side, offset: range(rng, 22, 34), kind, name: fresh(rng, GHOST_TOWNS), real: false };
    case 'grain':
      return { at, side, offset: range(rng, 30, 55), kind, name: fresh(rng, CO_OPS), real: false };
    case 'lookout':
      return { at, side, offset: range(rng, 35, 70), kind, name: fresh(rng, LOOKOUTS), real: false };
    case 'farmstead':
      return { at, side, offset: range(rng, 35, 70), kind, name: '', real: false };
    default:
      return { at, side, offset: range(rng, 30, 70), kind, name: '', real: false };
  }
}
