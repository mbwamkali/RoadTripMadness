import { placeShortcuts } from './shortcuts';
import { pathFromRoute, type RouteData } from '../geo/route';
import type { Path } from '../geo/geo';
import { fillLandmarks, type Landmark } from './landmarks';
import type { LiveConditions } from '../geo/liveWeather';
import type { CrewMember } from './events';
import { hourOf, nightLoot } from './time';
import { fuelEfficiency, MAX_LEVEL, maxHealthFor, noUpgrades, tankFor, upgradeCost, UPGRADES, type UpgradeKind, type Upgrades } from './upgrades';
import { generateStops, type PlaceKind, type Stop } from './stops';
import { hashString, makeRng, range, rangeInt, type Rng } from './rng';
import { DIFFICULTIES, type Difficulty } from './difficulty';
import { HALF_BOSSES, type BossKind } from './combat';
import { rideOf, type Ride } from './rides';

export type AmmoKind = 'bullets' | 'shells' | 'catnip';

export interface Inventory {
  fuel: number;
  cash: number;
  scrap: number;
  bullets: number;
  shells: number;
  catnip: number;
}

export interface GameState {
  version: 1;
  seed: number;
  route: RouteData;
  stops: Stop[];
  landmarks: Landmark[];
  /** Distance travelled along the game path. */
  distance: number;
  health: number;
  inv: Inventory;
  upgrades: Upgrades;
  crew: CrewMember[];
  nextEventAt: number;
  eventsSeen: number;
  /** Hours spent off the road (scavenging), which moves the clock. */
  hoursSpent: number;
  /** Real weather along the route and the real start time, when looked up. */
  live?: LiveConditions;
  /** Stop ids already passed or visited. */
  passed: string[];
  /** Searches done per stop+place, which raises the ambush risk. */
  searches: Record<string, number>;
  nextEncounterAt: number;
  encounters: number;
  difficulty: Difficulty;
  /** What you drive (older saves: the car). */
  ride?: Ride;
  /** The one-time bike rescue has been used (see rescue.ts). */
  bikeUsed?: boolean;
  /** Road rage, 0 to 100: rises when you shoot traffic, cools as you drive (see rage.ts). */
  rage?: number;
  /** The boss waiting halfway, drawn from the pool when the trip starts (older saves: by seed). */
  halfBoss?: BossKind;
  /** Karen was beaten this trip: the Cat Queen comes for her (the story ties them together). */
  karenBeaten?: boolean;
  /** Threat level carried over from earlier wins (see career.ts): tougher, bigger fights. */
  threat?: number;
  /** 0: halfway boss to come, 1: final boss to come, 2: both done. */
  bossStage: number;
  bossesBeaten: number;
  kills: number;
  status: 'driving' | 'won' | 'lost';
  lostReason?: string;
  log: string[];
}

/** Base values before upgrades. */
export const MAX_HEALTH = 100;
export const TANK = 100;

export const maxHealth = (s: GameState) => Math.round(maxHealthFor(s.upgrades) * rideOf(s).health);
export const tankSize = (s: GameState) => Math.round(tankFor(s.upgrades) * rideOf(s).tank);
export const FUEL_PRICE = 2; // cash per fuel unit
export const REPAIR_SCRAP_PER_HP = 0.5;
export const REPAIR_CASH_PER_HP = 1;

/**
 * How far a full stock tank goes in the muscle car, in real miles at the speed
 * limit on Normal (about 1.3x a real car's, so long trips stay busy without
 * becoming a chore). Rides change it through their tank and thirst: motorcycle
 * about 300, pickup about 550. Upgrades, speed and difficulty change it too.
 */
export const RANGE_MILES = 450;
const METERS_PER_MILE = 1609.344;

/** Fuel burned per game unit, for a route with `metersPerUnit` real metres in each game unit. */
export function fuelPerUnit(metersPerUnit: number): number {
  return (TANK * metersPerUnit) / (RANGE_MILES * METERS_PER_MILE);
}

