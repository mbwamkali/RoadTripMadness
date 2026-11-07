import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { Atlas, type AtlasFile } from '../src/offline/atlas';
import { unpackRoute, type PackedRoute } from '../src/offline/curated';
import { buildRouteData, type RouteData } from '../src/geo/route';
import { makeRng } from '../src/game/rng';
import { simulateTrip, type Player, type TripResult } from '../src/game/tripSim';
import type { Ride } from '../src/game/rides';
import type { Difficulty } from '../src/game/difficulty';

/**
 * Gas and money on real trips: the five classic trips plus random atlas trips
 * between big cities, for every ride, difficulty and both player styles in
 * src/game/tripSim.ts. Run `BALANCE_REPORT=1 npx vitest run tests/tripBalance.test.ts`
 * to print the full table.
 */

const atlas = new Atlas(JSON.parse(fs.readFileSync('public/data/atlas-us.json', 'utf8')) as AtlasFile);
const MILE = 1609.344;

interface Trip {
  name: string;
  route: RouteData;
  miles: number;
}

function classic(file: string): Trip {
  const raw = unpackRoute(JSON.parse(fs.readFileSync(`public/data/routes/${file}`, 'utf8')) as PackedRoute);
  raw.features = atlas.featuresAlong(raw.coords);
  const route = buildRouteData(raw);
  return { name: `${raw.startLabel.split(',')[0]} → ${raw.endLabel.split(',')[0]}`, route, miles: raw.realMeters / MILE };
}

/** Random trips between the 150 biggest atlas cities (fixed seed, so the same every run). */
function randomTrips(n: number, seed: number): Trip[] {
  const rng = makeRng(seed);
  const big = atlas.cities.slice(0, 150);
  const out: Trip[] = [];
  for (let tries = 0; out.length < n && tries < n * 10; tries++) {
    const a = big[Math.floor(rng() * big.length)];
    const b = big[Math.floor(rng() * big.length)];
    if (a === b) continue;
    try {
      const raw = atlas.planTrip(a, b, `${a.name}, ${a.state}`, `${b.name}, ${b.state}`);
      raw.features = atlas.featuresAlong(raw.coords);
      out.push({ name: `${a.name} → ${b.name}`, route: buildRouteData(raw), miles: raw.realMeters / MILE });
    } catch {
      // Unreachable in the atlas; pick another pair.
    }
  }
  return out;
}

const TRIPS: Trip[] = [
  ...['vegas-run.json', 'overseas-highway.json', 'pacific-coast.json', 'route-66.json', 'coast-to-coast.json'].map(classic),
  ...randomTrips(10, 2026),
];
const RIDES: Ride[] = ['car', 'motorcycle', 'truck'];
const LEVELS: Difficulty[] = ['easy', 'normal', 'hard'];
const SEEDS = [1, 2, 3];

type Row = { trip: Trip; ride: Ride; level: Difficulty; player: Player; runs: TripResult[] };
const rows: Row[] = [];
for (const trip of TRIPS)
  for (const ride of RIDES)
    for (const level of LEVELS)
      for (const player of ['careful', 'hurried'] as Player[]) rows.push({ trip, ride, level, player, runs: SEEDS.map((seed) => simulateTrip(trip.route, ride, level, player, seed)) });

if (process.env.BALANCE_REPORT) {
  const lines = ['trip | miles | ride | level | player | finished | ran dry | fill-ups | gas $ | cash found | short of $ | lowest tank | end $'];
  for (const r of rows) {
    const avg = (f: (x: TripResult) => number) => Math.round(r.runs.reduce((t, x) => t + f(x), 0) / r.runs.length);
    lines.push(
      [r.trip.name, Math.round(r.trip.miles), r.ride, r.level, r.player, `${r.runs.filter((x) => x.finished).length}/${r.runs.length}`, avg((x) => x.ranDry), avg((x) => x.fillUps), avg((x) => x.spentOnGas), avg((x) => x.cashFound), avg((x) => x.shortOfCash), `${Math.round(Math.min(...r.runs.map((x) => x.lowestTank)) * 100)}%`, avg((x) => x.endCash)].join(' | '),
    );
  }
  fs.writeFileSync('trip-balance.txt', lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}

describe('trip balance: gas and money on real routes', () => {
  it('has the classic trips and a spread of random ones', () => {
    expect(TRIPS.length).toBeGreaterThanOrEqual(12);
    expect(Math.max(...TRIPS.map((t) => t.miles))).toBeGreaterThan(2000);
    expect(Math.min(...TRIPS.map((t) => t.miles))).toBeLessThan(300);
  });

  it('a careful player finishes every trip on every ride and difficulty without running dry', () => {
    for (const r of rows.filter((x) => x.player === 'careful'))
      for (const x of r.runs) {
        expect(x.finished, `${r.trip.name} ${r.ride} ${r.level}`).toBe(true);
        expect(x.ranDry, `${r.trip.name} ${r.ride} ${r.level}`).toBe(0);
      }
  });

  it('a careful player can always pay for a full tank on Easy and Normal', () => {
    for (const r of rows.filter((x) => x.player === 'careful' && x.level !== 'hard')) for (const x of r.runs) expect(x.shortOfCash, `${r.trip.name} ${r.ride} ${r.level}`).toBe(0);
  });

  it('a hurried player (gas stops only) still finishes on Easy and Normal, at most using the bike once', () => {
    for (const r of rows.filter((x) => x.player === 'hurried' && x.level !== 'hard'))
      for (const x of r.runs) {
        expect(x.finished, `${r.trip.name} ${r.ride} ${r.level}`).toBe(true);
        expect(x.ranDry, `${r.trip.name} ${r.ride} ${r.level}`).toBeLessThanOrEqual(1);
      }
  });

  it('short trips need no gas stop', () => {
    for (const r of rows.filter((x) => x.trip.miles < 200 && x.ride === 'car' && x.level !== 'hard' && x.player === 'hurried')) for (const x of r.runs) expect(x.fillUps, r.trip.name).toBe(0);
  });
});
