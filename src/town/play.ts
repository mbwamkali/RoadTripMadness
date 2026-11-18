import * as THREE from 'three';
import {
  buyFuel,
  foundCash,
  damage,
  openCrate,
  repair,
  restAtMotel,
  scavengeNoise,
  startScavenge,
  tankSize,
  type GameState,
  type Inventory,
  type Scavenge,
} from '../game/state';
import { makeObstacle, makeCar } from '../scenes/common';
import { hdZombie } from '../scenes/hdModels';
import { lit } from '../scenes/materials';
import { person, type Person } from '../scenes/people';
import { CRATE_GLOW, type TownSpot, type TownWorld } from './world';
import { daylight, hourOf } from '../game/time';
import { hashString } from '../game/rng';
import { testing } from '../game/testFlag';

/**
 * Playing a town: you turn off the highway onto Main Street in the road
 * view, tap a place's picture sign to pull in, get out, walk in and search.
 * Noise brings zombies down the real street; tap them to shoot, or run back
 * to the car and drive off. Everything happens in the one scene and camera.
 * The rules (loot, noise, ambush odds, prices) are the same as ever, in
 * game/state.ts; this is the moving and showing.
 */

export type TownPhase = 'arrive' | 'street' | 'driving' | 'parked' | 'walking' | 'inside' | 'leaving' | 'done';

export interface TownHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  car: THREE.Object3D;
  /** Where the car rejoins the highway (in the lane) and which way it then faces. */
  exit: { pos: THREE.Vector3; fwd: THREE.Vector3 };
}

export interface TownHooks {
  kid: boolean;
  state: GameState;
  /** Searches are counted per stop and place, as before (state.ts). */
  stopId: string;
  say(text: string, speak?: boolean): void;
  /** A quick fade to dark and back, while you step through a door. */
  fade?(): void;
  /** Lights out at the motel: the moon or sun and Zzz over the screen, then `done`. */
  sleep?(wokeAtNight: boolean, done: () => void): void;
  sfx: { coin(): void; bad(): void; click(): void; shot?(): void };
  changed(): void;
  save(): void;
  /** Back on the highway. */
  done(): void;
  /** Loot just landed in your supplies (the HUD gives them a little bounce). */
  bump?(): void;
  /** The part of the screen the HUD leaves clear, in -1..1 screen units (y up), for framing the camera. */
  clearArea?(): Band | null;
}

/** The walker is drawn this much bigger inside buildings. */
const INSIDE_SCALE = 1.3;

/** Town driving (m/s): cruising speed (about 40 mph), and the most it speeds up to on a long way round (about 100 mph). */
export const TOWN_SPEED = 18;
const TOWN_TOP = 45;
/** Speeding up and slowing down (m/s each second). */
const TOWN_ACCEL = 30;
/** The most sideways pull on a bend (m/s²): the car slows for tight turns to keep under it. */
const TOWN_GRIP = 15;
/** On a long way round, bends are taken faster, up to this (m/s²), to keep inside MOVE_GOAL. */
const TOWN_GRIP_MAX = 40;
/** Backing up: the most speed (m/s). */
const REVERSE_TOP = 12;
/** A drive takes no longer than this (seconds), going faster than TOWN_SPEED when it has to, up to TOWN_TOP. */
const MOVE_GOAL = 2.6;
export const WALK_SPEED = 4.2;
/** The town cyclist's speed (m/s, about 9 mph). */
const CYCLE_SPEED = 4;
export const RUN_SPEED = 7.5;
/** U-turns: the radius (m) and the metres the car takes to drift between a lane and the curb, either side of the turn. */
const U_TURN_RADIUS = 4;
const U_TURN_EASE = 5;
/** How far below the arrival spot the U-turn back into it sits (m; MAIN_STREET_HOME only). */
const U_TURN_BACK = 10;
/** The lanes sit this far either side of the street's middle (m). */
const LANE = 2.2;
/** Backing out of a lot: the radius (m) the tail swings round. */
const BACK_OUT_RADIUS = 4;
/**
 * The Main Street button: false stops in the street right outside the lot (quick; the Main Street
 * camera shows every sign wherever the car is); true drives back to the arrival spot (issue #4).
 */
const MAIN_STREET_HOME = false;
/** Zombies on the street at once (kid mode fewer). */
export const TOWN_ZOMBIES = 7;
export const TOWN_ZOMBIES_KID = 4;
/** A zombie this close grabs you (drops a little loot) or bangs on the car. */
const GRAB = 1.5;
const SHOOT_RANGE = 34;

interface Zombie {
  obj: THREE.Object3D;
  hp: number;
  speed: number;
  phase: number;
  hurt: number;
  cool: number;
  /** Height of what it's standing on (a porch, say). */
  floor?: number;
}

interface CarMove {
  curve: THREE.CatmullRomCurve3;
  len: number;
  /** Metres along the curve so far. */
  s: number;
  reverse: boolean;
  then: () => void;
  /** The planned speed (m/s) at a distance along the curve. */
  speedAt: (s: number) => number;
  /** How long the plan says the move takes (seconds). */
  secs: number;
}

const UP = new THREE.Vector3(0, 1, 0);
/** Towns whose spots are already in world space. */
const placed = new WeakSet<TownWorld>();

export class TownPlay {
  phase: TownPhase = 'arrive';
  /** The lot the car is at (or the walker is in). */
  at: TownSpot | null = null;
  /** The search going on inside, if any. */
  search: Scavenge | null = null;
  /** Filling up: seconds left. */
  filling = 0;
  private walker: THREE.Object3D;
  private walkerRig: Person | null;
  private walk: { pts: THREE.Vector3[]; speed: number; then: () => void } | null = null;
  /** On the way in through a door (walking up, door opening, stepping through). */
  entering: TownSpot | null = null;
  /** A door swinging open or shut (0.35 s). */
  private doorAnim: { sp: TownSpot; t: number; open: boolean; then: () => void } | null = null;
  /** Digging into a box you walked over to: opens it when the time runs out. */
  private dig: { i: number; t: number } | null = null;
  /** Loot icons flying from a box up to your supplies. */
  private fly: { obj: THREE.Sprite; from: THREE.Vector3; t: number }[] = [];
  private move: CarMove | null = null;
  private zombies: Zombie[] = [];
  private fx: { obj: THREE.Object3D; life: number; vy: number }[] = [];
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  /** Which Main Street view: 0 shows every stop, the others are closer looks at part of the street. */
  view = 0;
  private views: { key: string; pos: THREE.Vector3; look: THREE.Vector3 }[] = [];
  private heading = new THREE.Vector3(0, 0, -1);
  private ray = new THREE.Raycaster();
  private time = 0;
  private spawned = 0;
  /** World-space copies of the town's paths. */
  private laneIn: THREE.Vector3[];
  private laneOut: THREE.Vector3[];
  private carYaw = 0;
  /** The in-lane point where the car first stops on Main Street (and comes back to). */
  private home = 0;
  /** The car's speed along its path right now (eases between segments that ask for it). */
  private carSpeed = 0;

  constructor(
    private host: TownHost,
    readonly world: TownWorld,
    private hooks: TownHooks,
  ) {
    world.group.updateMatrixWorld(true);
    const W = (v: THREE.Vector3) => world.group.localToWorld(v.clone());
    this.laneIn = world.laneIn.map(W);
    this.laneOut = world.laneOut.map(W);
    this.laneRunLen = this.laneIn.map(() => 0);
    for (let i = 1; i < this.laneIn.length; i++) this.laneRunLen[i] = this.laneRunLen[i - 1] + this.laneIn[i].distanceTo(this.laneIn[i - 1]);
    // The spots are moved into world space once per town: entering the same town again (a test jump,
    // say) must not move them a second time, or the car drives off into the fields.
    for (const sp of placed.has(world) ? [] : world.spots) {
      sp.park = sp.park.map(W);
      sp.parkDown = sp.parkDown.map(W);
      sp.door = W(sp.door);
      sp.inside = W(sp.inside);
      sp.threshold = W(sp.threshold);
      sp.centre = W(sp.centre);
      if (sp.pump) sp.pump = W(sp.pump);
      sp.facing = sp.facing.clone().transformDirection(world.group.matrixWorld);
    }
    placed.add(world);
    this.walkerRig = person('player_walker');
    // Off the motorcycle you keep its red helmet on, so it's clearly the same rider.
    if (host.car.getObjectByName('rider')) this.walkerRig?.addHelmet();
    this.walker = this.walkerRig?.obj ?? codeWalker();
    this.walker.visible = false;
    host.scene.add(this.walker);
    this.addLocals();
    this.camPos.copy(host.camera.position);
    const look = new THREE.Vector3();
    host.camera.getWorldDirection(look);
    this.camLook.copy(host.camera.position).addScaledVector(look, 20);
    // Roll in from the corner and wait just past it, where every sign is in view.
    const car = host.car.position.clone();
    this.carYaw = yawOf(host.car);
    const wait = this.laneIn.findIndex((p) => p.distanceTo(this.laneIn[0]) > 12);
    this.home = wait;
    this.driveCurve([car, ...this.laneIn.slice(Math.max(1, wait - 1), wait + 1)], false, () => {
      this.phase = 'street';
      hooks.say(hooks.kid ? 'Tap a sign!' : `Welcome to ${world.layout.name}.`); // the hint line says what to tap
      hooks.changed();
    });
    hooks.changed();
  }

  /** Town folk (Medium and High): the hitchhiker thumbing a ride by the way in, and a cyclist going up and down Main Street. */
  private locals: { rig: Person; path: THREE.Vector3[] | null; d: number; speed: number }[] = [];

