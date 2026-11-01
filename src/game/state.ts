import { pathFromRoute, type RouteData } from '../geo/route';
import type { Path } from '../geo/geo';
import { fillLandmarks, type Landmark } from './landmarks';
import type { CrewMember } from './events';
import { hourOf, nightLoot } from './time';
import { fuelEfficiency, MAX_LEVEL, maxHealthFor, noUpgrades, tankFor, upgradeCost, UPGRADES, type UpgradeKind, type Upgrades } from './upgrades';
import { generateStops, type PlaceKind, type Stop } from './stops';
import { hashString, makeRng, range, rangeInt, type Rng } from './rng';
import { DIFFICULTIES, type Difficulty } from './difficulty';
import type { BossKind } from './combat';

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
  /** Stop ids already passed or visited. */
  passed: string[];
  /** Searches done per stop+place, which raises the ambush risk. */
  searches: Record<string, number>;
  nextEncounterAt: number;
  encounters: number;
  difficulty: Difficulty;
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

export const maxHealth = (s: GameState) => maxHealthFor(s.upgrades);
export const tankSize = (s: GameState) => tankFor(s.upgrades);
export const FUEL_PRICE = 2; // cash per fuel unit
export const REPAIR_SCRAP_PER_HP = 0.5;
export const REPAIR_CASH_PER_HP = 1;

/** A tank lasts about a third of the trip, so the player has to stop for gas. */
export function fuelPerUnit(pathLength: number): number {
  return TANK / (pathLength / 3.2);
}

export function newGame(route: RouteData, seed = Date.now() & 0xffffffff, difficulty: Difficulty = 'normal'): GameState {
  const path = pathFromRoute(route);
  const rng = makeRng(seed);
  const stops = generateStops(route, path.length, seed);
  return {
    version: 1,
    seed,
    route,
    stops,
    landmarks: fillLandmarks(route, path.length, stops, route.landmarks ?? [], seed),
    distance: 0,
    health: MAX_HEALTH,
    upgrades: noUpgrades(),
    crew: [],
    nextEventAt: path.length * range(rng, 0.05, 0.09),
    eventsSeen: 0,
    hoursSpent: 0,
    inv: { ...DIFFICULTIES[difficulty].start },
    passed: [],
    searches: {},
    nextEncounterAt: encounterGap(rng, path.length, difficulty) * 0.7,
    encounters: 0,
    difficulty,
    bossStage: 0,
    bossesBeaten: 0,
    kills: 0,
    status: 'driving',
    log: [`Set out from ${route.startLabel} for ${route.endLabel}.`],
  };
}

export function encounterGap(rng: Rng, pathLength: number, difficulty: Difficulty = 'normal'): number {
  return range(rng, 0.07, 0.13) * pathLength * DIFFICULTIES[difficulty].gap;
}

/** Where the boss fights happen: halfway, and just outside the destination. */
export function bossPoints(pathLength: number): [number, number] {
  return [pathLength * 0.5, pathLength - Math.min(pathLength * 0.04, 400)];
}

/** Which boss waits at each point. The finale is always the Cat Queen. */
export function bossFor(s: GameState, stage: number): BossKind {
  if (stage >= 1) return 'mothership';
  return makeRng(s.seed ^ 0xb055)() < 0.5 ? 'brute' : 'warrig';
}

/** Advances the car. Returns what happened so the caller can react. */
export function advance(
  s: GameState,
  path: Path,
  dist: number,
  fuelRate = fuelPerUnit(path.length),
): { arrived: boolean; outOfFuel: boolean; encounter: boolean; event?: boolean; boss?: BossKind } {
  if (s.status !== 'driving') return { arrived: false, outOfFuel: false, encounter: false };
  const bosses = bossPoints(path.length);
  // Never skip past a boss, even on fast-forward.
  const toBoss = s.bossStage < 2 ? Math.max(0, bosses[s.bossStage] - s.distance) + 0.001 : Infinity;
  const step = Math.min(dist, path.length - s.distance, toBoss);
  s.distance += step;
  s.inv.fuel = Math.max(0, s.inv.fuel - step * fuelRate * fuelEfficiency(s.upgrades) * DIFFICULTIES[s.difficulty].fuel);
  const arrived = s.distance >= path.length - 0.01;
  if (arrived) {
    s.status = 'won';
    s.log.push(`Rolled into ${s.route.endLabel}.`);
    return { arrived, outOfFuel: false, encounter: false };
  }
  if (s.inv.fuel <= 0) {
    s.status = 'lost';
    s.lostReason = 'You ran out of fuel in the middle of nowhere.';
    return { arrived: false, outOfFuel: true, encounter: false };
  }
  if (s.bossStage < 2 && s.distance >= bosses[s.bossStage]) {
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
    if (nearBoss) {
      s.nextEncounterAt = bosses[s.bossStage] + encounterGap(rng, path.length, s.difficulty) * 0.5;
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
