// First-person viewmodel clips (rig 'VM'). Space: CameraRoot = the eye, -Z forward.
// "Camera" is a virtual joint applied on top of the player's view (kick, roll, dip).
// Attack clips share length and marker times with their third-person counterparts so hit timing
// stays authoritative from the third-person animation.
import { clip, pose } from '../core/dsl.mjs';
import { reach, wieldVM } from '../core/kinematics.mjs';
import { Arc, inOutSine, lerp, lerp3, outCubic, outQuart } from '../combat-kit.mjs';

const VM = { rig: 'VM' };

// Normalised screen position (x right, y up, -1..1) at a view depth -> camera space (FOV 70, 16:9).
const scr = (nx, ny, d) => [nx * d * 0.7 * 1.778, ny * d * 0.7, -d];
const norm = (v) => {
  const l = Math.hypot(...v) || 1;
  return v.map((x) => x / l);
};
const TIP = 3.45;
// Hand and blade-tip screen positions (x, y, depth) -> grip + blade direction.
const ht = (hx, hy, hd, tx, ty, td) => {
  const g = scr(hx, hy, hd);
  const t = scr(tx, ty, td);
  return { grip: g, blade: norm(t.map((v, i) => v - g[i])) };
};
// Edge directions that lead the tip's motion along a key sequence of { grip, blade }.
function withEdges(keys) {
  const tip = (k) => k.grip.map((g, i) => g + norm(k.blade)[i] * TIP);
  return keys.map((k, i) => {
    const a = tip(keys[Math.max(0, i - 1)]);
    const b = tip(keys[Math.min(keys.length - 1, i + 1)]);
    let e = b.map((x, j) => x - a[j]);
    if (Math.hypot(...e) < 1e-6) e = k.edge ?? [0, -1, 0];
    return { ...k, edge: norm(e) };
  });
}

const LOW_LEFT = () => ({ LeftShoulder: { r: [-12, 0, -8] }, LeftElbow: { r: [25, 0, 0] }, LeftWrist: { r: [0, 0, 0] } });

// Hold pose: torso twist/offset + weapon, one or two handed.
function hold({ torso = {}, cam = {}, w, two = true, left = null }) {
  let p = pose({ Torso: { r: torso.r ?? [0, 14, 0], p: torso.p ?? [0, 0, 0] }, Camera: { r: cam.r ?? [0, 0, 0], p: cam.p ?? [0, 0, 0] } });
  const f = w.arc ? w.arc.frame(w.theta) : w;
  if (!two && left) p = p.with(left);
  return wieldVM(p, f.grip, f.blade, f.edge, { two });
}

const IDLE_W = { ...ht(0.4, -0.62, 1.3, -0.35, 0.75, 2.6), edge: [0.15, -0.45, -0.88] };
const IDLE = (k = 0) =>
  hold({
    torso: { r: [0 + k * 0.6, 14, -1], p: [0.18, -0.02 * k, -0.05] },
    w: { ...IDLE_W, grip: scr(0.4, -0.62 - 0.012 * k, 1.3) },
  });

export const FP_Idle = clip('FP_Idle', { length: 3.0, loop: true, ...VM }, (c) => {
  c.key(0, IDLE(0));
  c.key(1.5, IDLE(1), { lag: { RightWrist: 0.1, LeftWrist: 0.12 } });
});

// Sprint: blade lowered and swept back, arms pumping, synced to the third-person sprint phase.
export const FP_Sprint = clip('FP_Sprint', { length: 0.42, loop: true, ...VM, stride: 26 * 0.42, speed: 26 }, (c) => {
  const run = (k) =>
    hold({
      two: false,
      torso: { r: [6 + 3 * k, 10, 4 * k], p: [0.25, -0.18 - 0.04 * Math.abs(k), 0.1] },
      cam: { r: [0, 0, 1.2 * k] },
      w: { grip: [0.78 + 0.06 * k, -0.95 + 0.05 * k, -0.62 - 0.22 * k], blade: [0.25, -0.28, 1], edge: [0, -1, 0.3] },
      left: { LeftShoulder: { r: [30 - 45 * k, 0, -18] }, LeftElbow: { r: [80, 0, 0] }, LeftWrist: { r: [0, 0, 0] } },
    });
  c.key(0, run(1));
  c.key(0.21, run(-1));
});

