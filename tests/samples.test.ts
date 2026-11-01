import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SAMPLES, sampleCatship, sampleMothership } from '../src/scenes/samples';

const named = (g: THREE.Object3D, n: string) => {
  const out: THREE.Object3D[] = [];
  g.traverse((o) => o.name === n && out.push(o));
  return out;
};

describe('sample models', () => {
  it('builds every sample standing on the ground', () => {
    for (const [name, build] of Object.entries(SAMPLES)) {
      const g = build();
      g.updateMatrixWorld(true);
      const b = new THREE.Box3();
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && o.name !== 'charge') b.expandByObject(o);
      });
      expect(b.isEmpty(), name).toBe(false);
      expect(b.min.y, name).toBeGreaterThan(-3); // saucers hang below their centre
    }
  });

  it('keeps the parts the fight animations move', () => {
    const brute = SAMPLES.brute();
    for (const n of ['legL', 'legR', 'armL', 'armR']) expect(named(brute, n)).toHaveLength(1);
    expect(named(SAMPLES.warrig(), 'turret')).toHaveLength(1);
    for (const ship of [sampleCatship(), sampleMothership()]) {
      expect(named(ship, 'charge')).toHaveLength(1);
      expect(named(ship, 'light').length).toBeGreaterThan(5);
    }
  });

  it('gives each ship its own light material so one charging ship does not light up the rest', () => {
    const a = named(sampleCatship(), 'light')[0] as THREE.Mesh;
    const b = named(sampleCatship(), 'light')[0] as THREE.Mesh;
    expect(a.material).not.toBe(b.material);
    expect((a.material as THREE.Material).userData.shared).toBeFalsy();
  });

  it('marks cached materials shared so clean-up leaves them alone', () => {
    let shared = 0;
    SAMPLES.pickup().traverse((o) => {
      if ((o as THREE.Mesh).isMesh && ((o as THREE.Mesh).material as THREE.Material).userData.shared) shared++;
    });
    expect(shared).toBeGreaterThan(10);
  });
});
