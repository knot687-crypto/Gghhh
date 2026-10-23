// Authoring-time forward kinematics and a damped-least-squares IK solver. Results are baked into
// keyframes, so the runtime never runs IK for authored motion. All positions are expressed in
// HumanoidRootPart space (or CameraRoot space for the viewmodel rig).

import { Pose } from './dsl.mjs';
import { RIGS } from './rig.mjs';
import { fromChannels, mulXform, quatFromEulerXYZ, quatMul, quatRotate } from './xform.mjs';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

function jointXform(def, c) {
  const c0 = { p: def.c0, q: def.c0r ? quatFromEulerXYZ(...def.c0r.map((x) => x * D2R)) : [0, 0, 0, 1] };
  const c1inv = { p: def.c1.map((x) => -x), q: [0, 0, 0, 1] };
  const tf = fromChannels({ rx: c.r[0], ry: c.r[1], rz: c.r[2], px: c.p[0], py: c.p[1], pz: c.p[2] });
  return mulXform(mulXform(c0, tf), c1inv);
}

// World (root-space) transform of every part.
export function fk(pose, rigName = 'R15') {
  const rig = RIGS[rigName];
  const out = { [rig.root]: { p: [0, 0, 0], q: [0, 0, 0, 1] } };
  for (const def of rig.joints) {
    const c = pose.j[def.name] ?? { r: [0, 0, 0], p: [0, 0, 0] };
    out[def.part1] = mulXform(out[def.part0], jointXform(def, c));
  }
  return out;
}

export function pointOf(world, part, local = [0, 0, 0]) {
  const x = world[part];
  const r = quatRotate(x.q, local);
  return [x.p[0] + r[0], x.p[1] + r[1], x.p[2] + r[2]];
}

export function quatToEulerXYZ(q) {
  const [x, y, z, w] = q;
  const m00 = 1 - 2 * (y * y + z * z);
  const m01 = 2 * (x * y - z * w);
  const m02 = 2 * (x * z + y * w);
  const m12 = 2 * (y * z - x * w);
  const m22 = 1 - 2 * (x * x + y * y);
  const m11 = 1 - 2 * (x * x + z * z);
  const b = Math.asin(Math.max(-1, Math.min(1, m02)));
  let a;
  let c;
  if (Math.abs(m02) < 0.99999) {
    a = Math.atan2(-m12, m22);
    c = Math.atan2(-m01, m00);
  } else {
    a = Math.atan2(2 * (y * z + x * w), m11);
    c = 0;
  }
  return [a * R2D, b * R2D, c * R2D];
}

function quatInv(q) {
  return [-q[0], -q[1], -q[2], q[3]];
}

// Rotation error as an axis-angle vector (radians) from current to target.
function rotError(cur, target) {
  let d = quatMul(target, quatInv(cur));
  if (d[3] < 0) d = d.map((x) => -x);
  const s = Math.hypot(d[0], d[1], d[2]);
  if (s < 1e-9) return [0, 0, 0];
  const angle = 2 * Math.atan2(s, d[3]);
  return [(d[0] / s) * angle, (d[1] / s) * angle, (d[2] / s) * angle];
}

