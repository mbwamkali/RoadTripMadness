import { describe, expect, it } from 'vitest';
import { BOSSES, ENEMY_STATS } from '../src/game/combat';
import { SECTIONS, sectionSpeech } from '../src/ui/howToPlay';

describe('how to play', () => {
  it('covers every boss in the game', () => {
    const bosses = SECTIONS.find((s) => s.id === 'bosses')!;
    for (const b of BOSSES) expect(bosses.tips.map((t) => t.title)).toContain(ENEMY_STATS[b].name);
  });
  it('explains exits, the horn and the boost', () => {
    const all = SECTIONS.flatMap((s) => s.tips.map((t) => t.title));
    for (const k of ['Take the exit', 'Horn', 'Boost', 'Kid mode']) expect(all).toContain(k);
  });
  it('keeps every tip short enough for a young reader', () => {
    for (const s of SECTIONS) for (const t of s.tips) expect(t.text.length).toBeLessThan(120);
    expect(sectionSpeech(SECTIONS[0])).toMatch(/^The goal\./);
  });
});
