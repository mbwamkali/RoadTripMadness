import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Structure } from '../game/structures';
import type { Path } from '../geo/geo';
import { waterTexture } from './landmarkModels';

/**
 * Bridges and tunnels, built a chunk at a time: each call draws the part of
 * a structure between `from` and `to` (game distance). Bridges get water on
 * both sides, concrete girders and steel railings; tunnels get a hill over the
 * road, concrete portals at each end and a dark tube with ceiling lights.
 */

const STEP = 4;

/** Distances from `from` to `to` every STEP, always ending exactly at `to`. */
function stations(from: number, to: number): number[] {
  const out: number[] = [];
  for (let d = from; d < to - 0.01; d += STEP) out.push(d);
  out.push(to);
  return out;
}

/** Per-chunk material, freed with the chunk. */
function mat(color: number, extra: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ color, ...extra });
  m.userData.chunkOwned = true;
  return m;
}
function basic(color: number, extra: THREE.MeshBasicMaterialParameters = {}): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color, ...extra });
  m.userData.chunkOwned = true;
  return m;
}

/** Position and right-hand vector of the road at a distance, in three.js space. */
function frame(path: Path, d: number) {
  const p = path.pointAt(d);
  const f = path.directionAt(d, 8);
  return { x: p.x, z: -p.y, rx: f.y, rz: f.x, yaw: Math.atan2(f.x, -f.y) };
}

/** A box placed at a sideways offset from the road centre, turned to follow the road. */
function boxAlong(path: Path, d: number, side: number, y: number, w: number, h: number, len: number): THREE.BufferGeometry {
  const f = frame(path, d);
  const g = new THREE.BoxGeometry(w, h, len);
  g.rotateY(f.yaw);
  g.translate(f.x + f.rx * side, y, f.z + f.rz * side);
  return g;
}

