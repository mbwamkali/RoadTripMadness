import { BIOMES, biomeAtDistance, biomeSpans } from './biomes';
import type { GameState } from './state';
import { hashString, makeRng } from './rng';

/** One full day passes every this many game units of driving (about 4 minutes at cruise). */
export const DAY_LENGTH = 9000;
const START_HOUR = 8;

/** Hour of day, 0-24. Driving and time spent at stops both move the clock. */
export function hourOf(s: GameState): number {
  return ((s.live?.startHour ?? START_HOUR) + (s.distance / DAY_LENGTH) * 24 + (s.hoursSpent ?? 0)) % 24;
}

/** 0 at night, 1 at midday, with smooth dawn and dusk. */
export function daylight(hour: number): number {
  const x = Math.sin(((hour - 6) / 12) * Math.PI);
  return Math.max(0, Math.min(1, x * 1.6 + 0.15));
}

export const isNight = (hour: number) => daylight(hour) < 0.25;

export function clockText(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.floor((hour - h) * 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export type Weather = 'clear' | 'rain' | 'dust' | 'fog' | 'snow';

export const WEATHER_INFO: Record<Weather, { icon: string; name: string }> = {
  clear: { icon: '☀️', name: 'Clear' },
  rain: { icon: '🌧️', name: 'Rain' },
  dust: { icon: '🌪️', name: 'Dust storm' },
  fog: { icon: '🌫️', name: 'Fog' },
  snow: { icon: '❄️', name: 'Snow' },
};

const WEATHER_SPAN = 3500;

/**
 * Weather for a stretch of road: the real weather there right now when it
 * was looked up, otherwise from the local climate (deserts get dust, the cold
 * North and mountains get snow).
 */
export function weatherAt(s: GameState, distance = s.distance): Weather {
  const live = s.live?.weather;
  if (live?.length) {
    let best = live[0];
    for (const p of live) if (Math.abs(p.at - distance) < Math.abs(best.at - distance)) best = p;
    return best.w;
  }
  const span = Math.floor(distance / WEATHER_SPAN);
  if (span === 0) return 'clear';
  const r = makeRng(s.seed ^ hashString(`weather${span}`))();
  const climate = BIOMES[biomeAtDistance(biomeSpans(s.route), distance)].weather;
  const desert = climate === 'dry';
  const cold = climate === 'cold';
  if (r < 0.55) return 'clear';
  if (r < 0.72) return desert ? 'dust' : cold ? 'snow' : 'rain';
  if (r < 0.87) return desert ? 'clear' : 'rain';
  return 'fog';
}

/** Night fights are tougher, but scavenging in the dark finds more. */
export const nightDanger = (hour: number) => (isNight(hour) ? 0.15 : 0);
export const nightLoot = (hour: number) => (isNight(hour) ? 1.4 : 1);
