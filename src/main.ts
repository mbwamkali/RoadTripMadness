import * as THREE from 'three';
import './style.css';
import type { Path } from './geo/geo';
import { currentPosition, type Place } from './geo/geocode';
import { ANNOUNCED, LANDMARK_ICONS, LANDMARK_TITLES, readMoreUrl, roadAt, type Landmark } from './game/landmarks';
import { demoRawRoute } from './geo/demoRoute';
import type { ObstacleKind } from './game/obstacles';
import type { VehicleKind } from './game/traffic';
import { loadModels, modelsReady, modelsWanted } from './scenes/models';
import { canUseBike, planBikeRide, rideForGas } from './game/rescue';
import { loadRide, RIDE_IDS, RIDES, rideOf, saveRide, type Ride } from './game/rides';
import { addStateLines, buildRouteData, pathFromRoute, realKmAt, type RawRoute, type RouteData } from './geo/route';
import { latLngAt, loadStateMap } from './geo/states';
import { overpassStreets } from './geo/streets';
import { fetchLiveConditions, liveEnabled, setLiveEnabled, type LiveConditions } from './geo/liveWeather';
import { isOffline, planTrip, searchAnywhere } from './offline/planner';
import { tripCache } from './offline/tripCache';
import { checkForUpdate, registerServiceWorker } from './offline/registerSw';
import { buildLabel } from './build';
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
  crateCount,
  openCrate,
  scavengeNoise,
  scavengeSummary,
  startScavenge,
  tankSize,
  type ActionResult,
  type GameState,
} from './game/state';
import { STOP_TITLES, type PlaceKind, type Stop } from './game/stops';
import { classAt, roadSegments } from './game/roads';
import { afterTrip, freshCareer, loadCareer, saveCareer, threatFor, threatScale } from './game/career';
import { BOOST_FUEL, BOSS_INFO, boost, createCombat, easeOff, ENEMY_STATS, horn, WEAPONS, type BossKind, type CombatState, type EnemyType, type WeaponKind } from './game/combat';
import { DIFFICULTIES, DIFFICULTY_IDS, type Difficulty } from './game/difficulty';
import { addScore, loadScores, scoreFor, type ScoreEntry } from './game/scores';
import { CREW, rollEvent, type RoadEvent } from './game/events';
import { mpg, swipeAction } from './game/driving';
import { installButton } from './ui/install';
import { showHowToPlay } from './ui/howToPlay';
import { narrateUi, narrator } from './audio/narrator';
import { choiceIcon, kidChoices, kidMode, oneLine } from './game/kidMode';
import { BOSS_SCENES, eventScenes, playEventScene, sceneKindFor, type SceneKind } from './scenes/eventScene';
import { DoubleTap, isSwipe, type Press } from './game/gestures';
import { RAGE_HOSTILE, RAGE_MAX, rageOf } from './game/rage';
import { clockText, hourOf, isNight, nightDanger, weatherAt, WEATHER_INFO, type Weather } from './game/time';
import type { GameScene } from './scenes/common';
import { DriveScene, type ShotTarget } from './scenes/DriveScene';
import { CombatScene } from './scenes/CombatScene';
import { clearUi, fmtKm, h, ui } from './ui/dom';
import { Minimap } from './ui/minimap';
import { PLACE_ICONS, TownMap } from './ui/townMap';
import { TownScene } from './scenes/townScene';
import { openScavengeScene } from './scenes/scavengeScene';
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
/** The speeding tip shows once per session. */
let warnedSpeeding = false;
let warnedHostile = false;
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
      h('button', { class: 'btn', onclick: () => showHowToPlay(showTitle) }, '❓ How to play'),
      h('button', { class: 'btn ghost', onclick: showScores }, '🏆 High scores'),
      kidModeButton(),
      voiceButton(),
      installButton(),
      isOffline() && h('div', { class: 'offline-badge' }, 'Offline: classic, saved and atlas trips still work'),
      buildLine(),
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

/** The build number, with a button that looks for a newer one. */
function buildLine(): HTMLElement {
  const check = h('button', { class: 'btn small ghost' }, '🔄 Check for updates');
  check.addEventListener('click', async () => {
    check.textContent = 'Checking…';
    const r = await checkForUpdate();
    check.textContent = r === 'updating' ? 'Updating… the game will reload' : r === 'current' ? '✅ You have the newest build' : '📴 Offline, try again later';
  });
  return h('div', { class: 'build-line' }, h('span', { class: 'build' }, buildLabel()), check);
}

