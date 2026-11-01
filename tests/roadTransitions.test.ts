import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { limitCurvature, Path, removeSpurs, resample, type Vec2 } from '../src/geo/geo';
import { buildRouteData, MIN_TURN_RADIUS } from '../src/geo/route';
import { unpackRoute, type PackedRoute } from '../src/offline/curated';
import { crossSectionAt, edgeOf, PROFILES, TAPER, type RoadSegment } from '../src/game/roads';
import { clampLane, laneCenter, sideIndex } from '../src/game/traffic';

/** Tightest bend along a path, as a radius (sampled every 4 units over an 8-unit window). */
function tightestRadius(path: Path): number {
  let min = Infinity;
  for (let d = 8; d < path.length - 8; d += 4) {
    const a = path.directionAt(d - 4, 4);
    const b = path.directionAt(d + 4, 4);
    const turn = Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y)));
    if (turn > 1e-6) min = Math.min(min, 8 / turn);
  }
  return min;
}

describe('road corners', () => {
  it('cuts out a spur where the route goes out and comes straight back', () => {
    const line: Vec2[] = [];
    for (let x = 0; x <= 100; x += 10) line.push({ x, y: 0 });
    for (let y = 10; y <= 40; y += 10) line.push({ x: 100, y });
    for (let y = 30; y >= 0; y -= 10) line.push({ x: 101, y });
    for (let x = 110; x <= 200; x += 10) line.push({ x, y: 0 });
    const out = removeSpurs(line, 150, 12);
    expect(Math.max(...out.map((p) => p.y))).toBeLessThan(10);
  });

  it('rounds a right-angle corner out to the minimum radius', () => {
    const corner = resample([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }], 4);
    const round = limitCurvature(corner, MIN_TURN_RADIUS, 4);
    expect(tightestRadius(new Path(round))).toBeGreaterThan(MIN_TURN_RADIUS * 0.8);
  });

  it('never bends a classic trip tighter than the widest road can follow', () => {
    for (const id of ['route-66', 'pacific-coast', 'coast-to-coast']) {
      const raw = unpackRoute(JSON.parse(readFileSync(`public/data/routes/${id}.json`, 'utf8')) as PackedRoute);
      const route = buildRouteData(raw);
      const path = new Path(route.points.map(([x, y]) => ({ x, y })));
      // Widest pavement plus its shoulder must fit inside every bend.
      expect(tightestRadius(path)).toBeGreaterThan(edgeOf('metro') + 3);
    }
  });
});

describe('road type changes', () => {
  const segs: RoadSegment[] = [
    { from: 0, to: 1000, cls: 'metro' },
    { from: 1000, to: 2000, cls: 'interstate' },
    { from: 2000, to: 3000, cls: 'highway' },
    { from: 3000, to: 4000, cls: 'local' },
    { from: 4000, to: 5000, cls: 'interstate' },
  ];

  it('changes width smoothly, with no jumps anywhere', () => {
    let last = crossSectionAt(segs, 0);
    for (let d = 0.5; d < 5000; d += 0.5) {
      const xs = crossSectionAt(segs, d);
      expect(Math.abs(xs.edge - last.edge)).toBeLessThan(0.2);
      expect(Math.abs(xs.median - last.median)).toBeLessThan(0.1);
      last = xs;
    }
  });

  it('keeps lanes their real width while a lane merges away', () => {
    const mid = crossSectionAt(segs, 1000 - TAPER / 2);
    expect(mid.laneWidth).toBeCloseTo(PROFILES.metro.laneWidth);
    expect(mid.lanes).toBeGreaterThan(2);
    expect(mid.lanes).toBeLessThan(4);
    // Narrowing is finished by the change, widening starts after it.
    expect(crossSectionAt(segs, 999.9).edge).toBeCloseTo(edgeOf('interstate'), 1);
    expect(crossSectionAt(segs, 4000.1).edge).toBeCloseTo(edgeOf('local'), 1);
    expect(crossSectionAt(segs, 4000 + TAPER).edge).toBeCloseTo(edgeOf('interstate'));
  });

  it('slides cars over as their lane ends, so renumbering lanes moves nobody', () => {
    for (const [b, from, to] of [[1000, 'metro', 'interstate'], [3000, 'highway', 'local']] as const) {
      for (let lane = -PROFILES[from].lanes; lane < PROFILES[from].lanes; lane++) {
        const before = laneCenter(crossSectionAt(segs, b - 0.01), lane);
        // Traffic merges to the outermost lane left (see Traffic.step); the player is clamped.
        const n = PROFILES[to].lanes;
        const merged = sideIndex(lane) >= n ? (lane < 0 ? -n : n - 1) : clampLane(to, lane);
        if (lane < 0 && merged >= 0) continue;
        const after = laneCenter(crossSectionAt(segs, b + 0.01), merged);
        expect(Math.abs(after - before)).toBeLessThan(0.1);
      }
    }
  });
});
