import type { LatLng, Vec2 } from '../geo/geo';
import type { OsmElement } from '../geo/overpass';
import type { PlaceKind } from '../game/stops';
import { makeRng, pick, type Rng } from '../game/rng';

/**
 * A walkable town, laid out from the town's real map data when we have it.
 *
 * Plain data, no Three.js, so a second game (the isometric explorer) can use
 * the same layouts. Everything is in metres in the town's own frame: Main
 * Street starts at (0, 0), where it leaves the highway, and runs off toward
 * +y; +x is on your right as you drive in. One game unit in the town is one
 * metre, so the car, people and buildings keep their real sizes.
 */

/** The town's real map data, in metres around the turn-off (x east, y north). */
export interface TownMapData {
  streets: { name: string; cls: string; pts: Vec2[] }[];
  pois: { kind: PlaceKind; name: string; x: number; y: number }[];
}

export interface TownLot {
  place: PlaceKind;
  /** Metres along Main Street from the highway. */
  along: number;
  /** 1 = right of the street driving in, -1 = left. */
  side: 1 | -1;
  /** The real business name, when the map has one. */
  name?: string;
}

export interface TownLayout {
  name: string;
  street: string;
  /** Main Street's centre line, from the highway outward. */
  line: Vec2[];
  length: number;
  lots: TownLot[];
  crossings: { along: number; name: string }[];
  houses: { along: number; side: 1 | -1 }[];
  /** True when the street and at least one place came from the real map. */
  real: boolean;
}

/** How far a town lookup reaches around the turn-off (metres). */
export const TOWN_RADIUS_M = 700;
/** Main Street is cut to this length (metres). */
export const STREET_MAX = 260;
export const STREET_MIN = 150;
/** Lots on one side of the street are at least this far apart (metres along). */
export const LOT_GAP = 36;
/** The first lot starts this far from the highway, so the turn-in has room. */
export const FIRST_LOT = 34;

// ------------------------------------------------------------------ the lookup

