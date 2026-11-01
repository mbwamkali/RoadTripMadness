import type { AmmoKind, Inventory } from './state';
import { makeRng, range, type Rng } from './rng';

/**
 * Combat rules, kept free of rendering so they can be tested.
 *
 * Coordinates: the car sits at z = 0 and the road scrolls toward +z.
 * x is across the road (lanes at about -2.5 .. 2.5), y is height.
 */

export type BossKind = 'brute' | 'warrig' | 'mothership';
export type EnemyType = 'zombie' | 'outlaw' | 'catship' | BossKind;
export const BOSSES: BossKind[] = ['brute', 'warrig', 'mothership'];
export const isBoss = (t: EnemyType): t is BossKind => (BOSSES as EnemyType[]).includes(t);
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
  /** Bosses: the lane x their big attack will land on (shown as a warning). */
  targetX: number;
}

export type CombatEvent =
  | { kind: 'shot'; weapon: WeaponKind; x: number; y: number; z: number }
  | { kind: 'hit'; enemy: number; dmg: number }
  | { kind: 'kill'; enemy: number; type: EnemyType; x: number; y: number; z: number }
  | { kind: 'carHit'; dmg: number; from: EnemyType }
  | { kind: 'enemyShot'; enemy: number; hit: boolean }
  | { kind: 'charge'; enemy: number }
  | { kind: 'laser'; enemy: number }
  | { kind: 'slam'; enemy: number; x: number; hit: boolean }
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
  gunner: boolean;
  gunnerTimer: number;
  /** The boss of a boss fight (no escaping; beat it to win). */
  boss: BossKind | null;
  bossId: number | null;
  minionTimer: number;
  hpScale: number;
  dmgScale: number;
  /** Chance an enemy hit misses (a nimble ride). */
  dodge: number;
  /** How fast the car steers sideways. */
  steerScale: number;
}

export const ENEMY_STATS: Record<EnemyType, { hp: number; name: string }> = {
  zombie: { hp: 2, name: 'Zombie' },
  outlaw: { hp: 4, name: 'Outlaw biker' },
  catship: { hp: 6, name: 'Alien cat saucer' },
  brute: { hp: 45, name: 'Big Rotten Earl' },
  warrig: { hp: 55, name: "Mad Maxine's war rig" },
  mothership: { hp: 70, name: 'The Cat Queen' },
};

export const BOSS_INFO: Record<BossKind, { title: string; intro: string; minion: EnemyType; slamDamage: number }> = {
  brute: {
    title: 'BOSS: Big Rotten Earl',
    intro: 'A zombie the size of a barn lumbers onto the highway. Watch for the red lane and steer out of it before he stomps.',
    minion: 'zombie',
    slamDamage: 16,
  },
  warrig: {
    title: "BOSS: Mad Maxine's war rig",
    intro: 'An armoured eighteen-wheeler covered in spikes swings in ahead of you. When a lane lights up red, a rocket is coming.',
    minion: 'outlaw',
    slamDamage: 14,
  },
  mothership: {
    title: 'BOSS: The Cat Queen',
    intro: 'The sky goes purple. A mothership the size of a stadium descends over your destination. Dodge the red beam. Catnip hurts her a lot.',
    minion: 'catship',
    slamDamage: 18,
  },
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
  /** A crew gunner fires at enemies on their own. */
  gunner?: boolean;
  /** Force the kind of fight (from a road event). */
  theme?: EnemyType;
  /** A boss fight. */
  boss?: BossKind;
  /** Difficulty: enemy health and damage multipliers. */
  hpScale?: number;
  dmgScale?: number;
  dodge?: number;
  steerScale?: number;
}

