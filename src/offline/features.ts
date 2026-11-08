import type { LatLng } from '../geo/geo';
import { simplify, wikiUrl } from '../geo/overpass';
import type { MapFeature } from '../game/landmarks';
import { nearRoute } from './atlas';
import { getRoadJson, loadRoadIndex, roadsUrl, type RoadIndex } from './roadNet';

/**
 * Landmarks and gas stations baked into the monthly road build
 * (scripts/osm_features.py): one small file per 2 × 2 degree square, holding
 * what lies near the highways. A trip loads the squares it passes through and
 * keeps what is near its own route, at the distances the old live lookup used.
 */
export interface FeatureFile {
  version: 1;
  q: number;
  kinds: string[];
  /** [kind, name, lng, lat, flags, wiki, ele?]; flags bit 0 truck stop, bit 1 city, bit 2 village; ele = a peak's height in metres. */
  points: [number, string, number, number, number, string, number?][];
  /** [kind, name, wiki, [lng, lat, dlng, dlat, ...]] (river pieces around highway crossings). */
  lines: [number, string, string, number[]][];
}

/** How near the route each kind must be, in metres. */
const REACH: Record<string, number> = { citysign: 3000, village: 1200, peak: 8000, fuel: 350, river: 1500 };
const SIGHT_REACH = 2000;

/** The feature squares a route passes through, plus neighbours it comes within about 10 km of. */
export function featureTilesAlong(index: Pick<RoadIndex, 'tileDeg' | 'features'>, coords: LatLng[]): [number, number][] {
  const have = new Set((index.features ?? []).map(([x, y]) => `${x}_${y}`));
  const want = new Map<string, [number, number]>();
  const pad = 0.12;
  const add = (lng: number, lat: number) => {
    for (const dx of [-pad, 0, pad])
      for (const dy of [-pad, 0, pad]) {
        const x = Math.floor((lng + dx) / index.tileDeg);
        const y = Math.floor((lat + dy) / index.tileDeg);
        const k = `${x}_${y}`;
        if (have.has(k)) want.set(k, [x, y]);
      }
  };
  for (let i = 0; i < coords.length; i++) {
    const a = coords[i];
    add(a.lng, a.lat);
    const b = coords[i + 1];
    if (!b) break;
    const steps = Math.ceil(Math.max(Math.abs(b.lng - a.lng), Math.abs(b.lat - a.lat)) / 0.1);
    for (let s = 1; s < steps; s++) add(a.lng + ((b.lng - a.lng) * s) / steps, a.lat + ((b.lat - a.lat) * s) / steps);
  }
  return [...want.values()];
}

const wikiFrom = (w: string) => (w ? wikiUrl(/^Q\d+$/.test(w) ? { wikidata: w } : { wikipedia: w }) : undefined);

/** The features in some squares that are near a route, in the same shape the live lookup gave. */
export function featuresNear(files: FeatureFile[], coords: LatLng[]): MapFeature[] {
  const route = simplify(coords, 800, 60);
  const points: (LatLng & { f: MapFeature; reach: number })[] = [];
  const lines: { f: MapFeature; mid: LatLng }[] = [];
  for (const file of files) {
    const q = file.q;
    for (const [k, name, x, y, flags, w, ele] of file.points) {
      const kind = file.kinds[k] as MapFeature['kind'];
      const wiki = wikiFrom(w);
      const f: MapFeature = {
        kind,
        name,
        point: { lat: y / q, lng: x / q },
        ...(kind === 'fuel' && flags & 1 ? { truck: true } : {}),
        ...(kind === 'citysign' && flags & 2 ? { big: true } : {}),
        ...(wiki ? { wiki } : {}),
        ...(typeof ele === 'number' ? { ele } : {}),
      };
      const reach = REACH[kind === 'citysign' && flags & 4 ? 'village' : kind] ?? SIGHT_REACH;
      points.push({ lat: y / q, lng: x / q, f, reach });
    }
    for (const [k, name, w, flat] of file.lines) {
      const line: LatLng[] = [];
      let x = 0;
      let y = 0;
      for (let i = 0; i + 1 < flat.length; i += 2) {
        x += flat[i];
        y += flat[i + 1];
        line.push({ lat: y / q, lng: x / q });
      }
      if (line.length < 2) continue;
      const wiki = wikiFrom(w);
      lines.push({ f: { kind: file.kinds[k] as MapFeature['kind'], name, line, ...(wiki ? { wiki } : {}) }, mid: line[line.length >> 1] });
    }
  }
  const out: MapFeature[] = [];
  // Group by reach so each distance check runs once per point.
  const byReach = new Map<number, typeof points>();
  for (const p of points) {
    const g = byReach.get(p.reach);
    if (g) g.push(p);
    else byReach.set(p.reach, [p]);
  }
  for (const [reach, group] of byReach) for (const c of nearRoute(route, group, reach)) out.push(c.item.f);
  const mids = lines.map((l) => ({ ...l.mid, l }));
  for (const c of nearRoute(route, mids, REACH.river)) out.push(c.item.l.f);
  return out;
}

const fileLoads = new Map<string, Promise<FeatureFile>>();

/**
 * Landmarks near a route from the baked files, or null when this road build
 * has none (built before they were added) or they can't be loaded.
 */
export async function loadRouteFeatures(coords: LatLng[]): Promise<MapFeature[] | null> {
  try {
    const index = await loadRoadIndex();
    if (!index.features) return null;
    const v = encodeURIComponent(index.built);
    const files = await Promise.all(
      featureTilesAlong(index, coords).map(([x, y]) => {
        const name = `features/${x}_${y}.json?v=${v}`;
        let load = fileLoads.get(name);
        if (!load) {
          load = getRoadJson<FeatureFile>(roadsUrl(name));
          load.catch(() => fileLoads.delete(name));
          fileLoads.set(name, load);
        }
        return load;
      }),
    );
    return featuresNear(files, coords);
  } catch {
    return null;
  }
}
