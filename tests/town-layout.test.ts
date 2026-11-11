import { describe, expect, it } from 'vitest';
import type { OsmElement } from '../src/geo/overpass';
import { FIRST_LOT, LOT_GAP, layoutTown, parseTownOsm, placeKindOf, townQuery } from '../src/town/layout';

// A small made-up OSM answer around (35.0, -100.0): Main St running north-east with a bend,
// a cross street, a gas station and a motel beside Main St, and a far-away pharmacy.
const o = { lat: 35, lng: -100 };
const dLat = (m: number) => m / 110_540;
const dLng = (m: number) => m / (111_320 * Math.cos((35 * Math.PI) / 180));
const pt = (x: number, y: number) => ({ lat: o.lat + dLat(y), lon: o.lng + dLng(x) });
const osm: { elements: OsmElement[] } = {
  elements: [
    { type: 'way' as const, tags: { highway: 'residential', name: 'Main Street' }, geometry: [pt(-5, -10), pt(10, 40), pt(40, 120), pt(60, 200), pt(70, 300)] },
    { type: 'way' as const, tags: { highway: 'residential', name: 'Elm Street' }, geometry: [pt(-60, 140), pt(40, 120), pt(150, 100)] },
    { type: 'node' as const, ...pt(30, 60), tags: { amenity: 'fuel', name: "Love's" } },
    { type: 'way' as const, center: pt(20, 170), tags: { tourism: 'motel', name: 'Sunset Motel' } },
    { type: 'node' as const, ...pt(600, 600), tags: { amenity: 'pharmacy', name: 'Far Drugs' } },
  ],
};

describe('town layout', () => {
  it('maps OpenStreetMap tags to our places', () => {
    expect(placeKindOf({ amenity: 'fuel' })).toBe('pumps');
    expect(placeKindOf({ tourism: 'motel' })).toBe('motel');
    expect(placeKindOf({ shop: 'car_repair' })).toBe('garage');
    expect(placeKindOf({ shop: 'supermarket' })).toBe('grocery');
    expect(placeKindOf({ highway: 'residential' })).toBeNull();
    expect(townQuery({ lat: 35, lng: -100 })).toContain('around:700,35.00000,-100.00000');
  });

  it('uses the real street and the real businesses', () => {
    const map = parseTownOsm(osm, o);
    expect(map.streets).toHaveLength(2);
    expect(map.pois.map((p) => p.kind).sort()).toEqual(['motel', 'pharmacy', 'pumps']);
    const t = layoutTown({ name: 'Testville', places: ['pumps', 'motel', 'grocery', 'pharmacy'], seed: 1, street: 'Main Street', map });
    expect(t.real).toBe(true);
    expect(t.street).toBe('Main Street');
    const gas = t.lots.find((l) => l.place === 'pumps')!;
    const motel = t.lots.find((l) => l.place === 'motel')!;
    expect(gas.name).toBe("Love's");
    expect(motel.name).toBe('Sunset Motel');
    // The gas station is nearer the highway than the motel, as on the real map.
    expect(gas.along).toBeLessThan(motel.along);
    // Far-away businesses don't count, so the pharmacy is made up (no name).
    expect(t.lots.find((l) => l.place === 'pharmacy')!.name).toBeUndefined();
    expect(t.crossings.map((c) => c.name)).toContain('Elm Street');
    // Main Street starts at the highway and heads off along +y.
    expect(t.line[0]).toEqual({ x: 0, y: 0 });
    expect(t.line[t.line.length - 1].y).toBeGreaterThan(100);
  });

  it('keeps lots apart, on the street and clear of cross streets, real map or not', () => {
    for (const map of [parseTownOsm(osm, o), null]) {
      for (let seed = 0; seed < 40; seed++) {
        const places = (['pumps', 'garage', 'grocery', 'police', 'motel', 'pharmacy'] as const).slice(0, 1 + (seed % 6));
        const t = layoutTown({ name: 'X', places: [...places], seed, map });
        expect(t.lots).toHaveLength(places.length);
        // Cross streets never run through a lot.
        for (const c of t.crossings) for (const l of t.lots) expect(Math.abs(c.along - l.along)).toBeGreaterThanOrEqual(20);
        for (const l of t.lots) {
          expect(l.along).toBeGreaterThanOrEqual(FIRST_LOT);
          expect(l.along).toBeLessThanOrEqual(t.length);
          for (const m of t.lots) if (m !== l && m.side === l.side) expect(Math.abs(m.along - l.along)).toBeGreaterThanOrEqual(LOT_GAP);
        }
        for (const hs of t.houses) for (const l of t.lots) if (l.side === hs.side) expect(Math.abs(l.along - hs.along)).toBeGreaterThanOrEqual(26);
      }
    }
  });

  it('makes up the same town every time when offline', () => {
    const a = layoutTown({ name: 'X', places: ['pumps', 'grocery'], seed: 42 });
    const b = layoutTown({ name: 'X', places: ['pumps', 'grocery'], seed: 42 });
    expect(a).toEqual(b);
    expect(a.real).toBe(false);
    expect(a.lots[0].place).toBe('pumps');
  });
});
