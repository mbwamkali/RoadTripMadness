import { describe, expect, it } from 'vitest';
import { choiceIcon, kidChoices, oneLine } from '../src/game/kidMode';

describe('kid mode', () => {
  it('keeps text to one line', () => {
    expect(oneLine('Tractor beam! A purple light locks on.')).toBe('Tractor beam!');
    expect(oneLine('"Your loss," the trader shrugs. Then he leaves.')).toBe('"Your loss," the trader shrugs.');
    expect(oneLine('No full stop')).toBe('No full stop');
  });

  it('shows at most three choices, the ones you can pick first, and keeps the way out', () => {
    const c = (label: string, enabled = true) => ({ label, enabled });
    const got = kidChoices([c('Scrap for bullets', false), c('Buy shells'), c('Buy a gas can'), c('No thanks')]);
    expect(got.map((x) => x.label)).toEqual(['Buy shells', 'Buy a gas can', 'No thanks']);
    expect(kidChoices([c('A'), c('B')]).length).toBe(2);
  });

  it('gives each choice a picture', () => {
    expect(choiceIcon('Shoot at it')).toBe('🔫');
    expect(choiceIcon('Throw catnip')).toBe('🌿');
    expect(choiceIcon('Keep driving')).toBe('🚗');
    expect(choiceIcon('Give her some fuel')).toBe('⛽');
    expect(choiceIcon('Something new')).toBe('👉');
  });
});
