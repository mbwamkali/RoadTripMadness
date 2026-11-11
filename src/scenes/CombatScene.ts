import * as THREE from 'three';
import { lit } from './materials';
import { hdModel, hdZombie } from './hdModels';
import {
  combatOutcome,
  isBoss,
  fireAt,
  missileAt,
  ROAD_SPEED,
  stepCombat,
  type CombatState,
  type Enemy,
  type EnemyType,
} from '../game/combat';
import { damage, type GameState } from '../game/state';
import { sound } from '../audio/sound';
import { Atmosphere } from './atmosphere';
import { quality } from './quality';
import { detailTexture } from './textures';
import { hourOf, weatherAt } from '../game/time';
import { biomeAtDistance, biomeSpans, BIOMES, groundColorAt, type BiomeId, type PlantKind } from '../game/biomes';
import { fightRoad, type FightRoad } from '../game/fightRoad';
import { classAt, roadSegments } from '../game/roads';
import { pick } from '../game/rng';
import { pathFromRoute } from '../geo/route';
import { castShadows, disposeTree, makeLaneTexture, makeRide, makeRoadTexture, type GameScene } from './common';
import { modelGeometry, modelMaterial, modelMesh, modelsWanted, treeModelsWanted, type ModelName } from './models';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sampleBrute, sampleCatship, sampleMothership, sampleOutlaw, sampleWarRig } from './samples';
import { person, type Person } from './people';
import { angryCat, paperPlaneGeometry, pizzaGeometryParts, sampleCommandDrone, sampleHermit, sampleKaren, simpleCommandDrone, samplePizzaCar, sampleSweeper, simpleCat, simpleHermit, simpleKaren, simplePizzaCar, simpleSweeper } from './bossModels';

export interface CombatCallbacks {
  onCarHit(dmg: number): void;
  onEnd(outcome: 'cleared' | 'escaped' | 'wrecked'): void;
  onTick(): void;
}

interface Fx {
  obj: THREE.Object3D;
  life: number;
  max: number;
  vel?: THREE.Vector3;
}

/**
 * The action view: the car barrels down a straight road while threats close in.
 * Tap (or hold) on an enemy to target and shoot it.
 */
