// Katana combat: stance, 4-hit combo, heavy, aerial slam, lunge, block/parry, draw/sheath.
//
// Marker vocabulary consumed by the runtime:
//   SwingStart/SwingEnd  weapon trail on/off          HitStart/HitEnd  hitbox active window
//   ComboWindow          next attack may be queued    Recover          movement may resume
//   Stomp / HeavyImpact / SlamImpact / Parry / BlockImpact   VFX + camera cues
import { clip, pose } from '../core/dsl.mjs';
import { R15 } from '../core/rig.mjs';
import { eulerQuat, holdScabbard, plantFoot, reach, sheathFrame } from '../core/kinematics.mjs';
import { quatMul, quatRotate } from '../core/xform.mjs';
import { Arc, feet, G, inOutSine, keyPath, lerp, lerp3, outCubic, outQuart, pathFn, wield } from '../combat-kit.mjs';
import { pivotX } from '../helpers.mjs';
import { perform } from '../perform.mjs';

// ------------------------------------------------------------------ body specs
// rp/rr = Root position/rotation, wr = Waist, nr = Neck, L/R = feet [x, z, yaw, pitch, lift]
// (start-relative, root-motion compensated).
const STANCE = {
  rp: [0.05, -0.38, 0],
  rr: [-6, 14, 0],
  wr: [-10, 14, 0],
  nr: [12, -24, 0],
  R: [0.5, -0.6, -8, 0, 0],
  L: [-0.62, 0.55, 28, -12, 0],
};
const STANCE_W = { grip: [0.05, -0.18, -1.25], blade: [-0.06, 0.48, -0.88], edge: [0, -1, -0.5] };

function lerpSpec(a, b, t) {
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] ?? b[k];
    const y = b[k] ?? a[k];
    out[k] = lerp3(x, y, t);
  }
  return out;
}
function lerpW(a, b, t) {
  if (a.arc && b.arc && a.arc === b.arc) return { arc: a.arc, theta: lerp(a.theta, b.theta, t), spin: lerp(a.spin ?? 0, b.spin ?? 0, t) };
  const fa = a.arc ? a.arc.frame(a.theta, a.spin ?? 0) : a;
  const fb = b.arc ? b.arc.frame(b.theta, b.spin ?? 0) : b;
  return { grip: lerp3(fa.grip, fb.grip, t), blade: lerp3(fa.blade, fb.blade, t), edge: lerp3(fa.edge, fb.edge, t) };
}

const ARMS_FREE = ['LeftShoulder', 'LeftElbow', 'LeftWrist'];

function body(spec, offset = [0, 0, 0], extra = null) {
  let p = pose({
    Root: { p: spec.rp, r: spec.rr },
    Waist: { r: spec.wr },
    Neck: { r: spec.nr },
  });
  p = feet(p, { Left: spec.L, Right: spec.R }, offset);
  if (extra) p = p.with(extra);
  return p;
}

/**
 * Build one key: body + weapon. `left` (optional) gives explicit free left-arm rotations when the
 * swing is one-handed.
 */
function key(c, t, spec, w, { two = true, offset = [0, 0, 0], left = null, ease, lag, extra = null } = {}) {
  let p = body(spec, offset, extra);
  if (!two && left) p = p.with(left);
  p = wield(p, w, { two, offset: [0, 0, 0] });
  if (p._twoHandErr) console.warn(`  ${c.name} @${t.toFixed(3)} two-hand error ${p._twoHandErr.toFixed(3)}`);
  c.key(t, p, { ease, lag });
  return p;
}

// ------------------------------------------------------------------ strike mechanics
// Snap out of the anticipation, accelerate into contact, cushion into the follow-through.
const smooth = (x) => x * x * (3 - 2 * x);
export const strikeEase = (x) => 0.6 * outCubic(x) + 0.4 * smooth(x);

// Kinetic chain: how early (fraction of the strike) each body part finishes its move. Hips and
// the stepping foot drive, the torso follows, the eyes lead to the target; the arms are solved
// to the blade, so they trail the torso and the blade whips through last.
export const CHAIN = { rp: 0.3, rr: 0.3, wr: 0.16, nr: 0.38, L: 0.25, R: 0.25 };

// A foot moving between two placements travels on an arc: toe-off, swing, heel-first plant.
function stepFoot(a, b, u) {
  const k = smooth(u);
  const out = lerp3(a, b, k);
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (d < 0.15) return out;
  const h = Math.min(0.4, 0.1 + 0.16 * d);
  out[4] = Math.max(out[4], lerp(a[4] ?? 0, b[4] ?? 0, k) + h * Math.sin(Math.PI * k));
  out[3] = lerp(a[3] ?? 0, b[3] ?? 0, k) - (k < 0.5 ? 16 * Math.sin(Math.PI * 2 * k) : -12 * Math.sin(Math.PI * (2 * k - 1)));
  return out;
}

function chainSpec(a, b, u, ease, chain) {
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] ?? b[k];
    const y = b[k] ?? a[k];
    const uk = Math.min(1, u / (1 - (chain?.[k] ?? 0)));
    out[k] = (k === 'L' || k === 'R') && chain ? stepFoot(x, y, uk) : lerp3(x, y, ease(uk));
  }
  return out;
}

/**
 * A strike: N keys between two beats. The blade follows `ease`; with `chain` the body parts
 * lead it (see CHAIN) and moving feet step on arcs.
 */
function strike(c, t0, t1, specA, specB, wA, wB, { n = 5, ease = outCubic, two = true, path, leftA, leftB, chain = null } = {}) {
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    const k = ease(u);
    const t = lerp(t0, t1, u);
    const left = leftA && leftB ? lerpLeft(leftA, leftB, k) : leftA;
    const spec = chain ? chainSpec(specA, specB, u, ease, chain) : lerpSpec(specA, specB, k);
    key(c, t, spec, lerpW(wA, wB, k), { two, offset: path ? path(t) : [0, 0, 0], left });
  }
}
function lerpLeft(a, b, k) {
  const out = {};
  for (const j of Object.keys(a)) out[j] = { r: lerp3(a[j].r, b[j].r, k) };
  return out;
}

// Back-out ease: passes the target slightly and settles (follow-through on the recovery).
const settle = (x) => {
  const c1 = 1.70158;
  return 1 + (c1 + 1) * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

/**
 * Recovery: the body eases back with a small overshoot and settle; a foot that is out of place
 * steps back under the body on an arc early in the recovery (no skating); arms and head lag the
 * torso (overlap). Ends exactly in `to`.
 */
function recover(c, t0, t1, from, to, wFrom, wTo, { path, n = 5, two = true, leftFrom = null, leftTo = null, lag = { LeftShoulder: 0.05, RightShoulder: 0.03, Neck: 0.06 }, footBy = 0.55 } = {}) {
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    const t = lerp(t0, t1, u);
    const spec = {};
    for (const k of new Set([...Object.keys(from), ...Object.keys(to)])) {
      const x = from[k] ?? to[k];
      const y = to[k] ?? from[k];
      spec[k] = k === 'L' || k === 'R' ? stepFoot(x, y, Math.min(1, u / footBy)) : lerp3(x, y, i === n ? 1 : settle(u));
    }
    const kw = smooth(u);
    const left = leftFrom && leftTo ? lerpLeft(leftFrom, leftTo, kw) : leftTo;
    key(c, t, spec, i === n ? wTo : lerpW(wFrom, wTo, kw), { offset: path ? path(t) : [0, 0, 0], two: i === n ? true : two, left: i === n ? null : left, lag });
  }
}

const ARMED = { weapon: 'hand' };

