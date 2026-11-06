/**
 * The car radio's songs. Every song is written out note by note, so it plays
 * exactly the same way every time (nothing is made up while you drive), and
 * Jared approved each one before it went in (decisions.md, 2026-11-05 Music).
 *
 * Melody notes are [MIDI note or null for a rest, beats]; every bar adds up to 4 beats.
 * Chords are per bar; two chords split the bar in half.
 * The arrangements only call the Band below, so they can be tested without audio.
 */

export type StationId = 'road' | 'classical' | 'west';
export type SongId = StationId | 'catqueen';

type Note = [number | null, number];
type Bar = Note[];

interface Section {
  name: string;
  ch: (string | string[])[];
  /** A theme name from the song's themes, or the bars themselves. */
  mel: string | Bar[];
  lead?: string;
  kit?: 'light' | 'mid' | 'full' | 'toms';
  crash?: boolean;
  organ?: boolean;
  strings?: boolean;
  cello?: boolean;
  pad?: boolean;
  last?: boolean;
}

export interface SongBar {
  sec: string;
  secIndex: number;
  /** Bar number inside its section, from 0. */
  n: number;
  ch: string[];
  mel: Bar;
  lead?: string;
  kit?: Section['kit'];
  crash: boolean;
  organ: boolean;
  strings: boolean;
  cello: boolean;
  pad: boolean;
  last: boolean;
}

/** What an arrangement can play. The radio turns these into sound; tests just count them. */
export interface Band {
  /** A recorded instrument note; hold = seconds before it starts to fade. */
  note(inst: string, midi: number, at: number, hold: number, vol: number, verb?: number): void;
  /** A recorded drum hit; alt picks the second take so repeats don't sound copied. */
  drum(name: string, at: number, vol: number, alt?: boolean): void;
  /** A real cat recording, retuned to a song note (or as recorded when midi is null). */
  cat(name: string, at: number, midi: number | null, vol: number, maxDur?: number): void;
  /** Soft made-up percussion for the quieter songs. */
  thump(at: number, vol: number): void;
  brush(at: number, vol: number): void;
  shaker(at: number, vol: number): void;
}

export interface Song {
  id: SongId;
  name: string;
  bpm: number;
  /** Level trim so every station plays at about the same loudness (about -20 LUFS). */
  trim: number;
  /** Plays faster with a heavier band during road fights. */
  fightable?: boolean;
  /** Instruments, drum hits and cat sounds this song needs loaded. */
  inst: string[];
  drums?: boolean;
  cats?: boolean;
  sections: Section[];
  themes: Record<string, Bar[]>;
  bars: SongBar[];
  arrange(bar: SongBar, t: number, beat: number, fight: boolean, band: Band): void;
}

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function chordInfo(name: string): { root: number; tones: number[]; minor: boolean } {
  const minor = name.length > 1 && name.endsWith('m');
  const root = 48 + PC[name[0]] + (name[1] === '#' ? 1 : 0);
  return { root, tones: [0, minor ? 3 : 4, 7].map((x) => root + x), minor };
}

const chordAt = (bar: SongBar, beatPos: number): string => bar.ch[Math.min(bar.ch.length - 1, Math.floor(beatPos / (4 / bar.ch.length)))];

function eachNote(bar: SongBar, t: number, beat: number, fn: (m: number, at: number, d: number) => void): void {
  let pos = 0;
  for (const [m, b] of bar.mel) {
    if (m != null) fn(m, t + pos * beat, b * beat);
    pos += b;
  }
}

function flatten(song: Omit<Song, 'bars'>): SongBar[] {
  const bars: SongBar[] = [];
  song.sections.forEach((s, si) => {
    const mel = typeof s.mel === 'string' ? song.themes[s.mel] : s.mel;
    s.ch.forEach((c, i) =>
      bars.push({
        sec: s.name,
        secIndex: si,
        n: i,
        ch: Array.isArray(c) ? c : [c],
        mel: mel[i] ?? [[null, 4]],
        lead: s.lead,
        kit: s.kit,
        crash: !!s.crash && i === 0,
        organ: !!s.organ,
        strings: !!s.strings,
        cello: !!s.cello,
        pad: !!s.pad,
        last: !!s.last && i === s.ch.length - 1,
      }),
    );
  });
  return bars;
}

const song = (s: Omit<Song, 'bars'>): Song => ({ ...s, bars: flatten(s) });

