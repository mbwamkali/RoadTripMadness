/** Registers the service worker in production builds, so the game can be installed and opened offline. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* Offline support is a bonus; the game works without it. */
    });
  });
}
