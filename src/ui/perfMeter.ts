import type * as THREE from 'three';
import { loadAutoCap, onPhone, quality } from '../scenes/quality';
import { BUILD } from '../build';
import { devClock } from '../game/time';
import { loadStats } from '../game/loadStats';

/** What the game is doing right now, from main.ts. Only `screen` is always there. */
export interface GameInfo {
  screen: string;
  hour?: number;
  weather?: string;
  biome?: string;
  road?: string;
  mph?: number;
  limit?: number;
  ride?: string;
  kid?: boolean;
  km?: number;
}

/**
 * A speed and test readout for real phones: open the game with ?perf=1
 * (remembered until ?perf=0). Refreshed every second. Line 1 is for people;
 * the rest is a compact code for reading off a screenshot:
 *
 *   L1  60 fps · Medium · build 101
 *   P   a avg frame ms, w slowest, s fps over the last 30 s (min-max, first 10 s > last 10 s:
 *       a falling trend means the phone is heating up), d draws, t triangles (k), g models,
 *       x textures, m JS memory MB (Chrome only)
 *   D   phone model, graphics chip, system, browser, cores, memory GB, quality choice (auto>m = Auto stepped down to Medium), ph or pc (counted as phone or computer),
 *       os/v exact versions, screen WxH, P/L orientation, r pixel ratio, battery % (+ charging), on/off line
 *   G   screen (road, roadfight, fight, town, bldg, menu), h hour, weather (* = set in the test panel),
 *       biome, road type, mph/limit, ride, kid mode, km into the trip
 *   L   load: trip wait ms, detailed models ok/fail at ms, buildings ok/fail at ms, c commit
 *
 * Nothing personal (no location, no account) goes in.
 */
export class PerfMeter {
  private el: HTMLDivElement | null = null;
  private frames = 0;
  private worst = 0;
  private sum = 0;
  private since = performance.now();
  private last = performance.now();
  private device = '';
  private history: number[] = [];
  private battery = '';

  constructor(
    private renderer: THREE.WebGLRenderer,
    private game: () => GameInfo = () => ({ screen: '?' }),
  ) {
    const q = new URLSearchParams(location.search).get('perf');
    try {
      if (q === '1') localStorage.setItem('rtm-perf', '1');
      if (q === '0') localStorage.removeItem('rtm-perf');
    } catch {
      /* storage blocked */
    }
    let on = q === '1';
    try {
      on ||= localStorage.getItem('rtm-perf') === '1';
    } catch {
      /* storage blocked */
    }
    if (!on) return;
    renderer.info.autoReset = false;
    this.device = deviceCode(renderer);
    // Chrome hides the phone model and exact Android build unless asked.
    const uad = (navigator as Navigator & { userAgentData?: { getHighEntropyValues(h: string[]): Promise<Record<string, string>> } }).userAgentData;
    void uad
      ?.getHighEntropyValues(['model', 'platformVersion', 'uaFullVersion'])
      .then((v) => {
        const model = (v.model || '').replace(/\s+/g, '');
        this.device = `${model ? model + ' ' : ''}${this.device} os${v.platformVersion ?? '?'} v${(v.uaFullVersion ?? '').split('.').slice(0, 3).join('.')}`;
      })
      .catch(() => undefined);
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean; addEventListener(t: string, f: () => void): void }> };
    void nav
      .getBattery?.()
      .then((b) => {
        const set = () => (this.battery = ` b${Math.round(b.level * 100)}${b.charging ? '+' : ''}`);
        set();
        b.addEventListener('levelchange', set);
        b.addEventListener('chargingchange', set);
      })
      .catch(() => undefined);
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'fixed', left: '50%', transform: 'translateX(-50%)', top: 'calc(env(safe-area-inset-top) + 2px)', zIndex: '9999', maxWidth: '98vw', overflow: 'hidden',
      font: '600 9px/1.25 ui-monospace, monospace', color: '#fff', background: 'rgba(0,0,0,0.65)', padding: '3px 6px', borderRadius: '6px', pointerEvents: 'none', whiteSpace: 'pre',
    });
    this.el.textContent = `build ${BUILD.number}`;
    document.body.append(this.el);
  }

  /** Call once at the start of each frame. */
  begin(): void {
    if (this.el) this.renderer.info.reset();
  }

  /** Call once after the frame is drawn. */
  end(): void {
    if (!this.el) return;
    const now = performance.now();
    const ft = now - this.last;
    this.worst = Math.max(this.worst, ft);
    this.sum += ft;
    this.last = now;
    this.frames++;
    if (now - this.since < 1000) return;
    const fps = (this.frames * 1000) / (now - this.since);
    this.history.push(fps);
    if (this.history.length > 30) this.history.shift();
    const h = this.history;
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const trend = `${Math.round(Math.min(...h))}-${Math.round(Math.max(...h))} ${Math.round(avg(h.slice(0, 10)))}>${Math.round(avg(h.slice(-10)))}`;
    const i = this.renderer.info;
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    const mode = { low: 'Low', medium: 'Medium', high: 'High' }[quality.level];
    const g = this.game();
    const n = (x: number | undefined, d = 0) => (x == null ? '-' : x.toFixed(d));
    const gameLine = [
      g.screen,
      `h${n(g.hour, 1)}${devClock.hour != null ? '*' : ''}`,
      `${g.weather ?? '-'}${devClock.weather ? '*' : ''}`,
      g.biome ?? '-',
      g.road ?? '-',
      `${n(g.mph)}/${n(g.limit)}`,
      g.ride ?? '-',
      g.kid ? 'kid' : 'nokid',
      `${n(g.km)}km`,
    ].join(' ');
    const at = (x: { ok: number; fail: number; at: number }) => `${x.ok}/${x.fail}@${Math.round(x.at)}`;
    this.el.textContent = [
      `${fps.toFixed(0)} fps · ${mode} · build ${BUILD.number}`,
      `P a${(this.sum / this.frames).toFixed(1)} w${this.worst.toFixed(0)} s${trend} d${i.render.calls} t${Math.round(i.render.triangles / 1000)} g${i.memory.geometries} x${i.memory.textures} m${mem ? Math.round(mem.usedJSHeapSize / 1048576) : '-'}`,
      `D ${this.device} ${qualityCode()} ${innerWidth}x${innerHeight}${innerWidth > innerHeight ? 'L' : 'P'} r${this.renderer.getPixelRatio().toFixed(1)}/${devicePixelRatio.toFixed(1)}${this.battery} ${navigator.onLine ? 'on' : 'off'}`,
      `G ${gameLine}`,
      `L t${Math.round(loadStats.tripWait)} hd${at(loadStats.hd)} b${at(loadStats.buildings)} c${BUILD.commit}`,
    ].join('\n');
    this.frames = 0;
    this.worst = 0;
    this.sum = 0;
    this.since = now;
  }
}

