import * as THREE from 'three';
import { Atmosphere } from './atmosphere';
import { Backdrop } from './backdrop';
import { BLINK_OFF, BLINK_ON, castShadows, disposeTree, makeAsphaltTexture, makeObstacle, makeRide, makeStripeTexture, type GameScene } from './common';
import { hdModelsReady, hdZombie, loadHdModels } from './hdModels';
import { lit } from './materials';
import { loadModels, modelMesh, modelsWanted, type ModelName } from './models';
import { detailTexture } from './textures';
import { addGroundDetail } from './groundDetail';
import { makeAnimal } from './animalModels';
import { sampleCatship, sampleMothership } from './samples';
import { person, type Person } from './people';
import { quality } from './quality';
import { sound } from '../audio/sound';

/**
 * The title screen's live scene: the player's car idling on a desert road at
 * golden hour, while a zombie, an alien cat, a cow, the saucer and now and
 * then the Cat Queen wander past. Tapping one of them (or the car) gets a
 * sound and a silly line. On Low graphics only the car and the road show.
 * The scene is built when the title opens and thrown away when it closes.
 */

export type Passer = 'zombie' | 'cat' | 'saucer' | 'cow' | 'queen';
export type Tapped = Passer | 'car';

/** What each one says when tapped (shown in a bubble, and read out in kid mode). */
export const TAP_LINES: Record<Tapped, { icon: string; text: string }[]> = {
  zombie: [
    { icon: '🧟', text: 'Braaains… I mean, gas!' },
    { icon: '🧟', text: 'Uuurgh! Wait for me!' },
  ],
  cat: [
    { icon: '👽', text: 'Meow! Take me to your leader!' },
    { icon: '👽', text: 'Mrrrow! This planet has yarn!' },
  ],
  saucer: [{ icon: '🛸', text: 'Beep boop… meow!' }],
  cow: [{ icon: '🐄', text: 'Moooove over!' }],
  queen: [{ icon: '👑', text: 'Bow to the Cat Queen!' }],
  car: [
    { icon: '🚗', text: "Beep beep! Let's go!" },
    { icon: '🚗', text: 'Vroom vroom!' },
  ],
};

/**
 * Each kind crosses the road side to side in its own lane (a fixed z: the car
 * sits at z 0, nose towards +z, about 2.3 long each way), so nobody walks
 * through the car, the sign or each other. `margin` is how far past the edge
 * of the picture it starts and ends (about half its own width, plus a bit).
 */
const PATHS: Record<Passer, { z: number; y: number; speed: number; margin: number }> = {
  zombie: { z: 4.8, y: 0, speed: 1.1, margin: 2 },
  cat: { z: -11, y: 0, speed: 2.6, margin: 3 },
  queen: { z: -16, y: 0, speed: 1.8, margin: 2 },
  cow: { z: -21, y: 0, speed: 1.0, margin: 3 },
  saucer: { z: -80, y: 9, speed: 9, margin: 12 },
};
/** Scenery stays this far from every lane, and off the road. */
const LANE_CLEAR = 2.6;
const ROAD_HALF = 4;
const SHOULDER = 1.6;
/** Desert colours from the driving view (biomes.ts). */
const SKY = 0xf2c58f;
const SAND = 0xd8b07a;
const VERGE = 0xb88c5a;

interface Walker {
  kind: Passer;
  obj: THREE.Group;
  person: Person | null;
  dir: 1 | -1;
  /** Where it is across the road (world x), and where it leaves the picture. */
  x: number;
  end: number;
  /** Which way it faces (the models face +z at 0). */
  heading: number;
  t: number;
  scared: number;
}

const CAR_X = 1.9;
const TMP_BOX = new THREE.Box3();
const TMP_V = new THREE.Vector3();