// ------------------------------------------------------------------ Home Stretch
// A warm sing-along road song: strummed acoustic guitar over a pop-rock band.

const GUITAR_SHAPES: Record<string, number[]> = { A: [45, 52, 57, 61, 64], E: [40, 47, 52, 56, 59, 64], 'F#m': [42, 49, 54, 57, 61, 66], D: [50, 57, 62, 66] };
// Strum on eighths: down, -, down, up, -, up, down, up.
const STRUM = ['D', null, 'D', 'U', null, 'U', 'D', 'U'];

export const HOME_STRETCH = song({
  id: 'road',
  name: 'Home Stretch',
  bpm: 88,
  trim: 3.8,
  fightable: true,
  drums: true,
  inst: ['acoustic_guitar_steel', 'electric_guitar_clean', 'electric_bass_finger', 'drawbar_organ', 'harmonica', 'fiddle', 'overdriven_guitar', 'acoustic_grand_piano'],
  sections: [
    { name: 'Intro', lead: 'electric_guitar_clean', kit: 'light', ch: ['A', 'E', 'F#m', 'D'], mel: 'I' },
    { name: 'Verse', lead: 'electric_guitar_clean', kit: 'light', ch: ['A', 'F#m', 'E', 'D', 'A', 'F#m', 'E', 'E'], mel: 'V' },
    { name: 'Chorus', lead: 'chorus', kit: 'full', crash: true, organ: true, ch: ['A', 'E', 'F#m', 'D', 'A', 'E', 'D', 'A'], mel: 'C' },
    { name: 'Verse', lead: 'harmonica', kit: 'mid', ch: ['A', 'F#m', 'E', 'D', 'A', 'F#m', 'E', 'E'], mel: 'V' },
    { name: 'Chorus', lead: 'chorus', kit: 'full', crash: true, organ: true, ch: ['A', 'E', 'F#m', 'D', 'A', 'E', 'D', 'A'], mel: 'C' },
    {
      name: 'Bridge', lead: 'acoustic_grand_piano', kit: 'toms', organ: true, ch: ['F#m', 'D', 'A', 'E', 'F#m', 'D', 'E', 'E'],
      mel: [
        [[73, 2], [69, 2]], [[74, 2], [78, 2]], [[76, 1], [73, 1], [69, 2]], [[71, 3], [null, 1]],
        [[73, 1], [76, 1], [78, 2]], [[81, 2], [78, 1], [74, 1]], [[76, 2], [80, 2]], [[76, 2], [null, 2]],
      ],
    },
    { name: 'Chorus', lead: 'chorus', kit: 'full', crash: true, organ: true, ch: ['A', 'E', 'F#m', 'D', 'A', 'E', 'D', 'A'], mel: 'C' },
    {
      name: 'Outro', lead: 'electric_guitar_clean', kit: 'light', last: true, ch: ['A', 'E', 'D', 'A'],
      mel: [[[null, 2], [76, 0.5], [73, 0.5], [69, 1]], [[68, 1], [71, 1], [76, 2]], [[76, 1], [74, 1], [73, 2]], [[69, 4]]],
    },
  ],
  themes: {
    I: [
      [[null, 2], [76, 0.5], [73, 0.5], [69, 1]], [[68, 1], [71, 1], [76, 2]],
      [[null, 2], [73, 0.5], [76, 0.5], [78, 1]], [[76, 1], [74, 1], [73, 2]],
    ],
    V: [
      [[null, 0.5], [69, 0.5], [69, 0.5], [71, 0.5], [73, 1], [73, 1]], [[71, 0.5], [69, 0.5], [66, 1], [69, 1.5], [null, 0.5]],
      [[null, 0.5], [68, 0.5], [68, 0.5], [69, 0.5], [71, 1], [68, 1]], [[66, 1], [64, 1], [66, 2]],
      [[null, 0.5], [69, 0.5], [69, 0.5], [71, 0.5], [73, 1], [76, 1]], [[76, 0.5], [73, 0.5], [71, 1], [73, 1.5], [null, 0.5]],
      [[71, 1], [69, 0.5], [68, 0.5], [69, 1], [71, 1]], [[68, 3], [null, 1]],
    ],
    C: [
      [[76, 1.5], [76, 0.5], [73, 1], [76, 1]], [[78, 1], [76, 1], [71, 2]],
      [[73, 1.5], [73, 0.5], [76, 1], [78, 1]], [[81, 2], [78, 1], [76, 1]],
      [[76, 1.5], [76, 0.5], [73, 1], [76, 1]], [[78, 1], [76, 1], [71, 1], [73, 1]],
      [[74, 1], [73, 1], [71, 1], [69, 1]], [[69, 3], [null, 1]],
    ],
  },
  arrange(bar, t, beat, fight, b) {
    const e8 = beat / 2;
    for (let e = 0; e < 8; e++) {
      const name = chordAt(bar, e / 2);
      const c = chordInfo(name);
      const at = t + e * e8;
      const shape = GUITAR_SHAPES[name] ?? [c.root - 12, c.tones[2] - 12, c.root, c.tones[1], c.tones[2]];
      const kind = bar.last ? 'D' : STRUM[e];
      if (kind === 'D') shape.forEach((m, k) => b.note('acoustic_guitar_steel', m, at + k * 0.009, e8 * (bar.last ? 6 : 1.8), e % 4 === 0 ? 0.27 : 0.22, 0.15));
      if (kind === 'U') shape.slice(-3).reverse().forEach((m, k) => b.note('acoustic_guitar_steel', m, at + k * 0.008, e8 * 1.2, 0.15, 0.15));
      // Bass: steady eighths in the chorus and in fights, roots and fifths elsewhere.
      const low = c.root - 12 > 40 ? c.root - 24 : c.root - 12;
      if (fight || bar.kit === 'full') b.note('electric_bass_finger', low, at, e8 * 0.8, e % 2 ? 0.2 : 0.26, 0);
      else if (e % 2 === 0) b.note('electric_bass_finger', low + (e === 4 ? 7 : 0) - (e === 4 && low + 7 > 45 ? 12 : 0), at, e8 * 1.6, 0.26, 0);
      if (fight && e % 2 === 1) [c.root - 12, c.root - 5].forEach((m) => b.note('overdriven_guitar', m, at, e8 * 0.7, 0.13, 0.1));
      if (bar.last) break;
      const kit = fight ? 'full' : bar.kit;
      if (kit === 'light') {
        if (e === 0 || e === 4) b.drum('kick', at, 0.25);
        b.drum('shaker', at, e % 2 ? 0.12 : 0.18, e % 2 === 1);
      } else if (kit === 'mid') {
        if (e === 0 || e === 5) b.drum('kick', at, 0.32, e === 5);
        if (e === 2 || e === 6) b.drum('snare', at, 0.32, e === 6);
        b.drum('hat', at, e % 2 ? 0.14 : 0.2, e % 2 === 1);
      } else if (kit === 'full') {
        if (e === 0 || e === 3 || e === 4) b.drum('kick', at, 0.4, e === 3);
        if (e === 2 || e === 6) b.drum('snare', at, 0.5, e === 6);
        if (e === 7 && bar.n % 2 === 1) b.drum('ohat', at, 0.22);
        else b.drum('hat', at, e % 2 ? 0.2 : 0.3, e % 2 === 1);
      } else if (kit === 'toms') {
        if (e === 0) b.drum('kick', at, 0.3);
        if (e === 4) b.drum('snare', at, 0.3);
        if (bar.n === 7 && e >= 4) b.drum('tom', at, 0.3 + e * 0.04);
        else b.drum('shaker', at, 0.14, e % 2 === 1);
      }
    }
    if (bar.crash) b.drum('crash', t, 0.4);
    if (bar.organ && !bar.last) chordInfo(bar.ch[0]).tones.forEach((m) => b.note('drawbar_organ', m + 12, t, beat * 3.6, 0.07, 0.3));
    if (bar.last) {
      b.drum('crash', t, 0.35);
      b.drum('kick', t, 0.6);
    }
    eachNote(bar, t, beat, (m, at, d) => {
      const hold = Math.max(0.1, d * 0.88);
      if (bar.lead === 'chorus') {
        b.note('overdriven_guitar', m, at, hold, 0.26, 0.35);
        b.note('fiddle', m, at, hold, 0.32, 0.4);
      } else if (bar.lead === 'acoustic_grand_piano') b.note('acoustic_grand_piano', m, at, Math.max(hold, beat), 0.45, 0.4);
      else b.note(bar.lead!, m, at, hold, bar.lead === 'harmonica' ? 0.45 : 0.55, 0.35);
    });
  },
});

