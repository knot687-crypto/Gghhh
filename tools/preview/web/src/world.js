// Arena: dusk sky, sun with tight follow shadows, tiled floor, course props from LAYOUT.
import * as THREE from 'three';
import { LAYOUT } from '/anim/layout.mjs';
import { groundTexture, stoneTexture } from './textures.js';
import { rng } from './rng.js';

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FRAG = `
uniform vec3 zenith; uniform vec3 horizon; uniform vec3 glow; uniform vec3 ground; uniform vec3 sunDir;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.55));
  float s = max(dot(d, normalize(sunDir)), 0.0);
  col += glow * pow(s, 6.0) * 0.55 * (1.0 - clamp(h * 1.5, 0.0, 1.0));
  col += glow * pow(s, 400.0) * 6.0;
  col = mix(col, ground, smoothstep(0.0, -0.08, h));
  gl_FragColor = vec4(col, 1.0);
}`;

export function buildWorld(scene, renderer, opts = {}) {
  const EnvMat = opts.lambert ? THREE.MeshLambertMaterial : THREE.MeshStandardMaterial;
  const envOpts = (o) => (opts.lambert ? Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'roughness' && k !== 'metalness')) : o);
  const sunDir = new THREE.Vector3(0.62, 0.45, 0.64).normalize();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 16),
    new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        zenith: { value: new THREE.Color(0x16203a) },
        horizon: { value: new THREE.Color(0xc98a64) },
        glow: { value: new THREE.Color(0xffb070) },
        ground: { value: new THREE.Color(0x2a2c33) },
        sunDir: { value: sunDir },
      },
    }),
  );
  sky.renderOrder = -10;
  scene.add(sky);

  // Reflection environment generated from the sky so the steel picks up the dusk colours.
  const envScene = new THREE.Scene();
  envScene.add(sky.clone());
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(200, 60), new THREE.MeshBasicMaterial({ color: 0xffd6b0 }));
  panel.position.copy(sunDir.clone().multiplyScalar(400));
  panel.lookAt(0, 0, 0);
  envScene.add(panel);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.55;

  scene.fog = new THREE.Fog(0x7d6a68, 90, 420);

  const hemi = new THREE.HemisphereLight(0x9cb4ff, 0x4a3a30, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd5ab, 3.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  const sc = sun.shadow.camera;
  sc.left = -26;
  sc.right = 26;
  sc.top = 26;
  sc.bottom = -26;
  sc.near = 1;
  sc.far = 220;
  scene.add(sun);
  scene.add(sun.target);
  const rim = new THREE.DirectionalLight(0x7fa6ff, 0.9);
  rim.position.set(-30, 25, -60);
  scene.add(rim);

  const groundTex = groundTexture();
  groundTex.repeat.set(LAYOUT.floor.size[0] / 16, LAYOUT.floor.size[2] / 16);
  groundTex.anisotropy = 2; // anisotropic filtering is very expensive under software GL
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(LAYOUT.floor.size[0], LAYOUT.floor.size[2]),
    new EnvMat(envOpts({ map: groundTex, roughness: 0.88, metalness: 0 })),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const stone = stoneTexture(3, [104, 100, 108]);
  const props = {};
  for (const b of LAYOUT.boxes) {
    const t = stone.clone();
    t.needsUpdate = true;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(Math.max(b.size[0], b.size[2]) / 8, b.size[1] / 4);
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(...b.size),
      new EnvMat(envOpts({ map: t, roughness: 0.9, color: 0xc8c4cc })),
    );
    m.position.fromArray(b.center);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    // bevelled cap trim reads nicely in silhouette
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(b.size[0] + 0.3, 0.25, b.size[2] + 0.3),
      new EnvMat(envOpts({ color: 0x5a5660, roughness: 0.7 })),
    );
    cap.position.set(b.center[0], b.center[1] + b.size[1] / 2 + 0.12, b.center[2]);
    cap.castShadow = true;
    cap.receiveShadow = true;
    scene.add(cap);
    props[b.name] = { mesh: m, def: b };
  }

  // Perimeter pillars with lanterns for depth and warm accents.
  const R = rng(21);
  const pillarMat = new EnvMat(envOpts({ color: 0x4b4752, roughness: 0.85 }));
  const lanternMat = new EnvMat(envOpts({ color: 0x331a08, emissive: 0xff9a3c, emissiveIntensity: 2.2 }));
  const pillarGeo = new THREE.BoxGeometry(3, 18, 3);
  const lanternGeo = new THREE.BoxGeometry(1.2, 1.6, 1.2);
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const r = 150 + R() * 10;
    const p = new THREE.Mesh(pillarGeo, pillarMat);
    p.position.set(Math.cos(a) * r, 9, Math.sin(a) * r - 40);
    p.castShadow = false;
    scene.add(p);
    const l = new THREE.Mesh(lanternGeo, lanternMat);
    l.position.set(Math.cos(a) * (r - 2), 7, Math.sin(a) * (r - 2) - 40);
    scene.add(l);
  }
  // Distant ridge silhouettes.
  const ridgeMat = new THREE.MeshLambertMaterial({ color: 0x3a3442, fog: true });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + R() * 0.2;
    const h = 40 + R() * 70;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(60 + R() * 50, h, 5), ridgeMat);
    cone.position.set(Math.cos(a) * 380, h / 2 - 4, Math.sin(a) * 380);
    cone.rotation.y = R() * 3;
    scene.add(cone);
  }

  return {
    sun,
    sunDir,
    ground,
    props,
    followShadow(focus) {
      sun.position.copy(focus).addScaledVector(sunDir, 120);
      sun.target.position.copy(focus);
      sun.target.updateMatrixWorld();
    },
  };
}
