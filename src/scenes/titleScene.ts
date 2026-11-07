import * as THREE from "three";
import { Atmosphere } from "./atmosphere";
import { Backdrop } from "./backdrop";
import {
  BLINK_OFF,
  BLINK_ON,
  castShadows,
  disposeTree,
  makeObstacle,
  makeRide,
  makeRoadTexture,
  textSprite,
  type GameScene,
} from "./common";
import { hdModelsReady, hdZombie, loadHdModels } from "./hdModels";
import { lit } from "./materials";
import { modelsWanted } from "./models";
import { makeAnimal } from "./animalModels";
import { sampleCatship, sampleMothership } from "./samples";
import { person, type Person } from "./people";
import { quality } from "./quality";
import { sound } from "../audio/sound";

/**
 * The title screen's live scene: the player's car idling on a desert road at
 * golden hour, while a zombie, an alien cat, a cow, the saucer and now and
 * then the Cat Queen wander past. Tapping one of them (or the car) gets a
 * sound and a silly line. On Low graphics only the car and the road show.
 * The scene is built when the title opens and thrown away when it closes.
 */

export type Passer = "zombie" | "cat" | "saucer" | "cow" | "queen";
export type Tapped = Passer | "car";

/** What each one says when tapped (shown in a bubble, and read out in kid mode). */
export const TAP_LINES: Record<Tapped, { icon: string; text: string }[]> = {
  zombie: [
    { icon: "🧟", text: "Braaains… I mean, gas!" },
    { icon: "🧟", text: "Uuurgh! Wait for me!" },
  ],
  cat: [
    { icon: "👽", text: "Meow! Take me to your leader!" },
    { icon: "👽", text: "Mrrrow! This planet has yarn!" },
  ],
  saucer: [{ icon: "🛸", text: "Beep boop… meow!" }],
  cow: [{ icon: "🐄", text: "Moooove over!" }],
  queen: [{ icon: "👑", text: "Bow to the Cat Queen!" }],
  car: [
    { icon: "🚗", text: "Beep beep! Let's go!" },
    { icon: "🚗", text: "Vroom vroom!" },
  ],
};

/**
 * Each kind walks straight across the view at its own depth (metres from the
 * camera along where it looks), height and speed. The car is about 16 m away.
 */
const PATHS: Record<Passer, { depth: number; y: number; speed: number }> = {
  zombie: { depth: 10, y: 0, speed: 1.1 },
  cat: { depth: 22, y: 0, speed: 2.6 },
  cow: { depth: 28, y: 0, speed: 1.0 },
  queen: { depth: 38, y: 0, speed: 1.8 },
  saucer: { depth: 110, y: 15, speed: 9 },
};
/** How far either side of the middle a walker starts and ends (the view is about 60° across). */
const reachAt = (depth: number) => depth * 0.62 + 3;

