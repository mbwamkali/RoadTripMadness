import type { QualityLevel } from './quality';

/**
 * Auto graphics: the device starts on its best guess, then the first stretch of
 * driving is timed. If it can't hold about 50 frames a second it steps down a
 * level (two if it's far off), times again, and remembers the result on the device.
 */
export const AUTO_TUNE = {
  /** Seconds of driving ignored after a scene is built (shaders compiling, models arriving). */
  warmup: 3,
  /** Seconds of driving that are timed. */
  window: 12,
  /** Below this average the level steps down once. */
  minFps: 48,
  /** Below this it skips straight down two levels. */
  farOffFps: 28,
  /** A single gap longer than this (a hitch while loading; hidden tabs are skipped anyway) isn't counted. */
  maxGapMs: 1000,
};

const DOWN: Record<QualityLevel, QualityLevel> = { high: 'medium', medium: 'low', low: 'low' };

/** The level to drop to for a measured frame rate, or null to stay. */
export function stepFor(level: QualityLevel, fps: number): QualityLevel | null {
  if (level === 'low' || fps >= AUTO_TUNE.minFps) return null;
  const one = DOWN[level];
  return fps < AUTO_TUNE.farOffFps ? DOWN[one] : one;
}

export class AutoTune {
  private warm = 0;
  private timed = 0;
  private frames = 0;
  /** True once a level has held up; nothing more is measured this session. */
  settled = false;

  /** Start over (new scene, or the level just changed). */
  reset(): void {
    this.warm = 0;
    this.timed = 0;
    this.frames = 0;
  }

  /**
   * Call once a frame with the real time since the last one. `counting` is false
   * when nothing is being timed (paused, in a menu, a fight, a town).
   * Returns the level to drop to once a full window is timed, else null.
   */
  frame(gapMs: number, counting: boolean, level: QualityLevel): QualityLevel | null {
    if (this.settled || level === 'low') return null;
    if (!counting || gapMs > AUTO_TUNE.maxGapMs) return null;
    if (this.warm < AUTO_TUNE.warmup * 1000) {
      this.warm += gapMs;
      return null;
    }
    this.timed += gapMs;
    this.frames++;
    if (this.timed < AUTO_TUNE.window * 1000) return null;
    const fps = (this.frames * 1000) / this.timed;
    const next = stepFor(level, fps);
    this.reset();
    if (!next) this.settled = true;
    return next;
  }
}
