import { classAt, isDivided, type RoadClass, type RoadSegment } from './roads';
import { makeRng, range, type Rng } from './rng';
import { damage, type GameState } from './state';

/**
 * Animals crossing the road: cows wander over country roads and giant
 * armadillos lumber across freeways. They walk slowly across the lanes, so
 * you can slow down and let them finish, swerve round them, or honk and
 * they hurry out of your way. Hitting one is only a bump: the animal is
 * dazed and trots off, never hurt. Pure game logic so it can be tested.
 */
export type AnimalKind = 'cow' | 'armadillo';

export type AnimalMode =
  /** Standing at the roadside, waiting for the car to come close. */
  | 'waiting'
  /** Walking slowly across. */
  | 'crossing'
  /** Honked at: trotting out of your way. */
  | 'hurry'
  /** Bumped: trots off, can't be hit again. */
  | 'dazed'
  /** Across, grazing by the road. */
  | 'done';

export interface Animal {
  id: number;
  kind: AnimalKind;
  /** Herd it belongs to (one announcement per herd). */
  herd: number;
  d: number;
  /** Sideways offset from the centre line (+ = the player's right). */
  x: number;
  /** Which way it walks across: -1 toward the left, 1 toward the right. */
  dir: -1 | 1;
  mode: AnimalMode;
  /** Seconds before the car arrives when it sets off (so it is in the road when you get there). */
  lead: number;
}

export const ANIMALS: Record<AnimalKind, { name: string; icon: string; length: number; width: number; walk: number }> = {
  // They walk across the road, so `length` (along the road) is the body's width and `width` (across it) its length.
  cow: { name: 'cow', icon: '🐄', length: 1.4, width: 2.4, walk: 1.5 },
  armadillo: { name: 'giant armadillo', icon: '🦔', length: 1.9, width: 2.8, walk: 2 },
};

/** How much faster they move when honked at or bumped. */
export const HURRY = 4;
/** Honking reaches animals this far ahead (and a little behind). */
export const HONK_RANGE = 160;

/** Car health a bump costs: 2, softened by the ram plate to 0 at full strength. */
export function animalBump(ramLevel: number): number {
  return Math.max(0, 2 - Math.floor(ramLevel * 0.7));
}

/** Cows on country roads and highways, giant armadillos on freeways (and sometimes desert highways). */
export function animalFor(cls: RoadClass, desert: boolean, r: number): AnimalKind {
  if (isDivided(cls)) return 'armadillo';
  if (desert && cls === 'highway' && r < 0.5) return 'armadillo';
  return 'cow';
}

export interface AnimalOptions {
  /** How often animals turn up here: 1 normally, 2 in Texas and the desert. */
  boost?: (d: number) => number;
  /** No animals here (towns, bridges, tunnels). */
  blocked?: (d: number) => boolean;
  /** In the desert (armadillos on highways too). */
  desertAt?: (d: number) => boolean;
  /** The road's edge (distance from the centre line to the outer pavement). */
  edgeAt?: (d: number) => number;
}

/** Average distance between animal crossings (game units) where the boost is 1. */
export const ANIMAL_GAP = 2600;

export class Animals {
  list: Animal[] = [];
  private nextId = 1;
  private nextHerd = 1;
  private nextAt: number;
  private rng: Rng;

  constructor(
    private segments: RoadSegment[],
    private pathLength: number,
    seed: number,
    startAt: number,
    private opts: AnimalOptions = {},
  ) {
    this.rng = makeRng(seed ^ 0xa1e1);
    this.nextAt = startAt + range(this.rng, 900, 1800);
  }

  private edge(d: number): number {
    return this.opts.edgeAt?.(d) ?? 4.5;
  }

