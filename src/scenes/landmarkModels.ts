import * as THREE from 'three';
import { lit } from './materials';
import type { Path } from '../geo/geo';
import { LANDMARK_TITLES, type Landmark } from '../game/landmarks';
import type { BiomeId } from '../game/biomes';
import { hashString, makeRng, range } from '../game/rng';
import { to3 } from './common';
import { boardSign } from './roadside';
import { hdBuilding, type HdBuilding } from './hdBuildings';

/**
 * Low-poly models for landmarks. Every material made here is owned by the
 * chunk that holds the model and is freed with it (userData.chunkOwned).
 */

const ROAD_HALF = 4.5;

function mat(color: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const m = lit({ color, ...extra });
  m.userData.chunkOwned = true;
  return m;
}

function basic(color: number, extra: THREE.MeshBasicMaterialParameters = {}): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color, ...extra });
  m.userData.chunkOwned = true;
  return m;
}

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  return o;
}

/** Frame of the road at a distance: position, forward and right vectors in three.js space. */
function frame(path: Path, at: number) {
  const p = path.pointAt(at);
  const f = path.directionAt(at, 8);
  return {
    p,
    fwd: new THREE.Vector3(f.x, 0, -f.y),
    right: new THREE.Vector3(f.y, 0, f.x),
  };
}

let waterTex: THREE.CanvasTexture | null = null;
/** Shared rippled water texture; DriveScene scrolls its offset to make rivers flow. */
export function waterTexture(): THREE.CanvasTexture {
  if (waterTex) return waterTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2f6fa8';
  g.fillRect(0, 0, 64, 128);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(200,230,255,${0.15 + Math.random() * 0.25})`;
    g.fillRect(Math.random() * 64, Math.random() * 128, 6 + Math.random() * 14, 2);
  }
  waterTex = new THREE.CanvasTexture(c);
  waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
  waterTex.colorSpace = THREE.SRGBColorSpace;
  return waterTex;
}

/** A meandering river crossing under the road, with a bridge and a name sign. */
function buildRiver(l: Landmark, path: Path, half = ROAD_HALF): THREE.Group {
  const g = new THREE.Group();
  const { p, fwd } = frame(path, l.at);
  const rng = makeRng(hashString(l.name + l.at));
  const width = l.real ? range(rng, 18, 34) : range(rng, 9, 16);
  const angle = l.angle ?? Math.PI / 2;
  // River direction: the road's forward vector rotated by the crossing angle.
  const dir = fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
  const across = new THREE.Vector3(-dir.z, 0, dir.x);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const centre = to3(p, 0.06);
  const n = 70;
  const len = 1400;
  const phase = rng() * 6;
  for (let i = 0; i <= n; i++) {
    const s = -len / 2 + (i / n) * len;
    // Meander, pinned straight where it passes under the bridge.
    const wiggle = Math.sin(s / 140 + phase) * 30 * Math.min(1, Math.abs(s) / 120);
    const c = centre.clone().addScaledVector(dir, s).addScaledVector(across, wiggle);
    const a = c.clone().addScaledVector(across, -width / 2);
    const b = c.clone().addScaledVector(across, width / 2);
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    uv.push(0, s / 30, 1, s / 30);
    if (i > 0) {
      const k = (i - 1) * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const water = mat(0xffffff, { map: waterTexture(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.DoubleSide });
  g.add(new THREE.Mesh(geo, water));
  // Bridge: deck sides and railings along the road where it crosses the water.
  const span = Math.min(80, width / Math.max(0.3, Math.sin(angle)) + 16);
  const steel = mat(0x7d8790);
  const concrete = mat(0xb9b2a5);
  for (const side of [-1, 1]) {
    for (let s = -span / 2; s <= span / 2; s += 2) {
      const f = frame(path, l.at + s);
      const base = to3(f.p).addScaledVector(f.right, side * (half + 0.4));
      const post = mesh(new THREE.BoxGeometry(0.25, 1.2, 0.25), steel);
      post.position.copy(base).setY(0.6);
      g.add(post);
    }
    const a = frame(path, l.at - span / 2);
    const b = frame(path, l.at + span / 2);
    const pa = to3(a.p).addScaledVector(a.right, side * (half + 0.4));
    const pb = to3(b.p).addScaledVector(b.right, side * (half + 0.4));
    const rail = mesh(new THREE.BoxGeometry(0.3, 0.3, pa.distanceTo(pb)), steel);
    rail.position.copy(pa).lerp(pb, 0.5).setY(1.2);
    rail.lookAt(pb.clone().setY(1.2));
    g.add(rail);
    const girder = mesh(new THREE.BoxGeometry(0.8, 1.6, pa.distanceTo(pb)), concrete);
    girder.position.copy(pa).lerp(pb, 0.5).setY(-0.6);
    girder.lookAt(pb.clone().setY(-0.6));
    g.add(girder);
  }
  // Blue river name sign before the bridge.
  const sf = frame(path, l.at - span / 2 - 30);
  const sign = boardSign(l.name, '', '#2a5f9e', 7, 2.6, 3.2);
  sign.position.copy(to3(sf.p).addScaledVector(sf.right, half + 4)).setY(0);
  sign.rotation.y = Math.atan2(-sf.fwd.x, -sf.fwd.z);
  g.add(sign);
  return g;
}

/** Rock, forest and snow colours for mountains by region. */
const MOUNTAIN_LOOK: Partial<Record<BiomeId, { low: number; high: number }>> = {
  pinewoods: { low: 0x34502f, high: 0x6d6f66 },
  forest: { low: 0x3f5f34, high: 0x6f7468 },
  tundra: { low: 0x5f6a5c, high: 0x8a8f88 },
  desert: { low: 0xa8643e, high: 0x8a5a44 },
  sagebrush: { low: 0x8a7a5e, high: 0x77706a },
};
const ROCK = { low: 0x55604c, high: 0x7a7a7e };

/**
 * One craggy mountain: a cone with its rim and slopes pushed about so it has ridges and
 * shoulders, coloured from trees or rock at the bottom to bare rock, with snow on tall ones.
 */
function craggy(rng: () => number, r: number, h: number, look: { low: number; high: number }, snow: boolean): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(r, h, 11, 5).toNonIndexed();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  // The same corner must move the same way in every face that shares it, or the slope tears.
  const moved = new Map<string, [number, number, number]>();
  const lo = new THREE.Color(look.low);
  const hi = new THREE.Color(look.high);
  const white = new THREE.Color(0xf2f5fa);
  const colors: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`;
    let m = moved.get(key);
    if (!m) {
      const t = (y + h / 2) / h; // 0 at the foot, 1 at the top
      const k = t > 0.98 ? 0 : 1 + (rng() - 0.5) * 0.55;
      m = [x * k, y + (t > 0.02 && t < 0.98 ? (rng() - 0.5) * h * 0.12 : 0), z * k];
      moved.set(key, m);
    }
    pos.setXYZ(i, m[0], m[1], m[2]);
    const t = (m[1] + h / 2) / h;
    c.copy(lo).lerp(hi, Math.min(1, t * 1.6));
    if (snow && t > 0.68) c.lerp(white, 0.9);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function mountainMat(): THREE.MeshStandardMaterial {
  return mat(0xffffff, { vertexColors: true, flatShading: true, roughness: 1 });
}

/** A real mountain: one main summit with lower shoulders either side, never wider than it is set back. */
function buildPeak(rng: () => number, biome?: BiomeId, ele?: number): THREE.Object3D {
  const g = new THREE.Group();
  const look = (biome && MOUNTAIN_LOOK[biome]) ?? ROCK;
  // Taller for taller real mountains (when the map says), within what fits the shrunk world.
  const h = ele != null ? Math.max(150, Math.min(380, ele / 10)) : range(rng, 200, 320);
  const r = h * range(rng, 0.7, 0.9);
  const m = mountainMat();
  const snow = (ele ?? 3000) > 2600 && biome !== 'desert';
  g.add(mesh(craggy(rng, r, h, look, snow), m, 0, h / 2 - 2, 0));
  for (let i = 0; i < 3; i++) {
    const hh = h * range(rng, 0.4, 0.7);
    g.add(mesh(craggy(rng, hh * 0.85, hh, look, snow && hh > 200), m, (i - 1) * r * 0.75 + range(rng, -20, 20), hh / 2 - 2, range(rng, -r * 0.5, -r * 0.1)));
  }
  return g;
}

/** A made-up range on the horizon: a row of uneven peaks, the middle ones tallest. */
function buildMountains(rng: () => number, biome?: BiomeId): THREE.Object3D {
  const g = new THREE.Group();
  const look = (biome && MOUNTAIN_LOOK[biome]) ?? ROCK;
  const m = mountainMat();
  const n = 4 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const mid = 1 - Math.abs(i - (n - 1) / 2) / n;
    const h = range(rng, 110, 220) * (0.7 + mid * 0.5);
    g.add(mesh(craggy(rng, h * range(rng, 0.8, 1.1), h, look, h > 190 && biome !== 'desert'), m, (i - (n - 1) / 2) * 130 + range(rng, -30, 30), h / 2 - 2, range(rng, -60, 60)));
  }
  return g;
}

