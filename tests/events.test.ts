import { describe, expect, it } from 'vitest';
import { buildRouteData, pathFromRoute } from '../src/geo/route';
import { demoRawRoute } from '../src/geo/demoRoute';
import { advance, newGame, search } from '../src/game/state';
import { EVENT_IDS, makeEvent, rollEvent } from '../src/game/events';
import { createCombat, stepCombat } from '../src/game/combat';

const route = buildRouteData(demoRawRoute());
const path = pathFromRoute(route);

describe('road events', () => {
  it('come up every so often while driving', () => {
    const s = newGame(route, 11);
    s.inv.fuel = 1e9;
    s.nextEncounterAt = Infinity;
    let events = 0;
    while (s.status === 'driving') if (advance(s, path, 40).event) events++;
    expect(events).toBeGreaterThanOrEqual(5);
    expect(events).toBeLessThanOrEqual(14);
  });

  it('every event has a choice you can always pick, and choices apply cleanly', () => {
    for (const id of EVENT_IDS) {
      const s = newGame(route, 3);
      s.inv = { fuel: 0, cash: 0, scrap: 0, bullets: 0, shells: 0, catnip: 0 };
      const ev = makeEvent(id, s);
      expect(ev.choices.some((c) => c.enabled)).toBe(true);
      const rich = newGame(route, 3);
      for (const ch of makeEvent(id, rich).choices) {
        const out = ch.apply();
        expect(out.message.length).toBeGreaterThan(0);
        expect(Object.values(rich.inv).every((v) => v >= 0)).toBe(true);
      }
    }
  });

  it('crew members join and help', () => {
    const s = newGame(route, 3);
    makeEvent('dog', s).choices[0].apply();
    makeEvent('mechanic', s).choices[0].apply();
    expect(s.crew).toEqual(['dog', 'mechanic']);
    // A dog makes searching safer.
    let withDog = 0;
    let without = 0;
    for (let seed = 0; seed < 300; seed++) {
      const a = newGame(route, seed);
      const b = newGame(route, seed);
      b.crew.push('dog');
      if (search(a, 'x', 'barn').ambush) without++;
      if (search(b, 'x', 'barn').ambush) withDog++;
    }
    expect(withDog).toBeLessThan(without);
  });

  it('a gunner takes enemies down without spending your ammo', () => {
    const c = createCombat({ seed: 5, progress: 0.2, gunner: true });
    for (let i = 0; i < 900; i++) stepCombat(c, 0.05);
    expect(c.kills).toBeGreaterThan(0);
  });

  it('picks a range of events', () => {
    const seen = new Set<string>();
    for (let n = 0; n < 60; n++) {
      const s = newGame(route, 7);
      s.eventsSeen = n;
      seen.add(rollEvent(s).id);
    }
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });
});
