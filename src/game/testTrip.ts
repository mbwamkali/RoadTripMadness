/**
 * Test trips: a short made-up road opened straight from the address bar, for
 * checking one thing (a boss, the town, the bike rescue...) without driving a
 * whole trip. Read by parseTestFlags; built by makeTestGame; main.ts adds the
 * parts that need the screen (turning into the town, the forced road event).
 * Values are in specs.md under "Test trips". Test trips are never saved or
 * scored (testFlag.ts).
 *
 *   ?test=boss&boss=karen     short ride to a boss (queen = the Cat Queen at the finish)
 *   ?test=town                straight into the town
 *   ?test=garage              into the town's garage, with cash for upgrades
 *   ?test=bike                the tank runs dry before the town (bike rescue)
 *   ?test=gasturn             the tank runs dry just after you tap Turn
 *   ?test=event&event=...     a road event a few seconds in
 *   ?test=fight&enemy=...     a fight a few seconds in (&horde=1 for a zombie horde)
 * Add-ons: &town=fake|real|0 &ride= &diff= &kid=1 &time= &weather= &cash= &gas=
 *          &tough=1 &radio=
 */
import type { LatLng } from '../geo/geo';
import { buildRouteData, CRUISE_SPEED, pathFromRoute, type RawRoute, type RawStep, type RouteData } from '../geo/route';
import { BOSS_INFO, HALF_BOSSES, type BossKind, type EnemyType } from './combat';
import { DIFFICULTIES, DIFFICULTY_IDS, type Difficulty } from './difficulty';
import { EVENT_IDS } from './events';
import { RIDE_IDS, rideOf, type Ride } from './rides';
import { bossPoints, fuelPerUnit, newGame, type GameState } from './state';
import type { PlaceKind, Stop } from './stops';
import { WEATHER_INFO, type Weather } from './time';
import { fuelEfficiency } from './upgrades';

export type TestKind = 'boss' | 'town' | 'garage' | 'bike' | 'gasturn' | 'event' | 'fight';
export const TEST_KINDS: TestKind[] = ['boss', 'town', 'garage', 'bike', 'gasturn', 'event', 'fight'];
export type RadioPick = 'off' | 'road' | 'classical' | 'west';
const RADIO: RadioPick[] = ['off', 'road', 'classical', 'west'];

export interface TestPlan {
  kind: TestKind;
  /** boss: the boss to meet ('mothership' is the Cat Queen at the finish). */
  boss?: BossKind;
  /** fake: the town is made up at once; real: looked up like a real trip; none: no town. */
  town: 'fake' | 'real' | 'none';
  event?: string;
  enemy?: Exclude<EnemyType, BossKind>;
  horde?: boolean;
  ride?: Ride;
  difficulty?: Difficulty;
  kid?: boolean;
  hour?: number;
  weather?: Weather;
  cash?: number;
  gas?: number;
  tough: boolean;
  radio?: RadioPick;
}

const BOSS_NAMES: Record<string, BossKind> = {
  queen: 'mothership',
  catqueen: 'mothership',
  cat: 'mothership',
  mothership: 'mothership',
  hermit: 'hermit',
  pizza: 'pizza',
  sweeper: 'sweeper',
  karen: 'karen',
  drones: 'drones',
  drone: 'drones',
  brute: 'brute',
  earl: 'brute',
  warrig: 'warrig',
  rig: 'warrig',
  maxine: 'warrig',
};
const ENEMY_NAMES: Record<string, Exclude<EnemyType, BossKind>> = {
  zombie: 'zombie',
  zombies: 'zombie',
  outlaw: 'outlaw',
  outlaws: 'outlaw',
  cat: 'catship',
  cats: 'catship',
  catship: 'catship',
  drone: 'drone',
  drones: 'drone',
};
const RIDE_NAMES: Record<string, Ride> = { car: 'car', motorcycle: 'motorcycle', bike: 'motorcycle', moto: 'motorcycle', truck: 'truck', pickup: 'truck' };
const RADIO_NAMES: Record<string, RadioPick> = { off: 'off', road: 'road', home: 'road', classical: 'classical', evening: 'classical', west: 'west', desert: 'west' };

