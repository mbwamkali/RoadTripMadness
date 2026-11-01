import * as THREE from 'three';
import type { Vec2 } from '../geo/geo';
import type { Upgrades } from '../game/upgrades';

/** Game plane (x east, y north) to three.js world (x, 0, -y). */
export const to3 = (p: Vec2, h = 0) => new THREE.Vector3(p.x, h, -p.y);

export interface GameScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  update(dt: number): void;
  resize(w: number, h: number): void;
  dispose(): void;
}

export function makeRoadTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3b3b40';
  g.fillRect(0, 0, 128, 256);
  // Grain so the asphalt reads as moving.
  for (let i = 0; i < 900; i++) {
    const v = 50 + Math.random() * 30;
    g.fillStyle = `rgb(${v},${v},${v + 4})`;
    g.fillRect(Math.random() * 128, Math.random() * 256, 2, 2);
  }
  g.fillStyle = '#e8e2cf';
  g.fillRect(6, 0, 4, 256);
  g.fillRect(118, 0, 4, 256);
  g.fillStyle = '#f2c230';
  g.fillRect(61, 0, 6, 150);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Asphalt with lane markings for wider roads.
 * 'highway': four lanes, double yellow in the middle, dashed white between lanes.
 * 'carriageway': one side of a divided road, four lanes, yellow on the median side (left).
 */
