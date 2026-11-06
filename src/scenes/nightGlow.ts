import * as THREE from 'three';

/**
 * Bad guys glow softly at night so they stand out on a dark road (Jared, 2026-11-06:
 * "hard to see the enemies"). Each fight mesh gets its own copy of its material,
 * shared per original, that lights up its own colours or texture.
 */
let glowOf = new WeakMap<THREE.Material, THREE.MeshStandardMaterial>();
const glowing = new Set<THREE.MeshStandardMaterial>();
const GLOW = 0.6;

function glowCopy(m: THREE.Material): THREE.Material {
  if ((m as THREE.MeshStandardMaterial).userData?.nightGlow) return m;
  const std = m as THREE.MeshStandardMaterial;
  if (!std.isMeshStandardMaterial) return m;
  let g = glowOf.get(m);
  if (!g) {
    g = std.clone();
    g.userData = { ...g.userData, nightGlow: true };
    if (g.map) {
      g.emissiveMap = g.map;
      g.emissive.setRGB(1, 1, 1);
    } else {
      g.emissive.copy(g.color);
    }
    glowOf.set(m, g);
    glowing.add(g);
  }
  return g;
}

/** Light up everything under `root` (a fight's enemies) by `night` (0 = day, 1 = deep night). */
export function glowFoes(root: THREE.Object3D, night: number): void {
  if (night > 0.02) {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.noGlow) return;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(glowCopy) : glowCopy(mesh.material);
    });
  }
  const k = night * GLOW;
  for (const g of glowing) g.emissiveIntensity = k;
}

/** The fight is over: free the glowing copies (the fight disposes the originals). */
export function endGlow(): void {
  for (const g of glowing) g.dispose();
  glowing.clear();
  glowOf = new WeakMap();
}