  private addLocals(): void {
    const h = hashString(this.hooks.stopId);
    // About half the towns have each; a practice town has both so they're easy to check.
    const hitch = testing.on || h % 2 === 0;
    const cyclist = testing.on || Math.floor(h / 2) % 2 === 0;
    // The kerb side of each lane: the lane pushed 1.5 m away from the other lane.
    const kerb = (lane: THREE.Vector3[], other: THREE.Vector3[]) =>
      lane.map((p) => {
        let best = other[0];
        for (const q of other) if (q.distanceToSquared(p) < best.distanceToSquared(p)) best = q;
        const away = p.clone().sub(best).setY(0);
        return away.lengthSq() > 0.01 ? p.clone().addScaledVector(away.normalize(), 1.5) : p.clone();
      });
    if (hitch) {
      const rig = person('hitchhiker');
      const lane = kerb(this.laneIn, this.laneOut);
      const i = Math.min(lane.length - 1, 2);
      if (rig && lane.length > 1) {
        // On the sidewalk by the way in, facing the cars coming up the street.
        const at = lane[i].clone();
        const next = lane[Math.min(lane.length - 1, i + 1)];
        const side = at.clone().sub(this.laneIn[i]).setY(0).normalize();
        rig.obj.position.copy(at).addScaledVector(side, 2.2).setY(0);
        const look = this.laneIn[0].clone().sub(next).setY(0);
        rig.obj.rotation.y = Math.atan2(look.x, look.z) + 0.5 * Math.sign(side.x * look.z - side.z * look.x || 1);
        rig.play('thumb');
        this.host.scene.add(rig.obj);
        this.locals.push({ rig, path: null, d: 0, speed: 0 });
      }
    }
    if (cyclist) {
      const rig = person('cyclist');
      const up = kerb(this.laneIn, this.laneOut);
      const down = kerb(this.laneOut, this.laneIn);
      // Up the street by the kerb, and back down the other side.
      const loop = [...up, ...down.slice().reverse().filter((p) => p.distanceTo(up[up.length - 1]) > 1)];
      if (rig && loop.length > 3) {
        rig.play('pedal', 0.8);
        this.host.scene.add(rig.obj);
        this.locals.push({ rig, path: loop, d: (h % 97) / 97, speed: CYCLE_SPEED });
      }
    }
  }

