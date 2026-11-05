import * as THREE from 'three';
import { modelsWanted } from './models';
import type { PlaceKind } from '../game/stops';

/**
 * The generated town buildings and landmarks (public/models/hd/b/, about 6k
 * triangles each). They load in the background once a trip starts, so they
 * never hold up the start; until they arrive, or on Low, the code-built ones
 * show. Every file faces +z already.
 */
export const HD_BUILDINGS = [
  'barn', 'gas_station', 'garage', 'grocery', 'hardware', 'supply', 'pharmacy', 'police', 'junkyard', 'motel',
  'water_tower', 'windmill', 'giant_statue', 'grain_elevator', 'lookout', 'ghost_town', 'lighthouse',
  'house_ranch', 'house_farm', 'house_bungalow',
] as const;
export type HdBuilding = (typeof HD_BUILDINGS)[number];
export const HD_HOUSES: HdBuilding[] = ['house_ranch', 'house_farm', 'house_bungalow'];

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
        } catch (e) {
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
        } catch (e) {
          console.warn(`Roadside building ${name} not loaded:`, e);
        }
      }),
    );
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
    mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false });
    mat.userData.shared = true;
    signCache.set(key, mat);
  }
  const geo = new THREE.PlaneGeometry(w, w / 4);
  const m = new THREE.Mesh(geo, mat);
  m.name = 'sign';
  return m;
}

const RAY = new THREE.Raycaster();
/** How far forward (+z) the building's front reaches at height y, found by casting a ray at it. */
function frontAt(b: THREE.Object3D, y: number, depth: number): number {
  b.updateMatrixWorld(true);
  RAY.set(new THREE.Vector3(0, y, depth * 2 + 5), new THREE.Vector3(0, 0, -1));
  const hit = RAY.intersectObject(b, true)[0];
  return hit ? hit.point.z : depth * 0.4;
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