// ---------------------------------------------------------------- attacks
// Screen-space strikes: keys give grip position + blade direction; edges follow the tip motion.
function fpStrike(name, length, { keys, markers, two = true, left = null }) {
  return clip(name, { length, ...VM, attack: name.replace('FP_', '') }, (c) => {
    c.key(0, IDLE(0));
    const ks = withEdges(keys);
    for (const k of ks) {
      const lf = left ? left(k.t) : null;
      c.key(
        k.t,
        hold({ two: k.two ?? two, torso: { r: k.torso ?? [0, 14, 0], p: k.torsoP ?? [0.18, 0, 0] }, cam: { r: k.cam ?? [0, 0, 0], p: k.camP ?? [0, 0, 0] }, w: k, left: lf }),
        { ease: k.ease },
      );
    }
    c.key(length, IDLE(0), { lag: { LeftShoulder: 0.04, RightShoulder: 0.02 } });
    for (const m of markers) c.marker(...m);
  });
}

// Densify a strike between two poses (grip and blade lerped with an ease) for smooth arcs.
function sweep(t0, t1, a, b, n = 5, ease = outCubic, extra = () => ({})) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    const k = ease(u);
    out.push({
      t: lerp(t0, t1, u),
      grip: lerp3(a.grip, b.grip, k),
      blade: norm(lerp3(norm(a.blade), norm(b.blade), k)),
      torso: lerp3(a.torso ?? [0, 14, 0], b.torso ?? [0, 14, 0], k),
      torsoP: lerp3(a.torsoP ?? [0.18, 0, 0], b.torsoP ?? [0.18, 0, 0], k),
      cam: lerp3(a.cam ?? [0, 0, 0], b.cam ?? [0, 0, 0], k),
      ...extra(k),
    });
  }
  return out;
}

const L1 = {
  wind: { ...ht(0.62, 0.3, 1.25, 0.15, 1.45, 2.4), torso: [-8, 4, 8], torsoP: [0.3, 0.12, 0], cam: [1.5, -2, -2] },
  mid: { ...ht(0.18, -0.35, 1.35, -1.15, 0.05, 2.3), torso: [6, 18, -2], torsoP: [0.12, -0.05, -0.1], cam: [-2, 2, 2] },
  end: { ...ht(-0.38, -0.8, 1.25, -1.2, -1.35, 2.2), torso: [14, 28, -6], torsoP: [0.02, -0.18, -0.1], cam: [-4, 4, 3] },
  follow: ht(-0.45, -0.88, 1.2, -1.15, -1.5, 2.1),
};
export const FP_Light1 = fpStrike('FP_Light1', 0.62, {
  two: false,
  left: LOW_LEFT,
  keys: [
    { t: 0.1, ...L1.wind, ease: 'smooth' },
    ...sweep(0.1, 0.145, L1.wind, L1.mid, 3, (x) => x),
    ...sweep(0.145, 0.19, L1.mid, L1.end, 3, outCubic),
    { t: 0.3, ...L1.end, ...L1.follow },
  ],
  markers: [
    [0.09, 'SwingStart', { slash: 'Diagonal' }],
    [0.115, 'HitStart'],
    [0.19, 'HitEnd'],
    [0.26, 'SwingEnd'],
    [0.22, 'ComboWindow'],
    [0.44, 'Recover'],
  ],
});