  private updateLocals(dt: number): void {
    for (const l of this.locals) {
      l.rig.update(dt);
      if (!l.path) continue;
      const pts = l.path;
      // Total length once (kept on the array).
      let len = (pts as unknown as { len?: number }).len;
      if (!len) {
        len = 0;
        for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
        len += pts[0].distanceTo(pts[pts.length - 1]);
        (pts as unknown as { len?: number }).len = len;
      }
      l.d = (l.d + (l.speed * dt) / len) % 1;
      let left = l.d * len;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const seg = a.distanceTo(b);
        if (left <= seg || i === pts.length - 1) {
          const t = seg > 0 ? Math.min(1, left / seg) : 0;
          l.rig.obj.position.lerpVectors(a, b, t).setY(0);
          const yaw = Math.atan2(b.x - a.x, b.z - a.z);
          // Ease the turn at the ends.
          let dy = yaw - l.rig.obj.rotation.y;
          dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          l.rig.obj.rotation.y += dy * Math.min(1, dt * 4);
          break;
        }
        left -= seg;
      }
    }
  }

  // ---------------------------------------------------------------- what the HUD asks

  /** The car or the walker is on the move (a tap on a sign waits till it stops). */
  /** Where close-up shadows centre (you, on foot or inside); null while driving around town. */
  get shadowFocus(): THREE.Vector3 | null {
    return this.walker.visible ? this.walker.position : null;
  }

  get busy(): boolean {
    return !!this.move || !!this.walk || !!this.dig || !!this.doorAnim || !!this.entering || this.resting;
  }

  /** Asleep at the motel (the Zzz picture is up). */
  resting = false;

  /** In the motel room and awake. */
  canRest(): boolean {
    return this.phase === 'inside' && this.at?.lot.place === 'motel' && !this.resting && !this.walk && !this.dig;
  }

  /** Rest at the motel: day turns to night (or night to day), the car gets a little fixing, and now and then zombies wait outside. */
  rest(): void {
    if (!this.canRest()) return;
    const s = this.hooks.state;
    const kid = this.hooks.kid;
    const r = restAtMotel(s, hourOf(s), Math.random());
    if (!r.ok) {
      this.hooks.sfx.bad();
      this.hooks.say(kid ? 'No money!' : r.message);
      return;
    }
    this.resting = true;
    this.hooks.changed();
    const wake = () => {
      this.resting = false;
      const sp = this.at;
      if (sp) this.roomLight(sp);
      this.hooks.save();
      if (r.ambush && sp) {
        this.hooks.sfx.bad();
        this.hooks.say(kid ? 'Zombies! Run to the car!' : r.message);
        // Waiting by the door: fewer and slower for the kid.
        const n = kid ? 1 : 2 + Math.min(2, Math.floor(s.threat ?? 0));
        for (let k = 0; k < n; k++) this.spawn(sp.door.clone().addScaledVector(sp.facing, 3 + k * 1.2).add(new THREE.Vector3((k - n / 2) * 1.4, 0, 0)), true);
      } else {
        this.hooks.say(kid ? (r.wokeAtNight ? 'Night time!' : 'Good morning!') : r.message);
      }
      this.hooks.changed();
    };
    if (this.hooks.sleep) this.hooks.sleep(r.wokeAtNight, wake);
    else wake();
  }

  /** The room's ceiling light matters at night; by day (roof off, in the sun) it would wash the room out. */
  private roomLight(sp: TownSpot): void {
    const lamp = sp.room.getObjectByName('roomLight') as THREE.PointLight | undefined;
    if (lamp) lamp.intensity = lamp.userData.full * (1 - 0.8 * daylight(hourOf(this.hooks.state)));
  }

  /** Zombies awake within `r` of you (or the car, or the door you went in). */
  nearZombies(r = 14): number {
    const from = this.focusPoint();
    return this.zombies.filter((z) => z.obj.position.distanceTo(from) < r).length;
  }

  get noise(): number {
    return this.search ? scavengeNoise(this.search) : 0;
  }

  /** Crates left to open in the building you're in. */
  cratesLeft(): number {
    if (!this.search) return 0;
    return this.search.opened.filter((o) => !o).length * (this.search.over ? 0 : 1);
  }

  /** How many Main Street views there are (the first always shows every stop). */
  get viewCount(): number {
    const n = this.world.spots.length;
    return n > 3 ? 3 : 1;
  }

  /** Main Street: switch to the next view. */
  nextView(): void {
    this.view = (this.view + 1) % this.viewCount;
    this.hooks.changed();
  }

  // ---------------------------------------------------------------- taps

  /** A tap or hold on the 3D view at normalised device coordinates. */
  tap(ndc: { x: number; y: number }): boolean {
    this.ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.host.camera);
    if (this.phase !== 'inside') {
      const z = this.pickZombie();
      if (z) {
        this.shoot(z);
        return true;
      }
    }
    if (this.phase === 'inside' && this.at) {
      const hits = this.search ? this.ray.intersectObjects(this.at.crates, true) : [];
      if (hits.length) {
        const i = this.at.crates.findIndex((c) => isChild(hits[0].object, c));
        if (i >= 0) this.tapCrate(i);
        return true;
      }
      if (this.at.lot.place === 'motel' && this.ray.intersectObjects(beds(this.at.room), false).length) {
        this.rest();
        return true;
      }
      return false;
    }
    if (this.phase === 'walking') {
      if (this.ray.intersectObject(this.host.car, true).length) {
        this.backToCar(this.nearZombies() > 0);
        return true;
      }
    }
    const spots = this.world.spots;
    const hit = this.ray.intersectObjects(spots.map((s) => s.group), true)[0];
    const sp = hit && spots.find((s) => isChild(hit.object, s.group));
    if (sp) {
      if (this.phase === 'street' || (this.phase === 'parked' && this.at !== sp)) this.driveTo(sp);
      else if (this.phase === 'parked' && this.at === sp) this.getOut();
      else if (this.phase === 'walking') {
        if (sp.pump && sp === this.at && hit.point.distanceTo(sp.pump) < 5 && this.canFill()) this.fillUp();
        else this.goIn(sp);
      }
      return true;
    }
    if (this.phase === 'walking') {
      const g = this.ray.ray.intersectPlane(new THREE.Plane(UP, -this.walker.position.y), new THREE.Vector3());
      if (g && g.distanceTo(this.walker.position) < 60) {
        this.walkTo([g], WALK_SPEED, () => {});
        return true;
      }
    }
    return false;
  }

  /** The zombie under the tap, a little forgiving for small fingers. */
  private pickZombie(): Zombie | null {
    const hits = this.ray.intersectObjects(this.zombies.map((z) => z.obj), true);
    if (hits.length) return this.zombies.find((z) => isChild(hits[0].object, z.obj)) ?? null;
    let best: Zombie | null = null;
    let bestD = 1.6;
    for (const z of this.zombies) {
      const c = z.obj.position.clone().setY(z.obj.position.y + 1.2);
      const d = this.ray.ray.distanceToPoint(c);
      if (d < bestD) {
        bestD = d;
        best = z;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- actions

  canFill(): boolean {
    const s = this.hooks.state;
    return s.inv.fuel < tankSize(s) - 0.5;
  }

  /** At the pumps: get out (if you aren't), walk to the pump and fill up. */
  fillUp(): void {
    const sp = this.at;
    if (!sp?.pump || this.filling > 0) return;
    if (this.phase === 'parked') this.getOut();
    this.walkTo([sp.pump], WALK_SPEED, () => {
      const r = buyFuel(this.hooks.state);
      if (!r.ok) {
        this.hooks.say(this.hooks.kid ? 'No money for gas!' : r.message);
        return;
      }
      this.filling = 2.4;
      this.hooks.sfx.coin();
      this.hooks.say(this.hooks.kid ? 'Glug glug glug!' : r.message);
      this.hooks.save();
      this.hooks.changed();
    });
  }

  /** At the garage: the mechanic fixes the car. */
  fix(): void {
    const r = repair(this.hooks.state);
    if (r.ok) this.hooks.sfx.coin();
    this.hooks.say(this.hooks.kid ? (r.ok ? 'All fixed!' : 'No money to fix it!') : r.message);
    this.hooks.save();
    this.hooks.changed();
  }

  getOut(): void {
    if (this.phase !== 'parked') return;
    const left = new THREE.Vector3(Math.cos(this.carYaw), 0, -Math.sin(this.carYaw));
    this.walker.position.copy(this.host.car.position).addScaledVector(left, 1.9).setY(this.host.car.position.y);
    // Face the place you parked at, so the camera (behind you) shows it, not the highway.
    const sp = this.at;
    const toward = sp ? sp.door.clone().sub(this.walker.position).setY(0) : new THREE.Vector3();
    if (toward.lengthSq() > 0.01) this.heading.copy(toward.normalize());
    else this.heading.set(Math.sin(this.carYaw), 0, Math.cos(this.carYaw));
    this.walker.rotation.y = Math.atan2(this.heading.x, this.heading.z);
    this.walker.visible = true;
    this.phase = 'walking';
    this.hooks.sfx.click();
    this.hooks.changed();
  }

  backToCar(run = false): void {
    if (this.phase === 'inside') {
      this.leaveBuilding(run, () => this.backToCar(run));
      return;
    }
    if (this.phase !== 'walking' || this.entering) return;
    const left = new THREE.Vector3(Math.cos(this.carYaw), 0, -Math.sin(this.carYaw));
    this.walkTo([this.host.car.position.clone().addScaledVector(left, 1.9)], run ? RUN_SPEED : WALK_SPEED, () => {
      this.walker.visible = false;
      this.phase = 'parked';
      this.hooks.sfx.click();
      this.hooks.changed();
    });
  }

  goIn(sp: TownSpot): void {
    if (this.phase !== 'walking' || this.entering) return;
    // Up to the building's own door, it swings open, step through, and you're inside.
    this.entering = sp;
    this.hooks.changed();
    this.walkTo([sp.door], WALK_SPEED, () => {
      this.swingDoor(sp, true, () =>
        this.walkTo([sp.threshold], WALK_SPEED, () => {
          this.hooks.fade?.();
          this.walkTo([sp.inside], WALK_SPEED, () => this.enterRoom(sp));
        }),
      );
    });
  }

  /** Swings a building's door open or shut, then carries on. */
  private swingDoor(sp: TownSpot, open: boolean, then: () => void): void {
    sp.doorway.visible = true;
    this.doorAnim = { sp, t: 0, open, then };
    if (open) this.hooks.sfx.click();
  }

  private updateDoor(dt: number): void {
    const a = this.doorAnim;
    if (!a) return;
    a.t = Math.min(1, a.t + dt / 0.35);
    const k = a.open ? a.t : 1 - a.t;
    const panel = a.sp.doorway.getObjectByName('doorPanel');
    if (panel) panel.rotation.y = -1.75 * (1 - (1 - k) * (1 - k));
    if (a.t < 1) return;
    this.doorAnim = null;
    if (!a.open) a.sp.doorway.visible = false;
    a.then();
  }

  private enterRoom(sp: TownSpot): void {
    {
      this.entering = null;
      sp.doorway.visible = false;
      this.at = sp;
      this.phase = 'inside';
      sp.shell.visible = false;
      sp.room.visible = true;
      // Inside, the walker is drawn a bit bigger so a small screen still shows who you are, and the
      // parked car (out front, under the buttons) steps out of the picture.
      this.walker.scale.setScalar(INSIDE_SCALE);
      this.host.car.visible = false;
      // The gas canopy would hide the dollhouse from above.
      showRoofs(sp, false);
      this.roomLight(sp);
      this.search = startScavenge(this.hooks.state, this.storeKey(), sp.lot.place, sp.crates.length);
      for (const c of sp.crates) resetCrate(c);
      this.hooks.save();
      this.hooks.say(this.hooks.kid ? 'Tap the boxes!' : `Inside the ${placeName(sp)}. Quiet now...`);
      this.hooks.changed();
    }
  }

  /** Out of the building to just outside the door. */
  leaveBuilding(run = false, then: () => void = () => {}): void {
    if (this.phase !== 'inside' || !this.at) return;
    const sp = this.at;
    this.dig = null;
    this.walker.scale.setScalar(1);
    this.host.car.visible = true;
    sp.shell.visible = true;
    sp.room.visible = false;
    showRoofs(sp, true);
    this.search = null;
    this.phase = 'walking';
    // Out through the open door facing the street (so the camera sees what's coming); it shuts behind you.
    this.hooks.fade?.();
    this.walker.position.copy(sp.threshold).setY(this.walker.position.y);
    this.heading.copy(sp.facing).setY(0).normalize();
    sp.doorway.visible = true;
    const panel = sp.doorway.getObjectByName('doorPanel');
    if (panel) panel.rotation.y = -1.75;
    this.hooks.changed();
    const speed = run ? RUN_SPEED : WALK_SPEED;
    this.walkTo([sp.door], speed, () => {
      this.swingDoor(sp, false, () => {});
      this.walkTo([sp.door.clone().addScaledVector(sp.facing, 1.5)], speed, then);
    });
  }

  private nearestZombie(p: THREE.Vector3, r: number): Zombie | null {
    let best: Zombie | null = null;
    let bestD = r;
    for (const z of this.zombies) {
      const d = z.obj.position.distanceTo(p);
      if (d < bestD) {
        bestD = d;
        best = z;
      }
    }
    return best;
  }

  private frame = 0;
  private down = new THREE.Raycaster();

  /**
   * The height to stand at here: the top of a building's floor, porch or step under this spot if
   * there is one within knee height, else the ground (the car's level).
   */
  private groundAt(p: THREE.Vector3): number {
    const base = this.host.car.position.y;
    const sp = this.phase === 'inside' && this.at ? this.at : this.nearestSpot(p);
    if (!sp) return base;
    const target = this.phase === 'inside' && this.at === sp ? sp.room : sp.shell;
    // Only worth a look close to the building.
    if (p.distanceTo(sp.centre) > Math.max(sp.size.x, sp.size.z) * 0.75 + 3) return base;
    this.down.set(new THREE.Vector3(p.x, base + 1.0, p.z), new THREE.Vector3(0, -1, 0));
    this.down.far = 1.4;
    for (const h of this.down.intersectObject(target, true)) {
      if (inCrate(h.object, target)) continue;
      if (h.face && h.face.normal.clone().transformDirection(h.object.matrixWorld).y < 0.6) continue;
      return Math.max(base, h.point.y);
    }
    return base;
  }

  private nearestSpot(p: THREE.Vector3): TownSpot | null {
    let best: TownSpot | null = null;
    let bestD = Infinity;
    for (const sp of this.world.spots) {
      const d = sp.centre.distanceToSquared(p);
      if (d < bestD) {
        bestD = d;
        best = sp;
      }
    }
    return best;
  }

  /** A tap on a box: walk over to it, dig in, and open it. */
  tapCrate(i: number): void {
    const sp = this.at;
    const sc = this.search;
    if (!sp || !sc || sc.opened[i] || sc.over || this.walk || this.dig) return;
    const c = sp.crates[i];
    const at = c.getWorldPosition(new THREE.Vector3());
    // Stand on the room side of it, facing it.
    const toward = sp.centre.clone().sub(at).setY(0);
    const stand = toward.lengthSq() > 0.01 ? at.clone().addScaledVector(toward.normalize(), 1.4) : at.clone();
    this.walkTo([stand], WALK_SPEED * 1.5, () => {
      const look = at.clone().sub(this.walker.position).setY(0);
      if (look.lengthSq() > 0.001) this.walker.rotation.y = Math.atan2(look.x, look.z);
      this.dig = { i, t: 0.45 };
    });
  }

  private openCrate(i: number): void {
    const sp = this.at!;
    const sc = this.search!;
    if (sc.opened[i] || sc.over) return;
    const r = openCrate(this.hooks.state, sc, i);
    const c = sp.crates[i];
    emptied(c, true);
    const p = c.getWorldPosition(new THREE.Vector3()).setY(c.getWorldPosition(new THREE.Vector3()).y + 2);
    if (r.ambush) {
      this.hooks.sfx.bad();
      this.hooks.say(this.hooks.kid ? 'Zombies! Run to the car!' : "They heard you. Zombies at the door! Run for the car!");
      // The ambush: a crowd comes through the door.
      const n = this.hooks.kid ? 2 : 3 + Math.min(3, Math.floor(this.hooks.state.threat ?? 0));
      for (let k = 0; k < n; k++) this.spawn(sp.door.clone().addScaledVector(sp.facing, 4 + k * 1.4).add(new THREE.Vector3((k - n / 2) * 1.3, 0, 0)), true);
    } else {
      this.hooks.sfx.coin();
      const words: string[] = [];
      let n = 0;
      for (const [k, v] of Object.entries(r.loot) as [keyof Inventory, number][]) {
        this.flyIcon(LOOT_ICONS[k], p, n++);
        words.push(`${v} ${k === 'cash' ? 'dollars' : k}`);
      }
      if (!words.length) this.popIcon('💨', p);
      this.hooks.say(words.length ? (this.hooks.kid ? `${LOOT_ICONS[(Object.keys(r.loot)[0] as keyof Inventory)]}!` : `Found ${words.join(', ')}.`) : this.hooks.kid ? 'Empty!' : 'Empty.', false);
      // The noise draws zombies down the street, more the louder it gets.
      const want = Math.floor(scavengeNoise(sc) * 4);
      while (this.spawned < want) this.spawnStreet();
    }
    this.hooks.save();
    this.hooks.changed();
  }

  /**
   * Pull into a lot, by the most direct way that stays on the road: out of the lot you're in
   * (backing out with the nose already pointing the way you're going), along the lane for that
   * direction, and straight in. Lots up the street are come at from below, lots down the street
   * from above (their mirror-image way in), so the car never drives past and turns round.
   */
  driveTo(sp: TownSpot): void {
    if (this.move) return;
    const car = this.host.car.position.clone();
    const a0 = this.alongOf(car);
    const stall = sp.park[sp.park.length - 1];
    // Up the street unless the lot is clearly behind you (a lot across the street counts as up).
    const dir: 1 | -1 = this.alongOf(stall) >= a0 - 6 || this.phase !== 'parked' ? 1 : -1;
    this.exitLot(dir, (lead) => {
      const from = lead[lead.length - 1];
      const aFrom = this.alongOf(from);
      // The way in for this direction, starting with the first point still ahead of you.
      const entry = (dir === 1 ? sp.park : sp.parkDown).slice();
      while (entry.length > 2 && (this.alongOf(entry[0]) - aFrom) * dir < 4) entry.shift();
      const lane = dir === 1 ? this.laneIn : this.laneOut;
      const mid = this.laneRun(lane, aFrom + dir * 8, this.alongOf(entry[0]) - dir * 6, dir);
      this.at = null;
      this.phase = 'driving';
      this.hooks.changed();
      this.driveCurve(dedupe([...lead, ...mid, ...entry]), false, () => {
        this.at = sp;
        this.phase = 'parked';
        this.hooks.say(this.hooks.kid ? `${placeWord(sp)}!` : `You pull into ${sp.lot.name ?? `the ${placeName(sp)}`}.`);
        this.hooks.changed();
      });
    });
  }

  /**
   * Back on Main Street from a lot. Pulls out into the in lane, nose up the street (at the pumps,
   * whichever way the car already faces), and stops right there: the Main Street camera is a fixed view of every sign, so it looks the same wherever the
   * car waits. (With MAIN_STREET_HOME it drives back down to the arrival spot and U-turns into it.)
   */
  toStreet(): void {
    if (this.move || this.phase !== 'parked') return;
    const back = () => {
      this.phase = 'street';
      this.view = 0;
      this.hooks.say(this.hooks.kid ? 'Tap a sign!' : 'Back on Main Street.', false);
      this.hooks.changed();
    };
    if (MAIN_STREET_HOME) {
      this.exitLot(-1, (lead) => {
        this.at = null;
        this.phase = 'driving';
        this.hooks.changed();
        this.driveHome(lead, back);
      });
      return;
    }
    // At the pumps, out the way the car is already facing (no loop under the canopy); from a building, up the street.
    const car = this.host.car.position;
    const fwd = new THREE.Vector3(Math.sin(this.carYaw), 0, Math.cos(this.carYaw));
    const dir: 1 | -1 = this.at?.pump && fwd.dot(this.upAt(this.alongOf(car))) < 0 ? -1 : 1;
    this.exitLot(dir, (lead) => {
      this.at = null;
      this.phase = 'driving';
      this.hooks.changed();
      const from = lead[lead.length - 1];
      const a = this.alongOf(from);
      // A few metres on along the lane, so the car ends square to it.
      const stop = this.laneRun(dir === 1 ? this.laneIn : this.laneOut, a + dir * 8, a + dir * 18, dir);
      if (!stop.length) stop.push(from.clone().addScaledVector(this.upAt(a), 6 * dir));
      this.driveCurve(dedupe([...lead, ...stop.slice(-2)]), false, back);
    });
  }

  /** Down the out lane from the end of `lead`, a U-turn just short of the arrival spot, and up into it. */
  private driveHome(lead: THREE.Vector3[], then: () => void): void {
    const { home, up, n, centre } = this.homeFrame();
    const from = lead[lead.length - 1];
    const u = this.uTurn(home, up, n, centre);
    const down = this.laneRun(this.laneOut, this.alongOf(from) - 8, this.alongOf(u[0]) + 6, -1);
    // Close-set U-turn points on purpose: dedupe only the run down the street, or the turn loses its shape.
    this.driveCurve([...dedupe([...lead, ...down]), ...u.filter((p, i) => i > 0 || p.distanceTo(down[down.length - 1] ?? from) > 1.2)], false, then);
  }

  /**
   * The arrival spot and the street around it: `home` in the in lane, `up` the way up the street,
   * `n` across from the out lane to the in lane, `centre` the street's middle beside home.
   */
  private homeFrame(): { home: THREE.Vector3; up: THREE.Vector3; n: THREE.Vector3; centre: THREE.Vector3 } {
    const h = this.home;
    const lane = this.laneIn;
    const home = lane[h].clone();
    const up = lane[Math.min(lane.length - 1, h + 1)].clone().sub(lane[Math.max(0, h - 1)]).setY(0).normalize();
    const centre = home.clone().lerp(this.laneOut[h], 0.5);
    const n = home.clone().sub(this.laneOut[h]).setY(0).normalize();
    return { home, up, n, centre };
  }

  /**
   * The U-turn back into the arrival spot, as close-set points (so the curve through them keeps its
   * shape): ease out from the out lane to the curb, round a half circle across the street, ease back
   * into the in lane, and straight on up to `home`. Its far side sits a little short of where the street starts.
   */
  private uTurn(home: THREE.Vector3, up: THREE.Vector3, n: THREE.Vector3, centre: THREE.Vector3): THREE.Vector3[] {
    const R = U_TURN_RADIUS;
    const lane = home.distanceTo(centre);
    // How far below the stop the turn sits: room to straighten out after it, but never past the corner.
    const room = centre.distanceTo(this.laneIn[0].clone().lerp(this.laneOut[0], 0.5));
    const back = Math.max(R + 1, Math.min(U_TURN_BACK, room - R - 1));
    const ease = Math.min(U_TURN_EASE, back - 1);
    const at = (along: number, across: number) => centre.clone().addScaledVector(up, along).addScaledVector(n, across);
    const pts = this.uTurnPts(at, -back, -1, lane, R, ease);
    pts.push(home.clone());
    return pts;
  }

  /**
   * A U-turn in the street as close-set points, in a frame `at(along, across)` whose across is
   * positive on the in lane's side: from the lane on side `-dir` at along `a + dir * ease`, easing out
   * to the curb, round a half circle of radius R whose middle is at along `a`, and easing back into
   * the lane on the other side. `dir` 1 turns from the in lane (heading up) into the out lane; -1 the other way.
   */
  private uTurnPts(at: (along: number, across: number) => THREE.Vector3, a: number, dir: 1 | -1, lane: number, R: number, ease: number): THREE.Vector3[] {
    const blend = (x: number, y: number, k: number) => x + ((y - x) * (1 - Math.cos(Math.PI * k))) / 2;
    const pts: THREE.Vector3[] = [];
    const step = 0.8;
    const s = dir; // the side you start on: +1 the in lane
    // Lane to the curb, flat at both ends so it meets the lane and the circle without a kink.
    for (let d = 0; d < ease; d += step) pts.push(at(a - dir * (ease - d), s * blend(lane, R, d / ease)));
    const arcSteps = Math.ceil((Math.PI * R) / step);
    for (let i = 0; i <= arcSteps; i++) {
      const t = (Math.PI * i) / arcSteps;
      pts.push(at(a + dir * R * Math.sin(t), s * R * Math.cos(t)));
    }
    for (let d = step; d <= ease; d += step) pts.push(at(a - dir * d, -s * blend(R, lane, d / ease)));
    return pts;
  }

  /**
   * Out of the lot, pointing the way you're going next (`dir` 1 up the street, -1 down it), and hands
   * `then` the forward path so far (it starts where the car is once any backing out is done; the
   * rest of the trip is added to it as one smooth drive). Parked at a building you back straight out
   * toward the street, the tail swinging the other way, into the lane for that direction. At the
   * pumps you drive straight on out, or loop round under the canopy if you're facing the wrong way.
   * On the street nothing happens, unless you're facing the wrong way: then a U-turn where you are.
   */
  private exitLot(dir: 1 | -1, then: (lead: THREE.Vector3[]) => void): void {
    const sp = this.at;
    const p = this.host.car.position.clone();
    const fwd = new THREE.Vector3(Math.sin(this.carYaw), 0, Math.cos(this.carYaw));
    const a = this.alongOf(p);
    const up = this.upAt(a);
    const u = up.clone().multiplyScalar(dir);
    if (this.phase !== 'parked' || !sp) {
      if (fwd.dot(u) >= 0) then([p]);
      else {
        // Facing the wrong way on the street: turn round right here, in the middle of the road.
        const c = this.streetFrame(a);
        const turn = -dir as 1 | -1;
        then([p, ...this.uTurnPts(c.at, a + turn * U_TURN_EASE, turn, LANE, U_TURN_RADIUS, U_TURN_EASE)]);
      }
      return;
    }
    const lane = dir === 1 ? this.laneIn : this.laneOut;
    const toStreet = sp.facing.clone().setY(0).normalize();
    // How far it is, toward the street, to the lane you want.
    const w = this.laneRun(lane, a - 6, a + 6)[0]?.clone().sub(p).setY(0).dot(toStreet) ?? 8;
    if (sp.pump) {
      if (fwd.dot(u) > 0) {
        // Facing the right way: straight on out from under the canopy.
        then([p, p.clone().addScaledVector(fwd, 5)]);
        return;
      }
      // Facing the wrong way: forward a little, then a wide loop toward the street that ends heading the other way.
      const R = Math.max(3, w / 2);
      const start = p.clone().addScaledVector(fwd, 2);
      const c = start.clone().addScaledVector(toStreet, R);
      const pts = [p];
      for (const deg of [0, 45, 90, 135, 180]) {
        const t = (deg * Math.PI) / 180;
        pts.push(c.clone().addScaledVector(toStreet, -R * Math.cos(t)).addScaledVector(fwd, R * Math.sin(t)));
      }
      then(pts);
      return;
    }
    // Back out of the stall, the tail swinging the other way so the nose points along `u`, then
    // drive on out across the lot: a short reverse, and the rest goes at driving speed.
    const R = BACK_OUT_RADIUS;
    const s = p.clone().addScaledVector(toStreet, 1.2);
    const c = s.clone().addScaledVector(u, -R);
    const pts = [p];
    for (const deg of [0, 30, 60, 90]) {
      const t = (deg * Math.PI) / 180;
      pts.push(c.clone().addScaledVector(u, R * Math.cos(t)).addScaledVector(toStreet, R * Math.sin(t)));
    }
    const end = pts[pts.length - 1].clone();
    this.driveCurve(dedupe(pts), true, () => then([end, end.clone().addScaledVector(u, 3).addScaledVector(toStreet, 1)]));
  }

  /** Back on the highway: out of the lot, down Main Street (turning round first if you're facing up it), and onto the road. */
  leave(): void {
    if (this.move) return;
    if (this.phase === 'walking' || this.phase === 'inside') {
      this.backToCar(this.nearZombies() > 0);
      return;
    }
    this.exitLot(-1, (lead) => {
      const from = lead[lead.length - 1];
      const e = this.host.exit;
      const exitIn = e.pos.clone().addScaledVector(e.fwd, -10);
      const down = this.laneRun(this.laneOut, this.alongOf(from) - 8, -Infinity, -1).filter((q) => q.distanceTo(exitIn) > 8);
      this.phase = 'leaving';
      this.at = null;
      this.hooks.changed();
      // Rolls out onto the highway still moving, at town speed.
      this.driveCurve([...lead, ...dedupe([...down, exitIn, e.pos.clone(), e.pos.clone().addScaledVector(e.fwd, 4)])], false, () => {
        this.phase = 'done';
        this.hooks.done();
      }, TOWN_SPEED);
    });
  }

  // ---------------------------------------------------------------- the street's frame

  /** How far up Main Street a point is (metres along the in lane, from the highway end). */
  private alongOf(p: THREE.Vector3): number {
    const lane = this.laneIn;
    const run = this.laneRunLen;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i + 1 < lane.length; i++) {
      const a = lane[i];
      const ab = lane[i + 1].clone().sub(a).setY(0);
      const l2 = ab.lengthSq() || 1;
      const k = Math.max(0, Math.min(1, p.clone().sub(a).setY(0).dot(ab) / l2));
      const d = a.clone().addScaledVector(ab, k).setY(p.y).distanceToSquared(p);
      if (d < bestD) {
        bestD = d;
        best = run[i] + k * Math.sqrt(l2);
      }
    }
    // Past either end the street carries on straight.
    const first = lane[1].clone().sub(lane[0]).setY(0).normalize();
    const before = p.clone().sub(lane[0]).setY(0).dot(first);
    if (before < 0) return before;
    const n = lane.length - 1;
    const last = lane[n].clone().sub(lane[n - 1]).setY(0).normalize();
    const after = p.clone().sub(lane[n]).setY(0).dot(last);
    return after > 0 ? run[n] + after : best;
  }

  /** The way up the street at a distance along it. */
  private upAt(a: number): THREE.Vector3 {
    const lane = this.laneIn;
    const i = Math.max(1, Math.min(lane.length - 1, this.laneRunLen.findIndex((r) => r >= a)));
    return lane[i].clone().sub(lane[i - 1]).setY(0).normalize();
  }

  /** The street around a distance along it: `at(along, across)`, across positive on the in lane's side. */
  private streetFrame(a: number): { at: (along: number, across: number) => THREE.Vector3 } {
    const up = this.upAt(a);
    const i = Math.max(0, Math.min(this.laneIn.length - 1, this.laneRunLen.findIndex((r) => r >= a)));
    const mid = this.laneIn[i].clone().lerp(this.laneOut[i], 0.5);
    const n = this.laneIn[i].clone().sub(this.laneOut[i]).setY(0).normalize();
    const a0 = this.laneRunLen[i];
    return { at: (along, across) => mid.clone().addScaledVector(up, along - a0).addScaledVector(n, across) };
  }

  /**
   * A lane's points strictly between two distances along the street, in the order you'd drive them
   * going `dir` (1 up the street, -1 down it); none if `to` isn't on that side of `from`.
   */
  private laneRun(lane: THREE.Vector3[], from: number, to: number, dir: 1 | -1 = to >= from ? 1 : -1): THREE.Vector3[] {
    if ((to - from) * dir <= 0) return [];
    const run = this.laneRunLen;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const pts = lane.filter((_, i) => run[i] > lo && run[i] < hi);
    return to >= from ? pts : pts.reverse();
  }

  /** Distance along the in lane at each of its points (the out lane's points sit beside them). */
  private laneRunLen: number[] = [];

  // ---------------------------------------------------------------- frame

  update(dt: number): void {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.updateDoor(dt);
    const car = this.host.car;
    if (this.move) {
      const m = this.move;
      const speed = (this.carSpeed = m.speedAt(m.s));
      // Never quite stalls at the start or end of a move, where the plan is at a standstill.
      m.s = Math.min(m.len, m.s + dt * Math.max(speed, 1.5));
      const t = m.s / m.len;
      const p = m.curve.getPointAt(t);
      const tan = m.curve.getTangentAt(t);
      car.position.copy(p);
      this.carYaw = Math.atan2(tan.x, tan.z) + (m.reverse ? Math.PI : 0);
      for (const c of car.children) if (c.name === 'wheel') c.rotation.x += (dt * speed) / 0.42;
      // Zombies in the road get knocked flying, like on the highway.
      for (const z of [...this.zombies]) if (z.obj.position.distanceTo(p) < 2.4) this.pop(z, true);
      if (m.s >= m.len) {
        this.move = null;
        m.then();
      }
    }
    car.rotation.set(0, this.carYaw, 0);
    // The walker.
    if (this.walk) {
      const w = this.walk;
      const target = w.pts[0];
      const d = target.clone().sub(this.walker.position).setY(0);
      const step = w.speed * dt;
      if (d.length() <= step) {
        this.walker.position.set(target.x, this.walker.position.y, target.z);
        w.pts.shift();
        if (!w.pts.length) {
          this.walk = null;
          w.then();
        }
      } else {
        this.walker.position.addScaledVector(d.normalize(), step);
        this.walker.rotation.y = Math.atan2(d.x, d.z);
        this.heading.lerp(d, Math.min(1, dt * 2.2)).normalize();
      }
    }
    if (this.walkerRig) {
      this.walkerRig.play(this.walk ? (this.walk.speed > WALK_SPEED ? 'run' : 'walk') : 'idle', this.walk ? this.walk.speed / (this.walk.speed > WALK_SPEED ? RUN_SPEED : WALK_SPEED) : 1);
      this.walkerRig.update(dt);
    } else if (this.walk) {
      const sw = Math.sin(this.time * 12) * 0.5;
      const l = this.walker.getObjectByName('legL');
      const r = this.walker.getObjectByName('legR');
      if (l && r) {
        l.rotation.x = sw;
        r.rotation.x = -sw;
      }
    }
    if (this.filling > 0) {
      this.filling -= dt;
      if (this.filling <= 0) {
        this.hooks.say(this.hooks.kid ? 'Full tank!' : 'Tank filled.', false);
        this.hooks.changed();
      }
    }
    if (this.dig) {
      this.dig.t -= dt;
      // Bend down and dig in.
      const k = Math.sin(Math.max(0, this.dig.t) * 20) * 0.06;
      this.walker.scale.set(INSIDE_SCALE, INSIDE_SCALE * (0.9 + k), INSIDE_SCALE);
      if (this.dig.t <= 0) {
        const i = this.dig.i;
        this.dig = null;
        this.walker.scale.setScalar(INSIDE_SCALE);
        if (this.phase === 'inside') this.openCrate(i);
      }
    }
    this.frame++;
    // Stand on whatever is underfoot (a porch, a deck, the room's floor), never sunk into it.
    if (this.walker.visible) {
      const y = this.groundAt(this.walker.position);
      // Step up onto it rather than pop.
      this.walker.position.y += (y - this.walker.position.y) * Math.min(1, dt * 14);
    }
    // A motorcycle stands empty while you're off it.
    const rider = this.host.car.getObjectByName('rider');
    if (rider) rider.visible = !this.walker.visible;
    this.updateCrates(dt);
    this.updateFly(dt);
    this.updateZombies(dt);
    this.updateLocals(dt);
    this.fx = this.fx.filter((f) => {
      f.life -= dt;
      f.obj.position.y += f.vy * dt;
      if (f.life <= 0) {
        this.host.scene.remove(f.obj);
        disposeSprite(f.obj);
      }
      return f.life > 0;
    });
    this.updateCamera(dt);
  }

  private focusPoint(): THREE.Vector3 {
    if (this.phase === 'walking') return this.walker.position;
    if (this.phase === 'inside' && this.at) return this.at.door;
    return this.host.car.position;
  }

  private updateZombies(dt: number): void {
    const target = this.focusPoint();
    this.zombies.forEach((z, i) => {
      z.phase += dt;
      const to = target.clone().sub(z.obj.position).setY(0);
      const dist = to.length();
      // Inside, they crowd round the door; outside they come for you (or the car).
      const stopAt = this.phase === 'inside' ? 1 + (i % 4) * 0.9 : GRAB * 0.8;
      if (dist > stopAt) z.obj.position.addScaledVector(to.normalize(), z.speed * dt);
      z.obj.rotation.set(0, Math.atan2(to.x, to.z), Math.sin(z.phase * 4) * 0.1);
      // On a porch or a deck they walk up it, not through it (checked every few frames, it costs a little).
      if ((this.frame + i) % 4 === 0) z.floor = this.groundAt(z.obj.position);
      z.obj.position.y = (z.hurt > 0 ? z.hurt * 2.4 : Math.abs(Math.sin(z.phase * 4)) * 0.1) + (z.floor ?? 0);
      z.hurt = Math.max(0, z.hurt - dt);
      z.cool -= dt;
      if (dist < GRAB && z.cool <= 0) {
        z.cool = 1.3;
        if (this.phase === 'walking') this.grabbed(z);
        else if (this.phase === 'parked') {
          damage(this.hooks.state, 2);
          this.hooks.sfx.bad();
          this.hooks.changed();
        }
      }
    });
  }

  private grabbed(z: Zombie): void {
    const s = this.hooks.state;
    this.hooks.sfx.bad();
    document.body.classList.remove('hurt');
    void document.body.offsetWidth;
    document.body.classList.add('hurt');
    // A grab costs a little of what you carry and shoves you away.
    let what = '';
    if (s.inv.cash >= 5) {
      s.inv.cash -= 5;
      what = '5 dollars';
    } else if (s.inv.scrap >= 1) {
      s.inv.scrap -= 1;
      what = '1 scrap';
    }
    const away = this.walker.position.clone().sub(z.obj.position).setY(0).normalize();
    this.walker.position.addScaledVector(away, 1.2);
    this.hooks.say(this.hooks.kid ? 'Ow! Run!' : what ? `A zombie grabbed ${what}!` : 'A zombie grabbed you!', false);
    this.hooks.changed();
  }

  shoot(z: Zombie): void {
    const s = this.hooks.state;
    if (s.inv.bullets <= 0) {
      this.hooks.say(this.hooks.kid ? 'No bullets! Run!' : 'Out of bullets. Run for it!', false);
      return;
    }
    const from = (this.phase === 'walking' ? this.walker.position : this.host.car.position).clone().setY(1.5);
    if (from.distanceTo(z.obj.position) > SHOOT_RANGE) {
      this.hooks.say('Too far away!', false);
      return;
    }
    s.inv.bullets--;
    this.hooks.sfx.shot?.();
    const geo = new THREE.BufferGeometry().setFromPoints([from, z.obj.position.clone().setY(1.3)]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe08a }));
    this.host.scene.add(line);
    this.fx.push({ obj: line, life: 0.1, vy: 0 });
    if (this.phase === 'walking') this.walker.rotation.y = Math.atan2(z.obj.position.x - from.x, z.obj.position.z - from.z);
    z.hp--;
    z.hurt = 0.22;
    if (z.hp <= 0) this.pop(z, false);
    this.hooks.changed();
  }

  private pop(z: Zombie, rammed: boolean): void {
    this.host.scene.remove(z.obj);
    this.zombies.splice(this.zombies.indexOf(z), 1);
    const p = z.obj.position.clone().setY(1.4);
    this.popIcon('💨', p, 2.6, 0.8);
    if (!rammed) {
      this.popIcon('💵', p.clone().setY(2.6), 1.3, 1.1);
      this.hooks.state.inv.cash += foundCash(this.hooks.state, 1);
    }
    this.hooks.changed();
  }

  // ---------------------------------------------------------------- helpers

  private spawnStreet(): void {
    // Up or down Main Street from where you are (close enough to arrive while you search), or out from between the buildings.
    const near = this.at?.door ?? this.host.car.position;
    const st = this.laneIn;
    const i = this.alongIdx(st, near);
    const k = this.spawned++;
    const step = Math.max(1, Math.round(35 / Math.max(1, st[1] ? st[0].distanceTo(st[1]) : 1)));
    const j = Math.min(st.length - 1, Math.max(0, k % 2 === 0 ? i + step : i - step));
    const jitter = () => (Math.random() - 0.5) * 6;
    const p = k % 3 === 2 ? near.clone().add(new THREE.Vector3(Math.sign(Math.random() - 0.5) * (16 + Math.random() * 8), 0, Math.sign(Math.random() - 0.5) * (16 + Math.random() * 8))) : st[j].clone().add(new THREE.Vector3(jitter(), 0, jitter()));
    this.spawn(p, true);
  }

  private spawn(p: THREE.Vector3, awake: boolean): void {
    if (this.zombies.length >= (this.hooks.kid ? TOWN_ZOMBIES_KID : TOWN_ZOMBIES)) return;
    const obj = new THREE.Group();
    const body = hdZombie() ?? makeObstacle('zombie');
    body.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    obj.add(body);
    obj.add(hat(this.zombies.length % 4));
    obj.position.copy(p).setY(0);
    this.host.scene.add(obj);
    const threat = this.hooks.state.threat ?? 0;
    this.zombies.push({ obj, hp: 2 + Math.floor(threat / 2), speed: (this.hooks.kid ? 1.2 : 1.7) + Math.random() * 0.5 * (awake ? 1 : 0), phase: Math.random() * 6, hurt: 0, cool: 1 });
  }

  /** A loot icon pops out of the box, then flies up to your supplies at the top of the screen. */
  private flyIcon(icon: string, p: THREE.Vector3, n: number): void {
    const s = emojiSprite(icon, 1.4);
    s.position.copy(p);
    s.renderOrder = 10;
    this.host.scene.add(s);
    this.fly.push({ obj: s, from: p.clone().add(new THREE.Vector3((n - 1) * 0.7, 0, 0)), t: -n * 0.12 });
  }

  private updateFly(dt: number): void {
    const cam = this.host.camera;
    // Where the supplies line sits: top left of the screen, a few metres in front of the camera.
    const to = new THREE.Vector3(-0.55, 0.78, 0.5).unproject(cam).sub(cam.position).normalize().multiplyScalar(4).add(cam.position);
    this.fly = this.fly.filter((f) => {
      f.t += dt;
      const t = Math.max(0, f.t);
      if (t < 0.45) {
        // Pop up out of the box first.
        f.obj.position.copy(f.from).setY(f.from.y + Math.sin((t / 0.45) * Math.PI * 0.5) * 1.2);
        return true;
      }
      const k = Math.min(1, (t - 0.45) / 0.55);
      const start = f.from.clone().setY(f.from.y + 1.2);
      f.obj.position.lerpVectors(start, to, k * k);
      const sc = 1.4 * (1 - k * 0.6);
      f.obj.scale.set(sc, sc, 1);
      if (k < 1) return true;
      this.host.scene.remove(f.obj);
      disposeSprite(f.obj);
      this.hooks.bump?.();
      return false;
    });
  }

  /** Unopened boxes bounce and glow; opened ones swing open (lid, door or drawer). */
  private updateCrates(dt: number): void {
    const sp = this.at;
    if (this.phase !== 'inside' || !sp) return;
    CRATE_GLOW.opacity = 0.75 + 0.25 * Math.sin(this.time * 4);
    sp.crates.forEach((c, i) => {
      const opened = !!this.search?.opened[i];
      const lid = c.getObjectByName('lid');
      if (lid) {
        const t = (lid.userData.t = THREE.MathUtils.clamp((lid.userData.t ?? 0) + (opened ? dt : -dt) * 3, 0, 1));
        const a = lid.userData.closed as { pos: THREE.Vector3; rot: THREE.Euler };
        const b = lid.userData.open as { pos: THREE.Vector3; rot: THREE.Euler };
        const e = t * t * (3 - 2 * t);
        lid.position.lerpVectors(a.pos, b.pos, e);
        lid.rotation.set(a.rot.x + (b.rot.x - a.rot.x) * e, a.rot.y + (b.rot.y - a.rot.y) * e, a.rot.z + (b.rot.z - a.rot.z) * e);
      }
      const bounce = opened || this.search?.over ? 0 : Math.max(0, Math.sin(this.time * 5 + i * 1.7));
      c.scale.set(1 - bounce * 0.03, 1 + bounce * 0.06, 1 - bounce * 0.03);
    });
  }

  private popIcon(icon: string, p: THREE.Vector3, size = 1.6, life = 1.2): void {
    const s = emojiSprite(icon, size);
    s.position.copy(p);
    this.host.scene.add(s);
    this.fx.push({ obj: s, life, vy: 1.6 });
  }

  private walkTo(pts: THREE.Vector3[], speed: number, then: () => void): void {
    this.walk = { pts: pts.map((p) => p.clone().setY(this.host.car.position.y)), speed, then };
  }

  /**
   * Drives the car along a smooth curve through `pts` (backwards if `reverse`), from a standstill to
   * `endSpeed`. Speed follows a plan worked out up front: speed up and slow down at TOWN_ACCEL, slow
   * for bends so the sideways pull stays under TOWN_GRIP, and cruise at TOWN_SPEED, or faster (up
   * to TOWN_TOP) when that's what it takes to finish inside MOVE_GOAL seconds. Backing up keeps to
   * REVERSE_TOP.
   */
  private driveCurve(pts: THREE.Vector3[], reverse: boolean, then: () => void, endSpeed = 0): void {
    if (pts.length < 2) pts = [pts[0], pts[0].clone().add(new THREE.Vector3(0.01, 0, 0))];
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => p.clone().setY(this.host.car.position.y)), false, 'centripetal');
    const len = Math.max(0.5, curve.getLength());
    const plan = speedPlan(curve, len, reverse ? { cruise: REVERSE_TOP, top: REVERSE_TOP } : { cruise: TOWN_SPEED, top: TOWN_TOP }, endSpeed);
    this.move = { curve, len, s: 0, reverse, then, speedAt: plan.speedAt, secs: plan.secs };
  }

  private alongIdx(lane: THREE.Vector3[], p: THREE.Vector3): number {
    let best = 0;
    let bestD = Infinity;
    lane.forEach((q, i) => {
      const d = q.distanceToSquared(p);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  private storeKey(): string {
    return this.hooks.stopId;
  }

  // ---------------------------------------------------------------- camera

  private updateCamera(dt: number): void {
    const cam = this.host.camera;
    const wantPos = new THREE.Vector3();
    const wantLook = new THREE.Vector3();
    const car = this.host.car.position;
    const fwd = new THREE.Vector3(Math.sin(this.carYaw), 0, Math.cos(this.carYaw));
    const busy = this.nearZombies(20) > 0;
    if (this.phase === 'inside' && this.at) {
      // The dollhouse: roof and front off, looking down into the room, as close as it can sit with
      // the whole room (every box) between the meters and the buttons, tall phone or sideways.
      const v = this.roomView(this.at);
      wantPos.copy(v.pos);
      wantLook.copy(v.look);
    } else if (this.phase === 'walking') {
      // Third person behind the walker: a close-up of the road's chase camera.
      const w = this.walker.position;
      // Standing still with zombies about: turn to face the nearest, so you can see it coming.
      const z = !this.walk ? this.nearestZombie(w, 20) : null;
      if (z) {
        const to = z.obj.position.clone().sub(w).setY(0);
        if (to.lengthSq() > 0.01) this.heading.lerp(to.normalize(), Math.min(1, dt * 1.5)).setY(0).normalize();
      }
      const sp = this.at;
      if (sp && w.distanceTo(sp.door) < 12) {
        // By a building: from the street side, a little along, looking between you and the door, so
        // you and the building are both in view (and the camera never ends up in the wall).
        const along = new THREE.Vector3(sp.facing.z, 0, -sp.facing.x);
        wantPos.copy(w).addScaledVector(sp.facing, 8).addScaledVector(along, -3).setY(w.y + 5.5);
        wantLook.copy(w).lerp(sp.door, 0.5).setY(w.y + 1.4);
      } else {
        wantPos.copy(w).addScaledVector(this.heading, busy ? -7.5 : -8.5).setY(w.y + (busy ? 6.5 : 5.2));
        wantLook.copy(w).addScaledVector(this.heading, 5).setY(w.y + 1.2);
      }
    } else if (this.phase === 'parked' && this.at?.pump && !this.move) {
      // At the pumps: low behind the car, under the canopy, the pump beside it.
      wantPos.copy(car).addScaledVector(fwd, -8.5).setY(car.y + 3.6);
      wantLook.copy(car).addScaledVector(fwd, 5).setY(car.y + 1.2);
    } else if (this.phase === 'parked' && this.at && !this.move) {
      // Parked (pulling out of the lot uses the chase camera below): back and up, the car and its building both in view.
      const sp = this.at;
      const mid = car.clone().lerp(sp.centre, 0.45);
      wantPos.copy(mid).addScaledVector(sp.facing, 13).addScaledVector(fwd.clone().cross(UP).multiplyScalar(0), 0);
      const along = new THREE.Vector3(sp.facing.z, 0, -sp.facing.x);
      wantPos.addScaledVector(along, -8).setY(car.y + 7.5);
      wantLook.copy(mid).setY(car.y + 2);
    } else if (this.phase === 'street' && !busy) {
      // Waiting on Main Street: up high, framed so every stop's sign (and the car) is on screen.
      const v = this.streetView(this.view);
      wantPos.copy(v.pos);
      wantLook.copy(v.look);
    } else {
      // Driving: the road's chase camera, a bit higher and closer when zombies are about (as in road fights).
      wantPos.copy(car).addScaledVector(fwd, busy ? -11.5 : -14).setY(car.y + (busy ? 8.5 : 7));
      wantLook.copy(car).addScaledVector(fwd, busy ? 22 : 20).setY(car.y + 1);
    }
    // Keep under the gas station's canopy while you're at the pumps.
    if (this.at?.pump && (this.phase === 'walking' || this.phase === 'parked') && wantPos.distanceTo(this.at.pump) < 14) wantPos.y = Math.min(wantPos.y, car.y + 4.2);
    // Driving in, out or round under it too, so the chase camera doesn't go through the roof.
    const underRoof = (v: THREE.Vector3) => this.world.spots.some((sp) => sp.pump && Math.hypot(v.x - sp.pump.x, v.z - sp.pump.z) < 11.5);
    if (this.move && (underRoof(wantPos) || underRoof(car))) wantPos.y = Math.min(wantPos.y, car.y + 4.2);
    // Glides at rate 3 a second; quicker while the car is going fast, so the chase camera keeps up.
    const k = Math.min(1, dt * (3 + (this.move ? this.carSpeed / 6 : 0)));
    this.camPos.lerp(wantPos, k);
    this.camLook.lerp(wantLook, k);
    if (this.move) {
      // A quick turn swings the chase point round the car; never let the glide cut in close over it.
      const off = this.camPos.clone().sub(car).setY(0);
      const d = off.length();
      if (d < 7 && d > 0.01) this.camPos.addScaledVector(off, (7 - d) / d);
      if (underRoof(this.camPos) || underRoof(car)) this.camPos.y = Math.min(this.camPos.y, car.y + 4.2);
    }
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
  }

  /**
   * A Main Street view, looking up the street from where it starts (the signs face that way),
   * pulled back until every sign in it fits the screen. View 0 holds every stop;
   * views 1 and 2 are the near and far halves of the street, closer up. Worked out once per
   * screen shape and kept, so the camera doesn't wander.
   */
  private streetView(i: number): { key: string; pos: THREE.Vector3; look: THREE.Vector3 } {
    const cam = this.host.camera;
    const key = `${i}|${cam.aspect.toFixed(3)}|${cam.fov}|${JSON.stringify(this.band(null))}`;
    const kept = this.views[i];
    if (kept && kept.key === key) return kept;
    const start = this.laneIn[0];
    const order = [...this.world.spots].sort((a, b) => a.centre.distanceTo(start) - b.centre.distanceTo(start));
    const half = Math.ceil(order.length / 2);
    const spots = i === 0 ? order : i === 1 ? order.slice(0, half) : order.slice(half - 1);
    const pts: THREE.Vector3[] = [];
    const box = new THREE.Box3();
    for (const sp of spots) {
      box.setFromObject(sp.sign);
      pts.push(box.min.clone(), box.max.clone(), new THREE.Vector3(box.min.x, box.max.y, box.min.z), new THREE.Vector3(box.max.x, box.min.y, box.max.z));
      pts.push(sp.centre.clone());
    }
    const centre = new THREE.Box3().setFromPoints(pts).getCenter(new THREE.Vector3());
    const ahead = centre.clone().sub(start).setY(0);
    if (ahead.lengthSq() < 1) ahead.set(Math.sin(this.carYaw), 0, Math.cos(this.carYaw));
    ahead.normalize();
    const tries: { dir: THREE.Vector3; cost: number }[] = [];
    for (const turn of [0, -0.35, 0.35, -0.7, 0.7]) for (const pitch of [0.72, 0.9]) tries.push({ dir: viewDir(ahead, turn, pitch), cost: 1 + Math.abs(turn) * 0.5 });
    const v = fitView(cam, pts, centre, tries, this.band({ left: -0.88, right: 0.88, top: 0.68, bottom: -0.5 }));
    const look = v?.look ?? centre;
    const pos = v?.pos ?? centre.clone().addScaledVector(ahead, -40).setY(centre.y + 45);
    return (this.views[i] = { key, pos, look });
  }

  /** The clear part of the screen as the HUD reports it (rounded, so it doesn't jitter), or `fallback`. */
  private band<T extends Band | null>(fallback: T): Band | T {
    const b = this.hooks.clearArea?.();
    if (!b) return fallback;
    const r = (v: number) => Math.round(v * 20) / 20;
    return { left: r(b.left) + 0.1, right: r(b.right) - 0.1, top: r(b.top) - 0.04, bottom: r(b.bottom) + 0.04 };
  }

  private roomViews = new Map<TownSpot, { key: string; pos: THREE.Vector3; look: THREE.Vector3 }>();

  /** The camera inside a building: from the street side or from either end, whichever fills the screen best. */
  private roomView(sp: TownSpot): { pos: THREE.Vector3; look: THREE.Vector3 } {
    const cam = this.host.camera;
    const key = `${cam.aspect.toFixed(3)}|${cam.fov}|${JSON.stringify(this.band(null))}`;
    const kept = this.roomViews.get(sp);
    if (kept && kept.key === key) return kept;
    sp.room.updateMatrixWorld(true);
    const hw = sp.size.x / 2;
    const hd = sp.size.z / 2;
    const pts: THREE.Vector3[] = [];
    for (const x of [-hw, hw]) for (const z of [-hd, hd]) pts.push(sp.room.localToWorld(new THREE.Vector3(x, 0, z)));
    for (const x of [-hw, hw]) pts.push(sp.room.localToWorld(new THREE.Vector3(x, 2.4, -hd)));
    for (const c of sp.crates) pts.push(c.localToWorld(new THREE.Vector3(0, 1.6, 0)));
    const centre = new THREE.Box3().setFromPoints(pts).getCenter(new THREE.Vector3());
    // facing points out of the front (toward the street); the camera looks in from there or from the ends.
    const inward = sp.facing.clone().setY(0).normalize().negate();
    const side = new THREE.Vector3(inward.z, 0, -inward.x);
    const tries: { dir: THREE.Vector3; cost: number }[] = [];
    for (const pitch of [1.0, 1.12, 1.25]) for (const turn of [0, -0.3, 0.3]) tries.push({ dir: viewDir(inward, turn, pitch), cost: 1 });
    // From an end the near wall hides less the steeper you look, so only steep views from there.
    for (const pitch of [1.2, 1.32]) for (const d of [side, side.clone().negate()]) tries.push({ dir: viewDir(d, 0, pitch), cost: 1.05 });
    const v = fitView(cam, pts, centre, tries, this.band({ left: -0.9, right: 0.9, top: 0.64, bottom: -0.46 }));
    const out = { key, pos: v?.pos ?? centre.clone().addScaledVector(sp.facing, 10).setY(centre.y + 14), look: v?.look ?? centre };
    this.roomViews.set(sp, out);
    return out;
  }

  dispose(): void {
    for (const l of this.locals) this.host.scene.remove(l.rig.obj);
    for (const z of this.zombies) this.host.scene.remove(z.obj);
    for (const f of this.fx) this.host.scene.remove(f.obj);
    for (const f of this.fly) {
      this.host.scene.remove(f.obj);
      disposeSprite(f.obj);
    }
    this.host.scene.remove(this.walker);
    this.host.car.visible = true;
    const rider = this.host.car.getObjectByName('rider');
    if (rider) rider.visible = true;
    for (const sp of this.world.spots) {
      sp.shell.visible = true;
      sp.room.visible = false;
      showRoofs(sp, true);
    }
  }
}

// ------------------------------------------------------------------ small parts

export const LOOT_ICONS: Record<keyof Inventory, string> = { fuel: '⛽', cash: '💵', scrap: '🔩', bullets: '🔫', shells: '💥', catnip: '🌿' };

function placeWord(sp: TownSpot): string {
  return { pumps: 'Gas', motel: 'Motel', grocery: 'Food', garage: 'Garage', hardware: 'Tools', pharmacy: 'Medicine', police: 'Police', gunshop: 'Ammo', junkyard: 'Junkyard', barn: 'Farm' }[sp.lot.place];
}

function showRoofs(sp: TownSpot, on: boolean): void {
  sp.group.traverse((o) => {
    if (o.name === 'roof') o.visible = on;
  });
}

function placeName(sp: TownSpot): string {
  return { pumps: 'gas station', motel: 'motel', grocery: 'grocery store', garage: 'garage', hardware: 'hardware store', pharmacy: 'drugstore', police: 'police station', gunshop: 'gun shop', junkyard: 'junkyard', barn: 'farm' }[sp.lot.place];
}

/** Part of a box to search (never something to stand on). */
function inCrate(o: THREE.Object3D | null, root: THREE.Object3D): boolean {
  for (; o && o !== root; o = o.parent) if (o.name === 'crate') return true;
  return false;
}

function isChild(o: THREE.Object3D | null, root: THREE.Object3D): boolean {
  for (; o; o = o.parent) if (o === root) return true;
  return false;
}

function dedupe(pts: THREE.Vector3[]): THREE.Vector3[] {
  return pts.filter((p, i) => i === 0 || p.distanceTo(pts[i - 1]) > 1.2);
}

function yawOf(o: THREE.Object3D): number {
  const d = new THREE.Vector3(0, 0, 1).applyQuaternion(o.quaternion);
  return Math.atan2(d.x, d.z);
}

/** The part of the screen not covered by the HUD, in -1..1 screen units (y up). */
export interface Band {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Where a camera sits relative to what it looks at: back from `ahead`, turned by `turn`, raised by `pitch` (radians). */
function viewDir(ahead: THREE.Vector3, turn: number, pitch: number): THREE.Vector3 {
  return ahead.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), turn).multiplyScalar(-Math.cos(pitch)).setY(Math.sin(pitch));
}

/**
 * The closest camera (over a few directions, each with a cost) that keeps every point inside the
 * clear band of the screen (in -1..1 screen units), re-aimed so the points sit in the middle of the band.
 */
function fitView(
  cam: THREE.PerspectiveCamera,
  pts: THREE.Vector3[],
  centre: THREE.Vector3,
  tries: { dir: THREE.Vector3; cost: number }[],
  band: Band,
): { pos: THREE.Vector3; look: THREE.Vector3 } | null {
  const probe = new THREE.PerspectiveCamera(cam.fov, cam.aspect, 0.5, 2000);
  const q = new THREE.Vector3();
  const mx = (band.left + band.right) / 2;
  const my = (band.top + band.bottom) / 2;
  /** Camera at `pos`, turned so `anchor` sits in the middle of the band (not the screen). Returns where it looks. */
  const aim = (pos: THREE.Vector3, anchor: THREE.Vector3): THREE.Vector3 => {
    probe.position.copy(pos);
    probe.lookAt(anchor);
    probe.updateMatrixWorld(true);
    const look = new THREE.Vector3(-mx, -my, 0.5).unproject(probe);
    probe.lookAt(look);
    probe.updateMatrixWorld(true);
    return look;
  };
  const fits = (pos: THREE.Vector3, anchor: THREE.Vector3) => {
    aim(pos, anchor);
    return pts.every((p) => {
      q.copy(p).project(probe);
      return q.z < 1 && q.x > band.left && q.x < band.right && q.y < band.top && q.y > band.bottom;
    });
  };
  const fit = (anchor: THREE.Vector3, dir: THREE.Vector3): number | null => {
    let lo = 3, hi = 400;
    if (!fits(anchor.clone().addScaledVector(dir, hi), anchor)) return null;
    for (let k = 0; k < 22; k++) {
      const mid = (lo + hi) / 2;
      if (fits(anchor.clone().addScaledVector(dir, mid), anchor)) hi = mid;
      else lo = mid;
    }
    return hi;
  };
  let best: { pos: THREE.Vector3; look: THREE.Vector3; d: number } | null = null;
  for (const { dir, cost } of tries) {
    const anchor = centre.clone();
    let dist = fit(anchor, dir);
    // Re-aim a few times so the points sit in the middle of the band, then pull in again.
    for (let k = 0; dist !== null && k < 4; k++) {
      aim(anchor.clone().addScaledVector(dir, dist), anchor);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of pts) {
        q.copy(p).project(probe);
        x0 = Math.min(x0, q.x);
        x1 = Math.max(x1, q.x);
        y0 = Math.min(y0, q.y);
        y1 = Math.max(y1, q.y);
      }
      // Move the anchor to whatever sits where the points' middle should be.
      const depth = q.copy(anchor).project(probe).z;
      const shifted = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, depth).unproject(probe);
      anchor.add(shifted.sub(new THREE.Vector3(mx, my, depth).unproject(probe)));
      dist = fit(anchor, dir) ?? dist;
    }
    if (dist === null) continue;
    if (!best || dist * cost < best.d) {
      const pos = anchor.clone().addScaledVector(dir, dist * 1.04);
      best = { pos, look: aim(pos, anchor), d: dist * cost };
    }
  }
  return best && { pos: best.pos, look: best.look };
}

