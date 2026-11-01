import { describe, expect, it } from 'vitest';
import { buildRouteData } from '../src/geo/route';
import { demoRawRoute } from '../src/geo/demoRoute';
import { newGame, tankSize } from '../src/game/state';
import { hasFuel } from '../src/game/stops';
import { canUseBike, planBikeRide, rideForGas } from '../src/game/rescue';

const route = buildRouteData(demoRawRoute());

describe('bike rescue', () => {
  it('heads for the nearest pumps, ahead or behind', () => {
    const s = newGame(route, 1);
    const pumps = s.stops.filter(hasFuel);
    s.distance = pumps[1].at + 30;
    const plan = planBikeRide(s);
    expect(plan.stop?.id).toBe(pumps[1].id);
    expect(plan.ahead).toBe(false);
    expect(plan.hours).toBeGreaterThanOrEqual(1);
    expect(plan.hours).toBeLessThanOrEqual(10);
  });

  it('brings back a can of gas, moves the clock, and only works once', () => {
    const s = newGame(route, 1);
    s.distance = 3000;
    s.inv.fuel = 0;
    s.inv.cash = 500;
    expect(canUseBike(s)).toBe(true);
    const out = rideForGas(s);
    expect(s.inv.fuel).toBeGreaterThan(0);
    expect(s.inv.fuel).toBeLessThanOrEqual(tankSize(s) * 0.3);
    expect(s.hoursSpent).toBe(out.hours);
    expect(s.inv.cash).toBeLessThan(500);
    expect(out.story.length).toBeGreaterThanOrEqual(3);
    expect(canUseBike(s)).toBe(false);
  });

  it('siphons a smaller can when you are broke', () => {
    const fuelWith = (cash: number) => {
      const s = newGame(route, 1);
      s.distance = 3000;
      s.inv.fuel = 0;
      s.inv.cash = cash;
      rideForGas(s);
      return { fuel: s.inv.fuel, cash: s.inv.cash };
    };
    const broke = fuelWith(0);
    expect(broke.cash).toBe(0);
    expect(broke.fuel).toBeGreaterThan(0);
    expect(broke.fuel).toBeLessThanOrEqual(fuelWith(500).fuel);
  });
});
