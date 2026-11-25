/**
 * A log of map lookups (Overpass queries and saved street hits), kept on the
 * phone in localStorage so it survives reloads and trips. The 🛠 test panel
 * (?dev=1) shows it with Copy and Download buttons, so a slow or failing
 * lookup can be pasted into a bug report. Nothing is sent anywhere.
 */
export interface MapLogEntry {
  /** When the lookup started (ms since epoch). */
  at: number;
  /** What it was for: 'local streets', 'town', 'street names', 'landmarks'. */
  what: string;
  /** Rough place (2 decimals, about 1 km), when there is one. */
  near?: string;
  /** found / saved / none / failed / offline. */
  result: string;
  /** Whole lookup time (ms). */
  ms: number;
  /** Bytes received. */
  bytes?: number;
  /** One per server tried: "overpass-api.de ok 9.1s", "overpass.private.coffee busy 429 0.3s". */
  tries: string[];
  /** Anything else ("1,240 street pieces", "planning moved on at 20 s"). */
  note?: string;
}

const KEY = 'rtm-map-log';
export const MAP_LOG_MAX = 40;

let entries: MapLogEntry[] | null = null;

function load(): MapLogEntry[] {
  if (entries) return entries;
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    entries = Array.isArray(list) ? (list as MapLogEntry[]) : [];
  } catch {
    entries = [];
  }
  return entries;
}

/** Writes the log back (call after changing an entry returned by addMapLog). */
export function saveMapLog(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(load()));
  } catch {
    /* storage full or blocked: the log only lives until reload */
  }
}

/** Adds an entry (newest last), keeping the last MAP_LOG_MAX. Returns it so a caller can add a note. */
export function addMapLog(e: MapLogEntry): MapLogEntry {
  const list = load();
  list.push(e);
  list.splice(0, Math.max(0, list.length - MAP_LOG_MAX));
  saveMapLog();
  return e;
}

/** All entries, oldest first. */
export function mapLog(): MapLogEntry[] {
  return [...load()];
}

export function clearMapLog(): void {
  entries = [];
  saveMapLog();
}

/** Short server name: "https://overpass-api.de/api/interpreter" -> "overpass-api.de". */
export function serverName(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

const pad = (n: number) => String(n).padStart(2, '0');

/** One line per entry, for the panel, Copy and Download. */
export function formatMapLog(list: MapLogEntry[] = mapLog()): string {
  return list
    .map((e) => {
      const d = new Date(e.at);
      const when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      const parts = [when, e.what + (e.near ? ` @${e.near}` : ''), `${e.result} in ${secs(e.ms)}`];
      if (e.bytes) parts.push(`${Math.round(e.bytes / 1000).toLocaleString('en-US')} KB`);
      if (e.note) parts.push(e.note);
      if (e.tries.length) parts.push(`[${e.tries.join('; ')}]`);
      return parts.join(' | ');
    })
    .join('\n');
}
