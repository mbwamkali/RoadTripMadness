import { describe, expect, it } from 'vitest';
import { buildRouteData, pathFromRoute } from '../src/geo/route';
import { demoRawRoute } from '../src/geo/demoRoute';
import { advance, bossPoints, newGame } from '../src/game/state';
import { createCombat, combatOutcome, fireAt, stepCombat, BOSS_INFO } from '../src/game/combat';
import { DIFFICULTIES } from '../src/game/difficulty';
import { addScore, scoreFor } from '../src/game/scores';

const route = buildRouteData(demoRawRoute());
const path = pathFromRoute(route);

describe('boss fights', () => {
  it('stops for a boss at halfway and before the destination, even when skipping ahead', () => {
    const s = newGame(route, 4);
    s.inv.fuel = 1e9;
    s.nextEncounterAt = s.nextEventAt = 1e12;
    const bosses: string[] = [];
    while (s.status === 'driving') {
      const r = advance(s, path, 500, 0);
      if (r.boss) bosses.push(`${r.boss}@${Math.round(s.distance)}`);
    }
    expect(bosses).toHaveLength(2);
    // The halfway boss slides clear of turn-offs (fights play on the road).
    const [half, end] = bossPoints(path.length, s.stops);
    expect(bosses[1]).toBe(`mothership@${Math.round(end + 0.001)}`);
    expect(Number(bosses[0].split('@')[1])).toBeCloseTo(half, -1);
    expect(s.status).toBe('won');
  });

  it('waits while you signal for a turn, then meets you when you drive on', () => {
    const s = newGame(route, 4);
    s.inv.fuel = 1e9;
    s.nextEncounterAt = s.nextEventAt = 1e12;
    const [half] = bossPoints(path.length, s.stops);
    s.distance = half - 100;
    // Signalling: drive well past the boss point and nothing happens.
    expect(advance(s, path, 300, 0, true).boss).toBeUndefined();
    expect(s.distance).toBeGreaterThan(half);
    expect(s.bossStage).toBe(0);
    // Back on the road: the held boss shows up straight away.
    expect(advance(s, path, 10, 0).boss).toBeDefined();
    expect(s.bossStage).toBe(1);
  });

  it('keeps driving past the finish while the last boss fights, then arrives', () => {
    const s = newGame(route, 4);
    s.inv.fuel = 5;
    s.nextEncounterAt = s.nextEventAt = 1e12;
    s.bossStage = 2;
    s.distance = path.length - 50;
    // Fight on: the road carries on, no arrival, no gas used past the line, no fights or events.
    s.nextEncounterAt = s.nextEventAt = 0;
    let r = advance(s, path, 400, 0.001, false, true);
    expect(r.arrived).toBe(false);
    expect(r.encounter || r.event || r.outOfFuel).toBeFalsy();
    expect(s.distance).toBeCloseTo(path.length + 350);
    expect(s.inv.fuel).toBeGreaterThan(4.9);
    expect(s.status).toBe('driving');
    // Boss down: you arrive straight away.
    r = advance(s, path, 10, 0.001);
    expect(r.arrived).toBe(true);
    expect(s.status).toBe('won');
  });

  it('a boss fight has no escape and ends when the boss falls', () => {
    const c = createCombat({ seed: 1, progress: 0.5, boss: 'brute' });
    const inv = { fuel: 50, cash: 0, scrap: 0, bullets: 10000, shells: 0, catnip: 0 };
    let t = 0;
    let took = 0;
    while (!combatOutcome(c) && t < 300) {
      took += stepCombat(c, 0.05);
      const boss = c.enemies.find((e) => e.id === c.bossId);
      // Dodge out of the red lane.
      c.carX = boss?.charging ? (boss.targetX > 0 ? -2.5 : 2.5) : 0;
      if (boss) fireAt(c, inv, boss.id);
      t += 0.05;
    }
    expect(combatOutcome(c)).toBe('cleared');
    expect(t).toBeGreaterThan(5);
    expect(c.loot.cash).toBeGreaterThanOrEqual(80);
    // Dodging every stomp means only minions got hits in.
    expect(took).toBeLessThan(BOSS_INFO.brute.slamDamage * 3);
  });

  it('standing still in the red lane gets you hit', () => {
    const c = createCombat({ seed: 2, progress: 0.5, boss: 'mothership' });
    let took = 0;
    for (let t = 0; t < 30; t += 0.05) took += stepCombat(c, 0.05);
    expect(took).toBeGreaterThanOrEqual(BOSS_INFO.mothership.slamDamage * 2);
    expect(combatOutcome(c)).toBeNull();
  });
});

describe('difficulty and scores', () => {
  it('changes starting supplies and enemy toughness', () => {
    expect(newGame(route, 1, 'easy').inv.bullets).toBeGreaterThan(newGame(route, 1, 'hard').inv.bullets);
    const hard = createCombat({ seed: 1, progress: 0.5, boss: 'warrig', hpScale: DIFFICULTIES.hard.hp });
    for (let t = 0; t < 2; t += 0.1) stepCombat(hard, 0.1);
    const boss = hard.enemies.find((e) => e.id === hard.bossId)!;
    expect(boss.maxHp).toBeCloseTo(55 * 1.3);
  });

  it('scores a finished trip higher than a failed one, and higher on hard', () => {
    const won = newGame(route, 1);
    won.distance = path.length;
    won.status = 'won';
    won.kills = 20;
    won.bossesBeaten = 2;
    const lost = newGame(route, 1);
    lost.distance = path.length / 2;
    lost.status = 'lost';
    expect(scoreFor(won, path.length).total).toBeGreaterThan(scoreFor(lost, path.length).total);
    const hard = { ...won, difficulty: 'hard' as const };
    expect(scoreFor(hard, path.length).total).toBeGreaterThan(scoreFor(won, path.length).total);
  });

  it('keeps the top scores in order', () => {
    let list: ReturnType<typeof addScore>['list'] = [];
    for (const n of [5, 50, 20, 70, 1]) list = addScore({ score: n, route: 'x', difficulty: 'normal', won: true, date: '' }, list).list;
    expect(list.map((e) => e.score)).toEqual([70, 50, 20, 5, 1]);
    const { rank } = addScore({ score: 30, route: 'y', difficulty: 'hard', won: false, date: '' }, list);
    expect(rank).toBe(2);
  });
});
