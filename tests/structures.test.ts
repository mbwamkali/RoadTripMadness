import { describe, expect, it } from 'vitest';
import { MIN_GAP, placeStructures, structureAt } from '../src/game/structures';
import { RoadNet, pointAlong, type RoadFile } from '../src/offline/roadNet';

const Q = 100_000;
const p = (lng: number, lat: number) => [Math.round(lng * Q), Math.round(lat * Q)];

describe('placing bridges and tunnels', () => {
  it('keeps the notable ones, sized to read at speed and spaced apart', () => {
    const placed = placeStructures(
      [
        { from: 5000, to: 5005, kind: 'bridge', meters: 600 },
        { from: 5100, to: 5102, kind: 'bridge', meters: 300 }, // too close to the big one
        { from: 9000, to: 9001, kind: 'bridge', meters: 80 }, // an overpass: left out
        { from: 12000, to: 12004, kind: 'tunnel', meters: 400 },
        { from: 100, to: 104, kind: 'tunnel', meters: 900 }, // right at the start: left out
      ],
      20000,
    );
    expect(placed.map((s) => s.kind)).toEqual(['bridge', 'tunnel']);
    const [bridge, tunnel] = placed;
    expect(bridge.to - bridge.from).toBeGreaterThan(60);
    expect((bridge.from + bridge.to) / 2).toBeCloseTo(5002.5);
    expect(tunnel.from - bridge.to).toBeGreaterThan(MIN_GAP);
    expect(structureAt(placed, 5002)?.kind).toBe('bridge');
    expect(structureAt(placed, 7000)).toBeNull();
  });
});

describe('bridges from the road files', () => {
  const file: RoadFile = {
    version: 2,
    kind: 'backbone',
    q: Q,
    attribution: '© OpenStreetMap contributors (ODbL)',
    classes: ['motorway', 'trunk', 'primary'],
    refs: ['', 'I 1'],
    names: [''],
    nodes: [...p(0, 0), ...p(0.1, 0)],
    // A two-way road 11.1 km long with a 1 km bridge 2 km from its west end.
    edges: [[0, 1, 0, 1, 0, 11_132, 0, 113, 2, [], [[2_000, 3_000, 1]]]],
  };

  it('reports where the bridge is, whichever way the road is driven', () => {
    const net = new RoadNet([file], { version: 2, q: Q, kinds: ['city', 'town'], towns: [] });
    const east = net.planTrip({ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.101 }, 'W', 'E');
    expect(east.structures).toHaveLength(1);
    expect(east.structures![0].from.lng).toBeCloseTo(0.018, 2);
    expect(east.structures![0].to.lng).toBeCloseTo(0.027, 2);
    const west = net.planTrip({ lat: 0, lng: 0.101 }, { lat: 0, lng: -0.001 }, 'E', 'W');
    expect(west.structures![0].from.lng).toBeCloseTo(0.027, 2);
    expect(west.structures![0].meters).toBe(1000);
  });

  it('finds a point part way along a line', () => {
    const pt = pointAlong([{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 0, lng: 2 }], 0.75);
    expect(pt.lng).toBeCloseTo(1.5);
  });
});
