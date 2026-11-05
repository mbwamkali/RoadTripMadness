import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { loadModels, modelGeometry as rawGeometry, type ModelName } from '../scenes/models';

const withNormals = new Map<ModelName, THREE.BufferGeometry>();
function modelGeometry(name: ModelName): THREE.BufferGeometry | null {
  const g = rawGeometry(name);
  if (!g) return null;
  let n = withNormals.get(name);
  if (!n) {
    n = g.index ? g.toNonIndexed() : g.clone();
    n.computeVertexNormals();
    withNormals.set(name, n);
  }
  return n;
}
import { makeAsphaltTexture } from '../scenes/common';
import { makeRng } from '../game/rng';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Throwaway visual target (look-proto.html): the same desert two-lane road as
 * the game, built with the game's own CC0 models, but lit and finished the way
 * a polished game would be. Not part of the game. Params: ?time=day|golden.
 */

const params = new URLSearchParams(location.search);
const golden = params.get('time') === 'golden';
const rng = makeRng(7);
const rand = (a: number, b: number) => a + (b - a) * rng();

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = golden ? 1.0 : 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1600);

// ---------------------------------------------------------------- road shape
const roadX = (z: number) => 22 * Math.sin(z / 210) + 8 * Math.sin(z / 77);
const ROAD_HALF = 4.2;
const SHOULDER = 2.4;

