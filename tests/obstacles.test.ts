import { describe, expect, it } from 'vitest';
import { buildRouteData } from '../src/geo/route';
import { demoRawRoute } from '../src/geo/demoRoute';
import { newGame } from '../src/game/state';
import { Obstacles, ramCost, ramObstacle, shootObstacle, type Obstacle } from '../src/game/obstacles';
import type { RoadSegment } from '../src/game/roads';

const road: RoadSegment[] = [{ from: 0, to: 50000, cls: 'interstate' }];
const route = buildRouteData(demoRawRoute());

describe('road obstacles', () => {
  it('appear ahead every so often, in the player\'s own lanes', () => {
    const o = new Obstacles(road, 50000, 3, 0);
    for (let d = 0; d < 20000; d += 50) o.step(d);
    const seen = new Set<number>();
    const all: Obstacle[] = [];
    const o2 = new Obstacles(road, 50000, 3, 0);
    for (let d = 0; d < 20000; d += 50) {
      o2.step(d);
      for (const x of o2.list) if (!seen.has(x.id)) (seen.add(x.id), all.push(x));
    }
    expect(all.length).toBeGreaterThan(12);
    expect(all.length).toBeLessThan(45);
    expect(all.every((x) => x.lane >= 0 && x.lane < 2)).toBe(true);
    expect(new Set(all.map((x) => x.kind)).size).toBeGreaterThan(2);
    // Left-behind ones are dropped.
    expect(o.list.every((x) => x.d > 20000 - 100)).toBe(true);
  });

  it('are fewer on easier settings', () => {
    const count = (gap: number) => {
      const o = new Obstacles(road, 50000, 9, 0, gap);
      const ids = new Set<number>();
      for (let d = 0; d < 30000; d += 50) {
        o.step(d);
        o.list.forEach((x) => ids.add(x.id));
      }
      return ids.size;
    };
    expect(count(1.5)).toBeLessThan(count(1));
  });

  it('ramming costs less with a ram plate, and a full plate shrugs off zombies', () => {
    expect(ramCost('wreck', 3)).toBeLessThan(ramCost('wreck', 0));
    expect(ramCost('zombie', 3)).toBe(0);
    expect(ramCost('roadblock', 0)).toBeGreaterThan(ramCost('debris', 0));
    const s = newGame(route, 1);
    const hp = s.health;
    const cost = ramObstacle(s, { id: 1, kind: 'zombie', d: 0, lane: 0, hp: 1 });
    expect(s.health).toBe(hp - cost);
    expect(s.kills).toBe(1);
  });

  it('shooting spends ammo, takes a few hits for big things and pays scrap', () => {
    const s = newGame(route, 1);
    s.inv.bullets = 2;
    s.inv.shells = 1;
    const scrap = s.inv.scrap;
    const block: Obstacle = { id: 1, kind: 'roadblock', d: 0, lane: 0, hp: 4 };
    expect(shootObstacle(s, block)?.destroyed).toBe(false);
    expect(shootObstacle(s, block)?.destroyed).toBe(false);
    // Out of bullets: a shell hits for 3.
    const r = shootObstacle(s, block);
    expect(r?.ammo).toBe('shells');
    expect(r?.destroyed).toBe(true);
    expect(s.inv.scrap).toBe(scrap + 2);
    expect(shootObstacle(s, { id: 2, kind: 'zombie', d: 0, lane: 0, hp: 1 })).toBeNull();
  });

  it('finds what is ahead in a lane and what the car runs into', () => {
    const o = new Obstacles(road, 50000, 3, 0);
    o.list = [{ id: 5, kind: 'debris', d: 500, lane: 1, hp: 1 }];
    expect(o.ahead(450, 1, 90)?.id).toBe(5);
    expect(o.ahead(450, 0, 90)).toBeNull();
    expect(o.hit(498, 9, () => 9)?.id).toBe(5);
    expect(o.hit(498, 5.4, () => 9)).toBeNull();
  });
});
