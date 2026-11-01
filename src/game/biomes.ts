import { makeProjection, type LatLng, type Path } from '../geo/geo';
import { pathFromRoute, type RouteData } from '../geo/route';

/**
 * The look of the land along the route, from a rough climate map: deserts
 * in the Southwest, prairie on the plains, cornfields in the Midwest, leafy
 * forest in the East, pines in the mountains and the North, palms in the
 * far South. Outside the US it falls back to latitude bands.
 */
export type BiomeId = 'desert' | 'sagebrush' | 'prairie' | 'farmland' | 'forest' | 'pinewoods' | 'mountains' | 'coastal' | 'subtropical' | 'tundra';

export type PlantKind = 'saguaro' | 'shrub' | 'grass' | 'oak' | 'pine' | 'palm' | 'crops';

export interface BiomeInfo {
  name: string;
  icon: string;
  ground: number;
  shoulder: number;
  sky: number;
  /** Relative odds of each plant. */
  plants: Partial<Record<PlantKind, number>>;
  /** 0..1, how much of the roadside has plants. */
  density: number;
  /** 0..1, how many rocks. */
  rocks: number;
  /** Weather it tends toward. */
  weather: 'dry' | 'wet' | 'cold' | 'mild';
}

export const BIOMES: Record<BiomeId, BiomeInfo> = {
  desert: { icon: '🌵', name: 'Desert', ground: 0xd8b07a, shoulder: 0xb88c5a, sky: 0xf2c58f, plants: { saguaro: 3, shrub: 4 }, density: 0.25, rocks: 0.25, weather: 'dry' },
  sagebrush: { icon: '🏜️', name: 'High desert', ground: 0xbfae86, shoulder: 0xa89270, sky: 0xd9d3c0, plants: { shrub: 8, grass: 2 }, density: 0.45, rocks: 0.2, weather: 'dry' },
  prairie: { icon: '🌾', name: 'Prairie', ground: 0xb7b06a, shoulder: 0xa08e62, sky: 0xc9dff0, plants: { grass: 8, oak: 1 }, density: 0.45, rocks: 0.04, weather: 'mild' },
  farmland: { icon: '🌽', name: 'Farm country', ground: 0x8fa452, shoulder: 0x9b8661, sky: 0xc9dff0, plants: { crops: 6, oak: 2, grass: 2 }, density: 0.6, rocks: 0.02, weather: 'wet' },
  forest: { icon: '🌳', name: 'Woods', ground: 0x6f8f4a, shoulder: 0x8a7a5a, sky: 0xbcd6ea, plants: { oak: 7, pine: 2 }, density: 0.8, rocks: 0.05, weather: 'wet' },
  pinewoods: { icon: '🌲', name: 'Pine forest', ground: 0x5f7f4a, shoulder: 0x8a7a5a, sky: 0xbcd6ea, plants: { pine: 9, oak: 1 }, density: 0.8, rocks: 0.08, weather: 'cold' },
  mountains: { icon: '🏔️', name: 'Mountains', ground: 0x7d8a5e, shoulder: 0x8c8070, sky: 0xb8cfe6, plants: { pine: 8, shrub: 2 }, density: 0.55, rocks: 0.35, weather: 'cold' },
  coastal: { icon: '🌊', name: 'Coast', ground: 0xb9a777, shoulder: 0xa89270, sky: 0xcfe3f2, plants: { shrub: 5, palm: 2, oak: 2 }, density: 0.45, rocks: 0.12, weather: 'mild' },
  subtropical: { icon: '🌴', name: 'Subtropics', ground: 0x7fa05a, shoulder: 0xb8a77f, sky: 0xc6e2f2, plants: { palm: 5, oak: 3, pine: 2 }, density: 0.6, rocks: 0.02, weather: 'wet' },
  tundra: { icon: '❄️', name: 'North woods', ground: 0x7a8a6a, shoulder: 0x8c8070, sky: 0xc8d6e2, plants: { pine: 9, shrub: 1 }, density: 0.6, rocks: 0.15, weather: 'cold' },
};