export class CombatScene implements GameScene {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  /**
   * Where the fight's enemies, shots and effects live. In its own view that is
   * the scene; on the road it is a group the drive view moves along with the car
   * (combat x is across your side of the road, -z is up the road ahead).
   */
  readonly root: THREE.Object3D;
  /** Fighting on the road: no road, car, sky or camera of its own. */
  readonly onRoad: boolean;
  private car!: THREE.Group;
  private atmosphere!: Atmosphere;
  private shadows = quality.profile.shadows;
  private groundMap: THREE.Texture | null = null;
  private roadTex = makeRoadTexture();
  /** Lane textures that scroll with the road (-1 for the far carriageway, which is turned around). */
  private scrolling: { tex: THREE.Texture; dir: number }[] = [];
  private props: THREE.Group = new THREE.Group();
  private meshes = new Map<number, THREE.Group>();
  /** Drones in a drone swarm: one paper plane drawn many times, tinted red while winding up. */
  private swarm: THREE.InstancedMesh | null = null;
  /** Horde zombies: one shared zombie drawn many times. */
  private horde: THREE.InstancedMesh | null = null;
  private missiles = new Map<number, THREE.Object3D>();
  private trash = Object.assign(lit({ color: 0x24302a, flatShading: true }), { userData: { shared: true } });
  private junk = Object.assign(lit({ color: 0x7a6a55 }), { userData: { shared: true } });
  /** A red glow over the car when it gets hit. */
  private hitGlow = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.8, 4.8), new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  private hitFlash = 0;
  private fx: Fx[] = [];
  private raycaster = new THREE.Raycaster();
  private lockedTarget: number | null = null;
  private holding = false;
  private done = false;
  private shake = 0;
  /** Red strip on the road where a boss attack will land. */
  private warning: THREE.Mesh;

  constructor(
    readonly combat: CombatState,
    private state: GameState,
    private cb: CombatCallbacks,
    host?: { scene: THREE.Scene; camera: THREE.PerspectiveCamera },
  ) {
    this.onRoad = !!host;
    this.camera = host?.camera ?? new THREE.PerspectiveCamera(60, 1, 0.3, 400);
    this.root = host ? new THREE.Group() : this.scene;
    if (host) host.scene.add(this.root);
    if (!host) this.buildView();
    this.hitGlow.visible = false;
    this.root.add(this.hitGlow);

    this.warning = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 26),
      new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.4, depthWrite: false }),
    );
    this.warning.rotation.x = -Math.PI / 2;
    this.warning.position.set(0, 0.06, -6);
    this.warning.visible = false;
    this.root.add(this.warning);
  }

  /** The separate fight view's own road, roadside, car and sky. */
  private buildView(): void {
    const state = this.state;
    const combat = this.combat;
    this.car = makeRide(state.ride ?? 'car', state.upgrades);
    this.atmosphere = new Atmosphere(this.scene, combat.title.includes('cat') || combat.boss === 'mothership' ? 0x5a3f8a : 0xe8a868, 60, 170, this.shadows ? { size: quality.profile.shadowSize, range: 45 } : null);
    this.atmosphere.minFogFar = combat.boss ? 90 : 55;
    this.atmosphere.set(hourOf(state), weatherAt(state));
    this.atmosphere.attachHeadlights(this.car);

    this.groundMap = detailTexture('ground', 400 / 30, 400 / 30);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), lit({ color: groundColorAt(biomeSpans(state.route), state.distance), map: this.groundMap }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.root.add(ground);

    // The same kind of road you were driving on: lanes, median and shoulders.
    const path = pathFromRoute(state.route);
    const layout = fightRoad(classAt(roadSegments(state.route, path.length), state.distance));
    this.buildRoad(layout);
    // Roadside posts and the biome's plants and rocks scroll past to sell the speed.
    this.buildProps(layout, biomeAtDistance(biomeSpans(state.route, path), state.distance));
    castShadows(this.props, this.shadows);
    castShadows(this.car, this.shadows);
    this.root.add(this.props);
    this.root.add(this.car);
  }

  resize(w: number, h: number): void {
    if (this.onRoad) return;
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 78 : 58;
    this.camera.updateProjectionMatrix();
  }

  /** Finds the enemy under a screen point (normalized device coords). */
  pick(ndc: THREE.Vector2): number | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    let best: { id: number; dist: number } | null = null;
    for (const [id, g] of this.meshes) {
      const hitbox = g.getObjectByName('hitbox')!;
      const hits = this.raycaster.intersectObject(hitbox, false);
      if (hits.length && (!best || hits[0].distance < best.dist)) best = { id, dist: hits[0].distance };
    }
    if (best) return best.id;
    // Forgiving aim for fingers: take the enemy closest to the tap on screen.
    let near: { id: number; d: number } | null = null;
    const consider = (id: number, at: THREE.Vector3) => {
      const p = at.setY(at.y + 1).project(this.camera);
      const d = Math.hypot(p.x - ndc.x, (p.y - ndc.y) * 0.8);
      if (d < 0.18 && (!near || d < near.d)) near = { id, d };
    };
    for (const [id, g] of this.meshes) consider(id, g.getWorldPosition(new THREE.Vector3()));
    for (const e of this.combat.enemies) if (e.horde || e.type === 'drone') consider(e.id, this.root.localToWorld(new THREE.Vector3(e.x, e.y, e.z)));
    return (near as { id: number } | null)?.id ?? null;
  }

  pointerDown(ndc: THREE.Vector2): void {
    this.holding = true;
    this.lockedTarget = this.pick(ndc);
    this.tryFire();
  }

  pointerUp(): void {
    this.holding = false;
  }

  private tryFire(): void {
    if (this.lockedTarget == null) return;
    if (!this.combat.enemies.some((e) => e.id === this.lockedTarget)) {
      this.lockedTarget = null;
      return;
    }
    fireAt(this.combat, this.state.inv, this.lockedTarget);
  }

  update(dt: number): void {
    if (this.done) {
      this.updateFx(dt);
      return;
    }
    const c = this.combat;
    if (this.holding) this.tryFire();
    const dmg = stepCombat(c, dt);
    if (dmg > 0) {
      damage(this.state, dmg);
      this.cb.onCarHit(dmg);
    }
    this.handleEvents();
    this.syncEnemies();
    this.ambience(dt);
    if (!this.onRoad) this.moveView(dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.hitGlow.visible = this.hitFlash > 0;
    this.hitGlow.position.set(c.carX, 0.9, 0);
    (this.hitGlow.material as THREE.MeshBasicMaterial).opacity = (this.hitFlash / 0.3) * 0.55;
    this.syncMissiles();
    this.shake = Math.max(0, this.shake - dt * 3);
    const boss = c.enemies.find((e) => e.id === c.bossId);
    this.warning.visible = !!boss?.charging;
    if (boss?.charging) {
      this.warning.position.x = boss.targetX;
      // Pulse faster as the hit gets closer.
      (this.warning.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.3 * (0.5 + 0.5 * Math.sin(c.time * (8 + (1.5 - boss.timer) * 14)));
    }
    this.updateFx(dt);
    if (!this.onRoad) this.atmosphere.update(dt, this.camera, this.car.position);
    this.cb.onTick();

    const outcome = this.state.status === 'lost' ? 'wrecked' : combatOutcome(c);
    if (outcome) {
      this.done = true;
      this.state.kills += c.kills;
      this.cb.onEnd(outcome);
    }
  }

  /** How hard the camera shakes from hits (the road view adds it to its own camera). */
  get shakeAmount(): number {
    return this.shake;
  }

  /** The separate fight view: scroll the road and props, steer the car, aim the camera. */
  private moveView(dt: number): void {
    const c = this.combat;
    sound.engine(1, c.boostTime > 0);
    const speed = ROAD_SPEED * (c.boostTime > 0 ? 2.2 : 1);
    for (const r of this.scrolling) r.tex.offset.y += (r.dir * speed * dt) / 16;
    if (this.groundMap) this.groundMap.offset.y = (this.groundMap.offset.y + (speed * dt) / 30) % 1;
    for (const p of this.props.children) {
      p.position.z += speed * dt;
      if (p.position.z > 25) p.position.z -= 180;
    }
    this.car.position.x = c.carX;
    this.car.rotation.set(0, Math.PI - c.steer * 0.15, 0);
    for (const ch of this.car.children) if (ch.name === 'wheel') ch.rotation.x -= speed * dt * 2;
    const gun = this.car.getObjectByName('gun');
    const target = c.enemies.find((e) => e.id === this.lockedTarget);
    if (gun && target) gun.rotation.y = Math.atan2(-(target.x - c.carX), -target.z);

    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    const big = c.boss === 'mothership';
    this.camera.position.set(c.carX * 0.6 + sx, (big ? 8 : 9.5) + sy, 14);
    this.camera.lookAt(c.carX * 0.4, big ? 3 : 0, -22);
  }

  private groanTimer = 1;
  /** Zombies groan and cats meow now and then while they're around. */
  private ambience(dt: number): void {
    this.groanTimer -= dt;
    if (this.groanTimer > 0) return;
    this.groanTimer = 1.2 + Math.random() * 2;
    const near = this.combat.enemies.filter((e) => Math.abs(e.z) < 50);
    const z = near.find((e) => e.type === 'zombie' || e.type === 'brute');
    const cat = near.find((e) => e.type === 'catship');
    if (cat && Math.random() < 0.5) sound.meow();
    else if (z) sound.groan();
  }

  private handleEvents(): void {
    const c = this.combat;
    for (const ev of c.events) {
      playEventSound(ev);
      switch (ev.kind) {
        case 'shot': {
          const from = new THREE.Vector3(c.carX, 2, 0);
          const to = new THREE.Vector3(ev.x, ev.y + 1, ev.z);
          const color = ev.weapon === 'catnip' ? 0x7dff6a : ev.weapon === 'shells' ? 0xffa040 : ev.weapon === 'rocks' ? 0xaaaaaa : 0xffee88;
          this.addLine(from, to, color, 0.08);
          if (ev.weapon === 'catnip' || ev.weapon === 'shells') this.addBurst(to, color, ev.weapon === 'catnip' ? 18 : 8);
          break;
        }
        case 'hit': {
          const g = this.meshes.get(ev.enemy);
          if (g) g.userData.flash = 0.1;
          break;
        }
        case 'kill': {
          const color = ev.type === 'zombie' ? 0x6fae3a : ev.type === 'outlaw' ? 0x7a4a2a : 0xd070ff;
          // Hordes die by the dozen: smaller bursts keep the frame rate up.
          this.addBurst(new THREE.Vector3(ev.x, ev.y + 1, ev.z), color, c.horde ? 6 : 16);
          break;
        }
        case 'carHit':
          this.shake = Math.min(1.2, this.shake + ev.dmg * 0.08);
          this.hitFlash = 0.3;
          break;
        case 'enemyShot': {
          const g = this.meshes.get(ev.enemy);
          const drone = g ? null : c.enemies.find((e) => e.id === ev.enemy);
          if (g || drone) {
            const muzzle = g ? g.position.clone().setY(1.6) : new THREE.Vector3(drone!.x, drone!.y - 0.3, drone!.z);
            this.addLine(muzzle, new THREE.Vector3(c.carX + (ev.hit ? 0 : 3), 1, 0), 0xff5533, 0.22);
            this.addBurst(muzzle, 0xffd040, 4);
          }
          break;
        }
        case 'throw':
          break;
        case 'missile': {
          this.addBurst(new THREE.Vector3(ev.x, 0.6, 0), 0x8a7a60, ev.hit ? 10 : 6);
          if (ev.hit) this.shake = Math.min(1.2, this.shake + 0.4);
          break;
        }
        case 'bail': {
          // The cat crew leaps out of the wrecked sweeper and scatters.
          for (let i = 0; i < ev.cats; i++) {
            const cat = angryCat([0xff9a3c, 0x3a3a3a, 0xf2f2f2, 0xb0b0b0][i % 4]);
            cat.scale.setScalar(1.6);
            cat.position.set(ev.x + (i - ev.cats / 2) * 0.8, 3, ev.z);
            this.root.add(cat);
            const v = new THREE.Vector3((i - (ev.cats - 1) / 2) * 5, 11 + i, 6);
            this.fx.push({ obj: cat, life: 1.4, max: 1.4, vel: v });
          }
          break;
        }
        case 'grab':
        case 'shakeOff': {
          const g = this.meshes.get(ev.enemy);
          if (g) this.addBurst(g.position.clone().setY(1.5), ev.kind === 'grab' ? 0xff4040 : 0x6fae3a, 8);
          break;
        }
        case 'laser': {
          const g = this.meshes.get(ev.enemy);
          if (g) this.addLine(g.position.clone(), new THREE.Vector3(c.carX, 1, 0), 0xff40ff, 0.35);
          break;
        }
        case 'slam': {
          const g = this.meshes.get(ev.enemy);
          const at = new THREE.Vector3(ev.x, 0.5, 0);
          const color = ({ mothership: 0xff40ff, warrig: 0xffa030, hermit: 0xb08a5a, pizza: 0xffc040 } as Record<string, number>)[this.combat.boss ?? ''] ?? 0x8fbf5a;
          if (g && this.combat.boss !== 'brute') this.addLine(g.position.clone().setY(g.position.y + 1), at, color, 0.4);
          this.addBurst(at, color, 24);
          this.addRing(color, ev.x);
          this.shake = Math.min(1.5, this.shake + 0.6);
          break;
        }
        case 'horn':
          this.addRing(0xffffff);
          break;
        case 'boost':
          this.addRing(0x40c0ff);
          break;
        default:
          break;
      }
    }
    c.events.length = 0;
  }

  private syncEnemies(): void {
    const alive = new Set<number>();
    this.syncHorde();
    this.syncSwarm();
    for (const e of this.combat.enemies) {
      if (e.horde || e.type === 'drone') continue;
      alive.add(e.id);
      let g = this.meshes.get(e.id);
      if (!g) {
        g = buildEnemy(e.type);
        castShadows(g, this.shadows);
        this.meshes.set(e.id, g);
        this.root.add(g);
      }
      g.position.set(e.x, e.y, e.z);
      animateEnemy(g, e, this.combat.time);
      const bar = g.getObjectByName('hp') as THREE.Mesh;
      bar.scale.x = Math.max(0.01, e.hp / e.maxHp);
      bar.visible = e.hp < e.maxHp;
      bar.lookAt(this.camera.position);
      const ring = g.getObjectByName('target')!;
      ring.visible = e.id === this.lockedTarget;
      ring.rotation.z += 0.05;
      const flash = (g.userData.flash as number) ?? 0;
      g.userData.flash = Math.max(0, flash - 1 / 60);
      const body = g.getObjectByName('body') as THREE.Mesh;
      if (body) body.visible = !(flash > 0 && Math.floor(flash * 60) % 2 === 0);
      // Every attack is telegraphed: a blinking warning light over the enemy while it winds up.
      if (!isBoss(e.type)) {
        let w = g.getObjectByName('windup') as THREE.Mesh | undefined;
        if (!w && e.charging) {
          w = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd040 }));
          w.name = 'windup';
          w.position.y = e.type === 'catship' ? -0.9 : 2.8;
          g.add(w);
        }
        if (w) {
          w.visible = e.charging && Math.floor(this.combat.time * 10) % 2 === 0;
          w.scale.setScalar(1 + Math.sin(this.combat.time * 20) * 0.2);
        }
      }
    }
    for (const [id, g] of this.meshes) {
      if (!alive.has(id)) {
        this.root.remove(g);
        disposeTree(g);
        this.meshes.delete(id);
        if (this.lockedTarget === id) this.lockedTarget = null;
      }
    }
  }

  /** Draws horde zombies as one instanced mesh (the model on Medium and High, simple shapes on Low). */
  private syncHorde(): void {
    const list = this.combat.enemies.filter((e) => e.horde && e.type === 'zombie');
    if (!this.horde) {
      if (!list.length) return;
      const geo = modelGeometry('zombie') ?? simpleZombieGeometry();
      const mat = modelGeometry('zombie') ? modelMaterial : lit({ vertexColors: true, flatShading: true });
      this.horde = new THREE.InstancedMesh(geo, mat, 48);
      this.horde.frustumCulled = false;
      this.horde.castShadow = this.shadows;
      this.root.add(this.horde);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3(1.35, 1.35, 1.35);
    const t = this.combat.time;
    const n = Math.min(list.length, this.horde.count === 0 ? 48 : 48);
    for (let i = 0; i < n; i++) {
      const e = list[i];
      const swing = Math.sin(t * 6 + e.id) * (e.stunned > 0 ? 0.05 : 0.5);
      pos.set(e.x, e.y + Math.abs(swing) * 0.15, e.z);
      q.setFromEuler(euler.set(0, e.stunned > 0 ? Math.sin(t * 20) * 0.3 : 0, Math.sin(t * 3 + e.id) * 0.12));
      this.horde.setMatrixAt(i, m.compose(pos, q, scale));
    }
    this.horde.count = n;
    this.horde.instanceMatrix.needsUpdate = true;
  }

  /** Draws the drones as one instanced paper plane, banking as they weave; red while winding up to shoot. */
  private syncSwarm(): void {
    const list = this.combat.enemies.filter((e) => e.type === 'drone');
    if (!this.swarm) {
      if (!list.length) return;
      this.swarm = new THREE.InstancedMesh(paperPlaneGeometry(), lit({ color: 0xffffff, side: THREE.DoubleSide }), 32);
      this.swarm.frustumCulled = false;
      this.swarm.castShadow = this.shadows;
      this.root.add(this.swarm);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3(2, 2, 2);
    const paper = new THREE.Color(0xf4f1e6);
    const red = new THREE.Color(0xff3030);
    const t = this.combat.time;
    const n = Math.min(list.length, 32);
    for (let i = 0; i < n; i++) {
      const e = list[i];
      pos.set(e.x, e.y, e.z);
      // Nose dipped toward the car so the wings show from the camera above.
      q.setFromEuler(euler.set(0.65, 0, Math.sin(t * 1.3 + e.id) * 0.5));
      this.swarm.setMatrixAt(i, m.compose(pos, q, scale));
      // Blink red during the wind-up so there is time to dodge.
      this.swarm.setColorAt(i, e.charging && Math.sin(t * 30) > -0.3 ? red : paper);
    }
    this.swarm.count = n;
    this.swarm.instanceMatrix.needsUpdate = true;
    if (this.swarm.instanceColor) this.swarm.instanceColor.needsUpdate = true;
  }

  /** Thrown junk tumbling through the air toward the lane it was aimed at. */
  private syncMissiles(): void {
    const live = new Set<number>();
    for (const ms of this.combat.missiles) {
      live.add(ms.id);
      let mesh = this.missiles.get(ms.id);
      if (!mesh) {
        if (ms.from === 'karen') {
          // A flying cat, legs out.
          mesh = modelsWanted() ? angryCat([0xff9a3c, 0x3a3a3a, 0xf2f2f2, 0xb0b0b0][ms.id % 4]) : simpleCat();
          mesh.scale.setScalar(1.1);
        } else if (ms.from === 'sweeper') {
          // A bulging trash bag.
          mesh = new THREE.Mesh(new THREE.SphereGeometry(0.4, 7, 5).scale(1, 1.2, 1), this.trash);
        } else if (ms.from === 'pizza') {
          // A spinning pizza, big enough to see coming.
          mesh = new THREE.Group();
          pizzaGeometryParts(mesh, 0.55);
        } else mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.6), this.junk);
        this.missiles.set(ms.id, mesh);
        this.root.add(mesh);
      }
      const p = missileAt(ms);
      mesh.position.set(p.x, p.y, p.z);
      if (ms.from === 'pizza') mesh.rotation.set(0.5, ms.t * 14, 0);
      else mesh.rotation.set(ms.t * 9, ms.t * 6, 0);
    }
    for (const [id, mesh] of this.missiles) {
      if (live.has(id)) continue;
      this.root.remove(mesh);
      disposeTree(mesh);
      this.missiles.delete(id);
    }
  }

  private addLine(a: THREE.Vector3, b: THREE.Vector3, color: number, life: number): void {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true }));
    this.root.add(line);
    this.fx.push({ obj: line, life, max: life });
  }

  private addBurst(at: THREE.Vector3, color: number, n: number): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
    const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(at);
      this.root.add(m);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).multiplyScalar(14);
      this.fx.push({ obj: m, life: 0.7, max: 0.7, vel: v });
    }
  }

  private addRing(color: number, x = this.combat.carX): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.6, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.5, 0);
    this.root.add(ring);
    this.fx.push({ obj: ring, life: 0.6, max: 0.6, vel: new THREE.Vector3(0, 0, 0) });
  }

  private updateFx(dt: number): void {
    for (const f of this.fx) {
      f.life -= dt;
      const t = Math.max(0, f.life / f.max);
      const mat = (f.obj as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (mat) mat.opacity = t;
      else f.obj.rotation.y += dt * 8; // a leaping cat spins as it goes
      if (f.vel) {
        if (f.obj instanceof THREE.Mesh && f.obj.geometry.type === 'RingGeometry') {
          f.obj.scale.setScalar(1 + (1 - t) * 18);
        } else {
          f.vel.y -= 25 * dt;
          f.obj.position.addScaledVector(f.vel, dt);
        }
      }
    }
    const dead = this.fx.filter((f) => f.life <= 0);
    for (const f of dead) {
      this.root.remove(f.obj);
      const m = f.obj as THREE.Mesh;
      if (!m.isMesh) {
        disposeTree(f.obj);
        continue;
      }
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.fx = this.fx.filter((f) => f.life > 0);
  }

  private buildRoad(layout: FightRoad): void {
    const g = new THREE.Group();
    const lay = (mesh: THREE.Mesh, x: number, y: number) => {
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, y, -60);
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    for (const st of layout.strips) {
      const tex = st.kind === 'local' ? this.roadTex : makeLaneTexture(st.kind);
      // The lane textures are drawn four lanes wide (two for 'carriageway2' across half the canvas).
      tex.repeat.set(1, STRIP_LEN / 16);
      const m = lay(new THREE.Mesh(new THREE.PlaneGeometry(st.width, STRIP_LEN), lit({ map: tex })), st.x, 0.02);
      if (st.flipped) m.rotation.z = Math.PI;
      this.scrolling.push({ tex, dir: st.flipped ? -1 : 1 });
    }
    const shoulderMat = lit({ color: 0x5a5a5e });
    for (const sh of layout.shoulders) lay(new THREE.Mesh(new THREE.PlaneGeometry(sh.width, STRIP_LEN), shoulderMat), sh.x, 0.015);
    this.root.add(g);
  }

  private buildProps(layout: FightRoad, biome: BiomeId): void {
    const info = BIOMES[biome];
    const kinds = Object.entries(info.plants) as [PlantKind, number][];
    const total = kinds.reduce((a, [, w]) => a + w, 0);
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pickPlant = (): PlantKind => {
      let r = rand() * total;
      for (const [k, w] of kinds) if ((r -= w) <= 0) return k;
      return kinds[0][0];
    };
    const postGeo = new THREE.BoxGeometry(0.3, 2.5, 0.3).translate(0, 1.25, 0);
    const postMat = lit({ color: 0xf0f0f0 });
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = lit({ color: 0x8c7660 });
    for (let i = 0; i < 40; i++) {
      const z = -150 + i * 4.5;
      // Reflector posts at both edges (and along the median of a divided road).
      if (i % 2 === 0) {
        for (const x of [layout.left - 1, layout.right + 1, ...(layout.median ? [layout.median.x + layout.median.width / 2 - 0.6] : [])]) {
          if (i % 4 === 0 && x === layout.left - 1 && layout.median) continue;
          const post = new THREE.Mesh(postGeo, postMat);
          post.position.set(x, 0, z);
          this.props.add(post);
        }
      }
      // Plants and rocks out past the edges, as thick as the biome grows them.
      for (const side of [-1, 1]) {
        if (rand() > Math.max(0.25, info.density)) continue;
        const edge = side < 0 ? layout.left : layout.right;
        const x = edge + side * (4 + rand() * 26);
        let m: THREE.Object3D;
        if (rand() < Math.max(0.15, info.rocks)) {
          m = modelMesh(pick(rand, ['rock-1', 'rock-2', 'rock-3'] as const)) ?? new THREE.Mesh(rockGeo, rockMat);
          m.scale.setScalar(0.6 + rand() * 2);
        } else {
          const kind = pickPlant();
          const names = FIGHT_PLANTS[kind];
          const useModel = names && (!FIGHT_TREES.has(kind) || treeModelsWanted());
          m = (useModel ? modelMesh(pick(rand, names)) : null) ?? simplePlant(kind);
          m.scale.setScalar(0.8 + rand() * 0.5);
        }
        m.rotation.y = rand() * Math.PI * 2;
        m.position.set(x, 0, z + rand() * 3);
        this.props.add(m);
      }
    }
  }

  dispose(): void {
    if (!this.onRoad) this.atmosphere.dispose();
    else this.root.parent?.remove(this.root);
    if (this.swarm) {
      this.swarm.geometry.dispose();
      (this.swarm.material as THREE.Material).dispose();
      this.swarm.dispose();
      this.root.remove(this.swarm);
    }
    if (this.horde) {
      if (!this.horde.geometry.userData.shared && this.horde.material !== modelMaterial) {
        this.horde.geometry.dispose();
        (this.horde.material as THREE.Material).dispose();
      }
      this.horde.dispose();
      this.root.remove(this.horde);
    }
    for (const mesh of this.missiles.values()) disposeTree(mesh);
    this.junk.dispose();
    this.trash.dispose();
    for (const g of this.meshes.values()) disposeTree(g);
    for (const f of this.fx) disposeTree(f.obj);
    disposeTree(this.root);
    this.roadTex.dispose();
    for (const r of this.scrolling) if (r.tex !== this.roadTex) r.tex.dispose();
  }
}

// ---------------------------------------------------------------- road and roadside

const STRIP_LEN = 200;

/** What grows by the road in a fight, per plant kind: CC0 models when loaded, else simple shapes. */
const FIGHT_PLANTS: Partial<Record<PlantKind, ModelName[]>> = {
  saguaro: ['cactus-1', 'cactus-2', 'cactus-3'],
  shrub: ['bush-1', 'bush-2'],
  grass: ['grass'],
  crops: ['corn', 'wheat'],
  oak: ['oak-1', 'oak-2', 'oak-3'],
  pine: ['pine-1', 'pine-2'],
  palm: ['palm-1', 'palm-2'],
};
const FIGHT_TREES = new Set<PlantKind>(['oak', 'pine', 'palm']);

/** A plain stand-in plant for Low (or before the models load). */
function simplePlant(kind: PlantKind): THREE.Object3D {
  const g = new THREE.Group();
  const lam = (c: number) => lit({ color: c, flatShading: true });
  if (kind === 'oak' || kind === 'pine' || kind === 'palm') {
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 2.5, 6).translate(0, 1.25, 0), lam(0x6b4a2a)));
    const crown = kind === 'pine' ? new THREE.ConeGeometry(1.8, 5, 7).translate(0, 4.5, 0) : new THREE.IcosahedronGeometry(2, 0).translate(0, 3.8, 0);
    g.add(new THREE.Mesh(crown, lam(kind === 'pine' ? 0x2f5a35 : kind === 'palm' ? 0x4f8a3a : 0x4a7a3a)));
  } else if (kind === 'saguaro') {
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 4.5, 7).translate(0, 2.25, 0), lam(0x4f7a3a)));
  } else {
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 0).translate(0, 0.5, 0), lam(kind === 'crops' ? 0xc9b25a : 0x6f8a45)));
  }
  return g;
}

