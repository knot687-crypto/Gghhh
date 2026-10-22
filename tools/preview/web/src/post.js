// Post-processing: HDR render -> bloom -> tone map -> grade (vignette, chromatic aberration,
// white flash, impact frames, grain). The Roblox runtime approximates the grade with
// Bloom/ColorCorrection/Blur effects.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    vignette: { value: 0.32 },
    aberration: { value: 0.0 },
    flash: { value: 0.0 },
    flashColor: { value: new THREE.Color(1, 1, 1) },
    impact: { value: 0.0 },
    impactTint: { value: new THREE.Color(0.85, 0.95, 1.0) },
    grain: { value: 0.025 },
    time: { value: 0 },
    aspect: { value: 16 / 9 },
    saturation: { value: 1.06 },
    fade: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float vignette, aberration, flash, impact, grain, time, aspect, saturation, fade;
    uniform vec3 flashColor, impactTint; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + time*17.0) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      vec2 off = c * aberration * 0.012;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      float l = dot(col, vec3(0.299,0.587,0.114));
      col = mix(vec3(l), col, saturation);
      // anime impact frame: inverted high-contrast silhouette
      float ink = 1.0 - smoothstep(0.32, 0.5, l);
      vec3 impactCol = mix(vec3(0.02), impactTint, ink);
      col = mix(col, impactCol, impact);
      vec2 cv = c * vec2(aspect, 1.0);
      float v = smoothstep(0.95, 0.25, length(cv) * (0.9 + vignette));
      col *= mix(1.0, v, vignette * 1.6);
      col = mix(col, flashColor, flash);
      col += (hash(vUv * 900.0) - 0.5) * grain;
      col = mix(col, vec3(0.0), fade);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createPost(renderer, scene, camera, width, height, opts = {}) {
  const type = { half: THREE.HalfFloatType, float: THREE.FloatType, byte: THREE.UnsignedByteType }[opts.target ?? 'half'];
  const target = new THREE.WebGLRenderTarget(width, height, { type, samples: opts.samples ?? 4 });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(1);
  composer.setSize(width, height);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(width / 2, height / 2), 0.62, 0.42, 0.82);
  if (opts.bloom !== false) composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  grade.uniforms.aspect.value = width / height;
  composer.addPass(grade);
  if (opts.fxaa) {
    const fxaa = new ShaderPass(FXAAShader);
    fxaa.uniforms.resolution.value.set(1 / width, 1 / height);
    composer.addPass(fxaa);
  }
  return { composer, bloom, grade, renderPass };
}
