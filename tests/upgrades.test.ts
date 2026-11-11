import { describe, expect, it } from 'vitest';
import { buildRouteData, pathFromRoute } from '../src/geo/route';
import { demoRawRoute } from '../src/geo/demoRoute';
import { advance, buyFuel, buyUpgrade, cashScale, maxHealth, newGame, tankSize } from '../src/game/state';
import { createCombat, stepCombat } from '../src/game/combat';

const route = buildRouteData(demoRawRoute());
const path = pathFromRoute(route);

describe('car upgrades', () => {
  it('costs scrap and cash and raises max condition', () => {
    const s = newGame(route, 1);
    s.inv.scrap = 100;
    s.inv.cash = 100;
    expect(buyUpgrade(s, 'armor').ok).toBe(true);
    expect(maxHealth(s)).toBe(125);
    expect(s.health).toBe(125);
    expect(s.inv.scrap).toBe(88);
    expect(s.inv.cash).toBe(100 - Math.round(20 * cashScale(s)));
  });

  it('refuses when you cannot pay or it is maxed', () => {
    const s = newGame(route, 1);
    s.inv.scrap = 0;
    expect(buyUpgrade(s, 'tank').ok).toBe(false);
    s.upgrades.tank = 3;
    s.inv.scrap = 999;
    s.inv.cash = 999;
    expect(buyUpgrade(s, 'tank').ok).toBe(false);
  });

  it('a bigger tank holds more fuel and a tune-up burns less', () => {
    const s = newGame(route, 1);
    s.upgrades.tank = 2;
    s.inv.cash = 1000;
    buyFuel(s);
    expect(s.inv.fuel).toBe(tankSize(s));
    expect(tankSize(s)).toBe(160);

    const a = newGame(route, 2);
    const b = newGame(route, 2);
    b.upgrades.engine = 3;
    a.nextEncounterAt = b.nextEncounterAt = Infinity;
    advance(a, path, 2000);
    advance(b, path, 2000);
    expect(b.inv.fuel).toBeGreaterThan(a.inv.fuel);
  });

  it('a ram plate stops zombies denting the car', () => {
    const run = (ramDamage: number) => {
      const c = createCombat({ seed: 3, progress: 0.05, ambush: true, ramDamage });
      let dmg = 0;
      for (let i = 0; i < 2000; i++) dmg += stepCombat(c, 0.05);
      return dmg;
    };
    expect(run(6)).toBeGreaterThan(0);
    expect(run(0)).toBeLessThan(run(6));
  });
});

describe('prices follow found money and the real price of gas', () => {
  it('locks the real gas price level in when the trip starts, and moves every price with it', async () => {
    const { levelFor } = await import('../src/game/gasPrice');
    expect(levelFor(4.153)).toBe(1);
    expect(levelFor(6.229)).toBe(1.5);
    expect(levelFor(50)).toBe(2);
    expect(levelFor(0.5)).toBe(0.5);
    const { fuelPrice, foundCash, priceOf } = await import('../src/game/state');
    const s = newGame(route, 1);
    s.priceLevel = 1.5;
    expect(fuelPrice(s)).toBe(3);
    expect(foundCash(s, 10)).toBe(30);
    expect(priceOf(s, 30)).toBe(90);
  });
});
