import * as THREE from 'three';
import { blankBack } from './materials';
import { modelsWanted } from './models';
import type { PlaceKind } from '../game/stops';
import { loadStats } from '../game/loadStats';

/**
 * The generated town buildings and landmarks (public/models/hd/b/, about 6k
 * triangles each). They load in the background once a trip starts, so they
 * never hold up the start; until they arrive, or on Low, the code-built ones
 * show. Every file faces +z (turned at load where its door is on another side, see DOORS).
 */
export const HD_BUILDINGS = [
  'barn', 'gas_station', 'garage', 'grocery', 'hardware', 'supply', 'pharmacy', 'police', 'junkyard', 'motel',
  'water_tower', 'windmill', 'giant_statue', 'grain_elevator', 'lookout', 'ghost_town', 'lighthouse',
  'house_ranch', 'house_farm', 'house_bungalow',
] as const;
export type HdBuilding = (typeof HD_BUILDINGS)[number];
export const HD_HOUSES: HdBuilding[] = ['house_ranch', 'house_farm', 'house_bungalow'];

/**
 * Where each town building's own front door is (looked up from the models: scripts in the
 * walkable-town thread render each from four sides). `turn` spins the model at load so that
 * door faces +z (the street); `x` is then the door's place across the front, as a fraction of
 * the width (-0.5 left edge to 0.5 right edge, seen from the street).
 */
export const DOORS: Partial<Record<HdBuilding, { turn: number; x: number }>> = {
  police: { turn: Math.PI / 2, x: 0 },
  pharmacy: { turn: -Math.PI / 2, x: -0.03 },
  gas_station: { turn: Math.PI / 2, x: -0.27 },
  motel: { turn: 0, x: 0.12 },
  grocery: { turn: 0, x: -0.02 },
  hardware: { turn: 0, x: -0.16 },
  supply: { turn: 0, x: 0.1 },
  garage: { turn: Math.PI / 2, x: 0.2 }, // its plain side door, not the roll-up
  junkyard: { turn: 0, x: 0.02 },
  barn: { turn: 0, x: 0 },
};

/** Which building stands for each place in a town, and the words on its sign (null: no sign). */
export const PLACE_BUILDINGS: Record<PlaceKind, { model: HdBuilding; sign: string | null; color: string }> = {
  pumps: { model: 'gas_station', sign: 'GAS', color: '#c8302a' },
  garage: { model: 'garage', sign: 'GARAGE', color: '#2f6b3f' },
  grocery: { model: 'grocery', sign: 'GROCERY', color: '#2f7a3a' },
  hardware: { model: 'hardware', sign: 'HARDWARE', color: '#b5562a' },
  gunshop: { model: 'supply', sign: 'SUPPLY', color: '#5a4632' },
  pharmacy: { model: 'pharmacy', sign: 'PHARMACY', color: '#1f7a4a' },
  police: { model: 'police', sign: 'POLICE', color: '#1f4f9a' },
  junkyard: { model: 'junkyard', sign: 'JUNKYARD', color: '#6a5a3a' },
  barn: { model: 'barn', sign: null, color: '#a8322a' },
  motel: { model: 'motel', sign: 'MOTEL', color: '#c0392b' },
};

/** Lighter copies (about 3.5k triangles, small textures) for the many houses and shops along a town's road. */
export const HD_ROADSIDE = ['house_ranch', 'house_farm', 'house_bungalow', 'grocery', 'hardware', 'pharmacy', 'motel', 'supply', 'garage', 'police', 'barn'] as const;
export type HdRoadside = (typeof HD_ROADSIDE)[number];

const loaded = new Map<HdBuilding, THREE.Group>();
const roadside = new Map<HdRoadside, { geometry: THREE.BufferGeometry; material: THREE.Material; size: THREE.Vector3 }>();
let loading: Promise<void> | null = null;

