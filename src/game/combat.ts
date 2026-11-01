import type { AmmoKind, Inventory } from './state';
import { makeRng, range, type Rng } from './rng';

/**
 * Combat rules, kept free of rendering so they can be tested.
 *
 * Coordinates: the car sits at z = 0 and the road scrolls toward +z.
 * x is across the road (lanes at about -2.5 .. 2.5), y is height.
 */

export type EnemyType = 'zombie' | 'outlaw' | 'catship';
export type WeaponKind = AmmoKind | 'rocks';

export interface Enemy {
  id: number;
  type: EnemyType;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  z: number;
  /** Generic timer: attack cooldown or charge time. */
  timer: number;
  charging: boolean;
  stunned: number;
  /** Where an outlaw wants to ride relative to the car. */
  holdZ: number;
  holdX: number;
}

export type CombatEvent =
  | { kind: 'shot'; weapon: WeaponKind; x: number; y: number; z: number }
  | { kind: 'hit'; enemy: number; dmg: number }
  | { kind: 'kill'; enemy: number; type: EnemyType; x: number; y: number; z: number }
  | { kind: 'carHit'; dmg: number; from: EnemyType }
  | { kind: 'enemyShot'; enemy: number; hit: boolean }
  | { kind: 'charge'; enemy: number }
  | { kind: 'laser'; enemy: number }
  | { kind: 'horn' }
  | { kind: 'boost' }
  | { kind: 'empty'; weapon: WeaponKind };

interface Spawn {
  t: number;
  type: EnemyType;
}

export interface CombatState {
  rng: Rng;
  time: number;
  /** Seconds the player has to survive to get away. */
  escapeAt: number;
  escape: number;
  carX: number;
  steer: number;
  weapon: WeaponKind;
  fireCooldown: number;
  hornCooldown: number;
  boostCooldown: number;
  boostTime: number;
  enemies: Enemy[];
  queue: Spawn[];
  nextId: number;
  events: CombatEvent[];
  kills: number;
  loot: Partial<Inventory>;
  title: string;
  gunDamage: number;
  ramDamage: number;
}

export const ENEMY_STATS: Record<EnemyType, { hp: number; name: string }> = {
  zombie: { hp: 2, name: 'Zombie' },
  outlaw: { hp: 4, name: 'Outlaw biker' },
  catship: { hp: 6, name: 'Alien cat saucer' },
};

export const WEAPONS: Record<WeaponKind, { name: string; dmg: number; cooldown: number; splash: number; ammo?: AmmoKind }> = {
  bullets: { name: 'Machine gun', dmg: 1, cooldown: 0.12, splash: 0, ammo: 'bullets' },
  shells: { name: 'Shotgun', dmg: 3, cooldown: 0.55, splash: 3, ammo: 'shells' },
  catnip: { name: 'Catnip bomb', dmg: 3, cooldown: 1, splash: 6, ammo: 'catnip' },
  rocks: { name: 'Rocks', dmg: 0.5, cooldown: 0.35, splash: 0 },
};

export const ROAD_SPEED = 14;
export const LANE_LIMIT = 2.6;
export const HORN_COOLDOWN = 8;
export const BOOST_COOLDOWN = 6;
export const BOOST_FUEL = 4;

export interface CombatOptions {
  seed: number;
  /** 0..1 progress through the trip; later fights are harder. */
  progress: number;
  /** An ambush while scavenging only has ground threats. */
  ambush?: boolean;
  /** Machine gun damage multiplier from the roof turret upgrade. */
  gunDamage?: number;
  /** Damage the car takes from hitting a zombie (ram plate upgrade lowers it). */
  ramDamage?: number;
}

export function createCombat(opts: CombatOptions): CombatState {
  const rng = makeRng(opts.seed);
  const p = Math.max(0, Math.min(1, opts.progress));
  const count = Math.round(5 + p * 9 + rng() * 3);
  const types: EnemyType[] = [];
  // Each fight leans toward one kind of threat so they feel distinct.
  const theme = opts.ambush ? (rng() < 0.6 ? 'zombie' : 'outlaw') : pickTheme(rng, p);
  for (let i = 0; i < count; i++) {
    const r = rng();
    let t: EnemyType = theme;
    if (r < 0.35) t = 'zombie';
    if (!opts.ambush && theme !== 'zombie' && r > 0.85 && p > 0.3) t = theme === 'outlaw' ? 'catship' : 'outlaw';
    types.push(t);
  }
  const queue = types.map((type, i) => ({ type, t: 0.8 + i * range(rng, 1.2, 2.4) }));
  const titles: Record<EnemyType, string> = {
    zombie: 'Zombie horde!',
    outlaw: 'Outlaws on your tail!',
    catship: 'Alien cat invasion!',
  };
  return {
    rng,
    time: 0,
    escapeAt: 45,
    escape: 0,
    carX: 0,
    steer: 0,
    weapon: 'bullets',
    fireCooldown: 0,
    hornCooldown: 0,
    boostCooldown: 0,
    boostTime: 0,
    enemies: [],
    queue,
    nextId: 1,
    events: [],
    kills: 0,
    loot: {},
    title: titles[theme],
    gunDamage: opts.gunDamage ?? 1,
    ramDamage: opts.ramDamage ?? 6,
  };
}

