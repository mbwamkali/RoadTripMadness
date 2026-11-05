import type { AmmoKind, Inventory } from './state';
import { makeRng, range, type Rng } from './rng';

/**
 * Combat rules, kept free of rendering so they can be tested.
 *
 * Coordinates: the car sits at z = 0 and the road scrolls toward +z.
 * x is across the road (lanes at about -2.5 .. 2.5), y is height.
 */

export type BossKind = 'brute' | 'warrig' | 'mothership' | 'hermit' | 'pizza' | 'sweeper' | 'karen' | 'drones';
export type EnemyType = 'zombie' | 'outlaw' | 'catship' | 'drone' | BossKind;
export const BOSSES: BossKind[] = ['brute', 'warrig', 'mothership', 'hermit', 'pizza', 'sweeper', 'karen', 'drones'];
/** The halfway boss is drawn from this pool (the Cat Queen always waits at the end). */
export const HALF_BOSSES: BossKind[] = ['brute', 'warrig', 'hermit', 'pizza', 'sweeper', 'karen', 'drones'];
/** Bosses that throw things at the car between their big attacks. */
const THROWING_BOSSES: Partial<Record<BossKind, { every: [number, number]; dmg: number; dur: number; spread?: number }>> = {
  hermit: { every: [1.8, 2.6], dmg: 5, dur: 1.1 },
  pizza: { every: [1.3, 1.9], dmg: 4, dur: 0.9 },
  // The sweeper sprays two trash bags at once: one at the car, one a lane over.
  sweeper: { every: [1.6, 2.4], dmg: 4, dur: 1.0, spread: 2.4 },
  // Karen throws her cats (they land on their feet and run off if they miss).
  karen: { every: [1.4, 2.0], dmg: 4, dur: 1.1 },
};
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
  /** Zombies: throwers stop up the road and hurl junk; climbers grab onto the car. */
  role?: 'thrower' | 'climber';
  /** Part of a horde: one hit (or one bump) each. */
  horde?: boolean;
  /** A climber riding on the car. */
  onCar?: boolean;
  /** Seconds of steering a climber has been shaken by (enough throws it off). */
  shaken?: number;
  /** Throwing bosses: time to the next small throw (between big attacks). */
  throwTimer?: number;
  /** The hermit: time to his next hop across the road. */
  hopTimer?: number;
}

