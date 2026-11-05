import * as THREE from 'three';
import { lit } from './materials';
import { disposeTree, makeRide } from './common';
import { modelsWanted } from './models';
import { sampleCatship, sampleOutlaw, sampleWreck } from './samples';
import { angryCat, paperPlaneGeometry, pizzaGeometryParts, sampleCommandDrone, simpleCommandDrone, sampleHermit, sampleKaren, samplePizzaCar, sampleSweeper, simpleCat, simpleHermit, simpleKaren, simplePizzaCar, simpleSweeper } from './bossModels';
import { kidMode } from '../game/kidMode';
import type { Upgrades } from '../game/upgrades';

/**
 * Short animated scenes for road events: a few seconds acting out what is
 * happening (a tyre blowing, a saucer's tractor beam, a trader's stall), so
 * a player who can't read yet can follow along. Each plays once in a small
 * canvas on the event card, then gives way to the event's big icon. On Low
 * graphics the people, saucers and wrecks are simple shapes.
 */

export type SceneKind = 'dirt' | 'flat' | 'help' | 'dog' | 'loot' | 'trade' | 'beam' | 'roadblock' | 'bridge' | 'fuel' | BossScene;
/** Boss intros with their own scene (the older bosses show just their icon). */
export type BossScene = 'hermit' | 'pizza' | 'sweeper' | 'karen' | 'drones';
export const BOSS_SCENES: readonly string[] = ['hermit', 'pizza', 'sweeper', 'karen', 'drones'] satisfies BossScene[];

/** The scene for each road event (src/game/events.ts ids), plus 'bike' for running out of gas. */
export function sceneKindFor(eventId: string): SceneKind {
  switch (eventId) {
    case 'flat':
      return 'flat';
    case 'hitchhiker':
    case 'mechanic':
      return 'help';
    case 'dog':
      return 'dog';
    case 'wreck':
      return 'loot';
    case 'trader':
      return 'trade';
    case 'beam':
      return 'beam';
    case 'roadblock':
      return 'roadblock';
    case 'bridge':
      return 'bridge';
    case 'bike':
      return 'fuel';
    default:
      return 'help';
  }
}

export const SCENE_SECONDS = 4;

const lam = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => lit({ color, ...extra });
function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/** A simple person: legs, body, head and a waving right arm (named 'arm'). */
function person(shirt: number, skin = 0xd8a77a): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.45, 0.8, 0.3), lam(0x2b3a55), 0, 0.4, 0));
  g.add(mesh(new THREE.BoxGeometry(0.55, 0.75, 0.35), lam(shirt), 0, 1.2, 0));
  g.add(mesh(new THREE.SphereGeometry(0.25, 12, 10), lam(skin), 0, 1.8, 0));
  const arm = new THREE.Group();
  arm.name = 'arm';
  arm.position.set(0.33, 1.5, 0);
  arm.add(mesh(new THREE.BoxGeometry(0.16, 0.6, 0.16), lam(shirt), 0, 0.28, 0));
  g.add(arm);
  g.add(mesh(new THREE.BoxGeometry(0.16, 0.6, 0.16), lam(shirt), -0.33, 1.25, 0));
  return g;
}

function dog(): THREE.Group {
  const g = new THREE.Group();
  const fur = lam(0xb07a3a);
  g.add(mesh(new THREE.BoxGeometry(0.9, 0.4, 0.35), fur, 0, 0.55, 0));
  g.add(mesh(new THREE.BoxGeometry(0.4, 0.35, 0.32), fur, 0.55, 0.85, 0));
  g.add(mesh(new THREE.BoxGeometry(0.18, 0.12, 0.2), lam(0x2a1a10), 0.8, 0.8, 0));
  for (const [x, z] of [[-0.3, -0.12], [-0.3, 0.12], [0.3, -0.12], [0.3, 0.12]]) g.add(mesh(new THREE.BoxGeometry(0.1, 0.4, 0.1), fur, x, 0.2, z));
  const tail = mesh(new THREE.BoxGeometry(0.35, 0.08, 0.08), fur, -0.6, 0.75, 0);
  tail.name = 'tail';
  g.add(tail);
  return g;
}