// ------------------------------------------------------------------ Combat idle
export const CombatIdle = clip('CombatIdle', { length: 2.4, loop: true, ...ARMED }, (c) => {
  const breathe = (k) => ({
    ...STANCE,
    rp: [STANCE.rp[0], STANCE.rp[1] - 0.025 * k, STANCE.rp[2]],
    wr: [STANCE.wr[0] + 1.5 * k, STANCE.wr[1], STANCE.wr[2]],
  });
  key(c, 0, breathe(0), STANCE_W);
  key(c, 1.2, breathe(1), { ...STANCE_W, grip: [0.05, -0.2, -1.24], blade: [-0.08, 0.5, -0.87] }, { lag: { Neck: 0.15 } });
});

// ------------------------------------------------------------------ Armed locomotion overlays
// Upper-body only: they key just the arms (and spine for the guard walk), so the legs and pelvis
// come from the regular locomotion cycles underneath.
export const ArmedWalk = clip('ArmedWalk', { length: 1.6, loop: true, ...ARMED, overlay: true }, (c) => {
  const guard = (k) => {
    const p = wield(pose({ Waist: { r: [-6, 14, 0] }, Neck: { r: [8, -16, 0] } }), {
      ...STANCE_W,
      grip: [0.05, -0.12 - 0.02 * k, -1.2],
    });
    return p.only(['Waist', 'Neck', 'RightShoulder', 'RightElbow', 'RightWrist', 'LeftShoulder', 'LeftElbow', 'LeftWrist']);
  };
  c.key(0, guard(0));
  c.key(0.8, guard(1));
});

export const ArmedRun = clip('ArmedRun', { length: 0.5, loop: true, ...ARMED, overlay: true, syncWith: 'Run' }, (c) => {
  // One-handed trailing carry: blade swept back and low, gentle counter-swing with the stride.
  const carry = (k) => {
    const p = wield(pose({}), {
      grip: [1.22 + 0.04 * k, -0.62, 0.32 - 0.22 * k],
      blade: [0.3, 0.18, 1],
      edge: [0, -1, 0.15],
    }, { two: false });
    return p.only(['RightShoulder', 'RightElbow', 'RightWrist']);
  };
  c.key(0, carry(1));
  c.key(0.25, carry(-1));
});

// ------------------------------------------------------------------ Light 1: kesa-giri
// Hasso windup (blade upright by the right shoulder, hips and shoulders coiled, eyes on the
// target) -> load (hips start forward while the shoulders stay back and the blade tip drops
// behind the head) -> diagonal cut with a fumikomi stamp: hips lead, the torso follows, the
// blade whips through last -> follow-through with the body sunk into the cut -> hikitsuke
// (rear foot drawn up) -> zanshin -> chudan.
const ARC1 = new Arc({ c: [0.0, 0.16, -0.58], r: 1.15, roll: -40, bladeLead: 6 });
export const Light1 = clip('Light1', { length: 0.62, ...ARMED, attack: 'Light1', reduce: true }, (c) => {
  const S = STANCE;
  perform(c, {
    path: [
      [0, 0, 0, 0],
      [0.115, 0, 0, 0.04],
      [0.19, 0, 0, -0.62],
      [0.29, 0, 0, -0.93],
      [0.4, 0, 0, -0.99],
      [0.62, 0, 0, -1.0],
    ],
    beats: [
      { t: 0, body: S, w: STANCE_W },
      {
        t: 0.1,
        body: { rp: [-0.06, -0.28, 0.14], rr: [-2, -12, 2], wr: [0, -26, -5], nr: [6, 34, 0] },
        w: { arc: ARC1, theta: -40, lead: 14 },
        in: 'outCubic',
        lead: { nr: 0.02, w: -0.01 },
      },
      {
        t: 0.125,
        body: { rp: [-0.04, -0.36, 0.08], rr: [-4, -4, 2], wr: [-2, -32, -5], nr: [8, 34, 0] },
        w: { arc: ARC1, theta: -44, lead: -12 },
      },
      {
        t: 0.15,
        body: { rp: [0.0, -0.44, -0.04], rr: [-9, 12, 1], wr: [-8, -2, 3], nr: [10, -12, 0] },
        w: { arc: ARC1, theta: 78, lead: 4 },
        lead: { rr: 0.012, rp: 0.01, wr: 0.004, nr: 0.016 },
      },
      {
        t: 0.19,
        body: { rp: [0.02, -0.5, -0.1], rr: [-10, 22, 2], wr: [-8, 14, 5], nr: [8, -32, 0] },
        w: { arc: ARC1, theta: 136, lead: 6 },
        lead: { rr: 0.01, rp: 0.008, nr: 0.012 },
      },
      {
        t: 0.28,
        body: { rp: [0.0, -0.54, -0.12], rr: [-12, 25, 3], wr: [-10, 18, 6], nr: [9, -38, 0] },
        w: { arc: ARC1, theta: 145, lead: -4 },
      },
      {
        t: 0.4,
        body: { rp: [0.0, -0.5, -0.1], rr: [-10, 24, 2], wr: [-9, 17, 5], nr: [8, -37, 0] },
        w: { arc: ARC1, theta: 146, lead: -6 },
      },
      {
        t: 0.54,
        body: { rp: [0.05, -0.36, 0], rr: [-5, 11.5, 0], wr: [-9, 12, 0], nr: [11, -21, 0] },
        w: { ...STANCE_W, grip: [0.05, -0.15, -1.25] },
        lead: { nr: 0.04, rr: 0.02, rp: 0.02, w: -0.015 },
      },
      { t: 0.62, body: S, w: STANCE_W },
    ],
    feet: {
      R: [
        [0, S.R],
        [0.115, S.R],
        [0.17, [0.5, -1.6, -8, 0, 0], { h: 0.26 }],
      ],
      L: [
        [0, S.L],
        [0.17, [-0.62, 0.55, 28, -24, 0]],
        [0.2, [-0.62, 0.55, 28, -24, 0]],
        [0.29, [-0.62, -0.45, 28, -12, 0], { drag: true }],
      ],
    },
  });
  c.marker(0.125, 'SwingStart', { slash: 'Diagonal' });
  c.marker(0.115, 'HitStart');
  c.marker(0.19, 'HitEnd');
  c.marker(0.17, 'Stomp', { foot: 'Right' });
  c.marker(0.27, 'SwingEnd');
  c.marker(0.22, 'ComboWindow');
  c.marker(0.44, 'Recover');
});