/** How far apart (game units) gas stops may be for a ride: 60% of its stock full-tank range. */
export function gasGapFor(ride: Ride, metersPerUnit: number): number {
  const r = rideOf({ ride });
  return (0.6 * (TANK * r.tank)) / (fuelPerUnit(metersPerUnit) * r.fuel);
}

export function newGame(
  route: RouteData,
  seed = Date.now() & 0xffffffff,
  difficulty: Difficulty = 'normal',
  ride: Ride = 'car',
  carry?: { upgrades: Upgrades; threat: number; lastBoss?: BossKind },
): GameState {
  const path = pathFromRoute(route);
  const rng = makeRng(seed);
  const stops = generateStops(route, path.length, seed, gasGapFor(ride, route.scale));
  // Now and then a dirt-road shortcut, offered like any other turn-off.
  stops.push(...placeShortcuts(path.length, seed, stops));
  stops.sort((a, b) => a.at - b.at);
  const r = rideOf({ ride });
  const start = DIFFICULTIES[difficulty].start;
  const s: GameState = {
    version: 1,
    seed,
    route,
    stops,
    landmarks: fillLandmarks(route, path.length, stops, route.landmarks ?? [], seed),
    distance: 0,
    health: MAX_HEALTH,
    upgrades: carry ? { ...carry.upgrades } : noUpgrades(),
    crew: [],
    nextEventAt: path.length * range(rng, 0.05, 0.09),
    eventsSeen: 0,
    hoursSpent: 0,
    inv: {
      ...start,
      fuel: Math.round(start.fuel * r.tank),
      bullets: Math.round(start.bullets * r.carry),
      shells: Math.round(start.shells * r.carry),
      catnip: Math.round(start.catnip * r.carry),
    },
    passed: [],
    searches: {},
    nextEncounterAt: encounterGap(rng, path.length, difficulty) * 0.7,
    encounters: 0,
    difficulty,
    ...(ride !== 'car' ? { ride } : {}),
    ...(carry?.threat ? { threat: carry.threat } : {}),
    halfBoss: pickHalfBoss(seed, carry?.lastBoss),
    bossStage: 0,
    bossesBeaten: 0,
    kills: 0,
    status: 'driving',
    log: [`Set out from ${route.startLabel} for ${route.endLabel}.`],
  };
  s.health = maxHealth(s);
  return s;
}

export function encounterGap(rng: Rng, pathLength: number, difficulty: Difficulty = 'normal'): number {
  return range(rng, 0.07, 0.13) * pathLength * DIFFICULTIES[difficulty].gap;
}

/** Where the boss fights happen: halfway, and just outside the destination. */
export function bossPoints(pathLength: number, stops?: { at: number }[]): [number, number] {
  const end = pathLength - Math.min(pathLength * 0.04, 400);
  const half = pathLength * 0.5;
  if (!stops?.length) return [half, end];
  // Boss fights play out on the road, so slide the halfway boss to the nearest spot with no turn-off
  // just before it or for BOSS_CLEAR units after it (so a boss never makes you miss a gas stop).
  const clear = (x: number) => !stops.some((st) => st.at > x - 150 && st.at < x + BOSS_CLEAR);
  for (let k = 0; k * 100 <= pathLength * 0.15; k++) {
    for (const x of [half + k * 100, half - k * 100]) if (clear(x)) return [x, end];
  }
  return [half, end];
}

/** Road units after the halfway boss with no turn-off. */
export const BOSS_CLEAR = 1500;

/** Which boss waits at each point. The finale is always the Cat Queen. */
export function bossFor(s: GameState, stage: number): BossKind {
  if (stage >= 1) return 'mothership';
  return s.halfBoss ?? (makeRng(s.seed ^ 0xb055)() < 0.5 ? 'brute' : 'warrig');
}

/** The halfway boss for a new trip: any from the pool but the one met last trip. */
export function pickHalfBoss(seed: number, last?: BossKind, pool: BossKind[] = HALF_BOSSES): BossKind {
  const options = pool.length > 1 ? pool.filter((b) => b !== last) : pool;
  return options[Math.floor(makeRng(seed ^ 0xb055)() * options.length) % options.length];
}

