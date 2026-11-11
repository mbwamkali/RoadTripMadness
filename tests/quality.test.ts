import { describe, expect, it } from 'vitest';
import { autoQuality, nextQualityChoice, QUALITY, resolveQuality } from '../src/scenes/quality';
import { sunDirection } from '../src/scenes/atmosphere';
import { AutoTune, stepFor } from '../src/scenes/autoTune';

describe('auto graphics', () => {
  it('steps down when slow, two levels when far off', () => {
    expect(stepFor('high', 60)).toBeNull();
    expect(stepFor('high', 40)).toBe('medium');
    expect(stepFor('high', 20)).toBe('low');
    expect(stepFor('medium', 40)).toBe('low');
    expect(stepFor('low', 10)).toBeNull();
  });

  it('times 12 s after a 3 s warm-up, ignoring paused time and long gaps', () => {
    const t = new AutoTune();
    let got = null;
    for (let i = 0; i < 300; i++) expect(t.frame(25, false, 'high')).toBeNull(); // paused: not counted
    for (let i = 0; i < 10; i++) t.frame(3000, true, 'high'); // app switched away
    for (let ms = 0; ms < 16000 && !got; ms += 25) got = t.frame(25, true, 'high'); // 40 fps
    expect(got).toBe('medium');
    const fast = new AutoTune();
    for (let ms = 0; ms < 16000; ms += 16) expect(fast.frame(16, true, 'high')).toBeNull();
    expect(fast.settled).toBe(true);
  });
});

describe('graphics quality', () => {
  it('picks a level for the device', () => {
    expect(autoQuality({ cores: 2, memoryGB: 2, mobile: true })).toBe('low');
    // Phones start on (phone) High; Auto steps down after timing the first drive.
    expect(autoQuality({ cores: 8, memoryGB: 6, mobile: true })).toBe('high');
    expect(autoQuality({ cores: 12, memoryGB: 16, mobile: false })).toBe('high');
  });

  it('cycles Auto, Low, Medium, High', () => {
    expect(nextQualityChoice('auto')).toBe('low');
    expect(nextQualityChoice('high')).toBe('auto');
    expect(resolveQuality('medium')).toBe('medium');
  });

  it('only High has bloom, and Low has no shadows', () => {
    expect(QUALITY.high.bloom).toBe(true);
    expect(QUALITY.medium.bloom).toBe(false);
    expect(QUALITY.low.shadows).toBe(false);
  });
});

describe('sun', () => {
  it('rises in the east, is high at noon and sets in the west', () => {
    expect(sunDirection(7).x).toBeGreaterThan(0.5);
    expect(sunDirection(12).y).toBeGreaterThan(0.9);
    expect(sunDirection(17).x).toBeLessThan(-0.5);
    // The moon is up at night, never below the horizon.
    expect(sunDirection(0).y).toBeGreaterThan(0.5);
    expect(sunDirection(5.9).y).toBeGreaterThan(0);
  });
});