// ------------------------------------------------------------------ Light 2: backhand sweep (one hand)
// Picks up where Light1 leaves the body (coiled left, blade on the left): the left hand lets
// go and points at the target, the right arm cocks the blade across the chest, then the hips
// unwind to the right and the blade sweeps flat across at shoulder height while the left arm
// is thrown back for balance. The front foot steps out and turns with the hips.
const ARC2 = new Arc({ c: [0.28, 0.1, -0.2], r: 1.22, roll: 90, pitch: -8, bladeLead: 8 });
export const Light2 = clip('Light2', { length: 0.58, ...ARMED, attack: 'Light2', reduce: true }, (c) => {
  const S = STANCE;
  const leftWind = { LeftShoulder: { r: [78, 0, 24] }, LeftElbow: { r: [24, 0, 0] }, LeftWrist: { r: [0, 0, -10] } };
  // Torso-relative: with the shoulders turned right, swinging the arm back points it away from
  // the blade (counterbalance).
  const leftThrow = { LeftShoulder: { r: [-72, 0, -34] }, LeftElbow: { r: [16, 0, 0] }, LeftWrist: { r: [0, 0, 0] } };
  const leftOpen = { LeftShoulder: { r: [-48, 0, -40] }, LeftElbow: { r: [26, 0, 0] }, LeftWrist: { r: [0, 0, 0] } };
  perform(c, {
    path: [
      [0, 0, 0, 0],
      [0.095, 0, 0, 0.02],
      [0.16, 0, 0, -0.45],
      [0.27, 0, 0, -0.66],
      [0.4, 0, 0, -0.7],
      [0.58, 0, 0, -0.7],
    ],
    beats: [
      { t: 0, body: S, w: STANCE_W },
      {
        t: 0.08,
        body: { rp: [0.06, -0.4, 0.08], rr: [-8, 36, 0], wr: [-8, 24, 2], nr: [10, -56, 0] },
        w: { arc: ARC2, theta: -15, lead: 6 },
        left: leftWind,
        in: 'outCubic',
        lead: { nr: 0.02, hands: 0.01 },
      },
      {
        t: 0.095,
        body: { rp: [0.06, -0.45, 0.06], rr: [-8, 29, 0], wr: [-8, 28, 2], nr: [10, -56, 0] },
        w: { arc: ARC2, theta: -18, lead: -14 },
        left: leftWind,
      },
      {
        t: 0.12,
        body: { rp: [0.02, -0.5, -0.04], rr: [-8, -6, 0], wr: [-6, -8, -2], nr: [8, 14, 0] },
        w: { arc: ARC2, theta: 95, lead: 6 },
        left: { LeftShoulder: { r: [20, 0, -40] }, LeftElbow: { r: [30, 0, 0] }, LeftWrist: { r: [0, 0, 0] } },
        lead: { rr: 0.012, rp: 0.01, wr: 0.004, nr: 0.016, hands: 0.008 },
      },
      {
        t: 0.16,
        body: { rp: [0.0, -0.56, -0.1], rr: [-8, -40, -2], wr: [-8, -26, -4], nr: [10, 56, 0] },
        w: { arc: ARC2, theta: 192, lead: 10 },
        left: leftThrow,
        lead: { rr: 0.01, rp: 0.008, nr: 0.012 },
      },
      {
        t: 0.27,
        body: { rp: [0.0, -0.58, -0.12], rr: [-9, -46, -2], wr: [-9, -30, -5], nr: [11, 62, 0] },
        w: { arc: ARC2, theta: 204, lead: 4 },
        left: leftThrow,
      },
      {
        t: 0.38,
        body: { rp: [0.0, -0.54, -0.1], rr: [-8, -44, -2], wr: [-8, -29, -4], nr: [10, 60, 0] },
        w: { arc: ARC2, theta: 205, lead: 0 },
        left: leftOpen,
      },
      {
        t: 0.5,
        body: { rp: [0.05, -0.36, 0], rr: [-5, 11.5, 0], wr: [-9, 12, 0], nr: [11, -21, 0] },
        w: { ...STANCE_W, grip: [0.05, -0.15, -1.25] },
        lead: { nr: 0.04, rr: 0.02, rp: 0.02, w: -0.01 },
      },
      { t: 0.58, body: S, w: STANCE_W },
    ],
    feet: {
      R: [
        [0, S.R],
        [0.095, S.R],
        [0.15, [0.5, -1.3, -22, 0, 0], { h: 0.22 }],
        [0.42, [0.5, -1.3, -22, 0, 0]],
        [0.52, [0.5, -1.3, -8, 0, 0]],
      ],
      L: [
        [0, S.L],
        [0.13, [-0.62, 0.55, 30, -22, 0]],
        [0.15, [-0.62, 0.55, 30, -22, 0]],
        [0.24, [-0.62, -0.15, 28, -12, 0], { drag: true }],
      ],
    },
  });
  c.marker(0.09, 'SwingStart', { slash: 'Horizontal' });
  c.marker(0.095, 'HitStart');
  c.marker(0.16, 'HitEnd');
  c.marker(0.24, 'SwingEnd');
  c.marker(0.2, 'ComboWindow');
  c.marker(0.42, 'Recover');
});

// Ballistic root-motion arc: take off at t0 from p0, land at t1 on p1, apex height h above the
// straight line between them (horizontal speed constant in the air).
function hopPath(t0, t1, p0, p1, h, n = 10) {
  const out = [];
  for (let i = 1; i < n; i++) {
    const u = i / n;
    out.push([lerp(t0, t1, u), lerp(p0[0], p1[0], u), lerp(p0[1], p1[1], u) + 4 * h * u * (1 - u), lerp(p0[2], p1[2], u)]);
  }
  return out;
}

// ------------------------------------------------------------------ Light 3: rising slash with hop
// Drops into a deep crouch with the blade low behind the right hip, then drives up off both
// feet: the rising cut (low right -> high left) launches the target while the body leaves the
// ground, the left hand lets go and is thrown down for balance, legs tuck, and the landing is
// absorbed with the blade still high before settling back to chudan.
const ARC3 = new Arc({ c: [0.0, 0.22, -0.5], r: 1.05, roll: -140, bladeLead: 6 });
export const Light3 = clip('Light3', { length: 0.64, ...ARMED, attack: 'Light3', visualLift: true, reduce: true }, (c) => {
  const S = STANCE;
  const leftThrow = { LeftShoulder: { r: [-50, 0, -42] }, LeftElbow: { r: [16, 0, 0] }, LeftWrist: { r: [0, 0, 0] } };
  perform(c, {
    path: [
      [0, 0, 0, 0],
      [0.09, 0, 0, -0.1],
      [0.14, 0, 0, -0.4],
      ...hopPath(0.14, 0.31, [0, 0, -0.4], [0, 0, -1.22], 0.62),
      [0.31, 0, 0, -1.22],
      [0.4, 0, 0, -1.28],
      [0.64, 0, 0, -1.3],
    ],
    beats: [
      { t: 0, body: S, w: STANCE_W },
      {
        t: 0.09,
        body: { rp: [0.06, -0.78, 0.06], rr: [-16, -30, 0], wr: [-14, -18, 0], nr: [26, 42, 0] },
        w: { arc: ARC3, theta: -30, lead: 4 },
        in: 'outCubic',
        lead: { nr: 0.02 },
      },
      {
        t: 0.105,
        body: { rp: [0.06, -0.84, 0.04], rr: [-18, -24, 0], wr: [-16, -22, 0], nr: [28, 42, 0] },
        w: { arc: ARC3, theta: -34, lead: -10 },
      },
      {
        t: 0.14,
        body: { rp: [0.0, -0.18, -0.04], rr: [-2, 8, 0], wr: [0, 2, 2], nr: [4, -14, 0] },
        w: { arc: ARC3, theta: 92, lead: 6 },
        lead: { rr: 0.012, rp: 0.012, wr: 0.004, nr: 0.016 },
      },
      {
        t: 0.2,
        body: { rp: [-0.04, -0.3, -0.04], rr: [6, 30, 0], wr: [8, 20, 4], nr: [-8, -40, 0] },
        w: { arc: ARC3, theta: 165, lead: 10 },
        left: leftThrow,
        lead: { rr: 0.01, nr: 0.012, hands: 0.02 },
      },
      {
        t: 0.27,
        body: { rp: [0.0, -0.22, 0.0], rr: [0, 28, 0], wr: [2, 18, 3], nr: [0, -36, 0] },
        w: { arc: ARC3, theta: 170, lead: 6 },
        left: leftThrow,
      },
      {
        t: 0.31,
        body: { rp: [0.04, -0.66, 0.0], rr: [-12, 24, 0], wr: [-8, 16, 2], nr: [14, -30, 0] },
        w: { arc: ARC3, theta: 172, lead: 2 },
        left: leftThrow,
      },
      {
        t: 0.42,
        body: { rp: [0.04, -0.5, 0.0], rr: [-8, 20, 0], wr: [-8, 15, 1], nr: [12, -27, 0] },
        w: { arc: ARC3, theta: 174, lead: -8 },
        left: { LeftShoulder: { r: [-10, 0, -40] }, LeftElbow: { r: [30, 0, 0] }, LeftWrist: { r: [0, 0, 0] } },
      },
      {
        t: 0.56,
        body: { rp: [0.05, -0.36, 0], rr: [-5, 11.5, 0], wr: [-9, 12, 0], nr: [11, -21, 0] },
        w: { ...STANCE_W, grip: [0.05, -0.15, -1.25] },
        lead: { nr: 0.04, rr: 0.02, rp: 0.02, w: -0.01 },
      },
      { t: 0.64, body: S, w: STANCE_W },
    ],
    feet: {
      R: [
        [0, S.R],
        [0.1, S.R],
        [0.14, [0.5, -0.6, -8, -24, 0]],
        [0.2, [0.45, -1.12, -12, -28, 0.78], { air: true }],
        [0.27, [0.5, -1.7, -8, -20, 0.3], { air: true }],
        [0.31, [0.5, -1.9, -8, 0, 0], { air: true }],
      ],
      L: [
        [0, S.L],
        [0.1, [-0.62, 0.55, 28, -16, 0]],
        [0.15, [-0.62, 0.55, 28, -34, 0]],
        [0.21, [-0.55, -0.25, 22, -38, 0.92], { air: true }],
        [0.28, [-0.6, -0.62, 26, -28, 0.38], { air: true }],
        [0.33, [-0.62, -0.75, 28, -12, 0], { air: true }],
      ],
    },
  });
  c.marker(0.105, 'SwingStart', { slash: 'Rising' });
  c.marker(0.11, 'HitStart', { launch: true });
  c.marker(0.18, 'HitEnd');
  c.marker(0.31, 'Land', { strength: 'light' });
  c.marker(0.26, 'SwingEnd');
  c.marker(0.24, 'ComboWindow');
  c.marker(0.46, 'Recover');
});

