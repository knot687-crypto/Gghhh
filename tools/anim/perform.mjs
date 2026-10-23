// Performance sampler: author an action as timed beats, sample it densely and solve IK at every
// sample.
//
//   perform(c, {
//     path: [[t, x, y, z], ...],                                   root motion (start-relative)
//     beats: [{ t, body: { rp, rr, wr, nr }, w, left, two, in, lead, vel, extra }, ...],
//     feet: { L: [[t, [x, z, yaw, pitch, lift], opts?], ...], R: [...] },
//   });
//
// * Body parts (rp/rr = Root position/rotation, wr = Waist, nr = Neck, plus any joint named in
//   `extra`) interpolate between the beats that set them. `in` is the ease of the segment that
//   arrives at a beat: 'auto' (default) is a smooth auto-tangent curve through the beats,
//   anything else is an easing name or function. `lead: { part: seconds }` makes that part hit
//   the beat earlier (negative: later), which is how the hips lead a strike, the eyes lead the
//   hips and the blade whips through last. `vel: { part: [...] }` pins a part's velocity at the
//   beat (units per second).
// * The blade `w` is a position on an arc { arc, theta, spin, lead } (consecutive beats on the
//   same arc interpolate the angles, so the grip stays on the circle) or a frame
//   { grip, blade, edge } (orientation slerped). Its `lead` angles the blade ahead of (or,
//   negative, behind) the radius: trailing at the start of a swing and snapping ahead into
//   contact gives the whip of the wrists. Part name for timing: 'w'.
// * Hands: the right hand wields the blade unless a beat gives `right` (free right-arm
//   rotations). The left hand is on the handle (two-handed) unless a beat gives `left` (free
//   left-arm rotations) or `scabbard: { along, roll }` (holding the scabbard). Changing hold
//   between beats blends across the segment instead of popping. Part name for timing: 'hands'.
// * `w` may also be a function of the solved pose returning a frame (e.g. the sheathed handle,
//   which moves with the hips).
// * Feet stay planted between their timeline entries. Moving a foot more than 0.12 studs is a
//   step (heel-off, toe-off, swing arc, heel strike, foot flat); `{ drag: true }` slides it
//   low instead (suri-ashi), `{ air: true }` just interpolates (jumps). Same position:
//   roll/pivot in place. A `null` entry frees the leg (no foot IK; hip/knee/ankle come from
//   the beats' `extra` joints), blending out of and back into the plants.
//
// Every sample is solved warm-started from the previous one, so IK solutions are continuous in
// time. Keying every sample means the blade follows its arc and planted feet stay planted at
// every frame; the clip builder's `reduce` option then strips the redundant keys.
import { pose } from './core/dsl.mjs';
import { EASE_FN, easeCode } from './core/easing.mjs';
import { fk, holdScabbard, pointOf, weaponRot } from './core/kinematics.mjs';
import { quatRotate, slerp } from './core/xform.mjs';
import { feet as plantFeet, G, keyPath, pathFn, wield } from './combat-kit.mjs';

const D2R = Math.PI / 180;
const smooth = (x) => x * x * (3 - 2 * x);
const smoother = (x) => x * x * x * (x * (6 * x - 15) + 10);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const bump = (u, a, b) => (u <= a || u >= b ? 0 : Math.sin((Math.PI * (u - a)) / (b - a)));
const lerpArr = (a, b, k) => a.map((x, i) => x + (b[i] - x) * k);

function easeOf(e) {
  if (e === undefined || e === null || e === 'auto') return null;
  if (typeof e === 'function') return e;
  return EASE_FN[easeCode(e)];
}

// Slope of an easing function at x (0 or 1), for C1 joins between eased and auto segments.
function easeSlope(fn, x) {
  const h = 1e-4;
  return x <= 0 ? (fn(h) - fn(0)) / h : (fn(1) - fn(1 - h)) / h;
}

function autoTangent(t0, v0, t1, v1, t2, v2) {
  const d0 = (v1 - v0) / (t1 - t0);
  const d1 = (v2 - v1) / (t2 - t1);
  if (d0 * d1 <= 0) return 0;
  let m = (v2 - v0) / (t2 - t0);
  const lim = 3 * Math.min(Math.abs(d0), Math.abs(d1));
  if (Math.abs(m) > lim) m = Math.sign(m) * lim;
  return m;
}