// ------------------------------------------------------------------ Evening Drive
// A slow, gentle piano piece with strings, in the feel of Jared's Lucy tribute soundtrack.

const EVENING_A: Bar[] = [
  [[78, 2], [76, 1], [74, 1]], [[73, 2], [76, 2]], [[74, 1.5], [73, 0.5], [71, 2]], [[67, 1], [71, 1], [74, 2]],
  [[78, 1.5], [79, 0.5], [81, 2]], [[79, 1], [78, 1], [76, 2]], [[74, 1], [76, 1], [79, 1], [78, 0.5], [76, 0.5]], [[76, 3], [null, 1]],
];

export const EVENING_DRIVE = song({
  id: 'classical',
  name: 'Evening Drive',
  bpm: 70,
  trim: 9.8,
  inst: ['acoustic_grand_piano', 'string_ensemble_1', 'cello'],
  sections: [
    { name: 'Intro', ch: ['D', 'A'], mel: [[[null, 4]], [[null, 4]]] },
    { name: 'Theme', ch: ['D', 'A', 'Bm', 'G', 'D', 'G', 'Em', 'A'], mel: 'A' },
    {
      name: 'Strings', strings: true, ch: ['Bm', 'G', 'D', 'A', 'Bm', 'G', 'Em', 'A'],
      mel: [
        [[74, 1], [73, 1], [71, 2]], [[74, 1], [79, 1], [78, 2]], [[78, 1], [76, 1], [74, 1], [69, 1]], [[73, 3], [null, 1]],
        [[71, 1], [73, 1], [74, 2]], [[79, 2], [78, 1], [76, 1]], [[76, 1.5], [74, 0.5], [71, 1], [73, 1]], [[76, 2], [73, 2]],
      ],
    },
    { name: 'Theme', strings: true, cello: true, ch: ['D', 'A', 'Bm', 'G', 'D', 'G', 'A', 'D'], mel: 'A2' },
    { name: 'Home', last: true, ch: ['D'], mel: [[[null, 4]]] },
  ],
  themes: { A: EVENING_A, A2: [...EVENING_A.slice(0, 6), [[76, 1], [74, 1], [73, 2]], [[74, 4]]] },
  arrange(bar, t, beat, _fight, b) {
    const c = chordInfo(bar.ch[0]);
    const low = c.root - 12;
    if (bar.last) {
      b.note('acoustic_grand_piano', low - 12, t, 3, 0.5, 0.4);
      [low, c.tones[1], c.tones[2], c.root + 12, c.tones[1] + 12].forEach((m, i) => b.note('acoustic_grand_piano', m, t + i * 0.09, 3.5, 0.32, 0.45));
      b.note('string_ensemble_1', c.root + 12, t, 3, 0.15, 0.5);
      return;
    }
    // Left hand: a low root, then a flowing arpeggio held with the pedal.
    const fifthBelow = c.tones[2] - 12 + (c.tones[2] - 12 < low ? 12 : 0);
    [low, fifthBelow, c.root, c.tones[1], c.tones[2], c.tones[1], c.root, c.tones[2] - 12].forEach((m, i) =>
      b.note('acoustic_grand_piano', m, t + (i * beat) / 2, beat * 3, i === 0 ? 0.42 : 0.24, 0.45),
    );
    eachNote(bar, t, beat, (m, at, d) => b.note('acoustic_grand_piano', m, at, Math.max(d, beat), 0.55, 0.45));
    if (bar.strings) {
      c.tones.forEach((m) => b.note('string_ensemble_1', m + 12, t, beat * 3.7, 0.11, 0.5));
      b.note('string_ensemble_1', c.root, t, beat * 3.7, 0.1, 0.5);
    }
    if (bar.cello) b.note('cello', c.root - 12, t, beat * 3.7, 0.22, 0.4);
  },
});

