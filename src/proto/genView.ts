import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Throwaway viewer for generated models: ?m=gen/file.glb&yaw=deg&clay=1 */
const p = new URLSearchParams(location.search);
const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2622);
const cam = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 100);
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x6a5a48, 1.2));
const sun = new THREE.DirectionalLight(0xfff2e0, 2.6);
sun.position.set(3, 5, 4);
scene.add(sun);
new GLTFLoader().load(p.get('m') ?? 'gen/saucer_hy.glb', (g) => {
  const root = g.scene;
  let tris = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    if (p.has('clay') || !(m.material as THREE.MeshStandardMaterial).map) {
      if (!m.geometry.attributes.normal) m.geometry.computeVertexNormals();
      m.material = new THREE.MeshStandardMaterial({ color: 0xc8c0b8, roughness: 0.7, vertexColors: !!m.geometry.attributes.color && !p.has('clay') });
    }
  });
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3()).length();
  const c = box.getCenter(new THREE.Vector3());
  root.position.sub(c);
  const pivot = new THREE.Group();
  pivot.add(root);
  pivot.rotation.y = THREE.MathUtils.degToRad(Number(p.get('yaw') ?? 0));
  scene.add(pivot);
  cam.position.set(0, size * 0.45, size * 1.25);
  cam.lookAt(0, 0, 0);
  renderer.render(scene, cam);
  document.getElementById('status')!.textContent = `ready ${Math.round(tris)}`;
});