/** Advances the car. Returns what happened so the caller can react. */
export function advance(
  s: GameState,
  path: Path,
  dist: number,
  fuelRate = fuelPerUnit(s.route.scale),
  /** Signalling for a turn: the boss waits until you're back on the road (it is never skipped). */
  holdBoss = false,
): { arrived: boolean; outOfFuel: boolean; encounter: boolean; event?: boolean; boss?: BossKind } {
  if (s.status !== 'driving') return { arrived: false, outOfFuel: false, encounter: false };
  const bosses = bossPoints(path.length, s.stops);
  // Never skip past a boss, even on fast-forward (a held one is met as soon as you drive on).
  const toBoss = s.bossStage < 2 && !holdBoss ? Math.max(0, bosses[s.bossStage] - s.distance) + 0.001 : Infinity;
  const step = Math.min(dist, path.length - s.distance, toBoss);
  s.distance += step;
  s.inv.fuel = Math.max(0, s.inv.fuel - step * fuelRate * fuelEfficiency(s.upgrades) * rideOf(s).fuel * DIFFICULTIES[s.difficulty].fuel);
  const arrived = s.distance >= path.length - 0.01;
  if (arrived) {
    s.status = 'won';
    s.log.push(`Rolled into ${s.route.endLabel}.`);
    return { arrived, outOfFuel: false, encounter: false };
  }
  if (s.inv.fuel <= 0) {
    // The first time, there's a bike in the ditch (the caller offers it).
    if (s.bikeUsed) {
      s.status = 'lost';
      s.lostReason = 'You ran out of fuel again, and this time there was no bike in the ditch.';
    }
    return { arrived: false, outOfFuel: true, encounter: false };
  }
  if (s.bossStage < 2 && s.distance >= bosses[s.bossStage] && !holdBoss) {
    const boss = bossFor(s, s.bossStage);
    s.bossStage++;
    // Give the player some room after a boss.
    s.nextEncounterAt = Math.max(s.nextEncounterAt, s.distance + 0.05 * path.length);
    s.nextEventAt = Math.max(s.nextEventAt, s.distance + 0.03 * path.length);
    return { arrived: false, outOfFuel: false, encounter: false, boss };
  }
  let encounter = false;
  // No ordinary fight right before a boss.
  const nearBoss = s.bossStage < 2 && bosses[s.bossStage] - s.distance < 0.04 * path.length;
  if (s.distance >= s.nextEncounterAt) {
    const rng = makeRng(s.seed + (s.encounters + 1) * 977);
    // Fights play out on the road, so don't start one just before a turn-off: wait until it's behind you.
    const stop = upcomingStop(s, FIGHT_CLEAR);
    if (nearBoss) {
      s.nextEncounterAt = bosses[s.bossStage] + encounterGap(rng, path.length, s.difficulty) * 0.5;
    } else if (stop) {
      s.nextEncounterAt = stop.at + 150;
    } else {
      encounter = true;
      s.encounters++;
      s.nextEncounterAt = s.distance + encounterGap(rng, path.length, s.difficulty);
    }
  }
  let event = false;
  if (!encounter && s.distance >= s.nextEventAt) {
    event = true;
    s.eventsSeen++;
    const rng = makeRng(s.seed ^ hashString(`gap${s.eventsSeen}`));
    s.nextEventAt = s.distance + range(rng, 0.08, 0.14) * path.length;
    // Keep events and fights from landing on top of each other.
    if (Math.abs(s.nextEventAt - s.nextEncounterAt) < 0.03 * path.length) s.nextEventAt += 0.04 * path.length;
  }
  return { arrived: false, outOfFuel: false, encounter, event };
}

/** Road units ahead that must be free of turn-offs before an ordinary fight starts. */
export const FIGHT_CLEAR = 1200;

/** The next stop the player hasn't passed, if it's within `lookahead` units. */
export function upcomingStop(s: GameState, lookahead: number): Stop | undefined {
  return s.stops.find((st) => !s.passed.includes(st.id) && st.at >= s.distance && st.at - s.distance <= lookahead);
}

