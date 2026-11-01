import { describe, expect, it } from 'vitest';
import { buildRouteData, pathFromRoute } from '../src/geo/route';
import { demoRawRoute } from '../src/geo/demoRoute';
import { fillLandmarks, lineCrossings, PathIndex, placeFeatures } from '../src/game/landmarks';
import { buildOverpassQuery, parseOverpass } from '../src/geo/overpass';
import { newGame } from '../src/game/state';
import { Path } from '../src/geo/geo';

const raw = demoRawRoute();
const route = buildRouteData(raw);
const path = pathFromRoute(route);

describe('landmarks', () => {
  it('finds where a line crosses the road', () => {
    const p = new Path(Array.from({ length: 51 }, (_, k) => ({ x: 0, y: k * 2 })));
    const idx = new PathIndex(p, 10);
    const hits = lineCrossings(p, idx, [{ x: -20, y: 40 }, { x: 20, y: 40 }]);
    expect(hits).toHaveLength(1);
    expect(hits[0].at).toBeCloseTo(40, 0);
    expect(hits[0].angle).toBeCloseTo(Math.PI / 2, 1);
  });

  it('places real features from OpenStreetMap next to the route', () => {
    const mid = raw.coords[200];
    const features = parseOverpass({
      elements: [
        { type: 'node', lat: mid.lat + 0.002, lon: mid.lng, tags: { tourism: 'attraction', name: 'Giant Cactus' } },
        { type: 'node', lat: mid.lat, lon: mid.lng, tags: { natural: 'peak', name: 'Mount Nope' } },
        { type: 'way', geometry: [{ lat: mid.lat - 0.05, lon: mid.lng + 0.05 }, { lat: mid.lat + 0.05, lon: mid.lng - 0.05 }], tags: { waterway: 'river', name: 'Dry River' } },
        { type: 'node', lat: 0, lon: 0, tags: { tourism: 'attraction', name: 'Far away' } },
        { type: 'node', lat: mid.lat, lon: mid.lng, tags: { amenity: 'bench', name: 'Ignored' } },
      ],
    });
    expect(features.map((f) => f.kind)).toEqual(['attraction', 'peak', 'river', 'attraction']);
    const placed = placeFeatures(route, path, features);
    const names = placed.map((l) => l.name);
    expect(names).toContain('Giant Cactus');
    expect(names).toContain('Dry River');
    expect(names).not.toContain('Far away');
    const river = placed.find((l) => l.kind === 'river')!;
    expect(river.at / path.length).toBeGreaterThan(0.4);
    expect(river.at / path.length).toBeLessThan(0.55);
  });

  it('keeps something to look at along the whole trip', () => {
    const s = newGame(route, 5);
    const sights = s.landmarks.filter((l) => l.kind !== 'mountains').map((l) => l.at);
    for (let d = 1000; d < path.length - 1000; d += 1000) {
      expect(sights.some((a) => Math.abs(a - d) < 1000)).toBe(true);
    }
    expect(s.landmarks.some((l) => l.kind === 'river')).toBe(true);
    expect(s.landmarks.some((l) => l.name.startsWith('Welcome to'))).toBe(true);
  });

  it('builds a polyline Overpass query', () => {
    const q = buildOverpassQuery(raw.coords);
    expect(q).toContain('around:1500,');
    expect(q).toContain('out geom');
    // Every selector is narrowed by a bounding box before the around filter.
    for (const line of q.split('\n').filter((l) => l.includes('around:'))) expect(line).toMatch(/\)\(around:\d+,[-\d.,]+\);$/);
    expect(q.split('\n').filter((l) => l.includes('around:')).every((l) => /^(node|way|nwr)\[.*\]\([-\d.]+,[-\d.]+,[-\d.]+,[-\d.]+\)\(around/.test(l))).toBe(true);
    expect(fillLandmarks(route, path.length, [], [], 1).length).toBeGreaterThan(5);
  });
});
