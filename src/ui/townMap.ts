import type { PlaceKind, Stop } from '../game/stops';
import { PLACE_TITLES } from '../game/state';
import { hashString, makeRng } from '../game/rng';

const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

export const PLACE_ICONS: Record<PlaceKind, string> = {
  pumps: '⛽',
  garage: '🔧',
  grocery: '🛒',
  hardware: '🔨',
  gunshop: '🔫',
  pharmacy: '💊',
  police: '🚓',
  junkyard: '♻️',
  barn: '🌾',
  motel: '🛏️',
};

const ROOF: Record<PlaceKind, string> = {
  pumps: '#d13b2c',
  garage: '#4b6e8f',
  grocery: '#3f8a4a',
  hardware: '#b8742c',
  gunshop: '#5a4632',
  pharmacy: '#3f9fb0',
  police: '#2c3f8f',
  junkyard: '#7a6a55',
  barn: '#a33a2a',
  motel: '#a04d8f',
};

/** Slots for buildings: x, y of the top-left corner, and which side of the street the door faces. */
const SLOTS: [number, number][] = [
  [28, 34],
  [212, 34],
  [28, 112],
  [212, 112],
  [28, 178],
  [212, 178],
];
const W = 120;
const H = 52;
const STREET_X = 180;
const PARK: [number, number] = [STREET_X, 222];

/**
 * A little top-down map of a stop. The player taps a building, a figure
 * walks over from the car, and then that place's actions open.
 */
export class TownMap {
  readonly svg: SVGSVGElement;
  private buildings = new Map<PlaceKind, SVGGElement>();
  private walker: SVGGElement;
  private walkerPos: [number, number] = [PARK[0] + 14, PARK[1] - 6];
  private selected: PlaceKind | null = null;

  constructor(
    private stop: Stop,
    night: boolean,
    private onArrive: (place: PlaceKind) => void,
  ) {
    const rng = makeRng(hashString(stop.id + stop.name));
    const rural = stop.kind === 'farm' || stop.kind === 'base';
    this.svg = el('svg', { viewBox: '0 0 360 250', class: `town-map ${night ? 'night' : ''}`, role: 'img', 'aria-label': `Map of ${stop.name}` });
    const ground = rural ? '#8aa05a' : stop.kind === 'gas' || stop.kind === 'truckstop' ? '#c9a46e' : '#b9ad96';
    el('rect', { x: 0, y: 0, width: 360, height: 250, fill: ground }, this.svg);
    if (rural) {
      // Crop rows.
      for (let i = 0; i < 9; i++) el('rect', { x: 0, y: 8 + i * 26, width: 360, height: 8, fill: '#7b8f4c', opacity: 0.5 }, this.svg);
    }
    // Highway along the bottom and the street up the middle.
    el('rect', { x: 0, y: 236, width: 360, height: 14, fill: '#3a3a3f' }, this.svg);
    el('line', { x1: 0, y1: 243, x2: 360, y2: 243, stroke: '#f2c230', 'stroke-width': 1.5, 'stroke-dasharray': '10 8' }, this.svg);
    el('rect', { x: STREET_X - 12, y: 14, width: 24, height: 224, fill: '#55555b' }, this.svg);
    el('line', { x1: STREET_X, y1: 18, x2: STREET_X, y2: 232, stroke: '#e8e2cf', 'stroke-width': 1, 'stroke-dasharray': '6 6' }, this.svg);
    // Decorations: trees or cacti, scattered away from the buildings.
    for (let i = 0; i < 16; i++) {
      const x = rng() * 360;
      const y = 8 + rng() * 220;
      if (Math.abs(x - STREET_X) < 22) continue;
      if (SLOTS.slice(0, stop.places.length).some(([sx, sy]) => x > sx - 6 && x < sx + W + 6 && y > sy - 6 && y < sy + H + 6)) continue;
      el('circle', { cx: x, cy: y, r: 4 + rng() * 4, fill: rural ? '#3f6b2f' : '#5d7a42', opacity: 0.9 }, this.svg);
    }
    stop.places.forEach((p, i) => this.addBuilding(p, SLOTS[i % SLOTS.length]));
    // The car, parked.
    const car = el('g', { transform: `translate(${PARK[0] - 7}, ${PARK[1] - 12})` }, this.svg);
    el('rect', { x: 0, y: 0, width: 14, height: 22, rx: 3, fill: '#d9482b', stroke: '#2a1404', 'stroke-width': 1 }, car);
    el('rect', { x: 2, y: 5, width: 10, height: 6, fill: '#8fc6e8' }, car);
    // The walker.
    this.walker = el('g', { class: 'walker' }, this.svg);
    el('circle', { cx: 0, cy: 0, r: 5, fill: '#ffd23f', stroke: '#2a1404', 'stroke-width': 1.5 }, this.walker);
    this.moveWalker(...this.walkerPos);
  }

