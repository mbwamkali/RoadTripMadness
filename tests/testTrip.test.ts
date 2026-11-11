import { afterEach, describe, expect, it } from 'vitest';
import { pathFromRoute } from '../src/geo/route';
import { HALF_BOSSES } from '../src/game/combat';
import { advance, bossPoints, damage, newGame, saveGame, upcomingStop } from '../src/game/state';
import { testing } from '../src/game/testFlag';
import { addScore } from '../src/game/scores';
import { fuelPerRoadUnit, makeTestGame, parseTestFlags, TEST_EVENT_AT, TEST_ROAD, TEST_TOWN_AT, testRoute } from '../src/game/testTrip';

const route = testRoute();
const path = pathFromRoute(route);

/** Drives the trip in small steps until something happens. */
function driveUntil(s: ReturnType<typeof makeTestGame>, stop: (r: ReturnType<typeof advance>) => boolean, max = 20000) {
  for (let i = 0; i < max; i++) {
    const r = advance(s, path, 5);
    if (stop(r)) return r;
  }
  throw new Error('nothing happened');
}

describe('test trip flags', () => {
  it('ignores a normal address', () => {
    expect(parseTestFlags('')).toBeNull();
    expect(parseTestFlags('?dev=1&perf=1')).toBeNull();
    expect(parseTestFlags('?test=0')).toBeNull();
  });
  it('reads a boss test, with names a person would type', () => {
    expect(parseTestFlags('?test=boss&boss=karen')).toMatchObject({ kind: 'boss', boss: 'karen', town: 'fake', tough: false });
    expect(parseTestFlags('?boss=Queen')).toMatchObject({ kind: 'boss', boss: 'mothership' });
    expect(parseTestFlags('?test=boss&boss=earl')?.boss).toBe('brute');
    expect(parseTestFlags('?test=boss&boss=nobody')?.boss).toBeUndefined();
  });
  it('reads the add-ons and drops bad values', () => {
    const p = parseTestFlags('?test=garage&ride=bike&diff=hard&kid=1&time=22&weather=rain&cash=500&gas=10&tough=1&radio=desert&town=real')!;
    expect(p).toMatchObject({ kind: 'garage', ride: 'motorcycle', difficulty: 'hard', kid: true, hour: 22, weather: 'rain', cash: 500, gas: 10, tough: true, radio: 'west', town: 'real' });
    const bad = parseTestFlags('?test=town&ride=tank&diff=insane&time=25&weather=lava&cash=-5&radio=jazz&town=0')!;
    expect(bad).toEqual({ kind: 'town', town: 'none', tough: false });
  });
  it('fights default to zombies with no town; events default to the hitchhiker', () => {
    expect(parseTestFlags('?test=fight')).toMatchObject({ enemy: 'zombie', town: 'none' });
    expect(parseTestFlags('?test=fight&enemy=cats&horde=0')).toMatchObject({ enemy: 'catship', horde: false });
    expect(parseTestFlags('?test=event')?.event).toBe('hitchhiker');
    expect(parseTestFlags('?test=event&event=wreck')?.event).toBe('wreck');
  });
});

describe('test trip road', () => {
  it('is short: about 95 seconds at 65 mph', () => {
    expect(path.length).toBeGreaterThan(TEST_ROAD * 0.9);
    expect(path.length).toBeLessThan(TEST_ROAD * 1.1);
  });
  it('has one town early and the chosen boss about a minute in', () => {
    const s = makeTestGame(parseTestFlags('?test=boss&boss=pizza')!, 42, route);
    expect(s.stops).toHaveLength(1);
    expect(s.stops[0].at).toBe(TEST_TOWN_AT);
    expect(s.stops[0].places).toContain('garage');
    const [half] = bossPoints(path.length, s.stops);
    expect(half / 38).toBeLessThan(60);
    s.passed.push(s.stops[0].id);
    const r = driveUntil(s, (r) => !!r.boss || r.encounter || !!r.event || r.outOfFuel);
    expect(r.boss).toBe('pizza');
  });
  it('a boss test picks any halfway boss when none is named', () => {
    const s = makeTestGame(parseTestFlags('?test=boss')!, -12345, route);
    expect(HALF_BOSSES).toContain(s.halfBoss);
  });
  it('the Cat Queen test starts close to her, with no town', () => {
    const s = makeTestGame(parseTestFlags('?test=boss&boss=queen')!, 7, route);
    expect(s.stops).toHaveLength(0);
    const end = bossPoints(path.length, s.stops)[1];
    expect((end - s.distance) / 38).toBeLessThan(30);
    expect(driveUntil(s, (r) => !!r.boss || r.encounter || !!r.event).boss).toBe('mothership');
  });
  it('the bike test runs dry before the town', () => {
    const s = makeTestGame(parseTestFlags('?test=bike')!, 3, route);
    driveUntil(s, (r) => r.outOfFuel);
    expect(s.distance).toBeLessThan(TEST_TOWN_AT - 200);
    expect(fuelPerRoadUnit(s)).toBeGreaterThan(0);
  });
  it('event and fight tests start a few seconds in', () => {
    const e = makeTestGame(parseTestFlags('?test=event')!, 3, route);
    expect(driveUntil(e, (r) => !!r.event || r.encounter).event).toBe(true);
    expect(e.distance).toBeLessThan(TEST_EVENT_AT + 10);
    const f = makeTestGame(parseTestFlags('?test=fight')!, 3, route);
    expect(upcomingStop(f, 2000)).toBeUndefined();
    expect(driveUntil(f, (r) => !!r.event || r.encounter).encounter).toBe(true);
    expect(f.distance).toBeLessThan(TEST_EVENT_AT + 10);
  });
  it('nothing random happens on a plain boss test before the boss', () => {
    const s = makeTestGame(parseTestFlags('?test=boss&boss=hermit&town=0')!, 11, route);
    const r = driveUntil(s, (r) => !!r.boss || r.encounter || !!r.event);
    expect(r.boss).toBe('hermit');
  });
  it('cash and gas flags win over the defaults', () => {
    const s = makeTestGame(parseTestFlags('?test=garage&cash=77&gas=5')!, 3, route);
    expect(s.inv.cash).toBe(77);
    expect(s.inv.fuel).toBe(5);
    expect(makeTestGame(parseTestFlags('?test=garage')!, 3, route).inv.cash).toBeGreaterThanOrEqual(3000);
  });
});

describe('test trips leave the real game alone', () => {
  afterEach(() => {
    testing.on = false;
    testing.tough = false;
  });
  it('no saves, no scores, no damage with tough', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    };
    testing.on = true;
    testing.tough = true;
    const s = newGame(route, 1);
    saveGame(s);
    expect(store.size).toBe(0);
    const r = addScore({ score: 5, route: 'x', difficulty: 'normal', won: true, date: '' }, []);
    expect(r.rank).toBe(-1);
    expect(store.size).toBe(0);
    const hp = s.health;
    damage(s, 50);
    expect(s.health).toBe(hp);
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
});
