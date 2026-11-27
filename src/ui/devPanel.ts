import { BUILD } from '../build';
import { clearMapLog, formatMapLog, mapLog } from '../geo/mapLog';
import { devClock, WEATHER_INFO, type Weather } from '../game/time';
import { devGfx, quality } from '../scenes/quality';

/**
 * A test panel for checking the look at any hour and in any weather without
 * waiting for it: open the game with ?dev=1 (remembered until ?dev=0). The
 * 🛠 button at the top opens it.
 */
const TEST_BOSSES: [string, string][] = [
  ['🧟 Earl', 'brute'],
  ['🚚 War rig', 'warrig'],
  ['🧔 Hermit', 'hermit'],
  ['🍕 Pizza', 'pizza'],
  ['🧹 Sweeper', 'sweeper'],
  ['👵 Karen', 'karen'],
  ['✈️ Drones', 'drones'],
  ['👑 Cat Queen', 'queen'],
];

/** `applyGfx` re-applies the graphics settings after a switch changes them. */
export function mountDevPanel(applyGfx: () => void = () => undefined): void {
  const params = new URLSearchParams(location.search);
  const q = params.get('dev');
  // A test trip (?test=...) always brings the panel.
  let on = q === '1' || (params.has('test') && params.get('test') !== '0') || params.has('boss');
  try {
    if (q === '1') localStorage.setItem('rtm-dev', '1');
    if (q === '0') localStorage.removeItem('rtm-dev');
    on ||= localStorage.getItem('rtm-dev') === '1';
  } catch {
    /* storage blocked */
  }
  if (!on) return;

  const css = document.createElement('style');
  css.textContent = `
.devp-btn{position:fixed;top:calc(env(safe-area-inset-top) + 34px);left:50%;transform:translateX(-50%);z-index:9999;font:600 14px system-ui;background:rgba(0,0,0,.7);color:#fff;border:1px solid #fff6;border-radius:18px;padding:4px 12px}
.devp{position:fixed;left:8px;right:8px;top:calc(env(safe-area-inset-top) + 72px);z-index:9999;max-width:420px;margin:0 auto;background:rgba(20,16,12,.92);color:#fff;border-radius:12px;padding:10px 12px;font:14px system-ui;display:none}
.devp.open{display:block}
.devp{max-height:calc(100dvh - 90px);overflow:auto}
.devp pre{margin:0 0 10px;max-height:180px;overflow:auto;background:#0006;border-radius:8px;padding:6px 8px;font:11px/1.35 ui-monospace,monospace;white-space:pre-wrap;word-break:break-word}
.devp h4{margin:0 0 6px;font-size:13px;opacity:.8}
.devp .row{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;align-items:center}
.devp button{font:600 13px system-ui;background:#3a3028;color:#fff;border:1px solid #fff3;border-radius:8px;padding:6px 9px}
.devp button.on{background:#e8a33a;color:#1b1410}
.devp input[type=range]{flex:1;min-width:160px}
.devp .val{min-width:64px;text-align:right;font-variant-numeric:tabular-nums}`;
  document.head.append(css);

  const btn = document.createElement('button');
  btn.className = 'devp-btn';
  btn.textContent = `🛠 Test · build ${BUILD.number}`;
  const panel = document.createElement('div');
  panel.className = 'devp';
  btn.onclick = () => {
    panel.classList.toggle('open');
    paintLog();
  };

  const fmt = (h: number) => {
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
  };

  // Time of day.
  const tHead = document.createElement('h4');
  tHead.textContent = 'Time of day';
  const tRow = document.createElement('div');
  tRow.className = 'row';
  const live = document.createElement('button');
  live.textContent = 'Trip clock';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '23.75';
  slider.step = '0.25';
  slider.value = '12';
  const val = document.createElement('span');
  val.className = 'val';
  const quick = [['Dawn', 6.2], ['Noon', 12], ['Dusk', 18.2], ['Night', 22]] as const;
  const quickBtns = quick.map(([label, h]) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => setHour(h);
    return b;
  });
  const setHour = (h: number | null) => {
    devClock.hour = h;
    if (h != null) slider.value = String(h);
    val.textContent = h == null ? 'trip' : fmt(h);
    live.classList.toggle('on', h == null);
    quickBtns.forEach((b, i) => b.classList.toggle('on', h === quick[i][1]));
  };
  slider.oninput = () => setHour(Number(slider.value));
  live.onclick = () => setHour(null);
  tRow.append(live, ...quickBtns);
  const sRow = document.createElement('div');
  sRow.className = 'row';
  sRow.append(slider, val);

  // Weather.
  const wHead = document.createElement('h4');
  wHead.textContent = 'Weather';
  const wRow = document.createElement('div');
  wRow.className = 'row';
  const options: (Weather | null)[] = [null, ...(Object.keys(WEATHER_INFO) as Weather[])];
  const wBtns = options.map((w) => {
    const b = document.createElement('button');
    b.textContent = w ? `${WEATHER_INFO[w].icon} ${WEATHER_INFO[w].name}` : 'Trip weather';
    b.onclick = () => setWeather(w);
    return b;
  });
  const setWeather = (w: Weather | null) => {
    devClock.weather = w;
    wBtns.forEach((b, i) => b.classList.toggle('on', options[i] === w));
  };
  wRow.append(...wBtns);

  // Graphics switches, to see what each effect costs on this phone (watch the ?perf=1 box).
  const gHead = document.createElement('h4');
  gHead.textContent = 'Graphics (resets on reload)';
  const gRow = document.createElement('div');
  gRow.className = 'row';
  const choices: { label: string; set: () => void; on: () => boolean }[] = [
    { label: 'Glow + grade', set: () => (devGfx.post = !quality.profile.bloom), on: () => quality.profile.bloom },
    ...[1, 1.5, 2].map((r) => ({ label: `Sharp ${r}x`, set: () => (devGfx.ratio = r), on: () => quality.profile.pixelRatio === r })),
  ];
  const gBtns = choices.map((c) => {
    const b = document.createElement('button');
    b.textContent = c.label;
    b.onclick = () => {
      c.set();
      applyGfx();
      paintGfx();
    };
    return b;
  });
  const paintGfx = () => gBtns.forEach((b, i) => b.classList.toggle('on', choices[i].on()));
  gRow.append(...gBtns);
  paintGfx();

  // Test trips: a short made-up road straight to one thing (src/game/testTrip.ts). Each button reloads the page.
  const xHead = document.createElement('h4');
  xHead.textContent = 'Test trips (nothing is saved)';
  const xRow = document.createElement('div');
  xRow.className = 'row';
  const go = (label: string, query: string) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => location.assign(`${location.pathname}?dev=1&${query}`);
    return b;
  };
  xRow.append(
    ...TEST_BOSSES.map(([label, id]) => go(label, `test=boss&boss=${id}`)),
    go('🏘️ Town', 'test=town'),
    go('🔧 Garage (bike)', 'test=garage&ride=motorcycle'),
    go('🚲 Bike rescue', 'test=bike'),
    go('⛽ Gas out in turn', 'test=gasturn'),
    go('🧍 Hitchhiker', 'test=event&event=hitchhiker'),
    go('🧟 Horde', 'test=fight&enemy=zombies&horde=1'),
    go('🤠 Outlaws', 'test=fight&enemy=outlaws'),
    go('🐱 Cats', 'test=fight&enemy=cats'),
  );

  // Map lookups (local streets, towns, street names): kept on the phone, newest first (src/geo/mapLog.ts).
  const lHead = document.createElement('h4');
  lHead.textContent = 'Map lookups (kept on this phone)';
  const lRow = document.createElement('div');
  lRow.className = 'row';
  const logBox = document.createElement('pre');
  const logText = () => formatMapLog(mapLog().reverse());
  function paintLog() {
    logBox.textContent = logText() || 'No lookups yet. Plan a trip from a real place.';
  }
  const lBtn = (label: string, act: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = act;
    return b;
  };
  const flash = (b: HTMLButtonElement, text: string) => {
    const was = b.textContent;
    b.textContent = text;
    setTimeout(() => (b.textContent = was), 1500);
  };
  const header = () => `Road Trip Madness build ${BUILD.number}, map lookup log, ${new Date().toString()}\n${navigator.userAgent}\n\n`;
  const copyBtn = lBtn('📋 Copy', () => {
    const text = header() + logText();
    navigator.clipboard?.writeText(text).then(
      () => flash(copyBtn, '✓ Copied'),
      () => {
        // No clipboard access: select the text so it can be copied by hand.
        const r = document.createRange();
        r.selectNodeContents(logBox);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(r);
        flash(copyBtn, 'Selected');
      },
    ) ?? flash(copyBtn, 'No clipboard');
  });
  const saveBtn = lBtn('💾 Download', () => {
    const url = URL.createObjectURL(new Blob([header() + logText() + '\n'], { type: 'text/plain' }));
    const a = document.createElement('a');
    const d = new Date();
    a.href = url;
    a.download = `rtm-map-log-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.txt`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
  lRow.append(
    lBtn('🔄 Refresh', paintLog),
    copyBtn,
    saveBtn,
    lBtn('🗑 Clear', () => {
      clearMapLog();
      paintLog();
    }),
  );
  paintLog();

  panel.append(tHead, tRow, sRow, wHead, wRow, gHead, gRow, xHead, xRow, lHead, lRow, logBox);
  document.body.append(btn, panel);
  document.body.classList.add('devp-on');
  // A test trip's &time= and &weather= are already set; show them.
  setHour(devClock.hour);
  setWeather(devClock.weather);
}
