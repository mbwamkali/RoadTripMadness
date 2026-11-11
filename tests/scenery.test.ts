import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { Atlas, type AtlasFile } from '../src/offline/atlas';
import { buildRouteData, pathFromRoute } from '../src/geo/route';
import { generateStops } from '../src/game/stops';
import { fillLandmarks } from '../src/game/landmarks';

const atlas = new Atlas(JSON.parse(fs.readFileSync('public/data/atlas-us.json', 'utf8')) as AtlasFile);
const trip = (a: string, b: string, withFeatures = true) => {
  const from = atlas.search(a)[0];
  const to = atlas.search(b)[0];
  const raw = atlas.planTrip(from, to, from.label, to.label);
  if (withFeatures) raw.features = atlas.featuresAlong(raw.coords);
  const route = buildRouteData(raw);
  const path = pathFromRoute(route);
  const stops = generateStops(route, path.length, 5);
  return { route, path, stops, marks: fillLandmarks(route, path.length, stops, route.landmarks ?? [], 5) };
};

describe('procedural scenery offline', () => {
  it('fills the desert with buttes and ghost towns, and the plains with farms and grain elevators', () => {
    const desert = trip('Phoenix', 'El Paso').marks.map((l) => l.kind);
    expect(desert.some((k) => k === 'mesa' || k === 'ghosttown')).toBe(true);
    const plains = trip('Omaha', 'Des Moines').marks.map((l) => l.kind);
    expect(plains.some((k) => k === 'farmstead' || k === 'grain')).toBe(true);
  });

  it('puts made-up sights closer together when the map has nothing to show', () => {
    const made = (withFeatures: boolean) => {
      const t = trip('Denver', 'Kansas City', withFeatures);
      return t.marks.filter((l) => !l.real && l.kind !== 'mountains').length / (t.path.length / 1000);
    };
    expect(made(false)).toBeGreaterThan(1);
  });

  it('every turn-off has a cross street, even with no map data', () => {
    const { stops } = trip('Denver', 'Kansas City', false);
    expect(stops.length).toBeGreaterThan(3);
    expect(stops.every((s) => !!s.street)).toBe(true);
    expect(stops.some((s) => /\d/.test(s.street!) || / (St|Ave|Rd|Ln|Blvd|Dr|Loop)$/.test(s.street!))).toBe(true);
  });
});

describe('mountains only where the land has them', () => {
  it('turns a mound in flat country into a hill, and keeps mountains in mountain country', async () => {
    const { isMountain } = await import('../src/game/landmarks');
    expect(isMountain({ name: 'Huntington Mound' }, 'subtropical')).toBe(false);
    expect(isMountain({ name: 'Big Bald' }, 'subtropical')).toBe(false);
    expect(isMountain({ name: 'Signal Hill' }, 'mountains')).toBe(false);
    expect(isMountain({ name: 'Pikes Peak', ele: 4302 }, 'mountains')).toBe(true);
    expect(isMountain({ name: 'Low Peak', ele: 300 }, 'mountains')).toBe(false);
  });

  it('puts no made-up mountain ranges on the Gulf coast', () => {
    const { route, path, stops } = trip('Houston', 'Beaumont');
    const marks = fillLandmarks(route, path.length, stops, route.landmarks ?? [], 5);
    expect(marks.filter((l) => l.kind === 'mountains' || l.kind === 'peak')).toHaveLength(0);
  });
});