// Backhand: one hand, blade sweeps left -> right across the middle of the view.
const L2 = {
  wind: { ...ht(-0.55, -0.45, 1.2, -1.4, -0.05, 2.0), torso: [0, 36, 6], torsoP: [0.05, -0.05, 0], cam: [0, 4, 2] },
  mid: { ...ht(0.0, -0.4, 1.35, 0.0, 0.25, 3.0), torso: [2, 5, 0], torsoP: [0.15, -0.05, -0.1], cam: [-1, 0, 0] },
  end: { ...ht(0.62, -0.5, 1.2, 1.45, -0.15, 2.0), torso: [4, -30, -6], torsoP: [0.3, -0.05, 0], cam: [-1, -5, -4] },
  follow: ht(0.7, -0.55, 1.15, 1.5, -0.25, 1.9),
};
const leftFree = (a, b, t0 = 0.08, t1 = 0.16) => (t) => {
  const k = Math.min(Math.max((t - t0) / (t1 - t0), 0), 1);
  return {
    LeftShoulder: { r: lerp3(a[0], b[0], k) },
    LeftElbow: { r: lerp3(a[1], b[1], k) },
    LeftWrist: { r: [0, 0, 0] },
  };
};
export const FP_Light2 = fpStrike('FP_Light2', 0.58, {
  two: false,
  left: leftFree([[60, 0, 30], [50, 0, 0]], [[-20, 0, -50], [25, 0, 0]]),
  keys: [
    { t: 0.08, ...L2.wind },
    ...sweep(0.08, 0.12, L2.wind, L2.mid, 3, (x) => x),
    ...sweep(0.12, 0.16, L2.mid, L2.end, 3, outCubic),
    { t: 0.27, ...L2.end, ...L2.follow },
  ],
  markers: [
    [0.07, 'SwingStart', { slash: 'Horizontal' }],
    [0.095, 'HitStart'],
    [0.16, 'HitEnd'],
    [0.24, 'SwingEnd'],
    [0.2, 'ComboWindow'],
    [0.42, 'Recover'],
  ],
});

// Rising: low right -> high left.
const L3 = {
  wind: { ...ht(0.55, -0.85, 1.2, 1.15, -1.45, 2.0), torso: [-12, -10, 6], torsoP: [0.25, -0.25, 0], cam: [-4, -2, -2] },
  mid: { ...ht(0.1, -0.4, 1.35, -0.6, 0.6, 2.6), torso: [0, 10, 0], torsoP: [0.12, -0.05, -0.05], cam: [2, 1, 1] },
  end: { ...ht(-0.3, 0.1, 1.3, -0.65, 1.5, 2.3), torso: [12, 26, -8], torsoP: [0.02, 0.12, -0.1], cam: [6, 3, 4] },
  follow: ht(-0.35, 0.18, 1.25, -0.6, 1.6, 2.2),
};
export const FP_Light3 = fpStrike('FP_Light3', 0.64, {
  two: false,
  left: leftFree([[40, 0, 10], [70, 0, 0]], [[-30, 0, -45], [20, 0, 0]], 0.09, 0.18),
  keys: [
    { t: 0.09, ...L3.wind },
    ...sweep(0.09, 0.135, L3.wind, L3.mid, 3, (x) => x),
    ...sweep(0.135, 0.18, L3.mid, L3.end, 3, outCubic),
    { t: 0.31, ...L3.end, ...L3.follow },
  ],
  markers: [
    [0.08, 'SwingStart', { slash: 'Rising' }],
    [0.11, 'HitStart', { launch: true }],
    [0.18, 'HitEnd'],
    [0.26, 'SwingEnd'],
    [0.24, 'ComboWindow'],
    [0.46, 'Recover'],
  ],
});

