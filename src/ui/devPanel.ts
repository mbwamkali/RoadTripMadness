import { BUILD } from '../build';
import { devClock, WEATHER_INFO, type Weather } from '../game/time';

/**
 * A test panel for checking the look at any hour and in any weather without
 * waiting for it: open the game with ?dev=1 (remembered until ?dev=0). The
 * 🛠 button at the top opens it.
 */
export function mountDevPanel(): void {
  const q = new URLSearchParams(location.search).get('dev');
  let on = q === '1';
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
  btn.onclick = () => panel.classList.toggle('open');

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

  panel.append(tHead, tRow, sRow, wHead, wRow);
  document.body.append(btn, panel);
  setHour(null);
  setWeather(null);
}