/** A low, round, grassy hill with a few trees: what a "peak" is in flat country. */
function buildHill(rng: () => number): THREE.Object3D {
  const g = new THREE.Group();
  const r = range(rng, 55, 90);
  const h = range(rng, 18, 32);
  const dome = new THREE.SphereGeometry(r, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, h / r, 1);
  g.add(mesh(dome, mat(0x6a8a48, { flatShading: true, roughness: 1 }), 0, -1, 0));
  const leaf = mat(0x3f6a2e, { flatShading: true });
  const trunk = mat(0x6a4a2e);
  for (let i = 0; i < 6; i++) {
    const a = rng() * Math.PI * 2;
    const d = r * range(rng, 0.1, 0.6);
    const y = h * Math.sqrt(Math.max(0, 1 - (d / r) ** 2)) - 1.5;
    const s = range(rng, 4, 7);
    g.add(mesh(new THREE.CylinderGeometry(0.5, 0.7, s, 5), trunk, Math.cos(a) * d, y + s / 2, Math.sin(a) * d));
    g.add(mesh(new THREE.IcosahedronGeometry(s * 0.7, 0), leaf, Math.cos(a) * d, y + s * 1.1, Math.sin(a) * d));
  }
  return g;
}

/** Big scenery (mountains, hills, mesas) moved back from the road until its foot is this clear of it everywhere nearby. */
const SCENERY_CLEAR = 60;