function saucer(): THREE.Group {
  if (modelsWanted()) return sampleCatship();
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.6, 2.4, 0.5, 16), lam(0xa6aec6)));
  g.add(mesh(new THREE.SphereGeometry(0.9, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), lam(0x9fd8ff, { transparent: true, opacity: 0.7 }), 0, 0.25, 0));
  return g;
}

function outlaw(): THREE.Group {
  if (modelsWanted()) return sampleOutlaw();
  return person(0x5a3622);
}

function wreck(): THREE.Group {
  if (modelsWanted()) return sampleWreck();
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(1.8, 0.9, 3.8), lam(0x6b4a3a), 0, 0.6, 0));
  g.add(mesh(new THREE.BoxGeometry(1.5, 0.6, 1.8), lam(0x3a3030), 0, 1.3, -0.2));
  return g;
}

function bicycle(): THREE.Group {
  const g = new THREE.Group();
  const black = lam(0x222222);
  for (const x of [-0.55, 0.55]) {
    const w = mesh(new THREE.TorusGeometry(0.35, 0.05, 6, 16), black, x, 0.35, 0);
    w.name = 'wheel';
    g.add(w);
  }
  g.add(mesh(new THREE.BoxGeometry(1.1, 0.07, 0.07), lam(0x9c2a22), 0, 0.6, 0));
  g.add(mesh(new THREE.BoxGeometry(0.35, 0.3, 0.3), lam(0xc23b2b), 0.65, 0.8, 0)); // gas can in the basket
  const rider = person(0x3a6ea5);
  rider.scale.setScalar(0.75);
  rider.position.set(-0.05, 0.35, 0);
  g.add(rider);
  return g;
}

interface Built {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Moves everything to time t (seconds). */
  at: (t: number) => void;
}