// ---------------------------------------------------------------- enemy models

const SAMPLE_ENEMIES: Partial<Record<EnemyType, { build: () => THREE.Group; hitRadius: number; barY: number }>> = {
  outlaw: { build: sampleOutlaw, hitRadius: 1.7, barY: 3.0 },
  catship: { build: sampleCatship, hitRadius: 2.6, barY: 2.8 },
  mothership: { build: sampleMothership, hitRadius: 8, barY: 9.6 },
  brute: { build: sampleBrute, hitRadius: 1.3, barY: 2.9 },
  warrig: { build: sampleWarRig, hitRadius: 3.6, barY: 5 },
  hermit: { build: sampleHermit, hitRadius: 1.2, barY: 2.9 },
  pizza: { build: samplePizzaCar, hitRadius: 2.4, barY: 3.6 },
  sweeper: { build: sampleSweeper, hitRadius: 3.0, barY: 4.8 },
  karen: { build: sampleKaren, hitRadius: 1.4, barY: 2.7 },
  drones: { build: sampleCommandDrone, hitRadius: 3.5, barY: 2.2 },
};

/** Low graphics versions of the newer bosses (the older ones are built inline below). */
const SIMPLE_BOSSES: Partial<Record<EnemyType, { build: () => THREE.Group; hitRadius: number; barY: number }>> = {
  hermit: { build: simpleHermit, hitRadius: 1.2, barY: 2.9 },
  pizza: { build: simplePizzaCar, hitRadius: 2.4, barY: 3.4 },
  sweeper: { build: simpleSweeper, hitRadius: 3.0, barY: 4.8 },
  karen: { build: simpleKaren, hitRadius: 1.4, barY: 2.7 },
  drones: { build: simpleCommandDrone, hitRadius: 3.5, barY: 2.2 },
};