// ------------------------------------------------------------------ Light 4: whirlwind -> finisher
// Coils hard right with the left hand aimed at the target, then springs into a jumping spin:
// legs tucked, blade extended one-handed, sweeping a full circle around the body while the head
// spots the target. Over the last quarter turn the left hand regrips and the blade rises
// overhead; the character lands in a wide stance and slams a diagonal cleave down to the
// ground (finisher), holds the zanshin, then draws the rear foot up into chudan.
const ARC4 = new Arc({ c: [0, 0.18, -0.1], r: 1.05, roll: -90, pitch: 4, bladeLead: 4 });
const ARC4F = new Arc({ c: [0.0, 0.3, -0.7], r: 1.25, roll: -28, bladeLead: 6 });
export const Light4 = clip('Light4', { length: 1.05, ...ARMED, attack: 'Light4', visualLift: true, reduce: true }, (c) => {
  const S = STANCE;
  const point = { LeftShoulder: { r: [88, 0, 34] }, LeftElbow: { r: [6, 0, 0] }, LeftWrist: { r: [0, 0, 0] } };
  const spread = { LeftShoulder: { r: [8, 0, -82] }, LeftElbow: { r: [12, 0, 0] }, LeftWrist: { r: [0, 0, 0] } };
  const tuck = {
    LeftHip: { r: [72, 0, -10] },
    LeftKnee: { r: [-112, 0, 0] },
    LeftAnkle: { r: [-16, 0, 0] },
    RightHip: { r: [48, 0, 10] },
    RightKnee: { r: [-96, 0, 0] },
    RightAnkle: { r: [-16, 0, 0] },
  };
  perform(c, {
    path: [
      [0, 0, 0, 0],
      [0.14, 0, 0, 0.12],
      [0.18, 0, 0, -0.05],
      ...hopPath(0.18, 0.42, [0, 0, -0.05], [0, 0, -1.6], 0.55),
      [0.42, 0, 0, -1.6],
      [0.5, 0, 0, -1.86],
      [0.62, 0, 0, -1.96],
      [1.05, 0, 0, -2.0],
    ],
    beats: [
      { t: 0, body: S, w: STANCE_W },
      {
        t: 0.14,
        body: { rp: [0.08, -0.62, 0.1], rr: [-10, -55, 0], wr: [-10, -28, 0], nr: [12, 70, 0] },
        w: { arc: ARC4, theta: -30, spin: -55, lead: -6 },
        left: point,
        in: 'outCubic',
        lead: { nr: 0.03, hands: 0.02 },
      },
      {
        t: 0.2,
        body: { rp: [0.0, -0.22, 0.0], rr: [-6, 20, 0], wr: [-6, -10, 0], nr: [8, -10, 0] },
        w: { arc: ARC4, theta: 8, spin: 20, lead: 6 },
        left: spread,
        extra: tuck,
      },
      {
        t: 0.26,
        body: { rp: [0.0, -0.15, 0.0], rr: [-4, 120, 0], wr: [-6, -10, 0], nr: [6, 30, 0] },
        w: { arc: ARC4, theta: 10, spin: 120, lead: 8 },
        left: spread,
      },
      {
        t: 0.32,
        body: { rp: [0.0, -0.15, 0.0], rr: [-4, 220, 0], wr: [-6, -8, 0], nr: [6, 60, 0] },
        w: { arc: ARC4, theta: 10, spin: 220, lead: 8 },
        left: spread,
        extra: tuck,
      },
      {
        t: 0.37,
        body: { rp: [0.0, -0.2, 0.0], rr: [-6, 300, 0], wr: [-6, -8, 0], nr: [8, 40, 0] },
        w: { arc: ARC4, theta: 12, spin: 300, lead: 4 },
        left: spread,
      },
      {
        t: 0.41,
        body: { rp: [0.0, -0.5, -0.02], rr: [-8, 340, 0], wr: [-6, -16, -4], nr: [8, 32, 0] },
        w: { arc: ARC4F, theta: -38, lead: 14 },
        lead: { hands: -0.01 },
      },
      {
        t: 0.425,
        body: { rp: [0.0, -0.66, -0.04], rr: [-10, 346, 0], wr: [-6, -22, -4], nr: [10, 30, 0] },
        w: { arc: ARC4F, theta: -42, lead: -12 },
      },
      {
        t: 0.47,
        body: { rp: [0.0, -0.84, -0.1], rr: [-18, 368, 0], wr: [-12, 0, 2], nr: [16, -10, 0] },
        w: { arc: ARC4F, theta: 80, lead: 4 },
        lead: { rr: 0.012, rp: 0.01, nr: 0.016 },
      },
      {
        t: 0.52,
        body: { rp: [0.0, -0.98, -0.16], rr: [-26, 380, 2], wr: [-14, 16, 4], nr: [26, -36, 0] },
        w: { arc: ARC4F, theta: 128, lead: 4 },
        lead: { rr: 0.008, rp: 0.008 },
      },
      {
        t: 0.62,
        body: { rp: [0.0, -1.0, -0.16], rr: [-27, 384, 2], wr: [-15, 18, 5], nr: [27, -40, 0] },
        w: { arc: ARC4F, theta: 132, lead: -2 },
      },
      {
        t: 0.8,
        body: { rp: [0.0, -0.94, -0.13], rr: [-24, 383, 2], wr: [-14, 18, 4], nr: [24, -39, 0] },
        w: { arc: ARC4F, theta: 133, lead: -4 },
      },
      {
        t: 0.97,
        body: { rp: [0.05, -0.36, 0], rr: [-5, 371.5, 0], wr: [-9, 12, 0], nr: [11, -21, 0] },
        w: { ...STANCE_W, grip: [0.05, -0.15, -1.25] },
        lead: { nr: 0.05, rr: 0.03, rp: 0.03, w: -0.02 },
      },
      { t: 1.05, body: { ...S, rr: [-6, 374, 0] }, w: STANCE_W },
    ],
    feet: {
      R: [
        [0, S.R],
        [0.1, [0.5, -0.6, -20, 0, 0]],
        [0.16, [0.5, -0.6, -20, -26, 0]],
        [0.23, null],
        [0.35, null],
        [0.42, [0.5, -2.6, -10, 0, 0]],
      ],
      L: [
        [0, S.L],
        [0.14, [-0.62, 0.55, 30, -18, 0]],
        [0.18, [-0.62, 0.55, 30, -32, 0]],
        [0.25, null],
        [0.37, null],
        [0.45, [-0.62, -0.75, 30, -20, 0]],
        [0.74, [-0.62, -0.75, 30, -20, 0]],
        [0.85, [-0.62, -1.45, 28, -12, 0], { drag: true }],
      ],
    },
  });
  c.marker(0.15, 'SwingStart', { slash: 'Spin' });
  c.marker(0.2, 'HitStart');
  c.marker(0.32, 'HitEnd');
  c.marker(0.38, 'SwingEnd');
  c.marker(0.425, 'SwingStart', { slash: 'Overhead' });
  c.marker(0.46, 'HitStart', { finisher: true });
  c.marker(0.53, 'HitEnd');
  c.marker(0.52, 'Stomp', { foot: 'Right' });
  c.marker(0.62, 'SwingEnd');
  c.marker(0.86, 'Recover');
});

