import { describe, expect, it } from 'vitest';
import { easeOff, boost, createCombat } from '../src/game/combat';
import { DoubleTap, isSwipe } from '../src/game/gestures';
import { isIos } from '../src/ui/install';

describe('gestures', () => {
  const p = { x: 100, y: 100, t: 0, id: 1 };
  it('a quick drag past the threshold is a swipe; short or slow ones are not', () => {
    expect(isSwipe(p, 150, 100, 120)).toBe(true);
    expect(isSwipe(p, 120, 100, 120)).toBe(false); // too short: still a tap or aim
    expect(isSwipe(p, 150, 100, 900)).toBe(false); // too slow: a held aim
  });

  it('two taps close together make a double tap', () => {
    const d = new DoubleTap();
    expect(d.tap(10, 10, 0)).toBe(false);
    expect(d.tap(20, 15, 200)).toBe(true);
    // A third tap starts over.
    expect(d.tap(20, 15, 300)).toBe(false);
    // Too far apart in time or space.
    expect(d.tap(20, 15, 1100)).toBe(false);
    expect(d.tap(200, 15, 1200)).toBe(false);
  });
});

describe('fight swipes', () => {
  it('swipe down eases off a boost', () => {
    const c = createCombat({ seed: 1, progress: 0.3 });
    expect(easeOff(c)).toBe(false);
    expect(boost(c, { fuel: 50 } as never)).toBe(true);
    expect(c.boostTime).toBeGreaterThan(0);
    expect(easeOff(c)).toBe(true);
    expect(c.boostTime).toBe(0);
  });
});

describe('install button', () => {
  it('knows iPhones and iPads, including iPads that say they are a Mac', () => {
    expect(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
    expect(isIos('Mozilla/5.0 (Linux; Android 15; Pixel 9)', 5)).toBe(false);
  });
});
