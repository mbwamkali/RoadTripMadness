import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { interstateNumber, setStateMap, StateMap, stateLines, type StatesFile } from '../src/geo/states';
import { Atlas, type AtlasFile } from '../src/offline/atlas';
import { unpackRoute, type PackedRoute } from '../src/offline/curated';
import { buildRouteData, pathFromRoute } from '../src/geo/route';
import { generateStops } from '../src/game/stops';
import { fillLandmarks } from '../src/game/landmarks';

const map = new StateMap(JSON.parse(fs.readFileSync('public/data/states-us.json', 'utf8')) as StatesFile);

describe('US states', () => {
  it('knows which state a place is in', () => {
    expect(map.stateAt({ lat: 35.2, lng: -101.83 })?.code).toBe('TX'); // Amarillo
    expect(map.stateAt({ lat: 36.17, lng: -115.14 })?.code).toBe('NV'); // Las Vegas
    expect(map.stateAt({ lat: 41.88, lng: -87.63 })?.code).toBe('IL'); // Chicago
    expect(map.stateAt({ lat: 30, lng: -140 })).toBeNull(); // Pacific
  });

  it('numbers interstate exits by miles into the state', () => {
    // I-40 through Amarillo is around exit 70; I-15 at Barstow around exit 180 (from the south).
    const amarillo = map.exitNumber({ lat: 35.2, lng: -101.83 }, 40)!;
    expect(amarillo).toBeGreaterThan(55);
    expect(amarillo).toBeLessThan(90);
    const barstow = map.exitNumber({ lat: 34.9, lng: -117.02 }, 15)!;
    expect(barstow).toBeGreaterThan(140);
    expect(barstow).toBeLessThan(260);
    expect(interstateNumber('I 40')).toBe(40);
    expect(interstateNumber('I-5')).toBe(5);
    expect(interstateNumber('US 66')).toBeNull();
  });

  it('finds every state line on Route 66 and puts up a sign and exit numbers', () => {
    setStateMap(map);
    const atlas = new Atlas(JSON.parse(fs.readFileSync('public/data/atlas-us.json', 'utf8')) as AtlasFile);
    const raw = unpackRoute(JSON.parse(fs.readFileSync('public/data/routes/route-66.json', 'utf8')) as PackedRoute);
    raw.features = atlas.featuresAlong(raw.coords);
    const route = buildRouteData(raw);
    const path = pathFromRoute(route);
    const codes = stateLines(route, path, map).map((s) => s.code);
    expect(route.states?.map((s) => s.code)).toEqual(codes);
    console.log(codes.join(' '));
    // The curated route follows I-44, which skips Route 66's few miles of Kansas.
    expect(codes).toEqual(['IL', 'MO', 'OK', 'TX', 'NM', 'AZ', 'CA']);
    const stops = generateStops(route, path.length, 7);
    const signs = fillLandmarks(route, path.length, stops, route.landmarks ?? [], 7).filter((l) => l.kind === 'stateline');
    expect(signs.map((l) => l.name)).toContain('Arizona');
    const exits = stops.filter((s) => s.exit);
    console.log(exits.map((s) => `Exit ${s.exit} ${s.name}`).join(', '));
    expect(exits.length).toBeGreaterThan(0);
    setStateMap(null);
  });
});

describe('play area (lower 48 only)', () => {
  it('keeps trips inside the contiguous US', async () => {
    const { inPlayArea, inLower48Box } = await import('../src/geo/coverage');
    for (const p of [
      { lat: 35.2, lng: -101.83 }, // Amarillo
      { lat: 24.56, lng: -81.78 }, // Key West
      { lat: 47.61, lng: -122.33 }, // Seattle
      { lat: 44.39, lng: -68.2 }, // Bar Harbor
      { lat: 38.9, lng: -77.04 }, // Washington DC
    ])
      expect(inPlayArea(p, map)).toBe(true);
    for (const p of [
      { lat: 43.65, lng: -79.38 }, // Toronto
      { lat: 31.87, lng: -116.6 }, // Ensenada (towns right on the border, like Tijuana, are let in)
      { lat: 21.31, lng: -157.86 }, // Honolulu
      { lat: 61.22, lng: -149.9 }, // Anchorage
      { lat: 18.47, lng: -66.11 }, // San Juan
      { lat: 51.51, lng: -0.13 }, // London
    ])
      expect(inPlayArea(p, map)).toBe(false);
    expect(inLower48Box({ lat: 21.31, lng: -157.86 })).toBe(false);
    expect(inPlayArea({ lat: 40.7, lng: -74 }, null)).toBe(true);
  });
});
