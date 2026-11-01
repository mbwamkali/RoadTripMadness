import { describe, expect, it } from 'vitest';
import { LANE_LIMIT } from '../src/game/combat';
import { fightRoad } from '../src/game/fightRoad';

describe('fight road layout', () => {
  it('keeps the car on pavement on every road type', () => {
    for (const cls of ['local', 'highway', 'interstate', 'metro'] as const) {
      const r = fightRoad(cls);
      const mine = r.strips[0];
      expect(mine.x - mine.width / 2, cls).toBeLessThanOrEqual(-LANE_LIMIT - 1);
      expect(mine.x + mine.width / 2, cls).toBeGreaterThanOrEqual(LANE_LIMIT + 1);
    }
  });

  it('divides interstates with a median and an oncoming carriageway', () => {
    const r = fightRoad('interstate');
    expect(r.strips).toHaveLength(2);
    expect(r.strips[1].flipped).toBe(true);
    expect(r.median!.width).toBeGreaterThan(5);
    expect(r.strips[1].x + r.strips[1].width / 2).toBeLessThan(r.median!.x);
    expect(fightRoad('local').median).toBeNull();
    expect(fightRoad('highway').strips[0].width).toBeGreaterThan(fightRoad('local').strips[0].width);
  });
});
