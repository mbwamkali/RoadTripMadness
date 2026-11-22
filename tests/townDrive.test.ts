import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { speedPlan, TOWN_SPEED } from '../src/town/play';

const line = (len: number) => new THREE.LineCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, len));

describe('town driving speed plan', () => {
  it('starts and ends at a standstill', () => {
    const p = speedPlan(line(40), 40, { cruise: TOWN_SPEED, top: 40 });
    expect(p.speedAt(0)).toBe(0);
    expect(p.speedAt(40)).toBe(0);
    expect(p.speedAt(20)).toBeGreaterThan(10);
  });

  it('a lot-to-lot hop takes a few seconds', () => {
    // Next door (36 m) and across the street and up two lots (80 m).
    expect(speedPlan(line(36), 36, { cruise: TOWN_SPEED, top: 40 }).secs).toBeLessThan(3.3);
    expect(speedPlan(line(80), 80, { cruise: TOWN_SPEED, top: 40 }).secs).toBeLessThan(3.6);
  });

  it('speeds up on a long street so it still takes about 5 seconds at most', () => {
    const p = speedPlan(line(140), 140, { cruise: TOWN_SPEED, top: 40 });
    expect(p.secs).toBeLessThan(5);
    expect(p.speedAt(70)).toBeGreaterThan(TOWN_SPEED);
    expect(p.speedAt(70)).toBeLessThanOrEqual(40);
  });

  it('slows for a tight U-turn', () => {
    const pts: THREE.Vector3[] = [];
    for (let z = -20; z < 0; z += 2) pts.push(new THREE.Vector3(4, 0, z));
    for (let i = 0; i <= 20; i++) {
      const t = (Math.PI * i) / 20;
      pts.push(new THREE.Vector3(4 * Math.cos(t), 0, 4 * Math.sin(t)));
    }
    for (let z = -2; z > -22; z -= 2) pts.push(new THREE.Vector3(-4, 0, z));
    const c = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const len = c.getLength();
    const p = speedPlan(c, len, { cruise: TOWN_SPEED, top: 40 });
    // Middle of the half circle: well under cruising speed; at most sqrt(40 m/s² × 4 m), about 12.6 m/s,
    // when a long way round has to hurry.
    expect(p.speedAt(20 + (Math.PI * 4) / 2)).toBeLessThan(13);
    expect(p.speedAt(20 + (Math.PI * 4) / 2)).toBeLessThan(TOWN_SPEED);
  });

  it('keeps backing up slow', () => {
    const p = speedPlan(line(30), 30, { cruise: 10, top: 10 });
    expect(p.speedAt(15)).toBeLessThanOrEqual(10);
  });
});
