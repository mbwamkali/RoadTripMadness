import { describe, expect, it } from 'vitest';
import { buildRouteData, pathFromRoute } from '../src/geo/route';
import { demoRawRoute } from '../src/geo/demoRoute';
import { advance, buyFuel, fuelAffordable, fuelCost, fuelPrice, fuelPerUnit, gasGapFor, newGame, RANGE_MILES, repair, search, upcomingStop, TANK } from '../src/game/state';
import { hasFuel } from '../src/game/stops';
import { boost, combatOutcome, createCombat, fireAt, horn, stepCombat } from '../src/game/combat';

const route = buildRouteData(demoRawRoute());
const path = pathFromRoute(route);

describe('trip', () => {
  it('generates evenly spaced stops with regular chances to refuel', () => {
    const s = newGame(route, 42);
    expect(s.stops.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < s.stops.length; i++) expect(s.stops[i].at - s.stops[i - 1].at).toBeGreaterThanOrEqual(500);
    // Pumps are never further apart than 60% of a tank's range.
    const gap = gasGapFor('car', route.scale);
    let last = 0;
    for (const st of s.stops.filter(hasFuel)) {
      expect(st.at - last).toBeLessThanOrEqual(gap + 1);
      last = st.at;
    }
  });

  it('a full tank goes a set number of real miles, whatever the trip length', () => {
    const units = TANK / fuelPerUnit(route.scale);
    expect((units * route.scale) / 1609.344).toBeCloseTo(RANGE_MILES, 5);
  });

  it('burns fuel while driving and fires encounters', () => {
    const s = newGame(route, 1);
    const fuel = s.inv.fuel;
    let encounters = 0;
    for (let i = 0; i < 200; i++) if (advance(s, path, 30).encounter) encounters++;
    expect(s.inv.fuel).toBeLessThan(fuel);
    expect(encounters).toBeGreaterThan(0);
  });

  it('offers the bike the first time the tank runs dry, and ends the trip the second time', () => {
    const s = newGame(route, 1);
    s.inv.fuel = 0.01;
    expect(advance(s, path, 50).outOfFuel).toBe(true);
    expect(s.status).toBe('driving');
    s.bikeUsed = true;
    expect(advance(s, path, 50).outOfFuel).toBe(true);
    expect(s.status).toBe('lost');
  });

  it('wins on arrival', () => {
    const s = newGame(route, 1);
    s.inv.fuel = 1e9;
    s.nextEncounterAt = Infinity;
    s.bossStage = 2;
    expect(advance(s, path, path.length + 10).arrived).toBe(true);
    expect(s.status).toBe('won');
  });

  it('shows the next stop only when it is close', () => {
    const s = newGame(route, 3);
    const first = s.stops[0];
    s.distance = first.at - 2000;
    expect(upcomingStop(s, 500)).toBeUndefined();
    s.distance = first.at - 300;
    expect(upcomingStop(s, 500)?.id).toBe(first.id);
    s.passed.push(first.id);
    expect(upcomingStop(s, 500)?.id).not.toBe(first.id);
  });
});

describe('scavenging and shops', () => {
  it('buys only the fuel you can afford', () => {
    const s = newGame(route, 1);
    s.inv.fuel = 50;
    s.inv.cash = 7;
    const n = fuelAffordable(s);
    expect(n).toBeGreaterThan(0);
    expect(fuelCost(s, n + 1)).toBeGreaterThan(7);
    expect(buyFuel(s).ok).toBe(true);
    expect(s.inv.fuel).toBe(50 + n);
    expect(s.inv.cash).toBe(7 - fuelCost(s, n));
  });

  it('repairs using scrap before cash', () => {
    const s = newGame(route, 1);
    s.health = 90;
    s.inv.scrap = 2;
    s.inv.cash = 100;
    repair(s);
    expect(s.health).toBe(100);
    expect(s.inv.scrap).toBe(0);
    expect(s.inv.cash).toBe(94);
  });

  it('gets riskier the more you search one place', () => {
    let ambushes = 0;
    for (let seed = 0; seed < 200; seed++) {
      const s = newGame(route, seed);
      for (let i = 0; i < 4; i++) if (search(s, 'stop-1', 'grocery').ambush) ambushes++;
    }
    expect(ambushes).toBeGreaterThan(200 * 0.3);
    expect(ambushes).toBeLessThan(200 * 3.5);
  });
});

describe('combat', () => {
  const inv = () => ({ fuel: 50, cash: 0, scrap: 0, bullets: 100, shells: 10, catnip: 2 });

  it('spawns enemies over time and lets you shoot them', () => {
    const c = createCombat({ seed: 9, progress: 0.1 });
    const bag = inv();
    for (let i = 0; i < 60; i++) stepCombat(c, 0.05);
    expect(c.enemies.length).toBeGreaterThan(0);
    const target = c.enemies[0];
    for (let i = 0; i < 10; i++) {
      c.fireCooldown = 0;
      fireAt(c, bag, target.id);
    }
    expect(bag.bullets).toBeLessThan(100);
    expect(c.kills).toBeGreaterThan(0);
  });

  it('falls back to rocks when out of ammo', () => {
    const c = createCombat({ seed: 9, progress: 0.1 });
    const bag = { ...inv(), bullets: 0 };
    for (let i = 0; i < 60; i++) stepCombat(c, 0.05);
    fireAt(c, bag, c.enemies[0].id);
    expect(c.events.some((e) => e.kind === 'shot' && e.weapon === 'rocks')).toBe(true);
  });

  it('hurts the car if you do nothing, and ends by escape', () => {
    const c = createCombat({ seed: 4, progress: 0.8 });
    let dmg = 0;
    while (!combatOutcome(c) && c.time < 120) dmg += stepCombat(c, 0.05);
    expect(dmg).toBeGreaterThan(0);
    expect(combatOutcome(c)).not.toBeNull();
  });

  it('has cooldowns on horn and boost, and boost costs fuel', () => {
    const c = createCombat({ seed: 1, progress: 0.5 });
    const bag = inv();
    expect(horn(c)).toBe(true);
    expect(horn(c)).toBe(false);
    expect(boost(c, bag)).toBe(true);
    expect(bag.fuel).toBe(46);
    expect(boost(c, bag)).toBe(false);
  });

  it('gas gets cheaper on long trips, down to 30%', () => {
    expect(fuelPrice({ route: { realMeters: 300 * 1609.344 } })).toBe(1);
    expect(fuelPrice({ route: { realMeters: 1600 * 1609.344 } })).toBe(0.5);
    expect(fuelPrice({ route: { realMeters: 2800 * 1609.344 } })).toBe(0.3);
  });
});
