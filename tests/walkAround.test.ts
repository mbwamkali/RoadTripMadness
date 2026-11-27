import { describe, expect, it } from 'vitest';
import { offTheRide, walkAround, type GroundBox } from '../src/town/walkAround';

const car: GroundBox = { x: 0, z: 0, yaw: 0, halfW: 1, halfL: 2.3 };
/** Does the path from a through via to b stay out of the box (grown by `room`)? */
function clear(a: { x: number; z: number }, via: { x: number; z: number }[], b: { x: number; z: number }, box: GroundBox, room = 0.59) {
  const pts = [a, ...via, b];
  for (let i = 0; i < pts.length - 1; i++)
    for (let t = 0; t <= 1; t += 0.01) {
      const x = pts[i].x + (pts[i + 1].x - pts[i].x) * t - box.x;
      const z = pts[i].z + (pts[i + 1].z - pts[i].z) * t - box.z;
      const s = Math.sin(box.yaw), c = Math.cos(box.yaw);
      const u = x * c - z * s, v = x * s + z * c;
      if (Math.abs(u) < box.halfW + room && Math.abs(v) < box.halfL + room) return false;
    }
  return true;
}

describe('walking round the parked ride', () => {
  it('leaves a clear straight line alone', () => {
    expect(walkAround({ x: 5, z: -5 }, { x: 5, z: 5 }, car)).toEqual([]);
  });
  it('goes round a car in the way, by the shorter side', () => {
    const a = { x: -4, z: 0.5 };
    const b = { x: 4, z: 0.5 };
    const via = walkAround(a, b, car);
    expect(via.length).toBe(2);
    expect(clear(a, via, b, car)).toBe(true);
    // The front is nearer (z > 0).
    expect(via.every((p) => p.z > 0)).toBe(true);
  });
  it('works for a turned box (a pickup parked at an angle)', () => {
    const truck: GroundBox = { x: 10, z: -3, yaw: 0.8, halfW: 1.1, halfL: 2.8 };
    const a = { x: 4, z: -3 };
    const b = { x: 16, z: -3 };
    const via = walkAround(a, b, truck);
    expect(via.length).toBeGreaterThan(0);
    expect(clear(a, via, b, truck)).toBe(true);
  });
  it('steps out from right beside the car, then goes round it to the far side', () => {
    const a = { x: 1.4, z: 0 };
    const b = { x: -8, z: 0 };
    const via = walkAround(a, b, car);
    expect(via[0].x).toBeGreaterThan(1.59);
    expect(Math.abs(via[0].z)).toBeLessThan(0.01);
    expect(clear(via[0], via.slice(1), b, car)).toBe(true);
  });
  it('walks up to the car door round it, ending beside it', () => {
    const a = { x: -8, z: 0 };
    const b = { x: 1.4, z: 0 };
    const via = walkAround(a, b, car);
    const last = via[via.length - 1];
    expect(last.x).toBeGreaterThan(1.59);
    expect(clear(a, via.slice(0, -1), last, car)).toBe(true);
  });
  it('leaves a walk alone when both ends are beside the car', () => {
    expect(walkAround({ x: 1.4, z: 0 }, { x: 1.4, z: 1 }, car)).toEqual([]);
  });
  it('goes round a small motorcycle too', () => {
    const bike: GroundBox = { x: 0, z: 0, yaw: Math.PI / 2, halfW: 0.45, halfL: 1.1 };
    const a = { x: 0, z: -3 };
    const b = { x: 0, z: 3 };
    const via = walkAround(a, b, bike);
    expect(clear(a, via, b, bike)).toBe(true);
  });
  it('moves a spot on the car to beside it, and leaves others alone', () => {
    const o = offTheRide({ x: 0.3, z: 2.0 }, car);
    expect(o.z).toBeGreaterThan(2.89);
    expect(offTheRide({ x: 1.5, z: 0 }, car)).toEqual({ x: 1.5, z: 0 });
  });
});
