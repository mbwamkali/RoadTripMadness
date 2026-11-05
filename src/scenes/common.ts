import * as THREE from 'three';
import { lit } from './materials';
import { modelMesh, modelsWanted } from './models';
import { sampleMotorcycle, sampleTraffic, sampleWreck } from './samples';
import { textureImage } from './textures';
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
  const t = new THREE.CanvasTexture(c);
  const draw = (img: HTMLImageElement | null) => {
    paintAsphalt(g, 128, 256, '#3b3b40', 900, img);
    g.fillStyle = '#e8e2cf';
    g.fillRect(6, 0, 4, 256);
    g.fillRect(118, 0, 4, 256);
    g.fillStyle = '#f2c230';
    g.fillRect(61, 0, 6, 150);
  };
  draw(null);
  withAsphalt(t, draw);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Asphalt under the markings: the photo when it's loaded (Medium/High), otherwise grey with grain. */
function paintAsphalt(g: CanvasRenderingContext2D, w: number, h: number, base: string, grains: number, img: HTMLImageElement | null): void {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  if (img) {
    // 64 px tiles: about 3.5 game units, close to the photo's real 3 m.
    for (let x = 0; x < w; x += 64) for (let y = 0; y < h; y += 64) g.drawImage(img, x, y, 64, 64);
    return;
  }
  // Grain so the asphalt reads as moving.
  for (let i = 0; i < grains; i++) {
    const v = 50 + Math.random() * 30;
    g.fillStyle = `rgb(${v},${v},${v + 4})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}

/** Redraws a canvas texture with the asphalt photo once it has loaded. */
function withAsphalt(t: THREE.CanvasTexture, draw: (img: HTMLImageElement | null) => void): void {
  void textureImage('asphalt').then((img) => {
    if (!img) return;
    draw(img);
    t.needsUpdate = true;
  });
}

/** Plain asphalt with no markings (the main road draws its lines as separate stripes). */
export function makeAsphaltTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  const t = new THREE.CanvasTexture(c);
  const draw = (img: HTMLImageElement | null) => paintAsphalt(g, 128, 128, '#424247', 700, img);
  draw(null);
  withAsphalt(t, draw);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A painted road stripe, solid or dashed (white; the material tints it). Dashes are 40% of the repeat. */
export function makeStripeTexture(dashed: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 4, dashed ? 26 : 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/**
 * Asphalt with lane markings for wider roads.
 * 'highway': four lanes, double yellow in the middle, dashed white between lanes.
 * 'carriageway': one side of a divided road, four lanes, yellow on the median side (left).
 * 'carriageway2': the same with two lanes (country interstates).
 */
export function makeLaneTexture(kind: 'highway' | 'carriageway' | 'carriageway2'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  const t = new THREE.CanvasTexture(c);
  const lane = 256 / 4;
  const draw = (img: HTMLImageElement | null) => {
    paintAsphalt(g, 256, 256, kind === 'highway' ? '#3e3e43' : '#46464b', 1600, img);
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
      for (const x of kind === 'carriageway2' ? [128] : [lane, lane * 2, lane * 3]) g.fillRect(x - 2, 0, 4, 110);
    }
  };
  draw(null);
  withAsphalt(t, draw);
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
  const paint = lit({ color });
  const dark = lit({ color: 0x1d1d22 });
  const glass = lit({ color: 0x8fc6e8, emissive: 0x112233 });
  const metal = lit({ color: 0x9a9a9a });

  // Side-profile shapes pulled across the car's width: a hood that slopes down
  // to the nose, a raked windshield and a fastback rear window.
  const body = new THREE.Mesh(
    profile(2, [
      [-2.1, 0.42],
      [2.1, 0.42],
      [2.1, 0.92],
      [1.9, 1.0],
      [0.8, 1.1],
      [-1.8, 1.1],
      [-2.1, 1.0],
    ]),
    paint,
  );
  car.add(body);
  const cabin = new THREE.Mesh(
    profile(1.72, [
      [0.8, 1.08],
      [-1.6, 1.08],
      [-1.3, 1.66],
      [0.1, 1.66],
    ]),
    glass,
  );
  car.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.1, 1.42), paint);
  roof.position.set(0, 1.7, -0.6);
  car.add(roof);
  // Door pillars between the windows.
  for (const z of [-0.45]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.56, 0.12), paint);
    pillar.position.set(0, 1.38, z);
    car.add(pillar);
  }
  // Dark wheel arches and side mirrors.
  for (const x of [-1.01, 1.01]) {
    for (const z of [1.3, -1.3]) {
      const arch = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.32, 1.1), dark);
      arch.position.set(x, 0.7, z);
      car.add(arch);
    }
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.12), paint);
    mirror.position.set(x * 1.06, 1.18, 0.62);
    car.add(mirror);
  }
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
  const tireGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.35, 14).rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.37, 10).rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.38, 0.05, 0.4);
  for (const [x, z] of [
    [-1, 1.3],
    [1, 1.3],
    [-1, -1.3],
    [1, -1.3],
  ]) {
    // Tire, rim and spokes in one group so the spokes show the wheel turning.
    const w = new THREE.Group();
    w.add(new THREE.Mesh(tireGeo, dark), new THREE.Mesh(rimGeo, metal));
    for (let i = 0; i < 2; i++) {
      const spoke = new THREE.Mesh(spokeGeo, dark);
      spoke.rotation.x = (i * Math.PI) / 2;
      w.add(spoke);
    }
    w.position.set(x, 0.42, z);
    w.name = 'wheel';
    car.add(w);
  }
  const lights = new THREE.MeshBasicMaterial({ color: 0xfff3b0 });
  for (const x of [-0.65, 0.65]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.05), lights);
    l.position.set(x, 0.8, 2.17);
    car.add(l);
  }
  const tail = new THREE.MeshBasicMaterial({ color: 0xd8261a });
  for (const x of [-0.6, 0.6]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.05), tail);
    l.position.set(x, 0.85, -2.17);
    car.add(l);
  }
  // Turn signals. The car faces +z, so its right-hand side is -x.
  for (const side of ['L', 'R'] as const) {
    const x = side === 'L' ? 0.9 : -0.9;
    const mat = new THREE.MeshBasicMaterial({ color: BLINK_OFF });
    for (const z of [2.18, -2.18]) {
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

/** The player's ride: the muscle car, a motorcycle or a pickup truck. Faces +z. */
export function makeRide(ride: 'car' | 'motorcycle' | 'truck', up?: Upgrades): THREE.Group {
  if (ride === 'car') return makeCar(undefined, up);
  const g = new THREE.Group();
  const paint = lit({ color: ride === 'truck' ? 0x2f5d8a : 0xd9482b });
  const dark = lit({ color: 0x1d1d22 });
  const metal = lit({ color: 0x9a9a9a });
  const glass = lit({ color: 0x8fc6e8, emissive: 0x112233 });
  const head = new THREE.MeshBasicMaterial({ color: 0xfff3b0 });
  const tail = new THREE.MeshBasicMaterial({ color: 0xd8261a });
  const wheel = (r: number, w: number, x: number, z: number) => {
    const wg = new THREE.Group();
    wg.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 14).rotateZ(Math.PI / 2), dark));
    wg.add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 10).rotateZ(Math.PI / 2), metal));
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(w + 0.03, 0.05, r * 0.95), dark);
    wg.add(spoke, spoke.clone().rotateX(Math.PI / 2));
    wg.position.set(x, r, z);
    wg.name = 'wheel';
    g.add(wg);
  };
  const signals = (x: number, y: number, zf: number, zb: number) => {
    for (const side of ['L', 'R'] as const) {
      const sx = side === 'L' ? x : -x;
      const mat = new THREE.MeshBasicMaterial({ color: BLINK_OFF });
      for (const z of [zf, zb]) {
        const b = mesh3(new THREE.BoxGeometry(0.2, 0.16, 0.08), mat, sx, y, z);
        b.name = `blink${side}`;
        g.add(b);
      }
      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(1.2, 1.2),
        new THREE.MeshBasicMaterial({ color: BLINK_ON, map: glowTexture(), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
      );
      glow.position.set(sx * 1.05, y, zb - 0.03);
      glow.name = `glow${side}`;
      g.add(glow);
    }
  };
  if (ride === 'motorcycle') {
    // A dirt-bike-ish bike with a rider in a red helmet and a gun strapped to the bars.
    wheel(0.36, 0.16, 0, 0.75);
    wheel(0.36, 0.2, 0, -0.75);
    g.add(new THREE.Mesh(profile(0.34, [[0.75, 0.4], [0.35, 0.95], [-0.5, 0.95], [-0.85, 0.7], [-0.75, 0.4]]), paint));
    g.add(mesh3(new THREE.BoxGeometry(0.42, 0.18, 0.7), dark, 0, 1.0, -0.35)); // seat
    g.add(mesh3(new THREE.BoxGeometry(0.8, 0.06, 0.06), metal, 0, 1.25, 0.55)); // handlebars
    g.add(mesh3(new THREE.BoxGeometry(0.06, 0.6, 0.06), metal, 0, 0.95, 0.65));
    // Rider: leaning forward, arms to the bars.
    const jacket = lit({ color: 0x3a2a1a });
    const torso = mesh3(new THREE.BoxGeometry(0.5, 0.7, 0.32), jacket, 0, 1.45, -0.15);
    torso.rotation.x = 0.35;
    g.add(torso);
    g.add(mesh3(new THREE.SphereGeometry(0.2, 10, 8), paint, 0, 1.95, 0.0)); // helmet
    g.add(mesh3(new THREE.BoxGeometry(0.3, 0.1, 0.06), glass, 0, 1.95, 0.18)); // visor
    for (const x of [-0.26, 0.26]) {
      const arm = mesh3(new THREE.BoxGeometry(0.12, 0.12, 0.6), jacket, x, 1.45, 0.25);
      arm.rotation.x = 0.4;
      g.add(arm, mesh3(new THREE.BoxGeometry(0.14, 0.5, 0.14), dark, x * 0.9, 0.85, -0.2));
    }
    const gun = mesh3(new THREE.BoxGeometry(0.1, 0.1, 0.7), dark, 0.28, 1.12, 0.6);
    gun.name = 'gun';
    g.add(gun);
    g.add(mesh3(new THREE.BoxGeometry(0.22, 0.14, 0.05), head, 0, 1.05, 0.79));
    g.add(mesh3(new THREE.BoxGeometry(0.2, 0.1, 0.05), tail, 0, 0.92, -0.88));
    signals(0.22, 1.0, 0.72, -0.9);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 2.2), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.35, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    g.add(shadow);
    return g;
  }
  // Pickup truck: tall cab, open bed with a roll bar and a heavy gun, big tires.
  g.add(new THREE.Mesh(profile(2.0, [[-2.2, 0.55], [2.2, 0.55], [2.2, 1.15], [1.1, 1.25], [-2.2, 1.25]]), paint));
  g.add(new THREE.Mesh(profile(1.9, [[1.05, 1.23], [-0.2, 1.23], [-0.2, 1.95], [0.65, 1.95]]), glass));
  g.add(mesh3(new THREE.BoxGeometry(1.94, 0.08, 0.85), paint, 0, 1.98, 0.22)); // cab roof
  g.add(mesh3(new THREE.BoxGeometry(1.84, 0.2, 1.9), dark, 0, 1.18, -1.2)); // bed floor
  for (const x of [-0.95, 0.95]) g.add(mesh3(new THREE.BoxGeometry(0.08, 1.0, 0.08), metal, x, 1.75, -0.45));
  g.add(mesh3(new THREE.BoxGeometry(1.98, 0.08, 0.08), metal, 0, 2.25, -0.45)); // roll bar
  const gun = mesh3(new THREE.BoxGeometry(0.24, 0.24, 1.5), dark, 0, 2.05, -0.9);
  gun.name = 'gun';
  g.add(gun);
  g.add(mesh3(new THREE.BoxGeometry(2.3, 0.35, 0.3), metal, 0, 0.7, 2.25)); // bull bar
  for (const [x, z] of [[-1.02, 1.35], [1.02, 1.35], [-1.02, -1.4], [1.02, -1.4]]) wheel(0.55, 0.42, x, z);
  for (const x of [-0.7, 0.7]) {
    g.add(mesh3(new THREE.BoxGeometry(0.4, 0.22, 0.05), head, x, 0.95, 2.23));
    g.add(mesh3(new THREE.BoxGeometry(0.35, 0.3, 0.05), tail, x * 1.2, 1.0, -2.23));
  }
  signals(0.92, 1.05, 2.24, -2.24);
  if (up) addUpgradeParts(g, { ...up, tank: 0 }, metal, dark);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 5), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.35, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  g.add(shadow);
  g.scale.set(1.08, 1.08, 1.12);
  return g;
}

const BIKER_JACKETS = [0x222226, 0x5a3622, 0x2b3a55, 0x6b1f1a];

/** Ordinary traffic: sedans, motorcycles, pickups, vans and big rigs. Faces +z like the player's car. */
export function makeTrafficVehicle(kind: 'car' | 'motorcycle' | 'pickup' | 'van' | 'truck', color: number): THREE.Group {
  if (kind === 'motorcycle') {
    if (!modelsWanted()) return makeRide('motorcycle');
    const jacket = BIKER_JACKETS[Math.abs(color) % BIKER_JACKETS.length];
    return sampleMotorcycle(color, { jacket, skin: 0xd8a77a, pants: 0x2b3a55 });
  }
  // Detailed pickups, vans and semis built in code on Medium and High.
  if (kind !== 'car' && modelsWanted()) return sampleTraffic(kind, color);
  const g = new THREE.Group();
  // CC0 car models on Medium and High; the colour picks which one.
  if (kind === 'car') {
    const model = modelMesh(CAR_MODELS[Math.abs(color) % CAR_MODELS.length]);
    if (model) {
      g.add(model);
      return g;
    }
  }
  const paint = lit({ color });
  const dark = lit({ color: 0x1d1d22 });
  const glass = lit({ color: 0x6f93ad, emissive: 0x0b1620 });
  const tail = new THREE.MeshBasicMaterial({ color: 0xc81e14 });
  const head = new THREE.MeshBasicMaterial({ color: 0xfff3c8 });
  const wheel = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 10).rotateZ(Math.PI / 2);
  const wheels = (zs: number[], x = 0.95) => {
    for (const z of zs) for (const sx of [-x, x]) g.add(mesh3(wheel, dark, sx, 0.4, z));
  };
  const lights = (front: number, back: number, y = 0.8, x = 0.6) => {
    for (const sx of [-x, x]) {
      g.add(mesh3(new THREE.BoxGeometry(0.35, 0.18, 0.05), head, sx, y, front));
      g.add(mesh3(new THREE.BoxGeometry(0.35, 0.18, 0.05), tail, sx, y, back));
    }
  };
  if (kind === 'car') {
    g.add(new THREE.Mesh(profile(1.85, [[-2.15, 0.4], [2.15, 0.4], [2.15, 0.85], [0.9, 1.0], [-1.9, 1.0], [-2.15, 0.9]]), paint));
    g.add(new THREE.Mesh(profile(1.6, [[0.9, 0.98], [-1.5, 0.98], [-1.15, 1.48], [0.25, 1.48]]), glass));
    wheels([1.35, -1.35]);
    lights(2.2, -2.2);
  } else if (kind === 'pickup') {
    g.add(new THREE.Mesh(profile(1.95, [[-2.5, 0.5], [2.5, 0.5], [2.5, 1.05], [1.3, 1.15], [-2.5, 1.15]]), paint));
    g.add(new THREE.Mesh(profile(1.8, [[1.2, 1.13], [-0.3, 1.13], [-0.3, 1.8], [0.75, 1.8]]), glass));
    // Open bed behind the cab.
    g.add(mesh3(new THREE.BoxGeometry(1.8, 0.3, 2.0), dark, 0, 1.08, -1.4));
    wheels([1.6, -1.6], 1.0);
    lights(2.55, -2.55, 0.9);
  } else if (kind === 'van') {
    g.add(new THREE.Mesh(profile(2.0, [[-2.6, 0.45], [2.6, 0.45], [2.6, 1.1], [1.8, 2.2], [-2.6, 2.2]]), paint));
    g.add(new THREE.Mesh(profile(2.02, [[2.45, 1.25], [1.85, 2.05], [1.4, 2.05], [1.4, 1.25]]), glass));
    wheels([1.7, -1.7], 1.0);
    lights(2.65, -2.65, 0.85, 0.7);
  } else {
    // Semi: a cab up front and a long box trailer.
    const cab = lit({ color });
    g.add(new THREE.Mesh(profile(2.4, [[4.5, 0.7], [7, 0.7], [7, 2.2], [6.6, 3.2], [4.5, 3.2]]), cab));
    g.add(new THREE.Mesh(profile(2.42, [[6.95, 2.3], [6.6, 3.0], [6.0, 3.0], [6.0, 2.3]]), glass));
    const trailer = lit({ color: 0xdedede });
    g.add(mesh3(new THREE.BoxGeometry(2.5, 3.0, 11), trailer, 0, 2.4, -1.2));
    g.add(mesh3(new THREE.BoxGeometry(1.2, 0.4, 13), dark, 0, 0.8, -0.2));
    wheels([6.2, 4.9, -4.5, -5.7], 1.05);
    lights(7.05, -6.75, 0.9, 0.9);
  }
  // Centre the trucks so their middle sits where the traffic logic puts them.
  if (kind === 'truck') g.children.forEach((c) => (c.position.z -= 0.15));
  return g;
}

/** Things in the road: debris, a lone zombie, a burnt-out wreck or a barricade. */
export function makeObstacle(kind: 'debris' | 'zombie' | 'wreck' | 'roadblock'): THREE.Group {
  const g = new THREE.Group();
  const lam = (color: number) => lit({ color });
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, ry = 0) => {
    const m = mesh3(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
    m.rotation.y = ry;
    g.add(m);
    return m;
  };
  if (kind === 'debris') {
    // A shredded tire, a couple of crates and a sheet of plywood.
    const tire = mesh3(new THREE.TorusGeometry(0.42, 0.18, 6, 12), lam(0x1b1b1b), -0.6, 0.18, 0.2);
    tire.rotation.x = Math.PI / 2;
    g.add(tire);
    box(0.6, 0.5, 0.6, lam(0x9a6b3a), 0.5, 0.25, -0.3, 0.4);
    box(0.45, 0.4, 0.45, lam(0x7d5530), 0.7, 0.2, 0.5, -0.3);
    box(1.4, 0.05, 0.9, lam(0xb08a5a), 0, 0.03, 0.6, 0.7);
  } else if (kind === 'zombie' && modelMesh('zombie')) {
    g.add(modelMesh('zombie')!);
    g.scale.setScalar(1.15);
    g.name = 'zombie';
  } else if (kind === 'zombie') {
    const skin = lam(0x8fbf5a);
    box(0.7, 0.9, 0.45, lam(0x4a5d7a), 0, 1.15, 0); // torn shirt
    box(0.55, 0.55, 0.55, skin, 0, 1.9, 0);
    box(0.22, 0.22, 0.65, skin, -0.45, 1.45, 0.3).name = 'armL';
    box(0.22, 0.22, 0.65, skin, 0.45, 1.45, 0.3).name = 'armR';
    box(0.26, 0.75, 0.26, lam(0x3b3328), -0.18, 0.37, 0);
    box(0.26, 0.75, 0.26, lam(0x3b3328), 0.18, 0.37, 0);
    const eye = new THREE.MeshBasicMaterial({ color: 0xff2020 });
    box(0.1, 0.1, 0.04, eye, -0.13, 1.95, 0.28);
    box(0.1, 0.1, 0.04, eye, 0.13, 1.95, 0.28);
    g.scale.setScalar(1.3);
    g.name = 'zombie';
  } else if (kind === 'wreck' && modelsWanted()) {
    g.add(sampleWreck());
  } else if (kind === 'wreck') {
    // A burnt-out car turned across the lane.
    const car = makeTrafficVehicle('car', 0x3a2e28);
    car.rotation.y = 0.5;
    car.rotation.z = 0.08;
    car.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = lam(0x2e2924);
    });
    g.add(car);
  } else {
    // Sawhorse barricade with red and white boards and a couple of tires.
    const stripes = document.createElement('canvas');
    stripes.width = 64;
    stripes.height = 16;
    const c = stripes.getContext('2d')!;
    for (let i = 0; i < 8; i++) {
      c.fillStyle = i % 2 ? '#f2f2f2' : '#d42a1e';
      c.beginPath();
      c.moveTo(i * 10 - 8, 16);
      c.lineTo(i * 10 + 2, 0);
      c.lineTo(i * 10 + 12, 0);
      c.lineTo(i * 10 + 2, 16);
      c.fill();
    }
    const board = lit({ map: new THREE.CanvasTexture(stripes) });
    (board.map as THREE.Texture).colorSpace = THREE.SRGBColorSpace;
    box(3.2, 0.35, 0.08, board, 0, 1.0, 0);
    box(3.2, 0.35, 0.08, board, 0, 0.5, 0);
    const leg = lam(0x7a7a7a);
    for (const x of [-1.4, 1.4]) {
      box(0.08, 1.2, 0.08, leg, x, 0.6, 0.15).rotation.x = 0.25;
      box(0.08, 1.2, 0.08, leg, x, 0.6, -0.15).rotation.x = -0.25;
    }
    const lamp = new THREE.MeshBasicMaterial({ color: 0xffa020 });
    box(0.18, 0.18, 0.1, lamp, -1.4, 1.3, 0);
    box(0.18, 0.18, 0.1, lamp, 1.4, 1.3, 0);
  }
  return g;
}

const CAR_MODELS = ['car-sedan', 'car-hatch', 'car-suv', 'car-taxi', 'car-sports', 'car-sedan', 'car-cop'] as const;

function mesh3(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/** A side profile (points as [z, y], the car facing +z) extruded across a width, centred on x = 0. */
function profile(width: number, pts: [number, number][]): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 1 });
  // Shape x becomes the car's length (z); the extrusion becomes its width (x).
  geo.rotateY(-Math.PI / 2);
  geo.translate(width / 2, 0, 0);
  return geo;
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
    if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
    const mat = (m as { material?: THREE.Material | THREE.Material[] }).material;
    const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
    for (const x of mats) {
      if (x.userData.shared) continue;
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
  const plate = lit({ color: 0x5d6168 });
  for (let i = 0; i < up.armor; i++) {
    for (const x of [-1.06, 1.06]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 1.1), plate);
      p.position.set(x, 0.85, 1.3 - i * 1.25);
      car.add(p);
    }
  }
  if (up.tank > 0) {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.35 + up.tank * 0.05, 0.35 + up.tank * 0.05, 1.6, 10), lit({ color: 0x3f6b3a }));
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
