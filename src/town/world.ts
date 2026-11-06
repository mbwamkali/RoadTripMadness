import * as THREE from 'three';
import type { PlaceKind } from '../game/stops';
import { lit } from '../scenes/materials';
import { placeBuilding, fitted, HD_HOUSES, PLACE_BUILDINGS } from '../scenes/hdBuildings';
import { modelMesh, type ModelName } from '../scenes/models';
import { textSprite } from '../scenes/common';
import { makeRng } from '../game/rng';
import { pointAlong, type TownLayout, type TownLot } from './layout';

/**
 * Builds a town layout (layout.ts) in 3D, in the town's own frame: Main
 * Street runs from (0, 0, 0) off along -z (the way to3 turns map +y), +x is on
 * your right driving in, one unit is one metre. The caller places the group
 * where the side road leaves the highway, so the town is part of the road
 * view: no screen change to get in.
 *
 * Each lot remembers where the car parks, where its door is and what is
 * inside, for the town's play (play.ts).
 */

export const STREET_HALF = 4.6;
export const SIDEWALK = 2.6;
/** Where lots start, measured out from Main Street's centre line. */
export const LOT_NEAR = STREET_HALF + SIDEWALK;
export const LOT_DEPTH = 30;
export const LOT_ALONG = 30;

/** Picture and word for each place's big roadside sign: picture first, for the 5-year-old. */
export const PLACE_PICTURES: Record<PlaceKind, { icon: string; word: string; color: string }> = {
  pumps: { icon: '⛽', word: 'GAS', color: '#c8302a' },
  motel: { icon: '🛏️', word: 'MOTEL', color: '#8e3fa0' },
  grocery: { icon: '🍎', word: 'FOOD', color: '#2f7a3a' },
  garage: { icon: '🔧', word: 'FIX CAR', color: '#2f5f9f' },
  hardware: { icon: '🔨', word: 'TOOLS', color: '#b5562a' },
  pharmacy: { icon: '💊', word: 'MEDICINE', color: '#1f8a7a' },
  police: { icon: '🚓', word: 'POLICE', color: '#1f4f9a' },
  gunshop: { icon: '🎯', word: 'AMMO', color: '#5a4632' },
  junkyard: { icon: '♻️', word: 'JUNK', color: '#6a5a3a' },
  barn: { icon: '🌾', word: 'FARM', color: '#a8322a' },
};

export interface TownSpot {
  lot: TownLot;
  /** Everything belonging to the lot (tap target). */
  group: THREE.Group;
  /** The outside of the building, hidden while you're inside (the dollhouse view). */
  shell: THREE.Object3D;
  /** The room inside, shown while you're inside. */
  room: THREE.Group;
  /** Car path into the lot, from Main Street to the parking spot. */
  park: THREE.Vector3[];
  /** Front door: outside and just inside. */
  door: THREE.Vector3;
  inside: THREE.Vector3;
  /** Crates in the room. */
  crates: THREE.Group[];
  /** The fuel pump, at a gas station. */
  pump?: THREE.Vector3;
  /** Where the room is, for the dollhouse camera. */
  centre: THREE.Vector3;
  size: THREE.Vector3;
  /** The direction the building faces (toward the street). */
  facing: THREE.Vector3;
  sign: THREE.Object3D;
}

export interface TownWorld {
  layout: TownLayout;
  group: THREE.Group;
  spots: TownSpot[];
  /** Main Street's centre line as 3D points, highway end first. */
  street: THREE.Vector3[];
  /** Right-hand lane, driving in and out. */
  laneIn: THREE.Vector3[];
  laneOut: THREE.Vector3[];
  /** Ground the walker may stand on: the street, sidewalks and lots (rough). */
  bounds: THREE.Box3;
  dispose(): void;
}