/** Road, sky and lights shared by every scene; the car drives along +x. */
function stage(kind: SceneKind, ride: 'car' | 'motorcycle' | 'truck', up?: Upgrades): Built {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(kind === 'beam' ? 0x1b1d3a : 0x9fc6e6);
  scene.add(new THREE.HemisphereLight(0xfff6e0, 0x6a5a45, 1.8));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(4, 10, 6);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.5, 200);
  camera.position.set(0, 2.4, 9.5);
  camera.lookAt(0, 1.3, 0);
  scene.add(mesh(new THREE.PlaneGeometry(80, 30).rotateX(-Math.PI / 2), lam(kind === 'bridge' ? 0x3d6f9a : 0x6f9a45), 0, -0.02, 0));
  const road = new THREE.Group();
  const asphalt = lam(kind === 'dirt' ? 0x9a7650 : 0x3a3a40);
  const dash = lam(0xf2d36b);
  const gap = kind === 'bridge';
  for (let x = -40; x < 40; x += 4) {
    if (gap && x >= 2 && x < 10) continue; // the bridge is out
    road.add(mesh(new THREE.BoxGeometry(4.02, 0.1, 5), asphalt, x + 2, 0, 0));
    if (kind !== 'dirt') road.add(mesh(new THREE.BoxGeometry(1.6, 0.02, 0.18), dash, x + 2, 0.06, 0));
  }
  scene.add(road);
  const car = makeRide(ride, up);
  car.rotation.y = -Math.PI / 2; // models face +z; drive along +x
  scene.add(car);
  const props: ((t: number) => void)[] = [];
  /** Car position: drives in from the left and stops at stopX by stopAt seconds. */
  let stopX = -1.5;
  const stopAt = 1.4;
  const drive = (t: number) => {
    const k = Math.min(1, t / stopAt);
    car.position.x = -14 + (stopX + 14) * (1 - (1 - k) ** 2);
    for (const w of car.children) if (w.name === 'wheel') w.rotation.x -= 0.2 * (1 - k);
  };
  switch (kind) {
    case 'dirt': {
      // Bouncing along a dirt road in a cloud of dust, past cacti and rocks.
      stopX = 14;
      const dust: THREE.Mesh[] = [];
      const dustMat = lam(0xc9a978, { transparent: true, opacity: 0.6 });
      for (let i = 0; i < 8; i++) {
        const m = mesh(new THREE.SphereGeometry(0.45, 7, 5), dustMat, 0, 0.4, 0);
        dust.push(m);
        scene.add(m);
      }
      for (const [x, z, cactus] of [[-9, -4, 1], [-3, -6, 0], [4, -4.5, 1], [9, -6, 0], [12, 3.5, 1], [-12, 3, 0]] as [number, number, number][]) {
        if (cactus) {
          const c = new THREE.Group();
          c.add(mesh(new THREE.CylinderGeometry(0.3, 0.35, 2.6, 7), lam(0x4f8a3c), 0, 1.3, 0));
          c.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 1, 6), lam(0x4f8a3c), 0.5, 1.6, 0));
          c.position.set(x, 0, z);
          scene.add(c);
        } else scene.add(mesh(new THREE.DodecahedronGeometry(0.8, 0), lam(0x9c8a78), x, 0.4, z));
      }
      props.push((t) => {
        car.position.x = -14 + (t / SCENE_SECONDS) * 28;
        car.position.y = Math.abs(Math.sin(t * 9)) * 0.22;
        car.rotation.z = Math.sin(t * 7) * 0.05;
        for (const w of car.children) if (w.name === 'wheel') w.rotation.x -= 0.25;
        dust.forEach((m, i) => {
          const age = (t * 2 + i / dust.length) % 1;
          m.position.set(car.position.x - 2 - age * 3, 0.3 + age * 0.8, (i % 2 ? 0.6 : -0.6) * (1 + age));
          m.scale.setScalar(0.6 + age * 1.6);
        });
        dustMat.opacity = 0.55;
        camera.position.x = car.position.x * 0.6;
        camera.lookAt(car.position.x * 0.6, 1.3, 0);
      });
      break;
    }
    case 'flat': {
      stopX = 0;
      const puff = new THREE.Group();
      for (let i = 0; i < 6; i++) puff.add(mesh(new THREE.SphereGeometry(0.35, 8, 6), lam(0xffffff, { transparent: true }), Math.cos(i) * 0.3, 0.3, Math.sin(i * 2) * 0.3));
      puff.visible = false;
      scene.add(puff);
      props.push((t) => {
        const p = t - stopAt;
        puff.visible = p > 0 && p < 2.2;
        puff.position.set(car.position.x + 1.2, 0.2, 1);
        puff.scale.setScalar(1 + Math.max(0, p) * 1.5);
        for (const m of puff.children) ((m as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = Math.max(0, 1 - p / 2.2);
        // The car sags on the burst tyre and wobbles.
        car.rotation.z = p > 0 ? -0.12 + Math.sin(p * 18) * 0.04 * Math.max(0, 1 - p) : 0;
        car.position.y = p > 0 ? -0.12 : 0;
      });
      break;
    }
    case 'help':
    case 'dog': {
      stopX = -2.5;
      const who = kind === 'dog' ? dog() : person(0x3a8f5a);
      who.position.set(2.2, 0, 2.6);
      who.rotation.y = kind === 'dog' ? Math.PI : -0.4;
      scene.add(who);
      props.push((t) => {
        const arm = who.getObjectByName('arm');
        if (arm) arm.rotation.z = Math.PI * 0.85 + Math.sin(t * 9) * 0.35; // waving
        const tail = who.getObjectByName('tail');
        if (tail) tail.rotation.y = Math.sin(t * 20) * 0.6;
        // Hops for joy once the car stops.
        who.position.y = t > stopAt ? Math.abs(Math.sin((t - stopAt) * 6)) * 0.35 : 0;
      });
      break;
    }
    case 'loot': {
      stopX = -3.5;
      const w = wreck();
      w.position.set(2.5, 0, 0);
      w.rotation.set(0, 0.6, 0.15);
      scene.add(w);
      const crates: THREE.Mesh[] = [];
      for (let i = 0; i < 3; i++) {
        const c = mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), lam([0xc8a050, 0x8a5a2a, 0x5a8f4a][i]));
        crates.push(c);
        scene.add(c);
      }
      props.push((t) => {
        crates.forEach((c, i) => {
          const p = Math.max(0, Math.min(1, (t - stopAt - i * 0.45) / 0.8));
          // Each crate arcs out of the wreck and into the car.
          c.position.set(2.5 + (car.position.x - 2.5) * p, 1 + Math.sin(p * Math.PI) * 2.5, 0.5);
          c.rotation.set(p * 6, p * 4, 0);
          c.visible = p > 0 && p < 1;
        });
      });
      break;
    }
    case 'trade': {
      stopX = -3.2;
      const stall = new THREE.Group();
      stall.add(mesh(new THREE.BoxGeometry(2.4, 0.9, 1.1), lam(0x8a5a2a), 0, 0.45, 0));
      for (let i = 0; i < 4; i++) stall.add(mesh(new THREE.BoxGeometry(0.6, 0.12, 1.4), lam(i % 2 ? 0xf2f2f2 : 0xc23b2b), -0.9 + i * 0.6, 2.2, 0));
      for (const x of [-1.1, 1.1]) stall.add(mesh(new THREE.BoxGeometry(0.1, 2.2, 0.1), lam(0x5a3a22), x, 1.1, 0.5));
      const trader = person(0x7a4aa0);
      trader.position.set(0, 0, -0.9);
      stall.add(trader);
      stall.position.set(2.2, 0, -2.2);
      scene.add(stall);
      const coin = mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.08, 16).rotateX(Math.PI / 2), lam(0xf2c84b, { emissive: 0x6a4a00 }));
      const goods = mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), lam(0x5a8f4a));
      scene.add(coin, goods);
      props.push((t) => {
        const p = Math.max(0, Math.min(1, (t - stopAt) / 0.9));
        const q = Math.max(0, Math.min(1, (t - stopAt - 1) / 0.9));
        coin.visible = p > 0 && p < 1;
        goods.visible = q > 0 && q < 1;
        coin.position.set(car.position.x + (2.2 - car.position.x) * p, 1.2 + Math.sin(p * Math.PI) * 1.5, -1.2 * p);
        coin.rotation.y = p * 12;
        goods.position.set(2.2 + (car.position.x - 2.2) * q, 1.2 + Math.sin(q * Math.PI) * 1.5, -1.2 * (1 - q));
        const arm = trader.getObjectByName('arm');
        if (arm) arm.rotation.z = Math.PI * 0.6 + Math.sin(t * 6) * 0.25;
      });
      break;
    }
    case 'beam': {
      stopX = 0;
      const ship = saucer();
      scene.add(ship);
      const cone = mesh(new THREE.CylinderGeometry(0.6, 2.2, 5, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xc070ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
      scene.add(cone);
      props.push((t) => {
        const p = Math.max(0, Math.min(1, (t - 0.6) / 1));
        ship.position.set(car.position.x, 6.2 - p * 2.5 + Math.sin(t * 3) * 0.15, 0);
        ship.rotation.y = t * 1.5;
        const beam = t > stopAt + 0.2;
        cone.visible = beam;
        cone.position.set(ship.position.x, ship.position.y - 2.5, 0);
        (cone.material as THREE.MeshBasicMaterial).opacity = 0.25 + Math.sin(t * 14) * 0.1;
        // The car floats up in the beam.
        car.position.y = beam ? Math.min(1.2, (t - stopAt - 0.2) * 0.8) + Math.sin(t * 5) * 0.05 : 0;
      });
      break;
    }
    case 'roadblock': {
      stopX = -4;
      for (let i = 0; i < 3; i++) {
        const barrel = mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.1, 12), lam(i === 1 ? 0xc23b2b : 0x3a6ea5), 1.5, 0.55, -1.4 + i * 1.4);
        scene.add(barrel);
      }
      const bad = [outlaw(), outlaw()];
      bad.forEach((o, i) => {
        o.position.set(4 + i * 1.6, 0, -1 + i * 2);
        o.rotation.y = -Math.PI / 2;
        if (!modelsWanted()) o.scale.setScalar(1);
        scene.add(o);
      });
      const flash = mesh(new THREE.SphereGeometry(0.25, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd040 }));
      scene.add(flash);
      props.push((t) => {
        bad.forEach((o, i) => (o.position.y = t > stopAt ? Math.min(0, -1.5 + (t - stopAt - i * 0.2) * 4) : -1.5));
        flash.visible = t > stopAt + 0.6 && Math.floor(t * 8) % 3 === 0;
        flash.position.set(bad[0].position.x - 0.9, 1.6, bad[0].position.z);
      });
      break;
    }
    case 'bridge': {
      stopX = -0.8;
      const bits: THREE.Mesh[] = [];
      for (let i = 0; i < 4; i++) {
        const b = mesh(new THREE.BoxGeometry(0.7, 0.3, 0.9), lam(0x5a5a60));
        bits.push(b);
        scene.add(b);
      }
      props.push((t) => {
        bits.forEach((b, i) => {
          const p = Math.max(0, t - stopAt - i * 0.25);
          b.position.set(2.4 + i * 0.4, -p * p * 6, -1 + i * 0.7);
          b.rotation.set(p * 3, p * 2, 0);
          b.visible = b.position.y > -6;
        });
        // A sudden stop at the edge: the car rocks forward.
        car.rotation.z = t > stopAt ? Math.sin((t - stopAt) * 10) * 0.05 * Math.max(0, 1 - (t - stopAt)) : 0;
      });
      break;
    }
    case 'hermit': {
      // He leaps out of the bushes by the road and starts hurling junk.
      stopX = -3;
      const bush = new THREE.Group();
      for (let i = 0; i < 5; i++) bush.add(mesh(new THREE.IcosahedronGeometry(0.7 + (i % 2) * 0.2, 0), lam(0x3f6f35), 2 + i * 0.5, 0.5, 3.4 + (i % 2) * 0.4));
      scene.add(bush);
      const him = modelsWanted() ? sampleHermit() : simpleHermit();
      him.scale.setScalar(1.15);
      him.rotation.y = -Math.PI / 2 - 0.5;
      scene.add(him);
      const junk = [0, 1, 2].map((i) => {
        const j = mesh(new THREE.BoxGeometry(0.4, 0.35, 0.5), lam([0x8a8a90, 0x7a5a3a, 0xf2f2f2][i]));
        scene.add(j);
        return j;
      });
      props.push((t) => {
        const leap = Math.min(1, Math.max(0, (t - 1.2) / 0.6));
        him.position.set(3 - leap * 0.8, Math.sin(leap * Math.PI) * 1.6, 3.6 - leap * 1.4);
        him.visible = t > 1.0;
        const armR = him.getObjectByName('armR');
        if (armR) armR.rotation.x = -2.4 + Math.sin(t * 9) * 0.6;
        junk.forEach((j, i) => {
          const p = (t - 2.0 - i * 0.55) / 0.7;
          j.visible = p > 0 && p < 1;
          j.position.set(2 - (2 - (stopX + 0.6 * (i - 1))) * p, 2 + Math.sin(p * Math.PI) * 1.5 - p * 1.6, 2.2 - 2.2 * p);
          j.rotation.set(p * 8, p * 5, 0);
        });
      });
      break;
    }
    case 'pizza': {
      // The pizza car roars up behind you, throwing pizzas.
      stopX = 4;
      const pc = modelsWanted() ? samplePizzaCar() : simplePizzaCar();
      pc.rotation.y = Math.PI / 2;
      pc.scale.multiplyScalar(0.8);
      scene.add(pc);
      const pies = [0, 1, 2].map(() => {
        const g = new THREE.Group();
        pizzaGeometryParts(g, 0.4);
        scene.add(g);
        return g;
      });
      props.push((t) => {
        pc.position.set(-16 + Math.min(1, t / 2.2) * 13, Math.abs(Math.sin(t * 9)) * 0.05, -0.3);
        pies.forEach((g, i) => {
          const p = (t - 1.6 - i * 0.6) / 0.8;
          g.visible = p > 0 && p < 1;
          const from = pc.position.x + 1;
          g.position.set(from + (car.position.x - from) * p, 2 + Math.sin(p * Math.PI) * 1.2, -0.3 + p * 0.3);
          g.rotation.set(0.5, p * 12, 0);
        });
      });
      break;
    }
    case 'sweeper': {
      // The sweeper rumbles toward you, brushes spinning, cats hurling trash bags.
      stopX = -4;
      const sw = modelsWanted() ? sampleSweeper() : simpleSweeper();
      sw.rotation.y = -Math.PI / 2; // driving toward the car, along -x
      sw.scale.setScalar(0.75);
      scene.add(sw);
      const bags = [0, 1, 2, 3].map(() => {
        const b = mesh(new THREE.SphereGeometry(0.3, 7, 5).scale(1, 1.2, 1), lam(0x24302a));
        scene.add(b);
        return b;
      });
      props.push((t) => {
        sw.position.set(12 - Math.min(1, t / 2.4) * 8, 0, -0.2);
        sw.traverse((o) => {
          if (o.name === 'brush') o.rotation.y = t * 14;
          if (o.name === 'tail') o.rotation.y = Math.sin(t * 8 + o.id) * 0.6;
        });
        bags.forEach((b, i) => {
          const p = (t - 1.4 - i * 0.5) / 0.8;
          b.visible = p > 0 && p < 1;
          const from = sw.position.x - 1.5;
          const to = stopX + (i % 2 ? 1.2 : -1.6);
          b.position.set(from + (to - from) * p, 3 + Math.sin(p * Math.PI) * 1.4 - p * 2.8, (i % 2 ? 1 : -1) * p * 1.2);
          b.rotation.set(p * 6, p * 4, 0);
        });
      });
      break;
    }
    case 'karen': {
      // Karen rolls out on her scooter, shakes her fist, and throws cats.
      stopX = -3.5;
      const k = modelsWanted() ? sampleKaren() : simpleKaren();
      k.rotation.y = -Math.PI / 2 + 0.4; // facing the car, a little toward us
      k.scale.setScalar(1.3);
      scene.add(k);
      const fur = [0xff9a3c, 0x3a3a3a, 0xf2f2f2];
      const cats = fur.map((f) => {
        const c = modelsWanted() ? angryCat(f) : simpleCat();
        c.scale.setScalar(0.8);
        scene.add(c);
        return c;
      });
      props.push((t) => {
        k.position.set(9 - Math.min(1, t / 1.6) * 5, 0, 1.2);
        const armR = k.getObjectByName('armR');
        if (armR) armR.rotation.x = -1.5 + Math.sin(t * 8) * 1.1;
        const armL = k.getObjectByName('armL');
        if (armL) armL.rotation.x = -0.8 + Math.sin(t * 12) * 0.3;
        k.traverse((o) => {
          if (o.name === 'tail') o.rotation.y = Math.sin(t * 8 + o.id) * 0.6;
        });
        cats.forEach((c, i) => {
          const p = (t - 1.6 - i * 0.6) / 0.8;
          c.visible = p > 0 && p < 1.4;
          const q = Math.min(1, p);
          const to = stopX + (i - 1) * 1.4;
          c.position.set(k.position.x + (to - k.position.x) * q, 2.2 + Math.sin(q * Math.PI) * 1.6 - q * 2.2, 1.2 - q * 0.6 + Math.max(0, p - 1) * 6);
          c.rotation.set(0, p * 10, 0);
        });
      });
      break;
    }
    case 'drones': {
      // A cloud of paper-plane drones swoops in behind the giant command drone.
      stopX = -3;
      const boss = modelsWanted() ? sampleCommandDrone() : simpleCommandDrone();
      boss.rotation.y = -Math.PI / 2;
      boss.scale.setScalar(0.45);
      scene.add(boss);
      const geo = paperPlaneGeometry();
      const paper = lam(0xf4f1e6, { side: THREE.DoubleSide });
      const n = modelsWanted() ? 12 : 7;
      const planes = Array.from({ length: n }, (_, i) => {
        const p = new THREE.Mesh(geo, paper);
        p.rotation.y = -Math.PI / 2;
        p.scale.setScalar(0.7);
        p.userData.off = [((i * 37) % 7) * 0.9, ((i * 13) % 5) * 0.5, ((i * 29) % 3) - 1];
        scene.add(p);
        return p;
      });
      props.push((t) => {
        boss.position.set(14 - Math.min(1, t / 3) * 10, 4.6 + Math.sin(t * 2) * 0.2, -1.5);
        boss.traverse((o) => {
          if (o.name === 'brush') o.rotation.y = t * 20;
        });
        planes.forEach((p, i) => {
          const [dx, dy, dz] = p.userData.off as number[];
          const k = Math.min(1, Math.max(0, (t - 0.3 - i * 0.12) / 2.2));
          p.position.set(16 + dx - k * (14 + dx) , 2.2 + dy + Math.sin(t * 3 + i) * 0.25, dz);
          p.rotation.x = Math.sin(t * 3 + i) * 0.3;
          (p.material as THREE.MeshStandardMaterial).color.setHex(0xf4f1e6);
        });
      });
      break;
    }
    case 'fuel': {
      car.visible = false;
      const bike = bicycle();
      scene.add(bike);
      props.push((t) => {
        bike.position.set(-9 + t * 4.5, 0, 1);
        bike.position.y = Math.abs(Math.sin(t * 8)) * 0.05;
        for (const w of bike.children) if (w.name === 'wheel') w.rotation.z -= 0.25;
      });
      break;
    }
  }
  return {
    scene,
    camera,
    at: (t) => {
      drive(t);
      for (const p of props) p(t);
    },
  };
}

