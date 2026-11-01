import { describe, expect, it } from 'vitest';
import { speakable, spokenList } from '../src/audio/narrator';

describe('narration text', () => {
  it('drops emoji and symbols the voice would read out', () => {
    expect(speakable('⛽ Speeding burns gas · Faster empties the tank')).toBe('Speeding burns gas, Faster empties the tank');
    expect(speakable('🧟‍♂️ Zombie horde!')).toBe('Zombie horde!');
    expect(speakable('Tap to read about it ↗')).toBe('Tap to read about it');
  });

  it('reads choices as a list', () => {
    expect(spokenList(['Help them', 'Drive on'])).toBe('Help them or Drive on');
    expect(spokenList(['A', '🔫 B', 'C'])).toBe('A, B or C');
    expect(spokenList(['Only'])).toBe('Only');
  });
});
