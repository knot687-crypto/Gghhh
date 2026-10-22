import * as THREE from 'three';
import { RIGS } from '/anim/core/rig.mjs';
import { sampleClip } from '/anim/core/animator.mjs';
import { buildWorld } from './world.js';
import { buildAvatar, STYLES } from './avatar.js';

const state = { clips: null };

async function init({ width = 1280, height = 720 } = {}) {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, width / height, 0.05, 2000);
  const world = buildWorld(scene, renderer);
  state.clips = await (await fetch('/data/clips.json')).json();
  Object.assign(state, { renderer, scene, camera, world, width, height });
  if (document.fonts) await document.fonts.ready;
  return Object.keys(state.clips);
}

const VIEWS = {
  side: { pos: [9.5, 3.2, 0], look: [0, 2.4, 0] },
  left: { pos: [-9.5, 3.2, 0], look: [0, 2.4, 0] },
  front: { pos: [0, 3.2, -10], look: [0, 2.4, 0] },
  back: { pos: [0, 3.6, 10], look: [0, 2.4, 0] },
  threeq: { pos: [7, 4.2, -7.5], look: [0, 2.3, 0] },
  threeqBack: { pos: [-7, 4.5, 7.5], look: [0, 2.3, 0] },
  top: { pos: [0.01, 13, 0], look: [0, 0, 0] },
  sideWide: { pos: [17, 5.5, -3.5], look: [0, 4, -3.5] },
  threeqWide: { pos: [12, 9, -14], look: [0, 3.5, -3] },
  backWide: { pos: [3, 7, 9], look: [0, 3.5, -4] },
  climbSide: { pos: [22, 9, -0.5], look: [0, 6.2, -1.4], fov: 38 },
  climbBack: { pos: [9, 13, 10], look: [0, 6.5, -1.5], fov: 40 },
  fp: { pos: [0, 0, 0], look: [0, 0, -1], fov: 70 },
};

let sheetAvatars = {};
function avatarFor(rigName, styleName) {
  const key = rigName + ':' + styleName;
  if (!sheetAvatars[key]) {
    const rig = RIGS[rigName];
    const av = buildAvatar({ rig, style: STYLES[styleName], hidden: rigName === 'VM' ? ['UpperTorso'] : [] });
    state.scene.add(av.root);
    sheetAvatars[key] = av;
  }
  for (const [k, a] of Object.entries(sheetAvatars)) a.root.visible = k === key;
  return sheetAvatars[key];
}

export function weaponModeAt(clip, t) {
  let mode = clip.meta?.weapon ?? 'hand';
  for (const m of clip.markers) if (m.name === 'WeaponAttach' && m.t <= t) mode = m.to;
  return mode;
}

// Contact sheet: rows = views, columns = sample times.
function sheet({ clip: clipName, times, views = ['side', 'front'], cellW = 300, cellH = 340, style = 'hero', yaw = 0 }) {
  const { renderer, scene, camera, world } = state;
  const clip = state.clips[clipName];
  if (!clip) throw new Error('no clip ' + clipName);
  const av = avatarFor(clip.rig, style);
  const hip = RIGS.R15.hipHeight;
  if (clip.rig === 'R15') {
    av.root.position.set(0, hip + 1, 0);
    av.root.rotation.set(0, (yaw * Math.PI) / 180, 0);
  }
  // Obstacles for traversal clips (vault rail / mantle ledge) in start-relative space.
  if (state.sheetObstacle) {
    scene.remove(state.sheetObstacle);
    state.sheetObstacle = null;
  }
  if (clip.meta?.wallDistance) {
    const side = clip.meta.wall === 'Right' ? 1 : -1;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 12, 30),
      new THREE.MeshStandardMaterial({ color: 0x8a8590, roughness: 0.9, transparent: true, opacity: 0.55 }),
    );
    m.position.set(side * (clip.meta.wallDistance + 0.2), hip + 1, 0);
    scene.add(m);
    state.sheetObstacle = m;
  }
  const ob = clip.meta?.obstacle;
  if (ob) {
    const depth = ob.depth ?? 10;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(6, ob.height, depth),
      new THREE.MeshStandardMaterial({ color: 0x8a8590, roughness: 0.9 }),
    );
    m.position.set(0, ob.height / 2, ob.depth ? -ob.distance : -ob.distance - depth / 2);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    state.sheetObstacle = m;
  }
  world.followShadow(new THREE.Vector3(0, 0, 0));
  if (!state.sheetLight) {
    // Review lighting: a soft key from the camera so poses read clearly in every view.
    state.sheetLight = new THREE.DirectionalLight(0xffffff, 1.6);
    scene.add(state.sheetLight);
    scene.add(state.sheetLight.target);
  }
  state.sheetLight.visible = true;
  renderer.setSize(cellW, cellH, false);
  camera.aspect = cellW / cellH;
  const out = document.createElement('canvas');
  out.width = cellW * times.length;
  out.height = cellH * views.length + 34;
  const g = out.getContext('2d');
  g.fillStyle = '#111';
  g.fillRect(0, 0, out.width, out.height);
  g.font = '600 22px Inter, sans-serif';
  g.fillStyle = '#fff';
  g.fillText(`${clipName}  (${clip.length.toFixed(2)}s${clip.loop ? ', loop' : ''})`, 10, 25);
  views.forEach((viewName, row) => {
    const v = VIEWS[viewName];
    times.forEach((t, col) => {
      const pose = sampleClip(clip, t);
      av.setWeaponAttach(weaponModeAt(clip, t));
      if (clip.rig === 'VM') {
        // Viewmodel: root at the camera; apply the virtual Camera joint to the view.
        const camX = pose.Camera;
        camera.position.set(0, 4.33, 0);
        camera.quaternion.identity();
        if (camX) {
          camera.position.add(new THREE.Vector3(...camX.p));
          camera.quaternion.set(...camX.q);
        }
        camera.fov = 70;
        av.root.position.set(0, 4.33, 0);
        av.root.quaternion.identity();
      } else {
        const rm = pose.RootMotion;
        av.root.position.set(rm ? rm.p[0] : 0, hip + 1 + (rm ? rm.p[1] : 0), rm ? rm.p[2] : 0);
        camera.fov = v.fov ?? 40;
        // Follow horizontal root motion unless the view frames an obstacle course.
        const follow = rm && !clip.meta?.obstacle ? new THREE.Vector3(rm.p[0], 0, rm.p[2]) : new THREE.Vector3();
        camera.position.fromArray(v.pos).add(follow);
        camera.lookAt(new THREE.Vector3(...v.look).add(follow));
      }
      camera.updateProjectionMatrix();
      state.sheetLight.position.copy(camera.position).add(new THREE.Vector3(2, 6, 0));
      state.sheetLight.target.position.set(0, 2, 0);
      av.applyPose(pose);
      renderer.render(scene, camera);
      g.drawImage(renderer.domElement, col * cellW, 34 + row * cellH);
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(col * cellW, 34 + row * cellH, 92, 24);
      g.fillStyle = '#ffd36b';
      g.font = '600 15px Inter, sans-serif';
      g.fillText(`${t.toFixed(3)}s`, col * cellW + 6, 34 + row * cellH + 17);
      g.strokeStyle = '#000';
      g.strokeRect(col * cellW + 0.5, 34 + row * cellH + 0.5, cellW - 1, cellH - 1);
    });
  });
  return out.toDataURL('image/png');
}

