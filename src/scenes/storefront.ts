import * as THREE from 'three';
import { lit } from './materials';
import { realTexturesOn } from './textures';
import type { PlaceKind } from '../game/stops';

/**
 * Code-built storefronts: a real building made of walls with real openings, so
 * the door you walk up to is a door in the right place, it swings open, and the
 * room you walk into is the inside of the same building (its walls are the
 * room's walls). The shop's sign is painted on a board made for it, above the
 * awning, so the words are always the right ones in the right spot.
 *
 * Built in the building's own frame like the generated models: standing on
 * y = 0, centred on x and z, facing +z (the street). The room is `w` by `d`;
 * the walls are centred on its edges (like the dollhouse room's walls), so the
 * room's furniture lines up with them.
 *
 * Parts named 'cutaway' are lifted off while you're inside (roof, upper walls,
 * awning, sign), leaving the dollhouse view; everything else stays.
 *
 * Wall photos: Poly Haven (CC0), public/textures/walls/.
 */

export interface Storefront {
  group: THREE.Group;
  /** The room's size (x width, y height to the top of the front, z depth). */
  size: THREE.Vector3;
  /** The front door: across (x), the outside face of the wall (z), the doorstep (y). */
  door: { x: number; z: number; y: number };
  /** The door: a group named 'doorway' holding the swinging 'doorPanel' (hinged on its left). */
  doorway: THREE.Group;
}

/** Which places are built this way. ?shops=old in the address keeps the generated model, to compare. */
const CODE_BUILT: PlaceKind[] = ['grocery'];
export function storefrontFor(place: PlaceKind): boolean {
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('shops') === 'old') return false;
  return CODE_BUILT.includes(place);
}

export const STORE_DOOR_W = 1.3;
export const STORE_DOOR_H = 2.4;
/** Wall thickness. */
const T = 0.3;
/** One photo tile covers this many metres of wall. */
const BRICK_TILE = 1.6;

// ------------------------------------------------------------------ materials (shared by every storefront)

type WallPhoto = 'red_brick_03' | 'painted_plaster_wall';
const photos = new Map<string, THREE.Texture>();
function photo(name: WallPhoto, normal: boolean): THREE.Texture | null {
  if (!realTexturesOn()) return null;
  const key = `${name}${normal ? '_n' : ''}`;
  let t = photos.get(key);
  if (!t) {
    t = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/walls/${key}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = normal ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.userData.shared = true;
    photos.set(key, t);
  }
  return t;
}

/** Wall UVs are in metres; the texture repeats once every `tile` metres. */
function wallMaterial(name: WallPhoto, tile: number, fallback: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const map = photo(name, false)?.clone() ?? null;
  const normalMap = photo(name, true)?.clone() ?? null;
  for (const t of [map, normalMap]) {
    if (!t) continue;
    t.repeat.set(1 / tile, 1 / tile);
    t.needsUpdate = true;
    t.userData.shared = true;
  }
  const m = lit({ color: map ? 0xffffff : fallback, map, normalMap, roughness: 0.92, ...extra });
  m.userData.shared = true;
  return m;
}

interface Mats {
  brick: THREE.MeshStandardMaterial;
  inside: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  paint: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  lamp: THREE.MeshStandardMaterial;
}
const matsByLook = new Map<string, Mats>();
function materials(trim: number, insideColor: number): Mats {
  const key = `${trim}|${insideColor}`;
  let m = matsByLook.get(key);
  if (m) return m;
  const shared = (x: THREE.MeshStandardMaterial) => ((x.userData.shared = true), x);
  m = {
    brick: wallMaterial('red_brick_03', BRICK_TILE, 0x9a4a36),
    inside: wallMaterial('painted_plaster_wall', 2.5, insideColor, { color: insideColor }),
    stone: shared(lit({ color: 0xd9d0bd, roughness: 0.85 })),
    paint: shared(lit({ color: trim, roughness: 0.55 })),
    // Shop glass: a little blue, mostly see-through, so the room inside shows. Glows warm at night.
    glass: shared(lit({ color: 0xbcd6e0, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false, emissive: 0xffc98a, emissiveIntensity: 0 })),
    roof: shared(lit({ color: 0x3a3836, roughness: 1 })),
    metal: shared(lit({ color: 0x2a2c2e, metalness: 0.6, roughness: 0.4 })),
    lamp: shared(lit({ color: 0xfff1c8, emissive: 0xffd48a, emissiveIntensity: 0.2 })),
  };
  matsByLook.set(key, m);
  setStorefrontNight(nightNow);
  return m;
}

