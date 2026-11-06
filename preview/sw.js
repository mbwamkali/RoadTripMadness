/* Road Trip Madness service worker. Generated at build time by vite.config.ts:
 * PRECACHE and VERSION are filled in with the built files. */
const VERSION = '7e1b1e70d93c';
const PRECACHE = ["./","./assets/index-BW0SWYZ4.css","./assets/index-E-WRJoBu.js","./assets/bloom-iGlLe3qN.js","./assets/GLTFLoader-Crff6KlS.js","./assets/SkeletonUtils-CuRFEry0.js","./data/atlas-us.json","./data/routes/coast-to-coast.json","./data/routes/overseas-highway.json","./data/routes/pacific-coast.json","./data/routes/route-66.json","./data/routes/vegas-run.json","./data/states-us.json","./icons/icon-192.png","./icons/icon-512.png","./icons/icon.svg","./manifest.webmanifest","./models/bush-1.glb","./models/bush-2.glb","./models/cactus-1.glb","./models/cactus-2.glb","./models/cactus-3.glb","./models/car-cop.glb","./models/car-hatch.glb","./models/car-sedan.glb","./models/car-sports.glb","./models/car-suv.glb","./models/car-taxi.glb","./models/corn.glb","./models/flat-1.glb","./models/flat-2.glb","./models/grass.glb","./models/hospital.glb","./models/house-1.glb","./models/house-2.glb","./models/house-3.glb","./models/house-4.glb","./models/house-5.glb","./models/oak-1.glb","./models/oak-2.glb","./models/oak-3.glb","./models/palm-1.glb","./models/palm-2.glb","./models/pine-1.glb","./models/pine-2.glb","./models/rock-1.glb","./models/rock-2.glb","./models/rock-3.glb","./models/shop.glb","./models/tree-dead.glb","./models/wheat.glb","./models/zombie.glb","./textures/asphalt.jpg","./textures/asphalt_n.jpg","./textures/gravel.jpg","./textures/ground.jpg","./textures/ground_n.jpg"];
// The side-branch preview lives under /preview/ on the same site. Each build keeps
// to its own caches, and the live game's worker leaves preview pages alone.
const IS_PREVIEW = self.location.pathname.includes('/preview/');
const PREFIX = IS_PREVIEW ? 'rtm-preview-' : 'rtm-';
const CACHE = `${PREFIX}${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith(PREFIX) && k !== CACHE && (IS_PREVIEW || !k.startsWith('rtm-preview-')))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Map services (search, routing, landmarks) are never cached here: the game
  // saves the trips it plans itself, and falls back to the offline atlas.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!IS_PREVIEW && url.pathname.includes('/preview/')) return;

  // Road files (data/osm/) live in their own cache that survives app updates,
  // since the backbone alone is about 10 MB. The index is network first; the
  // other files carry the road build date (?v=...) and are cache first, and a
  // new build's index clears out files from older builds.
  if (url.pathname.includes('/data/osm/')) {
    event.respondWith(roadFile(req, url));
    return;
  }

  if (req.mode === 'navigate') {
    // Network first for the page, so updates arrive; the cached copy when offline.
    event.respondWith(
      // no-cache: always ask the server, so the browser's own cache can't hand back an old page.
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./', copy));
          return res;
        })
        .catch(() => caches.match('./', { ignoreSearch: true })),
    );
    return;
  }

  // Built files have hashed names and data files change only with a new build, so cache first.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

const ROADS = 'roads-osm';

async function roadFile(req, url) {
  const cache = await caches.open(ROADS);
  if (url.pathname.endsWith('/index.json')) {
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) {
        const index = await res.clone().json();
        await cache.put(req, res.clone());
        const v = encodeURIComponent(index.built);
        for (const old of await cache.keys()) {
          const p = new URL(old.url).searchParams.get('v');
          if (p !== null && p !== v && p !== index.built) await cache.delete(old);
        }
      }
      return res;
    } catch (e) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      throw e;
    }
  }
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && url.searchParams.has('v')) await cache.put(req, res.clone());
  return res;
}
