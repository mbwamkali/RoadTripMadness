import * as THREE from 'three';

/**
 * A walk for the zombies, done in the vertex shader so it costs nothing extra
 * for a horde drawn as one instanced mesh, and works on the generated zombie,
 * which has no skeleton. Everything below the hips swings forward and back
 * round the hip, the two legs in turn, each zombie on its own beat (taken from
 * where it stands). The shadow gets the same swing.
 *
 * The shared clock: call `tickZombieWalk(dt)` once a frame.
 */
const walkTime = { value: 0 };

export function tickZombieWalk(dt: number): void {
  walkTime.value = (walkTime.value + dt) % 1000;
}

/** Steps per second (each leg) and how far a leg swings (radians). */
const RATE = 1.5;
const SWING = 0.42;

interface Shape {
  hipY: number;
  footY: number;
  cx: number;
  cz: number;
}

function shapeOf(geo: THREE.BufferGeometry): Shape {
  if (!geo.boundingBox) geo.computeBoundingBox();
  const b = geo.boundingBox!;
  const h = b.max.y - b.min.y;
  return { hipY: b.min.y + h * 0.46, footY: b.min.y, cx: (b.min.x + b.max.x) / 2, cz: (b.min.z + b.max.z) / 2 };
}

function inject(shader: { uniforms: Record<string, THREE.IUniform>; vertexShader: string }, s: Shape): void {
  shader.uniforms.uWalkTime = walkTime;
  shader.uniforms.uWalk = { value: new THREE.Vector4(s.hipY, s.footY, s.cx, s.cz) };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform float uWalkTime;\nuniform vec4 uWalk;')
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        float wkHip = uWalk.x;
        // Full swing from a little below the hips down; none at the hips, so the body doesn't tear.
        float wkW = clamp((wkHip - transformed.y) / max(0.001, (wkHip - uWalk.y) * 0.22), 0.0, 1.0);
        float wkSide = transformed.x < uWalk.z ? -1.0 : 1.0;
        vec4 wkAt = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        #ifdef USE_INSTANCING
          wkAt = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        #endif
        float wkA = sin(uWalkTime * ${(Math.PI * 2 * RATE).toFixed(4)} + wkAt.x * 1.7 + wkAt.z * 0.9) * ${SWING.toFixed(3)} * wkSide * wkW;
        float wkC = cos(wkA);
        float wkS = sin(wkA);
        float wkY = transformed.y - wkHip;
        float wkZ = transformed.z - uWalk.w;
        transformed.y = wkHip + wkY * wkC - wkZ * wkS;
        transformed.z = uWalk.w + wkY * wkS + wkZ * wkC;
      }`,
    );
}

const cache = new Map<string, { mat: THREE.Material; depth: THREE.MeshDepthMaterial }>();

/** A walking copy of `mat` for this geometry (cached, so a horde shares one). */
function walking(geo: THREE.BufferGeometry, mat: THREE.Material): { mat: THREE.Material; depth: THREE.MeshDepthMaterial } {
  const key = `${geo.uuid}:${mat.uuid}`;
  let hit = cache.get(key);
  if (hit) return hit;
  const s = shapeOf(geo);
  const m = mat.clone();
  m.onBeforeCompile = (sh) => inject(sh, s);
  m.customProgramCacheKey = () => `zwalk-${key}`;
  m.userData.shared = true;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => inject(sh, s);
  depth.customProgramCacheKey = () => `zwalk-depth-${key}`;
  depth.userData.shared = true;
  hit = { mat: m, depth };
  cache.set(key, hit);
  return hit;
}

/** Makes every mesh under `root` (a zombie, or the horde's instanced mesh) walk. */
export function makeWalk(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material) || m.userData.walking) return;
    const w = walking(m.geometry, m.material);
    m.material = w.mat;
    m.customDepthMaterial = w.depth;
    m.userData.walking = true;
  });
}
