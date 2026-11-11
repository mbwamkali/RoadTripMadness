/**
 * The car radio: plays the written-out songs in songs.ts on recorded instruments.
 *
 * Instrument notes, drum hits and cat sounds are small mp3 files in public/audio. A station's
 * files are fetched the first time it plays (the service worker keeps them, so it plays offline
 * after that), a few at a time, and decoded off the main thread, so starting a station never stalls a frame.
 *
 * Ear guardrails: fade in and out, a gentle low-pass, a limiter, each song levelled to about
 * the same loudness, and the music bus sits under the game sounds and the narrator.
 */
import { CAT_PITCH, DRUM_HITS, RELEASE, SONGS, notesUsed, type Band, type Song, type SongId } from './songs';

const BASE = './audio';
/** Files fetched at once while a station loads: quick to start, without flooding the connection. */
const PARALLEL = 6;

/** A fixed "human" feel: a tiny timing nudge and loudness change that depend only on where the note falls. */
function nudge(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export class Radio {
  private readonly ctx: AudioContext;
  private readonly out: GainNode;
  private readonly trim: GainNode;
  private readonly bus: GainNode;
  private readonly verb: GainNode;
  private noiseBuf: AudioBuffer;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loading = new Map<SongId, Promise<boolean>>();
  private readonly loaded = new Set<SongId>();
  /** Called when a song's files can't be loaded (offline before it ever played). */
  onFail: ((id: SongId) => void) | null = null;
  private song: Song | null = null;
  private bar = 0;
  private next = 0;
  private timer = 0;
  private fight = false;
  /** Which song should be playing; loading can finish after the wish has changed. */
  private wanted: SongId | null = null;

  constructor(ctx: AudioContext, dest: AudioNode) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.005;
    comp.release.value = 0.25;
    const soft = ctx.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = 8000;
    soft.Q.value = 0.5;
    this.trim = ctx.createGain();
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -4;
    limit.knee.value = 0;
    limit.ratio.value = 20;
    limit.attack.value = 0.002;
    limit.release.value = 0.1;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.6;
    this.bus.connect(soft).connect(comp).connect(this.trim).connect(limit).connect(this.out).connect(dest);
    // A small room so the band doesn't sound dry.
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.5);
    }
    conv.buffer = ir;
    this.verb = ctx.createGain();
    this.verb.gain.value = 0.3;
    this.verb.connect(conv).connect(soft);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  }

  /** True once a song's files are downloaded and ready to play at once. */
  isLoaded(id: SongId): boolean {
    return this.loaded.has(id);
  }

  /** The song playing now, if any. */
  get playing(): SongId | null {
    return this.song?.id ?? null;
  }

  /** Fetches and decodes a song's files ahead of time. Resolves false if they can't be loaded (offline the first time). */
  preload(id: SongId): Promise<boolean> {
    let p = this.loading.get(id);
    if (!p) {
      p = this.load(SONGS[id]).then(
        (ok) => {
          this.loaded.add(id);
          return ok;
        },
        () => {
          this.loading.delete(id);
          return false;
        },
      );
      this.loading.set(id, p);
    }
    return p;
  }

  private async load(s: Song): Promise<boolean> {
    const files = [...notesUsed(s)].map((k) => {
      const [inst, midi] = k.split(':');
      return [k, `${BASE}/inst/${inst}/${midi}.mp3`];
    });
    if (s.drums) files.push(...DRUM_HITS.map((d) => [`drum:${d}`, `${BASE}/drums/${d}.mp3`]));
    if (s.cats) files.push(...Object.keys(CAT_PITCH).map((c) => [`cat:${c}`, `${BASE}/cats/${c}.mp3`]));
    // A few files at a time: decoding runs off the main thread, and a small batch keeps the
    // network and CPU load gentle mid-drive while still starting a station within a second or two.
    const todo = files.filter(([key]) => !this.buffers.has(key));
    let i = 0;
    const worker = async (): Promise<void> => {
      while (i < todo.length) {
        const [key, url] = todo[i++];
        const res = await fetch(url);
        if (!res.ok) throw new Error(url);
        this.buffers.set(key, await this.ctx.decodeAudioData(await res.arrayBuffer()));
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, worker));
    return true;
  }

  /** Plays a song (or keeps it going), fading in once its files are ready. fight = the heavier fight version. */
  async play(id: SongId, volume: number, fight = false): Promise<void> {
    this.wanted = id;
    this.fight = fight;
    if (this.song?.id === id && this.timer) return;
    // Not downloaded yet: let the old song go now, so the switch is heard straight away.
    if (!this.loaded.has(id)) this.fadeOut();
    const ok = await this.preload(id);
    if (this.wanted !== id) return;
    if (!ok) {
      this.onFail?.(id);
      return;
    }
    this.halt();
    const s = SONGS[id];
    const now = this.ctx.currentTime;
    this.song = s;
    this.trim.gain.value = s.trim;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(0, now);
    this.out.gain.linearRampToValueAtTime(volume, now + 0.5);
    this.bar = 0;
    this.next = now + 0.45;
    this.timer = window.setInterval(() => this.tick(), 40);
    this.tick();
  }

  /** Switches the fight version on or off without restarting the song. */
  setFight(on: boolean): void {
    this.fight = on;
  }

  /** Fades out and stops. */
  stop(): void {
    this.wanted = null;
    this.fadeOut();
  }

  private fadeOut(): void {
    if (!this.song) return;
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(this.out.gain.value, now);
    this.out.gain.linearRampToValueAtTime(0, now + 0.6);
    this.halt();
    this.song = null;
  }

  private halt(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
  }

  private tick(): void {
    const s = this.song;
    if (!s) return;
    while (this.next < this.ctx.currentTime + 0.4) {
      const fight = this.fight && !!s.fightable;
      const beat = 60 / (s.bpm * (fight ? 1.15 : 1));
      s.arrange(s.bars[this.bar], this.next, beat, fight, this.band);
      this.next += 4 * beat;
      this.bar = (this.bar + 1) % s.bars.length;
    }
  }

  // ------------------------------------------------------------ the band

  /** Starts a sound in time even if it's a little late (it starts part-way in instead of piling up). */
  private start(src: AudioBufferSourceNode, at: number): void {
    const late = this.ctx.currentTime - at;
    if (late > 0) src.start(this.ctx.currentTime, late);
    else src.start(at);
  }

  private send(g: GainNode, amount: number): void {
    if (!amount) return;
    const s = this.ctx.createGain();
    s.gain.value = amount;
    g.connect(s).connect(this.verb);
  }

  private readonly band: Band = {
    note: (inst, midi, at, hold, vol, verb = 0.25) => {
      const buf = this.buffers.get(`${inst}:${midi}`);
      if (!buf) return;
      const t = at + (nudge(at * 7 + midi) - 0.5) * 0.018;
      const v = vol * (0.88 + nudge(at * 3 + midi * 1.7) * 0.24);
      const rel = RELEASE[inst] ?? 0.2;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(v, t);
      g.gain.setValueAtTime(v, t + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t + hold + rel);
      src.connect(g).connect(this.bus);
      this.send(g, verb);
      this.start(src, t);
      src.stop(t + hold + rel + 0.05);
    },
    drum: (name, at, vol, alt) => {
      const buf = this.buffers.get(`drum:${alt && this.buffers.has(`drum:${name}2`) ? name + '2' : name}`);
      if (!buf) return;
      const t = at + (nudge(at * 5 + name.length) - 0.5) * 0.01;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = vol * (0.9 + nudge(at * 11) * 0.2);
      src.connect(g).connect(this.bus);
      this.send(g, 0.18);
      this.start(src, t);
    },
    cat: (name, at, midi, vol, maxDur) => {
      const buf = this.buffers.get(`cat:${name}`);
      if (!buf) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      if (midi != null) src.playbackRate.value = Math.pow(2, (midi - CAT_PITCH[name]) / 12);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, at);
      if (maxDur) {
        g.gain.setValueAtTime(vol, at + maxDur);
        g.gain.exponentialRampToValueAtTime(0.0001, at + maxDur + 0.25);
      }
      src.connect(g).connect(this.bus);
      this.send(g, 0.35);
      this.start(src, at);
    },
    thump: (at, vol) => {
      const o = this.ctx.createOscillator();
      o.frequency.setValueAtTime(95, at);
      o.frequency.exponentialRampToValueAtTime(45, at + 0.18);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(vol, at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
      o.connect(g).connect(this.bus);
      o.start(at);
      o.stop(at + 0.3);
    },
    brush: (at, vol) => this.noise(at, 0.14, vol, 'bandpass', 3200, 0.7),
    shaker: (at, vol) => this.noise(at, 0.05, vol, 'highpass', 6000, 1),
  };

  private noise(at: number, dur: number, vol: number, type: BiquadFilterType, freq: number, q: number): void {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    s.connect(f).connect(g).connect(this.bus);
    s.start(Math.max(at, this.ctx.currentTime), Math.random() * 0.5);
    s.stop(Math.max(at, this.ctx.currentTime) + dur + 0.05);
  }
}
