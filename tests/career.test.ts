import { describe, expect, it } from 'vitest';
import { afterTrip, freshCareer, KID_THREAT_CAP, threatFor, threatScale, threatScoreBonus } from '../src/game/career';
import { createCombat, hordeWaves } from '../src/game/combat';
import { makeRng } from '../src/game/rng';
import { noUpgrades } from '../src/game/upgrades';

const ups = (o: Partial<ReturnType<typeof noUpgrades>>) => ({ ...noUpgrades(), ...o });

describe('career carry-over', () => {
  it('a win keeps upgrades and raises the threat', () => {
    const c = afterTrip(freshCareer(), true, ups({ armor: 2, ram: 1 }), false);
    expect(c.upgrades.armor).toBe(2);
    expect(c.upgrades.ram).toBe(1);
    expect(c.threat).toBe(1);
    expect(c.wins).toBe(1);
  });
  it('never loses a level it already had', () => {
    const c = afterTrip({ upgrades: ups({ turret: 3 }), threat: 2, wins: 2 }, true, ups({ turret: 1, tank: 1 }), false);
    expect(c.upgrades.turret).toBe(3);
    expect(c.upgrades.tank).toBe(1);
    expect(c.threat).toBe(3);
  });
  it('a loss changes nothing', () => {
    const before = { upgrades: ups({ armor: 1 }), threat: 2, wins: 2 };
    expect(afterTrip(before, false, ups({ armor: 3 }), false)).toEqual(before);
  });
  it('kid mode caps the threat', () => {
    let c = freshCareer();
    for (let i = 0; i < 6; i++) c = afterTrip(c, true, noUpgrades(), true);
    expect(c.threat).toBe(KID_THREAT_CAP);
    expect(threatFor({ ...c, threat: 7 }, true)).toBe(KID_THREAT_CAP);
    expect(threatFor({ ...c, threat: 7 }, false)).toBe(7);
  });
  it('threat makes enemies tougher, harder hitting and more numerous', () => {
    expect(threatScale(0)).toEqual({ hp: 1, dmg: 1, extra: 0 });
    const t3 = threatScale(3);
    expect(t3.hp).toBeGreaterThan(1.5);
    expect(t3.dmg).toBeGreaterThan(1.3);
    expect(t3.extra).toBe(6);
    expect(threatScale(20).extra).toBe(8);
    expect(threatScoreBonus(2)).toBeCloseTo(0.2);
  });
  it('extra enemies grow fights and hordes', () => {
    const base = createCombat({ seed: 5, progress: 0.5, theme: 'outlaw' });
    const more = createCombat({ seed: 5, progress: 0.5, theme: 'outlaw', extra: 4 });
    expect(more.queue.length).toBe(base.queue.length + 4);
    const h0 = hordeWaves(makeRng(9), 0, 40).length;
    expect(hordeWaves(makeRng(9), 0, 40, 6).length).toBe(Math.min(40, h0 + 6));
    expect(hordeWaves(makeRng(9), 1, 20, 8).length).toBeLessThanOrEqual(20);
  });
});
