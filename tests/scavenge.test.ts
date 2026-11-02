import { describe, expect, it } from 'vitest';
import { buildRouteData } from '../src/geo/route';
import { demoRawRoute } from '../src/geo/demoRoute';
import { newGame, openCrate, scavengeNoise, scavengeSummary, search, startScavenge, type GameState } from '../src/game/state';
import type { PlaceKind } from '../src/game/stops';

const route = buildRouteData(demoRawRoute());
const PLACES: PlaceKind[] = ['pumps', 'garage', 'grocery', 'hardware', 'gunshop', 'pharmacy', 'police', 'junkyard', 'barn', 'motel'];

/** A game with an empty tank and pockets, so every find shows in full. */
function fresh(seed: number): GameState {
  const s = newGame(route, seed);
  s.inv = { fuel: 0, cash: 0, scrap: 0, bullets: 0, shells: 0, catnip: 0 };
  return s;
}

describe('crate search', () => {
  it('finds exactly what one search would, split over the crates', () => {
    for (let seed = 0; seed < 60; seed++) {
      for (const place of PLACES) {
        const a = fresh(seed);
        const b = fresh(seed);
        const r = search(a, 'stop-1', place);
        const sc = startScavenge(b, 'stop-1', place, 4);
        let ambush = false;
        for (let i = 0; i < 4 && !ambush; i++) ambush = openCrate(b, sc, i).ambush;
        expect(ambush).toBe(!!r.ambush);
        if (!ambush) expect(b.inv).toEqual(a.inv);
        expect(b.hoursSpent).toBe(a.hoursSpent);
        expect(b.searches).toEqual(a.searches);
      }
    }
  });

  it('opening fewer crates risks less', () => {
    let all = 0;
    let one = 0;
    for (let seed = 0; seed < 400; seed++) {
      const a = fresh(seed);
      const sc = startScavenge(a, 'stop-1', 'grocery', 4);
      if (openCrate(a, sc, 0).ambush) one++;
      const b = fresh(seed);
      const sc2 = startScavenge(b, 'stop-1', 'grocery', 4);
      for (let i = 0; i < 4; i++) if (openCrate(b, sc2, i).ambush) all++;
    }
    expect(one).toBeLessThan(all);
    expect(all).toBeGreaterThan(400 * 0.08);
  });

  it('fills the noise meter as crates open, and repeat searches start noisier', () => {
    const s = fresh(3);
    const sc = startScavenge(s, 'stop-1', 'motel', 3);
    expect(scavengeNoise(sc)).toBe(0);
    openCrate(s, sc, 0);
    const after = scavengeNoise(sc);
    expect(after).toBeGreaterThan(0);
    const again = startScavenge(s, 'stop-1', 'motel', 3);
    expect(again.startNoise).toBeGreaterThan(0);
  });

  it('ignores a crate opened twice and sums what was found', () => {
    for (let seed = 0; seed < 50; seed++) {
      const s = fresh(seed);
      const sc = startScavenge(s, 'stop-2', 'gunshop', 4);
      if (sc.ambushOn) continue;
      openCrate(s, sc, 1);
      const before = { ...s.inv };
      expect(openCrate(s, sc, 1).loot).toEqual({});
      expect(s.inv).toEqual(before);
      expect(scavengeSummary(sc, false).message).toMatch(/^Found|Picked clean/);
      return;
    }
  });
});
