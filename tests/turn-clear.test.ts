import { describe, expect, it } from 'vitest';
import { inTurnClear, TURN_CLEAR, type Stop } from '../src/game/stops';
import { CROSS_ARM, LOT_DEPTH, LOT_NEAR, townCovers } from '../src/town/world';
import type { TownLayout } from '../src/town/layout';

const stop = (at: number, side: 'left' | 'right', kind: Stop['kind']): Stop => ({ id: `s${at}`, at, side, kind, name: 'Test', places: [] }) as Stop;

describe('turn-off clear zone', () => {
  const stops = [stop(1000, 'right', 'town'), stop(3000, 'left', 'shortcut')];
  it('clears the turn side around a town turn-off', () => {
    expect(inTurnClear(stops, 1000 - TURN_CLEAR.town.before + 1, 1)).toBe(true);
    expect(inTurnClear(stops, 1000 + TURN_CLEAR.town.after - 1, 1)).toBe(true);
    expect(inTurnClear(stops, 1000 - TURN_CLEAR.town.before - 1, 1)).toBe(false);
    expect(inTurnClear(stops, 1000 + TURN_CLEAR.town.after + 1, 1)).toBe(false);
  });
  it('leaves the far side of the road alone', () => {
    expect(inTurnClear(stops, 1000, -1)).toBe(false);
    expect(inTurnClear(stops, 3000, 1)).toBe(false);
  });
  it('uses the smaller zone for shortcuts', () => {
    expect(inTurnClear(stops, 3000 + TURN_CLEAR.shortcut.after - 1, -1)).toBe(true);
    expect(inTurnClear(stops, 3000 + TURN_CLEAR.shortcut.after + 1, -1)).toBe(false);
  });
});

describe('town ground', () => {
  // Main Street bends hard right after 100 m; one cross street at 60 m.
  const layout = {
    name: 'T',
    street: 'Main',
    line: [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 150, y: 100 }],
    length: 250,
    lots: [],
    crossings: [{ along: 60, name: 'Elm' }],
    houses: [],
    real: false,
  } as TownLayout;
  const covers = townCovers(layout, 10);
  const reach = LOT_NEAR + LOT_DEPTH + 10;
  it('covers the street, its lots and the bend', () => {
    expect(covers(0, 50)).toBe(true);
    expect(covers(reach - 1, 50)).toBe(true);
    expect(covers(120, 100 + reach - 1)).toBe(true);
    expect(covers(150 + 5, 100)).toBe(true);
  });
  it('covers the cross street arms', () => {
    expect(covers(-(CROSS_ARM + 5), 60)).toBe(true);
    expect(covers(-(CROSS_ARM + 15), 60)).toBe(false);
  });
  it('stops at the back of the lots, past the end, and at the highway edge', () => {
    expect(covers(-(reach + 1), 20)).toBe(false);
    expect(covers(150 + 40, 100)).toBe(false);
    expect(covers(0, -5)).toBe(false);
  });
});
