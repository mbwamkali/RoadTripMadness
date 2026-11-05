import * as THREE from 'three';
import { lit } from './materials';
import { disposeTree, makeObstacle } from './common';
import { modelMesh } from './models';
import { quality } from './quality';
import type { PlaceKind } from '../game/stops';
import type { Inventory } from '../game/state';

/**
 * A search, played: the inside of one building with a few crates to tap
 * open. Each crate pops out its loot; each tap fills the noise meter, and
 * zombies gather at the window as it rises. The player runs back to the car
 * whenever they like. Rules live in state.ts (startScavenge / openCrate);
 * this only draws them, in its own full-screen canvas, freed on close.
 */

export const LOOT_ICONS: Record<keyof Inventory, string> = {
  fuel: '⛽',
  cash: '💵',
  scrap: '🔩',
  bullets: '🔫',
  shells: '💥',
  catnip: '🌿',
};

/** Wall, floor and shelf colours for each building, so they don't all look alike. */
const ROOMS: Record<PlaceKind, { wall: number; floor: number; shelf: number; accent: number }> = {
  pumps: { wall: 0xe8d9b8, floor: 0x8a8a86, shelf: 0x9a9a9a, accent: 0xd13b2c },
  garage: { wall: 0xc9ccd1, floor: 0x6d6d70, shelf: 0x4b6e8f, accent: 0x4b6e8f },
  grocery: { wall: 0xe6dcc0, floor: 0xb9b2a0, shelf: 0x6b4a2a, accent: 0x3f8a4a },
  hardware: { wall: 0xe0cba6, floor: 0x9a8a72, shelf: 0x5a3c22, accent: 0xb8742c },
  gunshop: { wall: 0xb39a7a, floor: 0x7a6650, shelf: 0x3a2a1c, accent: 0x5a4632 },
  pharmacy: { wall: 0xe4f0ee, floor: 0xb6c2c0, shelf: 0xd6d6d6, accent: 0x3f9fb0 },
  police: { wall: 0xc8cfe0, floor: 0x7d8494, shelf: 0x4a5266, accent: 0x2c3f8f },
  junkyard: { wall: 0x9a8a72, floor: 0x6b5a45, shelf: 0x5d6168, accent: 0x7a6a55 },
  barn: { wall: 0xa33a2a, floor: 0xb8a070, shelf: 0x6b4a2a, accent: 0xe8c860 },
  motel: { wall: 0xe0c8d8, floor: 0x8a6a7a, shelf: 0x6b4a2a, accent: 0xa04d8f },
};

export interface ScavengeSceneOptions {
  place: PlaceKind;
  title: string;
  crates: number;
  kid: boolean;
  night: boolean;
  /** How full the meter already is (the building was searched before). */
  noise: number;
  /** Opens crate i; returns what it held and the meter after. */
  open: (i: number) => { loot: Partial<Inventory>; ambush: boolean; noise: number };
  /** The player left (ambush = the zombies got in first). */
  done: (ambush: boolean) => void;
  say?: (text: string) => void;
  sfx?: { coin(): void; bad(): void; click(): void };
}

const lam = (color: number, emissive = 0) => lit({ color, emissive });
function box(parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** A canvas sprite showing one emoji, for loot popping out of a crate. */
export function emojiSprite(emoji: string, size = 1.5): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.font = '100px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(emoji, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(size, size, 1);
  s.renderOrder = 10;
  return s;
}

/** The player on foot: chunky, like the outlaws, with a backpack. Shared with the town view. */
export function makeWalker(): THREE.Group {
  const g = new THREE.Group();
  const jeans = lam(0x2f4f8f);
  box(g, 0.5, 1.0, 0.45, jeans, -0.18, 0.5, 0).name = 'legL';
  box(g, 0.5, 1.0, 0.45, jeans, 0.18, 0.5, 0).name = 'legR';
  box(g, 1.0, 1.0, 0.6, lam(0xffc94a), 0, 1.5, 0);
  box(g, 0.6, 0.6, 0.6, lam(0xf1c28e), 0, 2.3, 0);
  box(g, 0.7, 0.2, 0.7, lam(0xd9482b), 0, 2.65, 0);
  box(g, 0.8, 0.8, 0.35, lam(0x6b4a2a), 0, 1.5, -0.45);
  return g;
}

/** A zombie: the CC0 model on Medium and High, the hand-built one on Low. */
export function makeZombie(): THREE.Object3D {
  return modelMesh('zombie') ?? makeObstacle('zombie');
}

