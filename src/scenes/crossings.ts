import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { signName, type RoadCrossing } from '../game/crossings';
import type { Path, Vec2 } from '../geo/geo';
import { lit } from './materials';
import { greenPanel } from './roadside';
import { makeTrafficVehicle } from './common';

/**
 * Draws a road crossing the trip (game/crossings.ts): an overpass with earth
 * ramps, concrete deck, girders, a median pier and a green name sign on the
 * side facing you; or a flat crossing with a light (big roads) or stop signs,
 * stop bars, a street-name blade and a car or two waiting. Everything is in
 * world coordinates, a few merged meshes per crossing.
 */

/** Overpass sizes (game units, about metres). The deck clears the chase camera (at most about 8.5 up). */
export const OVERPASS = { bottom: 10.2, deck: 1.4, ramp: 60, ground: 220, width: 11, widthBig: 16, slope: 1.5 };
/** Flat crossing sizes. */
export const FLAT = { width: 8, widthBig: 12, length: 260 };

export interface CrossingFit {
  /** Where the roadside starts (centre line to outside of the shoulder or sidewalk). */
  outer: (d: number) => number;
  /** Half-width of the pavement. */
  edge: (d: number) => number;
  /** Half-width of the median (0 on undivided roads). */
  median: (d: number) => number;
  /** Middle of your side of the road (centre line to the middle of your lanes). */
  sideCentre: (d: number) => number;
}

export interface CrossingMats {
  /** The crossing road's asphalt, drawn under the trip's road where they overlap. */
  asphalt: THREE.Material;
  ground: number;
  /** Cars (waiting at a light, driving over a bridge). Off on Low. */
  cars: boolean;
}

export interface BuiltCrossing {
  group: THREE.Group;
  /** Things the car can hit off the road: road distance, sideways offset, radius. */
  solids: { d: number; x: number; r: number }[];
  /** Whether a world point (x, z) is on the crossing road or its ramps (keep roadside scenery off it). */
  covers: (x: number, z: number) => boolean;
  /** Moves the cars on it. */
  tick?: (t: number) => void;
  /** Objects to free with disposeTree when the chunk goes. */
  trees: THREE.Object3D[];
}

const CONCRETE = lit({ color: 0xbab4a8 });
CONCRETE.userData.shared = true;
const PAINT_YELLOW = lit({ color: 0xf2c230, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -10 });
PAINT_YELLOW.userData.shared = true;
const PAINT_WHITE = lit({ color: 0xe8e2cf, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -10 });
PAINT_WHITE.userData.shared = true;
const POLE = lit({ color: 0x8a8f96 });
POLE.userData.shared = true;
const DARK = lit({ color: 0x2a2c30 });
DARK.userData.shared = true;
const GREEN_LIGHT = new THREE.MeshBasicMaterial({ color: 0x3dff6a });
GREEN_LIGHT.userData.shared = true;
const RED_LIGHT = new THREE.MeshBasicMaterial({ color: 0x5a1010 });
RED_LIGHT.userData.shared = true;
const STOP_RED = lit({ color: 0xc8202a, side: THREE.DoubleSide });
STOP_RED.userData.shared = true;
const embankMats = new Map<number, THREE.Material>();
function embankMat(ground: number): THREE.Material {
  let m = embankMats.get(ground);
  if (!m) {
    m = lit({ color: new THREE.Color(ground).multiplyScalar(0.82), flatShading: true });
    m.userData.shared = true;
    embankMats.set(ground, m);
  }
  return m;
}

/** A frame at the crossing: origin on the centre line, U along the crossing road, N across it (toward you when square). */
function frame(c: RoadCrossing, path: Path) {
  const o = path.pointAt(c.at);
  const f = path.directionAt(c.at, 10);
  const r = { x: f.y, y: -f.x };
  const ca = Math.cos(c.angle), sa = Math.sin(c.angle);
  const u = { x: r.x * ca + f.x * sa, y: r.y * ca + f.y * sa };
  const n = { x: u.y, y: -u.x };
  // Local (s along U, height, w along N) → world. N in 3D is U × up, so the basis is right-handed.
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(u.x, 0, -u.y), new THREE.Vector3(0, 1, 0), new THREE.Vector3(n.x, 0, -n.y));
  m.setPosition(o.x, 0, -o.y);
  /** World 2D point → local (s, w). */
  const local = (x: number, y: number) => {
    const px = x - o.x, py = y - o.y;
    return { s: px * u.x + py * u.y, w: px * n.x + py * n.y };
  };
  /** Local (s, w) → road distance and sideways offset. */
  const road = (s: number, w: number) => {
    const px = u.x * s + n.x * w, py = u.y * s + n.y * w;
    return { d: c.at + px * f.x + py * f.y, x: px * r.x + py * r.y };
  };
  return { o, f, r, u, n, m, local, road, cos: Math.cos(c.angle) };
}

