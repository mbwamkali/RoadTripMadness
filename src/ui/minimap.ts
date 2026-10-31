import type { Path } from '../geo/geo';
import type { Stop } from '../game/stops';

/** Small overview map of the whole trip with the car's position. */
export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private pts: { x: number; y: number }[] = [];
  private bounds = { minX: 0, minY: 0, scale: 1, ox: 0, oy: 0 };

  constructor(
    private path: Path,
    private stops: Stop[],
    size = 120,
  ) {
    this.canvas = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    this.canvas.className = 'minimap';
    const step = Math.max(1, Math.floor(path.points.length / 400));
    for (let i = 0; i < path.points.length; i += step) this.pts.push(path.points[i]);
    this.pts.push(path.points[path.points.length - 1]);
    const xs = this.pts.map((p) => p.x);
    const ys = this.pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const w = Math.max(...xs) - minX || 1;
    const hgt = Math.max(...ys) - minY || 1;
    const pad = 10 * dpr;
    const scale = (this.canvas.width - pad * 2) / Math.max(w, hgt);
    this.bounds = { minX, minY, scale, ox: pad + ((this.canvas.width - pad * 2) - w * scale) / 2, oy: pad + ((this.canvas.height - pad * 2) - hgt * scale) / 2 };
  }

  private map(p: { x: number; y: number }): [number, number] {
    const b = this.bounds;
    return [b.ox + (p.x - b.minX) * b.scale, this.canvas.height - (b.oy + (p.y - b.minY) * b.scale)];
  }

  draw(distance: number, passed: string[]): void {
    const g = this.canvas.getContext('2d')!;
    const dpr = this.canvas.width / parseFloat(this.canvas.style.width);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.lineJoin = 'round';
    g.lineWidth = 3 * dpr;
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    this.pts.forEach((p, i) => (i ? g.lineTo(...this.map(p)) : g.moveTo(...this.map(p))));
    g.stroke();
    // Travelled part.
    g.strokeStyle = '#ffb347';
    g.beginPath();
    const n = Math.max(1, Math.round((distance / this.path.length) * (this.pts.length - 1)));
    for (let i = 0; i <= n && i < this.pts.length; i++) (i ? g.lineTo(...this.map(this.pts[i])) : g.moveTo(...this.map(this.pts[i])));
    g.stroke();
    for (const s of this.stops) {
      const [x, y] = this.map(this.path.pointAt(s.at));
      g.fillStyle = passed.includes(s.id) ? 'rgba(255,255,255,0.3)' : s.places.includes('pumps') ? '#4fd17a' : '#7fb8ff';
      g.beginPath();
      g.arc(x, y, 3 * dpr, 0, Math.PI * 2);
      g.fill();
    }
    const [ex, ey] = this.map(this.path.pointAt(this.path.length));
    g.fillStyle = '#ff4d4d';
    g.fillRect(ex - 4 * dpr, ey - 4 * dpr, 8 * dpr, 8 * dpr);
    const [cx, cy] = this.map(this.path.pointAt(distance));
    g.fillStyle = '#fff';
    g.strokeStyle = '#000';
    g.lineWidth = 2 * dpr;
    g.beginPath();
    g.arc(cx, cy, 5 * dpr, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
}
