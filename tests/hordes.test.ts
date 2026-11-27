import { describe, expect, it } from 'vitest';
import { createCombat, fireAt, hordeAhead, hordeWaves, HORDE_AHEAD, stepCombat, ZOMBIE_HURRY, ZOMBIE_WALK, zombieHitScale, type CombatState, type Enemy } from '../src/game/combat';
import { easeTimeScale, MIN_TIME_SCALE, wantedTimeScale, zombieWindow } from '../src/game/zombieTime';
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
    // Standing up the road; it winds up once you're near enough for the junk to land as you arrive.
    c.pace = 0.5;
    c.enemies.push(base({ role: 'thrower', z: -40, holdZ: -14, timer: 1 }));
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

describe('zombies on the road', () => {
  it('stand on the road, so they come at you at your own speed plus a slow walk', () => {
    const c = quiet();
    c.pace = 2; // 76 units/s, about 130 mph
    c.enemies.push(base({ z: -100 }));
    stepCombat(c, 0.25);
    stepCombat(c, 0.25);
    expect(c.enemies[0].z).toBeCloseTo(-100 + (76 + ZOMBIE_WALK) * 0.5, 3);
  });

  it('a horde shows up far up the road, never right on top of you', () => {
    const c = createCombat({ seed: 5, progress: 0.5, theme: 'zombie', hordeChance: 1 });
    c.pace = 1.5;
    run(c, 0.4);
    for (const e of c.enemies.filter((x) => x.horde)) expect(e.z).toBeLessThan(-HORDE_AHEAD + 60 * 0.4);
  });

  it('stopped, zombies hurry over and grab on instead of going under the wheels', () => {
    const c = quiet();
    c.pace = 0;
    c.enemies.push(base({ z: -10, horde: true, hp: 1, maxHp: 1 }));
    stepCombat(c, 0.25);
    stepCombat(c, 0.25);
    expect(c.enemies[0].z).toBeCloseTo(-10 + ZOMBIE_HURRY * 0.5, 3);
    run(c, 3);
    expect(c.enemies[0].onCar).toBe(true);
    expect(c.kills).toBe(0);
  });

  it('ploughing into them hurts more the faster you go', () => {
    expect(zombieHitScale(130)).toBeCloseTo(3, 5);
    expect(zombieHitScale(80)).toBeCloseTo((80 / 65) ** 2, 5);
    expect(zombieHitScale(25)).toBe(0.2);
    const hit = (pace: number) => {
      const c = quiet();
      c.pace = pace;
      c.enemies.push(base({ z: -20, horde: true, hp: 1, maxHp: 1 }));
      return run(c, 1.5);
    };
    expect(hit(2)).toBeGreaterThan(hit(1));
  });

  it('reports the nearest horde zombie still coming, for zombie time', () => {
    const c = quiet();
    c.pace = 1;
    c.enemies.push(base({ id: 1, z: -80, horde: true, realAge: 1 }), base({ id: 2, z: -60, horde: true, realAge: 0.5 }), base({ id: 3, z: 5, horde: true }));
    const h = hordeAhead(c)!;
    expect(h.dist).toBe(60);
    expect(h.age).toBe(1);
    expect(h.closing).toBeCloseTo(38 + ZOMBIE_WALK, 5);
  });
});

describe('zombie time', () => {
  it('gives kid mode 7 s, easy 6, normal 4 and hard 2.5', () => {
    expect(zombieWindow('easy', true)).toBe(7);
    expect(zombieWindow('easy', false)).toBe(6);
    expect(zombieWindow('normal', false)).toBe(4);
    expect(zombieWindow('hard', false)).toBe(2.5);
  });

  it('slows time just enough that the horde is reached no sooner than the window', () => {
    // 115 units at about 80 mph (47 units/s) is 2.4 s: Hard needs nothing, Normal a bit, Easy more.
    const h = { dist: 115, closing: 47, age: 0 };
    expect(wantedTimeScale(h, 2.5)).toBeCloseTo(115 / 47 / 2.5, 5);
    expect(wantedTimeScale(h, 2)).toBe(1);
    expect(wantedTimeScale(h, 4)).toBeCloseTo(0.6117, 3);
    expect(wantedTimeScale({ dist: 20, closing: 80, age: 0 }, 7)).toBe(MIN_TIME_SCALE);
  });

  it('lets go once the window has passed, you have stopped, or no horde is left', () => {
    expect(wantedTimeScale({ dist: 50, closing: 47, age: 5 }, 4)).toBe(1);
    expect(wantedTimeScale({ dist: 50, closing: 2, age: 0 }, 4)).toBe(1);
    expect(wantedTimeScale(null, 4)).toBe(1);
  });

  it('slows quickly and speeds back up gently', () => {
    const down = easeTimeScale(1, 0.4, 0.1);
    const up = easeTimeScale(0.4, 1, 0.1);
    expect(1 - down).toBeGreaterThan(up - 0.4);
  });
});
