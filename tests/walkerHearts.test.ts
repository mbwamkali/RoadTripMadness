import { describe, expect, it } from 'vitest';
import { buildRouteData } from '../src/geo/route';
import { demoRawRoute } from '../src/geo/demoRoute';
import { HEARTS, healWalker, heartsOf, hurtWalker, maxHealth, newGame, restAtMotel } from '../src/game/state';

const route = buildRouteData(demoRawRoute());

describe('your hearts on foot', () => {
  it('start full (older saves have none: full) and are apart from the car', () => {
    const s = newGame(route, 1);
    expect(heartsOf(s)).toBe(HEARTS);
    expect(HEARTS).toBe(10);
    hurtWalker(s, false);
    expect(heartsOf(s)).toBe(9);
    expect(s.health).toBe(maxHealth(s));
  });

  it('a grab costs 1 heart, half in kid mode; at zero you are knocked dizzy', () => {
    const s = newGame(route, 1);
    let out = false;
    let grabs = 0;
    while (!out) {
      out = hurtWalker(s, true);
      grabs++;
    }
    expect(grabs).toBe(20);
    const a = newGame(route, 1);
    grabs = 0;
    out = false;
    while (!out) {
      out = hurtWalker(a, false);
      grabs++;
    }
    expect(grabs).toBe(10);
    expect(heartsOf(a)).toBe(0);
    expect(a.status).toBe('driving');
  });

  it('come back, never past full; a motel rest fills them', () => {
    const s = newGame(route, 1);
    s.hearts = 3;
    healWalker(s, 1);
    expect(heartsOf(s)).toBe(4);
    healWalker(s, 99);
    expect(heartsOf(s)).toBe(HEARTS);
    s.hearts = 2;
    s.inv.cash = 500;
    restAtMotel(s, 10, 0.9);
    expect(heartsOf(s)).toBe(HEARTS);
  });
});
