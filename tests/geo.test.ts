import { describe, expect, it } from 'vitest';
import { chaikin, haversineMeters, Path, resample } from '../src/geo/geo';
import { buildRouteData, CRUISE_SPEED, pathFromRoute, targetDriveSeconds, type RawRoute } from '../src/geo/route';
import { demoRawRoute } from '../src/geo/demoRoute';
import { shortLabel } from '../src/geo/geocode';

describe('geo helpers', () => {
  it('measures a degree of latitude as about 111 km', () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111195, -2);
  });

  it('resamples to even spacing and keeps the end points', () => {
    const pts = resample([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 1);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 10, y: 10 });
    expect(pts.length).toBe(21);
  });

  it('smooths corners without moving the ends', () => {
    const pts = chaikin([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 2);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 10, y: 10 });
    expect(pts.some((p) => p.x === 10 && p.y === 0)).toBe(false);
  });

  it('looks up points and headings along a path', () => {
    const path = new Path([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
    expect(path.length).toBe(200);
    expect(path.pointAt(150)).toEqual({ x: 100, y: 50 });
    expect(path.directionAt(50).x).toBeCloseTo(1);
    expect(path.directionAt(170).y).toBeCloseTo(1);
    expect(path.pointAt(9999)).toEqual({ x: 100, y: 100 });
  });
});

const rawFixture: RawRoute = {
  source: 'osm',
  startLabel: 'Denver',
  endLabel: 'Colorado Springs',
  coords: [
    { lat: 39.7, lng: -105.0 },
    { lat: 39.6, lng: -104.8 },
    { lat: 39.4, lng: -104.6 },
    { lat: 39.2, lng: -104.4 },
    { lat: 39.0, lng: -104.2 },
  ],
  realMeters: 120000,
  realSeconds: 4800,
  steps: [
    { location: { lat: 39.7, lng: -105.0 }, name: 'Colfax Avenue', type: 'depart' },
    { location: { lat: 39.4, lng: -104.6 }, name: 'Main Street US 85', type: 'turn', modifier: 'left' },
    { location: { lat: 39.0, lng: -104.2 }, name: '', type: 'arrive' },
  ],
  attribution: '© OpenStreetMap contributors (ODbL)',
};

describe('route data', () => {
  it('scales a route to a playable length and places steps in order', () => {
    const data = buildRouteData(rawFixture);
    const path = pathFromRoute(data);
    const expected = targetDriveSeconds(120000) * CRUISE_SPEED;
    expect(path.length / expected).toBeGreaterThan(0.9);
    expect(path.length / expected).toBeLessThan(1.05);
    expect(data.steps.map((s) => s.type)).toEqual(['depart', 'turn', 'arrive']);
    expect(data.steps[1].at).toBeGreaterThan(path.length * 0.3);
    expect(data.steps[1].at).toBeLessThan(path.length * 0.7);
  });

  it('builds the offline demo route', () => {
    const data = buildRouteData(demoRawRoute());
    expect(data.points.length).toBeGreaterThan(1000);
    expect(data.source).toBe('demo');
  });
});

describe('place labels', () => {
  it('shortens Nominatim names and drops postcodes', () => {
    expect(shortLabel('Denver, Denver County, Colorado, 80202, United States')).toBe('Denver, Denver County, Colorado');
  });
});
