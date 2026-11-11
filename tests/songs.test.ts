import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { CAT_PITCH, DRUM_HITS, SONGS, STATIONS, notesUsed, type Band } from '../src/audio/songs';

describe('radio songs', () => {
  it('has the three stations plus the Cat Queen fight song', () => {
    expect(STATIONS.map((s) => s.name)).toEqual(['Home Stretch', 'Evening Drive', 'Desert Highway']);
    expect(SONGS.catqueen.name).toBe('Cat Queen Creep');
  });

  it('writes every melody bar out to exactly four beats', () => {
    for (const s of Object.values(SONGS))
      for (const b of s.bars) expect(b.mel.reduce((sum, [, len]) => sum + len, 0), `${s.name} ${b.sec} bar ${b.n}`).toBeCloseTo(4, 6);
  });

  it('has a recorded file for every note, drum hit and cat sound it plays', () => {
    for (const s of Object.values(SONGS)) {
      for (const k of notesUsed(s)) {
        const [inst, midi] = k.split(':');
        expect(fs.existsSync(`public/audio/inst/${inst}/${midi}.mp3`), `${s.name} ${k}`).toBe(true);
      }
      const drums = new Set<string>();
      const cats = new Set<string>();
      const band: Band = { note: () => {}, drum: (d) => void drums.add(d), cat: (c) => void cats.add(c), thump: () => {}, brush: () => {}, shaker: () => {} };
      for (const bar of s.bars) s.arrange(bar, 0, 0.5, false, band);
      for (const d of drums) expect(DRUM_HITS, `${s.name} drum ${d}`).toContain(d);
      for (const c of cats) expect(c in CAT_PITCH, `${s.name} cat ${c}`).toBe(true);
    }
    for (const d of DRUM_HITS) expect(fs.existsSync(`public/audio/drums/${d}.mp3`), d).toBe(true);
    for (const c of Object.keys(CAT_PITCH)) expect(fs.existsSync(`public/audio/cats/${c}.mp3`), c).toBe(true);
  });

  it('plays the same notes every time (no made-up music)', () => {
    const run = () => {
      const out: string[] = [];
      const band: Band = { note: (i, m, at) => void out.push(`${i}${m}@${at.toFixed(4)}`), drum: (d, at) => void out.push(`${d}@${at.toFixed(4)}`), cat: (c, at) => void out.push(`${c}@${at.toFixed(4)}`), thump: () => {}, brush: () => {}, shaker: () => {} };
      SONGS.road.bars.forEach((b, i) => SONGS.road.arrange(b, i * 2, 0.5, false, band));
      return out.join(',');
    };
    expect(run()).toBe(run());
  });
});
