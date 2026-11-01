import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { Atlas, turnModifier, type AtlasFile } from '../src/offline/atlas';
import { buildRouteData } from '../src/geo/route';
import { generateStops } from '../src/game/stops';
import { pathFromRoute } from '../src/geo/route';

const atlas = new Atlas(JSON.parse(fs.readFileSync('public/data/atlas-us.json', 'utf8')) as AtlasFile);
const find = (q: string) => {
  const p = atlas.search(q)[0];
  if (!p) throw new Error(`no ${q}`);
  return p;
};

describe('offline atlas', () => {
  it('finds cities by name and state', () => {
    expect(find('denver').label).toBe('Denver, CO');
    expect(find('portland, me').label).toBe('Portland, ME');
    expect(find('Portland').label).toBe('Portland, OR');
  });

  it('plans New York to Los Angeles across the country', () => {
    const a = find('New York');
    const b = find('Los Angeles');
    const t0 = performance.now();
    const raw = atlas.planTrip(a, b, a.label, b.label);
    const ms = performance.now() - t0;
    const km = raw.realMeters / 1000;
    console.log(`NY-LA ${Math.round(km)} km, ${(raw.realSeconds / 3600).toFixed(1)} h, ${raw.coords.length} pts, ${raw.steps.length} steps, ${ms.toFixed(0)} ms`);
    expect(km).toBeGreaterThan(4200);
    expect(km).toBeLessThan(5600);
    expect(raw.steps.some((s) => s.name.startsWith('I-'))).toBe(true);
    expect(raw.steps.filter((s) => s.type === 'town').length).toBeGreaterThan(10);
    const route = buildRouteData(raw);
    const stops = generateStops(route, pathFromRoute(route).length, 1);
    expect(stops.length).toBeGreaterThan(5);
    // Real sights from the atlas: river crossings, peaks, towns.
    const kinds = new Set(route.landmarks?.map((l) => l.kind));
    console.log(`landmarks: ${route.landmarks?.length}`, [...kinds].join(','), route.landmarks?.filter((l) => l.kind === 'river').slice(0, 5).map((l) => l.name));
    expect(kinds.has('river')).toBe(true);
    expect(kinds.has('citysign')).toBe(true);
  });

  it('plans short regional trips', () => {
    for (const [x, y] of [['Seattle', 'Spokane'], ['Miami', 'Orlando'], ['Chicago', 'St. Louis'], ['Boston', 'Albany'], ['Dallas', 'Houston']]) {
      const a = find(x);
      const b = find(y);
      const raw = atlas.planTrip(a, b, a.label, b.label);
      const crow = Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180));
      console.log(`${x}-${y}: ${Math.round(raw.realMeters / 1000)} km (crow ${Math.round(crow)})`);
      expect(raw.realMeters / 1000).toBeLessThan(crow * 1.7);
      expect(raw.realMeters / 1000).toBeGreaterThan(crow * 0.95);
    }
  });

  it('refuses places far from any highway', () => {
    expect(() => atlas.planTrip({ lat: 21.3, lng: -157.8 }, find('Denver'), 'Honolulu', 'Denver')).toThrow(/too far/);
  });

  it('tells left from right', () => {
    // Heading north, then east is a right turn.
    expect(turnModifier({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }, { lat: 1, lng: 1 })).toBe('right');
    expect(turnModifier({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }, { lat: 1, lng: -1 })).toBe('left');
  });
});
