import * as THREE from 'three';
import { loadModels } from '../scenes/models';
import { buildStorefront, setStorefrontNight } from '../scenes/storefront';
import { shopRoom } from '../town/world';
import type { PlaceKind } from '../game/stops';
import { quality } from '../scenes/quality';

// The check page shows what Medium and High show (wall photos); ?q=low shows Low's plain colours.
quality.level = (new URLSearchParams(location.search).get('q') as typeof quality.level) ?? 'high';

/**
 * Check page (shops.html): one code-built shop (scenes/storefront.ts) on a lot, as the town builds it.
 *   ?place=grocery  &night=1  &view=front|corner|inside|back
 * Sets #status to 'ready' once the wall photos have loaded and a frame is drawn.
 */
const p = new URLSearchParams(location.search);
const place = (p.get('place') ?? 'grocery') as PlaceKind;
const night = p.get('night') === '1';
const view = p.get('view') ?? 'front';
const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(night ? 0x0c1424 : 0x9fc4e8);
scene.add(new THREE.HemisphereLight(night ? 0x3a4a70 : 0xdfe8ff, night ? 0x181410 : 0x7a6a58, night ? 0.35 : 1.3));
const sun = new THREE.DirectionalLight(night ? 0x8090c0 : 0xfff2e0, night ? 0.25 : 2.6);
sun.position.set(-10, 18, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, far: 60 });
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: 0x6e6c6a, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

await loadModels();
const width = place === 'junkyard' ? 18 : place === 'motel' ? 16 : 14;
const s = buildStorefront(place, width, 11);
scene.add(s.group);
const room = shopRoom(place, s.size, s.door.x);
scene.add(room);
const lamp = room.getObjectByName('roomLight') as THREE.PointLight | undefined;
if (view === 'inside') {
  s.group.traverse((o) => {
    if (o.name === 'cutaway') o.visible = false;
  });
  if (lamp) lamp.visible = true;
} else if (lamp) lamp.visible = night;
setStorefrontNight(night ? 1 : 0);
if (night && s.doorway) {
  // A street light out front.
  const l = new THREE.PointLight(0xffd8a0, 40, 30, 1.6);
  l.position.set(6, 6, 14);
  scene.add(l);
}
const cam = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 500);
const fz = s.size.z / 2;
if (view === 'corner') cam.position.set(width * 0.85, 4.5, fz + 15);
else if (view === 'inside') cam.position.set(0, 16, fz + 8);
else if (view === 'back') cam.position.set(-width * 0.6, 5, -fz - 14);
else cam.position.set(2, 2.6, fz + 16);
cam.lookAt(0, view === 'inside' ? 0 : 2.8, view === 'inside' ? 0 : 0);
let frames = 0;
THREE.DefaultLoadingManager.onLoad = () => (frames = Math.min(frames, 0));
const loop = () => {
  renderer.render(scene, cam);
  if (++frames === 40) document.getElementById('status')!.textContent = 'ready';
  requestAnimationFrame(loop);
};
loop();