// Finisher in first person: a fast right-to-left cut, then a huge two-handed return cleave with
// a camera roll (same two hit windows as the third-person whirlwind).
const L4 = {
  wind: { ...ht(0.62, -0.4, 1.2, 1.45, 0.0, 2.1), torso: [0, -40, 6], torsoP: [0.3, -0.05, 0.05], cam: [0, -6, -3] },
  mid1: { ...ht(0.0, -0.38, 1.35, 0.0, 0.2, 3.2), torso: [2, 0, 0], torsoP: [0.15, -0.05, -0.05], cam: [-1, 0, 1] },
  end1: { ...ht(-0.55, -0.45, 1.2, -1.45, -0.05, 2.1), torso: [4, 32, -4], torsoP: [0.02, -0.08, -0.05], cam: [-1, 5, 3] },
  // Finisher: both hands take the blade overhead as the spin lands, then a diagonal slam to the
  // floor with the view dipping hard into the impact (matches the third-person overhead cleave).
  coil: { ...ht(0.5, 0.78, 1.45, 0.25, 1.9, 2.4), torso: [-10, 6, 6], torsoP: [0.25, 0.15, 0.05], cam: [3, 2, -3], two: true },
  mid2: { ...ht(0.12, -0.15, 1.45, -0.55, 0.15, 3.1), torso: [8, 16, 0], torsoP: [0.15, -0.1, -0.1], cam: [-6, 2, 2], two: true },
  end2: { ...ht(-0.3, -0.7, 1.3, -1.1, -0.95, 2.4), torso: [22, 26, -6], torsoP: [0.05, -0.3, -0.15], cam: [-14, 4, 4], two: true },
  follow: { ...ht(-0.35, -0.75, 1.25, -1.1, -1.0, 2.35), two: true },
};
export const FP_Light4 = fpStrike('FP_Light4', 1.05, {
  two: false,
  left: LOW_LEFT,
  keys: [
    { t: 0.16, ...L4.wind },
    ...sweep(0.2, 0.25, L4.wind, L4.mid1, 2, (x) => x),
    ...sweep(0.25, 0.3, L4.mid1, L4.end1, 3, outCubic),
    { t: 0.42, ...L4.coil },
    ...sweep(0.43, 0.48, L4.coil, L4.mid2, 3, (x) => x * x, () => ({ two: true })),
    ...sweep(0.48, 0.53, L4.mid2, L4.end2, 3, outCubic, () => ({ two: true })),
    { t: 0.8, ...L4.end2, ...L4.follow, cam: [-11, 3, 3] },
  ],
  markers: [
    [0.15, 'SwingStart', { slash: 'Spin' }],
    [0.2, 'HitStart'],
    [0.32, 'HitEnd'],
    [0.38, 'SwingEnd'],
    [0.43, 'SwingStart', { slash: 'Overhead' }],
    [0.46, 'HitStart', { finisher: true }],
    [0.53, 'HitEnd'],
    [0.62, 'SwingEnd'],
    [0.86, 'Recover'],
  ],
});

// Heavy: blade raised high at the top right, trembling; the release slams down through the view.
const CHARGE_K = (j = 0) => ({
  ...ht(0.55, 0.42 + 0.01 * j, 1.3, 0.2, 1.75, 1.45),
  torso: [-14 + j, 8, 4],
  torsoP: [0.2, 0.25, 0.1],
  cam: [3 + j * 0.3, 0, j * 0.4],
});
export const FP_HeavyCharge = clip('FP_HeavyCharge', { length: 1.0, loop: true, ...VM }, (c) => {
  const k = (j) => {
    const w = CHARGE_K(j);
    return hold({ torso: { r: w.torso, p: w.torsoP }, cam: { r: w.cam }, w: { ...w, edge: [-0.3, 0, -1] } });
  };
  c.key(0, k(0));
  c.key(0.25, k(1));
  c.key(0.5, k(-0.6));
  c.key(0.75, k(0.8));
});

const HEAVY = {
  start: CHARGE_K(0),
  mid: { ...ht(0.15, -0.2, 1.4, -0.3, 0.35, 3.0), torso: [4, 6, 0], torsoP: [0.12, 0.0, -0.05], cam: [-4, 0, 0] },
  end: { ...ht(0.0, -0.8, 1.3, -0.2, -1.6, 2.8), torso: [22, 4, 0], torsoP: [0.05, -0.3, -0.15], cam: [-14, 0, 0] },
};
export const FP_HeavyRelease = fpStrike('FP_HeavyRelease', 0.95, {
  keys: [
    { t: 0.0, ...HEAVY.start },
    ...sweep(0.0, 0.07, HEAVY.start, HEAVY.mid, 3, (x) => x * x),
    ...sweep(0.07, 0.12, HEAVY.mid, HEAVY.end, 3, (x) => x),
    { t: 0.45, ...HEAVY.end, cam: [-11, 0, 0] },
  ],
  markers: [
    [0, 'SwingStart', { slash: 'Overhead' }],
    [0.04, 'HitStart', { guardBreak: true }],
    [0.12, 'HitEnd'],
    [0.12, 'HeavyImpact'],
    [0.3, 'SwingEnd'],
    [0.7, 'Recover'],
  ],
});

