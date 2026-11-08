/**
 * The public map servers the game talks to, in one place. The list ships
 * with the game and is refreshed from data/servers.json on the site when
 * the game starts, so a server can be swapped (if it shuts down, or asks
 * apps to move) with a commit instead of an app update. The Overpass
 * operators ask for exactly this.
 */
export interface Servers {
  /** Overpass API endpoints, tried in order: the main one first, then backups. */
  overpass: string[];
  /** Nominatim search endpoint. */
  nominatim: string;
}

export const DEFAULT_SERVERS: Servers = {
  overpass: ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'],
  nominatim: 'https://nominatim.openstreetmap.org/search',
};

let current: Servers = DEFAULT_SERVERS;
let loading: Promise<Servers> | null = null;

const isHttps = (u: unknown): u is string => typeof u === 'string' && /^https:\/\/[^\s]+$/.test(u);

/** Keeps only valid https addresses; anything missing falls back to the defaults. */
export function parseServers(json: unknown): Servers {
  const j = (json ?? {}) as Partial<Record<keyof Servers, unknown>>;
  const overpass = Array.isArray(j.overpass) ? j.overpass.filter(isHttps) : [];
  return {
    overpass: overpass.length ? overpass : DEFAULT_SERVERS.overpass,
    nominatim: isHttps(j.nominatim) ? j.nominatim : DEFAULT_SERVERS.nominatim,
  };
}

/** The servers to use now (the built-in list until the site's file has loaded). */
export function servers(): Servers {
  return current;
}

/** Loads data/servers.json from the site once (fresh when online). Never throws. */
export function loadServers(): Promise<Servers> {
  loading ??= (async () => {
    try {
      const url = new URL('data/servers.json', document.baseURI).href;
      const res = await fetch(url, { cache: 'no-cache' });
      if (res.ok) current = parseServers(await res.json());
    } catch {
      /* offline or missing: keep the built-in list */
    }
    return current;
  })();
  return loading;
}

/** For tests. */
export function setServers(s: Servers): void {
  current = s;
  loading = Promise.resolve(s);
}
