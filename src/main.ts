import * as THREE from 'three';
import './style.css';
import type { Path } from './geo/geo';
import { currentPosition, type Place } from './geo/geocode';
import { ANNOUNCED, LANDMARK_ICONS, LANDMARK_TITLES, readMoreUrl, roadAt, type Landmark } from './game/landmarks';
import { demoRawRoute } from './geo/demoRoute';
import type { ObstacleKind } from './game/obstacles';
import { loadModels, modelsReady, modelsWanted } from './scenes/models';
import { canUseBike, planBikeRide, rideForGas } from './game/rescue';
import { loadRide, RIDE_IDS, RIDES, rideOf, saveRide, type Ride } from './game/rides';
import { addStateLines, buildRouteData, pathFromRoute, realKmAt, type RawRoute, type RouteData } from './geo/route';
import { latLngAt, loadStateMap } from './geo/states';
import { overpassStreets } from './geo/streets';
import { fetchLiveConditions, liveEnabled, setLiveEnabled, type LiveConditions } from './geo/liveWeather';
import { isOffline, planTrip, searchAnywhere } from './offline/planner';
import { tripCache } from './offline/tripCache';
import { registerServiceWorker } from './offline/registerSw';
import { showClassics, showSavedTrips } from './ui/tripScreens';
import {
  buyFuel,
  clearSave,
  FUEL_PRICE,
  loadGame,
  maxHealth,
  buyUpgrade,
  newGame,
  PLACE_TITLES,
  repair,
  repairCost,
  saveGame,
  search,
  tankSize,
  type ActionResult,
  type GameState,
} from './game/state';
import { STOP_TITLES, type PlaceKind, type Stop } from './game/stops';
import { BOOST_FUEL, BOSS_INFO, boost, createCombat, ENEMY_STATS, horn, WEAPONS, type BossKind, type CombatState, type EnemyType, type WeaponKind } from './game/combat';
import { DIFFICULTIES, DIFFICULTY_IDS, type Difficulty } from './game/difficulty';
import { addScore, loadScores, scoreFor, type ScoreEntry } from './game/scores';
import { CREW, rollEvent, type RoadEvent } from './game/events';
import { clockText, hourOf, isNight, nightDanger, weatherAt, WEATHER_INFO, type Weather } from './game/time';
import type { GameScene } from './scenes/common';
import { DriveScene } from './scenes/DriveScene';
import { CombatScene } from './scenes/CombatScene';
import { clearUi, fmtKm, h, ui } from './ui/dom';
import { Minimap } from './ui/minimap';
import { PLACE_ICONS, TownMap } from './ui/townMap';
import { gunDamageFor, MAX_LEVEL, ramDamageFor, upgradeCost, UPGRADES, type UpgradeKind } from './game/upgrades';
import { sound } from './audio/sound';
import { loadQualityChoice, nextQualityChoice, quality, QUALITY_NAMES, resolveQuality, saveQualityChoice } from './scenes/quality';
import type { Bloom } from './scenes/bloom';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
let bloom: Bloom | null = null;

/** Applies the graphics quality to the renderer (scenes read it when they're built). */
function applyQuality(): void {
  const q = quality.profile;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
  renderer.shadowMap.enabled = q.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (q.bloom && !bloom) {
    void import('./scenes/bloom').then((m) => {
      if (!quality.profile.bloom || bloom) return;
      bloom = new m.Bloom(renderer);
      resize();
    });
  } else if (!q.bloom && bloom) {
    bloom.dispose();
    bloom = null;
  }
}
applyQuality();
// State outlines for state-line signs and exit numbers (small, cached offline).
void loadStateMap();
void loadModels();

let active: GameScene | null = null;
let state: GameState | null = null;
let path: Path | null = null;
let drive: DriveScene | null = null;
let combat: CombatScene | null = null;
let hudTick: (() => void) | null = null;
let lastSave = 0;

// --------------------------------------------------------------- render loop

function resize(): void {
  const w = window.innerWidth;
  const hgt = window.innerHeight;
  renderer.setSize(w, hgt, false);
  bloom?.setSize(w, hgt, renderer.getPixelRatio());
  canvas.style.width = `${w}px`;
  canvas.style.height = `${hgt}px`;
  active?.resize(w, hgt);
}
window.addEventListener('resize', resize);

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (active) {
    active.update(dt);
    if (bloom) bloom.render(active.scene, active.camera);
    else renderer.render(active.scene, active.camera);
  } else {
    renderer.setClearColor(0x1b1410);
    renderer.clear();
  }
  if (state && state.status === 'driving' && now - lastSave > 3000) {
    saveGame(state);
    lastSave = now;
  }
  requestAnimationFrame(frame);
}

function setScene(scene: GameScene | null): void {
  active = scene;
  resize();
}

// --------------------------------------------------------------- title & setup

function showTitle(): void {
  sound.stopMusic();
  sound.engine(0);
  setScene(null);
  disposeAll();
  clearUi();
  const saved = loadGame();
  const savedTrips = tripCache.list().length;
  const pick = (raw: RawRoute) => previewRoute(buildRouteData(raw), undefined, showTitle);
  ui().append(
    h(
      'div',
      { class: 'screen title' },
      h('h1', {}, 'Road Trip ', h('span', {}, 'Madness')),
      h('p', { class: 'tag' }, 'Real roads. Zombies, outlaws and alien cats. Keep your tank full.'),
      saved && h('button', { class: 'btn primary', onclick: () => startTrip(saved) }, `Continue to ${saved.route.endLabel.split(',')[0]}`),
      h('button', { class: `btn ${saved ? '' : 'primary'}`, onclick: showSetup }, 'Plan a new trip'),
      h('button', { class: 'btn', onclick: () => showClassics(pick, showTitle) }, 'Classic road trips'),
      savedTrips > 0 && h('button', { class: 'btn', onclick: () => showSavedTrips(pick, showTitle) }, `Saved trips (${savedTrips})`),
      h('button', { class: 'btn', onclick: () => previewRoute(buildRouteData(demoRawRoute(Date.now() % 1000)), undefined, showTitle) }, 'Quick demo trip (made-up map)'),
      h('button', { class: 'btn ghost', onclick: showScores }, '🏆 High scores'),
      isOffline() && h('div', { class: 'offline-badge' }, 'Offline: classic, saved and atlas trips still work'),
      h(
        'p',
        { class: 'fine' },
        'Maps © ',
        h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' }, 'OpenStreetMap'),
        ' contributors (ODbL). Offline atlas from Natural Earth.',
      ),
    ),
  );
}

