import { describe, expect, it } from 'vitest';
import { animalBump, animalFor, Animals, ANIMAL_GAP, bumpAnimal } from '../src/game/animals';
import type { RoadSegment } from '../src/game/roads';
import { newGame } from '../src/game/state';
import { demoRawRoute } from '../src/geo/demoRoute';
import { buildRouteData } from '../src/geo/route';

const local: RoadSegment[] = [{ from: 0, to: 100_000, cls: 'local' }];
const freeway: RoadSegment[] = [{ from: 0, to: 100_000, cls: 'interstate' }];

/** Drives at a steady speed, stepping the animals every frame. */
function drive(a: Animals, from: number, to: number, speed = 30, dt = 1 / 30): void {
  for (let d = from; d < to; d += speed * dt) a.step(dt, d, speed);
}

describe('animal crossings', () => {
  it('puts cows on country roads and giant armadillos on freeways', () => {
    expect(animalFor('local', false, 0.1)).toBe('cow');
    expect(animalFor('highway', false, 0.1)).toBe('cow');
    expect(animalFor('interstate', false, 0.9)).toBe('armadillo');
    expect(animalFor('metro', false, 0.9)).toBe('armadillo');
    // Desert highways get armadillos some of the time.
    expect(animalFor('highway', true, 0.1)).toBe('armadillo');
    expect(animalFor('highway', true, 0.9)).toBe('cow');
  });

  it('turns up about twice as often in Texas and the desert', () => {
    const count = (boost: number) => {
      const a = new Animals(local, 100_000, 7, 0, { boost: () => boost });
      const herds = new Set<number>();
      for (let d = 0; d < 90_000; d += 200) {
        a.step(0, d, 30);
        a.list.forEach((x) => herds.add(x.herd));
      }
      return herds.size;
    };
    const normal = count(1);
    expect(normal).toBeGreaterThan(90_000 / ANIMAL_GAP / 2);
    expect(count(2)).toBeGreaterThan(normal * 1.6);
  });

  it('keeps out of blocked stretches', () => {
    const a = new Animals(local, 100_000, 3, 0, { blocked: () => true });
    drive(a, 0, 20_000, 60, 1 / 4);
    expect(a.list).toHaveLength(0);
  });

  it('waits at the roadside, then walks across as the car comes', () => {
    const a = new Animals(freeway, 100_000, 5, 0, { edgeAt: () => 10.7 });
    for (let d = 0; !a.list.length && d < 50_000; d += 100) a.step(0, d, 40);
    const first = a.list[0];
    expect(first.mode).toBe('waiting');
    expect(Math.abs(first.x)).toBeGreaterThan(10.7);
    const startX = first.x;
    // Close in: it sets off a few seconds before the car arrives and moves across.
    drive(a, first.d - 200, first.d - 30, 40);
    expect(first.mode).toBe('crossing');
    expect(Math.sign(first.x - startX)).toBe(first.dir);
  });

  it('finishes crossing and grazes if you wait for it', () => {
    const a = new Animals(local, 100_000, 9, 0, { edgeAt: () => 4.5 });
    a.list.push({ id: 99, kind: 'cow', herd: 99, d: 500, x: -6, dir: 1, mode: 'crossing', lead: 3 });
    for (let i = 0; i < 30 * 20; i++) a.step(1 / 30, 450, 0);
    const cow = a.list.find((x) => x.id === 99)!;
    expect(cow.mode).toBe('done');
    expect(cow.x).toBeGreaterThan(4.5);
    expect(a.hit(500, cow.x)).toBeNull();
  });

  it('a honk sends them off the road away from the car', () => {
    const a = new Animals(local, 100_000, 9, 0, { edgeAt: () => 4.5 });
    a.list.push({ id: 1, kind: 'cow', herd: 1, d: 100, x: 1, dir: -1, mode: 'crossing', lead: 3 });
    a.list.push({ id: 2, kind: 'cow', herd: 1, d: 400, x: 1, dir: -1, mode: 'crossing', lead: 3 });
    expect(a.honk(0, -2)).toBe(1); // only the one in range
    const [near, far] = a.list;
    expect(near.mode).toBe('hurry');
    expect(near.dir).toBe(1); // the car is to its left, so it goes right
    expect(far.mode).toBe('crossing');
    for (let i = 0; i < 60; i++) a.step(1 / 30, 0, 0);
    expect(near.mode).toBe('done');
  });

  it('finds the animal in your path', () => {
    const a = new Animals(local, 100_000, 9, 0);
    a.list.push({ id: 1, kind: 'armadillo', herd: 1, d: 50, x: 2, dir: -1, mode: 'crossing', lead: 3 });
    expect(a.inPath(0, 2.2, 70)?.id).toBe(1);
    expect(a.inPath(0, 9, 70)).toBeNull();
    expect(a.inPath(0, 2.2, 30)).toBeNull();
  });

  it('a hit is just a bump: a little damage, the animal trots off and is never counted as a kill', () => {
    const s = newGame(buildRouteData(demoRawRoute()), 1);
    const a = new Animals(local, 100_000, 9, 0);
    a.list.push({ id: 1, kind: 'cow', herd: 1, d: 100, x: 2, dir: -1, mode: 'crossing', lead: 3 });
    const cow = a.hit(100, 2.5)!;
    expect(cow).not.toBeNull();
    const before = s.health;
    const kills = s.kills;
    expect(bumpAnimal(s, cow, 2.5)).toBe(2);
    expect(s.health).toBe(before - 2);
    expect(s.kills).toBe(kills);
    expect(cow.mode).toBe('dazed');
    expect(a.hit(100, 2.5)).toBeNull();
    expect(a.list).toHaveLength(1);
  });

  it('the ram plate softens the bump to nothing at full strength', () => {
    expect(animalBump(0)).toBe(2);
    expect(animalBump(1)).toBe(2);
    expect(animalBump(2)).toBe(1);
    expect(animalBump(3)).toBe(0);
  });
});
