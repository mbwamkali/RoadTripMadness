import { describe, expect, it } from 'vitest';
import { BOSS_INFO, createCombat, fireAt, HALF_BOSSES, stepCombat, type CombatState } from '../src/game/combat';
import { pickHalfBoss } from '../src/game/state';
import { afterTrip, freshCareer } from '../src/game/career';
import { noUpgrades } from '../src/game/upgrades';

const inv = () => ({ fuel: 50, cash: 0, scrap: 0, bullets: 999, shells: 0, catnip: 0 });
function run(c: CombatState, seconds: number, each?: (c: CombatState) => void): void {
  for (let t = 0; t < seconds; t += 1 / 30) {
    stepCombat(c, 1 / 30);
    each?.(c);
  }
}

describe('halfway boss pool', () => {
  it('draws every pool boss across trips, never the last one again', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 200; seed++) {
      const last = HALF_BOSSES[seed % HALF_BOSSES.length];
      const b = pickHalfBoss(seed * 7919, last);
      expect(b).not.toBe(last);
      expect(HALF_BOSSES).toContain(b);
      seen.add(b);
    }
    expect(seen).toEqual(new Set(HALF_BOSSES));
    expect(HALF_BOSSES).not.toContain('mothership');
  });
  it('the career remembers the last boss through a win', () => {
    const c = afterTrip({ ...freshCareer(), lastBoss: 'hermit' }, true, noUpgrades(), false);
    expect(c.lastBoss).toBe('hermit');
  });
});

describe('the crazy hermit', () => {
  it('stays by the roadside, hops across, and throws junk with a wind-up first', () => {
    const c = createCombat({ seed: 3, progress: 0.5, boss: 'hermit' });
    let throws = 0;
    let windups = 0;
    let sides = new Set<number>();
    let minX = Infinity;
    run(c, 30, (c) => {
      for (const ev of c.events) {
        if (ev.kind === 'throw') throws++;
        if (ev.kind === 'windup') windups++;
      }
      c.events.length = 0;
      const h = c.enemies.find((e) => e.type === 'hermit');
      if (h && h.y === 0 && h.z > -20) {
        sides.add(Math.sign(h.x));
        minX = Math.min(minX, Math.abs(h.x));
      }
    });
    expect(throws).toBeGreaterThanOrEqual(5);
    expect(windups).toBeGreaterThanOrEqual(throws);
    expect(sides.size).toBe(2);
    expect(minX).toBeGreaterThan(3);
    expect(c.missiles.every((m) => m.from === 'hermit')).toBe(true);
    // No minions with him.
    expect(c.enemies.every((e) => e.type === 'hermit')).toBe(true);
    expect(BOSS_INFO.hermit.minion).toBeNull();
  });
});

describe('the angry pizza driver', () => {
  it('throws pizzas, and his pizzas heal the car once he is beaten', () => {
    const c = createCombat({ seed: 4, progress: 0.5, boss: 'pizza' });
    let pizzas = 0;
    run(c, 20, (c) => {
      pizzas += c.events.filter((ev) => ev.kind === 'throw').length;
      c.events.length = 0;
    });
    expect(pizzas).toBeGreaterThanOrEqual(4);
    expect(c.missiles.every((m) => m.from === 'pizza')).toBe(true);
    const boss = c.enemies.find((e) => e.type === 'pizza')!;
    const items = inv();
    for (let i = 0; i < 200 && boss.hp > 0; i++) {
      c.fireCooldown = 0;
      fireAt(c, items, boss.id);
    }
    expect(boss.hp).toBeLessThanOrEqual(0);
    expect(c.heal).toBe(30);
  });
  it('a dodged pizza does no damage', () => {
    const c = createCombat({ seed: 5, progress: 0.5, boss: 'pizza' });
    let dmg = 0;
    // Weave so the pizzas land where the car was.
    run(c, 15, (c) => {
      c.steer = Math.sin(c.time * 3) > 0 ? 1 : -1;
      for (const m of c.missiles) if (m.t > m.dur - 0.1) c.steer = m.tx > c.carX ? -1 : 1;
      dmg += c.events.filter((e) => e.kind === 'carHit' && e.from === 'pizza').length;
      c.events.length = 0;
    });
    expect(dmg).toBeLessThan(6);
  });
});

describe('the street sweeper', () => {
  it('sprays two trash bags at a time, and its cats bail out when wrecked', () => {
    const c = createCombat({ seed: 6, progress: 0.5, boss: 'sweeper' });
    let pairs = 0;
    run(c, 20, (c) => {
      const throws = c.events.filter((ev) => ev.kind === 'throw').length;
      if (throws === 2) pairs++;
      c.events.length = 0;
    });
    expect(pairs).toBeGreaterThanOrEqual(3);
    // There is always a lane the bags miss.
    const lanes = new Set(c.missiles.map((m) => Math.round(m.tx)));
    expect(lanes.size === 0 || lanes.size === 2).toBe(true);
    const boss = c.enemies.find((e) => e.type === 'sweeper')!;
    const items = inv();
    for (let i = 0; i < 300 && boss.hp > 0; i++) {
      c.fireCooldown = 0;
      fireAt(c, items, boss.id);
    }
    const bail = c.events.find((ev) => ev.kind === 'bail');
    expect(bail && bail.kind === 'bail' && bail.cats).toBeGreaterThan(0);
    expect(c.loot.catnip).toBe(2);
  });
});