function solveLinear(A, b) {
  // Gaussian elimination with partial pivoting (small dense systems).
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

/**
 * Damped least squares IK.
 * params:   [['RightShoulder', 'rx'], ...]  channels the solver may change (degrees / studs)
 * goals:    [{ part, local, pos, rot, wPos, wRot }]  root-space targets
 * rest:     regularisation weight pulling params toward their starting values
 */
export function solve(pose, { rig = 'R15', params, goals, rest = 0.00015, restWeights = {}, iters = 400, limits = {} }) {
  const p = pose.clone();
  const idx = { rx: ['r', 0], ry: ['r', 1], rz: ['r', 2], px: ['p', 0], py: ['p', 1], pz: ['p', 2] };
  const get = ([j, ch]) => (p.j[j] ??= { r: [0, 0, 0], p: [0, 0, 0] })[idx[ch][0]][idx[ch][1]];
  const set = ([j, ch], v) => {
    const lim = limits[`${j}.${ch}`];
    if (lim) v = Math.max(lim[0], Math.min(lim[1], v));
    (p.j[j] ??= { r: [0, 0, 0], p: [0, 0, 0] })[idx[ch][0]][idx[ch][1]] = v;
  };
  const start = params.map(get);

  const residual = () => {
    const w = fk(p, rig);
    const res = [];
    for (const g of goals) {
      if (g.rel) {
        // Relative goal: a point on `part` must coincide with a point on `rel.part`.
        const a = pointOf(w, g.part, g.local ?? [0, 0, 0]);
        const b = pointOf(w, g.rel.part, g.rel.local ?? [0, 0, 0]);
        const k = g.wPos ?? 1;
        res.push((a[0] - b[0]) * k, (a[1] - b[1]) * k, (a[2] - b[2]) * k);
        if (g.rel.rot) {
          // part rotation must equal rel.part rotation * rel.rot
          const target = quatMul(w[g.rel.part].q, g.rel.rot);
          const e = rotError(w[g.part].q, target);
          const kr = g.wRot ?? 0.5;
          res.push(-e[0] * kr, -e[1] * kr, -e[2] * kr);
        }
        continue;
      }
      if (g.pos) {
        const at = pointOf(w, g.part, g.local ?? [0, 0, 0]);
        const k = g.wPos ?? 1;
        res.push((at[0] - g.pos[0]) * k, (at[1] - g.pos[1]) * k, (at[2] - g.pos[2]) * k);
      }
      if (g.rot) {
        const cur = g.localRot ? quatMul(w[g.part].q, g.localRot) : w[g.part].q;
        const e = rotError(cur, g.rot);
        const k = g.wRot ?? 0.5;
        res.push(-e[0] * k, -e[1] * k, -e[2] * k);
      }
    }
    params.forEach((pr, i) => res.push((get(pr) - start[i]) * (restWeights[`${pr[0]}.${pr[1]}`] ?? rest)));
    return res;
  };

  let lambda = 0.5;
  let r = residual();
  let cost = r.reduce((s, x) => s + x * x, 0);
  for (let it = 0; it < iters && cost > 1e-10; it++) {
    const J = [];
    const h = 0.05;
    for (let i = 0; i < params.length; i++) {
      const v0 = get(params[i]);
      set(params[i], v0 + h);
      const r1 = residual();
      set(params[i], v0);
      J.push(r1.map((x, k) => (x - r[k]) / h));
    }
    // (J^T J + lambda I) dx = -J^T r ; J is stored transposed (params x residuals)
    const n = params.length;
    const A = Array.from({ length: n }, (_, a) =>
      Array.from({ length: n }, (_, b) => J[a].reduce((s, x, k) => s + x * J[b][k], 0) + (a === b ? lambda : 0)),
    );
    const g = Array.from({ length: n }, (_, a) => -J[a].reduce((s, x, k) => s + x * r[k], 0));
    const dx = solveLinear(A, g);
    const saved = params.map(get);
    params.forEach((pr, i) => set(pr, saved[i] + Math.max(-20, Math.min(20, dx[i]))));
    const r2 = residual();
    const cost2 = r2.reduce((s, x) => s + x * x, 0);
    if (cost2 < cost) {
      const gain = cost - cost2;
      r = r2;
      cost = cost2;
      lambda = Math.max(lambda * 0.5, 1e-8);
      // Converged: a near Gauss-Newton step that no longer helps (large-lambda steps are tiny
      // but not converged, so they don't count).
      if (lambda < 1e-3 && (gain < 1e-13 || dx.every((d) => Math.abs(d) < 1e-7))) break;
    } else {
      params.forEach((pr, i) => set(pr, saved[i]));
      lambda *= 4;
      // The rest term keeps the cost above zero at the optimum; once no step helps, stop.
      if (lambda > 1e8) break;
    }
  }
  return p;
}

const ARM = (s) => [
  [`${s}Shoulder`, 'rx'],
  [`${s}Shoulder`, 'ry'],
  [`${s}Shoulder`, 'rz'],
  [`${s}Elbow`, 'rx'],
];
const LEG = (s) => [
  [`${s}Hip`, 'rx'],
  [`${s}Hip`, 'ry'],
  [`${s}Hip`, 'rz'],
  [`${s}Knee`, 'rx'],
];

export const eulerQuat = (r) => quatFromEulerXYZ(r[0] * D2R, r[1] * D2R, r[2] * D2R);

/**
 * Place a foot's sole centre at `pos` (root space) with the foot flat and yawed by `yaw` degrees
 * (pitch/roll optional), solving hip + knee + ankle.
 */
export function plantFoot(pose, side, pos, { yaw = 0, pitch = 0, roll = 0, rig = 'R15' } = {}) {
  // A straight knee is an IK singularity (bending changes nothing to first order); pre-bend it.
  const knee = pose.j[`${side}Knee`]?.r[0] ?? 0;
  if (knee > -12) pose = pose.with({ [`${side}Knee`]: { r: [-25, 0, 0] } });
  // The sole centre is 0.251 below the ankle joint in foot space; derive the ankle target from
  // the requested foot orientation so orienting the foot afterwards keeps the sole planted.
  const footRot = eulerQuat([pitch, yaw, roll]);
  const up = quatRotate(footRot, [0, 0.251, 0]);
  const ankle = [pos[0] + up[0], pos[1] + up[1], pos[2] + up[2]];
  const solved = solve(pose, {
    rig,
    params: LEG(side),
    goals: [{ part: `${side}LowerLeg`, local: [0, -0.547, 0], pos: ankle }],
    limits: { [`${side}Knee.rx`]: [-150, 0] },
  });
  return orientPart(solved, `${side}Ankle`, `${side}Foot`, footRot, rig);
}

// Set a single joint so `part` ends up with the given root-space rotation.
export function orientPart(pose, joint, part, rot, rig = 'R15') {
  const R = RIGS[rig];
  const def = R.joints.find((j) => j.name === joint);
  const p = pose.with({ [joint]: { r: [0, 0, 0] } });
  const w = fk(p, rig);
  const parentRot = w[def.part0].q;
  const c0q = def.c0r ? eulerQuat(def.c0r) : [0, 0, 0, 1];
  // part1 rot = parentRot * c0q * T  =>  T = (parentRot*c0q)^-1 * rot
  const T = quatMul(quatInv(quatMul(parentRot, c0q)), rot);
  return p.with({ [joint]: { r: quatToEulerXYZ(T) } });
}

/**
 * Put a hand somewhere. `pos` is the grip point (0.15 below the hand centre, like
 * RightGripAttachment); optional `rot` orients the hand (root space).
 */
export function reach(pose, side, pos, { rot = null, rig = 'R15', wrist = true, wRot = 0.6 } = {}) {
  const elbow = pose.j[`${side}Elbow`]?.r[0] ?? 0;
  if (elbow < 12) pose = pose.with({ [`${side}Elbow`]: { r: [30, 0, 0] } });
  const params = [...ARM(side)];
  if (wrist && rot) params.push([`${side}Wrist`, 'rx'], [`${side}Wrist`, 'ry'], [`${side}Wrist`, 'rz']);
  const goals = [{ part: `${side}Hand`, local: [0, -0.15, 0], pos }];
  if (rot) goals.push({ part: `${side}Hand`, rot, wRot });
  return solve(pose, { rig, params, goals, limits: { [`${side}Elbow.rx`]: [0, 155] } });
}

/**
 * Two-handed katana grip: the left hand wraps the handle `offset` studs below the right hand,
 * matching the weapon orientation (rolled by `roll` degrees around the handle).
 */
export function twoHand(pose, { offset = 0.62, roll = 0, rig = 'R15' } = {}) {
  const w = fk(pose, rig);
  const weapon = w.Weapon;
  const gripPos = pointOf(w, 'Weapon', [0, -offset, 0]);
  // Desired LeftHand rotation so that its grip frame (-90 X) matches the weapon frame.
  const gripRot = quatMul(weapon.q, eulerQuat([0, roll, 0]));
  const handRot = quatMul(gripRot, quatInv(eulerQuat([-90, 0, 0])));
  return reach(pose, 'Left', gripPos, { rot: handRot, rig, wRot: 0.8 });
}

export function weaponTip(pose, rig = 'R15') {
  const w = fk(pose, rig);
  return pointOf(w, 'Weapon', [0, 3.45, 0.12]);
}

export { Pose };

// ---------- weapon placement helpers ----------

const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function quatFromBasis(X, Y, Z) {
  // Columns X, Y, Z of a rotation matrix -> quaternion.
  const m00 = X[0], m10 = X[1], m20 = X[2];
  const m01 = Y[0], m11 = Y[1], m21 = Y[2];
  const m02 = Z[0], m12 = Z[1], m22 = Z[2];
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    w = 0.25 / s;
    x = (m21 - m12) * s;
    y = (m02 - m20) * s;
    z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  return norm4([x, y, z, w]);
}
function norm4(q) {
  const l = Math.hypot(...q) || 1;
  return q.map((v) => v / l);
}

// Root-space rotation of the Weapon part whose blade (+Y) points along `blade` and whose cutting
// edge (-Z) faces `edge` (projected perpendicular to the blade).
export function weaponRot(blade, edge) {
  const Y = norm(blade);
  let e = norm(edge);
  e = norm([e[0] - Y[0] * dot(e, Y), e[1] - Y[1] * dot(e, Y), e[2] - Y[2] * dot(e, Y)]);
  const Z = [-e[0], -e[1], -e[2]];
  const X = cross(Y, Z);
  return quatFromBasis(X, Y, Z);
}

const GRIP_C0 = eulerQuat([-90, 0, 0]);

// Place the katana with the right hand: grip point at `pos`, blade/edge directions as given.
export function grip(pose, pos, blade, edge, { rig = 'R15', wRot = 1.2 } = {}) {
  const handRot = quatMul(weaponRot(blade, edge), quatInv(GRIP_C0));
  return reach(pose, 'Right', pos, { rot: handRot, rig, wRot });
}

// Report how far the left hand is from its handle position (for asserting two-hand poses).
export function twoHandError(pose, offset = 0.62, rig = 'R15') {
  const w = fk(pose, rig);
  const a = pointOf(w, 'LeftHand', [0, -0.15, 0]);
  const b = pointOf(w, 'Weapon', [0, -offset, 0]);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// Root-space frame of the sheathed katana (LowerTorso * sheath C0).
export function sheathFrame(pose, rig = 'R15') {
  const R = RIGS[rig];
  const w = fk(pose, rig);
  const lt = w[R.sheath.part0];
  return mulXform(lt, { p: R.sheath.c0, q: eulerQuat(R.sheath.c0r) });
}

// Natural roll of the left hand around the scabbard (thumb on the guard, fingers wrapped).
export const SCABBARD_ROLL = -162;

// Rest a hand on the scabbard `along` studs down the weapon axis from the sheathed grip point.
export function holdScabbard(pose, { side = 'Left', along = 0.75, roll = SCABBARD_ROLL, rig = 'R15', wRot = 0.5 } = {}) {
  const f = sheathFrame(pose, rig);
  const pos = (() => {
    const r = quatRotate(f.q, [0, along, 0]);
    return [f.p[0] + r[0], f.p[1] + r[1], f.p[2] + r[2]];
  })();
  const gripRot = quatMul(f.q, eulerQuat([0, roll, 0]));
  const handRot = quatMul(gripRot, quatInv(GRIP_C0));
  return reach(pose, side, pos, { rot: handRot, rig, wRot });
}

/**
 * Two-handed weapon solve: blade orientation is a hard goal, the off hand must sit on the handle
 * `offset` below the grip, and the grip position itself is only a soft goal (weight `gripWeight`)
 * so the solver can move the weapon slightly to keep both hands on it.
 */
export function wieldTwoHanded(pose, gripPos, blade, edge, { offset = 0.62, roll = 0, gripWeight = 0.35, rig = 'R15' } = {}) {
  let p = grip(pose, gripPos, blade, edge, { rig });
  p = twoHand(p, { offset, roll, rig });
  if (twoHandError(p, offset, rig) < 0.02) return p;
  const wRot = weaponRot(blade, edge);
  const handOffRot = quatMul(eulerQuat([0, roll, 0]), quatInv(GRIP_C0));
  const params = [
    ...ARM('Right'),
    ['RightWrist', 'rx'],
    ['RightWrist', 'ry'],
    ['RightWrist', 'rz'],
    ...ARM('Left'),
    ['LeftWrist', 'rx'],
    ['LeftWrist', 'ry'],
    ['LeftWrist', 'rz'],
  ];
  return solve(p, {
    rig,
    params,
    iters: 600,
    goals: [
      { part: 'Weapon', rot: wRot, wRot: 1.4 },
      { part: 'Weapon', local: [0, 0, 0], pos: gripPos, wPos: gripWeight },
      { part: 'LeftHand', local: [0, -0.15, 0], rel: { part: 'Weapon', local: [0, -offset, 0], rot: handOffRot }, wPos: 2.5, wRot: 0.6 },
    ],
    limits: { 'RightElbow.rx': [0, 155], 'LeftElbow.rx': [0, 155] },
  });
}

/**
 * Viewmodel weapon solve: like wieldTwoHanded, but the (invisible) viewmodel torso may slide and
 * turn to reach targets the arms alone cannot. Torso motion is penalised so arms do the work first.
 */
export function wieldVM(pose, gripPos, blade, edge, { two = true, offset = 0.62, roll = 0 } = {}) {
  const rig = 'VM';
  let p = two ? wieldTwoHanded(pose, gripPos, blade, edge, { offset, roll, rig }) : grip(pose, gripPos, blade, edge, { rig });
  const w = fk(p, rig);
  const g = pointOf(w, 'Weapon', [0, 0, 0]);
  const err = Math.hypot(g[0] - gripPos[0], g[1] - gripPos[1], g[2] - gripPos[2]);
  if (err < 0.02 && (!two || twoHandError(p, offset, rig) < 0.02)) return p;
  const wRot = weaponRot(blade, edge);
  const params = [
    ['Torso', 'px'],
    ['Torso', 'py'],
    ['Torso', 'pz'],
    ['Torso', 'ry'],
    ...ARM('Right'),
    ['RightWrist', 'rx'],
    ['RightWrist', 'ry'],
    ['RightWrist', 'rz'],
  ];
  const goals = [
    { part: 'Weapon', rot: wRot, wRot: 1.4 },
    { part: 'Weapon', local: [0, 0, 0], pos: gripPos, wPos: 1.5 },
  ];
  if (two) {
    params.push(...ARM('Left'), ['LeftWrist', 'rx'], ['LeftWrist', 'ry'], ['LeftWrist', 'rz']);
    const handOffRot = quatMul(eulerQuat([0, roll, 0]), quatInv(GRIP_C0));
    goals.push({ part: 'LeftHand', local: [0, -0.15, 0], rel: { part: 'Weapon', local: [0, -offset, 0], rot: handOffRot }, wPos: 2.5, wRot: 0.6 });
  }
  return solve(p, {
    rig,
    params,
    goals,
    iters: 600,
    restWeights: { 'Torso.px': 0.05, 'Torso.py': 0.05, 'Torso.pz': 0.035, 'Torso.ry': 0.002 },
    limits: { 'RightElbow.rx': [0, 155], 'LeftElbow.rx': [0, 155] },
  });
}