// ------------------------------------------------------------------ Heavy: charge + overhead cleave
const ARCH = new Arc({ c: [0.05, 0.05, -0.65], r: 0.8, roll: -6, bladeLead: 4 });
const CHARGE = { rp: [0.04, -0.62, 0.15], rr: [6, 8, 0], wr: [8, 6, 0], nr: [-4, -14, 0], R: [0.62, -0.75, -8, 0, 0], L: [-0.7, 0.7, 26, -18, 0] };
// Jodan: hands above the forehead, blade angled back over the head.
const CHARGE_W = { grip: [0.1, 0.86, -0.24], blade: [-0.05, 0.55, 0.83], edge: [0, 0.6, -1] };
export const HeavyCharge = clip('HeavyCharge', { length: 1.0, loop: true, ...ARMED }, (c) => {
  const tremble = (k) => ({ ...CHARGE, rp: [CHARGE.rp[0] + 0.01 * k, CHARGE.rp[1] - 0.02 * Math.abs(k), CHARGE.rp[2]], rr: [CHARGE.rr[0] + k, CHARGE.rr[1], CHARGE.rr[2]] });
  key(c, 0, tremble(0), CHARGE_W);
  key(c, 0.25, tremble(1), { ...CHARGE_W, grip: [0.1, 0.84, -0.25] });
  key(c, 0.5, tremble(-0.5), { ...CHARGE_W, grip: [0.09, 0.86, -0.23] });
  key(c, 0.75, tremble(0.8), { ...CHARGE_W, grip: [0.1, 0.83, -0.24] });
});

export const HeavyRelease = clip('HeavyRelease', { length: 0.95, ...ARMED, attack: 'Heavy' }, (c) => {
  const P = [
    [0, 0, 0, 0],
    [0.12, 0, 0, -2.6],
    [0.3, 0, 0, -2.75],
    [0.95, 0, 0, -2.8],
  ];
  keyPath(c, P);
  const path = pathFn(P, 0.95);
  const impact = { rp: [0, -1.12, -0.25], rr: [-30, 4, 0], wr: [-18, 2, 0], nr: [34, -6, 0], R: [0.62, -3.95, -6, 0, 0], L: [-0.72, -1.2, 26, -40, 0] };
  key(c, 0, CHARGE, CHARGE_W);
  key(c, 0.03, lerpSpec(CHARGE, impact, 0.15), { arc: ARCH, theta: -20 }, { offset: path(0.03) });
  strike(c, 0.03, 0.12, lerpSpec(CHARGE, impact, 0.15), impact, { arc: ARCH, theta: -20 }, { arc: ARCH, theta: 140 }, { path, n: 5, ease: (x) => x * 0.7 + x * x * 0.3 });
  key(c, 0.45, { ...impact, rp: [0, -1.08, -0.25] }, { arc: ARCH, theta: 139 }, { offset: path(0.45) });
  key(c, 0.95, { ...STANCE, R: [0.5, -3.4, -8, 0, 0], L: [-0.62, -2.25, 28, -12, 0] }, STANCE_W, {
    offset: path(0.95),
    lag: { LeftShoulder: 0.04, Neck: 0.06 },
  });
  c.marker(0, 'SwingStart', { slash: 'Overhead' });
  c.marker(0.04, 'HitStart', { guardBreak: true });
  c.marker(0.12, 'HitEnd');
  c.marker(0.12, 'HeavyImpact');
  c.marker(0.3, 'SwingEnd');
  c.marker(0.7, 'Recover');
});

// ------------------------------------------------------------------ Aerial slam
const ARCA = new Arc({ c: [0.05, 0.05, -0.65], r: 0.8, roll: -4, bladeLead: 2 });
export const AerialSlam = clip('AerialSlam', { length: 0.5, loop: true, ...ARMED }, (c) => {
  // Diving: blade cocked overhead, legs tucked under, body pitched into the fall.
  const dive = (k) =>
    wield(
      pose({
        // (arms come from the jodan grip below)
        Root: { p: [0, 0.2, 0], r: [-24 - k * 2, 0, 0] },
        Waist: { r: [6, 0, 0] },
        Neck: { r: [10, 0, 0] },
        LeftHip: { r: [70, 0, -8] },
        LeftKnee: { r: [-120, 0, 0] },
        LeftAnkle: { r: [-20, 0, 0] },
        RightHip: { r: [40 + k * 4, 0, 8] },
        RightKnee: { r: [-100, 0, 0] },
        RightAnkle: { r: [-20, 0, 0] },
      }),
      { ...CHARGE_W, grip: [0.1, 0.86 + k * 0.03, -0.22] },
    );
  c.key(0, dive(0));
  c.key(0.25, dive(1));
});

export const AerialSlamLand = clip('AerialSlamLand', { length: 0.85, ...ARMED, attack: 'Aerial' }, (c) => {
  const pre = { rp: [0, 0.05, 0], rr: [-20, 0, 0], wr: [4, 0, 0], nr: [12, 0, 0], R: [0.5, -0.6, -6, 0, 0.6], L: [-0.6, 0.3, 20, 0, 0.8] };
  const impact = { rp: [0, -1.25, -0.1], rr: [-34, 0, 0], wr: [-18, 0, 0], nr: [38, 0, 0], R: [0.66, -1.0, -10, 0, 0], L: [-0.62, 0.8, 22, -50, 0.1] };
  key(c, 0, pre, CHARGE_W);
  strike(c, 0, 0.07, pre, impact, { arc: ARCA, theta: -15 }, { arc: ARCA, theta: 140 }, { n: 4, ease: (x) => x });
  key(c, 0.4, { ...impact, rp: [0, -1.2, -0.1] }, { arc: ARCA, theta: 139 });
  key(c, 0.85, STANCE, STANCE_W, { lag: { LeftShoulder: 0.04, Neck: 0.05 } });
  c.marker(0, 'SwingStart', { slash: 'Overhead' });
  c.marker(0.0, 'HitStart', { slam: true });
  c.marker(0.07, 'SlamImpact');
  c.marker(0.1, 'HitEnd');
  c.marker(0.3, 'SwingEnd');
  c.marker(0.6, 'Recover');
});

