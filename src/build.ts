declare const __BUILD__: { number: string; commit: string; time: string } | undefined;

/** Which build this is (filled in by vite.config.ts; tests and dev get a stand-in). */
export const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : { number: '0', commit: 'dev', time: new Date().toISOString() };

/** "Build 312 · beb1702 · Nov 1, 9:20 PM" (the time in the player's own time zone). */
export function buildLabel(): string {
  const when = new Date(BUILD.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `Build ${BUILD.number} · ${BUILD.commit} · ${when}`;
}
