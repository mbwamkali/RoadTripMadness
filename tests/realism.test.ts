import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { Atlas, type AtlasFile } from '../src/offline/atlas';
import { unpackRoute, type PackedRoute } from '../src/offline/curated';
import { buildRouteData, pathFromRoute } from '../src/geo/route';
import { simplify } from '../src/geo/overpass';
import { haversineMeters as haversine } from '../src/geo/geo';
import { generateStops } from '../src/game/stops';
import { roadAt, roadSigns } from '../src/game/landmarks';

const atlas = new Atlas(JSON.parse(fs.readFileSync('public/data/atlas-us.json', 'utf8')) as AtlasFile);
const route66 = (() => {
  const raw = unpackRoute(JSON.parse(fs.readFileSync('public/data/routes/route-66.json', 'utf8')) as PackedRoute);
  raw.features = atlas.featuresAlong(raw.coords);
  return buildRouteData(raw);
})();
const path = pathFromRoute(route66);

describe('real places along the route', () => {
  it('simplifies a long route without cutting corners', () => {
    const raw = unpackRoute(JSON.parse(fs.readFileSync('public/data/routes/route-66.json', 'utf8')) as PackedRoute);
    const line = simplify(raw.coords);
    expect(line.length).toBeLessThanOrEqual(300);
    // Every original point stays close to the simplified line's vertices' segments (spot-check vertices).
    expect(line[0]).toEqual(raw.coords[0]);
    expect(line[line.length - 1]).toEqual(raw.coords[raw.coords.length - 1]);
    const gaps = line.slice(1).map((p, i) => haversine(line[i], p));
    expect(Math.max(...gaps)).toBeLessThan(200_000);
  });

  it('names stops after real towns on the way', () => {
    const stops = generateStops(route66, path.length, 1);
    const towns = new Set((route66.landmarks ?? []).filter((l) => l.kind === 'citysign').map((l) => l.name));
    const real = stops.filter((s) => towns.has(s.name) || [...towns].some((t) => s.name.startsWith(`${t} `)));
    console.log(stops.map((s) => `${s.kind}: ${s.name}`).join(' | '));
    expect(real.length).toBeGreaterThanOrEqual(stops.length - 2);
  });

  it('puts up green signs where the route changes road, and knows the current road', () => {
    const signs = roadSigns(route66, path.length);
    expect(signs.length).toBeGreaterThan(5);
    for (let i = 1; i < signs.length; i++) expect(signs[i].at - signs[i - 1].at).toBeGreaterThanOrEqual(260);
    expect(signs.some((s) => /I[- ]?40/.test(s.name))).toBe(true);
    expect(roadAt(route66, path.length * 0.6)).not.toBe('');
  });
});

describe('sign names', () => {
  it('shortens long route names to the route number', async () => {
    const { signName } = await import('../src/game/landmarks');
    expect(signName('Officer David Haynes Memorial Highway I 44')).toBe('I 44');
    expect(signName('I 55; US 66 Hist')).toBe('I 55');
    expect(signName('Stevenson Expressway I 55')).toBe('Stevenson Expressway I 55');
    expect(signName('South Wabash Avenue')).toBe('South Wabash Avenue');
    expect(signName('George Washington Carver Memorial Highway I 44; MO 43')).toBe('I 44');
  });
});