// ------------------------------------------------------------------ Lunge (dash thrust)
export const Lunge = clip('Lunge', { length: 0.7, ...ARMED, attack: 'Lunge' }, (c) => {
  const P = [
    [0, 0, 0, 0],
    [0.05, 0, 0, 0.1],
    [0.16, 0, 0, -6.5],
    [0.3, 0, 0, -8.6],
    [0.7, 0, 0, -9.0],
  ];
  keyPath(c, P);
  const path = pathFn(P, 0.7);
  const coil = { rp: [0.1, -0.62, 0.15], rr: [-18, 24, 0], wr: [-10, 22, 0], nr: [22, -40, 0], R: [0.5, -0.4, -6, 0, 0], L: [-0.64, 0.75, 30, -16, 0] };
  const coilW = { grip: [0.95, -0.42, 0.05], blade: [-0.1, 0.06, -1], edge: [0, -1, 0] };
  const thrust = { rp: [0, -1.02, -0.3], rr: [-24, 38, 0], wr: [-12, 28, 0], nr: [28, -60, 0], R: [0.42, -8.2, -2, 0, 0], L: [-0.85, -4.2, 40, -60, 0] };
  const thrustW = { grip: [0.2, 0.05, -1.75], blade: [-0.04, 0.02, -1], edge: [0.05, -1, 0] };
  const leftBack = { LeftShoulder: { r: [-20, 0, -80] }, LeftElbow: { r: [10, 0, 0] }, LeftWrist: { r: [0, 0, 0] } };
  key(c, 0, STANCE, STANCE_W);
  key(c, 0.05, coil, coilW, { two: false, left: { LeftShoulder: { r: [50, 0, -10] }, LeftElbow: { r: [60, 0, 0] }, LeftWrist: { r: [0, 0, 0] } }, offset: path(0.05) });
  strike(c, 0.05, 0.13, coil, thrust, coilW, thrustW, {
    n: 4,
    two: false,
    path,
    leftA: { LeftShoulder: { r: [50, 0, -10] }, LeftElbow: { r: [60, 0, 0] }, LeftWrist: { r: [0, 0, 0] } },
    leftB: leftBack,
    ease: outQuart,
  });
  key(c, 0.32, { ...thrust, rp: [0, -1.05, -0.32] }, { ...thrustW, grip: [0.2, 0.03, -1.72] }, { two: false, left: leftBack, offset: path(0.32) });
  key(c, 0.7, { ...STANCE, R: [0.5, -9.6, -8, 0, 0], L: [-0.62, -8.45, 28, -12, 0] }, STANCE_W, { offset: path(0.7), lag: { LeftShoulder: 0.05, Neck: 0.05 } });
  c.marker(0.04, 'SwingStart', { slash: 'Thrust' });
  c.marker(0.06, 'HitStart');
  c.marker(0.22, 'HitEnd');
  c.marker(0.3, 'SwingEnd');
  c.marker(0.5, 'Recover');
});

// ------------------------------------------------------------------ Block / parry
const GUARD = { rp: [0.0, -0.5, 0.08], rr: [-4, 18, 0], wr: [-4, 14, 0], nr: [10, -28, 0], R: [0.5, -0.5, -8, 0, 0], L: [-0.66, 0.6, 30, -14, 0] };
const GUARD_W = { grip: [-0.12, 0.02, -1.0], blade: [0.62, 0.74, -0.18], edge: [0, 0.25, -1] };
export const Block = clip('Block', { length: 1.6, loop: true, ...ARMED }, (c) => {
  key(c, 0, GUARD, GUARD_W);
  key(c, 0.8, { ...GUARD, rp: [0, -0.53, 0.08] }, { ...GUARD_W, grip: [-0.12, 0.0, -0.99] }, { lag: { Neck: 0.1 } });
});

export const BlockHit = clip('BlockHit', { length: 0.34, ...ARMED }, (c) => {
  const pushed = { ...GUARD, rp: [0.02, -0.6, 0.32], rr: [6, 22, 0], wr: [6, 16, 0], nr: [0, -30, 0] };
  key(c, 0, GUARD, GUARD_W);
  key(c, 0.05, pushed, { ...GUARD_W, grip: [-0.12, 0.05, -0.88] }, { ease: 'outQuad' });
  key(c, 0.34, GUARD, GUARD_W);
  c.marker(0, 'BlockImpact');
});

const ARC_PARRY = new Arc({ c: [0.05, 0.25, -0.95], r: 0.42, yaw: -90, bladeLead: 0 });
export const Parry = clip('Parry', { length: 0.48, ...ARMED }, (c) => {
  const set = { ...GUARD, rr: [-4, 22, 0], wr: [-4, 18, 0], nr: [10, -32, 0] };
  const snap = { ...GUARD, rp: [0.08, -0.48, 0.0], rr: [-6, -20, 0], wr: [-8, -24, 0], nr: [12, 34, 0] };
  key(c, 0, GUARD, GUARD_W);
  key(c, 0.03, set, { arc: ARC_PARRY, theta: -25 }, { ease: 'inQuad' });
  strike(c, 0.03, 0.08, set, snap, { arc: ARC_PARRY, theta: -25 }, { arc: ARC_PARRY, theta: 105 }, { n: 4, ease: outQuart });
  key(c, 0.22, { ...snap, rr: [-6, -23, 0] }, { arc: ARC_PARRY, theta: 112 });
  key(c, 0.48, STANCE, STANCE_W, { lag: { LeftShoulder: 0.04, Neck: 0.04 } });
  c.marker(0.02, 'SwingStart', { slash: 'Parry' });
  c.marker(0.05, 'Parry');
  c.marker(0.2, 'SwingEnd');
});

// Victim of a parry / guard break: arms flung up, staggering back.
function staggerClip(name, severity) {
  return clip(name, { length: 0.9 + severity * 0.2, ...ARMED }, (c) => {
    const P = [
      [0, 0, 0, 0],
      [0.18, 0, 0, 1.2 + severity],
      [0.9, 0, 0, 1.5 + severity],
    ];
    keyPath(c, P);
    const path = pathFn(P, 0.9 + severity * 0.2);
    const flung = { rp: [0, -0.3, 0.2], rr: [16 + severity * 8, -10, 0], wr: [14 + severity * 6, -6, 0], nr: [-18, 10, 0], R: [0.5, -0.2, -8, -10, 0.3], L: [-0.62, 1.5 + severity, 28, -12, 0] };
    const flungW = { grip: [0.9, 1.2, -0.3], blade: [0.3, 0.9, 0.3], edge: [0, 0, -1] };
    const left = { LeftShoulder: { r: [100, 0, -70] }, LeftElbow: { r: [20, 0, 0] }, LeftWrist: { r: [0, 0, 0] } };
    key(c, 0, STANCE, STANCE_W);
    key(c, 0.08, flung, flungW, { two: false, left, ease: 'outQuart', offset: path(0.08) });
    const recover = { ...flung, rp: [0, -0.62, 0.1], rr: [4, -6, 0], wr: [4, -4, 0], nr: [0, 4, 0], R: [0.5, 1.0 + severity, -8, 0, 0], L: [-0.62, 2.0 + severity, 28, -12, 0] };
    key(c, 0.5, recover, { grip: [0.6, -0.2, -0.8], blade: [0.2, 0.3, -1], edge: [0, -1, 0] }, { two: false, left: { LeftShoulder: { r: [20, 0, -30] }, LeftElbow: { r: [30, 0, 0] }, LeftWrist: { r: [0, 0, 0] } }, offset: path(0.5) });
    key(c, 0.9 + severity * 0.2, { ...STANCE, R: [0.5, 0.9 + severity, -8, 0, 0], L: [-0.62, 2.05 + severity, 28, -12, 0] }, STANCE_W, { offset: path(0.9 + severity * 0.2) });
    c.marker(0, 'Stagger', { severity });
  });
}
export const Parried = staggerClip('Parried', 0);
export const GuardBreak = staggerClip('GuardBreak', 0.6);

