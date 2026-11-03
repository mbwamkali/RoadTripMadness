import { bossPoints, type GameState } from './state';
import { makeRng, range, type Rng } from './rng';
import type { Stop } from './stops';

/**
 * Dirt-road shortcuts: now and then a bumpy dirt road leaves the route,
 * offered like an exit ("Shortcut?"). Taking it skips a stretch of the
 * trip and saves some gas, but dirt roads are rough: a flat tyre, or an
 * outlaw ambush, can be waiting. Never past a boss, never near the end.
 * Pure game logic so it can be tested.
 */

const NAMES = ['Coyote Cut', 'Old Mill Road', 'Dusty Trail', 'Rattlesnake Pass', 'Cattle Track', 'Gravel Gulch', 'Back Forty Road', 'Tumbleweed Lane', 'Crooked Creek Road', 'Jackrabbit Trail'];

/** One shortcut on shorter trips, two on long ones. */
export function shortcutCount(pathLength: number, rng: Rng): number {
  if (pathLength < 6000) return 0;
  if (pathLength < 18000) return 1;
  return rng() < 0.6 ? 2 : 1;
}

/**
 * Where the shortcuts turn off: between 10% and 80% of the way, clear of
 * the other turn-offs and the boss fights, always on the right (like an exit).
 */
export function placeShortcuts(pathLength: number, seed: number, stops: Stop[]): Stop[] {
  const rng = makeRng(seed ^ 0x5c07c);
  const n = shortcutCount(pathLength, rng);
  const out: Stop[] = [];
  const [half] = bossPoints(pathLength);
  for (let i = 0; i < n; i++) {
    for (let tries = 0; tries < 30; tries++) {
      const at = pathLength * range(rng, 0.1, 0.8);
      const busy = [...stops, ...out].some((s) => Math.abs(s.at - at) < 500) || Math.abs(at - half) < 900;
      if (busy) continue;
      out.push({ id: `shortcut-${i}`, at, side: 'right', kind: 'shortcut', name: NAMES[Math.floor(rng() * NAMES.length)], places: [] });
      break;
    }
  }
  return out;
}

/**
 * How far a shortcut skips ahead: 5 to 15% of what's left, but never past
 * the next boss fight (it waits a little further on) or into the last 10%.
 */
export function shortcutSkip(s: GameState, pathLength: number, at: number, rng: Rng): number {
  const want = (pathLength - at) * range(rng, 0.05, 0.15);
  const bosses = bossPoints(pathLength);
  const nextBoss = s.bossStage < 2 ? bosses[s.bossStage] : Infinity;
  const limit = Math.min(nextBoss - 250, pathLength * 0.9) - at;
  return Math.max(0, Math.min(want, limit));
}

export type ShortcutOutcome = 'clear' | 'flat' | 'ambush';

/** What happens on the dirt road: usually nothing, sometimes a flat tyre, sometimes outlaws (rarer in kid mode). */
export function rollShortcut(rng: Rng, kid = false): ShortcutOutcome {
  const r = rng();
  const ambush = kid ? 0.08 : 0.2;
  if (r < ambush) return 'ambush';
  if (r < ambush + 0.25) return 'flat';
  return 'clear';
}

/** Taps it takes to change the flat tyre. */
export const FLAT_TAPS = { normal: 6, kid: 3 };

/**
 * Takes the shortcut: jumps ahead, burns less gas than the road would have
 * (the dirt road is shorter), and passes the turn-offs in between. Fights
 * and road events that were due on the skipped stretch move along too.
 * Returns the gas used.
 */
export function takeShortcut(s: GameState, stop: Stop, skip: number, fuelRate: number): number {
  const from = stop.at;
  const to = from + skip;
  const gas = Math.min(s.inv.fuel - 1, skip * fuelRate * 0.5);
  s.inv.fuel = Math.max(1, s.inv.fuel - Math.max(0, gas));
  s.distance = to;
  for (const st of s.stops) if (st.at <= to + 5 && !s.passed.includes(st.id)) s.passed.push(st.id);
  if (s.nextEncounterAt < to + 200) s.nextEncounterAt = to + 400;
  if (s.nextEventAt < to + 200) s.nextEventAt = to + 600;
  s.log.push(`Took the ${stop.name} shortcut.`);
  return Math.max(0, gas);
}

/** Fixing a flat: a scrap patch if you have one, otherwise it takes a while (half an hour). */
export function fixFlat(s: GameState): 'scrap' | 'time' {
  if (s.inv.scrap > 0) {
    s.inv.scrap--;
    return 'scrap';
  }
  s.hoursSpent = (s.hoursSpent ?? 0) + 0.5;
  return 'time';
}