/** Pushes a big shape away from the road until its foot is SCENERY_CLEAR from every bit of road near it (bends too). */
function keepOffRoad(model: THREE.Object3D, path: Path, at: number, away: THREE.Vector3, edge: number): void {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.z) / 2;
  const centre = box.getCenter(new THREE.Vector3());
  for (let tries = 0; tries < 6; tries++) {
    let worst = Infinity;
    for (let d = Math.max(0, at - radius * 2 - 200); d <= Math.min(path.length, at + radius * 2 + 200); d += 20) {
      const q = to3(path.pointAt(d));
      worst = Math.min(worst, Math.hypot(q.x - centre.x, q.z - centre.z));
    }
    const short = radius + edge + SCENERY_CLEAR - worst;
    if (short <= 0) return;
    const step = away.clone().setY(0).normalize().multiplyScalar(short + 10);
    model.position.add(step);
    centre.add(step);
  }
}

/** A flat-topped desert butte in layered red rock, set far back from the road. */
function buildMesa(rng: () => number): THREE.Object3D {
  const g = new THREE.Group();
  const h = range(rng, 45, 90);
  const r = range(rng, 60, 110);
  const layers = [0xb5603c, 0xc8794a, 0xa8553a, 0xd28e5c];
  let y = 0;
  for (let i = 0; i < 4; i++) {
    const lh = h / 4;
    const rr = r * (1 - i * 0.06);
    g.add(mesh(new THREE.CylinderGeometry(rr * 0.97, rr, lh, 9), mat(layers[i], { flatShading: true }), 0, y + lh / 2, 0));
    y += lh;
  }
  // A talus slope round the bottom.
  g.add(mesh(new THREE.CylinderGeometry(r, r * 1.35, h * 0.25, 9), mat(0xb87a55, { flatShading: true }), 0, h * 0.12, 0));
  g.scale.set(1, 1, range(rng, 0.5, 0.9));
  return g;
}

/** A few leaning, sun-bleached shacks and a false-front saloon. */
function buildGhostTown(rng: () => number): THREE.Object3D {
  const g = new THREE.Group();
  const wood = [0x8a7356, 0x6e5a43, 0x9c8669, 0x5d4c3a];
  for (let i = 0; i < 5; i++) {
    const w = range(rng, 5, 8);
    const h = range(rng, 3.5, 5);
    const d = range(rng, 5, 7);
    const shack = new THREE.Group();
    const color = wood[Math.floor(rng() * wood.length)];
    shack.add(mesh(new THREE.BoxGeometry(w, h, d), mat(color), 0, h / 2, 0));
    if (i === 2) {
      // The saloon's tall false front.
      shack.add(mesh(new THREE.BoxGeometry(w + 1, 3, 0.3), mat(color), 0, h + 1.2, d / 2));
    } else {
      const roof = mesh(new THREE.BoxGeometry(w + 0.6, 0.3, d * 0.62), mat(0x4a3d30), 0, h + 0.8, d * 0.2);
      roof.rotation.x = -0.5;
      shack.add(roof);
      const roof2 = roof.clone();
      roof2.position.z = -d * 0.2;
      roof2.rotation.x = 0.5;
      shack.add(roof2);
    }
    shack.add(mesh(new THREE.BoxGeometry(1.2, 2.2, 0.1), mat(0x2a221a), 0, 1.1, d / 2 + 0.03));
    shack.position.set((i - 2) * 10 + range(rng, -1, 1), 0, range(rng, -4, 4));
    shack.rotation.z = range(rng, -0.06, 0.06);
    shack.rotation.y = range(rng, -0.15, 0.15);
    g.add(shack);
  }
  // Tumbleweeds.
  for (let i = 0; i < 4; i++) g.add(mesh(new THREE.IcosahedronGeometry(0.6, 0), mat(0x9c8a5a, { wireframe: true }), range(rng, -20, 20), 0.6, range(rng, 6, 12)));
  return g;
}

/** A row of concrete grain silos with a tall head house. */
function buildGrainElevator(rng: () => number): THREE.Object3D {
  const g = new THREE.Group();
  const concrete = mat(0xd9d4c8);
  const n = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) g.add(mesh(new THREE.CylinderGeometry(3, 3, 26, 14), concrete, (i - (n - 1) / 2) * 6.2, 13, 0));
  const head = (n / 2) * 6.2 + 3;
  g.add(mesh(new THREE.BoxGeometry(6, 36, 7), concrete, head, 18, 0));
  g.add(mesh(new THREE.BoxGeometry(6.4, 4, 7.4), mat(0x9a9a92), head, 38, 0));
  g.add(mesh(new THREE.BoxGeometry(n * 6.2, 2, 6.8), mat(0xb8b2a4), 0, 27, 0));
  // A rail siding with a few hopper cars.
  for (let i = 0; i < 3; i++) g.add(mesh(new THREE.BoxGeometry(12, 3.4, 3), mat(i % 2 ? 0x7a3a28 : 0x4a5a6a), (i - 1) * 13, 2.2, 7));
  return g;
}