  private door(place: PlaceKind): [number, number] {
    const i = this.stop.places.indexOf(place);
    const [x, y] = SLOTS[i % SLOTS.length];
    const left = x < STREET_X;
    return [left ? x + W + 4 : x - 4, y + H / 2];
  }

  private addBuilding(place: PlaceKind, [x, y]: [number, number]): void {
    const g = el('g', { class: 'building', tabindex: 0, role: 'button', 'aria-label': PLACE_TITLES[place] }, this.svg);
    el('rect', { x: x + 3, y: y + 4, width: W, height: H, rx: 4, fill: '#000', opacity: 0.25 }, g);
    el('rect', { x, y, width: W, height: H, rx: 4, fill: ROOF[place], class: 'roof' }, g);
    el('rect', { x: x + 4, y: y + 4, width: W - 8, height: H - 8, rx: 3, fill: 'none', stroke: '#ffffff', 'stroke-opacity': 0.25 }, g);
    if (place === 'pumps') {
      for (let k = 0; k < 3; k++) el('rect', { x: x + 14 + k * 34, y: y + H + 4, width: 8, height: 10, fill: '#eee' }, g);
    }
    const icon = el('text', { x: x + 20, y: y + H / 2 + 7, 'font-size': 20, 'text-anchor': 'middle' }, g);
    icon.textContent = PLACE_ICONS[place];
    const label = el('text', { x: x + 36, y: y + H / 2 + 5, 'font-size': 11, 'font-weight': 700, fill: '#fff' }, g);
    label.textContent = PLACE_TITLES[place];
    el('text', { x: x + W - 8, y: y + 14, 'font-size': 11, 'text-anchor': 'end', fill: '#fff', class: 'badge' }, g);
    const [dx, dy] = this.door(place);
    el('rect', { x: dx - 3, y: dy - 6, width: 6, height: 12, fill: '#2a1404' }, g);
    g.addEventListener('click', () => this.walkTo(place));
    g.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') this.walkTo(place);
    });
    this.buildings.set(place, g);
  }

  /** Marks how picked-over each building is. */
  setSearches(counts: Partial<Record<PlaceKind, number>>): void {
    for (const [place, g] of this.buildings) {
      const n = counts[place] ?? 0;
      const badge = g.querySelector('.badge')!;
      badge.textContent = n === 0 ? '' : n === 1 ? '✓ searched' : '⚠ picked over';
      g.classList.toggle('risky', n >= 1);
      g.classList.toggle('selected', place === this.selected);
    }
  }

  private moveWalker(x: number, y: number): void {
    this.walkerPos = [x, y];
    this.walker.setAttribute('transform', `translate(${x}, ${y})`);
  }

  /** Walks along the street to a building's door, then calls onArrive. */
  walkTo(place: PlaceKind): void {
    this.selected = place;
    for (const [p, g] of this.buildings) g.classList.toggle('selected', p === place);
    const [tx, ty] = this.door(place);
    const [sx, sy] = this.walkerPos;
    const pts: [number, number][] = [[sx, sy], [STREET_X + (sx < STREET_X ? -6 : 6), sy], [STREET_X + (tx < STREET_X ? -6 : 6), ty], [tx, ty]];
    const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
    const total = lens.reduce((a, b) => a + b, 0) || 1;
    const dur = Math.min(900, 250 + total * 3);
    const start = performance.now();
    const step = (now: number) => {
      let d = Math.min(1, (now - start) / dur) * total;
      let i = 0;
      while (i < lens.length - 1 && d > lens[i]) d -= lens[i++];
      const t = lens[i] ? Math.min(1, d / lens[i]) : 1;
      this.moveWalker(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t);
      if (now - start < dur) requestAnimationFrame(step);
      else this.onArrive(place);
    };
    requestAnimationFrame(step);
  }
}