function scoreTable(list: ScoreEntry[], highlight = -1): HTMLElement {
  if (!list.length) return h('p', { class: 'muted' }, 'No trips finished yet. Get out there!');
  return h(
    'ol',
    { class: 'scores' },
    ...list.map((e, i) =>
      h(
        'li',
        { class: i === highlight ? 'new' : '' },
        h('b', {}, e.score.toLocaleString()),
        h('span', { class: 'who' }, `${e.won ? '🏁' : '💥'} ${e.route}`),
        h('span', { class: 'diff' }, `${DIFFICULTIES[e.difficulty]?.icon ?? ''} ${e.date}`),
      ),
    ),
  );
}

function showScores(): void {
  clearUi();
  ui().append(
    h(
      'div',
      { class: 'screen scores-screen' },
      h('h2', {}, '🏆 High scores'),
      scoreTable(loadScores()),
      h('button', { class: 'btn ghost', onclick: showTitle }, '← Back'),
    ),
  );
}

function loadDifficulty(): Difficulty {
  try {
    const d = localStorage.getItem('rtm-difficulty') as Difficulty | null;
    return d && d in DIFFICULTIES ? d : 'normal';
  } catch {
    return 'normal';
  }
}

function placePicker(label: string, onPick: (p: Place | null) => void, withGps: boolean): HTMLElement {
  const input = h('input', { type: 'search', placeholder: 'City, address or landmark', enterkeyhint: 'search', autocomplete: 'off' });
  const results = h('div', { class: 'results' });
  const chosen = h('div', { class: 'chosen' });
  const status = (msg: string) => results.replaceChildren(h('div', { class: 'muted' }, msg));
  const choose = (p: Place) => {
    chosen.textContent = `✓ ${p.label}`;
    input.value = p.label;
    results.replaceChildren();
    onPick(p);
  };
  const run = async () => {
    onPick(null);
    chosen.textContent = '';
    status('Searching…');
    try {
      const { places: found, offline } = await searchAnywhere(input.value);
      if (!found.length) return status(offline ? 'Offline, so only cities and parks in the built-in US atlas can be found. Try a bigger nearby city.' : 'No places found. Try adding a state or country.');
      results.replaceChildren(
        ...(offline ? [h('div', { class: 'muted' }, 'Offline: showing places from the built-in US atlas.')] : []),
        ...found.map((p) => h('button', { class: 'result', onclick: () => choose(p) }, p.label)),
      );
    } catch (e) {
      status(`${(e as Error).message} Check your connection, or try a classic road trip.`);
    }
  };
  input.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') run();
  });
  return h(
    'div',
    { class: 'picker' },
    h('label', {}, label),
    h(
      'div',
      { class: 'row' },
      input,
      h('button', { class: 'btn small', onclick: run }, 'Search'),
      withGps &&
        h(
          'button',
          {
            class: 'btn small',
            title: 'Use my location',
            onclick: async () => {
              status('Finding you…');
              try {
                choose(await currentPosition());
              } catch (e) {
                status((e as Error).message);
              }
            },
          },
          '📍',
        ),
    ),
    chosen,
    results,
  );
}

function showSetup(): void {
  clearUi();
  let from: Place | null = null;
  let to: Place | null = null;
  const err = h('div', { class: 'error' });
  const go = h('button', { class: 'btn primary', disabled: true }, 'Plan the route');
  const refresh = () => {
    go.disabled = !(from && to);
  };
  go.addEventListener('click', async () => {
    if (!from || !to) return;
    go.disabled = true;
    go.textContent = 'Finding the fastest road…';
    err.replaceChildren();
    try {
      const { raw, note } = await planTrip(from, to, (msg) => (go.textContent = msg));
      previewRoute(buildRouteData(raw), note);
    } catch (e) {
      err.replaceChildren(
        h('p', {}, `Couldn't plan that route: ${(e as Error).message}`),
        h('button', { class: 'btn small', onclick: () => previewRoute(buildRouteData(demoRawRoute())) }, 'Play the offline demo instead'),
      );
      go.textContent = 'Plan the route';
      refresh();
    }
  });
  ui().append(
    h(
      'div',
      { class: 'screen setup' },
      h('h2', {}, 'Where are you headed?'),
      placePicker('Start', (p) => ((from = p), refresh()), true),
      placePicker('Destination', (p) => ((to = p), refresh()), false),
      go,
      err,
      h('button', { class: 'btn ghost', onclick: showTitle }, '← Back'),
    ),
  );
}