function resetCrate(c: THREE.Group): void {
  const lid = c.getObjectByName('lid');
  if (lid) {
    const a = lid.userData.closed as { pos: THREE.Vector3; rot: THREE.Euler };
    lid.position.copy(a.pos);
    lid.rotation.copy(a.rot);
    lid.userData.t = 0;
  }
  c.scale.set(1, 1, 1);
  emptied(c, false);
}

/** An emptied box goes dark and loses its glow; `false` puts it back as new. */
function emptied(c: THREE.Group, on: boolean): void {
  // An opened lid or door stands up thin: it casts no shadow (it only made a dark slab on the floor).
  c.getObjectByName('lid')?.traverse((o) => ((o as THREE.Mesh).castShadow = !on));
  c.traverse((o) => {
    if (o.name === 'glow') {
      o.visible = !on;
      (o as THREE.Mesh).castShadow = false;
      return;
    }
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m?.color && m.userData.base !== undefined) m.color.setHex(m.userData.base).multiplyScalar(on ? 0.4 : 1);
  });
}

/** A sprite showing one emoji. */
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

function disposeSprite(o: THREE.Object3D): void {
  const m = (o as THREE.Sprite).material as THREE.SpriteMaterial | undefined;
  if (m && 'map' in m) {
    m.map?.dispose();
    m.dispose();
  }
  (o as THREE.Mesh).geometry?.dispose();
}

