import * as THREE from 'three';
import { daylight, type Weather } from '../game/time';

const TINT: Record<Weather, number> = { clear: 0, rain: 0.45, dust: 0.55, fog: 0.6, snow: 0.5 };
const TINT_COLOR: Record<Weather, number> = { clear: 0x000000, rain: 0x5a6470, dust: 0xc28a4a, fog: 0xb8bcc0, snow: 0xd8dde6 };
const FOG_SCALE: Record<Weather, number> = { clear: 1, rain: 0.55, dust: 0.25, fog: 0.18, snow: 0.4 };
const NIGHT = new THREE.Color(0x0b1026);
const DUSK = new THREE.Color(0xe0784a);
const WARM_SUN = new THREE.Color(0xffb070);
const WHITE = new THREE.Color(0xffffff);
/** Seconds for weather to blend from one kind to the next. */
const WEATHER_BLEND = 4;

/** Where the sun (or, at night, the moon) is in the sky for an hour of the day. */
export function sunDirection(hour: number, out = new THREE.Vector3()): THREE.Vector3 {
  const night = hour < 6 || hour >= 18;
  // The moon follows the same arc twelve hours later.
  const h = night ? (hour + 12) % 24 : hour;
  const a = ((h - 6) / 12) * Math.PI;
  // Rises in the east (+x), sets in the west, a little to the south.
  return out.set(Math.cos(a), Math.max(0.08, Math.sin(a)) * (night ? 0.8 : 1), -0.35).normalize();
}

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = `
uniform vec3 horizon;
uniform vec3 zenith;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform float sunSize;
uniform float glow;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float up = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(horizon, zenith, pow(up, 0.55));
  // Below the horizon the sky just keeps the horizon colour (it meets the fog).
  if (d.y < 0.0) col = horizon;
  float s = max(dot(d, sunDir), 0.0);
  col += sunColor * glow * pow(s, 8.0) * 0.35;
  col += sunColor * smoothstep(1.0 - sunSize, 1.0 - sunSize * 0.6, s);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/**
 * Sky dome, fog, sun/moon light and shadows, headlights and falling weather
 * particles. Shared by the driving and combat views. Changes to the hour and
 * weather blend in smoothly every frame.
 */
export class Atmosphere {
  private hemi = new THREE.HemisphereLight(0xfff6e0, 0x8a6a45, 1.6);
  private sun = new THREE.DirectionalLight(0xffffff, 1.8);
  private headlight: THREE.SpotLight;
  private particles: THREE.Points | null = null;
  private particleKind: Weather = 'clear';
  private sky = new THREE.Color();
  private stars: THREE.Points;
  private dome: THREE.Mesh;
  private domeMat: THREE.ShaderMaterial;
  private weather: Weather = 'clear';
  private hour = 12;
  private light = 1;
  /** Blended weather: how much of the tint colour shows, the tint colour, fog scale and how clear it is. */
  private tint = 0;
  private tintColor = new THREE.Color();
  private fogScale = 1;
  private clearness = 1;
  private started = false;
  private sunDir = new THREE.Vector3(0, 1, 0);
  private tmp = new THREE.Color();
  /** Fog never closes in further than this (combat needs to see the enemies). */
  minFogFar = 0;
  /** Fog distances for clear daytime; weather and night pull them in. */
  constructor(
    private scene: THREE.Scene,
    public daySky: number,
    private fogNear: number,
    private fogFar: number,
    shadows: { size: number; range: number } | null = null,
  ) {
    this.sun.position.set(40, 80, 30);
    scene.add(this.hemi, this.sun, this.sun.target);
    scene.fog = new THREE.Fog(daySky, fogNear, fogFar);
    scene.background = this.sky;
    if (shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(shadows.size, shadows.size);
      const cam = this.sun.shadow.camera;
      cam.left = cam.bottom = -shadows.range;
      cam.right = cam.top = shadows.range;
      cam.near = 1;
      cam.far = 500;
      this.sun.shadow.bias = -0.0008;
      this.sun.shadow.normalBias = 0.4;
    }
    this.headlight = new THREE.SpotLight(0xfff1c8, 0, 140, 0.5, 0.45, 1);
    this.stars = makeStars();
    scene.add(this.stars);
    this.domeMat = new THREE.ShaderMaterial({
      uniforms: {
        horizon: { value: new THREE.Color() },
        zenith: { value: new THREE.Color() },
        sunDir: { value: this.sunDir },
        sunColor: { value: new THREE.Color() },
        sunSize: { value: 0.0005 },
        glow: { value: 1 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.domeMat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);
  }

  /** Mounts the headlight on a car (it follows the car and points ahead). */
  attachHeadlights(car: THREE.Object3D): void {
    this.headlight.position.set(0, 1.2, 1.8);
    this.headlight.target.position.set(0, 0, 30);
    car.add(this.headlight, this.headlight.target);
  }

  /** Sets the hour and weather to show. The first call applies them at once; later ones blend in. */
  set(hour: number, weather: Weather): void {
    this.hour = hour;
    this.weather = weather;
    if (!this.started) {
      this.started = true;
      this.blendWeather(1);
      this.apply();
    }
  }

  private blendWeather(k: number): void {
    const w = this.weather;
    this.tint += (TINT[w] - this.tint) * k;
    // While clearing up, keep the old tint colour so it fades rather than flashing black.
    if (w !== 'clear') this.tintColor.lerp(this.tmp.setHex(TINT_COLOR[w]), this.tint < 0.02 ? 1 : k);
    this.fogScale += (FOG_SCALE[w] - this.fogScale) * k;
    this.clearness += ((w === 'clear' ? 1 : 0) - this.clearness) * k;
  }

  private apply(): void {
    const d = daylight(this.hour);
    this.light = d;
    const sky = this.sky;
    // Dawn and dusk get an orange band between night and day.
    if (d < 0.5) sky.copy(NIGHT).lerp(DUSK, d * 2);
    else sky.copy(DUSK).lerp(this.tmp.setHex(this.daySky), (d - 0.5) * 2);
    if (this.tint > 0.001) sky.lerp(this.tmp.copy(this.tintColor).multiplyScalar(0.3 + d * 0.7), this.tint);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(sky);
    const nightScale = 0.55 + d * 0.45;
    fog.far = Math.max(this.minFogFar, this.fogFar * this.fogScale * nightScale);
    fog.near = Math.min(this.fogNear * this.fogScale * nightScale * 0.6, fog.far * 0.5);
    const clear = this.clearness;
    this.hemi.intensity = 0.25 + d * 1.35 - (1 - clear) * 0.2;
    this.hemi.color.setHex(d < 0.3 ? 0x8090c0 : 0xfff6e0);
    this.sun.intensity = 0.1 + d * 1.7 * (0.5 + clear * 0.5);
    if (d < 0.6) this.sun.color.copy(WARM_SUN).lerp(WHITE, d);
    else this.sun.color.copy(WHITE);
    this.headlight.intensity = d < 0.5 ? (1 - d * 2) * 90 : 0;
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - d * 3) * (0.2 + clear * 0.8);
    this.stars.visible = d < 0.35;
    sunDirection(this.hour, this.sunDir);
    const u = this.domeMat.uniforms;
    (u.horizon.value as THREE.Color).copy(sky);
    // Overhead the sky is deeper; clouds and dust flatten it out.
    (u.zenith.value as THREE.Color).copy(sky).multiplyScalar(0.55 + 0.35 * (1 - clear)).lerp(this.tmp.setHex(0x1d3f8c), 0.25 * d * clear);
    const night = this.hour < 6 || this.hour >= 18;
    (u.sunColor.value as THREE.Color).copy(night ? this.tmp.setHex(0xd8e0f0) : this.sun.color).multiplyScalar(night ? 0.8 : 1.2);
    u.sunSize.value = night ? 0.0003 : 0.0005;
    // The disc hides behind heavy weather.
    u.glow.value = (night ? 0.3 : 1) * (0.15 + clear * 0.85);
    (u.sunColor.value as THREE.Color).multiplyScalar(0.25 + clear * 0.75);
  }

  /** Puts the shadow-casting sun over a point (the car) so its shadows stay sharp nearby. */
  follow(at: THREE.Vector3): void {
    this.sun.target.position.copy(at);
    this.sun.position.copy(at).addScaledVector(this.sunDir, 200);
    this.sun.target.updateMatrixWorld();
  }

  /** Moves particles and stars with the camera. */
  update(dt: number, camera: THREE.PerspectiveCamera, focus?: THREE.Vector3): void {
    this.blendWeather(Math.min(1, dt / WEATHER_BLEND * 3));
    this.apply();
    this.follow(focus ?? camera.position);
    this.dome.position.copy(camera.position);
    this.dome.scale.setScalar(camera.far * 0.9);
    this.stars.position.copy(camera.position);
    const falling = this.weather === 'rain' || this.weather === 'snow' || this.weather === 'dust';
    // Particles fade out with the weather before they're removed.
    const want: Weather = falling ? this.weather : this.weather === 'clear' && this.clearness < 0.9 ? this.particleKind : 'clear';
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
    (p.material as THREE.PointsMaterial).opacity = (want === 'rain' ? 0.35 + this.light * 0.3 : 0.8) * (1 - this.clearness);
  }

  dispose(): void {
    if (this.particles) {
      this.particles.geometry.dispose();
      (this.particles.material as THREE.Material).dispose();
    }
    this.stars.geometry.dispose();
    (this.stars.material as THREE.Material).dispose();
    this.dome.geometry.dispose();
    this.domeMat.dispose();
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
