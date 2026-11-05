import * as THREE from 'three';
import { lit } from './materials';
import { disposeTree, makeCar } from './common';
import { modelMesh, type ModelName } from './models';
import { quality } from './quality';
import { fitted, HD_HOUSES, placeBuilding } from './hdBuildings';
import { makeWalker, makeZombie } from './scavengeScene';
import type { PlaceKind, Stop } from '../game/stops';
import type { Upgrades } from '../game/upgrades';

/**
 * A stop drawn as a small 3D town seen from above, with the same CC0 shops,
 * houses and trees as the road and the player's own car parked at the end of
 * the street. A round icon bubble floats over each building: tap it and a
 * little figure walks over from the car, then that place's actions open.
 * Searched buildings go dim with a tick, and zombies gather at the far end
 * of the street the more the town is searched. Medium and High only; Low
 * keeps the flat 2D map (ui/townMap.ts), which has the same interface.
 */

export const BUBBLE_ICONS: Record<PlaceKind, string> = {
  pumps: '⛽',
  garage: '🔧',
  grocery: '🛒',
  hardware: '🔨',
  gunshop: '🔫',
  pharmacy: '💊',
  police: '🚓',
  junkyard: '♻️',
  barn: '🌾',
  motel: '🛏️',
};

/** The same colours as the 2D map's roofs, so a place keeps its colour. */
export const PLACE_COLORS: Record<PlaceKind, number> = {
  pumps: 0xd13b2c,
  garage: 0x4b6e8f,
  grocery: 0x3f8a4a,
  hardware: 0xb8742c,
  gunshop: 0x5a4632,
  pharmacy: 0x3f9fb0,
  police: 0x2c3f8f,
  junkyard: 0x7a6a55,
  barn: 0xa33a2a,
  motel: 0xa04d8f,
};

const RING: Record<PlaceKind, string> = {
  pumps: '#ffc94a',
  garage: '#5b9fe8',
  grocery: '#4fd17a',
  hardware: '#ffa04a',
  gunshop: '#c79a6a',
  pharmacy: '#4fc0d1',
  police: '#5b78e8',
  junkyard: '#b8a58a',
  barn: '#ff7a5a',
  motel: '#d07fc0',
};

const STREET_W = 7;
const ROW = 18;
const SIDE_X = 10.5;