/** Town point (x right, y along Main Street) to the group's 3D frame. */
export const v3 = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, -y);

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** The big picture sign on a pole: emoji, one word, and the real name underneath when we have it. */
export function pictureSign(place: PlaceKind, realName?: string): THREE.Group {
  const p = PLACE_PICTURES[place];
  const tex = canvasTexture(512, 512, (g) => {
    g.fillStyle = p.color;
    g.beginPath();
    g.roundRect(10, 10, 492, 492, 56);
    g.fill();
    g.strokeStyle = '#fff';
    g.lineWidth = 16;
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '250px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    g.fillText(p.icon, 256, 200);
    g.fillStyle = '#fff';
    let size = 96;
    g.font = `900 ${size}px system-ui, sans-serif`;
    while (g.measureText(p.word).width > 450 && size > 40) g.font = `900 ${(size -= 4)}px system-ui, sans-serif`;
    g.fillText(p.word, 256, realName ? 380 : 400);
    if (realName) {
      let s2 = 44;
      g.font = `700 ${s2}px system-ui, sans-serif`;
      while (g.measureText(realName).width > 450 && s2 > 22) g.font = `700 ${(s2 -= 2)}px system-ui, sans-serif`;
      g.fillText(realName, 256, 460);
    }
  });
  const g = new THREE.Group();
  // Two faces back to back, so the picture reads the right way round from either side.
  const face = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  for (const turn of [0, Math.PI]) {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), face);
    board.position.y = 7.4;
    board.rotation.y = turn;
    board.name = 'board';
    g.add(board);
  }
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 5.4, 8), lit({ color: 0x8a8f96, metalness: 0.4, roughness: 0.5 }));
  pole.position.y = 2.7;
  g.add(pole);
  return g;
}

const box = (w: number, h: number, d: number, mat: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);