/** A rough climate zone for a point on the map. */
export function biomeAt(p: LatLng): BiomeId {
  const { lat, lng } = p;
  const usa = lat > 24 && lat < 50 && lng > -125 && lng < -66;
  if (usa) {
    if (lng < -117 && lat < 38) return 'coastal'; // Southern and central California coast
    if (lng < -120 && lat >= 38) return lat > 42 ? 'pinewoods' : 'forest'; // Pacific Northwest, Northern California
    if (lat > 34.8 && lat < 36 && lng > -112.4 && lng < -111) return 'pinewoods'; // Flagstaff's ponderosa pines
    if (lng < -103 && lat < 37.5) return lng < -109 || lat < 33.5 ? 'desert' : 'sagebrush'; // Mojave, Sonoran, New Mexico
    if (lng < -111 && lat >= 37.5) return 'sagebrush'; // Great Basin
    if (lng < -104.5) return 'mountains'; // Rockies
    if (lng < -97) return lat < 31 ? 'sagebrush' : 'prairie'; // Great Plains, west Texas
    if (lat < 28.5 && lng > -83) return 'subtropical'; // Florida
    if (lat < 31.5) return 'subtropical'; // Gulf coast
    if (lng < -82 && lat >= 38 && lat < 45) return 'farmland'; // Corn belt
    if (lat >= 45) return 'pinewoods'; // Upper Midwest, Maine
    if (lng < -86 && lat < 38) return 'forest'; // Ozarks, mid-South
    if (lng > -82 && lng < -77 && lat > 35 && lat < 42) return 'mountains'; // Appalachians
    return 'forest';
  }
  const a = Math.abs(lat);
  if (a < 15) return 'subtropical';
  if (a < 33) return 'desert';
  if (a < 45) return 'farmland';
  if (a < 58) return 'forest';
  return 'tundra';
}

export interface BiomeSpan {
  from: number;
  to: number;
  id: BiomeId;
}

const SAMPLE = 600;
const cache = new WeakMap<RouteData, BiomeSpan[]>();

/** Biomes along the route, sampled every few hundred units and merged into spans. */
export function biomeSpans(route: RouteData, givenPath?: Path): BiomeSpan[] {
  const hit = cache.get(route);
  if (hit) return hit;
  const path = givenPath ?? pathFromRoute(route);
  const proj = makeProjection(route.start);
  const out: BiomeSpan[] = [];
  const demo = route.source === 'demo';
  for (let d = 0; d < path.length; d += SAMPLE) {
    const p = path.pointAt(d);
    const id = demo ? 'desert' : biomeAt(proj.toLatLng({ x: p.x * route.scale, y: p.y * route.scale }));
    const last = out[out.length - 1];
    if (last && last.id === id) last.to = Math.min(path.length, d + SAMPLE);
    else out.push({ from: d, to: Math.min(path.length, d + SAMPLE), id });
  }
  // Single-sample flickers between two longer spans just look noisy.
  for (let i = 1; i < out.length - 1; i++) {
    if (out[i].to - out[i].from <= SAMPLE && out[i - 1].id === out[i + 1].id) out[i].id = out[i - 1].id;
  }
  const merged: BiomeSpan[] = [];
  for (const s of out) {
    const last = merged[merged.length - 1];
    if (last && last.id === s.id) last.to = s.to;
    else merged.push({ ...s });
  }
  cache.set(route, merged);
  return merged;
}

export function biomeAtDistance(spans: BiomeSpan[], d: number): BiomeId {
  for (const s of spans) if (d < s.to) return s.id;
  return spans[spans.length - 1]?.id ?? 'prairie';
}

/** Ground colour with a soft blend across biome borders. */
export function groundColorAt(spans: BiomeSpan[], d: number, key: 'ground' | 'shoulder' | 'sky' = 'ground', blend = 400): number {
  const i = Math.max(0, spans.findIndex((s) => d < s.to));
  const s = spans[i];
  if (!s) return BIOMES.prairie[key];
  const here = BIOMES[s.id][key];
  const next = spans[i + 1];
  const prev = spans[i - 1];
  if (next && s.to - d < blend) return mix(here, BIOMES[next.id][key], 0.5 - (s.to - d) / blend / 2);
  if (prev && d - s.from < blend) return mix(BIOMES[prev.id][key], here, 0.5 + (d - s.from) / blend / 2);
  return here;
}

function mix(a: number, b: number, t: number): number {
  const ch = (c: number, sh: number) => (c >> sh) & 255;
  const m = (sh: number) => Math.round(ch(a, sh) + (ch(b, sh) - ch(a, sh)) * t) << sh;
  return m(16) | m(8) | m(0);
}