/** Silly hats so the 5-year-old can tell the zombies apart: a traffic cone, a chef's hat, a party hat, a bucket. */
function hat(kind: number): THREE.Object3D {
  const g = new THREE.Group();
  const m = (c: number) => lit({ color: c });
  if (kind === 0) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.75, 12), m(0xff7a1a));
    c.position.y = 0.38;
    g.add(c);
  } else if (kind === 1) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.45, 12), m(0xffffff));
    c.position.y = 0.22;
    g.add(c);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8), m(0xffffff));
    top.position.y = 0.55;
    g.add(top);
  } else if (kind === 2) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.7, 12), m(0xd04fd1));
    c.position.y = 0.35;
    g.add(c);
  } else {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.26, 0.45, 12), m(0x9aa4ae));
    c.position.y = 0.22;
    g.add(c);
  }
  g.position.y = 2.15;
  return g;
}

/** The player on foot when the rigged model isn't there (Low graphics): chunky, with a backpack. */
function codeWalker(): THREE.Group {
  const g = new THREE.Group();
  const add = (w: number, h: number, d: number, c: number, x: number, y: number, z: number, name = '') => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lit({ color: c }));
    b.position.set(x, y, z);
    b.castShadow = true;
    if (name) b.name = name;
    g.add(b);
  };
  add(0.32, 0.85, 0.3, 0x2f4f8f, -0.12, 0.43, 0, 'legL');
  add(0.32, 0.85, 0.3, 0x2f4f8f, 0.12, 0.43, 0, 'legR');
  add(0.62, 0.62, 0.36, 0xd9302a, 0, 1.15, 0);
  add(0.36, 0.36, 0.36, 0xf1c28e, 0, 1.66, 0);
  add(0.42, 0.12, 0.42, 0xd9482b, 0, 1.88, 0);
  add(0.5, 0.5, 0.22, 0xc8862a, 0, 1.15, -0.28);
  return g;
}

