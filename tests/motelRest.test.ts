import { describe, expect, it } from 'vitest';
import { buildRouteData } from '../src/geo/route';
import { demoRawRoute } from '../src/geo/demoRoute';
import { maxHealth, newGame, REST_AMBUSH, REST_HEAL, restAtMotel, restCost } from '../src/game/state';
import { hourOf } from '../src/game/time';

const route = buildRouteData(demoRawRoute());

describe('resting at the motel', () => {
  it('turns day into evening and night into morning', () => {
    const s = newGame(route, 1);
    s.inv.cash = 500;
    const day = restAtMotel(s, 10, 0.9);
    expect(day.ok).toBe(true);
    expect(day.hours).toBe(9);
    expect(day.wokeAtNight).toBe(true);
    const night = restAtMotel(s, 22, 0.9);
    expect(night.hours).toBe(9);
    expect(night.wokeAtNight).toBe(false);
    const late = restAtMotel(s, 3, 0.9);
    expect(late.hours).toBe(4);
  });

  it('sleeps through to the next one when the wake time is close', () => {
    const s = newGame(route, 1);
    s.inv.cash = 500;
    const r = restAtMotel(s, 18.5, 0.9);
    expect(r.hours).toBe(12.5);
    expect(r.wokeAtNight).toBe(false);
  });

  it('moves the clock by the hours slept', () => {
    const s = newGame(route, 1);
    s.inv.cash = 500;
    const before = hourOf(s);
    const r = restAtMotel(s, before, 0.9);
    expect(hourOf(s)).toBeCloseTo((before + r.hours) % 24, 5);
    expect([7, 19]).toContain(Math.round(hourOf(s)));
  });

  it('costs about $10 and fixes a little damage', () => {
    const s = newGame(route, 1);
    s.inv.cash = 100;
    s.health = maxHealth(s) - 40;
    const price = restCost(s);
    expect(price).toBeGreaterThanOrEqual(10);
    const r = restAtMotel(s, 12, 0.9);
    expect(s.inv.cash).toBe(100 - price);
    expect(r.healed).toBe(REST_HEAL);
    expect(s.health).toBe(maxHealth(s) - 40 + REST_HEAL);
  });

  it('never fixes past full', () => {
    const s = newGame(route, 1);
    s.inv.cash = 100;
    s.health = maxHealth(s) - 3;
    expect(restAtMotel(s, 12, 0.9).healed).toBe(3);
    expect(s.health).toBe(maxHealth(s));
  });

  it('refuses without the money, and nothing changes', () => {
    const s = newGame(route, 1);
    s.inv.cash = 0;
    const spent = s.hoursSpent;
    expect(restAtMotel(s, 12, 0.9).ok).toBe(false);
    expect(s.hoursSpent).toBe(spent);
  });

  it('sometimes has zombies waiting outside (about 1 in 6)', () => {
    const s = newGame(route, 1);
    s.inv.cash = 1e6;
    expect(restAtMotel(s, 12, REST_AMBUSH - 0.01).ambush).toBe(true);
    expect(restAtMotel(s, 12, REST_AMBUSH + 0.01).ambush).toBe(false);
    expect(REST_AMBUSH).toBeCloseTo(1 / 6, 5);
  });
});