function previewRoute(route: RouteData, note?: string, back: () => void = showSetup): void {
  clearUi();
  addStateLines(route);
  const s = newGame(route);
  let difficulty = loadDifficulty();
  const diffBtns = DIFFICULTY_IDS.map((d) =>
    h(
      'button',
      {
        class: 'btn diff',
        onclick: () => {
          difficulty = d;
          try {
            localStorage.setItem('rtm-difficulty', d);
          } catch {
            /* ignore */
          }
          syncDiff();
        },
      },
      h('b', {}, `${DIFFICULTIES[d].icon} ${DIFFICULTIES[d].name}`),
      h('span', {}, DIFFICULTIES[d].blurb),
    ),
  );
  const syncDiff = () => diffBtns.forEach((b, i) => b.classList.toggle('selected', DIFFICULTY_IDS[i] === difficulty));
  syncDiff();
  let ride: Ride = loadRide();
  const rideBtns = RIDE_IDS.map((r) =>
    h(
      'button',
      {
        class: 'btn ride',
        onclick: () => {
          ride = r;
          saveRide(r);
          syncRide();
        },
      },
      h('span', { class: 'icon' }, RIDES[r].icon),
      h('b', {}, RIDES[r].name),
    ),
  );
  const rideBlurb = h('p', { class: 'ride-blurb muted' }, '');
  const syncRide = () => {
    rideBtns.forEach((b, i) => b.classList.toggle('selected', RIDE_IDS[i] === ride));
    rideBlurb.textContent = RIDES[ride].blurb;
  };
  syncRide();
  const p = pathFromRoute(route);
  // Real weather along the route and the real time at the start (Open-Meteo).
  let live: Promise<LiveConditions | null> | null = null;
  const liveLi = h('li', {});
  const liveBtn = h('button', { class: 'btn small ghost' }, '');
  const lookUpLive = () => {
    const on = liveEnabled();
    liveBtn.textContent = `Real weather and time: ${on ? 'on' : 'off'}`;
    if (!on) {
      live = null;
      liveLi.textContent = 'The clock starts at 8 AM and the weather follows the climate.';
      return;
    }
    liveLi.textContent = 'Looking up the real weather along the way…';
    const mine = (live = fetchLiveConditions(route, p));
    void mine.then((c) => {
      if (live !== mine) return;
      liveLi.textContent = c ? describeLive(c) : "Couldn't get the real weather, so it follows the climate instead.";
    });
  };
  liveBtn.addEventListener('click', () => {
    setLiveEnabled(!liveEnabled());
    lookUpLive();
  });
  const realMap = route.source !== 'demo';
  if (realMap) lookUpLive();
  // Real street names at the turn-offs (the stops are the same for the same seed).
  const streets = realMap
    ? overpassStreets
        .streetsNear(
          s.stops.map((st) => latLngAt(route, p, st.at)),
          s.stops.map((st) => roadAt(route, st.at)),
        )
        .then((names) => new Map(s.stops.map((st, i) => [st.id, names[i]] as const)))
        .catch(() => null)
    : null;
  const go = () => {
    const g = newGame(route, s.seed, difficulty, ride);
    startTrip(g);
    void streets?.then((names) => {
      if (!names || state !== g) return;
      for (const st of g.stops) {
        const n = names.get(st.id);
        if (n) st.street = n;
      }
    });
    void live?.then((c) => {
      if (!c || state !== g) return;
      // Too late to reset the clock once the car is moving; the weather still blends in.
      g.live = g.distance > 50 ? { weather: c.weather } : c;
    });
  };
  const map = new Minimap(p, s.stops, 220);
  map.draw(0, []);
  const km = route.realMeters / 1000;
  const hours = route.realSeconds / 3600;
  ui().append(
    h(
      'div',
      { class: 'screen preview' },
      h('h2', {}, `${route.startLabel.split(',')[0]} → ${route.endLabel.split(',')[0]}`),
      map.canvas,
      h(
        'ul',
        { class: 'facts' },
        h('li', {}, `${fmtKm(km)} of road (${hours.toFixed(1)} h by the map)`),
        h('li', {}, `${s.stops.length} places to turn off for fuel and supplies`),
        (route.landmarks?.length ?? 0) > 0 &&
          h('li', {}, `${route.landmarks!.length} real sights to pass, like ${[...new Set(route.landmarks!.map((l) => l.name))].slice(0, 3).join(', ')}`),
        (route.fuel?.length ?? 0) > 0 && h('li', {}, `Fuel stops are real gas stations from the map (${route.fuel!.length} along the way)`),
        (route.states?.length ?? 0) > 1 && h('li', {}, `Crosses ${route.states!.length} states: ${route.states!.map((st) => st.code).join(' → ')}`),
        realMap && liveLi,
        h('li', {}, 'Green dots have gas pumps. Your tank lasts about a third of the trip.'),
        h('li', {}, 'Something big is waiting halfway, and another at the end of the road.'),
      ),
      note && h('p', { class: 'note' }, note),
      h('div', { class: 'difficulty' }, ...diffBtns),
      h('div', { class: 'rides' }, ...rideBtns),
      rideBlurb,
      h('button', { class: 'btn primary', onclick: go }, 'Hit the road'),
      realMap && liveBtn,
      h('button', { class: 'btn ghost', onclick: back }, back === showSetup ? '← Pick different places' : '← Back'),
      h('p', { class: 'fine' }, route.attribution, realMap ? ' Weather data by Open-Meteo.com.' : ''),
    ),
  );
}

/** "It's 9:45 PM at the start. Right now: rain, then clear." */
function describeLive(c: LiveConditions): string {
  const kinds: Weather[] = [];
  for (const p of c.weather) if (kinds[kinds.length - 1] !== p.w) kinds.push(p.w);
  const wx = kinds
    .slice(0, 4)
    .map((k) => `${WEATHER_INFO[k].icon} ${WEATHER_INFO[k].name.toLowerCase()}`)
    .join(', then ') + (kinds.length > 4 ? ' and more' : '');
  const time = c.startHour !== undefined ? `It's ${clockText(c.startHour)} at the start. ` : '';
  return `${time}Real weather right now: ${wx}.`;
}

// --------------------------------------------------------------- driving

function disposeAll(): void {
  drive?.dispose();
  combat?.dispose();
  drive = null;
  combat = null;
  hudTick = null;
}

function startTrip(s: GameState): void {
  // The CC0 models load in the background at startup; wait for them on the
  // rare first trip that starts before they arrive (they never block on Low).
  if (modelsWanted() && !modelsReady()) {
    void loadModels().then(() => startTripNow(s));
    return;
  }
  startTripNow(s);
}

function startTripNow(s: GameState): void {
  disposeAll();
  state = s;
  path = pathFromRoute(s.route);
  saveGame(s);
  drive = new DriveScene(s, path, {
    onEncounter: () => startCombat(false),
    onArrive: () => setTimeout(showEnd, 600),
    onOutOfFuel: () => setTimeout(() => (state?.status === 'lost' ? showEnd() : showBikeRescue()), 600),
    onPrompt: (stop, dist) => updatePrompt(stop, dist),
    onEnterStop: (stop) => showStop(stop),
    onLandmark: (l) => showLandmarkToast(l),
    onBiome: (icon, name) => showToast(icon, 'Now entering', name),
    onRoadEvent: () => showRoadEvent(rollEvent(s)),
    onBoss: (boss) => showBossIntro(boss),
    onTick: () => hudTick?.(),
    onRam: (kind, cost) => {
      const what = { debris: 'You plough through the junk', zombie: 'Splat! You run down a zombie', wreck: 'You shove a wreck aside', roadblock: 'You smash through the roadblock' }[kind];
      showToast(kind === 'zombie' ? '🧟' : '💥', what, cost ? `−${cost} car health` : 'The ram plate takes it');
      if (cost) navigator.vibrate?.(cost > 8 ? 120 : 50);
      if (state?.status === 'lost' && drive) {
        drive.paused = true;
        setTimeout(showEnd, 900);
      }
    },
    onCrash: (kind, dmg) => {
      const what = { car: 'a car', pickup: 'a pickup', van: 'a van', truck: 'a big rig' }[kind];
      showToast('💥', `You hit ${what}`, `−${dmg} car health`);
      navigator.vibrate?.(120);
      if (state?.status === 'lost' && drive) {
        drive.paused = true;
        setTimeout(showEnd, 900);
      }
    },
  });
  setScene(drive);
  showDriveHud();
  sound.startMusic();
}

let promptEl: HTMLElement | null = null;
let promptFor: string | null = null;

