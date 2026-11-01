import type { Weather } from '../game/time';
import type { Path } from './geo';
import { latLngAt } from './states';
import type { RouteData } from './route';

/**
 * Real weather along the route right now, and the real local time at the
 * start, from Open-Meteo (free, no key, CC BY 4.0). One request for the whole
 * route; any failure just means the game falls back to its own climate weather.
 */
export interface LiveConditions {
  /** Local hour (0-24) at the start when the trip began. */
  startHour?: number;
  /** Weather samples along the path, sorted by distance. */
  weather: { at: number; w: Weather }[];
}

const API = 'https://api.open-meteo.com/v1/forecast';
const KEY = 'rtm-live';

/** Turns a WMO weather code into the game's weather. */
export function weatherFromCode(code: number): Weather {
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 'rain';
  return 'clear';
}

interface OpenMeteoPoint {
  current?: { time?: string; weather_code?: number };
}

/** Parses Open-Meteo's answer (one object for one point, an array for several). */
export function parseLive(json: OpenMeteoPoint | OpenMeteoPoint[], at: number[]): LiveConditions | null {
  const list = Array.isArray(json) ? json : [json];
  const weather: LiveConditions['weather'] = [];
  list.forEach((p, i) => {
    const code = p.current?.weather_code;
    if (typeof code === 'number' && at[i] !== undefined) weather.push({ at: at[i], w: weatherFromCode(code) });
  });
  if (!weather.length) return null;
  // "2026-10-31T21:45" is local time at that point (timezone=auto).
  const m = list[0].current?.time?.match(/T(\d\d):(\d\d)/);
  const startHour = m ? parseInt(m[1], 10) + parseInt(m[2], 10) / 60 : undefined;
  return { weather, ...(startHour !== undefined ? { startHour } : {}) };
}

/** Where to sample: every 80 km or so, at most 25 points. */
export function samplePoints(route: RouteData, path: Path): number[] {
  const km = route.realMeters / 1000;
  const n = Math.max(2, Math.min(25, Math.round(km / 80) + 1));
  return Array.from({ length: n }, (_, i) => (path.length * i) / (n - 1));
}

export async function fetchLiveConditions(route: RouteData, path: Path, timeoutMs = 8000): Promise<LiveConditions | null> {
  try {
    const at = samplePoints(route, path);
    const pts = at.map((d) => latLngAt(route, path, d));
    const url =
      `${API}?latitude=${pts.map((p) => p.lat.toFixed(3)).join(',')}` +
      `&longitude=${pts.map((p) => p.lng.toFixed(3)).join(',')}&current=weather_code&timezone=auto`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return parseLive(await res.json(), at);
  } catch {
    return null;
  }
}

/** Whether to use real weather and time (on unless the player turned it off). */
export function liveEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setLiveEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* storage blocked */
  }
}