// ---------------------------------------------------------------- sky
const sunDir = golden ? new THREE.Vector3(-0.55, 0.16, -0.82).normalize() : new THREE.Vector3(-0.45, 0.62, -0.64).normalize();
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
  uniforms: {
    sunDir: { value: sunDir },
    top: { value: new THREE.Color(golden ? 0x3b5a9a : 0x2f6fd0) },
    horizon: { value: new THREE.Color(golden ? 0xffb070 : 0xcfe4f5) },
    sunCol: { value: new THREE.Color(golden ? 0xffd08a : 0xfff4dc) },
  },
  vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
  fragmentShader: `uniform vec3 sunDir, top, horizon, sunCol; varying vec3 vD;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
    float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
      return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
    float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*n(p); p*=2.03; a*=0.5; } return v; }
    void main(){
      float y = max(vD.y, 0.0);
      vec3 c = mix(horizon, top, pow(y, 0.55));
      float s = max(dot(vD, sunDir), 0.0);
      c += sunCol * (pow(s, 900.0) * 30.0 + pow(s, 12.0) * 0.35);
      // soft clouds
      vec2 uv = vD.xz / (vD.y + 0.18) * 1.6;
      float cl = smoothstep(0.52, 0.8, fbm(uv + vec2(3.0, 1.0)));
      vec3 cloudCol = mix(vec3(1.0), sunCol, 0.35) * (0.85 + 0.25 * s);
      c = mix(c, cloudCol, cl * smoothstep(0.02, 0.2, vD.y) * 0.85);
      if (vD.y < 0.0) c = horizon;
      gl_FragColor = vec4(c, 1.0);
    }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), skyMat);
scene.add(sky);
scene.fog = new THREE.FogExp2(golden ? 0xe8a878 : 0xd8e2e6, golden ? 0.0010 : 0.0006);

// Sky light for reflections and fill.
{
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMat));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: golden ? 0x7a4a2a : 0xa08060 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1;
  envScene.add(ground);
  scene.environment = pm.fromScene(envScene, 0.04).texture;
  scene.environmentIntensity = golden ? 0.5 : 0.7;
  pm.dispose();
}

// ---------------------------------------------------------------- lights
const hemi = new THREE.HemisphereLight(golden ? 0x9ab0ff : 0xcfe6ff, golden ? 0x8a5030 : 0xb08a60, golden ? 0.35 : 0.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight(golden ? 0xffb070 : 0xfff1dd, golden ? 3.2 : 3.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.radius = 3;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.05;
const sc = sun.shadow.camera;
sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 400;
scene.add(sun, sun.target);

// ---------------------------------------------------------------- ground
{
  const size = 1400;
  const seg = 220;
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const cols = new Float32Array(pos.count * 3);
  const sand = new THREE.Color(golden ? 0xd09060 : 0xd8b47a);
  const dark = new THREE.Color(golden ? 0xa86a40 : 0xb89060);
  const red = new THREE.Color(golden ? 0xc0603a : 0xc8805a);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i) - 500;
    pos.setZ(i, z);
    const d = Math.abs(x - roadX(z)) - ROAD_HALF - SHOULDER;
    const away = THREE.MathUtils.smoothstep(d, 4, 60);
    const hgt = away * (Math.sin(x * 0.021) * Math.cos(z * 0.017) * 5 + Math.sin(x * 0.07 + z * 0.05) * 1.4) - 0.25;
    pos.setY(i, Math.max(-0.25, hgt));
    const v = 0.5 + 0.5 * Math.sin(x * 0.11 + z * 0.09) * Math.cos(x * 0.05 - z * 0.13);
    tmp.copy(sand).lerp(dark, v * 0.6).lerp(red, Math.max(0, Math.sin(x * 0.013 + z * 0.02)) * 0.35);
    cols.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  m.receiveShadow = true;
  scene.add(m);
}

// ---------------------------------------------------------------- road ribbon
function ribbon(from: number, to: number, mat: THREE.Material, y: number, uScale = 1): THREE.Mesh {
  const n = 600;
  const posArr: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const z = 60 - (i / n) * 1300;
    const x = roadX(z);
    const dx = (roadX(z - 1) - roadX(z + 1)) / 2;
    const nx = 1 / Math.hypot(1, dx);
    const nz = dx * nx;
    posArr.push(x + nx * from, y, z + nz * from, x + nx * to, y, z + nz * to);
    uv.push(0, (i / n) * 1300 / (8 * uScale), 1, (i / n) * 1300 / (8 * uScale));
    if (i < n) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}
const asphalt = makeAsphaltTexture();
asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping;
asphalt.colorSpace = THREE.SRGBColorSpace;
asphalt.anisotropy = 8;
ribbon(-ROAD_HALF, ROAD_HALF, new THREE.MeshStandardMaterial({ map: asphalt, color: 0x9a9a9e, roughness: 0.85, metalness: 0 }), 0.02);
ribbon(-ROAD_HALF - SHOULDER, -ROAD_HALF, new THREE.MeshStandardMaterial({ color: 0x8a7a64, roughness: 0.95 }), 0.015);
ribbon(ROAD_HALF, ROAD_HALF + SHOULDER, new THREE.MeshStandardMaterial({ color: 0x8a7a64, roughness: 0.95 }), 0.015);
// double yellow centre line and white edges
const paint = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
ribbon(-0.28, -0.12, paint(0xf2c230), 0.03);
ribbon(0.12, 0.28, paint(0xf2c230), 0.03);
ribbon(-ROAD_HALF + 0.15, -ROAD_HALF + 0.35, paint(0xf0ede4), 0.03);
ribbon(ROAD_HALF - 0.35, ROAD_HALF - 0.15, paint(0xf0ede4), 0.03);

// ---------------------------------------------------------------- mesas on the horizon
{
  const strata = [0xa8543a, 0xc8764a, 0xb8643e, 0xd8946a];
  for (let k = 0; k < 9; k++) {
    const g = new THREE.CylinderGeometry(rand(40, 90), rand(70, 130), rand(40, 90), 9, 6);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const cols = new Float32Array(pos.count * 3);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      pos.setX(i, pos.getX(i) * (1 + rand(-0.08, 0.08)));
      pos.setZ(i, pos.getZ(i) * (1 + rand(-0.08, 0.08)));
      const band = Math.floor((pos.getY(i) + 50) / 9);
      tmp.setHex(strata[Math.abs(band) % strata.length]);
      cols.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
    const side = k % 2 ? 1 : -1;
    m.position.set(side * rand(160, 420), 0, -rand(380, 900));
    m.position.y = (m.geometry as THREE.CylinderGeometry).parameters.height / 2 - 4;
    scene.add(m);
  }
}

// ---------------------------------------------------------------- props
const plantMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
function scatter(name: ModelName, count: number, near: number, far: number, scale: [number, number], zRange: [number, number] = [40, -700]): void {
  const g = modelGeometry(name);
  if (!g) return;
  const inst = new THREE.InstancedMesh(g, plantMat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (let i = 0; i < count; i++) {
    const z = rand(zRange[1], zRange[0]);
    const side = rng() < 0.5 ? -1 : 1;
    const x = roadX(z) + side * (ROAD_HALF + SHOULDER + rand(near, far));
    const s = rand(scale[0], scale[1]);
    e.set(0, rand(0, Math.PI * 2), 0);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, -0.1, z), q, new THREE.Vector3(s, s * rand(0.85, 1.15), s));
    inst.setMatrixAt(i, m);
  }
  inst.castShadow = true;
  inst.receiveShadow = true;
  scene.add(inst);
}

// telephone poles with sagging wires
function poles(): void {
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.9 });
  const wire = new THREE.LineBasicMaterial({ color: 0x2a2520 });
  let prev: THREE.Vector3 | null = null;
  for (let z = 20; z > -900; z -= 46) {
    const x = roadX(z) + ROAD_HALF + SHOULDER + 7;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 9, 6), wood);
    pole.position.set(x, 4.5, z);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.18, 0.18), wood);
    arm.position.set(x, 8.4, z);
    pole.castShadow = arm.castShadow = true;
    scene.add(pole, arm);
    const top = new THREE.Vector3(x, 8.5, z);
    if (prev) {
      const pts: THREE.Vector3[] = [];
      for (let t = 0; t <= 1.0001; t += 0.1) pts.push(new THREE.Vector3().lerpVectors(prev, top, t).setY(8.5 - Math.sin(t * Math.PI) * 0.9));
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wire));
    }
    prev = top;
  }
}

// reflector posts on the shoulder
function reflectors(): void {
  const post = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.5 });
  const refl = new THREE.MeshStandardMaterial({ color: 0xffa020, emissive: 0xff8800, emissiveIntensity: 0.6 });
  for (let z = 30; z > -600; z -= 24) {
    for (const side of [-1, 1]) {
      const x = roadX(z) + side * (ROAD_HALF + SHOULDER + 0.4);
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.12), post);
      p.position.set(x, 0.55, z);
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.14), refl);
      r.position.set(x, 1.0, z);
      p.castShadow = true;
      scene.add(p, r);
    }
  }
}

// ---------------------------------------------------------------- the player's car
function playerCar(): THREE.Object3D {
  const g = modelGeometry('car-sports');
  const group = new THREE.Group();
  if (g) {
    // Repaint the body red with clear-coat; keep the model's darker parts (tyres, windows).
    const paintMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06 });
    const geo = g.clone();
    const col = geo.attributes.color as THREE.BufferAttribute;
    const c = new THREE.Color();
    for (let i = 0; i < col.count; i++) {
      c.setRGB(col.getX(i), col.getY(i), col.getZ(i));
      const hsl = { h: 0, s: 0, l: 0 };
      c.getHSL(hsl);
      if (hsl.s > 0.25 && hsl.l > 0.2) c.setHex(0xd8321e);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    const body = new THREE.Mesh(geo, paintMat);
    body.castShadow = body.receiveShadow = true;
    body.scale.setScalar(1.12);
    group.add(body);
  }
  return group;
}

// ---------------------------------------------------------------- traffic
function traffic(): void {
  const kinds: ModelName[] = ['car-suv', 'car-hatch', 'car-sedan'];
  const colors = [0x2c6db5, 0xf0f0f0, 0x3a3a40];
  kinds.forEach((k, i) => {
    const g = modelGeometry(k);
    if (!g) return;
    const m = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.15, clearcoat: 0.8 }));
    const z = -60 - i * 70;
    const lane = i === 1 ? -2.1 : 2.1;
    m.position.set(roadX(z) + lane, 0, z);
    if (lane < 0) m.rotation.y = Math.PI;
    m.castShadow = true;
    scene.add(m);
    void colors;
  });
}

// ---------------------------------------------------------------- post
const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const ao = new GTAOPass(scene, camera, 2, 2);
ao.blendIntensity = 0.9;
ao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.6, thickness: 1.5, scale: 1.1, samples: 12 });
composer.addPass(
  new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
      void main(){ vec4 c = texture2D(tDiffuse, vUv);
        if (!(c.r >= 0.0) || !(c.g >= 0.0) || !(c.b >= 0.0) || c.r > 1e4 || c.g > 1e4 || c.b > 1e4) c = vec4(0.0);
        gl_FragColor = vec4(min(c.rgb, vec3(16.0)), 1.0); }`,
  }),
);
composer.addPass(ao);
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.55, 0.88);
composer.addPass(bloom);
composer.addPass(
  new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        float l = dot(c.rgb, vec3(0.2126,0.7152,0.0722));
        c.rgb = mix(vec3(l), c.rgb, 1.12);
        vec2 d = vUv - 0.5;
        c.rgb *= 1.0 - 0.38 * dot(d, d) * 1.6;
        gl_FragColor = c;
      }`,
  }),
);
composer.addPass(new OutputPass());

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
  bloom.resolution.set(w / 2, h / 2);
  camera.aspect = w / h;
  camera.fov = w < h ? 62 : 50;
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- generated models (?car=gen/x.glb&saucer=gen/y.glb)
function loadGen(url: string, yawDeg: number, size: number, clearcoat: number): Promise<THREE.Object3D> {
  return new GLTFLoader().loadAsync(url).then((g) => {
    const root = g.scene;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const old = m.material as THREE.MeshStandardMaterial;
      const mat = new THREE.MeshPhysicalMaterial({ map: old.map, normalMap: old.normalMap, roughnessMap: old.roughnessMap, metalnessMap: old.metalnessMap,
        roughness: old.roughness, metalness: old.metalness, clearcoat, clearcoatRoughness: 0.08 });
      m.material = mat;
      m.castShadow = m.receiveShadow = true;
    });
    const box = new THREE.Box3().setFromObject(root);
    const dims = box.getSize(new THREE.Vector3());
    root.scale.setScalar(size / Math.max(dims.x, dims.z));
    box.setFromObject(root);
    root.position.y -= box.min.y;
    root.position.x -= (box.min.x + box.max.x) / 2;
    root.position.z -= (box.min.z + box.max.z) / 2;
    const pivot = new THREE.Group();
    const inner = new THREE.Group();
    inner.add(root);
    inner.rotation.y = THREE.MathUtils.degToRad(yawDeg);
    pivot.add(inner);
    return pivot;
  });
}

// ---------------------------------------------------------------- go
const status = document.getElementById('status')!;
void loadModels().then(async () => {
  scatter('cactus-1', 70, 3, 90, [0.8, 1.3]);
  scatter('cactus-2', 50, 6, 120, [0.7, 1.2]);
  scatter('cactus-3', 40, 6, 120, [0.7, 1.1]);
  scatter('bush-1', 420, 1, 120, [0.7, 1.6]);
  scatter('bush-2', 320, 1, 120, [0.7, 1.5]);
  scatter('grass', 900, 0.2, 40, [0.6, 1.3]);
  scatter('rock-1', 160, 2, 140, [0.6, 2.6]);
  scatter('rock-2', 160, 1, 140, [0.6, 2.2]);
  scatter('rock-3', 120, 1, 140, [0.8, 3.4]);
  scatter('tree-dead', 12, 8, 80, [0.7, 1.0]);
  poles();
  reflectors();
  traffic();
  const genCar = params.get('car');
  const car = genCar ? await loadGen(genCar, Number(params.get('caryaw') ?? 270), 4.4, 0.7) : playerCar();
  // ?props=url:size:side:z:yaw;... places models beside the road (size = longest side in metres, side = metres from the road centre).
  for (const spec of (params.get('props') ?? '').split(';').filter(Boolean)) {
    const [url, size, side, z, yaw] = spec.split(':');
    const prop = await loadGen(url, Number(yaw ?? 0), Number(size), 0);
    const zz = Number(z);
    prop.position.set(roadX(zz) + Number(side), 0, zz);
    scene.add(prop);
  }
  const genSaucer = params.get('saucer');
  if (genSaucer) {
    const sc = await loadGen(genSaucer, Number(params.get('saucyaw') ?? 200), 7, 0.3);
    sc.position.set(roadX(-34) - 1, 6.5, -34);
    sc.rotation.z = 0.08;
    scene.add(sc);
  }
  const carZ = 0;
  car.position.set(roadX(carZ) + 2.1, 0, carZ);
  car.lookAt(roadX(carZ - 8) + 2.1, 0, carZ - 8);
  scene.add(car);
  // Same chase camera as the game: 14 back, 7 up, looking 20 ahead.
  camera.position.set(roadX(carZ + 12) + 1.6, 6.2, carZ + 12);
  camera.lookAt(roadX(carZ - 20) + 1.2, 1.2, carZ - 20);
  sun.position.copy(car.position).addScaledVector(sunDir, 200);
  sun.target.position.copy(car.position).add(new THREE.Vector3(0, 0, -30));
  resize();
  // Draw a few frames and stop (keeps headless screenshots fast); ?live=1 keeps drawing.
  let frames = 0;
  const live = params.has('live');
  const tick = () => {
    composer.render();
    if (++frames === 3) status.textContent = 'ready';
    if (live || frames < 3) requestAnimationFrame(tick);
  };
  tick();
});
window.addEventListener('resize', resize);
