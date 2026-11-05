import { describe, expect, it } from 'vitest';
import { changeLane, createCombat, nearestEnemy, ROAD_LANES, stepCombat, useLanes } from '../src/game/combat';
import { bossPoints, BOSS_CLEAR } from '../src/game/state';

const fight = () => createCombat({ seed: 7, progress: 0.3, theme: 'outlaw', hordeChance: 0 });

describe('fights on the road', () => {
  it('dodges between lanes instead of steering freely', () => {
    const c = fight();
    useLanes(c, 1.5);
    expect(c.lane).toBe(1);
    expect(changeLane(c, 1)).toBe(false);
    expect(changeLane(c, -1)).toBe(true);
    for (let i = 0; i < 60; i++) stepCombat(c, 1 / 60);
    expect(c.carX).toBeCloseTo(ROAD_LANES[0], 5);
    expect(c.steer).toBe(0);
  });
  it('one lane over clears a boss strike', () => {
    expect(ROAD_LANES[1] - ROAD_LANES[0]).toBeGreaterThanOrEqual(3.6);
  });
  it('escapes by distance: faster driving gets away sooner', () => {
    const slow = fight();
    const fast = fight();
    slow.pace = 0.5;
    fast.pace = 1.5;
    stepCombat(slow, 2);
    stepCombat(fast, 2);
    expect(fast.escape).toBeCloseTo(3);
    expect(slow.escape).toBeCloseTo(1);
    const stopped = fight();
    stopped.pace = 0;
    stepCombat(stopped, 2);
    expect(stopped.escape).toBe(0);
  });
  it('finds the nearest bad guy for the kid mode button', () => {
    const c = fight();
    for (let i = 0; i < 600 && c.enemies.length < 2; i++) stepCombat(c, 1 / 30);
    const n = nearestEnemy(c);
    expect(n).not.toBeNull();
    for (const e of c.enemies) expect(Math.hypot(e.x - c.carX, e.z)).toBeGreaterThanOrEqual(Math.hypot(n!.x - c.carX, n!.z) - 1e-9);
  });
  it('keeps turn-offs clear after the halfway boss', () => {
    const len = 20000;
    const stops = [{ at: 9900 }, { at: 10600 }, { at: 11900 }];
    const [half] = bossPoints(len, stops);
    for (const st of stops) expect(st.at <= half - 150 || st.at >= half + BOSS_CLEAR).toBe(true);
    expect(bossPoints(len)[0]).toBe(len / 2);
  });
});