function updatePrompt(stop: Stop | null, dist: number): void {
  if (!promptEl) return;
  if (!stop) {
    promptEl.replaceChildren();
    promptEl.classList.remove('show', 'signalling');
    promptFor = null;
    return;
  }
  const meters = Math.max(0, Math.round(realKmAt(state!.route, dist) * 1000));
  const distText = meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
  const distEl = promptEl.querySelector('.dist');
  if (drive?.signalling === stop) {
    if (!promptEl.classList.contains('signalling')) renderSignalling(stop);
    const d = promptEl.querySelector('.dist');
    if (d) d.textContent = `in ${distText}`;
    return;
  }
  promptEl.classList.remove('signalling');
  if (promptFor === stop.id && distEl) {
    distEl.textContent = `in ${distText}`;
    return;
  }
  promptFor = stop.id;
  const right = stop.side === 'right';
  promptEl.classList.add('show');
  promptEl.replaceChildren(
    h(
      'div',
      { class: 'prompt-text' },
      h('strong', {}, `${stop.exit ? `Exit ${stop.exit} · ` : ''}${STOP_TITLES[stop.kind]} · ${stop.name}`),
      h('span', {}, ` on the ${stop.side} `),
      h('span', { class: 'dist' }, `in ${distText}`),
      stop.street && h('div', { class: 'muted' }, `Turn onto ${stop.street}`),
      h('div', { class: 'muted' }, stop.places.map((p) => PLACE_TITLES[p]).join(' · ')),
    ),
    h(
      'div',
      { class: 'row' },
      !right && h('button', { class: 'btn turn', onclick: () => chooseTurn(stop) }, '◀ Turn left'),
      h('button', { class: 'btn ghost', onclick: () => drive?.skipStop(stop) }, 'Keep driving'),
      right && h('button', { class: 'btn turn', onclick: () => chooseTurn(stop) }, stop.exit ? 'Take the exit ▶' : 'Turn right ▶'),
    ),
  );
}

function chooseTurn(stop: Stop): void {
  drive?.takeTurn(stop);
  navigator.vibrate?.(40);
  renderSignalling(stop);
}

/** Replaces the turn buttons with a blinking indicator so it's obvious the tap registered. */
function renderSignalling(stop: Stop): void {
  if (!promptEl) return;
  const left = stop.side === 'left';
  promptEl.classList.add('signalling');
  promptEl.replaceChildren(
    h(
      'div',
      { class: `signal ${left ? 'left' : 'right'}` },
      left && h('span', { class: 'arrow' }, '◀'),
      h('div', { class: 'signal-text' }, h('strong', {}, `Turning ${stop.side}`), h('span', { class: 'muted' }, ` into ${stop.name} `), h('span', { class: 'dist' }, '')),
      !left && h('span', { class: 'arrow' }, '▶'),
    ),
    h(
      'button',
      {
        class: 'btn ghost small',
        onclick: () => {
          drive?.cancelTurn();
          promptEl?.classList.remove('signalling');
          promptFor = null;
        },
      },
      'Cancel',
    ),
  );
}

let toastTimer = 0;
/** The state a spot on the route is in, for Wikipedia searches ("Barstow, California"). */
function stateNameAt(at: number): string | undefined {
  return state?.route.states?.filter((st) => st.at <= at).pop()?.name;
}

/** Where to read about a sight; nothing for the made-up demo map. */
function linkFor(l: Landmark): string | null {
  return state?.route.source === 'demo' ? null : readMoreUrl(l, stateNameAt(l.at));
}

function showLandmarkToast(l: Landmark): void {
  const link = linkFor(l);
  if (l.kind === 'stateline') return showToast(LANDMARK_ICONS[l.kind], 'Now entering', l.name, link);
  const verb = l.kind === 'river' ? 'Crossing' : l.kind === 'citysign' ? '' : 'Passing';
  showToast(LANDMARK_ICONS[l.kind], verb ? `${verb} · ${LANDMARK_TITLES[l.kind]}` : LANDMARK_TITLES[l.kind], l.name, link);
}

function showToast(icon: string, small: string, big: string, link?: string | null): void {
  const el = document.querySelector('.landmark-toast') as HTMLElement | null;
  if (!el) return;
  el.replaceChildren(h('span', { class: 'icon' }, icon), h('div', {}, h('small', {}, small), h('strong', {}, big), link && h('span', { class: 'more' }, 'Tap to read about it ↗')));
  el.onclick = link ? () => window.open(link, '_blank', 'noopener') : null;
  el.classList.toggle('linked', !!link);
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), link ? 5000 : 3500);
}

/** Real sights already passed, newest first, with somewhere to read about each. */
function sightsPassed(): HTMLElement | null {
  const s = state;
  if (!s || s.route.source === 'demo') return null;
  const seen = s.landmarks.filter((l) => l.real && l.at <= s.distance && ANNOUNCED.has(l.kind) && !/^(Leaving|Welcome to) /.test(l.name)).slice(-6).reverse();
  if (!seen.length) return null;
  return h(
    'div',
    { class: 'sights' },
    h('h3', {}, 'Sights you passed'),
    ...seen.map((l) => {
      const url = linkFor(l);
      return h('a', { href: url ?? '#', target: '_blank', rel: 'noopener' }, `${LANDMARK_ICONS[l.kind]} ${l.name}`);
    }),
  );
}

function bar(cls: string, label: string): { el: HTMLElement; set: (v: number, max: number, text?: string) => void } {
  const fill = h('div', { class: 'fill' });
  const txt = h('span', {});
  const el = h('div', { class: `bar ${cls}` }, h('b', {}, label), h('div', { class: 'track' }, fill), txt);
  return {
    el,
    set(v, max, text) {
      const pct = Math.max(0, Math.min(1, v / max));
      fill.style.width = `${pct * 100}%`;
      el.classList.toggle('low', pct < 0.25);
      txt.textContent = text ?? `${Math.round(v)}`;
    },
  };
}

function inventoryLine(s: GameState): HTMLElement {
  const i = s.inv;
  return h(
    'div',
    { class: 'inv' },
    h('span', { title: 'Cash' }, `💵 ${Math.floor(i.cash)}`),
    h('span', { title: 'Scrap' }, `🔩 ${Math.floor(i.scrap)}`),
    h('span', { title: 'Bullets' }, `🔫 ${i.bullets}`),
    h('span', { title: 'Shotgun shells' }, `💥 ${i.shells}`),
    h('span', { title: 'Catnip bombs' }, `🌿 ${i.catnip}`),
    ...s.crew.map((c) => h('span', { title: `${CREW[c].name}: ${CREW[c].perk}` }, CREW[c].icon)),
  );
}

