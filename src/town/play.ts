import * as THREE from 'three';
import {
  buyFuel,
  damage,
  openCrate,
  repair,
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
import type { TownSpot, TownWorld } from './world';

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
  sfx: { coin(): void; bad(): void; click(): void; shot?(): void };
  changed(): void;
  save(): void;
  /** Back on the highway. */
  done(): void;
}

/** Town driving speed (units a second, about 22 mph). */
export const TOWN_SPEED = 10;
export const WALK_SPEED = 4.2;
export const RUN_SPEED = 7.5;
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
}

interface CarMove {
  curve: THREE.CatmullRomCurve3;
  t: number;
  len: number;
  reverse: boolean;
  then: () => void;
}

const UP = new THREE.Vector3(0, 1, 0);

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
  private move: CarMove | null = null;
  private zombies: Zombie[] = [];
  private fx: { obj: THREE.Object3D; life: number; vy: number }[] = [];
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private heading = new THREE.Vector3(0, 0, -1);
  private ray = new THREE.Raycaster();
  private time = 0;
  private spawned = 0;
  /** World-space copies of the town's paths. */
  private laneIn: THREE.Vector3[];
  private laneOut: THREE.Vector3[];
  private carYaw = 0;

  constructor(
    private host: TownHost,
    readonly world: TownWorld,
    private hooks: TownHooks,
  ) {
    world.group.updateMatrixWorld(true);
    const W = (v: THREE.Vector3) => world.group.localToWorld(v.clone());
    this.laneIn = world.laneIn.map(W);
    this.laneOut = world.laneOut.map(W);
    for (const sp of world.spots) {
      sp.park = sp.park.map(W);
      sp.door = W(sp.door);
      sp.inside = W(sp.inside);
      sp.centre = W(sp.centre);
      if (sp.pump) sp.pump = W(sp.pump);
      sp.facing = sp.facing.clone().transformDirection(world.group.matrixWorld);
    }
    this.walkerRig = person('player_walker');
    this.walker = this.walkerRig?.obj ?? codeWalker();
    this.walker.visible = false;
    host.scene.add(this.walker);
    this.camPos.copy(host.camera.position);
    const look = new THREE.Vector3();
    host.camera.getWorldDirection(look);
    this.camLook.copy(host.camera.position).addScaledVector(look, 20);
    // Roll in from the corner and wait just past it, where every sign is in view.
    const car = host.car.position.clone();
    this.carYaw = yawOf(host.car);
    const wait = this.laneIn.findIndex((p) => p.distanceTo(this.laneIn[0]) > 12);
    this.driveCurve([car, ...this.laneIn.slice(Math.max(1, wait - 1), wait + 1)], false, () => {
      this.phase = 'street';
      hooks.say(hooks.kid ? 'Tap a sign!' : `Welcome to ${world.layout.name}. Tap a sign to pull in.`);
      hooks.changed();
    });
    hooks.changed();
  }

  // ---------------------------------------------------------------- what the HUD asks

  /** The car or the walker is on the move (a tap on a sign waits till it stops). */
  get busy(): boolean {
    return !!this.move || !!this.walk;
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
    if (this.phase === 'inside' && this.at && this.search) {
      const hits = this.ray.intersectObjects(this.at.crates, true);
      if (hits.length) {
        const i = this.at.crates.findIndex((c) => isChild(hits[0].object, c));
        if (i >= 0) this.openCrate(i);
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
    this.walker.rotation.y = this.carYaw;
    this.heading.set(Math.sin(this.carYaw), 0, Math.cos(this.carYaw));
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
    if (this.phase !== 'walking') return;
    const left = new THREE.Vector3(Math.cos(this.carYaw), 0, -Math.sin(this.carYaw));
    this.walkTo([this.host.car.position.clone().addScaledVector(left, 1.9)], run ? RUN_SPEED : WALK_SPEED, () => {
      this.walker.visible = false;
      this.phase = 'parked';
      this.hooks.sfx.click();
      this.hooks.changed();
    });
  }

  goIn(sp: TownSpot): void {
    if (this.phase !== 'walking') return;
    this.walkTo([sp.door, sp.inside], WALK_SPEED, () => {
      this.at = sp;
      this.phase = 'inside';
      sp.shell.visible = false;
      sp.room.visible = true;
      this.search = startScavenge(this.hooks.state, this.storeKey(), sp.lot.place, sp.crates.length);
      for (const c of sp.crates) resetCrate(c);
      this.hooks.save();
      this.hooks.say(this.hooks.kid ? 'Tap the boxes!' : `Inside the ${placeName(sp)}. Quiet now...`);
      this.hooks.changed();
    });
  }

  /** Out of the building to just outside the door. */
  leaveBuilding(run = false, then: () => void = () => {}): void {
    if (this.phase !== 'inside' || !this.at) return;
    const sp = this.at;
    sp.shell.visible = true;
    sp.room.visible = false;
    this.search = null;
    this.phase = 'walking';
    // Out the door facing the street, so the camera sees what's coming.
    this.walker.position.copy(sp.door).setY(this.walker.position.y);
    this.heading.copy(sp.facing).setY(0).normalize();
    this.hooks.changed();
    this.walkTo([sp.door.clone().addScaledVector(sp.facing, 2.5)], run ? RUN_SPEED : WALK_SPEED, then);
  }

  private openCrate(i: number): void {
    const sp = this.at!;
    const sc = this.search!;
    if (sc.opened[i] || sc.over) return;
    const r = openCrate(this.hooks.state, sc, i);
    const c = sp.crates[i];
    const lid = c.getObjectByName('lid');
    if (lid) {
      lid.rotation.x = -1.1;
      lid.position.set(0, 1.5, -0.55);
    }
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
      for (const [k, v] of Object.entries(r.loot) as [keyof Inventory, number][]) {
        this.popIcon(LOOT_ICONS[k], p);
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

  /** Pull into a lot: out of the one you're in first (backing out), along Main Street, and in. */
  driveTo(sp: TownSpot): void {
    if (this.move) return;
    const go = () => {
      const now = this.host.car.position.clone();
      const target = sp.park[0];
      const ahead = this.alongIdx(this.laneIn, target) >= this.alongIdx(this.laneIn, now);
      const pts = [now];
      if (ahead) {
        const i0 = this.alongIdx(this.laneIn, now) + 1;
        const i1 = this.alongIdx(this.laneIn, target) - 1;
        for (let i = i0; i <= i1; i += 2) pts.push(this.laneIn[i]);
      } else {
        // Back toward the highway in the other lane, swing round and come in the right way.
        const i0 = this.alongIdx(this.laneOut, now) - 1;
        const i1 = Math.max(1, this.alongIdx(this.laneOut, target) - 4);
        for (let i = i0; i >= i1; i -= 2) pts.push(this.laneOut[i]);
        const turn = Math.max(0, i1 - 3);
        pts.push(this.world.group.localToWorld(this.world.street[turn].clone()), this.laneIn[Math.max(0, turn - 1)], this.laneIn[turn + 1]);
      }
      pts.push(...sp.park);
      this.at = null;
      this.phase = 'driving';
      this.hooks.changed();
      this.driveCurve(dedupe(pts), false, () => {
        this.at = sp;
        this.phase = 'parked';
        this.hooks.say(this.hooks.kid ? `${placeWord(sp)}!` : `You pull into ${sp.lot.name ?? `the ${placeName(sp)}`}.`);
        this.hooks.changed();
      });
    };
    this.backOut(go);
  }

  /** Back on the highway: out of the lot, down Main Street, and onto the road. */
  leave(): void {
    if (this.move) return;
    if (this.phase === 'walking' || this.phase === 'inside') {
      this.backToCar(this.nearZombies() > 0);
      return;
    }
    this.backOut(() => {
      const now = this.host.car.position.clone();
      const pts = [now];
      const i0 = this.alongIdx(this.laneOut, now) - 1;
      for (let i = i0; i >= 0; i -= 2) pts.push(this.laneOut[i]);
      const e = this.host.exit;
      pts.push(e.pos.clone().addScaledVector(e.fwd, -10), e.pos.clone(), e.pos.clone().addScaledVector(e.fwd, 4));
      this.phase = 'leaving';
      this.at = null;
      this.hooks.changed();
      this.driveCurve(dedupe(pts), false, () => {
        this.phase = 'done';
        this.hooks.done();
      });
    });
  }

  private backOut(then: () => void): void {
    if (this.phase === 'parked' && this.at && !this.at.pump) {
      const p = this.host.car.position.clone();
      const fwd = new THREE.Vector3(Math.sin(this.carYaw), 0, Math.cos(this.carYaw));
      const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
      this.driveCurve([p, p.clone().addScaledVector(fwd, -3), p.clone().addScaledVector(fwd, -7).addScaledVector(side, 2)], true, then);
    } else then();
  }

  // ---------------------------------------------------------------- frame

  update(dt: number): void {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    const car = this.host.car;
    if (this.move) {
      const m = this.move;
      const speed = this.phase === 'leaving' ? TOWN_SPEED * 2 : TOWN_SPEED;
      m.t = Math.min(1, m.t + (dt * (m.reverse ? speed * 0.5 : speed)) / m.len);
      const p = m.curve.getPointAt(m.t);
      const tan = m.curve.getTangentAt(m.t);
      car.position.copy(p);
      this.carYaw = Math.atan2(tan.x, tan.z) + (m.reverse ? Math.PI : 0);
      for (const c of car.children) if (c.name === 'wheel') c.rotation.x += (dt * speed) / 0.42;
      // Zombies in the road get knocked flying, like on the highway.
      for (const z of [...this.zombies]) if (z.obj.position.distanceTo(p) < 2.4) this.pop(z, true);
      if (m.t >= 1) {
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
    this.updateZombies(dt);
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
      z.obj.position.y = (z.hurt > 0 ? z.hurt * 2.4 : Math.abs(Math.sin(z.phase * 4)) * 0.1) + target.y * 0;
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
      this.hooks.state.inv.cash += 2;
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

  private popIcon(icon: string, p: THREE.Vector3, size = 1.6, life = 1.2): void {
    const s = emojiSprite(icon, size);
    s.position.copy(p);
    this.host.scene.add(s);
    this.fx.push({ obj: s, life, vy: 1.6 });
  }

  private walkTo(pts: THREE.Vector3[], speed: number, then: () => void): void {
    this.walk = { pts: pts.map((p) => p.clone().setY(this.host.car.position.y)), speed, then };
  }

  private driveCurve(pts: THREE.Vector3[], reverse: boolean, then: () => void): void {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => p.clone().setY(this.host.car.position.y)), false, 'centripetal');
    this.move = { curve, t: 0, len: Math.max(1, curve.getLength()), reverse, then };
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
      // The dollhouse: roof and front off, looking down into the room from the street side.
      const sp = this.at;
      wantPos.copy(sp.centre).addScaledVector(sp.facing, sp.size.z / 2 + 8).setY(sp.centre.y + 11);
      wantLook.copy(sp.centre).addScaledVector(sp.facing, 1).setY(sp.centre.y + 0.5);
    } else if (this.phase === 'walking') {
      // Third person behind the walker: a close-up of the road's chase camera.
      const w = this.walker.position;
      const sp = this.at;
      if (sp && w.distanceTo(sp.door) < 12) {
        // By a building: from the street side and a little along it, so the camera never ends up in the wall.
        const along = new THREE.Vector3(sp.facing.z, 0, -sp.facing.x);
        wantPos.copy(w).addScaledVector(sp.facing, 7).addScaledVector(along, -6).setY(w.y + 5.5);
        wantLook.copy(w).addScaledVector(sp.facing, 2).setY(w.y + 1.2);
      } else {
        wantPos.copy(w).addScaledVector(this.heading, busy ? -7.5 : -8.5).setY(w.y + (busy ? 6.5 : 5.2));
        wantLook.copy(w).addScaledVector(this.heading, 5).setY(w.y + 1.2);
      }
    } else if (this.phase === 'parked' && this.at?.pump) {
      // At the pumps: low behind the car, under the canopy, the pump beside it.
      wantPos.copy(car).addScaledVector(fwd, -8.5).setY(car.y + 3.6);
      wantLook.copy(car).addScaledVector(fwd, 5).setY(car.y + 1.2);
    } else if (this.phase === 'parked' && this.at) {
      // Parked: back and up, the car and its building both in view.
      const sp = this.at;
      const mid = car.clone().lerp(sp.centre, 0.45);
      wantPos.copy(mid).addScaledVector(sp.facing, 13).addScaledVector(fwd.clone().cross(UP).multiplyScalar(0), 0);
      const along = new THREE.Vector3(sp.facing.z, 0, -sp.facing.x);
      wantPos.addScaledVector(along, -8).setY(car.y + 7.5);
      wantLook.copy(mid).setY(car.y + 2);
    } else {
      // Driving: the road's chase camera, a bit higher and closer when zombies are about (as in road fights).
      wantPos.copy(car).addScaledVector(fwd, busy ? -11.5 : -14).setY(car.y + (busy ? 8.5 : 7));
      wantLook.copy(car).addScaledVector(fwd, busy ? 22 : 20).setY(car.y + 1);
    }
    // Keep under the gas station's canopy while you're at the pumps.
    if (this.at?.pump && (this.phase === 'walking' || this.phase === 'parked') && wantPos.distanceTo(this.at.pump) < 14) wantPos.y = Math.min(wantPos.y, car.y + 4.2);
    const k = Math.min(1, dt * 3);
    this.camPos.lerp(wantPos, k);
    this.camLook.lerp(wantLook, k);
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
  }

  dispose(): void {
    for (const z of this.zombies) this.host.scene.remove(z.obj);
    for (const f of this.fx) this.host.scene.remove(f.obj);
    this.host.scene.remove(this.walker);
    for (const sp of this.world.spots) {
      sp.shell.visible = true;
      sp.room.visible = false;
    }
  }
}

// ------------------------------------------------------------------ small parts

export const LOOT_ICONS: Record<keyof Inventory, string> = { fuel: '⛽', cash: '💵', scrap: '🔩', bullets: '🔫', shells: '💥', catnip: '🌿' };

function placeWord(sp: TownSpot): string {
  return { pumps: 'Gas', motel: 'Motel', grocery: 'Food', garage: 'Garage', hardware: 'Tools', pharmacy: 'Medicine', police: 'Police', gunshop: 'Ammo', junkyard: 'Junkyard', barn: 'Farm' }[sp.lot.place];
}

function placeName(sp: TownSpot): string {
  return { pumps: 'gas station', motel: 'motel', grocery: 'grocery store', garage: 'garage', hardware: 'hardware store', pharmacy: 'drugstore', police: 'police station', gunshop: 'gun shop', junkyard: 'junkyard', barn: 'farm' }[sp.lot.place];
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

function resetCrate(c: THREE.Group): void {
  const lid = c.getObjectByName('lid');
  if (lid) {
    lid.rotation.x = 0;
    lid.position.set(0, 1.08, 0);
  }
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