/** The Kid mode switch on the title screen. */
function kidModeButton(): HTMLElement {
  const label = () => `🧒 Kid mode: ${kidMode.on ? 'on' : 'off'}`;
  const b = h('button', { class: `btn kid-toggle ${kidMode.on ? 'on' : ''}` }, label());
  b.addEventListener('click', () => {
    kidMode.set(!kidMode.on);
    b.textContent = label();
    b.classList.toggle('on', kidMode.on);
    document.body.classList.toggle('kid', kidMode.on);
    if (kidMode.on) narrator.say('Kid mode is on. I will read everything out loud.');
    else narrator.stop();
  });
  return b;
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
        h('span', { class: 'diff' }, `${DIFFICULTIES[e.difficulty]?.icon ?? ''}${e.threat ? ` ⚠️${e.threat}` : ''} ${e.date}`),
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
  // Shown only while the live landmark lookup runs (when the road build has no landmark files).
  const skipScout = h('button', { class: 'btn small ghost', hidden: true }, 'Skip landmark scouting');
  const refresh = () => {
    go.disabled = !(from && to);
  };
  go.addEventListener('click', async () => {
    if (!from || !to) return;
    go.disabled = true;
    go.textContent = 'Finding the fastest road…';
    err.replaceChildren();
    try {
      const { raw, note } = await planTrip(
        from,
        to,
        (msg) => (go.textContent = msg),
        (skip) => {
          skipScout.hidden = !skip;
          skipScout.onclick = skip;
        },
      );
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
      skipScout,
      err,
      h('button', { class: 'btn ghost', onclick: showTitle }, '← Back'),
    ),
  );
}

function previewRoute(route: RouteData, note?: string, back: () => void = showSetup): void {
  clearUi();
  addStateLines(route);
  const s = newGame(route);
  let difficulty = kidMode.on ? DIFFICULTY_IDS[0] : loadDifficulty();
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
    const career = loadCareer();
    const g = newGame(route, s.seed, difficulty, ride, { upgrades: career.upgrades, threat: threatFor(career, kidMode.on), lastBoss: career.lastBoss });
    saveCareer({ ...career, lastBoss: g.halfBoss });
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
      kidMode.on ? h('p', { class: 'note' }, `🧒 Kid mode: ${DIFFICULTIES[DIFFICULTY_IDS[0]].name}, the easiest trip`) : h('div', { class: 'difficulty' }, ...diffBtns),
      h('div', { class: 'rides' }, ...rideBtns),
      rideBlurb,
      careerNote(),
      h('button', { class: 'btn primary', onclick: go }, 'Hit the road'),
      realMap && liveBtn,
      h('button', { class: 'btn ghost', onclick: back }, back === showSetup ? '← Pick different places' : '← Back'),
      h('p', { class: 'fine' }, route.attribution, realMap ? ' Weather data by Open-Meteo.com.' : ''),
    ),
  );
}