/** A flat strip along a polyline (town coordinates), from `a` to `b` metres off the centre line. */
function strip(line: { x: number; y: number }[], a: number, b: number, h: number, mat: THREE.Material, uvScale = 8): THREE.Mesh {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let run = 0;
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    const q = line[Math.min(line.length - 1, i + 1)];
    const o = line[Math.max(0, i - 1)];
    const dx = q.x - o.x;
    const dy = q.y - o.y;
    const l = Math.hypot(dx, dy) || 1;
    const rx = dy / l;
    const ry = -dx / l;
    if (i > 0) run += Math.hypot(p.x - line[i - 1].x, p.y - line[i - 1].y);
    for (const off of [a, b]) {
      const v = v3(p.x + rx * off, p.y + ry * off, h);
      pos.push(v.x, v.y, v.z);
      uv.push((off - a) / uvScale, run / uvScale);
    }
    if (i > 0) {
      const k = i * 2;
      // Wound to face up (map +y runs to -z, which mirrors the usual order).
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

export interface TownMaterials {
  asphalt: THREE.Material;
  lineYellow: THREE.Material;
}

/** Builds the town. `hd` false (Low, or the models not loaded yet) uses simple shapes for the buildings. */
export function buildTownWorld(layout: TownLayout, mats: TownMaterials, seed: number, crateCount: number): TownWorld {
  const rng = makeRng(seed);
  const group = new THREE.Group();
  group.name = 'town';
  const owned: THREE.Material[] = [];
  const mat = (p: THREE.MeshStandardMaterialParameters) => {
    const m = lit(p);
    owned.push(m);
    return m;
  };
  const concrete = mat({ color: 0xb9b2a4, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
  const lotMat = mat({ color: 0x6e6c6a, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
  const curb = mat({ color: 0xd8d2c4 });
  const line = layout.line;
  // Main Street, its centre line and sidewalks.
  group.add(strip(line, -STREET_HALF, STREET_HALF, 0.1, mats.asphalt));
  const dashes: { x: number; y: number }[][] = [];
  for (let d = 6; d < layout.length - 4; d += 9) {
    const a = pointAlong(line, d).p;
    const b = pointAlong(line, d + 4).p;
    dashes.push([a, b]);
  }
  for (const [a, b] of dashes) group.add(strip([a, b], -0.12, 0.12, 0.13, mats.lineYellow, 1));
  for (const s of [-1, 1]) {
    const sw = strip(line, s * STREET_HALF, s * (STREET_HALF + SIDEWALK), 0.22, concrete);
    group.add(sw);
    group.add(strip(line, s * STREET_HALF, s * (STREET_HALF + 0.25), 0.26, curb, 1));
  }
  // Street lights every 30 m, on alternating sides.
  const postMat = mat({ color: 0x6c7076, metalness: 0.5, roughness: 0.5 });
  const lampMat = mat({ color: 0xfff1c8, emissive: 0xffd890, emissiveIntensity: 0.3 });
  for (let d = 20, k = 0; d < layout.length; d += 30, k++) {
    const s = k % 2 ? 1 : -1;
    if (layout.lots.some((l) => l.side === s && Math.abs(l.along - d) < LOT_ALONG / 2 + 2)) continue;
    const { p, dir } = pointAlong(line, d);
    const rx = dir.y;
    const ry = -dir.x;
    const base = v3(p.x + rx * s * (STREET_HALF + 1), p.y + ry * s * (STREET_HALF + 1));
    const post = box(0.2, 6, 0.2, postMat);
    post.position.copy(base).setY(3);
    group.add(post);
    const head = box(1.4, 0.2, 0.4, lampMat);
    head.position.copy(base).add(v3(-rx * s * 0.6, -ry * s * 0.6, 6));
    group.add(head);
  }
  // Cross streets with name blades.
  for (const c of layout.crossings) {
    const { p, dir } = pointAlong(line, c.along);
    const rx = dir.y;
    const ry = -dir.x;
    const cross = [
      { x: p.x - rx * 60, y: p.y - ry * 60 },
      { x: p.x + rx * 60, y: p.y + ry * 60 },
    ];
    group.add(strip(cross, -3.6, 3.6, 0.09, mats.asphalt));
    const blade = textSprite(c.name, '', '#1f6b3a');
    blade.scale.set(4.2, 1.6, 1);
    blade.position.copy(v3(p.x + rx * (STREET_HALF + 1.5) - dir.x * 5, p.y + ry * (STREET_HALF + 1.5) - dir.y * 5, 3.6));
    group.add(blade);
  }

  // Lots.
  const spots: TownSpot[] = [];
  for (const lot of layout.lots) {
    const { p, dir } = pointAlong(line, lot.along);
    const s = lot.side;
    // The lot's own frame: `out` away from the street, `fwd` along it.
    const fwd = new THREE.Vector3(dir.x, 0, -dir.y);
    const out = new THREE.Vector3(dir.y * s, 0, dir.x * s);
    const at = (o: number, a: number, h = 0) => v3(p.x, p.y, h).addScaledVector(out, o).addScaledVector(fwd, a);
    const g = new THREE.Group();
    g.name = `lot:${lot.place}`;
    group.add(g);
    // Paving for the lot, a driveway across the sidewalk.
    const lotLine = [
      { x: p.x + dir.y * s * LOT_NEAR, y: p.y - dir.x * s * LOT_NEAR },
      { x: p.x + dir.y * s * (LOT_NEAR + LOT_DEPTH), y: p.y - dir.x * s * (LOT_NEAR + LOT_DEPTH) },
    ];
    void lotLine;
    const pave = new THREE.Mesh(new THREE.PlaneGeometry(LOT_ALONG, LOT_DEPTH + SIDEWALK), lotMat);
    pave.rotation.x = -Math.PI / 2;
    pave.rotation.z = Math.atan2(-fwd.z, fwd.x);
    pave.position.copy(at(STREET_HALF + (LOT_DEPTH + SIDEWALK) / 2, 0, 0.16));
    pave.receiveShadow = true;
    g.add(pave);
    // The building, facing the street, at the back of the lot.
    const yawToStreet = Math.atan2(-out.x, -out.z);
    const width = lot.place === 'junkyard' ? 18 : lot.place === 'motel' ? 16 : 14;
    const hd = placeBuilding(lot.place, width, 13);
    let shell: THREE.Object3D;
    let size: THREE.Vector3;
    if (hd) {
      shell = hd;
      size = (hd.userData.size as THREE.Vector3).clone();
    } else {
      shell = codeBuilding(lot.place, width, mat);
      size = new THREE.Vector3(width, 5, 11);
    }
    const back = LOT_NEAR + LOT_DEPTH - size.z / 2 - 1.5;
    shell.position.copy(at(back, 0));
    shell.rotation.y = yawToStreet;
    shell.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = m.receiveShadow = true;
    });
    g.add(shell);
    const front = back - size.z / 2;
    const door = at(front - 1.8, 0);
    const inside = at(front + 2.2, 0);
    // The big picture sign at the corner of the lot, angled toward cars coming up the street.
    const sign = pictureSign(lot.place, lot.name);
    sign.position.copy(at(LOT_NEAR + 1.2, -LOT_ALONG / 2 + 2.5));
    sign.rotation.y = Math.atan2(-fwd.x, -fwd.z) + s * -0.6;
    g.add(sign);
    let park: THREE.Vector3[];
    let pump: THREE.Vector3 | undefined;
    if (lot.place === 'pumps') {
      // A big red canopy over a pump island: you drive under it, alongside the pump.
      const canopyMat = mat({ color: 0xc8302a, roughness: 0.6 });
      const under = mat({ color: 0xf2efe8, emissive: 0xfff4dc, emissiveIntensity: 0.25 });
      const white = mat({ color: 0xeeeeea, roughness: 0.5 });
      const cy = 5.4;
      const co = LOT_NEAR + 11;
      const canopy = box(13, 0.9, LOT_ALONG * 0.62, canopyMat);
      canopy.position.copy(at(co, 0, cy + 0.45));
      canopy.rotation.y = Math.atan2(fwd.x, fwd.z);
      canopy.castShadow = true;
      canopy.name = 'roof';
      g.add(canopy);
      const ceil = box(12.8, 0.05, LOT_ALONG * 0.6, under);
      ceil.position.copy(at(co, 0, cy - 0.02));
      ceil.rotation.y = canopy.rotation.y;
      ceil.name = 'roof';
      g.add(ceil);
      for (const a of [-7, 7]) for (const o of [-4.5, 4.5]) {
        const post = box(0.45, cy, 0.45, white);
        post.position.copy(at(co + o, a, cy / 2));
        g.add(post);
      }
      const island = box(1.4, 0.3, 8, white);
      island.position.copy(at(co + 1.5, 0, 0.3));
      island.rotation.y = canopy.rotation.y;
      g.add(island);
      const pumpMat = mat({ color: 0xc8302a, roughness: 0.5 });
      const screen = mat({ color: 0x223344, emissive: 0x335577, emissiveIntensity: 0.5 });
      for (const a of [-2.2, 2.2]) {
        const pm = box(0.9, 1.9, 0.7, pumpMat);
        pm.position.copy(at(co + 1.5, a, 1.25));
        pm.rotation.y = canopy.rotation.y;
        pm.castShadow = true;
        g.add(pm);
        const sc = box(0.92, 0.45, 0.4, screen);
        sc.position.copy(at(co + 1.5, a, 1.75));
        sc.rotation.y = canopy.rotation.y;
        g.add(sc);
      }
      pump = at(co + 0.2, 2.2);
      // In from the street, curve under the canopy and stop beside the pump facing up the street.
      park = [at(STREET_HALF - 1.2, -18), at(LOT_NEAR + 3, -11), at(co - 1.6, -4), at(co - 1.6, 1.5)];
    } else {
      park = [at(STREET_HALF - 1.2, -14), at(LOT_NEAR + 2, -5), at(front - 6.5, -3.5)];
      // Face the building: the last step points at the door.
      park.push(at(front - 5, -3.5));
    }
    if (lot.place === 'motel') {
      // A pool out front: the kid's clue it's a motel, with the bed inside.
      const rim = box(7, 0.35, 4.6, mat({ color: 0xf4f1ea }));
      rim.position.copy(at(LOT_NEAR + 6, 9, 0.2));
      rim.rotation.y = Math.atan2(fwd.x, fwd.z);
      g.add(rim);
      const water = new THREE.Mesh(new THREE.PlaneGeometry(4, 6.4), mat({ color: 0x3fb6e8, roughness: 0.15, emissive: 0x0a3550, emissiveIntensity: 0.4 }));
      water.rotation.x = -Math.PI / 2;
      water.rotation.z = Math.atan2(-fwd.z, fwd.x);
      water.position.copy(at(LOT_NEAR + 6, 9, 0.39));
      g.add(water);
    }
    // The room inside, built now but hidden until you walk in.
    const room = new THREE.Group();
    room.visible = false;
    room.position.copy(at(back, 0));
    room.rotation.y = yawToStreet;
    furnish(room, lot.place, size, mat);
    const crates: THREE.Group[] = [];
    const spotsIn: [number, number][] = [
      [-size.x / 2 + 2, -size.z / 2 + 1.8],
      [size.x / 2 - 2.2, -size.z / 2 + 2.4],
      [-size.x / 2 + 2.6, size.z / 2 - 3.2],
      [size.x / 2 - 2.4, size.z / 2 - 3.6],
    ];
    for (const [x, z] of spotsIn.slice(0, crateCount)) {
      const c = crate(mat);
      c.position.set(x, 0.12, z);
      room.add(c);
      crates.push(c);
    }
    g.add(room);
    spots.push({
      lot,
      group: g,
      shell,
      room,
      park,
      door,
      inside,
      crates,
      pump,
      centre: at(back, 0),
      size,
      facing: out.clone().negate(),
      sign,
    });
  }

  // Houses in the gaps.
  for (const hs of layout.houses) {
    const { p, dir } = pointAlong(line, hs.along);
    const out = new THREE.Vector3(dir.y * hs.side, 0, dir.x * hs.side);
    const name = HD_HOUSES[Math.floor(rng() * HD_HOUSES.length)];
    const h = fitted(name, 11, 11) ?? houseFallback(rng, mat);
    h.position.copy(v3(p.x, p.y)).addScaledVector(out, LOT_NEAR + 9 + rng() * 3);
    h.rotation.y = Math.atan2(-out.x, -out.z) + (rng() - 0.5) * 0.15;
    h.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = m.receiveShadow = true;
    });
    group.add(h);
  }
  // A "back to the highway" sign where Main Street ends, with a turning circle.
  const end = pointAlong(line, layout.length);
  const circle = new THREE.Mesh(new THREE.CircleGeometry(11, 24), mats.asphalt);
  circle.rotation.x = -Math.PI / 2;
  circle.position.copy(v3(end.p.x, end.p.y, 0.1));
  group.add(circle);

  const street = line.map((q) => v3(q.x, q.y));
  const lane = (off: number) =>
    line.map((q, i) => {
      const a = line[Math.max(0, i - 1)];
      const b = line[Math.min(line.length - 1, i + 1)];
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return v3(q.x + ((b.y - a.y) / l) * off, q.y - ((b.x - a.x) / l) * off);
    });
  const bounds = new THREE.Box3().setFromObject(group);
  return {
    layout,
    group,
    spots,
    street,
    laneIn: lane(2.2),
    laneOut: lane(-2.2),
    bounds,
    dispose() {
      for (const m of owned) m.dispose();
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if (!m.geometry.userData.shared && !m.userData.sharedModel) m.geometry.dispose();
        const mm = m.material as THREE.MeshBasicMaterial;
        if (mm && !mm.userData.shared && mm.map && (mm.map as THREE.CanvasTexture).isCanvasTexture) {
          mm.map.dispose();
          mm.dispose();
        }
      });
    },
  };
}

