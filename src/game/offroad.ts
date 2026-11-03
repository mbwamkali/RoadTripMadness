/**
 * Leaving the road. Driving stays lane-based, so going off-road is a few
 * more positions past the last lane: steer right from the outside lane onto
 * the shoulder (or the sidewalk in town), then out onto the verge; on a
 * two-way road the same works on the left, and on a freeway steering left
 * from the inside lane runs onto the grass median, or into the concrete
 * barrier in the city. Off the road the car is slower and bumpy. Things at
 * the roadside are solid: small ones (posts, signs, street lights) get
 * knocked flat; big ones (buildings, trees, rocks, barriers, bridge rails)
 * stop you hard and bounce you back. Enough crashes wreck the car, and the
 * townsfolk are glad: the sidewalk is safe again. Kid mode halves the
 * damage. Autopilot never leaves the road. Pure logic so it can be tested.
 */

export interface OffRoad {
  /** Which side of the road: -1 left, 1 right. */
  side: -1 | 1;
  /** 1 = the shoulder, sidewalk or median; 2 = out on the verge. */
  step: 1 | 2;
}

export type SolidKind = 'delineator' | 'sign' | 'mile' | 'lamp' | 'pole' | 'tree' | 'rock' | 'building' | 'barrier' | 'guardrail' | 'bridge';

/** What each roadside thing does when you hit it. Big ones stop you; small ones fall over. */
export const SOLIDS: Record<SolidKind, { name: string; big: boolean; damage: number }> = {
  delineator: { name: 'a reflector post', big: false, damage: 0 },
  mile: { name: 'a mile marker', big: false, damage: 1 },
  sign: { name: 'a sign', big: false, damage: 1 },
  lamp: { name: 'a street light', big: false, damage: 2 },
  pole: { name: 'a telephone pole', big: false, damage: 2 },
  tree: { name: 'a tree', big: true, damage: 8 },
  rock: { name: 'a big rock', big: true, damage: 8 },
  building: { name: 'a building', big: true, damage: 12 },
  barrier: { name: 'the concrete barrier', big: true, damage: 6 },
  guardrail: { name: 'the guardrail', big: true, damage: 5 },
  bridge: { name: 'the bridge rail', big: true, damage: 6 },
};

/** How fast the car goes off the road, as a share of its speed on it. */
export const OFFROAD_SPEED = { paved: 0.9, sidewalk: 0.75, rough: 0.6 };

/** The road around the car, for working out where it can go. */
export interface Roadside {
  divided: boolean;
  /** A concrete barrier down the middle (city freeways). */
  barrierMedian: boolean;
  /** At the outermost lane on this side already (steering further leaves the road). */
  atEdge: boolean;
}

export type SteerResult =
  | { kind: 'lane' }
  | { kind: 'leave'; off: OffRoad }
  | { kind: 'move'; off: OffRoad }
  | { kind: 'back' }
  | { kind: 'crash'; what: SolidKind; off: OffRoad | null }
  | { kind: 'blocked' };

/**
 * What a sideways steer does, given where the car is. `further` names a big
 * thing in the way when steering out past the verge (a building, a tree), if
 * any. Returns 'lane' when it's an ordinary lane change for the caller.
 */
export function steerOffRoad(off: OffRoad | null, dir: -1 | 1, road: Roadside, further: SolidKind | null = null): SteerResult {
  if (!off) {
    if (!road.atEdge) return { kind: 'lane' };
    // Left from the inside lane of a freeway: the median.
    if (road.divided && dir < 0) {
      if (road.barrierMedian) return { kind: 'crash', what: 'barrier', off: null };
      return { kind: 'leave', off: { side: -1, step: 1 } };
    }
    return { kind: 'leave', off: { side: dir, step: 1 } };
  }
  if (dir !== off.side) {
    if (off.step === 2) return { kind: 'move', off: { side: off.side, step: 1 } };
    return { kind: 'back' };
  }
  // Further out. The median only has room for one step.
  if (off.step === 1) {
    if (road.divided && off.side < 0) return { kind: 'blocked' };
    return { kind: 'move', off: { side: off.side, step: 2 } };
  }
  if (further) return { kind: 'crash', what: further, off: { side: off.side, step: 1 } };
  return { kind: 'blocked' };
}

export interface CrashScale {
  /** The difficulty's damage multiplier. */
  dmg?: number;
  /** Speed: crashing fast hurts more (driving.ts crashScale). */
  speed?: number;
  /** The ride's ram toughness (rides.ts). */
  ram?: number;
  kid?: boolean;
}

/** Car health lost hitting one. Kid mode halves it but never below 1 (a free knock stays free). */
export function crashCost(what: SolidKind, scale: CrashScale = {}): number {
  const base = SOLIDS[what].damage;
  if (!base) return 0;
  const raw = base * (scale.dmg ?? 1) * (scale.speed ?? 1) * (scale.ram ?? 1);
  return Math.max(1, Math.round(scale.kid ? raw / 2 : raw));
}

/** The end-of-trip line when off-road crashes wreck the car: the silly ending. */
export function offRoadWreckReason(inTown: boolean): string {
  return inTown
    ? 'The townsfolk cheer! Your car is wrecked, so the sidewalk is safe again.'
    : 'The cows cheer! Your car is wrecked in a ditch, so the roadside is safe again.';
}

/**
 * The car's sideways position off the road (+ = right of the centre line).
 * `edge` is the outside of the lanes, `shoulder` the paved shoulder width,
 * `sidewalk` the sidewalk width (0 when there is none), `median` the median's half-width.
 */
export function offRoadX(off: OffRoad, at: { edge: number; shoulder: number; sidewalk: number; median: number; divided: boolean }): number {
  // On a freeway the left side is the grass median, still on your own side of the centre.
  if (at.divided && off.side < 0) return medianX(at.median);
  const strip = at.sidewalk > 0 ? at.sidewalk : at.shoulder;
  const x = off.step === 1 ? at.edge + Math.max(1.4, strip / 2 + 0.2) : at.edge + strip + 3.2;
  return off.side * x;
}

/** On a freeway, the grass median: a little in from the inside lane, still on your own side. */
export function medianX(median: number): number {
  return Math.max(0.6, median * 0.45);
}
