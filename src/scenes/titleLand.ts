import * as THREE from 'three';
import { makeRng } from '../game/rng';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { modelGeometry, modelMaterial, type ModelName } from './models';

/**
 * The title screen's Sonoran desert: one big rocky mountain behind the road,
 * a blue ridge all round the horizon, and scrub (palo verde bushes, saguaros,
 * grass and rocks) out to the hills. All made in code from noise, nothing
 * copied from a photo. Only the title uses it.
 */

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
/** Ridged noise: sharp crests, like weathered rock. 0..1. */
function ridged(x: number, y: number, octaves = 5): number {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise(x * f, y * f) * 2 - 1);
    v += n * n * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return v / norm;
}

const ROCK = new THREE.Color(0xb47a56);
const ROCK_DARK = new THREE.Color(0x7e5440);
const SCRUB = new THREE.Color(0x6e7442);
const FOOT = new THREE.Color(0x9a7c56);

/**
 * A rocky mountain as a height field `width` across and `depth` deep, its
 * front edge along local z = 0 and rising away from it (towards -z). Steep
 * faces are bare rock, gentler slopes carry scrub.
 */
export function makeMountain(width: number, depth: number, height: number, seed: number): THREE.Mesh {
  const nx = 110;
  const nz = 46;
  const geo = new THREE.PlaneGeometry(width, depth, nx, nz).rotateX(-Math.PI / 2).translate(0, 0, -depth / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const ox = seed * 13.7;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const u = x / (width / 2);
    const v = -z / depth;
    // Two summits, a high one right of centre and a lower shoulder to the left, and a long tail.
    const mass = Math.exp(-(((u - 0.12) * 1.5) ** 2)) + 0.55 * Math.exp(-(((u + 0.55) * 2.4) ** 2)) + 0.25 * Math.exp(-((u * 0.8) ** 2));
    // Rises steeply from the front, flattens on top, falls off at the back.
    const prof = THREE.MathUtils.smoothstep(v, 0, 0.42) * (1 - THREE.MathUtils.smoothstep(v, 0.8, 1));
    const r = ridged(u * 3.2 + ox, v * 2.6, 6);
    // A flat-topped crown with cliffs: clamp the top and stretch it.
    let h = height * mass * prof * (0.45 + 0.75 * r);
    const crown = height * 0.82;
    if (h > crown) h = crown + (h - crown) * 0.35;
    pos.setY(i, h - 4);
  }
  const ni = geo.toNonIndexed();
  geo.dispose();
  ni.computeVertexNormals();
  // Colour each face by how steep and high it is (flat shading keeps the facets).
  const p = ni.attributes.position as THREE.BufferAttribute;
  const n = ni.attributes.normal as THREE.BufferAttribute;
  const cols = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    const ny = (n.getY(i) + n.getY(i + 1) + n.getY(i + 2)) / 3;
    const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    const x = p.getX(i);
    const steep = THREE.MathUtils.smoothstep(1 - ny, 0.25, 0.55);
    const high = THREE.MathUtils.clamp(y / height, 0, 1);
    c.copy(FOOT).lerp(SCRUB, THREE.MathUtils.smoothstep(y, 2, 30) * 0.9);
    c.lerp(ROCK, Math.max(steep, high * 0.8));
    c.lerp(ROCK_DARK, steep * 0.45 * hash(x * 0.1, y * 0.1));
    const k = 0.9 + hash(x * 0.37, y * 0.71) * 0.2;
    for (let j = 0; j < 3; j++) cols.set([c.r * k, c.g * k, c.b * k], (i + j) * 3);
  }
  ni.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const m = new THREE.Mesh(ni, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
  m.receiveShadow = false;
  return m;
}

/** A jagged ridge right round the horizon, `dist` away, for the far blue ranges. */
export function makeRange(dist: number, low: number, high: number, color: number, seed: number): THREE.Mesh {
  const n = 360;
  const verts: number[] = [];
  const cols: number[] = [];
  const top = new THREE.Color(color);
  const foot = new THREE.Color(color).multiplyScalar(0.8);
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const t = (i / n) * 40;
    const h = low + (high - low) * ridged(t + seed, seed * 0.3, 5) * (0.6 + 0.4 * noise(t * 0.15 + seed, 2));
    const x = Math.cos(a) * dist;
    const z = Math.sin(a) * dist;
    verts.push(x, -10, z, x, h, z);
    cols.push(foot.r, foot.g, foot.b, top.r, top.g, top.b);
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const k = i * 2;
    idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
}

export interface ScrubArea {
  /** Keep out: returns true where nothing should grow (road, lanes, the car). */
  blocked: (x: number, z: number) => boolean;
  /** Where the camera is and which way it looks (flat), to grow mostly what shows. */
  eye: THREE.Vector3;
  look: THREE.Vector3;
  /** 1 = full, less on weaker graphics. */
  amount: number;
}

