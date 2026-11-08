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
  const tex = signTexture(place, realName);
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

/** The sign's picture: emoji, one word, and the real name underneath when we have it. */
function signTexture(place: PlaceKind, realName?: string): THREE.CanvasTexture {
  const p = PLACE_PICTURES[place];
  return canvasTexture(512, 512, (g) => {
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
    // Flush with the street, like the highway's sidewalks: a raised slab with no side reads as floating.
    const sw = strip(line, s * STREET_HALF, s * (STREET_HALF + SIDEWALK), 0.12, concrete);
    group.add(sw);
    group.add(strip(line, s * STREET_HALF, s * (STREET_HALF + 0.25), 0.14, curb, 1));
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
      const c = container(CONTAINERS[lot.place], mat);
      c.position.set(x, FLOOR_Y, z);
      // Face into the room, so the lid or door opens toward the camera side.
      c.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
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

type Mat = (p: THREE.MeshStandardMaterialParameters) => THREE.Material;

/** Top of a room's floor: above the lot's paving (0.16 m), which would otherwise show through. */
const FLOOR_Y = 0.26;

/** The glow under every unopened box, shared so they all pulse together (town play sets its opacity). */
export const CRATE_GLOW = new THREE.MeshBasicMaterial({ color: 0xff9a1a, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false });
CRATE_GLOW.userData.shared = true;

/** What you search in each place: a toolbox in the garage, a fridge at the grocery, a cabinet at the drugstore. */
export type ContainerKind = 'toolbox' | 'fridge' | 'cabinet' | 'locker' | 'ammo' | 'suitcase' | 'crate';
export const CONTAINERS: Record<PlaceKind, ContainerKind> = {
  garage: 'toolbox',
  hardware: 'toolbox',
  junkyard: 'toolbox',
  grocery: 'fridge',
  pumps: 'fridge',
  pharmacy: 'cabinet',
  police: 'locker',
  gunshop: 'ammo',
  motel: 'suitcase',
  barn: 'crate',
};

/**
 * Something to search, named 'crate'. Its 'lid' (a lid, door or drawer) knows how it opens
 * (userData.open: position and rotation), and a 'glow' ring on the floor shows it's not opened yet.
 */
function container(kind: ContainerKind, mat: Mat): THREE.Group {
  const g = new THREE.Group();
  g.name = 'crate';
  g.userData.kind = kind;
  const part = (m: THREE.Mesh, x: number, y: number, z: number, to: THREE.Object3D = g) => {
    m.position.set(x, y, z);
    m.castShadow = true;
    to.add(m);
    return m;
  };
  const lid = new THREE.Group();
  lid.name = 'lid';
  g.add(lid);
  let open = { pos: new THREE.Vector3(), rot: new THREE.Euler() };
  let foot = 1.6;
  if (kind === 'toolbox' || kind === 'ammo') {
    // A big red toolbox (green for the ammo box): the lid flips back on its hinge.
    const c = kind === 'toolbox' ? 0xd13b2c : 0x4f6b3a;
    part(box(1.4, 0.8, 0.9, mat({ color: c, metalness: 0.4, roughness: 0.45 })), 0, 0.4, 0);
    part(box(1.42, 0.08, 0.92, mat({ color: 0x333333, metalness: 0.6 })), 0, 0.62, 0);
    lid.position.set(0, 0.8, -0.45);
    part(box(1.44, 0.2, 0.94, mat({ color: c, metalness: 0.4, roughness: 0.45 })), 0, 0.1, 0.47, lid);
    part(box(0.6, 0.08, 0.1, mat({ color: 0x222222 })), 0, 0.26, 0.47, lid);
    if (kind === 'ammo') part(box(0.5, 0.3, 0.02, mat({ color: 0xffd04a })), 0, 0.42, 0.46);
    open = { pos: lid.position.clone(), rot: new THREE.Euler(-1.9, 0, 0) };
  } else if (kind === 'fridge') {
    // A white fridge with a see-through glowing door that swings open.
    part(box(1.2, 2.0, 0.9, mat({ color: 0xf2f4f6, roughness: 0.35 })), 0, 1.0, 0);
    const food = [0xe0302a, 0x4fd17a, 0xffc94a, 0x5b9fe8];
    for (let r = 0; r < 3; r++) for (let i = 0; i < 3; i++) part(box(0.26, 0.3, 0.26, mat({ color: food[(r + i) % 4] })), -0.35 + i * 0.35, 0.45 + r * 0.55, 0.15);
    lid.position.set(0.6, 0, 0.46);
    part(box(1.2, 2.0, 0.06, mat({ color: 0xbfe6ff, transparent: true, opacity: 0.45, emissive: 0x88ccff, emissiveIntensity: 0.5 })), -0.6, 1.0, 0, lid);
    part(box(0.06, 0.8, 0.08, mat({ color: 0x888888, metalness: 0.7 })), -1.1, 1.1, 0.06, lid);
    open = { pos: lid.position.clone(), rot: new THREE.Euler(0, 1.9, 0) };
    foot = 1.8;
  } else if (kind === 'cabinet' || kind === 'locker') {
    // A cabinet (white with a red cross) or a blue locker: the drawer slides out.
    const c = kind === 'cabinet' ? 0xf4f6f6 : 0x3f5f9f;
    part(box(1.2, 1.5, 0.8, mat({ color: c, metalness: 0.3, roughness: 0.4 })), 0, 0.75, 0);
    if (kind === 'cabinet') {
      const red = mat({ color: 0xe0302a });
      part(box(0.5, 0.14, 0.02, red), 0, 1.25, 0.41);
      part(box(0.14, 0.5, 0.02, red), 0, 1.25, 0.41);
    } else for (const y of [1.1, 1.25, 1.4]) part(box(0.8, 0.04, 0.02, mat({ color: 0x223355 })), 0, y, 0.41);
    lid.position.set(0, 0.45, 0.05);
    part(box(1.1, 0.5, 0.8, mat({ color: c, metalness: 0.3, roughness: 0.4 })), 0, 0, 0, lid);
    part(box(0.5, 0.08, 0.08, mat({ color: 0x555555, metalness: 0.7 })), 0, 0, 0.44, lid);
    open = { pos: new THREE.Vector3(0, 0.45, 0.65), rot: new THREE.Euler() };
  } else if (kind === 'suitcase') {
    // A suitcase on the floor: the top flips open.
    part(box(1.4, 0.35, 1.0, mat({ color: 0x8a4fd1, roughness: 0.6 })), 0, 0.18, 0);
    lid.position.set(0, 0.35, -0.5);
    part(box(1.4, 0.3, 1.0, mat({ color: 0x8a4fd1, roughness: 0.6 })), 0, 0.15, 0.5, lid);
    part(box(0.5, 0.1, 0.12, mat({ color: 0x222222 })), 0, 0.15, 1.04, lid);
    open = { pos: lid.position.clone(), rot: new THREE.Euler(-1.8, 0, 0) };
  } else {
    // A wooden crate: the lid lifts and tips back.
    const wood = mat({ color: 0xb88a4a, roughness: 0.85 });
    part(box(1.3, 1.0, 1.1, wood), 0, 0.5, 0);
    part(box(1.34, 0.14, 0.22, mat({ color: 0x7a5a30 })), 0, 0.75, 0);
    lid.position.set(0, 1.0, -0.55);
    part(box(1.36, 0.16, 1.16, mat({ color: 0xb88a4a, roughness: 0.85 })), 0, 0.08, 0.55, lid);
    open = { pos: new THREE.Vector3(0, 1.4, -0.6), rot: new THREE.Euler(-1.2, 0, 0) };
  }
  lid.userData.closed = { pos: lid.position.clone(), rot: lid.rotation.clone() };
  lid.userData.open = open;
  // A glowing ring on the floor: "this one still has something in it".
  const ring = new THREE.Mesh(new THREE.RingGeometry(foot * 0.55, foot * 0.75, 32), CRATE_GLOW);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  ring.name = 'glow';
  g.add(ring);
  // Remember each colour, so an emptied one can go dark and come back for the next visit.
  g.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m && o !== ring && m.color && m.userData.base === undefined) m.userData.base = m.color.getHex();
  });
  return g;
}