export function damage(s: GameState, amount: number): void {
  s.health = Math.max(0, s.health - amount);
  if (s.health <= 0 && s.status === 'driving') {
    s.status = 'lost';
    s.lostReason = 'Your car was wrecked.';
  }
}

// ---------------------------------------------------------------- explore

export interface ActionResult {
  ok: boolean;
  message: string;
  /** When set, searching attracted trouble and a fight starts. */
  ambush?: boolean;
}

export function buyFuel(s: GameState): ActionResult {
  const want = Math.floor(tankSize(s) - s.inv.fuel);
  if (want <= 0) return { ok: false, message: 'Your tank is already full.' };
  const afford = Math.floor(s.inv.cash / FUEL_PRICE);
  const units = Math.min(want, afford);
  if (units <= 0) return { ok: false, message: `You can't afford gas ($${FUEL_PRICE} a unit).` };
  s.inv.fuel += units;
  s.inv.cash -= units * FUEL_PRICE;
  return { ok: true, message: `Pumped ${units} units of fuel for $${units * FUEL_PRICE}.` };
}

export function repairCost(s: GameState): { hp: number; scrap: number; cash: number } {
  const hp = Math.ceil(maxHealth(s) - s.health);
  return { hp, scrap: Math.ceil(hp * REPAIR_SCRAP_PER_HP), cash: Math.ceil(hp * REPAIR_CASH_PER_HP) };
}

/** Repairs as much as the player can pay for, scrap first and cash for the rest. */
export function repair(s: GameState): ActionResult {
  const need = Math.ceil(maxHealth(s) - s.health);
  if (need <= 0) return { ok: false, message: 'The mechanic says your car is fine.' };
  let hp = 0;
  while (hp < need) {
    if (s.inv.scrap >= REPAIR_SCRAP_PER_HP) s.inv.scrap -= REPAIR_SCRAP_PER_HP;
    else if (s.inv.cash >= REPAIR_CASH_PER_HP) s.inv.cash -= REPAIR_CASH_PER_HP;
    else break;
    hp++;
  }
  s.inv.scrap = Math.round(s.inv.scrap * 10) / 10;
  if (hp === 0) return { ok: false, message: 'You need scrap or cash to pay for repairs.' };
  s.health = Math.min(maxHealth(s), s.health + hp);
  return { ok: true, message: `Repaired ${hp} damage.` };
}

type Loot = Partial<Inventory>;

const LOOT: Record<PlaceKind, (rng: Rng) => Loot> = {
  pumps: (r) => ({ fuel: rangeInt(r, 5, 25) }),
  garage: (r) => ({ scrap: rangeInt(r, 4, 14), fuel: rangeInt(r, 0, 8) }),
  grocery: (r) => ({ cash: rangeInt(r, 5, 30), catnip: r() < 0.4 ? 1 : 0 }),
  hardware: (r) => ({ scrap: rangeInt(r, 3, 10), shells: rangeInt(r, 0, 4) }),
  gunshop: (r) => ({ bullets: rangeInt(r, 20, 60), shells: rangeInt(r, 2, 8) }),
  pharmacy: (r) => ({ cash: rangeInt(r, 10, 40), catnip: rangeInt(r, 0, 2) }),
  police: (r) => ({ bullets: rangeInt(r, 15, 40), shells: rangeInt(r, 0, 6) }),
  junkyard: (r) => ({ scrap: rangeInt(r, 8, 20) }),
  barn: (r) => ({ fuel: rangeInt(r, 0, 15), catnip: rangeInt(r, 0, 3), scrap: rangeInt(r, 0, 5) }),
  motel: (r) => ({ cash: rangeInt(r, 10, 35), bullets: rangeInt(r, 0, 15) }),
};

export const PLACE_TITLES: Record<PlaceKind, string> = {
  pumps: 'Gas pumps',
  garage: 'Auto garage',
  grocery: 'Grocery store',
  hardware: 'Hardware store',
  gunshop: 'Gun shop',
  pharmacy: 'Pharmacy',
  police: 'Police station',
  junkyard: 'Junkyard',
  barn: 'Barn',
  motel: 'Motel',
};

