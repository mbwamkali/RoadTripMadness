import * as THREE from 'three';
import { quality } from './quality';

/**
 * The game's everyday lit material. Medium and High use physically based
 * shading, so models pick up the sky's light and reflections; Low keeps the
 * cheaper Lambert shading. Both share the fields the game touches (colour,
 * map, emissive, opacity, side), so callers treat it as one type.
 */
export function lit(params: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  if (quality.level === 'low') {
    const { roughness: _r, metalness: _m, ...rest } = params;
    return new THREE.MeshLambertMaterial(rest as THREE.MeshLambertMaterialParameters) as unknown as THREE.MeshStandardMaterial;
  }
  return new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...params });
}