function pickTheme(rng: Rng, p: number): EnemyType {
  const r = rng();
  if (p < 0.15) return 'zombie';
  if (p < 0.35) return r < 0.55 ? 'zombie' : 'outlaw';
  if (r < 0.4) return 'zombie';
  if (r < 0.7) return 'outlaw';
  return 'catship';
}

function spawn(c: CombatState, type: EnemyType): Enemy {
  const r = c.rng;
  const side = r() < 0.5 ? -1 : 1;
  const e: Enemy = {
    id: c.nextId++,
    type,
    hp: ENEMY_STATS[type].hp,
    maxHp: ENEMY_STATS[type].hp,
    x: 0,
    y: 0,
    z: 0,
    timer: 0,
    charging: false,
    stunned: 0,
    holdZ: 0,
    holdX: 0,
  };
  if (type === 'zombie') {
    e.x = range(r, -7, 7);
    e.z = -70;
  } else if (type === 'outlaw') {
    e.x = side * 5.5;
    e.z = 35;
    // Ride alongside, a little ahead of the car so they stay on screen in portrait.
    e.holdX = side * range(r, 3.8, 4.6);
    e.holdZ = range(r, -12, -3);
    e.timer = range(r, 2, 3);
  } else {
    e.x = range(r, -6, 6);
    e.y = 8;
    e.z = -60;
    e.holdX = range(r, -5, 5);
    e.holdZ = range(r, -22, -14);
    e.timer = range(r, 3, 5);
  }
  c.enemies.push(e);
  return e;
}

/** Steps the fight forward. Returns damage dealt to the car during this step. */
export function stepCombat(c: CombatState, dt: number): number {
  c.time += dt;
  c.fireCooldown = Math.max(0, c.fireCooldown - dt);
  c.hornCooldown = Math.max(0, c.hornCooldown - dt);
  c.boostCooldown = Math.max(0, c.boostCooldown - dt);
  const boosting = c.boostTime > 0;
  c.boostTime = Math.max(0, c.boostTime - dt);
  c.escape += dt * (boosting ? 2.5 : 1);

  c.carX = Math.max(-LANE_LIMIT, Math.min(LANE_LIMIT, c.carX + c.steer * 7 * dt));

  while (c.queue.length && c.queue[0].t <= c.time) spawn(c, c.queue.shift()!.type);

  const roadSpeed = ROAD_SPEED * (boosting ? 2.2 : 1);
  let carDamage = 0;
  const hitCar = (dmg: number, from: EnemyType) => {
    carDamage += dmg;
    c.events.push({ kind: 'carHit', dmg, from });
  };

  for (const e of c.enemies) {
    const stunned = e.stunned > 0;
    e.stunned = Math.max(0, e.stunned - dt);
    if (e.type === 'zombie') {
      e.z += roadSpeed * dt;
      if (!stunned) e.x += Math.sign(c.carX - e.x) * Math.min(Math.abs(c.carX - e.x), 1.8 * dt);
      if (e.z > -1.5 && e.z < 1.5 && Math.abs(e.x - c.carX) < 1.5) {
        // Ploughing into a zombie hurts the car unless you're boosting through.
        if (!boosting && c.ramDamage > 0) hitCar(c.ramDamage, 'zombie');
        kill(c, e, false);
      }
    } else if (e.type === 'outlaw') {
      if (boosting) {
        e.z += roadSpeed * 0.6 * dt;
      } else {
        e.z += Math.sign(e.holdZ - e.z) * Math.min(Math.abs(e.holdZ - e.z), 8 * dt);
        e.x += Math.sign(c.carX + e.holdX - e.x) * Math.min(Math.abs(c.carX + e.holdX - e.x), 4 * dt);
      }
      e.timer -= dt;
      if (e.timer <= 0 && !stunned && Math.abs(e.z - e.holdZ) < 2) {
        e.timer = range(c.rng, 1.8, 2.8);
        const hit = c.rng() < 0.6;
        c.events.push({ kind: 'enemyShot', enemy: e.id, hit });
        if (hit) hitCar(4, 'outlaw');
      }
    } else {
      e.z += Math.sign(e.holdZ - e.z) * Math.min(Math.abs(e.holdZ - e.z), 10 * dt);
      e.x += (c.carX + e.holdX - e.x) * Math.min(1, dt * 0.8) + Math.sin(c.time * 1.7 + e.id) * dt * 2;
      e.y = 7 + Math.sin(c.time * 2 + e.id) * 0.6;
      if (stunned) {
        e.charging = false;
      } else {
        e.timer -= dt;
        if (!e.charging && e.timer <= 1.4) {
          e.charging = true;
          c.events.push({ kind: 'charge', enemy: e.id });
        }
        if (e.timer <= 0) {
          e.charging = false;
          e.timer = range(c.rng, 3.5, 5);
          c.events.push({ kind: 'laser', enemy: e.id });
          hitCar(9, 'catship');
        }
      }
    }
  }
  // Anything that falls far behind is gone (left in the dust, not killed).
  c.enemies = c.enemies.filter((e) => e.hp > 0 && e.z < 40);
  return carDamage;
}

