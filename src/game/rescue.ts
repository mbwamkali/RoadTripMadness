import { realKmAt } from '../geo/route';
import { makeRng } from './rng';
import { fuelCost, tankSize, type GameState } from './state';
import { hasFuel, type Stop } from './stops';
import { hourOf, isNight } from './time';

/**
 * Bike rescue: the first time the tank runs dry you find an old bicycle and
 * can pedal to the nearest pumps for a can of gas. It costs hours and it can
 * go wrong on the way back. After that, running dry ends the trip.
 */
export interface BikePlan {
  /** Where the pumps are (null: no pumps anywhere, so you hunt wrecks for gas). */
  stop: Stop | null;
  /** Real km one way. */
  km: number;
  /** Ahead of the car or back the way you came. */
  ahead: boolean;
  hours: number;
}

export interface BikeOutcome {
  fuel: number;
  cash: number;
  hours: number;
  /** What happened, in order, for the little story on screen. */
  story: string[];
}

/** Bike speed with a gas can on the back, km/h. */
const BIKE_KMH = 16;

export const canUseBike = (s: GameState) => !s.bikeUsed;

/** The closest stop with pumps, ahead or behind. */
export function planBikeRide(s: GameState): BikePlan {
  const pumps = s.stops.filter(hasFuel);
  const best = pumps.sort((a, b) => Math.abs(a.at - s.distance) - Math.abs(b.at - s.distance))[0] ?? null;
  const gap = best ? Math.abs(best.at - s.distance) : 0;
  const km = best ? Math.max(0.5, realKmAt(s.route, gap)) : 0;
  const hours = best ? Math.min(10, Math.max(1, (2 * km) / BIKE_KMH + 0.5)) : 3;
  return { stop: best, km, ahead: best ? best.at >= s.distance : true, hours: Math.round(hours * 4) / 4 };
}

/** Rides there and back. Mutates the state (fuel, cash, clock) and marks the bike as used. */
export function rideForGas(s: GameState, plan: BikePlan = planBikeRide(s)): BikeOutcome {
  const rng = makeRng(s.seed ^ Math.floor(s.distance) ^ 0xb1c7c1e);
  const story: string[] = [];
  const can = Math.round(tankSize(s) * 0.3);
  let fuel: number;
  let cash = 0;
  if (!plan.stop) {
    story.push('No pumps anywhere near. You pedal from wreck to wreck with a hose.');
    fuel = Math.round(can * 0.5);
  } else {
    story.push(`You pedal ${plan.km < 10 ? plan.km.toFixed(1) : Math.round(plan.km)} km ${plan.ahead ? 'up the road' : 'back the way you came'} to ${plan.stop.name}.`);
    const price = fuelCost(s, can);
    if (s.inv.cash >= price) {
      cash = -price;
      fuel = can;
      story.push(`You fill a gas can for $${price}.`);
    } else {
      // Broke: siphon what you can from the cars out back.
      fuel = Math.round(can * 0.6);
      story.push('No money for the pumps, so you siphon a can from the cars out back.');
    }
  }
  // The ride back is the dangerous part, worse at night and on long rides.
  const risk = 0.2 + (isNight(hourOf(s)) ? 0.2 : 0) + Math.min(0.25, plan.km / 200);
  if (rng() < risk) {
    if (rng() < 0.5) {
      const spilt = Math.round(fuel * 0.4);
      fuel -= spilt;
      story.push(`A zombie lunges out of a ditch. You make it, but ${spilt} fuel sloshes out of the can.`);
    } else {
      const lost = Math.min(s.inv.cash + cash, 10 + Math.floor(rng() * 20));
      cash -= lost;
      story.push(lost > 0 ? `Two raiders on dirt bikes run you off the road and take $${lost}.` : 'Two raiders run you off the road, see your empty pockets, and leave.');
    }
  } else story.push('The ride back is quiet. Just you, the crickets and a sloshing can.');
  story.push(`You pour ${fuel} fuel into the tank and leave the bike by the road.`);
  s.inv.fuel = Math.min(tankSize(s), s.inv.fuel + fuel);
  s.inv.cash = Math.max(0, s.inv.cash + cash);
  s.hoursSpent += plan.hours;
  s.bikeUsed = true;
  s.log.push('Ran out of gas and rode a bike for more.');
  return { fuel, cash, hours: plan.hours, story };
}