const lam = (c: number, e = 0) => lit({ color: c, emissive: e });
function box(parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function flat(parent: THREE.Object3D, w: number, d: number, color: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lam(color));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function shadows(o: THREE.Object3D, on: boolean): void {
  if (!on) return;
  o.traverse((c) => {
    (c as THREE.Mesh).castShadow = true;
    (c as THREE.Mesh).receiveShadow = true;
  });
}

function bubbleTexture(emoji: string, ring: string, dim: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 192;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.beginPath();
  g.arc(96, 102, 80, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = dim ? '#5a4c40' : '#2a1f18';
  g.strokeStyle = dim ? '#8a7a6a' : ring;
  g.lineWidth = 12;
  g.beginPath();
  g.arc(96, 92, 78, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.font = '88px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.globalAlpha = dim ? 0.55 : 1;
  g.fillText(emoji, 96, 98);
  if (dim) {
    // A green tick: searched already.
    g.globalAlpha = 1;
    g.fillStyle = '#4fd17a';
    g.beginPath();
    g.arc(158, 38, 28, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#fff';
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(144, 38);
    g.lineTo(154, 49);
    g.lineTo(172, 28);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Building {
  place: PlaceKind;
  side: 1 | -1;
  z: number;
  bubble: THREE.Sprite;
  group: THREE.Group;
  searches: number;
}

export class TownScene {
  /** Put this in the page; it fills its parent. */
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.5, 400);
  private buildings: Building[] = [];
  private walker: THREE.Group;
  private ring: THREE.Mesh;
  private zombies: THREE.Object3D[] = [];
  private farZ: number;
  private alertness = 0;
  private walk: { pts: THREE.Vector3[]; t0: number; dur: number; place: PlaceKind } | null = null;
  private raf = 0;
  private disposed = false;
  private shown = false;
  private selected: PlaceKind | null = null;
  private ray = new THREE.Raycaster();

  constructor(
    private stop: Stop,
    night: boolean,
    private onArrive: (place: PlaceKind) => void,
    upgrades?: Upgrades,
  ) {
    const low = quality.level === 'low';
    const sh = !low && quality.level === 'high';
    this.el = document.createElement('div');
    this.el.className = 'town3d';
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', `Map of ${stop.name}`);
    this.el.append(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = sh;

    const rural = stop.kind === 'farm' || stop.kind === 'base';
    const groundC = rural ? 0x8aa05a : stop.kind === 'gas' || stop.kind === 'truckstop' ? 0xc9a46e : 0xc9b48a;
    const sky = night ? 0x141a33 : 0x9fd0ef;
    this.scene.background = new THREE.Color(sky);
    this.scene.fog = new THREE.Fog(sky, 90, 190);
    this.scene.add(new THREE.HemisphereLight(night ? 0x8090c0 : 0xfff6e0, 0x8a6a45, night ? 0.9 : 1.6));
    const sun = new THREE.DirectionalLight(night ? 0xaab8ff : 0xffffff, night ? 0.7 : 1.9);
    sun.position.set(-30, 60, 25);
    sun.castShadow = sh;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 60, bottom: -60, far: 200 });
    this.scene.add(sun);

    const rows = Math.max(1, Math.ceil(stop.places.length / 2));
    const streetEnd = -(rows * ROW + 40);
    this.farZ = streetEnd + 8;
    flat(this.scene, 400, 400, groundC, 0, 0, 0);
    // The highway along the front and the town's street.
    flat(this.scene, 300, 9, 0x3a3a3f, 0, 0.015, 17);
    for (let x = -90; x < 90; x += 6) box(this.scene, 3, 0.03, 0.25, lam(0xf2c230), x, 0.03, 17);
    flat(this.scene, STREET_W, 12 - streetEnd, 0x55555b, 0, 0.02, (12 + streetEnd) / 2);
    for (let z = 10; z > streetEnd; z -= 5) box(this.scene, 0.25, 0.03, 2.4, lam(0xe8e2cf), 0, 0.04, z);
    for (const s of [-1, 1]) flat(this.scene, 2.2, 12 - streetEnd, rural ? 0xa89870 : 0xb9ad96, s * (STREET_W / 2 + 1.1), 0.03, (12 + streetEnd) / 2);

    // Buildings, alternating sides up the street.
    stop.places.forEach((place, i) => {
      const side: 1 | -1 = i % 2 === 0 ? -1 : 1;
      const z = -4 - Math.floor(i / 2) * ROW - (side === 1 ? 2 : 0);
      const group = this.building(place, side, z);
      shadows(group, sh);
      this.scene.add(group);
      const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTexture(BUBBLE_ICONS[place], RING[place], false), depthTest: false }));
      bubble.position.set(side * SIDE_X, 10.5, z);
      bubble.scale.set(4.4, 4.4, 1);
      bubble.renderOrder = 10;
      bubble.userData.place = place;
      this.scene.add(bubble);
      this.buildings.push({ place, side, z, bubble, group, searches: 0 });
    });
    // Houses further up, so the street feels like a town.
    const houses: ModelName[] = rural ? ['house-2', 'house-5'] : ['house-1', 'house-3', 'house-2', 'house-4'];
    houses.forEach((n, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      const m = fitted(rural ? (i % 2 ? 'barn' : 'house_farm') : HD_HOUSES[i % HD_HOUSES.length], 11, 11) ?? modelMesh(n);
      if (!m) return;
      m.position.set(side * (SIDE_X + 0.5), 0, -rows * ROW - 6 - Math.floor(i / 2) * 16);
      m.rotation.y = side === -1 ? Math.PI / 2 : -Math.PI / 2;
      shadows(m, sh);
      this.scene.add(m);
    });
    // Trees (or cacti on the dusty stops) out past the buildings.
    const trees: ModelName[] = stop.kind === 'gas' || stop.kind === 'truckstop' ? ['cactus-1', 'cactus-2', 'bush-1'] : ['oak-1', 'oak-2', 'oak-3', 'bush-2'];
    for (let i = 0; i < 12; i++) {
      const side = i % 2 ? 1 : -1;
      const m = modelMesh(trees[i % trees.length]);
      if (!m) continue;
      m.position.set(side * (19 + ((i * 7) % 5)), 0, 6 - i * 6);
      m.rotation.y = i * 1.3;
      m.scale.setScalar(0.8);
      shadows(m, sh);
      this.scene.add(m);
    }

    const car = makeCar(0xd9482b, upgrades);
    car.position.set(1.8, 0, 7);
    car.rotation.y = Math.PI;
    shadows(car, sh);
    this.scene.add(car);
    this.walker = makeWalker();
    this.walker.position.set(-0.4, 0, 6.5);
    shadows(this.walker, sh);
    this.scene.add(this.walker);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 3.1, 32), new THREE.MeshBasicMaterial({ color: 0xffc94a, transparent: true, opacity: 0.85 }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.scene.add(this.ring);
    for (let i = 0; i < 4; i++) {
      const z = makeZombie();
      z.visible = false;
      z.position.set(-2.4 + i * 1.6, 0, this.farZ - (i % 2) * 3);
      z.userData.x = z.position.x;
      shadows(z, sh);
      this.scene.add(z);
      this.zombies.push(z);
    }
    if (night) {
      // Street lamps, so a night stop isn't just dark.
      for (let z = 4; z > streetEnd + 10; z -= 16) {
        for (const s of [-1, 1]) {
          box(this.scene, 0.3, 6, 0.3, lam(0x444444), s * 4.6, 3, z);
          box(this.scene, 1.2, 0.4, 0.8, lam(0xffe9a0, 0xffd060), s * 4.0, 6, z);
        }
      }
    }

    this.canvas.addEventListener('pointerdown', this.onTap);
    this.raf = requestAnimationFrame(this.tick);
  }

  private building(place: PlaceKind, side: 1 | -1, z: number): THREE.Group {
    const g = new THREE.Group();
    const color = PLACE_COLORS[place];
    const face = -side; // the side that faces the street
    const x = side * SIDE_X;
    const ry = face === 1 ? Math.PI / 2 : -Math.PI / 2;
    // The detailed building with a clean sign, when it has loaded.
    const hd = placeBuilding(place, 12, 11);
    if (hd) {
      hd.position.set(x, 0, z);
      hd.rotation.y = ry;
      g.add(hd);
      return g;
    }
    const model = (n: ModelName, mx: number, s = 1.15) => {
      const m = modelMesh(n);
      if (m) {
        m.position.set(mx, 0, z);
        m.rotation.y = ry;
        m.scale.setScalar(s);
        g.add(m);
      } else box(g, 8, 6, 8, lam(0xd8c9a8), mx, 3, z);
    };
    if (place === 'pumps') {
      const cx = side * (SIDE_X - 3);
      box(g, 7, 0.5, 9, lam(color), cx, 4.6, z);
      for (const dz of [-2.6, 2.6]) box(g, 0.4, 4.4, 0.4, lam(0xdddddd), cx, 2.2, z + dz);
      for (const dz of [-2.2, 0, 2.2]) {
        box(g, 0.9, 1.7, 0.6, lam(0xeeeeee), cx + face * 0.5, 0.85, z + dz);
        box(g, 0.92, 0.4, 0.62, lam(color), cx + face * 0.5, 1.5, z + dz);
      }
      model('shop', side * (SIDE_X + 4), 0.9);
    } else if (place === 'barn') {
      box(g, 8, 6, 10, lam(color), x, 3, z);
      const roof = box(g, 8.6, 0.4, 10.6, lam(0x5a3c22), x, 6.6, z);
      roof.scale.set(1, 1, 1);
      box(g, 0.3, 3.4, 3.2, lam(0xf0e6d0), x + face * 4.05, 1.7, z);
    } else if (place === 'junkyard') {
      for (let i = 0; i < 7; i++) {
        const w = box(g, 2.2 + (i % 3), 1 + (i % 2), 1.6 + (i % 2), lam([0x7a6a55, 0x5d6168, 0x8f5f2c, 0x4b6e8f][i % 4]), x + ((i * 5) % 5) - 2, 0.6 + Math.floor(i / 3) * 1.1, z - 3 + ((i * 3) % 7));
        w.rotation.y = i * 0.7;
      }
      box(g, 0.2, 2, 12, lam(0x8a8a86), x + face * 4.5, 1, z);
    } else {
      model(place === 'motel' ? 'house-3' : place === 'police' ? 'flat-1' : 'shop', x, place === 'police' ? 0.6 : 1.15);
      // The place's colour as an awning and a sign board, like the 2D map's roofs.
      box(g, 0.5, 0.35, 7, lam(color, 0x111111), x + face * 4.3, 3.4, z);
      box(g, 0.25, 1.4, 4.5, lam(color), x + face * 4.1, 6.4, z);
    }
    return g;
  }

  /** Lays the camera out to fit the street for the canvas's shape. */
  private resize(): void {
    const w = this.el.clientWidth || innerWidth;
    const h = this.el.clientHeight || innerHeight;
    if (this.canvas.width === Math.round(w * this.renderer.getPixelRatio()) && this.canvas.height === Math.round(h * this.renderer.getPixelRatio())) return;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    const rows = Math.max(1, Math.ceil(this.stop.places.length / 2));
    const span = rows * ROW + 14;
    if (aspect < 0.8) {
      // Phone, upright: look down the street from high above the car.
      this.camera.fov = 60;
      // The buttons cover the bottom 40% of the screen, so aim low enough to keep the car above them.
      this.camera.position.set(0, 46 + span * 0.5, 42 + span * 0.2);
      this.camera.lookAt(0, 0, 8 - span * 0.2);
    } else {
      // Tablet or sideways phone: lower and closer.
      this.camera.fov = 45;
      this.camera.position.set(0, 34 + span * 0.45, 44 + span * 0.15);
      this.camera.lookAt(0, 0, 6 - span * 0.3);
    }
    this.camera.updateProjectionMatrix();
  }

  private onTap = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const bubbles = this.ray.intersectObjects(this.buildings.map((b) => b.bubble));
    let hit = bubbles[0]?.object.userData.place as PlaceKind | undefined;
    if (!hit) {
      const walls = this.ray.intersectObjects(this.buildings.map((b) => b.group), true)[0];
      const inside = (b: Building) => {
        for (let o: THREE.Object3D | null = walls?.object ?? null; o; o = o.parent) if (o === b.group) return true;
        return false;
      };
      hit = walls && this.buildings.find(inside)?.place;
    }
    if (hit) this.walkTo(hit);
  };

  private door(b: Building): THREE.Vector3 {
    return new THREE.Vector3(b.side * (STREET_W / 2 + 1.6), 0, b.z);
  }

  /** Walks from where the figure is to a building's door, then calls onArrive. */
  walkTo(place: PlaceKind): void {
    const b = this.buildings.find((x) => x.place === place);
    if (!b) return;
    this.selected = place;
    const from = this.walker.position.clone();
    const door = this.door(b);
    const lane = new THREE.Vector3(b.side * 1.2, 0, from.z);
    const pts = [from, lane, new THREE.Vector3(lane.x, 0, door.z), door];
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
    this.walk = { pts, t0: performance.now(), dur: Math.min(1100, 250 + len * 28), place };
    this.ring.position.set(door.x + b.side * 0.6, 0.06, door.z);
    this.ring.visible = true;
  }

  /** Marks how picked-over each building is, and wakes the street's zombies. */
  setSearches(counts: Partial<Record<PlaceKind, number>>): void {
    let total = 0;
    for (const b of this.buildings) {
      const n = counts[b.place] ?? 0;
      total += n;
      if ((n > 0) !== (b.searches > 0)) {
        const mat = b.bubble.material as THREE.SpriteMaterial;
        mat.map?.dispose();
        mat.map = bubbleTexture(BUBBLE_ICONS[b.place], RING[b.place], n > 0);
        mat.needsUpdate = true;
      }
      b.searches = n;
    }
    this.alertness = total;
  }

  private tick = (now: number) => {
    if (this.disposed) return;
    if (this.el.isConnected) this.shown = true;
    else if (this.shown) {
      // Left the stop: free the GPU memory.
      this.dispose();
      return;
    }
    this.resize();
    const t = now / 1000;
    for (const b of this.buildings) {
      const sel = b.place === this.selected;
      b.bubble.position.y = 10.5 + Math.sin(t * 2 + b.z) * 0.25;
      const s = sel ? 5.4 + Math.sin(t * 5) * 0.2 : 4.4;
      b.bubble.scale.set(s, s, 1);
    }
    if (this.walk) {
      const { pts, t0, dur, place } = this.walk;
      const k = Math.min(1, (now - t0) / dur);
      let total = 0;
      const lens = pts.slice(1).map((p, i) => {
        const l = p.distanceTo(pts[i]);
        total += l;
        return l;
      });
      let d = k * total;
      let i = 0;
      while (i < lens.length - 1 && d > lens[i]) d -= lens[i++];
      const a = lens[i] ? Math.min(1, d / lens[i]) : 1;
      const pos = pts[i].clone().lerp(pts[i + 1], a);
      const dir = pts[i + 1].clone().sub(pts[i]);
      if (dir.lengthSq() > 0.01) this.walker.rotation.y = Math.atan2(dir.x, dir.z);
      this.walker.position.copy(pos);
      const swing = Math.sin(now / 60) * 0.5;
      this.walker.getObjectByName('legL')!.rotation.x = swing;
      this.walker.getObjectByName('legR')!.rotation.x = -swing;
      if (k >= 1) {
        this.walk = null;
        this.walker.getObjectByName('legL')!.rotation.x = 0;
        this.walker.getObjectByName('legR')!.rotation.x = 0;
        this.onArrive(place);
      }
    }
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.6 + 0.3 * Math.sin(t * 5);
    // One more zombie at the end of the street for each search here, creeping closer.
    const showing = Math.min(this.zombies.length, this.alertness);
    this.zombies.forEach((z, i) => {
      z.visible = i < showing;
      z.position.z = this.farZ + Math.min(14, this.alertness * 3) - (i % 2) * 3 + Math.sin(t * 0.8 + i) * 0.6;
      z.position.x = z.userData.x + Math.sin(t * 1.3 + i) * 0.3;
    });
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.tick);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.onTap);
    disposeTree(this.scene);
    this.renderer.dispose();
    // dispose() alone keeps the WebGL context alive. Phones allow only a few at
    // once and drop the oldest (the main road view) when a new one is made, which
    // turned the road white after a few town visits. Hand it back now.
    this.renderer.forceContextLoss();
  }
}
