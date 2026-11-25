import type { LatLng } from './geo';
import type { Way } from './localStreets';

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

/** Reads one square (already unzipped). Throws on a file it doesn't understand. */
export function decodeStreetSquare(buf: Uint8Array): Way[] {
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
  return ways;
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
  if (info.version !== 1 || typeof DecompressionStream === 'undefined') return null;
  squareDeg = info.tileDeg;
  const reach = Math.max(radii.minorM, radii.middleM, radii.majorM);
  const squares = squaresAround(p, reach, info.tileDeg);
  let bytes = 0;
  const all: Way[] = [];
  try {
    await Promise.all(
      squares.map(async ([x, y]) => {
        const r = await fetch(url(`${info.dir}/${x}_${y}.bin`), { signal });
        if (r.status === 404) return;
        if (!r.ok) throw new Error(`street square ${r.status}`);
        const data = await r.arrayBuffer();
        bytes += data.byteLength;
        all.push(...decodeStreetSquare(await gunzip(data)));
      }),
    );
  } catch {
    return null;
  }
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
  return { ways, bytes, squares: squares.length };
}
