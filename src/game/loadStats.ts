/** How long the game's big downloads took this session (for the ?perf=1 readout). Times in ms since the page opened. */
export const loadStats = {
  /** Detailed vehicles and characters loaded / failed, and when they finished. */
  hd: { ok: 0, fail: 0, at: 0 },
  /** Generated buildings loaded / failed, and when they finished. */
  buildings: { ok: 0, fail: 0, at: 0 },
  /** How long the last trip waited for models after Hit the road. */
  tripWait: 0,
};