/** A forest fire lookout: a cabin with wraparound windows up on a steel tower. */
function buildLookout(): THREE.Object3D {
  const g = new THREE.Group();
  const steel = mat(0x7d8288);
  for (const [x, z] of [
    [-2.5, -2.5],
    [2.5, -2.5],
    [-2.5, 2.5],
    [2.5, 2.5],
  ]) {
    const leg = mesh(new THREE.CylinderGeometry(0.2, 0.25, 24, 5), steel, x * 0.8, 12, z * 0.8);
    leg.rotation.set(z * 0.012, 0, -x * 0.012);
    g.add(leg);
  }
  for (const y of [6, 12, 18]) g.add(mesh(new THREE.BoxGeometry(4.6, 0.2, 4.6), steel, 0, y, 0));
  g.add(mesh(new THREE.BoxGeometry(5, 0.4, 5), mat(0x6b5440), 0, 24.2, 0));
  g.add(mesh(new THREE.BoxGeometry(4, 1.2, 4), mat(0xeae4d6), 0, 25, 0));
  g.add(mesh(new THREE.BoxGeometry(4.02, 1.3, 4.02), mat(0x8fc6e8, { emissive: 0x223344 }), 0, 26.2, 0));
  g.add(mesh(new THREE.ConeGeometry(3.6, 1.6, 4), mat(0x3f5f3a), 0, 27.6, 0).rotateY(Math.PI / 4));
  return g;
}

/** A red barn with a white-trimmed gambrel roof, a silo and a farmhouse. */
function buildFarmstead(rng: () => number): THREE.Object3D {
  const g = new THREE.Group();
  const red = mat(0xa8322a);
  g.add(mesh(new THREE.BoxGeometry(12, 7, 16), red, 0, 3.5, 0));
  // Gambrel roof from two pairs of slopes.
  const roofMat = mat(0x4a4a4e);
  for (const [x, y, rot, w] of [
    [-4.4, 8.3, 0.95, 4.2],
    [4.4, 8.3, -0.95, 4.2],
    [-1.8, 10.4, 0.35, 4.2],
    [1.8, 10.4, -0.35, 4.2],
  ]) {
    const slope = mesh(new THREE.BoxGeometry(w, 0.3, 16.4), roofMat, x, y, 0);
    slope.rotation.z = rot;
    g.add(slope);
  }
  g.add(mesh(new THREE.BoxGeometry(5, 5, 0.1), mat(0xf2f2f2), 0, 2.5, 8.03));
  g.add(mesh(new THREE.BoxGeometry(4.6, 4.6, 0.12), red, 0, 2.5, 8.05));
  g.add(mesh(new THREE.CylinderGeometry(2.6, 2.6, 16, 12), mat(0x9aa4ad), 9, 8, -3));
  g.add(mesh(new THREE.SphereGeometry(2.6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x9aa4ad), 9, 16, -3));
  // Farmhouse off to the side.
  const house = new THREE.Group();
  house.add(mesh(new THREE.BoxGeometry(8, 5, 7), mat(rng() < 0.5 ? 0xf0ead8 : 0xd8c9a4), 0, 2.5, 0));
  const r1 = mesh(new THREE.BoxGeometry(8.4, 0.3, 4.6), mat(0x5b3b33), 0, 6.1, 1.7);
  r1.rotation.x = -0.6;
  const r2 = mesh(new THREE.BoxGeometry(8.4, 0.3, 4.6), mat(0x5b3b33), 0, 6.1, -1.7);
  r2.rotation.x = 0.6;
  house.add(r1, r2);
  house.position.set(-18, 0, 4);
  g.add(house);
  return g;
}

function buildMonument(): THREE.Object3D {
  const g = new THREE.Group();
  const stone = mat(0xe8e2d4);
  g.add(mesh(new THREE.BoxGeometry(8, 2, 8), mat(0xa89e8c), 0, 1, 0));
  const ob = new THREE.CylinderGeometry(0.9, 2, 26, 4);
  ob.rotateY(Math.PI / 4);
  g.add(mesh(ob, stone, 0, 15, 0));
  const tip = new THREE.ConeGeometry(1.25, 2.5, 4);
  tip.rotateY(Math.PI / 4);
  g.add(mesh(tip, stone, 0, 29.2, 0));
  return g;
}

function buildTower(): THREE.Object3D {
  const g = new THREE.Group();
  const red = mat(0xd03a2a);
  const white = mat(0xf0f0f0);
  for (let i = 0; i < 8; i++) {
    const r0 = 1.6 - i * 0.15;
    g.add(mesh(new THREE.CylinderGeometry(r0 - 0.15, r0, 6, 6), i % 2 ? white : red, 0, 3 + i * 6, 0));
  }
  g.add(mesh(new THREE.SphereGeometry(0.6, 6, 4), basic(0xff3030), 0, 49, 0));
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(2, 0.3, 0.8, 10), white);
  dish.rotation.z = Math.PI / 2.5;
  dish.position.set(1.8, 34, 0);
  g.add(dish);
  return g;
}

function buildLighthouse(): THREE.Object3D {
  const g = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const r0 = 3 - i * 0.3;
    g.add(mesh(new THREE.CylinderGeometry(r0 - 0.3, r0, 4.5, 10), mat(i % 2 ? 0xd03a2a : 0xf4f4f4), 0, 2.25 + i * 4.5, 0));
  }
  g.add(mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.4, 10), basic(0xfff2a0), 0, 28.2, 0));
  g.add(mesh(new THREE.ConeGeometry(2, 2, 10), mat(0x303030), 0, 30.4, 0));
  return g;
}

