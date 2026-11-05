import * as THREE from 'three';
import type { BiomeId } from '../game/biomes';
import { makeRng } from '../game/rng';

/**
 * Far-off hills, mesas and mountains on the horizon, picked by biome. They sit
 * deep in the haze and travel with the camera (too far away to show parallax),
 * so they cost a few hundred triangles and never need building along the route.
 */
type Shape = 'mesa' | 'peak' | 'hill';

const LOOK: Record<BiomeId, { shape: Shape; colors: number[]; count: number; height: [number, number] }> = {
  desert: { shape: 'mesa', colors: [0xa8543a, 0xc8764a, 0xb8643e, 0xd8946a], count: 9, height: [40, 90] },
  sagebrush: { shape: 'mesa', colors: [0x9a7a5a, 0xb0906a, 0x8a6a4a], count: 8, height: [30, 70] },
  prairie: { shape: 'hill', colors: [0x8a9a5a, 0x7a8a4a], count: 7, height: [18, 40] },
  farmland: { shape: 'hill', colors: [0x6f8f4a, 0x7f9a52], count: 8, height: [20, 45] },
  forest: { shape: 'hill', colors: [0x4f6f3a, 0x5a7a40], count: 9, height: [35, 80] },
  pinewoods: { shape: 'peak', colors: [0x3f5a3a, 0x4a6a44], count: 9, height: [70, 150] },
  mountains: { shape: 'peak', colors: [0x6a6a6a, 0x7a7466, 0x5a6050], count: 10, height: [140, 280] },
  coastal: { shape: 'hill', colors: [0x8a8a5a, 0x9a9466], count: 7, height: [30, 70] },
  subtropical: { shape: 'hill', colors: [0x5a7a40, 0x6a8a48], count: 5, height: [15, 30] },
  tundra: { shape: 'peak', colors: [0x6a7a6a, 0x7a8478], count: 8, height: [60, 120] },
};

function shapeGeometry(shape: Shape, h: number, rand: (a: number, b: number) => number, colors: number[]): THREE.BufferGeometry {
  const r = shape === 'mesa' ? rand(1.0, 1.6) * h : shape === 'peak' ? rand(1.1, 1.7) * h : rand(2.5, 4) * h;
  const g =
    shape === 'mesa'
      ? new THREE.CylinderGeometry(r * rand(0.55, 0.75), r, h, 9, 5)
      : shape === 'peak'
        ? new THREE.ConeGeometry(r, h, 10, 5)
        : new THREE.SphereGeometry(r, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, h / r, 1).translate(0, -h / 2, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const cols = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const snow = new THREE.Color(0xeef2f6);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    // Rough up the outline so no two look alike.
    const k = 1 + rand(-0.1, 0.1);
    pos.setX(i, pos.getX(i) * k);
    pos.setZ(i, pos.getZ(i) * k);
    const band = Math.floor((y + h) / (h / 6));
    c.setHex(colors[Math.abs(band) % colors.length]);
    if (shape === 'peak' && h > 120 && y > h * 0.25) c.lerp(snow, 0.85);
    cols.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

export class Backdrop {
  readonly group = new THREE.Group();
  private biome: BiomeId | null = null;
  private mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });

  /** `far` is the fog's far distance; the shapes sit just inside it so the haze softens them. */
  constructor(private far: number) {
    this.group.name = 'backdrop';
  }

  /** Rebuilds the skyline when the biome changes. */
  setBiome(biome: BiomeId): void {
    if (biome === this.biome) return;
    this.biome = biome;
    this.clear();
    const look = LOOK[biome];
    const rng = makeRng(biome.length * 977 + look.count);
    const rand = (a: number, b: number) => a + (b - a) * rng();
    for (let i = 0; i < look.count * 2; i++) {
      const h = rand(look.height[0], look.height[1]);
      const m = new THREE.Mesh(shapeGeometry(look.shape, h, rand, look.colors), this.mat);
      // Spread right round the horizon, in two depths.
      const a = (i / (look.count * 2)) * Math.PI * 2 + rand(-0.15, 0.15);
      const dist = this.far * rand(0.62, 0.9);
      m.position.set(Math.cos(a) * dist, h / 2 - 6, Math.sin(a) * dist);
      m.rotation.y = rand(0, Math.PI * 2);
      this.group.add(m);
    }
  }

  /** Keeps the skyline centred on the camera. */
  follow(camera: THREE.Camera): void {
    this.group.position.set(camera.position.x, 0, camera.position.z);
  }

  private clear(): void {
    for (const c of [...this.group.children]) {
      (c as THREE.Mesh).geometry.dispose();
      this.group.remove(c);
    }
  }

  dispose(): void {
    this.clear();
    this.mat.dispose();
  }
}
