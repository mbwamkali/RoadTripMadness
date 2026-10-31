import type { RouteData } from '../geo/route';
import { hashString, makeRng, pick, type Rng } from './rng';

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

  const realTurns = route.steps.filter((s) => s.modifier && /left|right/.test(s.modifier) && s.name);
  const stops: Stop[] = [];
  for (let i = 1; i <= count; i++) {
    const ideal = i * spacing;
    // Snap to a real turn if one is near the ideal spot.
    const near = realTurns.find((t) => Math.abs(t.at - ideal) < spacing * 0.3);
    const at = near ? near.at : ideal + (rng() - 0.5) * spacing * 0.3;
    const side: Stop['side'] = near?.modifier?.includes('left') ? 'left' : near?.modifier?.includes('right') ? 'right' : rng() < 0.5 ? 'left' : 'right';
    const kind = i % 3 === 1 ? pick(rng, ['gas', 'truckstop', 'town'] as const) : pickKind(rng);
    const places = pick(rng, PLACES_BY_KIND[kind]).slice();
    if (i % 3 === 1 && !places.includes('pumps')) places.unshift('pumps');
    stops.push({
      id: `stop-${i}`,
      at: Math.max(400, Math.min(pathLength - 600, at)),
      side,
      kind,
      name: near?.name || pick(rng, MADE_UP_NAMES),
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
