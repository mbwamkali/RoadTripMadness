import * as THREE from 'three';
import type { Path, Vec2 } from '../geo/geo';
import { CRUISE_SPEED } from '../geo/route';
import { advance, upcomingStop, type GameState } from '../game/state';
import { STOP_TITLES, type Stop } from '../game/stops';
import { hashString, makeRng, type Rng } from '../game/rng';
import { ANNOUNCED, type Landmark } from '../game/landmarks';
import { addLights, disposeTree, makeCar, makeRoadTexture, setBlinkers, textSprite, to3, type GameScene } from './common';
import { buildLandmark, waterTexture } from './landmarkModels';
import { sound } from '../audio/sound';

const CHUNK = 400;
const BEHIND = 250;
const AHEAD = 1500;
const ROAD_HALF = 4.5;
const PROMPT_RANGE = 320;

export interface DriveCallbacks {
  onEncounter(): void;
  onArrive(): void;
  onOutOfFuel(): void;
  onPrompt(stop: Stop | null, distanceTo: number): void;
  onEnterStop(stop: Stop): void;
  onLandmark(l: Landmark): void;
  onTick(): void;
}

type Biome = { ground: number; shoulder: number; plant: 'cactus' | 'pine' | 'round'; sky: number };

function biomeFor(state: GameState): Biome {
  const lat = Math.abs(state.route.start.lat + state.route.end.lat) / 2;
  if (state.route.source === 'demo' || lat < 36) return { ground: 0xd8b07a, shoulder: 0xb88c5a, plant: 'cactus', sky: 0xf2c58f };
  if (lat > 45) return { ground: 0x6f8f55, shoulder: 0x8a7a5a, plant: 'pine', sky: 0xbcd6ea };
  return { ground: 0x9fae62, shoulder: 0x9b8661, plant: 'round', sky: 0xc9dff0 };
}

