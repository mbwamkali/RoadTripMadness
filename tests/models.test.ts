import { existsSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MODEL_SPECS, modelMesh, normalise, setModelGeometry, type ModelName } from '../src/scenes/models';
import { quality } from '../src/scenes/quality';

describe('models', () => {
  it('has a built file for every model, and they stay light', () => {
    let total = 0;
    for (const name of Object.keys(MODEL_SPECS)) {
      const f = `public/models/${name}.glb`;
      expect(existsSync(f), f).toBe(true);
      total += statSync(f).size;
    }
    expect(total).toBeLessThan(2_000_000);
  });

  it('centres a model, stands it on the ground and scales it', () => {
    const box = new THREE.BoxGeometry(2, 4, 6).translate(10, 5, -3);
    const tall = normalise(box, { height: 8 });
    const b = tall.boundingBox!;
    expect(b.min.y).toBeCloseTo(0);
    expect(b.max.y).toBeCloseTo(8);
    expect(b.min.x + b.max.x).toBeCloseTo(0);
    expect(b.min.z + b.max.z).toBeCloseTo(0);
    expect(tall.userData.shared).toBe(true);
    const car = normalise(box, { length: 3 });
    expect(car.boundingBox!.max.z - car.boundingBox!.min.z).toBeCloseTo(3);
  });

  it('gives meshes only on Medium and High', () => {
    const name: ModelName = 'rock-1';
    setModelGeometry(name, normalise(new THREE.BoxGeometry(), MODEL_SPECS[name]));
    const was = quality.level;
    quality.level = 'medium';
    expect(modelMesh(name)).not.toBeNull();
    quality.level = 'low';
    expect(modelMesh(name)).toBeNull();
    quality.level = was;
    setModelGeometry(name, null);
  });
});