export const FP_AerialSlam = clip('FP_AerialSlam', { length: 0.5, loop: true, ...VM }, (c) => {
  const k = (j) => {
    const w = CHARGE_K(j);
    return hold({ torso: { r: w.torso, p: w.torsoP }, cam: { r: [-22 - j, 0, 0] }, w: { ...w, edge: [-0.3, 0, -1] } });
  };
  c.key(0, k(0));
  c.key(0.25, k(1));
});

export const FP_AerialSlamLand = fpStrike('FP_AerialSlamLand', 0.85, {
  keys: [
    { t: 0.0, ...HEAVY.start, cam: [-20, 0, 0] },
    ...sweep(0.0, 0.035, { ...HEAVY.start, cam: [-20, 0, 0] }, { ...HEAVY.mid, cam: [-18, 0, 0] }, 2, (x) => x),
    ...sweep(0.035, 0.07, { ...HEAVY.mid, cam: [-18, 0, 0] }, { ...HEAVY.end, cam: [-22, 0, 0], camP: [0, -0.6, 0] }, 2, (x) => x),
    { t: 0.4, ...HEAVY.end, cam: [-14, 0, 0], camP: [0, -0.5, 0] },
  ],
  markers: [
    [0, 'SwingStart', { slash: 'Overhead' }],
    [0, 'HitStart', { slam: true }],
    [0.07, 'SlamImpact'],
    [0.1, 'HitEnd'],
    [0.3, 'SwingEnd'],
    [0.6, 'Recover'],
  ],
});

// Lunge: blade drives from the lower right toward the centre of the view.
const LUNGE = {
  coil: { ...ht(0.6, -0.65, 1.0, 0.45, -0.25, 3.0), torso: [6, 30, 0], torsoP: [0.25, -0.15, 0.25], cam: [-2, 4, 0] },
  thrust: { ...ht(0.25, -0.35, 1.45, 0.02, -0.05, 4.8), torso: [6, 10, 0], torsoP: [0.05, -0.1, -0.35], cam: [-3, -2, 0] },
};
export const FP_Lunge = fpStrike('FP_Lunge', 0.7, {
  two: false,
  left: LOW_LEFT,
  keys: [
    { t: 0.05, ...LUNGE.coil },
    ...sweep(0.05, 0.13, LUNGE.coil, LUNGE.thrust, 3, outQuart),
    { t: 0.32, ...LUNGE.thrust, torsoP: [0.05, -0.1, -0.33] },
  ],
  markers: [
    [0.04, 'SwingStart', { slash: 'Thrust' }],
    [0.06, 'HitStart'],
    [0.22, 'HitEnd'],
    [0.3, 'SwingEnd'],
    [0.5, 'Recover'],
  ],
});