/**
 * Scavenges a place. Each repeat search finds less and is more likely to
 * draw an ambush, so players can't farm one spot forever.
 */
export function search(s: GameState, stopId: string, place: PlaceKind): ActionResult {
  const key = `${stopId}:${place}`;
  const n = s.searches[key] ?? 0;
  s.searches[key] = n + 1;
  s.hoursSpent += 0.75;
  const rng = makeRng(s.seed ^ hashString(`${key}:${n}`));
  const ambushChance = Math.min(0.75, 0.15 + n * 0.2) - (s.crew.includes('dog') ? 0.1 : 0);
  if (rng() < ambushChance) {
    return { ok: true, ambush: true, message: 'Something heard you. They\'re coming!' };
  }
  const loot = LOOT[place](rng);
  const factor = (n === 0 ? 1 : n === 1 ? 0.5 : 0.2) * nightLoot(hourOf(s));
  const found: string[] = [];
  for (const [k, v] of Object.entries(loot) as [keyof Inventory, number][]) {
    const amount = Math.floor((v ?? 0) * factor);
    if (amount <= 0) continue;
    s.inv[k] = k === 'fuel' ? Math.min(tankSize(s), s.inv[k] + amount) : s.inv[k] + amount;
    found.push(`${amount} ${k === 'cash' ? 'dollars' : k}`);
  }
  if (!found.length) return { ok: true, message: 'Picked clean. Nothing useful left here.' };
  return { ok: true, message: `Found ${found.join(', ')}.` };
}