export function buildEnemy(type: EnemyType): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';
  g.add(body);
  const box = (w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0, name = '') => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lit({ color }));
    m.position.set(x, y, z);
    m.name = name;
    body.add(m);
    return m;
  };
  let hitRadius = 1.4;
  let barY = 2.6;
  const sample = (modelsWanted() ? SAMPLE_ENEMIES[type] : undefined) ?? SIMPLE_BOSSES[type];
  if (sample) {
    // Detailed models built in code (Medium and High); Low keeps the boxes below.
    const s = sample.build();
    body.add(...[...s.children]);
    hitRadius = sample.hitRadius;
    barY = sample.barY;
  } else if (type === 'warrig') {
    box(3.4, 2.4, 5, 0x5b4a3a, 0, 1.7, -2.2); // trailer
    box(3.2, 2.2, 2.6, 0x7a2a1a, 0, 1.6, 1.8); // cab
    box(2.6, 0.9, 0.2, 0x9ff0ff, 0, 2.2, 3.12); // windscreen
    box(3.6, 0.8, 0.5, 0x888888, 0, 0.7, 3.3); // plough
    for (let i = -3; i <= 3; i++) box(0.25, 0.25, 0.9, 0xcccccc, i * 0.5, 0.7, 3.8); // spikes
    for (const x of [-1.3, 1.3]) box(0.3, 1.8, 0.3, 0x333333, x, 3.2, 0.6); // smokestacks
    for (const [x, z] of [[-1.6, 2], [1.6, 2], [-1.6, -1], [1.6, -1], [-1.6, -3.5], [1.6, -3.5]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.5, 12), lit({ color: 0x151515 }));
      w.rotation.z = Math.PI / 2;
      w.position.set(x, 0.7, z);
      body.add(w);
    }
    box(0.9, 0.7, 0.9, 0x444444, 0, 3.3, -2.5, 'turret');
    box(0.25, 0.25, 1.8, 0x222222, 0, 3.4, -1.4);
    box(1.2, 1, 0.1, 0xeeeeee, 0, 1.6, 3.6); // skull plate
    box(0.25, 0.25, 0.05, 0x111111, -0.25, 1.75, 3.66);
    box(0.25, 0.25, 0.05, 0x111111, 0.25, 1.75, 3.66);
    hitRadius = 3.6;
    barY = 5;
  } else if (type === 'mothership') {
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(7, 9, 1.6, 24), lit({ color: 0x8a8fb0 }));
    body.add(hull);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(8.6, 0.35, 6, 32), lit({ color: 0x5a3f8a }));
    rim.rotation.x = Math.PI / 2;
    body.add(rim);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(3.4, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      lit({ color: 0x9ff0ff, transparent: true, opacity: 0.6 }),
    );
    dome.position.y = 0.8;
    body.add(dome);
    const head = new THREE.Mesh(new THREE.SphereGeometry(1.7, 14, 10), lit({ color: 0xf2f2f2 }));
    head.position.y = 2;
    body.add(head);
    for (const x of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.2, 4), lit({ color: 0xf2f2f2 }));
      ear.position.set(x, 3.5, 0);
      body.add(ear);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: 0x40a0ff }));
      eye.position.set(x * 0.6, 2.2, 1.5);
      body.add(eye);
    }
    // Her crown.
    for (let i = 0; i < 5; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.8, 4), lit({ color: 0xffd23f }));
      const a = (i / 5) * Math.PI * 2;
      spike.position.set(Math.cos(a) * 0.8, 3.9, Math.sin(a) * 0.8);
      body.add(spike);
    }
    for (let i = 0; i < 14; i++) {
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffe040 }));
      const a = (i / 14) * Math.PI * 2;
      light.position.set(Math.cos(a) * 8.2, -0.5, Math.sin(a) * 8.2);
      light.name = 'light';
      body.add(light);
    }
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(3, 14, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff40ff, transparent: true, opacity: 0.3, side: THREE.DoubleSide }),
    );
    beam.position.y = -7.5;
    beam.name = 'charge';
    beam.visible = false;
    body.add(beam);
    hitRadius = 8;
    barY = 5.5;
  } else if (type === 'zombie' && (hdModel('zombie') || modelMesh('zombie'))) {
    // Detailed zombie once loaded, else the CC0 one (Medium and High), at the same 2.3 height.
    body.add(hdZombie() ?? modelMesh('zombie')!);
  } else if (type === 'zombie' || type === 'brute') {
    box(0.8, 1.1, 0.5, 0x4a5d7a, 0, 1.3); // torn shirt
    box(0.6, 0.6, 0.6, 0x8fbf5a, 0, 2.15); // head
    box(0.25, 0.25, 0.7, 0x8fbf5a, -0.5, 1.6, 0.3, 'armL');
    box(0.25, 0.25, 0.7, 0x8fbf5a, 0.5, 1.6, 0.3, 'armR');
    box(0.3, 0.8, 0.3, 0x3b3328, -0.2, 0.4, 0, 'legL');
    box(0.3, 0.8, 0.3, 0x3b3328, 0.2, 0.4, 0, 'legR');
    box(0.12, 0.12, 0.05, 0xff2020, -0.14, 2.2, 0.3);
    box(0.12, 0.12, 0.05, 0xff2020, 0.14, 2.2, 0.3);
    if (type === 'brute') {
      // Overalls and a road-sign club.
      box(0.85, 0.6, 0.55, 0x2f5f9a, 0, 0.95);
      box(0.08, 1.4, 0.08, 0x777777, 0.62, 1.4, 0.75);
      box(0.5, 0.5, 0.05, 0xd13b2c, 0.62, 2.2, 0.75);
      hitRadius = 1.3;
    }
  } else if (type === 'outlaw') {
    box(0.4, 0.7, 2.2, 0x222222, 0, 0.6); // bike
    box(0.2, 0.9, 0.9, 0x111111, 0, 0.45, 0.9);
    box(0.2, 0.9, 0.9, 0x111111, 0, 0.45, -0.9);
    box(0.7, 0.9, 0.5, 0x7a4a2a, 0, 1.5); // leather jacket
    box(0.5, 0.5, 0.5, 0xd8a77a, 0, 2.2);
    box(1.0, 0.12, 1.0, 0x3a2a1a, 0, 2.5); // hat brim
    box(0.55, 0.35, 0.55, 0x3a2a1a, 0, 2.7);
    box(0.15, 0.15, 0.8, 0x555555, 0.45, 1.6, 0.4); // gun
    hitRadius = 1.7;
    barY = 3.2;
  } else {
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 0.6, 16), lit({ color: 0xa0a8c0 }));
    body.add(hull);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      lit({ color: 0x9ff0ff, transparent: true, opacity: 0.7 }),
    );
    dome.position.y = 0.3;
    body.add(dome);
    // The cat pilot.
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), lit({ color: 0xff9a3c }));
    head.position.y = 0.75;
    body.add(head);
    for (const x of [-0.3, 0.3]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 4), lit({ color: 0xff9a3c }));
      ear.position.set(x, 1.25, 0);
      body.add(ear);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), new THREE.MeshBasicMaterial({ color: 0x40ff60 }));
      eye.position.set(x * 0.6, 0.8, 0.48);
      body.add(eye);
    }
    for (let i = 0; i < 6; i++) {
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffe040 }));
      const a = (i / 6) * Math.PI * 2;
      light.position.set(Math.cos(a) * 2.3, -0.1, Math.sin(a) * 2.3);
      light.name = 'light';
      body.add(light);
    }
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(1.2, 6, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff40ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    );
    beam.position.y = -3.2;
    beam.name = 'charge';
    beam.visible = false;
    body.add(beam);
    hitRadius = 2.6;
    barY = 1.9;
  }
  if (type === 'mothership' && body.getObjectByName('hd')) addQueen(body);
  const hitbox = new THREE.Mesh(new THREE.SphereGeometry(hitRadius, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
  hitbox.position.y = type === 'catship' || type === 'mothership' || type === 'drones' ? 0.2 : type === 'warrig' ? 1.8 : type === 'pizza' ? 1.4 : type === 'sweeper' ? 2.0 : 1.3;
  hitbox.name = 'hitbox';
  g.add(hitbox);
  const hp = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.2), new THREE.MeshBasicMaterial({ color: 0xff3030, depthTest: false }));
  hp.position.y = barY;
  hp.name = 'hp';
  g.add(hp);
  const target = new THREE.Mesh(
    new THREE.RingGeometry(hitRadius * 0.9, hitRadius, 4, 1),
    new THREE.MeshBasicMaterial({ color: 0xff2a2a, side: THREE.DoubleSide, depthTest: false }),
  );
  target.position.y = hitbox.position.y;
  target.name = 'target';
  target.visible = false;
  g.add(target);
  if (type === 'outlaw') g.rotation.y = Math.PI;
  if (type === 'warrig' || type === 'pizza' || type === 'sweeper') {
    // Drives away from the car, rear facing us.
    g.rotation.y = Math.PI;
    hp.rotation.y = Math.PI;
  }
  // A bit larger than life so they read well on a phone screen.
  const scale: Record<EnemyType, number> = { zombie: 1.35, outlaw: 1.35, catship: 1.1, brute: 4.2, warrig: 1.1, mothership: 1, hermit: 1.9, pizza: 1.15, sweeper: 1.3, karen: 2.0, drones: 1.2, drone: 1.5 };
  g.scale.setScalar(scale[type]);
  return g;
}