// Guard: blade held across the view, flat facing the camera.
const GUARD_W = { ...ht(0.3, -0.45, 1.3, -1.4, -0.05, 2.0), edge: [0, 0.35, -1] };
const GUARD = (k = 0) => hold({ torso: { r: [0, 6, 0], p: [0.05, 0.08 - 0.01 * k, 0] }, cam: { r: [0, 0, 0] }, w: { ...GUARD_W, grip: scr(0.3, -0.45 - 0.008 * k, 1.3) } });
export const FP_Block = clip('FP_Block', { length: 1.6, loop: true, ...VM }, (c) => {
  c.key(0, GUARD(0));
  c.key(0.8, GUARD(1));
});
export const FP_BlockHit = clip('FP_BlockHit', { length: 0.34, ...VM }, (c) => {
  c.key(0, GUARD(0));
  c.key(0.05, hold({ torso: { r: [-8, 6, 3], p: [0.05, 0.12, 0.3] }, cam: { r: [3, 0, 2], p: [0, 0, 0.1] }, w: { ...ht(0.28, -0.36, 1.05, -1.3, 0.0, 1.6), edge: [0, 0.35, -1] } }), { ease: 'outQuad' });
  c.key(0.34, GUARD(0));
  c.marker(0, 'BlockImpact');
});
const PARRY = {
  guard: { ...ht(0.3, -0.45, 1.3, -1.4, -0.05, 2.0), torso: [0, 6, 0], torsoP: [0.05, 0.08, 0] },
  snap: { ...ht(0.4, -0.32, 1.3, 1.35, 0.85, 2.0), torso: [0, -20, 0], torsoP: [0.1, 0.05, 0], cam: [0, -5, -4] },
};
export const FP_Parry = fpStrike('FP_Parry', 0.48, {
  two: false,
  left: LOW_LEFT,
  keys: [
    { t: 0.02, ...PARRY.guard },
    ...sweep(0.02, 0.08, PARRY.guard, PARRY.snap, 4, outQuart),
    { t: 0.22, ...PARRY.snap, cam: [0, -4, -3] },
  ],
  markers: [
    [0.02, 'SwingStart', { slash: 'Parry' }],
    [0.05, 'Parry'],
    [0.2, 'SwingEnd'],
  ],
});

const DRAW = {
  low: { ...ht(0.3, -1.45, 1.0, -0.8, -1.9, 1.5), torso: [10, 30, 0], torsoP: [0, -0.5, 0.25] },
  clear: { ...ht(-0.25, -0.95, 1.15, -1.25, -1.05, 1.95), torso: [6, 26, 0], torsoP: [0.05, -0.25, 0.15] },
  mid: { ...ht(0.05, -0.45, 1.35, 0.0, 0.2, 3.0), torso: [6, 4, 0], torsoP: [0.1, -0.15, 0], cam: [0, 1, 0] },
  end: { ...ht(0.6, -0.5, 1.2, 1.45, -0.1, 2.0), torso: [6, -20, 0], torsoP: [0.25, -0.1, 0], cam: [0, -3, -2] },
};
export const FP_Draw = clip('FP_Draw', { length: 0.62, ...VM }, (c) => {
  const keys = withEdges([
    { t: 0, ...DRAW.low },
    { t: 0.19, ...DRAW.clear },
    ...sweep(0.19, 0.23, DRAW.clear, DRAW.mid, 2, (x) => x),
    ...sweep(0.23, 0.27, DRAW.mid, DRAW.end, 3, outCubic),
  ]);
  for (const k of keys) c.key(k.t, hold({ two: false, torso: { r: k.torso, p: k.torsoP }, cam: { r: k.cam ?? [0, 0, 0] }, w: k, left: LOW_LEFT() }));
  c.key(0.62, IDLE(0));
  c.marker(0.18, 'SwingStart', { slash: 'Draw' });
  c.marker(0.2, 'HitStart');
  c.marker(0.27, 'HitEnd');
  c.marker(0.34, 'SwingEnd');
});

// ---------------------------------------------------------------- traversal
const FREE = (k = 0) =>
  hold({
    two: false,
    torso: { r: [4, 10, 0], p: [0.25, -0.2, 0.1] },
    w: { grip: [0.7, -0.9, -0.7], blade: [0.15, -0.2, -1], edge: [0, -1, 0] },
    left: { LeftShoulder: { r: [20 + k * 10, 0, -14] }, LeftElbow: { r: [60, 0, 0] }, LeftWrist: { r: [0, 0, 0] } },
  });

