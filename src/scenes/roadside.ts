import * as THREE from 'three';
import { lit } from './materials';
import type { Path } from '../geo/geo';

/**
 * Drawing helpers for what runs alongside the road (see game/roadside.ts):
 * shapes swept along the route (curbs, sidewalks, the median barrier,
 * guardrails), street lights, and the signs: speed limits, exits ahead and
 * distances to the next towns.
 */

/**
 * Sweeps a cross-section along the route. `profile` points are [sideways, up],
 * sideways measured outward from `at(d)` (to the right, or to the left when
 * `left` is set). Returns null for an empty stretch.
 */
export function sweep(path: Path, from: number, to: number, profile: [number, number][], at: (d: number) => number, left = false, step = 4): THREE.BufferGeometry | null {
  if (to - from < 0.5) return null;
  const ds: number[] = [];
  for (let d = from; d < to - 0.5; d += step) ds.push(d);
  ds.push(to);
  const n = profile.length;
  const pos: number[] = [];
  const idx: number[] = [];
  const side = left ? -1 : 1;
  ds.forEach((d, i) => {
    const p = path.pointAt(d);
    const f = path.directionAt(d);
    const r = { x: f.y * side, y: -f.x * side };
    const base = at(d);
    for (const [x, y] of profile) {
      const o = base + x;
      pos.push(p.x + r.x * o, y, -(p.y + r.y * o));
    }
    if (i > 0) {
      const a = (i - 1) * n;
      const b = i * n;
      for (let k = 0; k < n - 1; k++) idx.push(a + k, b + k, a + k + 1, a + k + 1, b + k, b + k + 1);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Cross-sections, outward from where they start. */
export const PROFILES = {
  /** Curb face and sidewalk top, from the road's edge out. */
  sidewalk: (width: number, h: number): [number, number][] => [
    [0, 0.02],
    [0, h],
    [0.05, h],
    [width, h],
    [width, 0.02],
  ],
  /** A concrete barrier, centred on the line. */
  barrier: [
    [-0.42, 0.02],
    [-0.28, 0.28],
    [-0.12, 0.85],
    [0.12, 0.85],
    [0.28, 0.28],
    [0.42, 0.02],
  ] as [number, number][],
  /** A guardrail beam (a W-beam seen end-on, roughly). */
  guardrail: [
    [0, 0.5],
    [-0.12, 0.6],
    [0, 0.68],
    [-0.12, 0.76],
    [0, 0.86],
  ] as [number, number][],
};

/** One street light: a post with an arm over the road (along +x) and the lamp head (lit separately). */
export function lampGeometries(): { post: THREE.BufferGeometry; head: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const post = new THREE.CylinderGeometry(0.1, 0.14, 7.6, 6).translate(0, 3.8, 0);
  const arm = new THREE.BoxGeometry(2.3, 0.1, 0.1).translate(1.1, 7.45, 0);
  const parts = [post, arm];
  const merged = mergeSimple(parts);
  parts.forEach((g) => g.dispose());
  return {
    post: merged,
    head: new THREE.BoxGeometry(0.9, 0.18, 0.45).translate(2.2, 7.32, 0),
    // A pool of light on the road under the lamp.
    glow: new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2).translate(2.2, 0.16, 0),
  };
}

/** Merges non-indexed-compatible simple geometries (positions and normals only). */
function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...(g.getAttribute('position').array as Float32Array));
    nor.push(...(g.getAttribute('normal').array as Float32Array));
    if (g !== g0) g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, owned = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (owned) tex.userData.chunkOwned = true;
  return tex;
}

const POST_MAT = lit({ color: 0x8a8f96 });
POST_MAT.userData.shared = true;

/** A sign face on one or two posts, facing back down the road toward the car (+z toward the car once placed). */
function signOnPosts(tex: THREE.Texture, w: number, h: number, height: number, owned: boolean): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
  // The material goes with the chunk; a shared texture (speed limits) stays (see disposeRoadside).
  mat.userData.chunkOwned = true;
  if (!owned) tex.userData.chunkOwned = false;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  face.position.y = height + h / 2;
  g.add(face);
  const posts = w > 3 ? [-w / 3, w / 3] : [0];
  for (const x of posts) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, height + h * 0.8, 0.14), POST_MAT);
    post.position.set(x, (height + h * 0.8) / 2, -0.06);
    g.add(post);
  }
  return g;
}

const limitTextures = new Map<number, THREE.CanvasTexture>();

/** A white SPEED LIMIT sign. Textures are shared per number (freed by disposeRoadside). */
export function speedLimitSign(mph: number): THREE.Group {
  let tex = limitTextures.get(mph);
  if (!tex) {
    tex = canvasTexture(
      96,
      128,
      (g) => {
        g.fillStyle = '#f4f4f0';
        g.fillRect(0, 0, 96, 128);
        g.strokeStyle = '#111';
        g.lineWidth = 4;
        g.strokeRect(5, 5, 86, 118);
        g.fillStyle = '#111';
        g.textAlign = 'center';
        g.font = 'bold 18px system-ui, sans-serif';
        g.fillText('SPEED', 48, 30);
        g.fillText('LIMIT', 48, 50);
        g.font = 'bold 50px system-ui, sans-serif';
        g.fillText(String(mph), 48, 104);
      },
      false,
    );
    limitTextures.set(mph, tex);
  }
  return signOnPosts(tex, 1.5, 2, 1.7, false);
}

/** A green highway sign with a few lines of white text; `right` adds an arrow column for exits. */
export function greenSign(lines: { text: string; right?: string }[], width = 6): THREE.Group {
  const rows = lines.length;
  const h = 0.9 + rows * 0.75;
  const pxW = 512;
  const pxH = Math.round((pxW * h) / width);
  const tex = canvasTexture(pxW, pxH, (g) => {
    g.fillStyle = '#1f6b3a';
    g.fillRect(0, 0, pxW, pxH);
    g.strokeStyle = '#fff';
    g.lineWidth = 6;
    g.strokeRect(8, 8, pxW - 16, pxH - 16);
    g.fillStyle = '#fff';
    g.textBaseline = 'middle';
    const size = Math.min(54, (pxH - 40) / rows - 8);
    g.font = `800 ${size}px system-ui, sans-serif`;
    lines.forEach((l, i) => {
      const y = 20 + (i + 0.5) * ((pxH - 40) / rows);
      g.textAlign = 'left';
      g.fillText(l.text, 30, y, l.right ? pxW - 190 : pxW - 60);
      if (l.right) {
        g.textAlign = 'right';
        g.fillText(l.right, pxW - 30, y);
      }
    });
  });
  return signOnPosts(tex, width, h, 3.4, true);
}

/** Frees the shared sign textures (when the drive view closes). */
export function disposeRoadside(): void {
  for (const t of limitTextures.values()) t.dispose();
  limitTextures.clear();
}

/** A rumble-strip texture: thin dark grooves across the shoulder (the asphalt shows between them). */
export function rumbleTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(
    8,
    32,
    (g) => {
      g.clearRect(0, 0, 8, 32);
      g.fillStyle = 'rgba(20, 20, 22, 0.75)';
      g.fillRect(0, 12, 8, 7);
    },
    false,
  );
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
