import type { BossKind } from '../game/combat';
import * as THREE from 'three';
import type { Path, Vec2 } from '../geo/geo';
import { CRUISE_SPEED, postedLimit } from '../geo/route';
import { advance, damage, fuelPerUnit, upcomingStop, type GameState } from '../game/state';
import { brakeRange, crashScale, speedFuelFactor } from '../game/driving';
import { structureAt, type Structure } from '../game/structures';
import { buildStructurePart } from './structures';
import { coolRage, HOSTILE_RANGE, hostileShot, rageOf, rollHostile, shootVehicle } from '../game/rage';
import { clampLane, defaultLane, laneCenter, oncoming, Traffic, type Vehicle, type VehicleKind } from '../game/traffic';
import { Obstacles, ramObstacle, shootObstacle, SHOOT_RANGE, type Obstacle, type ObstacleKind } from '../game/obstacles';
import { DIFFICULTIES } from '../game/difficulty';
import { rideOf } from '../game/rides';
import { STOP_TITLES, type Stop } from '../game/stops';
import { hashString, makeRng, pick, type Rng } from '../game/rng';
import { ANNOUNCED, roadAt, type Landmark } from '../game/landmarks';
import { interstateNumber, latLngAt, stateMap } from '../geo/states';
import { castShadows, disposeTree, makeObstacle, makeRide, makeTrafficVehicle, makeLaneTexture, makeRoadTexture, setBlinkers, textSprite, to3, type GameScene } from './common';
import { classAt, edgeAt, edgeOf, isDivided, PROFILES, roadSegments, SPEED, urbanZones, type RoadClass, type RoadSegment } from '../game/roads';
import { buildLandmark, waterTexture } from './landmarkModels';
import { sound } from '../audio/sound';
import { Atmosphere } from './atmosphere';
import { quality } from './quality';
import { MODEL_SPECS, modelGeometry, modelMaterial, modelMesh, treeModelsWanted, type ModelName } from './models';
import { detailTexture } from './textures';
import { daylight, hourOf, weatherAt } from '../game/time';
import { BIOMES, biomeAtDistance, biomeSpans, groundColorAt, type BiomeId, type BiomeSpan, type PlantKind } from '../game/biomes';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const CHUNK = 400;
const BEHIND = 250;
const AHEAD = 1500;
const GROUND_SIZE = 4000;
/** Ground texture repeats every this many units. */
const GROUND_TILE = 60;
const ROAD_HALF = 4.5;
const PROMPT_RANGE = 320;

export interface DriveCallbacks {
  onEncounter(): void;
  onArrive(): void;
  onOutOfFuel(): void;
  onPrompt(stop: Stop | null, distanceTo: number): void;
  onEnterStop(stop: Stop): void;
  onLandmark(l: Landmark): void;
  onRoadEvent(): void;
  onBoss(boss: BossKind): void;
  /** Driving into a different kind of country. */
  onBiome?(icon: string, name: string): void;
  onTick(): void;
  /** Hit another vehicle (damage already taken). */
  onCrash?(kind: VehicleKind, damage: number): void;
  /** Drove into an obstacle (cost is car health lost). */
  onRam?(kind: ObstacleKind, cost: number): void;
  /** A hostile driver fired at you (damage already taken; 0 = missed). */
  onShotAt?(kind: VehicleKind, damage: number): void;
}

/** What the gun is pointed at: something in the road, or another vehicle. */
export type ShotTarget = { type: 'obstacle'; o: Obstacle } | { type: 'vehicle'; v: Vehicle };

/** Shared plant models; trees are a trunk plus a crown so each part gets its own colour. */
function plantModels(): { geos: Record<string, THREE.BufferGeometry>; mats: Record<string, THREE.Material> } {
  const saguaro = mergeGeometries([
    new THREE.CylinderGeometry(0.55, 0.65, 6, 7).translate(0, 3, 0),
    new THREE.CylinderGeometry(0.35, 0.35, 2.2, 6).translate(-1.2, 3.6, 0),
    new THREE.CylinderGeometry(0.35, 0.35, 0.4, 6).rotateZ(Math.PI / 2).translate(-0.8, 2.6, 0),
    new THREE.CylinderGeometry(0.35, 0.35, 1.8, 6).translate(1.1, 4.2, 0),
    new THREE.CylinderGeometry(0.35, 0.35, 0.4, 6).rotateZ(Math.PI / 2).translate(0.75, 3.4, 0),
  ])!;
  const palmLeaves = mergeGeometries(
    [0, 1, 2, 3, 4, 5].map((i) =>
      new THREE.ConeGeometry(0.5, 4.2, 4)
        .rotateZ(Math.PI / 2 + 0.35)
        .translate(1.9, 9.2, 0)
        .rotateY((i / 6) * Math.PI * 2),
    ),
  )!;
  return {
    geos: {
      saguaro,
      shrub: new THREE.IcosahedronGeometry(1.1, 0).scale(1.3, 0.7, 1.3).translate(0, 0.6, 0),
      grass: new THREE.ConeGeometry(0.6, 1.4, 5).translate(0, 0.7, 0),
      oakTop: new THREE.IcosahedronGeometry(2.8, 0).translate(0, 4.5, 0),
      pineTop: new THREE.ConeGeometry(2.2, 8, 7).translate(0, 5, 0),
      trunk: new THREE.CylinderGeometry(0.3, 0.4, 2, 6).translate(0, 1, 0),
      palmTrunk: new THREE.CylinderGeometry(0.25, 0.4, 9.5, 6).translate(0, 4.75, 0),
      palmLeaves,
      crops: new THREE.BoxGeometry(1.1, 1.5, 24).translate(0, 0.75, 0),
    },
    mats: {
      saguaro: new THREE.MeshLambertMaterial({ color: 0x4f8a3c }),
      shrub: new THREE.MeshLambertMaterial({ color: 0x8a9a6a }),
      grass: new THREE.MeshLambertMaterial({ color: 0xb3a95a }),
      oakTop: new THREE.MeshLambertMaterial({ color: 0x3f7a35 }),
      pineTop: new THREE.MeshLambertMaterial({ color: 0x2f5f35 }),
      trunk: new THREE.MeshLambertMaterial({ color: 0x6b4a2b }),
      palmTrunk: new THREE.MeshLambertMaterial({ color: 0x8a6a45 }),
      palmLeaves: new THREE.MeshLambertMaterial({ color: 0x3f8a3a }),
      crops: new THREE.MeshLambertMaterial({ color: 0x6f9a3a }),
    },
  };
}