export function makeLaneTexture(kind: 'highway' | 'carriageway'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = kind === 'carriageway' ? '#46464b' : '#3e3e43';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1600; i++) {
    const v = 52 + Math.random() * 30;
    g.fillStyle = `rgb(${v},${v},${v + 4})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const lane = 256 / 4;
  g.fillStyle = '#e8e2cf';
  g.fillRect(250 - 2, 0, 4, 256); // right edge
  if (kind === 'highway') {
    g.fillRect(4, 0, 4, 256); // left edge
    g.fillStyle = '#f2c230';
    g.fillRect(128 - 7, 0, 4, 256);
    g.fillRect(128 + 3, 0, 4, 256);
    g.fillStyle = '#e8e2cf';
    for (const x of [lane, lane * 3]) g.fillRect(x - 2, 0, 4, 110);
  } else {
    g.fillStyle = '#f2c230';
    g.fillRect(6, 0, 4, 256); // median edge
    g.fillStyle = '#e8e2cf';
    for (const x of [lane, lane * 2, lane * 3]) g.fillRect(x - 2, 0, 4, 110);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const BLINK_OFF = 0x5a3a10;
export const BLINK_ON = 0xffb020;

let glowTex: THREE.CanvasTexture | null = null;

/** Soft round glow, shared by every blinker. */
function glowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

/** Turns a car's indicators on or off. side: 'L', 'R' or null for both off. */
export function setBlinkers(car: THREE.Object3D, side: 'L' | 'R' | null, lit: boolean): void {
  car.traverse((o) => {
    const m = o as THREE.Mesh;
    if (o.name === 'blinkL' || o.name === 'blinkR') {
      const on = lit && o.name === `blink${side}`;
      (m.material as THREE.MeshBasicMaterial).color.setHex(on ? BLINK_ON : BLINK_OFF);
    } else if (o.name === 'glowL' || o.name === 'glowR') {
      (m.material as THREE.MeshBasicMaterial).opacity = lit && o.name === `glow${side}` ? 0.55 : 0;
    }
  });
}

/** A chunky low-poly muscle car built from boxes. Faces +z. */
export function makeCar(color = 0xd9482b, up?: Upgrades): THREE.Group {
  const car = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1d1d22 });
  const glass = new THREE.MeshLambertMaterial({ color: 0x8fc6e8, emissive: 0x112233 });
  const metal = new THREE.MeshLambertMaterial({ color: 0x9a9a9a });

  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 4.2), paint);
  body.position.y = 0.75;
  car.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2), glass);
  cabin.position.set(0, 1.35, -0.3);
  car.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.12, 1.8), paint);
  roof.position.set(0, 1.7, -0.3);
  car.add(roof);
  // Spiked bumper and a roof gun: this car is ready for trouble.
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.3, 0.3), metal);
  bumper.position.set(0, 0.55, 2.2);
  car.add(bumper);
  for (const x of [-0.8, 0, 0.8]) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 5), metal);
    spike.rotation.x = Math.PI / 2;
    spike.position.set(x, 0.55, 2.55);
    car.add(spike);
  }
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 1.2), dark);
  gun.position.set(0, 1.9, 0);
  gun.name = 'gun';
  car.add(gun);
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.35, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const [x, z] of [
    [-1, 1.3],
    [1, 1.3],
    [-1, -1.3],
    [1, -1.3],
  ]) {
    const w = new THREE.Mesh(wheelGeo, dark);
    w.position.set(x, 0.42, z);
    w.name = 'wheel';
    car.add(w);
  }
  const lights = new THREE.MeshBasicMaterial({ color: 0xfff3b0 });
  for (const x of [-0.65, 0.65]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.05), lights);
    l.position.set(x, 0.85, 2.11);
    car.add(l);
  }
  const tail = new THREE.MeshBasicMaterial({ color: 0x9a1a10 });
  for (const x of [-0.6, 0.6]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.05), tail);
    l.position.set(x, 0.85, -2.11);
    car.add(l);
  }
  // Turn signals. The car faces +z, so its right-hand side is -x.
  for (const side of ['L', 'R'] as const) {
    const x = side === 'L' ? 0.9 : -0.9;
    const mat = new THREE.MeshBasicMaterial({ color: BLINK_OFF });
    for (const z of [2.12, -2.12]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.08), mat);
      b.position.set(x, 0.9, z);
      b.name = `blink${side}`;
      car.add(b);
    }
    // A glow card that makes the blink readable from the chase camera.
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 1.4),
      new THREE.MeshBasicMaterial({ color: BLINK_ON, map: glowTexture(), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    glow.position.set(x * 1.05, 0.9, -2.2);
    glow.name = `glow${side}`;
    car.add(glow);
  }
  if (up) addUpgradeParts(car, up, metal, dark);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 4.8),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  car.add(shadow);
  return car;
}

/** A sprite with text drawn on it, for road signs. */
export function textSprite(text: string, sub = '', bg = '#1f6b3a'): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 192;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.strokeStyle = '#ffffff';
  g.lineWidth = 10;
  g.beginPath();
  g.roundRect(8, 8, 496, 176, 20);
  g.fill();
  g.stroke();
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.font = 'bold 60px system-ui, sans-serif';
  g.fillText(text.slice(0, 18), 256, sub ? 92 : 115);
  if (sub) {
    g.font = '40px system-ui, sans-serif';
    g.fillText(sub.slice(0, 26), 256, 150);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set(8, 3, 1);
  return s;
}

export function disposeTree(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = (m as { material?: THREE.Material | THREE.Material[] }).material;
    const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
    for (const x of mats) {
      (x as THREE.MeshBasicMaterial).map?.dispose();
      x.dispose();
    }
  });
}

export function addLights(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xfff6e0, 0x8a6a45, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(40, 80, 30);
  scene.add(sun);
}

/** Bolts visible upgrades onto the car so players can see what they bought. */
function addUpgradeParts(car: THREE.Group, up: Upgrades, metal: THREE.Material, dark: THREE.Material): void {
  const plate = new THREE.MeshLambertMaterial({ color: 0x5d6168 });
  for (let i = 0; i < up.armor; i++) {
    for (const x of [-1.06, 1.06]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 1.1), plate);
      p.position.set(x, 0.85, 1.3 - i * 1.25);
      car.add(p);
    }
  }
  if (up.tank > 0) {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.35 + up.tank * 0.05, 0.35 + up.tank * 0.05, 1.6, 10), new THREE.MeshLambertMaterial({ color: 0x3f6b3a }));
    drum.rotation.z = Math.PI / 2;
    drum.position.set(0, 1.4, -1.6);
    car.add(drum);
  }
  if (up.engine > 0) {
    const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.25 + up.engine * 0.08, 0.9), dark);
    scoop.position.set(0, 1.15 + up.engine * 0.04, 1.4);
    car.add(scoop);
    for (const x of [-0.75, 0.75]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.8, 6), metal);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(x, 0.45, -2.3);
      car.add(pipe);
    }
  }
  const gun = car.getObjectByName('gun') as THREE.Mesh | undefined;
  if (gun && up.turret > 0) {
    gun.scale.set(1 + up.turret * 0.4, 1 + up.turret * 0.4, 1 + up.turret * 0.25);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.3, 8), dark);
    base.position.set(0, 1.85, 0);
    car.add(base);
  }
  if (up.ram > 0) {
    const ram = new THREE.Mesh(new THREE.BoxGeometry(2.3 + up.ram * 0.1, 0.4 + up.ram * 0.2, 0.25), metal);
    ram.position.set(0, 0.6 + up.ram * 0.08, 2.45);
    ram.rotation.x = -0.25;
    car.add(ram);
  }
}

const SHADOW_BOX = new THREE.Box3();

/** Lets solid things cast shadows; flat ones (road, water, shoulders) only receive them. */
export function castShadows(root: THREE.Object3D, on: boolean): void {
  if (!on) return;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.receiveShadow = true;
    const geo = m.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    m.updateMatrix();
    const box = SHADOW_BOX.copy(geo.boundingBox!).applyMatrix4(m.matrix);
    const tall = box.max.y - box.min.y > 0.3;
    m.castShadow = tall && !(m.material as THREE.Material).transparent;
  });
}
