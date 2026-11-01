import { describe, expect, it } from 'vitest';
import { featureTilesAlong, featuresNear, type FeatureFile } from '../src/offline/features';

const Q = 100_000;
const KINDS = ['citysign', 'peak', 'monument', 'tower', 'lighthouse', 'watertower', 'windmill', 'castle', 'viewpoint', 'attraction', 'fuel', 'river'];
const q = (v: number) => Math.round(v * Q);

/** A route east along latitude 40, from -100 to -99.9. */
const route = [
  { lat: 40, lng: -100 },
  { lat: 40, lng: -99.9 },
];

const file: FeatureFile = {
  version: 1,
  q: Q,
  kinds: KINDS,
  points: [
    [1, 'Near Peak', q(-99.95), q(40.05), 0, 'en:Near Peak'], // 5.5 km: peaks reach 8 km
    [9, 'Far Thing', q(-99.95), q(40.05), 0, ''], // sights only reach 2 km
    [10, "Love's", q(-99.97), q(40.002), 1, ''], // 220 m off the road
    [10, 'Back Road Gas', q(-99.97), q(40.01), 0, ''], // 1.1 km: too far for a stop
    [0, 'Bigton', q(-99.92), q(40.02), 2, 'Q42'], // town 2.2 km away: towns reach 3 km
    [0, 'Hamlet', q(-99.93), q(40.02), 4, ''], // village 2.2 km away: villages reach 1.2 km
  ],
  lines: [[11, 'Test River', '', [q(-99.95), q(39.997), 0, 600]]],
};

describe('baked landmark files', () => {
  it('keeps what is near the route, each kind at its own distance', () => {
    const got = featuresNear([file], route);
    expect(got.map((f) => f.name).sort()).toEqual(['Bigton', "Love's", 'Near Peak', 'Test River']);
    expect(got.find((f) => f.name === "Love's")).toMatchObject({ kind: 'fuel', truck: true });
    expect(got.find((f) => f.name === 'Bigton')).toMatchObject({ kind: 'citysign', big: true, wiki: 'https://www.wikidata.org/wiki/Q42' });
    expect(got.find((f) => f.name === 'Near Peak')?.wiki).toBe('https://en.wikipedia.org/wiki/Near_Peak');
    const river = got.find((f) => f.kind === 'river')!;
    expect(river.line).toHaveLength(2);
    expect(river.line![1].lat).toBeCloseTo(40.003, 5);
  });

  it('loads the squares a route passes through and those it runs close to', () => {
    const index = { tileDeg: 2, features: [[-50, 20, 1], [-50, 19, 1], [-49, 20, 1], [-51, 20, 1], [-40, 20, 1]] as [number, number, number][] };
    // Along lat 40.05, a few km north of the square below: that one is near enough to load.
    const got = featureTilesAlong(index, [{ lat: 40.05, lng: -99.5 }, { lat: 40.05, lng: -97.5 }]).map(([x, y]) => `${x}_${y}`).sort();
    expect(got).toEqual(['-49_20', '-50_19', '-50_20']);
  });
});