/** A saguaro: a ribbed trunk with up to three arms that bend up, coloured in its vertices. */
export function saguaroGeometry(arms: number, seed: number): THREE.BufferGeometry {
  const rng = makeRng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const h = 6 + rng() * 3;
  const r = 0.38;
  const trunk = (g: THREE.BufferGeometry) => parts.push(g.index ? g.toNonIndexed() : g);
  trunk(new THREE.CylinderGeometry(r * 0.95, r, h, 10, 1).translate(0, h / 2, 0));
  trunk(new THREE.SphereGeometry(r * 0.95, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, h, 0));
  for (let i = 0; i < arms; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const turn = (i * 2.1 + rng()) % (Math.PI * 2);
    const at = h * (0.38 + rng() * 0.25);
    const out = 0.7 + rng() * 0.4;
    const up = 1.4 + rng() * 1.8;
    const ar = r * 0.68;
    const arm: THREE.BufferGeometry[] = [
      new THREE.CylinderGeometry(ar, ar, out, 8).rotateZ(Math.PI / 2).translate((side * out) / 2, at, 0),
      new THREE.SphereGeometry(ar, 8, 6).translate(side * out, at, 0),
      new THREE.CylinderGeometry(ar * 0.95, ar, up, 8).translate(side * out, at + up / 2, 0),
      new THREE.SphereGeometry(ar * 0.95, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(side * out, at + up, 0),
    ];
    for (const g of arm) trunk(g.rotateY(turn));
  }
  for (const g of parts) {
    g.deleteAttribute('uv');
  }
  const geo = mergeGeometries(parts)!;
  for (const g of parts) g.dispose();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const cols = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    // Ribs: alternate faces a touch lighter and darker; the tops a little paler.
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    const rib = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 20) % 2;
    c.setHex(0x667a4c).multiplyScalar(rib ? 1.08 : 0.88).lerp(new THREE.Color(0x8a9a5e), THREE.MathUtils.clamp(pos.getY(i) / 12, 0, 0.3));
    cols.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  geo.userData.shared = false;
  return geo;
}

type Kind = { names: ModelName[]; count: number; scale: [number, number]; tint: number[]; near: number; far: number };

/** Palo verde green bushes, saguaros, grass and rocks scattered over the desert floor. One draw per model. */
export function scatterScrub(area: ScrubArea, seed = 7): THREE.Group {
  const g = new THREE.Group();
  const rng = makeRng(seed);
  const kinds: Kind[] = [
    // Palo verde and creosote: yellow-green, thick near the road like the real thing.
    { names: ['bush-1', 'bush-2'], count: 420, scale: [0.4, 0.95], tint: [0xf2ffc0, 0xd8f0a8, 0xffffd0, 0xc8e098], near: 12, far: 420 },
    { names: ['grass'], count: 400, scale: [0.5, 1.0], tint: [0xffffff, 0xf4ead0], near: 9, far: 260 },
    { names: ['cactus-1', 'cactus-2', 'cactus-3'], count: 40, scale: [0.25, 0.45], tint: [0xffffff, 0xe8f2dc], near: 16, far: 200 },
    { names: ['rock-1', 'rock-2', 'rock-3'], count: 140, scale: [0.4, 1.3], tint: [0xe8c4a0, 0xd8b08c], near: 12, far: 300 },
  ];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const col = new THREE.Color();
  for (const k of kinds) {
    for (const name of k.names) {
      const geo = modelGeometry(name);
      if (!geo) continue;
      const count = Math.round((k.count / k.names.length) * area.amount);
      const mesh = new THREE.InstancedMesh(geo, modelMaterial, count);
      let placed = 0;
      for (let tries = 0; placed < count && tries < count * 8; tries++) {
        // More of them close by: distance spread with a square bias, inside a wide wedge round the view.
        const d = k.near + (k.far - k.near) * rng() ** 1.6;
        const a = Math.atan2(area.look.z, area.look.x) + (rng() - 0.5) * 2.2;
        const x = area.eye.x + Math.cos(a) * d;
        const z = area.eye.z + Math.sin(a) * d;
        if (area.blocked(x, z)) continue;
        const s = k.scale[0] + (k.scale[1] - k.scale[0]) * rng();
        q.setFromAxisAngle(up, rng() * Math.PI * 2);
        m4.compose(pos.set(x, 0, z), q, sc.set(s, s * (0.85 + rng() * 0.3), s));
        mesh.setMatrixAt(placed, m4);
        mesh.setColorAt(placed, col.setHex(k.tint[Math.floor(rng() * k.tint.length)]));
        placed++;
      }
      mesh.count = placed;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.userData.sharedModel = true;
      g.add(mesh);
    }
  }
  // Saguaros, standing tall across the flats (three shapes, one draw each).
  const per = Math.round(40 * area.amount);
  for (let v = 0; v < 3; v++) {
    const geo = saguaroGeometry(v, 40 + v);
    const mesh = new THREE.InstancedMesh(geo, modelMaterial, per);
    let placed = 0;
    for (let tries = 0; placed < per && tries < per * 10; tries++) {
      const d = 30 + 600 * rng() ** 1.2;
      const a = Math.atan2(area.look.z, area.look.x) + (rng() - 0.5) * 2.2;
      const x = area.eye.x + Math.cos(a) * d;
      const z = area.eye.z + Math.sin(a) * d;
      if (area.blocked(x, z)) continue;
      const s = 0.8 + rng() * 0.45;
      q.setFromAxisAngle(up, rng() * Math.PI * 2);
      m4.compose(pos.set(x, 0, z), q, sc.set(s, s, s));
      mesh.setMatrixAt(placed++, m4);
    }
    mesh.count = placed;
    mesh.castShadow = true;
    mesh.computeBoundingSphere();
    g.add(mesh);
  }
  return g;
}