/**
 * The rigged Cat Queen stands on top of the generated mothership, between its
 * ears, facing the car (Medium and High, once both have loaded).
 */
function addQueen(body: THREE.Object3D): void {
  const q = person('cat_queen', 5.4);
  if (!q) return;
  body.updateMatrixWorld(true);
  const hd = body.getObjectByName('hd')!;
  const box = new THREE.Box3().setFromObject(hd);
  // The ship's top is its ears; she stands a little lower, on the dome in front of them.
  q.obj.position.set(0, box.min.y + (box.max.y - box.min.y) * 0.78, box.max.z * 0.25);
  q.obj.name = 'queen';
  q.play('idle');
  body.add(q.obj);
  body.userData.queen = q;
  // With her on top it stands taller than the old ship: smaller and lower, so she stays below the top of a phone screen.
  body.scale.setScalar(0.8);
  body.position.y = -4;
}

function animateEnemy(g: THREE.Group, e: Enemy, t: number): void {
  const body = g.getObjectByName('body')!;
  const queen = body.userData.queen as Person | undefined;
  if (queen) {
    // The new ship has a face, so it sways toward you instead of spinning; she swipes when the beam charges.
    const dt = Math.min(0.1, Math.max(0, t - ((body.userData.lastT as number) ?? t)));
    body.userData.lastT = t;
    queen.play(e.charging ? 'swipe' : 'idle', 1, 0.2);
    queen.update(dt);
    body.rotation.y = Math.sin(t * 0.5) * 0.25;
    const charge = body.getObjectByName('charge');
    if (charge) charge.visible = e.charging;
    body.traverse((o) => {
      if (o.name === 'light') ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(e.charging ? 0xff40ff : 0xffe040);
    });
    return;
  }
  if (e.type === 'zombie' || e.type === 'brute') {
    const swing = Math.sin(t * (e.type === 'brute' ? 2.5 : 6) + e.id) * 0.5 * (e.stunned > 0 ? 0.1 : 1);
    const legL = body.getObjectByName('legL');
    const legR = body.getObjectByName('legR');
    if (legL && legR) {
      legL.rotation.x = swing;
      legR.rotation.x = -swing;
    } else body.position.y = Math.abs(swing) * 0.15;
    body.rotation.z = Math.sin(t * 3 + e.id) * 0.12;
    body.rotation.y = e.stunned > 0 ? Math.sin(t * 20) * 0.3 : 0;
    if (e.type === 'brute') {
      // Raises both arms to wind up a stomp.
      for (const n of ['armL', 'armR']) {
        const arm = body.getObjectByName(n);
        if (arm) arm.rotation.x = e.charging ? -1.4 : 0;
      }
    }
  } else if (e.type === 'hermit') {
    // Hops about, flails, and raises his arms to throw (both for the big one).
    const legL = body.getObjectByName('legL');
    const legR = body.getObjectByName('legR');
    const hop = e.y > 0.1 ? 0.8 : Math.sin(t * 5 + e.id) * 0.3;
    if (legL && legR) {
      legL.rotation.x = hop;
      legR.rotation.x = -hop;
    }
    body.rotation.z = Math.sin(t * 4) * 0.1;
    const throwing = (e.throwTimer ?? 9) < 0.6;
    const armL = body.getObjectByName('armL');
    const armR = body.getObjectByName('armR');
    if (armL) armL.rotation.x = e.charging ? -2.6 : Math.sin(t * 7) * 0.4;
    if (armR) armR.rotation.x = e.charging || throwing ? -2.6 : Math.sin(t * 7 + 1) * 0.4;
  } else if (e.type === 'drones') {
    body.rotation.x = 0.5; // tipped toward the camera so its wings show
    body.rotation.z = Math.sin(t * 1.2) * 0.12;
    body.traverse((o) => {
      if (o.name === 'brush') o.rotation.y += 0.6;
      if (o.name === 'light') o.visible = e.charging ? Math.sin(t * 30) > 0 : Math.sin(t * 4) > -0.5;
    });
  } else if (e.type === 'karen') {
    body.rotation.z = Math.sin(t * 2.2) * 0.04;
    const throwing = (e.throwTimer ?? 9) < 0.6;
    const armL = body.getObjectByName('armL');
    const armR = body.getObjectByName('armR');
    // Shakes her fist, raises an arm to throw, and both for the big one.
    if (armL) armL.rotation.x = e.charging ? -2.6 : Math.sin(t * 9) * 0.3 - 0.4;
    if (armR) armR.rotation.x = e.charging || throwing ? -2.6 : 0;
    body.traverse((o) => {
      if (o.name === 'tail') o.rotation.y = Math.sin(t * 8 + o.id) * 0.6;
    });
  } else if (e.type === 'sweeper') {
    body.rotation.z = Math.sin(t * 2) * 0.02;
    body.traverse((o) => {
      if (o.name === 'brush') o.rotation.y += 0.3;
      if (o.name === 'tail') o.rotation.y = Math.sin(t * 8 + o.id) * 0.6;
      if (o.name === 'light') o.visible = Math.sin(t * 10) > 0 || e.charging;
    });
  } else if (e.type === 'pizza') {
    body.rotation.z = Math.sin(t * 2.4) * 0.05;
    body.position.y = Math.abs(Math.sin(t * 9)) * 0.06;
  } else if (e.type === 'outlaw') {
    body.rotation.z = Math.sin(t * 2 + e.id) * 0.08;
  } else if (e.type === 'warrig') {
    body.rotation.z = Math.sin(t * 3) * 0.02;
    const turret = body.getObjectByName('turret');
    if (turret) turret.rotation.y = e.charging ? Math.sin(t * 20) * 0.2 : 0;
  } else {
    body.rotation.y += e.type === 'mothership' ? 0.008 : 0.03;
    const charge = body.getObjectByName('charge')!;
    charge.visible = e.charging;
    body.traverse((o) => {
      if (o.name === 'light') ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(e.charging ? 0xff40ff : 0xffe040);
    });
  }
}

