import type { RouteData } from '../geo/route';
import { pathFromRoute } from '../geo/route';
import { DIFFICULTIES, type Difficulty } from './difficulty';
import { fuelEfficiency } from './upgrades';
import { rideOf, type Ride } from './rides';
import { advance, buyFuel, foundCash, fuelPerUnit, newGame, search, tankSize, type GameState } from './state';
import { hasFuel, type Stop } from './stops';

/**
 * A quick, rules-only play-through of a trip, to check that gas and money
 * work out on real routes (scripts/trip-balance.mjs and tests/tripBalance.test.ts).
 * Uses the game's own rules: newGame's stops, advance's fuel burn, search's
 * loot, buyFuel's price. Drives at the speed limit. Fights aren't played:
 * a search that brings an ambush finds nothing, and each boss pays its
 * reward as if beaten. Road events and outlaw bounties are left out, so the
 * result errs on the hard side.
 *
 * Two players:
 * - careful: takes every turn-off, searches each building once, tops up at every pump.
 * - hurried: only pulls in for gas when the next pumps (or the finish) are out
 *   of reach with a 15% spare, searches one building there and fills up.
 */
export type Player = 'careful' | 'hurried';

export interface TripResult {
  finished: boolean;
  /** Ran dry at least once (the bike rescue would have saved the first time). */
  ranDry: number;
  fillUps: number;
  gasBought: number;
  spentOnGas: number;
  cashFound: number;
  /** Times the player wanted gas but couldn't pay for a full tank. */
  shortOfCash: number;
  /** Lowest the tank got, as a share of a full tank. */
  lowestTank: number;
  endCash: number;
  stopsTaken: number;
}

const BOSS_CASH = 80;
const STEP = 40;

export function simulateTrip(route: RouteData, ride: Ride, difficulty: Difficulty, player: Player, seed = 1): TripResult {
  const s = newGame(route, seed, difficulty, ride);
  const path = pathFromRoute(route);
  const rate = fuelPerUnit(route.scale);
  const r: TripResult = { finished: false, ranDry: 0, fillUps: 0, gasBought: 0, spentOnGas: 0, cashFound: 0, shortOfCash: 0, lowestTank: 1, endCash: 0, stopsTaken: 0 };
  const stops = [...s.stops].sort((a, b) => a.at - b.at);
  const pumps = stops.filter(hasFuel);
  let next = 0;

  const driveTo = (to: number) => {
    while (s.status === 'driving' && s.distance < to - 0.01) {
      const res = advance(s, path, Math.min(STEP, to - s.distance), rate);
      r.lowestTank = Math.min(r.lowestTank, s.inv.fuel / tankSize(s));
      if (res.boss) s.inv.cash += foundCash(s, BOSS_CASH);
      if (res.outOfFuel) {
        r.ranDry++;
        if (s.status !== 'driving') return;
        // The bike rescue: a can with 30% of a tank, once per trip.
        s.bikeUsed = true;
        s.inv.fuel = Math.round(tankSize(s) * 0.3);
      }
    }
  };

  const loot = (stop: Stop, place: Stop['places'][number]) => {
    const before = s.inv.cash;
    search(s, stop.id, place);
    r.cashFound += Math.max(0, s.inv.cash - before);
  };

  const fill = () => {
    const before = s.inv.cash;
    const want = tankSize(s) - s.inv.fuel;
    const res = buyFuel(s);
    if (!res.ok && want < 1) return;
    if (s.inv.fuel < tankSize(s) - 1) r.shortOfCash++;
    if (res.ok) {
      r.fillUps++;
      r.gasBought += want - (tankSize(s) - s.inv.fuel);
      r.spentOnGas += before - s.inv.cash;
    }
  };

  /** Fuel needed (units) to drive from here to a point, at the limit. */
  const need = (to: number) => (to - s.distance) * rate * burnPerUnit(s);

  while (s.status === 'driving' && next < stops.length) {
    const stop = stops[next++];
    driveTo(stop.at);
    if (s.status !== 'driving') break;
    const gas = hasFuel(stop);
    if (player === 'careful') {
      r.stopsTaken++;
      for (const p of stop.places) loot(stop, p);
      if (gas) fill();
      continue;
    }
    // Hurried: only for gas, when it's getting low or the next pumps are too far.
    if (!gas) continue;
    const nextPump = pumps.find((p) => p.at > stop.at)?.at ?? path.length;
    const low = need(nextPump) > s.inv.fuel - tankSize(s) * 0.15;
    if (!low) continue;
    r.stopsTaken++;
    const shop = stop.places.find((p) => p === 'grocery' || p === 'pharmacy' || p === 'motel') ?? 'pumps';
    loot(stop, shop);
    fill();
  }
  if (s.status === 'driving') driveTo(path.length);
  r.finished = s.status === 'won';
  r.endCash = s.inv.cash;
  return r;
}

/** The multiplier advance() applies on top of the per-unit rate (upgrades, ride, difficulty). */
function burnPerUnit(s: GameState): number {
  return fuelEfficiency(s.upgrades) * rideOf(s).fuel * DIFFICULTIES[s.difficulty].fuel;
}