function showDriveHud(): void {
  clearUi();
  const s = state!;
  const p = path!;
  const fuel = bar('fuel', '⛽');
  const hp = bar('hp', '🔧');
  const inv = h('div', {});
  const progress = h('div', { class: 'progress' }, h('div', { class: 'fill' }));
  const progressText = h('div', { class: 'progress-text' });
  const map = new Minimap(p, s.stops, 110);
  const speedBtn = h('button', { class: 'btn small round', title: 'Fast forward' }, '▶');
  speedBtn.addEventListener('click', () => {
    drive!.warp = drive!.warp === 1 ? 3 : 1;
    speedBtn.textContent = drive!.warp === 1 ? '▶' : '▶▶';
  });
  const menuBtn = h('button', { class: 'btn small round', title: 'Menu' }, '☰');
  const stationName = () => ({ off: 'Radio off', twang: 'KTWG Country', synth: 'Neon FM' })[sound.station];
  const radioBtn = h('button', { class: `btn small round ${sound.station === 'off' ? 'off' : ''}`, title: stationName() }, '📻');
  radioBtn.addEventListener('click', () => {
    sound.nextStation();
    radioBtn.classList.toggle('off', sound.station === 'off');
    radioBtn.title = stationName();
    showToast('📻', 'Car radio', stationName());
  });
  menuBtn.addEventListener('click', () => showPauseMenu());
  // Driving: change lanes and pick your speed.
  const pad = (label: string, title: string, fn: () => void) => {
    const b = h('button', { class: 'btn pad', title }, label);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      fn();
    });
    return b;
  };
  const speedText = h('span', { class: 'speed' }, '');
  const controls = h(
    'div',
    { class: 'drive-pad' },
    pad('◀', 'Change lane left', () => drive?.steer(-1)),
    h('div', { class: 'speed-ctl' }, pad('−', 'Slow down', () => drive?.pedal(-1)), speedText, pad('+', 'Speed up', () => drive?.pedal(1))),
    pad('▶', 'Change lane right', () => drive?.steer(1)),
  );
  // Shows up when something is in the road ahead of you.
  const shootBtn = pad('🔫', 'Shoot what is ahead', () => shootAhead());
  shootBtn.classList.add('shoot');
  const shootRow = h('div', { class: 'shoot-row' }, shootBtn);
  promptEl = h('div', { class: 'prompt' });
  promptFor = null;
  ui().append(
    h(
      'div',
      { class: 'hud' },
      h('div', { class: 'landmark-toast' }),
      h('div', { class: 'hud-top' }, h('div', { class: 'stats' }, fuel.el, hp.el, inv), h('div', { class: 'side' }, map.canvas, h('div', { class: 'row' }, radioBtn, speedBtn, menuBtn))),
      h('div', { class: 'hud-bottom' }, promptEl, shootRow, controls, progress, progressText),
    ),
  );
  let lastInv = '';
  let frameCount = 0;
  hudTick = () => {
    fuel.set(s.inv.fuel, tankSize(s));
    hp.set(s.health, maxHealth(s));
    const key = JSON.stringify(s.inv) + s.crew.join();
    if (key !== lastInv) {
      inv.replaceChildren(inventoryLine(s));
      lastInv = key;
    }
    (progress.firstChild as HTMLElement).style.width = `${(s.distance / p.length) * 100}%`;
    const left = realKmAt(s.route, p.length - s.distance);
    const hour = hourOf(s);
    const wx = weatherAt(s);
    const road = roadAt(s.route, s.distance);
    progressText.textContent = `${isNight(hour) ? '🌙' : '☀️'} ${clockText(hour)} · ${wx === 'clear' ? '' : `${WEATHER_INFO[wx].icon} ${WEATHER_INFO[wx].name} · `}${road ? `${road} · ` : ''}${drive ? `${drive.speedLimit()} mph · ` : ''}${fmtKm(left)} to ${s.route.endLabel.split(',')[0]}`;
    if (frameCount++ % 10 === 0) map.draw(s.distance, s.passed);
    if (drive) {
      const mph = Math.round(drive.speedLimit() * drive.throttle);
      speedText.textContent = `${mph} mph`;
      speedText.classList.toggle('fast', drive.throttle > 1);
      controls.classList.toggle('wrong-side', drive.wrongSide);
      const t = drive.target;
      shootRow.classList.toggle('show', !!t);
      if (t) {
        const label = `🔫 ${OBSTACLE_LABEL[t.kind]}`;
        if (shootBtn.textContent !== label) shootBtn.textContent = label;
      }
    }
  };
  hudTick();
}

const OBSTACLE_LABEL: Record<ObstacleKind, string> = { debris: 'Junk', zombie: 'Zombie', wreck: 'Wreck', roadblock: 'Roadblock' };

/** Fires at whatever is in the road ahead in your lane. */
function shootAhead(): void {
  const r = drive?.shoot();
  if (r === 'empty') showToast('🔫', 'Out of ammo', 'Dodge it or ram it');
  else if (r?.destroyed && r.scrap) showToast('💥', `${OBSTACLE_LABEL[r.kind]} cleared`, `+${r.scrap} scrap`);
}

function showPauseMenu(): void {
  if (!drive) return;
  drive.paused = true;
  const startLevel = quality.level;
  const close = () => {
    overlay.remove();
    drive!.paused = false;
    // Shadows, draw distance and scenery are built with the scene, so rebuild it.
    if (quality.level !== startLevel && state) startTrip(state);
  };
  const qualityText = () => {
    const c = loadQualityChoice();
    return `Graphics: ${QUALITY_NAMES[c]}${c === 'auto' ? ` (${QUALITY_NAMES[quality.level]})` : ''}`;
  };
  const overlay = h(
    'div',
    { class: 'modal' },
    h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Paused'),
      h('p', {}, `Encounters survived: ${state!.encounters} · Kills: ${state!.kills}`),
      sightsPassed(),
      h('button', { class: 'btn primary', onclick: close }, 'Keep driving'),
      h(
        'button',
        {
          class: 'btn',
          onclick: (e: Event) => {
            sound.setSfx(!sound.settings.sfx);
            (e.currentTarget as HTMLElement).textContent = `Sound effects: ${sound.settings.sfx ? 'on' : 'off'}`;
          },
        },
        `Sound effects: ${sound.settings.sfx ? 'on' : 'off'}`,
      ),
      h(
        'button',
        {
          class: 'btn',
          onclick: (e: Event) => {
            const c = nextQualityChoice(loadQualityChoice());
            saveQualityChoice(c);
            quality.level = resolveQuality(c);
            applyQuality();
            (e.currentTarget as HTMLElement).textContent = qualityText();
          },
        },
        qualityText(),
      ),
      h(
        'button',
        {
          class: 'btn',
          onclick: () => {
            saveGame(state!);
            state = null;
            showTitle();
          },
        },
        'Save and quit',
      ),
    ),
  );
  ui().append(overlay);
}

// --------------------------------------------------------------- road events

function showRoadEvent(ev: RoadEvent): void {
  const s = state!;
  saveGame(s);
  const body = h('div', { class: 'event-body' });
  const card = h('div', { class: 'card event' }, h('div', { class: 'event-icon' }, ev.icon), h('h2', {}, ev.title), h('p', {}, ev.text), body);
  const overlay = h('div', { class: 'modal' }, card);
  const finish = (fight?: EnemyType) => {
    overlay.remove();
    if (s.status === 'lost') return showEnd();
    if (fight) return startCombat(false, undefined, fight);
    drive?.resume();
    hudTick?.();
  };
  body.replaceChildren(
    ...ev.choices.map((ch) =>
      h(
        'button',
        {
          class: 'btn choice',
          disabled: !ch.enabled,
          onclick: () => {
            const out = ch.apply();
            if (out.fight) sound.bad();
            else if (out.ok) sound.coin();
            else sound.bad();
            hudTick?.();
            body.replaceChildren(
              h('p', { class: `outcome ${out.ok ? 'good' : 'bad'}` }, out.message),
              h('button', { class: 'btn primary', onclick: () => finish(out.fight) }, out.fight ? 'Fight!' : 'Continue'),
            );
          },
        },
        h('b', {}, ch.label),
        ch.hint ? h('small', {}, ch.hint) : null,
      ),
    ),
  );
  sound.charge();
  ui().append(overlay);
}

