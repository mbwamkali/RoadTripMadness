// PROTOTYPE (not wired into the game): a town stop you drive into, park at,
// get out of and walk around, in the same 3D look as the road. Opened from
// town-proto.html. See docs/proto-town.md for what it is testing.
import * as THREE from 'three';
import { Atmosphere } from '../scenes/atmosphere';
import { makeCar } from '../scenes/common';
import { loadModels, modelMesh, type ModelName } from '../scenes/models';
import { quality } from '../scenes/quality';
import { emojiSprite, makeWalker, makeZombie, LOOT_ICONS } from '../scenes/scavengeScene';
import type { PlaceKind } from '../game/stops';

type Loot = keyof typeof LOOT_ICONS;
const params = new URLSearchParams(location.search);
const KID = params.get('kid') === '1';
const HOUR = +(params.get('hour') ?? 10);
if (params.get('q')) (quality as { level: string }).level = params.get('q')!;
const PLACES = (params.get('places')?.split(',') ?? ['pumps', 'motel', 'grocery', 'garage']) as PlaceKind[];

// ------------------------------------------------------------------ helpers
const lam = (c: number, e = 0) => new THREE.MeshLambertMaterial({ color: c, emissive: e });
const GLASS = new THREE.MeshLambertMaterial({ color: 0x9fd4ee, transparent: true, opacity: 0.28, depthWrite: false });
function box(p: THREE.Object3D, w: number, h: number, d: number, c: number | THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof c === 'number' ? lam(c) : c);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  p.add(m);
  return m;
}
function cyl(p: THREE.Object3D, rt: number, rb: number, h: number, c: number, x: number, y: number, z: number, seg = 12): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), lam(c));
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  p.add(m);
  return m;
}
function flat(p: THREE.Object3D, w: number, d: number, c: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lam(c));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  p.add(m);
  return m;
}
function model(name: ModelName): THREE.Mesh | null {
  const m = modelMesh(name);
  if (m) m.castShadow = m.receiveShadow = true;
  return m;
}

/** A big roadside sign: picture first, one word under it. Faces the camera. */
function signSprite(emoji: string, word: string, bg: string, w = 7): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 448;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.strokeStyle = '#fff';
  g.lineWidth = 18;
  g.beginPath();
  g.roundRect(12, 12, 488, 424, 48);
  g.fill();
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '230px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  g.fillText(emoji, 256, 175);
  g.fillStyle = '#fff';
  g.font = 'bold 92px system-ui, sans-serif';
  g.fillText(word, 256, 365);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t }));
  s.scale.set(w, (w * 448) / 512, 1);
  return s;
}

