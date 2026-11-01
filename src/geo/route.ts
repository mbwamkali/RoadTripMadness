import { placeFeatures, placeFuel, type FuelStation, type Landmark, type MapFeature } from '../game/landmarks';
import { chaikin, dedupe, makeProjection, Path, resample, type LatLng, type Vec2 } from './geo';

/** One maneuver on the real route (from OSRM), placed along the game path. */
export interface RouteStep {
  /** Distance along the game path, in game units. */
  at: number;
  name: string;
  type: string;
  modifier?: string;
  /** The road after this step is a motorway (from OSRM's road classes). */
  motorway?: boolean;
}

/**
 * A route ready for the game. Geometry is in game units: the real route is
 * projected to meters and then scaled so every trip takes a playable amount of time.
 */
export interface RouteData {
  source: 'osrm' | 'demo' | 'offline' | 'curated';
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
  if (raw.features?.length) {
    const path = pathFromRoute(data);
    data.landmarks = placeFeatures(data, path, raw.features);
    const fuel = placeFuel(data, path, raw.features);
    if (fuel.length) data.fuel = fuel;
  }
  return data;
}

export function pathFromRoute(route: RouteData): Path {
  return new Path(route.points.map(([x, y]) => ({ x, y })));
}

/** Real kilometers travelled at a given game distance. */
export function realKmAt(route: RouteData, gameDistance: number): number {
  return (gameDistance * route.scale) / 1000;
}