/** Starts loading the buildings (Medium and High only). Safe to call more than once. */
export function loadHdBuildings(base = `${import.meta.env.BASE_URL}models/hd/b/`): Promise<void> {
  if (!modelsWanted()) return Promise.resolve();
  loading ??= (async () => {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();
    // A few at a time, so the road's own files aren't starved.
    const queue = [...HD_BUILDINGS];
    const worker = async () => {
      for (let name = queue.shift(); name; name = queue.shift()) {
        try {
          const gltf = await loader.loadAsync(`${base}${name}.glb`);
          const pivot = new THREE.Group();
          gltf.scene.rotation.y = DOORS[name]?.turn ?? 0;
          pivot.add(gltf.scene);
          pivot.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(pivot);
          const c = box.getCenter(new THREE.Vector3());
          gltf.scene.position.set(-c.x, -box.min.y, -c.z);
          pivot.userData.size = box.getSize(new THREE.Vector3());
          pivot.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            m.geometry.userData.shared = true;
            for (const mat of [m.material].flat()) mat.userData.shared = true;
          });
          loaded.set(name, pivot);
          nightLevel = -1;
          loadStats.buildings.ok++;
        } catch (e) {
          loadStats.buildings.fail++;
          console.warn(`Building ${name} not loaded:`, e);
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    // Then the light roadside copies, baked to one mesh each so they can be instanced.
    await Promise.all(
      HD_ROADSIDE.map(async (name) => {
        try {
          const gltf = await loader.loadAsync(`${base}lod/${name}.glb`);
          gltf.scene.rotation.y = DOORS[name]?.turn ?? 0;
          gltf.scene.updateMatrixWorld(true);
          let mesh: THREE.Mesh | null = null;
          gltf.scene.traverse((o) => {
            if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
          });
          if (!mesh) return;
          const m = mesh as THREE.Mesh;
          const geometry = m.geometry.clone().applyMatrix4(m.matrixWorld);
          geometry.computeBoundingBox();
          const box = geometry.boundingBox!;
          const c = box.getCenter(new THREE.Vector3());
          geometry.translate(-c.x, -box.min.y, -c.z);
          geometry.userData.shared = true;
          const material = m.material as THREE.Material;
          material.userData.shared = true;
          roadside.set(name, { geometry, material, size: box.getSize(new THREE.Vector3()) });
          nightLevel = -1;
        } catch (e) {
          console.warn(`Roadside building ${name} not loaded:`, e);
        }
      }),
    );
    loadStats.buildings.at = performance.now();
  })();
  return loading;
}

/** The light roadside copy of a building, standing on y = 0, facing +z, for instancing; null if not loaded. */
export function hdRoadside(name: HdRoadside): { geometry: THREE.BufferGeometry; material: THREE.Material; size: THREE.Vector3 } | null {
  return roadside.get(name) ?? null;
}

/**
 * A copy of a building standing on y = 0 and facing +z, scaled so its
 * width (x), height or depth (z) is `size`; null if it isn't loaded.
 */
export function hdBuilding(name: HdBuilding, size: number, fit: 'width' | 'height' | 'depth' = 'width'): THREE.Group | null {
  const src = loaded.get(name);
  if (!src) return null;
  const copy = src.clone(true);
  const s = src.userData.size as THREE.Vector3;
  const k = size / (fit === 'width' ? s.x : fit === 'height' ? s.y : s.z);
  copy.scale.setScalar(k);
  copy.userData.size = s.clone().multiplyScalar(k);
  copy.name = 'hd';
  return copy;
}

/** A building `width` wide, shrunk further if that would make it deeper than `maxDepth`. */
export function fitted(name: HdBuilding, width: number, maxDepth = Infinity): THREE.Group | null {
  const b = hdBuilding(name, width);
  if (!b) return null;
  const s = b.userData.size as THREE.Vector3;
  if (s.z > maxDepth) {
    const k = maxDepth / s.z;
    b.scale.multiplyScalar(k);
    s.multiplyScalar(k);
  }
  return b;
}

const signCache = new Map<string, THREE.MeshBasicMaterial>();

/**
 * A clean, readable shop sign on a board, `w` wide, to hang over the
 * generated building's own (garbled) lettering. Lit so it reads at night too.
 */
export function shopSign(text: string, color: string, w: number): THREE.Mesh {
  const key = `${text}|${color}`;
  let mat = signCache.get(key);
  if (!mat) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#f6efe0';
    g.beginPath();
    g.roundRect(4, 4, 504, 120, 16);
    g.fill();
    g.strokeStyle = color;
    g.lineWidth = 10;
    g.stroke();
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 84;
    g.font = `900 ${size}px system-ui, sans-serif`;
    while (g.measureText(text).width > 460 && size > 30) g.font = `900 ${(size -= 4)}px system-ui, sans-serif`;
    g.fillText(text, 256, 68);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    mat.userData.shared = true;
    signCache.set(key, mat);
  }
  const geo = new THREE.PlaneGeometry(w, w / 4);
  const m = blankBack(new THREE.Mesh(geo, mat));
  m.name = 'sign';
  return m;
}

const RAY = new THREE.Raycaster();
/** How far forward (+z) the building's front reaches at height y (and across at x), found by casting a ray at it. */
export function frontAt(b: THREE.Object3D, y: number, depth: number, x = 0): number {
  b.updateMatrixWorld(true);
  RAY.set(new THREE.Vector3(x, y, depth * 2 + 5), new THREE.Vector3(0, 0, -1));
  const hit = RAY.intersectObjects(b.children.filter((o) => o.name !== 'sign'), true)[0];
  return hit ? hit.point.z : depth * 0.4;
}

