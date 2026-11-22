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
 * awning, sign), leaving the dollhouse view; everything else stays. The room
 * (built by the town) shows through the windows of the building you're at.
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

/** Which places are built this way. ?shops=old in the address keeps the generated models, to compare. */
export function storefrontFor(place: PlaceKind): boolean {
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('shops') === 'old') return false;
  return place in STORE_LOOKS;
}

export const STORE_DOOR_W = 1.3;
export const STORE_DOOR_H = 2.4;
/** Wall thickness. */
const T = 0.3;

// ------------------------------------------------------------------ materials (shared by every storefront)

type WallPhoto = 'red_brick_03' | 'painted_plaster_wall' | 'white_planks_clean' | 'corrugated_iron' | 'weathered_brown_planks';
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

/** How a wall looks: a photo, tinted (the photo's colour times `tint`), one tile every `tile` metres, turned a quarter for sideways boards. */
interface WallLook {
  photo: WallPhoto;
  tint: number;
  tile: number;
  turn?: boolean;
  /** The plain colour on Low (no photos). */
  flat: number;
}
const wallMats = new Map<string, THREE.MeshStandardMaterial>();
/** Wall UVs are in metres; the photo repeats once every `tile` metres. */
function wallMaterial(look: WallLook): THREE.MeshStandardMaterial {
  const key = `${look.photo}|${look.tint}|${look.tile}|${!!look.turn}`;
  let m = wallMats.get(key);
  if (m) return m;
  const map = photo(look.photo, false)?.clone() ?? null;
  const normalMap = photo(look.photo, true)?.clone() ?? null;
  for (const t of [map, normalMap]) {
    if (!t) continue;
    t.repeat.set(1 / look.tile, 1 / look.tile);
    if (look.turn) t.rotation = Math.PI / 2;
    t.needsUpdate = true;
    t.userData.shared = true;
  }
  m = lit({ color: map ? look.tint : look.flat, map, normalMap, roughness: 0.92, metalness: look.photo === 'corrugated_iron' ? 0.25 : 0 });
  m.userData.shared = true;
  wallMats.set(key, m);
  return m;
}

const plain = new Map<string, THREE.MeshStandardMaterial>();
/** A plain shared material (paint, stone, glass...), made once per look. */
function shared(key: string, make: () => THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  let m = plain.get(key);
  if (!m) {
    m = make();
    m.userData.shared = true;
    plain.set(key, m);
    setStorefrontNight(nightNow);
  }
  return m;
}
const paintOf = (c: string) => shared(`paint${c}`, () => lit({ color: c, roughness: 0.55 }));
const stone = () => shared('stone', () => lit({ color: 0xd9d0bd, roughness: 0.85 }));
const roofTar = () => shared('roof', () => lit({ color: 0x3a3836, roughness: 1 }));
const metal = () => shared('metal', () => lit({ color: 0x2a2c2e, metalness: 0.6, roughness: 0.4 }));
// Shop glass: a little blue, mostly see-through, so the room inside shows. Glows warm at night.
const glassMat = () => shared('glass', () => lit({ color: 0xbcd6e0, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false, emissive: 0xffc98a, emissiveIntensity: 0 }));
const lampMat = () => shared('lamp', () => lit({ color: 0xfff1c8, emissive: 0xffd48a, emissiveIntensity: 0.2 }));
const glowMat = (c: number) => shared(`glow${c}`, () => lit({ color: c, emissive: c, emissiveIntensity: 0.3 }));

const signMats: THREE.MeshStandardMaterial[] = [];
let nightNow = 0;
/** Shop windows glow warm, and sign lamps, signs and neon come on as night falls (0 day to 1 night). */
export function setStorefrontNight(night: number): void {
  nightNow = night;
  const g = plain.get('glass');
  if (g) {
    g.emissiveIntensity = 0.3 * night;
    g.opacity = 0.32 + 0.2 * night;
  }
  const l = plain.get('lamp');
  if (l) l.emissiveIntensity = 0.2 + 1.6 * night;
  for (const [k, m] of plain) if (k.startsWith('glow')) m.emissiveIntensity = 0.3 + 1.4 * night;
  for (const s of signMats) s.emissiveIntensity = (0.12 + 0.55 * night) * (s.userData.neon ? 2.2 : 1);
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

/** UVs in metres for a flat plane, so wall photos keep their size on doors and panels. */
function plane(w: number, h: number, m: THREE.Material): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(w, h);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
  return new THREE.Mesh(geo, m);
}

