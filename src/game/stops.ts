import type { RouteData } from '../geo/route';
import { hashString, makeRng, pick, type Rng } from './rng';
import { classAt, isDivided, roadSegments } from './roads';

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
  /** A real gas station from the map. */
  real?: boolean;
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
  const stations = route.fuel ?? [];
  const usedStations = new Set<number>();
  const nearestTown = (at: number, within: number) =>
    towns.filter((t) => Math.abs(t.at - at) < within).sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0];
  const closest = <T extends { at: number }>(list: T[], ideal: number, within: number, skip: (t: T) => boolean) =>
    list.filter((t) => !skip(t) && Math.abs(t.at - ideal) < within).sort((a, b) => Math.abs(a.at - ideal) - Math.abs(b.at - ideal))[0];

  for (let i = 1; i <= count; i++) {
    const ideal = i * spacing;
    const fuel = i % 3 === 1;
    // Fuel stops go to a real gas station when there is one; other stops prefer a real town.
    let station = fuel ? closest(stations, ideal, spacing * 0.35, (t) => usedStations.has(t.at)) : undefined;
    const town = station ? undefined : closest(towns, ideal, spacing * 0.35, (t) => usedTowns.has(t.name));
    const turn = town || station ? undefined : realTurns.find((t) => Math.abs(t.at - ideal) < spacing * 0.3);
    // A town's turn-off comes just after its sign.
    const at = station ? station.at : town ? town.at + 60 : turn ? turn.at : ideal + (rng() - 0.5) * spacing * 0.3;
    const dir = station?.side ?? town?.side ?? turn?.modifier;
    // Interstate exits are on the right.
    const onInterstate = isDivided(classAt(segments, at));
    const side: Stop['side'] = onInterstate ? 'right' : dir?.includes('left') ? 'left' : dir?.includes('right') ? 'right' : rng() < 0.5 ? 'left' : 'right';
    let kind: StopKind = fuel ? pick(rng, ['gas', 'truckstop', 'town'] as const) : pickKind(rng);
    if (station) kind = station.truck ? 'truckstop' : 'gas';
    else if (town && kind !== 'gas' && kind !== 'truckstop') kind = 'town';
    const places = pick(rng, PLACES_BY_KIND[kind]).slice();
    if (fuel && !places.includes('pumps')) places.unshift('pumps');
    let name: string;
    if (station) {
      // "Shell" on its own says little; "Shell, Tucumcari" says where you are.
      const near = nearestTown(at, spacing * 0.6);
      name = near && station.name.split(' ').length <= 2 ? `${station.name}, ${near.name}` : station.name;
      usedStations.add(station.at);
    } else if (town && kind === 'town') name = town.name;
    else {
      // Out-of-town stops borrow the nearest real town's name, the way real ones do.
      const nearby = nearestTown(at, spacing);
      if (nearby) name = `${nearby.name} ${pick(rng, OUTSKIRTS[kind])}`;
      else {
        // Made-up towns, without repeats until we run out.
        const left = MADE_UP_NAMES.filter((n) => !stops.some((st) => st.name === n));
        name = pick(rng, left.length ? left : MADE_UP_NAMES);
      }
      if (stops.some((st) => st.name === name)) name = `${name} ${pick(rng, OUTSKIRTS[kind])}`;
    }
    if (town) usedTowns.add(town.name);
    stops.push({
      id: `stop-${i}`,
      at: Math.max(400, Math.min(pathLength - 600, at)),
      side,
      kind,
      name,
      places,
      ...(station ? { real: true } : {}),
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
