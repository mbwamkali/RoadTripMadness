import { describe, expect, it } from 'vitest';
import { parseLive, weatherFromCode } from '../src/geo/liveWeather';
import { buildRouteData, pathFromRoute } from '../src/geo/route';
import { demoRawRoute } from '../src/geo/demoRoute';
import { newGame } from '../src/game/state';
import { hourOf, weatherAt } from '../src/game/time';

describe('live weather and time', () => {
  it('maps weather codes', () => {
    expect(weatherFromCode(0)).toBe('clear');
    expect(weatherFromCode(3)).toBe('clear');
    expect(weatherFromCode(45)).toBe('fog');
    expect(weatherFromCode(53)).toBe('rain');
    expect(weatherFromCode(75)).toBe('snow');
    expect(weatherFromCode(95)).toBe('rain');
  });

  it('reads the start time and weather along the route', () => {
    const json = [
      { current: { time: '2026-10-31T21:45', weather_code: 53 } },
      { current: { time: '2026-10-31T21:45', weather_code: 3 } },
    ];
    const c = parseLive(json, [0, 1000])!;
    expect(c.startHour).toBeCloseTo(21.75);
    expect(c.weather).toEqual([
      { at: 0, w: 'rain' },
      { at: 1000, w: 'clear' },
    ]);
    expect(parseLive({ current: {} }, [0])).toBeNull();
  });

  it('uses the real weather and clock when there is one, the climate otherwise', () => {
    const route = buildRouteData(demoRawRoute(3));
    const s = newGame(route, 3);
    expect(hourOf(s)).toBeCloseTo(8);
    s.live = { startHour: 21.75, weather: [{ at: 0, w: 'snow' }, { at: pathFromRoute(route).length, w: 'fog' }] };
    expect(hourOf(s)).toBeCloseTo(21.75);
    expect(weatherAt(s, 10)).toBe('snow');
    expect(weatherAt(s, pathFromRoute(route).length - 10)).toBe('fog');
  });
});