/** Simple building for Low graphics or before the models load: walls, roof, door, the place's colour. */
function codeBuilding(place: PlaceKind, w: number, mat: (p: THREE.MeshStandardMaterialParameters) => THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const c = new THREE.Color(PLACE_BUILDINGS[place].color);
  const d = 11;
  const h = place === 'motel' ? 4.2 : 5;
  const walls = box(w, h, d, mat({ color: 0xe6dcc8 }));
  walls.position.y = h / 2;
  g.add(walls);
  const trim = box(w + 0.6, 0.7, d + 0.6, mat({ color: c }));
  trim.position.y = h + 0.3;
  g.add(trim);
  const door = box(2.2, 2.8, 0.1, mat({ color: 0x5a3a22 }));
  door.position.set(0, 1.4, d / 2 + 0.05);
  g.add(door);
  for (const x of [-w / 4 - 1, w / 4 + 1]) {
    const win = box(w / 4, 1.8, 0.1, mat({ color: 0x9fd4ee, emissive: 0x223344, emissiveIntensity: 0.4 }));
    win.position.set(x, 2.2, d / 2 + 0.05);
    g.add(win);
  }
  return g;
}

function houseFallback(rng: () => number, mat: (p: THREE.MeshStandardMaterialParameters) => THREE.Material): THREE.Object3D {
  const names: ModelName[] = ['house-1', 'house-2', 'house-3', 'house-4', 'house-5'];
  const m = modelMesh(names[Math.floor(rng() * names.length)]);
  if (m) return m;
  const g = new THREE.Group();
  const b = box(9, 5, 8, mat({ color: new THREE.Color().setHSL(0.08 + rng() * 0.05, 0.25, 0.7) }));
  b.position.y = 2.5;
  g.add(b);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(7, 2.6, 4), mat({ color: 0x6b4a3a }));
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 6.3;
  g.add(roof);
  return g;
}

