import type { RouteData } from '../geo/route';
import { hashString, makeRng, pick, type Rng } from './rng';
import { classAt, roadSegments } from './roads';

export type StopKind = 'town' | 'gas' | 'truckstop' | 'farm' | 'mall' | 'base';
export type PlaceKind = 'pumps' | 'garage' | 'grocery' | 'hardware' | 'gunshop' | 'pharmacy' | 'police' | 'junkyard' | 'barn' | 'motel';

/** A spot along the route where the player may turn off left or right. */
export interface Stop {
  id: string;
  at: number;
  side: 'left' | 'right';
  kind: StopKind;
  name: string;
  places: PlaceKind[];
}

export const STOP_TITLES: Record<StopKind, string> = {
  town: 'Town',
  gas: 'Gas station',
  truckstop: 'Truck stop',
  farm: 'Farmstead',
  mall: 'Strip mall',
  base: 'Abandoned army post',
};

const PLACES_BY_KIND: Record<StopKind, PlaceKind[][]> = {
  town: [['pumps', 'garage', 'grocery', 'police'], ['pumps', 'hardware', 'pharmacy', 'motel'], ['garage', 'grocery', 'gunshop', 'pumps']],
  gas: [['pumps', 'grocery'], ['pumps', 'garage']],
  truckstop: [['pumps', 'garage', 'motel', 'grocery']],
  farm: [['barn', 'junkyard'], ['barn', 'pumps']],
  mall: [['grocery', 'hardware', 'pharmacy', 'gunshop']],
  base: [['police', 'junkyard', 'gunshop']],
};

/** Name endings for stops on the edge of a real town. */
const OUTSKIRTS: Record<StopKind, string[]> = {
  town: ['Junction', 'Crossing', 'Heights'],
  gas: ['Gas & Go', 'Fuel Stop', 'Quik Fill'],
  truckstop: ['Travel Plaza', 'Truck Stop', 'Truck Center'],
  farm: ['Farm', 'Ranch', 'Feed & Seed'],
  mall: ['Plaza', 'Shopping Center', 'Outlet Mall'],
  base: ['Armory', 'National Guard Post', 'Army Depot'],
};

const MADE_UP_NAMES = ['Dry Creek', 'Pinecone', 'Hollow Rock', 'Bitterroot', 'Red Mesa', 'Junction City', 'Cold Spring', 'Antler', 'Saltlick', 'Fort Sorrow', 'Buzzard Hill', 'Lonesome'];

/** Kinds that sell fuel, so we can guarantee the player is never stranded by bad luck. */
export const hasFuel = (s: Stop) => s.places.includes('pumps');

/**
 * Places turn-off points along the route. Real turns from the routing data
 * become stops named after the road; gaps are filled with made-up stops so
 * the spacing stays even. Every few stops is guaranteed to have pumps.
 */
export function generateStops(route: RouteData, pathLength: number, seed: number): Stop[] {
  const rng = makeRng(seed ^ hashString(route.startLabel + route.endLabel));
  const count = Math.max(6, Math.min(14, Math.round(pathLength / 2600)));
  const spacing = pathLength / (count + 1);

  // Real towns along the road: from the map data, or from offline-atlas town steps.
  const towns: { at: number; name: string; side?: 'left' | 'right' }[] = [
    ...(route.landmarks ?? []).filter((l) => l.kind === 'citysign' && l.real).map((l) => ({ at: l.at, name: l.name })),
    ...route.steps
      .filter((st) => st.type === 'town' && st.name)
      .map((st) => ({ at: st.at, name: st.name, side: st.modifier?.includes('left') ? ('left' as const) : ('right' as const) })),
  ].filter((t) => t.at > 400 && t.at < pathLength - 600);
  const realTurns = route.steps.filter((s) => s.type !== 'town' && s.modifier && /left|right/.test(s.modifier));
  const usedTowns = new Set<string>();
  const segments = roadSegments(route, pathLength);
  const stops: Stop[] = [];
  for (let i = 1; i <= count; i++) {
    const ideal = i * spacing;
    // Prefer a real town near the ideal spot, then a real turn, then anywhere.
    const town = towns
      .filter((t) => !usedTowns.has(t.name) && Math.abs(t.at - ideal) < spacing * 0.35)
      .sort((a, b) => Math.abs(a.at - ideal) - Math.abs(b.at - ideal))[0];
    const turn = town ? undefined : realTurns.find((t) => Math.abs(t.at - ideal) < spacing * 0.3);
    // A town's turn-off comes just before its sign.
    const at = town ? town.at + 60 : turn ? turn.at : ideal + (rng() - 0.5) * spacing * 0.3;
    const dir = town?.side ?? turn?.modifier;
    // Interstate exits are on the right.
    const onInterstate = classAt(segments, at) === 'interstate';
    const side: Stop['side'] = onInterstate ? 'right' : dir?.includes('left') ? 'left' : dir?.includes('right') ? 'right' : rng() < 0.5 ? 'left' : 'right';
    const fuel = i % 3 === 1;
    let kind: StopKind = fuel ? pick(rng, ['gas', 'truckstop', 'town'] as const) : pickKind(rng);
    if (town && kind !== 'gas' && kind !== 'truckstop') kind = 'town';
    const places = pick(rng, PLACES_BY_KIND[kind]).slice();
    if (fuel && !places.includes('pumps')) places.unshift('pumps');
    let name: string;
    if (town && kind === 'town') name = town.name;
    else {
      // Out-of-town stops borrow the nearest real town's name, the way real ones do.
      const nearby = towns.filter((t) => Math.abs(t.at - at) < spacing).sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0];
      name = nearby ? `${nearby.name} ${pick(rng, OUTSKIRTS[kind])}` : pick(rng, MADE_UP_NAMES);
    }
    if (town) usedTowns.add(town.name);
    stops.push({
      id: `stop-${i}`,
      at: Math.max(400, Math.min(pathLength - 600, at)),
      side,
      kind,
      name,
      places,
    });
  }
  stops.sort((a, b) => a.at - b.at);
  // Keep stops apart even after snapping to real turns.
  for (let i = 1; i < stops.length; i++) {
    if (stops[i].at - stops[i - 1].at < 500) stops[i].at = stops[i - 1].at + 500;
  }
  return stops.filter((s) => s.at < pathLength - 300);
}

function pickKind(rng: Rng): StopKind {
  const r = rng();
  if (r < 0.3) return 'town';
  if (r < 0.5) return 'gas';
  if (r < 0.65) return 'farm';
  if (r < 0.8) return 'mall';
  if (r < 0.9) return 'truckstop';
  return 'base';
}