// Blade sweep: ribbons of the blade (base->tip) over [t0, t1], character posed at `at`.
function sweep({ clip: clipName, t0, t1, at, views = ['threeq'], cellW = 420, cellH = 420, n = 90, style = 'hero' }) {
  const { renderer, scene, camera, world } = state;
  const clip = state.clips[clipName];
  const av = avatarFor(clip.rig, style);
  const hip = RIGS.R15.hipHeight;
  const placeAt = (t) => {
    const pose = sampleClip(clip, t);
    av.setWeaponAttach(weaponModeAt(clip, t));
    const rm = pose.RootMotion;
    av.root.position.set(rm ? rm.p[0] : 0, hip + 1 + (rm ? rm.p[1] : 0), rm ? rm.p[2] : 0);
    av.root.rotation.set(0, 0, 0);
    av.applyPose(pose);
    av.root.updateMatrixWorld(true);
    return rm ? new THREE.Vector3(rm.p[0], 0, rm.p[2]) : new THREE.Vector3();
  };
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    placeAt(t);
    const g = av.katana.group;
    pts.push([g.localToWorld(av.katana.points.base.clone()), g.localToWorld(av.katana.points.tip.clone()), i / n]);
  }
  const pos = [];
  const col = [];
  for (let i = 0; i < n; i++) {
    const [a0, b0, k0] = pts[i];
    const [a1, b1, k1] = pts[i + 1];
    for (const [p, k] of [[a0, k0], [b0, k0], [a1, k1], [a1, k1], [b0, k0], [b1, k1]]) {
      pos.push(p.x, p.y, p.z);
      col.push(0.3 + 0.7 * k, 0.55 + 0.45 * k, 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const ribbon = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }),
  );
  scene.add(ribbon);
  const follow = placeAt(at);
  if (state.sheetLight) state.sheetLight.visible = true;
  renderer.setSize(cellW, cellH, false);
  camera.aspect = cellW / cellH;
  const out = document.createElement('canvas');
  out.width = cellW * views.length;
  out.height = cellH + 30;
  const g2 = out.getContext('2d');
  g2.fillStyle = '#111';
  g2.fillRect(0, 0, out.width, out.height);
  g2.fillStyle = '#fff';
  g2.font = '600 18px Inter, sans-serif';
  g2.fillText(`${clipName} sweep ${t0.toFixed(2)}-${t1.toFixed(2)}s, pose @${at.toFixed(2)}`, 8, 21);
  views.forEach((vn, i) => {
    const v = VIEWS[vn];
    camera.fov = v.fov ?? 40;
    camera.position.fromArray(v.pos).add(follow);
    camera.lookAt(new THREE.Vector3(...v.look).add(follow));
    camera.updateProjectionMatrix();
    if (state.sheetLight) {
      state.sheetLight.position.copy(camera.position).add(new THREE.Vector3(2, 6, 0));
      state.sheetLight.target.position.copy(follow).setY(2);
    }
    renderer.render(scene, camera);
    g2.drawImage(renderer.domElement, i * cellW, 30);
  });
  scene.remove(ribbon);
  geo.dispose();
  return out.toDataURL('image/png');
}

window.AAA = { init, sheet, sweep, state };
window.AAA_READY = true;
