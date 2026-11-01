/**
 * Narration: the device's own text-to-speech voice (speechSynthesis) reads
 * event text, choices, road signs and tips aloud. It needs no network, so it
 * works offline. Off by default; kid mode turns it on. A new line cuts off
 * the one before, so the voice never falls behind the game.
 */

const KEY = 'rtm-narrate';

/** Emoji and pictographs read badly ("fuel pump"); speech gets plain words only. */
export function speakable(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, '')
    .replace(/[·•|]/g, ',')
    .replace(/\s*↗\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/^[\s,]+|[\s,]+$/g, '');
}

/** "A, B or C" for reading a list of choices. */
export function spokenList(items: string[]): string {
  const xs = items.map(speakable).filter(Boolean);
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;
}

const synth = (): SpeechSynthesis | null => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null);

let enabled = (() => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
})();
let voice: SpeechSynthesisVoice | null = null;

/** A clear English voice, preferring one that runs on the device. */
function pickVoice(): SpeechSynthesisVoice | null {
  const all = synth()?.getVoices() ?? [];
  const en = all.filter((v) => /^en(-|_|$)/i.test(v.lang));
  return en.find((v) => v.localService && /en-US/i.test(v.lang)) ?? en.find((v) => v.localService) ?? en[0] ?? all[0] ?? null;
}
synth()?.addEventListener?.('voiceschanged', () => (voice = pickVoice()));

export const narrator = {
  /** Whether speech works on this device at all. */
  get available(): boolean {
    return !!synth();
  },
  get on(): boolean {
    return enabled && !!synth();
  },
  set(on: boolean, remember = true): void {
    enabled = on;
    if (remember) {
      try {
        localStorage.setItem(KEY, on ? '1' : '0');
      } catch {
        // Storage blocked: it lasts for this visit.
      }
    }
    if (!on) synth()?.cancel();
  },
  /** Reads a line aloud (when narration is on), cutting off whatever was being read. */
  say(text: string): void {
    const s = synth();
    const line = speakable(text);
    if (!enabled || !s || !line) return;
    s.cancel();
    const u = new SpeechSynthesisUtterance(line);
    voice = voice ?? pickVoice();
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? 'en-US';
    u.rate = 0.95;
    u.pitch = 1.05;
    s.speak(u);
  },
  stop(): void {
    synth()?.cancel();
  },
};

/**
 * Reads a card aloud and lets a tap on the card (anywhere but its buttons
 * and links) read it again. `text` is called each time, so a card that
 * changes (an event's outcome) replays what it says now.
 */
export function narrateCard(card: HTMLElement, text: () => string): void {
  narrator.say(text());
  card.classList.add('narrated');
  card.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button, a, input, select')) return;
    narrator.say(text());
  });
}

/** What a card says: its outcome once there is one, otherwise its heading, text and choices. */
export function cardText(card: HTMLElement): string {
  const outcome = card.querySelector('.outcome');
  if (outcome) return outcome.textContent ?? '';
  const parts: string[] = [];
  for (const el of card.querySelectorAll('h2, p')) if (!el.closest('button')) parts.push(el.textContent ?? '');
  const choices = [...card.querySelectorAll('button.choice:not([disabled]) b')].map((b) => b.textContent ?? '');
  if (choices.length) parts.push(`You can ${spokenList(choices)}.`);
  return parts.map((t) => speakable(t).replace(/([^.!?])$/, '$1.')).join(' ');
}

/**
 * Reads every card that pops up in the game's UI layer (events, arrivals,
 * boss intros, fight results), and the heading of each new screen at a stop.
 * Cards marked data-quiet (the pause menu, the garage) are left alone.
 */
export function narrateUi(root: HTMLElement): void {
  new MutationObserver((records) => {
    for (const r of records)
      for (const n of r.addedNodes) {
        if (!(n instanceof HTMLElement)) continue;
        const card = n.matches('.card') ? n : n.querySelector<HTMLElement>('.modal .card');
        if (card && !card.closest('[data-quiet]') && !card.classList.contains('narrated')) narrateCard(card, () => cardText(card));
        else if (n.matches('.screen.explore')) {
          const h2 = n.querySelector('h2');
          if (h2) narrator.say(`${h2.textContent}.`);
        }
      }
  }).observe(root, { childList: true, subtree: true });
}