// ------------------------------------------------------------------ Desert Highway
// A slow cowboy tune: a whistled theme, then a lonely trumpet.

export const DESERT_HIGHWAY = song({
  id: 'west',
  name: 'Desert Highway',
  bpm: 92,
  trim: 6.3,
  inst: ['acoustic_guitar_nylon', 'whistle', 'trumpet', 'string_ensemble_1', 'acoustic_bass'],
  sections: [
    { name: 'Intro', lead: 'whistle', ch: ['Em', 'Em', 'D', 'D'], mel: [[[null, 4]], [[null, 4]], [[null, 4]], [[null, 4]]] },
    { name: 'Theme', lead: 'whistle', ch: ['Em', 'Em', 'D', 'D', 'C', 'C', 'B', 'B'], mel: 'A' },
    {
      name: 'Lift', lead: 'trumpet', pad: true, ch: ['Am', 'Am', 'Em', 'Em', 'C', 'D', 'B', 'B'],
      mel: [
        [[72, 2], [76, 2]], [[81, 2], [79, 1], [76, 1]], [[79, 2], [76, 1], [71, 1]], [[76, 3], [null, 1]],
        [[72, 1], [76, 1], [79, 2]], [[78, 1], [76, 1], [74, 2]], [[75, 2], [78, 1], [75, 1]], [[71, 3], [null, 1]],
      ],
    },
    { name: 'Theme', lead: 'whistle', pad: true, ch: ['Em', 'Em', 'D', 'D', 'C', 'C', 'B', 'B'], mel: 'A' },
    { name: 'End', lead: 'trumpet', ch: ['Em', 'Em'], mel: [[[64, 4]], [[null, 4]]] },
  ],
  themes: {
    A: [
      [[64, 0.5], [67, 0.5], [71, 3]], [[76, 2], [74, 1], [71, 1]], [[74, 1.5], [72, 0.5], [69, 2]], [[66, 3], [null, 1]],
      [[67, 0.5], [69, 0.5], [72, 3]], [[76, 2], [74, 1], [72, 1]], [[71, 2], [75, 2]], [[71, 3], [null, 1]],
    ],
  },
  arrange(bar, t, beat, _fight, b) {
    const pattern = [0, 2, 1, 2, 3, 2, 1, 2];
    for (let e = 0; e < 8; e++) {
      const c = chordInfo(chordAt(bar, e / 2));
      const at = t + (e * beat) / 2;
      const tones = [c.root - 12 < 40 ? c.root : c.root - 12, c.tones[1], c.tones[2], c.root + 12];
      b.note('acoustic_guitar_nylon', tones[pattern[e]], at, beat * 1.2, e === 0 ? 0.3 : 0.2, 0.35);
      if (e % 2 === 1) b.shaker(at, 0.02);
    }
    const c0 = chordInfo(bar.ch[0]);
    b.note('acoustic_bass', c0.root - 12, t, beat * 1.8, 0.4, 0.1);
    b.note('acoustic_bass', c0.root - 5, t + 2 * beat, beat * 1.8, 0.33, 0.1);
    if (bar.pad) c0.tones.forEach((m) => b.note('string_ensemble_1', m, t, beat * 3.6, 0.09, 0.5));
    eachNote(bar, t, beat, (m, at, d) => b.note(bar.lead!, bar.lead === 'whistle' ? m + 12 : m, at, Math.max(0.1, d * 0.9), 0.4, 0.6));
  },
});

