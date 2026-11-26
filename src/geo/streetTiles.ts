import type { LatLng } from './geo';
import type { Way } from './localStreets';
import type { PlaceKind } from '../game/stops';

/**
 * Street squares made by the monthly road build (scripts/build-osm-streets.py):
 * every street in the lower 48, cut into TILE_DEG squares, packed and gzipped.
 * The game reads the squares around each end of a trip instead of asking a
 * public Overpass server, which was too slow or refused (2026-11-25).
 * In dense city blocks the build keeps only the bigger roads.
 */

export interface StreetsInfo {
  dir: string;
  tileDeg: number;
  version: number;
  squares: number;
  bytes: number;
}

/** A place a town stop can have, from a version 2 square. */
export interface SquarePlace {
  kind: PlaceKind;
  name: string;
  /** In 1/q degrees. */
  x: number;
  y: number;
}

/** Place kinds in the build's order (scripts/build-osm-streets.py PLACE_KINDS). */
const PLACE_KINDS: PlaceKind[] = ['pumps', 'garage', 'grocery', 'hardware', 'gunshop', 'pharmacy', 'police', 'junkyard', 'barn', 'motel'];

/** Reads one square's streets (already unzipped). Throws on a file it doesn't understand. */
export function decodeStreetSquare(buf: Uint8Array): Way[] {
  return decodeSquare(buf).ways;
}

/** Reads one square: its streets, and its town places when the square has them (version 2). */
export function decodeSquare(buf: Uint8Array): { ways: Way[]; places: SquarePlace[] } {
  let at = 0;
  const u = () => {
    let n = 0;
    let shift = 0;
    for (;;) {
      if (at >= buf.length) throw new Error('street square cut short');
      const b = buf[at++];
      n += (b & 0x7f) * 2 ** shift;
      if (b < 0x80) return n;
      shift += 7;
    }
  };
  const z = () => {
    const n = u();
    return n % 2 ? -(n + 1) / 2 : n / 2;
  };
  if (String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== 'RTS1') throw new Error('not a street square');
  at = 4;
  const tx = u() - 1000;
  const ty = u() - 1000;
  const q = u() * 1000;
  const strings: string[] = [];
  const dec = new TextDecoder();
  for (let i = u(); i > 0; i--) {
    const len = u();
    strings.push(dec.decode(buf.subarray(at, at + len)));
    at += len;
  }
  const n = u();
  const col = () => Array.from({ length: n }, u);
  const kind = col();
  const name = col();
  const ref = col();
  const speed = col();
  const lanes = col();
  const count = col();
  const span = Math.round(squareDeg * q);
  let px = tx * span;
  let py = ty * span;
  const ways: Way[] = [];
  for (let i = 0; i < n; i++) {
    let x = px + z();
    let y = py + z();
    px = x;
    py = y;
    const pts: [number, number][] = [[x, y]];
    for (let k = 1; k < count[i]; k++) {
      x += z();
      y += z();
      pts.push([x, y]);
    }
    ways.push({
      cls: kind[i] >> 1,
      oneway: (kind[i] & 1) === 1,
      name: name[i] ? strings[name[i] - 1] : '',
      ref: ref[i] ? strings[ref[i] - 1] : '',
      speed: speed[i],
      lanes: lanes[i],
      pts,
    });
  }
  const places: SquarePlace[] = [];
  if (at < buf.length) {
    const m = u();
    const kinds = Array.from({ length: m }, u);
    const names = Array.from({ length: m }, u);
    let x = tx * span;
    let y = ty * span;
    for (let i = 0; i < m; i++) {
      x += z();
      y += z();
      const kind = PLACE_KINDS[kinds[i]];
      if (kind) places.push({ kind, name: names[i] ? strings[names[i] - 1] : '', x, y });
    }
  }
  return { ways, places };
}

/** Square size the decoder assumes; set from the road index before reading. */
let squareDeg = 0.25;

/** "south,west,north,east" in degrees reaching `m` metres each way, as numbers. */
function box(p: LatLng, m: number): [number, number, number, number] {
  const dLat = m / 111_320;
  const dLng = m / (111_320 * Math.max(0.01, Math.cos((p.lat * Math.PI) / 180)));
  return [p.lat - dLat, p.lng - dLng, p.lat + dLat, p.lng + dLng];
}

