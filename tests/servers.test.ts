import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SERVERS, parseServers, setServers } from '../src/geo/servers';
import { overpassQuery, overpassWaiting } from '../src/geo/overpass';
import { cachedSearch, rememberSearch, searchPlaces } from '../src/geo/geocode';

describe('server list', () => {
  it('keeps valid https addresses and falls back to the defaults', () => {
    expect(parseServers({ overpass: ['https://a.example/api', 'http://insecure', 5], nominatim: 'https://n.example/search' })).toEqual({
      overpass: ['https://a.example/api'],
      nominatim: 'https://n.example/search',
    });
    expect(parseServers(null)).toEqual(DEFAULT_SERVERS);
    expect(parseServers({ overpass: [] }).overpass).toEqual(DEFAULT_SERVERS.overpass);
  });
});

describe('Overpass line', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    setServers(DEFAULT_SERVERS);
  });

  it('moves to the backup server when the main one is busy', async () => {
    setServers({ overpass: ['https://main.example/api', 'https://backup.example/api'], nominatim: DEFAULT_SERVERS.nominatim });
    const asked: string[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      asked.push(String(url));
      return String(url).includes('main') ? new Response('busy', { status: 429 }) : new Response('{"elements":[{"type":"node"}]}');
    }) as typeof fetch;
    const json = await overpassQuery('q', { timeoutMs: 1000 });
    expect(json?.elements).toHaveLength(1);
    expect(asked).toEqual(['https://main.example/api', 'https://backup.example/api']);
  });

  it('runs two at a time and lets street lookups go first', async () => {
    setServers({ overpass: ['https://main.example/api'], nominatim: DEFAULT_SERVERS.nominatim });
    const started: string[] = [];
    const release: (() => void)[] = [];
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      started.push(String((init?.body as URLSearchParams).get('data')));
      await new Promise<void>((r) => release.push(r));
      return new Response('{"elements":[]}');
    }) as typeof fetch;
    const all = [
      overpassQuery('town 1', { timeoutMs: 5000 }),
      overpassQuery('town 2', { timeoutMs: 5000 }),
      overpassQuery('cross streets', { timeoutMs: 5000 }),
      overpassQuery('streets', { timeoutMs: 5000, priority: 'streets' }),
    ];
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual(['town 1', 'town 2']);
    expect(overpassWaiting()).toBe(2);
    release.shift()!();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(started[2]).toBe('streets');
    while (release.length || started.length < 4) {
      release.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    }
    await Promise.all(all);
    expect(started).toEqual(['town 1', 'town 2', 'streets', 'cross streets']);
  });
});

describe('search cache', () => {
  const store = new Map<string, string>();
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = realFetch;
  });

  it('remembers a search for 30 days, ignoring case and spacing', () => {
    const places = [{ lat: 39.74, lng: -104.99, label: 'Denver' }];
    rememberSearch('Denver  CO', places, 1_000);
    expect(cachedSearch('denver co', 1_000 + 29 * 86_400_000)).toEqual(places);
    expect(cachedSearch('denver co', 1_000 + 31 * 86_400_000)).toBeNull();
  });

  it('answers a repeat search without asking Nominatim', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return new Response(JSON.stringify([{ lat: '39.74', lon: '-104.99', display_name: 'Denver, Colorado, United States' }]));
    }) as typeof fetch;
    const first = await searchPlaces('Denver');
    const again = await searchPlaces('denver');
    expect(again).toEqual(first);
    expect(calls).toBe(1);
  });
});
