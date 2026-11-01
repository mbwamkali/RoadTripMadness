import { placeFeatures, placeFuel, type FuelStation, type Landmark, type MapFeature } from '../game/landmarks';
import { chaikin, dedupe, makeProjection, Path, resample, type LatLng, type Vec2 } from './geo';
import { stateLines, stateMap, type StateLine } from './states';
import { placeStructures, type Structure } from '../game/structures';

/** One maneuver on the real route, placed along the game path. */
export interface RouteStep {
  /** Distance along the game path, in game units. */
  at: number;
  name: string;
  type: string;
  modifier?: string;
  /** The road after this step is a motorway. */
  motorway?: boolean;
}

/**
 * A route ready for the game. Geometry is in game units: the real route is
 * projected to meters and then scaled so every trip takes a playable amount of time.
 */
export interface RouteData {
  /** 'osrm' only on trips saved before the game stopped using the OSRM server. */
  source: 'osrm' | 'osm' | 'demo' | 'offline' | 'curated';
  startLabel: string;
  endLabel: string;
  start: LatLng;
  end: LatLng;
  realMeters: number;
  realSeconds: number;
  /** Real meters per game unit. */
  scale: number;
  points: [number, number][];
  steps: RouteStep[];
  attribution: string;
  /** Real landmarks from OpenStreetMap, placed along the path (optional; filled in after routing). */
  landmarks?: Landmark[];
  /** Real gas stations beside the road (optional; from OpenStreetMap). */
  fuel?: FuelStation[];
  /** Where the route enters each US state (first entry: the starting state). */
  states?: StateLine[];
  /** Real motorway exits the route passes, from OpenStreetMap (own-routing trips only). */
  exits?: { at: number; ref: string; name: string }[];
  /** Posted speed limits where they change along the route, in mph; 0 = not known from here on. */
  limits?: { at: number; mph: number }[];
  /** Bridges and tunnels to draw, in game distance (see game/structures.ts). */
  structures?: Structure[];
}

/** Cruise speed of the car in game units per second. */
export const CRUISE_SPEED = 38;

/** How long the driving part of a trip should take, in seconds, for a real distance. */
export function targetDriveSeconds(realMeters: number): number {
  const km = realMeters / 1000;
  const minutes = Math.max(5, Math.min(25, 5 + km / 60));
  return minutes * 60;
}

export interface RawStep {
  location: LatLng;
  name: string;
  type: string;
  modifier?: string;
  motorway?: boolean;
}

export interface RawRoute {
  source: RouteData['source'];
  startLabel: string;
  endLabel: string;
  coords: LatLng[];
  realMeters: number;
  realSeconds: number;
  steps: RawStep[];
  attribution: string;
  /** Sights near the route from OpenStreetMap (see geo/overpass.ts). Optional; offline trips can skip it. */
  features?: MapFeature[];
  /** Motorway exits passed on the way (own-routing trips): exit number and destination. */
  exits?: { location: LatLng; ref: string; name: string }[];
  /** Posted speed limits where they change, in km/h; 0 = not known from here on. */
  limits?: { location: LatLng; kmh: number }[];
  /** Bridges and tunnels on the way (own-routing trips), with their real length. */
  structures?: { from: LatLng; to: LatLng; kind: 'bridge' | 'tunnel'; meters: number }[];
}

/** Converts a real-world route into game geometry: project, scale, smooth and resample. */
export function buildRouteData(raw: RawRoute): RouteData {
  if (raw.coords.length < 2) throw new Error('Route has no geometry');
  const proj = makeProjection(raw.coords[0]);
  const meters = dedupe(raw.coords.map((c) => proj.toLocal(c)));
  if (meters.length < 2) throw new Error('Start and end are the same place');
  const metersPath = new Path(meters);

  const gameLength = targetDriveSeconds(raw.realMeters) * CRUISE_SPEED;
  const scale = metersPath.length / gameLength;
  const scaled: Vec2[] = meters.map((p) => ({ x: p.x / scale, y: p.y / scale }));

  // Coarse resample first so smoothing works on a sane number of points,
  // then round corners and resample again at the spacing the renderer uses.
  const smooth = resample(chaikin(resample(scaled, 10), 3), 4);
  const path = new Path(smooth);

  const steps: RouteStep[] = raw.steps.map((s) => {
    const local = proj.toLocal(s.location);
    return {
      at: path.nearestDistance({ x: local.x / scale, y: local.y / scale }),
      name: s.name,
      type: s.type,
      modifier: s.modifier,
      ...(s.motorway ? { motorway: true } : {}),
    };
  });
  steps.sort((a, b) => a.at - b.at);
  const at = (p: LatLng) => {
    const local = proj.toLocal(p);
    return path.nearestDistance({ x: local.x / scale, y: local.y / scale });
  };

  const data: RouteData = {
    source: raw.source,
    startLabel: raw.startLabel,
    endLabel: raw.endLabel,
    start: raw.coords[0],
    end: raw.coords[raw.coords.length - 1],
    realMeters: raw.realMeters,
    realSeconds: raw.realSeconds,
    scale,
    points: smooth.map((p) => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]),
    steps,
    attribution: raw.attribution,
  };
  if (raw.exits?.length) data.exits = raw.exits.map((e) => ({ at: at(e.location), ref: e.ref, name: e.name })).sort((a, b) => a.at - b.at);
  if (raw.limits?.length) {
    data.limits = raw.limits
      .map((l) => ({ at: at(l.location), mph: l.kmh > 0 ? Math.round(l.kmh / 1.609344 / 5) * 5 : 0 }))
      .sort((a, b) => a.at - b.at);
  }
  if (raw.structures?.length) {
    const placed = placeStructures(raw.structures.map((st) => ({ from: at(st.from), to: at(st.to), kind: st.kind, meters: st.meters })), path.length);
    if (placed.length) data.structures = placed;
  }
  if (raw.features?.length) {
    const path = pathFromRoute(data);
    data.landmarks = placeFeatures(data, path, raw.features);
    const fuel = placeFuel(data, path, raw.features);
    if (fuel.length) data.fuel = fuel;
  }
  addStateLines(data);
  return data;
}

/** Works out the state lines once the state outlines are loaded (kept with the route, so saves have them). */
export function addStateLines(route: RouteData): void {
  const map = stateMap();
  if (route.states || !map || route.source === 'demo') return;
  const lines = stateLines(route, pathFromRoute(route), map);
  if (lines.length) route.states = lines;
}

export function pathFromRoute(route: RouteData): Path {
  return new Path(route.points.map(([x, y]) => ({ x, y })));
}

/** Real kilometers travelled at a given game distance. */
export function realKmAt(route: RouteData, gameDistance: number): number {
  return (gameDistance * route.scale) / 1000;
}

/** The posted speed limit (mph) in force at a game distance, or 0 when the route doesn't know it. */
export function postedLimit(route: RouteData, gameDistance: number): number {
  const list = route.limits;
  if (!list?.length || gameDistance < list[0].at) return 0;
  let lo = 0, hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid].at <= gameDistance) lo = mid;
    else hi = mid - 1;
  }
  return list[lo].mph;
}

/** The real exit closest to a game distance, if one is within about 2 km (real). */
export function realExitNear(route: RouteData, gameDistance: number, withinMeters = 2_000): { at: number; ref: string; name: string } | null {
  let best: { at: number; ref: string; name: string } | null = null;
  const within = withinMeters / route.scale;
  for (const e of route.exits ?? []) {
    const d = Math.abs(e.at - gameDistance);
    if (d <= within && (!best || d < Math.abs(best.at - gameDistance))) best = e;
  }
  return best;
}
