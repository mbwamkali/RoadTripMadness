import { describe, expect, it } from 'vitest';
import { buildRouteData, postedLimit, realExitNear } from '../src/geo/route';
import { RoadNet, tilesFor, type RoadFile, type RoadIndex } from '../src/offline/roadNet';

const Q = 100_000;
const p = (lng: number, lat: number) => [Math.round(lng * Q), Math.round(lat * Q)];

/**
 * A tiny network split over two files, like the real backbone and a tile:
 * an eastbound and a westbound one-way motorway (I 1) along the equator,
 * with exit 5 halfway, and a two-way Main Street north from the east end.
 */
const backbone: RoadFile = {
  version: 2,
  kind: 'backbone',
  q: Q,
  attribution: '© OpenStreetMap contributors (ODbL)',
  classes: ['motorway', 'trunk', 'primary'],
  refs: ['', 'I 1'],
  names: [''],
  // 0 A, 1 B, 2 C (eastbound); 3 C', 4 A' (westbound, 110 m north)
  nodes: [...p(0, 0), ...p(0.1, 0), ...p(0.2, 0), ...p(0.2, 0.001), ...p(0, 0.001)],
  edges: [
    [0, 1, 0, 1, 0, 11_132, 1, 113, 2, []],
    [1, 2, 0, 1, 0, 11_132, 1, 113, 2, []],
    [3, 4, 0, 1, 0, 22_264, 1, 113, 2, [-10_000, 0]],
  ],
  exits: [[1, '5', 'Smallville']],
};

const tile: RoadFile = {
  version: 2,
  kind: 'tile',
  q: Q,
  attribution: '© OpenStreetMap contributors (ODbL)',
  classes: ['motorway', 'trunk', 'primary'],
  refs: [''],
  names: ['Main Street'],
  // 0 is the same place as the backbone's C, so the files join there.
  nodes: [...p(0.2, 0), ...p(0.2, 0.1)],
  edges: [[0, 1, 2, 0, 0, 11_132, 0, 0, 0, []]],
};

const net = () => new RoadNet([backbone, tile], { version: 2, q: Q, kinds: ['city', 'town'], towns: [] });

describe('RoadNet', () => {
  it('joins files at shared nodes', () => {
    const n = net();
    expect(n.nodeCount).toBe(6); // 5 backbone nodes + 1 new tile node
    expect(n.edgeCount).toBe(4);
  });

  it('routes along the motorway and onto a tile road, with exits, limits and turn-offs', () => {
    const raw = net().planTrip({ lat: -0.001, lng: 0 }, { lat: 0.101, lng: 0.2 }, 'West', 'North');
    expect(raw.source).toBe('osm');
    expect(raw.realMeters).toBeGreaterThan(33_000);
    expect(raw.realMeters).toBeLessThan(34_000);
    expect(raw.steps.filter((s) => s.type === 'turn').map((s) => s.name)).toEqual(['I 1', 'Main Street']);
    expect(raw.steps[0].motorway).toBe(true);
    expect(raw.exits).toEqual([{ location: { lat: 0, lng: 0.1 }, ref: '5', name: 'Smallville' }]);
    expect(raw.limits?.map((l) => l.kmh)).toEqual([113, 0]);
    expect(raw.attribution).toContain('OpenStreetMap');
  });

  it('never drives a one-way road backwards', () => {
    const raw = net().planTrip({ lat: 0.101, lng: 0.2 }, { lat: 0.002, lng: 0 }, 'North', 'West');
    // Westbound has to use the other carriageway (110 m north), not the eastbound one.
    expect(raw.coords.some((c) => Math.abs(c.lat - 0.001) < 1e-9 && Math.abs(c.lng - 0.1) < 1e-9)).toBe(true);
    expect(raw.coords.some((c) => c.lat === 0 && c.lng === 0.1)).toBe(false);
  });

  it('puts real exits and posted limits on the game route', () => {
    const raw = net().planTrip({ lat: -0.001, lng: 0 }, { lat: 0.101, lng: 0.2 }, 'West', 'North');
    const route = buildRouteData(raw);
    expect(route.exits).toHaveLength(1);
    const exit = route.exits![0];
    expect(realExitNear(route, exit.at)?.ref).toBe('5');
    expect(postedLimit(route, exit.at)).toBe(70);
    expect(postedLimit(route, route.limits![1].at + 1)).toBe(0);
  });

  it('joins a long road part way along when no junction is near', () => {
    // Halfway between A and B, 110 m south of the eastbound carriageway: the nearest junction is 5.5 km away.
    const raw = net().planTrip({ lat: -0.001, lng: 0.05 }, { lat: 0.101, lng: 0.2 }, 'Midway', 'North');
    expect(raw.coords[1].lng).toBeCloseTo(0.05, 3);
    expect(raw.coords[1].lat).toBeCloseTo(0, 5);
    expect(raw.realMeters).toBeGreaterThan(27_500);
    expect(raw.realMeters).toBeLessThan(28_500);
    expect(raw.steps.filter((s) => s.type === 'turn').map((s) => s.name)).toEqual(['I 1', 'Main Street']);
    // And the same for an end: stop part way along the westbound side, never driving the eastbound one backwards.
    const back = net().planTrip({ lat: 0.101, lng: 0.2 }, { lat: 0.002, lng: 0.05 }, 'North', 'Midway');
    const last = back.coords[back.coords.length - 2];
    expect(last.lat).toBeCloseTo(0.001, 5);
    expect(last.lng).toBeCloseTo(0.05, 3);
  });

  it('extends a built network with more files and routes the same as building it all at once', () => {
    const base = new RoadNet([backbone]);
    const ext = new RoadNet([tile], null, base);
    expect(ext.nodeCount).toBe(net().nodeCount);
    expect(ext.edgeCount).toBe(net().edgeCount);
    expect(base.edgeCount).toBe(3); // unchanged
    const a = ext.planTrip({ lat: -0.001, lng: 0 }, { lat: 0.101, lng: 0.2 }, 'West', 'North');
    const b = net().planTrip({ lat: -0.001, lng: 0 }, { lat: 0.101, lng: 0.2 }, 'West', 'North');
    expect(a.coords).toEqual(b.coords);
    expect(a.exits).toEqual(b.exits);
    expect(ext.hasNode(...(p(0.2, 0.1) as [number, number]))).toBe(true);
    expect(base.hasNode(...(p(0.2, 0.1) as [number, number]))).toBe(false);
  });

  it('fails clearly when a place is far from every road', () => {
    expect(() => net().planTrip({ lat: 10, lng: 10 }, { lat: 0, lng: 0 }, 'Nowhere', 'West')).toThrow(/too far/);
  });
});

describe('tilesFor', () => {
  it('picks the listed tiles around each point', () => {
    const index = { tileDeg: 2, tiles: [[0, 0, 1], [1, 0, 1], [-1, -1, 1], [5, 5, 1]] } as unknown as RoadIndex;
    const got = tilesFor(index, [{ lat: 1, lng: 1 }]).map(([x, y]) => `${x}_${y}`).sort();
    expect(got).toEqual(['-1_-1', '0_0', '1_0']);
  });
});
