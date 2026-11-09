import { describe, expect, it } from 'vitest';
import { ENDS, FILL_GAP, MIN_GAP, crossingCandidates, planCrossings, type RoadCrossing } from '../src/game/crossings';
import { RoadNet, type RoadFile } from '../src/offline/roadNet';
import { buildRouteData } from '../src/geo/route';

const Q = 100_000;
const p = (lng: number, lat: number) => [Math.round(lng * Q), Math.round(lat * Q)];

describe('roads crossing the trip, from the road files', () => {
  // An east-west highway (Main Hwy) through a junction J at 0.05; Oak Ave
  // crosses it at 0.03 with no junction (a bridge), Elm St meets it at J.
  const file: RoadFile = {
    version: 2,
    kind: 'backbone',
    q: Q,
    attribution: '© OpenStreetMap contributors (ODbL)',
    classes: ['motorway', 'trunk', 'primary'],
    refs: [''],
    names: ['', 'Main Hwy', 'Oak Ave', 'Elm St', 'Side Rd'],
    nodes: [...p(0, 0), ...p(0.05, 0), ...p(0.1, 0), ...p(0.03, 0.02), ...p(0.03, -0.02), ...p(0.05, 0.02), ...p(0.05, -0.02), ...p(0.08, 0.001), ...p(0.12, 0.002)],
    edges: [
      [0, 1, 2, 0, 1, 5_566, 0, 90, 2, []],
      [1, 2, 2, 0, 1, 5_566, 0, 90, 2, []],
      [3, 4, 2, 0, 2, 4_450, 0, 70, 2, []],
      [1, 5, 2, 0, 3, 2_225, 0, 50, 4, []],
      [1, 6, 2, 0, 3, 2_225, 0, 50, 4, []],
      // Runs alongside at a shallow angle: not a crossing.
      [7, 8, 2, 0, 4, 4_450, 0, 50, 2, []],
    ],
  };
  const net = new RoadNet([file], { version: 2, q: Q, kinds: ['city', 'town'], towns: [] });

  it('finds a bridge where a road crosses with no junction, and a light where one meets it', () => {
    const trip = net.planTrip({ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.101 }, 'W', 'E');
    const found = trip.crossings ?? [];
    expect(found.map((c) => [c.name, c.kind])).toEqual([
      ['Oak Ave', 'over'],
      ['Elm St', 'flat'],
    ]);
    expect(found[0].location.lng).toBeCloseTo(0.03, 3);
    expect(found[1].both).toBe(true);
  });

  it('places them along the game road, square to it', () => {
    const trip = net.planTrip({ lat: 0, lng: -0.001 }, { lat: 0, lng: 0.101 }, 'W', 'E');
    const route = buildRouteData(trip, 120);
    const list = route.crossings ?? [];
    const path = route.points;
    const length = Math.hypot(path[path.length - 1][0] - path[0][0], path[path.length - 1][1] - path[0][1]);
    expect(list).toHaveLength(2);
    expect(list[0].at / length).toBeCloseTo(0.3, 1);
    expect(Math.abs(list[0].angle)).toBeLessThan(0.05);
  });
});

describe('placing crossings', () => {
  const c = (at: number, extra: Partial<RoadCrossing> = {}): RoadCrossing => ({ at, kind: 'over', name: 'X', angle: 0, side: 0, big: false, ...extra });
  const plan = { length: 20_000, blocked: () => false, urban: () => 0, divided: () => true, madeUpAll: false, seed: 1 };

  it('keeps the best real crossing in each stretch', () => {
    const kept = crossingCandidates(
      [
        { ...c(1000), score: 1 },
        { ...c(1100, { name: 'Big' }), score: 5 },
        { ...c(100), score: 9 }, // too near the start
      ],
      20_000,
    );
    expect(kept.map((k) => k.name)).toEqual(['Big']);
  });

  it('spaces them out, keeps them off turn-offs, and makes flat ones on freeways into bridges', () => {
    const out = planCrossings([c(2000, { kind: 'flat', side: 1 }), c(2300), c(4000, { big: true }), c(6000)], { ...plan, blocked: (d) => Math.abs(d - 6000) < 300 });
    const real = out.filter((o) => !o.madeUp);
    expect(real.map((o) => o.at)).toEqual([2000, 4000]);
    expect(real[0].kind).toBe('over');
    for (let i = 1; i < out.length; i++) expect(out[i].at - out[i - 1].at).toBeGreaterThanOrEqual(MIN_GAP);
  });

  it('fills long empty stretches with made-up ones, but never near the ends', () => {
    const out = planCrossings([], { ...plan, divided: () => false });
    expect(out.length).toBeGreaterThan(3);
    expect(out.every((o) => o.madeUp && o.kind === 'flat' && o.at >= ENDS && o.at <= 20_000 - ENDS)).toBe(true);
    const marks = [ENDS, ...out.map((o) => o.at), 20_000 - ENDS];
    for (let i = 1; i < marks.length; i++) expect(marks[i] - marks[i - 1]).toBeLessThanOrEqual(FILL_GAP + 300);
  });
});

describe('names on crossing signs', async () => {
  const { signName } = await import('../src/game/crossings');
  it('shortens long names', () => {
    expect(signName('Hellertown Road PA 412')).toBe('Hellertown Rd PA 412');
    expect(signName('Pennsylvania Turnpike Northeast Extension I 476')).toBe('I 476');
    expect(signName('South Lincoln Street I 70 Business')).toBe('S Lincoln St');
    expect(signName('Elm St')).toBe('Elm St');
  });
});