/** A flat strip beside the road from offset a to b (a < b), like the road ribbons. */
function strip(path: Path, from: number, to: number, a: (d: number) => number, b: (d: number) => number, y: number, vScale: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  stations(from, to).forEach((d, i) => {
    const f = frame(path, d);
    const l = a(d);
    const r = b(d);
    pos.push(f.x + f.rx * l, y, f.z + f.rz * l, f.x + f.rx * r, y, f.z + f.rz * r);
    uv.push(l / vScale, d / vScale, r / vScale, d / vScale);
    if (i > 0) {
      const k = (i - 1) * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A point on an arch of half-width 1 and height 1 at angle a (0 = right foot,
 * PI = left foot). Square arches (a superellipse) keep a tunnel tall right out
 * to its walls, so the chase camera stays inside it over any lane.
 */
function archPoint(a: number, square: boolean): [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return square ? [Math.sign(c) * Math.sqrt(Math.abs(c)), Math.sqrt(Math.abs(s))] : [c, s];
}

/** An arch over the road, as a surface running along it. */
function arch(path: Path, from: number, to: number, w: (d: number) => number, h: number, segs = 12, square = false): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  stations(from, to).forEach((d, i) => {
    const f = frame(path, d);
    const half = w(d);
    for (let k = 0; k <= segs; k++) {
      const [ax, ay] = archPoint((k / segs) * Math.PI, square);
      const side = ax * half;
      pos.push(f.x + f.rx * side, ay * h, f.z + f.rz * side);
    }
    if (i > 0) {
      const r0 = (i - 1) * (segs + 1);
      const r1 = i * (segs + 1);
      for (let k = 0; k < segs; k++) idx.push(r0 + k, r1 + k, r0 + k + 1, r0 + k + 1, r1 + k, r1 + k + 1);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** The face of a portal: the ring between the tunnel opening and the hill's outline. */
function portalFace(path: Path, d: number, inner: number, innerH: number, outer: number, outerH: number, segs = 16): THREE.BufferGeometry {
  const f = frame(path, d);
  const pos: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k <= segs; k++) {
    const a = (k / segs) * Math.PI;
    for (const [w, h, square] of [
      [inner, innerH, true],
      [outer, outerH, false],
    ] as const) {
      const [ax, ay] = archPoint(a, square);
      pos.push(f.x + f.rx * ax * w, ay * h, f.z + f.rz * ax * w);
    }
    if (k > 0) {
      const p = (k - 1) * 2;
      idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function merged(parts: THREE.BufferGeometry[], m: THREE.Material): THREE.Mesh | null {
  if (!parts.length) return null;
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  parts.forEach((p) => p.dispose());
  return g ? new THREE.Mesh(g, m) : null;
}

/** Draws the part of a bridge or tunnel that falls between `from` and `to`. */
export function buildStructurePart(st: Structure, path: Path, from: number, to: number, edge: (d: number) => number): THREE.Group {
  const g = new THREE.Group();
  const a = Math.max(st.from, from);
  const b = Math.min(st.to, to);
  if (b <= a) return g;
  if (st.kind === 'bridge') buildBridge(g, st, path, a, b, edge);
  else buildTunnel(g, st, path, a, b, edge);
  return g;
}

function buildBridge(g: THREE.Group, st: Structure, path: Path, a: number, b: number, edge: (d: number) => number): void {
  // Water on both sides, out to where the banks would be.
  const water = mat(0xffffff, { map: waterTexture(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    const near = (d: number) => s * (edge(d) + 0.6);
    const far = (d: number) => s * (edge(d) + 90);
    g.add(new THREE.Mesh(strip(path, a, b, s < 0 ? far : near, s < 0 ? near : far, 0.05, 30), water));
  }
  // Girders, railings and posts along both edges; abutments where it meets land.
  const concrete: THREE.BufferGeometry[] = [];
  const steel: THREE.BufferGeometry[] = [];
  for (let d = a; d < b; d += STEP) {
    const len = Math.min(STEP, b - d) + 0.05;
    const mid = d + len / 2;
    for (const s of [-1, 1]) {
      const off = s * (edge(mid) + 0.4);
      concrete.push(boxAlong(path, mid, off, -0.3, 0.9, 1.4, len));
      steel.push(boxAlong(path, mid, off, 1.15, 0.22, 0.22, len));
      steel.push(boxAlong(path, mid, off, 0.7, 0.12, 0.12, len));
      steel.push(boxAlong(path, d, off, 0.6, 0.18, 1.2, 0.18));
    }
    // Piers under the deck every 40 units, standing in the water.
    if (Math.floor(d / 40) !== Math.floor((d + STEP) / 40)) for (const s of [-1, 1]) concrete.push(boxAlong(path, d, s * (edge(d) - 0.8), -1, 2.2, 2.4, 2.2));
  }
  for (const end of [st.from, st.to]) {
    if (end < a - 0.01 || end > b + 0.01) continue;
    for (const s of [-1, 1]) concrete.push(boxAlong(path, end, s * (edge(end) + 1.2), 0.4, 2.4, 2, 3));
  }
  const c = merged(concrete, mat(0xb9b2a5));
  const r = merged(steel, mat(0x6f7a84));
  if (c) g.add(c);
  if (r) g.add(r);
}

function buildTunnel(g: THREE.Group, st: Structure, path: Path, a: number, b: number, edge: (d: number) => number): void {
  const inner = (d: number) => edge(d) + 2;
  const innerH = 10.5;
  const outer = (d: number) => edge(d) + 34;
  const outerH = 24;
  // The hill the road goes through, and the tube inside it.
  g.add(new THREE.Mesh(arch(path, a, b, outer, outerH, 10), mat(0x7a6f5e, { flatShading: true })));
  g.add(new THREE.Mesh(arch(path, a, b, inner, innerH, 16, true), basic(0x34343a, { side: THREE.DoubleSide })));
  // Lights along the ceiling.
  const lamps: THREE.BufferGeometry[] = [];
  for (let d = Math.ceil(a / 14) * 14; d < b; d += 14) {
    const f = frame(path, d);
    for (const s of [-0.35, 0.35]) {
      const w = inner(d) * s;
      const geo = new THREE.BoxGeometry(0.5, 0.15, 2.4);
      geo.rotateY(f.yaw);
      geo.translate(f.x + f.rx * w, (1 - s ** 4) ** 0.25 * innerH - 0.4, f.z + f.rz * w);
      lamps.push(geo);
    }
  }
  const l = merged(lamps, basic(0xffe6a0));
  if (l) g.add(l);
  // Concrete portals at each end.
  for (const end of [st.from, st.to]) {
    if (end < a - 0.01 || end > b + 0.01) continue;
    g.add(new THREE.Mesh(portalFace(path, end, inner(end), innerH, outer(end), outerH), mat(0x8c8676, { side: THREE.DoubleSide })));
    g.add(new THREE.Mesh(arch(path, end - 0.6, end + 0.6, (d) => inner(d) + 0.6, innerH + 0.6, 16, true), mat(0xc9c2b2, { side: THREE.DoubleSide })));
  }
}
