# Architecture

The game is a static web app: TypeScript, [Three.js](https://threejs.org/) for 3D, and [Vite](https://vitejs.dev/) for builds. It runs in any modern mobile browser, can be added to a home screen, and can later be wrapped as an iOS/Android app with Capacitor without a rewrite.

```
src/
  main.ts              App flow: screens, HUDs, switching between scenes
  style.css            Touch-first UI styles (portrait and landscape)
  geo/
    geo.ts             Lat/lng math, local projection, polyline resampling, Path lookups
    geocode.ts         Place search (Nominatim) and device location
    osrm.ts            Route request and parsing (OSRM)
    route.ts           Turns a real route into game geometry (scale, smooth, place steps)
    demoRoute.ts       Offline made-up route
    overpass.ts        Real landmarks near the route (Overpass API)
  game/                Rules, no rendering. Covered by tests.
    state.ts           Game state, fuel, travel, shops, scavenging, saving
    stops.ts           Where the turn-offs are and what's at them
    combat.ts          Enemies, bosses, weapons, horn, boost, outcomes
    landmarks.ts       Placing real and made-up sights along the road
    upgrades.ts        Car upgrade levels and their effects
    events.ts          Road events and crew members
    time.ts            Clock, day/night and weather
    difficulty.ts      Difficulty settings
    scores.ts          Score and the local high-score table
    rng.ts             Seeded random numbers, so runs are reproducible
  scenes/
    DriveScene.ts      On-rails driving view; streams road and scenery in chunks
    CombatScene.ts     Action view; enemy models, tap-to-target, effects
    common.ts          Car model, road texture, signs, helpers
    landmarkModels.ts  3D models for landmarks
    atmosphere.ts      Sky, fog, sun, headlights, stars, weather particles
  audio/
    sound.ts           Synthesized sound effects and radio
  ui/
    dom.ts, minimap.ts Small DOM helpers and the route minimap
    townMap.ts         Top-down map of a stop
tests/                 Vitest unit tests for geo and game rules
```

## Key ideas

- **Rules are separate from rendering.** Everything in `src/game` is plain TypeScript that can be stepped in tests. The scenes read state and draw it.
- **Route scaling.** `buildRouteData` projects the route to metres, scales it to a playable length, smooths corners and resamples it every 4 units. `Path` gives position and heading at any distance with a binary search.
- **World streaming.** The driving view only builds road and scenery for about 1.7 km around the car, in 400-unit chunks with instanced meshes, which keeps phones fast on long trips.
- **Saving.** The game autosaves to `localStorage` every few seconds and on every stop, and the title screen offers to continue.

## Running it

```
npm install
npm run dev       # dev server, open the printed URL on your phone (same Wi-Fi)
npm test          # unit tests
npm run build     # production build in dist/
```
