import { describe, expect, it } from 'vitest';
import { buildRouteData } from '../src/geo/route';
import { demoRawRoute } from '../src/geo/demoRoute';
import { newGame, search } from '../src/game/state';
import { clockText, DAY_LENGTH, daylight, hourOf, isNight, weatherAt } from '../src/game/time';

const route = buildRouteData(demoRawRoute());

describe('day and night', () => {
  it('starts in the morning and gets dark as you drive', () => {
    const s = newGame(route, 1);
    expect(clockText(hourOf(s))).toBe('8:00 AM');
    expect(isNight(hourOf(s))).toBe(false);
    s.distance = DAY_LENGTH * 0.6; // about 10:24 PM
    expect(isNight(hourOf(s))).toBe(true);
  });

  it('has bright middays and dark midnights', () => {
    expect(daylight(12)).toBe(1);
    expect(daylight(0)).toBe(0);
    expect(daylight(6.5)).toBeGreaterThan(0);
    expect(daylight(6.5)).toBeLessThan(1);
  });

  it('searching at a stop takes time', () => {
    const s = newGame(route, 1);
    search(s, 'a', 'barn');
    expect(hourOf(s)).toBeCloseTo(8.75);
  });

  it('starts clear and has some weather along the way', () => {
    const s = newGame(route, 9);
    expect(weatherAt(s, 0)).toBe('clear');
    const kinds = new Set<string>();
    for (let d = 0; d < 60000; d += 3500) kinds.add(weatherAt(s, d));
    expect(kinds.size).toBeGreaterThan(1);
  });
});