/** Out of gas the first time: an old bike in the ditch, a ride to the pumps and back. */
function showBikeRescue(): void {
  const s = state!;
  if (!canUseBike(s)) return showEnd();
  saveGame(s);
  sound.engine(0);
  const plan = planBikeRide(s);
  const where = plan.stop
    ? `${plan.stop.name} is ${plan.km < 10 ? plan.km.toFixed(1) : Math.round(plan.km)} km ${plan.ahead ? 'up the road' : 'back the way you came'}.`
    : 'There are no pumps anywhere near, but there are plenty of wrecks.';
  const hours = `${plan.hours} h there and back`;
  const body = h('div', { class: 'event-body' });
  const card = h(
    'div',
    { class: 'card event' },
    h('div', { class: 'event-icon' }, '🚲'),
    h('h2', {}, 'Out of gas'),
    h('p', {}, `The engine coughs and dies. In the ditch there's a rusty old bicycle with a basket just big enough for a gas can. ${where}`),
    body,
  );
  const overlay = h('div', { class: 'modal' }, card);
  const giveUp = () => {
    overlay.remove();
    s.status = 'lost';
    s.lostReason = 'You ran out of fuel and decided to wait for a ride that never came.';
    showEnd();
  };
  const ride = () => {
    const out = rideForGas(s);
    saveGame(s);
    // A little bike rolls out to the pumps and back while the story plays.
    const bike = h('span', { class: 'bike' }, '🚲');
    const track = h('div', { class: 'bike-track' }, h('span', {}, '🚗'), bike, h('span', {}, '⛽'));
    const lines = h('div', { class: 'bike-story' });
    const done = h('button', { class: 'btn primary', disabled: true, onclick: () => {
      overlay.remove();
      hudTick?.();
      drive?.resume();
    } }, 'Back on the road');
    body.replaceChildren(track, lines, done);
    out.story.forEach((line, i) =>
      setTimeout(() => {
        lines.append(h('p', { class: `outcome ${/zombie|raiders/.test(line) ? 'bad' : 'good'}` }, line));
        if (/zombie|raiders/.test(line)) sound.bad();
        if (i === out.story.length - 1) {
          sound.coin();
          (done as HTMLButtonElement).disabled = false;
          hudTick?.();
        }
      }, 400 + i * 900),
    );
  };
  body.replaceChildren(
    h('button', { class: 'btn choice', onclick: ride }, h('b', {}, 'Ride for gas'), h('small', {}, `${hours}. You only get one bike.`)),
    h('button', { class: 'btn choice', onclick: giveUp }, h('b', {}, 'Give up the trip'), h('small', {}, 'Ends the run')),
  );
  sound.bad();
  ui().append(overlay);
}

// --------------------------------------------------------------- explore a stop

const PLACE_BLURBS: Record<PlaceKind, string> = {
  pumps: 'Pumps still work if you pay. Or poke around for gas cans.',
  garage: 'Tools, lifts and spare parts. A mechanic will fix you up for a price.',
  grocery: 'Shelves mostly bare, but the till might have cash.',
  hardware: 'Scrap metal, pipes and the odd box of shells.',
  gunshop: 'Bars on the windows. Whatever is left in here is worth it.',
  pharmacy: 'Cash in the register and, weirdly, catnip.',
  police: 'Evidence lockers full of ammo. Doors hanging open.',
  junkyard: 'Mountains of scrap. Something growls behind the crusher.',
  barn: 'Hay, a tractor, and a few jerry cans.',
  motel: 'Room keys still on the hooks. Guests left in a hurry.',
};

function showStop(stop: Stop): void {
  const s = state!;
  saveGame(s);
  clearUi();
  const log = h('div', { class: 'log' }, h('p', {}, `You pull into ${stop.name}. The place is quiet. Too quiet.`));
  const invEl = h('div', {});
  const meters = h('div', { class: 'stats' });
  const fuel = bar('fuel', '⛽');
  const hp = bar('hp', '🔧');
  meters.append(fuel.el, hp.el);
  const refresh = () => {
    fuel.set(s.inv.fuel, tankSize(s));
    hp.set(s.health, maxHealth(s));
    invEl.replaceChildren(inventoryLine(s));
    map.setSearches(Object.fromEntries(stop.places.map((p) => [p, s.searches[`${stop.id}:${p}`] ?? 0])));
    sheet.replaceChildren(current ? placeCard(current) : h('p', { class: 'muted hint' }, '👆 Tap a building to walk over and look around.'));
  };
  const say = (r: ActionResult) => {
    log.prepend(h('p', { class: r.ok ? '' : 'muted' }, r.message));
    if (r.ambush) sound.bad();
    else if (r.ok) sound.coin();
    if (r.ambush) {
      setTimeout(() => startCombat(true, stop), 700);
      return;
    }
    refresh();
  };
  const placeCard = (place: PlaceKind) => {
    const n = s.searches[`${stop.id}:${place}`] ?? 0;
    const actions: HTMLElement[] = [];
    if (place === 'pumps') {
      const want = Math.max(0, Math.floor(tankSize(s) - s.inv.fuel));
      actions.push(h('button', { class: 'btn small primary', onclick: () => say(buyFuel(s)), disabled: want === 0 }, `Fill up ($${Math.min(want * FUEL_PRICE, Math.floor(s.inv.cash / FUEL_PRICE) * FUEL_PRICE)})`));
    }
    if (place === 'garage') {
      const cost = repairCost(s);
      actions.push(
        h('button', { class: 'btn small primary', onclick: () => say(repair(s)), disabled: cost.hp === 0 }, cost.hp ? `Repair (${cost.scrap} scrap or $${cost.cash})` : 'Car is fine'),
        h('button', { class: 'btn small', onclick: () => showUpgrades(s, say) }, '🔧 Upgrades'),
      );
    }
    actions.push(h('button', { class: 'btn small', onclick: () => say(search(s, stop.id, place)) }, n === 0 ? 'Search' : `Search again (${n === 1 ? 'risky' : 'very risky'})`));
    return h(
      'div',
      { class: `place ${place}` },
      h('h3', {}, `${PLACE_ICONS[place]} ${PLACE_TITLES[place]}`),
      h('p', { class: 'muted' }, PLACE_BLURBS[place]),
      h('div', { class: 'row' }, ...actions),
    );
  };
  let current: PlaceKind | null = null;
  const sheet = h('div', { class: 'sheet' });
  const map = new TownMap(stop, isNight(hourOf(s)), (place) => {
    current = place;
    refresh();
  });
  ui().append(
    h(
      'div',
      { class: 'screen explore' },
      h('h2', {}, `${stop.name}`, h('small', {}, ` ${STOP_TITLES[stop.kind]}`)),
      h(
        'p',
        { class: 'muted' },
        isNight(hourOf(s))
          ? `🌙 ${clockText(hourOf(s))}. It's dark: you'll find more, but every search takes 45 minutes.`
          : `☀️ ${clockText(hourOf(s))}. Every search takes 45 minutes.`,
      ),
      meters,
      invEl,
      map.svg,
      sheet,
      log,
      h(
        'button',
        {
          class: 'btn primary',
          onclick: () => {
            saveGame(s);
            showDriveHud();
            drive!.resume();
            sound.startMusic();
            setScene(drive);
          },
        },
        'Back on the road',
      ),
    ),
  );
  refresh();
}