/** Junk thrown at the car: flies from the thrower to where the car was, and hits if the car is still there. */
export interface Missile {
  id: number;
  from: EnemyType;
  x0: number;
  y0: number;
  z0: number;
  /** The lane it was aimed at. */
  tx: number;
  t: number;
  dur: number;
  dmg: number;
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
  | { kind: 'windup'; enemy: number }
  | { kind: 'throw'; missile: number }
  | { kind: 'missile'; missile: number; x: number; hit: boolean }
  | { kind: 'grab'; enemy: number }
  /** The sweeper is wrecked and its cat crew leaps out. */
  | { kind: 'bail'; x: number; z: number; cats: number }
  | { kind: 'shakeOff'; enemy: number }
  | { kind: 'horn' }
  | { kind: 'boost' }
  | { kind: 'empty'; weapon: WeaponKind };

interface Spawn {
  t: number;
  type: EnemyType;
  horde?: boolean;
}

export interface CombatState {
  rng: Rng;
  time: number;
  /**
   * How far you have to get to escape, in seconds at cruise speed. In the
   * separate fight view that is plain seconds; on the road it is distance
   * (see `pace`), so driving faster gets you away sooner.
   */
  escapeAt: number;
  escape: number;
  /**
   * On the road: the car's speed as a share of cruise speed, set every frame by
   * the drive. Escape then grows with distance driven. Unset = time-based.
   */
  pace?: number;
  carX: number;
  steer: number;
  /**
   * On the road: the lane centres you can dodge between (across your side of
   * the road), and which one you're heading for. Unset = free steering.
   */
  lanes?: number[];
  lane?: number;
  weapon: WeaponKind;
  fireCooldown: number;
  hornCooldown: number;
  boostCooldown: number;
  boostTime: number;
  enemies: Enemy[];
  missiles: Missile[];
  queue: Spawn[];
  /** A zombie horde fight (waves of one-hit zombies). */
  horde: boolean;
  nextId: number;
  events: CombatEvent[];
  kills: number;
  loot: Partial<Inventory>;
  title: string;
  gunDamage: number;
  ramDamage: number;
  gunner: boolean;
  gunnerTimer: number;
  /** Most drones in the air at once in a drone boss fight (smaller on Low and in kid mode). */
  swarmMax: number;
  /** Car condition won back in the fight (the pizza driver's pizzas). */
  heal: number;
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
  drone: { hp: 1, name: 'Rogue drone' },
  brute: { hp: 45, name: 'Big Rotten Earl' },
  warrig: { hp: 55, name: "Mad Maxine's war rig" },
  mothership: { hp: 70, name: 'The Cat Queen' },
  hermit: { hp: 40, name: 'The Crazy Hermit' },
  pizza: { hp: 42, name: 'The Angry Pizza Driver' },
  sweeper: { hp: 50, name: 'The Street Sweeper' },
  karen: { hp: 46, name: 'Crazy Cat Lady Karen' },
  drones: { hp: 40, name: 'The Rogue Drone Air Force' },
};

export const BOSS_INFO: Record<BossKind, { title: string; intro: string; minion: EnemyType | null; slamDamage: number; icon: string }> = {
  brute: {
    title: 'BOSS: Big Rotten Earl',
    intro: 'A zombie the size of a barn lumbers onto the highway. Watch for the red lane and steer out of it before he stomps.',
    minion: 'zombie',
    slamDamage: 16,
    icon: '🧟',
  },
  warrig: {
    title: "BOSS: Mad Maxine's war rig",
    intro: 'An armoured eighteen-wheeler covered in spikes swings in ahead of you. When a lane lights up red, a rocket is coming.',
    minion: 'outlaw',
    slamDamage: 14,
    icon: '🚚',
  },
  mothership: {
    title: 'BOSS: The Cat Queen',
    intro: 'The sky goes purple. A mothership the size of a stadium descends over your destination. Dodge the red beam. Catnip hurts her a lot.',
    minion: 'catship',
    slamDamage: 18,
    icon: '🐱',
  },
  hermit: {
    title: 'BOSS: The Crazy Hermit',
    intro: 'A wild hermit with a huge beard jumps out of the bushes. He throws everything he owns at you! Dodge the junk, and steer out of the red lane before the big one lands.',
    minion: null,
    slamDamage: 15,
    icon: '🧔',
  },
  pizza: {
    title: 'BOSS: The Angry Pizza Driver',
    intro: 'A pizza car roars up behind you. The driver is mad, and he is throwing pizzas! Dodge them and the red lane. Beat him and the pizzas are yours.',
    minion: null,
    slamDamage: 14,
    icon: '🍕',
  },
  sweeper: {
    title: 'BOSS: The Street Sweeper',
    intro: 'A giant street sweeper rumbles onto the road. Angry cats are driving it! It sprays trash across the lanes. Dodge the trash bags and the red lane, and wreck it to make the cats jump out.',
    minion: null,
    slamDamage: 14,
    icon: '🧹',
  },
  karen: {
    title: 'BOSS: Crazy Cat Lady Karen',
    intro: 'A lady on a pink scooter blocks the road, with cats piled all over her. "These are MY roads and MY cats!" She throws cats at you! Dodge the cats and the red lane.',
    minion: null,
    slamDamage: 14,
    icon: '👵',
  },
  drones: {
    title: 'BOSS: The Rogue Drone Air Force',
    intro: 'A buzzing cloud of paper-plane drones fills the sky, led by a giant command drone. Each little drone falls with one hit, and they blink red before they shoot. Shoot down the big one to send them all home!',
    minion: 'drone',
    slamDamage: 14,
    icon: '✈️',
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
/** Lane centres for fights on the road: your side's two lanes, 3.6 apart (one lane over clears a boss's red strip). */
export const ROAD_LANES = [-1.8, 1.8];
/** How fast the car slides to a new lane in a road fight (units a second). */
export const LANE_SLIDE = 9;

/** Road fights: turns lane dodging on, starting from the lane nearest the car. */
export function useLanes(c: CombatState, carX: number, lanes = ROAD_LANES): void {
  c.lanes = lanes;
  c.carX = carX;
  c.lane = nearestLane(lanes, carX);
}

function nearestLane(lanes: number[], x: number): number {
  let best = 0;
  lanes.forEach((l, i) => {
    if (Math.abs(l - x) < Math.abs(lanes[best] - x)) best = i;
  });
  return best;
}

/** Road fights: move one lane left (-1) or right (1). False at the edge. */
export function changeLane(c: CombatState, dir: -1 | 1): boolean {
  if (!c.lanes || c.lane === undefined) return false;
  const next = Math.max(0, Math.min(c.lanes.length - 1, c.lane + dir));
  if (next === c.lane) return false;
  c.lane = next;
  return true;
}

/** The nearest enemy still in the fight (for kid mode's big shoot button). */
export function nearestEnemy(c: CombatState): Enemy | null {
  let best: Enemy | null = null;
  for (const e of c.enemies) {
    if (e.hp <= 0) continue;
    const d = Math.hypot(e.x - c.carX, e.z);
    if (!best || d < Math.hypot(best.x - c.carX, best.z)) best = e;
  }
  return best;
}
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
  /** Chance a zombie fight is a horde (difficulty and cities raise it). */
  hordeChance?: number;
  /** Most zombies in a horde (fewer on Low graphics and in kid mode). */
  hordeMax?: number;
  /** Difficulty: enemy health and damage multipliers. */
  hpScale?: number;
  dmgScale?: number;
  /** Extra enemies per fight from the threat level (career). */
  extra?: number;
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
    missiles: [],
    nextId: 1,
    events: [],
    kills: 0,
    loot: {},
    heal: 0,
    swarmMax: Math.max(6, Math.round((opts.hordeMax ?? 40) * 0.35) + (opts.extra ?? 0)),
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
      // The drone air force launches its first wave quickly.
      ...(opts.boss === 'drones' ? { minionTimer: 2.5 } : {}),
      title: BOSS_INFO[opts.boss].title,
      boss: opts.boss,
      horde: false,
    };
  }
  // Each fight leans toward one kind of threat so they feel distinct.
  const theme = opts.theme ?? (opts.ambush ? (rng() < 0.6 ? 'zombie' : 'outlaw') : pickTheme(rng, p));
  if (theme === 'zombie' && rng() < (opts.hordeChance ?? 0)) {
    return { ...common, escapeAt: 45, queue: hordeWaves(rng, p, opts.hordeMax ?? 40, (opts.extra ?? 0) * 2), title: 'ZOMBIE HORDE!', boss: null, horde: true };
  }
  const count = Math.round(5 + p * 9 + rng() * 3) + (opts.extra ?? 0);
  const types: EnemyType[] = [];
  for (let i = 0; i < count; i++) {
    const r = rng();
    let t: EnemyType = theme;
    if (r < 0.35) t = 'zombie';
    if (!opts.ambush && theme !== 'zombie' && r > 0.85 && p > 0.3) t = theme === 'outlaw' ? 'catship' : 'outlaw';
    types.push(t);
  }
  const queue = types.map((type, i) => ({ type, t: 0.8 + i * range(rng, 1.2, 2.4) }));
  const titles: Record<'zombie' | 'outlaw' | 'catship', string> = {
    zombie: 'Zombies!',
    outlaw: 'Outlaws on your tail!',
    catship: 'Alien cat invasion!',
  };
  return { ...common, escapeAt: 45, queue, title: titles[theme as 'zombie' | 'outlaw' | 'catship'] ?? titles.zombie, boss: null, horde: false };
}