export const FP_SlideEnter = clip('FP_SlideEnter', { length: 0.24, ...VM }, (c) => {
  c.key(0, FREE(0));
  c.key(
    0.24,
    hold({
      two: false,
      torso: { r: [10, 18, 6], p: [0.3, -0.2, 0.15] },
      cam: { r: [4, 0, -9], p: [0, -1.35, 0] },
      w: { grip: [0.75, -0.6, -0.95], blade: [-0.1, 0.25, -1], edge: [0, -1, 0] },
      left: { LeftShoulder: { r: [-20, 0, -40] }, LeftElbow: { r: [10, 0, 0] }, LeftWrist: { r: [0, 0, 0] } },
    }),
    { ease: 'outCubic' },
  );
});
export const FP_Slide = clip('FP_Slide', { length: 0.8, loop: true, ...VM }, (c) => {
  const k = (j) =>
    hold({
      two: false,
      torso: { r: [10, 18, 6], p: [0.3, -0.2 + 0.01 * j, 0.15] },
      cam: { r: [4 + 0.4 * j, 0, -9 + 0.5 * j], p: [0, -1.35 + 0.02 * j, 0] },
      w: { grip: [0.75, -0.6, -0.95], blade: [-0.1, 0.25, -1], edge: [0, -1, 0] },
      left: { LeftShoulder: { r: [-20, 0, -40] }, LeftElbow: { r: [10, 0, 0] }, LeftWrist: { r: [0, 0, 0] } },
    });
  c.key(0, k(0));
  c.key(0.4, k(1));
});

export const FP_Vault = clip('FP_Vault', { length: 0.58, ...VM }, (c) => {
  // Left hand slams onto the rail in view, camera rolls over it.
  c.key(0, FREE(0));
  const plant = (cam, handY) =>
    reach(
      hold({ two: false, torso: { r: [10, 6, 0], p: [0.25, -0.2, 0] }, cam, w: { grip: [0.85, -0.75, -0.5], blade: [0.3, 0.1, -1], edge: [0, -1, 0] } }),
      'Left',
      [-0.35, handY, -1.05],
      { rig: 'VM' },
    );
  c.key(0.1, plant({ r: [-12, 0, 6] }, -1.3), { ease: 'outCubic' });
  c.key(0.2, plant({ r: [-8, 0, 12] }, -1.7));
  c.key(0.3, plant({ r: [-2, 0, 6] }, -2.3));
  c.key(0.42, FREE(1).with({ Camera: { r: [-3, 0, -2], p: [0, -0.25, 0] } }));
  c.key(0.58, FREE(0));
  c.marker(0.1, 'HandPlant', { hand: 'Left' });
  c.marker(0.42, 'Land', { strength: 'light' });
});

export const FP_Mantle = clip('FP_Mantle', { length: 0.92, ...VM }, (c) => {
  // Both hands catch the ledge in view and pull the view up over it.
  const hands = (y, z, cam) => {
    let p = pose({ Torso: { r: [-10, 0, 0], p: [0, 0.1, 0] }, Camera: { r: cam ?? [0, 0, 0] } });
    p = reach(p, 'Left', [-0.55, y, z], { rig: 'VM' });
    p = reach(p, 'Right', [0.55, y, z], { rig: 'VM' });
    return p;
  };
  c.key(0, FREE(0));
  c.key(0.14, hands(0.25, -1.0, [14, 0, 0]), { ease: 'outCubic' });
  c.key(0.3, hands(-0.1, -0.95, [8, 0, 0]));
  c.key(0.48, hands(-0.8, -0.85, [-8, 0, 0]));
  c.key(0.64, hands(-1.3, -0.55, [-14, 0, 2]).with({ Camera: { r: [-14, 0, 2], p: [0, -0.3, 0] } }));
  c.key(0.8, FREE(1).with({ Camera: { r: [-4, 0, 0], p: [0, -0.15, 0] } }));
  c.key(0.92, FREE(0));
  c.marker(0.14, 'HandPlant', { hand: 'Both' });
  c.marker(0.64, 'Land', { strength: 'light' });
});

