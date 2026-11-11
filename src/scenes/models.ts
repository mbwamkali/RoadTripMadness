import * as THREE from 'three';
import { lit } from './materials';
import { quality } from './quality';

/**
 * CC0 low-poly models (Quaternius, see docs/CREDITS.md), built into
 * public/models/ by scripts/build-models.py: one flat-shaded mesh each, with
 * colours baked into the vertices, so a model is one draw call and can be
 * instanced. Loaded once on Medium and High; Low keeps the hand-built shapes.
 * Every model is normalised here: centred, standing on y = 0, facing +z (the
 * way the cars face), and scaled to a size in game units.
 */
export const MODEL_SPECS = {
  // Traffic: [fit by length along z] in units.
  'car-sedan': { length: 4.6 },
  'car-hatch': { length: 4.1 },
  'car-suv': { length: 4.9 },
  'car-taxi': { length: 4.6 },
  'car-cop': { length: 4.7 },
  'car-sports': { length: 4.5 },
  // Enemies
  'zombie': { height: 2.3 },
  // Plants and rocks: height in units (instances scale this further).
  'oak-1': { height: 7 },
  'oak-2': { height: 8 },
  'oak-3': { height: 8.5 },
  'tree-dead': { height: 6 },
  'pine-1': { height: 9 },
  'pine-2': { height: 10.5 },
  'palm-1': { height: 11 },
  'palm-2': { height: 10 },
  'cactus-1': { height: 4.5 },
  'cactus-2': { height: 6 },
  'cactus-3': { height: 5.5 },
  'bush-1': { height: 1.4 },
  'bush-2': { height: 1.5 },
  'grass': { height: 1.2 },
  'corn': { height: 2.2 },
  'wheat': { height: 1.2 },
  'rock-1': { height: 1.6 },
  'rock-2': { height: 1.1 },
  'rock-3': { height: 1.2 },
  // Town buildings: height in units.
  'shop': { height: 6 },
  'flat-1': { height: 13 },
  'flat-2': { height: 13 },
  'hospital': { height: 15 },
  'house-1': { height: 6.5 },
  'house-2': { height: 6 },
  'house-3': { height: 8 },
  'house-4': { height: 6 },
  'house-5': { height: 6 },
} as const satisfies Record<string, { length?: number; height?: number; turn?: number }>;

export type ModelName = keyof typeof MODEL_SPECS;

const geos = new Map<ModelName, THREE.BufferGeometry>();
let loading: Promise<boolean> | null = null;

/** Shared material for every model: the colours are in the vertices. */
export const modelMaterial = lit({ vertexColors: true, flatShading: true });
modelMaterial.userData.shared = true;

/** Whether this graphics level uses the models at all. */
export const modelsWanted = () => quality.level !== 'low';
/** Trees are a few thousand triangles each, so only High swaps them in. */
export const treeModelsWanted = () => quality.level === 'high';

export const modelsReady = () => geos.size > 0;

/** The normalised geometry of a model, or null before loading (or on Low). */
export function modelGeometry(name: ModelName): THREE.BufferGeometry | null {
  return modelsWanted() ? geos.get(name) ?? null : null;
}

/** A mesh of a model (sharing geometry and material), or null when not available. */
export function modelMesh(name: ModelName): THREE.Mesh | null {
  const g = modelGeometry(name);
  if (!g) return null;
  const m = new THREE.Mesh(g, modelMaterial);
  m.userData.sharedModel = true;
  return m;
}

/** Loads every model once. Resolves false (and the game keeps its own shapes) on any failure. */
export function loadModels(base = `${import.meta.env.BASE_URL}models/`): Promise<boolean> {
  if (!modelsWanted()) return Promise.resolve(false);
  loading ??= (async () => {
    try {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const loader = new GLTFLoader();
      const names = Object.keys(MODEL_SPECS) as ModelName[];
      const loaded = await Promise.all(
        names.map(async (name) => {
          const gltf = await loader.loadAsync(`${base}${name}.glb`);
          let geo: THREE.BufferGeometry | null = null;
          gltf.scene.traverse((o) => {
            if (!geo && (o as THREE.Mesh).isMesh) geo = (o as THREE.Mesh).geometry;
          });
          if (!geo) throw new Error(`no mesh in ${name}`);
          return [name, normalise(geo, MODEL_SPECS[name])] as const;
        }),
      );
      for (const [name, g] of loaded) geos.set(name, g);
      return true;
    } catch (e) {
      console.warn('Models not loaded, using built-in shapes:', e);
      geos.clear();
      return false;
    }
  })();
  return loading;
}

export function normalise(geo: THREE.BufferGeometry, spec: { length?: number; height?: number; turn?: number }): THREE.BufferGeometry {
  let g = geo.clone();
  // The models are flat-shaded and ship without normals; the contact-shadow pass (High) needs them.
  if (!g.attributes.normal) {
    if (g.index) g = g.toNonIndexed();
    g.computeVertexNormals();
  }
  if (spec.turn) g.rotateY(spec.turn);
  g.computeBoundingBox();
  const b = g.boundingBox!;
  const size = b.getSize(new THREE.Vector3());
  const k = spec.length ? spec.length / size.z : (spec.height ?? 1) / size.y;
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  g.scale(k, k, k);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  // Shared by every copy: scene clean-up must leave it alone.
  g.userData.shared = true;
  return g;
}

/** Test hook: put geometries in without loading files. */
export function setModelGeometry(name: ModelName, g: THREE.BufferGeometry | null): void {
  if (g) geos.set(name, g);
  else geos.delete(name);
}
