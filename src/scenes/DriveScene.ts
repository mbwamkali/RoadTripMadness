import type { BossKind } from '../game/combat';
import * as THREE from 'three';
import { lit } from './materials';
import type { Path, Vec2 } from '../geo/geo';
import { CRUISE_SPEED, postedLimit, realKmAt } from '../geo/route';
import { advance, damage, fuelPerUnit, upcomingStop, type GameState } from '../game/state';
import { brakeRange, crashScale, speedFuelFactor } from '../game/driving';
import { structureAt, type Structure } from '../game/structures';
import { buildStructurePart } from './structures';
import { coolRage, HOSTILE_RANGE, hostileShot, rageOf, rollHostile, shootVehicle } from '../game/rage';
import { clampLane, defaultLane, laneCenter, oncoming, Traffic, type Vehicle, type VehicleKind } from '../game/traffic';
import { Obstacles, ramObstacle, shootObstacle, SHOOT_RANGE, type Obstacle, type ObstacleKind } from '../game/obstacles';
import { DIFFICULTIES } from '../game/difficulty';
import { ANIMALS, Animals, bumpAnimal, type Animal, type AnimalKind } from '../game/animals';
import { makeAnimal } from './animalModels';
import { distanceSignLines, limitChanges, medianKind, milepost, shoulderAt, SIDEWALK, CURB_HEIGHT, turnAngle } from '../game/roadside';
import { crashCost, OFFROAD_SPEED, offRoadWreckReason, offRoadX, SOLIDS, steerOffRoad, type OffRoad, type SolidKind } from '../game/offroad';
import { kidMode } from '../game/kidMode';
import { disposeRoadside, greenSign, lampGeometries, PROFILES as SHAPES, rumbleTexture, speedLimitSign, sweep } from './roadside';
import { rideOf } from '../game/rides';
import { STOP_TITLES, type Stop } from '../game/stops';
import { hashString, makeRng, pick, type Rng } from '../game/rng';
import { ANNOUNCED, roadAt, type Landmark } from '../game/landmarks';
import { interstateNumber, latLngAt, stateMap } from '../geo/states';
import { castShadows, disposeTree, makeAsphaltTexture, makeObstacle, makeRide, makeStripeTexture, makeTrafficVehicle, makeRoadTexture, setBlinkers, textSprite, to3, type GameScene } from './common';
import { classAt, crossSectionAt, isDivided, PROFILES, roadSegments, SPEED, urbanZones, type CrossSection, type RoadClass, type RoadSegment } from '../game/roads';
import { buildLandmark, waterTexture } from './landmarkModels';
import { sound } from '../audio/sound';
import { Atmosphere } from './atmosphere';
import { Backdrop } from './backdrop';
import { addGroundDetail } from './groundDetail';
import { fitted, setBuildingsNight, HD_HOUSES, HD_ROADSIDE, hdRoadside, placeBuilding, type HdRoadside } from './hdBuildings';
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
  /** Animals are about to cross the road ahead (once per herd). */
  onAnimals?(kind: AnimalKind, count: number): void;
  /** Bumped into an animal (cost is car health lost; the animal is fine). */
  onAnimalBump?(kind: AnimalKind, cost: number): void;
  /** Drove off the road (the first time shows a tip). */
  onOffRoad?(): void;
  /** Hit something at the roadside: knocked it over (small) or crashed into it (big). */
  onRoadside?(what: SolidKind, cost: number, big: boolean): void;
}

/** Something solid at the roadside the car can hit when it leaves the road. */
interface Solid {
  d: number;
  /** Sideways offset (+ = right of the centre line). */
  x: number;
  /** How close (sideways and along) counts as a hit, besides the car's own size. */
  r: number;
  kind: SolidKind;
  knocked?: boolean;
  /** Where it is drawn, so it can be knocked flat: one instance of an instanced mesh, or its own object. */
  inst?: { key: string; index: number; mesh?: THREE.InstancedMesh }[];
  obj?: THREE.Object3D;
}

/** What the gun is pointed at: something in the road, or another vehicle. */
export type ShotTarget = { type: 'obstacle'; o: Obstacle } | { type: 'vehicle'; v: Vehicle };
/** What a tap picks: something to shoot, or an animal (tapping one honks at it). */
export type PickTarget = ShotTarget | { type: 'animal'; a: Animal };

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
      saguaro: lit({ color: 0x4f8a3c }),
      shrub: lit({ color: 0x8a9a6a }),
      grass: lit({ color: 0xb3a95a }),
      oakTop: lit({ color: 0x3f7a35 }),
      pineTop: lit({ color: 0x2f5f35 }),
      trunk: lit({ color: 0x6b4a2b }),
      palmTrunk: lit({ color: 0x8a6a45 }),
      palmLeaves: lit({ color: 0x3f8a3a }),
      crops: lit({ color: 0x6f9a3a }),
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
const HD_HOUSES_ROADSIDE: HdRoadside[] = ['house_ranch', 'house_farm', 'house_bungalow'];
const HD_SHOPS: HdRoadside[] = ['grocery', 'hardware', 'pharmacy', 'motel', 'supply', 'garage', 'police'];

/** The on-rails road trip view: the car follows the route and the world streams in around it. */
/** How much faster time runs on autopilot. */
export const AUTOPILOT_SPEEDUP = 3;

/**
 * A fight happening right on the road (prototype). Its enemies and effects sit
 * in `root`, which the drive view carries along with the car: combat x runs
 * across your side of the road and -z points up the road ahead.
 */
export interface RoadFight {
  root: THREE.Object3D;
  /** The car's sideways place within your side of the road. */
  carX(): number;
  update(dt: number): void;
  /** Camera shake from hits. */
  shake(): number;
  /** Swipes and the lane buttons dodge between the fight's lanes. */
  changeLane(dir: -1 | 1): void;
  /** The car's speed as a share of cruise speed (escape is by distance). */
  setPace(pace: number): void;
  /** Nitro is burning: the car really speeds up. */
  boosting(): boolean;
  boss: boolean;
}

/** A boss fight never rolls you over the finish: the car stops this far short of it. */
const BOSS_HOLD = 40;

/** How much a fight's nitro boost speeds the car up. */
export const FIGHT_BOOST_SPEED = 1.6;