/** Loot names as the result line says them: "12 dollars, 3 bullets". */
export function lootText(loot: Partial<Inventory>): string {
  return (Object.entries(loot) as [keyof Inventory, number][])
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${v} ${k === 'cash' ? 'dollars' : k}`)
    .join(', ');
}

/** One search, played as a few crates the player taps open. */
export interface Scavenge {
  stopId: string;
  place: PlaceKind;
  /** What each crate holds; together exactly what one search() would find. */
  crates: Partial<Inventory>[];
  opened: boolean[];
  /** How many crates have been opened. */
  opens: number;
  /** The open (1-based) that brings the ambush, or 0 for none. */
  ambushOn: number;
  /** How noisy the building already was from earlier searches, 0..1. */
  startNoise: number;
  found: Partial<Inventory>;
  over: boolean;
}

export const crateCount = (kid: boolean) => (kid ? 3 : 4);

/**
 * Starts a crate search. Same cost, loot and ambush odds as search(): the
 * loot roll is identical, split across the crates, and the ambush (if this
 * search would have drawn one) comes on a random open. Opening every crate
 * risks exactly what one search does; stopping early risks less and finds less.
 */
export function startScavenge(s: GameState, stopId: string, place: PlaceKind, count = 4): Scavenge {
  const key = `${stopId}:${place}`;
  const n = s.searches[key] ?? 0;
  s.searches[key] = n + 1;
  s.hoursSpent += 0.75;
  const rng = makeRng(s.seed ^ hashString(`${key}:${n}`));
  const ambushChance = Math.min(0.75, 0.15 + n * 0.2) - (s.crew.includes('dog') ? 0.1 : 0);
  const ambush = rng() < ambushChance;
  const loot = LOOT[place](rng);
  const factor = (n === 0 ? 1 : n === 1 ? 0.5 : 0.2) * nightLoot(hourOf(s));
  const crates: Partial<Inventory>[] = Array.from({ length: count }, () => ({}));
  for (const [k, v] of Object.entries(loot) as [keyof Inventory, number][]) {
    let amount = Math.floor((v ?? 0) * factor);
    if (amount <= 0) continue;
    // Small amounts go in one or two crates so each find is worth a cheer.
    const parts = Math.max(1, Math.min(count, Math.ceil(amount / 4)));
    const start = Math.floor(rng() * count);
    for (let i = 0; i < parts && amount > 0; i++) {
      const share = i === parts - 1 ? amount : Math.max(1, Math.round(amount / (parts - i)));
      const c = crates[(start + i) % count];
      c[k] = (c[k] ?? 0) + share;
      amount -= share;
    }
  }
  return {
    stopId,
    place,
    crates,
    opened: crates.map(() => false),
    opens: 0,
    ambushOn: ambush ? 1 + Math.floor(rng() * count) : 0,
    startNoise: Math.min(0.6, n * 0.25),
    found: {},
    over: false,
  };
}

/** How full the noise meter is, 0..1. Full means the ambush is here. */
export function scavengeNoise(sc: Scavenge): number {
  if (sc.ambushOn && sc.opens >= sc.ambushOn) return 1;
  return Math.min(0.95, sc.startNoise + ((1 - sc.startNoise) * 0.9 * sc.opens) / sc.crates.length);
}

/** Opens crate i: adds its loot to the car, or springs the ambush. */
export function openCrate(s: GameState, sc: Scavenge, i: number): { loot: Partial<Inventory>; ambush: boolean } {
  if (sc.over || sc.opened[i]) return { loot: {}, ambush: false };
  sc.opened[i] = true;
  sc.opens++;
  if (sc.ambushOn && sc.opens >= sc.ambushOn) {
    sc.over = true;
    return { loot: {}, ambush: true };
  }
  const loot: Partial<Inventory> = {};
  for (const [k, v] of Object.entries(sc.crates[i]) as [keyof Inventory, number][]) {
    const before = s.inv[k];
    s.inv[k] = k === 'fuel' ? Math.min(tankSize(s), before + v) : before + v;
    const got = Math.round(s.inv[k] - before);
    if (got > 0) {
      loot[k] = got;
      sc.found[k] = (sc.found[k] ?? 0) + got;
    }
  }
  if (sc.opened.every(Boolean)) sc.over = true;
  return { loot, ambush: false };
}

/** The line for the stop's log once the player leaves the building. */
export function scavengeSummary(sc: Scavenge, ambush: boolean): ActionResult {
  if (ambush) return { ok: true, ambush: true, message: "Something heard you. They're coming!" };
  const text = lootText(sc.found);
  if (text) return { ok: true, message: `Found ${text}.` };
  return { ok: true, message: sc.opens ? 'Picked clean. Nothing useful left here.' : 'You looked around and left.' };
}

/** Buys the next level of an upgrade, paying scrap first and cash for the rest of the price. */
export function buyUpgrade(s: GameState, kind: UpgradeKind): ActionResult {
  const level = s.upgrades[kind];
  if (level >= MAX_LEVEL) return { ok: false, message: `${UPGRADES[kind].name} is already maxed out.` };
  const cost = upgradeCost(level);
  if (s.inv.scrap < cost.scrap || s.inv.cash < cost.cash) {
    return { ok: false, message: `You need ${cost.scrap} scrap and $${cost.cash} for that.` };
  }
  s.inv.scrap -= cost.scrap;
  s.inv.cash -= cost.cash;
  const before = maxHealth(s);
  s.upgrades[kind] = level + 1;
  // New armor arrives in good shape.
  if (kind === 'armor') s.health += maxHealth(s) - before;
  return { ok: true, message: `Installed ${UPGRADES[kind].name} level ${level + 1}. ${UPGRADES[kind].describe(level + 1)}.` };
}

// ---------------------------------------------------------------- saving

const SAVE_KEY = 'rtm-save-v1';

export function saveGame(s: GameState): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    /* storage can be full or blocked; the game still works without saves */
  }
}

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as GameState;
    if (s.version !== 1 || s.status !== 'driving') return null;
    s.upgrades ??= noUpgrades();
    s.crew ??= [];
    s.eventsSeen ??= 0;
    s.hoursSpent ??= 0;
    s.nextEventAt ??= s.distance + 500;
    s.difficulty ??= 'normal';
    s.bossesBeaten ??= 0;
    if (s.bossStage == null) {
      const [half] = bossPoints(pathFromRoute(s.route).length);
      s.bossStage = s.distance > half ? 1 : 0;
    }
    // Saves from before landmarks existed.
    s.landmarks ??= fillLandmarks(s.route, pathFromRoute(s.route).length, s.stops, s.route.landmarks ?? [], s.seed);
    return s;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}
