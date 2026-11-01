/**
 * Bridges and tunnels along a trip. Trips are squeezed into a short drive, so
 * a real 400 m bridge would flash past in a few game units. Only the notable
 * ones are kept (long bridges, which are mostly over rivers and valleys, and
 * tunnels), each is drawn at a length that reads at speed, and they are spaced
 * out so the road isn't one bridge after another.
 */
export interface Structure {
  /** Game distance where it starts and ends. */
  from: number;
  to: number;
  kind: 'bridge' | 'tunnel';
}

/** Real length (metres) a bridge or tunnel needs to show up in the game. */
export const MIN_REAL: Record<Structure['kind'], number> = { bridge: 250, tunnel: 100 };
/** Shortest gap (game units) between two structures. */
export const MIN_GAP = 700;
/** Keep clear of the start and end of the trip. */
const ENDS = 300;

/** How long a structure is drawn (game units), from its real length. */
export function drawnLength(kind: Structure['kind'], meters: number): number {
  return kind === 'bridge' ? Math.min(260, 70 + meters * 0.12) : Math.min(320, 90 + meters * 0.1);
}

export function placeStructures(
  raw: { from: number; to: number; kind: Structure['kind']; meters: number }[],
  pathLength: number,
): Structure[] {
  // Longest first, so a big river crossing wins over a nearby short one.
  const keep = raw.filter((r) => r.meters >= MIN_REAL[r.kind]).sort((a, b) => b.meters - a.meters);
  const out: Structure[] = [];
  for (const r of keep) {
    const mid = (r.from + r.to) / 2;
    const half = drawnLength(r.kind, r.meters) / 2;
    const s = { from: mid - half, to: mid + half, kind: r.kind };
    if (s.from < ENDS || s.to > pathLength - ENDS) continue;
    if (out.some((o) => s.from < o.to + MIN_GAP && s.to > o.from - MIN_GAP)) continue;
    out.push(s);
  }
  return out.sort((a, b) => a.from - b.from);
}

/** The structure at a distance, if any. */
export function structureAt(list: Structure[] | undefined, d: number, pad = 0): Structure | null {
  for (const s of list ?? []) if (d >= s.from - pad && d <= s.to + pad) return s;
  return null;
}