/**
 * Line 3 of the readout: the phone's graphics chip, system and browser,
 * CPU cores and memory, e.g. "Pixel8 Mali-G715 And14 Chr131 8c 8g os14.0.0 v131.0.6778" (then the graphics choice, see qualityCode)
 * (the phone model and exact versions arrive a moment later, where the browser shares them).
 */
function deviceCode(renderer: THREE.WebGLRenderer): string {
  let gpu = '?';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    // "ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)" -> "Adreno740"; keep it short.
    const m = gpu.match(/(Adreno|Mali|PowerVR|Immortalis|Xclipse|Apple|Intel|NVIDIA|GeForce|Radeon|AMD|SwiftShader)[^,)]*/i);
    gpu = (m ? m[0] : gpu).replace(/\(TM\)|\(R\)|Graphics|Direct3D.*$/gi, '').replace(/[^A-Za-z0-9.-]/g, '').slice(0, 18);
  } catch {
    /* no WebGL info */
  }
  const ua = navigator.userAgent;
  const os = /Android (\d+)/.exec(ua)?.[1] ? `And${/Android (\d+)/.exec(ua)![1]}` : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Win' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Lin' : '?';
  const br = /Edg\/(\d+)/.exec(ua) ? `Edg${/Edg\/(\d+)/.exec(ua)![1]}` : /Chrome\/(\d+)/.exec(ua) ? `Chr${/Chrome\/(\d+)/.exec(ua)![1]}` : /Firefox\/(\d+)/.exec(ua) ? `Ffx${/Firefox\/(\d+)/.exec(ua)![1]}` : /Safari/.test(ua) ? 'Saf' : '?';
  const nav = navigator as Navigator & { deviceMemory?: number };
  return `${gpu} ${os} ${br} ${nav.hardwareConcurrency ?? '?'}c ${nav.deviceMemory ?? '?'}g`;
}

/**
 * Graphics choice, read fresh each refresh: "auto>m" means Auto measured this
 * device down to Medium; "ph"/"pc" means it was counted as a phone or a computer.
 */
function qualityCode(): string {
  let choice = 'auto';
  try {
    choice = localStorage.getItem('rtm-quality') ?? 'auto';
  } catch {
    /* storage blocked */
  }
  const cap = choice === 'auto' ? loadAutoCap() : null;
  return `${choice}${cap ? `>${cap[0]}` : ''} ${onPhone ? 'ph' : 'pc'}`;
}