/** A floor you can tell apart: tiles in shops, concrete in the garage, planks in the motel and barn. */
function floorTexture(place: PlaceKind, w: number, d: number): THREE.CanvasTexture {
  const look: Record<PlaceKind, [string, string, 'tile' | 'concrete' | 'planks']> = {
    grocery: ['#f2efe6', '#d9d2c0', 'tile'],
    pumps: ['#efece4', '#c9c3b6', 'tile'],
    pharmacy: ['#f4fbfa', '#cfe3e0', 'tile'],
    police: ['#cfd5e2', '#aab2c4', 'tile'],
    garage: ['#8b8c8f', '#77787b', 'concrete'],
    hardware: ['#a39b8c', '#8e8676', 'concrete'],
    junkyard: ['#7d7062', '#665a4c', 'concrete'],
    gunshop: ['#8a6a4a', '#6f5238', 'planks'],
    motel: ['#a8774f', '#8f6340', 'planks'],
    barn: ['#9a7448', '#7f5e38', 'planks'],
  };
  const [a, b, kind] = look[place];
  const tex = canvasTexture(256, 256, (g) => {
    g.fillStyle = a;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = b;
    if (kind === 'tile') {
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2) g.fillRect(x * 64, y * 64, 64, 64);
    } else if (kind === 'planks') {
      for (let y = 0; y < 8; y++) {
        g.fillRect(0, y * 32, 256, 3);
        g.fillRect(((y * 97) % 256), y * 32, 3, 32);
      }
    } else {
      for (let i = 0; i < 260; i++) g.fillRect((i * 151) % 256, (i * 89) % 256, 2 + (i % 3), 2 + (i % 2));
      g.fillRect(0, 126, 256, 3);
      g.fillRect(126, 0, 3, 256);
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(w / 4, d / 4);
  return tex;
}

/** Furniture a 5-year-old can name, so every place has its own room: a car on a lift in the garage,
 * shelves of fruit and a till at the grocery, a bed in the motel, hay in the barn. */
function furnish(g: THREE.Group, place: PlaceKind, size: THREE.Vector3, mat: Mat): void {
  const w = size.x;
  const d = size.z;
  const add = (m: THREE.Object3D, x: number, y: number, z: number) => {
    m.position.set(x, y, z);
    m.traverse((o) => ((o as THREE.Mesh).castShadow = (o as THREE.Mesh).receiveShadow = true));
    g.add(m);
    return m;
  };
  const walls: Record<PlaceKind, [number, number]> = {
    pumps: [0xf1ebdc, 0xc8302a], motel: [0xf2d6e4, 0x8a6a7a], grocery: [0xe9f2d8, 0x4fa04f], garage: [0xc9ccd1, 0xffc94a],
    hardware: [0xe0cba6, 0xd1772c], gunshop: [0xb39a7a, 0x4f6b3a], pharmacy: [0xe4f0ee, 0xe0302a], police: [0xc8cfe0, 0x2f4f8f],
    junkyard: [0x9a8a72, 0x7a5a30], barn: [0xb04a3a, 0xf4f1ea],
  };
  const [wallC, trimC] = walls[place];
  // Floor and low walls: a dollhouse with the roof and front lifted off.
  // Its top sits above the lot's paving (FLOOR_Y), or the paving shows through.
  add(box(w, FLOOR_Y, d, mat({ color: 0xffffff, map: floorTexture(place, w, d), roughness: 0.8 })), 0, FLOOR_Y / 2, 0);
  const wall = mat({ color: wallC });
  const trim = mat({ color: trimC });
  add(box(w, 2.4, 0.3, wall), 0, 1.2, -d / 2);
  add(box(0.3, 2.4, d, wall), -w / 2, 1.2, 0);
  add(box(0.3, 2.4, d, wall), w / 2, 1.2, 0);
  // A stripe of the place's colour along the walls.
  add(box(w, 0.35, 0.34, trim), 0, 2.25, -d / 2);
  add(box(0.34, 0.35, d, trim), -w / 2, 2.25, 0);
  add(box(0.34, 0.35, d, trim), w / 2, 2.25, 0);
  // The front: low walls either side of the doorway, an open door and a mat, so you see where you came in.
  add(box(w / 2 - 1.4, 0.9, 0.3, wall), -w / 4 - 0.7, 0.45, d / 2);
  add(box(w / 2 - 1.4, 0.9, 0.3, wall), w / 4 + 0.7, 0.45, d / 2);
  const frame = mat({ color: 0x5a3a22 });
  for (const x of [-1.4, 1.4]) add(box(0.25, 2.6, 0.35, frame), x, 1.3, d / 2);
  add(box(3.05, 0.3, 0.4, trim), 0, 2.65, d / 2);
  add(box(2.2, 0.03, 1.2, mat({ color: trimC, roughness: 0.95 })), 0, FLOOR_Y + 0.02, d / 2 - 0.9);
  // A big picture of the place on the back wall (the same as its sign out front).
  const poster = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: signTexture(place), toneMapped: false }));
  add(poster, 0, 1.55, -d / 2 + 0.17);
  // Warm light from above, and two lamps on the back wall.
  // Its strength is set by the time of day when you go in (TownPlay.goIn): the roof is off, so the sun lights it by day.
  const light = new THREE.PointLight(0xfff0d0, 22, 24, 1.3);
  light.name = 'roomLight';
  light.userData.full = 22;
  light.position.set(0, 5, 0);
  g.add(light);
  const lamp = mat({ color: 0xfff2c0, emissive: 0xffe0a0, emissiveIntensity: 1.2 });
  for (const x of [-w / 2 + 1.2, w / 2 - 1.2]) add(box(0.5, 0.3, 0.2, lamp), x, 2.0, -d / 2 + 0.25);

  const shelf = (x: number, z: number, len: number, colors: number[], round = false, turn = 0) => {
    const s = new THREE.Group();
    s.add(box(len, 1.6, 0.7, mat({ color: 0x8a6a4a })).translateY(0.8));
    for (let r = 0; r < 3; r++)
      for (let i = 0; i < Math.floor(len / 0.5); i++) {
        const m = round ? new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), mat({ color: colors[(i + r) % colors.length] })) : box(0.34, 0.36, 0.3, mat({ color: colors[(i + r) % colors.length] }));
        m.position.set(-len / 2 + 0.3 + i * 0.5, 0.45 + r * 0.5, 0.42);
        s.add(m);
      }
    s.rotation.y = turn;
    return add(s, x, FLOOR_Y, z);
  };
  const counter = (x: number, z: number, len: number, c: number) => {
    add(box(len, 1.0, 0.8, mat({ color: c })), x, 0.66, z);
    add(box(len + 0.1, 0.08, 0.9, mat({ color: 0xeeeeee })), x, 1.2, z);
  };
  const tire = (x: number, y: number, z: number) => {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.18, 8, 16), mat({ color: 0x222222, roughness: 0.9 }));
    t.rotation.x = Math.PI / 2;
    return add(t, x, y, z);
  };
  const drum = (x: number, z: number, c: number) => add(new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.2, 12), mat({ color: c, metalness: 0.3 })), x, 0.76, z);

  if (place === 'motel') {
    add(box(3.2, 0.7, 4.4, mat({ color: 0x6b4a2a })), -1, 0.5, -d / 2 + 2.6);
    add(box(3.0, 0.4, 4.2, mat({ color: 0xffffff })), -1, 1.0, -d / 2 + 2.6);
    add(box(3.05, 0.45, 2.8, mat({ color: 0x5b9fe8 })), -1, 1.05, -d / 2 + 3.4);
    for (const x of [-1.7, -0.3]) add(box(1.1, 0.35, 0.8, mat({ color: 0xffffff })), x, 1.3, -d / 2 + 1.0);
    add(box(0.8, 0.8, 0.8, mat({ color: 0x6b4a2a })), 1.4, 0.56, -d / 2 + 0.9);
    add(box(0.6, 0.6, 0.6, mat({ color: 0xffe08a, emissive: 0xffd070, emissiveIntensity: 0.6 })), 1.4, 1.26, -d / 2 + 0.9);
    add(box(3.6, 0.03, 2.4, mat({ color: 0xd16a8a })), -1, 0.18, 0.8);
    add(box(2.2, 1.3, 0.2, mat({ color: 0x111111 })), 2.6, 1.6, -d / 2 + 0.3);
  } else if (place === 'garage') {
    const yellow = mat({ color: 0xffc94a, metalness: 0.3, roughness: 0.5 });
    for (const x of [-2.6, 2.6]) add(box(0.4, 2.2, 0.4, yellow), x, 1.1, -0.8);
    add(box(5.6, 0.2, 3, yellow), 0, 2.2, -0.8);
    const car = modelMesh('car-sedan');
    if (car) {
      car.rotation.y = Math.PI / 2;
      add(car, 0, 2.3, -0.8);
    }
    // Pegboard of tools on the back wall.
    add(box(5, 1.6, 0.08, mat({ color: 0xb0805a })), 0, 1.5, -d / 2 + 0.2);
    for (let i = 0; i < 7; i++) add(box(0.12, 0.7 - (i % 3) * 0.15, 0.06, mat({ color: [0xd13b2c, 0x5b9fe8, 0x888888][i % 3], metalness: 0.5 })), -2.1 + i * 0.7, 1.5, -d / 2 + 0.28);
    for (let k = 0; k < 4; k++) tire(-1, 0.36 + k * 0.36, 2.0);
    for (let k = 0; k < 3; k++) tire(0.2, 0.36 + k * 0.36, 2.2);
    for (const x of [1.6, 2.6]) drum(x, 1.6, 0x2f5f9f);
  } else if (place === 'grocery' || place === 'pumps') {
    const food = place === 'grocery' ? [0xe0302a, 0x4fd17a, 0xffc94a, 0xff8a2a] : [0xd13b2c, 0x5b9fe8, 0xffc94a, 0x7a4fd1];
    shelf(-1.6, -0.4, 3, food, place === 'grocery', Math.PI / 2);
    shelf(1.6, -0.4, 3, food, place === 'grocery', -Math.PI / 2);
    // Drinks fridges glowing along the back wall.
    for (const x of [-1.3, 0, 1.3]) {
      add(box(1.2, 2.0, 0.6, mat({ color: 0xdfe6ee })), x, 1.16, -d / 2 + 0.5);
      add(box(1.0, 1.7, 0.04, mat({ color: 0xbfe6ff, emissive: 0x88ccff, emissiveIntensity: 0.6 })), x, 1.2, -d / 2 + 0.82);
    }
    counter(0, d / 2 - 2.2, 2.4, 0x6b4a2a);
    add(box(0.6, 0.4, 0.5, mat({ color: 0x333333 })), 0.5, 1.45, d / 2 - 2.2);
  } else if (place === 'pharmacy') {
    shelf(-1.6, -0.4, 3, [0xffffff, 0x5b9fe8, 0xe0302a, 0x4fd17a], false, Math.PI / 2);
    shelf(1.6, -0.4, 3, [0xffffff, 0xffc94a, 0x7a4fd1, 0x5b9fe8], false, -Math.PI / 2);
    counter(0, -d / 2 + 1.4, 3.4, 0xf4f6f6);
    const red = mat({ color: 0xe0302a, emissive: 0xe0302a, emissiveIntensity: 0.4 });
    add(box(0.9, 0.3, 0.06, red), 2.6, 1.9, -d / 2 + 0.2);
    add(box(0.3, 0.9, 0.06, red), 2.6, 1.9, -d / 2 + 0.2);
  } else if (place === 'hardware') {
    shelf(-1.6, -0.4, 3, [0xd1772c, 0x5b9fe8, 0xffc94a, 0x4fa04f], false, Math.PI / 2);
    shelf(1.6, -0.4, 3, [0x888888, 0xd13b2c, 0xffffff, 0x333333], false, -Math.PI / 2);
    // Paint cans and a ladder.
    for (let i = 0; i < 4; i++) add(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.4, 12), mat({ color: [0xe0302a, 0x5b9fe8, 0xffc94a, 0x4fd17a][i] })), -1 + i * 0.6, 0.36, d / 2 - 2.2);
    const ladder = new THREE.Group();
    for (const x of [-0.35, 0.35]) ladder.add(box(0.08, 2.2, 0.08, mat({ color: 0xc0c4c8, metalness: 0.6 })).translateX(x).translateY(1.1));
    for (let k = 0; k < 5; k++) ladder.add(box(0.7, 0.06, 0.06, mat({ color: 0xc0c4c8, metalness: 0.6 })).translateY(0.3 + k * 0.42));
    ladder.rotation.x = -0.25;
    add(ladder, 0, 0.16, -d / 2 + 0.8);
  } else if (place === 'police') {
    add(box(2.4, 0.9, 1.2, mat({ color: 0x4a5266 })), -1.5, 0.6, -0.5);
    add(box(0.5, 0.35, 0.4, mat({ color: 0x222222 })), -1.5, 1.25, -0.5);
    // A cell with bars at the back.
    for (let i = 0; i < 7; i++) add(box(0.1, 2.2, 0.1, mat({ color: 0x777777, metalness: 0.7 })), 0.8 + i * 0.45, 1.26, -d / 2 + 2.2);
    add(box(3.2, 0.1, 0.1, mat({ color: 0x777777, metalness: 0.7 })), 2.15, 2.3, -d / 2 + 2.2);
    add(box(1.0, 1.2, 0.05, mat({ color: 0xffffff })), -3, 1.6, -d / 2 + 0.2);
  } else if (place === 'gunshop') {
    counter(0, -d / 2 + 1.4, 4, 0x6b4a2a);
    // Racks of ammo boxes behind the counter (no guns on show).
    for (let i = 0; i < 8; i++) add(box(0.5, 0.35, 0.3, mat({ color: i % 2 ? 0x4f6b3a : 0xc8a040 })), -1.8 + i * 0.5, 1.5 + (i % 2) * 0.4, -d / 2 + 0.3);
    add(box(2.0, 0.03, 1.4, mat({ color: 0x7a3a2a })), 0, 0.18, 0.6);
  } else if (place === 'junkyard') {
    for (let k = 0; k < 5; k++) tire(-2 + (k % 2) * 0.3, 0.36 + k * 0.36, -0.4);
    for (let k = 0; k < 3; k++) tire(1.8, 0.36 + k * 0.36, 1.2);
    for (const [x, z] of [[0.4, -1.2], [1.4, -1.4]] as [number, number][]) drum(x, z, 0x8a4a2a);
    add(box(2.6, 1.0, 1.4, mat({ color: 0x6f7f8f, metalness: 0.5, roughness: 0.7 })), 0, 0.66, 1.4).rotation.y = 0.3;
  } else if (place === 'barn') {
    const hay = mat({ color: 0xe8c860, roughness: 1 });
    for (const [x, y, z] of [[-1.8, 0.56, -0.8], [-0.6, 0.56, -0.8], [-1.2, 1.36, -0.8], [1.6, 0.56, 1.2]] as [number, number, number][]) add(box(1.1, 0.8, 0.7, hay), x, y, z);
    for (const x of [0.6, 1.2]) add(box(0.5, 0.7, 0.4, mat({ color: 0xd8ccb0 })), x, 0.51, -d / 2 + 0.6);
    add(box(0.12, 1.8, 0.12, mat({ color: 0x6b4a2a })), 2.2, 1.06, -d / 2 + 0.5).rotation.z = 0.3;
  }
}
