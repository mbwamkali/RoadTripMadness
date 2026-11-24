/**
 * Zombie time: when a horde shows up on the road, the game slows down just
 * enough that you always get a fair moment to react (brake, swerve or start
 * shooting) before you reach it, however fast you're going. Pure rules, so
 * they can be tested; the drive applies the result to its clock.
 */
import type { Difficulty } from './difficulty';

/** Real seconds from a horde showing up to reaching it, at the least. */
export const ZOMBIE_WINDOW: Record<Difficulty, number> & { kid: number } = { kid: 7, easy: 6, normal: 4, hard: 2.5 };
/** Time never runs slower than this. */
export const MIN_TIME_SCALE = 0.25;
/** How quickly time slows (per second) when a horde appears, and how gently it comes back. */
const EASE_IN = 6;
const EASE_OUT = 1.5;

export function zombieWindow(difficulty: Difficulty, kid: boolean): number {
  return kid ? ZOMBIE_WINDOW.kid : ZOMBIE_WINDOW[difficulty];
}

/**
 * How fast game time should run so the nearest horde zombie is reached no
 * sooner than `window` real seconds after it showed up.
 * `dist` units away, closing at `closing` units per game second, seen `age` real seconds ago.
 */
export function wantedTimeScale(h: { dist: number; closing: number; age: number } | null, window: number): number {
  if (!h || h.closing <= 0) return 1;
  const left = window - h.age;
  if (left <= 0) return 1;
  const reach = h.dist / h.closing;
  return Math.max(MIN_TIME_SCALE, Math.min(1, reach / left));
}

/** Eases the clock toward what's wanted: slows fast, speeds back up gently. */
export function easeTimeScale(now: number, want: number, realDt: number): number {
  const rate = want < now ? EASE_IN : EASE_OUT;
  const k = Math.min(1, rate * realDt);
  return now + (want - now) * k;
}
