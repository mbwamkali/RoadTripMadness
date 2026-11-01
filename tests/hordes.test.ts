import { describe, expect, it } from 'vitest';
import { createCombat, fireAt, hordeWaves, stepCombat, type CombatState, type Enemy } from '../src/game/combat';
import { makeRng } from '../src/game/rng';

const base = (over: Partial<Enemy>): Enemy => ({ id: 900, type: 'zombie', hp: 2, maxHp: 2, x: 0, y: 0, z: -40, timer: 0, charging: false, stunned: 0, holdZ: 0, holdX: 0, targetX: 0, ...over });
const quiet = (seed = 1): CombatState => {
  const c = createCombat({ seed, progress: 0.5, theme: 'outlaw' });
  c.queue = [];
  return c;
};
const run = (c: CombatState, secs: number, each?: () => void) => {
  let dmg = 0;
  for (let t = 0; t < secs; t += 1 / 60) {
    each?.();
    dmg += stepCombat(c, 1 / 60);
  }
  return dmg;
};

describe('zombie hordes', () => {
  it('come in three or four waves of 20 to 40 in total, fewer when capped', () => {
    for (let seed = 1; seed < 30; seed++) {
      const q = hordeWaves(makeRng(seed), 0.6, 40);
      expect(q.length).toBeGreaterThanOrEqual(20);
      expect(q.length).toBeLessThanOrEqual(40);
      expect(q.every((s) => s.horde && s.type === 'zombie')).toBe(true);
    }
    expect(hordeWaves(makeRng(3), 1, 16).length).toBeLessThanOrEqual(16);
  });

  it('turn a zombie fight into a horde, and each one goes down in one shot', () => {
    const c = createCombat({ seed: 5, progress: 0.5, theme: 'zombie', hordeChance: 1, hpScale: 1.3 });
    expect(c.horde).toBe(true);
    expect(c.title).toBe('ZOMBIE HORDE!');
    run(c, 2);
    const z = c.enemies.find((e) => e.horde)!;
    expect(z.hp).toBe(1);
    c.fireCooldown = 0;
    fireAt(c, { bullets: 10 } as never, z.id);
    expect(c.enemies.some((e) => e.id === z.id)).toBe(false);
  });

  it('never happen when the chance is zero', () => {
    for (let seed = 1; seed < 20; seed++) expect(createCombat({ seed, progress: 0.5, theme: 'zombie' }).horde).toBe(false);
  });
});

describe('zombies fight back', () => {
  it('throwers wind up, then throw junk that hits the lane the car was in', () => {
    const c = quiet();
    c.enemies.push(base({ role: 'thrower', z: -14, holdZ: -14, timer: 1 }));
    const kinds: string[] = [];
    const dmg = run(c, 2.5, () => kinds.push(...c.events.map((e) => e.kind)) && (c.events.length = 0));
    expect(kinds.indexOf('windup')).toBeGreaterThanOrEqual(0);
    expect(kinds.indexOf('windup')).toBeLessThan(kinds.indexOf('throw'));
    expect(kinds).toContain('missile');
    expect(dmg).toBeGreaterThan(0);
  });

  it('thrown junk misses if you steer out of the lane', () => {
    const c = quiet();
    c.enemies.push(base({ role: 'thrower', z: -14, holdZ: -14, timer: 0.05 }));
    run(c, 0.2);
    expect(c.missiles.length).toBe(1);
    c.steer = 1;
    const dmg = run(c, 1);
    expect(dmg).toBe(0);
  });

  it('climbers grab on and claw until shaken off by steering', () => {
    const c = quiet();
    c.enemies.push(base({ role: 'climber', z: -3 }));
    run(c, 0.5);
    const z = c.enemies.find((e) => e.id === 900)!;
    expect(z.onCar).toBe(true);
    const dmg = run(c, 2);
    expect(dmg).toBeGreaterThan(0);
    c.steer = 1;
    run(c, 1);
    expect(c.enemies.some((e) => e.id === 900)).toBe(false);
  });

  it('outlaws raise their gun before every shot', () => {
    const c = quiet();
    c.enemies.push(base({ type: 'outlaw', hp: 4, maxHp: 4, z: -6, holdZ: -6, x: 4, holdX: 4, timer: 1 }));
    const kinds: string[] = [];
    run(c, 1.2, () => kinds.push(...c.events.map((e) => e.kind)) && (c.events.length = 0));
    expect(kinds.indexOf('windup')).toBeGreaterThanOrEqual(0);
    expect(kinds.indexOf('windup')).toBeLessThan(kinds.indexOf('enemyShot'));
  });
});
