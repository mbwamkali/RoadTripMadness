import * as THREE from 'three';
import { modelsWanted } from './models';
import { loadStats } from '../game/loadStats';

/**
 * The rigged people (public/models/hd/people/, made by scripts/rig-people.py
 * from the generated statues): the player on foot, the hitchhiker, the
 * cyclist and the Cat Queen, each with a few looping moves. Medium and High
 * only; until they load, or on Low, callers use their code-built figures.
 */
export const PEOPLE = {
  player_walker: { height: 1.75, clips: ['idle', 'walk', 'run'] },
  hitchhiker: { height: 1.8, clips: ['idle', 'thumb', 'walk'] },
  cyclist: { height: 1.75, clips: ['pedal'] },
  cat_queen: { height: 4.5, clips: ['idle', 'swipe', 'walk'] },
} as const;
export type PersonName = keyof typeof PEOPLE;

interface Loaded {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  size: THREE.Vector3;
}
const loaded = new Map<PersonName, Loaded>();
let loading: Promise<void> | null = null;

export function loadPeople(base = `${import.meta.env.BASE_URL}models/hd/people/`): Promise<void> {
  if (!modelsWanted()) return Promise.resolve();
  loading ??= (async () => {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();
    await Promise.all(
      (Object.keys(PEOPLE) as PersonName[]).map(async (name) => {
        try {
          const gltf = await loader.loadAsync(`${base}${name}.glb`);
          const box = new THREE.Box3().setFromObject(gltf.scene);
          gltf.scene.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            m.castShadow = true;
            m.frustumCulled = false;
            m.geometry.userData.shared = true;
            for (const mat of [m.material].flat()) mat.userData.shared = true;
          });
          gltf.scene.userData.minY = box.min.y;
          loaded.set(name, { scene: gltf.scene, clips: gltf.animations, size: box.getSize(new THREE.Vector3()) });
          loadStats.hd.ok++;
        } catch (e) {
          loadStats.hd.fail++;
          console.warn(`Person ${name} not loaded:`, e);
        }
      }),
    );
  })();
  return loading;
}

export const personReady = (name: PersonName) => loaded.has(name);

/** A posable copy: the figure standing on y = 0, facing +z, at its real height, with its moves. */
export class Person {
  readonly obj = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;

  constructor(src: Loaded, height: number, clone: (o: THREE.Object3D) => THREE.Object3D) {
    const inner = clone(src.scene);
    const k = height / src.size.y;
    inner.scale.setScalar(k);
    inner.position.y = -(src.scene.userData.minY as number) * k;
    this.obj.add(inner);
    this.mixer = new THREE.AnimationMixer(inner);
    for (const c of src.clips) this.actions.set(c.name, this.mixer.clipAction(c));
  }

  /** Plays a move, blending from the last one. `speed` scales how fast it plays. */
  play(name: string, speed = 1, fade = 0.25): void {
    const a = this.actions.get(name);
    if (!a) return;
    a.timeScale = speed;
    if (a === this.current) return;
    a.reset().play();
    if (this.current) a.crossFadeFrom(this.current, fade, false);
    this.current = a;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }
}

let cloneFn: ((o: THREE.Object3D) => THREE.Object3D) | null = null;
/** Loads three's skeleton-aware clone once (a plain clone would share one skeleton). */
export async function preparePeople(): Promise<void> {
  if (cloneFn) return;
  const { clone } = await import('three/examples/jsm/utils/SkeletonUtils.js');
  cloneFn = clone;
}

/** A new copy of a rigged person, or null if it isn't loaded. */
export function person(name: PersonName, height: number = PEOPLE[name].height): Person | null {
  const src = loaded.get(name);
  if (!src || !cloneFn) return null;
  return new Person(src, height, cloneFn);
}
