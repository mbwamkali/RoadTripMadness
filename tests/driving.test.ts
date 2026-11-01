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
    expect(mpg(car, 1)).toBeCloseTo(BASE_MPG);
    const bike = newGame(buildRouteData(demoRawRoute()), 1, 'normal', 'motorcycle');
    expect(mpg(bike, 1)).toBeGreaterThan(mpg(car, 1));
  });
});
