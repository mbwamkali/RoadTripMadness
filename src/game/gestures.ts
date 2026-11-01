/**
 * Touch gestures shared by the road and the fight view.
 *
 * - A press that moves past SWIPE_PX within SWIPE_MS is a swipe; anything
 *   slower or shorter stays a tap or a hold (so taps and held aim still shoot).
 * - Two taps within DOUBLE_TAP_MS and DOUBLE_TAP_PX of each other are a double tap.
 */
export const SWIPE_PX = 36;
export const SWIPE_MS = 350;
export const DOUBLE_TAP_MS = 450;
export const DOUBLE_TAP_PX = 48;

export interface Press {
  x: number;
  y: number;
  t: number;
  id: number;
}

/** Whether a press that has moved to (x, y) by time t is now a swipe. */
export function isSwipe(p: Press, x: number, y: number, t: number): boolean {
  return t - p.t <= SWIPE_MS && Math.hypot(x - p.x, y - p.y) >= SWIPE_PX;
}

/** Remembers the last tap and says when a new one makes a double tap. */
export class DoubleTap {
  private last: { x: number; y: number; t: number } | null = null;

  /** Records a tap; true when it completes a double tap (which then starts over). */
  tap(x: number, y: number, t: number): boolean {
    const l = this.last;
    if (l && t - l.t <= DOUBLE_TAP_MS && Math.hypot(x - l.x, y - l.y) <= DOUBLE_TAP_PX) {
      this.last = null;
      return true;
    }
    this.last = { x, y, t };
    return false;
  }

  reset(): void {
    this.last = null;
  }
}