/** The carried-over upgrades and threat level, with a way to start over from scratch. */
function careerNote(): HTMLElement | false {
  const c = loadCareer();
  const threat = threatFor(c, kidMode.on);
  const levels = Object.values(c.upgrades).reduce((a, b) => a + b, 0);
  if (!threat && !levels) return false;
  const box = h(
    'div',
    { class: 'note career' },
    h('p', {}, `⚠️ Threat level ${threat}: enemies are tougher, hit harder and come in bigger groups.`),
    levels > 0 && h('p', {}, `🔧 Your car upgrades from earlier trips came along (${levels} level${levels === 1 ? '' : 's'}).`),
  );
  const reset = h('button', { class: 'btn small ghost' }, 'Start over (no upgrades, threat 0)');
  reset.addEventListener('click', () => {
    if (reset.dataset.sure !== '1') {
      reset.dataset.sure = '1';
      reset.textContent = 'Tap again to start over';
      return;
    }
    saveCareer(freshCareer());
    box.remove();
  });
  box.append(reset);
  return box;
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
    onShotAt: (kind, dmg) => {
      if (dmg > 0) navigator.vibrate?.(60);
      if (!warnedHostile) {
        warnedHostile = true;
        showToast('😠', `A ${VEHICLE_LABEL[kind].toLowerCase()} is shooting back!`, 'Shoot back, or let your road rage cool');
      }
      if (state?.status === 'lost' && drive) {
        drive.paused = true;
        setTimeout(showEnd, 900);
      }
    },
    onCrash: (kind, dmg) => {
      const what = { car: 'a car', motorcycle: 'a motorcycle', pickup: 'a pickup', van: 'a van', truck: 'a big rig' }[kind];
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
  narrator.say(`${stop.exit ? `Exit ${stop.exit}. ` : ''}${STOP_TITLES[stop.kind]}, ${stop.name}, on the ${stop.side}.`);
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
  narrator.say(`${small}. ${big}.`);
  el.onclick = link
    ? () => {
        // Reading about it pauses the trip, so nothing happens on the road while you're away.
        pauseDriving();
        window.open(link, '_blank', 'noopener');
      }
    : null;
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

/** Supplies as pictures with little bars (kid mode): no numbers to read. */
function kidSupplies(s: GameState): HTMLElement {
  const i = s.inv;
  const item = (icon: string, title: string, v: number, full: number) =>
    h('span', { class: 'kid-item', title }, icon, h('span', { class: 'mini' }, h('span', { class: `fill ${v <= 0 ? 'empty' : ''}`, style: `width:${Math.min(100, (v / full) * 100)}%` })));
  return h(
    'div',
    { class: 'inv kid-inv' },
    item('💵', 'Cash', i.cash, 200),
    item('🔫', 'Bullets', i.bullets, 60),
    item('💥', 'Shotgun shells', i.shells, 12),
    item('🌿', 'Catnip bombs', i.catnip, 3),
    item('🔩', 'Scrap', i.scrap, 40),
    ...s.crew.map((c) => h('span', { class: 'kid-item', title: CREW[c].name }, CREW[c].icon)),
  );
}

function showDriveHud(): void {
  clearUi();
  const s = state!;
  const p = path!;
  const fuel = bar('fuel', '⛽');
  const hp = bar('hp', '🔧');
  const rage = bar('rage', '😡');
  const inv = h('div', {});
  const progress = h('div', { class: 'progress' }, h('div', { class: 'fill' }));
  const progressText = h('div', { class: 'progress-text' });
  const map = new Minimap(p, s.stops, 110);
  const speedBtn = h('button', { class: 'btn small round', title: 'Autopilot: drives faster on its own, stays in lane' }, '🤖');
  speedBtn.addEventListener('click', () => {
    drive!.autopilot = !drive!.autopilot;
    speedBtn.classList.toggle('on', drive!.autopilot);
    showToast('🤖', 'Autopilot', drive!.autopilot ? 'On: faster, stays in its lane, slows for traffic' : 'Off: you are driving');
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
  // The dashboard: big speed, clock and fuel economy.
  const dashSpeed = h('b', {}, '');
  const dashClock = h('b', {}, '');
  const dashMpg = h('b', {}, '');
  const dash = h(
    'div',
    { class: 'dash' },
    h('div', { class: 'gauge speed-gauge' }, dashSpeed, h('small', {}, 'mph')),
    h('div', { class: 'gauge' }, dashClock, h('small', {}, 'time')),
    h('div', { class: 'gauge' }, dashMpg, h('small', {}, 'mpg')),
  );
  const controls = h(
    'div',
    { class: 'drive-pad' },
    pad('◀', 'Change lane left', () => drive?.steer(-1)),
    h('div', { class: 'speed-ctl' }, pad('−', 'Slow down', () => drive?.pedal(-1)), speedText, pad('+', 'Speed up', () => drive?.pedal(1))),
    pad('▶', 'Change lane right', () => drive?.steer(1)),
  );
  // A big shoot button for what is ahead; only in kid mode. Everyone else double-taps the target.
  const bigShoot = kidMode.on;
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
      h('div', { class: 'hud-top' }, h('div', { class: 'stats' }, fuel.el, hp.el, rage.el, inv), h('div', { class: 'side' }, map.canvas, h('div', { class: 'row' }, radioBtn, speedBtn, menuBtn))),
      h('div', { class: 'hud-bottom' }, promptEl, bigShoot && shootRow, dash, controls, progress, progressText),
    ),
  );
  try {
    if (!localStorage.getItem('rtm-swipe-hint')) {
      localStorage.setItem('rtm-swipe-hint', '1');
      setTimeout(() => showToast('👆', 'Swipe to drive', 'Swipe sideways to change lanes, up or down to change speed'), 1500);
    }
  } catch {
    // Storage blocked: skip the hint.
  }
  let lastInv = '';
  let frameCount = 0;
  hudTick = () => {
    fuel.set(s.inv.fuel, tankSize(s));
    hp.set(s.health, maxHealth(s));
    rage.set(rageOf(s), RAGE_MAX);
    rage.el.classList.toggle('show', rageOf(s) > 0.5);
    rage.el.classList.toggle('hot', rageOf(s) >= RAGE_HOSTILE);
    const key = JSON.stringify(s.inv) + s.crew.join();
    if (key !== lastInv) {
      inv.replaceChildren(kidMode.on ? kidSupplies(s) : inventoryLine(s));
      lastInv = key;
    }
    (progress.firstChild as HTMLElement).style.width = `${(s.distance / p.length) * 100}%`;
    const left = realKmAt(s.route, p.length - s.distance);
    const hour = hourOf(s);
    const wx = weatherAt(s);
    const road = roadAt(s.route, s.distance);
    progressText.textContent = `${isNight(hour) ? '🌙' : '☀️'} ${wx === 'clear' ? '' : `${WEATHER_INFO[wx].icon} ${WEATHER_INFO[wx].name} · `}${road ? `${road} · ` : ''}${fmtKm(left)} to ${s.route.endLabel.split(',')[0]}`;
    dashClock.textContent = clockText(hour);
    if (frameCount++ % 10 === 0) map.draw(s.distance, s.passed);
    if (drive) {
      const limit = drive.speedLimit();
      const mph = Math.round(limit * drive.throttle);
      speedText.textContent = `Limit ${limit}`;
      dashSpeed.textContent = String(mph);
      dash.classList.toggle('fast', drive.throttle > 1);
      if (drive.throttle > 1 && !warnedSpeeding) {
        warnedSpeeding = true;
        showToast('⛽', 'Speeding burns gas', 'Faster empties the tank sooner and gives you less time to react');
      }
      dashMpg.textContent = String(Math.round(mpg(s, drive.throttle)));
      controls.classList.toggle('wrong-side', drive.wrongSide);
      const t = drive.target;
      // The big shoot button sits just above the stop prompt; it steps aside while a turn is on offer,
      // or it would catch taps meant for "Take the exit".
      shootRow.classList.toggle('show', !!t && !promptEl?.classList.contains('show'));
      if (t && !bigShoot) tapHint();
      if (t) {
        const label = t.type === 'obstacle' ? `🔫 ${OBSTACLE_LABEL[t.o.kind]}` : `🔫 ${t.v.hostile ? '😠 ' : ''}${VEHICLE_LABEL[t.v.kind]}`;
        if (shootBtn.textContent !== label) shootBtn.textContent = label;
      }
    }
  };
  hudTick();
}

/** The first time there is something to shoot, explain double-tap. */
function tapHint(): void {
  try {
    if (localStorage.getItem('rtm-tap-hint')) return;
    localStorage.setItem('rtm-tap-hint', '1');
  } catch {
    return;
  }
  showToast('👆', 'Double-tap to shoot', 'Double-tap a car or junk in the road to fire at it');
}

const OBSTACLE_LABEL: Record<ObstacleKind, string> = { debris: 'Junk', zombie: 'Zombie', wreck: 'Wreck', roadblock: 'Roadblock' };
const VEHICLE_LABEL: Record<VehicleKind, string> = { car: 'Car', motorcycle: 'Biker', pickup: 'Pickup', van: 'Van', truck: 'Big rig' };

/** Fires at whatever is in the road ahead in your lane. */
function shootAhead(): void {
  shootAt(drive?.target ?? null);
}

/** Fires at a car or obstacle (picked by a double tap, or the one ahead). */
function shootAt(t: ShotTarget | null): void {
  if (!t) return;
  const r = drive?.shoot(t);
  if (r === 'empty') showToast('🔫', 'Out of ammo', 'Dodge it or ram it');
  else if (r?.vehicle && r.destroyed) showToast('💥', `${VEHICLE_LABEL[r.kind as VehicleKind]} wrecked`, `+${r.scrap} scrap · road rage is rising`);
  else if (r && !r.vehicle && r.destroyed && r.scrap) showToast('💥', `${OBSTACLE_LABEL[r.kind as ObstacleKind]} cleared`, `+${r.scrap} scrap`);
}

/** The Narration on/off switch (the device's own voice reads events, signs and tips). */
function narrationButton(): HTMLElement | null {
  if (!narrator.available) return null;
  const label = () => `🗣️ Narration: ${narrator.on ? 'on' : 'off'}`;
  return h(
    'button',
    {
      class: 'btn',
      onclick: (e: Event) => {
        narrator.set(!narrator.on);
        (e.currentTarget as HTMLElement).textContent = label();
        narrator.say('Narration is on. Tap any card to hear it again.');
      },
    },
    label(),
  );
}

/** Opens the narrator voice settings: the phone's voices, speed and pitch, with a Test button. */
function voiceButton(): HTMLElement | null {
  if (!narrator.available) return null;
  return h('button', { class: 'btn', onclick: () => showVoiceSettings() }, '🎙️ Narrator voice');
}

function showVoiceSettings(): void {
  const sample = () => narrator.say("Hi! I'm your road trip narrator. Watch out for zombies!", true);
  const select = h('select', { class: 'voice-select', 'aria-label': 'Voice' }) as HTMLSelectElement;
  const fillVoices = () => {
    const list = narrator.voices();
    select.replaceChildren(
      h('option', { value: '' }, 'Automatic'),
      ...list.map((v) => h('option', { value: v.voiceURI }, `${v.name} (${v.lang})${v.localService ? '' : ' · online'}`)),
    );
    select.value = narrator.voiceId && list.some((v) => v.voiceURI === narrator.voiceId) ? narrator.voiceId : '';
  };
  fillVoices();
  // Some browsers hand over their voices a moment after the page loads.
  speechSynthesis.addEventListener?.('voiceschanged', fillVoices);
  select.addEventListener('change', () => {
    narrator.setVoice(select.value || null);
    sample();
  });
  const slider = (label: string, min: number, max: number, get: () => number, set: (v: number) => void) => {
    const out = h('span', { class: 'voice-value' }, `${get().toFixed(2)}×`);
    const input = h('input', { type: 'range', min, max, step: 0.05, value: get(), 'aria-label': label }) as HTMLInputElement;
    input.addEventListener('input', () => {
      set(parseFloat(input.value));
      out.textContent = `${get().toFixed(2)}×`;
    });
    input.addEventListener('change', sample);
    return h('label', { class: 'voice-slider' }, h('span', {}, label), input, out);
  };
  const close = () => {
    speechSynthesis.removeEventListener?.('voiceschanged', fillVoices);
    overlay.remove();
  };
  const overlay = h(
    'div',
    { class: 'modal voice-modal' },
    h(
      'div',
      { class: 'card voice-card', 'data-quiet': true },
      h('h2', {}, '🎙️ Narrator voice'),
      h('p', { class: 'muted' }, 'Voices come from this phone or tablet. Pick one, then tap Test.'),
      select,
      slider('🐢 Speed 🐇', 0.5, 1.5, () => narrator.rate, (v) => narrator.setRate(v)),
      slider('Pitch', 0.5, 2, () => narrator.pitch, (v) => narrator.setPitch(v)),
      h('button', { class: 'btn', onclick: sample }, '🔊 Test'),
      h(
        'button',
        {
          class: 'btn ghost',
          onclick: () => {
            narrator.resetVoice();
            close();
            showVoiceSettings();
          },
        },
        'Reset to default',
      ),
      h('button', { class: 'btn primary', onclick: close }, 'Done'),
    ),
  );
  ui().append(overlay);
}

/** Opens the pause menu if the car is out on the road and not already paused. */
function pauseDriving(): void {
  if (drive && active === drive && drive.onRoad && state?.status === 'driving') showPauseMenu();
}

// Leaving the game (another app, a link, the home screen) pauses the trip.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseDriving();
});

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
      { class: 'card', 'data-quiet': true },
      h('h2', {}, 'Paused'),
      h('p', {}, `Encounters survived: ${state!.encounters} · Kills: ${state!.kills}`),
      h('p', { class: 'fine build' }, buildLabel()),
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
      narrationButton(),
      voiceButton(),
      h(
        'button',
        {
          class: 'btn',
          onclick: (e: Event) => {
            eventScenes.set(!eventScenes.on);
            (e.currentTarget as HTMLElement).textContent = `🎬 Event scenes: ${eventScenes.on ? 'on' : 'off'}`;
          },
        },
        `🎬 Event scenes: ${eventScenes.on ? 'on' : 'off'}`,
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

/**
 * The picture at the top of an event card: a few seconds of the event acted
 * out in 3D (when event scenes are on), then its big icon. Tap to skip.
 */
function eventPicture(icon: string, kind: SceneKind): HTMLElement {
  const iconEl = h('div', { class: 'event-icon' }, icon);
  const box = h('div', { class: 'event-picture' }, iconEl);
  if (!eventScenes.on) return box;
  iconEl.hidden = true;
  box.classList.add('playing');
  // Start once the card is on screen, so the scene knows how wide it can be.
  requestAnimationFrame(() => {
    const stop = playEventScene(box, kind, {
      ride: state?.ride ?? 'car',
      upgrades: state?.upgrades,
      onDone: () => {
        box.classList.remove('playing');
        iconEl.hidden = false;
        iconEl.classList.add('pop');
      },
    });
    box.addEventListener('click', stop, { once: true });
  });
  return box;
}

function showRoadEvent(ev: RoadEvent): void {
  const s = state!;
  saveGame(s);
  const body = h('div', { class: 'event-body' });
  const kid = kidMode.on;
  const card = h('div', { class: `card event ${kid ? 'kid' : ''}` }, eventPicture(ev.icon, sceneKindFor(ev.id)), h('h2', {}, ev.title), h('p', {}, kid ? oneLine(ev.text) : ev.text), body);
  const overlay = h('div', { class: 'modal' }, card);
  const finish = (fight?: EnemyType) => {
    overlay.remove();
    if (s.status === 'lost') return showEnd();
    if (fight) return startCombat(false, undefined, fight);
    drive?.resume();
    hudTick?.();
  };
  body.replaceChildren(
    ...(kid ? kidChoices(ev.choices) : ev.choices).map((ch) =>
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
            const message = kid ? oneLine(out.message) : out.message;
            narrator.say(message);
            body.replaceChildren(
              h('p', { class: `outcome ${out.ok ? 'good' : 'bad'}` }, message),
              h('button', { class: 'btn primary', onclick: () => finish(out.fight) }, out.fight ? 'Fight!' : 'Continue'),
            );
          },
        },
        kid && h('span', { class: 'choice-icon' }, choiceIcon(ch.label)),
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
    eventPicture('🚲', 'fuel'),
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

/** The town on screen, for play tests. */
let townView: TownScene | TownMap | null = null;

function showStop(stop: Stop): void {
  const s = state!;
  saveGame(s);
  clearUi();
  const night = isNight(hourOf(s));
  const kid = kidMode.on;
  // Medium and High draw the town in 3D with the road's models; Low keeps the flat map.
  const in3d = modelsWanted() && modelsReady();
  const log = h('div', { class: 'log' }, h('p', {}, kid ? `You pull into ${stop.name}.` : `You pull into ${stop.name}. The place is quiet. Too quiet.`));
  const invEl = h('div', {});
  const meters = h('div', { class: 'stats' });
  const fuel = bar('fuel', '⛽');
  const hp = bar('hp', '🔧');
  meters.append(fuel.el, hp.el, invEl);
  const noise = h('div', { class: 'noise' }, h('span', {}, '🔊'), h('div', { class: 'track' }, h('span', { class: 'fill' })), h('span', {}, '🧟'));
  const searchesAt = (p: PlaceKind) => s.searches[`${stop.id}:${p}`] ?? 0;
  const refresh = () => {
    fuel.set(s.inv.fuel, tankSize(s));
    hp.set(s.health, maxHealth(s));
    invEl.replaceChildren(kid ? kidSupplies(s) : inventoryLine(s));
    map.setSearches(Object.fromEntries(stop.places.map((p) => [p, searchesAt(p)])));
    // The meter shows how noisy the chosen building already is.
    const v = current ? Math.min(0.6, searchesAt(current) * 0.25) : 0;
    (noise.querySelector('.fill') as HTMLElement).style.width = `${Math.round(v * 100)}%`;
    noise.classList.toggle('warm', v > 0.33 && v <= 0.66);
    noise.classList.toggle('hot', v > 0.66);
    noise.hidden = !current;
    sheet.replaceChildren(current ? placeCard(current) : h('p', { class: 'muted hint' }, kid ? '👆 Tap a building!' : '👆 Tap a building to walk over and look around.'));
  };
  const say = (r: ActionResult) => {
    log.prepend(h('p', { class: r.ok ? '' : 'muted' }, kid ? oneLine(r.message) : r.message));
    if (r.ambush) sound.bad();
    else if (r.ok) sound.coin();
    if (r.ambush) {
      setTimeout(() => startCombat(true, stop), 700);
      return;
    }
    refresh();
  };
  /** Search, played: tap crates inside the building (state.ts keeps the same loot and odds). */
  const scavenge = (place: PlaceKind) => {
    const sc = startScavenge(s, stop.id, place, crateCount(kid));
    saveGame(s);
    sound.click();
    openScavengeScene(ui(), {
      place,
      title: PLACE_TITLES[place],
      crates: sc.crates.length,
      kid,
      night,
      noise: scavengeNoise(sc),
      open: (i) => {
        const r = openCrate(s, sc, i);
        return { ...r, noise: scavengeNoise(sc) };
      },
      done: (ambush) => {
        saveGame(s);
        say(scavengeSummary(sc, ambush));
      },
      say: (t) => narrator.say(t),
      sfx: sound,
    });
    narrator.say(kid ? 'Tap the boxes!' : `${PLACE_TITLES[place]}. Tap the boxes. Too much noise brings zombies.`);
  };
  const placeCard = (place: PlaceKind) => {
    const n = searchesAt(place);
    const actions: HTMLElement[] = [];
    const big = (icon: string, text: string) => [h('span', { class: 'big-icon' }, icon), text] as const;
    if (place === 'pumps') {
      const want = Math.max(0, Math.floor(tankSize(s) - s.inv.fuel));
      const price = Math.min(want * FUEL_PRICE, Math.floor(s.inv.cash / FUEL_PRICE) * FUEL_PRICE);
      actions.push(h('button', { class: 'btn small primary', onclick: () => say(buyFuel(s)), disabled: want === 0 }, ...big('⛽', want === 0 ? 'Tank is full' : kid ? `$${price}` : `Fill up ($${price})`)));
    }
    if (place === 'garage') {
      const cost = repairCost(s);
      actions.push(
        h('button', { class: 'btn small primary', onclick: () => say(repair(s)), disabled: cost.hp === 0 }, ...big('🔧', cost.hp ? (kid ? 'Fix' : `Repair (${cost.scrap} scrap or $${cost.cash})`) : 'Car is fine')),
        h('button', { class: 'btn small', onclick: () => showUpgrades(s, say) }, ...big('⬆️', 'Upgrades')),
      );
    }
    actions.push(h('button', { class: `btn small ${actions.length ? '' : 'primary'}`, onclick: () => scavenge(place) }, ...big('🔍', n === 0 ? 'Search' : kid ? 'Again' : 'Search again')));
    return h(
      'div',
      { class: `place ${place}` },
      h('h3', {}, h('span', { class: 'big-icon' }, PLACE_ICONS[place]), ` ${PLACE_TITLES[place]}`),
      kid || in3d ? '' : h('p', { class: 'muted' }, PLACE_BLURBS[place]),
      h('div', { class: 'row' }, ...actions),
    );
  };
  let current: PlaceKind | null = null;
  const sheet = h('div', { class: 'sheet' });
  const arrive = (place: PlaceKind) => {
    current = place;
    refresh();
    narrator.say(PLACE_TITLES[place]);
  };
  const map = in3d ? new TownScene(stop, night, arrive, s.upgrades) : new TownMap(stop, night, arrive);
  townView = map;
  const back = h(
    'button',
    {
      class: 'btn primary back-road',
      onclick: () => {
        saveGame(s);
        showDriveHud();
        drive!.resume();
        sound.startMusic();
        setScene(drive);
      },
    },
    '🚗 Back on the road',
  );
  const clock = night ? `🌙 ${clockText(hourOf(s))}` : `☀️ ${clockText(hourOf(s))}`;
  if (map instanceof TownScene) {
    ui().append(
      h(
        'div',
        { class: 'screen explore town3d-screen' },
        map.el,
        h('div', { class: 'town3d-top' }, meters, h('div', { class: 'town-chip' }, h('h2', {}, stop.name), h('small', {}, `${clock} · ${STOP_TITLES[stop.kind]}`))),
        h('div', { class: 'town3d-bottom' }, noise, sheet, log, back),
      ),
    );
  } else {
    ui().append(
      h(
        'div',
        { class: 'screen explore' },
        h('h2', {}, `${stop.name}`, h('small', {}, ` ${STOP_TITLES[stop.kind]}`)),
        h('p', { class: 'muted' }, night ? `${clock}. It's dark: you'll find more, but every search takes 45 minutes.` : `${clock}. Every search takes 45 minutes.`),
        meters,
        map.svg,
        noise,
        sheet,
        log,
        back,
      ),
    );
  }
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
    h('div', { class: 'card wide', 'data-quiet': true }, h('h2', {}, 'Garage upgrades'), wallet, list, h('button', { class: 'btn primary', onclick: () => overlay.remove() }, 'Done')),
  );
  render();
  ui().append(overlay);
}

// --------------------------------------------------------------- combat

/** The story that ties Karen to the alien cats and sets up the Cat Queen. */
const KAREN_STORY = {
  reveal:
    '📡 Her scooter tips over and out rolls a tin-can antenna. Karen has been calling the alien cats from space! "My babies! Come home to Mommy!"',
  tease: '👑 Far above, a purple light blinks. Someone up there heard her. Keep driving...',
  queen: '👑 Karen\'s call reached space. The Cat Queen has come to take her kittens home, and you are in the way!',
};

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
        BOSS_SCENES.includes(boss) ? eventPicture(BOSS_INFO[boss].icon, boss as SceneKind) : h('div', { class: 'boss-icon' }, BOSS_INFO[boss].icon),
        h('h2', {}, ENEMY_STATS[boss].name),
        boss === 'mothership' && s.karenBeaten && h('p', { class: 'story' }, KAREN_STORY.queen),
        h('p', {}, info.intro),
        h('p', { class: 'muted' }, `No running from this one. Ammo: ${s.inv.bullets} bullets, ${s.inv.shells} shells, ${s.inv.catnip} catnip.`),
        h('button', { class: 'btn primary', onclick: () => startCombat(false, undefined, undefined, boss) }, 'Bring it on'),
      ),
    ),
  );
}

