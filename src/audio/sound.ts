/**
 * Game sound effects are synthesized with the Web Audio API. The car radio
 * (radio.ts) plays written-out songs on recorded instruments. Browsers only
 * allow audio after a user gesture, so `unlock()` is called from the first tap.
 */
import { Radio } from './radio';
import { STATIONS, type SongId, type StationId } from './songs';
import type { BossKind } from '../game/combat';

export type Station = 'off' | StationId;
const STATION_ORDER: Station[] = ['off', ...STATIONS.map((s) => s.id as StationId)];
/** Music level into the master bus: under the game sounds and the narrator. */
const MUSIC_VOLUME = 0.45;

interface Settings {
  sfx: boolean;
  station: Station;
}

const KEY = 'rtm-audio';

function loadSettings(): Settings {
  try {
    const saved = { sfx: true, station: 'road', ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Settings>) } as Settings;
    // The old stations (KTWG Country, Neon FM) are gone: anyone who had one on gets Home Stretch.
    if (!STATION_ORDER.includes(saved.station)) saved.station = 'road';
    return saved;
  } catch {
    return { sfx: true, station: 'road' };
  }
}

class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private noiseBuf!: AudioBuffer;
  private engineOsc: OscillatorNode | null = null;
  private engineSub: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineKey = '';
  private radio: Radio | null = null;
  private backgroundLoading = false;
  /** What the music should be doing: off, the station while driving, or a fight. */
  private musicMode: { kind: 'off' } | { kind: 'drive' } | { kind: 'fight'; boss?: BossKind } = { kind: 'off' };
  settings = loadSettings();
  /** Called when the radio can't load a song (offline before it ever played). */
  onRadioFail: ((id: SongId) => void) | null = null;

  /** Creates or resumes the audio context. Safe to call on every tap. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.settings.sfx ? 1 : 0;
      this.sfxBus.connect(this.master);
      this.radio = new Radio(this.ctx, this.master);
      this.radio.onFail = (id) => this.onRadioFail?.(id);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const kick = () => this.applyMusic();
    if (this.ctx.state === 'suspended') void this.ctx.resume().then(kick);
    else kick();
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
  }

  setSfx(on: boolean): void {
    this.settings.sfx = on;
    this.save();
    if (this.ctx) this.sfxBus.gain.value = on ? 1 : 0;
  }

  /** Cycles the car radio: off, then each station in turn. Returns the new station. */
  nextStation(): Station {
    this.settings.station = STATION_ORDER[(STATION_ORDER.indexOf(this.settings.station) + 1) % STATION_ORDER.length];
    this.save();
    this.applyMusic();
    return this.settings.station;
  }

  // ------------------------------------------------------------ building blocks

  private get t(): number {
    return this.ctx!.currentTime;
  }

  private env(gain: GainNode, at: number, peak: number, attack: number, decay: number): void {
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  }

  private noise(dur: number, filterType: BiquadFilterType, freq: number, peak: number, q = 1, at = this.t, dest?: AudioNode): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, at, peak, 0.004, dur);
    src.connect(f).connect(g).connect(dest ?? this.sfxBus);
    src.start(at, Math.random() * 0.5);
    src.stop(at + dur + 0.05);
  }

  private tone(type: OscillatorType, freq: number, dur: number, peak: number, opts: { to?: number; at?: number; attack?: number; dest?: AudioNode; detune?: number } = {}): void {
    const ctx = this.ctx!;
    const at = opts.at ?? this.t;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, at + dur);
    if (opts.detune) o.detune.value = opts.detune;
    const g = ctx.createGain();
    this.env(g, at, peak, opts.attack ?? 0.005, dur);
    o.connect(g).connect(opts.dest ?? this.sfxBus);
    o.start(at);
    o.stop(at + (opts.attack ?? 0.005) + dur + 0.05);
  }

  private get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  // ------------------------------------------------------------ engine

  /** Sets the engine hum; level 0 stops it. `speed` 1 = cruise. */
  engine(speed: number, boosting = false): void {
    if (!this.ready) return;
    // Only touch the audio graph when something changed; this runs every frame.
    const key = `${speed.toFixed(2)}${boosting}`;
    if (key === this.engineKey) return;
    this.engineKey = key;
    const ctx = this.ctx!;
    if (speed <= 0) {
      if (this.engineGain) this.engineGain.gain.setTargetAtTime(0, this.t, 0.15);
      return;
    }
    if (!this.engineOsc) {
      this.engineOsc = ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineSub = ctx.createOscillator();
      this.engineSub.type = 'square';
      this.engineFilter = ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 300;
      this.engineGain = ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineOsc.connect(this.engineFilter);
      this.engineSub.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain).connect(this.sfxBus);
      this.engineOsc.start();
      this.engineSub.start();
    }
    const base = 42 + Math.min(3, speed) * 16 + (boosting ? 40 : 0);
    this.engineOsc.frequency.setTargetAtTime(base, this.t, 0.3);
    this.engineSub!.frequency.setTargetAtTime(base / 2, this.t, 0.3);
    this.engineFilter!.frequency.setTargetAtTime(boosting ? 900 : 260 + speed * 60, this.t, 0.3);
    this.engineGain!.gain.setTargetAtTime(boosting ? 0.11 : 0.06, this.t, 0.2);
  }

  // ------------------------------------------------------------ effects

  shot(weapon: 'bullets' | 'shells' | 'catnip' | 'rocks'): void {
    if (!this.ready) return;
    if (weapon === 'bullets') {
      this.noise(0.07, 'bandpass', 1800, 0.35, 0.8);
      this.tone('square', 180, 0.05, 0.08, { to: 60 });
    } else if (weapon === 'shells') {
      this.noise(0.28, 'lowpass', 1400, 0.7, 0.7);
      this.tone('sine', 120, 0.2, 0.4, { to: 40 });
    } else if (weapon === 'catnip') {
      this.tone('sine', 300, 0.15, 0.3, { to: 900 });
      for (let i = 0; i < 5; i++) this.tone('triangle', 1200 + i * 300, 0.12, 0.08, { at: this.t + 0.12 + i * 0.04 });
      this.noise(0.4, 'highpass', 3000, 0.2, 0.5, this.t + 0.1);
    } else {
      this.noise(0.08, 'lowpass', 600, 0.4, 1);
    }
  }

  empty(): void {
    if (!this.ready) return;
    this.tone('square', 900, 0.03, 0.08);
  }

  kill(type: 'zombie' | 'outlaw' | 'catship' | 'boss'): void {
    if (!this.ready) return;
    if (type === 'boss') {
      this.noise(1.4, 'lowpass', 500, 0.9, 0.6);
      this.tone('sine', 110, 1.2, 0.35, { to: 30 });
      this.tone('sawtooth', 220, 0.8, 0.08, { to: 60, at: this.t + 0.2 });
      return;
    }
    if (type === 'zombie') {
      this.noise(0.25, 'lowpass', 500, 0.5, 2);
      this.tone('sawtooth', 140, 0.35, 0.12, { to: 50 });
    } else if (type === 'outlaw') {
      this.noise(0.4, 'lowpass', 900, 0.6, 1);
      this.tone('sawtooth', 260, 0.3, 0.1, { to: 90 });
    } else {
      // Indignant space cat.
      this.tone('sawtooth', 700, 0.12, 0.15, { to: 1300, attack: 0.03 });
      this.tone('sawtooth', 1300, 0.35, 0.12, { to: 400, at: this.t + 0.14 });
      this.noise(0.6, 'bandpass', 900, 0.4, 0.6, this.t + 0.05);
    }
  }

  groan(): void {
    if (!this.ready) return;
    const f = 85 + Math.random() * 40;
    this.tone('sawtooth', f, 0.9, 0.07, { to: f * 0.7, attack: 0.25 });
    this.tone('sawtooth', f * 1.5, 0.8, 0.03, { to: f, attack: 0.3, detune: 15 });
  }

  meow(): void {
    if (!this.ready) return;
    const f = 600 + Math.random() * 300;
    this.tone('triangle', f, 0.18, 0.08, { to: f * 1.6, attack: 0.05 });
    this.tone('triangle', f * 1.6, 0.3, 0.07, { to: f * 0.9, at: this.t + 0.2 });
  }

  carHit(): void {
    if (!this.ready) return;
    this.noise(0.18, 'lowpass', 400, 0.8, 1.5);
    this.tone('sine', 90, 0.2, 0.5, { to: 40 });
    this.noise(0.12, 'highpass', 4000, 0.15, 1, this.t + 0.02);
  }

  enemyShot(): void {
    if (!this.ready) return;
    this.noise(0.12, 'bandpass', 1200, 0.25, 1);
  }

  charge(): void {
    if (!this.ready) return;
    this.tone('sine', 200, 1.3, 0.1, { to: 1400, attack: 0.2 });
  }

  /** A boss's big attack landing. */
  slam(hit: boolean): void {
    if (!this.ready) return;
    this.noise(0.6, 'lowpass', 350, hit ? 0.9 : 0.5, 1.2);
    this.tone('sine', 90, 0.5, hit ? 0.35 : 0.2, { to: 28 });
  }

  laser(): void {
    if (!this.ready) return;
    this.tone('sawtooth', 1800, 0.45, 0.2, { to: 120 });
    this.tone('square', 900, 0.4, 0.06, { to: 80 });
  }

  horn(): void {
    if (!this.ready) return;
    for (const f of [392, 494]) this.tone('square', f, 0.55, 0.12, { attack: 0.02 });
  }

  /** Tyres on rumble strips and gravel as the car leaves the road. */
  rumble(): void {
    if (!this.ready) return;
    this.noise(0.45, 'lowpass', 260, 0.5, 2);
    this.tone('square', 46, 0.4, 0.08);
  }

  /** Knocking over a post or a sign. */
  thud(): void {
    if (!this.ready) return;
    this.noise(0.25, 'bandpass', 500, 0.45, 1.5);
    this.tone('triangle', 180, 0.25, 0.15, { to: 70 });
  }

  /** A cow's moo (honked at, or bumped). */
  moo(at = 0): void {
    if (!this.ready) return;
    const t = this.t + at;
    this.tone('sawtooth', 150, 1, 0.07, { to: 105, attack: 0.18, at: t });
    this.tone('sine', 300, 0.9, 0.06, { to: 210, attack: 0.18, at: t });
  }

  /** A giant armadillo's surprised squeak. */
  squeak(at = 0): void {
    if (!this.ready) return;
    const t = this.t + at;
    this.tone('triangle', 900, 0.14, 0.1, { to: 1500, at: t });
    this.tone('triangle', 1000, 0.16, 0.08, { to: 1700, at: t + 0.18 });
  }

  boost(): void {
    if (!this.ready) return;
    this.noise(1.2, 'bandpass', 700, 0.5, 0.6);
    this.tone('sawtooth', 120, 1, 0.12, { to: 480, attack: 0.05 });
  }

  click(): void {
    if (!this.ready) return;
    this.tone('triangle', 1400, 0.03, 0.06);
  }

  /** Turn-signal tick. */
  tick(on: boolean): void {
    if (!this.ready) return;
    this.tone('square', on ? 1500 : 1100, 0.015, 0.04);
  }

  coin(): void {
    if (!this.ready) return;
    this.tone('square', 988, 0.08, 0.08);
    this.tone('square', 1319, 0.25, 0.08, { at: this.t + 0.08 });
  }

  bad(): void {
    if (!this.ready) return;
    this.tone('sawtooth', 220, 0.25, 0.12, { to: 110 });
  }

  fanfare(win: boolean): void {
    if (!this.ready) return;
    const notes = win ? [523, 659, 784, 1047] : [392, 349, 311, 262];
    notes.forEach((f, i) => this.tone('square', f, i === 3 ? 0.7 : 0.18, 0.12, { at: this.t + i * 0.18 }));
  }

  // ------------------------------------------------------------ car radio

  /** Plays the chosen station (if not off) while driving. */
  startMusic(): void {
    this.musicMode = { kind: 'drive' };
    this.applyMusic();
    // In the background, one after another: the chosen station, the Cat Queen's song for the end of
    // the trip, then the other stations, so switching later is instant.
    const r = this.radio;
    if (r && this.settings.station !== 'off' && !this.backgroundLoading) {
      this.backgroundLoading = true;
      const order: SongId[] = [this.settings.station, 'catqueen', ...STATIONS.map((s) => s.id)];
      void (async () => {
        for (const id of order) if (!(await r.preload(id))) break;
        this.backgroundLoading = false;
      })();
    }
  }

  /**
   * Music for a fight on the road: the Cat Queen gets her own song, and Home Stretch
   * switches to its faster fight version. Other stations just keep playing.
   */
  fightMusic(boss?: BossKind): void {
    this.musicMode = { kind: 'fight', boss };
    this.applyMusic();
  }

  stopMusic(): void {
    this.musicMode = { kind: 'off' };
    this.applyMusic();
  }

  /** True when the chosen station still has to download before it can play. */
  get tuning(): boolean {
    const st = this.settings.station;
    return st !== 'off' && !!this.radio && !this.radio.isLoaded(st);
  }

  get station(): Station {
    return this.settings.station;
  }

  private applyMusic(): void {
    const r = this.radio;
    if (!r || !this.ready) return;
    const station = this.settings.station;
    const mode = this.musicMode;
    if (mode.kind === 'off' || station === 'off') return r.stop();
    if (mode.kind === 'fight' && mode.boss === 'mothership') return void r.play('catqueen', MUSIC_VOLUME);
    const fight = mode.kind === 'fight';
    if (r.playing === station) r.setFight(fight);
    else void r.play(station, MUSIC_VOLUME, fight);
  }
}

export const sound = new Sound();