  /**
   * Places new animals ahead, starts them walking as the car nears, moves
   * them and drops the ones left behind. `playerSpeed` is in units a second.
   */
  step(dt: number, playerD: number, playerSpeed: number): void {
    while (this.nextAt < playerD + 900 && this.nextAt < this.pathLength - 500) {
      const at = this.nextAt;
      const boost = Math.max(0.2, this.opts.boost?.(at) ?? 1);
      this.nextAt += (range(this.rng, 0.6, 1.4) * ANIMAL_GAP) / boost;
      if (at > playerD + 250 && !this.opts.blocked?.(at)) this.spawn(at);
    }
    for (const a of this.list) {
      const gap = a.d - playerD;
      if (a.mode === 'waiting' && gap < Math.max(40, playerSpeed * a.lead)) a.mode = 'crossing';
      if (a.mode === 'waiting' || a.mode === 'done') continue;
      const k = ANIMALS[a.kind];
      a.x += a.dir * k.walk * (a.mode === 'crossing' ? 1 : HURRY) * dt;
      const far = this.edge(a.d) + 3;
      if (Math.abs(a.x) > far && Math.sign(a.x) === a.dir) {
        a.x = a.dir * far;
        a.mode = 'done';
      }
    }
    this.list = this.list.filter((a) => a.d > playerD - 40);
  }

  private spawn(d: number): void {
    const cls = classAt(this.segments, d);
    const kind = animalFor(cls, !!this.opts.desertAt?.(d), this.rng());
    // Cows come in small herds on country roads; armadillos alone or in pairs.
    const n = kind === 'cow' ? 1 + Math.floor(this.rng() * (cls === 'local' ? 3 : 2)) : this.rng() < 0.2 ? 2 : 1;
    const dir: -1 | 1 = this.rng() < 0.5 ? -1 : 1;
    const herd = this.nextHerd++;
    const lead = range(this.rng, 2.4, 4.2);
    const start = -dir * (this.edge(d) + 2);
    for (let i = 0; i < n; i++) {
      this.list.push({
        id: this.nextId++,
        kind,
        herd,
        d: d + i * 3.2 + (this.rng() - 0.5),
        // Followers trail behind the leader, so a herd spreads across more lanes.
        x: start - dir * i * 2.6,
        dir,
        mode: 'waiting',
        lead,
      });
    }
  }

  /** Animals still in the way (or about to be). */
  get active(): Animal[] {
    return this.list.filter((a) => a.mode === 'crossing' || a.mode === 'waiting' || a.mode === 'hurry');
  }

  /** The nearest animal ahead that is on the road or about to step onto it. */
  nearest(playerD: number, within: number): Animal | null {
    let best: Animal | null = null;
    for (const a of this.list) {
      if (a.mode === 'done' || a.mode === 'dazed') continue;
      const gap = a.d - playerD;
      if (gap > -2 && gap < within && (!best || a.d < best.d)) best = a;
    }
    return best;
  }

  /** The nearest animal ahead standing in the car's path (within a lane's width of `playerX`). */
  inPath(playerD: number, playerX: number, within: number): Animal | null {
    let best: Animal | null = null;
    for (const a of this.list) {
      if (a.mode !== 'crossing' && a.mode !== 'hurry') continue;
      const gap = a.d - playerD;
      if (gap <= 0 || gap > within) continue;
      if (Math.abs(a.x - playerX) > ANIMALS[a.kind].width / 2 + 2.2) continue;
      if (!best || a.d < best.d) best = a;
    }
    return best;
  }

  /**
   * Honk: every animal in range trots off the road, away from the car.
   * Returns how many were moved along.
   */
  honk(playerD: number, playerX: number): number {
    let n = 0;
    for (const a of this.list) {
      if (a.mode === 'done' || a.mode === 'dazed') continue;
      const gap = a.d - playerD;
      if (gap < -10 || gap > HONK_RANGE) continue;
      a.mode = 'hurry';
      // Away from the car, so it leaves your lane rather than crossing it.
      a.dir = a.x >= playerX ? 1 : -1;
      n++;
    }
    return n;
  }

  /** An animal the car overlaps, if any (dazed and grazing ones are out of the way). */
  hit(playerD: number, playerX: number, playerLength = 4.4): Animal | null {
    for (const a of this.list) {
      if (a.mode === 'dazed' || a.mode === 'done' || a.mode === 'waiting') continue;
      const k = ANIMALS[a.kind];
      if (Math.abs(a.d - playerD) > (k.length + playerLength) / 2) continue;
      if (Math.abs(a.x - playerX) < (k.width + 2) / 2) return a;
    }
    return null;
  }
}

/** A bump: a little car health, and the animal trots off dazed (never hurt, never a kill). */
export function bumpAnimal(s: GameState, a: Animal, playerX: number): number {
  const cost = animalBump(s.upgrades.ram);
  if (cost) damage(s, cost);
  a.mode = 'dazed';
  a.dir = a.x >= playerX ? 1 : -1;
  return cost;
}