/** Piecewise curve through keys [{ t, v: number[], ease, vel? }] (ease = arriving segment). */
export class Curve {
  constructor(keys) {
    const k = [...keys].sort((a, b) => a.t - b.t);
    // Merge keys that landed on the same time (later beats win).
    this.k = [];
    for (const key of k) {
      const last = this.k[this.k.length - 1];
      if (last && Math.abs(last.t - key.t) < 1e-6) this.k[this.k.length - 1] = key;
      else this.k.push(key);
    }
    const n = this.k.length;
    this.fn = this.k.map((key) => easeOf(key.ease));
    this.m = this.k.map((key, i) => {
      const dim = key.v.length;
      if (key.vel) return key.vel;
      const inFn = i > 0 ? this.fn[i] : null;
      const outFn = i < n - 1 ? this.fn[i + 1] : null;
      return Array.from({ length: dim }, (_, d) => {
        if (i === 0 || i === n - 1) {
          // Ends: inherit the eased neighbour's slope, else rest.
          if (i === 0 && n > 1 && outFn) return 0;
          return 0;
        }
        const a = this.k[i - 1];
        const b = this.k[i + 1];
        if (!inFn && !outFn) return autoTangent(a.t, a.v[d], key.t, key.v[d], b.t, b.v[d]);
        if (inFn && !outFn) {
          const m = (easeSlope(inFn, 1) * (key.v[d] - a.v[d])) / (key.t - a.t);
          const lim = (3 * Math.abs(b.v[d] - key.v[d])) / (b.t - key.t);
          return Math.sign(m) * Math.min(Math.abs(m), lim);
        }
        if (!inFn && outFn) {
          const m = (easeSlope(outFn, 0) * (b.v[d] - key.v[d])) / (b.t - key.t);
          const lim = (3 * Math.abs(key.v[d] - a.v[d])) / (key.t - a.t);
          return Math.sign(m) * Math.min(Math.abs(m), lim);
        }
        return 0;
      });
    });
  }

  get empty() {
    return this.k.length === 0;
  }

  // Returns [value, segmentIndex, u].
  locate(t) {
    const k = this.k;
    const n = k.length;
    if (t <= k[0].t) return [-1, 0];
    if (t >= k[n - 1].t) return [n - 1, 0];
    let i = 0;
    while (i < n - 2 && k[i + 1].t <= t) i++;
    return [i, (t - k[i].t) / (k[i + 1].t - k[i].t)];
  }

  at(t) {
    const k = this.k;
    const [i, u] = this.locate(t);
    if (i < 0) return [...k[0].v];
    if (i >= k.length - 1) return [...k[k.length - 1].v];
    const a = k[i];
    const b = k[i + 1];
    const fn = this.fn[i + 1];
    if (fn) {
      const e = fn(u);
      return a.v.map((x, d) => x + (b.v[d] - x) * e);
    }
    const h = b.t - a.t;
    const u2 = u * u;
    const u3 = u2 * u;
    return a.v.map(
      (x, d) => (2 * u3 - 3 * u2 + 1) * x + (u3 - 2 * u2 + u) * h * this.m[i][d] + (-2 * u3 + 3 * u2) * b.v[d] + (u3 - u2) * h * this.m[i + 1][d],
    );
  }
}

// ------------------------------------------------------------------ blade
const frameOf = (w, p) => (typeof w === 'function' ? w(p) : w.arc ? w.arc.frame(w.theta, w.spin ?? 0, w.lead) : w);

function frameQuat(f) {
  return weaponRot(f.blade, f.edge);
}

function blendFrames(fa, fb, k) {
  const q = slerp(frameQuat(fa), frameQuat(fb), k);
  return { grip: lerpArr(fa.grip, fb.grip, k), blade: quatRotate(q, [0, 1, 0]), edge: quatRotate(q, [0, 0, -1]) };
}