/** One Overpass query for a town: its streets with geometry, and the shops we can stop at. */
export function townQuery(p: LatLng, r = TOWN_RADIUS_M): string {
  const at = `around:${r},${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  return (
    `[out:json][timeout:20];(` +
    `way(${at})[highway~"^(primary|secondary|tertiary|unclassified|residential|living_street)$"];` +
    `nwr(${at})[amenity~"^(fuel|police|pharmacy)$"];` +
    `nwr(${at})[shop~"^(supermarket|convenience|grocery|general|hardware|doityourself|car_repair|tyres|chemist|farm|hunting|outdoor|weapons)$"];` +
    `nwr(${at})[craft=car_repair];` +
    `nwr(${at})[tourism~"^(motel|hotel|guest_house)$"];` +
    `nwr(${at})[industrial=scrap_yard];nwr(${at})[landuse=farmyard][name];` +
    `);out geom 400;`
  );
}

/** Which of our places an OpenStreetMap object is, if any. */
export function placeKindOf(t: Record<string, string>): PlaceKind | null {
  if (t.amenity === 'fuel') return 'pumps';
  if (t.amenity === 'police') return 'police';
  if (t.amenity === 'pharmacy' || t.shop === 'chemist') return 'pharmacy';
  if (t.shop === 'car_repair' || t.shop === 'tyres' || t.craft === 'car_repair') return 'garage';
  if (t.shop === 'hardware' || t.shop === 'doityourself') return 'hardware';
  if (t.shop === 'supermarket' || t.shop === 'convenience' || t.shop === 'grocery' || t.shop === 'general') return 'grocery';
  if (t.shop === 'hunting' || t.shop === 'outdoor' || t.shop === 'weapons') return 'gunshop';
  if (t.tourism === 'motel' || t.tourism === 'hotel' || t.tourism === 'guest_house') return 'motel';
  if (t.industrial === 'scrap_yard') return 'junkyard';
  if (t.landuse === 'farmyard' || t.shop === 'farm') return 'barn';
  return null;
}

/** Turns an Overpass answer into metres around `origin`. */
export function parseTownOsm(json: { elements?: OsmElement[] }, origin: LatLng): TownMapData {
  const kx = 111_320 * Math.cos((origin.lat * Math.PI) / 180);
  const ky = 110_540;
  const local = (lat: number, lon: number): Vec2 => ({ x: (lon - origin.lng) * kx, y: (lat - origin.lat) * ky });
  const out: TownMapData = { streets: [], pois: [] };
  for (const e of json.elements ?? []) {
    const t = e.tags ?? {};
    const kind = placeKindOf(t);
    if (kind) {
      const c = e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lon: e.lon } : e.center ?? (e.bounds ? { lat: (e.bounds.minlat + e.bounds.maxlat) / 2, lon: (e.bounds.minlon + e.bounds.maxlon) / 2 } : e.geometry?.[0]);
      if (c) out.pois.push({ kind, name: (t.name ?? t.brand ?? '').slice(0, 28), ...local(c.lat, c.lon) });
      continue;
    }
    if (e.type === 'way' && t.highway && e.geometry && e.geometry.length >= 2) {
      out.streets.push({ name: t.name ?? '', cls: t.highway, pts: e.geometry.map((g) => local(g.lat, g.lon)) });
    }
  }
  return out;
}

// ------------------------------------------------------------------ geometry helpers

const len = (a: Vec2, b: Vec2) => Math.hypot(b.x - a.x, b.y - a.y);

function polyLength(pts: Vec2[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += len(pts[i - 1], pts[i]);
  return d;
}

/** Nearest point on a polyline: segment index, the point, its distance along and how far away it is. */
export function nearestOn(pts: Vec2[], p: Vec2): { i: number; at: Vec2; along: number; dist: number; side: 1 | -1 } {
  let best = { i: 0, at: pts[0], along: 0, dist: Infinity, side: 1 as 1 | -1 };
  let run = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    const d = len(q, p);
    if (d < best.dist) {
      // Cross product: positive means p is to the left of the direction of travel.
      const cross = dx * (p.y - a.y) - dy * (p.x - a.x);
      best = { i, at: q, along: run + Math.sqrt(l2) * t, dist: d, side: cross > 0 ? -1 : 1 };
    }
    run += Math.sqrt(l2);
  }
  return best;
}

/** Points every `step` metres along a polyline. */
export function resampleLine(pts: Vec2[], step: number): Vec2[] {
  const out: Vec2[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const l = len(a, b);
    let d = step - carry;
    while (d <= l) {
      out.push({ x: a.x + ((b.x - a.x) * d) / l, y: a.y + ((b.y - a.y) * d) / l });
      d += step;
    }
    carry = l - (d - step);
  }
  const last = pts[pts.length - 1];
  if (len(out[out.length - 1], last) > step * 0.3) out.push(last);
  return out;
}

/** The point and direction at a distance along a polyline. */
export function pointAlong(pts: Vec2[], d: number): { p: Vec2; dir: Vec2 } {
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = len(pts[i - 1], pts[i]);
    if (run + l >= d || i === pts.length - 1) {
      const t = l > 0 ? Math.max(0, Math.min(1, (d - run) / l)) : 0;
      const a = pts[i - 1];
      const b = pts[i];
      return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, dir: { x: (b.x - a.x) / (l || 1), y: (b.y - a.y) / (l || 1) } };
    }
    run += l;
  }
  return { p: pts[0], dir: { x: 0, y: 1 } };
}

/**
 * Takes a real street and makes it drivable Main Street: starts where it is
 * nearest the turn-off, follows it the longer way, cut to length, turned so it
 * heads off along +y, with bends softened so the car and camera can follow.
 */
export function shapeMainStreet(pts: Vec2[], origin: Vec2 = { x: 0, y: 0 }): { line: Vec2[]; frame: (p: Vec2) => Vec2 } {
  const n = nearestOn(pts, origin);
  const fwd = [n.at, ...pts.slice(n.i + 1)];
  const back = [n.at, ...pts.slice(0, n.i + 1).reverse()];
  let line = polyLength(fwd) >= polyLength(back) ? fwd : back;
  line = resampleLine(line, 6);
  // Cut to length.
  const cut: Vec2[] = [line[0]];
  let run = 0;
  for (let i = 1; i < line.length && run < STREET_MAX; i++) {
    run += len(line[i - 1], line[i]);
    cut.push(line[i]);
  }
  // Move the start to (0, 0) and turn the whole street so it heads along +y.
  const s = cut[0];
  const e = cut[cut.length - 1];
  const ang = Math.atan2(e.x - s.x, e.y - s.y);
  const c = Math.cos(ang);
  const sn = Math.sin(ang);
  const frame = (p: Vec2): Vec2 => {
    const x = p.x - s.x;
    const y = p.y - s.y;
    return { x: x * c - y * sn, y: x * sn + y * c };
  };
  let out = cut.map(frame);
  // Soften bends (a few passes of neighbour averaging) and keep it from wandering too far sideways.
  for (let k = 0; k < 6; k++) out = out.map((p, i) => (i === 0 || i === out.length - 1 ? p : { x: (out[i - 1].x + 2 * p.x + out[i + 1].x) / 4, y: (out[i - 1].y + 2 * p.y + out[i + 1].y) / 4 }));
  const wide = Math.max(1, ...out.map((p) => Math.abs(p.x)) ) / 30;
  out = out.map((p, i) => ({ x: (p.x / Math.max(1, wide)) * Math.min(1, i / 4), y: Math.max(p.y, i * 2) }));
  return { line: out, frame };
}

const MADE_UP_STREETS = ['Main St', 'Elm St', 'Oak St', '1st St', '2nd St', 'Church St', 'Mill Rd', 'Depot St', 'Maple Ave', 'Railroad Ave'];

// ------------------------------------------------------------------ the layout

/**
 * Lays out a town: Main Street (real when the map has it), a lot for each
 * place we can stop at (at the real business's spot when there is one, with
 * its name), cross streets and houses filling the gaps.
 */
export function layoutTown(opts: { name: string; places: PlaceKind[]; seed: number; street?: string; map?: TownMapData | null }): TownLayout {
  const rng = makeRng(opts.seed);
  const map = opts.map;
  // Main Street: the street the turn-off is on if we know it, else the nearest named street, else any.
  let line: Vec2[] | null = null;
  let frame: ((p: Vec2) => Vec2) | null = null;
  let streetName = opts.street ?? '';
  const streets = map?.streets.filter((s) => s.pts.length >= 2 && polyLength(s.pts) > 60) ?? [];
  if (streets.length) {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const near = (s: { pts: Vec2[] }) => nearestOn(s.pts, { x: 0, y: 0 }).dist;
    const named = streets.filter((s) => streetName && norm(s.name) === norm(streetName));
    const pool = named.length ? named : streets.filter((s) => s.name);
    const best = (pool.length ? pool : streets).slice().sort((a, b) => near(a) - near(b))[0];
    if (near(best) < 250) {
      const shaped = shapeMainStreet(best.pts);
      if (polyLength(shaped.line) >= STREET_MIN * 0.6) {
        line = shaped.line;
        frame = shaped.frame;
        streetName = best.name || streetName;
      }
    }
  }
  const real = !!line;
  if (!line) {
    // Made up: a gently bending street.
    const bend = (rng() - 0.5) * 0.004;
    line = [];
    for (let y = 0; y <= STREET_MAX * 0.8; y += 6) line.push({ x: bend * y * y * 0.5, y });
  }
  if (!streetName) streetName = pick(rng, MADE_UP_STREETS);
  // Real businesses, placed along Main Street in the same frame.
  const pois = frame && map
    ? map!.pois
        .map((p) => ({ ...p, n: nearestOn(line!, frame!(p)) }))
        .filter((p) => p.n.dist < 160)
        .sort((a, b) => a.n.dist - b.n.dist)
    : [];
  const lots: TownLot[] = [];
  const taken = (along: number, side: number) => lots.some((l) => l.side === side && Math.abs(l.along - along) < LOT_GAP);
  const lineLen = polyLength(line);
  const free = (want: number, side: 1 | -1): { along: number; side: 1 | -1 } => {
    // Nearest free slot to `want`, trying this side then the other.
    for (let k = 0; k < 40; k++) {
      for (const s of [side, -side as 1 | -1]) {
        for (const a of [want + k * 6, want - k * 6]) {
          const at = Math.max(FIRST_LOT, a);
          if (at <= Math.max(lineLen, STREET_MIN) - 24 && !taken(at, s)) return { along: at, side: s };
        }
      }
    }
    return { along: FIRST_LOT + lots.length * LOT_GAP, side };
  };
  const order = [...opts.places].sort((a, b) => (a === 'pumps' ? -1 : b === 'pumps' ? 1 : 0));
  order.forEach((place, i) => {
    const poi = pois.find((p) => p.kind === place && !lots.some((l) => l.name && l.name === p.name && l.place === place));
    if (poi) {
      const slot = free(poi.n.along, poi.n.side);
      lots.push({ place, ...slot, ...(poi.name ? { name: poi.name } : {}) });
    } else {
      // Gas first and nearest the highway, the rest spread up the street, sides alternating.
      const want = FIRST_LOT + (i / Math.max(1, order.length - 1)) * Math.max(0, Math.min(lineLen, STREET_MAX) - FIRST_LOT - 40) * 0.8;
      lots.push({ place, ...free(want, i % 2 === 0 ? 1 : -1) });
    }
  });
  lots.sort((a, b) => a.along - b.along);
  const length = Math.min(lineLen, Math.max(STREET_MIN, lots[lots.length - 1]?.along + 46 || STREET_MIN));
  // Cross streets: real ones where they meet Main Street, or one or two made up.
  const crossings: { along: number; name: string }[] = [];
  if (frame) {
    for (const s of streets) {
      if (!s.name || s.name === streetName) continue;
      for (const q of resampleLine(s.pts, 4)) {
        const n = nearestOn(line, frame(q));
        if (n.dist < 12 && n.along > 20 && n.along < length - 10 && !crossings.some((c) => Math.abs(c.along - n.along) < 30)) {
          crossings.push({ along: n.along, name: s.name });
          break;
        }
      }
    }
  }
  if (!crossings.length) {
    const at = lots.length > 1 ? (lots[0].along + lots[1].along) / 2 : length * 0.6;
    if (!lots.some((l) => Math.abs(l.along - at) < 18)) crossings.push({ along: at, name: pick(rng, MADE_UP_STREETS.filter((n) => n !== streetName)) });
  }
  crossings.sort((a, b) => a.along - b.along);
  // Houses fill the gaps on both sides.
  const houses: { along: number; side: 1 | -1 }[] = [];
  for (const side of [1, -1] as const) {
    for (let a = 16; a < length - 8; a += 20 + rng() * 6) {
      if (lots.some((l) => l.side === side && Math.abs(l.along - a) < 26)) continue;
      if (crossings.some((c) => Math.abs(c.along - a) < 12)) continue;
      houses.push({ along: a, side });
    }
  }
  return { name: opts.name, street: streetName, line: cutLine(line, length), length, lots, crossings, houses, real };
}

function cutLine(pts: Vec2[], length: number): Vec2[] {
  const out: Vec2[] = [pts[0]];
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = len(pts[i - 1], pts[i]);
    if (run + l >= length) {
      out.push(pointAlong(pts, length).p);
      return out;
    }
    run += l;
    out.push(pts[i]);
  }
  return out;
}

/** A seed for a stop's town, so the same stop always gets the same made-up details. */
export function townSeed(tripSeed: number, stopId: string): number {
  let h = tripSeed >>> 0;
  for (let i = 0; i < stopId.length; i++) h = Math.imul(h ^ stopId.charCodeAt(i), 16777619) >>> 0;
  return h;
}

export type { Rng };
