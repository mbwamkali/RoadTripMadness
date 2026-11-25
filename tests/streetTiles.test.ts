import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeStreetSquare, squaresAround, streetsFromSquares } from '../src/geo/streetTiles';
import { roadFileFromWays } from '../src/geo/localStreets';

// A real square from the road build (Texas, 31.25-31.5 N, 95.5-95.25 W; OpenStreetMap, ODbL).
const SQUARE = readFileSync(new URL('./street-square.bin', import.meta.url));

describe('street squares', () => {
  it('reads a square from the road build', () => {
    const ways = decodeStreetSquare(gunzipSync(SQUARE));
    expect(ways.length).toBeGreaterThan(500);
    for (const w of ways) {
      expect(w.cls).toBeGreaterThanOrEqual(1);
      expect(w.cls).toBeLessThanOrEqual(5);
      expect(w.pts.length).toBeGreaterThanOrEqual(2);
    }
    // Nearly every way has a point inside the square (the rest only cross its corner).
    const inside = ways.filter((w) => w.pts.some(([x, y]) => x / 1e5 >= -95.5 && x / 1e5 <= -95.25 && y / 1e5 >= 31.25 && y / 1e5 <= 31.5));
    expect(inside.length / ways.length).toBeGreaterThan(0.9);
    expect(ways.some((w) => w.name)).toBe(true);
    // Streets meet at shared points, so the road file has more pieces than ways.
    expect(roadFileFromWays(ways, 1e5, 'x').edges.length).toBeGreaterThan(ways.length);
  });

  it('finds the squares a box touches', () => {
    expect(squaresAround({ lat: 31.4, lng: -95.4 }, 1000, 0.25)).toEqual([[-382, 125]]);
    expect(squaresAround({ lat: 31.5, lng: -95.5 }, 1000, 0.25)).toHaveLength(4);
  });

  describe('download', () => {
    const realFetch = globalThis.fetch;
    afterEach(() => (globalThis.fetch = realFetch));
    it('keeps only streets near the place, and treats a missing square as empty', async () => {
      const asked: string[] = [];
      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        asked.push(String(url));
        return String(url).endsWith('-382_125.bin') ? new Response(SQUARE) : new Response('', { status: 404 });
      }) as typeof fetch;
      const info = { dir: 'streets', tileDeg: 0.25, version: 1, squares: 1, bytes: 1 };
      const got = await streetsFromSquares({ lat: 31.34, lng: -95.39 }, info, (p) => `https://x/${p}`, { minorM: 2000, middleM: 4000, majorM: 3000 });
      expect(asked).toEqual(['https://x/streets/-382_125.bin']);
      expect(got!.ways.length).toBeGreaterThan(10);
      expect(got!.ways.length).toBeLessThan(decodeStreetSquare(gunzipSync(SQUARE)).length);
      expect(got!.bytes).toBe(SQUARE.length);
    });
  });
});
