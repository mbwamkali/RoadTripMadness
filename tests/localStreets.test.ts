import { describe, expect, it } from 'vitest';
import { boxAround, buildLocalStreetsQuery, localStreetsFile, parseSpeed, pyRound } from '../src/geo/localStreets';
import { RoadNet, type RoadFile } from '../src/offline/roadNet';
import { streetsSummary } from '../src/offline/planner';
import type { StreetStatus } from '../src/geo/localStreets';

const Q = 100_000;
const p = (lng: number, lat: number) => [Math.round(lng * Q), Math.round(lat * Q)];

/** A highway file: Main Street north from (0.2, 0) to (0.2, 0.1), and I 1 east to it. */
const highways: RoadFile = {
  version: 2,
  kind: 'tile',
  q: Q,
  attribution: '© OpenStreetMap contributors (ODbL)',
  classes: ['motorway', 'trunk', 'primary'],
  refs: ['', 'I 1'],
  names: ['Main Street', ''],
  nodes: [...p(0, 0), ...p(0.2, 0), ...p(0.2, 0.1)],
  edges: [
    [0, 1, 0, 1, 1, 22_264, 0, 113, 2, []],
    [1, 2, 2, 0, 0, 11_132, 0, 0, 0, []],
  ],
};

/** What Overpass answers: ways with tags, then their nodes. */
const answer = {
  elements: [
    // Elm Street: from Main Street's north end east to a house, with a bend.
    { type: 'way', id: 1, nodes: [10, 11, 12, 13], tags: { highway: 'residential', name: 'Elm Street', maxspeed: '25 mph' } },
    // Oak Lane: one way, drawn backwards (oneway=-1), from Elm Street's bend south.
    { type: 'way', id: 2, nodes: [14, 11], tags: { highway: 'residential', name: 'Oak Lane', oneway: '-1' } },
    // A loop of private-looking streets that never reaches a highway.
    { type: 'way', id: 3, nodes: [20, 21, 22], tags: { highway: 'residential', name: 'Island Court' } },
    // Not a road for cars.
    { type: 'way', id: 4, nodes: [10, 13], tags: { highway: 'footway' } },
    { type: 'node', id: 10, lat: 0.1, lon: 0.2 },
    { type: 'node', id: 11, lat: 0.1, lon: 0.21 },
    { type: 'node', id: 12, lat: 0.1005, lon: 0.22 },
    { type: 'node', id: 13, lat: 0.1, lon: 0.23 },
    { type: 'node', id: 14, lat: 0.09, lon: 0.21 },
    { type: 'node', id: 20, lat: 0.5, lon: 0.5 },
    { type: 'node', id: 21, lat: 0.5, lon: 0.51 },
    { type: 'node', id: 22, lat: 0.51, lon: 0.51 },
  ],
} as never;

