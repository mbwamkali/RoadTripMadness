import * as THREE from 'three';
import { loadModels } from '../scenes/models';
import { loadHdModels } from '../scenes/hdModels';
import { buildEnemy } from '../scenes/CombatScene';
import { makeRide, makeTrafficVehicle } from '../scenes/common';
import { makeAnimal } from '../scenes/animalModels';
import type { EnemyType } from '../game/combat';

/**
 * Throwaway check (lineup.html): every in-game model as the game builds it,
 * side by side on a grid, so swapped-in models can be checked for size and facing.
 * ?set=enemies|vehicles  ?hd=0 shows the code-built versions.
 */
const p = new URLSearchParams(location.search);
const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2622);
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x6a5a48, 1.4));
const sun = new THREE.DirectionalLight(0xfff2e0, 2.8);
sun.position.set(-4, 8, 6);
scene.add(sun);
const grid = new THREE.GridHelper(80, 40, 0x555555, 0x3a3a3a);
scene.add(grid);

await loadModels();
if (p.get('hd') !== '0') await loadHdModels();

const set = p.get('set') ?? 'enemies';
const items: [string, THREE.Object3D][] =
  set === 'enemies'
    ? (['zombie', 'outlaw', 'catship', 'brute', 'warrig', 'hermit', 'pizza', 'sweeper', 'karen', 'drones', 'mothership'] as EnemyType[]).map((t) => [t, buildEnemy(t)])
    : [
        ['car', makeRide('car')],
        ['truck', makeRide('truck')],
        ['motorcycle', makeRide('motorcycle')],
        ['t-car', makeTrafficVehicle('car', 5)],
        ['t-pickup', makeTrafficVehicle('pickup', 0x3366aa)],
        ['t-van', makeTrafficVehicle('van', 0xffffff)],
        ['t-truck', makeTrafficVehicle('truck', 0x884422)],
        ['cow', makeAnimal('cow')],
        ['armadillo', makeAnimal('armadillo')],
      ];
let x = 0;
for (const [, o] of items) {
  const box = new THREE.Box3().setFromObject(o);
  const w = box.getSize(new THREE.Vector3()).x;
  o.position.x = x + w / 2 - (box.min.x + box.max.x) / 2;
  x += w + 2;
  scene.add(o);
}
const cam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 500);
cam.position.set(x / 2, x * 0.35, x * 0.9);
cam.lookAt(x / 2, 1.5, 0);
renderer.render(scene, cam);
document.getElementById('status')!.textContent = 'ready';
