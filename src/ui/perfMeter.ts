import type * as THREE from 'three';
import { quality } from '../scenes/quality';
import { BUILD } from '../build';

/**
 * A small speed readout for testing on real phones: open the game with
 * ?perf=1 (remembered until ?perf=0). Shows frames per second, the slowest
 * frame, draw calls and triangles, refreshed every second.
 */
export class PerfMeter {
  private el: HTMLDivElement | null = null;
  private frames = 0;
  private worst = 0;
  private since = performance.now();
  private last = performance.now();

  constructor(private renderer: THREE.WebGLRenderer) {
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
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'fixed', left: '50%', transform: 'translateX(-50%)', top: 'calc(env(safe-area-inset-top) + 2px)', zIndex: '9999',
      font: '600 11px/1.3 ui-monospace, monospace', color: '#fff', background: 'rgba(0,0,0,0.65)', padding: '3px 7px', borderRadius: '6px', pointerEvents: 'none', whiteSpace: 'pre',
    });
    this.el.textContent = `build ${BUILD.number} · ${BUILD.commit}`;
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
    this.worst = Math.max(this.worst, now - this.last);
    this.last = now;
    this.frames++;
    if (now - this.since < 1000) return;
    const fps = (this.frames * 1000) / (now - this.since);
    const i = this.renderer.info;
    const tris = i.render.triangles;
    this.el.textContent = `${fps.toFixed(0)} fps · worst ${this.worst.toFixed(0)} ms · ${quality.level} ×${this.renderer.getPixelRatio().toFixed(1)}\n${i.render.calls} draws · ${tris > 1e6 ? (tris / 1e6).toFixed(2) + 'M' : Math.round(tris / 1000) + 'k'} tris · ${i.memory.geometries} geo · ${i.memory.textures} tex\nbuild ${BUILD.number} · ${BUILD.commit}`;
    this.frames = 0;
    this.worst = 0;
    this.since = now;
  }
}