function fpWallRun(side) {
  const s = side === 'Left' ? 1 : -1;
  return clip(`FP_WallRun${side}`, { length: 0.48, loop: true, ...VM, wall: side }, (c) => {
    const k = (j) => {
      let p = hold({
        two: false,
        torso: { r: [6, 10, 0], p: [0.25, -0.2 + 0.03 * j, 0.1] },
        cam: { r: [0, 0, -12 * s + 1.2 * j] },
        w: { grip: [0.8, -0.85 + 0.05 * j, -0.6], blade: [0.2, -0.15, -1], edge: [0, -1, 0] },
      });
      if (side === 'Left') p = reach(p, 'Left', [-1.15, -0.25 + 0.08 * j, -0.85 - 0.2 * j], { rig: 'VM' });
      else p = p.with({ LeftShoulder: { r: [40 - 30 * j, 0, -20] }, LeftElbow: { r: [80, 0, 0] }, LeftWrist: { r: [0, 0, 0] } });
      return p;
    };
    c.key(0, k(1));
    c.key(0.24, k(-1));
  });
}
export const FP_WallRunLeft = fpWallRun('Left');
export const FP_WallRunRight = fpWallRun('Right');

export const FP_Dash = clip('FP_Dash', { length: 0.44, ...VM }, (c) => {
  c.key(0, FREE(0));
  c.key(
    0.05,
    hold({
      two: false,
      torso: { r: [-6, 10, 0], p: [0.3, -0.35, 0.4] },
      cam: { r: [-3, 0, 0], p: [0, -0.2, 0] },
      w: { grip: [0.85, -1.0, -0.3], blade: [0.25, -0.3, 1], edge: [0, -1, 0] },
      left: { LeftShoulder: { r: [-40, 0, -20] }, LeftElbow: { r: [20, 0, 0] }, LeftWrist: { r: [0, 0, 0] } },
    }),
    { ease: 'outQuart' },
  );
  c.key(0.3, FREE(1).with({ Camera: { r: [1, 0, 0], p: [0, -0.1, 0] } }));
  c.key(0.44, FREE(0));
});

export const FP_Land = clip('FP_Land', { length: 0.36, additive: true, ...VM }, (c) => {
  const zero = pose({ Camera: {}, Torso: {} });
  c.key(0, zero);
  c.key(0.07, pose({ Camera: { r: [-4, 0, 0], p: [0, -0.32, 0] }, Torso: { p: [0, -0.12, 0], r: [3, 0, 0] } }), { ease: 'outQuad' });
  c.key(0.36, zero);
});

export const FP_DoubleJump = clip('FP_DoubleJump', { length: 0.58, ...VM }, (c) => {
  // Front flip read in first person: a fast forward pitch roll of the view.
  c.key(0, FREE(0));
  c.key(0.12, FREE(1).with({ Camera: { r: [-30, 0, 0] } }), { ease: 'inOutSine' });
  c.key(0.22, FREE(1).with({ Camera: { r: [-120, 0, 0] } }));
  c.key(0.32, FREE(1).with({ Camera: { r: [-240, 0, 0] } }));
  c.key(0.44, FREE(0).with({ Camera: { r: [-340, 0, 0] } }));
  c.key(0.58, FREE(0).with({ Camera: { r: [-360, 0, 0] } }));
  c.marker(0, 'DoubleJumpBurst');
});

export default [
  FP_Idle,
  FP_Sprint,
  FP_Light1,
  FP_Light2,
  FP_Light3,
  FP_Light4,
  FP_HeavyCharge,
  FP_HeavyRelease,
  FP_AerialSlam,
  FP_AerialSlamLand,
  FP_Lunge,
  FP_Block,
  FP_BlockHit,
  FP_Parry,
  FP_Draw,
  FP_SlideEnter,
  FP_Slide,
  FP_Vault,
  FP_Mantle,
  FP_WallRunLeft,
  FP_WallRunRight,
  FP_Dash,
  FP_Land,
  FP_DoubleJump,
];