/** Set by play tests to force or block a horde. */
let testHorde: boolean | undefined;

function startCombat(ambush: boolean, stop?: Stop, theme?: EnemyType, boss?: BossKind): void {
  const s = state!;
  sound.stopMusic();
  const diff = DIFFICULTIES[s.difficulty];
  const ts = threatScale(s.threat ?? 0);
  const c = createCombat({
    theme,
    boss,
    hpScale: diff.hp * ts.hp,
    dmgScale: diff.dmg * ts.dmg,
    extra: ts.extra,
    gunner: s.crew.includes('gunner'),
    seed: s.seed + s.encounters * 31 + (ambush ? 7 : 0) + Math.floor(s.distance),
    progress: s.distance / path!.length + nightDanger(hourOf(s)),
    ambush,
    gunDamage: gunDamageFor(s.upgrades) * rideOf(s).gun,
    ramDamage: ramDamageFor(s.upgrades) * rideOf(s).ram,
    dodge: rideOf(s).dodge,
    steerScale: rideOf(s).steer,
    // Zombie hordes: likelier on harder trips and in cities; smaller on Low graphics and in kid mode.
    hordeChance: testHorde !== undefined ? +testHorde : (({ easy: 0.2, normal: 0.35, hard: 0.5 }[s.difficulty] ?? 0.35) + (classAt(roadSegments(s.route, path!.length), s.distance) === 'metro' ? 0.25 : 0)),
    hordeMax: quality.level === 'low' || kidMode.on ? 20 : 40,
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
  fightCombatState = c;
  fightSteer = 0;
  narrator.say(c.title);
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
        h('small', {}, kidMode.on ? 'Tap the bad guys!' : c.boss ? 'Hold on the boss to shoot. Swipe to steer out of the red lane!' : 'Tap or hold on enemies to shoot. Swipe to steer, up to boost.'),
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
// Touch controls. On the road: swipe sideways to change lanes, up or down to
// change speed, and double-tap a car or obstacle to shoot it. In a fight: tap
// or hold on enemies to shoot, swipe sideways to steer (keeps steering while
// the finger stays down), swipe up to boost and down to ease off.
let press: Press | null = null;
let pressSwiped = false;
let fightSteer = 0;
const doubleTap = new DoubleTap();
canvas.addEventListener('pointerdown', (e) => {
  press = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId };
  pressSwiped = false;
  if (active === combat && combat) combat.pointerDown(toNdc(e));
});
canvas.addEventListener('pointermove', (e) => {
  if (active !== combat || !combat || !press || press.id !== e.pointerId) return;
  if (!pressSwiped && isSwipe(press, e.clientX, e.clientY, e.timeStamp)) {
    pressSwiped = true;
    combat.pointerUp();
    fightSwipe(swipeAction(e.clientX - press.x, e.clientY - press.y));
    return;
  }
  if (!pressSwiped) combat.pointerDown(toNdc(e));
});
canvas.addEventListener('pointerup', (e) => {
  const from = press;
  press = null;
  if (!from || from.id !== e.pointerId) return;
  if (active === combat) {
    // A sideways swipe keeps steering for a moment after the finger lifts.
    if (fightSteer) {
      const dir = fightSteer;
      setTimeout(() => {
        if (fightCombatState && fightCombatState.steer === dir && fightSteer === dir) fightCombatState.steer = 0;
        if (fightSteer === dir) fightSteer = 0;
      }, 300);
    }
    return;
  }
  if (!drive || active !== drive) return;
  const act = swipeAction(e.clientX - from.x, e.clientY - from.y);
  if (act) {
    doubleTap.reset();
    if (act === 'left') drive.steer(-1);
    else if (act === 'right') drive.steer(1);
    else if (act === 'faster') drive.pedal(1);
    else if (act === 'slower') drive.pedal(-1);
    return;
  }
  if (doubleTap.tap(e.clientX, e.clientY, e.timeStamp)) {
    const t = drive.pick(toNdc(e));
    if (t) shootAt(t);
  }
});
canvas.addEventListener('pointercancel', () => {
  press = null;
  if (fightCombatState && fightSteer) fightCombatState.steer = 0;
  fightSteer = 0;
});
window.addEventListener('pointerup', () => combat?.pointerUp());

/** The fight HUD's state, so canvas swipes can steer and boost. */
let fightCombatState: CombatState | null = null;
function fightSwipe(act: ReturnType<typeof swipeAction>): void {
  const c = fightCombatState;
  if (!c || !act || !state) return;
  if (act === 'left' || act === 'right') {
    fightSteer = act === 'left' ? -1 : 1;
    c.steer = fightSteer;
  } else if (act === 'faster') boost(c, state.inv);
  else easeOff(c);
}

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
  if (c.boss === 'karen') s.karenBeaten = true;
  // Food from the fight (the pizza driver's pizzas) fixes you up.
  const ate = Math.min(c.heal, maxHealth(s) - s.health);
  if (ate > 0) s.health += ate;
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
        c.boss === 'karen' && h('p', { class: 'story' }, KAREN_STORY.reveal),
        c.boss === 'karen' && h('p', { class: 'story' }, KAREN_STORY.tease),
        c.heal > 0 && h('p', {}, `🍕 Free pizza! You eat on the road and feel great${ate > 0 ? `: +${Math.round(ate)} condition` : ''}.`),
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
    ...(s.threat ? { threat: s.threat } : {}),
    date: new Date().toLocaleDateString(),
  };
  const { list, rank } = addScore(entry);
  // A finished trip keeps its upgrades and raises the threat for the next one.
  const before = loadCareer();
  const career = afterTrip(before, won, s.upgrades, kidMode.on);
  saveCareer(career);
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
      won &&
        h(
          'p',
          { class: 'note' },
          career.threat > before.threat
            ? `🔧 Your upgrades come with you. ⚠️ Next trip is threat level ${career.threat}: the bad guys get tougher!`
            : '🔧 Your upgrades come with you to the next trip.',
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
document.body.classList.toggle('kid', kidMode.on);
narrateUi(ui());
showTitle();
registerServiceWorker(() => {
  // A new build just took over. Off the road, reload straight into it; mid-trip, offer it (the trip is saved).
  if (!state || state.status !== 'driving') {
    location.reload();
    return;
  }
  if (document.querySelector('.update-banner')) return;
  const banner = h('button', { class: 'update-banner' }, '🆕 New version ready · tap to update');
  banner.addEventListener('click', () => {
    if (state?.status === 'driving') saveGame(state);
    location.reload();
  });
  document.body.append(banner);
});

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
  /** Shows an event scene on its own card, for checking how each one looks. */
  showScene(kind: SceneKind) {
    const card = h('div', { class: 'card event', 'data-quiet': true }, eventPicture('🎬', kind), h('h2', {}, kind));
    const overlay = h('div', { class: 'modal scene-test' }, card);
    ui().append(overlay);
    return overlay;
  },
  /** Shows a boss's intro card (its button starts the fight). */
  bossIntro(boss: BossKind) {
    showBossIntro(boss);
  },
  /** Opens a stop's town (index into the trip's stops; the first town by default). */
  stop(i?: number) {
    const s = state!;
    const st = i == null ? s.stops.find((x) => x.places.length >= 4) ?? s.stops[0] : s.stops[i];
    if (drive) (drive as unknown as { paused: boolean }).paused = true;
    showStop(st);
    return st;
  },
  /** Walks to a building in the open town, as if it was tapped. */
  visit(place: PlaceKind) {
    townView?.walkTo(place);
  },
  /** Starts a fight on the spot; `horde` forces (true) or blocks (false) a zombie horde. */
  fight(theme?: EnemyType, horde?: boolean) {
    testHorde = horde;
    startCombat(false, undefined, theme);
    testHorde = undefined;
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