function kill(c: CombatState, e: Enemy, byPlayer: boolean): void {
  e.hp = 0;
  c.events.push({ kind: 'kill', enemy: e.id, type: e.type, x: e.x, y: e.y, z: e.z });
  if (!byPlayer) return;
  c.kills++;
  const add = (k: keyof Inventory, n: number) => (c.loot[k] = (c.loot[k] ?? 0) + n);
  if (e.type === 'zombie') add('scrap', 1);
  if (e.type === 'outlaw') {
    add('bullets', 8);
    add('cash', 6);
  }
  if (e.type === 'catship') {
    add('scrap', 4);
    if (c.rng() < 0.5) add('catnip', 1);
  }
}

/** Fires the current weapon at an enemy. Spends ammo from the inventory. */
export function fireAt(c: CombatState, inv: Inventory, enemyId: number): boolean {
  if (c.fireCooldown > 0) return false;
  const target = c.enemies.find((e) => e.id === enemyId && e.hp > 0);
  if (!target) return false;
  let weapon = c.weapon;
  const w0 = WEAPONS[weapon];
  if (w0.ammo && inv[w0.ammo] <= 0) {
    c.events.push({ kind: 'empty', weapon });
    weapon = 'rocks';
  }
  const w = WEAPONS[weapon];
  if (w.ammo) inv[w.ammo]--;
  c.fireCooldown = w.cooldown;
  c.events.push({ kind: 'shot', weapon, x: target.x, y: target.y, z: target.z });
  for (const e of c.enemies) {
    if (e.hp <= 0) continue;
    const d = Math.hypot(e.x - target.x, e.z - target.z, e.y - target.y);
    let dmg = e === target ? w.dmg : d <= w.splash ? (weapon === 'catnip' ? w.dmg : w.dmg / 2) : 0;
    if (weapon === 'bullets') dmg *= c.gunDamage;
    if (dmg <= 0) continue;
    if (weapon === 'catnip' && e.type === 'catship') dmg *= 3;
    if (weapon === 'catnip' && e.type !== 'catship') e.stunned = Math.max(e.stunned, 1.5);
    e.hp -= dmg;
    c.events.push({ kind: 'hit', enemy: e.id, dmg });
    if (e.hp <= 0) kill(c, e, true);
  }
  c.enemies = c.enemies.filter((e) => e.hp > 0);
  return true;
}

/** Blasts the horn: stuns zombies and saucers nearby (cats hate loud noises). */
export function horn(c: CombatState): boolean {
  if (c.hornCooldown > 0) return false;
  c.hornCooldown = HORN_COOLDOWN;
  c.events.push({ kind: 'horn' });
  for (const e of c.enemies) {
    if (Math.abs(e.z) < 35) e.stunned = Math.max(e.stunned, e.type === 'outlaw' ? 1 : 3);
  }
  return true;
}

/** Nitro: burns fuel to plough through zombies and leave bikers behind. */
export function boost(c: CombatState, inv: Inventory): boolean {
  if (c.boostCooldown > 0 || inv.fuel < BOOST_FUEL + 1) return false;
  inv.fuel -= BOOST_FUEL;
  c.boostCooldown = BOOST_COOLDOWN;
  c.boostTime = 2.5;
  c.events.push({ kind: 'boost' });
  return true;
}

export type CombatOutcome = 'cleared' | 'escaped' | null;

export function combatOutcome(c: CombatState): CombatOutcome {
  if (c.queue.length === 0 && c.enemies.length === 0) return 'cleared';
  if (c.escape >= c.escapeAt) return 'escaped';
  return null;
}