/** The garage's upgrade shop, as a modal over the explore screen. */
function showUpgrades(s: GameState, say: (r: ActionResult) => void): void {
  const list = h('div', { class: 'upgrades' });
  const wallet = h('p', { class: 'muted' });
  const render = () => {
    wallet.textContent = `You have ${Math.floor(s.inv.scrap)} scrap and $${Math.floor(s.inv.cash)}.`;
    list.replaceChildren(
      ...(Object.keys(UPGRADES) as UpgradeKind[]).map((k) => {
        const u = UPGRADES[k];
        const level = s.upgrades[k];
        const maxed = level >= MAX_LEVEL;
        const cost = upgradeCost(level);
        const afford = s.inv.scrap >= cost.scrap && s.inv.cash >= cost.cash;
        return h(
          'div',
          { class: 'upgrade' },
          h('span', { class: 'icon' }, u.icon),
          h(
            'div',
            { class: 'info' },
            h('strong', {}, u.name),
            h('span', { class: 'pips' }, '●'.repeat(level) + '○'.repeat(MAX_LEVEL - level)),
            h('small', {}, maxed ? u.describe(level) : `Next: ${u.describe(level + 1)}`),
          ),
          h(
            'button',
            {
              class: `btn small ${afford && !maxed ? 'primary' : ''}`,
              disabled: maxed || !afford,
              onclick: () => {
                const r = buyUpgrade(s, k);
                say(r);
                if (r.ok) drive?.refreshCar();
                render();
              },
            },
            maxed ? 'Maxed' : `${cost.scrap}🔩 $${cost.cash}`,
          ),
        );
      }),
    );
  };
  const overlay = h(
    'div',
    { class: 'modal' },
    h('div', { class: 'card wide' }, h('h2', {}, 'Garage upgrades'), wallet, list, h('button', { class: 'btn primary', onclick: () => overlay.remove() }, 'Done')),
  );
  render();
  ui().append(overlay);
}

// --------------------------------------------------------------- combat

function showBossIntro(boss: BossKind): void {
  const s = state!;
  sound.stopMusic();
  sound.bad();
  const info = BOSS_INFO[boss];
  saveGame(s);
  ui().append(
    h(
      'div',
      { class: 'modal boss-intro' },
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'boss-icon' }, boss === 'brute' ? '🧟' : boss === 'warrig' ? '🚚' : '🐱'),
        h('h2', {}, ENEMY_STATS[boss].name),
        h('p', {}, info.intro),
        h('p', { class: 'muted' }, `No running from this one. Ammo: ${s.inv.bullets} bullets, ${s.inv.shells} shells, ${s.inv.catnip} catnip.`),
        h('button', { class: 'btn primary', onclick: () => startCombat(false, undefined, undefined, boss) }, 'Bring it on'),
      ),
    ),
  );
}

function startCombat(ambush: boolean, stop?: Stop, theme?: EnemyType, boss?: BossKind): void {
  const s = state!;
  sound.stopMusic();
  const diff = DIFFICULTIES[s.difficulty];
  const c = createCombat({
    theme,
    boss,
    hpScale: diff.hp,
    dmgScale: diff.dmg,
    gunner: s.crew.includes('gunner'),
    seed: s.seed + s.encounters * 31 + (ambush ? 7 : 0) + Math.floor(s.distance),
    progress: s.distance / path!.length + nightDanger(hourOf(s)),
    ambush,
    gunDamage: gunDamageFor(s.upgrades) * rideOf(s).gun,
    ramDamage: ramDamageFor(s.upgrades) * rideOf(s).ram,
    dodge: rideOf(s).dodge,
    steerScale: rideOf(s).steer,
  });
  combat?.dispose();
  combat = new CombatScene(c, s, {
    onCarHit: () => {
      document.body.classList.remove('hurt');
      void document.body.offsetWidth;
      document.body.classList.add('hurt');
    },
    onEnd: (outcome) => setTimeout(() => endCombat(c, outcome, stop), 700),
    onTick: () => hudTick?.(),
  });
  setScene(combat);
  showCombatHud(c);
}

function showCombatHud(c: CombatState): void {
  clearUi();
  const s = state!;
  const hp = bar('hp', '🔧');
  const esc = bar(c.boss ? 'bosshp' : 'escape', c.boss ? '💀' : '🏁');
  const weapons: WeaponKind[] = ['bullets', 'shells', 'catnip'];
  const wbtns = weapons.map((w) =>
    h('button', { class: 'btn weapon', onclick: () => ((c.weapon = w), syncWeapons()) }, h('b', {}, WEAPONS[w].name), h('span', {}, '')),
  );
  const syncWeapons = () =>
    wbtns.forEach((b, i) => {
      const w = weapons[i];
      b.classList.toggle('selected', c.weapon === w);
      b.lastChild!.textContent = String(s.inv[w as 'bullets' | 'shells' | 'catnip']);
      b.classList.toggle('empty', s.inv[w as 'bullets'] <= 0);
    });
  const hornBtn = h('button', { class: 'btn action', onclick: () => horn(c) }, '📯 Horn');
  const boostBtn = h('button', { class: 'btn action', onclick: () => boost(c, s.inv) }, `🔥 Boost (${BOOST_FUEL}⛽)`);
  const steerBtn = (dir: number, label: string) => {
    const b = h('button', { class: 'btn steer' }, label);
    const on = (e: Event) => {
      e.preventDefault();
      c.steer = dir;
    };
    const off = () => {
      if (c.steer === dir) c.steer = 0;
    };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointerleave', off);
    b.addEventListener('pointercancel', off);
    return b;
  };
  ui().append(
    h(
      'div',
      { class: 'hud combat' },
      h(
        'div',
        { class: `banner ${c.boss ? 'boss' : ''}` },
        c.title,
        h('small', {}, c.boss ? 'Hold on the boss to shoot. Steer out of the red lane!' : 'Tap or hold on enemies to shoot. Survive or wipe them out.'),
      ),
      h('div', { class: 'stats' }, hp.el, esc.el),
      h(
        'div',
        { class: 'hud-bottom' },
        h('div', { class: 'row weapons' }, ...wbtns),
        h('div', { class: 'row' }, steerBtn(-1, '◀'), hornBtn, boostBtn, steerBtn(1, '▶')),
      ),
    ),
  );
  hudTick = () => {
    hp.set(s.health, maxHealth(s));
    if (c.boss) {
      const b = c.enemies.find((e) => e.id === c.bossId);
      esc.set(b ? b.hp : c.queue.length ? 1 : 0, b ? b.maxHp : 1, b ? `${Math.ceil(b.hp)}` : c.queue.length ? 'Incoming…' : 'Down!');
    } else esc.set(c.escape, c.escapeAt, `${c.enemies.length + c.queue.length} left`);
    hornBtn.classList.toggle('cooling', c.hornCooldown > 0);
    boostBtn.classList.toggle('cooling', c.boostCooldown > 0 || s.inv.fuel < BOOST_FUEL + 1);
    syncWeapons();
  };
  hudTick();
}

