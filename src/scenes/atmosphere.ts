import * as THREE from 'three';
import { daylight, type Weather } from '../game/time';

/**
 * Sky colour, fog, sun/moon light, headlights and falling weather particles.
 * Shared by the driving and combat views.
 */
export class Atmosphere {
  private hemi = new THREE.HemisphereLight(0xfff6e0, 0x8a6a45, 1.6);
  private sun = new THREE.DirectionalLight(0xffffff, 1.8);
  private headlight: THREE.SpotLight;
  private particles: THREE.Points | null = null;
  private particleKind: Weather = 'clear';
  private sky = new THREE.Color();
  private stars: THREE.Points;
  private weather: Weather = 'clear';
  private light = 1;
  /** Fog never closes in further than this (combat needs to see the enemies). */
  minFogFar = 0;
  /** Fog distances for clear daytime; weather and night pull them in. */
  constructor(
    private scene: THREE.Scene,
    private daySky: number,
    private fogNear: number,
    private fogFar: number,
  ) {
    this.sun.position.set(40, 80, 30);
    scene.add(this.hemi, this.sun, this.sun.target);
    scene.fog = new THREE.Fog(daySky, fogNear, fogFar);
    scene.background = this.sky;
    this.headlight = new THREE.SpotLight(0xfff1c8, 0, 140, 0.5, 0.45, 1);
    this.stars = makeStars();
    scene.add(this.stars);
  }

  /** Mounts the headlight on a car (it follows the car and points ahead). */
  attachHeadlights(car: THREE.Object3D): void {
    this.headlight.position.set(0, 1.2, 1.8);
    this.headlight.target.position.set(0, 0, 30);
    car.add(this.headlight, this.headlight.target);
  }

  set(hour: number, weather: Weather): void {
    const d = daylight(hour);
    this.light = d;
    this.weather = weather;
    const night = new THREE.Color(0x0b1026);
    const dusk = new THREE.Color(0xe0784a);
    const day = new THREE.Color(this.daySky);
    // Dawn and dusk get an orange band between night and day.
    const sky = d < 0.5 ? night.clone().lerp(dusk, d * 2) : dusk.clone().lerp(day, (d - 0.5) * 2);
    const tint: Record<Weather, number> = { clear: 0, rain: 0.45, dust: 0.55, fog: 0.6, snow: 0.5 };
    const tintColor: Record<Weather, number> = { clear: 0, rain: 0x5a6470, dust: 0xc28a4a, fog: 0xb8bcc0, snow: 0xd8dde6 };
    if (weather !== 'clear') sky.lerp(new THREE.Color(tintColor[weather]).multiplyScalar(0.3 + d * 0.7), tint[weather]);
    this.sky.copy(sky);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(sky);
    const fogScale: Record<Weather, number> = { clear: 1, rain: 0.55, dust: 0.25, fog: 0.18, snow: 0.4 };
    const nightScale = 0.55 + d * 0.45;
    fog.near = this.fogNear * fogScale[weather] * nightScale * 0.6;
    fog.far = Math.max(this.minFogFar, this.fogFar * fogScale[weather] * nightScale);
    fog.near = Math.min(fog.near, fog.far * 0.5);
    this.hemi.intensity = 0.25 + d * 1.35 - (weather === 'clear' ? 0 : 0.2);
    this.hemi.color.setHex(d < 0.3 ? 0x8090c0 : 0xfff6e0);
    this.sun.intensity = 0.1 + d * 1.7 * (weather === 'clear' ? 1 : 0.5);
    this.sun.color.copy(d < 0.6 ? new THREE.Color(0xffb070).lerp(new THREE.Color(0xffffff), d) : new THREE.Color(0xffffff));
    this.headlight.intensity = d < 0.5 ? (1 - d * 2) * 90 : 0;
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - d * 3) * (weather === 'clear' ? 1 : 0.2);
    this.stars.visible = d < 0.35;
  }

  /** Moves particles and stars with the camera. */
  update(dt: number, camera: THREE.Camera): void {
    this.stars.position.copy(camera.position);
    const want: Weather = this.weather === 'rain' || this.weather === 'snow' || this.weather === 'dust' ? this.weather : 'clear';
    if (want !== this.particleKind) {
      if (this.particles) {
        this.scene.remove(this.particles);
        this.particles.geometry.dispose();
        (this.particles.material as THREE.Material).dispose();
        this.particles = null;
      }
      this.particleKind = want;
      if (want !== 'clear') {
        this.particles = makeParticles(want);
        this.scene.add(this.particles);
      }
    }
    const p = this.particles;
    if (!p) return;
    p.position.copy(camera.position);
    const pos = p.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const fall = want === 'rain' ? 45 : want === 'snow' ? 4 : 1.5;
    const drift = want === 'dust' ? 30 : want === 'snow' ? 2 : 3;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] -= fall * dt;
      arr[i] += drift * dt * (want === 'snow' ? Math.sin(i + arr[i + 1]) : 1);
      if (arr[i + 1] < -12) arr[i + 1] += 40;
      if (arr[i] > 40) arr[i] -= 80;
      if (arr[i] < -40) arr[i] += 80;
    }
    pos.needsUpdate = true;
    (p.material as THREE.PointsMaterial).opacity = want === 'rain' ? 0.35 + this.light * 0.3 : 0.8;
  }

  dispose(): void {
    if (this.particles) {
      this.particles.geometry.dispose();
      (this.particles.material as THREE.Material).dispose();
    }
    this.stars.geometry.dispose();
    (this.stars.material as THREE.Material).dispose();
  }
}

function makeParticles(kind: Weather): THREE.Points {
  const n = kind === 'rain' ? 1800 : kind === 'snow' ? 1200 : 900;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 80;
    pos[i * 3 + 1] = Math.random() * 40 - 12;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 80;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const color = kind === 'rain' ? 0xaebfd0 : kind === 'snow' ? 0xffffff : 0xd9a066;
  const size = kind === 'rain' ? 0.14 : kind === 'snow' ? 0.3 : 0.22;
  const mat = new THREE.PointsMaterial({ color, size, map: dotTexture(), transparent: true, opacity: 0.6, depthWrite: false, fog: false });
  const p = new THREE.Points(geo, mat);
  p.frustumCulled = false;
  return p;
}

let dotTex: THREE.CanvasTexture | null = null;
/** Soft round dot so particles aren't drawn as squares. */
function dotTexture(): THREE.CanvasTexture {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

function makeStars(): THREE.Points {
  const n = 600;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // Points on the upper half of a big sphere.
    const u = Math.random() * Math.PI * 2;
    const v = Math.random() * 0.45 * Math.PI;
    pos[i * 3] = Math.cos(u) * Math.cos(v) * 1800;
    pos[i * 3 + 1] = Math.sin(v) * 1800 + 60;
    pos[i * 3 + 2] = Math.sin(u) * Math.cos(v) * 1800;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  p.frustumCulled = false;
  return p;
}
