import { describe, expect, it } from 'vitest';
import { BASE_MPG, mpg, swipeAction } from '../src/game/driving';
import { newGame } from '../src/game/state';
import { demoRawRoute } from '../src/geo/demoRoute';
import { buildRouteData } from '../src/geo/route';

describe('swipe controls', () => {
  it('reads sideways swipes as lane changes and up/down as speed', () => {
    expect(swipeAction(-80, 5)).toBe('left');
    expect(swipeAction(90, -10)).toBe('right');
    expect(swipeAction(4, -70)).toBe('faster');
    expect(swipeAction(-6, 60)).toBe('slower');
  });

  it('ignores taps and diagonals', () => {
    expect(swipeAction(10, 12)).toBeNull();
    expect(swipeAction(60, 58)).toBeNull();
  });
});

describe('fuel economy readout', () => {
  it('is the base figure for the stock car on Normal and better on a motorcycle', () => {
    const car = newGame(buildRouteData(demoRawRoute()), 1, 'normal', 'car');
    expect(mpg(car, 65, 65)).toBeCloseTo(BASE_MPG);
    const bike = newGame(buildRouteData(demoRawRoute()), 1, 'normal', 'motorcycle');
    expect(mpg(bike, 65, 65)).toBeGreaterThan(mpg(car, 65, 65));
  });
});

describe('speed costs fuel and adds risk', () => {
  it('is free up to 5 over, then burns more and more; easing off saves a little', async () => {
    const { speedFuelFactor } = await import('../src/game/driving');
    expect(speedFuelFactor(65, 65)).toBe(1);
    expect(speedFuelFactor(70, 65)).toBe(1);
    expect(speedFuelFactor(100, 75)).toBeCloseTo(1.5625);
    expect(speedFuelFactor(140, 65)).toBeCloseTo(4);
    expect(speedFuelFactor(30, 75)).toBeCloseTo(0.8);
    expect(speedFuelFactor(0, 35)).toBeCloseTo(0.8);
    const car = newGame(buildRouteData(demoRawRoute()), 1, 'normal', 'car');
    expect(mpg(car, 90, 65)).toBeLessThan(mpg(car, 65, 65));
    expect(mpg(car, 50, 65)).toBeGreaterThan(mpg(car, 65, 65));
  });

  it('notices slow traffic later and crashes harder when speeding', async () => {
    const { brakeRange, crashScale } = await import('../src/game/driving');
    expect(brakeRange(65, 65)).toBe(16);
    expect(brakeRange(40, 65)).toBe(16);
    expect(brakeRange(140, 65)).toBeLessThan(9);
    expect(crashScale(40)).toBe(1);
    expect(crashScale(65)).toBe(1);
    expect(crashScale(100) / crashScale(70)).toBeCloseTo(2.04, 1);
  });
});

describe('speed choice', () => {
  it('top speed comes from the ride, plus 5 mph per engine level', async () => {
    const { topSpeed } = await import('../src/game/driving');
    const u = { armor: 0, tank: 0, engine: 0, turret: 0, ram: 0 };
    expect(topSpeed({ ride: 'motorcycle', upgrades: u })).toBe(140);
    expect(topSpeed({ ride: 'car', upgrades: u })).toBe(120);
    expect(topSpeed({ ride: 'truck', upgrades: u })).toBe(95);
    expect(topSpeed({ ride: 'car', upgrades: { ...u, engine: 3 } })).toBe(135);
  });

  it('goes from a stop to the cap; kid mode stays within 10 over and autopilot at the limit', async () => {
    const { speedCap, targetMph } = await import('../src/game/driving');
    expect(targetMph(65, -100, 120)).toBe(0);
    expect(targetMph(65, 80, 120)).toBe(120);
    expect(targetMph(35, 10, 120)).toBe(45);
    expect(speedCap(35, 120, { kid: true })).toBe(45);
    expect(speedCap(65, 120, { autopilot: true })).toBe(65);
    expect(speedCap(75, 95)).toBe(95);
  });
});
