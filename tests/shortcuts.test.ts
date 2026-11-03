import { describe, expect, it } from 'vitest';
import { fixFlat, placeShortcuts, rollShortcut, shortcutCount, shortcutSkip, takeShortcut } from '../src/game/shortcuts';
import { makeRng } from '../src/game/rng';
import { bossPoints, newGame } from '../src/game/state';
import { demoRawRoute } from '../src/geo/demoRoute';
import { buildRouteData, pathFromRoute } from '../src/geo/route';

const route = buildRouteData(demoRawRoute());
const path = pathFromRoute(route);

describe('dirt-road shortcuts', () => {
  it('are rare: none on short trips, one or two on longer ones', () => {
    const rng = makeRng(1);
    expect(shortcutCount(4000, rng)).toBe(0);
    expect(shortcutCount(10_000, rng)).toBe(1);
    for (let i = 0; i < 20; i++) expect(shortcutCount(40_000, rng)).toBeLessThanOrEqual(2);
  });

  it('turn off on the right, clear of other stops and the halfway boss, never near the end', () => {
    for (let seed = 1; seed < 30; seed++) {
      const others = [{ id: 'a', at: 5000, side: 'right' as const, kind: 'gas' as const, name: 'A', places: [] }];
      const cuts = placeShortcuts(30_000, seed, others);
      for (const c of cuts) {
        expect(c.kind).toBe('shortcut');
        expect(c.side).toBe('right');
        expect(c.at).toBeGreaterThan(30_000 * 0.1 - 1);
        expect(c.at).toBeLessThan(30_000 * 0.8 + 1);
        expect(Math.abs(c.at - 5000)).toBeGreaterThanOrEqual(500);
        expect(Math.abs(c.at - bossPoints(30_000)[0])).toBeGreaterThanOrEqual(900);
      }
    }
  });

  it('are offered on the demo trip like any other turn-off, in order', () => {
    const s = newGame(route, 3);
    const ats = s.stops.map((x) => x.at);
    expect([...ats].sort((a, b) => a - b)).toEqual(ats);
    if (path.length >= 6000) expect(s.stops.some((x) => x.kind === 'shortcut')).toBe(true);
  });

  it('skip 5 to 15% of what is left, but never past the next boss or into the last 10%', () => {
    const s = newGame(route, 4);
    const L = 20_000;
    for (let i = 0; i < 50; i++) {
      const at = 2000 + i * 100;
      const skip = shortcutSkip(s, L, at, makeRng(i));
      expect(skip).toBeLessThanOrEqual((L - at) * 0.15 + 1e-6);
      expect(at + skip).toBeLessThanOrEqual(bossPoints(L)[0] - 250 + 1e-6);
    }
    // Just before the boss there is nothing to skip.
    expect(shortcutSkip(s, L, bossPoints(L)[0] - 100, makeRng(1))).toBe(0);
  });

  it('move the car ahead, use less gas than the road, and pass the turn-offs in between', () => {
    const s = newGame(route, 5);
    const stop = { id: 'cut', at: 1000, side: 'right' as const, kind: 'shortcut' as const, name: 'Coyote Cut', places: [] };
    s.distance = 1000;
    s.nextEncounterAt = 1200;
    const fuel = s.inv.fuel;
    const rate = 0.01;
    const gas = takeShortcut(s, stop, 800, rate);
    expect(s.distance).toBe(1800);
    expect(gas).toBeLessThan(800 * rate);
    expect(s.inv.fuel).toBeCloseTo(fuel - gas);
    expect(s.nextEncounterAt).toBeGreaterThan(1800);
    for (const st of s.stops.filter((x) => x.at <= 1800)) expect(s.passed).toContain(st.id);
  });

  it('can bring a flat tyre or outlaws, with fewer outlaws in kid mode', () => {
    const count = (kid: boolean) => {
      const rng = makeRng(9);
      const n = { clear: 0, flat: 0, ambush: 0 };
      for (let i = 0; i < 2000; i++) n[rollShortcut(rng, kid)]++;
      return n;
    };
    const normal = count(false);
    const kid = count(true);
    expect(normal.clear).toBeGreaterThan(normal.flat);
    expect(normal.flat).toBeGreaterThan(0);
    expect(kid.ambush).toBeLessThan(normal.ambush / 2);
  });

  it('a flat costs a scrap if you have one, otherwise half an hour', () => {
    const s = newGame(route, 6);
    s.inv.scrap = 1;
    expect(fixFlat(s)).toBe('scrap');
    expect(s.inv.scrap).toBe(0);
    const h = s.hoursSpent;
    expect(fixFlat(s)).toBe('time');
    expect(s.hoursSpent).toBeCloseTo(h + 0.5);
  });
});