/** A place's front door, in the building's own frame (it stands at the origin facing +z): across (x) and the wall (z). */
export function placeDoor(place: PlaceKind, b: THREE.Object3D): { x: number; z: number; y: number } {
  const s = b.userData.size as THREE.Vector3;
  const x = (DOORS[PLACE_BUILDINGS[place].model]?.x ?? 0) * s.x;
  // The wall at door height; a porch post or a barrel in the way is no wall, so take the deepest of three.
  const z = Math.min(...[-0.35, 0, 0.35].map((dx) => frontAt(b, 1.3, s.z, x + dx)));
  // The doorstep: the top of any steps or porch just in front of the door.
  RAY.set(new THREE.Vector3(x, s.y + 2, z + 0.25), new THREE.Vector3(0, -1, 0));
  const step = RAY.intersectObjects(b.children.filter((o) => o.name !== 'sign'), true).find((h) => h.point.y < 1.6);
  return { x, z: Math.min(z, s.z / 2), y: step ? Math.max(0, step.point.y) : 0 };
}

/**
 * The model's own door, as a flat leaf that can swing: a grid over the door
 * (w by h, its bottom middle at `at`) whose every point takes its picture from
 * the wall straight behind it. Null if the wall there has no picture.
 */
export function doorSkin(b: THREE.Object3D, at: { x: number; z: number; y: number }, w: number, h: number): THREE.Mesh | null {
  b.updateMatrixWorld(true);
  const parts = b.children.filter((o) => o.name !== 'sign');
  const nx = 8, ny = 12;
  const geo = new THREE.PlaneGeometry(w, h, nx, ny);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const maps = new Map<THREE.Texture, number>();
  let mat: THREE.MeshStandardMaterial | null = null;
  let missed = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = at.x + pos.getX(i);
    const y = at.y + h / 2 + pos.getY(i);
    RAY.set(new THREE.Vector3(x, y, at.z + 1.5), new THREE.Vector3(0, 0, -1));
    const hit = RAY.intersectObjects(parts, true)[0];
    const m = (hit?.object as THREE.Mesh | undefined)?.material as THREE.MeshStandardMaterial | undefined;
    if (!hit?.uv || !m?.map) {
      missed++;
      continue;
    }
    uv.setXY(i, hit.uv.x, hit.uv.y);
    maps.set(m.map, (maps.get(m.map) ?? 0) + 1);
    if (!mat || (maps.get(m.map) ?? 0) > (maps.get(mat.map!) ?? 0)) mat = m;
  }
  if (!mat || missed > pos.count / 3) {
    geo.dispose();
    return null;
  }
  const leaf = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: mat.map, roughness: 0.8, side: THREE.DoubleSide }));
  leaf.castShadow = true;
  return leaf;
}

/**
 * A place's building with its sign on the front, `width` wide, facing +z;
 * null if the model isn't loaded.
 */
export function placeBuilding(place: PlaceKind, width: number, maxDepth = Infinity): THREE.Group | null {
  const spec = PLACE_BUILDINGS[place];
  const b = fitted(spec.model, width, maxDepth);
  if (!b) return null;
  const g = new THREE.Group();
  g.add(b);
  if (spec.sign) {
    const s = b.userData.size as THREE.Vector3;
    const sign = shopSign(spec.sign, spec.color, Math.min(s.x * 0.6, 7));
    // High on the front wall, a little proud of it, where the shop's own sign usually is.
    const y = s.y * 0.68;
    sign.position.set(0, y, frontAt(b, y, s.z) + 0.12);
    g.add(sign);
  }
  g.userData.size = (b.userData.size as THREE.Vector3).clone();
  return g;
}

let nightLevel = -1;
/**
 * Night glow for the generated buildings: they have no window lights of their
 * own, so their own picture glows faintly, warmed like porch and street light.
 * Shared by every copy, so one call covers the whole road.
 */
export function setBuildingsNight(night: number): void {
  const n = Math.round(night * 20) / 20;
  if (n === nightLevel) return;
  nightLevel = n;
  const mats = new Set<THREE.MeshStandardMaterial>();
  for (const g of loaded.values()) g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) mats.add(m.material as THREE.MeshStandardMaterial); });
  for (const r of roadside.values()) mats.add(r.material as THREE.MeshStandardMaterial);
  for (const m of mats) {
    if (!m.emissive) continue;
    if (m.map && m.emissiveMap !== m.map) {
      m.emissiveMap = m.map;
      m.needsUpdate = true;
    }
    m.emissive.setRGB(0.55, 0.42, 0.3).multiplyScalar(n * 0.55);
  }
}
