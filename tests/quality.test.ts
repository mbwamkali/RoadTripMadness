import { describe, expect, it } from 'vitest';
import { autoQuality, nextQualityChoice, QUALITY, resolveQuality } from '../src/scenes/quality';
import { sunDirection } from '../src/scenes/atmosphere';

describe('graphics quality', () => {
  it('picks a level for the device', () => {
    expect(autoQuality({ cores: 2, memoryGB: 2, mobile: true })).toBe('low');
    expect(autoQuality({ cores: 8, memoryGB: 6, mobile: true })).toBe('medium');
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