function playEventSound(ev: CombatState['events'][number]): void {
  switch (ev.kind) {
    case 'shot':
      sound.shot(ev.weapon);
      break;
    case 'kill':
      sound.kill(isBoss(ev.type) ? 'boss' : ev.type === 'drone' ? 'catship' : ev.type);
      break;
    case 'carHit':
      sound.carHit();
      break;
    case 'enemyShot':
      sound.enemyShot();
      break;
    case 'charge':
      sound.charge();
      break;
    case 'laser':
      sound.laser();
      break;
    case 'slam':
      sound.slam(ev.hit);
      break;
    case 'horn':
      sound.horn();
      break;
    case 'boost':
      sound.boost();
      break;
    case 'empty':
      sound.empty();
      break;
    default:
      break;
  }
}

/** A simple zombie as one geometry with its colours in the vertices, for drawing a horde on Low. */
function simpleZombieGeometry(): THREE.BufferGeometry {
  const parts: [number, number, number, number, number, number, number][] = [
    [0.8, 1.1, 0.5, 0x4a5d7a, 0, 1.3, 0],
    [0.6, 0.6, 0.6, 0x8fbf5a, 0, 2.15, 0],
    [0.25, 0.25, 0.7, 0x8fbf5a, -0.5, 1.6, 0.3],
    [0.25, 0.25, 0.7, 0x8fbf5a, 0.5, 1.6, 0.3],
    [0.3, 0.8, 0.3, 0x3b3328, -0.2, 0.4, 0],
    [0.3, 0.8, 0.3, 0x3b3328, 0.2, 0.4, 0],
  ];
  const geos = parts.map(([w, h, d, color, x, y, z]) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.translate(x, y, z);
    const c = new THREE.Color(color);
    const n = g.getAttribute('position').count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n).fill(0).flatMap(() => [c.r, c.g, c.b]), 3));
    return g;
  });
  const merged = mergeGeometries(geos)!;
  geos.forEach((g) => g.dispose());
  return merged;
}
