import { h, ui } from './dom';

/**
 * The title screen's "Install app" button. Android and desktop Chrome offer a
 * real install prompt (the beforeinstallprompt event, kept here until the
 * player taps the button). iPhone and iPad have no prompt, so the button
 * shows a picture guide to Share, then Add to Home Screen. Running as the
 * installed app, or on a browser that offers neither, there is no button.
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
let installed = false;
/** Updates the button on the current title screen, if any. */
let current: (() => void) | null = null;
const changed = () => current?.();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    changed();
  });
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // The manifest asks for fullscreen; browsers that can't do that fall back to standalone.
  const mode = (m: string) => window.matchMedia?.(`(display-mode: ${m})`).matches;
  return mode('fullscreen') || mode('standalone') || (navigator as { standalone?: boolean }).standalone === true;
}

/** iPhone, iPad and iPod (iPads may say they are a Mac, but have a touch screen). */
export function isIos(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints ?? 0): boolean {
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && touchPoints > 1);
}

/** Whether the button should show right now. */
export function canInstall(): boolean {
  return !installed && !isStandalone() && (!!deferred || isIos());
}

/** The Install app button; it hides itself whenever installing isn't possible. */
export function installButton(): HTMLButtonElement {
  const b = h('button', { class: 'btn install' }, '📲 Install app');
  const sync = () => (b.hidden = !canInstall());
  sync();
  current = sync;
  b.addEventListener('click', async () => {
    if (deferred) {
      const d = deferred;
      deferred = null;
      await d.prompt();
      await d.userChoice.catch(() => null);
      sync();
    } else showIosGuide();
  });
  return b;
}

const SHARE_ICON =
  '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M7.5 7.5 12 3l4.5 4.5"/><path d="M6 11H5v10h14V11h-1"/></svg>';
const ADD_ICON =
  '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';

function icon(svg: string): HTMLElement {
  const span = h('span', { class: 'guide-icon' });
  span.innerHTML = svg;
  return span;
}

/** A picture guide for iPhone and iPad: Share, then Add to Home Screen. */
export function showIosGuide(): void {
  const close = () => overlay.remove();
  const overlay = h(
    'div',
    { class: 'modal' },
    h(
      'div',
      { class: 'card install-guide' },
      h('h2', {}, 'Put the game on your Home Screen'),
      h('ol', {}, h('li', {}, icon(SHARE_ICON), h('span', {}, 'Tap ', h('b', {}, 'Share'), ' at the bottom of Safari (top right on iPad)')), h('li', {}, icon(ADD_ICON), h('span', {}, 'Scroll down and tap ', h('b', {}, 'Add to Home Screen'))), h('li', {}, h('span', { class: 'guide-icon' }, '🚗'), h('span', {}, 'Tap ', h('b', {}, 'Add'), '. The game opens full screen from its icon, and works offline'))),
      h('button', { class: 'btn primary', onclick: close }, 'Got it'),
    ),
  );
  overlay.addEventListener('click', (e) => e.target === overlay && close());
  ui().append(overlay);
}
