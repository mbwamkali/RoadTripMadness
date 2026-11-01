import { describe, expect, it } from 'vitest';
import { buildStreetsQuery, pickStreets } from '../src/geo/streets';
import type { OsmElement } from '../src/geo/overpass';

describe('cross streets', () => {
  it('asks for named streets around each turn-off', () => {
    const q = buildStreetsQuery([{ lat: 34.9, lng: -117.02 }]);
    expect(q).toContain('way(around:600,34.90000,-117.02000)');
    expect(q).toContain('out tags center');
  });

  it('picks the nearest street that is not the road being driven', () => {
    const els: OsmElement[] = [
      { type: 'way' as const, center: { lat: 34.9001, lon: -117.02 }, tags: { name: 'Mojave Freeway', ref: 'I 15', highway: 'trunk' } },
      { type: 'way' as const, center: { lat: 34.9015, lon: -117.02 }, tags: { name: 'Main Street', highway: 'primary' } },
      { type: 'way' as const, center: { lat: 34.903, lon: -117.02 }, tags: { name: 'Elm Avenue', highway: 'residential' } },
    ];
    expect(pickStreets(els, [{ lat: 34.9, lng: -117.02 }], ['Mojave Freeway I 15'])).toEqual(['Main Street']);
    expect(pickStreets(els, [{ lat: 34.9, lng: -117.02 }], ['I 15'])).toEqual(['Main Street']);
    expect(pickStreets(els, [{ lat: 10, lng: 10 }], [''])).toEqual([null]);
  });
});