// ------------------------------------------------------------------ Draw (iai) / Sheath
function sheathGrip(p) {
  // Right hand on the sheathed handle (grip frame == sheathed weapon frame).
  const f = sheathFrame(p);
  const handRot = quatMul(f.q, eulerQuat([90, 0, 0]));
  return reach(p, 'Right', f.p, { rot: handRot, wRot: 1.2 });
}

const ARC_DRAW = new Arc({ c: [0.05, -0.32, -0.25], r: 1.2, roll: 90, pitch: -4, bladeLead: 10 });
export const Draw = clip('Draw', { length: 0.62, weapon: 'sheath' }, (c) => {
  const idle = (() => {
    let p = pose({
      Root: { p: [0.02, -0.12, 0], r: [-2, 8, 0] },
      Waist: { r: [-2, -6, 1] },
      Neck: { r: [0, -2, 0] },
      RightShoulder: { r: [4, -4, 6] },
      RightElbow: { r: [14, 0, 0] },
      RightWrist: { r: [6, 0, -4] },
    });
    p = feet(p, { Left: [-0.62, -0.22, 10, 0, 0], Right: [0.62, 0.24, -16, 0, 0] });
    return holdScabbard(p, { along: 0.78, roll: -20 });
  })();
  c.key(0, idle);
  // Reach across and grip the handle; left thumb pushes the guard out (koiguchi wo kiru).
  const gripSpec = { rp: [0.0, -0.32, 0.05], rr: [-8, 26, 0], wr: [-10, 22, 0], nr: [10, -32, 0], R: [0.55, -0.45, -8, 0, 0], L: [-0.62, 0.3, 24, -8, 0] };
  let gripPose = body(gripSpec);
  gripPose = holdScabbard(gripPose, { along: 0.62, roll: -20 });
  gripPose = sheathGrip(gripPose);
  c.key(0.15, gripPose, { ease: 'inOutSine' });
  // Clear the scabbard: blade still trailing back-left along the saya, hand pulled forward.
  const clearSpec = { ...gripSpec, rp: [0.02, -0.4, 0.0], rr: [-8, 20, 0], wr: [-8, 14, 0], nr: [10, -24, 0] };
  const leftPull = { LeftShoulder: { r: [-30, 0, -26] }, LeftElbow: { r: [40, 0, 0] }, LeftWrist: { r: [0, 0, 0] } };
  key(c, 0.19, clearSpec, { arc: ARC_DRAW, theta: -55 }, { two: false, left: leftPull });
  // Nukitsuke: horizontal flash from the left hip through the front to the right.
  const flash = { rp: [0.06, -0.5, -0.08], rr: [-8, -24, 0], wr: [-6, -26, 0], nr: [10, 36, 0], R: [0.6, -0.8, -14, 0, 0], L: [-0.62, 0.42, 26, -14, 0] };
  const leftOpen = { LeftShoulder: { r: [-20, 0, -60] }, LeftElbow: { r: [20, 0, 0] }, LeftWrist: { r: [0, 0, 0] } };
  strike(c, 0.19, 0.27, clearSpec, flash, { arc: ARC_DRAW, theta: -55 }, { arc: ARC_DRAW, theta: 168 }, {
    two: false,
    leftA: leftPull,
    leftB: leftOpen,
    ease: outCubic,
  });
  key(c, 0.36, { ...flash, rr: [-9, -28, 0] }, { arc: ARC_DRAW, theta: 176 }, { two: false, left: leftOpen });
  key(c, 0.62, STANCE, STANCE_W, { lag: { LeftShoulder: 0.05, Neck: 0.05 } });
  c.marker(0.15, 'WeaponAttach', { to: 'hand' });
  c.marker(0.18, 'SwingStart', { slash: 'Draw' });
  c.marker(0.2, 'HitStart');
  c.marker(0.27, 'HitEnd');
  c.marker(0.34, 'SwingEnd');
});

export const Sheath = clip('Sheath', { length: 0.95, weapon: 'hand' }, (c) => {
  key(c, 0, STANCE, STANCE_W);
  // Chiburi: sharp flick down to the right.
  const flick = { rp: [0.05, -0.42, 0], rr: [-6, -6, 0], wr: [-6, -10, 0], nr: [10, 6, 0], R: [0.55, -0.6, -8, 0, 0], L: [-0.62, 0.5, 28, -12, 0] };
  key(c, 0.18, flick, { grip: [1.35, -0.55, -0.7], blade: [0.6, -0.35, -0.7], edge: [0.2, -1, 0] }, {
    two: false,
    left: { LeftShoulder: { r: [10, 0, -20] }, LeftElbow: { r: [40, 0, 0] }, LeftWrist: { r: [0, 0, 0] } },
    ease: 'outQuart',
  });
  // Bring the blade across to the scabbard mouth.
  let insert = pose({
    Root: { p: [0.0, -0.25, 0.05], r: [-6, 20, 0] },
    Waist: { r: [-8, 18, 0] },
    Neck: { r: [14, -26, 0] },
  });
  insert = feet(insert, { Left: [-0.62, 0.3, 24, -8, 0], Right: [0.55, -0.45, -8, 0, 0] });
  insert = holdScabbard(insert, { along: 0.62, roll: -20 });
  insert = sheathGrip(insert);
  c.key(0.62, insert, { ease: 'inOutSine' });
  let rest = pose({
    Root: { p: [0.02, -0.12, 0], r: [-2, 8, 0] },
    Waist: { r: [-2, -6, 1] },
    Neck: { r: [0, -2, 0] },
    RightShoulder: { r: [4, -4, 6] },
    RightElbow: { r: [14, 0, 0] },
    RightWrist: { r: [6, 0, -4] },
  });
  rest = feet(rest, { Left: [-0.62, -0.22, 10, 0, 0], Right: [0.62, 0.24, -16, 0, 0] });
  rest = holdScabbard(rest, { along: 0.78, roll: -20 });
  c.key(0.95, rest, { lag: { RightShoulder: 0.05 } });
  c.marker(0.62, 'WeaponAttach', { to: 'sheath' });
  c.marker(0.62, 'SheathClick');
});