/** Which instanced parts make up each plant. */
const PLANT_PARTS: Record<PlantKind, string[]> = {
  saguaro: ['saguaro'],
  shrub: ['shrub'],
  grass: ['grass'],
  oak: ['trunk', 'oakTop'],
  pine: ['trunk', 'pineTop'],
  palm: ['palmTrunk', 'palmLeaves'],
  crops: ['crops'],
};

/** CC0 models that stand in for each plant when they're loaded (trees only on High). */
const PLANT_MODELS: Partial<Record<PlantKind, ModelName[]>> = {
  saguaro: ['cactus-1', 'cactus-2', 'cactus-3'],
  shrub: ['bush-1', 'bush-2'],
  grass: ['grass'],
  oak: ['oak-1', 'oak-2', 'oak-3'],
  pine: ['pine-1', 'pine-2'],
  palm: ['palm-1', 'palm-2'],
};
const TREES = new Set<PlantKind>(['oak', 'pine', 'palm']);
const ROCK_MODELS: ModelName[] = ['rock-1', 'rock-2', 'rock-3'];
/** Small-town buildings and the taller ones for busier blocks. */
const HOUSE_MODELS: ModelName[] = ['house-1', 'house-2', 'house-3', 'house-4', 'house-5', 'shop'];
const BLOCK_MODELS: ModelName[] = ['flat-1', 'flat-2', 'shop', 'hospital'];

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
  private highwayMat: THREE.MeshLambertMaterial;
  private medianMat: THREE.MeshLambertMaterial;
  private carriageMat: THREE.MeshLambertMaterial;
  private carriage2Mat: THREE.MeshLambertMaterial;
  private laneTex = [makeLaneTexture('highway'), makeLaneTexture('carriageway'), makeLaneTexture('carriageway2')];
  private segments: RoadSegment[];
  /** Share of cruise speed for the road type (eases between types). */
  private roadSpeed = 1;
  /** The player's lane (see game/traffic.ts for the numbering). */
  private playerLane = 0;
  private laneClass: RoadClass = 'local';
  /** Player's speed choice: 0.6 (slow) to 1.3 (fast). */
  throttle = 1;
  private readonly fuelRate: number;
  private traffic: Traffic;
  private vehicleMeshes = new Map<number, THREE.Group>();
  private crashCooldown = 0;
  private obstacles: Obstacles;
  private obstacleMeshes = new Map<number, THREE.Group>();
  /** Current sideways position of the car (eases between lanes when the road changes). */
  private lane = 2;
  private shoulderMat: THREE.MeshLambertMaterial;
  private mats: Record<string, THREE.Material>;
  private geos: Record<string, THREE.BufferGeometry>;
  private biomes: BiomeSpan[];
  private lastBiome: BiomeId | null = null;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private promptStop: Stop | null = null;
  private pendingTurn: Stop | null = null;
  private turning: { stop: Stop; t: number; from: THREE.Vector3; mid: THREE.Vector3; to: THREE.Vector3 } | null = null;
  private stopping = false;
  private clock = 0;
  private rageRng: Rng;
  private structures: Structure[];
  private lastBlink = false;
  private atmosphere: Atmosphere;
  private skyTimer = 0;
  private announced = new Set<number>();
  /** From the graphics quality setting. */
  private ahead: number;
  private density: number;
  private shadows: boolean;

  constructor(
    private state: GameState,
    private path: Path,
    private cb: DriveCallbacks,
  ) {
    this.car = makeRide(state.ride ?? 'car', state.upgrades);
    this.fuelRate = fuelPerUnit(path.length);
    this.rageRng = makeRng(state.seed ^ 0x2a6e);
    // A river landmark already draws its own crossing, so skip a bridge right on top of one.
    this.structures = (state.route.structures ?? []).filter(
      (st) => st.kind === 'tunnel' || !state.landmarks.some((l) => l.kind === 'river' && l.at > st.from - 150 && l.at < st.to + 150),
    );
    this.biomes = biomeSpans(state.route, path);
    const q = quality.profile;
    this.ahead = AHEAD * q.drawScale;
    this.density = q.density;
    this.shadows = q.shadows;
    this.camera.far = 2500 * q.drawScale;
    this.atmosphere = new Atmosphere(this.scene, groundColorAt(this.biomes, state.distance, 'sky'), 300, 1300 * q.drawScale, q.shadows ? { size: q.shadowSize, range: 70 } : null);
    this.atmosphere.attachHeadlights(this.car);
    this.atmosphere.set(hourOf(state), weatherAt(state));

    // Layered flat surfaces: polygon offsets keep road > water > shoulder > ground without z-fighting.
    this.roadMat = new THREE.MeshLambertMaterial({ map: this.roadTex, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    this.highwayMat = new THREE.MeshLambertMaterial({ map: this.laneTex[0], polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    this.carriageMat = new THREE.MeshLambertMaterial({ map: this.laneTex[1], polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    this.carriage2Mat = new THREE.MeshLambertMaterial({ map: this.laneTex[2], polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    this.medianMat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(groundColorAt(this.biomes, state.distance)).multiplyScalar(0.85),
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
    this.segments = roadSegments(state.route, path.length);
    this.laneClass = classAt(this.segments, state.distance);
    this.playerLane = defaultLane(this.laneClass);
    this.lane = this.laneAt(state.distance);
    const zones = urbanZones(state.route, path.length);
    this.traffic = new Traffic(this.segments, path.length, CRUISE_SPEED, state.seed ^ Math.floor(state.distance), {
      urbanAt: (d) => (zones.some((z) => d >= z.from && d <= z.to) ? 1 : 0),
    });
    this.obstacles = new Obstacles(this.segments, path.length, state.seed ^ Math.floor(state.distance), state.distance, DIFFICULTIES[state.difficulty].gap);
    this.roadSpeed = SPEED[classAt(this.segments, state.distance)].factor;
    this.shoulderMat = new THREE.MeshLambertMaterial({ color: groundColorAt(this.biomes, state.distance, 'shoulder'), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    // Photo grain on Medium/High (the colours still come from the climate).
    this.shoulderMat.map = detailTexture('gravel', 1, 1 / 6);
    this.medianMat.map = detailTexture('ground', 0.12, 1 / 60);
    const plants = plantModels();
    this.mats = {
      ...plants.mats,
      rock: new THREE.MeshLambertMaterial({ color: 0x9c8a78 }),
      pole: new THREE.MeshLambertMaterial({ color: 0x5a4632 }),
      // Walls with rows of windows; some light up after dark.
      building: new THREE.MeshLambertMaterial({ color: 0xffffff, map: windowTexture(false), emissive: 0xffd890, emissiveMap: windowTexture(true), emissiveIntensity: 0 }),
      roof: new THREE.MeshLambertMaterial({ color: 0x5b3b33 }),
      canopy: new THREE.MeshLambertMaterial({ color: 0xc8302c }),
      white: new THREE.MeshLambertMaterial({ color: 0xeeeeee }),
      delineator: new THREE.MeshLambertMaterial({ color: 0xe8e8e8 }),
      // Unlit, so the reflectors catch the headlights' eye at night.
      reflector: new THREE.MeshBasicMaterial({ color: 0xffb030 }),
    };
    this.geos = {
      ...plants.geos,
      rock: new THREE.DodecahedronGeometry(1.4, 0),
      pole: new THREE.CylinderGeometry(0.15, 0.18, 8, 5).translate(0, 4, 0),
      building: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      roof: new THREE.ConeGeometry(0.75, 0.5, 4).rotateY(Math.PI / 4).translate(0, 1.25, 0),
      delineator: new THREE.BoxGeometry(0.12, 1.1, 0.12).translate(0, 0.55, 0),
      reflector: new THREE.BoxGeometry(0.15, 0.2, 0.15).translate(0, 0.95, 0),
    };
    // CC0 models on Medium and High, when they've loaded (see models.ts).
    for (const name of Object.keys(MODEL_SPECS) as ModelName[]) {
      const g = modelGeometry(name);
      if (!g) continue;
      this.geos[`m:${name}`] = g;
      this.mats[`m:${name}`] = modelMaterial;
    }

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
      new THREE.MeshLambertMaterial({
        color: groundColorAt(this.biomes, state.distance),
        map: detailTexture('ground', GROUND_SIZE / GROUND_TILE, GROUND_SIZE / GROUND_TILE),
        polygonOffset: true,
        polygonOffsetFactor: 2,
        polygonOffsetUnits: 4,
      }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    castShadows(this.car, this.shadows);
    this.scene.add(this.car);
    this.placeCar(true);
  }

  /** Half-width of the pavement at a distance. */
  edge(d: number): number {
    return edgeAt(this.segments, d);
  }

  /** How much wider than a plain two-lane road it is here (scenery moves out by this much). */
  widen(d: number): number {
    return this.edge(d) - ROAD_HALF;
  }

  /** The speed limit where the car is, in mph: the posted one from OpenStreetMap when known, else the usual one for the road. */
  speedLimit(d = this.state.distance): number {
    const posted = postedLimit(this.state.route, d);
    return posted || SPEED[classAt(this.segments, d)].mph;
  }

  private laneAt(d: number): number {
    return laneCenter(classAt(this.segments, d), this.playerLane, this.edge(d));
  }

  /** Sideways position of a traffic vehicle. */
  private vehicleX(v: Vehicle): number {
    return laneCenter(classAt(this.segments, v.d), v.lane, this.edge(v.d));
  }

  /** Change lanes: -1 = left, 1 = right. On two-way roads you can pull into the oncoming lane to pass. */
  steer(dir: -1 | 1): void {
    if (this.paused || this.stopping || this.turning || this.pendingTurn) return;
    const cls = classAt(this.segments, this.state.distance);
    const next = clampLane(cls, this.playerLane + dir);
    if (next !== this.playerLane) {
      this.playerLane = next;
      sound.click();
    }
  }

  /** Speed up (1) or ease off (-1). */
  pedal(dir: -1 | 1): void {
    this.throttle = Math.max(0.6, Math.min(1.3, Math.round((this.throttle + dir * 0.15) * 100) / 100));
  }

  /** In an oncoming lane (for the HUD warning). */
  get wrongSide(): boolean {
    return oncoming(this.playerLane);
  }

  /** Keeps the player's lane valid as the road changes, and holds the default lane if they never left it. */
  private followRoadChanges(): void {
    const cls = classAt(this.segments, this.state.distance);
    if (cls === this.laneClass) return;
    const wasDefault = this.playerLane === defaultLane(this.laneClass);
    const fromRight = PROFILES[this.laneClass].lanes - 1 - this.playerLane;
    this.laneClass = cls;
    if (wasDefault) this.playerLane = defaultLane(cls);
    else if (this.playerLane >= 0) this.playerLane = Math.max(0, PROFILES[cls].lanes - 1 - fromRight);
    this.playerLane = clampLane(cls, this.playerLane);
  }

  /** The land changes colour gradually as you drive from one climate into another. */
  private applyBiomeColours(): void {
    const d = this.state.distance;
    (this.ground.material as THREE.MeshLambertMaterial).color.setHex(groundColorAt(this.biomes, d));
    this.medianMat.color.setHex(groundColorAt(this.biomes, d)).multiplyScalar(0.85);
    this.shoulderMat.color.setHex(groundColorAt(this.biomes, d, 'shoulder'));
    this.atmosphere.daySky = groundColorAt(this.biomes, d, 'sky');
  }

  /** The kind of country at a distance (for the HUD). */
  biomeName(d = this.state.distance): string {
    return BIOMES[biomeAtDistance(this.biomes, d)].name;
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
    this.car = makeRide(this.state.ride ?? 'car', this.state.upgrades);
    this.atmosphere.attachHeadlights(this.car);
    castShadows(this.car, this.shadows);
    this.car.position.copy(pos);
    this.car.quaternion.copy(rot);
    this.scene.add(this.car);
  }

  /** Changed their mind before reaching the turn. */
  cancelTurn(): void {
    if (this.turning) return;
    this.pendingTurn = null;
  }

  /** Out on the road and moving: not paused, stopped at a place or event, or turning in. */
  get onRoad(): boolean {
    return !this.paused && !this.stopping && !this.turning;
  }

  /** The stop the car is signalling for: from choosing the turn until it has turned in (never while parked). */
  get signalling(): Stop | null {
    if (this.turning) return this.turning.stop;
    if (this.paused || this.stopping) return null;
    return this.pendingTurn;
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
    this.skyTimer -= dt;
    if (this.skyTimer <= 0) {
      this.skyTimer = 0.25;
      this.applyBiomeColours();
      (this.mats.building as THREE.MeshLambertMaterial).emissiveIntensity = Math.max(0, 1 - daylight(hourOf(this.state)) * 2.5);
    }
    // The clock moves every frame so dawn and dusk come on smoothly.
    this.atmosphere.set(hourOf(this.state), weatherAt(this.state));
    this.atmosphere.update(dt, this.camera, this.car.position);
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
    if (!this.paused) {
      this.traffic.step(dt * (this.stopping ? 0.3 : 1), this.state.distance);
      this.obstacles.step(this.state.distance);
      this.trafficAvoidsObstacles();
    }
    this.streamChunks();
    this.placeCar(false, dt);
    this.placeTraffic();
    this.placeObstacles();
  }

  private drive(dt: number): void {
    const s = this.state;
    // Faster on interstates, slower through towns; eases between road types.
    const want = SPEED[classAt(this.segments, s.distance)].factor;
    this.roadSpeed += (want - this.roadSpeed) * Math.min(1, dt * 0.8);
    this.followRoadChanges();
    this.crashCooldown -= dt;
    let speed = CRUISE_SPEED * rideOf(s).speed * this.roadSpeed * this.throttle * this.warp;
    if (this.promptStop) speed = Math.min(speed, CRUISE_SPEED * 0.7);
    // Brake behind a slower vehicle in your lane (fast-forward drives through traffic).
    if (this.warp === 1 && !oncoming(this.playerLane)) {
      // Speeding leaves less time to react: the car notices slower traffic later.
      const v = this.traffic.ahead(s.distance, this.playerLane, brakeRange(this.throttle));
      if (v) speed = Math.min(speed, v.speed * (1 - Math.max(0, 8 - (v.d - s.distance)) * 0.08));
    }
    speed = Math.max(0, speed);
    let step = speed * dt;
    if (this.pendingTurn && s.distance + step >= this.pendingTurn.at) {
      step = Math.max(0, this.pendingTurn.at - s.distance);
    }
    const res = advance(s, this.path, step, this.fuelRate * speedFuelFactor(this.throttle));
    this.spinWheels(step);
    coolRage(s, step);
    if (this.warp === 1) this.roadRage(dt, speed);
    if (this.warp === 1) this.checkCrash();
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
    if (res.boss) {
      this.pendingTurn = null;
      this.stopping = true;
      this.cb.onBoss(res.boss);
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
    if (res.event && !this.pendingTurn) {
      this.stopping = true;
      this.cb.onRoadEvent();
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
    const biome = biomeAtDistance(this.biomes, s.distance);
    if (biome !== this.lastBiome) {
      if (this.lastBiome) this.cb.onBiome?.(BIOMES[biome].icon, BIOMES[biome].name);
      this.lastBiome = biome;
    }
    this.cb.onTick();
  }

  /** Hitting another vehicle hurts, knocks it off the road and slows you down. */
  private checkCrash(): void {
    if (this.crashCooldown > 0) return;
    const o = this.obstacles.hit(this.state.distance, this.lane, (x) => this.obstacleX(x), rideOf(this.state).length);
    if (o) {
      const cost = ramObstacle(this.state, o);
      this.obstacles.remove(o);
      if (o.kind === 'zombie') sound.kill('zombie');
      else sound.carHit();
      // Big things slow you right down; a zombie or a bit of junk barely does.
      if (o.kind === 'wreck' || o.kind === 'roadblock') this.roadSpeed *= 0.4;
      this.crashCooldown = 0.6;
      this.cb.onRam?.(o.kind, cost);
      return;
    }
    const v = this.traffic.hit(this.state.distance, this.lane, (x) => this.vehicleX(x), rideOf(this.state).length);
    if (!v) return;
    const headOn = oncoming(v.lane);
    const base = v.kind === 'truck' ? 18 : 10;
    // The ram plate softens it.
    const amount = Math.round(base * (headOn ? 1.6 : 1) * Math.max(0.4, 1 - this.state.upgrades.ram * 0.2) * rideOf(this.state).ram * crashScale(this.throttle));
    damage(this.state, amount);
    sound.carHit();
    this.traffic.remove(v);
    this.roadSpeed *= 0.3;
    this.crashCooldown = 1.5;
    // Swerve back to your own side.
    this.playerLane = clampLane(this.laneClass, Math.max(0, this.playerLane));
    this.cb.onCrash?.(v.kind, amount);
  }

  /**
   * Road rage: when the meter is high some drivers you meet turn hostile. They
   * pace you and shoot while they're close, with no fight scene.
   */
  private roadRage(dt: number, playerSpeed: number): void {
    const s = this.state;
    const rage = rageOf(s);
    for (const v of this.traffic.vehicles) {
      const gap = v.d - s.distance;
      if (Math.abs(gap) < 300) rollHostile(v, rage, this.rageRng);
      if (!v.hostile) continue;
      // Same-direction drivers hang alongside you; oncoming ones fire as they pass.
      if (!oncoming(v.lane) && Math.abs(gap) < 120) v.cruise = Math.max(1, playerSpeed * (gap > 6 ? 0.92 : 1.05));
      v.fireIn = (v.fireIn ?? 2) - dt;
      if (v.fireIn > 0 || Math.abs(gap) > HOSTILE_RANGE || s.status !== 'driving') continue;
      const dmg = hostileShot(s, v, this.rageRng);
      sound.enemyShot();
      const m = this.vehicleMeshes.get(v.id);
      if (m) m.userData.flash = 0.18;
      this.cb.onShotAt?.(v.kind, dmg);
    }
  }

  private obstacleX(o: Obstacle): number {
    return laneCenter(classAt(this.segments, o.d), o.lane, this.edge(o.d));
  }

  /** What a shot would hit: the nearest obstacle ahead in your lane. */
  get target(): ShotTarget | null {
    if (this.paused || this.stopping || this.turning) return null;
    const d = this.state.distance;
    const o = this.obstacles.ahead(d, this.playerLane, SHOOT_RANGE);
    const v = this.traffic.ahead(d, this.playerLane, SHOOT_RANGE);
    if (o && (!v || o.d <= v.d)) return { type: 'obstacle', o };
    if (v) return { type: 'vehicle', v };
    // Nothing in your lane: a hostile driver close by in any lane.
    let best: Vehicle | null = null;
    for (const x of this.traffic.vehicles) {
      if (x.hostile && Math.abs(x.d - d) < HOSTILE_RANGE && (!best || Math.abs(x.d - d) < Math.abs(best.d - d))) best = x;
    }
    return best ? { type: 'vehicle', v: best } : null;
  }

  /**
   * What a tap at a screen point (normalised device coordinates) picks: the
   * car or obstacle in range drawn nearest the tap, within a forgiving radius
   * so a small finger still hits a small car.
   */
  pick(ndc: { x: number; y: number }, radius = 0.16): ShotTarget | null {
    if (this.paused || this.stopping || this.turning) return null;
    const d = this.state.distance;
    const aspect = this.camera.aspect || 1;
    const p = new THREE.Vector3();
    let best: ShotTarget | null = null;
    let bestDist = radius;
    const consider = (m: THREE.Object3D | undefined, t: ShotTarget) => {
      if (!m) return;
      m.getWorldPosition(p);
      p.y += 1;
      p.project(this.camera);
      if (p.z > 1) return; // behind the camera
      const dist = Math.hypot((p.x - ndc.x) * aspect, p.y - ndc.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = t;
      }
    };
    for (const o of this.obstacles.list) if (o.d > d - 2 && o.d - d <= SHOOT_RANGE) consider(this.obstacleMeshes.get(o.id), { type: 'obstacle', o });
    for (const v of this.traffic.vehicles) {
      const gap = v.d - d;
      if ((gap > -2 && gap <= SHOOT_RANGE) || (v.hostile && Math.abs(gap) < HOSTILE_RANGE)) consider(this.vehicleMeshes.get(v.id), { type: 'vehicle', v });
    }
    return best;
  }

  /** Fires at a target (by default the obstacle ahead). Returns what happened, or null with nothing to shoot. */
  shoot(target: ShotTarget | null = this.target): { kind: ObstacleKind | VehicleKind; destroyed: boolean; scrap: number; vehicle?: boolean } | 'empty' | null {
    const t = target;
    if (!t) return null;
    if (t.type === 'vehicle') return this.shootVehicle(t.v);
    const o = t.o;
    const r = shootObstacle(this.state, o);
    if (!r) {
      sound.empty();
      return 'empty';
    }
    sound.shot(r.ammo);
    const m = this.obstacleMeshes.get(o.id);
    if (r.destroyed) {
      this.obstacles.remove(o);
      if (o.kind === 'zombie') sound.kill('zombie');
    } else if (m) {
      // A little jolt so you can see the hit land.
      m.position.y = 0.25;
    }
    return { kind: o.kind, destroyed: r.destroyed, scrap: r.scrap };
  }

  private shootVehicle(v: Vehicle): { kind: VehicleKind; destroyed: boolean; scrap: number; vehicle: true } | 'empty' {
    const r = shootVehicle(this.state, v);
    if (!r) {
      sound.empty();
      return 'empty';
    }
    sound.shot(r.ammo);
    const m = this.vehicleMeshes.get(v.id);
    if (r.destroyed) {
      sound.carHit();
      this.traffic.remove(v);
      // What's left stays in the road (in your direction's lanes).
      if (!oncoming(v.lane)) this.obstacles.list.push({ id: 100_000 + v.id, kind: 'wreck', d: v.d, lane: v.lane, hp: 3 });
    } else if (m) m.position.y = 0.25;
    return { kind: v.kind, destroyed: r.destroyed, scrap: r.scrap, vehicle: true };
  }

  /** Traffic swerves round obstacles (or pulls off the road on a one-lane road). */
  private trafficAvoidsObstacles(): void {
    for (const o of this.obstacles.list) {
      for (const v of this.traffic.vehicles) {
        if (v.lane !== o.lane || v.d > o.d || o.d - v.d > 30) continue;
        const n = PROFILES[classAt(this.segments, v.d)].lanes;
        if (n > 1) v.lane = o.lane === 0 ? 1 : o.lane - 1;
        else this.traffic.remove(v);
      }
    }
  }

  private placeObstacles(): void {
    const alive = new Set<number>();
    for (const o of this.obstacles.list) {
      if (o.d - this.state.distance > this.ahead) continue;
      alive.add(o.id);
      let m = this.obstacleMeshes.get(o.id);
      if (!m) {
        const made = makeObstacle(o.kind);
        castShadows(made, this.shadows);
        // A fixed random turn so they don't all line up.
        made.userData.turn = ((o.id * 2654435761) % 1000) / 1000 - 0.5;
        this.obstacleMeshes.set(o.id, made);
        this.scene.add(made);
        m = made;
      }
      const p = this.path.pointAt(o.d);
      const f = this.path.directionAt(o.d, 6);
      const x = this.obstacleX(o);
      const y = Math.max(0, m.position.y - 0.03);
      m.position.set(p.x + f.y * x, y, -p.y + f.x * x);
      // Zombies shamble toward you; everything else sits at an angle.
      const face = Math.atan2(f.x, -f.y);
      if (o.kind === 'zombie') {
        m.rotation.y = face + Math.PI + Math.sin(this.clock * 2 + o.id) * 0.2;
        const arm = Math.sin(this.clock * 4 + o.id) * 0.3;
        const armL = m.getObjectByName('armL');
        const armR = m.getObjectByName('armR');
        if (armL && armR) {
          armL.rotation.x = arm;
          armR.rotation.x = -arm;
        } else m.rotation.z = arm * 0.25;
      } else m.rotation.y = face + (o.kind === 'roadblock' ? m.userData.turn * 0.3 : m.userData.turn * 1.5);
    }
    for (const [id, m] of this.obstacleMeshes) {
      if (alive.has(id)) continue;
      this.scene.remove(m);
      disposeTree(m);
      this.obstacleMeshes.delete(id);
    }
  }

  /** Puts a model on every traffic vehicle near the player. */
  private placeTraffic(): void {
    const alive = new Set<number>();
    for (const v of this.traffic.vehicles) {
      alive.add(v.id);
      let m = this.vehicleMeshes.get(v.id);
      if (!m) {
        const made = makeTrafficVehicle(v.kind, v.color);
        castShadows(made, this.shadows);
        this.vehicleMeshes.set(v.id, made);
        this.scene.add(made);
        m = made;
      }
      const p = this.path.pointAt(v.d);
      const f = this.path.directionAt(v.d, 6);
      const x = this.vehicleX(v);
      m.position.set(p.x + f.y * x, 0, -p.y + f.x * x);
      const dir = oncoming(v.lane) ? -1 : 1;
      m.rotation.y = Math.atan2(f.x * dir, -f.y * dir);
      if (v.hostile) this.markHostile(m);
    }
    for (const [id, m] of this.vehicleMeshes) {
      if (alive.has(id)) continue;
      this.scene.remove(m);
      disposeTree(m);
      this.vehicleMeshes.delete(id);
    }
  }

  /** A hostile driver: a red light on the roof, and a muzzle flash when they fire. */
  private markHostile(m: THREE.Group): void {
    let mark = m.getObjectByName('hostile') as THREE.Mesh | undefined;
    if (!mark) {
      const box = new THREE.Box3().setFromObject(m);
      mark = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
      mark.name = 'hostile';
      mark.position.y = box.max.y + 0.9;
      const flash = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd040 }));
      flash.name = 'muzzle';
      flash.position.set(0, box.max.y - 0.3, 0);
      flash.visible = false;
      m.add(mark, flash);
    }
    mark.rotation.y = this.clock * 3;
    mark.scale.setScalar(1 + Math.sin(this.clock * 8) * 0.15);
    const flash = (m.userData.flash as number | undefined) ?? 0;
    m.userData.flash = Math.max(0, flash - 1 / 60);
    m.getObjectByName('muzzle')!.visible = flash > 0;
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
    this.pendingTurn = null;
    this.turning = {
      stop,
      t: 0,
      from: this.car.position.clone(),
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

  private placeCar(snap: boolean, dt = 1 / 60): void {
    const d = this.state.distance;
    const p = to3(this.path.pointAt(d));
    const f = this.path.directionAt(d, 10);
    const fwd = new THREE.Vector3(f.x, 0, -f.y);
    // Drive in the right-hand lane, easing over when the road widens or narrows.
    const want = this.laneAt(d);
    // Jumps (loading, debug teleports) snap; otherwise change lanes at a steady pace.
    const jumped = this.car.position.distanceTo(p) > 150;
    this.lane = snap || jumped ? want : this.lane + Math.sign(want - this.lane) * Math.min(Math.abs(want - this.lane), 5 * rideOf(this.state).steer * dt);
    p.addScaledVector(new THREE.Vector3(f.y, 0, f.x), this.lane);
    this.car.position.copy(p);
    this.car.lookAt(p.clone().add(fwd));
    this.ground.position.set(p.x, 0, p.z);
    // The ground follows the car; shift its texture back so the grain stays put in the world.
    const gmap = (this.ground.material as THREE.MeshLambertMaterial).map;
    if (gmap) gmap.offset.set((p.x / GROUND_TILE) % 1, (-p.z / GROUND_TILE) % 1);
    if (snap) {
      this.camPos.copy(p).addScaledVector(fwd, -14).setY(7);
      this.camLook.copy(p).addScaledVector(fwd, 20);
    }
    this.followCamera(p, fwd, snap ? 1 : dt);
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
    const last = Math.floor(Math.min(this.path.length, d + this.ahead) / CHUNK);
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

  private ribbon(from: number, to: number, half: number | ((d: number) => [number, number]), y: number, mat: THREE.Material, vScale: number, flip = false): THREE.Mesh {
    const span = typeof half === 'number' ? (): [number, number] => [-half, half] : half;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const step = 4;
    let i = 0;
    for (let d = from; d <= to + 0.001; d += step, i++) {
      const p = this.path.pointAt(d);
      const f = this.path.directionAt(d);
      const r = { x: f.y, y: -f.x };
      const [a, b] = span(d);
      pos.push(p.x + r.x * a, y, -(p.y + r.y * a), p.x + r.x * b, y, -(p.y + r.y * b));
      uv.push(flip ? 1 : 0, d / vScale, flip ? 0 : 1, d / vScale);
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
    this.buildRoad(g, from, to);

    const rng = makeRng(this.state.seed ^ hashString(`chunk${k}`));
    const inst: Record<string, THREE.Matrix4[]> = {};
    for (const k of Object.keys(this.geos)) inst[k] = [];
    const buildingColors: THREE.Color[] = [];
    const stopsHere = this.state.stops.filter((s) => s.at > from - 200 && s.at < to + 200);
    const marksHere = this.state.landmarks.filter((l) => l.at > from - 120 && l.at < to + 120 && l.kind !== 'mountains' && l.kind !== 'peak' && l.kind !== 'mesa');
    const clear = (d: number, side: number) =>
      !!structureAt(this.structures, d, 30) ||
      marksHere.some((l) => (l.kind === 'river' ? Math.abs(l.at - d) < 45 : Math.abs(l.at - d) < (WIDE_SIGHTS.has(l.kind) ? 75 : 30) && l.side === side));
    const total = this.path.length;
    // Every town sign, real or made up, starts a town: a few blocks for a small
    // town, a bigger, taller spread for a city of 50,000+.
    const towns = this.state.landmarks
      .filter((l) => l.kind === 'citysign' && !/^Leaving |^Welcome to /.test(l.name) && l.at > from - 900 && l.at < to + 300)
      .map((l) => ({ mid: l.at + (l.big ? 380 : 170), radius: l.big ? 620 : 240, big: !!l.big }));

    for (let d = from; d < to; d += 8) {
      const p = this.path.pointAt(d);
      const f = this.path.directionAt(d);
      const right = { x: f.y, y: -f.x };
      // More buildings near the start, the end and towns.
      const urban = Math.max(
        d < 1500 ? 1 - d / 1500 : 0,
        d > total - 1500 ? 1 - (total - d) / 1500 : 0,
        ...stopsHere.filter((s) => s.kind === 'town' || s.kind === 'mall').map((s) => Math.max(0, 1 - Math.abs(s.at - d) / 260)),
        ...towns.map((t) => Math.max(0, 1 - Math.abs(t.mid - d) / t.radius)),
      );
      const city = towns.some((t) => t.big && Math.abs(t.mid - d) < t.radius * 0.6);
      const wide = this.widen(d);
      if (Math.round(d) % 48 < 8 && !clear(d, 1)) placeAt(inst.pole, p, right, 7.5 + wide, 0, 1);
      // Reflector posts along the shoulders of bigger roads.
      if (Math.round(d) % 40 < 8 && classAt(this.segments, d) !== 'local' && urban < 0.3) {
        for (const side of [-1, 1]) {
          const off = side * (this.edge(d) + 1.4);
          placeAt(inst.delineator, p, right, off, 0, 1);
          placeAt(inst.reflector, p, right, off, 0, 1);
        }
      }
      for (const side of [-1, 1]) {
        if (stopsHere.some((s) => Math.abs(s.at - d) < 30 && (s.side === 'right' ? 1 : -1) === side)) continue;
        if (clear(d, side)) continue;
        const r = rng();
        if (r < urban * 0.6) {
          const off = side * (12 + wide + rng() * 20);
          const w = 6 + rng() * 10;
          const h = 4 + rng() * (city && urban > 0.5 ? 34 : urban > 0.6 ? 18 : 6);
          const tower = city && urban > 0.5 && h > 16;
          const model = !tower && this.model(pick(rng, urban > 0.6 ? BLOCK_MODELS : HOUSE_MODELS));
          if (model) {
            // Models face the road, a little crooked so the street doesn't look stamped out.
            const face = Math.atan2(-side * f.y, -side * f.x) + (rng() - 0.5) * 0.3;
            placeAt(inst[model], p, right, side * (14 + wide + rng() * 14), face, 0.85 + rng() * 0.35);
          } else {
            placeAt(inst.building, p, right, off, rng() * Math.PI, w, h, 6 + rng() * 8);
            buildingColors.push(new THREE.Color().setHSL(0.08 + rng() * 0.1, 0.25, 0.55 + rng() * 0.25));
          }
        } else {
          const b = BIOMES[biomeAtDistance(this.biomes, d)];
          const r2 = rng();
          if (r2 < b.density * this.density) {
            const kind = pickPlant(b.plants, rng());
            if (kind === 'crops') {
              // Rows of crops run alongside the road, in fields set back from it.
              if (Math.round(d) % 24 < 8) {
                const yaw = Math.atan2(f.x, -f.y);
                for (let row = 0; row < 6; row++) placeAt(inst.crops, p, right, side * (16 + wide + row * 4 + rng()), yaw, 1, 0.8 + rng() * 0.4, 1);
              }
            } else {
              const off = side * (10 + wide + rng() * 70);
              const s = 0.7 + rng() * 0.8;
              const rot = rng() * 6;
              const models = PLANT_MODELS[kind];
              const model = models && (!TREES.has(kind) || treeModelsWanted()) ? this.model(pick(rng, models)) : null;
              if (model) placeAt(inst[model], p, right, off, rot, s);
              else for (const part of PLANT_PARTS[kind]) placeAt(inst[part], p, right, off, rot, s);
            }
          } else if (r2 < b.density * this.density + b.rocks * 0.5 * this.density) {
            const rock = this.model(pick(rng, ROCK_MODELS));
            placeAt(inst[rock ?? 'rock'], p, right, side * (10 + wide + rng() * 80), rng() * 6, (0.5 + rng() * 2) * (rock ? 1.8 : 1));
          }
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
    this.addMileMarkers(g, from, to);
    for (const l of this.state.landmarks) {
      if (l.at >= from && l.at < from + CHUNK) g.add(buildLandmark(l, this.path, (d) => this.edge(d)));
    }
    for (const st of this.structures) {
      if (st.to > from && st.from < to) g.add(buildStructurePart(st, this.path, from, to, (d) => this.edge(d)));
    }
    if (k === Math.floor(this.path.length / CHUNK)) g.add(this.buildFinish());
    if (this.shadows) castShadows(g, true);
    return g;
  }

  /** The instancing key for a model, or null when it isn't loaded. */
  private model(name: ModelName): string | null {
    return this.geos[`m:${name}`] ? `m:${name}` : null;
  }

  /** Pavement for one chunk: two-lane roads, four-lane highways, or divided interstates. */
  private buildRoad(g: THREE.Group, from: number, to: number): void {
    const edge = (d: number) => this.edge(d);
    // Gravel shoulders just outside the pavement on both sides.
    g.add(this.ribbon(from, to, (d) => [-edge(d) - 3, -edge(d) + 0.5], 0.04, this.shoulderMat, 1));
    g.add(this.ribbon(from, to, (d) => [edge(d) - 0.5, edge(d) + 3], 0.04, this.shoulderMat, 1));
    for (const seg of this.segments) {
      const a = Math.max(from, seg.from);
      const b = Math.min(to, seg.to);
      if (b <= a) continue;
      const full = edgeOf(seg.cls);
      if (isDivided(seg.cls)) {
        const m = PROFILES[seg.cls].median;
        const mat = seg.cls === 'metro' ? this.carriageMat : this.carriage2Mat;
        // Lanes squeeze proportionally where the road tapers.
        const inner = (d: number) => m * (edge(d) / full);
        g.add(this.ribbon(a, b, (d) => [inner(d), edge(d)], 0.1, mat, 16));
        g.add(this.ribbon(a, b, (d) => [-edge(d), -inner(d)], 0.1, mat, 16, true));
        // Grass median edges.
        g.add(this.ribbon(a, b, (d) => [-inner(d), inner(d)], 0.04, this.medianMat, 1));
      } else if (seg.cls === 'highway') {
        g.add(this.ribbon(a, b, (d) => [-edge(d), edge(d)], 0.1, this.highwayMat, 16));
      } else {
        g.add(this.ribbon(a, b, (d) => [-edge(d), edge(d)], 0.1, this.roadMat, 16));
      }
    }
  }

  /** Green mile markers on interstates, numbered like the exits (miles into the state). */
  private addMileMarkers(g: THREE.Group, from: number, to: number): void {
    const map = stateMap();
    const route = this.state.route;
    if (!map || route.source === 'demo') return;
    // Whole real miles apart, but never closer than 150 units in the game.
    const miles = Math.max(1, Math.ceil((150 * route.scale) / 1609));
    const step = (miles * 1609) / route.scale;
    for (let d = Math.ceil(from / step) * step; d < to; d += step) {
      if (!isDivided(classAt(this.segments, d))) continue;
      const n = interstateNumber(roadAt(route, d));
      const mile = n === null ? null : map.exitNumber(latLngAt(route, this.path, d), n);
      if (mile === null) continue;
      const sign = mileMarker(mile);
      const p = this.path.pointAt(d);
      const f = this.path.directionAt(d);
      const off = this.edge(d) + 2;
      sign.position.copy(to3({ x: p.x + f.y * off, y: p.y - f.x * off }, 0));
      // Face the oncoming car.
      sign.rotation.y = Math.atan2(-f.x, f.y);
      g.add(sign);
    }
  }

  private buildStop(stop: Stop, rng: Rng): THREE.Group {
    const g = new THREE.Group();
    const p = this.path.pointAt(stop.at);
    const f = this.path.directionAt(stop.at);
    const sideSign = stop.side === 'right' ? 1 : -1;
    const side = { x: f.y * sideSign, y: -f.x * sideSign };
    // Side road.
    const edge = this.edge(stop.at);
    const wide = edge - ROAD_HALF;
    const len = 70 + wide;
    const a = { x: p.x + side.x * edge, y: p.y + side.y * edge };
    const b = { x: p.x + side.x * len, y: p.y + side.y * len };
    const road = new THREE.Mesh(new THREE.PlaneGeometry(7, len - edge), this.roadMat);
    road.rotation.x = -Math.PI / 2;
    road.rotation.z = Math.atan2(side.x, side.y);
    road.position.copy(to3({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 0.09));
    g.add(road);
    // Exit sign ahead of the turn.
    const signAt = this.path.pointAt(stop.at - 90);
    const sf = this.path.directionAt(stop.at - 90);
    const sub = [stop.exit ? `EXIT ${stop.exit}` : STOP_TITLES[stop.kind], stop.street].filter(Boolean).join(' · ');
    const sign = textSprite(`${stop.side === 'left' ? '◀' : ''} ${stop.name} ${stop.side === 'right' ? '▶' : ''}`.trim(), sub);
    const so = this.edge(stop.at - 90) + 3.5;
    sign.position.copy(to3({ x: signAt.x + sf.y * sideSign * so, y: signAt.y - sf.x * sideSign * so }, 5));
    g.add(sign);
    // Street name blade at the corner.
    if (stop.street) {
      const blade = textSprite(stop.street, '', '#1f6b3a');
      blade.scale.set(5, 1.9, 1);
      const back = -8;
      blade.position.copy(to3({ x: a.x + side.x * 3 + f.x * back, y: a.y + side.y * 3 + f.y * back }, 4));
      g.add(blade);
    }
    // A little cluster of buildings at the end of the side road.
    for (let i = 0; i < 4 + rng() * 4; i++) {
      const w = 8 + rng() * 10;
      const h = 4 + rng() * 8;
      const along = (rng() - 0.5) * 70;
      const out = len - 10 + rng() * 40;
      const model = modelMesh(pick(rng, stop.kind === 'town' || stop.kind === 'mall' ? BLOCK_MODELS : HOUSE_MODELS));
      if (model) {
        model.position.copy(to3({ x: p.x + side.x * out + f.x * along, y: p.y + side.y * out + f.y * along }, 0));
        // Face back down the side road.
        model.rotation.y = Math.atan2(-side.x, side.y) + (rng() - 0.5) * 0.4;
        model.scale.setScalar(0.9 + rng() * 0.4);
        g.add(model);
        continue;
      }
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, 8 + rng() * 6),
        new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(rng(), 0.3, 0.6) }),
      );
      (box.material as THREE.Material).userData.chunkOwned = true;
      box.position.copy(to3({ x: p.x + side.x * out + f.x * along, y: p.y + side.y * out + f.y * along }, h / 2));
      box.rotation.y = rng();
      g.add(box);
    }
    if (stop.places.includes('pumps')) {
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(16, 0.8, 10), this.mats.canopy);
      const cpos = { x: p.x + side.x * (28 + wide) + f.x * 14, y: p.y + side.y * (28 + wide) + f.y * 14 };
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
    this.atmosphere.dispose();
    for (const g of this.chunks.values()) disposeChunk(g);
    this.chunks.clear();
    disposeTree(this.car);
    this.ground.geometry.dispose();
    const gm = this.ground.material as THREE.MeshLambertMaterial;
    for (const m of [gm, this.medianMat, this.shoulderMat]) m.map?.dispose();
    gm.dispose();
    Object.values(this.geos).forEach((x) => !x.userData.shared && x.dispose());
    const bm = this.mats.building as THREE.MeshLambertMaterial;
    bm.map?.dispose();
    bm.emissiveMap?.dispose();
    Object.values(this.mats).forEach((x) => !x.userData.shared && x.dispose());
    for (const m of [this.roadMat, this.highwayMat, this.carriageMat, this.carriage2Mat, this.medianMat, this.shoulderMat]) m.dispose();
    this.roadTex.dispose();
    this.laneTex.forEach((t) => t.dispose());
  }
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();

/** Sights that spread along the road and need the buildings and trees kept clear. */
const WIDE_SIGHTS = new Set<Landmark['kind']>(['grain', 'farmstead', 'ghosttown']);

function pickPlant(weights: Partial<Record<PlantKind, number>>, r: number): PlantKind {
  const entries = Object.entries(weights) as [PlantKind, number][];
  let t = r * entries.reduce((a, [, w]) => a + w, 0);
  for (const [k, w] of entries) {
    t -= w;
    if (t <= 0) return k;
  }
  return entries[0][0];
}

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
      if (!o.geometry.userData.shared) o.geometry.dispose();
      // Building materials are made per chunk; the rest are shared and freed in dispose().
      const mat = o.material as THREE.MeshBasicMaterial;
      if (mat.userData.chunkOwned) {
        if (mat.map?.userData.chunkOwned) mat.map.dispose();
        mat.dispose();
      }
    }
  });
}

const STICK_MAT = new THREE.MeshLambertMaterial({ color: 0x8a8f96 });

/** A small green mile-marker post: "MILE" over the number. */
function mileMarker(mile: number): THREE.Group {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1f6b3a';
  g.fillRect(0, 0, 64, 128);
  g.strokeStyle = '#fff';
  g.lineWidth = 4;
  g.strokeRect(4, 4, 56, 120);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.font = 'bold 20px system-ui, sans-serif';
  g.fillText('MILE', 32, 36);
  g.font = 'bold 34px system-ui, sans-serif';
  g.fillText(String(mile), 32, 92);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.chunkOwned = true;
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
  mat.userData.chunkOwned = true;
  const post = new THREE.Group();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.2), mat);
  face.position.y = 1.6;
  const stick = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.08), STICK_MAT);
  stick.position.y = 0.6;
  post.add(face, stick);
  return post;
}

/**
 * Building walls: a grid of windows. The emissive version marks which
 * windows are lit at night (the same pattern, so lights sit in the windows).
 */
function windowTexture(lit: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = lit ? '#000' : '#fff';
  g.fillRect(0, 0, 64, 64);
  const rng = makeRng(7);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      const on = rng() < 0.55;
      if (lit && !on) continue;
      g.fillStyle = lit ? '#fff' : '#5a6370';
      g.fillRect(6 + col * 20, 6 + row * 15, 12, 8);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}