/**
 * Plays a scene in `host` (it fills the host's width), then calls onDone.
 * Returns a stop function that ends it early. Everything it made is freed
 * when it ends. Without WebGL it ends straight away.
 */
export function playEventScene(
  host: HTMLElement,
  kind: SceneKind,
  opts: { ride?: 'car' | 'motorcycle' | 'truck'; upgrades?: Upgrades; seconds?: number; onDone: () => void },
): () => void {
  const seconds = opts.seconds ?? SCENE_SECONDS;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: modelsWanted(), alpha: false, powerPreference: 'low-power' });
  } catch (e) {
    console.warn('Event scene skipped:', (e as Error).message);
    opts.onDone();
    return () => {};
  }
  const built = stage(kind, opts.ride ?? 'car', opts.upgrades);
  const w = Math.max(200, host.clientWidth || 320);
  const h = Math.round(w * 0.5);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, modelsWanted() ? 2 : 1));
  renderer.setSize(w, h);
  built.camera.aspect = w / h;
  built.camera.updateProjectionMatrix();
  renderer.domElement.className = 'event-scene';
  host.append(renderer.domElement);
  let raf = 0;
  let done = false;
  // Scene time moves at most 1/20 s per frame, so a slow first frame (shaders
  // compiling) or a slow phone plays the whole scene instead of skipping it.
  let t = 0;
  let last = performance.now();
  const finish = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    renderer.domElement.remove();
    disposeTree(built.scene);
    renderer.dispose();
    renderer.forceContextLoss();
    opts.onDone();
  };
  const frame = () => {
    const now = performance.now();
    t += Math.min(0.05, (now - last) / 1000);
    last = now;
    host.dataset.sceneT = t.toFixed(2);
    built.at(Math.min(t, seconds));
    renderer.render(built.scene, built.camera);
    if (t >= seconds) finish();
    else raf = requestAnimationFrame(frame);
  };
  frame();
  return finish;
}

const SCENES_KEY = 'rtm-scenes';

/** Event scenes on or off (on unless switched off in the pause menu; always on in kid mode). */
export const eventScenes = {
  get on(): boolean {
    if (kidMode.on) return true;
    try {
      return localStorage.getItem(SCENES_KEY) !== '0';
    } catch {
      return true;
    }
  },
  set(on: boolean): void {
    try {
      localStorage.setItem(SCENES_KEY, on ? '1' : '0');
    } catch {
      // Storage blocked: nothing to remember it in.
    }
  },
};
