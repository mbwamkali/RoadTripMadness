import { PROFILES, type RoadClass } from './roads';

/**
 * The road a fight takes place on, laid out to match the road you were
 * driving. Fights keep their own lane rules (the car swings about ±2.6 units
 * from the middle), so the layout centres your side of the road on x = 0 and
 * adds the rest around it.
 *
 * x grows to the right; widths are in road units (metres).
 */
export type FightSurface = 'local' | 'highway' | 'carriageway' | 'carriageway2';

export interface FightRoad {
  /** Paved strips: the lane texture to use, its centre, width, and whether it runs the other way. */
  strips: { kind: FightSurface; x: number; width: number; flipped: boolean }[];
  /** Plain asphalt shoulders. */
  shoulders: { x: number; width: number }[];
  /** Outer edges of everything paved (reflector posts stand just outside). */
  left: number;
  right: number;
  /** A grass median between the two directions (divided roads only). */
  median: { x: number; width: number } | null;
}

const SHOULDER = 2.4;

export function fightRoad(cls: RoadClass): FightRoad {
  const p = PROFILES[cls];
  if (cls === 'local') return { strips: [{ kind: 'local', x: 0, width: 10, flipped: false }], shoulders: [], left: -5, right: 5, median: null };
  const side = p.lanes * p.laneWidth;
  if (cls === 'highway') {
    // Undivided four-lane highway: your two lanes on the right of the double yellow line.
    return { strips: [{ kind: 'highway', x: -side / 2, width: side * 2, flipped: false }], shoulders: [], left: -side * 1.5, right: side / 2, median: null };
  }
  // Divided interstate: your carriageway in the middle, shoulders, a grass median, the other carriageway beyond.
  const kind: FightSurface = cls === 'metro' ? 'carriageway' : 'carriageway2';
  const half = side / 2;
  const median = p.median * 2;
  const farX = -half - SHOULDER - median - SHOULDER - half;
  return {
    strips: [
      { kind, x: 0, width: side, flipped: false },
      { kind, x: farX, width: side, flipped: true },
    ],
    shoulders: [
      { x: half + SHOULDER / 2, width: SHOULDER },
      { x: -half - SHOULDER / 2, width: SHOULDER },
      { x: farX + half + SHOULDER / 2, width: SHOULDER },
      { x: farX - half - SHOULDER / 2, width: SHOULDER },
    ],
    left: farX - half - SHOULDER,
    right: half + SHOULDER,
    median: { x: -half - SHOULDER - median / 2, width: median },
  };
}