// ------------------------------------------------------------------ Cat Queen Creep
// A sneaky tiptoe tune for the Cat Queen fight, with real cats singing along.

const MEOWS = ['meow1', 'meow4', 'meow3', 'mew2'];

export const CAT_QUEEN_CREEP = song({
  id: 'catqueen',
  name: 'Cat Queen Creep',
  bpm: 120,
  trim: 3.0,
  cats: true,
  inst: ['pizzicato_strings', 'bassoon', 'clarinet', 'celesta'],
  sections: [
    { name: 'Sneak in', lead: 'bassoon', ch: ['Am', 'Am'], mel: [[[null, 4]], [[null, 4]]] },
    { name: 'Bassoon', lead: 'bassoon', ch: ['Am', 'Am', 'Dm', 'Am', 'E', 'Dm', 'Am', 'Am'], mel: 'A' },
    { name: 'Clarinet', lead: 'clarinet', ch: ['Am', 'Am', 'Dm', 'Am', 'E', 'Dm', 'Am', 'Am'], mel: 'A' },
  ],
  themes: {
    A: [
      [[69, 1], [null, 0.5], [72, 0.5], [76, 1], [null, 1]], [[75, 0.5], [76, 0.5], [72, 1], [69, 1], [null, 1]],
      [[74, 1], [null, 0.5], [77, 0.5], [81, 1], [null, 1]], [[79, 0.5], [76, 0.5], [72, 1], [69, 2]],
      [[71, 1], [null, 0.5], [68, 0.5], [71, 1], [74, 1]], [[77, 1], [76, 0.5], [74, 0.5], [72, 1], [71, 1]],
      [[69, 1], [null, 0.5], [72, 0.5], [76, 1], [81, 1]], [[69, 3], [null, 1]],
    ],
  },
  arrange(bar, t, beat, _fight, b) {
    for (let e = 0; e < 8; e++) {
      const c = chordInfo(chordAt(bar, e / 2));
      const at = t + (e * beat) / 2;
      const walk = c.minor ? [0, 3, 7, 9, 10, 9, 7, 3] : [0, 4, 7, 9, 10, 9, 7, 4];
      b.note('pizzicato_strings', c.root - 12 + walk[e], at, beat * 0.3, 0.5, 0.25);
      b.shaker(at, e % 2 ? 0.03 : 0.015);
    }
    for (let i = 0; i < 4; i++) {
      const at = t + i * beat;
      if (i % 2 === 0) b.thump(at, 0.3);
      else b.brush(at, 0.1);
    }
    eachNote(bar, t, beat, (m, at, d) => b.note(bar.lead!, bar.lead === 'bassoon' ? m - 12 : m, at, Math.max(0.1, d * 0.75), 0.45, 0.35));
    if (bar.lead === 'clarinet') eachNote(bar, t, beat, (m, at, d) => d >= beat && b.note('celesta', m + 12, at, d, 0.12, 0.5));
    // The cat sings along: meows tuned to the tune, hisses in the gaps, a little screech at the tense chord.
    if (bar.sec === 'Sneak in') {
      if (bar.n === 0) b.cat('purr', t, null, 0.22, beat * 7);
      if (bar.n === 1) b.cat('hiss', t + beat * 3, null, 0.16);
      return;
    }
    let pos = 0;
    let k = 0;
    for (const [m, len] of bar.mel) {
      const at = t + pos * beat;
      if (m == null && len <= 0.5 && pos > 0) b.cat('hiss', at, null, 0.1, len * beat);
      else if (m != null) {
        const along = bar.lead === 'clarinet' ? len >= 1 : len >= 1 && (pos === 0 || len >= 2);
        if (along) {
          b.cat(len >= 2 ? 'meow3' : MEOWS[(bar.n + k) % MEOWS.length], at, m, len >= 2 ? 0.2 : 0.16, Math.max(0.3, len * beat * 0.9));
          k++;
        }
      }
      pos += len;
    }
    if (bar.n === 4) b.cat(bar.lead === 'clarinet' ? 'screech2' : 'screech1', t + beat * 3, 74, 0.1, beat * 0.9);
  },
});