function crate(mat: (p: THREE.MeshStandardMaterialParameters) => THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.name = 'crate';
  const wood = mat({ color: 0xb88a4a, roughness: 0.85 });
  const band = mat({ color: 0x7a5a30 });
  const body = box(1.3, 1.0, 1.1, wood);
  body.position.y = 0.5;
  body.castShadow = true;
  g.add(body);
  const b1 = box(1.34, 0.14, 0.22, band);
  b1.position.y = 0.75;
  g.add(b1);
  const lid = box(1.36, 0.16, 1.16, wood);
  lid.position.y = 1.08;
  lid.name = 'lid';
  g.add(lid);
  return g;
}

/** Furniture a 5-year-old can name: a bed in the motel, a car on a lift in the garage, fruit at the grocery. */
function furnish(g: THREE.Group, place: PlaceKind, size: THREE.Vector3, mat: (p: THREE.MeshStandardMaterialParameters) => THREE.Material): void {
  const w = size.x;
  const d = size.z;
  const add = (m: THREE.Mesh, x: number, y: number, z: number) => {
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const room = {
    pumps: [0xf1ebdc, 0x9a9a96], motel: [0xf2d6e4, 0x8a6a7a], grocery: [0xe9e2c8, 0xbab3a0], garage: [0xc9ccd1, 0x6d6d70],
    hardware: [0xe0cba6, 0x9a8a72], gunshop: [0xb39a7a, 0x7a6650], pharmacy: [0xe4f0ee, 0xb6c2c0], police: [0xc8cfe0, 0x7d8494],
    junkyard: [0x9a8a72, 0x6b5a45], barn: [0xb04a3a, 0xb8a070],
  }[place];
  // Floor and low walls: a dollhouse with the roof and front lifted off.
  add(box(w, 0.16, d, mat({ color: room[1] })), 0, 0.08, 0);
  const wall = mat({ color: room[0] });
  add(box(w, 2.4, 0.3, wall), 0, 1.2, -d / 2);
  add(box(0.3, 2.4, d, wall), -w / 2, 1.2, 0);
  add(box(0.3, 2.4, d, wall), w / 2, 1.2, 0);
  add(box(w / 2 - 1.4, 0.9, 0.3, wall), -w / 4 - 0.7, 0.45, d / 2);
  add(box(w / 2 - 1.4, 0.9, 0.3, wall), w / 4 + 0.7, 0.45, d / 2);
  const light = new THREE.PointLight(0xfff0d0, 18, 22, 1.4);
  light.position.set(0, 4.5, 0);
  g.add(light);
  if (place === 'motel') {
    add(box(3.2, 0.7, 4.4, mat({ color: 0x6b4a2a })), -1, 0.45, -d / 2 + 2.6);
    add(box(3.0, 0.4, 4.2, mat({ color: 0xffffff })), -1, 0.95, -d / 2 + 2.6);
    add(box(3.05, 0.45, 2.8, mat({ color: 0x5b9fe8 })), -1, 1.0, -d / 2 + 3.4);
    for (const x of [-1.7, -0.3]) add(box(1.1, 0.35, 0.8, mat({ color: 0xffffff })), x, 1.25, -d / 2 + 1.0);
    add(box(0.8, 0.8, 0.8, mat({ color: 0x6b4a2a })), 1.4, 0.5, -d / 2 + 0.9);
    add(box(0.6, 0.6, 0.6, mat({ color: 0xffe08a, emissive: 0xffd070, emissiveIntensity: 0.6 })), 1.4, 1.2, -d / 2 + 0.9);
    add(box(2.2, 1.3, 0.2, mat({ color: 0x111111 })), 4.2, 1.7, -d / 2 + 0.3);
  } else if (place === 'garage') {
    const yellow = mat({ color: 0xffc94a, metalness: 0.3, roughness: 0.5 });
    for (const x of [-2.6, 2.6]) add(box(0.4, 2.2, 0.4, yellow), x, 1.1, -0.8);
    add(box(5.6, 0.2, 3, yellow), 0, 2.2, -0.8);
    const car = modelMesh('car-sedan');
    if (car) {
      car.rotation.y = Math.PI / 2;
      car.position.set(0, 2.3, -0.8);
      g.add(car);
    }
    add(box(6, 1.8, 0.1, mat({ color: 0xb0805a })), 0, 1.6, -d / 2 + 0.25);
    for (const x of [w / 2 - 1.2, w / 2 - 2.4]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.3, 12), mat({ color: 0x2f5f9f })), x, 0.75, 1.5);
  } else if (place === 'grocery' || place === 'pumps' || place === 'pharmacy' || place === 'hardware') {
    const colors = place === 'grocery' ? [0xe0302a, 0x4fd17a, 0xffc94a, 0xff8a2a] : [0xd13b2c, 0x5b9fe8, 0xffc94a, 0x7a4fd1];
    for (const x of [-2, 2]) {
      add(box(1.2, 1.8, d * 0.45, mat({ color: 0x8a6a4a })), x, 0.95, -0.6);
      for (let r = 0; r < 3; r++)
        for (let i = 0; i < 4; i++) {
          const item = place === 'grocery' ? new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), mat({ color: colors[(i + r) % 4] })) : box(0.4, 0.45, 0.3, mat({ color: colors[(i + r) % 4] }));
          add(item, x + 0.62, 0.5 + r * 0.55, -0.6 - d * 0.18 + i * (d * 0.12));
        }
    }
    add(box(2.6, 2.2, 1, mat({ color: 0xe8e8ee })), w / 2 - 1.8, 1.1, -d / 2 + 0.8);
  } else if (place === 'police') {
    add(box(3, 0.9, 1.2, mat({ color: 0x4a5266 })), -2, 0.45, -1);
    for (let i = 0; i < 6; i++) add(box(0.12, 2.2, 0.12, mat({ color: 0x777777, metalness: 0.6 })), w / 2 - 3.5 + i * 0.5, 1.1, -d / 2 + 2.5);
  } else {
    for (const x of [-2, 2]) add(box(1.2, 1.8, d * 0.45, mat({ color: 0x6b4a2a })), x, 0.95, -0.6);
  }
}