export function createCombat(opts: CombatOptions): CombatState {
  const rng = makeRng(opts.seed);
  const p = Math.max(0, Math.min(1, opts.progress));
  const common = {
    rng,
    time: 0,
    escape: 0,
    carX: 0,
    steer: 0,
    weapon: 'bullets' as WeaponKind,
    fireCooldown: 0,
    hornCooldown: 0,
    boostCooldown: 0,
    boostTime: 0,
    enemies: [],
    nextId: 1,
    events: [],
    kills: 0,
    loot: {},
    gunDamage: opts.gunDamage ?? 1,
    ramDamage: opts.ramDamage ?? 6,
    gunner: !!opts.gunner,
    gunnerTimer: 2,
    bossId: null,
    minionTimer: 6,
    hpScale: opts.hpScale ?? 1,
    dmgScale: opts.dmgScale ?? 1,
    dodge: opts.dodge ?? 0,
    steerScale: opts.steerScale ?? 1,
  };
  if (opts.boss) {
    return {
      ...common,
      escapeAt: Infinity,
      queue: [{ t: 1, type: opts.boss }],
      title: BOSS_INFO[opts.boss].title,
      boss: opts.boss,
    };
  }
  const count = Math.round(5 + p * 9 + rng() * 3);
  const types: EnemyType[] = [];
  // Each fight leans toward one kind of threat so they feel distinct.
  const theme = opts.theme ?? (opts.ambush ? (rng() < 0.6 ? 'zombie' : 'outlaw') : pickTheme(rng, p));
  for (let i = 0; i < count; i++) {
    const r = rng();
    let t: EnemyType = theme;
    if (r < 0.35) t = 'zombie';
    if (!opts.ambush && theme !== 'zombie' && r > 0.85 && p > 0.3) t = theme === 'outlaw' ? 'catship' : 'outlaw';
    types.push(t);
  }
  const queue = types.map((type, i) => ({ type, t: 0.8 + i * range(rng, 1.2, 2.4) }));
  const titles: Record<'zombie' | 'outlaw' | 'catship', string> = {
    zombie: 'Zombie horde!',
    outlaw: 'Outlaws on your tail!',
    catship: 'Alien cat invasion!',
  };
  return { ...common, escapeAt: 45, queue, title: titles[theme as 'zombie' | 'outlaw' | 'catship'] ?? titles.zombie, boss: null };
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
  const hp = ENEMY_STATS[type].hp * c.hpScale;
  const e: Enemy = {
    id: c.nextId++,
    type,
    hp,
    maxHp: hp,
    x: 0,
    y: 0,
    z: 0,
    timer: 0,
    charging: false,
    stunned: 0,
    holdZ: 0,
    holdX: 0,
    targetX: 0,
  };
  if (isBoss(type)) {
    c.bossId = e.id;
    e.x = 0;
    e.y = type === 'mothership' ? 14 : 0;
    e.z = -90;
    e.holdZ = type === 'brute' ? -20 : type === 'warrig' ? -16 : -34;
    e.timer = 4;
  } else if (type === 'zombie') {
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

  c.carX = Math.max(-LANE_LIMIT, Math.min(LANE_LIMIT, c.carX + c.steer * 7 * c.steerScale * dt));

  while (c.queue.length && c.queue[0].t <= c.time) spawn(c, c.queue.shift()!.type);

  const roadSpeed = ROAD_SPEED * (boosting ? 2.2 : 1);
  let carDamage = 0;
  const hitCar = (raw: number, from: EnemyType) => {
    if (c.dodge > 0 && c.rng() < c.dodge) return;
    const dmg = raw * c.dmgScale;
    carDamage += dmg;
    c.events.push({ kind: 'carHit', dmg, from });
  };

  for (const e of c.enemies) {
    const stunned = e.stunned > 0;
    // Bosses shake off stuns quickly.
    e.stunned = Math.max(0, e.stunned - dt * (isBoss(e.type) ? 3 : 1));
    if (isBoss(e.type)) {
      stepBoss(c, e, e.type, dt, stunned, hitCar);
    } else if (e.type === 'zombie') {
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
  if (c.gunner) gunnerFire(c, dt);
  if (c.boss && c.bossId != null) {
    c.minionTimer -= dt;
    const minion = BOSS_INFO[c.boss].minion;
    const count = c.enemies.filter((e) => e.type === minion && e.hp > 0).length;
    if (c.minionTimer <= 0 && c.enemies.some((e) => e.id === c.bossId)) {
      c.minionTimer = minion === 'zombie' ? range(c.rng, 3, 5) : range(c.rng, 7, 10);
      if (count < (minion === 'zombie' ? 4 : 2)) spawn(c, minion);
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
  if (isBoss(e.type)) {
    add('cash', 80);
    add('scrap', 25);
    add('bullets', 40);
    add('shells', 4);
    // The rest of the gang scatters.
    for (const o of c.enemies) if (o !== e && o.hp > 0) o.z = 999;
  }
}

/**
 * Bosses hang ahead of the car, follow it across the road, and wind up a big
 * attack on the lane the car is in. Steering out of the red lane dodges it.
 */
function stepBoss(c: CombatState, e: Enemy, type: BossKind, dt: number, stunned: boolean, hitCar: (d: number, from: EnemyType) => void): void {
  e.z += Math.sign(e.holdZ - e.z) * Math.min(Math.abs(e.holdZ - e.z), 18 * dt);
  const follow = type === 'brute' ? 1.2 : type === 'warrig' ? 2.2 : 1.6;
  const wantX = type === 'mothership' ? c.carX * 0.5 + Math.sin(c.time * 0.5) * 4 : c.carX;
  e.x += Math.sign(wantX - e.x) * Math.min(Math.abs(wantX - e.x), follow * dt);
  if (type === 'mothership') e.y = 14 + Math.sin(c.time * 1.2) * 0.8;
  if (Math.abs(e.z - e.holdZ) > 3 || stunned) {
    if (stunned) e.charging = false;
    return;
  }
  e.timer -= dt;
  if (!e.charging && e.timer <= 1.5) {
    e.charging = true;
    e.targetX = c.carX;
    c.events.push({ kind: 'charge', enemy: e.id });
  }
  if (e.timer <= 0) {
    e.charging = false;
    const hp = e.hp / e.maxHp;
    // Faster attacks when it's hurt.
    e.timer = range(c.rng, 3.2, 4.4) * (0.65 + hp * 0.35);
    const hit = Math.abs(c.carX - e.targetX) < 1.8;
    c.events.push({ kind: 'slam', enemy: e.id, x: e.targetX, hit });
    if (hit) hitCar(BOSS_INFO[type].slamDamage, type);
  }
  // The war rig also has gunners on the back.
  if (type === 'warrig' && !e.charging) {
    e.holdX -= dt;
    if (e.holdX <= 0) {
      e.holdX = range(c.rng, 1.4, 2.2);
      const hit = c.rng() < 0.5;
      c.events.push({ kind: 'enemyShot', enemy: e.id, hit });
      if (hit) hitCar(3, 'warrig');
    }
  }
}

/** The crew gunner picks off the closest threat every so often, with their own ammo. */
function gunnerFire(c: CombatState, dt: number): void {
  c.gunnerTimer -= dt;
  if (c.gunnerTimer > 0) return;
  c.gunnerTimer = 1.3;
  const target = c.enemies.filter((e) => e.hp > 0 && e.z > -45).sort((a, b) => Math.abs(a.z) - Math.abs(b.z))[0];
  if (!target) return;
  c.events.push({ kind: 'shot', weapon: 'bullets', x: target.x, y: target.y, z: target.z });
  target.hp -= 1;
  c.events.push({ kind: 'hit', enemy: target.id, dmg: 1 });
  if (target.hp <= 0) kill(c, target, true);
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
    if (weapon === 'catnip' && (e.type === 'catship' || e.type === 'mothership')) dmg *= 3;
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
  if (c.boss) return c.queue.length === 0 && !c.enemies.some((e) => e.id === c.bossId) ? 'cleared' : null;
  if (c.queue.length === 0 && c.enemies.length === 0) return 'cleared';
  if (c.escape >= c.escapeAt) return 'escaped';
  return null;
}
