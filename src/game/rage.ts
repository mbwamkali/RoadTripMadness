import { DIFFICULTIES } from './difficulty';
import { rideOf } from './rides';
import type { Rng } from './rng';
import { damage, type GameState } from './state';
import type { Vehicle, VehicleKind } from './traffic';

/**
 * Road rage. The gun can hit ordinary traffic too, but every hit makes the road
 * angrier: the rage meter climbs, and past RAGE_HOSTILE some drivers you meet
 * turn hostile and shoot back while you drive (no fight scene). Rage cools as
 * you put distance behind you. Pure rules, so they can be tested.
 */

export const RAGE_MAX = 100;
/** Above this some drivers fight back. */
export const RAGE_HOSTILE = 40;
export const RAGE_PER_HIT = 6;
export const RAGE_PER_WRECK = 14;
/** Rage lost per 1000 units driven (about a minute of driving at cruise). */
export const RAGE_COOL = 30;
/** How close (units, along the road) a hostile driver must be to shoot. */
export const HOSTILE_RANGE = 45;

/** Shots each kind of vehicle takes before it's wrecked (bullets; a shell counts as three). */
export const VEHICLE_HP: Record<VehicleKind, number> = { motorcycle: 1, car: 3, pickup: 4, van: 4, truck: 8 };
/** Scrap you can pull from what's left. */
export const VEHICLE_SCRAP: Record<VehicleKind, number> = { motorcycle: 1, car: 3, pickup: 4, van: 4, truck: 6 };

export const rageOf = (s: GameState) => s.rage ?? 0;

export function addRage(s: GameState, amount: number): void {
  s.rage = Math.min(RAGE_MAX, rageOf(s) + amount);
}

/** Rage cools as you drive on. */
export function coolRage(s: GameState, distance: number): void {
  if (rageOf(s) > 0) s.rage = Math.max(0, rageOf(s) - (distance * RAGE_COOL) / 1000);
}

/** Chance a driver you meet is hostile at this rage. */
export function hostileChance(rage: number): number {
  if (rage < RAGE_HOSTILE) return 0;
  return Math.min(0.6, 0.15 + (rage - RAGE_HOSTILE) / 100);
}

/** Rolls once per vehicle whether its driver is out for revenge. */
export function rollHostile(v: Vehicle, rage: number, rng: Rng): void {
  if (v.rolled || rage < RAGE_HOSTILE) return;
  v.rolled = true;
  if (rng() < hostileChance(rage)) {
    v.hostile = true;
    v.fireIn = 1.5 + rng() * 1.5;
  }
}

/**
 * One shot at a vehicle: spends a bullet (or a shell), raises rage, and wrecks
 * it when its hp runs out. Shooting a hostile driver back costs no extra rage.
 * Returns null with no ammo.
 */
export function shootVehicle(s: GameState, v: Vehicle): { destroyed: boolean; scrap: number; ammo: 'bullets' | 'shells' } | null {
  const ammo = s.inv.bullets > 0 ? 'bullets' : s.inv.shells > 0 ? 'shells' : null;
  if (!ammo) return null;
  s.inv[ammo]--;
  v.hp ??= VEHICLE_HP[v.kind];
  v.hp -= ((ammo === 'shells' ? 3 : 1) + s.upgrades.turret) * Math.max(1, rideOf(s).gun);
  // Any hit makes this driver mad, whatever the meter says.
  if (!v.hostile) {
    v.hostile = true;
    v.rolled = true;
    v.fireIn = 1.2;
    addRage(s, RAGE_PER_HIT);
  }
  if (v.hp > 0) return { destroyed: false, scrap: 0, ammo };
  addRage(s, RAGE_PER_WRECK);
  const scrap = VEHICLE_SCRAP[v.kind];
  s.inv.scrap += scrap;
  return { destroyed: true, scrap, ammo };
}

/**
 * A hostile driver's shot at you. Bikes dodge some; the difficulty sets the
 * damage. Returns the damage done (0 on a miss).
 */
export function hostileShot(s: GameState, v: Vehicle, rng: Rng): number {
  v.fireIn = 2 + rng() * 1.5;
  if (rng() < rideOf(s).dodge + 0.25) return 0;
  const base = v.kind === 'truck' ? 5 : v.kind === 'motorcycle' ? 3 : 4;
  const amount = Math.max(1, Math.round(base * DIFFICULTIES[s.difficulty].dmg));
  damage(s, amount);
  return amount;
}
