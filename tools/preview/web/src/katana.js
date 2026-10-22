// Katana model in "Weapon" part space: origin = grip centre, +Y toward the tip, edge toward -Z.
// Mirrors the part layout built by AAAMotion/Combat/Weapon.luau so trails line up in both.
import * as THREE from 'three';
import { wrapTexture } from './textures.js';

import { KATANA, KATANA_POINTS, bladeFrame } from '/anim/weapon.mjs';

export { KATANA, bladeFrame };

function loftBlade(N = 48) {
  // Cross-section ring: edge, shinogi+, spine+, spine-, shinogi-.
  const ring = (f) => [
    [0, f.zE],
    [f.tS, f.zS],
    [f.tB, f.zB],
    [-f.tB, f.zB],
    [-f.tS, f.zS],
  ];
  const sections = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const f = bladeFrame(s);
    sections.push({ y: f.y, pts: ring(f) });
  }
  const pos = [];
  const sides = 5;
  for (let side = 0; side < sides; side++) {
    const a = side;
    const b = (side + 1) % sides;
    for (let i = 0; i < N; i++) {
      const s0 = sections[i];
      const s1 = sections[i + 1];
      const p00 = [s0.pts[a][0], s0.y, s0.pts[a][1]];
      const p01 = [s0.pts[b][0], s0.y, s0.pts[b][1]];
      const p10 = [s1.pts[a][0], s1.y, s1.pts[a][1]];
      const p11 = [s1.pts[b][0], s1.y, s1.pts[b][1]];
      pos.push(...p00, ...p10, ...p01, ...p01, ...p10, ...p11);
    }
  }
  // cap at the base
  const base = sections[0];
  for (let k = 1; k < sides - 1; k++) {
    pos.push(base.pts[0][0], base.y, base.pts[0][1]);
    pos.push(base.pts[k + 1][0], base.y, base.pts[k + 1][1]);
    pos.push(base.pts[k][0], base.y, base.pts[k][1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function edgeStrip(N = 48) {
  // Thin band along the cutting edge (hamon) on both faces, slightly proud of the blade.
  const pos = [];
  for (const sx of [1, -1]) {
    for (let i = 0; i < N; i++) {
      const f0 = bladeFrame(i / N);
      const f1 = bladeFrame((i + 1) / N);
      const band = (f) => {
        const z1 = f.zE + (f.zS - f.zE) * 0.55;
        const x1 = f.tS * 0.55 * sx + 0.0015 * sx;
        return [
          [0.0015 * sx, f.y, f.zE],
          [x1, f.y, z1],
        ];
      };
      const [a0, b0] = band(f0);
      const [a1, b1] = band(f1);
      if (sx > 0) pos.push(...a0, ...a1, ...b0, ...b0, ...a1, ...b1);
      else pos.push(...a0, ...b0, ...a1, ...b0, ...b1, ...a1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function buildKatana({ castShadow = true } = {}) {
  const group = new THREE.Group();
  group.name = 'Katana';

  const steel = new THREE.MeshStandardMaterial({ color: 0xd6dbe4, metalness: 1, roughness: 0.22 });
  const blade = new THREE.Mesh(loftBlade(), steel);
  group.add(blade);

  const edgeMat = new THREE.MeshStandardMaterial({
    color: 0xeaf6ff,
    metalness: 0.6,
    roughness: 0.15,
    emissive: new THREE.Color(0x7fd8ff),
    emissiveIntensity: 0.35,
  });
  const edge = new THREE.Mesh(edgeStrip(), edgeMat);
  group.add(edge);

  const gold = new THREE.MeshStandardMaterial({ color: 0xb8913f, metalness: 1, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15151a, metalness: 0.4, roughness: 0.5 });

  const habaki = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.12, 0.22), gold);
  habaki.position.set(0, 0.53, 0);
  group.add(habaki);

  const tsuba = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.055, 28), dark);
  tsuba.scale.set(0.85, 1, 1.12);
  tsuba.position.set(0, 0.45, 0);
  group.add(tsuba);
  const tsubaRim = new THREE.Mesh(new THREE.TorusGeometry(0.235, 0.018, 8, 32), gold);
  tsubaRim.rotation.x = Math.PI / 2;
  tsubaRim.scale.set(0.85, 1.12, 1);
  tsubaRim.position.set(0, 0.45, 0);
  group.add(tsubaRim);

  const wrap = new THREE.MeshStandardMaterial({ map: wrapTexture(), roughness: 0.85, metalness: 0 });
  const tsukaLen = 0.42 - KATANA.handleStart;
  wrap.map.repeat.set(3, tsukaLen * 1.4);
  const tsuka = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.092, tsukaLen, 20, 1, true), wrap);
  tsuka.scale.set(0.85, 1, 1.12);
  tsuka.position.set(0, (0.42 + KATANA.handleStart) / 2, 0);
  group.add(tsuka);
  const fuchi = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.06, 20), gold);
  fuchi.scale.set(0.85, 1, 1.12);
  fuchi.position.set(0, 0.4, 0);
  group.add(fuchi);
  const kashira = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.095, 0.08, 20), gold);
  kashira.scale.set(0.85, 1, 1.12);
  kashira.position.set(0, KATANA.handleStart - 0.02, 0);
  group.add(kashira);

  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = castShadow;
      o.receiveShadow = false;
    }
  });

  const points = {
    base: new THREE.Vector3(...KATANA_POINTS.base),
    mid: new THREE.Vector3(...KATANA_POINTS.mid),
    tip: new THREE.Vector3(...KATANA_POINTS.tip),
  };
  return { group, edgeMat, steel, points };
}

export function buildScabbard() {
  // Lacquered saya following the blade curve; lives on the left hip.
  const pts = [];
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const f = bladeFrame(i / N);
    pts.push(new THREE.Vector3(0, f.y + 0.05, (f.zE + f.zB) / 2));
  }
  const path = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.TubeGeometry(path, 32, 0.115, 12, false);
  geo.scale(0.62, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0x101014, metalness: 0.3, roughness: 0.28 });
  const saya = new THREE.Mesh(geo, mat);
  const koiguchi = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 0.08, 16),
    new THREE.MeshStandardMaterial({ color: 0xb8913f, metalness: 1, roughness: 0.35 }),
  );
  koiguchi.scale.set(0.62, 1, 1);
  koiguchi.position.set(0, 0.56, 0);
  const g = new THREE.Group();
  g.add(saya, koiguchi);
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return g;
}