/** A painted shop sign: the place's picture and its word on a coloured board with a thin gold line round it. */
const signCache = new Map<string, THREE.MeshStandardMaterial>();
function signMaterial(text: string, icon: string, board: string, ink: string, neon: boolean): THREE.MeshStandardMaterial {
  const key = `${text}|${icon}|${board}|${ink}`;
  const had = signCache.get(key);
  if (had) return had;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = board;
  g.fillRect(0, 0, 1024, 256);
  // A little grain, so it reads as a painted board, not a screen.
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(0,0,0,${0.03 + (i % 5) * 0.012})`;
    g.fillRect((i * 389) % 1024, (i * 211) % 256, 30 + (i % 40), 2);
  }
  g.strokeStyle = neon ? ink : '#e8c766';
  g.lineWidth = 8;
  g.strokeRect(22, 22, 980, 212);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // The picture first (the 5-year-old reads that), then the word.
  g.fillStyle = '#ffffff';
  g.font = `150px 'Noto Color Emoji', 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif`;
  g.fillText(icon, 150, 140);
  let size = 150;
  const font = (n: number) => `900 ${n}px Georgia, 'Times New Roman', serif`;
  g.font = font(size);
  while (g.measureText(text).width > 680 && size > 50) g.font = font((size -= 6));
  const cx = 620;
  // A soft shadow under the letters, like raised paint.
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillText(text, cx + 4, 138);
  g.fillStyle = ink;
  g.fillText(text, cx, 134);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const m = lit({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.12, roughness: 0.7 });
  m.userData.shared = true;
  m.userData.neon = neon;
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
function awningMaterial(a: string, b: string, width: number): THREE.MeshStandardMaterial {
  const key = `${a}|${b}|${width}`;
  let m = awnings.get(key);
  if (!m) {
    const t = awningTexture(a, b);
    t.repeat.set(width / 2.4, 1);
    m = lit({ map: t, side: THREE.DoubleSide, roughness: 0.9 });
    m.userData.shared = true;
    awnings.set(key, m);
  }
  return m;
}

// ------------------------------------------------------------------ the buildings

/** What the front wall is made of: shop windows, an office's windows, garage bays, a row of motel rooms, barn doors, or a shack's door and window. */
type Front = 'shop' | 'office' | 'garage' | 'motel' | 'barn' | 'shack';

export interface StoreLook {
  /** Words on the sign (null: no sign) and the picture beside them. */
  sign: string | null;
  icon: string;
  /** Sign board colour and its letters. */
  board: string;
  ink?: string;
  wall: WallLook;
  /** Window frames, doors and trim. */
  trim: string;
  /** Inside wall colour. */
  inside: number;
  front: Front;
  /** The door you go in by, across the front as a fraction of the width (-0.5 left to 0.5 right, seen from the street). */
  doorX: number;
  door: 'glass' | 'wood';
  /** Wall height, and the top of a false front above the roof (none if 0). */
  height: number;
  falseFront?: number;
  roof: 'flat' | 'gable' | 'tin';
  shade?: { kind: 'stripes'; a: string; b: string } | { kind: 'solid'; color: string } | { kind: 'porch'; color: string };
  /** The sign hangs on the front, or stands up on the roof. */
  signOnRoof?: boolean;
  /** A coloured band right across the top of the front (gas station). */
  fascia?: boolean;
  extra?: 'cross' | 'police' | 'neon';
}

/**
 * Every place you can walk into, each its own kind of building so the 5-year-old can tell them
 * apart: a brick grocery with a green striped awning, a white gas station with a red band, a
 * tin garage with roll-up doors, a wooden hardware store, a weathered supply store with a porch,
 * a white drugstore with a green cross, a sandstone police station with blue lamps, a rusty
 * junkyard shack, a red barn and a pink motel with a glowing sign.
 */
export const STORE_LOOKS: Partial<Record<PlaceKind, StoreLook>> = {
  grocery: {
    sign: 'GROCERY', icon: '🍎', board: '#2a5a34', wall: { photo: 'red_brick_03', tint: 0xffffff, tile: 1.6, flat: 0x9a4a36 }, trim: '#2a5a34', inside: 0xe9f2d8,
    front: 'shop', doorX: 0, door: 'glass', height: 4.6, falseFront: 6.3, roof: 'flat', shade: { kind: 'stripes', a: '#2f6b3a', b: '#efe6cf' },
  },
  pumps: {
    sign: 'GAS', icon: '⛽', board: '#c8302a', wall: { photo: 'painted_plaster_wall', tint: 0xf6f2ea, tile: 2.5, flat: 0xf0ece4 }, trim: '#a8261f', inside: 0xf1ebdc,
    front: 'shop', doorX: -0.2, door: 'glass', height: 5.0, roof: 'flat', fascia: true,
  },
  garage: {
    sign: 'GARAGE', icon: '🔧', board: '#2f5f9f', wall: { photo: 'corrugated_iron', tint: 0xc4d0dc, tile: 2, flat: 0xb8c4d0 }, trim: '#2f5f9f', inside: 0xc9ccd1,
    front: 'garage', doorX: 0.32, door: 'wood', height: 5.6, roof: 'flat',
  },
  hardware: {
    sign: 'HARDWARE', icon: '🔨', board: '#9a4a22', wall: { photo: 'white_planks_clean', tint: 0xeadfc4, tile: 1.4, turn: true, flat: 0xe0d4b8 }, trim: '#7a3a1a', inside: 0xe0cba6,
    front: 'shop', doorX: -0.16, door: 'glass', height: 4.6, falseFront: 6.2, roof: 'flat', shade: { kind: 'stripes', a: '#c8642a', b: '#f2e8d2' },
  },
  gunshop: {
    sign: 'SUPPLY', icon: '🎯', board: '#5a4632', wall: { photo: 'weathered_brown_planks', tint: 0xffffff, tile: 2.2, flat: 0x6e5440 }, trim: '#3e2c1e', inside: 0xb39a7a,
    front: 'office', doorX: 0.1, door: 'wood', height: 4.4, falseFront: 6.0, roof: 'flat', shade: { kind: 'porch', color: '#6b4a2a' },
  },
  pharmacy: {
    sign: 'PHARMACY', icon: '💊', board: '#1f7a6a', wall: { photo: 'painted_plaster_wall', tint: 0xf8f8f4, tile: 2.5, flat: 0xf2f2ee }, trim: '#1f6a5a', inside: 0xe4f0ee,
    front: 'shop', doorX: 0, door: 'glass', height: 5.4, roof: 'flat', shade: { kind: 'solid', color: '#1f8a7a' }, extra: 'cross',
  },
  police: {
    sign: 'POLICE', icon: '🚓', board: '#1f3f7a', wall: { photo: 'painted_plaster_wall', tint: 0xdcc9a4, tile: 2.5, flat: 0xd4c09a }, trim: '#1f3f7a', inside: 0xc8cfe0,
    front: 'office', doorX: 0, door: 'wood', height: 5.4, roof: 'flat', extra: 'police',
  },
  junkyard: {
    sign: 'JUNKYARD', icon: '♻️', board: '#ece4cc', ink: '#3a2a1a', wall: { photo: 'corrugated_iron', tint: 0xb48a68, tile: 2, flat: 0x9a6a4a }, trim: '#5a4a32', inside: 0x9a8a72,
    front: 'shack', doorX: 0, door: 'wood', height: 3.8, roof: 'tin', signOnRoof: true,
  },
  barn: {
    sign: null, icon: '🌾', board: '#a8322a', wall: { photo: 'white_planks_clean', tint: 0xb0382c, tile: 1.4, flat: 0xa8322a }, trim: '#ddd6c8', inside: 0xb04a3a,
    front: 'barn', doorX: 0, door: 'wood', height: 4.2, roof: 'gable',
  },
  motel: {
    sign: 'MOTEL', icon: '🛏️', board: '#2a1838', ink: '#ff7ad9', wall: { photo: 'white_planks_clean', tint: 0xf4e4ea, tile: 1.4, turn: true, flat: 0xf0dce4 }, trim: '#8e3fa0', inside: 0xf2d6e4,
    front: 'motel', doorX: 0, door: 'wood', height: 3.8, roof: 'flat', shade: { kind: 'porch', color: '#efe4ef' }, signOnRoof: true, extra: 'neon',
  },
};

/**
 * Builds a place's building. `w` by `d` is the room inside; the walls stand
 * on its edges. Parts named 'cutaway' come off while you're inside.
 */
export function buildStorefront(place: PlaceKind, w: number, d: number): Storefront {
  const look = STORE_LOOKS[place] ?? STORE_LOOKS.grocery!;
  const wallM = wallMaterial(look.wall);
  const insideM = wallMaterial({ photo: 'painted_plaster_wall', tint: look.inside, tile: 2.5, flat: look.inside });
  const paint = paintOf(look.trim);
  const g = new THREE.Group();
  g.name = 'storefront';
  const H = look.height;
  const HF = look.falseFront ?? 0;
  const LOW = 1.0; // front wall kept when inside (below the windows)
  const LOW_SIDE = Math.min(2.6, H - 0.4); // side and back walls kept when inside
  const DH = look.front === 'barn' ? 3.3 : STORE_DOOR_H;
  const DW = look.front === 'barn' ? 1.8 : STORE_DOOR_W;
  // The barn's way in is the left half of its big double door.
  const doorX = look.front === 'barn' ? -DW / 2 : Math.max(-w / 2 + 1.6, Math.min(w / 2 - 1.6, look.doorX * w));
  const fz = d / 2 + T / 2; // outside face of the front
  const cut = <O extends THREE.Object3D>(o: O) => ((o.name = 'cutaway'), o);
  const add = <O extends THREE.Object3D>(o: O, x: number, y: number, z: number, cutaway = false) => {
    o.position.set(x, y, z);
    if (cutaway) cut(o);
    g.add(o);
    return o;
  };

  const put = (geo: [THREE.BufferGeometry, THREE.BufferGeometry], x: number, z: number, turn: number, outside: THREE.Material, cutaway: boolean, inside: THREE.Material = insideM) => {
    for (const [i, gm] of geo.entries()) {
      const m = new THREE.Mesh(gm, i === 0 ? outside : inside);
      m.position.set(x, 0, z);
      m.rotation.y = turn;
      m.castShadow = m.receiveShadow = true;
      if (cutaway) m.name = 'cutaway';
      g.add(m);
    }
  };

  // ---- Openings in the front: the door, then what this kind of building has.
  const door: Rect = { x0: doorX - DW / 2, x1: doorX + DW / 2, y0: 0, y1: DH };
  if (look.front === 'barn') door.x1 = doorX + DW * 1.5; // both leaves
  const windows: Rect[] = [];
  /** Shut doors and panels that fill an opening (roll-up doors, the other motel rooms, the barn's right leaf). */
  const fills: { r: Rect; kind: 'rollup' | 'door' | 'barn' }[] = [];
  const left = { a: -w / 2 + 0.9, b: door.x0 - 0.7 };
  const right = { a: door.x1 + 0.7, b: w / 2 - 0.9 };
  const spread = (a: number, b: number, ww: number, y0: number, y1: number, gap = 1.2) => {
    const n = Math.floor((b - a + gap) / (ww + gap));
    if (n < 1) return;
    const used = n * ww + (n - 1) * gap;
    for (let i = 0; i < n; i++) {
      const x0 = a + (b - a - used) / 2 + i * (ww + gap);
      windows.push({ x0, x1: x0 + ww, y0, y1 });
    }
  };
  if (look.front !== 'barn' && look.front !== 'motel' && look.front !== 'garage') windows.push({ x0: door.x0, x1: door.x1, y0: DH + 0.12, y1: 3.0 }); // transom
  if (look.front === 'shop') {
    for (const s of [left, right]) if (s.b - s.a > 1.2) windows.push({ x0: s.a, x1: s.b, y0: 0.75, y1: 3.0 });
  } else if (look.front === 'office') {
    for (const s of [left, right]) spread(s.a, s.b, 1.3, 1.0, 2.7);
  } else if (look.front === 'shack') {
    for (const s of [left, right]) spread(s.a, Math.min(s.b, s.a + 3), 1.4, 1.1, 2.2);
  } else if (look.front === 'garage') {
    // Two roll-up bays on the far side of the person door.
    const a = -w / 2 + 0.8;
    const b = door.x0 - 0.9;
    const bw = Math.min(3.4, (b - a - 0.6) / 2);
    for (let i = 0; i < 2; i++) {
      const x0 = a + i * (bw + 0.6);
      fills.push({ r: { x0, x1: x0 + bw, y0: 0, y1: 3.4 }, kind: 'rollup' });
    }
    windows.push({ x0: door.x1 + 0.5, x1: Math.min(w / 2 - 0.5, door.x1 + 1.9), y0: 1.1, y1: 2.4 });
  } else if (look.front === 'motel') {
    // A row of room doors, each with a window: the middle one is yours.
    for (let k = -3; k <= 3; k++) {
      const x = doorX + k * 3.6;
      if (Math.abs(x) > w / 2 - 2.6) continue;
      if (k !== 0) fills.push({ r: { x0: x - DW / 2, x1: x + DW / 2, y0: 0, y1: DH }, kind: 'door' });
      windows.push({ x0: x + DW / 2 + 0.4, x1: x + DW / 2 + 1.6, y0: 1.0, y1: 2.2 });
    }
  } else if (look.front === 'barn') {
    fills.push({ r: { x0: doorX + DW / 2, x1: door.x1, y0: 0, y1: DH }, kind: 'barn' });
  }
  const holes = [door, ...windows, ...fills.map((f) => f.r)];

  // ---- Walls. Front, then sides and back, each in a low band (kept inside) and the rest (lifted off).
  const fw = w + T; // walls are centred on the room's edges
  put(wallBand(fw, 0, LOW, holes), 0, d / 2, 0, wallM, false);
  put(wallBand(fw, LOW, H, holes), 0, d / 2, 0, wallM, true);
  if (HF > H) put(wallBand(fw, H, HF, []), 0, d / 2, 0, wallM, true, wallM);
  const side = d - T;
  // A window in each side wall, 0.3 m in front of the middle (where the room's light falls).
  const sideWin = (s: number): Rect[] => (look.front === 'barn' || look.front === 'garage' ? [] : [{ x0: -0.3 * s - 0.8, x1: -0.3 * s + 0.8, y0: 1.05, y1: 2.05 }]);
  for (const s of [-1, 1]) {
    put(wallBand(side, 0, LOW_SIDE, sideWin(s)), (s * w) / 2, 0, (s * Math.PI) / 2, wallM, false);
    put(wallBand(side, LOW_SIDE, H, sideWin(s)), (s * w) / 2, 0, (s * Math.PI) / 2, wallM, true);
  }
  const backDoor: Rect = { x0: -w / 2 + 1.5, x1: -w / 2 + 2.6, y0: 0, y1: 2.2 };
  put(wallBand(fw, 0, LOW_SIDE, [backDoor]), 0, -d / 2, Math.PI, wallM, false);
  put(wallBand(fw, LOW_SIDE, H, [backDoor]), 0, -d / 2, Math.PI, wallM, true);
  add(box(1.1, 2.2, 0.06, paint), w / 2 - 2.05, 1.1, -d / 2);
  // Glass in the side windows (the room's own window pictures sit just inside).
  for (const s of [-1, 1]) for (const r of sideWin(s)) {
    const z = (-(r.x0 + r.x1) / 2) * s;
    const pane = cut(plane(r.x1 - r.x0, r.y1 - r.y0, glassMat()));
    pane.rotation.y = (s * Math.PI) / 2;
    add(pane, s * (w / 2 + 0.02), (r.y0 + r.y1) / 2, z);
    for (const [y, hh, zz, ll] of [[r.y0, 0.1, z, 1.75], [r.y1, 0.1, z, 1.75], [(r.y0 + r.y1) / 2, 1.1, z - 0.82, 0.1], [(r.y0 + r.y1) / 2, 1.1, z + 0.82, 0.1]] as const)
      add(box(0.1, hh, ll, paint), s * (w / 2 + 0.17), y, zz, y > LOW_SIDE || hh > 1);
  }

  // ---- Roof.
  if (look.roof === 'gable') {
    const rise = w * 0.32;
    for (const z of [d / 2, -d / 2]) {
      const [o, i] = gableBand(fw, H, rise);
      put([o, i], 0, z, z > 0 ? 0 : Math.PI, wallM, true);
    }
    const tin = wallMaterial({ photo: 'corrugated_iron', tint: 0x5c6268, tile: 1.6, flat: 0x50565c });
    const half = Math.hypot(w / 2 + 0.6, rise + 0.3);
    for (const s of [-1, 1]) {
      const sheet = cut(box(half, 0.1, d + T + 0.8, tin));
      sheet.rotation.z = -s * Math.atan2(rise + 0.3, w / 2 + 0.6);
      add(sheet, (s * (w / 2 + 0.6)) / 2, H - 0.3 + (rise + 0.3) / 2 + 0.05, 0, true);
      sheet.castShadow = true;
    }
    // White trim round the barn doors and a hayloft door up in the gable.
    const white = paint;
    add(box(0.9, 1.1, 0.06, paintOf('#7a2a22')), 0, H + rise * 0.35, fz + 0.02, true);
    for (const [x, y, ww, hh] of [[0, H + rise * 0.35 + 0.6, 1.1, 0.1], [0, H + rise * 0.35 - 0.6, 1.1, 0.1], [-0.5, H + rise * 0.35, 0.1, 1.3], [0.5, H + rise * 0.35, 0.1, 1.3]] as const)
      add(box(ww, hh, 0.08, white), x, y, fz + 0.04, true);
  } else {
    const over = look.roof === 'tin' ? 0.6 : 0;
    const roofM = look.roof === 'tin' ? wallMaterial({ photo: 'corrugated_iron', tint: 0x8a7a6a, tile: 1.6, flat: 0x7a6a5a }) : roofTar();
    const roof = add(box(w + T + over * 2, 0.12, d + T + over * 2, roofM), 0, H - 0.08 + (over ? 0.14 : 0), 0, true);
    roof.receiveShadow = roof.castShadow = true;
    // A cornice along the top of the front (or of the false front).
    if (!over) {
      const top = HF > H ? HF : H;
      add(box(fw + 0.5, 0.36, 0.5, look.fascia ? paint : stone()), 0, top + 0.05, fz - 0.1, true).castShadow = true;
    }
  }
  // Inside ceiling (seen through the windows), white.
  const ceiling = cut(new THREE.Mesh(new THREE.PlaneGeometry(w - T, d - T), stone()));
  ceiling.rotation.x = Math.PI / 2;
  add(ceiling, 0, H - 0.16, 0, true);

  // ---- Windows: glass and painted frames; display windows get a middle bar and one across the top.
  for (const r of windows) {
    const glass = plane(r.x1 - r.x0, r.y1 - r.y0, glassMat());
    glass.renderOrder = 2;
    add(glass, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, d / 2 + 0.02, true);
    const f = 0.09;
    const parts: [number, number, number, number][] = [
      [(r.x0 + r.x1) / 2, r.y0 + f / 2, r.x1 - r.x0, f],
      [(r.x0 + r.x1) / 2, r.y1 - f / 2, r.x1 - r.x0, f],
      [r.x0 + f / 2, (r.y0 + r.y1) / 2, f, r.y1 - r.y0],
      [r.x1 - f / 2, (r.y0 + r.y1) / 2, f, r.y1 - r.y0],
    ];
    if (r.x1 - r.x0 > 2) {
      parts.push([(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, f, r.y1 - r.y0]);
      parts.push([(r.x0 + r.x1) / 2, r.y1 - 0.55, r.x1 - r.x0, f * 0.8]);
    } else if (r.y1 - r.y0 > 1) parts.push([(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, r.x1 - r.x0, f * 0.8]);
    for (const [x, y, pw, ph] of parts) add(box(pw, ph, 0.1, paint), x, y, d / 2 + 0.04, y > LOW);
    if (r.y0 > 0.5) add(box(r.x1 - r.x0 + 0.3, 0.12, 0.28, look.front === 'shop' ? stone() : paint), (r.x0 + r.x1) / 2, r.y0 - 0.02, fz + 0.06, r.y0 > LOW);
  }

  // ---- Shut doors and panels, in a low part (kept) and the rest (lifted off), so the dollhouse view stays open.
  const rollM = wallMaterial({ photo: 'corrugated_iron', tint: 0xe4e8ea, tile: 1.2, turn: true, flat: 0xd8dcde });
  // Barn doors are boards the colour of the barn; other shut doors are painted the trim colour.
  const woodC = look.front === 'barn' ? look.wall.tint : new THREE.Color(look.trim).getHex();
  const woodM = wallMaterial({ photo: 'white_planks_clean', tint: woodC, tile: 1.4, flat: woodC });
  for (const f of fills) {
    const { r } = f;
    const m = f.kind === 'rollup' ? rollM : f.kind === 'barn' ? woodM : paint;
    for (const [y0, y1, c] of [[r.y0, LOW, false], [LOW, r.y1, true]] as const) {
      const p = plane(r.x1 - r.x0, y1 - y0, m);
      add(p, (r.x0 + r.x1) / 2, (y0 + y1) / 2, d / 2 + 0.05, c);
    }
    if (f.kind === 'door') add(box(0.08, 0.08, 0.08, metal()), r.x1 - 0.2, 1.1, d / 2 + 0.1);
    if (f.kind === 'barn') barnX(g, r, d / 2 + 0.08, paintOf('#ddd6c8'), LOW);
    if (f.kind === 'rollup') add(box(r.x1 - r.x0 + 0.3, 0.3, 0.3, paint), (r.x0 + r.x1) / 2, r.y1 + 0.15, fz, true);
  }
  // Room numbers over the motel doors.
  if (look.front === 'motel') {
    let n = 1;
    for (const x of [...fills.map((f) => (f.r.x0 + f.r.x1) / 2), doorX].sort((a, b) => a - b)) {
      add(numberPlate(n++), x, DH + 0.3, d / 2 + 0.1, true);
    }
  }

  // ---- The door you go in by, in its frame, hinged on its left.
  for (const [x, y, pw, ph] of [
    [door.x0 - 0.05, DH / 2, 0.12, DH + 0.1],
    [door.x1 + 0.05, DH / 2, 0.12, DH + 0.1],
    [(door.x0 + door.x1) / 2, DH + 0.06, door.x1 - door.x0 + 0.22, 0.12],
  ] as const)
    add(box(pw, ph, 0.34, paint), x, y, d / 2 + 0.02, y > DH);
  const doorway = new THREE.Group();
  doorway.name = 'doorway';
  doorway.position.set(doorX, 0, d / 2 + 0.1);
  const panel = new THREE.Group();
  panel.name = 'doorPanel';
  panel.position.set(-DW / 2, 0, 0);
  if (look.front === 'barn') {
    panel.add(plane(DW, DH, woodM).translateX(DW / 2).translateY(DH / 2));
    barnX(panel, { x0: 0, x1: DW, y0: 0, y1: DH }, 0.03, paintOf('#ddd6c8'), -1);
  } else if (look.door === 'glass') {
    const rail = 0.14;
    for (const [x, y, pw, ph] of [
      [DW / 2, rail / 2 + 0.02, DW, rail * 2],
      [DW / 2, DH - rail / 2, DW, rail],
      [rail / 2, DH / 2, rail, DH],
      [DW - rail / 2, DH / 2, rail, DH],
    ] as const)
      panel.add(box(pw, ph, 0.06, paint).translateX(x).translateY(y));
    panel.add(new THREE.Mesh(new THREE.PlaneGeometry(DW - rail * 2, DH - rail * 3.5), glassMat()).translateX(DW / 2).translateY(DH / 2 + 0.08));
    panel.add(box(DW * 0.6, 0.05, 0.05, metal()).translateX(DW / 2).translateY(1.05).translateZ(0.07));
  } else {
    // A painted wooden door with a little window up top and a brass knob.
    panel.add(box(DW, DH, 0.06, paint).translateX(DW / 2).translateY(DH / 2));
    panel.add(new THREE.Mesh(new THREE.PlaneGeometry(DW * 0.55, 0.5), glassMat()).translateX(DW / 2).translateY(DH - 0.55).translateZ(0.035));
    panel.add(box(0.1, 0.1, 0.12, shared('brass', () => lit({ color: 0xd8b04a, metalness: 0.6, roughness: 0.3 }))).translateX(DW - 0.18).translateY(1.05).translateZ(0.05));
  }
  panel.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  doorway.add(panel);
  g.add(doorway);
  // A concrete step up to the floor in front of the door.
  add(box(door.x1 - door.x0 + 1.2, 0.26, 1.2, stone()), (door.x0 + door.x1) / 2, 0.13, fz + 0.6).receiveShadow = true;

  // ---- Shade over the front: a striped or plain awning, or a wooden porch roof on posts.
  // Where the sign may start: above the awning (or the garage's roll-up doors).
  let shadeTop = look.front === 'garage' ? 3.8 : 3.35;
  if (look.shade) {
    const porch = look.shade.kind === 'porch';
    const aw = w - (porch ? 0.2 : 0.8);
    const reach = porch ? 2.4 : 1.5;
    const top = porch ? Math.min(H - 0.35, 3.4) : 3.35;
    const drop = porch ? 0.35 : 0.6;
    shadeTop = top;
    const m = look.shade.kind === 'stripes' ? awningMaterial(look.shade.a, look.shade.b, aw) : shared(`shade${look.shade.color}`, () => lit({ color: (look.shade as { color: string }).color, side: THREE.DoubleSide, roughness: 0.85 }));
    const slope = Math.hypot(reach, drop);
    const sheet = cut(new THREE.Mesh(porch ? new THREE.BoxGeometry(aw, slope, 0.12) : new THREE.PlaneGeometry(aw, slope), m));
    sheet.rotation.x = -Math.PI / 2 + Math.atan2(drop, reach);
    sheet.castShadow = true;
    add(sheet, 0, top - drop / 2, fz + reach / 2, true);
    if (porch) {
      // Posts down to the ground along the front edge, clear of the doors.
      const xs: number[] = [];
      for (let x = -aw / 2 + 0.2; x <= aw / 2 - 0.1; x += 3.6) xs.push(x);
      xs.push(aw / 2 - 0.2);
      for (const x of xs) {
        if (Math.abs(x - doorX) < 1.2) continue;
        add(box(0.18, top - drop, 0.18, m), x, (top - drop) / 2, fz + reach - 0.15, true).castShadow = true;
      }
      add(box(aw, 0.22, 0.16, m), 0, top - drop - 0.1, fz + reach - 0.1, true);
    } else {
      add(new THREE.Mesh(new THREE.PlaneGeometry(aw, 0.32), m), 0, top - drop - 0.16, fz + reach, true);
      for (const s of [-1, 1]) {
        const arm = add(box(0.04, 0.04, slope, metal()), (s * aw) / 2, top - drop / 2 - 0.03, fz + reach / 2, true);
        arm.rotation.x = Math.atan2(drop, reach);
      }
    }
  }
  if (look.fascia) {
    // A band of the place's colour right across the top of the front.
    add(box(fw + 0.2, H - 3.3, 0.16, paint), 0, (3.3 + H) / 2, fz + 0.08, true);
    shadeTop = 3.3;
  }

  // ---- The sign: on the front between the shade and the top, or standing on the roof.
  if (look.sign) {
    const top = HF > H ? HF - 0.2 : H - 0.15;
    let sw: number;
    let sy: number;
    let sz = fz + 0.125;
    if (look.signOnRoof) {
      sw = Math.min(w * 0.5, 7);
      sy = H + 0.5 + sw / 8;
      sz = fz - 1.2;
      for (const s of [-1, 1]) add(box(0.14, sw / 8 + 0.6, 0.14, metal()), s * sw * 0.35, H + (sw / 8 + 0.6) / 2, sz - 0.1, true);
    } else {
      if (look.fascia) {
        // On the coloured band.
        sw = Math.min(w * 0.5, (H - 3.3 - 0.2) * 4);
        sy = (3.3 + H) / 2;
        sz = fz + 0.23;
      } else {
        const room = top - (shadeTop + 0.25);
        sw = Math.min(w * 0.55, 7, room * 4);
        sy = (shadeTop + 0.25 + top) / 2;
      }
    }
    const sh = sw / 4;
    add(box(sw + 0.3, sh + 0.3, 0.12, paint), 0, sy, sz - 0.065, true);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), signMaterial(look.sign, look.icon, look.board, look.ink ?? '#f6efdc', look.extra === 'neon'));
    add(face, 0, sy, sz, true);
    if (look.signOnRoof) {
      const back = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), paint);
      back.rotation.y = Math.PI;
      add(back, 0, sy, sz - 0.13, true);
    } else if (!look.fascia) {
      // Two lamps on arms over the sign.
      for (const s of [-1, 1]) {
        add(box(0.05, 0.05, 0.7, metal()), s * sw * 0.3, sy + sh / 2 + 0.22, sz + 0.25, true);
        add(new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.22, 12, 1, true), metal()), s * sw * 0.3, sy + sh / 2 + 0.18, sz + 0.6, true);
        add(new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), lampMat()), s * sw * 0.3, sy + sh / 2 + 0.1, sz + 0.6, true);
      }
    }
  }

  // ---- Extras a kid can name.
  if (look.extra === 'cross') {
    // A green cross on a bracket, sticking out from the corner so it shows from up the street.
    const green = glowMat(0x2fbf6a);
    const x = w / 2 - 0.4;
    add(box(0.06, 0.06, 0.9, metal()), x, 3.9, fz + 0.45, true);
    const cross = new THREE.Group();
    cross.add(box(0.12, 1.1, 0.36, green));
    cross.add(box(0.12, 0.36, 1.1, green));
    add(cross, x, 3.9, fz + 1.0, true);
  } else if (look.extra === 'police') {
    // Blue lamps either side of the door, and a flag on a pole by the corner.
    for (const s of [-1, 1]) {
      add(box(0.12, 0.12, 0.3, metal()), doorX + s * (DW / 2 + 0.45), 2.3, fz + 0.12);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), glowMat(0x3f7fff)), doorX + s * (DW / 2 + 0.45), 2.3, fz + 0.32);
    }
    const px = -w / 2 + 0.6;
    add(box(0.12, 7.2, 0.12, shared('pole', () => lit({ color: 0xc0c4c8, metalness: 0.6, roughness: 0.4 }))), px, 3.6, fz + 3.2);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), shared('brass', () => lit({ color: 0xd8b04a, metalness: 0.6, roughness: 0.3 }))), px, 7.25, fz + 3.2);
    add(new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), flagMaterial()), px + 0.86, 6.55, fz + 3.2);
  }

  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !m.castShadow) m.receiveShadow = true;
  });
  return {
    group: g,
    size: new THREE.Vector3(w, Math.max(H, HF), d),
    door: { x: doorX, z: fz, y: 0 },
    doorway,
  };
}

/** The gable end of a wall: a triangle from y0 up to the ridge, outside and inside faces plus the sloped tops. */
function gableBand(len: number, y0: number, rise: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const out = new Quads();
  const inn = new Quads();
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const a = -len / 2, b = len / 2, z = T / 2;
  // Triangles as quads with a doubled corner.
  out.add(V(a, y0, z), V(b, y0, z), V(0, y0 + rise, z), V(0, y0 + rise, z), [[a, y0], [b, y0], [0, y0 + rise], [0, y0 + rise]]);
  inn.add(V(b, y0, -z), V(a, y0, -z), V(0, y0 + rise, -z), V(0, y0 + rise, -z), [[-b, y0], [-a, y0], [0, y0 + rise], [0, y0 + rise]]);
  return [out.build(), inn.build()];
}

/** The white X-and-frame trim on a barn door leaf. */
function barnX(to: THREE.Object3D, r: Rect, z: number, white: THREE.Material, low: number): void {
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  const cx = (r.x0 + r.x1) / 2;
  const cy = (r.y0 + r.y1) / 2;
  const t = 0.14;
  const bits: THREE.Mesh[] = [];
  for (const [x, y, bw, bh] of [[cx, r.y0 + t / 2, w, t], [cx, r.y1 - t / 2, w, t], [r.x0 + t / 2, cy, t, h], [r.x1 - t / 2, cy, t, h]] as const) {
    const m = box(bw, bh, 0.05, white);
    m.position.set(x, y, z);
    bits.push(m);
  }
  const len = Math.hypot(w, h) - t * 2;
  for (const s of [-1, 1]) {
    const m = box(t, len, 0.05, white);
    m.position.set(cx, cy, z);
    m.rotation.z = s * Math.atan2(w, h);
    bits.push(m);
  }
  for (const m of bits) {
    // On a wall (low >= 0), the parts above the kept low band come off inside.
    if (low >= 0 && m.position.y > low) m.name = 'cutaway';
    to.add(m);
  }
}

const numbers = new Map<number, THREE.MeshStandardMaterial>();
/** A small brass room number for a motel door. */
function numberPlate(n: number): THREE.Mesh {
  let m = numbers.get(n);
  if (!m) {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#d8b04a';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#3a2a10';
    g.font = '900 46px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), 32, 36);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    m = lit({ map: t, roughness: 0.4, metalness: 0.3 });
    m.userData.shared = true;
    numbers.set(n, m);
  }
  return new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), m);
}

let flagMat: THREE.MeshStandardMaterial | null = null;
/** A flag: red and white stripes with a blue corner. */
function flagMaterial(): THREE.MeshStandardMaterial {
  if (flagMat) return flagMat;
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 64;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 7; i++) {
    g.fillStyle = i % 2 ? '#ffffff' : '#c8202a';
    g.fillRect(0, i * (64 / 7), 96, 64 / 7 + 1);
  }
  g.fillStyle = '#1f3f8f';
  g.fillRect(0, 0, 42, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  flagMat = lit({ map: t, side: THREE.DoubleSide, roughness: 0.8 });
  flagMat.userData.shared = true;
  return flagMat;
}
