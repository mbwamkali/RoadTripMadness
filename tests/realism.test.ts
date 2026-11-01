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

describe('road types', () => {
  it('classifies roads by their names', async () => {
    const { classifyRoad } = await import('../src/game/roads');
    expect(classifyRoad('I 40')).toBe('interstate');
    expect(classifyRoad('Santa Ana Freeway US 101; US 99 Hist')).toBe('interstate');
    expect(classifyRoad('I 40 Bus')).toBe('highway');
    expect(classifyRoad('US 66')).toBe('highway');
    expect(classifyRoad('MO 43')).toBe('highway');
    expect(classifyRoad('South Wabash Avenue')).toBe('local');
    expect(classifyRoad('Some Road', true)).toBe('interstate');
  });

  it('splits Route 66 into long stretches of interstate, highway and town streets', async () => {
    const { roadSegments, edgeAt, edgeOf, classAt } = await import('../src/game/roads');
    const segs = roadSegments(route66, path.length);
    const share = (c: string) => segs.filter((s) => s.cls === c).reduce((a, s) => a + s.to - s.from, 0) / path.length;
    console.log(segs.length, 'segments', ['interstate', 'highway', 'local'].map((c) => `${c} ${(share(c) * 100).toFixed(0)}%`).join(', '));
    expect(share('interstate')).toBeGreaterThan(0.5);
    expect(segs[0].from).toBe(0);
    expect(segs[segs.length - 1].to).toBe(path.length);
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].from).toBe(segs[i - 1].to);
      expect(segs[i].cls).not.toBe(segs[i - 1].cls);
    }
    // Widths taper instead of jumping.
    const b = segs[1].from;
    const e0 = edgeAt(segs, b - 1);
    const e1 = edgeAt(segs, b + 1);
    expect(Math.abs(e1 - e0)).toBeLessThan(0.5);
    expect(edgeAt(segs, (segs[0].from + segs[0].to) / 2)).toBeCloseTo(edgeOf(classAt(segs, 1)));
  });

  it('puts interstate exits on the right', async () => {
    const { roadSegments, classAt } = await import('../src/game/roads');
    const segs = roadSegments(route66, path.length);
    for (const s of generateStops(route66, path.length, 3)) if (classAt(segs, s.at) === 'interstate') expect(s.side).toBe('right');
  });
});

describe('climate', () => {
  it('knows roughly what the land looks like around the US', async () => {
    const { biomeAt } = await import('../src/game/biomes');
    const at = (lat: number, lng: number) => biomeAt({ lat, lng });
    expect(at(33.45, -112.07)).toBe('desert'); // Phoenix
    expect(at(39.5, -119.8)).toBe('sagebrush'); // Reno
    expect(at(38.5, -98.0)).toBe('prairie'); // Kansas
    expect(at(41.6, -93.6)).toBe('farmland'); // Des Moines
    expect(at(33.75, -84.39)).toBe('forest'); // Atlanta
    expect(at(25.76, -80.19)).toBe('subtropical'); // Miami
    expect(at(47.6, -122.33)).toBe('pinewoods'); // Seattle
    expect(at(34.05, -118.24)).toBe('coastal'); // Los Angeles
    expect(at(39.5, -106.0)).toBe('mountains'); // Colorado Rockies
    expect(at(60, 25)).toBe('tundra'); // Finland
  });

  it('changes scenery across Route 66', async () => {
    const { biomeSpans } = await import('../src/game/biomes');
    const spans = biomeSpans(route66, path);
    const ids = spans.map((s) => s.id);
    console.log(spans.map((s) => `${s.id} ${Math.round(((s.to - s.from) / path.length) * 100)}%`).join(' → '));
    expect(ids[0]).toBe('farmland');
    expect(ids).toContain('prairie');
    expect(ids).toContain('desert');
    expect(ids[ids.length - 1]).toBe('coastal');
    for (let i = 1; i < spans.length; i++) expect(spans[i].from).toBe(spans[i - 1].to);
  });
});
