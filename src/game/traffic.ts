import { classAt, isDivided, PROFILES, SPEED, type RoadClass, type RoadSegment } from './roads';
import { makeRng, pick, range, type Rng } from './rng';

/**
 * Other traffic on the road, and the lanes the player can steer between.
 * Pure game logic (no rendering) so it can be tested.
 *
 * Lanes are numbered with one integer: 0, 1, 2 … are the player's direction
 * counted out from the centre line (or median), and -1, -2 … are the
 * oncoming lanes counted out the other way. On an undivided road the player
 * may pull into an oncoming lane to pass, at their own risk.
 */
export type VehicleKind = 'car' | 'motorcycle' | 'pickup' | 'van' | 'truck';

export interface Vehicle {
  id: number;
  kind: VehicleKind;
  /** Distance along the path. */
  d: number;
  /** Lane, numbered as above (oncoming vehicles use negative lanes). */
  lane: number;
  /** Units per second, always positive; oncoming vehicles move toward lower d. */
  speed: number;
  /** The speed it would like to drive. */
  cruise: number;
  color: number;
}

export const VEHICLE_LENGTH: Record<VehicleKind, number> = { car: 4.4, motorcycle: 2.4, pickup: 5, van: 5.2, truck: 14 };
export const PLAYER_LENGTH = 4.4;

const COLORS = [0xe8e8e8, 0x2b2b30, 0x8a96a3, 0x9c2a22, 0x23457a, 0x3d6b45, 0xc9b27a, 0x6b4a8a];

/** Vehicles per 1000 units in each direction. Cities are busier. */
const DENSITY: Record<RoadClass, number> = { interstate: 3, metro: 8, highway: 2.5, local: 2 };

export const oncoming = (lane: number) => lane < 0;
/** Index out from the centre within its own side (0 = next to the centre line). */
export const sideIndex = (lane: number) => (lane < 0 ? -lane - 1 : lane);

/** Lanes each way at a distance. */
export function lanesAt(segments: RoadSegment[], d: number): number {
  return PROFILES[classAt(segments, d)].lanes;
}

/**
 * Sideways offset of a lane's centre (+ = right of the centre line), for a
 * road whose pavement edge is `edge` (lanes squeeze in proportion where the
 * road tapers between types).
 */
export function laneCenter(cls: RoadClass, lane: number, edge: number): number {
  const p = PROFILES[cls];
  const full = p.median + p.lanes * p.laneWidth;
  const i = Math.min(sideIndex(lane), p.lanes - 1);
  const x = (p.median + (i + 0.5) * p.laneWidth) * (edge / full);
  return oncoming(lane) ? -x : x;
}

/** The lane the car settles into by itself: the right lane, or second from the right on a wide city interstate. */
export function defaultLane(cls: RoadClass): number {
  const n = PROFILES[cls].lanes;
  return cls === 'metro' ? n - 2 : n - 1;
}

/** Keeps a lane valid when the road changes under it. */
export function clampLane(cls: RoadClass, lane: number): number {
  const n = PROFILES[cls].lanes;
  if (lane < 0 && isDivided(cls)) return 0;
  return Math.max(-n, Math.min(n - 1, lane));
}

export interface TrafficOptions {
  /** How busy the roads are (1 = normal). */
  density?: number;
  /** Extra traffic near the start, end and cities: 1 inside a city zone, 0 in the country. */
  urbanAt?: (d: number) => number;
}

export class Traffic {
  vehicles: Vehicle[] = [];
  private nextId = 1;
  private rng: Rng;
  private started = false;

  constructor(
    private segments: RoadSegment[],
    private pathLength: number,
    private baseSpeed: number,
    seed: number,
    private opts: TrafficOptions = {},
  ) {
    this.rng = makeRng(seed ^ 0x7a11c);
  }

  /** How many vehicles a stretch should have in one direction. */
  private wanted(from: number, to: number): number {
    let n = 0;
    for (let d = from; d < to; d += 100) {
      const cls = classAt(this.segments, d);
      const urban = this.opts.urbanAt?.(d) ?? 0;
      n += (DENSITY[cls] * (1 + urban * 1.5) * (this.opts.density ?? 1)) / 10;
    }
    return n;
  }

