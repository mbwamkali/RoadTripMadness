import { describe, expect, it } from 'vitest';
import { clampLane, defaultLane, laneCenter, Traffic, oncoming, sideIndex } from '../src/game/traffic';
import { edgeOf, type RoadSegment } from '../src/game/roads';

const road = (cls: RoadSegment['cls'], length = 20000): RoadSegment[] => [{ from: 0, to: length, cls }];

describe('lanes', () => {
  it('numbers oncoming lanes negative and counts out from the centre', () => {
    expect(oncoming(-1)).toBe(true);
    expect(oncoming(0)).toBe(false);
    expect(sideIndex(-2)).toBe(1);
    expect(sideIndex(1)).toBe(1);
  });

  it('puts lane centres on the right side of the road and inside the pavement', () => {
    for (const cls of ['interstate', 'metro', 'highway', 'local'] as const) {
      const edge = edgeOf(cls);
      const x0 = laneCenter(cls, 0, edge);
      const xr = laneCenter(cls, defaultLane(cls), edge);
      expect(x0).toBeGreaterThan(0);
      expect(xr).toBeGreaterThanOrEqual(x0);
      expect(xr).toBeLessThan(edge);
      expect(laneCenter(cls, -1, edge)).toBeCloseTo(-x0);
    }
  });

  it('keeps the player off the wrong side of a divided road', () => {
    expect(clampLane('interstate', -1)).toBe(0);
    expect(clampLane('highway', -1)).toBe(-1);
    expect(clampLane('local', 3)).toBe(0);
    expect(clampLane('metro', 3)).toBe(3);
  });
});

describe('Traffic', () => {
  it('fills the road both ways, busier in cities', () => {
    const country = new Traffic(road('interstate'), 20000, 30, 1);
    country.step(0.016, 1000);
    const city = new Traffic(road('metro'), 20000, 30, 1, { urbanAt: () => 1 });
    city.step(0.016, 1000);
    expect(country.vehicles.some((v) => oncoming(v.lane))).toBe(true);
    expect(country.vehicles.some((v) => !oncoming(v.lane))).toBe(true);
    expect(city.vehicles.length).toBeGreaterThan(country.vehicles.length * 2);
  });

  it('moves each direction the right way and drops cars left behind', () => {
    const t = new Traffic(road('highway'), 20000, 30, 7);
    t.step(0.016, 1000);
    const before = new Map(t.vehicles.map((v) => [v.id, v.d]));
    t.step(1, 1000);
    for (const v of t.vehicles) {
      const was = before.get(v.id);
      if (was === undefined) continue;
      if (oncoming(v.lane)) expect(v.d).toBeLessThan(was);
      else expect(v.d).toBeGreaterThan(was);
    }
    // Drive far on: everything from the start is gone.
    t.step(0.016, 9000);
    expect(t.vehicles.every((v) => !before.has(v.id))).toBe(true);
  });

  it('finds the car ahead in a lane and detects a hit', () => {
    const t = new Traffic(road('highway'), 20000, 30, 3);
    t.vehicles = [{ id: 1, kind: 'car', d: 1050, lane: 1, speed: 20, cruise: 20, color: 0 }];
    expect(t.ahead(1000, 1, 100)?.id).toBe(1);
    expect(t.ahead(1000, 0, 100)).toBeNull();
    const x = () => 5.4;
    expect(t.hit(1048, 5.4, x)?.id).toBe(1);
    expect(t.hit(1048, 1.8, x)).toBeNull();
    expect(t.hit(1000, 5.4, x)).toBeNull();
    t.clearNear(1050, 10);
    expect(t.vehicles).toHaveLength(0);
  });

  it('slows down behind a slower vehicle instead of driving through it', () => {
    const t = new Traffic(road('highway'), 20000, 30, 3);
    t.step(0, 0);
    t.vehicles = [
      { id: 1, kind: 'truck', d: 1030, lane: 1, speed: 10, cruise: 10, color: 0 },
      { id: 2, kind: 'car', d: 1000, lane: 1, speed: 25, cruise: 25, color: 0 },
    ];
    for (let i = 0; i < 300; i++) t.step(0.05, 900);
    const [truck, car] = [t.vehicles.find((v) => v.id === 1)!, t.vehicles.find((v) => v.id === 2)!];
    expect(truck.d - car.d).toBeGreaterThan(9);
  });
});