function buildCastle(rng: () => number): THREE.Object3D {
  const g = new THREE.Group();
  const stone = mat(0xa39a8a, { flatShading: true });
  const w = range(rng, 22, 34);
  const h = range(rng, 7, 11);
  for (const [x, z, rx, rz] of [
    [0, -w / 2, w, 1.5],
    [0, w / 2, w, 1.5],
    [-w / 2, 0, 1.5, w],
    [w / 2, 0, 1.5, w],
  ]) {
    g.add(mesh(new THREE.BoxGeometry(rx, h, rz), stone, x, h / 2, z));
    // Crenellations.
    const along = rx > rz ? 'x' : 'z';
    for (let s = -w / 2; s <= w / 2; s += 3) {
      const c = mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), stone, along === 'x' ? s : x, h + 0.7, along === 'z' ? s : z);
      g.add(c);
    }
  }
  for (const x of [-w / 2, w / 2]) {
    for (const z of [-w / 2, w / 2]) {
      g.add(mesh(new THREE.CylinderGeometry(3, 3.3, h * 1.6, 8), stone, x, (h * 1.6) / 2, z));
      g.add(mesh(new THREE.ConeGeometry(3.6, 4, 8), mat(0x6b3b2b), x, h * 1.6 + 2, z));
    }
  }
  g.add(mesh(new THREE.BoxGeometry(w * 0.5, h * 1.8, w * 0.5), stone, 0, h * 0.9, 0));
  return g;
}

/** A Ferris wheel, because every attraction deserves one. Its wheel is named 'spin'. */
function buildAttraction(): THREE.Object3D {
  const g = new THREE.Group();
  const steel = mat(0xe0e0e0);
  const wheel = new THREE.Group();
  wheel.name = 'spin';
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(12, 0.4, 6, 32), steel));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const spoke = mesh(new THREE.BoxGeometry(0.25, 24, 0.25), steel);
    spoke.rotation.z = a;
    wheel.add(spoke);
    const car = mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), mat(new THREE.Color().setHSL(i / 12, 0.7, 0.55).getHex()), Math.cos(a) * 12, Math.sin(a) * 12, 0);
    wheel.add(car);
  }
  wheel.position.y = 15;
  g.add(wheel);
  for (const x of [-4, 4]) {
    const leg = mesh(new THREE.BoxGeometry(0.6, 16, 0.6), steel, x, 7.5, 0);
    leg.rotation.z = x > 0 ? 0.25 : -0.25;
    g.add(leg);
  }
  return g;
}

function buildViewpoint(): THREE.Object3D {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(6, 6, 0.2, 16), mat(0x8a8274), 0, 0.1, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.3, 6), mat(0x333333), 0, 0.75, 0));
  g.add(mesh(new THREE.BoxGeometry(0.9, 0.4, 0.4), mat(0x2f6b3a), 0, 1.5, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 6, 5), mat(0x666666), 3, 3, 0));
  g.add(mesh(new THREE.BoxGeometry(0.05, 1.2, 2), mat(0xd03a2a), 3, 5.3, 1));
  return g;
}

function buildWaterTower(rng: () => number): THREE.Object3D {
  const g = new THREE.Group();
  const leg = mat(0x8a8f96);
  for (const [x, z] of [
    [-3, -3],
    [3, -3],
    [-3, 3],
    [3, 3],
  ]) {
    g.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 16, 5), leg, x, 8, z));
  }
  const color = rng() < 0.5 ? 0xe8eef2 : 0x7fb0d8;
  g.add(mesh(new THREE.CylinderGeometry(5, 5, 6, 14), mat(color), 0, 19, 0));
  g.add(mesh(new THREE.ConeGeometry(5.2, 2.5, 14), mat(color), 0, 23.2, 0));
  g.add(mesh(new THREE.SphereGeometry(5, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat(color), 0, 16, 0));
  return g;
}

/** A farm windmill; its blades are named 'spin'. */
function buildWindmill(): THREE.Object3D {
  const g = new THREE.Group();
  const tower = new THREE.CylinderGeometry(0.4, 2.5, 18, 4);
  g.add(mesh(tower, mat(0x9a9a9a, { wireframe: false }), 0, 9, 0));
  const rotor = new THREE.Group();
  rotor.name = 'spin';
  const blade = mat(0xd8d8d8);
  for (let i = 0; i < 12; i++) {
    const b = mesh(new THREE.BoxGeometry(0.5, 3.2, 0.1), blade, 0, 1.8, 0);
    const holder = new THREE.Group();
    holder.rotation.z = (i / 12) * Math.PI * 2;
    holder.add(b);
    rotor.add(holder);
  }
  rotor.position.set(0, 18.5, 0.8);
  g.add(rotor);
  const tail = mesh(new THREE.BoxGeometry(0.1, 1.6, 3), mat(0xc0392b), 0, 18.5, -2);
  g.add(tail);
  return g;
}

function signTexture(lines: string[], bg: string, fg: string, w = 512, h = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = fg;
  g.lineWidth = 8;
  g.strokeRect(8, 8, w - 16, h - 16);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const size = lines.length > 2 ? 46 : 58;
  g.font = `900 ${size}px system-ui, sans-serif`;
  lines.forEach((t, i) => g.fillText(t, w / 2, h / 2 + (i - (lines.length - 1) / 2) * (size + 8)));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.chunkOwned = true;
  return tex;
}