export class DriveScene implements GameScene {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, 1, 0.5, 2500);
  /**
   * Autopilot: time runs three times as fast, but everything still happens:
   * the car keeps its lane, brakes for traffic, and hits whatever is in the road.
   */
  autopilot = false;
  /** How many times faster than real time the drive runs. */
  get warp(): number {
    return this.autopilot ? AUTOPILOT_SPEEDUP : 1;
  }
  paused = false;
  /** A fight on the road, if one is on. */
  private fight: RoadFight | null = null;
  /** 0..1: how far the camera has pulled back and up for a fight. */
  private fightCam = 0;

  private chunks = new Map<number, THREE.Group>();
  private car: THREE.Group;
  private ground: THREE.Mesh;
  private roadTex = makeRoadTexture();
  private roadMat: THREE.MeshStandardMaterial;
  private medianMat: THREE.MeshStandardMaterial;
  /** The main road: plain asphalt with its lines drawn as separate stripes, so they line up through every change of road type. */
  private asphaltTex = makeAsphaltTexture();
  private stripeTex = [makeStripeTexture(false), makeStripeTexture(true)];
  private asphaltMat: THREE.MeshStandardMaterial;
  private stripeMats: Record<'white' | 'whiteDash' | 'yellow' | 'yellowDash', THREE.MeshStandardMaterial>;
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
  private animals: Animals;
  private animalMeshes = new Map<number, THREE.Group>();
  private announcedHerds = new Set<number>();
  /** The car's speed last frame (units a second), so animals set off in time. */
  private speed = 0;
  private autoHonked = new Set<number>();
  /** Off the road (null = in a lane). */
  private off: OffRoad | null = null;
  /** Roadside things per chunk that the car can hit off the road. */
  private solids = new Map<number, Solid[]>();
  /** Current sideways position of the car (eases between lanes when the road changes). */
  private lane = 2;
  private shoulderMat: THREE.MeshStandardMaterial;
  /** Dirt-road shortcuts. */
  private dirtMat = lit({ color: 0x9a7650, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
  /** Sidewalks, the median barrier, guardrails and rumble strips (round five roadside detail). */
  private roadsideMats: Record<'concrete' | 'barrier' | 'rail' | 'rumble', THREE.MeshStandardMaterial>;
  /** Town centres along the route (from the town signs), for sidewalks and street lights. */
  private townList: { mid: number; radius: number; big: boolean }[] = [];
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
  private backdrop: Backdrop;
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
    this.backdrop = new Backdrop(1300 * q.drawScale);
    this.backdrop.setBiome(biomeAtDistance(this.biomes, state.distance));
    this.scene.add(this.backdrop.group);
    this.atmosphere.set(hourOf(state), weatherAt(state));

    // Layered flat surfaces: polygon offsets keep road > water > shoulder > ground without z-fighting.
    this.roadMat = lit({ map: this.roadTex, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    this.asphaltMat = lit({ map: this.asphaltTex, normalMap: detailTexture('asphalt_n', 2, 2), roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    const stripe = (color: number, dashed: boolean) =>
      lit({ color, map: this.stripeTex[dashed ? 1 : 0], alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 });
    this.stripeMats = { white: stripe(0xe8e2cf, false), whiteDash: stripe(0xe8e2cf, true), yellow: stripe(0xf2c230, false), yellowDash: stripe(0xf2c230, true) };
    this.medianMat = lit({
      color: new THREE.Color(groundColorAt(this.biomes, state.distance)).multiplyScalar(0.85),
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
    this.segments = roadSegments(state.route, path.length);
    this.townList = state.landmarks
      .filter((l) => l.kind === 'citysign' && !/^Leaving |^Welcome to /.test(l.name))
      .map((l) => ({ mid: l.at + (l.big ? 380 : 170), radius: l.big ? 620 : 240, big: !!l.big }));
    this.laneClass = classAt(this.segments, state.distance);
    this.playerLane = defaultLane(this.laneClass);
    this.lane = this.laneAt(state.distance);
    const zones = urbanZones(state.route, path.length);
    this.traffic = new Traffic(this.segments, path.length, CRUISE_SPEED, state.seed ^ Math.floor(state.distance), {
      urbanAt: (d) => (zones.some((z) => d >= z.from && d <= z.to) ? 1 : 0),
    });
    this.obstacles = new Obstacles(this.segments, path.length, state.seed ^ Math.floor(state.distance), state.distance, DIFFICULTIES[state.difficulty].gap);
    // Animals cross more often in Texas and the desert; never in towns or on bridges and in tunnels.
    const animalTowns = state.landmarks.filter((l) => l.kind === 'citysign').map((l) => l.at);
    const desert = (d: number) => {
      const b = biomeAtDistance(this.biomes, d);
      return b === 'desert' || b === 'sagebrush';
    };
    this.animals = new Animals(this.segments, path.length, state.seed ^ Math.floor(state.distance), state.distance, {
      edgeAt: (d) => this.outer(d),
      desertAt: desert,
      boost: (d) => (desert(d) || stateMap()?.stateAt(latLngAt(state.route, path, d))?.code === 'TX' ? 2 : 1),
      blocked: (d) =>
        !!structureAt(this.structures, d, 60) ||
        animalTowns.some((t) => d > t - 150 && d < t + 900) ||
        state.stops.some((st) => Math.abs(st.at - d) < 250) ||
        zones.some((z) => d >= z.from && d <= z.to),
    });
    this.roadSpeed = SPEED[classAt(this.segments, state.distance)].factor;
    this.shoulderMat = lit({ color: groundColorAt(this.biomes, state.distance, 'shoulder'), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    // Photo grain on Medium/High (the colours still come from the climate).
    this.shoulderMat.map = detailTexture('gravel', 1, 1 / 6);
    this.medianMat.map = detailTexture('ground', 0.12, 1 / 60);
    const flat = { polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -10 };
    const rumble = rumbleTexture();
    this.roadsideMats = {
      concrete: lit({ color: 0xbdb8ad, side: THREE.DoubleSide }),
      barrier: lit({ color: 0xcfcabe, side: THREE.DoubleSide }),
      rail: lit({ color: 0xaab2b8, side: THREE.DoubleSide }),
      rumble: lit({ map: rumble, transparent: true, depthWrite: false, ...flat }),
    };
    const plants = plantModels();
    const lamp = lampGeometries();
    this.mats = {
      ...plants.mats,
      rock: lit({ color: 0x9c8a78 }),
      pole: lit({ color: 0x5a4632 }),
      // Walls with rows of windows; some light up after dark.
      building: lit({ color: 0xffffff, map: windowTexture(false), emissive: 0xffd890, emissiveMap: windowTexture(true), emissiveIntensity: 0 }),
      roof: lit({ color: 0x5b3b33 }),
      canopy: lit({ color: 0xc8302c }),
      white: lit({ color: 0xeeeeee }),
      delineator: lit({ color: 0xe8e8e8 }),
      // Unlit, so the reflectors catch the headlights' eye at night.
      reflector: new THREE.MeshBasicMaterial({ color: 0xffb030 }),
      // Street lights: the head glows after dark, with a pool of light on the road (not on Low).
      lampPost: lit({ color: 0x6d737a }),
      lampHead: lit({ color: 0xfff4d8, emissive: 0xffd890, emissiveIntensity: 0 }),
      // Soft-edged, and pulled ahead of the road surface so it shows from far off, not just as you pass.
      lampGlow: new THREE.MeshBasicMaterial({ color: 0xffd28a, map: glowTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -10, polygonOffsetUnits: -20, toneMapped: false }),
      railPost: lit({ color: 0x8a9096 }),
    };
    this.geos = {
      ...plants.geos,
      rock: new THREE.DodecahedronGeometry(1.4, 0),
      pole: new THREE.CylinderGeometry(0.15, 0.18, 8, 5).translate(0, 4, 0),
      building: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      roof: new THREE.ConeGeometry(0.75, 0.5, 4).rotateY(Math.PI / 4).translate(0, 1.25, 0),
      delineator: new THREE.BoxGeometry(0.12, 1.1, 0.12).translate(0, 0.55, 0),
      reflector: new THREE.BoxGeometry(0.15, 0.2, 0.15).translate(0, 0.95, 0),
      lampPost: lamp.post,
      lampHead: lamp.head,
      lampGlow: lamp.glow,
      railPost: new THREE.BoxGeometry(0.16, 0.85, 0.16).translate(0, 0.42, 0),
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
      lit({
        color: groundColorAt(this.biomes, state.distance),
        map: detailTexture('ground', GROUND_SIZE / GROUND_TILE, GROUND_SIZE / GROUND_TILE),
        normalMap: detailTexture('ground_n', GROUND_SIZE / GROUND_TILE, GROUND_SIZE / GROUND_TILE),
        normalScale: new THREE.Vector2(0.9, 0.9),
        polygonOffset: true,
        polygonOffsetFactor: 2,
        polygonOffsetUnits: 4,
      }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    if (quality.level !== 'low') addGroundDetail(this.ground.material as THREE.Material);
    this.scene.add(this.ground);
    castShadows(this.car, this.shadows);
    this.scene.add(this.car);
    this.placeCar(true);
  }

  /** Half-width of the pavement at a distance. */
  edge(d: number): number {
    return this.section(d).edge;
  }

  /** The road's shape across at a distance (lanes, their width and the median). */
  section(d: number): CrossSection {
    return crossSectionAt(this.segments, d);
  }

  /** How much wider than a plain two-lane road it is here (scenery moves out by this much). */
  widen(d: number): number {
    return this.outer(d) - ROAD_HALF;
  }

  /** How built-up it is here, 0 (open country) to 1 (downtown): near the start, the end, town stops and town signs. */
  urbanAt(d: number): number {
    const total = this.path.length;
    let u = Math.max(d < 1500 ? 1 - d / 1500 : 0, d > total - 1500 ? 1 - (total - d) / 1500 : 0);
    for (const s of this.state.stops) if (s.kind === 'town' || s.kind === 'mall') u = Math.max(u, 1 - Math.abs(s.at - d) / 260);
    for (const t of this.townList) u = Math.max(u, 1 - Math.abs(t.mid - d) / t.radius);
    return u;
  }

  /** Sidewalks with curbs and street lights: town streets (not freeways), leaving a gap at side roads. */
  sidewalkAt(d: number): boolean {
    if (isDivided(classAt(this.segments, d)) || this.urbanAt(d) < 0.4) return false;
    return !this.state.stops.some((s) => Math.abs(s.at - d) < 6);
  }

  /** The paved shoulder outside the last lane (none on local roads or where there is a sidewalk). */
  shoulder(d: number): number {
    return this.sidewalkAt(d) ? 0 : shoulderAt(this.segments, d);
  }

  /** Distance from the centre line to the outside of the shoulder or sidewalk: where the roadside starts. */
  outer(d: number): number {
    return this.edge(d) + (this.sidewalkAt(d) ? SIDEWALK : this.shoulder(d));
  }

  /** For the ?perf=1 readout: whether a fight is on the road, and the climate id here. */
  get fightOn(): boolean {
    return !!this.fight;
  }
  get biomeId(): BiomeId {
    return biomeAtDistance(this.biomes, this.state.distance);
  }

  /** The road type under the car (for the ?perf=1 readout). */
  get roadClass(): RoadClass {
    return this.laneClass;
  }

  /** The speed limit where the car is, in mph: the posted one from OpenStreetMap when known, else the usual one for the road. */
  speedLimit(d = this.state.distance): number {
    const posted = postedLimit(this.state.route, d);
    return posted || SPEED[classAt(this.segments, d)].mph;
  }

  private laneAt(d: number): number {
    if (this.off) {
      const xs = this.section(d);
      return offRoadX(this.off, { edge: xs.edge, shoulder: this.shoulder(d), sidewalk: this.sidewalkAt(d) ? SIDEWALK : 0, median: xs.median, divided: isDivided(classAt(this.segments, d)) });
    }
    return laneCenter(this.section(d), this.playerLane);
  }

  /** Off the road right now (for the HUD). */
  get offRoad(): boolean {
    return !!this.off;
  }

  /** Sideways position of a traffic vehicle. */
  private vehicleX(v: Vehicle): number {
    return laneCenter(this.section(v.d), v.lane);
  }

  /** Change lanes: -1 = left, 1 = right. On two-way roads you can pull into the oncoming lane to pass. */
  steer(dir: -1 | 1): void {
    if (this.paused || this.stopping || this.turning || this.pendingTurn) return;
    if (this.fight) {
      this.fight.changeLane(dir);
      sound.click();
      return;
    }
    const d = this.state.distance;
    const cls = classAt(this.segments, d);
    const next = clampLane(cls, this.playerLane + dir);
    const res = steerOffRoad(
      this.off,
      dir,
      { divided: isDivided(cls), barrierMedian: medianKind(cls) === 'barrier' && this.section(d).median > 1, atEdge: next === this.playerLane },
      this.off?.step === 2 ? this.bigThingOutside(this.off.side) : null,
    );
    // Autopilot keeps to the road.
    if (this.autopilot && !this.off && res.kind !== 'lane') return;
    switch (res.kind) {
      case 'lane':
        if (next !== this.playerLane) {
          this.playerLane = next;
          sound.click();
        }
        break;
      case 'leave':
        // Bridges and tunnels have walls: no way off.
        if (structureAt(this.structures, d, 6)) this.crashInto('bridge');
        else {
          this.off = res.off;
          sound.rumble();
          this.cb.onOffRoad?.();
        }
        break;
      case 'move':
        // A guardrail on a bend stops you going any further out.
        if (res.off.step === 2 && this.shoulder(d) > 1.2 && this.sharpBend(d)) this.crashInto('guardrail');
        else {
          this.off = res.off;
          sound.rumble();
        }
        break;
      case 'back':
        this.off = null;
        sound.click();
        break;
      case 'crash':
        this.crashInto(res.what);
        this.off = res.off;
        break;
      case 'blocked':
        sound.click();
        break;
    }
  }

  /** A building, tree or rock just past the verge on one side (what steering out further would hit). */
  private bigThingOutside(side: -1 | 1): SolidKind | null {
    const d = this.state.distance;
    let best: Solid | null = null;
    for (const list of this.nearSolids()) {
      for (const s of list) {
        if (!SOLIDS[s.kind].big || Math.sign(s.x) !== side || Math.abs(s.d - d) > 12 + s.r) continue;
        if (!best || Math.abs(s.x) < Math.abs(best.x)) best = s;
      }
    }
    return best?.kind ?? null;
  }

  /** The solids of the chunks around the car. */
  private nearSolids(): Solid[][] {
    const k = Math.floor(this.state.distance / CHUNK);
    return [this.solids.get(k - 1), this.solids.get(k), this.solids.get(k + 1)].filter((x): x is Solid[] => !!x);
  }

  /**
   * Hitting something at the roadside. Small things fall over and cost a
   * little; big things stop the car hard and bounce it back toward the road.
   */
  private crashInto(what: SolidKind, solid?: Solid): void {
    const s = this.state;
    const big = SOLIDS[what].big;
    const cost = crashCost(what, { dmg: DIFFICULTIES[s.difficulty].dmg, speed: crashScale(this.throttle), ram: rideOf(s).ram, kid: kidMode.on });
    if (cost) damage(s, cost);
    if (s.status === 'lost') s.lostReason = offRoadWreckReason(this.urbanAt(s.distance) > 0.4);
    if (solid) this.knockOver(solid);
    if (big) {
      sound.carHit();
      this.roadSpeed *= 0.15;
      this.crashCooldown = 1;
      navigator.vibrate?.(140);
    } else {
      sound.thud();
      this.roadSpeed *= 0.85;
    }
    this.cb.onRoadside?.(what, cost, big);
  }

  /** Lays a knocked-over post or sign flat, falling away from the road. */
  private knockOver(sol: Solid): void {
    if (sol.knocked || SOLIDS[sol.kind].big) return;
    sol.knocked = true;
    const f = this.path.directionAt(sol.d);
    const fwd = new THREE.Vector3(f.x, 0, -f.y).normalize();
    const out = new THREE.Vector3(f.y, 0, f.x).multiplyScalar(Math.sign(sol.x) || 1);
    const tilt = new THREE.Quaternion().setFromAxisAngle(fwd, (Math.sign(sol.x) || 1) * (Math.PI / 2 - 0.12));
    if (sol.obj) {
      sol.obj.quaternion.premultiply(tilt);
      sol.obj.position.addScaledVector(out, 0.6);
    }
    for (const i of sol.inst ?? []) {
      if (!i.mesh) continue;
      const m = new THREE.Matrix4();
      i.mesh.getMatrixAt(i.index, m);
      const pos = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const sc = new THREE.Vector3();
      m.decompose(pos, q, sc);
      q.premultiply(tilt);
      pos.addScaledVector(out, 0.6).setY(0.15);
      i.mesh.setMatrixAt(i.index, m.compose(pos, q, sc));
      i.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Off the road: run into whatever is in the car's path. */
  private roadsideHits(): void {
    if (!this.off || this.crashCooldown > 0) return;
    const d = this.state.distance;
    // Driving off the end of the shoulder onto a bridge or into a tunnel: the rail stops you.
    if (structureAt(this.structures, d + 4, 0)) {
      this.crashInto('bridge');
      this.off = null;
      return;
    }
    const half = rideOf(this.state).length / 2;
    for (const list of this.nearSolids()) {
      for (const sol of list) {
        if (sol.knocked || Math.abs(sol.d - d) > half + sol.r || Math.abs(sol.x - this.lane) > sol.r + 1) continue;
        this.crashInto(sol.kind, sol);
        // A big thing bounces you back toward the road.
        if (SOLIDS[sol.kind].big && this.off) this.off = this.off.step === 2 ? { side: this.off.side, step: 1 } : null;
        return;
      }
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
    this.laneClass = cls;
    if (wasDefault) this.playerLane = defaultLane(cls);
    // Lanes open up and merge away on the outside, so keep your lane counted from the
    // centre; a merged-away lane has already slid you in beside the next one.
    else if (this.playerLane >= 0) this.playerLane = Math.min(this.playerLane, PROFILES[cls].lanes - 1);
    this.playerLane = clampLane(cls, this.playerLane);
  }

  /** The land changes colour gradually as you drive from one climate into another. */
  private applyBiomeColours(): void {
    const d = this.state.distance;
    (this.ground.material as THREE.MeshStandardMaterial).color.setHex(groundColorAt(this.biomes, d));
    this.medianMat.color.setHex(groundColorAt(this.biomes, d)).multiplyScalar(0.85);
    this.shoulderMat.color.setHex(groundColorAt(this.biomes, d, 'shoulder'));
    this.atmosphere.daySky = groundColorAt(this.biomes, d, 'sky');
    this.backdrop.setBiome(biomeAtDistance(this.biomes, d));
  }

  /** The kind of country at a distance (for the HUD). */
  biomeName(d = this.state.distance): string {
    return BIOMES[biomeAtDistance(this.biomes, d)].name;
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    // Portrait phones need a wider view to see the road ahead.
    // Upright phones need a wide view, but too wide makes buildings at the edges lean.
    this.camera.fov = w < h ? 68 : 58;
    this.camera.updateProjectionMatrix();
  }

  /** The player chose to turn off at a stop; the car signals and takes the turn when it gets there. */
  takeTurn(stop: Stop): void {
    this.pendingTurn = stop;
    // Signalling for a turn brings you back onto the road first.
    this.off = null;
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
  /** Starts drawing and running a fight around the car while it keeps driving. */
  attachFight(f: RoadFight): void {
    this.fight = f;
    this.off = null;
    this.traffic.clearNear(this.state.distance, 400);
    this.promptStop = null;
    this.cb.onPrompt(null, 0);
  }

  /** Where the car sits across your side of the road (a fight's starting x). */
  get sideX(): number {
    return this.lane - this.sideCentre(this.state.distance);
  }

  detachFight(): void {
    this.fight = null;
  }

  get fighting(): boolean {
    return !!this.fight;
  }

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
      const night = Math.max(0, 1 - daylight(hourOf(this.state)) * 2.5);
      (this.mats.building as THREE.MeshStandardMaterial).emissiveIntensity = night;
      (this.mats.lampHead as THREE.MeshStandardMaterial).emissiveIntensity = night * 1.6;
      (this.mats.lampGlow as THREE.MeshBasicMaterial).opacity = night * 0.4;
      setBuildingsNight(night);
    }
    // The clock moves every frame so dawn and dusk come on smoothly.
    this.atmosphere.set(hourOf(this.state), weatherAt(this.state));
    this.atmosphere.update(dt, this.camera, this.car.position);
    this.backdrop.follow(this.camera);
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
    // Autopilot runs the same drive several times a frame, so braking, crashes and road rage all still happen.
    for (let i = 0; i < this.warp; i++) {
      if (this.paused || this.turning) break;
      if (!this.stopping) this.drive(dt);
      this.traffic.step(dt * (this.stopping ? 0.3 : 1), this.state.distance);
      this.obstacles.step(this.state.distance);
      this.animals.step(dt, this.state.distance, this.stopping ? 0 : this.speed);
      this.trafficAvoidsObstacles();
      if (this.stopping) break;
    }
    this.streamChunks();
    this.fightCam += ((this.fight ? 1 : 0) - this.fightCam) * Math.min(1, dt * 2);
    this.placeCar(false, dt);
    if (this.fight) {
      this.placeFight();
      if (!this.paused) for (let i = 0; i < this.warp; i++) this.fight?.update(dt);
    }
    this.placeTraffic();
    this.placeObstacles();
    this.placeAnimals();
  }

  private drive(dt: number): void {
    const s = this.state;
    // Faster on interstates, slower through towns; eases between road types.
    const want = SPEED[classAt(this.segments, s.distance)].factor;
    this.roadSpeed += (want - this.roadSpeed) * Math.min(1, dt * 0.8);
    this.followRoadChanges();
    this.crashCooldown -= dt;
    if (this.autopilot) {
      // Autopilot drives at the limit on its own side of the road (and back onto it).
      this.off = null;
      this.throttle = Math.min(this.throttle, 1);
      if (oncoming(this.playerLane)) this.playerLane = clampLane(this.laneClass, 0);
    }
    let speed = CRUISE_SPEED * rideOf(s).speed * this.roadSpeed * this.throttle;
    if (this.promptStop) speed = Math.min(speed, CRUISE_SPEED * 0.7);
    // Off the road: slower on the shoulder, slower still on the sidewalk, and slowest on grass and dirt.
    if (this.off) speed *= this.offSurface() === 'paved' ? OFFROAD_SPEED.paved : this.offSurface() === 'sidewalk' ? OFFROAD_SPEED.sidewalk : OFFROAD_SPEED.rough;
    // Brake behind a slower vehicle in your lane.
    if (!oncoming(this.playerLane)) {
      // Speeding leaves less time to react: the car notices slower traffic later.
      const v = this.traffic.ahead(s.distance, this.playerLane, brakeRange(this.throttle));
      if (v) speed = Math.min(speed, v.speed * (1 - Math.max(0, 8 - (v.d - s.distance)) * 0.08));
    }
    if (this.autopilot) speed = this.autopilotAnimals(speed);
    if (this.fight?.boosting()) speed *= FIGHT_BOOST_SPEED;
    speed = Math.max(0, speed);
    this.fight?.setPace(speed / CRUISE_SPEED);
    this.speed = speed;
    this.announceAnimals();
    let step = speed * dt;
    // A boss still fighting at the end of the trip: the car pulls up short of the finish and waits.
    if (this.fight?.boss) {
      const room = Math.max(0, this.path.length - BOSS_HOLD - s.distance);
      if (step >= room) {
        step = room;
        this.fight.setPace(0);
      }
    }
    if (this.pendingTurn && s.distance + step >= this.pendingTurn.at) {
      step = Math.max(0, this.pendingTurn.at - s.distance);
    }
    const res = advance(s, this.path, step, this.fuelRate * speedFuelFactor(this.throttle));
    this.spinWheels(step);
    coolRage(s, step);
    this.roadRage(dt, speed);
    this.checkCrash();
    this.roadsideHits();
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
    if (this.fight) {
      // Traffic pulls off and stops wait while you fight.
      this.traffic.clearNear(s.distance, 300);
      this.cb.onTick();
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

  /** What the car is driving on, off the road. */
  private offSurface(): 'paved' | 'sidewalk' | 'rough' {
    const d = this.state.distance;
    if (!this.off || this.off.step === 2 || (this.off.side < 0 && isDivided(classAt(this.segments, d)))) return 'rough';
    if (this.sidewalkAt(d)) return 'sidewalk';
    return this.shoulder(d) > 1 ? 'paved' : 'rough';
  }

  /** Autopilot slows for animals in its path and honks them along, rather than hitting them. */
  private autopilotAnimals(speed: number): number {
    const a = this.animals.inPath(this.state.distance, this.lane, 70);
    if (!a) return speed;
    if (!this.autoHonked.has(a.herd)) {
      this.autoHonked.add(a.herd);
      this.honk();
    }
    const gap = a.d - this.state.distance;
    return Math.min(speed, CRUISE_SPEED * Math.max(0, (gap - 8) / 70));
  }

  /** Tells the HUD once per herd that animals are about to cross. */
  private announceAnimals(): void {
    const a = this.animals.nearest(this.state.distance, 200);
    if (!a || this.announcedHerds.has(a.herd)) return;
    this.announcedHerds.add(a.herd);
    const count = this.animals.list.filter((x) => x.herd === a.herd).length;
    this.cb.onAnimals?.(a.kind, count);
  }

  /** An animal ahead that a honk would move along (for the HUD's horn button). */
  get animalAhead(): Animal | null {
    if (this.paused || this.stopping || this.turning) return null;
    return this.animals.nearest(this.state.distance, 200);
  }

  /** Honk the horn: animals ahead trot off the road. Returns how many moved. */
  honk(): number {
    sound.horn();
    const n = this.animals.honk(this.state.distance, this.lane);
    if (n) {
      const kinds = new Set(this.animals.list.filter((a) => a.mode === 'hurry').map((a) => a.kind));
      if (kinds.has('cow')) sound.moo(0.5);
      if (kinds.has('armadillo')) sound.squeak(0.4);
    }
    return n;
  }

  /** Hitting another vehicle hurts, knocks it off the road and slows you down. */
  private checkCrash(): void {
    if (this.crashCooldown > 0) return;
    const animal = this.animals.hit(this.state.distance, this.lane, rideOf(this.state).length);
    if (animal) {
      const cost = bumpAnimal(this.state, animal, this.lane);
      if (animal.kind === 'cow') sound.moo();
      else sound.squeak();
      sound.carHit();
      this.roadSpeed *= 0.6;
      this.crashCooldown = 0.6;
      this.cb.onAnimalBump?.(animal.kind, cost);
      return;
    }
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
    return laneCenter(this.section(o.d), o.lane);
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
  pick(ndc: { x: number; y: number }, radius = 0.16): PickTarget | null {
    if (this.paused || this.stopping || this.turning) return null;
    const d = this.state.distance;
    const aspect = this.camera.aspect || 1;
    const p = new THREE.Vector3();
    let best: PickTarget | null = null;
    let bestDist = radius;
    const consider = (m: THREE.Object3D | undefined, t: PickTarget) => {
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
    for (const a of this.animals.list) if (a.d > d - 2 && a.d - d <= SHOOT_RANGE) consider(this.animalMeshes.get(a.id), { type: 'animal', a });
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

  /** Traffic swerves round obstacles and crossing animals (or pulls off the road on a one-lane road). */
  private trafficAvoidsObstacles(): void {
    for (const a of this.animals.active) {
      if (a.mode === 'waiting') continue;
      for (const v of this.traffic.vehicles) {
        const gap = oncoming(v.lane) ? v.d - a.d : a.d - v.d;
        if (gap < 0 || gap > 30 || Math.abs(this.vehicleX(v) - a.x) > ANIMALS[a.kind].width / 2 + 2) continue;
        const n = PROFILES[classAt(this.segments, v.d)].lanes;
        // Lanes count out from the centre line: 0, 1… on your side and -1, -2… oncoming.
        if (n > 1) v.lane = oncoming(v.lane) ? (v.lane === -1 ? -2 : v.lane + 1) : v.lane === 0 ? 1 : v.lane - 1;
        else this.traffic.remove(v);
      }
    }
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

  /** Animals walk across the road, legs swinging; a bumped one wobbles with stars over its head. */
  private placeAnimals(): void {
    const alive = new Set<number>();
    for (const a of this.animals.list) {
      if (a.d - this.state.distance > this.ahead) continue;
      alive.add(a.id);
      let m = this.animalMeshes.get(a.id);
      if (!m) {
        m = makeAnimal(a.kind);
        castShadows(m, this.shadows);
        this.animalMeshes.set(a.id, m);
        this.scene.add(m);
      }
      const p = this.path.pointAt(a.d);
      const f = this.path.directionAt(a.d, 6);
      m.position.set(p.x + f.y * a.x, 0, -p.y + f.x * a.x);
      const moving = a.mode !== 'waiting' && a.mode !== 'done';
      const pace = a.mode === 'crossing' ? 5 : 12;
      // Head toward the way it walks; grazing ones turn a little along the road.
      const heading = Math.atan2(a.dir * f.y, a.dir * f.x) + (moving ? 0 : 0.6 * a.dir);
      m.rotation.y = heading;
      m.rotation.z = a.mode === 'dazed' ? Math.sin(this.clock * 9) * 0.12 : 0;
      let i = 0;
      for (const c of m.children) {
        if (c.name !== 'leg') continue;
        c.rotation.x = moving ? Math.sin(this.clock * pace + a.id + (i++ % 2) * Math.PI) * 0.45 : 0;
      }
      const stars = m.getObjectByName('stars');
      if (stars) {
        stars.visible = a.mode === 'dazed';
        stars.rotation.y = this.clock * 4;
      }
    }
    for (const [id, m] of this.animalMeshes) {
      if (alive.has(id)) continue;
      this.scene.remove(m);
      disposeTree(m);
      this.animalMeshes.delete(id);
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
    const want = this.fight ? this.sideCentre(d) + this.fight.carX() : this.laneAt(d);
    // Jumps (loading, debug teleports) snap; otherwise change lanes at a steady pace (quicker when dodging in a fight).
    const jumped = this.car.position.distanceTo(p) > 150;
    const rate = (this.fight ? 14 : 5) * rideOf(this.state).steer;
    this.lane = snap || jumped ? want : this.lane + Math.sign(want - this.lane) * Math.min(Math.abs(want - this.lane), rate * dt);
    p.addScaledVector(new THREE.Vector3(f.y, 0, f.x), this.lane);
    this.car.position.copy(p);
    this.car.lookAt(p.clone().add(fwd));
    // Bumpy on grass and dirt.
    if (this.off && !this.paused && this.offSurface() === 'rough') {
      this.car.position.y = Math.abs(Math.sin(this.clock * 17)) * 0.09;
      this.car.rotateZ(Math.sin(this.clock * 11) * 0.025);
    }
    this.ground.position.set(p.x, 0, p.z);
    // The ground follows the car; shift its texture back so the grain stays put in the world.
    const gm = this.ground.material as THREE.MeshStandardMaterial;
    for (const t of [gm.map, gm.normalMap]) t?.offset.set((p.x / GROUND_TILE) % 1, (-p.z / GROUND_TILE) % 1);
    if (snap) {
      this.camPos.copy(p).addScaledVector(fwd, -14).setY(7);
      this.camLook.copy(p).addScaledVector(fwd, 20);
    }
    this.followCamera(p, fwd, snap ? 1 : dt);
  }

  /** The middle of your side of the road (where a fight centres its lanes). */
  private sideCentre(d: number): number {
    const xs = this.section(d);
    return xs.median + (xs.lanes * xs.laneWidth) / 2;
  }

  /** Lines the fight up with the car: origin on your side of the road, -z up the road. */
  private placeFight(): void {
    const f = this.fight!;
    const d = this.state.distance;
    const p = to3(this.path.pointAt(d));
    const dir = this.path.directionAt(d, 10);
    const right = new THREE.Vector3(dir.y, 0, dir.x);
    const back = new THREE.Vector3(-dir.x, 0, dir.y);
    p.addScaledVector(right, this.sideCentre(d));
    f.root.position.copy(p).setY(0);
    f.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, new THREE.Vector3(0, 1, 0), back));
    f.root.updateMatrixWorld(true);
  }

  private followCamera(p: THREE.Vector3, fwd: THREE.Vector3, dt: number): void {
    // In a fight the camera rises and tilts down, like the old fight view, so the road ahead fills the screen.
    const k = this.fightCam;
    const wantPos = p.clone().addScaledVector(fwd, -14 + 2.5 * k).setY(p.y + 7 + 1.5 * k);
    // Snap instead of gliding across the map after a jump (loading a save, resuming).
    const ease = this.camPos.distanceTo(wantPos) > 150 ? 1 : Math.min(1, dt * 4);
    const wantLook = p.clone().addScaledVector(fwd, 20 + 2 * k).setY(1 - 1.5 * k);
    this.camPos.lerp(wantPos, ease);
    this.camLook.lerp(wantLook, ease);
    this.camera.position.copy(this.camPos);
    const shake = this.fight?.shake() ?? 0;
    if (shake > 0) this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, 0));
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
        this.solids.delete(k);
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

  /**
   * A flat strip along the path between two sideways offsets. It always ends
   * exactly at `to`, so strips that meet (chunks, road types) leave no gap.
   * `uScale` maps sideways world units to texture u (0 = stretch 0..1 across).
   */
  private strip(from: number, to: number, span: (d: number) => [number, number], y: number, vScale: number, uScale = 0, flip = false): THREE.BufferGeometry {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const ds: number[] = [];
    for (let d = from; d < to - 0.5; d += 4) ds.push(d);
    ds.push(to);
    ds.forEach((d, i) => {
      const p = this.path.pointAt(d);
      const f = this.path.directionAt(d);
      const r = { x: f.y, y: -f.x };
      const [a, b] = span(d);
      pos.push(p.x + r.x * a, y, -(p.y + r.y * a), p.x + r.x * b, y, -(p.y + r.y * b));
      const [ua, ub] = uScale ? [a / uScale, b / uScale] : flip ? [1, 0] : [0, 1];
      uv.push(ua, d / vScale, ub, d / vScale);
      if (i > 0) {
        const k = (i - 1) * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  private buildChunk(k: number): THREE.Group {
    const g = new THREE.Group();
    const from = k * CHUNK;
    const to = Math.min(this.path.length, from + CHUNK + 4);
    this.buildRoad(g, from, to);

    const rng = makeRng(this.state.seed ^ hashString(`chunk${k}`));
    this.addHdRoadside();
    const inst: Record<string, THREE.Matrix4[]> = {};
    for (const k of Object.keys(this.geos)) inst[k] = [];
    const buildingColors: THREE.Color[] = [];
    // Roadside things the car can hit off the road (small ones are knocked flat by instance).
    const solids: Solid[] = [];
    this.solids.set(k, solids);
    const solid = (kind: SolidKind, d: number, x: number, r: number, ...keys: string[]) =>
      solids.push({ kind, d, x, r, inst: keys.map((key) => ({ key, index: inst[key].length - 1 })) });
    const stopsHere = this.state.stops.filter((s) => s.at > from - 200 && s.at < to + 200);
    const marksHere = this.state.landmarks.filter((l) => l.at > from - 120 && l.at < to + 120 && l.kind !== 'mountains' && l.kind !== 'peak' && l.kind !== 'mesa');
    const clear = (d: number, side: number) =>
      !!structureAt(this.structures, d, 30) ||
      marksHere.some((l) => (l.kind === 'river' ? Math.abs(l.at - d) < 45 : Math.abs(l.at - d) < (WIDE_SIGHTS.has(l.kind) ? 75 : 30) && l.side === side));
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
      const urban = this.urbanAt(d);
      const city = towns.some((t) => t.big && Math.abs(t.mid - d) < t.radius * 0.6);
      const wide = this.widen(d);
      const sidewalk = this.sidewalkAt(d);
      const cls = classAt(this.segments, d);
      // Wooden poles out in the country; street lights on the sidewalks in town.
      if (Math.round(d) % 48 < 8 && !clear(d, 1) && !sidewalk) {
        placeAt(inst.pole, p, right, 7.5 + wide, 0, 1);
        solid('pole', d, 7.5 + wide, 0.4, 'pole');
      }
      const lampSpots = sidewalk ? { every: 40, off: this.edge(d) + SIDEWALK - 0.6 } : cls === 'metro' ? { every: 64, off: this.outer(d) + 0.5 } : null;
      if (lampSpots && Math.round(d) % lampSpots.every < 8) {
        for (const side of [-1, 1]) {
          if (structureAt(this.structures, d, 10)) continue;
          // The arm reaches out over the road.
          const yaw = Math.atan2(side * f.x, -side * f.y);
          placeAt(inst.lampPost, p, right, side * lampSpots.off, yaw, 1);
          placeAt(inst.lampHead, p, right, side * lampSpots.off, yaw, 1);
          // The lamp head falls with its post.
          solid('lamp', d, side * lampSpots.off, 0.4, 'lampPost', 'lampHead');
          if (quality.level !== 'low') placeAt(inst.lampGlow, p, right, side * lampSpots.off, yaw, 1);
        }
      }
      // Reflector posts along the shoulders of bigger roads (guardrail posts on sharp bends).
      if (Math.round(d) % 40 < 8 && cls !== 'local' && urban < 0.3) {
        for (const side of [-1, 1]) {
          const off = side * (this.outer(d) + 0.8);
          placeAt(inst.delineator, p, right, off, 0, 1);
          placeAt(inst.reflector, p, right, off, 0, 1);
          solid('delineator', d, off, 0.3, 'delineator', 'reflector');
        }
      }
      if (this.shoulder(d) > 1.2 && this.sharpBend(d)) {
        for (const side of [-1, 1]) placeAt(inst.railPost, p, right, side * (this.edge(d) + this.shoulder(d) + 0.52), 0, 1);
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
          // The detailed houses and shops when they've loaded: mostly houses on the edge of town, shops nearer the middle.
          const hdName = tower ? null : pick(rng, urban > 0.6 ? (rng() < 0.5 ? HD_SHOPS : []) : rng() < 0.6 ? HD_HOUSES_ROADSIDE : HD_SHOPS);
          const hd = hdName && this.geos[`hd:${hdName}`] ? hdName : null;
          const model = !tower && !hd && this.model(pick(rng, urban > 0.6 ? BLOCK_MODELS : HOUSE_MODELS));
          if (hd) {
            const face = Math.atan2(-side * f.y, -side * f.x) + (rng() - 0.5) * 0.2;
            const mo = side * (16 + wide + rng() * 12);
            const size = hdRoadside(hd)!.size;
            placeAt(inst[`hd:${hd}`], p, right, mo, face, ((hd.startsWith('house') ? 11 : 13) / size.x) * (0.9 + rng() * 0.2));
            solid('building', d, mo, 6);
          } else if (model) {
            // Models face the road, a little crooked so the street doesn't look stamped out.
            const face = Math.atan2(-side * f.y, -side * f.x) + (rng() - 0.5) * 0.3;
            const mo = side * (14 + wide + rng() * 14);
            placeAt(inst[model], p, right, mo, face, 0.85 + rng() * 0.35);
            solid('building', d, mo, 5);
          } else {
            placeAt(inst.building, p, right, off, rng() * Math.PI, w, h, 6 + rng() * 8);
            solid('building', d, off, w / 2);
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
              if (TREES.has(kind) || kind === 'saguaro') solid('tree', d, off, 0.8);
            }
          } else if (r2 < b.density * this.density + b.rocks * 0.5 * this.density) {
            const rock = this.model(pick(rng, ROCK_MODELS));
            const ro = side * (10 + wide + rng() * 80);
            const rs = [rng() * 6, (0.5 + rng() * 2) * (rock ? 1.8 : 1)];
            placeAt(inst[rock ?? 'rock'], p, right, ro, rs[0], rs[1]);
            if (rs[1] > 1.2) solid('rock', d, ro, rs[1]);
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
      for (const sol of solids) for (const i of sol.inst ?? []) if (i.key === key) i.mesh = mesh;
    }
    for (const stop of this.state.stops) {
      if (stop.at >= from && stop.at < from + CHUNK) g.add(this.buildStop(stop, rng));
    }
    this.addMileMarkers(g, from, to);
    this.addSigns(g, k, from, Math.min(this.path.length, from + CHUNK));
    for (const l of this.state.landmarks) {
      if (l.at >= from && l.at < from + CHUNK) g.add(buildLandmark(l, this.path, (d) => this.outer(d)));
    }
    for (const st of this.structures) {
      if (st.to > from && st.from < to) g.add(buildStructurePart(st, this.path, from, to, (d) => this.outer(d)));
    }
    if (k === Math.floor(this.path.length / CHUNK)) g.add(this.buildFinish());
    if (this.shadows) castShadows(g, true);
    return g;
  }

  /** The instancing key for a model, or null when it isn't loaded. */
  /** Registers the light roadside buildings for instancing once they've loaded. */
  private addHdRoadside(): void {
    for (const name of HD_ROADSIDE) {
      const key = `hd:${name}`;
      if (this.geos[key]) continue;
      const r = hdRoadside(name);
      if (!r) continue;
      this.geos[key] = r.geometry;
      this.mats[key] = r.material;
    }
  }

  private model(name: ModelName): string | null {
    return this.geos[`m:${name}`] ? `m:${name}` : null;
  }

  /**
   * Pavement for one chunk: asphalt, the grass median, and the painted lines.
   * Everything follows the road's cross-section, so where the road type
   * changes a lane opens up or merges away and the median grows or closes,
   * instead of the whole road squeezing.
   */
  private buildRoad(g: THREE.Group, from: number, to: number): void {
    const parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const add = (mat: THREE.Material, geo: THREE.BufferGeometry) => {
      const list = parts.get(mat) ?? [];
      list.push(geo);
      parts.set(mat, list);
    };
    // Sample the cross-section once per spot; strips look it up many times.
    const cache = new Map<number, CrossSection>();
    const xs = (d: number) => {
      let v = cache.get(d);
      if (!v) cache.set(d, (v = this.section(d)));
      return v;
    };
    const both = (fn: (d: number) => [number, number]) => [fn, (d: number): [number, number] => {
      const [a, b] = fn(d);
      return [-b, -a];
    }] as const;
    const line = (mat: THREE.Material, a: number, b: number, at: (d: number) => number, w = 0.2) => {
      for (const fn of both((d) => [at(d) - w / 2, at(d) + w / 2])) add(mat, this.strip(a, b, fn, 0.1, 12, 0));
    };
    // Gravel verges outside the paved shoulder (or sidewalk) on both sides.
    const shoulderCache = new Map<number, number>();
    const sh = (d: number) => {
      let v = shoulderCache.get(d);
      if (v === undefined) shoulderCache.set(d, (v = this.shoulder(d)));
      return v;
    };
    const walkCache = new Map<number, boolean>();
    const walk = (d: number) => {
      let v = walkCache.get(d);
      if (v === undefined) walkCache.set(d, (v = this.sidewalkAt(d)));
      return v;
    };
    const outer = (d: number) => xs(d).edge + (walk(d) ? SIDEWALK : sh(d));
    for (const fn of both((d) => [outer(d) - 0.5, outer(d) + 3])) add(this.shoulderMat, this.strip(from, to, fn, 0.04, 1));
    // Paved shoulders on highways and freeways, with rumble strips just outside the edge line.
    for (const [a, b] of this.spans(from, to, (d) => sh(d) > 0.05)) {
      for (const fn of both((d) => [xs(d).edge - 0.2, xs(d).edge + sh(d)])) add(this.asphaltMat, this.strip(a, b, fn, 0.1, 7, 7));
    }
    for (const [a, b] of this.spans(from, to, (d) => sh(d) > 1.2)) {
      for (const fn of both((d) => [xs(d).edge + 0.15, xs(d).edge + 0.75])) add(this.roadsideMats.rumble, this.strip(a, b, fn, 0.11, 1.1));
    }
    // Curbs and sidewalks through towns.
    for (const [a, b] of this.spans(from, to, walk)) {
      for (const left of [false, true]) {
        const geo = sweep(this.path, a, b, SHAPES.sidewalk(SIDEWALK, CURB_HEIGHT), (d) => xs(d).edge, left);
        if (geo) add(this.roadsideMats.concrete, geo);
      }
    }
    // A concrete barrier down the middle of city freeways (the grass median stays in the country).
    for (const [a, b] of this.spans(from, to, (d) => xs(d).median > 1 && medianKind(classAt(this.segments, d)) === 'barrier')) {
      const geo = sweep(this.path, a, b, SHAPES.barrier, () => 0);
      if (geo) add(this.roadsideMats.barrier, geo);
    }
    // Guardrails on the outside of sharp bends on highways and freeways.
    for (const [a, b] of this.spans(from, to, (d) => sh(d) > 1.2 && this.sharpBend(d))) {
      for (const left of [false, true]) {
        const geo = sweep(this.path, a, b, SHAPES.guardrail, (d) => xs(d).edge + sh(d) + 0.4, left);
        if (geo) add(this.roadsideMats.rail, geo);
      }
    }
    // Asphalt, one side of the centre line (or median) each.
    for (const fn of both((d) => [xs(d).median, xs(d).edge])) add(this.asphaltMat, this.strip(from, to, fn, 0.1, 7, 7));
    // Grass median, where there is one.
    for (const [a, b] of this.spans(from, to, (d) => xs(d).median > 0.02)) {
      add(this.medianMat, this.strip(a, b, (d) => [-xs(d).median, xs(d).median], 0.04, 1));
    }
    // Yellow on the left: a double line on bigger two-way roads, the median edge on divided ones,
    // and a dashed centre line on two-lane roads.
    const solidYellow = (d: number) => xs(d).median > 0.02 || classAt(this.segments, d) !== 'local';
    for (const [a, b] of this.spans(from, to, solidYellow)) line(this.stripeMats.yellow, a, b, (d) => xs(d).median + 0.22, 0.16);
    for (const [a, b] of this.spans(from, to, (d) => !solidYellow(d))) add(this.stripeMats.yellowDash, this.strip(a, b, () => [-0.1, 0.1], 0.1, 12));
    // White edge lines, angling in where a lane merges away.
    line(this.stripeMats.white, from, to, (d) => xs(d).edge - 0.35);
    // Dashed lines between lanes, each ending where its lane runs out.
    for (let k = 1; k < 4; k++) {
      for (const [a, b] of this.spans(from, to, (d) => xs(d).lanes > k + 0.15)) {
        line(this.stripeMats.whiteDash, a, b, (d) => xs(d).median + k * xs(d).laneWidth);
      }
    }
    for (const [mat, geos] of parts) {
      const geo = geos.length > 1 ? mergeGeometries(geos) : geos[0];
      if (geos.length > 1) geos.forEach((x) => x.dispose());
      g.add(new THREE.Mesh(geo, mat));
    }
  }

  /** A bend tight enough for guardrails. */
  sharpBend(d: number): boolean {
    return turnAngle(this.path.directionAt(Math.max(0, d - 25)), this.path.directionAt(d + 25)) > 0.22;
  }

  /** The stretches of [from, to] where a test holds, to the nearest 2 units. */
  private spans(from: number, to: number, test: (d: number) => boolean): [number, number][] {
    const out: [number, number][] = [];
    let start: number | null = null;
    for (let d = from; ; d = Math.min(to, d + 2)) {
      const ok = test(d);
      if (ok && start === null) start = d;
      if ((!ok || d >= to) && start !== null) {
        if (d > start) out.push([start, d]);
        start = null;
      }
      if (d >= to) break;
    }
    return out;
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
      // Follow the real exit numbers where the route knows them; the border estimate fills the gaps.
      const estimate = (x: number) => (n === null ? null : map.exitNumber(latLngAt(route, this.path, x), n));
      const mile = milepost(d, route.exits, route.scale, estimate);
      if (mile === null) continue;
      const sign = mileMarker(mile);
      const p = this.path.pointAt(d);
      const f = this.path.directionAt(d);
      // On the outside of the shoulder.
      const off = this.outer(d) + 0.8;
      sign.position.copy(to3({ x: p.x + f.y * off, y: p.y - f.x * off }, 0));
      // Face the oncoming car.
      sign.rotation.y = Math.atan2(-f.x, f.y);
      g.add(sign);
      this.solids.get(Math.floor(from / CHUNK))?.push({ kind: 'mile', d, x: off, r: 0.4, obj: sign });
    }
  }

  /**
   * Roadside signs: SPEED LIMIT where the limit changes (and now and then as
   * a reminder), green EXIT signs half a mile before each exit on freeways,
   * and green distance signs to the next towns and the end of the trip.
   */
  private addSigns(g: THREE.Group, k: number, from: number, to: number): void {
    const route = this.state.route;
    const put = (sign: THREE.Object3D, d: number, out: number) => {
      const p = this.path.pointAt(d);
      const f = this.path.directionAt(d);
      sign.position.copy(to3({ x: p.x + f.y * out, y: p.y - f.x * out }, 0));
      sign.rotation.y = Math.atan2(-f.x, f.y);
      g.add(sign);
      this.solids.get(k)?.push({ kind: 'sign', d, x: out, r: out > this.outer(d) + 2 ? 1.8 : 0.6, obj: sign });
    };
    const free = (d: number) => !structureAt(this.structures, d, 25) && !this.state.stops.some((s) => Math.abs(s.at - d) < 40);
    const limits = limitChanges(from, to, (d) => this.speedLimit(d));
    // A reminder every few chunks, out of town.
    if (k % 5 === 2 && !limits.length && this.urbanAt(from + 60) < 0.4) limits.push({ at: from + 60, mph: this.speedLimit(from + 60) });
    for (const l of limits) {
      const d = l.at + 15;
      if (d < to && free(d)) put(speedLimitSign(l.mph), d, this.outer(d) + 1.2);
    }
    const miles = (a: number, b: number) => realKmAt(route, Math.abs(b - a)) / 1.609;
    // Exit ahead.
    for (const stop of this.state.stops) {
      const d = stop.at - 450;
      if (!stop.exit || d < from || d >= to || !isDivided(classAt(this.segments, d)) || !free(d)) continue;
      const m = miles(d, stop.at);
      const dist = m < 0.35 ? '1/4 MILE' : m < 0.65 ? '1/2 MILE' : m < 0.9 ? '3/4 MILE' : `${Math.round(m)} MILE${Math.round(m) > 1 ? 'S' : ''}`;
      put(greenSign([{ text: `EXIT ${stop.exit}` }, { text: stop.name }, { text: dist }], 5.5), d, this.outer(d) + 2.2);
    }
    // Distances to the next towns, now and then out of town.
    const d = from + 220;
    if (k % 7 === 3 && d < to && free(d) && this.urbanAt(d) < 0.3) {
      const towns = this.state.landmarks.filter((l) => l.kind === 'citysign' && !/^Leaving |^Welcome to /.test(l.name)).map((l) => ({ at: l.at, name: l.name }));
      const end = { at: this.path.length, name: route.endLabel.split(',')[0] };
      const lines = distanceSignLines(d, towns, end, miles);
      put(greenSign(lines.map((l) => ({ text: l.name, right: String(l.miles) }))), d, this.outer(d) + 2.6);
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
    const dirt = stop.kind === 'shortcut';
    const road = new THREE.Mesh(new THREE.PlaneGeometry(dirt ? 5 : 7, len - edge), dirt ? this.dirtMat : this.roadMat);
    road.rotation.x = -Math.PI / 2;
    road.rotation.z = Math.atan2(side.x, side.y);
    road.position.copy(to3({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 0.09));
    g.add(road);
    // Exit sign ahead of the turn.
    const signAt = this.path.pointAt(stop.at - 90);
    const sf = this.path.directionAt(stop.at - 90);
    const sub = [stop.exit ? `EXIT ${stop.exit}` : STOP_TITLES[stop.kind], stop.street].filter(Boolean).join(' · ');
    const sign = dirt
      ? textSprite(`SHORTCUT ${stop.side === 'right' ? '▶' : '◀'}`, stop.name, '#7a5230')
      : textSprite(`${stop.side === 'left' ? '◀' : ''} ${stop.name} ${stop.side === 'right' ? '▶' : ''}`.trim(), sub);
    const so = this.outer(stop.at - 90) + 1.5;
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
    // A dirt road just runs off into the distance.
    if (dirt) return g;
    // The detailed buildings, when loaded: the stop's own places in a row across the end of the side road, houses behind.
    const facing = Math.atan2(-side.x, side.y);
    const at = (along: number, out: number) => to3({ x: p.x + side.x * out + f.x * along, y: p.y + side.y * out + f.y * along }, 0);
    const places = stop.places.map((pl) => placeBuilding(pl, pl === 'junkyard' ? 18 : 13, 14));
    if (places.length && places.every(Boolean)) {
      places.forEach((b, i) => {
        b!.position.copy(at((i - (places.length - 1) / 2) * 17, len + 4));
        b!.rotation.y = facing + (rng() - 0.5) * 0.1;
        g.add(b!);
      });
      const houses = stop.kind === 'farm' ? ['barn', 'house_farm'] as const : stop.kind === 'town' ? HD_HOUSES : [];
      houses.forEach((h, i) => {
        const b = fitted(h, 11, 12);
        if (!b) return;
        b.position.copy(at((i - (houses.length - 1) / 2) * 18 + (rng() - 0.5) * 4, len + 24 + rng() * 4));
        b.rotation.y = facing + (rng() - 0.5) * 0.3;
        g.add(b);
      });
      return g;
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
        lit({ color: new THREE.Color().setHSL(rng(), 0.3, 0.6) }),
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
    this.backdrop.dispose();
    for (const m of this.animalMeshes.values()) disposeTree(m);
    this.animalMeshes.clear();
    for (const g of this.chunks.values()) disposeChunk(g);
    this.chunks.clear();
    disposeTree(this.car);
    this.ground.geometry.dispose();
    const gm = this.ground.material as THREE.MeshStandardMaterial;
    for (const m of [gm, this.medianMat, this.shoulderMat, this.asphaltMat]) m.normalMap?.dispose();
    for (const m of [gm, this.medianMat, this.shoulderMat]) m.map?.dispose();
    gm.dispose();
    Object.values(this.geos).forEach((x) => !x.userData.shared && x.dispose());
    const bm = this.mats.building as THREE.MeshStandardMaterial;
    bm.map?.dispose();
    bm.emissiveMap?.dispose();
    (this.mats.lampGlow as THREE.MeshBasicMaterial).map?.dispose();
    Object.values(this.mats).forEach((x) => !x.userData.shared && x.dispose());
    for (const m of [this.roadMat, this.asphaltMat, ...Object.values(this.stripeMats), this.medianMat, this.shoulderMat]) m.dispose();
    this.dirtMat.dispose();
    this.roadsideMats.rumble.map?.dispose();
    Object.values(this.roadsideMats).forEach((m) => m.dispose());
    disposeRoadside();
    this.roadTex.dispose();
    this.asphaltTex.dispose();
    this.stripeTex.forEach((t) => t.dispose());
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

/** A round glow that fades out to nothing at the edge. */
function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
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

const STICK_MAT = lit({ color: 0x8a8f96 });

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
  // Framed windows with blinds; by night about a third glow, each a slightly different warmth.
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = lit ? '#000' : '#fff';
  g.fillRect(0, 0, 128, 128);
  const rng = makeRng(7);
  const warm = ['#ffd890', '#ffe7b8', '#f6c070', '#fff0d0'];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      const x = 12 + col * 40;
      const y = 10 + row * 30;
      const on = rng() < 0.35;
      const shade = rng();
      if (lit) {
        if (!on) continue;
        const grad = g.createLinearGradient(0, y, 0, y + 18);
        const tone = warm[Math.floor(rng() * warm.length)];
        grad.addColorStop(0, tone);
        grad.addColorStop(1, '#a07040');
        g.fillStyle = grad;
        g.globalAlpha = 0.6 + shade * 0.4;
        g.fillRect(x + 2, y + 2 + shade * 6, 20, 16 - shade * 6);
        g.globalAlpha = 1;
        continue;
      }
      g.fillStyle = '#8a8a86';
      g.fillRect(x, y, 24, 20);
      g.fillStyle = '#3e4a58';
      g.fillRect(x + 2, y + 2, 20, 16);
      // A blind part-way down.
      g.fillStyle = '#c9c2b0';
      g.fillRect(x + 2, y + 2, 20, shade * 6);
      g.fillStyle = '#8a8a86';
      g.fillRect(x + 11, y + 2, 2, 16);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