  private spawn(d: number, dir: 1 | -1): void {
    const cls = classAt(this.segments, d);
    const n = PROFILES[cls].lanes;
    const i = Math.floor(this.rng() * n);
    const lane = dir === 1 ? i : -i - 1;
    const r = this.rng();
    const kind: VehicleKind = r < 0.5 ? 'car' : r < 0.55 ? 'motorcycle' : r < 0.72 ? 'pickup' : r < 0.84 ? 'van' : 'truck';
    const road = this.baseSpeed * SPEED[cls].factor;
    // Your direction drives a bit slower than you so you pass them; trucks are slowest.
    const cruise = dir === 1 ? road * range(this.rng, 0.55, 0.8) * (kind === 'truck' ? 0.85 : 1) : road * range(this.rng, 0.8, 1.05);
    // Don't drop one on top of another.
    if (this.vehicles.some((v) => v.lane === lane && Math.abs(v.d - d) < 30)) return;
    this.vehicles.push({ id: this.nextId++, kind, d, lane, speed: cruise, cruise, color: pick(this.rng, COLORS) });
  }

  /**
   * Moves everything for one frame around the player at `playerD`, spawning
   * vehicles ahead and dropping the ones left behind.
   */
  step(dt: number, playerD: number): void {
    const behind = playerD - 120;
    const ahead = Math.min(this.pathLength, playerD + 1100);
    if (!this.started) {
      // Fill the road at once on the first frame.
      this.started = true;
      for (const dir of [1, -1] as const) {
        const want = Math.round(this.wanted(playerD + 40, ahead));
        for (let k = 0; k < want; k++) this.spawn(range(this.rng, playerD + 40, ahead), dir);
      }
    }
    for (const v of this.vehicles) {
      // Merge over when the road loses a lane.
      const n = PROFILES[classAt(this.segments, v.d)].lanes;
      if (sideIndex(v.lane) >= n) v.lane = oncoming(v.lane) ? -n : n - 1;
      // Slow down behind a slower vehicle in the same lane.
      const dir = oncoming(v.lane) ? -1 : 1;
      let speed = v.cruise;
      for (const o of this.vehicles) {
        if (o === v || o.lane !== v.lane) continue;
        const gap = (o.d - v.d) * dir;
        if (gap > 0 && gap < 12 + VEHICLE_LENGTH[o.kind]) speed = Math.min(speed, o.speed * 0.98);
      }
      v.speed += (speed - v.speed) * Math.min(1, dt * 2);
      v.d += v.speed * dt * dir;
    }
    this.vehicles = this.vehicles.filter((v) => v.d > behind && v.d < ahead + 50 && v.d > 0 && v.d < this.pathLength);
    // Top up: new ones appear far ahead (both directions) as the player drives on.
    for (const dir of [1, -1] as const) {
      const have = this.vehicles.filter((v) => (dir === 1) !== oncoming(v.lane) && v.d > playerD).length;
      const want = this.wanted(playerD, ahead);
      if (have < want && this.rng() < dt * 3) this.spawn(range(this.rng, ahead - 250, ahead), dir);
    }
  }

  /** The nearest vehicle ahead in a lane, within `range` units. */
  ahead(playerD: number, lane: number, within: number): Vehicle | null {
    let best: Vehicle | null = null;
    for (const v of this.vehicles) {
      if (v.lane !== lane) continue;
      const gap = v.d - playerD;
      if (gap > 0 && gap < within && (!best || gap < best.d - playerD)) best = v;
    }
    return best;
  }

  /** A vehicle overlapping the player (lateral offsets in road units), if any. */
  hit(playerD: number, playerX: number, xOf: (v: Vehicle) => number, playerLength = PLAYER_LENGTH): Vehicle | null {
    for (const v of this.vehicles) {
      if (Math.abs(v.d - playerD) > (VEHICLE_LENGTH[v.kind] + playerLength) / 2) continue;
      if (Math.abs(xOf(v) - playerX) < 2.1) return v;
    }
    return null;
  }

  remove(v: Vehicle): void {
    this.vehicles = this.vehicles.filter((x) => x !== v);
  }

  /** Clears the road near a point (after a crash, or when a fight starts). */
  clearNear(d: number, radius: number): void {
    this.vehicles = this.vehicles.filter((v) => Math.abs(v.d - d) > radius);
  }
}