/** Splits text into lines of about `width` characters. */
function wrap(text: string, width: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width && line) {
      lines.push(line);
      line = w;
    } else line = (line + ' ' + w).trim();
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function buildBillboard(l: Landmark, rng: () => number): THREE.Object3D {
  const g = new THREE.Group();
  const wood = mat(0x5a4632);
  for (const x of [-5, 5]) g.add(mesh(new THREE.BoxGeometry(0.5, 9, 0.5), wood, x, 4.5, -0.3));
  const bgs = ['#ffd23f', '#f4f1e8', '#e8432e', '#1f6fb2'];
  const bg = bgs[Math.floor(rng() * bgs.length)];
  const fg = bg === '#ffd23f' || bg === '#f4f1e8' ? '#1a1a1a' : '#ffffff';
  const tex = signTexture(wrap(l.name, 16), bg, fg);
  const board = mesh(new THREE.PlaneGeometry(16, 8), basic(0xffffff, { map: tex, side: THREE.DoubleSide }), 0, 9, 0);
  g.add(board);
  return g;
}

/** Big goofy roadside figures. The shape is picked from the name so it's stable. */
function buildGiant(l: Landmark): THREE.Object3D {
  const g = new THREE.Group();
  const n = l.name.toLowerCase();
  if (n.includes('duck')) {
    const y = mat(0xffd21f);
    g.add(mesh(new THREE.SphereGeometry(7, 14, 10), y, 0, 6, 0));
    g.add(mesh(new THREE.SphereGeometry(4, 12, 8), y, 0, 14, 4));
    const beak = mesh(new THREE.ConeGeometry(1.4, 3.5, 8), mat(0xff7a1a), 0, 13.5, 8.5);
    beak.rotation.x = Math.PI / 2;
    g.add(beak);
  } else if (n.includes('dinosaur')) {
    const green = mat(0x4f9a46, { flatShading: true });
    g.add(mesh(new THREE.BoxGeometry(6, 6, 14), green, 0, 8, 0));
    const neck = mesh(new THREE.BoxGeometry(2.4, 14, 2.4), green, 0, 16, 7);
    neck.rotation.x = 0.35;
    g.add(neck);
    g.add(mesh(new THREE.BoxGeometry(3, 3, 5), green, 0, 23, 10.5));
    const tail = mesh(new THREE.BoxGeometry(2, 2, 12), green, 0, 6, -12);
    tail.rotation.x = -0.3;
    g.add(tail);
    for (const [x, z] of [
      [-2.2, -4],
      [2.2, -4],
      [-2.2, 4],
      [2.2, 4],
    ])
      g.add(mesh(new THREE.BoxGeometry(1.8, 6, 1.8), green, x, 3, z));
  } else if (n.includes('coffee')) {
    const pot = mat(0xe0e4e8);
    g.add(mesh(new THREE.CylinderGeometry(6, 7.5, 14, 16), pot, 0, 7, 0));
    g.add(mesh(new THREE.ConeGeometry(6, 4, 16), pot, 0, 16, 0));
    const spout = mesh(new THREE.CylinderGeometry(0.8, 1.6, 7, 8), pot, 0, 10, 8);
    spout.rotation.x = 0.9;
    g.add(spout);
  } else if (n.includes('ufo')) {
    g.add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 12, 6), mat(0x777777), 0, 6, 0));
    const tilt = new THREE.Group();
    tilt.rotation.z = 0.3;
    tilt.position.y = 13;
    tilt.add(mesh(new THREE.CylinderGeometry(7, 8, 1.6, 18), mat(0xb8c0d0)));
    tilt.add(mesh(new THREE.SphereGeometry(3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x9ff0ff, { transparent: true, opacity: 0.75 }), 0, 0.8, 0));
    g.add(tilt);
  } else {
    // A big fiberglass figure: cowboy, rooster, armadillo, fork... all get the giant-man treatment.
    const shirt = mat(n.includes('rooster') ? 0xc8402a : 0x2f6fb5);
    const skin = mat(0xe1a77a);
    g.add(mesh(new THREE.BoxGeometry(2.4, 9, 2.4), mat(0x3b4a6b), -1.6, 4.5, 0));
    g.add(mesh(new THREE.BoxGeometry(2.4, 9, 2.4), mat(0x3b4a6b), 1.6, 4.5, 0));
    g.add(mesh(new THREE.BoxGeometry(6, 8, 3.2), shirt, 0, 13, 0));
    g.add(mesh(new THREE.BoxGeometry(3.4, 3.6, 3.4), skin, 0, 19, 0));
    g.add(mesh(new THREE.CylinderGeometry(4, 4, 0.5, 14), mat(0x6b4423), 0, 21, 0));
    g.add(mesh(new THREE.CylinderGeometry(2, 2.2, 2.4, 14), mat(0x6b4423), 0, 22.4, 0));
    const arm = mesh(new THREE.BoxGeometry(1.6, 7, 1.6), shirt, 4, 15, 0);
    arm.rotation.z = 2.4;
    g.add(arm);
    g.add(mesh(new THREE.BoxGeometry(1.6, 7, 1.6), shirt, -3.8, 12, 0));
  }
  return g;
}

function buildCitySign(l: Landmark): THREE.Object3D {
  const g = new THREE.Group();
  const post = mat(0x8a8f96);
  g.add(mesh(new THREE.BoxGeometry(0.25, 4, 0.25), post, -2.6, 2, 0));
  g.add(mesh(new THREE.BoxGeometry(0.25, 4, 0.25), post, 2.6, 2, 0));
  const lines = wrap(l.name, 18);
  const tex = signTexture(lines, '#1f6b3a', '#ffffff');
  g.add(mesh(new THREE.PlaneGeometry(6.4, 3.2), basic(0xffffff, { map: tex, side: THREE.DoubleSide }), 0, 4.6, 0.15));
  return g;
}