function box(s: number, y: number, w: number, ls: number, ly: number, lw: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(ls, ly, lw).translate(s, y, w);
}

/** A strip along s, between w = -half..half, at height h(s). Indexed, with normals and uvs (u across, v along / vScale). */
function stripAlong(ss: number[], half: number, h: (s: number) => number, vScale: number, w0 = 0): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  ss.forEach((s, i) => {
    pos.push(s, h(s), w0 + half, s, h(s), w0 - half);
    uv.push(0, s / vScale, 1, s / vScale);
    if (i > 0) {
      const k = (i - 1) * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** An earth ramp from s0 (full height `top`) down to s1 (ground), sides sloping out. */
function embankment(s0: number, s1: number, top: number, half: number, slope: number): THREE.BufferGeometry {
  const steps = 8;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const s = s0 + (s1 - s0) * t;
    const h = top * (1 - t);
    const out = half + h * slope;
    // Bottom left, top left, top right, bottom right.
    pos.push(s, 0, -out, s, h, -half, s, h, half, s, 0, out);
    uv.push(0, t, 0.3, t, 0.7, t, 1, t);
    if (i > 0) {
      const a = (i - 1) * 4, b = i * 4;
      const forward = s1 > s0;
      const quad = (p: number, q: number) =>
        forward ? idx.push(a + p, a + q, b + p, a + q, b + q, b + p) : idx.push(a + p, b + p, a + q, a + q, b + p, b + q);
      quad(0, 1);
      quad(1, 2);
      quad(2, 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Merges parts (all indexed, position/normal/uv), moves them into the world, one mesh. */
function mesh(parts: THREE.BufferGeometry[], m: THREE.Matrix4, mat: THREE.Material): THREE.Mesh | null {
  if (!parts.length) return null;
  const clean = parts.map((g) => {
    const x = g.index ? g : g.setIndex([...Array(g.attributes.position.count).keys()]);
    if (!x.attributes.normal) x.computeVertexNormals();
    if (!x.attributes.uv) x.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(x.attributes.position.count * 2).fill(0), 2));
    return x;
  });
  const merged = mergeGeometries(clean, false);
  clean.forEach((g) => g.dispose());
  if (!merged) return null;
  merged.applyMatrix4(m);
  return new THREE.Mesh(merged, mat);
}

/** Facing direction (2D) → rotation.y, the same way traffic is turned. */
const yawFor = (v: Vec2) => Math.atan2(v.x, -v.y);

/** Overpass layout along the crossing road: half-span of the deck S, ramp R, whole half-length L. */
function overDims(c: RoadCrossing, fit: CrossingFit, cos: number) {
  const P = OVERPASS;
  const W = c.big ? P.widthBig : P.width;
  const top = P.bottom + P.deck;
  const outer = Math.max(fit.outer(c.at - 20), fit.outer(c.at), fit.outer(c.at + 20));
  // Abutments clear the shoulders across the whole width of the deck, however skewed.
  const S = (outer + 3) / cos + (W / 2) * Math.abs(Math.tan(c.angle));
  const R = P.ramp;
  return { W, top, S, R, L: S + R + P.ground };
}

/**
 * Whether a world point (x, z) is on a crossing road or its ramps: cheap, no
 * geometry, so neighbouring chunks can keep their scenery off it.
 */
export function crossingFootprint(c: RoadCrossing, path: Path, fit: CrossingFit): (x: number, z: number) => boolean {
  const F = frame(c, path);
  if (c.kind === 'over') {
    const { W, top, S, R, L } = overDims(c, fit, F.cos);
    return (x, z) => {
      const p = F.local(x, -z);
      const a = Math.abs(p.s);
      return a <= L + 4 && Math.abs(p.w) < (a < S + R + 4 ? W / 2 + top * OVERPASS.slope + 3 : W / 2 + 4);
    };
  }
  const Wc = c.big ? FLAT.widthBig : FLAT.width;
  return (x, z) => {
    const q = F.local(x, -z);
    if (Math.abs(q.w) > Wc / 2 + 6 || Math.abs(q.s) > FLAT.length + 4) return false;
    return c.side === 0 || Math.sign(q.s) === c.side;
  };
}

export function buildCrossing(c: RoadCrossing, path: Path, fit: CrossingFit, mats: CrossingMats): BuiltCrossing {
  const b = c.kind === 'over' ? overpass(c, path, fit, mats) : flatCrossing(c, path, fit, mats);
  b.group.name = `crossing:${c.kind}`;
  return b;
}

function overpass(c: RoadCrossing, path: Path, fit: CrossingFit, mats: CrossingMats): BuiltCrossing {
  const F = frame(c, path);
  const g = new THREE.Group();
  const P = OVERPASS;
  const { W, top, S, R, L } = overDims(c, fit, F.cos);
  const height = (s: number) => {
    const a = Math.abs(s);
    return a <= S ? top : a <= S + R ? top * (1 - (a - S) / R) : 0.07;
  };
  const concrete: THREE.BufferGeometry[] = [];
  // Deck, girders under it, parapets on it, abutment walls.
  concrete.push(box(0, P.bottom + P.deck / 2, 0, 2 * S + 2, P.deck, W));
  for (const k of [-0.36, -0.12, 0.12, 0.36]) concrete.push(box(0, P.bottom - 0.4, k * W, 2 * S, 0.8, 0.7));
  for (const side of [-1, 1]) concrete.push(box(0, top + 0.5, side * (W / 2 - 0.25), 2 * S + 2, 1, 0.5));
  for (const side of [-1, 1]) concrete.push(box(side * (S + 0.6), top / 2, 0, 1.2, top, W + 2));
  // A pier in a wide enough median: a cap beam on three columns.
  const median = fit.median(c.at);
  if (median >= 1.2) {
    concrete.push(box(0, P.bottom - 1.3, 0, 1.6, 1, W - 0.5));
    for (const k of [-1, 0, 1]) concrete.push(new THREE.CylinderGeometry(0.55, 0.65, P.bottom - 1.8, 10).translate(0, (P.bottom - 1.8) / 2, (k * W) / 3));
  }
  const embank: THREE.BufferGeometry[] = [embankment(S + 1.2, S + R, top, W / 2, P.slope), embankment(-S - 1.2, -S - R, top, W / 2, P.slope)];
  // The road surface: over the deck, down the ramps and on along the ground.
  const ss: number[] = [-L, -S - R];
  for (let i = 1; i < 10; i++) ss.push(-S - R + (R * i) / 10);
  ss.push(-S, S);
  for (let i = 1; i < 10; i++) ss.push(S + (R * i) / 10);
  ss.push(S + R, L);
  const asphalt = stripAlong(ss, W / 2 - 0.6, (s) => height(s) + 0.03, 8);
  const lines = [stripAlong(ss, 0.09, (s) => height(s) + 0.06, 8, 0.14), stripAlong(ss, 0.09, (s) => height(s) + 0.06, 8, -0.14)];
  for (const [list, mat] of [
    [concrete, CONCRETE],
    [embank, embankMat(mats.ground)],
    [[asphalt], mats.asphalt],
    [lines, PAINT_YELLOW],
  ] as [THREE.BufferGeometry[], THREE.Material][]) {
    const me = mesh(list, F.m, mat);
    if (me) g.add(me);
  }
  // The name on the side of the bridge, over your lanes.
  if (c.name) {
    const sign = greenPanel([{ text: signName(c.name) }], Math.min(9, 3 + signName(c.name).length * 0.42));
    const sc = fit.sideCentre(c.at) / F.cos;
    sign.position.set(sc, P.bottom + P.deck / 2 + 0.1, W / 2 + 0.08);
    sign.scale.setScalar(0.85);
    const holder = new THREE.Group();
    holder.add(sign);
    holder.applyMatrix4(F.m);
    g.add(holder);
  }
  // Abutments and the median pier stop a car that's off the road.
  const solids: BuiltCrossing['solids'] = [];
  for (const side of [-1, 1]) {
    for (let w = -W / 2 - 1; w <= W / 2 + 1; w += 2) {
      const at = F.road(side * (S + 0.6), w);
      solids.push({ d: at.d, x: at.x, r: 1.4 });
    }
  }
  if (median >= 1.2) {
    for (const k of [-1, 0, 1]) {
      const at = F.road(0, (k * W) / 3);
      solids.push({ d: at.d, x: at.x, r: 0.9 });
    }
  }
  const covers = crossingFootprint(c, path, fit);
  // Now and then a car or truck drives over.
  const trees: THREE.Object3D[] = [];
  let tick: BuiltCrossing['tick'];
  if (mats.cars) {
    const dir = c.at % 2 < 1 ? 1 : -1;
    const kinds = ['car', 'pickup', 'van', 'truck', 'car'] as const;
    const v = makeTrafficVehicle(kinds[Math.floor(c.at) % kinds.length], [0xc23b22, 0x2d5d9b, 0xdedad2, 0x2f6b3e, 0x222222][Math.floor(c.at / 7) % 5]);
    trees.push(v);
    g.add(v);
    const heading = { x: F.u.x * dir, y: F.u.y * dir };
    const lane = dir * (W / 4);
    const speed = 16;
    const span = 2 * L;
    const phase = (c.at * 13) % span;
    tick = (t) => {
      const s = (((t * speed + phase) % span) - L) * dir;
      const px = F.o.x + F.u.x * s + F.n.x * lane, py = F.o.y + F.u.y * s + F.n.y * lane;
      v.position.set(px, height(s), -py);
      // Tilt with the ramp.
      const slope = Math.abs(s) > S && Math.abs(s) < S + R ? (top / R) * Math.sign(s) * dir : 0;
      v.rotation.set(0, yawFor(heading), 0);
      v.rotateX(slope);
    };
    tick(0);
  }
  return { group: g, solids, covers, tick, trees };
}

function flatCrossing(c: RoadCrossing, path: Path, fit: CrossingFit, mats: CrossingMats): BuiltCrossing {
  const F = frame(c, path);
  const g = new THREE.Group();
  const Wc = c.big ? FLAT.widthBig : FLAT.width;
  const edge = fit.edge(c.at) / F.cos;
  const outer = fit.outer(c.at) / F.cos;
  const arms = c.side === 0 ? [-1, 1] : [c.side];
  const asphalt: THREE.BufferGeometry[] = [];
  const yellow: THREE.BufferGeometry[] = [];
  const white: THREE.BufferGeometry[] = [];
  const stop = outer + 1.2;
  for (const arm of arms) {
    const a = c.side === 0 ? 0 : edge - 0.5;
    const ss = arm > 0 ? [a, FLAT.length] : [-FLAT.length, -a];
    asphalt.push(stripAlong(ss, Wc / 2, () => 0.07, 8));
    const ls = arm > 0 ? [stop, FLAT.length] : [-FLAT.length, -stop];
    yellow.push(stripAlong(ls, 0.09, () => 0.075, 8, 0.14), stripAlong(ls, 0.09, () => 0.075, 8, -0.14));
    // Stop bar across the lane coming toward the trip (right-hand traffic: w < 0 on the +s arm).
    const bar = arm > 0 ? [stop, stop + 0.6] : [-stop - 0.6, -stop];
    white.push(stripAlong(bar, Wc / 4 - 0.1, () => 0.075, 8, -arm * (Wc / 4)));
  }
  for (const [list, mat] of [
    [asphalt, mats.asphalt],
    [yellow, PAINT_YELLOW],
    [white, PAINT_WHITE],
  ] as [THREE.BufferGeometry[], THREE.Material][]) {
    const me = mesh(list, F.m, mat);
    if (me) g.add(me);
  }
  // Your side: a light hanging over your lanes (big roads) and a street-name blade at the corner.
  const near = c.at - (Wc / 2 + 3) / F.cos;
  const p = path.pointAt(near);
  const f = path.directionAt(near, 10);
  const r = { x: f.y, y: -f.x };
  const toCar = { x: -f.x, y: -f.y };
  const cornerX = fit.outer(near) + 1.2;
  const at = (x: number, y: number) => new THREE.Vector3(p.x + r.x * x, y, -(p.y + r.y * x));
  const props: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const green: THREE.BufferGeometry[] = [];
  const red: THREE.BufferGeometry[] = [];
  const place = (geo: THREE.BufferGeometry, x: number, y: number, list: THREE.BufferGeometry[]) => {
    geo.rotateY(yawFor(toCar) + Math.PI);
    const q = at(x, y);
    list.push(geo.translate(q.x, q.y, q.z));
  };
  if (c.big) {
    const reach = cornerX - fit.median(near) - 0.5;
    place(new THREE.CylinderGeometry(0.16, 0.2, 7, 8), cornerX, 3.5, props);
    // The mast arm out over the road.
    const arm = new THREE.BoxGeometry(reach, 0.22, 0.22).translate(reach / 2, 0, 0);
    place(arm, cornerX, 6.6, props);
    for (let k = 0; k < 2; k++) {
      const x = cornerX - reach * (0.35 + 0.4 * k);
      place(new THREE.BoxGeometry(0.5, 1.4, 0.4), x, 5.9, dark);
      place(new THREE.BoxGeometry(0.28, 0.28, 0.06).translate(0, -0.42, -0.23), x, 5.9, green);
      place(new THREE.BoxGeometry(0.28, 0.28, 0.06).translate(0, 0.42, -0.23), x, 5.9, red);
    }
  } else {
    // Stop signs for the crossing road (you have the right of way).
    for (const arm of arms) {
      const s = arm * (stop + 1.8);
      const w = -arm * (Wc / 2 + 1.2);
      const pole = new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6).translate(s, 1.3, w);
      props.push(pole.applyMatrix4(F.m));
      const face = new THREE.CircleGeometry(0.45, 8).rotateY(arm > 0 ? Math.PI / 2 : -Math.PI / 2).translate(s + arm * 0.06, 2.6, w);
      red.push(face.applyMatrix4(F.m));
    }
  }
  place(new THREE.CylinderGeometry(0.07, 0.07, 3.6, 6), cornerX + (c.big ? 0.9 : 0), 1.8, props);
  for (const [list, mat] of [
    [props, POLE],
    [dark, DARK],
    [green, GREEN_LIGHT],
    [red, c.big ? RED_LIGHT : STOP_RED],
  ] as [THREE.BufferGeometry[], THREE.Material][]) {
    if (!list.length) continue;
    const merged = mergeGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x)), false);
    list.forEach((x) => x.dispose());
    if (merged) g.add(new THREE.Mesh(merged, mat));
  }
  if (c.name) {
    const blade = greenPanel([{ text: signName(c.name) }], Math.min(5, 1.6 + signName(c.name).length * 0.25));
    blade.scale.setScalar(0.55);
    blade.position.copy(at(cornerX + (c.big ? 0.9 : 0), 3.7));
    blade.rotation.y = yawFor(toCar);
    g.add(blade);
  }
  const solids: BuiltCrossing['solids'] = [{ d: near, x: cornerX, r: 0.5 }];
  const covers = crossingFootprint(c, path, fit);
  // A car waiting at the stop bar on each arm.
  const trees: THREE.Object3D[] = [];
  if (mats.cars) {
    arms.forEach((arm, i) => {
      const kinds = ['car', 'pickup', 'car', 'van'] as const;
      const v = makeTrafficVehicle(kinds[(Math.floor(c.at) + i) % kinds.length], [0x7a1f1f, 0x1f3f7a, 0xe0ddd5, 0x3d3d3d][(Math.floor(c.at / 3) + i) % 4]);
      const s = arm * (stop + 3.2);
      const w = -arm * (Wc / 4);
      const x = F.o.x + F.u.x * s + F.n.x * w, y = F.o.y + F.u.y * s + F.n.y * w;
      v.position.set(x, 0, -y);
      v.rotation.y = yawFor({ x: -arm * F.u.x, y: -arm * F.u.y });
      g.add(v);
      trees.push(v);
    });
  }
  return { group: g, solids, covers, trees };
}

/** Width of the crossing road along the trip (game units), for keeping sidewalks and signs off it. */
export function crossingHalfSpan(c: RoadCrossing): number {
  const w = c.kind === 'over' ? (c.big ? OVERPASS.widthBig : OVERPASS.width) : c.big ? FLAT.widthBig : FLAT.width;
  return w / 2 / Math.cos(c.angle);
}
