/**
 * What you drive. The muscle car is the all-rounder; the motorcycle is fast,
 * nimble and thrifty but fragile and carries little; the pickup truck is slow
 * and thirsty but tough, with a bigger tank and a heavier gun.
 */
export type Ride = 'car' | 'motorcycle' | 'truck';

export interface RideInfo {
  name: string;
  icon: string;
  blurb: string;
  /** Multipliers on the car's base values. */
  health: number;
  tank: number;
  /** Fuel burned per unit. */
  fuel: number;
  /** Top speed in mph (engine upgrades add to it). */
  topMph: number;
  /** How fast it changes lanes (on the road and in fights). */
  steer: number;
  /** Chance an enemy hit misses entirely in a fight. */
  dodge: number;
  /** Starting ammo it can carry. */
  carry: number;
  /** Machine gun damage. */
  gun: number;
  /** Damage taken ramming things or crashing. */
  ram: number;
  /** Length for collisions. */
  length: number;
}

export const RIDES: Record<Ride, RideInfo> = {
  motorcycle: {
    name: 'Motorcycle',
    icon: '🏍️',
    blurb: 'Fast, nimble and easy on gas. Dodges more, but fragile and carries little.',
    health: 0.6,
    tank: 0.6,
    fuel: 0.55,
    topMph: 140,
    steer: 1.8,
    dodge: 0.3,
    carry: 0.6,
    gun: 0.85,
    ram: 1.8,
    length: 2.2,
  },
  car: {
    name: 'Muscle car',
    icon: '🚗',
    blurb: 'The all-rounder.',
    health: 1,
    tank: 1,
    fuel: 1,
    topMph: 120,
    steer: 1,
    dodge: 0,
    carry: 1,
    gun: 1,
    ram: 1,
    length: 4.4,
  },
  truck: {
    name: 'Pickup truck',
    icon: '🛻',
    blurb: 'Slower and thirsty, but tough, with a big tank, more ammo and a heavy gun.',
    health: 1.5,
    tank: 1.4,
    fuel: 1.35,
    topMph: 95,
    steer: 0.7,
    dodge: 0,
    carry: 1.5,
    gun: 1.3,
    ram: 0.55,
    length: 5.4,
  },
};

export const RIDE_IDS: Ride[] = ['motorcycle', 'car', 'truck'];

export const rideOf = (s: { ride?: Ride }): RideInfo => RIDES[s.ride ?? 'car'];

const KEY = 'rtm-ride';

export function loadRide(): Ride {
  try {
    const r = localStorage.getItem(KEY) as Ride | null;
    return r && r in RIDES ? r : 'car';
  } catch {
    return 'car';
  }
}

export function saveRide(r: Ride): void {
  try {
    localStorage.setItem(KEY, r);
  } catch {
    /* storage blocked */
  }
}
