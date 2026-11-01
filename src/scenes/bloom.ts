import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** High quality only: a soft glow around the sun, headlights, fire and explosions. Loaded on demand. */
export class Bloom {
  private composer: EffectComposer;
  private pass: RenderPass;
  private bloom: UnrealBloomPass;

  constructor(renderer: THREE.WebGLRenderer) {
    this.composer = new EffectComposer(renderer);
    this.pass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    // Bloom is worked out at half size; it's a blur, so nobody can tell and it's much cheaper.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0.5, 0.82);
    this.composer.addPass(this.pass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.pass.scene = scene;
    this.pass.camera = camera;
    this.composer.render();
  }

  dispose(): void {
    this.bloom.dispose();
    this.composer.dispose();
  }
}