/** Where crates sit: [x, y (shelf top), z]. Shelves first, then the floor. */
function crateSpots(n: number): [number, number, number][] {
  const three: [number, number, number][] = [[-3, 0.85, -5.6], [-2.4, 0, -1.2], [2.6, 0, -1.6]];
  const more: [number, number, number][] = [[-3.2, 0.85, -5.6], [3, 0.85, -5.6], [-2.6, 0, -1.5], [2.4, 0, -0.8], [0, 3.05, -5.6]];
  return n <= 3 ? three : more.slice(0, n);
}

export function openScavengeScene(root: HTMLElement, o: ScavengeSceneOptions): () => void {
  const low = quality.level === 'low';
  const wrap = document.createElement('div');
  wrap.className = 'scavenge';
  wrap.dataset.quiet = '';
  const canvas = document.createElement('canvas');
  wrap.append(canvas);
  const head = document.createElement('div');
  head.className = 'scavenge-title';
  head.innerHTML = `<b></b><small></small>`;
  head.querySelector('b')!.textContent = o.title.toUpperCase();
  head.querySelector('small')!.textContent = o.kid ? 'Tap the boxes!' : 'Tap the boxes! Too much noise brings zombies.';
  const pops = document.createElement('div');
  pops.className = 'scavenge-pops';
  const bottom = document.createElement('div');
  bottom.className = 'scavenge-bottom';
  const tray = document.createElement('div');
  tray.className = 'scavenge-tray';
  const meter = document.createElement('div');
  meter.className = 'noise';
  meter.innerHTML = `<span>🔊</span><div class="track"><span class="fill"></span></div><span>🧟</span>`;
  const fill = meter.querySelector<HTMLElement>('.fill')!;
  const run = document.createElement('button');
  run.className = 'btn primary scavenge-run';
  run.textContent = '🏃 Run to the car!';
  bottom.append(tray, meter, run);
  wrap.append(head, pops, bottom);
  root.append(wrap);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !low });
  renderer.setPixelRatio(Math.min(devicePixelRatio, low ? 1 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = !low;
  const scene = new THREE.Scene();
  const room = ROOMS[o.place];
  scene.background = new THREE.Color(0x2a1f18);
  scene.add(new THREE.HemisphereLight(0xfff6e0, 0x8a6a45, o.night ? 1.0 : 1.6));
  const lamp = new THREE.DirectionalLight(o.night ? 0xffd9a0 : 0xffffff, o.night ? 1.4 : 1.6);
  lamp.position.set(-6, 14, 10);
  lamp.castShadow = !low;
  lamp.shadow.mapSize.set(1024, 1024);
  Object.assign(lamp.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 });
  scene.add(lamp);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);

  // The room: floor, back wall with a window, side walls, shelves.
  const wallMat = lam(room.wall);
  const floor = box(scene, 30, 0.2, 30, lam(room.floor), 0, -0.1, 0);
  floor.receiveShadow = true;
  box(scene, 16, 6.5, 0.4, wallMat, 0, 3.25, -7);
  box(scene, 16, 6, 0.4, wallMat, 0, 11.7, -7);
  box(scene, 5.5, 2.2, 0.4, wallMat, -5.25, 7.6, -7);
  box(scene, 5.5, 2.2, 0.4, wallMat, 5.25, 7.6, -7);
  box(scene, 0.4, 16, 16, lam(room.wall, 0x080808), -8, 8, 0);
  box(scene, 0.4, 16, 16, lam(room.wall, 0x080808), 8, 8, 0);
  box(scene, 16.2, 0.5, 0.5, lam(room.accent), 0, 9.0, -6.7);
  const glass = box(scene, 5, 2.2, 0.15, lit({ color: o.night ? 0x1d2a44 : 0x8fc6e8, transparent: true, opacity: 0.4 }), 0, 7.6, -6.75);
  glass.renderOrder = 5;
  box(scene, 16, 2.2, 0.3, lam(o.night ? 0x14182a : 0x9fb7c9), 0, 7.6, -8.8);
  const shelfMat = lam(room.shelf);
  for (const y of [0.1, 2.3, 4.5]) box(scene, 12, 0.25, 2, shelfMat, 0, y + 0.6, -5.8);
  for (const x of [-6, 0, 6]) box(scene, 0.3, 5.6, 2, shelfMat, x, 2.8, -5.8);
  // Shop stock along the empty shelf, in the building's colour.
  for (let i = 0; i < 6; i++) box(scene, 0.7, 0.9, 0.7, lam(i % 2 ? room.accent : 0xd8c9a8), -5 + i * 2, 5.6, -5.6);

  // Zombies wait behind the window; more show as the meter fills.
  const zombies: THREE.Object3D[] = [];
  for (let i = 0; i < 3; i++) {
    const z = makeZombie();
    z.scale.setScalar(1.3);
    z.position.set(-1.6 + i * 1.6, 4.9, -8);
    z.visible = false;
    z.userData.x = z.position.x;
    scene.add(z);
    zombies.push(z);
  }

  // Crates.
  const big = o.kid ? 1.25 : 1;
  const crates: { g: THREE.Group; lid: THREE.Mesh; body: THREE.Mesh; open: number; spot: THREE.Vector3 }[] = [];
  for (const [x, y, z] of crateSpots(o.crates)) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.scale.setScalar(big);
    const body = box(g, 2, 1.4, 1.6, lam(0xd09a4c, 0x3a2200), 0, 0.7, 0);
    box(g, 2.05, 0.15, 1.65, lam(0x7a5228), 0, 0.35, 0);
    const lidPivot = new THREE.Group();
    lidPivot.position.set(0, 1.4, -0.8);
    g.add(lidPivot);
    const lid = box(lidPivot, 2.1, 0.12, 1.7, lam(0x8f5f2c), 0, 0.05, 0.85);
    // The dark inside, seen once the lid is up.
    box(g, 1.8, 0.04, 1.4, lam(0x2a1a0c), 0, 1.41, 0);
    g.traverse((m) => {
      (m as THREE.Mesh).castShadow = !low;
      (m as THREE.Mesh).receiveShadow = !low;
    });
    scene.add(g);
    crates.push({ g, lid, body, open: -1, spot: new THREE.Vector3(x, y + 1.6 * big, z) });
  }
  const hand = emojiSprite('👆', 1.6);
  scene.add(hand);
  const walker = makeWalker();
  walker.position.set(0.3, 0, 2.8);
  walker.rotation.y = Math.PI;
  scene.add(walker);

  const popped: { s: THREE.Sprite; t0: number; from: THREE.Vector3 }[] = [];
  let meterValue = o.noise;
  let ambushAt = -1;
  let closed = false;
  let tapped = false;
  const found: Partial<Inventory> = {};
  const setMeter = (v: number) => {
    meterValue = v;
    fill.style.width = `${Math.round(v * 100)}%`;
    meter.classList.toggle('warm', v > 0.33 && v <= 0.66);
    meter.classList.toggle('hot', v > 0.66);
  };
  setMeter(o.noise);

  const resize = () => {
    const w = wrap.clientWidth || innerWidth;
    const h = wrap.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Portrait phones need to stand further back to see the whole shelf.
    // Short landscape screens stand back a little more so nothing hides under the buttons.
    const short = camera.aspect > 1 && h < 520;
    const back = camera.aspect < 0.7 ? 15 : short ? 14.5 : 11;
    camera.fov = camera.aspect < 0.7 ? 70 : 55;
    camera.position.set(0, 10.5, back);
    camera.lookAt(0, 1.6, -3);
    // Centre the shelf in the space between the title and the buttons at the bottom.
    const shift = short ? Math.max(0, (bottom.offsetHeight - head.offsetHeight) / 2) : 0;
    if (shift > 0) camera.setViewOffset(w, h + 2 * shift, 0, 2 * shift, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  };
  resize();
  addEventListener('resize', resize);

  const toScreen = (v: THREE.Vector3) => {
    const p = v.clone().project(camera);
    return { x: ((p.x + 1) / 2) * canvas.clientWidth, y: ((1 - p.y) / 2) * canvas.clientHeight };
  };
  const popText = (at: THREE.Vector3, text: string) => {
    const el = document.createElement('div');
    el.className = 'scavenge-pop';
    el.textContent = text;
    const { x, y } = toScreen(at);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    pops.append(el);
    setTimeout(() => el.remove(), 1400);
  };
  const updateTray = () => {
    tray.replaceChildren(
      ...(Object.entries(found) as [keyof Inventory, number][]).map(([k, v]) => {
        const s = document.createElement('span');
        s.textContent = `${LOOT_ICONS[k]} +${v}`;
        return s;
      }),
    );
  };

  const finish = (ambush: boolean) => {
    if (closed) return;
    closed = true;
    close();
    o.done(ambush);
  };
  run.onclick = () => {
    o.sfx?.click();
    finish(false);
  };

  const ray = new THREE.Raycaster();
  const onTap = (e: PointerEvent) => {
    if (ambushAt >= 0 || closed) return;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hits = ray.intersectObjects(crates.map((c) => c.g), true);
    if (!hits.length) return;
    const i = crates.findIndex((c) => hits[0].object.parent === c.g || hits[0].object.parent?.parent === c.g);
    if (i < 0 || crates[i].open >= 0) return;
    tapped = true;
    const c = crates[i];
    c.open = performance.now();
    (c.body.material as THREE.MeshStandardMaterial).emissive.setHex(0);
    const res = o.open(i);
    setMeter(res.noise);
    if (res.ambush) {
      ambushAt = performance.now();
      o.sfx?.bad();
      wrap.classList.add('ambush');
      head.querySelector('b')!.textContent = 'THEY HEARD YOU!';
      head.querySelector('small')!.textContent = '';
      o.say?.('They heard you! Zombies!');
      run.disabled = true;
      setTimeout(() => finish(true), 1600);
      return;
    }
    const items = Object.entries(res.loot) as [keyof Inventory, number][];
    if (!items.length) {
      const s = emojiSprite('🕸️', 1.4);
      s.position.copy(c.spot);
      scene.add(s);
      popped.push({ s, t0: performance.now(), from: c.spot.clone() });
      popText(c.spot, 'Empty');
      o.sfx?.click();
    } else {
      items.forEach(([k, v], j) => {
        const s = emojiSprite(LOOT_ICONS[k], 1.7);
        const from = c.spot.clone().add(new THREE.Vector3((j - (items.length - 1) / 2) * 1.4, 0, 0.6));
        s.position.copy(from);
        scene.add(s);
        popped.push({ s, t0: performance.now() + j * 120, from });
        found[k] = (found[k] ?? 0) + v;
        setTimeout(() => popText(from.clone().add(new THREE.Vector3(0, 1.4, 0)), `+${v}`), j * 120);
      });
      o.sfx?.coin();
      updateTray();
    }
    if (crates.every((x) => x.open >= 0)) {
      head.querySelector('small')!.textContent = 'All done! Back to the car.';
      run.classList.add('pulse');
      o.say?.('All done! Back to the car.');
    }
  };
  canvas.addEventListener('pointerdown', onTap);

  let raf = 0;
  const t0 = performance.now();
  const tick = (now: number) => {
    const t = (now - t0) / 1000;
    for (const c of crates) {
      if (c.open < 0) {
        // Unopened crates pulse gently so a kid knows what to tap.
        const k = 0.5 + 0.5 * Math.sin(t * 4 + c.g.position.x);
        (c.body.material as THREE.MeshStandardMaterial).emissive.setRGB(0.25 * k, 0.15 * k, 0);
      } else {
        const a = Math.min(1, (now - c.open) / 250);
        c.lid.parent!.rotation.x = -2.5 * a;
      }
    }
    const next = crates.find((c) => c.open < 0);
    hand.visible = !!next && (!tapped || o.kid) && ambushAt < 0;
    if (next) hand.position.copy(next.spot).add(new THREE.Vector3(0.6, 0.3 + 0.25 * Math.abs(Math.sin(t * 3)), 0.9));
    for (const p of popped) {
      const a = Math.max(0, (now - p.t0) / 1000);
      p.s.position.set(p.from.x, p.from.y + Math.min(1.2, a * 3), p.from.z);
      (p.s.material as THREE.SpriteMaterial).opacity = a > 1.2 ? Math.max(0, 1 - (a - 1.2) * 2) : 1;
    }
    // Zombies at the window: one per third of the meter; all of them on an ambush.
    const showing = ambushAt >= 0 ? 3 : Math.floor(meterValue * 3.2);
    zombies.forEach((z, i) => {
      z.visible = i < showing;
      z.position.x = z.userData.x + Math.sin(t * 1.5 + i) * 0.25;
      z.rotation.z = Math.sin(t * 2 + i) * 0.06;
    });
    if (ambushAt >= 0) camera.position.x = Math.sin(now / 30) * 0.15 * Math.max(0, 1 - (now - ambushAt) / 800);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  function close(): void {
    cancelAnimationFrame(raf);
    removeEventListener('resize', resize);
    canvas.removeEventListener('pointerdown', onTap);
    disposeTree(scene);
    renderer.dispose();
    // Free the WebGL context too, or enough searches push out the main road view's.
    renderer.forceContextLoss();
    wrap.remove();
  }
  return () => {
    if (!closed) {
      closed = true;
      close();
    }
  };
}