const signMats: THREE.MeshStandardMaterial[] = [];
let nightNow = 0;
/** Shop windows glow warm and the sign lamps come on as night falls (0 day to 1 night). */
export function setStorefrontNight(night: number): void {
  nightNow = night;
  for (const m of matsByLook.values()) {
    m.glass.emissiveIntensity = 0.3 * night;
    m.glass.opacity = 0.32 + 0.2 * night;
    m.lamp.emissiveIntensity = 0.2 + 1.6 * night;
  }
  for (const s of signMats) s.emissiveIntensity = 0.12 + 0.55 * night;
}

// ------------------------------------------------------------------ geometry helpers

interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Collects quads (with UVs in metres) into one geometry. */
class Quads {
  pos: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  /** A quad from four corners (counter-clockwise seen from its front), UVs taken from (u, v) per corner. */
  add(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, uv: [number, number][]): void {
    const i = this.pos.length / 3;
    for (const p of [a, b, c, d]) this.pos.push(p.x, p.y, p.z);
    for (const [u, v] of uv) this.uv.push(u, v);
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

/**
 * One band of a wall (from y0 to y1, x from -len/2 to len/2) with rectangular
 * openings cut right through: the outside face at z = +T/2 facing +z, the
 * inside face at z = -T/2 facing -z, the reveals round each opening, and a cap
 * on top. Returns [outside, inside] geometries (the reveals and cap go with
 * the outside, so they take its photo).
 */
function wallBand(len: number, y0: number, y1: number, holes: Rect[], uOffset = 0): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const x0 = -len / 2;
  const x1 = len / 2;
  const hs = holes
    .map((h) => ({ x0: Math.max(x0, h.x0), x1: Math.min(x1, h.x1), y0: Math.max(y0, h.y0), y1: Math.min(y1, h.y1) }))
    .filter((h) => h.x1 > h.x0 && h.y1 > h.y0);
  const xs = [...new Set([x0, x1, ...hs.flatMap((h) => [h.x0, h.x1])])].sort((a, b) => a - b);
  const ys = [...new Set([y0, y1, ...hs.flatMap((h) => [h.y0, h.y1])])].sort((a, b) => a - b);
  const out = new Quads();
  const inn = new Quads();
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  for (let i = 0; i < xs.length - 1; i++)
    for (let j = 0; j < ys.length - 1; j++) {
      const a = xs[i], b = xs[i + 1], c = ys[j], e = ys[j + 1];
      const mx = (a + b) / 2, my = (c + e) / 2;
      if (hs.some((h) => mx > h.x0 && mx < h.x1 && my > h.y0 && my < h.y1)) continue;
      const z = T / 2;
      out.add(V(a, c, z), V(b, c, z), V(b, e, z), V(a, e, z), [[a + uOffset, c], [b + uOffset, c], [b + uOffset, e], [a + uOffset, e]]);
      inn.add(V(b, c, -z), V(a, c, -z), V(a, e, -z), V(b, e, -z), [[-b, c], [-a, c], [-a, e], [-b, e]]);
    }
  // Reveals: the wall's thickness showing round each opening, facing into the opening.
  const z0 = -T / 2, z1 = T / 2;
  for (const h of hs) {
    // Bottom (sill) faces up, top faces down, sides face inward.
    if (h.y0 > y0) out.add(V(h.x0, h.y0, z1), V(h.x1, h.y0, z1), V(h.x1, h.y0, z0), V(h.x0, h.y0, z0), [[h.x0, 0], [h.x1, 0], [h.x1, T], [h.x0, T]]);
    if (h.y1 < y1) out.add(V(h.x0, h.y1, z0), V(h.x1, h.y1, z0), V(h.x1, h.y1, z1), V(h.x0, h.y1, z1), [[h.x0, 0], [h.x1, 0], [h.x1, T], [h.x0, T]]);
    if (h.x0 > x0) out.add(V(h.x0, h.y0, z1), V(h.x0, h.y0, z0), V(h.x0, h.y1, z0), V(h.x0, h.y1, z1), [[0, h.y0], [T, h.y0], [T, h.y1], [0, h.y1]]);
    if (h.x1 < x1) out.add(V(h.x1, h.y0, z0), V(h.x1, h.y0, z1), V(h.x1, h.y1, z1), V(h.x1, h.y1, z0), [[0, h.y0], [T, h.y0], [T, h.y1], [0, h.y1]]);
  }
  // Cap on top (also shows when the band above is lifted off).
  out.add(V(x0, y1, z1), V(x1, y1, z1), V(x1, y1, z0), V(x0, y1, z0), [[x0, 0], [x1, 0], [x1, T], [x0, T]]);
  // Ends, so a wall seen side-on at a corner isn't hollow.
  out.add(V(x0, y0, z0), V(x0, y0, z1), V(x0, y1, z1), V(x0, y1, z0), [[0, y0], [T, y0], [T, y1], [0, y1]]);
  out.add(V(x1, y0, z1), V(x1, y0, z0), V(x1, y1, z0), V(x1, y1, z1), [[0, y0], [T, y0], [T, y1], [0, y1]]);
  return [out.build(), inn.build()];
}

const box = (w: number, h: number, d: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

/** A painted shop sign: cream letters on a coloured board with a thin gold line round it. */
const signCache = new Map<string, THREE.MeshStandardMaterial>();
function signMaterial(text: string, color: string): THREE.MeshStandardMaterial {
  const key = `${text}|${color}`;
  const had = signCache.get(key);
  if (had) return had;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(0, 0, 1024, 256);
  // A little grain, so it reads as a painted board, not a screen.
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(0,0,0,${0.03 + (i % 5) * 0.012})`;
    g.fillRect((i * 389) % 1024, (i * 211) % 256, 30 + (i % 40), 2);
  }
  g.strokeStyle = '#e8c766';
  g.lineWidth = 8;
  g.strokeRect(22, 22, 980, 212);
  g.fillStyle = '#f6efdc';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 150;
  const font = (s: number) => `900 ${s}px Georgia, 'Times New Roman', serif`;
  g.font = font(size);
  while (g.measureText(text).width > 880 && size > 50) g.font = font((size -= 6));
  // A soft shadow under the letters, like raised paint.
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillText(text, 516, 138);
  g.fillStyle = '#f6efdc';
  g.fillText(text, 512, 134);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const m = lit({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.12, roughness: 0.7 });
  m.userData.shared = true;
  signMats.push(m);
  signCache.set(key, m);
  setStorefrontNight(nightNow);
  return m;
}

/** Striped awning canvas. */
function awningTexture(a: string, b: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 16;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? b : a;
    g.fillRect(i * 32, 0, 32, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

const awnings = new Map<string, THREE.MeshStandardMaterial>();
function awningMaterial(c: [string, string], width: number): THREE.MeshStandardMaterial {
  const key = `${c.join()}|${width}`;
  let m = awnings.get(key);
  if (!m) {
    const t = awningTexture(c[0], c[1]);
    t.repeat.set(width / 2.4, 1);
    m = lit({ map: t, side: THREE.DoubleSide, roughness: 0.9 });
    m.userData.shared = true;
    awnings.set(key, m);
  }
  return m;
}

// ------------------------------------------------------------------ the building

export interface StoreLook {
  /** Words on the sign. */
  sign: string;
  /** Board and trim colour (window frames, door). */
  trim: string;
  /** Awning stripes. */
  awning: [string, string];
  /** Inside wall colour. */
  inside: number;
}

export const STORE_LOOKS: Partial<Record<PlaceKind, StoreLook>> = {
  grocery: { sign: 'GROCERY', trim: '#2a5a34', awning: ['#2f6b3a', '#efe6cf'], inside: 0xe9f2d8 },
};

/**
 * A one-storey brick shop with a false front: big display windows either side
 * of a glass door, a striped awning over them, the sign board above, and a
 * cornice on top. `w` by `d` is the room inside.
 */
export function buildStorefront(place: PlaceKind, w: number, d: number): Storefront {
  const look = STORE_LOOKS[place] ?? STORE_LOOKS.grocery!;
  const M = materials(new THREE.Color(look.trim).getHex(), look.inside);
  const g = new THREE.Group();
  g.name = 'storefront';
  const H = 4.6; // roof line (sides and back)
  const HF = 6.3; // top of the false front
  const LOW = 1.0; // front wall kept when inside (below the windows)
  const LOW_SIDE = 2.6; // side and back walls kept when inside
  const doorX = 0;
  const DW = STORE_DOOR_W;
  const DH = STORE_DOOR_H;

  const put = (geo: [THREE.BufferGeometry, THREE.BufferGeometry], x: number, z: number, turn: number, outside: THREE.Material, cut: boolean) => {
    for (const [i, gm] of geo.entries()) {
      const m = new THREE.Mesh(gm, i === 0 ? outside : M.inside);
      m.position.set(x, 0, z);
      m.rotation.y = turn;
      m.castShadow = m.receiveShadow = true;
      if (cut) m.name = 'cutaway';
      g.add(m);
    }
  };

  // The front: door in the middle, a display window either side, a transom over the door.
  const winY0 = 0.75;
  const winY1 = 3.0;
  const front: Rect[] = [
    { x0: doorX - DW / 2, x1: doorX + DW / 2, y0: 0, y1: DH },
    { x0: doorX - DW / 2, x1: doorX + DW / 2, y0: DH + 0.12, y1: winY1 }, // transom
    { x0: -w / 2 + 0.9, x1: doorX - DW / 2 - 0.7, y0: winY0, y1: winY1 },
    { x0: doorX + DW / 2 + 0.7, x1: w / 2 - 0.9, y0: winY0, y1: winY1 },
  ];
  const fw = w + T; // walls are centred on the room's edges
  put(wallBand(fw, 0, LOW, front), 0, d / 2, 0, M.brick, false);
  put(wallBand(fw, LOW, H, front), 0, d / 2, 0, M.brick, true);
  // The false front above the roof: brick on both sides (it's outside either way).
  const [pOut, pIn] = wallBand(fw, H, HF, []);
  put([pOut, pIn], 0, d / 2, 0, M.brick, true);
  (g.children[g.children.length - 1] as THREE.Mesh).material = M.brick;
  // Sides and back.
  const side = d - T; // between the front and back walls
  for (const s of [-1, 1]) {
    put(wallBand(side, 0, LOW_SIDE, []), (s * w) / 2, 0, (s * Math.PI) / 2, M.brick, false);
    put(wallBand(side, LOW_SIDE, H, []), (s * w) / 2, 0, (s * Math.PI) / 2, M.brick, true);
  }
  put(wallBand(fw, 0, LOW_SIDE, [{ x0: -w / 2 + 1.5, x1: -w / 2 + 2.6, y0: 0, y1: 2.2 }]), 0, -d / 2, Math.PI, M.brick, false);
  put(wallBand(fw, LOW_SIDE, H, [{ x0: -w / 2 + 1.5, x1: -w / 2 + 2.6, y0: 0, y1: 2.2 }]), 0, -d / 2, Math.PI, M.brick, true);
  // A plain back door (shut), so the back isn't a blank wall.
  const backDoor = box(1.1, 2.2, 0.06, M.paint);
  backDoor.position.set(w / 2 - 2.05, 1.1, -d / 2);
  g.add(backDoor);

  // Flat roof, tar-dark, just under the wall tops.
  const roof = box(w + T, 0.12, d + T, M.roof);
  roof.position.y = H - 0.08;
  roof.name = 'cutaway';
  roof.receiveShadow = true;
  g.add(roof);
  // Inside ceiling (seen through the windows), white.
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w - T, d - T), M.stone);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = H - 0.16;
  ceiling.name = 'cutaway';
  g.add(ceiling);

  const fz = d / 2 + T / 2; // outside face of the front
  const cut = <O extends THREE.Object3D>(o: O) => ((o.name = 'cutaway'), o);
  // Cornice along the top of the false front, and a stone band under the sign.
  const cornice = cut(box(fw + 0.5, 0.42, 0.55, M.stone));
  cornice.position.set(0, HF + 0.05, fz - 0.12);
  cornice.castShadow = true;
  g.add(cornice);
  const band = cut(box(fw + 0.1, 0.22, 0.14, M.stone));
  band.position.set(0, 3.55, fz + 0.03);
  g.add(band);
  // Stone sills under the display windows, and the frames round the glass.
  for (const r of front.slice(2)) {
    const sill = box(r.x1 - r.x0 + 0.3, 0.12, 0.28, M.stone);
    sill.position.set((r.x0 + r.x1) / 2, r.y0 - 0.02, fz + 0.06);
    g.add(sill);
  }
  for (const [i, r] of front.entries()) {
    if (i === 0) continue; // the door has its own frame
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(r.x1 - r.x0, r.y1 - r.y0), M.glass);
    glass.position.set((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, d / 2 + 0.02);
    glass.renderOrder = 2;
    g.add(cut(glass));
    const f = 0.09;
    const parts: [number, number, number, number][] = [
      [(r.x0 + r.x1) / 2, r.y0 + f / 2, r.x1 - r.x0, f],
      [(r.x0 + r.x1) / 2, r.y1 - f / 2, r.x1 - r.x0, f],
      [r.x0 + f / 2, (r.y0 + r.y1) / 2, f, r.y1 - r.y0],
      [r.x1 - f / 2, (r.y0 + r.y1) / 2, f, r.y1 - r.y0],
    ];
    // Display windows get a middle bar and a bar across near the top.
    if (i >= 2) {
      parts.push([(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, f, r.y1 - r.y0]);
      parts.push([(r.x0 + r.x1) / 2, r.y1 - 0.55, r.x1 - r.x0, f * 0.8]);
    }
    for (const [x, y, pw, ph] of parts) {
      const bar = box(pw, ph, 0.1, M.paint);
      bar.position.set(x, y, d / 2 + 0.04);
      g.add(y > LOW ? cut(bar) : bar);
    }
  }
  // Door frame.
  for (const [x, y, pw, ph] of [
    [doorX - DW / 2 - 0.05, DH / 2, 0.12, DH + 0.1],
    [doorX + DW / 2 + 0.05, DH / 2, 0.12, DH + 0.1],
    [doorX, DH + 0.06, DW + 0.22, 0.12],
  ] as const) {
    const bar = box(pw, ph, 0.34, M.paint);
    bar.position.set(x, y, d / 2 + 0.02);
    g.add(bar);
  }
  // The door: painted frame round a big glass pane, a push bar, hinged on its left.
  const doorway = new THREE.Group();
  doorway.name = 'doorway';
  doorway.position.set(doorX, 0, d / 2 + 0.1);
  const panel = new THREE.Group();
  panel.name = 'doorPanel';
  panel.position.set(-DW / 2, 0, 0);
  const rail = 0.14;
  for (const [x, y, pw, ph] of [
    [DW / 2, rail / 2 + 0.02, DW, rail * 2],
    [DW / 2, DH - rail / 2, DW, rail],
    [rail / 2, DH / 2, rail, DH],
    [DW - rail / 2, DH / 2, rail, DH],
  ] as const) {
    const p = box(pw, ph, 0.06, M.paint);
    p.position.set(x, y, 0);
    p.castShadow = true;
    panel.add(p);
  }
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(DW - rail * 2, DH - rail * 3.5), M.glass);
  pane.position.set(DW / 2, DH / 2 + 0.08, 0);
  panel.add(pane);
  const bar = box(DW * 0.6, 0.05, 0.05, M.metal);
  bar.position.set(DW / 2, 1.05, 0.07);
  panel.add(bar);
  doorway.add(panel);
  g.add(doorway);
  // A concrete step up to the shop floor in front of the door.
  const step = box(DW + 1.2, 0.26, 1.2, M.stone);
  step.position.set(doorX, 0.13, fz + 0.6);
  step.receiveShadow = true;
  g.add(step);

  // Awning over the windows and door: sloped canvas and a valance hanging off its front edge.
  const aw = w - 0.8;
  const reach = 1.5;
  const top = 3.35;
  const drop = 0.6;
  const awMat = awningMaterial(look.awning, aw);
  const slope = Math.hypot(reach, drop);
  const sheet = cut(new THREE.Mesh(new THREE.PlaneGeometry(aw, slope), awMat));
  sheet.rotation.x = -Math.PI / 2 + Math.atan2(drop, reach);
  sheet.position.set(0, top - drop / 2, fz + reach / 2);
  sheet.castShadow = true;
  g.add(sheet);
  const valance = cut(new THREE.Mesh(new THREE.PlaneGeometry(aw, 0.32), awMat));
  valance.position.set(0, top - drop - 0.16, fz + reach);
  g.add(valance);
  for (const s of [-1, 1]) {
    const arm = cut(box(0.04, 0.04, slope, M.metal));
    arm.position.set((s * aw) / 2, top - drop / 2 - 0.03, fz + reach / 2);
    arm.rotation.x = Math.atan2(drop, reach);
    g.add(arm);
  }

  // The sign board, between the awning and the cornice, on a stepped frame, with two lamps over it.
  const sw = Math.min(w * 0.55, 7);
  const sh = sw / 4;
  const sy = (3.66 + (HF - 0.2)) / 2;
  const frame = cut(box(sw + 0.3, sh + 0.3, 0.12, M.paint));
  frame.position.set(0, sy, fz + 0.06);
  g.add(frame);
  const sign = cut(new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), signMaterial(look.sign, look.trim)));
  sign.position.set(0, sy, fz + 0.125);
  g.add(sign);
  for (const s of [-1, 1]) {
    const arm = cut(box(0.05, 0.05, 0.7, M.metal));
    arm.position.set(s * sw * 0.3, sy + sh / 2 + 0.22, fz + 0.38);
    g.add(arm);
    const shade = cut(new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.22, 12, 1, true), M.metal));
    shade.position.set(s * sw * 0.3, sy + sh / 2 + 0.18, fz + 0.72);
    g.add(shade);
    const bulb = cut(new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), M.lamp));
    bulb.position.set(s * sw * 0.3, sy + sh / 2 + 0.1, fz + 0.72);
    g.add(bulb);
  }

  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.name !== 'cutaway' && !m.castShadow) m.receiveShadow = true;
  });
  return {
    group: g,
    size: new THREE.Vector3(w, HF, d),
    door: { x: doorX, z: fz, y: 0 },
    doorway,
  };
}