/** Radio stations in the order the 📻 button steps through them (then off). */
export const STATIONS: Song[] = [HOME_STRETCH, EVENING_DRIVE, DESERT_HIGHWAY];
export const SONGS: Record<SongId, Song> = { road: HOME_STRETCH, classical: EVENING_DRIVE, west: DESERT_HIGHWAY, catqueen: CAT_QUEEN_CREEP };

/** The MIDI note each cat recording is sung at, measured from the recording. */
export const CAT_PITCH: Record<string, number> = { hiss: 93.12, meow1: 74.12, meow3: 70.62, meow4: 72.87, mew2: 84.37, purr: 50.37, screech1: 76.47, screech2: 74.37 };
export const DRUM_HITS = ['kick', 'kick2', 'snare', 'snare2', 'hat', 'hat2', 'ohat', 'crash', 'shaker', 'tom'];

/** Seconds each instrument takes to fade after its note is let go. */
export const RELEASE: Record<string, number> = {
  electric_guitar_clean: 0.3, electric_bass_finger: 0.12, drawbar_organ: 0.25, acoustic_grand_piano: 1.6, string_ensemble_1: 0.6, cello: 0.5,
  acoustic_guitar_steel: 0.4, acoustic_guitar_nylon: 0.8, fiddle: 0.12, harmonica: 0.1, acoustic_bass: 0.15, whistle: 0.15, trumpet: 0.12,
  clarinet: 0.1, pizzicato_strings: 0.3, bassoon: 0.1, celesta: 0.8, overdriven_guitar: 0.08,
};

/** Every recorded note a song plays, as "instrument:midi", worked out by running its arrangement silently. */
export function notesUsed(s: Song): Set<string> {
  const used = new Set<string>();
  const band: Band = { note: (inst, midi) => void used.add(`${inst}:${midi}`), drum: () => {}, cat: () => {}, thump: () => {}, brush: () => {}, shaker: () => {} };
  for (const bar of s.bars) {
    s.arrange(bar, 0, 0.5, false, band);
    if (s.fightable) s.arrange(bar, 0, 0.5, true, band);
  }
  return used;
}
