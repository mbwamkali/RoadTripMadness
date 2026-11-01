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
 * How much more (or less) fuel you burn at a throttle setting (1 = cruise,
 * 0.6 to 1.3 in game). Air drag climbs fast: flat out burns 60% more per
 * mile, while easing off saves a little, down to 20% less at the slowest.
 */
export function speedFuelFactor(throttle: number): number {
  return throttle >= 1 ? 1 + (throttle - 1) * 2 : 1 - (1 - throttle) * 0.5;
}

/** How far ahead (units) the car notices a slower vehicle and brakes. Shrinks when you speed. */
export function brakeRange(throttle: number): number {
  return 16 / Math.max(1, throttle) ** 2;
}

/** Crashing at speed hurts more. */
export function crashScale(throttle: number): number {
  return Math.max(1, throttle) ** 2;
}

/** Fuel economy right now, from the ride, engine upgrades, difficulty and speed. */
export function mpg(s: GameState, throttle: number): number {
  const burn = fuelEfficiency(s.upgrades) * rideOf(s).fuel * DIFFICULTIES[s.difficulty].fuel * speedFuelFactor(throttle);
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