const yes = (v: string | null) => v != null && /^(1|yes|on|true)$/i.test(v);
const num = (v: string | null) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** Reads the test flags from the address bar's query string; null when no test was asked for. */
export function parseTestFlags(search: string): TestPlan | null {
  const q = new URLSearchParams(search);
  const lc = (k: string) => q.get(k)?.trim().toLowerCase() ?? null;
  let kind = lc('test') as TestKind | null;
  // ?boss=karen on its own is a boss test too.
  if (!kind && q.has('boss')) kind = 'boss';
  if (!kind || kind === ('0' as TestKind)) return null;
  if (!TEST_KINDS.includes(kind)) kind = 'boss';
  const townQ = lc('town');
  const town: TestPlan['town'] =
    townQ === 'real' ? 'real' : townQ != null && /^(0|no|none|off)$/.test(townQ) ? 'none' : townQ === 'fake' || kind !== 'fight' ? 'fake' : 'none';
  const plan: TestPlan = { kind, town, tough: yes(q.get('tough')) };
  if (kind === 'boss') plan.boss = BOSS_NAMES[lc('boss') ?? ''];
  if (kind === 'event') {
    const ev = lc('event');
    plan.event = ev && EVENT_IDS.includes(ev) ? ev : 'hitchhiker';
  }
  if (kind === 'fight') {
    plan.enemy = ENEMY_NAMES[lc('enemy') ?? ''] ?? 'zombie';
    if (q.has('horde')) plan.horde = yes(q.get('horde'));
  }
  const ride = RIDE_NAMES[lc('ride') ?? ''];
  if (ride && RIDE_IDS.includes(ride)) plan.ride = ride;
  const diff = lc('diff') as Difficulty | null;
  if (diff && DIFFICULTY_IDS.includes(diff)) plan.difficulty = diff;
  if (q.has('kid')) plan.kid = yes(q.get('kid'));
  const hour = num(q.get('time'));
  if (hour != null && hour >= 0 && hour < 24) plan.hour = hour;
  const w = lc('weather') as Weather | null;
  if (w && w in WEATHER_INFO) plan.weather = w;
  const cash = num(q.get('cash'));
  if (cash != null && cash >= 0) plan.cash = Math.round(cash);
  const gas = num(q.get('gas'));
  if (gas != null && gas >= 0) plan.gas = gas;
  const radio = RADIO_NAMES[lc('radio') ?? ''];
  if (radio && RADIO.includes(radio)) plan.radio = radio;
  return plan;
}

/** A short title for the test's start card: "Boss: karen", "Town walk". */
export function describeTest(p: TestPlan): string {
  switch (p.kind) {
    case 'boss':
      return p.boss === 'mothership' ? 'The Cat Queen at the finish' : p.boss ? BOSS_INFO[p.boss].title.replace(/^BOSS: /, 'Boss: ') : 'Boss: a random one';
    case 'town':
      return 'Walk the town';
    case 'garage':
      return 'Garage upgrade';
    case 'bike':
      return 'Out of gas: bike rescue';
    case 'gasturn':
      return 'Out of gas during a turn';
    case 'event':
      return `Road event: ${p.event}`;
    case 'fight':
      return `Fight: ${p.enemy}${p.horde ? ' horde' : ''}`;
  }
}

/** Road length of a test trip in game units (about 95 s at 65 mph). */
export const TEST_ROAD = 3600;
/** Where the test town's turn-off is (about 16 s in). */
export const TEST_TOWN_AT = 600;
/** Where a test road event or fight starts (a few seconds in). */
export const TEST_EVENT_AT = 150;
/** The real town the test road runs through, for &town=real: Seligman, AZ on Route 66. */
const TOWN_SPOT: LatLng = { lat: 35.3256, lng: -112.8766 };
const ROAD_KM = 18;
const TOWN_PLACES: PlaceKind[] = ['pumps', 'garage', 'grocery', 'hardware', 'police'];
/** Cash for the garage test when &cash= isn't given. */
export const GARAGE_CASH = 3000;
/** Road units the gasturn test leaves in the tank after Turn is tapped (about 1 s). */
export const GASTURN_LEFT = 40;