/** Blade track: runs of same-arc beats interpolate arc angles; everything else slerps frames. */
class BladeTrack {
  constructor(keys) {
    this.k = [...keys].sort((a, b) => a.t - b.t);
    // Group consecutive keys on the same arc into angle curves.
    this.runs = [];
    let run = null;
    for (const key of this.k) {
      if (key.w.arc && run && run.arc === key.w.arc && !key.w.cut) run.keys.push(key);
      else {
        run = key.w.arc ? { arc: key.w.arc, keys: [key] } : null;
        if (run) this.runs.push(run);
      }
      key.run = run;
    }
    for (const r of this.runs) {
      r.curve = new Curve(r.keys.map((key) => ({ t: key.t, v: [key.w.theta, key.w.spin ?? 0, key.w.lead ?? r.arc.bladeLead], ease: key.ease, vel: key.vel })));
    }
  }

  at(t, p) {
    const k = this.k;
    const n = k.length;
    const onRun = (key) => {
      const [theta, spin, lead] = key.run.curve.at(t);
      return key.run.arc.frame(theta, spin, lead);
    };
    if (t <= k[0].t) return frameOf(k[0].w, p);
    if (t >= k[n - 1].t) return frameOf(k[n - 1].w, p);
    let i = 0;
    while (i < n - 2 && k[i + 1].t <= t) i++;
    const a = k[i];
    const b = k[i + 1];
    if (a.run && a.run === b.run) return onRun(a);
    const u = (t - a.t) / (b.t - a.t);
    const fn = easeOf(b.ease) ?? smooth;
    return blendFrames(frameOf(a.w, p), frameOf(b.w, p), fn(u));
  }
}

// ------------------------------------------------------------------ feet
/**
 * Foot timeline: [[t, [x, z, yaw, pitch, lift], opts?], ...]. Between entries whose positions
 * differ the foot steps; otherwise it rolls/pivots in place.
 */
export function footAt(timeline, t) {
  const n = timeline.length;
  if (t <= timeline[0][0]) return [...timeline[0][1]];
  if (t >= timeline[n - 1][0]) return [...timeline[n - 1][1]];
  let i = 0;
  while (i < n - 2 && timeline[i + 1][0] <= t) i++;
  const [t0, a] = timeline[i];
  const [t1, b, opts = {}] = timeline[i + 1];
  const u = (t - t0) / (t1 - t0);
  const A = [a[0], a[1], a[2] ?? 0, a[3] ?? 0, a[4] ?? 0];
  const B = [b[0], b[1], b[2] ?? 0, b[3] ?? 0, b[4] ?? 0];
  const d = Math.hypot(B[0] - A[0], B[1] - A[1]);
  if (d < 0.12) {
    // Roll / pivot in place: a big yaw change pivots on the ball of the foot (heel lifts).
    const k = smooth(u);
    const out = lerpArr(A, B, k);
    const turn = Math.abs(B[2] - A[2]);
    if (turn > 10) out[3] -= Math.min(16, turn * 0.25) * Math.sin(Math.PI * u);
    return out;
  }
  if (opts.air) {
    // Airborne: positions/attitude simply interpolate (jumps, spins).
    return lerpArr(A, B, opts.linear ? u : smooth(u));
  }
  if (opts.drag) {
    // Suri-ashi: the foot slides up low and flat, the heel just off the floor.
    const k = smoother(u);
    const out = lerpArr(A, B, k);
    out[4] += (opts.h ?? 0.035) * Math.sin(Math.PI * u);
    out[3] -= 6 * Math.sin(Math.PI * u);
    return out;
  }
  // Step: heel-off (0-30%), swing on an arc, heel strike with the toe up, then flat.
  const h = opts.h ?? Math.min(0.42, 0.12 + 0.16 * d);
  const k = smoother(clamp01((u - 0.12) / 0.8));
  const out = lerpArr(A, B, k);
  out[4] += h * Math.pow(bump(u, 0.1, 0.94), 0.85);
  out[3] += -(opts.toe ?? 22) * bump(u, 0, 0.5) + (opts.heel ?? 16) * bump(u, 0.42, 1);
  return out;
}

