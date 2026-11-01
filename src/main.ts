import * as THREE from 'three';
import './style.css';
import type { Path } from './geo/geo';
import { currentPosition, type Place } from './geo/geocode';
import { LANDMARK_ICONS, LANDMARK_TITLES, type Landmark } from './game/landmarks';
import { demoRawRoute } from './geo/demoRoute';
import { buildRouteData, pathFromRoute, realKmAt, type RawRoute, type RouteData } from './geo/route';
import { isOffline, planTrip, searchAnywhere } from './offline/planner';
import { tripCache } from './offline/tripCache';
import { registerServiceWorker } from './offline/registerSw';
import { showClassics, showSavedTrips } from './ui/tripScreens';
import {
  buyFuel,
  clearSave,
  FUEL_PRICE,
  loadGame,
  MAX_HEALTH,
  newGame,
  PLACE_TITLES,
  repair,
  repairCost,
  saveGame,
  search,
  TANK,
  type ActionResult,
  type GameState,
} from './game/state';
import { STOP_TITLES, type PlaceKind, type Stop } from './game/stops';
import { BOOST_FUEL, boost, createCombat, horn, WEAPONS, type CombatState, type WeaponKind } from './game/combat';
import type { GameScene } from './scenes/common';
import { DriveScene } from './scenes/DriveScene';
import { CombatScene } from './scenes/CombatScene';
import { clearUi, fmtKm, h, ui } from './ui/dom';
import { Minimap } from './ui/minimap';
import { sound } from './audio/sound';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));

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
    renderer.render(active.scene, active.camera);
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
      isOffline() && h('div', { class: 'offline-badge' }, 'Offline: classic, saved and atlas trips still work'),
      h('p', { class: 'fine' }, 'Maps © OpenStreetMap contributors. Routing by OSRM. Offline atlas from Natural Earth.'),
    ),
  );
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
  const s = newGame(route);
  const p = pathFromRoute(route);
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
        h('li', {}, 'Green dots have gas pumps. Your tank lasts about a third of the trip.'),
      ),
      note && h('p', { class: 'note' }, note),
      h('button', { class: 'btn primary', onclick: () => startTrip(s) }, 'Hit the road'),
      h('button', { class: 'btn ghost', onclick: back }, back === showSetup ? '← Pick different places' : '← Back'),
      h('p', { class: 'fine' }, route.attribution),
    ),
  );
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
  disposeAll();
  state = s;
  path = pathFromRoute(s.route);
  saveGame(s);
  drive = new DriveScene(s, path, {
    onEncounter: () => startCombat(false),
    onArrive: () => setTimeout(showEnd, 600),
    onOutOfFuel: () => setTimeout(showEnd, 600),
    onPrompt: (stop, dist) => updatePrompt(stop, dist),
    onEnterStop: (stop) => showStop(stop),
    onLandmark: (l) => showLandmarkToast(l),
    onTick: () => hudTick?.(),
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
      h('strong', {}, `${STOP_TITLES[stop.kind]} · ${stop.name}`),
      h('span', {}, ` on the ${stop.side} `),
      h('span', { class: 'dist' }, `in ${distText}`),
      h('div', { class: 'muted' }, stop.places.map((p) => PLACE_TITLES[p]).join(' · ')),
    ),
    h(
      'div',
      { class: 'row' },
      !right && h('button', { class: 'btn turn', onclick: () => chooseTurn(stop) }, '◀ Turn left'),
      h('button', { class: 'btn ghost', onclick: () => drive?.skipStop(stop) }, 'Keep driving'),
      right && h('button', { class: 'btn turn', onclick: () => chooseTurn(stop) }, 'Turn right ▶'),
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
function showLandmarkToast(l: Landmark): void {
  const verb = l.kind === 'river' ? 'Crossing' : l.kind === 'citysign' ? '' : 'Passing';
  showToast(LANDMARK_ICONS[l.kind], verb ? `${verb} · ${LANDMARK_TITLES[l.kind]}` : LANDMARK_TITLES[l.kind], l.name);
}

function showToast(icon: string, small: string, big: string): void {
  const el = document.querySelector('.landmark-toast');
  if (!el) return;
  el.replaceChildren(h('span', { class: 'icon' }, icon), h('div', {}, h('small', {}, small), h('strong', {}, big)));
  el.classList.remove('show');
  void (el as HTMLElement).offsetWidth;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 3500);
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
  promptEl = h('div', { class: 'prompt' });
  promptFor = null;
  ui().append(
    h(
      'div',
      { class: 'hud' },
      h('div', { class: 'landmark-toast' }),
      h('div', { class: 'hud-top' }, h('div', { class: 'stats' }, fuel.el, hp.el, inv), h('div', { class: 'side' }, map.canvas, h('div', { class: 'row' }, radioBtn, speedBtn, menuBtn))),
      h('div', { class: 'hud-bottom' }, promptEl, progress, progressText),
    ),
  );
  let lastInv = '';
  let frameCount = 0;
  hudTick = () => {
    fuel.set(s.inv.fuel, TANK);
    hp.set(s.health, MAX_HEALTH);
    const key = JSON.stringify(s.inv);
    if (key !== lastInv) {
      inv.replaceChildren(inventoryLine(s));
      lastInv = key;
    }
    (progress.firstChild as HTMLElement).style.width = `${(s.distance / p.length) * 100}%`;
    const left = realKmAt(s.route, p.length - s.distance);
    progressText.textContent = `${fmtKm(left)} to ${s.route.endLabel.split(',')[0]}`;
    if (frameCount++ % 10 === 0) map.draw(s.distance, s.passed);
  };
  hudTick();
}

function showPauseMenu(): void {
  if (!drive) return;
  drive.paused = true;
  const close = () => {
    overlay.remove();
    drive!.paused = false;
  };
  const overlay = h(
    'div',
    { class: 'modal' },
    h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Paused'),
      h('p', {}, `Encounters survived: ${state!.encounters} · Kills: ${state!.kills}`),
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

// --------------------------------------------------------------- explore a stop

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
    fuel.set(s.inv.fuel, TANK);
    hp.set(s.health, MAX_HEALTH);
    invEl.replaceChildren(inventoryLine(s));
    cards.replaceChildren(...stop.places.map(placeCard));
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
      const want = Math.max(0, Math.floor(TANK - s.inv.fuel));
      actions.push(h('button', { class: 'btn small primary', onclick: () => say(buyFuel(s)), disabled: want === 0 }, `Fill up ($${Math.min(want * FUEL_PRICE, Math.floor(s.inv.cash / FUEL_PRICE) * FUEL_PRICE)})`));
    }
    if (place === 'garage') {
      const cost = repairCost(s);
      actions.push(
        h('button', { class: 'btn small primary', onclick: () => say(repair(s)), disabled: cost.hp === 0 }, cost.hp ? `Repair (${cost.scrap} scrap or $${cost.cash})` : 'Car is fine'),
      );
    }
    actions.push(h('button', { class: 'btn small', onclick: () => say(search(s, stop.id, place)) }, n === 0 ? 'Search' : `Search again (${n === 1 ? 'risky' : 'very risky'})`));
    return h('div', { class: `place ${place}` }, h('h3', {}, PLACE_TITLES[place]), h('div', { class: 'row' }, ...actions));
  };
  const cards = h('div', { class: 'places' });
  ui().append(
    h(
      'div',
      { class: 'screen explore' },
      h('h2', {}, `${stop.name}`, h('small', {}, ` ${STOP_TITLES[stop.kind]}`)),
      meters,
      invEl,
      cards,
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

// --------------------------------------------------------------- combat

function startCombat(ambush: boolean, stop?: Stop): void {
  const s = state!;
  sound.stopMusic();
  const c = createCombat({ seed: s.seed + s.encounters * 31 + (ambush ? 7 : 0) + Math.floor(s.distance), progress: s.distance / path!.length, ambush });
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
  const esc = bar('escape', '🏁');
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
      h('div', { class: 'banner' }, c.title, h('small', {}, 'Tap or hold on enemies to shoot. Survive or wipe them out.')),
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
    hp.set(s.health, MAX_HEALTH);
    esc.set(c.escape, c.escapeAt, `${c.enemies.length + c.queue.length} left`);
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
  saveGame(s);
  ui().append(
    h(
      'div',
      { class: 'modal' },
      h(
        'div',
        { class: 'card' },
        h('h2', {}, outcome === 'cleared' ? 'Wiped them out!' : 'You got away!'),
        h('p', {}, `${c.kills} taken down. Car at ${Math.round(s.health)}%.`),
        found.length > 0 && h('p', {}, `Picked up ${found.join(', ')}.`),
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
          stop ? `Back to ${stop.name}` : 'Keep driving',
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
      ),
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