export { makeCar };

/** The motel bed's parts (named 'bed' by the room's furniture). */
function beds(room: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  room.traverse((o) => {
    if (o.name === 'bed') out.push(o);
  });
  return out;
}

/**
 * A speed plan for a drive along `curve`: from a standstill to `endSpeed`, speeding up and slowing
 * down at TOWN_ACCEL, slowing for bends (sideways pull under TOWN_GRIP), at `cruise` or faster, up
 * to `top`, if that's what it takes to finish inside MOVE_GOAL. Sampled every half metre or so.
 */
export function speedPlan(curve: THREE.Curve<THREE.Vector3>, len: number, speeds: { cruise: number; top: number }, endSpeed = 0): { speedAt: (s: number) => number; secs: number } {
  const n = Math.max(2, Math.ceil(len / 0.5));
  const step = len / n;
  // The bend at each sample: how far the heading turns per metre, measured over about 4 m so tiny
  // kinks where the curve meets a lane point don't count as hairpins.
  const tans: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) tans.push(curve.getTangentAt(i / n).setY(0).normalize());
  const w = Math.max(1, Math.round(2 / step));
  const peak: number[] = [];
  for (let i = 0; i <= n; i++) {
    const i0 = Math.max(0, i - w);
    const i1 = Math.min(n, i + w);
    peak.push(i1 > i0 ? Math.acos(Math.max(-1, Math.min(1, tans[i0].dot(tans[i1])))) / (step * (i1 - i0)) : 0);
  }
  const build = (cruise: number, pull: number) => {
    const v = peak.map((k) => Math.min(k > 1e-4 ? Math.sqrt(pull / k) : Infinity, cruise));
    v[0] = 0;
    v[n] = Math.min(v[n], endSpeed);
    for (let i = 1; i <= n; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] * v[i - 1] + 2 * TOWN_ACCEL * step));
    for (let i = n - 1; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * TOWN_ACCEL * step));
    let secs = 0;
    for (let i = 0; i < n; i++) secs += step / Math.max(0.75, (v[i] + v[i + 1]) / 2);
    return { v, secs };
  };
  /** The lowest value in lo..hi for which `make` finishes inside MOVE_GOAL (hi if none does). */
  const lowest = (lo: number, hi: number, make: (x: number) => { v: number[]; secs: number }) => {
    for (let k = 0; k < 12; k++) {
      const mid = (lo + hi) / 2;
      if (make(mid).secs > MOVE_GOAL) lo = mid;
      else hi = mid;
    }
    return make(hi);
  };
  let plan = build(speeds.cruise, TOWN_GRIP);
  if (plan.secs > MOVE_GOAL && speeds.top > speeds.cruise) {
    // Too slow: cruise faster on the straights, up to the top speed...
    plan = build(speeds.top, TOWN_GRIP);
    if (plan.secs <= MOVE_GOAL) plan = lowest(speeds.cruise, speeds.top, (c) => build(c, TOWN_GRIP));
    // ...and if that's still not enough, take the bends faster too (a game car, it grips).
    else if (build(speeds.top, TOWN_GRIP_MAX).secs > MOVE_GOAL) plan = build(speeds.top, TOWN_GRIP_MAX);
    else plan = lowest(TOWN_GRIP, TOWN_GRIP_MAX, (g) => build(speeds.top, g));
  }
  const v = plan.v;
  return {
    secs: plan.secs,
    speedAt: (s: number) => {
      const x = Math.max(0, Math.min(n, s / step));
      const i = Math.min(n - 1, Math.floor(x));
      return v[i] + (v[i + 1] - v[i]) * (x - i);
    },
  };
}
