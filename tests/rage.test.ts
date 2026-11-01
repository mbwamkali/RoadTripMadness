import { describe, expect, it } from 'vitest';
import { addRage, coolRage, hostileChance, hostileShot, RAGE_HOSTILE, rageOf, rollHostile, shootVehicle, VEHICLE_HP } from '../src/game/rage';
import { makeRng } from '../src/game/rng';
import { newGame } from '../src/game/state';
import type { Vehicle } from '../src/game/traffic';
import { demoRawRoute } from '../src/geo/demoRoute';
import { buildRouteData } from '../src/geo/route';

const game = () => newGame(buildRouteData(demoRawRoute()), 1, 'normal', 'car');
const car = (): Vehicle => ({ id: 1, kind: 'car', d: 100, lane: 0, speed: 10, cruise: 10, color: 0 });

describe('road rage', () => {
  it('wrecks a car after enough shots, makes that driver hostile and raises rage', () => {
    const s = game();
    const v = car();
    const bullets = s.inv.bullets;
    let r = shootVehicle(s, v)!;
    expect(r.destroyed).toBe(false);
    expect(v.hostile).toBe(true);
    for (let i = 1; i < VEHICLE_HP.car; i++) r = shootVehicle(s, v)!;
    expect(r.destroyed).toBe(true);
    expect(s.inv.bullets).toBe(bullets - VEHICLE_HP.car);
    expect(rageOf(s)).toBeGreaterThan(15);
  });

  it('does nothing without ammo', () => {
    const s = game();
    s.inv.bullets = 0;
    s.inv.shells = 0;
    expect(shootVehicle(s, car())).toBeNull();
    expect(rageOf(s)).toBe(0);
  });

  it('turns some drivers hostile only past the threshold, and cools with distance', () => {
    expect(hostileChance(RAGE_HOSTILE - 1)).toBe(0);
    expect(hostileChance(100)).toBeCloseTo(0.6);
    const rng = makeRng(3);
    const calm = Array.from({ length: 50 }, car);
    calm.forEach((v) => rollHostile(v, 20, rng));
    expect(calm.some((v) => v.hostile)).toBe(false);
    const angry = Array.from({ length: 200 }, car);
    angry.forEach((v) => rollHostile(v, 100, rng));
    const n = angry.filter((v) => v.hostile).length;
    expect(n).toBeGreaterThan(80);
    expect(n).toBeLessThan(160);
    const s = game();
    addRage(s, 60);
    coolRage(s, 1000);
    expect(rageOf(s)).toBe(30);
    coolRage(s, 5000);
    expect(rageOf(s)).toBe(0);
  });

  it('hostile drivers hurt you when they hit', () => {
    const s = game();
    const rng = makeRng(9);
    let total = 0;
    for (let i = 0; i < 20; i++) total += hostileShot(s, { ...car(), hostile: true }, rng);
    expect(total).toBeGreaterThan(0);
    expect(s.health).toBe(100 - total);
  });
});
