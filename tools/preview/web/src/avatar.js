// R15-style avatar whose node hierarchy reproduces Motor6D maths exactly:
//   part1 = part0 * C0 * Transform * C1^-1
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { faceTexture, torsoTexture, woodTexture } from './textures.js';
import { buildKatana, buildScabbard } from './katana.js';

const D2R = Math.PI / 180;

export const STYLES = {
  hero: {
    skin: 0xe9b48f,
    jacket: 0x34466f,
    sash: 0xa3242c,
    band: 0xb8262f,
    pants: 0x3b3f4a,
    shoes: 0x1f2126,
    gloves: 0x2a2d35,
    face: true,
    torsoDecal: true,
    cloth: true,
  },
  dummy: {
    wood: true,
    skin: 0xc79a66,
    jacket: 0xb48a5a,
    sash: 0x6b4a2c,
    pants: 0xa98154,
    shoes: 0x5a3d22,
    gloves: 0xb48a5a,
    face: false,
    torsoDecal: false,
  },
  rival: {
    skin: 0xc58c66,
    jacket: 0x4a1418,
    sash: 0x111111,
    band: 0x8e1b22,
    pants: 0x1c1c20,
    shoes: 0x0d0d0f,
    gloves: 0x111114,
    face: true,
    torsoDecal: true,
    trim: '#c9a227',
    cloth: true,
  },
};

function partColor(style, part) {
  if (part === 'Head') return style.skin;
  if (/Hand/.test(part)) return style.gloves ?? style.skin;
  if (/UpperTorso|Arm/.test(part)) return style.jacket;
  if (part === 'LowerTorso') return style.sash;
  if (/Foot/.test(part)) return style.shoes;
  return style.pants;
}

// Slight size offsets so overlapping R15 blocks never z-fight.
const SHRINK = {
  LeftLowerArm: 0.965,
  RightLowerArm: 0.965,
  LeftHand: 0.93,
  RightHand: 0.93,
  LeftLowerLeg: 0.965,
  RightLowerLeg: 0.965,
  LeftFoot: 0.995,
  RightFoot: 0.995,
  LowerTorso: 0.985,
};

const sharedGeo = new Map();
function rounded(size, radius) {
  const key = size.join(',') + ':' + radius;
  if (!sharedGeo.has(key)) sharedGeo.set(key, new RoundedBoxGeometry(size[0], size[1], size[2], 3, radius));
  return sharedGeo.get(key);
}

let woodTex = null;

export function buildAvatar({ rig, style = STYLES.hero, weapon = true, scabbard = true, hidden = [] } = {}) {
  const root = new THREE.Group();
  root.name = rig.root;
  const parts = { [rig.root]: root };
  const joints = {};
  for (const j of rig.joints) {
    const parent = parts[j.part0];
    const pivot = new THREE.Group();
    pivot.position.fromArray(j.c0);
    if (j.c0r) pivot.rotation.set(j.c0r[0] * D2R, j.c0r[1] * D2R, j.c0r[2] * D2R, 'XYZ');
    parent.add(pivot);
    const xf = new THREE.Group();
    pivot.add(xf);
    const part = new THREE.Group();
    part.name = j.part1;
    part.position.set(-j.c1[0], -j.c1[1], -j.c1[2]);
    xf.add(part);
    parts[j.part1] = part;
    joints[j.name] = { pivot, xf, def: j };
  }

  const materials = {};
  const mat = (color, opts = {}) => {
    const key = color + JSON.stringify(opts);
    if (!materials[key]) {
      if (style.wood) {
        woodTex ??= woodTexture();
        materials[key] = new THREE.MeshStandardMaterial({ color, map: woodTex, roughness: 0.85, ...opts });
      } else {
        materials[key] = new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0, ...opts });
      }
    }
    return materials[key];
  };

  const meshes = [];
  for (const [name, size] of Object.entries(rig.parts)) {
    if (name === rig.root || name === 'CameraRoot' || name === 'Weapon' || hidden.includes(name)) continue;
    const s = SHRINK[name] ?? 1;
    const dims = [size[0] * s, size[1], size[2] * s];
    const radius = name === 'Head' ? 0.32 : /Hand|Foot|LowerTorso/.test(name) ? 0.09 : 0.13;
    const m = new THREE.Mesh(rounded(dims, Math.min(radius, dims[1] / 2 - 0.01)), mat(partColor(style, name)));
    m.castShadow = true;
    m.receiveShadow = true;
    parts[name].add(m);
    meshes.push(m);
    if (name === 'Head' && style.face) {
      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(1.0, 1.0),
        new THREE.MeshStandardMaterial({ map: faceTexture(), transparent: true, roughness: 0.8, depthWrite: false }),
      );
      face.position.set(0, 0, -0.602);
      face.rotation.y = Math.PI;
      parts[name].add(face);
    }
    if (name === 'UpperTorso' && style.torsoDecal) {
      const dec = new THREE.Mesh(
        new THREE.PlaneGeometry(1.86, 1.5),
        new THREE.MeshStandardMaterial({
          map: torsoTexture('#' + style.jacket.toString(16).padStart(6, '0'), style.trim ?? '#d9d4c7'),
          roughness: 0.75,
        }),
      );
      dec.position.set(0, 0, -0.503);
      dec.rotation.y = Math.PI;
      dec.receiveShadow = true;
      parts[name].add(dec);
    }
  }

  let katana = null;
  if (weapon && parts.Weapon) {
    katana = buildKatana();
    parts.Weapon.add(katana.group);
  }
  let saya = null;
  let sheathNode = null;
  if (rig.sheath && parts.LowerTorso) {
    // Frame the katana snaps to when sheathed; the scabbard model shares it.
    sheathNode = new THREE.Group();
    sheathNode.position.fromArray(rig.sheath.c0);
    sheathNode.rotation.set(...rig.sheath.c0r.map((x) => x * D2R), 'XYZ');
    parts.LowerTorso.add(sheathNode);
    if (scabbard) {
      saya = buildScabbard();
      sheathNode.add(saya);
    }
  }
  let weaponMode = 'hand';

  const api = {
    root,
    parts,
    joints,
    katana,
    saya,
    meshes,
    posScale: 1,
    applyPose(pose) {
      for (const [name, j] of Object.entries(joints)) {
        const x = pose[name];
        if (!x) {
          j.xf.position.set(0, 0, 0);
          j.xf.quaternion.identity();
          continue;
        }
        j.xf.position.set(x.p[0] * api.posScale, x.p[1] * api.posScale, x.p[2] * api.posScale);
        j.xf.quaternion.set(x.q[0], x.q[1], x.q[2], x.q[3]);
      }
    },
    worldPoint(partName, local, target = new THREE.Vector3()) {
      parts[partName].updateWorldMatrix(true, false);
      return target.copy(local).applyMatrix4(parts[partName].matrixWorld);
    },
    setVisible(v) {
      root.visible = v;
    },
    // 'hand' = Weapon joint on RightHand (grip), 'sheath' = parked in the scabbard.
    setWeaponAttach(mode) {
      if (!katana || !sheathNode || mode === weaponMode) return;
      weaponMode = mode;
      if (mode === 'sheath') sheathNode.add(katana.group);
      else parts.Weapon.add(katana.group);
    },
    get weaponMode() {
      return weaponMode;
    },
  };
  return api;
}
