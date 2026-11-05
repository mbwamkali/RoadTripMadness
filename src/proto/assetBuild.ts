import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Hand-built models with tiling CC0 photo textures (Poly Haven), exported as GLB.
 * ?a=barn → window.__glb holds the base64 GLB; #status says "ready <tris>".
 * Units are metres, +z is the front.
 */
const p = new URLSearchParams(location.search);
const tl = new THREE.TextureLoader();
const tex = (f: string, srgb = false) => {
  const t = tl.load(`gen/tex/${f}`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
};

type Mat = 'red' | 'white' | 'metal' | 'dirt' | 'dark';
const MATS: Record<Mat, () => THREE.MeshStandardMaterial> = {
  red: () => new THREE.MeshStandardMaterial({ name: 'barn_red', map: tex('planks_red.jpg', true), normalMap: tex('planks_nor.jpg'), roughnessMap: tex('planks_rough.jpg'), roughness: 1 }),
  white: () => new THREE.MeshStandardMaterial({ name: 'trim_white', map: tex('planks_white.jpg', true), normalMap: tex('planks_nor.jpg'), roughness: 0.8 }),
  metal: () => new THREE.MeshStandardMaterial({ name: 'roof_metal', map: tex('metal_diff.jpg', true), normalMap: tex('metal_nor.jpg'), roughnessMap: tex('metal_rough.jpg'), metalness: 0.6, roughness: 1, side: THREE.DoubleSide }),
  dirt: () => new THREE.MeshStandardMaterial({ name: 'ground_dirt', map: tex('dirt_diff.jpg', true), normalMap: tex('dirt_nor.jpg'), roughness: 1 }),
  dark: () => new THREE.MeshStandardMaterial({ name: 'window_dark', color: 0x1d2228, roughness: 0.25, metalness: 0.2 }),
};

/** Collects pieces per material, then merges them (one draw call per material). */
class Builder {
  parts = new Map<Mat, THREE.BufferGeometry[]>();
  add(mat: Mat, g: THREE.BufferGeometry, m?: THREE.Matrix4): void {
    const gg = g.index ? g.toNonIndexed() : g;
    if (m) gg.applyMatrix4(m);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat)!.push(gg);
  }
  /** A flat quad a→b→c→d (counter-clockwise seen from the front), UVs in metres / tile. */
  quad(mat: Mat, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, tile = 3): void {
    const u = b.clone().sub(a).normalize();
    const n = u.clone().cross(d.clone().sub(a)).normalize();
    const v = n.clone().cross(u);
    const uv = (q: THREE.Vector3) => [q.clone().sub(a).dot(u) / tile, q.clone().sub(a).dot(v) / tile];
    const pos = [a, b, c, a, c, d];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos.flatMap((q) => [q.x, q.y, q.z]), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(pos.flatMap(uv), 2));
    g.computeVertexNormals();
    this.add(mat, g);
  }
  /** A flat polygon in the plane z = z0 (pts in x,y), facing +z or -z. */
  poly(mat: Mat, pts: [number, number][], z0: number, facing: 1 | -1, tile = 3): void {
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ShapeGeometry(shape);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / tile, uv.getY(i) / tile);
    const m = new THREE.Matrix4().makeTranslation(0, 0, z0);
    if (facing < 0) m.multiply(new THREE.Matrix4().makeScale(-1, 1, -1));
    this.add(mat, g, m);
  }
  /** A box from point a to point b (a beam), w × h cross-section. */
  beam(mat: Mat, a: THREE.Vector3, b: THREE.Vector3, w: number, h = w): void {
    const len = a.distanceTo(b);
    const g = new THREE.BoxGeometry(w, h, len);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(w, len) / 3, uv.getY(i) * Math.max(h, 0.3) / 3);
    const m = new THREE.Matrix4().lookAt(b, a, new THREE.Vector3(0, 1, Math.abs(b.y - a.y) > len * 0.99 ? 0.001 : 0)).setPosition(a.clone().add(b).multiplyScalar(0.5));
    this.add(mat, g, m);
  }
  box(mat: Mat, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): void {
    this.beam(mat, new THREE.Vector3(cx, cy, cz - sz / 2), new THREE.Vector3(cx, cy, cz + sz / 2), sx, sy);
  }
  build(): THREE.Group {
    const group = new THREE.Group();
    for (const [mat, gs] of this.parts) {
      const g = mergeGeometries(gs)!;
      const mesh = new THREE.Mesh(g, MATS[mat]());
      mesh.name = mat;
      group.add(mesh);
    }
    return group;
  }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function barn(): THREE.Group {
  const b = new Builder();
  const W = 5, D = 7, EAVE = 4.2, KNEE = 6.6, KX = 3.6, RIDGE = 8.4;
  const prof: [number, number][] = [[-W, 0], [W, 0], [W, EAVE], [KX, KNEE], [0, RIDGE], [-KX, KNEE], [-W, EAVE]];
  // Gable ends and side walls.
  b.poly('red', prof, D, 1);
  b.poly('red', prof, -D, -1);
  b.quad('red', V(W, 0, D), V(W, 0, -D), V(W, EAVE, -D), V(W, EAVE, D));
  b.quad('red', V(-W, 0, -D), V(-W, 0, D), V(-W, EAVE, D), V(-W, EAVE, -D));
  // Gambrel roof: four metal panels with an overhang, plus a ridge cap.
  const o = 0.45, out = 0.35;
  const roofPts: [number, number][] = [[W + out, EAVE - 0.25], [KX + 0.12, KNEE + 0.12], [0, RIDGE + 0.15], [-KX - 0.12, KNEE + 0.12], [-W - out, EAVE - 0.25]];
  for (let i = 0; i < 4; i++) {
    const [x0, y0] = roofPts[i], [x1, y1] = roofPts[i + 1];
    const a = V(x0, y0, D + o), bb = V(x0, y0, -D - o), c = V(x1, y1, -D - o), d = V(x1, y1, D + o);
    if (x0 > x1) b.quad('metal', a, bb, c, d, 2.5); else b.quad('metal', bb, a, d, c, 2.5);
  }
  b.beam('metal', V(0, RIDGE + 0.2, D + o), V(0, RIDGE + 0.2, -D - o), 0.35, 0.12);
  // White trim on the gable edges and corners.
  for (const z of [D + 0.06, -D - 0.06]) {
    for (let i = 2; i < prof.length; i++) {
      const [x0, y0] = prof[i], [x1, y1] = prof[(i + 1) % prof.length];
      if (y0 === 0 && y1 === 0) continue;
      b.beam('white', V(x0, y0, z), V(x1, y1, z), 0.22, 0.1);
    }
    b.beam('white', V(W - 0.05, 0, z), V(W - 0.05, EAVE, z), 0.22, 0.1);
    b.beam('white', V(-W + 0.05, 0, z), V(-W + 0.05, EAVE, z), 0.22, 0.1);
    b.beam('white', V(-W, 0.12, z), V(W, 0.12, z), 0.24, 0.1);
  }
  for (const z of [D - 0.05, -D + 0.05]) for (const x of [W + 0.06, -W - 0.06]) b.beam('white', V(x, 0, z), V(x, EAVE, z), 0.1, 0.22);
  // Big front door: white frame and X braces over red boards.
  const dz = D + 0.08, dw = 1.9, dh = 3.5;
  b.quad('red', V(-dw, 0, dz - 0.02), V(dw, 0, dz - 0.02), V(dw, dh, dz - 0.02), V(-dw, dh, dz - 0.02), 2);
  b.beam('white', V(-dw, 0, dz), V(-dw, dh, dz), 0.2, 0.1);
  b.beam('white', V(dw, 0, dz), V(dw, dh, dz), 0.2, 0.1);
  b.beam('white', V(0, 0, dz), V(0, dh, dz), 0.16, 0.1);
  b.beam('white', V(-dw, dh, dz), V(dw, dh, dz), 0.2, 0.1);
  b.beam('white', V(-dw, 0.1, dz), V(dw, 0.1, dz), 0.18, 0.1);
  for (const s of [-1, 1]) {
    b.beam('white', V(s * dw, 0.1, dz + 0.02), V(0, dh, dz + 0.02), 0.16, 0.08);
    b.beam('white', V(0, 0.1, dz + 0.02), V(s * dw, dh, dz + 0.02), 0.16, 0.08);
  }
  b.beam('metal', V(-dw - 0.6, dh + 0.25, dz + 0.05), V(dw + 0.6, dh + 0.25, dz + 0.05), 0.12, 0.12);
  // Hayloft door.
  const hy = 5.6, hw = 0.85, hh = 0.95;
  b.quad('dark', V(-hw, hy - hh, dz - 0.03), V(hw, hy - hh, dz - 0.03), V(hw, hy + hh, dz - 0.03), V(-hw, hy + hh, dz - 0.03));
  b.quad('red', V(-hw, hy - hh, dz - 0.01), V(0, hy - hh, dz - 0.01), V(0, hy + hh, dz - 0.01), V(-hw, hy + hh, dz - 0.01), 2);
  for (const [a, c] of [[V(-hw, hy - hh, dz), V(-hw, hy + hh, dz)], [V(hw, hy - hh, dz), V(hw, hy + hh, dz)], [V(-hw, hy + hh, dz), V(hw, hy + hh, dz)], [V(-hw, hy - hh, dz), V(hw, hy - hh, dz)], [V(-hw, hy - hh, dz + 0.02), V(0, hy + hh, dz + 0.02)]] as [THREE.Vector3, THREE.Vector3][]) b.beam('white', a, c, 0.15, 0.08);
  b.beam('metal', V(0, RIDGE - 0.4, D + 0.6), V(0, RIDGE - 0.4, D + 0.05), 0.12, 0.12); // hay hoist beam
  // Side windows.
  for (const s of [-1, 1]) for (const z of [-4.2, 0, 4.2]) {
    const x = s * (W + 0.03), y = 2.4, ww = 0.55, wh = 0.55;
    const P = (dz2: number, dy: number) => V(x, y + dy, z + dz2 * s);
    b.quad('dark', P(-ww, -wh), P(ww, -wh), P(ww, wh), P(-ww, wh));
    const xo = s * 0.04;
    for (const [a, c] of [[P(-ww, -wh), P(-ww, wh)], [P(ww, -wh), P(ww, wh)], [P(-ww, wh), P(ww, wh)], [P(-ww, -wh), P(ww, -wh)], [P(0, -wh), P(0, wh)], [P(-ww, 0), P(ww, 0)]] as [THREE.Vector3, THREE.Vector3][]) b.beam('white', a.clone().setX(x + xo), c.clone().setX(x + xo), 0.09, 0.09);
  }
  // Cupola on the ridge.
  b.box('white', 0, RIDGE + 0.75, 0, 1.3, 1.2, 1.3);
  b.box('dark', 0, RIDGE + 0.8, 0, 1.36, 0.6, 1.0);
  b.box('dark', 0, RIDGE + 0.8, 0, 1.0, 0.6, 1.36);
  const cap = new THREE.ConeGeometry(1.15, 0.9, 4, 1);
  cap.rotateY(Math.PI / 4);
  b.add('metal', cap, new THREE.Matrix4().makeTranslation(0, RIDGE + 1.8, 0));
  // Ground: a dirt pad.
  const pad = new THREE.CircleGeometry(1, 40);
  pad.rotateX(-Math.PI / 2);
  const uv = pad.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 5, uv.getY(i) * 6);
  b.add('dirt', pad, new THREE.Matrix4().makeScale(9, 1, 11).setPosition(0, 0.02, 0.8));
  return b.build();
}

