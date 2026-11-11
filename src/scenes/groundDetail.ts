import * as THREE from 'three';

/**
 * Breaks up the tiling on the big ground plane: soft patches of lighter and
 * darker earth a few hundred metres across, plus the detail photo sampled
 * again at a much larger scale, all in world space so they stay put while
 * the plane follows the car. Costs a few instructions per pixel.
 */
export function addGroundDetail(mat: THREE.Material): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vGroundXZ;
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1, 0)), f.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), f.x), f.y);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  float n = gNoise(vGroundXZ * 0.004) * 0.55 + gNoise(vGroundXZ * 0.017) * 0.3 + gNoise(vGroundXZ * 0.07) * 0.15;
  diffuseColor.rgb *= mix(0.74, 1.2, n);
  #ifdef USE_MAP
  diffuseColor.rgb *= 0.75 + 0.5 * texture2D(map, vGroundXZ * 0.0047).r;
  #endif
}`,
      );
  };
  mat.customProgramCacheKey = () => 'ground-detail';
}
