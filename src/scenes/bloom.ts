import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }';

/** Clears any NaN or huge value before the blur passes; one bad pixel would otherwise black out the screen. */
const CLEAN = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: VERT,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      if (!(c.r >= 0.0) || !(c.g >= 0.0) || !(c.b >= 0.0) || c.r > 1e4 || c.g > 1e4 || c.b > 1e4) c = vec4(0.0);
      gl_FragColor = vec4(min(c.rgb, vec3(16.0)), 1.0); }`,
};

/** A light colour grade: a little more saturation and a soft vignette. */
const GRADE = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: VERT,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, 1.12);
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - 0.38 * dot(d, d) * 1.6;
      gl_FragColor = c;
    }`,
};

/**
 * High quality only: contact shadows (ambient occlusion) where things meet the
 * ground, a soft glow around bright things, and a light colour grade. Loaded on demand.
 */
export class Bloom {
  private composer: EffectComposer;
  private pass: RenderPass;
  private ao: GTAOPass;
  private bloom: UnrealBloomPass;

  constructor(renderer: THREE.WebGLRenderer) {
    // Half-float with multisampling keeps edges smooth and lets bright spots glow.
    const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.pass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.composer.addPass(this.pass);
    this.composer.addPass(new ShaderPass(CLEAN));
    this.ao = new GTAOPass(new THREE.Scene(), new THREE.PerspectiveCamera(), 2, 2);
    this.ao.blendIntensity = 0.85;
    this.ao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.6, thickness: 1.5, scale: 1.1, samples: 12 });
    this.composer.addPass(this.ao);
    // Bloom is worked out at half size; it's a blur, so nobody can tell and it's much cheaper.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.55, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new ShaderPass(GRADE));
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
    if (this.ao.scene !== scene || this.ao.camera !== camera) {
      this.ao.scene = scene;
      this.ao.camera = camera;
      // The AO pass keeps its own copies of the camera's matrices; refresh them for the new camera.
      this.ao.updateGtaoMaterial({});
    }
    this.composer.render();
  }

  dispose(): void {
    this.ao.dispose();
    this.bloom.dispose();
    this.composer.dispose();
  }
}