const BUILDERS: Record<string, () => THREE.Group> = { barn };

// ---- show and export
const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2622);
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x6a5a48, 1.2));
const sun = new THREE.DirectionalLight(0xfff2e0, 2.6);
sun.position.set(3, 5, 4);
scene.add(sun);
const model = (BUILDERS[p.get('a') ?? 'barn'] ?? barn)();
scene.add(model);
THREE.DefaultLoadingManager.onLoad = () => {
  let tris = 0;
  model.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) tris += m.geometry.attributes.position.count / 3; });
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3()).length();
  const c = box.getCenter(new THREE.Vector3());
  const cam = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 500);
  const yaw = THREE.MathUtils.degToRad(Number(p.get('yaw') ?? 35));
  cam.position.set(c.x + Math.sin(yaw) * size * 1.25, c.y + size * 0.45, c.z + Math.cos(yaw) * size * 1.25);
  cam.lookAt(c);
  renderer.render(scene, cam);
  new GLTFExporter().parse(model, (glb) => {
    const bytes = new Uint8Array(glb as ArrayBuffer);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    (window as unknown as { __glb: string }).__glb = btoa(s);
    document.getElementById('status')!.textContent = `ready ${Math.round(tris)}`;
  }, (e) => { document.getElementById('status')!.textContent = 'error ' + e; }, { binary: true });
};