/** The on-rails road trip view: the car follows the route and the world streams in around it. */
export class DriveScene implements GameScene {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, 1, 0.5, 2500);
  /** 1 = cruise, 3 = fast-forward. */
  warp = 1;
  paused = false;

  private chunks = new Map<number, THREE.Group>();
  private car: THREE.Group;
  private ground: THREE.Mesh;
  private roadTex = makeRoadTexture();
  private roadMat: THREE.MeshLambertMaterial;
  private shoulderMat: THREE.MeshLambertMaterial;
  private mats: Record<string, THREE.Material>;
  private geos: Record<string, THREE.BufferGeometry>;
  private biome: Biome;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private promptStop: Stop | null = null;
  private pendingTurn: Stop | null = null;
  private turning: { stop: Stop; t: number; from: THREE.Vector3; mid: THREE.Vector3; to: THREE.Vector3 } | null = null;
  private stopping = false;
  private clock = 0;
  private lastBlink = false;
  private announced = new Set<number>();

  constructor(
    private state: GameState,
    private path: Path,
    private cb: DriveCallbacks,
  ) {
    this.car = makeCar(undefined, state.upgrades);
    this.biome = biomeFor(state);
    this.scene.background = new THREE.Color(this.biome.sky);
    this.scene.fog = new THREE.Fog(this.biome.sky, 300, 1300);
    addLights(this.scene);

    // Layered flat surfaces: polygon offsets keep road > water > shoulder > ground without z-fighting.
    this.roadMat = new THREE.MeshLambertMaterial({ map: this.roadTex, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    this.shoulderMat = new THREE.MeshLambertMaterial({ color: this.biome.shoulder, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    this.mats = {
      plant: new THREE.MeshLambertMaterial({ color: this.biome.plant === 'cactus' ? 0x4f8a3c : 0x2f6b35 }),
      trunk: new THREE.MeshLambertMaterial({ color: 0x6b4a2b }),
      rock: new THREE.MeshLambertMaterial({ color: 0x9c8a78 }),
      pole: new THREE.MeshLambertMaterial({ color: 0x5a4632 }),
      building: new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: false }),
      roof: new THREE.MeshLambertMaterial({ color: 0x5b3b33 }),
      canopy: new THREE.MeshLambertMaterial({ color: 0xc8302c }),
      white: new THREE.MeshLambertMaterial({ color: 0xeeeeee }),
    };
    const plantGeo =
      this.biome.plant === 'cactus'
        ? new THREE.CylinderGeometry(0.5, 0.6, 5, 7).translate(0, 2.5, 0)
        : this.biome.plant === 'pine'
          ? new THREE.ConeGeometry(2.2, 8, 7).translate(0, 5, 0)
          : new THREE.IcosahedronGeometry(2.8, 0).translate(0, 4.5, 0);
    this.geos = {
      plant: plantGeo,
      trunk: new THREE.CylinderGeometry(0.3, 0.4, 2, 6).translate(0, 1, 0),
      rock: new THREE.DodecahedronGeometry(1.4, 0),
      pole: new THREE.CylinderGeometry(0.15, 0.18, 8, 5).translate(0, 4, 0),
      building: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      roof: new THREE.ConeGeometry(0.75, 0.5, 4).rotateY(Math.PI / 4).translate(0, 1.25, 0),
    };

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshLambertMaterial({ color: this.biome.ground, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.scene.add(this.ground);
    this.scene.add(this.car);
    this.placeCar(true);
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    // Portrait phones need a wider view to see the road ahead.
    this.camera.fov = w < h ? 75 : 60;
    this.camera.updateProjectionMatrix();
  }

  /** The player chose to turn off at a stop; the car signals and takes the turn when it gets there. */
  takeTurn(stop: Stop): void {
    this.pendingTurn = stop;
  }

  /** Rebuilds the car model after an upgrade. */
  refreshCar(): void {
    const pos = this.car.position.clone();
    const rot = this.car.quaternion.clone();
    this.scene.remove(this.car);
    disposeTree(this.car);
    this.car = makeCar(undefined, this.state.upgrades);
    this.car.position.copy(pos);
    this.car.quaternion.copy(rot);
    this.scene.add(this.car);
  }

  /** Changed their mind before reaching the turn. */
  cancelTurn(): void {
    if (this.turning) return;
    this.pendingTurn = null;
  }

  get signalling(): Stop | null {
    return this.turning?.stop ?? this.pendingTurn;
  }

  skipStop(stop: Stop): void {
    if (!this.state.passed.includes(stop.id)) this.state.passed.push(stop.id);
    this.promptStop = null;
    this.cb.onPrompt(null, 0);
  }

  /** Puts the car back on the route after a stop or a fight. */
  resume(): void {
    this.turning = null;
    this.pendingTurn = null;
    this.stopping = false;
    this.paused = false;
    this.placeCar(true);
  }

  update(dt: number): void {
    this.clock += dt;
    const sig = this.signalling;
    const blinkOn = Math.floor(this.clock * 3) % 2 === 0;
    setBlinkers(this.car, sig ? (sig.side === 'left' ? 'L' : 'R') : null, !!sig && blinkOn);
    if (sig && blinkOn !== this.lastBlink) sound.tick(blinkOn);
    this.lastBlink = blinkOn;
    const moving = !this.paused && (!this.stopping || !!this.turning);
    sound.engine(moving ? (this.turning ? 0.6 : this.warp) : 0);
    const water = waterTexture();
    water.offset.y -= dt * 0.25;
    for (const g of this.chunks.values()) {
      g.traverse((o) => {
        if (o.name === 'spin') o.rotation.z += dt * 0.6;
      });
    }
    if (this.turning) {
      this.animateTurn(dt);
      return;
    }
    if (!this.paused && !this.stopping) this.drive(dt);
    this.streamChunks();
    this.placeCar(false);
  }

  private drive(dt: number): void {
    const s = this.state;
    let speed = CRUISE_SPEED * this.warp;
    if (this.promptStop) speed = Math.min(speed, CRUISE_SPEED * 0.7);
    let step = speed * dt;
    if (this.pendingTurn && s.distance + step >= this.pendingTurn.at) {
      step = Math.max(0, this.pendingTurn.at - s.distance);
    }
    const res = advance(s, this.path, step);
    this.spinWheels(step);
    if (res.arrived) {
      this.stopping = true;
      this.cb.onArrive();
      return;
    }
    if (res.outOfFuel) {
      this.stopping = true;
      this.cb.onOutOfFuel();
      return;
    }
    if (this.pendingTurn && s.distance >= this.pendingTurn.at - 0.01) {
      this.startTurn(this.pendingTurn);
      return;
    }
    if (res.encounter && !this.pendingTurn) {
      this.stopping = true;
      this.cb.onEncounter();
      return;
    }
    // Stop prompts.
    const next = upcomingStop(s, PROMPT_RANGE);
    if (this.promptStop && s.distance > this.promptStop.at + 5) {
      this.skipStop(this.promptStop);
    } else if (next && next !== this.promptStop && !this.pendingTurn) {
      this.promptStop = next;
    }
    if (this.promptStop) this.cb.onPrompt(this.promptStop, this.promptStop.at - s.distance);
    this.announceLandmarks();
    this.cb.onTick();
  }

  private announceLandmarks(): void {
    const d = this.state.distance;
    this.state.landmarks.forEach((l, i) => {
      if (this.announced.has(i) || !ANNOUNCED.has(l.kind)) return;
      if (d >= l.at - 60 && d < l.at + 20) {
        this.announced.add(i);
        this.cb.onLandmark(l);
      } else if (d >= l.at + 20) {
        this.announced.add(i);
      }
    });
  }

  private spinWheels(step: number): void {
    for (const c of this.car.children) if (c.name === 'wheel') c.rotation.x += step / 0.42;
  }

  private sideVector(stop: Stop): THREE.Vector3 {
    const f = this.path.directionAt(stop.at);
    const right = new THREE.Vector3(f.y, 0, f.x);
    return stop.side === 'right' ? right : right.negate();
  }

  private startTurn(stop: Stop): void {
    const p = to3(this.path.pointAt(stop.at));
    const f = this.path.directionAt(stop.at);
    const fwd = new THREE.Vector3(f.x, 0, -f.y);
    const side = this.sideVector(stop);
    this.turning = {
      stop,
      t: 0,
      from: p.clone().addScaledVector(fwd, -8),
      mid: p.clone().addScaledVector(fwd, 4),
      to: p.clone().addScaledVector(side, 45),
    };
    this.promptStop = null;
    this.cb.onPrompt(null, 0);
  }

  private animateTurn(dt: number): void {
    const tr = this.turning!;
    tr.t = Math.min(1, tr.t + dt / 1.8);
    const t = tr.t;
    const a = tr.from.clone().lerp(tr.mid, t);
    const b = tr.mid.clone().lerp(tr.to, t);
    const pos = a.clone().lerp(b, t);
    const ahead = b.clone().sub(a).normalize();
    this.car.position.copy(pos);
    this.car.lookAt(pos.clone().add(ahead));
    this.spinWheels(CRUISE_SPEED * 0.5 * dt);
    this.followCamera(pos, ahead, dt);
    if (t >= 1) {
      const stop = tr.stop;
      if (!this.state.passed.includes(stop.id)) this.state.passed.push(stop.id);
      this.turning = null;
      this.stopping = true;
      this.cb.onEnterStop(stop);
    }
  }

  private placeCar(snap: boolean): void {
    const d = this.state.distance;
    const p = to3(this.path.pointAt(d));
    const f = this.path.directionAt(d, 10);
    const fwd = new THREE.Vector3(f.x, 0, -f.y);
    // Drive in the right-hand lane.
    p.addScaledVector(new THREE.Vector3(f.y, 0, f.x), 2);
    this.car.position.copy(p);
    this.car.lookAt(p.clone().add(fwd));
    this.ground.position.set(p.x, 0, p.z);
    if (snap) {
      this.camPos.copy(p).addScaledVector(fwd, -14).setY(7);
      this.camLook.copy(p).addScaledVector(fwd, 20);
    }
    this.followCamera(p, fwd, snap ? 1 : 1 / 60);
  }

  private followCamera(p: THREE.Vector3, fwd: THREE.Vector3, dt: number): void {
    const wantPos = p.clone().addScaledVector(fwd, -14).setY(p.y + 7);
    // Snap instead of gliding across the map after a jump (loading a save, resuming).
    const k = this.camPos.distanceTo(wantPos) > 150 ? 1 : Math.min(1, dt * 4);
    const wantLook = p.clone().addScaledVector(fwd, 20).setY(1);
    this.camPos.lerp(wantPos, k);
    this.camLook.lerp(wantLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  // ------------------------------------------------------------ world streaming

  private streamChunks(): void {
    const d = this.state.distance;
    const first = Math.max(0, Math.floor((d - BEHIND) / CHUNK));
    const last = Math.floor(Math.min(this.path.length, d + AHEAD) / CHUNK);
    for (const [k, g] of this.chunks) {
      if (k < first || k > last) {
        this.scene.remove(g);
        disposeChunk(g);
        this.chunks.delete(k);
      }
    }
    for (let k = first; k <= last; k++) {
      if (!this.chunks.has(k)) {
        const g = this.buildChunk(k);
        this.chunks.set(k, g);
        this.scene.add(g);
      }
    }
  }

  private ribbon(from: number, to: number, half: number, y: number, mat: THREE.Material, vScale: number): THREE.Mesh {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const step = 4;
    let i = 0;
    for (let d = from; d <= to + 0.001; d += step, i++) {
      const p = this.path.pointAt(d);
      const f = this.path.directionAt(d);
      const r = { x: f.y, y: -f.x };
      pos.push(p.x - r.x * half, y, -(p.y - r.y * half), p.x + r.x * half, y, -(p.y + r.y * half));
      uv.push(0, d / vScale, 1, d / vScale);
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, mat);
  }

  private buildChunk(k: number): THREE.Group {
    const g = new THREE.Group();
    const from = k * CHUNK;
    const to = Math.min(this.path.length, from + CHUNK + 4);
    g.add(this.ribbon(from, to, ROAD_HALF + 3, 0.04, this.shoulderMat, 1));
    g.add(this.ribbon(from, to, ROAD_HALF, 0.1, this.roadMat, 16));

    const rng = makeRng(this.state.seed ^ hashString(`chunk${k}`));
    const inst: Record<string, THREE.Matrix4[]> = { plant: [], trunk: [], rock: [], pole: [], building: [], roof: [] };
    const buildingColors: THREE.Color[] = [];
    const stopsHere = this.state.stops.filter((s) => s.at > from - 200 && s.at < to + 200);
    const marksHere = this.state.landmarks.filter((l) => l.at > from - 120 && l.at < to + 120 && l.kind !== 'mountains' && l.kind !== 'peak');
    const clear = (d: number, side: number) =>
      marksHere.some((l) => (l.kind === 'river' ? Math.abs(l.at - d) < 45 : Math.abs(l.at - d) < 30 && l.side === side));
    const total = this.path.length;

    for (let d = from; d < to; d += 8) {
      const p = this.path.pointAt(d);
      const f = this.path.directionAt(d);
      const right = { x: f.y, y: -f.x };
      // More buildings near the start, the end and towns.
      const urban = Math.max(
        d < 1500 ? 1 - d / 1500 : 0,
        d > total - 1500 ? 1 - (total - d) / 1500 : 0,
        ...stopsHere.filter((s) => s.kind === 'town' || s.kind === 'mall').map((s) => Math.max(0, 1 - Math.abs(s.at - d) / 260)),
      );
      if (Math.round(d) % 48 < 8 && !clear(d, 1)) placeAt(inst.pole, p, right, 7.5, 0, 1);
      for (const side of [-1, 1]) {
        if (stopsHere.some((s) => Math.abs(s.at - d) < 30 && (s.side === 'right' ? 1 : -1) === side)) continue;
        if (clear(d, side)) continue;
        const r = rng();
        if (r < urban * 0.6) {
          const off = side * (12 + rng() * 20);
          const w = 6 + rng() * 10;
          const h = 4 + rng() * (urban > 0.6 ? 18 : 6);
          placeAt(inst.building, p, right, off, rng() * Math.PI, w, h, 6 + rng() * 8);
          buildingColors.push(new THREE.Color().setHSL(0.08 + rng() * 0.1, 0.25, 0.55 + rng() * 0.25));
        } else if (r < 0.5) {
          const off = side * (10 + rng() * 70);
          const s = 0.7 + rng() * 0.8;
          placeAt(inst.plant, p, right, off, rng() * 6, s);
          if (this.biome.plant !== 'cactus') placeAt(inst.trunk, p, right, off, 0, s);
        } else if (r < 0.62) {
          placeAt(inst.rock, p, right, side * (10 + rng() * 80), rng() * 6, 0.5 + rng() * 2);
        }
      }
    }
    for (const [key, mats] of Object.entries(inst)) {
      if (!mats.length) continue;
      const mesh = new THREE.InstancedMesh(this.geos[key], this.mats[key], mats.length);
      mats.forEach((m, i) => mesh.setMatrixAt(i, m));
      if (key === 'building') buildingColors.forEach((c, i) => mesh.setColorAt(i, c));
      g.add(mesh);
    }
    for (const stop of this.state.stops) {
      if (stop.at >= from && stop.at < from + CHUNK) g.add(this.buildStop(stop, rng));
    }
    for (const l of this.state.landmarks) {
      if (l.at >= from && l.at < from + CHUNK) g.add(buildLandmark(l, this.path));
    }
    if (k === Math.floor(this.path.length / CHUNK)) g.add(this.buildFinish());
    return g;
  }

  private buildStop(stop: Stop, rng: Rng): THREE.Group {
    const g = new THREE.Group();
    const p = this.path.pointAt(stop.at);
    const f = this.path.directionAt(stop.at);
    const sideSign = stop.side === 'right' ? 1 : -1;
    const side = { x: f.y * sideSign, y: -f.x * sideSign };
    // Side road.
    const len = 70;
    const a = { x: p.x + side.x * ROAD_HALF, y: p.y + side.y * ROAD_HALF };
    const b = { x: p.x + side.x * len, y: p.y + side.y * len };
    const road = new THREE.Mesh(new THREE.PlaneGeometry(7, len - ROAD_HALF), this.roadMat);
    road.rotation.x = -Math.PI / 2;
    road.rotation.z = Math.atan2(side.x, side.y);
    road.position.copy(to3({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 0.09));
    g.add(road);
    // Exit sign ahead of the turn.
    const signAt = this.path.pointAt(stop.at - 90);
    const sf = this.path.directionAt(stop.at - 90);
    const sign = textSprite(`${stop.side === 'left' ? '◀' : ''} ${stop.name} ${stop.side === 'right' ? '▶' : ''}`.trim(), STOP_TITLES[stop.kind]);
    sign.position.copy(to3({ x: signAt.x + sf.y * sideSign * 8, y: signAt.y - sf.x * sideSign * 8 }, 5));
    g.add(sign);
    // A little cluster of buildings at the end of the side road.
    for (let i = 0; i < 4 + rng() * 4; i++) {
      const w = 8 + rng() * 10;
      const h = 4 + rng() * 8;
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, 8 + rng() * 6),
        new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(rng(), 0.3, 0.6) }),
      );
      (box.material as THREE.Material).userData.chunkOwned = true;
      const along = (rng() - 0.5) * 70;
      const out = len - 10 + rng() * 40;
      box.position.copy(to3({ x: p.x + side.x * out + f.x * along, y: p.y + side.y * out + f.y * along }, h / 2));
      box.rotation.y = rng();
      g.add(box);
    }
    if (stop.places.includes('pumps')) {
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(16, 0.8, 10), this.mats.canopy);
      const cpos = { x: p.x + side.x * 28 + f.x * 14, y: p.y + side.y * 28 + f.y * 14 };
      canopy.position.copy(to3(cpos, 5));
      canopy.rotation.y = Math.atan2(f.x, f.y);
      g.add(canopy);
      for (const o of [-5, 5]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 5, 0.6), this.mats.white);
        post.position.copy(to3({ x: cpos.x + f.y * o, y: cpos.y - f.x * o }, 2.5));
        g.add(post);
      }
    }
    return g;
  }

  private buildFinish(): THREE.Group {
    const g = new THREE.Group();
    const d = this.path.length - 30;
    const p = this.path.pointAt(d);
    const f = this.path.directionAt(d);
    const sign = textSprite(this.state.route.endLabel.split(',')[0], 'Destination', '#2b4f8a');
    sign.position.copy(to3(p, 9));
    sign.scale.set(12, 4.5, 1);
    g.add(sign);
    for (const o of [-6, 6]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 0.5), this.mats.white);
      post.position.copy(to3({ x: p.x + f.y * o, y: p.y - f.x * o }, 4));
      g.add(post);
    }
    return g;
  }

  dispose(): void {
    for (const g of this.chunks.values()) disposeChunk(g);
    this.chunks.clear();
    disposeTree(this.car);
    this.ground.geometry.dispose();
    Object.values(this.geos).forEach((x) => x.dispose());
    Object.values(this.mats).forEach((x) => x.dispose());
    this.roadMat.dispose();
    this.shoulderMat.dispose();
    this.roadTex.dispose();
  }
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();

function placeAt(list: THREE.Matrix4[], p: Vec2, right: Vec2, offset: number, rotY: number, sx: number, sy = sx, sz = sx): void {
  const pos = new THREE.Vector3(p.x + right.x * offset, 0, -(p.y + right.y * offset));
  tmpQ.setFromEuler(tmpE.set(0, rotY, 0));
  list.push(tmpM.clone().compose(pos, tmpQ, new THREE.Vector3(sx, sy, sz)));
}

/** Frees per-chunk geometry. Shared geometries/materials live on the scene and are freed in dispose(). */
function disposeChunk(g: THREE.Group): void {
  g.traverse((o) => {
    if (o instanceof THREE.InstancedMesh) {
      o.dispose();
      return;
    }
    if (o instanceof THREE.Sprite) {
      o.material.map?.dispose();
      o.material.dispose();
      return;
    }
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      // Building materials are made per chunk; the rest are shared and freed in dispose().
      const mat = o.material as THREE.MeshBasicMaterial;
      if (mat.userData.chunkOwned) {
        if (mat.map?.userData.chunkOwned) mat.map.dispose();
        mat.dispose();
      }
    }
  });
}
