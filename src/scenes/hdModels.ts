import * as THREE from 'three';
import { modelsWanted } from './models';
import { loadStats } from '../game/loadStats';

/**
 * The detailed generated models from the visual overhaul (public/models/hd/,
 * shrunk for phones: quantised mesh, WebP textures). Loaded once on Medium and
 * High; until they arrive, or on Low, the code-built models stay.
 *
 * Each file faces a different way; `turn` (degrees) turns it to face +z like
 * everything else in the game.
 */
export const HD_SPECS = {
  car: { turn: -90 },
  pickup: { turn: -90 },
  saucer: { turn: 0 },
  mothership: { turn: 0 },
  earl: { turn: -90 },
  warrig: { turn: -90 },
  hermit: { turn: -90 },
  pizza: { turn: 0 },
  sweeper: { turn: 90 },
  karen: { turn: -90 },
  drone: { turn: -90 },
  zombie: { turn: -90 },
  outlaw: { turn: -90 },
  alien_cat: { turn: 0 },
  cow: { turn: -90 },
  armadillo: { turn: -90 },
  sedan: { turn: -90 },
  van: { turn: -90 },
  semi: { turn: -90 },
} as const;
export type HdName = keyof typeof HD_SPECS;

const loaded = new Map<HdName, THREE.Object3D>();
let loading: Promise<void> | null = null;
let ready = false;

/** True once loading has finished (whether or not every file arrived). */
export const hdModelsReady = () => ready;

/** Starts loading every detailed model (Medium and High only). Safe to call more than once. */
export function loadHdModels(base = `${import.meta.env.BASE_URL}models/hd/`): Promise<void> {
  if (!modelsWanted()) return Promise.resolve();
  loading ??= (async () => {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();
    await Promise.all(
      (Object.keys(HD_SPECS) as HdName[]).map(async (name) => {
        try {
          const gltf = await loader.loadAsync(`${base}${name}.glb`);
          const inner = gltf.scene;
          inner.rotation.y = THREE.MathUtils.degToRad(HD_SPECS[name].turn);
          const pivot = new THREE.Group();
          pivot.add(inner);
          pivot.updateMatrixWorld(true);
          // Stand it on y = 0, centred on x and z.
          const box = new THREE.Box3().setFromObject(pivot);
          const c = box.getCenter(new THREE.Vector3());
          inner.position.set(-c.x, -box.min.y, -c.z);
          pivot.userData.size = box.getSize(new THREE.Vector3());
          pivot.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            m.geometry.userData.shared = true;
            for (const mat of [m.material].flat()) mat.userData.shared = true;
          });
          loaded.set(name, pivot);
          loadStats.hd.ok++;
        } catch (e) {
          loadStats.hd.fail++;
          console.warn(`Detailed model ${name} not loaded:`, e);
        }
      }),
    );
    ready = true;
    loadStats.hd.at = performance.now();
  })();
  return loading;
}

/** A copy of a detailed model, facing +z and standing on y = 0, or null if it isn't loaded. */
export function hdModel(name: HdName): THREE.Group | null {
  const src = loaded.get(name);
  if (!src) return null;
  const copy = src.clone(true) as THREE.Group;
  copy.userData.size = (src.userData.size as THREE.Vector3).clone();
  return copy;
}

/** The detailed zombie at the CC0 zombie's height (2.3), or null. A light version (about 2.8k triangles) for hordes. */
export function hdZombie(): THREE.Group | null {
  const z = hdModel('zombie');
  if (z) z.scale.setScalar(2.3 / (z.userData.size as THREE.Vector3).y);
  return z;
}

/** Named parts that game code looks up on a model (warning beams and lights); they survive the swap. */
const RESCUE = new Set(['charge', 'light']);
const TMP_BOX = new THREE.Box3();

/**
 * Swaps a code-built model's body for the detailed one, sized to the same
 * footprint so hit areas and spacing don't change. `fit` picks the matching
 * measure: length along z for vehicles, height for people and animals.
 * Children that `keep` accepts (turn signals, guns, bolt-on upgrades) stay.
 */
export function withHd(name: HdName, code: THREE.Group, fit: 'length' | 'height', keep: (o: THREE.Object3D) => boolean = () => false): THREE.Group {
  const hd = hdModel(name);
  if (!hd) return code;
  code.updateMatrixWorld(true);
  const box = new THREE.Box3();
  // Measure what shows: skip hidden parts (a saucer's beam) and flat blob shadows.
  code.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.geometry.type === 'PlaneGeometry') return;
    m.geometry.computeBoundingBox();
    box.union(TMP_BOX.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld));
  });
  if (box.isEmpty()) return code;
  const want = box.getSize(new THREE.Vector3());
  const size = hd.userData.size as THREE.Vector3;
  const k = fit === 'length' ? want.z / size.z : want.y / size.y;
  hd.scale.setScalar(k);
  const c = box.getCenter(new THREE.Vector3());
  hd.position.set(c.x, box.min.y, c.z);
  hd.name = 'hd';
  for (const child of [...code.children]) {
    if (keep(child)) continue;
    // Parts the fights animate as warnings (a saucer's beam and rim lights) move over to the new model.
    const rescue: THREE.Object3D[] = [];
    child.traverse((o) => {
      if (o !== child && RESCUE.has(o.name)) rescue.push(o);
    });
    for (const o of rescue) code.attach(o);
    if (!RESCUE.has(child.name)) code.remove(child);
  }
  code.add(hd);
  return code;
}
