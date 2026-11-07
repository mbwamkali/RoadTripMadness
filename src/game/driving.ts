import { DIFFICULTIES } from './difficulty';
import { rideOf } from './rides';
import type { GameState } from './state';
import { fuelEfficiency } from './upgrades';

/**
 * Driving feel: the dashboard's fuel economy readout and swipe controls.
 * Pure functions, so the rules can be tested without a scene.
 */

/** Miles per gallon of the stock car at cruise on Normal. Fictional, but in the right range. */
export const BASE_MPG = 24;

/**
 * Speed. The car drives at the speed limit plus however much the player has
 * dialled on or off, in 5 mph steps, from a full stop up to the vehicle's top
 * speed. The limit is only advice: going over costs fuel, makes crashes hurt
 * more and leaves less time to brake. Game units per second are tied to mph,
 * with 65 mph = the old cruise speed.
 */
export const CRUISE_MPH = 65;
/** One swipe or tap on + or − changes speed by this much. */
export const SPEED_STEP = 5;
/** This far over the limit costs nothing extra. */
export const FREE_OVER = 5;
/** Kid mode never goes more than this far over the limit. */
export const KID_OVER = 10;
/** Each engine tune-up level adds this to the top speed. */
export const ENGINE_TOP_MPH = 5;
/** A fight's Boost adds this much, never past the top speed. */
export const BOOST_MPH = 35;

/** The fastest the ride can go, in mph, with its engine upgrades. */
export function topSpeed(s: Pick<GameState, 'ride' | 'upgrades'>): number {
  return rideOf(s).topMph + s.upgrades.engine * ENGINE_TOP_MPH;
}

/** The most the player may dial in right now: the top speed, held to the limit on autopilot and limit + 10 in kid mode. */
export function speedCap(limit: number, top: number, opts: { kid?: boolean; autopilot?: boolean } = {}): number {
  let cap = top;
  if (opts.kid) cap = Math.min(cap, limit + KID_OVER);
  if (opts.autopilot) cap = Math.min(cap, limit);
  return Math.max(0, cap);
}

/** The speed the car aims for: limit plus the player's offset, from a stop up to the cap. */
export function targetMph(limit: number, over: number, cap: number): number {
  return Math.max(0, Math.min(cap, limit + over));
}

/** How far over (or under) the limit the car is beyond the free 5 mph, as a share of the limit. */
function overShare(mph: number, limit: number): number {
  return mph / Math.max(5, limit + FREE_OVER);
}

/**
 * Gas per mile at a steady speed, in made-up units: a fixed part plus air
 * drag, which grows with speed squared. Fitted to Oak Ridge National Lab
 * tests of 74 cars (DOE Facts #772/#982): about 14% worse mileage from 60
 * to 70 mph and 27% worse from 60 to 80.
 */
function fuelPerMile(mph: number): number {
  return 0.56 + 0.000123 * mph * mph;
}

/**
 * How much more (or less) fuel you burn per mile at a speed. Up to 5 over
 * the limit costs nothing extra; past that it follows real cars (above), so
 * 100 on a 65 road burns about 1.54x and 140 about 2.56x. Driving under the
 * limit saves a little, down to 20% less.
 */
export function speedFuelFactor(mph: number, limit: number): number {
  if (mph > limit + FREE_OVER) return fuelPerMile(mph) / fuelPerMile(limit + FREE_OVER);
  if (mph >= limit) return 1;
  return Math.max(0.8, 1 - (1 - mph / Math.max(1, limit)) * 0.5);
}

/** How far ahead (units) the car notices a slower vehicle and brakes. Shrinks when you speed. */
export function brakeRange(mph: number, limit: number): number {
  return 16 / Math.max(1, overShare(mph, limit));
}

/** Crashing at speed hurts more: with speed squared above 65 mph, so 100 hurts about twice as much as 70. */
export function crashScale(mph: number): number {
  return Math.max(1, mph / CRUISE_MPH) ** 2;
}

/** Fuel economy right now, from the ride, engine upgrades, difficulty and speed. */
export function mpg(s: GameState, mph: number, limit: number): number {
  const burn = fuelEfficiency(s.upgrades) * rideOf(s).fuel * DIFFICULTIES[s.difficulty].fuel * speedFuelFactor(mph, limit);
  return BASE_MPG / burn;
}

export type SwipeAction = 'left' | 'right' | 'faster' | 'slower';

/** What a swipe across the road means: sideways changes lanes, up speeds up, down slows down. */
export function swipeAction(dx: number, dy: number, minPx = 36): SwipeAction | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < minPx) return null;
  // Mostly sideways or mostly up and down; a diagonal in between does nothing.
  if (ax > ay * 1.3) return dx < 0 ? 'left' : 'right';
  if (ay > ax * 1.3) return dy < 0 ? 'faster' : 'slower';
  return null;
}
