import { describe, expect, it } from 'vitest';
import { distanceSignLines, exitNumberOf, limitChanges, medianKind, milepost, shoulderAt, SHOULDER, turnAngle } from '../src/game/roadside';
import type { RoadSegment } from '../src/game/roads';

/** 1609.34 m per mile at 16.0934 m per unit = 100 units per mile. */
const SCALE = 16.0934;

describe('roadside: shoulders and medians', () => {
  it('gives bigger roads paved shoulders and local roads none', () => {
    expect(SHOULDER.local).toBe(0);
    expect(SHOULDER.highway).toBeGreaterThan(2);
    expect(SHOULDER.interstate).toBeGreaterThanOrEqual(SHOULDER.highway);
  });

  it('eases the shoulder in where the road type changes', () => {
    const segs: RoadSegment[] = [
      { from: 0, to: 1000, cls: 'local' },
      { from: 1000, to: 3000, cls: 'interstate' },
    ];
    expect(shoulderAt(segs, 500)).toBe(0);
    expect(shoulderAt(segs, 2000)).toBe(SHOULDER.interstate);
    const mid = shoulderAt(segs, 1000);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(SHOULDER.interstate);
  });

  it('puts grass between country freeway carriageways and a barrier on city freeways', () => {
    expect(medianKind('interstate')).toBe('grass');
    expect(medianKind('metro')).toBe('barrier');
    expect(medianKind('highway')).toBe('none');
    expect(medianKind('local')).toBe('none');
  });

  it('measures how sharply the road bends', () => {
    expect(turnAngle({ x: 0, y: 1 }, { x: 0, y: 1 })).toBeCloseTo(0);
    expect(turnAngle({ x: 0, y: 1 }, { x: 1, y: 0 })).toBeCloseTo(Math.PI / 2);
  });
});

describe('roadside: mile markers follow the real exits', () => {
  it('reads exit numbers off signs', () => {
    expect(exitNumberOf('42')).toBe(42);
    expect(exitNumberOf('42B')).toBe(42);
    expect(exitNumberOf('A')).toBeNull();
  });

  it('counts between two exits whose numbers match the miles between them', () => {
    const exits = [
      { at: 1000, ref: '40' },
      { at: 2000, ref: '50' }, // 10 miles later, 10 numbers on
    ];
    expect(milepost(1500, exits, SCALE, () => 999)).toBe(45);
    expect(milepost(1000, exits, SCALE, () => 999)).toBe(40);
  });

  it('counts on from one nearby exit in the direction the miles run', () => {
    const exits = [{ at: 1000, ref: '120' }];
    // Miles counting down (heading west on an even interstate, say).
    const down = (d: number) => 500 - Math.round(d / 100);
    expect(milepost(1300, exits, SCALE, down)).toBe(117);
    const up = (d: number) => Math.round(d / 100);
    expect(milepost(1300, exits, SCALE, up)).toBe(123);
  });

  it('falls back to the border estimate with no exits nearby', () => {
    expect(milepost(1000, [], SCALE, () => 77)).toBe(77);
    expect(milepost(1000, [{ at: 900_000, ref: '5' }], SCALE, () => 77)).toBe(77);
    expect(milepost(1000, undefined, SCALE, () => null)).toBeNull();
  });

  it('ignores a pair of exits whose numbers do not fit the distance', () => {
    const exits = [
      { at: 1000, ref: '3' },
      { at: 2000, ref: '210' },
    ];
    const v = milepost(1100, exits, SCALE, (d) => Math.round(d / 100));
    // Counts on from the nearer exit instead of jumping between 3 and 210.
    expect(v).toBe(4);
  });
});

describe('roadside: signs', () => {
  it('finds where the speed limit changes', () => {
    const limit = (d: number) => (d < 500 ? 35 : d < 900 ? 55 : 65);
    expect(limitChanges(0, 1000, limit).map((c) => c.mph)).toEqual([55, 65]);
    expect(limitChanges(0, 400, limit)).toEqual([]);
  });

  it('lists the next towns and the destination, nearest first', () => {
    const towns = [
      { at: 3000, name: 'Far Town' },
      { at: 1500, name: 'Near Town' },
      { at: 500, name: 'Behind' },
      { at: 9000, name: 'Way Off' },
    ];
    const lines = distanceSignLines(1000, towns, { at: 10_000, name: 'The End' }, (a, b) => (b - a) / 100);
    expect(lines).toEqual([
      { name: 'Near Town', miles: 5 },
      { name: 'Far Town', miles: 20 },
      { name: 'The End', miles: 90 },
    ]);
  });
});