/** Text painted on a wall (a plane, not a sprite). */
function wallText(text: string, bg: string, fg = '#fff', w = 6, h = 1.4): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = Math.round((512 * h) / w);
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.round(c.height * 0.7)}px system-ui, sans-serif`;
  g.fillText(text, 256, c.height / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: t }));
}

// ------------------------------------------------------------------ places
interface Crate {
  mesh: THREE.Group;
  open: boolean;
  loot: [Loot, number];
}
interface Place {
  kind: PlaceKind;
  side: 1 | -1;
  z: number;
  group: THREE.Group;
  /** Walk targets in world space. */
  door: THREE.Vector3;
  inside: THREE.Vector3;
  camPos: THREE.Vector3;
  camLook: THREE.Vector3;
  park: THREE.Vector3[];
  footprint: THREE.Box3;
  crates: Crate[];
  pump?: THREE.Vector3;
  doorMesh?: THREE.Mesh;
  light: THREE.PointLight;
  cut: THREE.Object3D[];
}

const SIGNS: Record<PlaceKind, [string, string, string]> = {
  pumps: ['⛽', 'GAS', '#d13b2c'],
  motel: ['🛏️', 'MOTEL', '#a04d8f'],
  grocery: ['🍎', 'FOOD', '#3f8a4a'],
  garage: ['🔧', 'FIX CAR', '#2f5f9f'],
  hardware: ['🔨', 'TOOLS', '#b8742c'],
  pharmacy: ['💊', 'MEDS', '#2f9fb0'],
  police: ['🚓', 'POLICE', '#2c3f8f'],
  gunshop: ['🎯', 'AMMO', '#5a4632'],
  junkyard: ['♻️', 'JUNK', '#7a6a55'],
  barn: ['🌾', 'FARM', '#a33a2a'],
};
const LOOT_BY_PLACE: Record<PlaceKind, Loot[]> = {
  pumps: ['fuel', 'fuel', 'cash'],
  motel: ['cash', 'catnip', 'bullets'],
  grocery: ['cash', 'cash', 'catnip'],
  garage: ['scrap', 'scrap', 'fuel'],
  hardware: ['scrap', 'shells'],
  pharmacy: ['catnip', 'cash'],
  police: ['bullets', 'shells'],
  gunshop: ['bullets', 'shells'],
  junkyard: ['scrap'],
  barn: ['fuel', 'scrap'],
};

/**
 * A hollow building: floor, three walls and a glass front with an open door,
 * so the camera can stand inside and see out to the street. Local +z faces
 * the street. Returns the roof so the caller can decorate it.
 */
/** Marks a part to hide while the player is inside (roof, signs, canopy). */
function cut<T extends THREE.Object3D>(o: T): T {
  o.userData.cut = true;
  return o;
}

function hollow(g: THREE.Group, w: number, d: number, h: number, wall: number, trim: number, floor: number): { roof: THREE.Mesh } {
  const t = 0.35;
  box(g, w, 0.1, d, floor, 0, 0.05, 0);
  box(g, w, h, t, wall, 0, h / 2, -d / 2);
  box(g, t, h, d, wall, -w / 2, h / 2, 0);
  box(g, t, h, d, wall, w / 2, h / 2, 0);
  const door = 2.6;
  const seg = (w - door) / 2;
  for (const s of [-1, 1]) {
    const x = s * (door / 2 + seg / 2);
    box(g, seg, 1, t, wall, x, 0.5, d / 2);
    cut(box(g, seg, h - 3.2, t, wall, x, h - (h - 3.2) / 2, d / 2));
    box(g, seg, 2.2, 0.08, GLASS, x, 2.1, d / 2);
  }
  cut(box(g, door, h - 3.2, t, wall, 0, h - (h - 3.2) / 2, d / 2));
  // Trim band and roof: hidden while you're inside, so the camera can look in like a dollhouse.
  cut(box(g, w + 0.6, 0.6, d + 0.6, trim, 0, h + 0.3, 0));
  const roof = cut(box(g, w, 0.2, d, 0x55504a, 0, h + 0.5, 0));
  return { roof };
}

function crate(color = 0xb88a4a): THREE.Group {
  const g = new THREE.Group();
  box(g, 1.2, 1.0, 1.0, color, 0, 0.5, 0);
  box(g, 1.26, 0.12, 0.2, 0x7a5a30, 0, 0.75, 0);
  const lid = box(g, 1.26, 0.14, 1.06, 0xc99a5a, 0, 1.07, 0);
  lid.name = 'lid';
  const q = emojiSprite('❓', 0.9);
  q.position.set(0, 2.0, 0);
  q.name = 'q';
  g.add(q);
  return g;
}

function buildPlace(scene: THREE.Scene, kind: PlaceKind, side: 1 | -1, z: number, crates: number, rng: () => number): Place {
  const g = new THREE.Group();
  // Local frame: +z points at the street. The lot runs from the sidewalk (local z = +14) back.
  const cx = side * 26;
  g.position.set(cx, 0, z);
  g.rotation.y = -side * (Math.PI / 2);
  scene.add(g);
  let w = 14;
  let d = 10;
  let h = 5;
  let doorX = 0;
  // Parking lot.
  flat(g, 30, 28, 0x5d5d62, 0, 0.03, 6);
  const extras: Partial<Place> = {};
  const [em, word, bg] = SIGNS[kind];
  if (kind === 'pumps') {
    // A little shop at the back and a big red canopy over the pumps in front.
    w = 12;
    d = 8;
    hollow(g, w, d, 4.5, 0xf1ebdc, 0xd13b2c, 0x9a9a96);
    const shop = wallText('SNACKS', '#d13b2c', '#fff', 5, 1);
    shop.position.set(0, 4.0, d / 2 + 0.2);
    g.add(cut(shop));
    // Canopy over the pumps, between the shop and the street.
    for (const x of [-6, 6]) for (const zz of [7, 15]) cyl(g, 0.25, 0.25, 8.4, 0xf4f4f4, x, 4.2, zz);
    cut(box(g, 16, 0.8, 12, 0xd13b2c, 0, 8.6, 11));
    cut(box(g, 16.2, 0.25, 12.2, 0xffc94a, 0, 8.1, 11));
    for (const x of [-2.6, 2.6]) {
      box(g, 1.2, 0.3, 4.6, 0xcfcfcf, x, 0.15, 11);
      for (const zz of [9.6, 12.4]) {
        box(g, 0.9, 2.0, 0.7, 0xd13b2c, x, 1.3, zz);
        box(g, 0.7, 0.5, 0.05, 0x223344, x, 1.8, zz + 0.37);
        box(g, 0.25, 0.25, 0.3, 0x222222, x + 0.5, 1.2, zz);
      }
    }
    extras.pump = new THREE.Vector3(-2.6 + 1.1, 0, 11.6);
    extras.park = [new THREE.Vector3(-5.2, 0, 22), new THREE.Vector3(-5.2, 0, 15), new THREE.Vector3(-5.2, 0, 8.5)];
  } else if (kind === 'motel') {
    // Long and low, a row of coloured doors with numbers, and a pool out front.
    w = 22;
    d = 8;
    h = 4.2;
    doorX = 0;
    hollow(g, w, d, h, 0xf2d6e4, 0xa04d8f, 0x8a6a7a);
    const cols = [0x4fc0d1, 0xffc94a, 0x5b9fe8, 0x4fd17a];
    [-9, -6, 6, 9].forEach((x, i) => {
      box(g, 1.4, 2.6, 0.2, cols[i], x, 1.3, d / 2 + 0.2);
      const n = wallText(String(i < 2 ? i + 1 : i + 2), '#ffffff', '#333', 0.6, 0.5);
      n.position.set(x, 3.0, d / 2 + 0.31);
      g.add(n);
    });
    const tag = wallText('MOTEL', '#a04d8f', '#fff', 6, 1.1);
    tag.position.set(0, 3.6, d / 2 + 0.2);
    g.add(cut(tag));
    // Walkway roof.
    cut(box(g, w + 1, 0.25, 2.4, 0xa04d8f, 0, h - 0.4, d / 2 + 1.3));
    // Pool with a ladder and an umbrella.
    box(g, 9, 0.3, 5, 0xffffff, 9, 0.15, 12);
    flat(g, 8.2, 4.2, 0x3fb6e8, 9, 0.32, 12);
    cyl(g, 0.08, 0.08, 3, 0xdddddd, 13, 1.5, 9);
    const um = new THREE.Mesh(new THREE.ConeGeometry(1.8, 0.8, 8), lam(0xff7aa8));
    um.position.set(13, 3.1, 9);
    g.add(um);
    extras.park = [new THREE.Vector3(-6, 0, 22), new THREE.Vector3(-6, 0, 15), new THREE.Vector3(-6, 0, 10)];
  } else if (kind === 'grocery') {
    w = 16;
    d = 11;
    hollow(g, w, d, 5, 0xe9e2c8, 0x3f8a4a, 0xbab3a0);
    const tag = wallText('FOOD', '#3f8a4a', '#fff', 6, 1.3);
    tag.position.set(0, 4.2, d / 2 + 0.2);
    g.add(cut(tag));
    // A giant apple on the roof.
    const ap = new THREE.Mesh(new THREE.SphereGeometry(1.7, 16, 12), lam(0xe0302a));
    ap.position.set(4, 7.4, 0);
    ap.castShadow = true;
    g.add(cut(ap));
    cut(box(g, 0.3, 0.9, 0.3, 0x5a3a1a, 4, 9.3, 0));
    cut(box(g, 0.9, 0.15, 0.5, 0x3fb64a, 4.5, 9.4, 0));
    // Shopping carts.
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Group();
      box(c, 1.0, 0.7, 1.4, 0xc0c4c8, 0, 1.0, 0);
      for (const x of [-0.4, 0.4]) for (const zz of [-0.55, 0.55]) cyl(c, 0.12, 0.12, 0.1, 0x222222, x, 0.15, zz);
      c.position.set(-6 + i * 1.3, 0, 8);
      g.add(c);
    }
    extras.park = [new THREE.Vector3(5, 0, 22), new THREE.Vector3(5, 0, 15), new THREE.Vector3(5, 0, 11)];
  } else if (kind === 'garage') {
    w = 15;
    d = 12;
    h = 6;
    hollow(g, w, d, h, 0xc9ccd1, 0x2f5f9f, 0x6d6d70);
    // A closed roll-up door beside the open one (stripes).
    for (let i = 0; i < 4; i++) box(g, 4.2, 0.55, 0.12, i % 2 ? 0xdddddd : 0xb0b4ba, -4.5, 0.6 + i * 0.6, d / 2 + 0.25);
    const tag = wallText('GARAGE', '#2f5f9f', '#fff', 6, 1.2);
    tag.position.set(0, 5.0, d / 2 + 0.2);
    g.add(cut(tag));
    // Tyre stacks.
    for (let i = 0; i < 4; i++) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.28, 8, 14), lam(0x1d1d22));
      t.rotation.x = Math.PI / 2;
      t.position.set(6.2, 0.3 + i * 0.55, 8);
      g.add(t);
    }
    extras.park = [new THREE.Vector3(-4, 0, 22), new THREE.Vector3(-4, 0, 15), new THREE.Vector3(-4, 0, 10)];
  } else {
    hollow(g, w, d, h, 0xe0d4bc, parseInt(bg.slice(1), 16), 0x9a9a96);
    const tag = wallText(word, bg, '#fff', 6, 1.2);
    tag.position.set(0, 4.2, d / 2 + 0.2);
    g.add(cut(tag));
    extras.park = [new THREE.Vector3(5, 0, 22), new THREE.Vector3(5, 0, 15), new THREE.Vector3(5, 0, 10)];
  }
  // Tall roadside sign on a pole at the sidewalk.
  const poleX = kind === 'pumps' ? 11 : -(w / 2) - 3;
  cyl(g, 0.22, 0.22, 9, 0x8a8a8a, poleX, 4.5, 13.5);
  const sign = signSprite(em, word, bg, 6);
  sign.position.set(poleX, 11, 13.5);
  sign.userData.place = kind;
  g.add(sign);

  // Inside: furniture that says what the place is, and the crates.
  const inner = new THREE.Group();
  g.add(inner);
  furnish(inner, kind, w, d);
  const sx = Math.min(w / 2 - 2, 4.5);
  const spots: [number, number][] = [
    [-sx, -d / 2 + 1.6],
    [sx, -d / 2 + 2.2],
    [-sx + 0.6, 1.2],
    [sx - 0.4, 1.0],
  ].slice(0, crates) as [number, number][];
  const pool = LOOT_BY_PLACE[kind];
  const list: Crate[] = spots.map(([x, zz]) => {
    const m = crate();
    m.position.set(x, 0.1, zz);
    inner.add(m);
    const k = pool[Math.floor(rng() * pool.length)];
    const amt = { fuel: 15, cash: 20, scrap: 4, bullets: 10, shells: 3, catnip: 1 }[k];
    return { mesh: m, open: false, loot: [k, amt] };
  });
  const light = new THREE.PointLight(0xfff0d0, 0, 26, 1.2);
  light.position.set(0, h - 0.8, 0);
  g.add(light);
  g.updateMatrixWorld(true);
  const W = (v: THREE.Vector3) => g.localToWorld(v.clone());
  const fp = new THREE.Box3().setFromPoints([W(new THREE.Vector3(-w / 2 - 0.5, 0, -d / 2 - 0.5)), W(new THREE.Vector3(w / 2 + 0.5, 0, d / 2 + 0.5))]);
  fp.min.y = -1;
  fp.max.y = 10;
  return {
    kind,
    side,
    z,
    group: g,
    door: W(new THREE.Vector3(doorX, 0, d / 2 + 1.6)),
    inside: W(new THREE.Vector3(doorX, 0, d / 2 - 1.8)),
    camPos: W(new THREE.Vector3(0, h + 12, d / 2 + 11)),
    camLook: W(new THREE.Vector3(0, 0, -0.8)),
    cut: (() => {
      const list: THREE.Object3D[] = [];
      g.traverse((o) => o.userData.cut && list.push(o));
      return list;
    })(),
    park: (extras.park ?? []).map(W),
    footprint: fp,
    crates: list,
    pump: extras.pump && W(extras.pump),
    light,
  };
}

/** Furniture a five-year-old can name: a bed in the motel, a car on a lift in the garage, fruit at the grocery. */
function furnish(g: THREE.Group, kind: PlaceKind, w: number, d: number): void {
  if (kind === 'motel') {
    // Bed with pillows and a blanket, a lamp and a TV.
    box(g, 3.2, 0.7, 4.2, 0x6b4a2a, -1, 0.45, -d / 2 + 2.4);
    box(g, 3.0, 0.4, 4.0, 0xffffff, -1, 0.95, -d / 2 + 2.4);
    box(g, 3.05, 0.45, 2.6, 0x5b9fe8, -1, 1.0, -d / 2 + 3.1);
    box(g, 1.1, 0.35, 0.8, 0xffffff, -1.7, 1.25, -d / 2 + 0.9);
    box(g, 1.1, 0.35, 0.8, 0xffffff, -0.3, 1.25, -d / 2 + 0.9);
    box(g, 0.8, 0.8, 0.8, 0x6b4a2a, 1.3, 0.5, -d / 2 + 0.8);
    cyl(g, 0.35, 0.5, 0.6, 0xffe08a, 1.3, 1.25, -d / 2 + 0.8);
    box(g, 2.2, 1.3, 0.2, 0x111111, 4.5, 2.0, -d / 2 + 0.4);
    box(g, 2.0, 1.1, 0.05, 0x3a6ab0, 4.5, 2.0, -d / 2 + 0.52);
  } else if (kind === 'garage') {
    // A car up on a lift, a tool wall, oil drums.
    for (const x of [-2.6, 2.6]) box(g, 0.4, 2.4, 0.4, 0xffc94a, x, 1.2, -1);
    box(g, 5.6, 0.2, 3, 0xffc94a, 0, 2.4, -1);
    const car = model('car-sedan') ?? makeCar(0x4fc0d1);
    car.rotation.y = Math.PI / 2;
    car.position.set(0, 2.5, -1);
    g.add(car);
    box(g, 6, 2.4, 0.1, 0xb0805a, 0, 2.5, -d / 2 + 0.25);
    for (let i = 0; i < 5; i++) box(g, 0.2, 0.9, 0.08, 0x666666, -2 + i, 2.6, -d / 2 + 0.33);
    for (const x of [w / 2 - 1.2, w / 2 - 2.4]) cyl(g, 0.5, 0.5, 1.3, 0x2f5f9f, x, 0.75, 3);
  } else if (kind === 'grocery' || kind === 'pumps') {
    // Shelves with bright fruit or snacks, and a fridge.
    const colors = kind === 'grocery' ? [0xe0302a, 0x4fd17a, 0xffc94a, 0xff8a2a] : [0xd13b2c, 0x5b9fe8, 0xffc94a, 0x7a4fd1];
    for (const x of [-2, 2]) {
      box(g, 1.2, 2.2, d * 0.45, 0x8a6a4a, x, 1.15, -0.5);
      for (let r = 0; r < 3; r++)
        for (let i = 0; i < 4; i++) {
          const fruit = kind === 'grocery' ? new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), lam(colors[(i + r) % 4])) : new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.3), lam(colors[(i + r) % 4]));
          fruit.position.set(x + 0.62, 0.6 + r * 0.7, -0.5 - d * 0.18 + i * (d * 0.12));
          g.add(fruit);
        }
    }
    box(g, 2.6, 2.6, 1, 0xe8e8ee, w / 2 - 1.7, 1.3, -d / 2 + 0.8);
    box(g, 2.3, 2.2, 0.08, 0x9fd4ee, w / 2 - 1.7, 1.4, -d / 2 + 1.32);
  } else {
    for (const x of [-2, 2]) box(g, 1.2, 2.2, d * 0.45, 0x6b4a2a, x, 1.15, -0.5);
  }
}

// ------------------------------------------------------------------ zombies
interface Zombie {
  obj: THREE.Object3D;
  pos: THREE.Vector3;
  hp: number;
  speed: number;
  phase: number;
  hurt: number;
  awake: boolean;
}
function hat(kind: number): THREE.Object3D {
  const g = new THREE.Group();
  if (kind === 0) {
    // Traffic cone.
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.8, 10), lam(0xff7a1a));
    c.position.y = 0.4;
    g.add(c);
    box(g, 0.5, 0.06, 0.5, 0xff7a1a, 0, 0.02, 0);
  } else if (kind === 1) {
    // Chef's hat.
    cyl(g, 0.3, 0.26, 0.5, 0xffffff, 0, 0.25, 0);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 8), lam(0xffffff));
    top.position.y = 0.6;
    g.add(top);
  } else if (kind === 2) {
    // Party hat.
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.75, 10), lam(0xd04fd1));
    c.position.y = 0.38;
    g.add(c);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), lam(0xffe04a));
    b.position.y = 0.8;
    g.add(b);
  } else {
    // A bucket.
    cyl(g, 0.34, 0.28, 0.5, 0x9aa4ae, 0, 0.25, 0);
  }
  return g;
}

// ------------------------------------------------------------------ the prototype
type Phase = 'arrive' | 'driving' | 'parked' | 'walking' | 'inside' | 'leaving' | 'gone';

class TownProto {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, 1, 0.3, 900);
  atmo: Atmosphere;
  car: THREE.Group;
  walker: THREE.Group;
  places: Place[] = [];
  zombies: Zombie[] = [];
  phase: Phase = 'arrive';
  at: Place | null = null;
  inv = { fuel: 38, cash: 40, scrap: 6, bullets: 24, shells: 4, catnip: 1 };
  carHp = 72;
  me = 10;
  noise = 0;
  carYaw = Math.PI;
  carPath: { curve: THREE.CatmullRomCurve3; t: number; len: number; reverse?: boolean; done: () => void } | null = null;
  walkPath: { pts: THREE.Vector3[]; i: number; speed: number; done: () => void } | null = null;
  camPos = new THREE.Vector3();
  camLook = new THREE.Vector3();
  camWant = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  ray = new THREE.Raycaster();
  fx: { obj: THREE.Object3D; life: number; vy: number }[] = [];
  clock = new THREE.Clock();
  time = 0;
  fill: number | null = null;
  streetEnd: number;
  onChange: () => void = () => {};
  say: (t: string) => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, quality.level === 'low' ? 1 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = quality.level !== 'low';
    this.atmo = new Atmosphere(this.scene, 0x9fd0ef, 120, 420, quality.level !== 'low' ? { size: 2048, range: 60 } : null);
    this.atmo.set(HOUR, 'clear');
    this.build();
    this.car = makeCar(0xd9482b);
    this.car.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.scene.add(this.car);
    this.atmo.attachHeadlights(this.car);
    this.walker = makeWalker();
    this.walker.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.walker.visible = false;
    this.scene.add(this.walker);
    this.streetEnd = Math.min(...this.places.map((p) => p.z)) - 40;
    // The car comes off the highway and onto Main Street.
    this.car.position.set(30, 0, 34);
    this.carYaw = -Math.PI / 2;
    this.driveCurve([new THREE.Vector3(30, 0, 34), new THREE.Vector3(12, 0, 33), new THREE.Vector3(2.6, 0, 24), new THREE.Vector3(2.6, 0, 14)], () => {
      this.phase = 'driving';
      this.onChange();
    });
    this.spawnZombie(new THREE.Vector3(-3, 0, this.streetEnd + 12), false);
    this.spawnZombie(new THREE.Vector3(5, 0, this.streetEnd + 20), false);
    this.snapCamera();
    addEventListener('resize', () => this.resize());
    this.resize();
    canvas.addEventListener('pointerdown', (e) => this.tap(e));
    this.renderer.setAnimationLoop(() => this.frame());
  }

  build(): void {
    const s = this.scene;
    flat(s, 900, 900, 0xc9b48a, 0, 0, 0);
    // The highway along the front of town, with yellow lines.
    flat(s, 900, 14, 0x3a3a3f, 0, 0.02, 36);
    for (let x = -400; x < 400; x += 8) box(s, 4, 0.03, 0.25, 0xf2c230, x, 0.04, 36);
    // Main Street: two lanes, centre line, sidewalks, street lights.
    const rng = mulberry(7);
    const rows = Math.ceil(PLACES.length / 2);
    const end = -rows * 44 - 50;
    const len = 30 - end;
    flat(s, 10, len, 0x46464c, 0, 0.03, (30 + end) / 2);
    for (let z = 26; z > end; z -= 6) box(s, 0.25, 0.03, 3, 0xf2c230, 0, 0.05, z);
    for (const side of [-1, 1]) {
      box(s, 2.6, 0.25, len, 0xbdb3a0, side * 6.3, 0.12, (30 + end) / 2);
      for (let z = 22; z > end; z -= 24) {
        if (PLACES.some((_, i) => (i % 2 === 0 ? 1 : -1) === side && Math.abs(-30 - Math.floor(i / 2) * 44 - (i % 2) * 18 - z) < 22)) continue;
        cyl(s, 0.12, 0.12, 6, 0x666a70, side * 7, 3, z);
        box(s, 1.4, 0.15, 0.4, 0x666a70, side * 6.3, 6, z);
      }
    }
    PLACES.forEach((k, i) => {
      const side: 1 | -1 = i % 2 === 0 ? 1 : -1;
      const z = -30 - Math.floor(i / 2) * 44 - (i % 2) * 18;
      this.places.push(buildPlace(s, k, side, z, KID ? 3 : 4, rng));
    });
    // Houses and trees fill the gaps, the same CC0 models as the road.
    const houses: ModelName[] = ['house-1', 'house-2', 'house-3', 'house-4', 'house-5'];
    for (let z = 10; z > end + 10; z -= 15) {
      for (const side of [-1, 1]) {
        const near = this.places.some((p) => p.side === side && Math.abs(p.z - z) < 18);
        if (near) {
          const t = model(rng() < 0.5 ? 'oak-1' : 'oak-2');
          if (t) {
            t.position.set(side * (48 + rng() * 10), 0, z);
            s.add(t);
          }
          continue;
        }
        const m = model(houses[Math.floor(rng() * houses.length)]);
        if (m) {
          m.position.set(side * 16, 0, z);
          m.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
          s.add(m);
        } else box(s, 8, 6, 8, 0xd8c8a8, side * 16, 3, z);
        const t = model(rng() < 0.5 ? 'oak-2' : 'oak-3');
        if (t) {
          t.position.set(side * (26 + rng() * 6), 0, z + 6);
          s.add(t);
        }
      }
    }
    // A sign at the end of the street pointing back to the highway.
    const back = signSprite('🛣️', 'ROAD', '#1f6b3a', 5);
    back.position.set(-8, 7, end + 8);
    s.add(back);
    cyl(s, 0.2, 0.2, 5, 0x8a8a8a, -8, 2.5, end + 8);
  }

  // ---------------------------------------------------------------- zombies
  spawnZombie(at: THREE.Vector3, awake: boolean): void {
    if (this.zombies.length >= (KID ? 4 : 7)) return;
    const z = makeZombie();
    const holder = new THREE.Group();
    holder.add(z);
    z.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    const h = hat(this.zombies.length % 4);
    h.position.y = 2.2;
    holder.add(h);
    holder.position.copy(at);
    holder.userData.zombie = true;
    this.scene.add(holder);
    this.zombies.push({ obj: holder, pos: holder.position, hp: 2, speed: (KID ? 1.3 : 1.8) + Math.random() * 0.4, phase: Math.random() * 6, hurt: 0, awake });
  }

  noiseUp(by: number): void {
    const before = this.noise;
    this.noise = Math.min(1, this.noise + by);
    const steps = [0.34, 0.67, 1];
    for (const s of steps)
      if (before < s && this.noise >= s) {
        // Zombies shuffle in from the far end of the street and from behind the houses.
        const n = s === 0.34 ? 2 : 2;
        for (let i = 0; i < n; i++) {
          const p = this.at ?? this.places[0];
          const from = i % 2 ? new THREE.Vector3(p.side * 8, 0, p.z - 30 - Math.random() * 10) : new THREE.Vector3(-p.side * 12, 0, p.z + 24 + Math.random() * 8);
          this.spawnZombie(from, true);
        }
        for (const z of this.zombies) z.awake = true;
        this.say(KID ? 'Uh oh! Zombies are coming!' : 'All that noise woke up the neighbourhood.');
      }
  }

  // ---------------------------------------------------------------- input
  tap(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
    // Zombies first: tap one to shoot it.
    const zHits = this.ray.intersectObjects(this.zombies.map((z) => z.obj), true);
    if (zHits.length && this.phase !== 'inside') {
      let o: THREE.Object3D | null = zHits[0].object;
      while (o && !o.userData.zombie) o = o.parent;
      const z = this.zombies.find((q) => q.obj === o);
      if (z) return this.shoot(z);
    }
    if (this.phase === 'inside' && this.at) {
      const hits = this.ray.intersectObjects(this.at.crates.map((c) => c.mesh), true);
      if (hits.length) {
        const c = this.at.crates.find((q) => q.mesh === hits[0].object.parent || q.mesh === hits[0].object.parent?.parent);
        if (c) this.openCrate(c);
      }
      return;
    }
    const hits = this.ray.intersectObjects([...this.places.map((p) => p.group), this.car], true);
    for (const h of hits) {
      if (isChild(h.object, this.car)) {
        if (this.phase === 'walking') this.walkToCar();
        return;
      }
      const p = this.places.find((q) => isChild(h.object, q.group));
      if (p) {
        if (this.phase === 'driving' || this.phase === 'parked') {
          if (this.phase === 'parked' && this.at === p) this.getOut();
          else this.driveTo(p);
        } else if (this.phase === 'walking') {
          if (p === this.at && p.pump && h.point.distanceTo(p.pump) < 3 && this.inv.fuel < 100) this.walkTo([p.pump.clone().add(new THREE.Vector3(0.8, 0, 0))], 4.5, () => this.fillUp());
          else this.enter(p);
        }
        return;
      }
    }
    // The ground: walk there.
    if (this.phase === 'walking') {
      const g = this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
      if (g) this.walkTo([g], 4.5, () => {});
    }
  }

  shoot(z: Zombie): void {
    if (this.inv.bullets <= 0) return this.say('Out of bullets!');
    const from = this.phase === 'walking' ? this.walker.position : this.car.position;
    if (from.distanceTo(z.pos) > 30) return this.say('Too far away!');
    this.inv.bullets--;
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone().setY(1.6), z.pos.clone().setY(1.4)]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe08a }));
    this.scene.add(line);
    this.fx.push({ obj: line, life: 0.12, vy: 0 });
    if (this.phase === 'walking') this.walker.rotation.y = Math.atan2(z.pos.x - from.x, z.pos.z - from.z);
    z.hp--;
    z.hurt = 0.25;
    z.awake = true;
    if (z.hp <= 0) this.pop(z);
    this.onChange();
  }

  pop(z: Zombie): void {
    this.scene.remove(z.obj);
    this.zombies.splice(this.zombies.indexOf(z), 1);
    const puff = emojiSprite('💨', 2.4);
    puff.position.copy(z.pos).setY(1.4);
    this.scene.add(puff);
    this.fx.push({ obj: puff, life: 0.8, vy: 1 });
    // The hat pops off and sometimes a coin.
    const coin = emojiSprite(Math.random() < 0.5 ? '💵' : '⭐', 1.3);
    coin.position.copy(z.pos).setY(2.5);
    this.scene.add(coin);
    this.fx.push({ obj: coin, life: 1.1, vy: 2.5 });
    this.inv.cash += 5;
  }

  // ---------------------------------------------------------------- driving
  driveCurve(pts: THREE.Vector3[], done: () => void, reverse = false): void {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    this.carPath = { curve, t: 0, len: curve.getLength(), reverse, done };
  }

  /** Out of a lot (backing out if needed), along Main Street and into another lot. */
  driveTo(p: Place): void {
    if (this.carPath) return;
    this.walker.visible = false;
    const pos = this.car.position.clone();
    const go = () => {
      const now = this.car.position.clone();
      const ahead = p.z < now.z;
      const lane = ahead ? 2.6 : -2.6;
      const pts = [now];
      if (Math.abs(now.x) > 7) pts.push(new THREE.Vector3(Math.sign(now.x) * 6, 0, now.z + (ahead ? -6 : 6)));
      pts.push(new THREE.Vector3(lane, 0, now.z + (ahead ? -12 : 12)));
      const entry = p.park[0];
      const zIn = entry.z + (ahead ? 10 : -10);
      if (Math.abs(zIn - now.z) > 16) pts.push(new THREE.Vector3(lane, 0, zIn));
      pts.push(...p.park);
      this.phase = 'driving';
      this.at = null;
      this.onChange();
      this.driveCurve(dedupe(pts), () => {
        this.at = p;
        this.phase = 'parked';
        this.say(KID ? `${SIGNS[p.kind][1]}!` : `You pull into the ${SIGNS[p.kind][1].toLowerCase()}.`);
        this.onChange();
      });
    };
    if (this.phase === 'parked' && this.at) {
      // Back out first.
      const fwd = new THREE.Vector3(Math.sin(this.carYaw), 0, Math.cos(this.carYaw));
      this.driveCurve([pos, pos.clone().addScaledVector(fwd, -3), pos.clone().addScaledVector(fwd, -7)], go, true);
    } else go();
  }

  leaveTown(): void {
    if (this.carPath) return;
    const fwd = new THREE.Vector3(Math.sin(this.carYaw), 0, Math.cos(this.carYaw));
    const now = this.car.position.clone();
    const out = () => {
      const p = this.car.position.clone();
      this.phase = 'leaving';
      this.onChange();
      this.driveCurve(dedupe([p, new THREE.Vector3(Math.sign(p.x) * 5, 0, p.z - 8), new THREE.Vector3(2.6, 0, p.z - 20), new THREE.Vector3(2.6, 0, this.streetEnd + 8), new THREE.Vector3(14, 0, this.streetEnd - 6), new THREE.Vector3(60, 0, this.streetEnd - 10)]), () => {
        this.phase = 'gone';
        this.onChange();
      });
    };
    if (this.phase === 'parked' && this.at && !this.at.pump) this.driveCurve([now, now.clone().addScaledVector(fwd, -3), now.clone().addScaledVector(fwd, -7)], out, true);
    else out();
  }

  // ---------------------------------------------------------------- on foot
  getOut(): void {
    if (this.phase !== 'parked') return;
    const left = new THREE.Vector3(Math.cos(this.carYaw), 0, -Math.sin(this.carYaw));
    this.walker.position.copy(this.car.position).addScaledVector(left, 1.9);
    this.walker.rotation.y = this.carYaw;
    this.walker.visible = true;
    this.phase = 'walking';
    this.say(KID ? 'Tap where to go!' : 'Tap a door to go in, or the car to hop back in.');
    this.onChange();
  }

  walkTo(pts: THREE.Vector3[], speed: number, done: () => void): void {
    this.walkPath = { pts: pts.map((p) => p.clone().setY(0)), i: 0, speed, done };
  }

  walkToCar(run = false): void {
    if (this.phase !== 'walking') return;
    const left = new THREE.Vector3(Math.cos(this.carYaw), 0, -Math.sin(this.carYaw));
    this.walkTo([this.car.position.clone().addScaledVector(left, 1.9)], run ? 7.5 : 4.5, () => {
      this.walker.visible = false;
      this.phase = 'parked';
      this.onChange();
    });
  }

  enter(p: Place): void {
    this.at = p;
    this.walkTo([p.door, p.inside], 4.5, () => {
      this.phase = 'inside';
      p.light.intensity = 30;
      for (const o of p.cut) o.visible = false;
      this.say(KID ? 'Tap the boxes!' : 'Tap the boxes. Noise brings zombies.');
      this.onChange();
    });
  }

  goOut(run = false): void {
    if (this.phase !== 'inside' || !this.at) return;
    const p = this.at;
    p.light.intensity = 0;
    for (const o of p.cut) o.visible = true;
    this.phase = 'walking';
    this.onChange();
    this.walkTo([p.door], run ? 7 : 4.5, () => {
      if (run) this.walkToCar(true);
    });
  }

  openCrate(c: Crate): void {
    if (c.open) return;
    c.open = true;
    const lid = c.mesh.getObjectByName('lid')!;
    lid.rotation.x = -1.2;
    lid.position.set(0, 1.4, -0.5);
    const [k, n] = c.loot;
    (this.inv as Record<string, number>)[k] += n;
    const s = emojiSprite(LOOT_ICONS[k], 1.6);
    s.position.copy(c.mesh.getWorldPosition(new THREE.Vector3())).setY(2);
    this.scene.add(s);
    this.fx.push({ obj: s, life: 1.2, vy: 1.6 });
    this.noiseUp(0.18 + Math.random() * 0.12);
    this.onChange();
  }

  fillUp(): void {
    this.fill = 0;
    this.say(KID ? 'Glug glug glug!' : 'Filling up.');
  }

  // ---------------------------------------------------------------- frame
  resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Sideways phones see more; tall phones need a wider view to see both sides of the street.
    this.camera.fov = w < h ? 68 : 52;
    this.camera.updateProjectionMatrix();
  }

  snapCamera(): void {
    this.wantCamera();
    this.camPos.copy(this.camWant.pos);
    this.camLook.copy(this.camWant.look);
  }

  wantCamera(): void {
    const { pos, look } = this.camWant;
    if (this.phase === 'inside' && this.at) {
      pos.copy(this.at.camPos);
      look.copy(this.at.camLook);
      return;
    }
    if (this.phase === 'walking') {
      // Over the shoulder from the street side, so the doors face the camera.
      const w = this.walker.position;
      pos.set(w.x * 0.6, 6.5, w.z + 10);
      look.set(w.x, 1.2, w.z - 3);
      return;
    }
    // The road's chase camera: 14 behind, 7 up, looking 20 ahead.
    const fwd = new THREE.Vector3(Math.sin(this.carYaw), 0, Math.cos(this.carYaw));
    const p = this.car.position;
    if (this.phase === 'parked' && this.at) {
      // Parked: pull back to see the car and the building together.
      // Parked: from the street, a little back, so the car, the building and its sign are all in view.
      const d = this.at.door;
      pos.set(-this.at.side * 2, 6.5, d.z + 16);
      look.set((p.x + d.x) / 2, 2.5, (p.z + d.z) / 2 - 2);
      return;
    }
    pos.copy(p).addScaledVector(fwd, -14).setY(7);
    look.copy(p).addScaledVector(fwd, 20).setY(1);
  }

  frame(): void {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;
    // Car along its path.
    if (this.carPath) {
      const cp = this.carPath;
      const speed = this.phase === 'leaving' ? 14 : 10;
      cp.t = Math.min(1, cp.t + (dt * speed) / cp.len);
      const e = cp.t;
      const pt = cp.curve.getPointAt(e);
      const tan = cp.curve.getTangentAt(e);
      this.car.position.copy(pt);
      this.carYaw = Math.atan2(tan.x, tan.z) + (cp.reverse ? Math.PI : 0);
      // Running zombies over in the street, like on the road.
      for (const z of [...this.zombies]) if (z.pos.distanceTo(pt) < 2.4) this.pop(z);
      if (cp.t >= 1) {
        this.carPath = null;
        cp.done();
      }
    }
    this.car.rotation.y = this.carYaw;
    // Walker along its path, legs swinging.
    if (this.walkPath) {
      const wp = this.walkPath;
      const target = wp.pts[wp.i];
      const d = target.clone().sub(this.walker.position).setY(0);
      const step = wp.speed * dt;
      if (d.length() <= step) {
        this.walker.position.copy(target);
        wp.i++;
        if (wp.i >= wp.pts.length) {
          this.walkPath = null;
          wp.done();
        }
      } else {
        this.walker.position.addScaledVector(d.normalize(), step);
        this.walker.rotation.y = Math.atan2(d.x, d.z);
      }
      const sw = Math.sin(this.time * 12) * 0.5;
      this.walker.getObjectByName('legL')!.rotation.x = sw;
      this.walker.getObjectByName('legR')!.rotation.x = -sw;
    }
    // Filling up at the pump.
    if (this.fill !== null) {
      this.fill += dt;
      this.inv.fuel = Math.min(100, this.inv.fuel + dt * 30);
      if (this.inv.fuel >= 100 || this.fill > 3) {
        this.fill = null;
        this.say(KID ? 'Full tank!' : 'Tank is full.');
      }
      this.onChange();
    }
    // Zombies shuffle after you: the walker, the door you went in, or the car.
    const target = this.phase === 'walking' ? this.walker.position : this.phase === 'inside' && this.at ? this.at.door : this.car.position;
    this.zombies.forEach((z, i) => {
      z.phase += dt;
      const toT = target.clone().sub(z.pos).setY(0);
      const dist = toT.length();
      if (!z.awake && dist < 16 && this.phase === 'walking') z.awake = true;
      const sp = z.awake ? z.speed : 0.5;
      const want = z.awake ? toT : new THREE.Vector3(Math.sin(z.phase * 0.3 + i), 0, Math.cos(z.phase * 0.3 + i));
      const stopAt = this.phase === 'inside' ? 1.2 + i * 0.9 : 1.3;
      if (!z.awake || dist > stopAt) z.pos.addScaledVector(want.normalize(), sp * dt);
      z.obj.rotation.y = Math.atan2(want.x, want.z);
      // Wobble, and a jump when hit.
      z.obj.rotation.z = Math.sin(z.phase * 4) * 0.12;
      z.obj.position.y = z.hurt > 0 ? z.hurt * 2 : Math.abs(Math.sin(z.phase * 4)) * 0.12;
      z.hurt = Math.max(0, z.hurt - dt);
      if (z.awake && dist < 1.6 && this.phase === 'walking' && (z.obj.userData.cool ?? 0) < this.time) {
        z.obj.userData.cool = this.time + 1.2;
        this.me = Math.max(0, this.me - 1);
        document.body.classList.remove('hurt');
        void document.body.offsetWidth;
        document.body.classList.add('hurt');
        this.onChange();
      }
      if (z.awake && dist < 3 && this.phase === 'parked' && (z.obj.userData.cool ?? 0) < this.time) {
        z.obj.userData.cool = this.time + 1.5;
        this.carHp = Math.max(0, this.carHp - 1);
        this.onChange();
      }
    });
    // Effects float up and fade.
    this.fx = this.fx.filter((f) => {
      f.life -= dt;
      f.obj.position.y += f.vy * dt;
      if (f.life <= 0) this.scene.remove(f.obj);
      return f.life > 0;
    });
    // Crates bob their question marks.
    for (const p of this.places)
      for (const c of p.crates) {
        const q = c.mesh.getObjectByName('q')!;
        q.position.y = 2 + Math.sin(this.time * 3) * 0.15;
        // Only shown inside, or they would show through the walls.
        q.visible = !c.open && this.phase === 'inside' && this.at === p;
      }
    this.wantCamera();
    const k = Math.min(1, dt * (this.phase === 'inside' ? 3 : 4));
    this.camPos.lerp(this.camWant.pos, k);
    this.camLook.lerp(this.camWant.look, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.atmo.update(dt, this.camera, this.phase === 'walking' ? this.walker.position : this.car.position);
    this.renderer.render(this.scene, this.camera);
  }

  nearZombies(r = 10): number {
    const from = this.phase === 'inside' && this.at ? this.at.door : this.phase === 'walking' ? this.walker.position : this.car.position;
    return this.zombies.filter((z) => z.awake && z.pos.distanceTo(from) < r).length;
  }
}

function isChild(o: THREE.Object3D | null, root: THREE.Object3D): boolean {
  for (; o; o = o.parent) if (o === root) return true;
  return false;
}
function dedupe(pts: THREE.Vector3[]): THREE.Vector3[] {
  return pts.filter((p, i) => i === 0 || p.distanceTo(pts[i - 1]) > 1);
}
function mulberry(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ HUD
const h = (tag: string, cls = '', text = ''): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

async function main(): Promise<void> {
  if (quality.level !== 'low') await loadModels();
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const ui = document.getElementById('ui')!;
  if (KID) document.body.classList.add('kid');
  const t = new TownProto(canvas);
  const top = h('div', 'p-top');
  const meters = h('div', 'p-meters');
  const chip = h('div', 'p-chip');
  chip.innerHTML = `<b>Coyote Flats</b><small>${HOUR >= 19 || HOUR < 6 ? '🌙' : '☀️'} Town</small>`;
  top.append(meters, chip);
  const said = h('div', 'p-say');
  const bottom = h('div', 'p-bottom');
  const noise = h('div', 'p-noise');
  noise.innerHTML = '<span>🔊</span><div class="track"><span class="fill"></span></div><span>🧟</span>';
  const row = h('div', 'p-row');
  bottom.append(noise, row);
  ui.append(top, said, bottom);
  let sayT = 0;
  t.say = (s) => {
    said.textContent = s;
    said.classList.add('on');
    clearTimeout(sayT);
    sayT = window.setTimeout(() => said.classList.remove('on'), 2600);
  };
  const btn = (icon: string, text: string, cls: string, fn: () => void) => {
    const b = h('button', `btn ${cls}`);
    b.append(h('span', 'big-icon', icon), document.createTextNode(KID ? '' : ` ${text}`));
    if (KID) b.setAttribute('aria-label', text);
    b.onclick = fn;
    return b;
  };
  const bar = (icon: string, v: number, max: number, cls: string) => {
    const el = h('div', 'p-bar');
    el.innerHTML = `<span>${icon}</span><div class="track ${cls}"><span style="width:${Math.round((v / max) * 100)}%"></span></div>`;
    return el;
  };
  const render = () => {
    meters.replaceChildren(
      bar('⛽', t.inv.fuel, 100, 'fuel'),
      bar('🔧', t.carHp, 100, 'hp'),
      bar('❤️', t.me, 10, 'me'),
      Object.assign(h('div', 'p-inv'), { textContent: `💵 ${t.inv.cash}  🔩 ${t.inv.scrap}  🔫 ${t.inv.bullets}` }),
    );
    (noise.querySelector('.fill') as HTMLElement).style.width = `${Math.round(t.noise * 100)}%`;
    noise.classList.toggle('hot', t.noise > 0.66);
    noise.hidden = t.phase !== 'inside';
    const near = t.nearZombies();
    const b: HTMLElement[] = [];
    if (t.phase === 'driving' || t.phase === 'arrive') b.push(h('div', 'p-hint', KID ? '👆 Tap a sign!' : '👆 Tap a place to pull in'), btn('🛣️', 'Back on the road', 'ghost', () => t.leaveTown()));
    if (t.phase === 'parked') {
      if (t.at?.pump && t.inv.fuel < 100) b.push(btn('⛽', 'Fill up', 'primary', () => (t.getOut(), t.walkTo([t.at!.pump!.clone().add(new THREE.Vector3(0.8, 0, 0))], 4.5, () => t.fillUp()))));
      b.push(btn('🚶', 'Get out', t.at?.pump && t.inv.fuel < 100 ? '' : 'primary', () => t.getOut()), btn('🛣️', 'Drive on', near ? 'primary pulse' : 'ghost', () => t.leaveTown()));
    }
    if (t.phase === 'walking') {
      b.push(h('div', 'p-hint', KID ? '👆 Tap a door!' : '👆 Tap a door, the ground, or a zombie'));
      b.push(btn('🚗', near ? 'Run to the car!' : 'Back to the car', near ? 'primary pulse' : 'ghost', () => t.walkToCar(near > 0)));
    }
    if (t.phase === 'inside') {
      const left = t.at!.crates.filter((c) => !c.open).length;
      b.push(h('div', 'p-hint', left ? (KID ? '👆 Tap the boxes!' : `👆 Tap the boxes (${left} left)`) : near ? (KID ? 'Zombies outside!' : 'Zombies at the door!') : 'All searched'));
      b.push(btn('🚪', near ? 'Run to the car!' : 'Go outside', near || !left ? 'primary' : 'ghost', () => t.goOut(near > 0)));
    }
    if (t.phase === 'leaving') b.push(h('div', 'p-hint', 'Back to the highway…'));
    if (t.phase === 'gone') b.push(h('div', 'p-hint', 'Back on the road! (In the game the road view carries on from here.)'), btn('🔁', 'Again', 'primary', () => location.reload()));
    row.replaceChildren(...b);
  };
  t.onChange = render;
  setInterval(render, 500);
  render();
  // Screenshot hooks: jump straight to a moment.
  (window as unknown as { proto: unknown }).proto = {
    t,
    async shot(name: string) {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const until = async (f: () => boolean) => {
        for (let i = 0; i < 1500 && !f(); i++) await wait(50);
      };
      const gas = t.places.find((p) => p.kind === 'pumps')!;
      const motel = t.places.find((p) => p.kind === 'motel')!;
      await until(() => t.phase === 'driving');
      if (name === 'arrive') return;
      t.driveTo(gas);
      await until(() => t.phase === 'parked');
      if (name === 'gas') return;
      t.getOut();
      t.walkTo([gas.pump!.clone().add(new THREE.Vector3(0.8, 0, 0))], 9, () => t.fillUp());
      await until(() => t.fill !== null);
      await wait(900);
      if (name === 'pump') return;
      await until(() => t.fill === null);
      t.walkToCar();
      await until(() => t.phase === 'parked');
      t.driveTo(motel);
      await until(() => t.phase === 'parked' && t.at === motel);
      if (name === 'motel') return;
      t.getOut();
      t.walkTo([motel.door.clone().add(new THREE.Vector3(-motel.side * 5, 0, 2))], 9, () => {});
      await wait(1200);
      if (name === 'walk') return;
      t.enter(motel);
      await until(() => t.phase === 'inside');
      await wait(1200);
      if (name === 'inside') return;
      for (const c of motel.crates.slice(0, 3)) {
        t.openCrate(c);
        await wait(300);
      }
      for (const z of t.zombies) z.pos.lerp(motel.door, 0.85);
      await wait(1500);
      if (name === 'zombies-in') return;
      t.goOut();
      await until(() => !t.walkPath);
      await wait(300);
      if (name === 'zombies-out') return;
    },
  };
}
void main();