/** The short made-up road: east along old Route 66, through Seligman about 16 seconds in. */
export function testRawRoute(): RawRoute {
  const townKm = (TEST_TOWN_AT / TEST_ROAD) * ROAD_KM;
  const kmLng = 111 * Math.cos((TOWN_SPOT.lat * Math.PI) / 180);
  const coords: LatLng[] = [];
  const n = ROAD_KM * 4;
  for (let i = 0; i <= n; i++) {
    const km = i / 4;
    // A few gentle bends, so the road isn't a ruler line.
    coords.push({ lat: TOWN_SPOT.lat + (Math.sin(km / 2.2) * 0.25 - Math.sin(townKm / 2.2) * 0.25) / 111, lng: TOWN_SPOT.lng + (km - townKm) / kmLng });
  }
  const steps: RawStep[] = [{ location: coords[1], name: 'AZ 66', type: 'depart' }];
  return {
    source: 'demo',
    startLabel: 'Test Track, AZ',
    endLabel: 'Boss Junction, AZ',
    coords,
    realMeters: ROAD_KM * 1000,
    realSeconds: ROAD_KM * 45,
    steps,
    attribution: 'Test trip (made-up map)',
  };
}

export function testRoute(): RouteData {
  return buildRouteData(testRawRoute(), TEST_ROAD / CRUISE_SPEED);
}

/** Fuel the tank loses per road unit at the speed limit, for this trip's ride and difficulty. */
export function fuelPerRoadUnit(s: GameState): number {
  return fuelPerUnit(s.route.scale) * fuelEfficiency(s.upgrades) * rideOf(s).fuel * DIFFICULTIES[s.difficulty].fuel;
}

/** The test trip's starting state. Nothing random happens on the road unless the test asks for it. */
export function makeTestGame(p: TestPlan, seed = Date.now() & 0xffffffff, route = testRoute()): GameState {
  const difficulty = p.kid ? DIFFICULTY_IDS[0] : p.difficulty ?? 'normal';
  const s = newGame(route, seed, difficulty, p.ride ?? 'car');
  const length = pathFromRoute(route).length;
  const town: Stop = {
    id: 'stop-test',
    at: TEST_TOWN_AT,
    side: 'right',
    kind: 'town',
    name: p.town === 'real' ? 'Seligman' : 'Practice Town',
    places: TOWN_PLACES.slice(),
  };
  s.stops = p.town === 'none' ? [] : [town];
  // No random fights or road events (a test may ask for one below).
  s.nextEncounterAt = Infinity;
  s.nextEventAt = Infinity;
  s.halfBoss = p.boss && p.boss !== 'mothership' ? p.boss : HALF_BOSSES[Math.abs(seed) % HALF_BOSSES.length];
  if (p.kind === 'boss' && p.boss === 'mothership') {
    // Straight to the Cat Queen: start past halfway, about 25 s short of her (the town is behind you).
    s.bossStage = 1;
    s.stops = [];
    s.distance = Math.max(0, bossPoints(length, s.stops)[1] - 950);
  }
  if (p.kind === 'event') s.nextEventAt = TEST_EVENT_AT;
  if (p.kind === 'fight') s.nextEncounterAt = TEST_EVENT_AT;
  if (p.kind === 'garage') s.inv.cash = Math.max(s.inv.cash, GARAGE_CASH);
  // The bike test: dry about 300 units in, before the town (its pumps are where the bike goes).
  if (p.kind === 'bike') s.inv.fuel = 300 * fuelPerRoadUnit(s);
  if (p.cash != null) s.inv.cash = p.cash;
  if (p.gas != null) s.inv.fuel = p.gas;
  s.log = [`Test trip: ${describeTest(p)}.`];
  return s;
}