// Foot state at t: { spec } planted/stepping, { free: true }, or { spec, free: k } blending
// between the plant `spec` and the free leg (k = 1 fully free).
function footState(tl, t) {
  const n = tl.length;
  if (t <= tl[0][0]) return tl[0][1] ? { spec: footAt(tl, t) } : { free: 1 };
  if (t >= tl[n - 1][0]) return tl[n - 1][1] ? { spec: footAt(tl, t) } : { free: 1 };
  let i = 0;
  while (i < n - 2 && tl[i + 1][0] <= t) i++;
  const a = tl[i][1];
  const b = tl[i + 1][1];
  if (a && b) return { spec: footAt(tl, t) };
  if (!a && !b) return { free: 1 };
  const u = smooth(clamp01((t - tl[i][0]) / (tl[i + 1][0] - tl[i][0])));
  return a ? { spec: [...a], free: u } : { spec: [...b], free: 1 - u };
}

// ------------------------------------------------------------------ hands
const LEFT_ARM = ['LeftShoulder', 'LeftElbow', 'LeftWrist'];
const RIGHT_ARM = ['RightShoulder', 'RightElbow', 'RightWrist'];
const ARMS = [...LEFT_ARM, ...RIGHT_ARM];
const LEGS = ['LeftHip', 'LeftKnee', 'LeftAnkle', 'RightHip', 'RightKnee', 'RightAnkle'];
const SEED = [...LEGS, ...ARMS];

const flatArm = (names, spec) => names.flatMap((j) => spec[j]?.r ?? [0, 0, 0]);
const unflatArm = (names, v) => Object.fromEntries(names.map((j, i) => [j, { r: v.slice(i * 3, i * 3 + 3) }]));

function blendJoints(pa, pb, names, k) {
  const over = {};
  for (const n of names) {
    const a = pa.j[n] ?? { r: [0, 0, 0] };
    const b = pb.j[n] ?? { r: [0, 0, 0] };
    over[n] = { r: lerpArr(a.r, b.r, k) };
  }
  return over;
}

// How a beat holds things: right = 'blade' | 'free'; left = 'two' | 'free' | 'scabbard' | 'none'.
function holdOf(b, twoDefault, hasBlade) {
  if (!(b.w || b.left || b.right || b.scabbard || b.two !== undefined)) return null;
  const right = b.right ? 'free' : hasBlade ? 'blade' : 'none';
  let left = 'none';
  if (b.left) left = 'free';
  else if (b.scabbard) left = 'scabbard';
  else if (right === 'blade' && (b.two ?? twoDefault)) left = 'two';
  return { right, left, scabbard: b.scabbard };
}

// ------------------------------------------------------------------ sampler
const BODY = { rp: ['Root', 'p'], rr: ['Root', 'r'], wr: ['Waist', 'r'], nr: ['Neck', 'r'] };