// ------------------------------------------------------------------ Hit reactions (additive)
function flinch(name, dir) {
  return clip(name, { length: 0.42, additive: true }, (c) => {
    const zero = pose({ Root: {}, Waist: {}, Neck: {}, RightShoulder: {}, LeftShoulder: {}, RightElbow: {}, LeftElbow: {} });
    const D = {
      Front: { Root: { p: [0, -0.08, 0.18], r: [10, 0, 0] }, Waist: { r: [16, 0, 0] }, Neck: { r: [-24, 0, 0] }, RightShoulder: { r: [-14, 0, 14] }, LeftShoulder: { r: [-14, 0, -14] }, RightElbow: { r: [16, 0, 0] }, LeftElbow: { r: [16, 0, 0] } },
      Back: { Root: { p: [0, -0.08, -0.18], r: [-10, 0, 0] }, Waist: { r: [-18, 0, 0] }, Neck: { r: [20, 0, 0] }, RightShoulder: { r: [16, 0, 10] }, LeftShoulder: { r: [16, 0, -10] }, RightElbow: { r: [10, 0, 0] }, LeftElbow: { r: [10, 0, 0] } },
      Left: { Root: { p: [0.18, -0.06, 0], r: [0, -8, -10] }, Waist: { r: [0, -10, -14] }, Neck: { r: [0, -16, -18] }, RightShoulder: { r: [0, 0, 18] }, LeftShoulder: { r: [10, 0, -6] }, RightElbow: { r: [10, 0, 0] }, LeftElbow: { r: [20, 0, 0] } },
      Right: { Root: { p: [-0.18, -0.06, 0], r: [0, 8, 10] }, Waist: { r: [0, 10, 14] }, Neck: { r: [0, 16, 18] }, RightShoulder: { r: [10, 0, 6] }, LeftShoulder: { r: [0, 0, -18] }, RightElbow: { r: [20, 0, 0] }, LeftElbow: { r: [10, 0, 0] } },
    }[dir];
    c.key(0, zero);
    c.key(0.05, pose(D), { ease: 'outQuad' });
    c.key(0.14, pose(D).scale(0.7));
    c.key(0.42, zero);
  });
}
export const HitFront = flinch('HitFront', 'Front');
export const HitBack = flinch('HitBack', 'Back');
export const HitLeft = flinch('HitLeft', 'Left');
export const HitRight = flinch('HitRight', 'Right');

// Launched by a finisher: airborne, folded around the impact.
export const Knockback = clip('Knockback', { length: 0.6, loop: true }, (c) => {
  const blown = (k) =>
    pose({
      Root: { p: [0, 0.1, 0], r: [32 + k * 4, 0, 0] },
      Waist: { r: [-24, 0, 0] },
      Neck: { r: [-30, 0, 0] },
      LeftHip: { r: [70 + k * 6, 0, -10] },
      LeftKnee: { r: [-60, 0, 0] },
      RightHip: { r: [50 - k * 6, 0, 10] },
      RightKnee: { r: [-30, 0, 0] },
      LeftShoulder: { r: [80, 0, -40 - k * 6] },
      LeftElbow: { r: [20, 0, 0] },
      RightShoulder: { r: [70, 0, 44 + k * 6] },
      RightElbow: { r: [24, 0, 0] },
    });
  c.key(0, blown(0));
  c.key(0.3, blown(1));
});

export const KnockdownLand = clip('KnockdownLand', { length: 0.5 }, (c) => {
  // Hit the ground on the back, bounce, settle lying down.
  const lying = (h) =>
    pose({
      Root: pivotX(80, [0, 0.4, 0], [0, -1.95 + h, 0]),
      Waist: { r: [-6, 0, 0] },
      Neck: { r: [-10 - h * 20, 0, 0] },
      LeftHip: { r: [30, 0, -14] },
      LeftKnee: { r: [-40, 0, 0] },
      RightHip: { r: [10, 0, 14] },
      RightKnee: { r: [-14, 0, 0] },
      LeftShoulder: { r: [20, 0, -70] },
      LeftElbow: { r: [20, 0, 0] },
      RightShoulder: { r: [10, 0, 76] },
      RightElbow: { r: [16, 0, 0] },
    });
  c.key(0, lying(0));
  c.key(0.12, lying(0.3), { ease: 'outQuad' });
  c.key(0.24, lying(0));
  c.key(0.34, lying(0.06));
  c.key(0.5, lying(0));
  c.marker(0, 'BodyImpact');
});

export const GetUp = clip('GetUp', { length: 0.95 }, (c) => {
  // Kip-up: knees to chest, whip the legs and spring up.
  const lying = pose({
    Root: pivotX(80, [0, 0.4, 0], [0, -1.95, 0]),
    Waist: { r: [-6, 0, 0] },
    Neck: { r: [-10, 0, 0] },
    LeftHip: { r: [30, 0, -14] },
    LeftKnee: { r: [-40, 0, 0] },
    RightHip: { r: [10, 0, 14] },
    RightKnee: { r: [-14, 0, 0] },
    LeftShoulder: { r: [20, 0, -70] },
    LeftElbow: { r: [20, 0, 0] },
    RightShoulder: { r: [10, 0, 76] },
    RightElbow: { r: [16, 0, 0] },
  });
  const coil = pose({
    Root: pivotX(100, [0, 0.4, 0], [0, -2.0, 0]),
    Waist: { r: [-20, 0, 0] },
    Neck: { r: [-30, 0, 0] },
    LeftHip: { r: [130, 0, -6] },
    LeftKnee: { r: [-120, 0, 0] },
    RightHip: { r: [130, 0, 6] },
    RightKnee: { r: [-120, 0, 0] },
    LeftShoulder: { r: [170, 0, -20] },
    LeftElbow: { r: [100, 0, 0] },
    RightShoulder: { r: [170, 0, 20] },
    RightElbow: { r: [100, 0, 0] },
  });
  const whip = pose({
    Root: pivotX(30, [0, 0.4, 0], [0, -1.2, 0]),
    Waist: { r: [16, 0, 0] },
    Neck: { r: [10, 0, 0] },
    LeftHip: { r: [40, 0, -6] },
    LeftKnee: { r: [-90, 0, 0] },
    RightHip: { r: [50, 0, 6] },
    RightKnee: { r: [-100, 0, 0] },
    LeftShoulder: { r: [40, 0, -50] },
    LeftElbow: { r: [30, 0, 0] },
    RightShoulder: { r: [40, 0, 50] },
    RightElbow: { r: [30, 0, 0] },
  });
  let crouch = pose({
    Root: { p: [0, -0.9, 0], r: [-18, 0, 0] },
    Waist: { r: [-8, 0, 0] },
    Neck: { r: [20, 0, 0] },
    LeftShoulder: { r: [20, 0, -40] },
    LeftElbow: { r: [40, 0, 0] },
    RightShoulder: { r: [20, 0, 40] },
    RightElbow: { r: [40, 0, 0] },
  });
  crouch = plantFoot(crouch, 'Left', [-0.6, G, -0.2]);
  crouch = plantFoot(crouch, 'Right', [0.6, G, 0.2], { pitch: -10 });
  let stand = pose({
    Root: { p: [0, -0.15, 0], r: [-4, 0, 0] },
    Waist: { r: [-2, 0, 0] },
    Neck: { r: [4, 0, 0] },
    LeftShoulder: { r: [4, 0, -10] },
    LeftElbow: { r: [20, 0, 0] },
    RightShoulder: { r: [4, 0, 10] },
    RightElbow: { r: [20, 0, 0] },
  });
  stand = plantFoot(stand, 'Left', [-0.55, G, -0.1]);
  stand = plantFoot(stand, 'Right', [0.55, G, 0.15]);
  c.key(0, lying);
  c.key(0.22, coil, { ease: 'inOutSine' });
  c.key(0.36, whip, { ease: 'outCubic' });
  c.key(0.55, crouch);
  c.key(0.95, stand);
  c.marker(0.36, 'KipUp');
});

export default [
  CombatIdle,
  ArmedWalk,
  ArmedRun,
  Light1,
  Light2,
  Light3,
  Light4,
  HeavyCharge,
  HeavyRelease,
  AerialSlam,
  AerialSlamLand,
  Lunge,
  Block,
  BlockHit,
  Parry,
  Parried,
  GuardBreak,
  Draw,
  Sheath,
  HitFront,
  HitBack,
  HitLeft,
  HitRight,
  Knockback,
  KnockdownLand,
  GetUp,
];