describe('local streets', () => {
  it('asks for side streets close by and bigger roads further out, with points inline', () => {
    const q = buildLocalStreetsQuery({ lat: 41.8, lng: -71.4 });
    // Boxes, not circles (around: timed out on the server every time).
    expect(q).not.toContain('around');
    expect(q).toContain(`(${boxAround({ lat: 41.8, lng: -71.4 }, 2000)})`);
    expect(q).toContain(`(${boxAround({ lat: 41.8, lng: -71.4 }, 4000)})`);
    expect(q).toContain(`(${boxAround({ lat: 41.8, lng: -71.4 }, 3000)})`);
    expect(q).not.toMatch(/motorway/);
    expect(q).toContain('out geom qt');
  });

  it('reads ways with inline points the same as ways with separate nodes', () => {
    const els = (answer as { elements: { type: string; id: number; nodes?: number[]; lat?: number; lon?: number }[] }).elements;
    const at = new Map(els.filter((e) => e.type === 'node').map((e) => [e.id, { lat: e.lat!, lon: e.lon! }]));
    const inline = { elements: els.filter((e) => e.type === 'way').map((e) => ({ ...e, nodes: undefined, geometry: e.nodes!.map((n) => at.get(n)!) })) } as never;
    expect(localStreetsFile(inline, Q, 'x', [highways])).toEqual(localStreetsFile(answer, Q, 'x', [highways]));
  });

  it('joins streets onto a built network without rebuilding it', () => {
    const highwaysNet = new RoadNet([highways]);
    const all = localStreetsFile(answer, Q, 'x');
    const net = highwaysNet.withStreets([all]);
    expect(net.edgeCount).toBe(highwaysNet.edgeCount + 3); // Island Court left out
    expect(highwaysNet.withStreets([]).edgeCount).toBe(highwaysNet.edgeCount);
    const home = { lat: 0.1001, lng: 0.2301 };
    const a = net.planTrip(home, { lat: 0, lng: -0.001 }, 'Home', 'West');
    const b = new RoadNet([highways, localStreetsFile(answer, Q, 'x', [highways])]).planTrip(home, { lat: 0, lng: -0.001 }, 'Home', 'West');
    expect(a.coords).toEqual(b.coords);
    expect(a.realSeconds).toBeCloseTo(b.realSeconds, 6);
  });

  it('rounds like the build script so shared junctions line up', () => {
    expect(pyRound(2.5)).toBe(2);
    expect(pyRound(3.5)).toBe(4);
    expect(pyRound(-2.5)).toBe(-2);
    expect(pyRound(-3.5)).toBe(-4);
    expect(pyRound(1.2)).toBe(1);
    expect(parseSpeed('25 mph')).toBe(40);
    expect(parseSpeed('50')).toBe(50);
    expect(parseSpeed('walk')).toBe(0);
  });

  it('splits streets where they meet and drops streets that never reach a highway', () => {
    const f = localStreetsFile(answer, Q, 'x', [highways]);
    expect(f.kind).toBe('local');
    expect(f.edges.map((e) => f.names[e[4]])).not.toContain('Island Court');
    // Elm Street splits at Oak Lane: 2 pieces, plus Oak Lane.
    expect(f.edges).toHaveLength(3);
    const oak = f.edges.find((e) => f.names[e[4]] === 'Oak Lane')!;
    expect(oak[6] & 1).toBe(1);
    // Drawn backwards, so it runs from Elm Street (node 11) south to node 14.
    expect(f.nodes.slice(oak[0] * 2, oak[0] * 2 + 2)).toEqual(p(0.21, 0.1));
    const elm = f.edges.filter((e) => f.names[e[4]] === 'Elm Street');
    expect(elm.every((e) => e[7] === 40)).toBe(true);
    // The bend survives as a shape point.
    expect(elm.some((e) => e[9].length === 2)).toBe(true);
  });

  it('keeps everything when there is no highway map to join to', () => {
    expect(localStreetsFile(answer, Q, 'x').names).toContain('Island Court');
  });

  it('lets a trip start on the right street', () => {
    const local = localStreetsFile(answer, Q, 'x', [highways]);
    const home = { lat: 0.1001, lng: 0.2301 };
    const withStreets = new RoadNet([highways, local]).planTrip(home, { lat: 0, lng: -0.001 }, 'Home', 'West');
    const turns = withStreets.steps.filter((s) => s.type === 'turn').map((s) => s.name);
    expect(turns[0]).toBe('Elm Street');
    // Without the streets the trip starts with a straight link to Main Street.
    const without = new RoadNet([highways]).planTrip(home, { lat: 0, lng: -0.001 }, 'Home', 'West');
    expect(without.steps.find((s) => s.type === 'turn')?.name).toBe('Main Street');
  });

  it('never drives a one-way street the wrong way', () => {
    const local = localStreetsFile(answer, Q, 'x', [highways]);
    const net = new RoadNet([highways, local]);
    // From the south end of Oak Lane you can't drive up it; the trip links straight to a street instead.
    const raw = net.planTrip({ lat: 0.0899, lng: 0.21 }, { lat: 0.1001, lng: 0.2301 }, 'A', 'B');
    expect(raw.steps.some((s) => s.name === 'Oak Lane')).toBe(false);
  });
});

describe('street box', () => {
  it('reaches the same distance north-south and east-west', () => {
    const [s, w, n, e] = boxAround({ lat: 40, lng: -100 }, 2000).split(',').map(Number);
    expect((n - s) * 111_320).toBeCloseTo(4000, -1);
    expect((e - w) * 111_320 * Math.cos((40 * Math.PI) / 180)).toBeCloseTo(4000, -1);
  });
});

describe('street step summary', () => {
  const st = (o: Partial<StreetStatus>): StreetStatus => ({ state: 'done', bytes: 0, started: 1000, ended: 10_000, server: '', tries: [], pieces: 0, plannerNote: '', ...o });
  it('says how many pieces, from which server, how long', () => {
    expect(streetsSummary([st({ pieces: 1000, server: 'overpass-api.de' }), st({ pieces: 240, server: 'overpass-api.de' })], 'done')).toBe(
      '1,240 street pieces · overpass-api.de · 9 s',
    );
    expect(streetsSummary([st({ state: 'cached' }), st({ state: 'cached' })], 'done')).toBe('saved on the phone from last time');
  });
  it('names the slow servers when planning moves on', () => {
    const s = streetsSummary([st({ state: 'waiting', ended: 0, tries: ['overpass-api.de too slow 12.0s'] })], 'late', 20_000);
    expect(s).toContain('took over 20 s');
    expect(s).toContain('overpass-api.de too slow 12.0s');
  });
});
