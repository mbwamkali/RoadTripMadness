/**
 * Walking round the parked ride: the shortest way from one spot to another
 * that doesn't cut through a box on the ground (the car, pickup or motorcycle,
 * plus a little room to pass). Plain 2D maths on the ground plane (x, z), so
 * it can be tested on its own.
 */

export interface P2 {
  x: number;
  z: number;
}

/** A box on the ground: its centre, which way it faces (yaw, as atan2(x, z) of its front), and half its width and length. */
export interface GroundBox {
  x: number;
  z: number;
  yaw: number;
  halfW: number;
  halfL: number;
}

/** Does the segment a-b pass through the inside of the rectangle |u| < hu, |v| < hv? (Touching an edge or corner doesn't count.) */
function crosses(a: P2, b: P2, hu: number, hv: number): boolean {
  const eps = 1e-6;
  let t0 = 0;
  let t1 = 1;
  const du = b.x - a.x;
  const dv = b.z - a.z;
  for (const [p, q] of [
    [-du, a.x + hu],
    [du, hu - a.x],
    [-dv, a.z + hv],
    [dv, hv - a.z],
  ]) {
    if (Math.abs(p) < eps) {
      if (q <= eps) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 >= t1 - eps) return false;
  }
  return true;
}

/**
 * The corners to walk via (in order, world x/z) to get from `from` to `to`
 * without going through `box` grown by `room` on every side. Empty when the
 * straight line is already clear, or when either end is inside the grown box
 * (getting in or out of the car).
 */
export function walkAround(from: P2, to: P2, box: GroundBox, room = 0.6): P2[] {
  const s = Math.sin(box.yaw);
  const c = Math.cos(box.yaw);
  // Into the box's own frame: u across (its left), v along (its front).
  const local = (p: P2): P2 => {
    const dx = p.x - box.x;
    const dz = p.z - box.z;
    return { x: dx * c - dz * s, z: dx * s + dz * c };
  };
  const world = (p: P2): P2 => ({ x: box.x + p.x * c + p.z * s, z: box.z - p.x * s + p.z * c });
  const hu = box.halfW + room;
  const hv = box.halfL + room;
  const a = local(from);
  const b = local(to);
  const inside = (p: P2) => Math.abs(p.x) < hu && Math.abs(p.z) < hv;
  if (inside(a) || inside(b) || !crosses(a, b, hu, hv)) return [];
  // Shortest path over start, end and the four corners (nudged out a touch so the legs between them clear).
  const k = 1.02;
  const nodes: P2[] = [a, b, { x: hu * k, z: hv * k }, { x: -hu * k, z: hv * k }, { x: -hu * k, z: -hv * k }, { x: hu * k, z: -hv * k }];
  const dist = nodes.map(() => Infinity);
  const prev = nodes.map(() => -1);
  const done = nodes.map(() => false);
  dist[0] = 0;
  for (;;) {
    let i = -1;
    for (let j = 0; j < nodes.length; j++) if (!done[j] && (i < 0 || dist[j] < dist[i])) i = j;
    if (i < 0 || dist[i] === Infinity || i === 1) break;
    done[i] = true;
    for (let j = 0; j < nodes.length; j++) {
      if (done[j] || crosses(nodes[i], nodes[j], hu, hv)) continue;
      const d = dist[i] + Math.hypot(nodes[j].x - nodes[i].x, nodes[j].z - nodes[i].z);
      if (d < dist[j]) {
        dist[j] = d;
        prev[j] = i;
      }
    }
  }
  const via: P2[] = [];
  for (let j = prev[1]; j > 1; j = prev[j]) via.unshift(world(nodes[j]));
  return via;
}