const ndc = new THREE.Vector2();
function toNdc(e: PointerEvent): THREE.Vector2 {
  const r = canvas.getBoundingClientRect();
  return ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}
canvas.addEventListener('pointerdown', (e) => {
  if (active === combat && combat) combat.pointerDown(toNdc(e));
});
window.addEventListener('pointerup', () => combat?.pointerUp());
canvas.addEventListener('pointermove', (e) => {
  if (active === combat && combat && e.buttons) combat.pointerDown(toNdc(e));
});

function endCombat(c: CombatState, outcome: 'cleared' | 'escaped' | 'wrecked', stop?: Stop): void {
  const s = state!;
  if (outcome === 'wrecked') {
    showEnd();
    return;
  }
  const found: string[] = [];
  for (const [k, v] of Object.entries(c.loot) as [keyof typeof s.inv, number][]) {
    s.inv[k] += v;
    found.push(`${v} ${k}`);
  }
  s.log.push(`${c.title} ${outcome === 'cleared' ? 'Wiped them out' : 'Got away'}.`);
  if (c.boss) s.bossesBeaten++;
  let patched = 0;
  if (s.crew.includes('mechanic')) {
    patched = Math.min(8, maxHealth(s) - s.health);
    s.health += patched;
  }
  saveGame(s);
  ui().append(
    h(
      'div',
      { class: 'modal' },
      h(
        'div',
        { class: 'card' },
        h('h2', {}, c.boss ? `${ENEMY_STATS[c.boss].name} is down!` : outcome === 'cleared' ? 'Wiped them out!' : 'You got away!'),
        h('p', {}, `${c.kills} taken down. Car at ${Math.round(s.health)}%.`),
        found.length > 0 && h('p', {}, `Picked up ${found.join(', ')}.`),
        patched > 0 && h('p', {}, `🧰 Your mechanic patches ${Math.round(patched)} damage.`),
        h(
          'button',
          {
            class: 'btn primary',
            onclick: () => {
              combat?.dispose();
              combat = null;
              if (stop) {
                setScene(drive);
                showStop(stop);
              } else {
                showDriveHud();
                drive!.resume();
            sound.startMusic();
                setScene(drive);
              }
            },
          },
          stop ? `Back to ${stop.name}` : c.boss === 'mothership' ? `Roll into ${s.route.endLabel.split(',')[0]}` : 'Keep driving',
        ),
      ),
    ),
  );
}

// --------------------------------------------------------------- the end

function showEnd(): void {
  const s = state!;
  clearSave();
  const won = s.status === 'won';
  sound.stopMusic();
  sound.engine(0);
  sound.fanfare(won);
  const km = realKmAt(s.route, s.distance);
  const score = scoreFor(s, pathFromRoute(s.route).length);
  const entry: ScoreEntry = {
    score: score.total,
    route: `${s.route.startLabel.split(',')[0]} → ${s.route.endLabel.split(',')[0]}`,
    difficulty: s.difficulty,
    won,
    date: new Date().toLocaleDateString(),
  };
  const { list, rank } = addScore(entry);
  ui().replaceChildren(
    h(
      'div',
      { class: `screen end ${won ? 'won' : 'lost'}` },
      h('h1', {}, won ? 'You made it!' : 'Road trip over'),
      h('p', {}, won ? `Welcome to ${s.route.endLabel}.` : s.lostReason ?? 'Your trip ended early.'),
      h(
        'ul',
        { class: 'facts' },
        h('li', {}, `${fmtKm(km)} driven`),
        h('li', {}, `${s.encounters} fights, ${s.kills} taken down`),
        h('li', {}, `Car condition ${Math.round(s.health)}%, ${Math.round(s.inv.fuel)} fuel left`),
        h('li', {}, `${s.bossesBeaten} of 2 bosses beaten on ${DIFFICULTIES[s.difficulty].name}`),
      ),
      h(
        'div',
        { class: 'score' },
        h('div', { class: 'total' }, h('small', {}, rank === 0 ? 'NEW HIGH SCORE' : 'Score'), score.total.toLocaleString()),
        h('ul', { class: 'breakdown' }, ...score.lines.map(([k, v]) => h('li', {}, h('span', {}, k), h('b', {}, `${v >= 0 ? '+' : ''}${v}`)))),
      ),
      h('h3', {}, '🏆 High scores'),
      scoreTable(list, rank),
      h('button', { class: 'btn primary', onclick: showSetup }, 'Plan another trip'),
      h('button', { class: 'btn', onclick: showTitle }, 'Title screen'),
    ),
  );
  state = null;
}

// Audio may only start after a user gesture; every tap makes sure it's running.
window.addEventListener('pointerdown', () => sound.unlock(), { capture: true });
window.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest?.('.btn, .result')) sound.click();
});

resize();
requestAnimationFrame(frame);
showTitle();
registerServiceWorker();

// Handy for automated play tests.
(window as unknown as { rtm: unknown }).rtm = {
  get state() {
    return state;
  },
  get drive() {
    return drive;
  },
  get combat() {
    return combat;
  },
};

// Keyboard driving: arrows or WASD change lanes and speed.
window.addEventListener('keydown', (e) => {
  if (!drive || active !== drive || (e.target as HTMLElement)?.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === 'arrowleft' || k === 'a') drive.steer(-1);
  else if (k === 'arrowright' || k === 'd') drive.steer(1);
  else if (k === 'arrowup' || k === 'w') drive.pedal(1);
  else if (k === 'arrowdown' || k === 's') drive.pedal(-1);
  else if (k === ' ' || k === 'f') {
    e.preventDefault();
    shootAhead();
  }
  else return;
  e.preventDefault();
});
