import { classAt, PROFILES, type RoadSegment } from './roads';
import { makeRng, range, type Rng } from './rng';
import type { GameState } from './state';
import { damage } from './state';
import { DIFFICULTIES } from './difficulty';
import { rideOf } from './rides';

/**
 * Small threats on the road itself: dodge them, ram them or shoot them.
 * Big fights still happen in the fight view; these never stop the car.
 * Pure game logic so it can be tested.
 */
export type ObstacleKind = 'debris' | 'zombie' | 'wreck' | 'roadblock';

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  d: number;
  /** One of the player's lanes (0 = next to the centre line). */
  lane: number;
  hp: number;
}

export const OBSTACLES: Record<ObstacleKind, { name: string; hp: number; ram: number; length: number; width: number; scrap: number }> = {
  debris: { name: 'debris', hp: 1, ram: 4, length: 2, width: 2.4, scrap: 0 },
  zombie: { name: 'a zombie', hp: 1, ram: 3, length: 1, width: 1.4, scrap: 1 },
  wreck: { name: 'a wreck', hp: 3, ram: 12, length: 4.4, width: 2.2, scrap: 3 },
  roadblock: { name: 'a roadblock', hp: 4, ram: 16, length: 1.2, width: 3.2, scrap: 2 },
};

/** How far ahead you can shoot something in your lane. */
export const SHOOT_RANGE = 90;

/** Car health lost ramming one. The ram plate softens it (zombies bounce off a full plate). */
export function ramCost(kind: ObstacleKind, ramLevel: number, dmgScale = 1): number {
  if (kind === 'zombie') return Math.max(0, Math.round((3 - ramLevel) * dmgScale));
  return Math.max(1, Math.round(OBSTACLES[kind].ram * Math.max(0.4, 1 - ramLevel * 0.2) * dmgScale));
}

export class Obstacles {
  list: Obstacle[] = [];
  private nextId = 1;
  private nextAt: number;
  private rng: Rng;
  private gap: number;

  constructor(
    private segments: RoadSegment[],
    private pathLength: number,
    seed: number,
    startAt: number,
    /** Bigger means fewer (the difficulty's gap between fights). */
    gapScale = 1,
  ) {
    this.rng = makeRng(seed ^ 0x0b57ac1e);
    this.gap = gapScale;
    this.nextAt = startAt + range(this.rng, 300, 700);
  }

  /** Places new obstacles ahead and drops the ones left behind. */
  step(playerD: number): void {
    while (this.nextAt < playerD + 700 && this.nextAt < this.pathLength - 400) {
      if (this.nextAt > playerD + 150) this.spawn(this.nextAt);
      this.nextAt += range(this.rng, 450, 1100) * this.gap;
    }
    this.list = this.list.filter((o) => o.d > playerD - 40);
  }

  private spawn(d: number): void {
    const r = this.rng();
    const kind: ObstacleKind = r < 0.4 ? 'zombie' : r < 0.7 ? 'debris' : r < 0.9 ? 'wreck' : 'roadblock';
    const lanes = PROFILES[classAt(this.segments, d)].lanes;
    const lane = Math.floor(this.rng() * lanes);
    this.list.push({ id: this.nextId++, kind, d, lane, hp: OBSTACLES[kind].hp });
  }

  /** The nearest obstacle ahead in a lane, within `within` units. */
  ahead(playerD: number, lane: number, within: number): Obstacle | null {
    let best: Obstacle | null = null;
    for (const o of this.list) {
      const gap = o.d - playerD;
      if (o.lane === lane && gap > 0 && gap < within && (!best || o.d < best.d)) best = o;
    }
    return best;
  }

  /** An obstacle the player overlaps (lateral offsets in road units), if any. */
  hit(playerD: number, playerX: number, xOf: (o: Obstacle) => number, playerLength = 4.4): Obstacle | null {
    for (const o of this.list) {
      const k = OBSTACLES[o.kind];
      if (Math.abs(o.d - playerD) > (k.length + playerLength) / 2) continue;
      if (Math.abs(xOf(o) - playerX) < (k.width + 2) / 2) return o;
    }
    return null;
  }

  remove(o: Obstacle): void {
    this.list = this.list.filter((x) => x !== o);
  }
}

/** Driving into one: costs car health, clears it, and a zombie counts as a kill. */
export function ramObstacle(s: GameState, o: Obstacle): number {
  const cost = ramCost(o.kind, s.upgrades.ram, DIFFICULTIES[s.difficulty].dmg * rideOf(s).ram);
  damage(s, cost);
  if (o.kind === 'zombie') s.kills++;
  return cost;
}

/**
 * One shot at an obstacle: spends a bullet (or a shell when out of bullets,
 * which hits harder). The roof turret adds damage. Returns null with no ammo.
 */
export function shootObstacle(s: GameState, o: Obstacle): { destroyed: boolean; scrap: number; ammo: 'bullets' | 'shells' } | null {
  const ammo = s.inv.bullets > 0 ? 'bullets' : s.inv.shells > 0 ? 'shells' : null;
  if (!ammo) return null;
  s.inv[ammo]--;
  o.hp -= ((ammo === 'shells' ? 3 : 1) + s.upgrades.turret) * Math.max(1, rideOf(s).gun);
  if (o.hp > 0) return { destroyed: false, scrap: 0, ammo };
  const scrap = OBSTACLES[o.kind].scrap;
  s.inv.scrap += scrap;
  if (o.kind === 'zombie') s.kills++;
  return { destroyed: true, scrap, ammo };
}