interface Walker {
  kind: Passer;
  obj: THREE.Group;
  person: Person | null;
  dir: 1 | -1;
  /** The middle of its crossing, and the way across (flat, unit length). */
  mid: THREE.Vector3;
  across: THREE.Vector3;
  /** How far along the crossing it is, from the middle. */
  x: number;
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
  private backdrop = new Backdrop(900);
  private car: THREE.Group;
  private puffs: THREE.Sprite[] = [];
  private puffMat: THREE.SpriteMaterial;
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
    this.atmosphere = new Atmosphere(
      this.scene,
      0x9fc4e8,
      160,
      900,
      q.shadows ? { size: Math.min(1024, q.shadowSize), range: 30 } : null,
    );
    this.atmosphere.set(17.6, "clear");
    this.backdrop.setBiome("desert");
    this.scene.add(this.backdrop.group);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2400, 2400),
      lit({ color: 0xc89466, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const tex = makeRoadTexture();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 600 / 14);
    tex.anisotropy = 4;
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 600),
      lit({ map: tex, roughness: 0.9 }),
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.02, -250);
    road.receiveShadow = true;
    this.scene.add(road);

    // A green sign up the road, and a few cacti and rocks on the sand.
    const sign = textSprite("MADNESS", "NEXT EXIT");
    sign.scale.set(6, 2.25, 1);
    sign.position.set(7.5, 4.2, -26);
    this.scene.add(sign);
    for (const x of [6.7, 8.3]) {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 3.2, 6),
        lit({ color: 0x8a8f96 }),
      );
      pole.position.set(x, 1.6, -26.2);
      this.scene.add(pole);
    }
    this.addScenery();

    this.car = this.makeCar();
    // The title often opens before the detailed models arrive: swap the car in when they do.
    if (this.extras && !hdModelsReady()) {
      void loadHdModels().then(() => {
        if (this.disposed) return;
        this.scene.remove(this.car);
        disposeTree(this.car);
        this.car = this.makeCar();
      });
    }

    // Exhaust puffs drifting up from the tailpipe.
    this.puffMat = new THREE.SpriteMaterial({
      map: puffTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.5,
    });
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(this.puffMat.clone());
      s.userData.age = i / 6;
      this.puffs.push(s);
      this.scene.add(s);
    }
  }

  private makeCar(): THREE.Group {
    const car = makeRide("car");
    car.position.set(CAR_X, 0, 0);
    car.rotation.y = -0.12;
    castShadows(car, quality.profile.shadows);
    this.scene.add(car);
    return car;
  }

  private addScenery(): void {
    const cactus = lit({ color: 0x4f7a3a, roughness: 0.8 });
    const rock = lit({ color: 0x9a6a4a, roughness: 1, flatShading: true });
    const spots: [number, number, "c" | "r"][] = [
      [-9, -6, "c"],
      [-14, -30, "c"],
      [11, -12, "r"],
      [-7, -45, "r"],
      [16, -40, "c"],
      [-20, -14, "r"],
      [9, 8, "r"],
      [-11, 4, "c"],
      [24, -70, "c"],
      [-26, -80, "r"],
    ];
    for (const [x, z, k] of spots) {
      const g = new THREE.Group();
      if (k === "c") {
        g.add(
          new THREE.Mesh(
            new THREE.CylinderGeometry(0.35, 0.4, 3, 8),
            cactus,
          ).translateY(1.5),
        );
        const arm = new THREE.Mesh(
          new THREE.CylinderGeometry(0.22, 0.22, 1.2, 8),
          cactus,
        );
        arm.position.set(0.55, 2, 0);
        g.add(
          arm,
          new THREE.Mesh(
            new THREE.CylinderGeometry(0.22, 0.22, 0.6, 8).rotateZ(Math.PI / 2),
            cactus,
          )
            .translateY(1.5)
            .translateX(0.3),
        );
      } else {
        g.add(
          new THREE.Mesh(
            new THREE.DodecahedronGeometry(1.1, 0),
            rock,
          ).translateY(0.4),
        );
      }
      g.position.set(x, 0, z);
      g.rotation.y = x * 1.7;
      castShadows(g, quality.profile.shadows);
      this.scene.add(g);
    }
  }

  resize(w: number, h: number): void {
    const aspect = w / Math.max(1, h);
    this.camera.aspect = aspect;
    // Keep about 60° across, so a tall phone sees the whole scene too (just more sky and road).
    const across = THREE.MathUtils.degToRad(60);
    const vfov = THREE.MathUtils.radToDeg(
      2 * Math.atan(Math.tan(across / 2) / aspect),
    );
    this.camera.fov = THREE.MathUtils.clamp(vfov, 38, 95);
    // Tall screens: come in a little closer, so the car fills more of the gap.
    const tall = THREE.MathUtils.clamp((1.2 - aspect) / 0.7, 0, 1);
    this.camera.position.set(
      -6.5 + tall * 1.6,
      2.4 + tall * 0.3,
      10.5 - tall * 2.6,
    );
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
    const gap = document
      .querySelector(".title .title-view")
      ?.getBoundingClientRect();
    const cy =
      gap && gap.height > 0
        ? THREE.MathUtils.clamp(
            (gap.top + gap.bottom) / 2 + 20,
            h * 0.25,
            h * 0.6,
          )
        : h * 0.5;
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
    }
    this.atmosphere.update(dt, this.camera, this.car.position);
    // The engine idles: a little shake, and a hop when it honks.
    this.honk = Math.max(0, this.honk - dt);
    const hop =
      this.honk > 0 ? Math.sin((1 - this.honk / 0.6) * Math.PI) * 0.25 : 0;
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
    for (const p of this.puffs) {
      let age = (p.userData.age as number) + dt * 0.7;
      if (age >= 1) age -= 1;
      p.userData.age = age;
      p.position.set(
        back.x - age * 0.8,
        back.y + age * 1.4,
        back.z - age * 1.2,
      );
      p.scale.setScalar(0.3 + age * 1.3);
      (p.material as THREE.SpriteMaterial).opacity = 0.45 * (1 - age);
    }
  }

  private flash(on: boolean): void {
    this.car.traverse((o) => {
      if (o.name !== "blinkL" && o.name !== "blinkR") return;
      ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(
        on ? BLINK_ON : BLINK_OFF,
      );
    });
  }

  private spawn(): void {
    if (!this.bag.length) {
      this.bag = shuffle<Passer>([
        "zombie",
        "cat",
        "saucer",
        "cow",
        "zombie",
        "cat",
      ]);
      // The first one is always a zombie, so there's something walking straight away.
      if (this.time < 1) this.bag.unshift("zombie");
      else if (Math.random() < 0.5) this.bag.push("queen");
    }
    const i = this.bag.findIndex(
      (k) => !this.walkers.some((w) => w.kind === k),
    );
    if (i < 0) return;
    const kind = this.bag.splice(i, 1)[0];
    const made = this.make(kind);
    if (!made) {
      this.next = 0.2;
      return;
    }
    const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    const path = PATHS[kind];
    const look = this.camera
      .getWorldDirection(new THREE.Vector3())
      .setY(0)
      .normalize();
    const mid = this.camera.position
      .clone()
      .setY(0)
      .addScaledVector(look, path.depth);
    const across = new THREE.Vector3(-look.z, 0, look.x);
    const w: Walker = {
      kind,
      obj: made.obj,
      person: made.person,
      dir,
      mid,
      across,
      x: -dir * reachAt(path.depth),
      heading: 0,
      t: Math.random() * 10,
      scared: 0,
    };
    w.obj.position.copy(mid).addScaledVector(across, w.x).setY(path.y);
    w.heading = Math.atan2(across.x * dir, across.z * dir);
    w.obj.rotation.y = w.heading;
    castShadows(w.obj, quality.profile.shadows);
    this.scene.add(w.obj);
    this.walkers.push(w);
    this.next = 2.5 + Math.random() * 3;
  }

  private make(
    kind: Passer,
  ): { obj: THREE.Group; person: Person | null } | null {
    switch (kind) {
      case "zombie":
        return { obj: hdZombie() ?? makeObstacle("zombie"), person: null };
      case "cat":
        return { obj: sampleCatship(), person: null };
      case "saucer": {
        const s = sampleMothership();
        s.scale.multiplyScalar(1.6);
        return { obj: s, person: null };
      }
      case "cow": {
        const c = makeAnimal("cow");
        // The animal's "shoo" stars stay hidden here.
        return { obj: c, person: null };
      }
      case "queen": {
        const p = person("cat_queen", 4.2);
        if (!p) return null;
        p.play("walk", 0.9);
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
      case "zombie": {
        // A lurching shamble: surge, stall, lean.
        speed *= 0.45 + 0.75 * Math.abs(Math.sin(w.t * 2.3));
        o.position.y = Math.abs(Math.sin(w.t * 4.6)) * 0.08;
        o.rotation.z = Math.sin(w.t * 2.3) * 0.12;
        o.rotation.x = 0.12 + Math.sin(w.t * 4.6) * 0.04;
        const arm = Math.sin(w.t * 4.6) * 0.3;
        const armL = o.getObjectByName("armL");
        const armR = o.getObjectByName("armR");
        if (armL && armR) {
          armL.rotation.x = arm;
          armR.rotation.x = -arm;
        }
        o.rotation.y =
          w.heading + (w.scared > 0 ? Math.sin(w.t * 20) * 0.4 : 0);
        break;
      }
      case "cat": {
        // Bouncy hops.
        const hop = Math.abs(Math.sin(w.t * 5.5));
        o.position.y = path.y + hop * (w.scared > 0 ? 2.2 : 0.9);
        o.rotation.x = Math.cos(w.t * 5.5) * 0.15;
        o.rotation.y = w.scared > 0 ? o.rotation.y + dt * 14 : w.heading;
        break;
      }
      case "saucer":
        o.position.y =
          path.y +
          Math.sin(w.t * 1.3) * 1.2 +
          (w.scared > 0 ? (1.2 - w.scared) * 8 : 0);
        o.rotation.z = Math.sin(w.t * 1.7) * 0.08;
        o.rotation.y += dt * (w.scared > 0 ? 6 : 0.6);
        break;
      case "cow":
        o.position.y = Math.abs(Math.sin(w.t * 3)) * 0.05;
        o.rotation.z = Math.sin(w.t * 3) * 0.03;
        if (w.scared > 0) o.position.y += Math.abs(Math.sin(w.t * 9)) * 0.6;
        break;
      case "queen":
        w.person?.update(dt * fast);
        break;
    }
    w.x += w.dir * speed * dt;
    o.position.x = w.mid.x + w.across.x * w.x;
    o.position.z = w.mid.z + w.across.z * w.x;
    if (Math.abs(w.x) > reachAt(path.depth) + 1) this.remove(w);
  }

  private remove(w: Walker): void {
    this.scene.remove(w.obj);
    disposeTree(w.obj);
    this.walkers = this.walkers.filter((x) => x !== w);
  }

  /** Taps at a screen point: whatever is there reacts. Returns what was tapped, or null. */
  tap(clientX: number, clientY: number, w: number, h: number): Tapped | null {
    this.ray.setFromCamera(
      new THREE.Vector2((clientX / w) * 2 - 1, -(clientY / h) * 2 + 1),
      this.camera,
    );
    let best: { kind: Tapped; walker: Walker | null; d: number } | null = null;
    const hit = (
      obj: THREE.Object3D,
      kind: Tapped,
      walker: Walker | null,
      grow: number,
    ) => {
      TMP_BOX.setFromObject(obj).expandByScalar(grow);
      const p = this.ray.ray.intersectBox(TMP_BOX, TMP_V);
      if (!p) return;
      const d = p.distanceTo(this.ray.ray.origin);
      if (!best || d < best.d) best = { kind, walker, d };
    };
    // Generous boxes: small fingers, moving targets.
    for (const wk of this.walkers)
      hit(wk.obj, wk.kind, wk, wk.kind === "saucer" ? 4 : 0.8);
    hit(this.car, "car", null, 0.3);
    const b = best as { kind: Tapped; walker: Walker | null; d: number } | null;
    if (!b) return null;
    this.react(b.kind, b.walker);
    return b.kind;
  }

  private react(kind: Tapped, w: Walker | null): void {
    if (w) w.scared = 1.2;
    switch (kind) {
      case "car":
        this.honk = 0.6;
        sound.horn();
        // Anything close by hurries along.
        for (const x of this.walkers)
          if (x.kind === "zombie" || x.kind === "cow" || x.kind === "cat")
            x.scared = 1.2;
        break;
      case "zombie":
        sound.groan();
        break;
      case "cat":
      case "queen":
        sound.meow();
        break;
      case "saucer":
        sound.laser();
        break;
      case "cow":
        sound.moo();
        break;
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const w of [...this.walkers]) this.remove(w);
    for (const p of this.puffs) (p.material as THREE.SpriteMaterial).dispose();
    this.puffMat.map?.dispose();
    this.puffMat.dispose();
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
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, "rgba(220,215,205,1)");
  grad.addColorStop(1, "rgba(220,215,205,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