export function perform(c, { path, beats, feet = {}, rate = 120, times = [], two: twoDefault = true, weapon = true }) {
  const length = c.opts.length;
  if (path) keyPath(c, path);
  const offsetAt = path ? pathFn(path, length) : () => [0, 0, 0];
  const shift = (beat, part) => beat.t - (beat.lead?.[part] ?? 0);

  // Body and extra joint curves.
  const parts = new Set();
  for (const b of beats) {
    for (const k of Object.keys(b.body ?? {})) parts.add(k);
    for (const k of Object.keys(b.extra ?? {})) parts.add(k);
  }
  const curves = {};
  for (const part of parts) {
    const keys = [];
    for (const b of beats) {
      const v = b.body?.[part] ?? b.extra?.[part]?.r;
      if (v) keys.push({ t: shift(b, part), v, ease: b.inParts?.[part] ?? b.in, vel: b.vel?.[part] });
    }
    curves[part] = new Curve(keys);
  }

  // Blade, holds and free arms.
  const bladeKeys = beats.filter((b) => b.w).map((b) => ({ t: shift(b, 'w'), w: b.w, ease: b.inParts?.w ?? b.in, vel: b.vel?.w }));
  const blade = weapon && bladeKeys.length ? new BladeTrack(bladeKeys) : null;
  const holds = [];
  for (const b of beats) {
    const h = holdOf(b, twoDefault, !!blade);
    if (h) holds.push({ t: shift(b, 'hands'), ...h });
  }
  holds.sort((a, b) => a.t - b.t);
  const armCurve = (names, key) => {
    const keys = beats.filter((b) => b[key]).map((b) => ({ t: shift(b, 'hands'), v: flatArm(names, b[key]), ease: b.inParts?.hands ?? b.in }));
    return keys.length ? new Curve(keys) : null;
  };
  const leftCurve = armCurve(LEFT_ARM, 'left');
  const rightCurve = armCurve(RIGHT_ARM, 'right');
  const scabCurve = (() => {
    const keys = beats.filter((b) => b.scabbard).map((b) => ({ t: shift(b, 'hands'), v: [b.scabbard.along ?? 0.75, b.scabbard.roll ?? 0] }));
    return keys.length ? new Curve(keys) : null;
  })();

  // Solve the arms for one hold at time t. Warm-started solves keep the arms continuous, but can
  // get stuck in a twisted local solution when the target swings far; when the result misses
  // the katana's path, solve again from a neutral seed and keep whichever fits better.
  const bladeMiss = (p, frame, two) => {
    const w = fk(p);
    const g = w.Weapon.p;
    return Math.hypot(g[0] - frame.grip[0], g[1] - frame.grip[1], g[2] - frame.grip[2]) + (two ? 2 * (p._twoHandErr ?? 0) : 0);
  };
  const neutralArms = (p) => p.omit(ARMS);
  const wieldBest = (p, frame, two) => {
    const warm = wield(p, frame, { two });
    const missWarm = bladeMiss(warm, frame, two);
    if (missWarm < (two ? 0.03 : 0.01)) return warm;
    let seed = neutralArms(p);
    if (!two && p.j.LeftShoulder) seed = seed.with({ LeftShoulder: p.j.LeftShoulder, LeftElbow: p.j.LeftElbow, LeftWrist: p.j.LeftWrist });
    const cold = wield(seed, frame, { two });
    return bladeMiss(cold, frame, two) < missWarm - 0.005 ? cold : warm;
  };
  const solveHold = (p, hold, frame, t) => {
    if (hold.left === 'two') return wieldBest(p, frame, true);
    if (hold.right === 'blade') p = wieldBest(p, frame, false);
    else if (hold.right === 'free' && rightCurve) p = p.with(unflatArm(RIGHT_ARM, rightCurve.at(t)));
    if (hold.left === 'free' && leftCurve) p = p.with(unflatArm(LEFT_ARM, leftCurve.at(t)));
    else if (hold.left === 'scabbard' && scabCurve) {
      const [along, roll] = scabCurve.at(t);
      p = holdScabbard(p, { along, roll });
    }
    return p;
  };
  const sameHold = (a, b) => a.right === b.right && a.left === b.left;

  // Sample times: uniform grid plus every beat and foot event.
  const set = new Set();
  const add = (t) => {
    if (t >= 0 && t <= length) set.add(Math.round(t * 1e5) / 1e5);
  };
  const steps = Math.ceil(length * rate);
  for (let i = 0; i <= steps; i++) add((length * i) / steps);
  for (const b of beats) add(b.t);
  for (const tl of Object.values(feet)) for (const e of tl) add(e[0]);
  for (const t of times) add(t);
  const sampleTimes = [...set].sort((a, b) => a - b);

  let prev = null;
  let worstGrip = 0;
  let worstGripAt = 0;
  let worstFoot = 0;
  let worstFootAt = 0;
  const diag = [];
  let worstWeapon = 0;
  let worstWeaponAt = 0;
  let worstWeaponErr = 0;
  const out = [];
  for (const t of sampleTimes) {
    const j = {};
    for (const [part, [joint, ch]] of Object.entries(BODY)) {
      if (!curves[part]) continue;
      (j[joint] ??= {})[ch] = curves[part].at(t);
    }
    // Leg joints given in `extra` only drive free legs (see footState); planted legs are
    // solved warm-started from the previous sample.
    const freeLegs = {};
    for (const part of parts) {
      if (BODY[part]) continue;
      if (LEGS.includes(part)) freeLegs[part] = { r: curves[part].at(t) };
      else j[part] = { r: curves[part].at(t) };
    }
    let p = pose(j);
    if (prev) p = p.with(Object.fromEntries(SEED.filter((n) => prev.j[n] && !j[n]).map((n) => [n, { r: prev.j[n].r }])));
    const offset = offsetAt(t);
    const footSpec = {};
    const blendFree = [];
    for (const [side, key] of [['Left', 'L'], ['Right', 'R']]) {
      if (!feet[key]) continue;
      const st = footState(feet[key], t);
      if (st.spec) footSpec[side] = st.spec;
      if (st.free) blendFree.push([side, st.free]);
    }
    const legsFree = p.with(freeLegs);
    p = plantFeet(p, footSpec, offset);
    for (const [side, k] of blendFree) {
      const names = [`${side}Hip`, `${side}Knee`, `${side}Ankle`];
      p = p.with(blendJoints(p, legsFree, names, k));
      delete footSpec[side];
    }
    for (const [side, f] of Object.entries(footSpec)) {
      // Planted-foot accuracy check (sole height and position).
      const w = fk(p);
      const pitch = f[3] ?? 0;
      const want = [f[0] - offset[0], G + (f[4] ?? 0) + 0.5 * Math.sin(Math.abs(pitch) * D2R) - offset[1], f[1] - offset[2]];
      const sole = pointOf(w, `${side}Foot`, [0, -0.15, 0]);
      const err = Math.hypot(sole[0] - want[0], sole[1] - want[1], sole[2] - want[2]);
      if (err > worstFoot) {
        worstFoot = err;
        worstFootAt = t;
      }
    }

    if (holds.length) {
      const frame = blade ? blade.at(t, p) : null;
      let i = 0;
      while (i < holds.length - 1 && holds[i + 1].t <= t) i++;
      const A = holds[i];
      const B = holds[Math.min(i + 1, holds.length - 1)];
      if (t <= A.t || sameHold(A, B) || B === A) {
        p = solveHold(p, t <= A.t && i === 0 ? A : t >= B.t ? B : A, frame, t);
      } else {
        const k = smooth(clamp01((t - A.t) / (B.t - A.t)));
        const pa = solveHold(p, A, frame, t);
        const pb = solveHold(p, B, frame, t);
        p = pa.with(blendJoints(pa, pb, ARMS, k));
        p._twoHandErr = Math.max(pa._twoHandErr ?? 0, pb._twoHandErr ?? 0) * (A.left === 'two' && B.left === 'two' ? 1 : 0);
      }
      if (p._twoHandErr && p._twoHandErr > worstGrip) {
        worstGrip = p._twoHandErr;
        worstGripAt = t;
      }
      // Is the katana where the frame says (only meaningful while the right hand wields it)?
      const hold = t <= A.t ? A : t >= B.t ? B : A;
      if (frame && hold.right === 'blade' && (B.right === 'blade' || t <= A.t)) {
        const wp = fk(p).Weapon.p;
        const err = Math.hypot(wp[0] - frame.grip[0], wp[1] - frame.grip[1], wp[2] - frame.grip[2]);
        const tol = hold.left === 'two' ? 0.15 : 0.04;
        if (process.env.PERFORM_DIAG && (process.env.PERFORM_DIAG === '1' || process.env.PERFORM_DIAG === c.name)) diag.push([t, err, hold.left]);
        if (err - tol > worstWeapon) {
          worstWeapon = err - tol;
          worstWeaponAt = t;
          worstWeaponErr = err;
        }
      }
    }
    delete p._twoHandErr;
    c.key(t, p);
    out.push({ t, pose: p });
    prev = p;
  }
  if (worstGrip > 0.06) console.warn(`  ${c.name}: two-hand grip off by ${worstGrip.toFixed(3)} at ${worstGripAt.toFixed(3)}s`);
  if (worstFoot > 0.03) console.warn(`  ${c.name}: foot off its plant by ${worstFoot.toFixed(3)} at ${worstFootAt.toFixed(3)}s`);
  if (diag.length) {
    const rows = diag.filter((d, i) => i % 3 === 0 || d[1] > 0.2).map(([t, e, l]) => `${t.toFixed(3)}:${e.toFixed(2)}${l === 'two' ? '' : '*'}`);
    console.warn(`  ${c.name} weapon err: ${rows.join(' ')}`);
  }
  if (worstWeapon > 0) console.warn(`  ${c.name}: hand can't put the katana on its path (off by ${worstWeaponErr.toFixed(3)} at ${worstWeaponAt.toFixed(3)}s)`);
  return out;
}
