/**
 * Kid mode: one switch that makes the game readable for a small child.
 * Narration and event scenes on, the easiest difficulty, one-line text, at
 * most three big picture choices, supplies as icons and bars, and a big
 * shoot button instead of double-tap. Remembered on the device.
 */
const KEY = 'rtm-kid';

export const kidMode = {
  get on(): boolean {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  },
  set(on: boolean): void {
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      // Storage blocked: nothing to remember it in.
    }
  },
};

/** The first sentence of a text: "A purple light locks onto the car." */
export function oneLine(text: string): string {
  const m = text.match(/^.*?[.!?](?=\s|$)(["”’)]?)/);
  return (m ? m[0] : text).trim();
}

const ICONS: [RegExp, string][] = [
  [/shoot|fight|gun/i, '🔫'],
  [/ram|floor it|drive through/i, '💥'],
  [/catnip/i, '🌿'],
  [/fuel|gas/i, '⛽'],
  [/shell/i, '💥'],
  [/bullet|scrap for/i, '🔩'],
  [/patch|fix|repair/i, '🔧'],
  [/pay|toll|buy/i, '💵'],
  [/search/i, '🔍'],
  [/pick (them|her|him) up|let them in|ride/i, '🤝'],
  [/detour/i, '↪️'],
  [/ford|creek/i, '🌊'],
  [/rim/i, '🛞'],
  [/wave|goodbye/i, '👋'],
  [/no thanks|leave|keep driving|drive (past|on)/i, '🚗'],
];

/** A picture for a choice, from its words. */
export function choiceIcon(label: string): string {
  for (const [re, icon] of ICONS) if (re.test(label)) return icon;
  return '👉';
}

/**
 * At most `max` choices: the ones you can pick come first, in their order,
 * and the last choice (usually "no thanks" or "keep driving") always stays.
 */
export function kidChoices<T extends { enabled: boolean }>(choices: T[], max = 3): T[] {
  if (choices.length <= max) return choices;
  const last = choices[choices.length - 1];
  const rest = choices.slice(0, -1);
  const ordered = [...rest.filter((c) => c.enabled), ...rest.filter((c) => !c.enabled)];
  return [...ordered.slice(0, max - 1), last];
}
