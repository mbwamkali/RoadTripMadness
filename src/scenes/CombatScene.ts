import * as THREE from 'three';
import {
  combatOutcome,
  fireAt,
  ROAD_SPEED,
  stepCombat,
  type CombatState,
  type Enemy,
  type EnemyType,
} from '../game/combat';
import { damage, type GameState } from '../game/state';
import { addLights, disposeTree, makeCar, makeRoadTexture, type GameScene } from './common';

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
  camera = new THREE.PerspectiveCamera(60, 1, 0.3, 400);
  private car = makeCar();
  private roadTex = makeRoadTexture();
  private road: THREE.Mesh;
  private props: THREE.Group = new THREE.Group();
  private meshes = new Map<number, THREE.Group>();
  private fx: Fx[] = [];
  private raycaster = new THREE.Raycaster();
  private lockedTarget: number | null = null;
  private holding = false;
  private done = false;
  private shake = 0;

  constructor(
    readonly combat: CombatState,
    private state: GameState,
    private cb: CombatCallbacks,
  ) {
    this.scene.background = new THREE.Color(combat.title.includes('cat') ? 0x2a1f4a : 0xe8a868);
    this.scene.fog = new THREE.Fog(this.scene.background as THREE.Color, 60, 160);
    addLights(this.scene);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: 0xc89a62 }));
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    this.roadTex.repeat.set(1, 200 / 16);
    this.road = new THREE.Mesh(new THREE.PlaneGeometry(10, 200), new THREE.MeshLambertMaterial({ map: this.roadTex }));
    this.road.rotation.x = -Math.PI / 2;
    this.road.position.set(0, 0.02, -60);
    this.scene.add(this.road);

    // Roadside rocks and posts that scroll past to sell the speed.
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x8c7660 });
    const postGeo = new THREE.BoxGeometry(0.3, 2.5, 0.3).translate(0, 1.25, 0);
    const postMat = new THREE.MeshLambertMaterial({ color: 0xf0f0f0 });
    for (let i = 0; i < 40; i++) {
      const post = i % 2 === 0;
      const m = new THREE.Mesh(post ? postGeo : rockGeo, post ? postMat : rockMat);
      const side = i % 4 < 2 ? -1 : 1;
      m.position.set(side * (post ? 6.5 : 9 + Math.random() * 25), post ? 0 : 0.4, -150 + i * 4.5);
      if (!post) m.scale.setScalar(0.6 + Math.random() * 2.2);
      this.props.add(m);
    }
    this.scene.add(this.props);
    this.scene.add(this.car);
  }

  resize(w: number, h: number): void {
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
    for (const [id, g] of this.meshes) {
      const p = g.position.clone().setY(g.position.y + 1).project(this.camera);
      const d = Math.hypot(p.x - ndc.x, (p.y - ndc.y) * 0.8);
      if (d < 0.18 && (!near || d < near.d)) near = { id, d };
    }
    return near?.id ?? null;
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

    const speed = ROAD_SPEED * (c.boostTime > 0 ? 2.2 : 1);
    this.roadTex.offset.y += (speed * dt) / 16;
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

    this.shake = Math.max(0, this.shake - dt * 3);
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    this.camera.position.set(c.carX * 0.6 + sx, 9.5 + sy, 14);
    this.camera.lookAt(c.carX * 0.4, 0, -22);
    this.updateFx(dt);
    this.cb.onTick();

    const outcome = this.state.status === 'lost' ? 'wrecked' : combatOutcome(c);
    if (outcome) {
      this.done = true;
      this.state.kills += c.kills;
      this.cb.onEnd(outcome);
    }
  }

  private handleEvents(): void {
    const c = this.combat;
    for (const ev of c.events) {
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
          this.addBurst(new THREE.Vector3(ev.x, ev.y + 1, ev.z), color, 16);
          break;
        }
        case 'carHit':
          this.shake = Math.min(1.2, this.shake + ev.dmg * 0.08);
          break;
        case 'enemyShot': {
          const g = this.meshes.get(ev.enemy);
          if (g) this.addLine(g.position.clone().setY(1.5), new THREE.Vector3(c.carX + (ev.hit ? 0 : 3), 1, 0), 0xff5533, 0.1);
          break;
        }
        case 'laser': {
          const g = this.meshes.get(ev.enemy);
          if (g) this.addLine(g.position.clone(), new THREE.Vector3(c.carX, 1, 0), 0xff40ff, 0.35);
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
    for (const e of this.combat.enemies) {
      alive.add(e.id);
      let g = this.meshes.get(e.id);
      if (!g) {
        g = buildEnemy(e.type);
        this.meshes.set(e.id, g);
        this.scene.add(g);
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
    }
    for (const [id, g] of this.meshes) {
      if (!alive.has(id)) {
        this.scene.remove(g);
        disposeTree(g);
        this.meshes.delete(id);
        if (this.lockedTarget === id) this.lockedTarget = null;
      }
    }
  }

  private addLine(a: THREE.Vector3, b: THREE.Vector3, color: number, life: number): void {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true }));
    this.scene.add(line);
    this.fx.push({ obj: line, life, max: life });
  }

  private addBurst(at: THREE.Vector3, color: number, n: number): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
    const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(at);
      this.scene.add(m);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).multiplyScalar(14);
      this.fx.push({ obj: m, life: 0.7, max: 0.7, vel: v });
    }
  }

  private addRing(color: number): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.6, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(this.combat.carX, 0.5, 0);
    this.scene.add(ring);
    this.fx.push({ obj: ring, life: 0.6, max: 0.6, vel: new THREE.Vector3(0, 0, 0) });
  }

  private updateFx(dt: number): void {
    for (const f of this.fx) {
      f.life -= dt;
      const t = Math.max(0, f.life / f.max);
      const mat = (f.obj as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.opacity = t;
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
      this.scene.remove(f.obj);
      const m = f.obj as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.fx = this.fx.filter((f) => f.life > 0);
  }

  dispose(): void {
    for (const g of this.meshes.values()) disposeTree(g);
    for (const f of this.fx) disposeTree(f.obj);
    disposeTree(this.scene);
    this.roadTex.dispose();
  }
}

// ---------------------------------------------------------------- enemy models

function buildEnemy(type: EnemyType): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';
  g.add(body);
  const box = (w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0, name = '') => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
    m.position.set(x, y, z);
    m.name = name;
    body.add(m);
    return m;
  };
  let hitRadius = 1.4;
  let barY = 2.6;
  if (type === 'zombie') {
    box(0.8, 1.1, 0.5, 0x4a5d7a, 0, 1.3); // torn shirt
    box(0.6, 0.6, 0.6, 0x8fbf5a, 0, 2.15); // head
    box(0.25, 0.25, 0.7, 0x8fbf5a, -0.5, 1.6, 0.3, 'armL');
    box(0.25, 0.25, 0.7, 0x8fbf5a, 0.5, 1.6, 0.3, 'armR');
    box(0.3, 0.8, 0.3, 0x3b3328, -0.2, 0.4, 0, 'legL');
    box(0.3, 0.8, 0.3, 0x3b3328, 0.2, 0.4, 0, 'legR');
    box(0.12, 0.12, 0.05, 0xff2020, -0.14, 2.2, 0.3);
    box(0.12, 0.12, 0.05, 0xff2020, 0.14, 2.2, 0.3);
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
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 0.6, 16), new THREE.MeshLambertMaterial({ color: 0xa0a8c0 }));
    body.add(hull);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0x9ff0ff, transparent: true, opacity: 0.7 }),
    );
    dome.position.y = 0.3;
    body.add(dome);
    // The cat pilot.
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), new THREE.MeshLambertMaterial({ color: 0xff9a3c }));
    head.position.y = 0.75;
    body.add(head);
    for (const x of [-0.3, 0.3]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 4), new THREE.MeshLambertMaterial({ color: 0xff9a3c }));
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
  const hitbox = new THREE.Mesh(new THREE.SphereGeometry(hitRadius, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
  hitbox.position.y = type === 'catship' ? 0.2 : 1.3;
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
  // A bit larger than life so they read well on a phone screen.
  g.scale.setScalar(type === 'catship' ? 1.1 : 1.35);
  return g;
}

function animateEnemy(g: THREE.Group, e: Enemy, t: number): void {
  const body = g.getObjectByName('body')!;
  if (e.type === 'zombie') {
    const swing = Math.sin(t * 6 + e.id) * 0.5 * (e.stunned > 0 ? 0.1 : 1);
    body.getObjectByName('legL')!.rotation.x = swing;
    body.getObjectByName('legR')!.rotation.x = -swing;
    body.rotation.z = Math.sin(t * 3 + e.id) * 0.12;
    body.rotation.y = e.stunned > 0 ? Math.sin(t * 20) * 0.3 : 0;
  } else if (e.type === 'outlaw') {
    body.rotation.z = Math.sin(t * 2 + e.id) * 0.08;
  } else {
    body.rotation.y += 0.03;
    const charge = body.getObjectByName('charge')!;
    charge.visible = e.charging;
    body.traverse((o) => {
      if (o.name === 'light') ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(e.charging ? 0xff40ff : 0xffe040);
    });
  }
}
