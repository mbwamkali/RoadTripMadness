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

let backMat: THREE.MeshStandardMaterial | null = null;
/**
 * Gives a one-sided sign face a plain back (painted metal), so from behind it
 * shows a blank board instead of its words mirrored. The back shares the face's
 * shape. Returns the face.
 */
export function blankBack<T extends THREE.Mesh>(face: T): T {
  if (!backMat) {
    backMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.6, metalness: 0.3 });
    backMat.userData.shared = true;
  }
  const back = new THREE.Mesh(face.geometry, backMat);
  back.rotation.y = Math.PI;
  back.name = face.name ? `${face.name}Back` : 'signBack';
  face.add(back);
  return face;
}
