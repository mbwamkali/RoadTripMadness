/**
 * Registers the service worker in production builds, so the game can be
 * installed and opened offline, and keeps the game up to date: it looks for
 * a new build when the game opens and whenever it comes back to the screen.
 * A new build switches over by itself (the worker skips waiting); `onUpdate`
 * is called when it has, so the game can reload (or offer to, mid-trip).
 */

let registration: ServiceWorkerRegistration | null = null;
let onUpdate: (() => void) | null = null;
let hadController = false;

export function registerServiceWorker(updated?: () => void): void {
  onUpdate = updated ?? null;
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // The first install taking control isn't an update.
    if (!hadController) {
      hadController = true;
      return;
    }
    onUpdate?.();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        registration = reg;
        void reg.update().catch(() => {});
      })
      .catch(() => {
        /* Offline support is a bonus; the game works without it. */
      });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void registration?.update().catch(() => {});
  });
}

/**
 * Looks for a newer build right now. Resolves 'updating' when one was found
 * (the game reloads once it takes over), 'current' when this is the newest,
 * and 'offline' when it couldn't check.
 */
export async function checkForUpdate(): Promise<'updating' | 'current' | 'offline'> {
  if (!registration) return navigator.onLine ? 'current' : 'offline';
  try {
    await registration.update();
  } catch {
    return 'offline';
  }
  return registration.installing || registration.waiting ? 'updating' : 'current';
}
