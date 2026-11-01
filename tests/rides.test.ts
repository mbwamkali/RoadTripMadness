import { describe, expect, it } from 'vitest';
import { buildRouteData, pathFromRoute } from '../src/geo/route';
import { demoRawRoute } from '../src/geo/demoRoute';
import { advance, maxHealth, newGame, tankSize } from '../src/game/state';
import { createCombat, stepCombat } from '../src/game/combat';
import { ramObstacle } from '../src/game/obstacles';
import { RIDES } from '../src/game/rides';

const route = buildRouteData(demoRawRoute());
const path = pathFromRoute(route);

describe('vehicle types', () => {
  it('the car is the default and old saves without a ride still work', () => {
    const s = newGame(route, 1);
    expect(s.ride).toBeUndefined();
    expect(maxHealth(s)).toBe(100);
    expect(s.health).toBe(100);
  });

  it('the motorcycle is fragile and carries less; the truck is tough and carries more', () => {
    const moto = newGame(route, 1, 'normal', 'motorcycle');
    const car = newGame(route, 1, 'normal', 'car');
    const truck = newGame(route, 1, 'normal', 'truck');
    expect(moto.health).toBeLessThan(car.health);
    expect(truck.health).toBeGreaterThan(car.health);
    expect(truck.health).toBe(maxHealth(truck));
    expect(tankSize(truck)).toBeGreaterThan(tankSize(car));
    expect(moto.inv.bullets).toBeLessThan(car.inv.bullets);
    expect(truck.inv.bullets).toBeGreaterThan(car.inv.bullets);
    expect(moto.inv.fuel).toBeLessThanOrEqual(tankSize(moto));
  });

  it('a tank of gas takes every ride about as far', () => {
    const range = (ride: 'motorcycle' | 'car' | 'truck') => {
      const s = newGame(route, 1, 'normal', ride);
      s.inv.fuel = tankSize(s);
      s.nextEncounterAt = s.nextEventAt = 1e9;
      s.bossStage = 2;
      let d = 0;
      while (s.inv.fuel > 0 && s.status === 'driving' && d < path.length) {
        advance(s, path, 10);
        d += 10;
      }
      return d;
    };
    const car = range('car');
    for (const r of ['motorcycle', 'truck'] as const) expect(Math.abs(range(r) - car) / car).toBeLessThan(0.15);
  });

  it('ramming hurts the bike more and the truck less', () => {
    const cost = (ride: 'motorcycle' | 'car' | 'truck') => ramObstacle(newGame(route, 1, 'normal', ride), { id: 1, kind: 'wreck', d: 0, lane: 0, hp: 3 });
    expect(cost('motorcycle')).toBeGreaterThan(cost('car'));
    expect(cost('truck')).toBeLessThan(cost('car'));
  });

  it('a nimble ride dodges some hits in a fight', () => {
    const taken = (dodge: number) => {
      let total = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const c = createCombat({ seed, progress: 0.5, ambush: true, dodge });
        for (let i = 0; i < 400; i++) total += stepCombat(c, 0.05);
      }
      return total;
    };
    expect(taken(RIDES.motorcycle.dodge)).toBeLessThan(taken(0));
  });
});