/** Blue "Welcome to" sign at a state line. */
function buildStateSign(l: Landmark): THREE.Object3D {
  const g = new THREE.Group();
  const post = mat(0x8a8f96);
  g.add(mesh(new THREE.BoxGeometry(0.25, 4.4, 0.25), post, -3, 2.2, 0));
  g.add(mesh(new THREE.BoxGeometry(0.25, 4.4, 0.25), post, 3, 2.2, 0));
  const tex = signTexture(['WELCOME TO', ...wrap(l.name.toUpperCase(), 16)], '#1d4fa8', '#ffffff');
  g.add(mesh(new THREE.PlaneGeometry(7.2, 3.8), basic(0xffffff, { map: tex, side: THREE.DoubleSide }), 0, 5.2, 0.15));
  return g;
}

/** Finds a route number in a road name: "I 40", "US 66", "SR 99". */
export function routeShield(name: string): { kind: 'I' | 'US' | 'state'; num: string } | null {
  const m = name.match(/\b(I|US|SR|[A-Z]{2})[- ]?(\d{1,3}[A-Z]?)\b/);
  if (!m) return null;
  return { kind: m[1] === 'I' ? 'I' : m[1] === 'US' ? 'US' : 'state', num: m[2] };
}

function drawShield(g: CanvasRenderingContext2D, kind: 'I' | 'US' | 'state', num: string, cx: number, cy: number, r: number): void {
  g.save();
  g.lineWidth = 6;
  if (kind === 'I') {
    g.beginPath();
    g.moveTo(cx - r, cy - r * 0.8);
    g.quadraticCurveTo(cx, cy - r * 1.1, cx + r, cy - r * 0.8);
    g.quadraticCurveTo(cx + r * 1.05, cy + r * 0.4, cx, cy + r);
    g.quadraticCurveTo(cx - r * 1.05, cy + r * 0.4, cx - r, cy - r * 0.8);
    g.fillStyle = '#1d4fa8';
    g.fill();
    g.strokeStyle = '#fff';
    g.stroke();
    g.fillStyle = '#c8202f';
    g.fillRect(cx - r * 0.9, cy - r * 0.85, r * 1.8, r * 0.38);
    g.fillStyle = '#fff';
  } else if (kind === 'US') {
    g.beginPath();
    g.moveTo(cx - r * 0.9, cy - r);
    g.lineTo(cx + r * 0.9, cy - r);
    g.quadraticCurveTo(cx + r, cy + r * 0.3, cx, cy + r);
    g.quadraticCurveTo(cx - r, cy + r * 0.3, cx - r * 0.9, cy - r);
    g.fillStyle = '#fff';
    g.fill();
    g.strokeStyle = '#111';
    g.stroke();
    g.fillStyle = '#111';
  } else {
    g.beginPath();
    g.ellipse(cx, cy, r, r * 0.85, 0, 0, Math.PI * 2);
    g.fillStyle = '#fff';
    g.fill();
    g.strokeStyle = '#111';
    g.stroke();
    g.fillStyle = '#111';
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `900 ${num.length > 2 ? r * 0.75 : r}px system-ui, sans-serif`;
  g.fillText(num, cx, cy + (kind === 'I' ? r * 0.18 : 0));
  g.restore();
}

/** Green guide sign: an arrow for the turn, a route shield if there is one, and the road name. */
function roadSignTexture(l: Landmark): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0f6b3a';
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = '#fff';
  g.lineWidth = 6;
  g.strokeRect(10, 10, 492, 236);
  // Arrow on the left.
  g.save();
  g.translate(72, 128);
  g.rotate(l.arrow === 'left' ? -Math.PI / 2 : l.arrow === 'right' ? Math.PI / 2 : 0);
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(0, -52);
  g.lineTo(36, -10);
  g.lineTo(12, -10);
  g.lineTo(12, 48);
  g.lineTo(-12, 48);
  g.lineTo(-12, -10);
  g.lineTo(-36, -10);
  g.closePath();
  g.fill();
  g.restore();
  const shield = routeShield(l.name);
  let text = l.name;
  let x = 140;
  if (shield) {
    drawShield(g, shield.kind, shield.num, 196, 128, 52);
    text = l.name.replace(/\b(I|US|SR|[A-Z]{2})[- ]?\d{1,3}[A-Z]?\b/, '').trim();
    x = 266;
  }
  g.fillStyle = '#fff';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  const lines = wrap(text, shield ? 11 : 15).slice(0, 2);
  const size = lines.length > 1 ? 44 : 52;
  g.font = `800 ${size}px system-ui, sans-serif`;
  lines.forEach((t, i) => g.fillText(t, x, 128 + (i - (lines.length - 1) / 2) * (size + 6), 512 - x - 24));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.chunkOwned = true;
  return tex;
}

function buildRoadSign(l: Landmark): THREE.Object3D {
  const g = new THREE.Group();
  const post = mat(0x8a8f96);
  g.add(mesh(new THREE.BoxGeometry(0.3, 5.5, 0.3), post, -3, 2.75, 0));
  g.add(mesh(new THREE.BoxGeometry(0.3, 5.5, 0.3), post, 3, 2.75, 0));
  g.add(mesh(new THREE.PlaneGeometry(7.2, 3.6), basic(0xffffff, { map: roadSignTexture(l), side: THREE.DoubleSide }), 0, 5.4, 0.18));
  g.scale.setScalar(1.4);
  return g;
}

