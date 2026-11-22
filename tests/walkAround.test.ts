import { describe, expect, it } from 'vitest';
import { walkAround, type GroundBox } from '../src/town/walkAround';

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
  it('lets you get in and out (an end inside the box room)', () => {
    expect(walkAround({ x: 1.4, z: 0 }, { x: 8, z: 0 }, car)).toEqual([]);
  });
  it('goes round a small motorcycle too', () => {
    const bike: GroundBox = { x: 0, z: 0, yaw: Math.PI / 2, halfW: 0.45, halfL: 1.1 };
    const a = { x: 0, z: -3 };
    const b = { x: 0, z: 3 };
    const via = walkAround(a, b, bike);
    expect(clear(a, via, b, bike)).toBe(true);
  });
});
