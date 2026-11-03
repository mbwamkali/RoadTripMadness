import { describe, expect, it } from 'vitest';
import { crashCost, medianX, offRoadWreckReason, offRoadX, SOLIDS, steerOffRoad, type Roadside } from '../src/game/offroad';

const twoWay: Roadside = { divided: false, barrierMedian: false, atEdge: true };
const freeway: Roadside = { divided: true, barrierMedian: false, atEdge: true };
const cityFreeway: Roadside = { divided: true, barrierMedian: true, atEdge: true };

describe('leaving the road', () => {
  it('is an ordinary lane change until the last lane', () => {
    expect(steerOffRoad(null, 1, { ...twoWay, atEdge: false })).toEqual({ kind: 'lane' });
  });

  it('runs onto the shoulder, then the verge, and back again', () => {
    const leave = steerOffRoad(null, 1, twoWay);
    expect(leave).toEqual({ kind: 'leave', off: { side: 1, step: 1 } });
    expect(steerOffRoad({ side: 1, step: 1 }, 1, twoWay)).toEqual({ kind: 'move', off: { side: 1, step: 2 } });
    expect(steerOffRoad({ side: 1, step: 2 }, -1, twoWay)).toEqual({ kind: 'move', off: { side: 1, step: 1 } });
    expect(steerOffRoad({ side: 1, step: 1 }, -1, twoWay)).toEqual({ kind: 'back' });
  });

  it('works on the left of a two-way road too', () => {
    expect(steerOffRoad(null, -1, twoWay)).toEqual({ kind: 'leave', off: { side: -1, step: 1 } });
  });

  it('goes onto the grass median of a country freeway but no further', () => {
    expect(steerOffRoad(null, -1, freeway)).toEqual({ kind: 'leave', off: { side: -1, step: 1 } });
    expect(steerOffRoad({ side: -1, step: 1 }, -1, freeway)).toEqual({ kind: 'blocked' });
  });

  it('crashes into the barrier on a city freeway', () => {
    expect(steerOffRoad(null, -1, cityFreeway)).toEqual({ kind: 'crash', what: 'barrier', off: null });
  });

  it('crashes into a building or tree when steering out past the verge', () => {
    expect(steerOffRoad({ side: 1, step: 2 }, 1, twoWay, 'building')).toEqual({ kind: 'crash', what: 'building', off: { side: 1, step: 1 } });
    expect(steerOffRoad({ side: 1, step: 2 }, 1, twoWay, null)).toEqual({ kind: 'blocked' });
  });
});

describe('where the car sits off the road', () => {
  const at = { edge: 10, shoulder: 3, sidewalk: 0, median: 3.5, divided: true };
  it('drives on the shoulder, then further out on the verge', () => {
    const shoulder = offRoadX({ side: 1, step: 1 }, at);
    const verge = offRoadX({ side: 1, step: 2 }, at);
    expect(shoulder).toBeGreaterThan(10);
    expect(shoulder).toBeLessThan(13);
    expect(verge).toBeGreaterThan(13);
  });

  it('stays on its own side on the median', () => {
    expect(offRoadX({ side: -1, step: 1 }, at)).toBe(medianX(3.5));
    expect(medianX(3.5)).toBeGreaterThan(0);
    expect(medianX(3.5)).toBeLessThan(3.5);
  });

  it('mirrors on the left of a two-way road', () => {
    const local = { edge: 4.5, shoulder: 0, sidewalk: 3.2, median: 0, divided: false };
    expect(offRoadX({ side: -1, step: 1 }, local)).toBe(-offRoadX({ side: 1, step: 1 }, local));
  });
});

describe('crash damage', () => {
  it('costs more for big things than small ones', () => {
    expect(SOLIDS.building.big).toBe(true);
    expect(SOLIDS.lamp.big).toBe(false);
    expect(crashCost('building')).toBeGreaterThan(crashCost('lamp'));
    expect(crashCost('delineator')).toBe(0);
  });

  it('hurts more at speed and less with a tough ride', () => {
    expect(crashCost('tree', { speed: 1.69 })).toBeGreaterThan(crashCost('tree'));
    expect(crashCost('tree', { ram: 0.5 })).toBeLessThan(crashCost('tree'));
  });

  it('kid mode halves it, but a crash still costs at least 1', () => {
    expect(crashCost('building', { kid: true })).toBe(Math.round(crashCost('building') / 2));
    expect(crashCost('mile', { kid: true })).toBe(1);
    expect(crashCost('delineator', { kid: true })).toBe(0);
  });

  it('has the silly ending: the townsfolk are glad', () => {
    expect(offRoadWreckReason(true)).toMatch(/townsfolk cheer.*sidewalk is safe/i);
    expect(offRoadWreckReason(false)).toMatch(/cheer/i);
  });
});