export class TitleScene implements GameScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.5, 1600);
  private atmosphere: Atmosphere;
  private backdrop = new Backdrop(1300);
  private car: THREE.Group;
  /** Exhaust puffs are points, not sprites: the High quality shading pass skips points, so they never turn into dark boxes. */
  private puffs: THREE.Points[] = [];
  private puffTex = puffTexture();
  private hdTried = false;
  private walkers: Walker[] = [];
  private bag: Passer[] = [];
  private next = 1.2;
  private time = 0;
  private honk = 0;
  private extras = modelsWanted();
  private ray = new THREE.Raycaster();
  private disposed = false;
  private size = new THREE.Vector2(1, 1);
  private gapY = -1;
  private fitClock = 0;

  constructor() {
    const q = quality.profile;
    // The same desert look as the driving view: warm sky, haze from 300 m, far mesas.
    this.atmosphere = new Atmosphere(this.scene, SKY, 300, 1300, q.shadows ? { size: Math.min(1024, q.shadowSize), range: 30 } : null);
    this.atmosphere.set(17.6, 'clear');
    this.backdrop.setBiome('desert');
    this.scene.add(this.backdrop.group);
    this.addGround();
    this.addSign();
    // The plant and rock models are usually loaded by now; until they are (and on Low) simple shapes stand in.
    if (this.extras) {
      void loadModels().then((ok) => {
        if (!this.disposed) this.addScenery(ok);
      });
    } else this.addScenery(false);

    this.car = this.makeCar();
    // The title often opens before the detailed models arrive: swap the car in when they do.
    if (this.extras && !hdModelsReady()) {
      void loadHdModels().then(() => {
        if (!this.disposed) this.swapCar();
      });
    }

    // Exhaust puffs drifting up from the tailpipe.
    for (let i = 0; i < 6; i++) {
      const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
      const mat = new THREE.PointsMaterial({ map: this.puffTex, color: 0xe8e2d6, transparent: true, depthWrite: false, opacity: 0.4, sizeAttenuation: true });
      const p = new THREE.Points(geo, mat);
      p.frustumCulled = false;
      p.userData.age = i / 6;
      this.puffs.push(p);
      this.scene.add(p);
    }
  }

  private swapCar(): void {
    this.hdTried = true;
    this.scene.remove(this.car);
    disposeTree(this.car);
    this.car = this.makeCar();
  }

  /** Sand with the photo grain and soft patches, an asphalt road with painted lines, and gravel verges. */
  private addGround(): void {
    const size = 2400;
    const tile = 60;
    const groundMat = lit({
      color: SAND,
      map: detailTexture('ground', size / tile, size / tile),
      normalMap: detailTexture('ground_n', size / tile, size / tile),
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 4,
    });
    if (this.extras) addGroundDetail(groundMat);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const len = 700;
    const flat = (w: number, x: number, mat: THREE.Material, y: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, -len / 2 + 60);
      m.receiveShadow = true;
      this.scene.add(m);
      return m;
    };
    const verge = lit({ color: VERGE, map: detailTexture('gravel', 1, len / 6), roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    for (const side of [-1, 1]) flat(SHOULDER, side * (ROAD_HALF + SHOULDER / 2), verge, 0.01);

    const asphalt = makeAsphaltTexture();
    asphalt.repeat.set(ROAD_HALF / 4, len / 8);
    const normal = detailTexture('asphalt_n', ROAD_HALF / 2, len / 4);
    flat(ROAD_HALF * 2, 0, lit({ map: asphalt, normalMap: normal, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }), 0.02);

    // Painted lines: a dashed yellow centre line and solid white edge lines, as on a two-lane highway.
    const stripe = (dashed: boolean, color: number, x: number, w: number) => {
      const t = makeStripeTexture(dashed);
      t.repeat.set(1, len / (dashed ? 12 : 4));
      flat(w, x, new THREE.MeshStandardMaterial({ map: t, color, roughness: 0.7, transparent: dashed, alphaTest: dashed ? 0.5 : 0, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 }), 0.03);
    };
    stripe(true, 0xf2c230, 0, 0.16);
    for (const side of [-1, 1]) stripe(false, 0xf4f2ea, side * (ROAD_HALF - 0.3), 0.14);
  }

  /** A real green exit sign on two posts (a board, not a flat picture that turns to face you). */
  private addSign(): void {
    const g = new THREE.Group();
    const face = new THREE.CanvasTexture(signCanvas('MADNESS', 'NEXT EXIT'));
    face.colorSpace = THREE.SRGBColorSpace;
    face.anisotropy = 4;
    const green = lit({ color: 0x1f6b3a, roughness: 0.6 });
    const back = lit({ color: 0x7c838b, roughness: 0.7, metalness: 0.3 });
    // Box faces: +x, -x, +y, -y, +z (front), -z (back).
    const board = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.95, 0.1), [green, green, green, green, lit({ map: face, roughness: 0.5 }), back]);
    board.position.y = 2.9;
    g.add(board);
    const post = lit({ color: 0x8a8f96, roughness: 0.5, metalness: 0.5 });
    for (const x of [-1.4, 1.4]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 3.8, 8), post);
      pole.position.set(x, 1.9, -0.12);
      g.add(pole);
    }
    g.position.set(7.8, 0, -26);
    // Turned a little towards the camera, as signs are angled to the road's traffic.
    g.rotation.y = -0.3;
    castShadows(g, quality.profile.shadows);
    this.scene.add(g);
  }

  private makeCar(): THREE.Group {
    const car = makeRide('car');
    car.position.set(CAR_X, 0, 0);
    car.rotation.y = -0.12;
    // No roof gun on the title: it's a family car out for a drive.
    const gun = car.getObjectByName('gun');
    if (gun) gun.visible = false;
    castShadows(car, quality.profile.shadows);
    this.scene.add(car);
    return car;
  }

  private addScenery(models: boolean): void {
    const cactus = lit({ color: 0x4f7a3a, roughness: 0.8 });
    const rock = lit({ color: 0x9a6a4a, roughness: 1, flatShading: true });
    // x, z, kind, size. Every spot is clear of the walkers' lanes, the road and the sign.
    const spots: [number, number, ModelName, number][] = [
      [-10, -3, 'cactus-1', 0.9],
      [12, -2.5, 'rock-1', 1.2],
      [-8.5, 0.5, 'bush-1', 1],
      [9.5, 1, 'bush-2', 0.9],
      [-15, -34, 'cactus-2', 1],
      [15, -38, 'cactus-3', 0.9],
      [-8, -45, 'rock-2', 1.4],
      [11.5, -31, 'bush-1', 1.1],
      [-11, -29, 'rock-3', 1],
      [22, -60, 'cactus-2', 1.1],
      [-27, -72, 'rock-1', 1.6],
      [-30, -52, 'cactus-1', 1],
      [30, -90, 'cactus-3', 1.2],
      [12, 12, 'rock-2', 1],
    ];
    for (const [x, z, name, k] of spots) {
      if (Math.abs(x) < ROAD_HALF + SHOULDER + 1 || Object.values(PATHS).some((p) => p.y === 0 && Math.abs(p.z - z) < LANE_CLEAR)) continue;
      let obj: THREE.Object3D | null = models ? modelMesh(name) : null;
      if (!obj) {
        const g = new THREE.Group();
        if (name.startsWith('cactus')) {
          g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 3, 8), cactus).translateY(1.5));
          const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.2, 8), cactus);
          arm.position.set(0.55, 2, 0);
          g.add(arm, new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.6, 8).rotateZ(Math.PI / 2), cactus).translateY(1.5).translateX(0.3));
        } else if (name.startsWith('rock')) {
          g.add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.8, 0), rock).translateY(0.3));
        } else continue;
        obj = g;
      }
      obj.position.set(x, 0, z);
      obj.rotation.y = x * 1.7 + z;
      obj.scale.setScalar(k);
      castShadows(obj, quality.profile.shadows);
      this.scene.add(obj);
    }
  }

  resize(w: number, h: number): void {
    const aspect = w / Math.max(1, h);
    this.camera.aspect = aspect;
    // Keep about 60° across, so a tall phone sees the whole scene too (just more sky and road).
    const across = THREE.MathUtils.degToRad(60);
    const vfov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(across / 2) / aspect));
    this.camera.fov = THREE.MathUtils.clamp(vfov, 38, 95);
    // Tall screens: come in a little closer, so the car fills more of the gap.
    const tall = THREE.MathUtils.clamp((1.2 - aspect) / 0.7, 0, 1);
    this.camera.position.set(-6.5 + tall * 1.6, 2.4 + tall * 0.3, 10.5 - tall * 2.6);
    this.camera.lookAt(0.9, 0.9, -2);
    this.size.set(w, h);
    this.fitGap();
    this.backdrop.follow(this.camera);
  }

  /**
   * Shifts the picture so the car sits in the middle of the gap between the logo
   * and the buttons (the menu's .title-view), whatever the screen's shape.
   */
  private fitGap(): void {
    const [w, h] = [this.size.x, this.size.y];
    const gap = document.querySelector('.title .title-view')?.getBoundingClientRect();
    const cy = gap && gap.height > 0 ? THREE.MathUtils.clamp((gap.top + gap.bottom) / 2 + 20, h * 0.25, h * 0.6) : h * 0.5;
    if (Math.abs(cy - this.gapY) > 1 || !this.camera.view) {
      this.gapY = cy;
      this.camera.setViewOffset(w, h, 0, h / 2 - cy, w, h);
    }
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.time += dt;
    // The menu lays itself out after the scene starts (and fonts can shift it), so re-check now and then.
    this.fitClock -= dt;
    if (this.fitClock <= 0) {
      this.fitClock = 0.5;
      this.fitGap();
      // Belt and braces: if the detailed car is ready but this one is still the code model, swap once.
      if (this.extras && !this.hdTried && hdModelsReady() && !this.car.getObjectByName('hd')) this.swapCar();
    }
    this.atmosphere.update(dt, this.camera, this.car.position);
    // The engine idles: a little shake, and a hop when it honks.
    this.honk = Math.max(0, this.honk - dt);
    const hop = this.honk > 0 ? Math.sin((1 - this.honk / 0.6) * Math.PI) * 0.25 : 0;
    this.car.position.y = Math.abs(Math.sin(this.time * 31)) * 0.012 + hop;
    this.car.rotation.z = Math.sin(this.time * 17) * 0.004;
    this.flash(this.honk > 0 && Math.floor(this.honk * 8) % 2 === 0);
    this.updatePuffs(dt);
    if (!this.extras) return;
    this.next -= dt;
    if (this.next <= 0 && this.walkers.length < 2) this.spawn();
    for (const w of [...this.walkers]) this.move(w, dt);
  }

  private updatePuffs(dt: number): void {
    // The tailpipe is at the back of the car (the car faces +z).
    const back = TMP_V.set(-0.6, 0.35, -2.5).applyMatrix4(this.car.matrixWorld);
    // Points are sized in pixels at 1 m; this turns a size in metres into that.
    const perMetre = 1 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    for (const p of this.puffs) {
      let age = (p.userData.age as number) + dt * 0.7;
      if (age >= 1) age -= 1;
      p.userData.age = age;
      p.position.set(back.x - age * 0.8, back.y + age * 1.4, back.z - age * 1.2);
      const m = p.material as THREE.PointsMaterial;
      m.size = (0.35 + age * 1.2) * perMetre;
      m.opacity = 0.4 * (1 - age) * Math.min(1, age * 6);
    }
  }

  private flash(on: boolean): void {
    this.car.traverse((o) => {
      if (o.name !== 'blinkL' && o.name !== 'blinkR') return;
      ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(on ? BLINK_ON : BLINK_OFF);
    });
  }

  private spawn(): void {
    if (!this.bag.length) {
      this.bag = shuffle<Passer>(['zombie', 'cat', 'saucer', 'cow', 'zombie', 'cat']);
      // The first one is always a zombie, so there's something walking straight away.
      if (this.time < 1) this.bag.unshift('zombie');
      else if (Math.random() < 0.5) this.bag.push('queen');
    }
    const i = this.bag.findIndex((k) => !this.walkers.some((w) => w.kind === k));
    if (i < 0) return;
    const kind = this.bag.splice(i, 1)[0];
    const made = this.make(kind);
    if (!made) {
      this.next = 0.2;
      return;
    }
    const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    const path = PATHS[kind];
    const [lo, hi] = this.visibleSpan(path.z, path.y + 1);
    const w: Walker = {
      kind,
      obj: made.obj,
      person: made.person,
      dir,
      x: dir > 0 ? lo - path.margin : hi + path.margin,
      end: dir > 0 ? hi + path.margin : lo - path.margin,
      heading: 0,
      t: Math.random() * 10,
      scared: 0,
    };
    w.obj.position.set(w.x, path.y, path.z);
    w.heading = (dir * Math.PI) / 2;
    w.obj.rotation.y = w.heading;
    castShadows(w.obj, quality.profile.shadows);
    this.scene.add(w.obj);
    this.walkers.push(w);
    this.next = 2.5 + Math.random() * 3;
  }

  private make(kind: Passer): { obj: THREE.Group; person: Person | null } | null {
    switch (kind) {
      case 'zombie':
        return { obj: hdZombie() ?? makeObstacle('zombie'), person: null };
      case 'cat':
        return { obj: sampleCatship(), person: null };
      case 'saucer': {
        const s = sampleMothership();
        s.scale.multiplyScalar(1.6);
        return { obj: s, person: null };
      }
      case 'cow': {
        const c = makeAnimal('cow');
        // The animal's "shoo" stars stay hidden here.
        return { obj: c, person: null };
      }
      case 'queen': {
        const p = person('cat_queen', 4.2);
        if (!p) return null;
        p.play('walk', 0.9);
        const g = new THREE.Group();
        g.add(p.obj);
        return { obj: g, person: p };
      }
    }
  }

  private move(w: Walker, dt: number): void {
    const path = PATHS[w.kind];
    w.t += dt;
    w.scared = Math.max(0, w.scared - dt);
    const fast = w.scared > 0 ? 3.2 : 1;
    const o = w.obj;
    let speed = path.speed * fast;
    switch (w.kind) {
      case 'zombie': {
        // A lurching shamble: surge, stall, lean.
        speed *= 0.45 + 0.75 * Math.abs(Math.sin(w.t * 2.3));
        o.position.y = Math.abs(Math.sin(w.t * 4.6)) * 0.08;
        o.rotation.z = Math.sin(w.t * 2.3) * 0.12;
        o.rotation.x = 0.12 + Math.sin(w.t * 4.6) * 0.04;
        const arm = Math.sin(w.t * 4.6) * 0.3;
        const armL = o.getObjectByName('armL');
        const armR = o.getObjectByName('armR');
        if (armL && armR) {
          armL.rotation.x = arm;
          armR.rotation.x = -arm;
        }
        o.rotation.y = w.heading + (w.scared > 0 ? Math.sin(w.t * 20) * 0.4 : 0);
        break;
      }
      case 'cat': {
        // Bouncy hops.
        const hop = Math.abs(Math.sin(w.t * 5.5));
        o.position.y = path.y + hop * (w.scared > 0 ? 2.2 : 0.9);
        o.rotation.x = Math.cos(w.t * 5.5) * 0.15;
        o.rotation.y = w.scared > 0 ? o.rotation.y + dt * 14 : w.heading;
        break;
      }
      case 'saucer':
        o.position.y = path.y + Math.sin(w.t * 1.3) * 1.2 + (w.scared > 0 ? (1.2 - w.scared) * 8 : 0);
        o.rotation.z = Math.sin(w.t * 1.7) * 0.08;
        o.rotation.y += dt * (w.scared > 0 ? 6 : 0.6);
        break;
      case 'cow':
        o.position.y = Math.abs(Math.sin(w.t * 3)) * 0.05;
        o.rotation.z = Math.sin(w.t * 3) * 0.03;
        if (w.scared > 0) o.position.y += Math.abs(Math.sin(w.t * 9)) * 0.6;
        break;
      case 'queen':
        w.person?.update(dt * fast);
        break;
    }
    w.x += w.dir * speed * dt;
    o.position.x = w.x;
    o.position.z = path.z;
    if ((w.x - w.end) * w.dir > 0) this.remove(w);
  }

  /** The stretch of a lane (world x, at height y) that shows on screen right now. */
  private visibleSpan(z: number, y: number): [number, number] {
    this.camera.updateMatrixWorld();
    let lo = Infinity;
    let hi = -Infinity;
    for (let x = -200; x <= 200; x += 0.5) {
      const p = TMP_V.set(x, y, z).project(this.camera);
      if (p.z < 1 && Math.abs(p.x) <= 1) {
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
    }
    return Number.isFinite(lo) ? [lo, hi] : [-30, 30];
  }

  private remove(w: Walker): void {
    this.scene.remove(w.obj);
    disposeTree(w.obj);
    this.walkers = this.walkers.filter((x) => x !== w);
  }

  /** Taps at a screen point: whatever is there reacts. Returns what was tapped, or null. */
  tap(clientX: number, clientY: number, w: number, h: number): Tapped | null {
    this.ray.setFromCamera(new THREE.Vector2((clientX / w) * 2 - 1, -(clientY / h) * 2 + 1), this.camera);
    let best: { kind: Tapped; walker: Walker | null; d: number } | null = null;
    const hit = (obj: THREE.Object3D, kind: Tapped, walker: Walker | null, grow: number) => {
      TMP_BOX.setFromObject(obj).expandByScalar(grow);
      const p = this.ray.ray.intersectBox(TMP_BOX, TMP_V);
      if (!p) return;
      const d = p.distanceTo(this.ray.ray.origin);
      if (!best || d < best.d) best = { kind, walker, d };
    };
    // Generous boxes: small fingers, moving targets.
    for (const wk of this.walkers) hit(wk.obj, wk.kind, wk, wk.kind === 'saucer' ? 4 : 0.8);
    hit(this.car, 'car', null, 0.3);
    const b = best as { kind: Tapped; walker: Walker | null; d: number } | null;
    if (!b) return null;
    this.react(b.kind, b.walker);
    return b.kind;
  }

  private react(kind: Tapped, w: Walker | null): void {
    if (w) w.scared = 1.2;
    switch (kind) {
      case 'car':
        this.honk = 0.6;
        sound.horn();
        // Anything close by hurries along.
        for (const x of this.walkers) if (x.kind === 'zombie' || x.kind === 'cow' || x.kind === 'cat') x.scared = 1.2;
        break;
      case 'zombie':
        sound.groan();
        break;
      case 'cat':
      case 'queen':
        sound.meow();
        break;
      case 'saucer':
        sound.laser();
        break;
      case 'cow':
        sound.moo();
        break;
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const w of [...this.walkers]) this.remove(w);
    this.puffTex.dispose();
    this.backdrop.dispose();
    this.atmosphere.dispose();
    disposeTree(this.scene);
  }
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function puffTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(220,215,205,1)');
  grad.addColorStop(1, 'rgba(220,215,205,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** The exit sign's face: white text and border on highway green, filling the whole board. */
function signCanvas(text: string, sub: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 192;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1f6b3a';
  g.fillRect(0, 0, 512, 192);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 8;
  g.beginPath();
  g.roundRect(14, 14, 484, 164, 16);
  g.stroke();
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.font = 'bold 64px system-ui, sans-serif';
  g.fillText(text, 256, 94);
  g.font = '40px system-ui, sans-serif';
  g.fillText(sub, 256, 150);
  return c;
}