/** How far before a landmark its brown sign stands. */
const POI_LEAD = 70;
const SIGN_KINDS = new Set<Landmark['kind']>(['citysign', 'stateline', 'roadsign', 'billboard']);
const NO_POI = new Set<Landmark['kind']>(['citysign', 'stateline', 'roadsign', 'billboard', 'mountains', 'watertower', 'windmill', 'farmstead']);

/**
 * Where along the road a landmark puts writing people should read: its brown
 * sign, or the landmark itself when it is a sign or billboard. Null for none.
 * Poles and posts keep clear of these so they never stand in front of the words.
 */
export function landmarkSignAt(l: Landmark): number | null {
  if (SIGN_KINDS.has(l.kind)) return l.at;
  // The blue river sign stands 50 to 70 before the water, on the right.
  if (l.kind === 'river') return l.at - 60;
  if (NO_POI.has(l.kind)) return null;
  return Math.max(0, l.at - POI_LEAD);
}

/** Brown "point of interest" sign that announces a landmark ahead. */
function poiSign(l: Landmark, path: Path, edge = ROAD_HALF): THREE.Object3D {
  const f = frame(path, Math.max(0, l.at - POI_LEAD));
  const sign = boardSign(l.name, LANDMARK_TITLES[l.kind], '#6b3f1f', 7, 2.6, 3.2);
  sign.position.copy(to3(f.p).addScaledVector(f.right, (l.side > 0 ? 1 : -1) * (edge + 4))).setY(0);
  sign.rotation.y = Math.atan2(-f.fwd.x, -f.fwd.z);
  return sign;
}

/** Builds a landmark, positioned and turned to face the road. */
/** Landmarks with a detailed generated model (the windmill keeps its code-built one, whose blades turn). */
const HD_LANDMARKS: Partial<Record<Landmark['kind'], HdBuilding>> = {
  watertower: 'water_tower',
  grain: 'grain_elevator',
  lookout: 'lookout',
  ghosttown: 'ghost_town',
  lighthouse: 'lighthouse',
  farmstead: 'barn',
};

/** Swaps in the detailed model at the code-built one's height, when it has loaded. */
function withHdLandmark(l: Landmark, code: THREE.Object3D): THREE.Object3D {
  const lumberjack = l.kind === 'giant' && /lumberjack|bunyan|logger|muffler/i.test(l.name);
  const name = lumberjack ? 'giant_statue' : HD_LANDMARKS[l.kind];
  if (!name) return code;
  const h = new THREE.Box3().setFromObject(code).getSize(new THREE.Vector3()).y;
  return hdBuilding(name, Math.max(h, 6), 'height') ?? code;
}

export function buildLandmark(l: Landmark, path: Path, edgeAt: (d: number) => number = () => ROAD_HALF, biome?: BiomeId): THREE.Object3D {
  if (l.kind === 'river') return buildRiver(l, path, edgeAt(l.at));
  const big = l.kind === 'peak' || l.kind === 'mountains' || l.kind === 'mesa' || l.kind === 'hill';
  const wide = big ? 0 : edgeAt(l.at) - ROAD_HALF;
  const rng = makeRng(hashString(`${l.kind}${l.name}${Math.round(l.at)}`));
  const builders: Partial<Record<Landmark['kind'], () => THREE.Object3D>> = {
    peak: () => buildPeak(rng, biome, l.ele),
    hill: () => buildHill(rng),
    mountains: () => buildMountains(rng, biome),
    monument: buildMonument,
    tower: buildTower,
    lighthouse: buildLighthouse,
    castle: () => buildCastle(rng),
    attraction: buildAttraction,
    viewpoint: buildViewpoint,
    watertower: () => buildWaterTower(rng),
    windmill: buildWindmill,
    billboard: () => buildBillboard(l, rng),
    giant: () => buildGiant(l),
    citysign: () => buildCitySign(l),
    stateline: () => buildStateSign(l),
    roadsign: () => buildRoadSign(l),
    mesa: () => buildMesa(rng),
    ghosttown: () => buildGhostTown(rng),
    grain: () => buildGrainElevator(rng),
    lookout: buildLookout,
    farmstead: () => buildFarmstead(rng),
  };
  const model = withHdLandmark(l, (builders[l.kind] ?? buildMonument)());
  const { p, fwd, right } = frame(path, l.at);
  const out = new THREE.Group();
  model.position.copy(to3(p)).addScaledVector(right, l.side * (l.offset + wide));
  // Face the road; signs and billboards also angle toward oncoming traffic.
  const toRoad = right.clone().multiplyScalar(-l.side);
  const face = l.kind === 'billboard' || l.kind === 'citysign' || l.kind === 'stateline' || l.kind === 'roadsign' ? toRoad.multiplyScalar(0.35).addScaledVector(fwd, -1).normalize() : toRoad;
  model.rotation.y = Math.atan2(face.x, face.z);
  // Mountains, hills and mesas never sit on the road, even where it bends toward them.
  if (big) keepOffRoad(model, path, l.at, right.clone().multiplyScalar(l.side), edgeAt(l.at));
  out.add(model);
  if (!NO_POI.has(l.kind)) {
    out.add(poiSign(l, path, edgeAt(Math.max(0, l.at - POI_LEAD))));
  }
  return out;
}