/** 20 to 40 zombies (more with `extra` from the threat level, at most `max`) in three or four waves, each wave a tight rush. */
export function hordeWaves(rng: Rng, p: number, max: number, extra = 0): Spawn[] {
  const total = Math.min(max, Math.round(20 + p * 12 + rng() * 8) + extra);
  const waves = total > 28 ? 4 : 3;
  const out: Spawn[] = [];
  let t = 1;
  for (let w = 0; w < waves; w++) {
    const n = Math.round(total / waves) + (w === waves - 1 ? total - Math.round(total / waves) * waves : 0);
    for (let i = 0; i < n; i++) out.push({ t: t + i * range(rng, 0.12, 0.3), type: 'zombie', horde: true });
    t += n * 0.22 + range(rng, 4, 6);
  }
  return out;
}

function pickTheme(rng: Rng, p: number): EnemyType {
  const r = rng();
  if (p < 0.15) return 'zombie';
  if (p < 0.35) return r < 0.55 ? 'zombie' : 'outlaw';
  if (r < 0.4) return 'zombie';
  if (r < 0.7) return 'outlaw';
  return 'catship';
}

function spawn(c: CombatState, type: EnemyType, horde = false): Enemy {
  const r = c.rng;
  const side = r() < 0.5 ? -1 : 1;
  const hp = horde ? 1 : ENEMY_STATS[type].hp * c.hpScale;
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
    e.y = type === 'mothership' ? 14 : type === 'drones' ? 9 : 0;
    e.z = -90;
    e.holdZ = { brute: -20, warrig: -16, hermit: -18, pizza: -10, sweeper: -15, karen: -16, drones: -30, mothership: -34 }[type];
    e.timer = 4;
    if (type === 'hermit') {
      // Leaps out from the roadside and stays off the road, hopping from side to side.
      e.holdX = side * 5.5;
      e.x = side * 8;
      e.hopTimer = range(r, 6, 8);
    }
    if (type === 'pizza') {
      // Comes up from behind like the outlaws, then rides just ahead.
      e.z = 30;
      e.x = side * 4;
      e.holdX = side * 3.4;
    }
    if (THROWING_BOSSES[type]) e.throwTimer = 3;
  } else if (type === 'zombie') {
    e.x = range(r, -7, 7);
    e.z = -70;
    if (horde) {
      e.horde = true;
      e.z = -70 - r() * 12;
      e.holdX = range(r, -6, 6);
    } else if (!c.boss) {
      // Later in the trip more zombies fight back: some throw junk, some climb on.
      const p = Math.min(1, c.time / 60 + 0.3);
      const roll = r();
      if (roll < 0.22 * p + 0.12) {
        e.role = 'thrower';
        e.holdZ = range(r, -17, -11);
        e.timer = range(r, 0.8, 1.6);
      } else if (roll < 0.5) e.role = 'climber';
    }
  } else if (type === 'drone') {
    // Swoops in high and hangs over the road ahead, weaving.
    e.x = range(r, -7, 7);
    e.y = range(r, 6, 9);
    e.z = -75 - r() * 10;
    e.holdZ = range(r, -24, -9);
    e.holdX = range(r, -3.5, 3.5);
    e.timer = range(r, 2.5, 4.5);
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
  // On the road the car's own speed (boost included) carries you away; in the fight view a boost counts extra.
  c.escape += c.pace !== undefined ? dt * c.pace : dt * (boosting ? 2.5 : 1);

  if (c.lanes && c.lane !== undefined) {
    // Lane dodging: slide over to the chosen lane. Moving counts as steering (it shakes off climbers).
    const gap = c.lanes[c.lane] - c.carX;
    c.carX += Math.sign(gap) * Math.min(Math.abs(gap), LANE_SLIDE * c.steerScale * dt);
    c.steer = Math.abs(gap) > 0.05 ? Math.sign(gap) : 0;
  } else c.carX = Math.max(-LANE_LIMIT, Math.min(LANE_LIMIT, c.carX + c.steer * 7 * c.steerScale * dt));

  while (c.queue.length && c.queue[0].t <= c.time) {
    const q = c.queue.shift()!;
    spawn(c, q.type, q.horde);
  }

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
      if (e.onCar) stepClimber(c, e, dt, stunned, boosting, hitCar);
      else if (e.role === 'thrower') stepThrower(c, e, dt, stunned, boosting, roadSpeed);
      else {
        e.z += roadSpeed * dt;
        // A horde spreads across the road far off and closes in on the car as it nears.
        const aimX = e.horde ? c.carX + e.holdX * Math.min(1, Math.max(0, -e.z / 35)) : c.carX;
        if (!stunned) e.x += Math.sign(aimX - e.x) * Math.min(Math.abs(aimX - e.x), (e.horde ? 1.6 : 1.8) * dt);
        if (e.z > -1.5 && e.z < 1.5 && Math.abs(e.x - c.carX) < 1.5) {
          if (e.role === 'climber' && !boosting) {
            // It grabs on instead of going under the wheels.
            e.onCar = true;
            e.shaken = 0;
            e.timer = 1.2;
            c.events.push({ kind: 'grab', enemy: e.id });
          } else {
            // Ploughing into a zombie hurts the car unless you're boosting through; a horde zombie is a small bump.
            if (!boosting && c.ramDamage > 0) hitCar(e.horde ? c.ramDamage * 0.25 : c.ramDamage, 'zombie');
            kill(c, e, !!e.horde);
          }
        }
      }
    } else if (e.type === 'drone') {
      stepDrone(c, e, dt, stunned, boosting, roadSpeed, hitCar);
    } else if (e.type === 'outlaw') {
      if (boosting) {
        e.z += roadSpeed * 0.6 * dt;
      } else {
        e.z += Math.sign(e.holdZ - e.z) * Math.min(Math.abs(e.holdZ - e.z), 8 * dt);
        e.x += Math.sign(c.carX + e.holdX - e.x) * Math.min(Math.abs(c.carX + e.holdX - e.x), 4 * dt);
      }
      e.timer -= dt;
      if (stunned) e.charging = false;
      else if (!e.charging && e.timer <= WINDUP && e.timer > 0 && Math.abs(e.z - e.holdZ) < 2) {
        // Raises the gun first (the outlaw flashes), so there's a moment to swerve.
        e.charging = true;
        c.events.push({ kind: 'windup', enemy: e.id });
      }
      if (e.timer <= 0 && !stunned && Math.abs(e.z - e.holdZ) < 2) {
        e.timer = range(c.rng, 1.8, 2.8);
        e.charging = false;
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
  stepMissiles(c, dt, hitCar);
  if (c.gunner) gunnerFire(c, dt);
  const minion = c.boss ? BOSS_INFO[c.boss].minion : null;
  if (minion === 'drone' && c.bossId != null) {
    // The command drone launches a wave every few seconds, up to the swarm limit.
    c.minionTimer -= dt;
    const flying = c.enemies.filter((e) => e.type === 'drone' && e.hp > 0).length;
    if (c.minionTimer <= 0 && c.enemies.some((e) => e.id === c.bossId)) {
      c.minionTimer = range(c.rng, 6, 8);
      const n = Math.min(c.swarmMax - flying, Math.round(range(c.rng, 4, 8)));
      for (let i = 0; i < n; i++) spawn(c, 'drone');
    }
  } else if (minion && c.bossId != null) {
    c.minionTimer -= dt;
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
  if (e.type === 'zombie' && (!e.horde || c.rng() < 0.35)) add('scrap', 1);
  if (e.type === 'outlaw') {
    add('bullets', 8);
    add('cash', 6);
  }
  if (e.type === 'drone' && c.rng() < 0.3) add('scrap', 1);
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
  // The pizza driver's pizzas are yours: a meal on the road fixes you up.
  if (e.type === 'pizza') c.heal += 30;
  if (e.type === 'sweeper') {
    // The cats bail out and run off, dropping some catnip.
    c.events.push({ kind: 'bail', x: e.x, z: e.z, cats: 4 });
    add('catnip', 2);
  }
}

/** How long an enemy flashes before it attacks. */
export const WINDUP = 0.6;

/** A thrower stops up the road, winds up and hurls junk at the lane the car is in. */
function stepThrower(c: CombatState, e: Enemy, dt: number, stunned: boolean, boosting: boolean, roadSpeed: number): void {
  // Boosting leaves throwers behind.
  if (boosting || e.z < e.holdZ) e.z = boosting ? e.z + roadSpeed * dt : Math.min(e.holdZ, e.z + roadSpeed * dt);
  if (stunned || e.z < e.holdZ - 0.5 || e.z > e.holdZ + 0.5) {
    e.charging = false;
    return;
  }
  e.timer -= dt;
  if (!e.charging && e.timer <= WINDUP) {
    e.charging = true;
    c.events.push({ kind: 'windup', enemy: e.id });
  }
  if (e.timer <= 0) {
    e.timer = range(c.rng, 2, 3);
    e.charging = false;
    const m: Missile = { id: c.nextId++, from: 'zombie', x0: e.x, y0: 2, z0: e.z, tx: c.carX, t: 0, dur: 1, dmg: 5 };
    c.missiles.push(m);
    c.events.push({ kind: 'throw', missile: m.id });
  }
}

/** A drone hangs over the road ahead, weaving, and fires a small shot after a wind-up (it blinks red). */
function stepDrone(c: CombatState, e: Enemy, dt: number, stunned: boolean, boosting: boolean, roadSpeed: number, hitCar: (d: number, from: EnemyType) => void): void {
  if (boosting) e.z += roadSpeed * 0.5 * dt;
  else e.z += Math.sign(e.holdZ - e.z) * Math.min(Math.abs(e.holdZ - e.z), 16 * dt);
  const wantX = c.carX + e.holdX + Math.sin(c.time * 1.3 + e.id) * 1.5;
  e.x += Math.sign(wantX - e.x) * Math.min(Math.abs(wantX - e.x), 5 * dt);
  e.y += (6 + Math.sin(c.time * 2 + e.id) * 0.8 - e.y) * Math.min(1, dt * 2);
  if (stunned) {
    // A stunned drone wobbles and drops a little.
    e.charging = false;
    e.y -= dt;
    return;
  }
  if (Math.abs(e.z - e.holdZ) > 3) return;
  e.timer -= dt;
  if (!e.charging && e.timer <= WINDUP && e.timer > 0) {
    e.charging = true;
    c.events.push({ kind: 'windup', enemy: e.id });
  }
  if (e.timer <= 0) {
    e.charging = false;
    e.timer = range(c.rng, 2.8, 4.2);
    const hit = c.rng() < 0.4;
    c.events.push({ kind: 'enemyShot', enemy: e.id, hit });
    if (hit) hitCar(2, 'drone');
  }
}

/** A climber rides on the car and claws at it until it's shot, shaken off by steering, or blown off by a boost. */
function stepClimber(c: CombatState, e: Enemy, dt: number, stunned: boolean, boosting: boolean, hitCar: (d: number, from: EnemyType) => void): void {
  const side = e.x >= c.carX ? 1 : -1;
  e.x = c.carX + side * 0.7;
  e.z = -0.6;
  e.y = 1.1;
  e.shaken = (e.shaken ?? 0) + Math.abs(c.steer) * dt;
  if (boosting || e.shaken >= 0.9) {
    c.events.push({ kind: 'shakeOff', enemy: e.id });
    kill(c, e, true);
    return;
  }
  e.timer -= dt;
  if (stunned) {
    e.charging = false;
    return;
  }
  if (!e.charging && e.timer <= WINDUP && e.timer > 0) {
    e.charging = true;
    c.events.push({ kind: 'windup', enemy: e.id });
  }
  if (e.timer <= 0) {
    e.timer = 1.6;
    e.charging = false;
    hitCar(3, 'zombie');
  }
}

/** Thrown junk lands where it was aimed: steer out of that lane to dodge it. */
function stepMissiles(c: CombatState, dt: number, hitCar: (d: number, from: EnemyType) => void): void {
  for (const m of c.missiles) {
    m.t += dt;
    if (m.t < m.dur) continue;
    const hit = Math.abs(c.carX - m.tx) < 1.4;
    c.events.push({ kind: 'missile', missile: m.id, x: m.tx, hit });
    if (hit) hitCar(m.dmg, m.from);
  }
  c.missiles = c.missiles.filter((m) => m.t < m.dur);
}

/** Where a missile is now: an arc from the thrower to the aimed lane at the car. */
export function missileAt(m: Missile): { x: number; y: number; z: number } {
  const k = Math.min(1, m.t / m.dur);
  return { x: m.x0 + (m.tx - m.x0) * k, y: m.y0 + (1 - m.y0) * k + Math.sin(k * Math.PI) * 3, z: m.z0 * (1 - k) };
}

/**
 * Bosses hang ahead of the car, follow it across the road, and wind up a big
 * attack on the lane the car is in. Steering out of the red lane dodges it.
 */
function stepBoss(c: CombatState, e: Enemy, type: BossKind, dt: number, stunned: boolean, hitCar: (d: number, from: EnemyType) => void): void {
  e.z += Math.sign(e.holdZ - e.z) * Math.min(Math.abs(e.holdZ - e.z), 18 * dt);
  const follow = { brute: 1.2, warrig: 2.2, mothership: 1.6, hermit: 7, pizza: 2.6, sweeper: 1.8, karen: 1.5, drones: 1.4 }[type];
  let wantX = type === 'mothership' ? c.carX * 0.5 + Math.sin(c.time * 0.5) * 4 : c.carX;
  if (type === 'hermit') {
    // Hops from one roadside to the other every so often (a jump arc on the way).
    e.hopTimer = (e.hopTimer ?? 6) - dt;
    if (e.hopTimer <= 0 && !e.charging) {
      e.hopTimer = range(c.rng, 6, 9);
      e.holdX = -e.holdX;
    }
    wantX = e.holdX;
    const across = Math.abs(e.x - e.holdX);
    e.y = across > 0.2 ? Math.sin(Math.min(1, across / 11) * Math.PI) * 3 : 0;
  }
  if (type === 'pizza') {
    // Swerves from one side of the car to the other.
    if (Math.sin(c.time * 0.35 + e.id) * e.holdX < 0) e.holdX = -e.holdX;
    wantX = Math.max(-5, Math.min(5, c.carX + e.holdX));
  }
  e.x += Math.sign(wantX - e.x) * Math.min(Math.abs(wantX - e.x), follow * dt);
  if (type === 'mothership') e.y = 14 + Math.sin(c.time * 1.2) * 0.8;
  if (type === 'drones') e.y = 9 + Math.sin(c.time * 1.5) * 0.6;
  const thrower = THROWING_BOSSES[type];
  if (thrower && !stunned && !e.charging && Math.abs(e.z - e.holdZ) < 3 && e.y < 0.5) {
    // Small throws between big attacks, each with a wind-up flash first.
    e.throwTimer = (e.throwTimer ?? 2) - dt;
    if (e.throwTimer <= WINDUP && e.throwTimer + dt > WINDUP) c.events.push({ kind: 'windup', enemy: e.id });
    if (e.throwTimer <= 0) {
      e.throwTimer = range(c.rng, ...thrower.every);
      const lanes = [c.carX];
      if (thrower.spread) {
        // The second bag goes a lane over, toward the middle of the road.
        const side = c.carX > 0 ? -1 : c.carX < 0 ? 1 : c.rng() < 0.5 ? -1 : 1;
        lanes.push(Math.max(-LANE_LIMIT, Math.min(LANE_LIMIT, c.carX + side * thrower.spread)));
      }
      for (const tx of lanes) {
        const m: Missile = { id: c.nextId++, from: type, x0: e.x, y0: 2.2, z0: e.z, tx, t: 0, dur: thrower.dur, dmg: thrower.dmg };
        c.missiles.push(m);
        c.events.push({ kind: 'throw', missile: m.id });
      }
    }
  }
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

/** Eases off the gas: ends a boost early. False when not boosting. */
export function easeOff(c: CombatState): boolean {
  if (c.boostTime <= 0) return false;
  c.boostTime = 0;
  return true;
}

export type CombatOutcome = 'cleared' | 'escaped' | null;

export function combatOutcome(c: CombatState): CombatOutcome {
  if (c.boss) return c.queue.length === 0 && !c.enemies.some((e) => e.id === c.bossId) ? 'cleared' : null;
  if (c.queue.length === 0 && c.enemies.length === 0) return 'cleared';
  if (c.escape >= c.escapeAt) return 'escaped';
  return null;
}