/** The squares (x, y) a box around `p` touches. */
export function squaresAround(p: LatLng, m: number, tileDeg: number): [number, number][] {
  const [s, w, n, e] = box(p, m);
  const out: [number, number][] = [];
  for (let x = Math.floor(w / tileDeg); x <= Math.floor(e / tileDeg); x++)
    for (let y = Math.floor(s / tileDeg); y <= Math.floor(n / tileDeg); y++) out.push([x, y]);
  return out;
}

async function gunzip(data: ArrayBuffer): Promise<Uint8Array> {
  const bytes = new Uint8Array(data);
  // Not gzip (a server that already unzipped it): use as is.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface SquareResult {
  ways: Way[];
  /** Bytes downloaded. */
  bytes: number;
  /** Squares read (a missing square is empty land or water). */
  squares: number;
}

/**
 * The streets around a place from the street squares: side streets within
 * minorM, secondary and tertiary within middleM, trunk and primary within
 * majorM (boxes, like the Overpass query). Null when the road build has no
 * squares or one can't be read, so the caller can try Overpass.
 */
export async function streetsFromSquares(
  p: LatLng,
  info: StreetsInfo,
  url: (path: string) => string,
  radii: { minorM: number; middleM: number; majorM: number },
  signal?: AbortSignal,
): Promise<SquareResult | null> {
  if (info.version < 1 || info.version > 2 || typeof DecompressionStream === 'undefined') return null;
  const reach = Math.max(radii.minorM, radii.middleM, radii.majorM);
  const got = await loadSquares([p], reach, info, url, signal);
  if (!got) return null;
  const { ways: all, bytes, squares } = got;
  // A street crossing a square's edge is in both squares.
  const seen = new Set<string>();
  const boxes = {
    minor: box(p, radii.minorM),
    middle: box(p, radii.middleM),
    major: box(p, radii.majorM),
  };
  const ways = all.filter((w) => {
    const k = `${w.pts[0]},${w.pts[w.pts.length - 1]},${w.pts.length},${w.name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    const [s, wst, n, e] = w.cls >= 5 ? boxes.minor : w.cls >= 3 ? boxes.middle : boxes.major;
    const q = 100_000;
    return w.pts.some(([x, y]) => y / q >= s && y / q <= n && x / q >= wst && x / q <= e);
  });
  return { ways, bytes, squares };
}

const decoded = new Map<string, Promise<{ ways: Way[]; places: SquarePlace[]; bytes: number }>>();
const KEEP_DECODED = 24;

/**
 * The squares within `reachM` of any of the points, read and kept in memory
 * (the last KEEP_DECODED), so a trip's town stops and turn-off names don't
 * download the same square twice. Null when a square can't be read.
 */
export async function loadSquares(
  points: LatLng[],
  reachM: number,
  info: StreetsInfo,
  url: (path: string) => string,
  signal?: AbortSignal,
): Promise<{ ways: Way[]; places: SquarePlace[]; bytes: number; squares: number } | null> {
  if (info.version < 1 || info.version > 2 || typeof DecompressionStream === 'undefined') return null;
  squareDeg = info.tileDeg;
  const keys = new Set<string>();
  for (const p of points) for (const [x, y] of squaresAround(p, reachM, info.tileDeg)) keys.add(`${x}_${y}`);
  try {
    const parts = await Promise.all(
      [...keys].map((k) => {
        const href = url(`${info.dir}/${k}.bin`);
        let job = decoded.get(href);
        if (!job) {
          job = (async () => {
            const r = await fetch(href, { signal });
            if (r.status === 404) return { ways: [], places: [], bytes: 0 };
            if (!r.ok) throw new Error(`street square ${r.status}`);
            const data = await r.arrayBuffer();
            return { ...decodeSquare(await gunzip(data)), bytes: data.byteLength };
          })();
          job.catch(() => decoded.delete(href));
          decoded.set(href, job);
          while (decoded.size > KEEP_DECODED) decoded.delete(decoded.keys().next().value!);
        }
        return job;
      }),
    );
    return {
      ways: parts.flatMap((x) => x.ways),
      places: parts.flatMap((x) => x.places),
      bytes: parts.reduce((n, x) => n + x.bytes, 0),
      squares: keys.size,
    };
  } catch {
    return null;
  }
}

/** Forgets the squares kept in memory (for tests). */
export function forgetSquares(): void {
  decoded.clear();
}
