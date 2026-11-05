import * as THREE from 'three';
import { quality } from './quality';

/**
 * Photo textures (CC0, from Poly Haven) for the ground, gravel and asphalt,
 * on Medium and High quality. They're greyscale detail maps: the biome colour
 * still sets the hue, the texture adds grain. Low quality keeps the flat
 * colours and drawn asphalt.
 */
/** `_n` files are bump (normal) maps made from the photo of the same name. */
export type TextureName = 'ground' | 'gravel' | 'asphalt' | 'ground_n' | 'asphalt_n';

const cache = new Map<TextureName, THREE.Texture>();
/** Copies made before the photo arrived; each needs its own upload flag set. */
const pending = new Map<TextureName, THREE.Texture[]>();
const images = new Map<TextureName, Promise<HTMLImageElement | null>>();

export const realTexturesOn = () => quality.level !== 'low';

function url(name: TextureName): string {
  return `${import.meta.env.BASE_URL}textures/${name}.jpg`;
}

/** The photo itself, for drawing into canvas textures. Resolves to null on Low or if it fails to load. */
export function textureImage(name: TextureName): Promise<HTMLImageElement | null> {
  if (!realTexturesOn() || typeof Image === 'undefined') return Promise.resolve(null);
  let p = images.get(name);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url(name);
    });
    images.set(name, p);
  }
  return p;
}

/**
 * A repeating detail texture, one tile every `tile` game units on a mesh
 * whose UVs run 0..1 over `size` units. Each caller gets its own copy (own
 * repeat and offset) sharing the same image. Null on Low.
 */
export function detailTexture(name: TextureName, repeatU: number, repeatV: number): THREE.Texture | null {
  if (!realTexturesOn()) return null;
  let base = cache.get(name);
  if (!base) {
    base = new THREE.Texture();
    base.wrapS = base.wrapT = THREE.RepeatWrapping;
    base.anisotropy = 8;
    // Detail maps multiply the material colour; read them as plain numbers so the tint stays true.
    base.colorSpace = THREE.NoColorSpace;
    const t = base;
    void textureImage(name).then((img) => {
      if (!img) return;
      t.image = img;
      t.needsUpdate = true;
      for (const c of pending.get(name) ?? []) c.needsUpdate = true;
      pending.delete(name);
    });
    cache.set(name, base);
  }
  const t = base.clone();
  t.repeat.set(repeatU, repeatV);
  // Copies share the photo. One made before it loads is flagged for upload when it arrives.
  if (base.image) t.needsUpdate = true;
  else pending.set(name, [...(pending.get(name) ?? []), t]);
  return t;
}
