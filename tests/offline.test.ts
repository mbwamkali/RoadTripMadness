import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { packLatLng, simplifyLatLng, unpackLatLng } from '../src/offline/polyline';
import { MAX_TRIPS, TripCache, type KeyValueStore } from '../src/offline/tripCache';
import { CURATED_ROUTES, unpackRoute, type PackedRoute } from '../src/offline/curated';
import { buildRouteData, pathFromRoute, type RawRoute } from '../src/geo/route';
import { demoRawRoute } from '../src/geo/demoRoute';
import { generateStops } from '../src/game/stops';

class MemStore implements KeyValueStore {
  map = new Map<string, string>();
  limit = Infinity;
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    const size = [...this.map].reduce((n, [kk, vv]) => n + (kk === k ? 0 : vv.length), 0) + v.length;
    if (size > this.limit) throw new Error('QuotaExceededError');
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const trip = (label: string, offset = 0): RawRoute => {
  const r = demoRawRoute(3);
  return { ...r, startLabel: `${label} start`, endLabel: `${label} end`, coords: r.coords.map((c) => ({ lat: c.lat + offset, lng: c.lng })) };
};

describe('polyline packing', () => {
  it('round-trips to about a metre', () => {
    const pts = [{ lat: 40.71281, lng: -74.00601 }, { lat: 34.05223, lng: -118.24368 }];
    const back = unpackLatLng(packLatLng(pts));
    expect(back[1].lat).toBeCloseTo(34.05223, 5);
    expect(back[1].lng).toBeCloseTo(-118.24368, 5);
  });

  it('drops points on straight stretches but keeps the bends', () => {
    const line = Array.from({ length: 101 }, (_, i) => ({ lat: 40 + (i <= 50 ? i : 50) * 0.001, lng: -100 + (i > 50 ? (i - 50) * 0.001 : 0) }));
    const s = simplifyLatLng(line, 5);
    expect(s.length).toBe(3);
    expect(s[1]).toEqual(line[50]);
  });
});

describe('saved trips', () => {
  it('saves, lists and reloads a trip that plays the same', () => {
    const cache = new TripCache(new MemStore());
    const raw = trip('A');
    const id = cache.save(raw)!;
    expect(cache.list().map((t) => t.id)).toEqual([id]);
    const back = cache.load(id)!;
    expect(back.startLabel).toBe('A start');
    expect(back.steps).toEqual(raw.steps);
    expect(back.coords.length).toBeLessThanOrEqual(raw.coords.length);
    const a = buildRouteData(raw);
    const b = buildRouteData(back);
    expect(pathFromRoute(b).length).toBeCloseTo(pathFromRoute(a).length, -1);
    expect(generateStops(b, pathFromRoute(b).length, 9).length).toBe(generateStops(a, pathFromRoute(a).length, 9).length);
  });

  it('keeps extra route fields such as landmark features', () => {
    const cache = new TripCache(new MemStore());
    const line = Array.from({ length: 50 }, (_, i) => ({ lat: 35 + i * 0.001, lng: -115 }));
    const raw: RawRoute = { ...trip('F'), features: [{ name: 'Big River', kind: 'river', line }, { name: 'Tall Peak', kind: 'peak', point: { lat: 35.123456789, lng: -115.5 } }] };
    const back = cache.load(cache.save(raw)!)!;
    expect(back.features!.map((f) => f.name)).toEqual(['Big River', 'Tall Peak']);
    expect(back.features![0].line).toEqual([line[0], line[49]]);
    expect(back.features![1].point).toEqual({ lat: 35.12346, lng: -115.5 });
  });

  it('finds a trip by the places the player picked', () => {
    const cache = new TripCache(new MemStore());
    const raw = trip('P');
    const start = { lat: 1, lng: 2 };
    const end = { lat: 3, lng: 4 };
    cache.save(raw, { start, end });
    expect(cache.find(start, end, 'P start', 'P end')?.endLabel).toBe('P end');
    expect(cache.find(start, end, 'P start', 'elsewhere')).toBeNull();
  });

  it('replaces a re-planned trip instead of duplicating it', () => {
    const cache = new TripCache(new MemStore());
    cache.save(trip('A'), undefined, 1);
    cache.save(trip('A'), undefined, 2);
    expect(cache.list().length).toBe(1);
  });

  it('keeps at most MAX_TRIPS, dropping the least recently played', () => {
    const store = new MemStore();
    const cache = new TripCache(store);
    for (let i = 0; i < MAX_TRIPS + 3; i++) cache.save(trip(`T${i}`, i * 0.01), undefined, i);
    const list = cache.list();
    expect(list.length).toBe(MAX_TRIPS);
    expect(list.some((t) => t.startLabel === 'T0 start')).toBe(false);
    expect([...store.map.keys()].filter((k) => k.startsWith('rtm-trip-v1:')).length).toBe(MAX_TRIPS);
  });

  it('drops old trips when storage is full instead of failing', () => {
    const store = new MemStore();
    const cache = new TripCache(store);
    cache.save(trip('first'), undefined, 1);
    store.limit = [...store.map.values()].reduce((n, v) => n + v.length, 0) * 1.6; // room for about one and a half trips
    cache.save(trip('second', 0.01), undefined, 2);
    cache.save(trip('third', 0.02), undefined, 3);
    const names = cache.list().map((t) => t.startLabel);
    expect(names[0]).toBe('third start');
    expect(names).not.toContain('first start');
  });

  it('works without storage', () => {
    const cache = new TripCache(null);
    expect(cache.save(trip('X'))).toBeNull();
    expect(cache.list()).toEqual([]);
  });

  it('removes trips', () => {
    const cache = new TripCache(new MemStore());
    const id = cache.save(trip('R'))!;
    cache.remove(id);
    expect(cache.list()).toEqual([]);
    expect(cache.load(id)).toBeNull();
  });
});

describe('classic routes', () => {
  for (const r of CURATED_ROUTES) {
    it(`${r.title} is bundled and playable`, () => {
      const raw = unpackRoute(JSON.parse(fs.readFileSync(`public/data/routes/${r.id}.json`, 'utf8')) as PackedRoute);
      expect(raw.source).toBe('curated');
      expect(Math.abs(raw.realMeters / 1000 - r.km)).toBeLessThan(5);
      const route = buildRouteData(raw);
      const stops = generateStops(route, pathFromRoute(route).length, 4);
      expect(stops.length).toBeGreaterThanOrEqual(6);
      expect(stops.some((s) => raw.steps.some((st) => st.name === s.name))).toBe(true);
    });
  }
});
