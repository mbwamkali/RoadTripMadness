import { describe, expect, it } from 'vitest';
import { chaikin, haversineMeters, Path, resample } from '../src/geo/geo';
import { buildRouteData, CRUISE_SPEED, pathFromRoute, targetDriveSeconds } from '../src/geo/route';
import { parseOsrm, osrmRouteUrl, type OsrmResponse } from '../src/geo/osrm';
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

const osrmFixture: OsrmResponse = {
  code: 'Ok',
  routes: [
    {
      distance: 120000,
      duration: 4800,
      geometry: {
        type: 'LineString',
        coordinates: [
          [-105.0, 39.7],
          [-104.8, 39.6],
          [-104.6, 39.4],
          [-104.4, 39.2],
          [-104.2, 39.0],
        ],
      },
      legs: [
        {
          steps: [
            { name: 'Colfax Avenue', maneuver: { location: [-105.0, 39.7], type: 'depart' } },
            { name: 'Main Street', ref: 'US 85', maneuver: { location: [-104.6, 39.4], type: 'turn', modifier: 'left' } },
            { name: '', maneuver: { location: [-104.2, 39.0], type: 'arrive' } },
          ],
        },
      ],
    },
  ],
};

describe('OSRM routing', () => {
  it('builds a request with lng,lat order and full geometry', () => {
    const url = osrmRouteUrl({ lat: 39.7, lng: -105 }, { lat: 39, lng: -104.2 });
    expect(url).toContain('/route/v1/driving/-105.000000,39.700000;-104.200000,39.000000');
    expect(url).toContain('overview=full');
    expect(url).toContain('steps=true');
  });

  it('parses steps and geometry', () => {
    const raw = parseOsrm(osrmFixture, 'Denver', 'Colorado Springs');
    expect(raw.coords).toHaveLength(5);
    expect(raw.coords[0]).toEqual({ lat: 39.7, lng: -105 });
    expect(raw.steps[1]).toMatchObject({ name: 'Main Street US 85', modifier: 'left' });
  });

  it('reports a missing route clearly', () => {
    expect(() => parseOsrm({ code: 'NoRoute' }, 'a', 'b')).toThrow(/no driving route/);
  });

  it('scales a route to a playable length and places steps in order', () => {
    const data = buildRouteData(parseOsrm(osrmFixture, 'Denver', 'Colorado Springs'));
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
