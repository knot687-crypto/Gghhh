// Katana combat authoring kit.
//
// Swings are generated from a parametric arc. At angle theta the grip sits on a circle of radius
// `r` around centre `c`, the blade points radially outward and the cutting edge faces the
// direction of travel (increasing theta). That gives circular swings, correct edge alignment and
// flat trail ribbons. Everything is solved with IK and baked into keys.
import { compileChannel, evalChannel } from './core/curve.mjs';
import { pose } from './core/dsl.mjs';
import { eulerQuat, fk, grip, plantFoot, pointOf, twoHandError, wieldTwoHanded } from './core/kinematics.mjs';
import { R15 } from './core/rig.mjs';
import { quatRotate } from './core/xform.mjs';

export const G = R15.ground;
const D2R = Math.PI / 180;

const rotY = (v, deg) => {
  const a = deg * D2R;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
};
const rotZ = (v, deg) => {
  const a = deg * D2R;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
};
const rotX = (v, deg) => {
  const a = deg * D2R;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
};
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/**
 * Slash arc. The base plane is vertical through the body (u = up, v = forward); `roll` rotates
 * it about the forward axis (-90 = horizontal sweeping from the right, -40 = diagonal from the
 * upper right), `pitch` tilts it about X, `yaw` turns it about Y.
 * theta = 0 points along u, 90 along forward, 180 along -u.
 */
export class Arc {
  constructor({ c, r, roll = 0, pitch = 0, yaw = 0, bladeLead = 0 }) {
    Object.assign(this, { c, r, roll, pitch, yaw, bladeLead });
  }

  frame(theta, spin = 0, lead = this.bladeLead) {
    const t = theta * D2R;
    const tf = (v) => rotY(rotY(rotX(rotZ(v, this.roll), this.pitch), this.yaw), spin);
    const u = tf([0, 1, 0]);
    const v = tf([0, 0, -1]);
    const radial = add(scale(u, Math.cos(t)), scale(v, Math.sin(t)));
    const tangent = add(scale(u, -Math.sin(t)), scale(v, Math.cos(t)));
    const centre = rotY(this.c, spin);
    const gripPos = add(centre, scale(radial, this.r));
    // The lead tilts the blade ahead of the radial direction (wrist snap); negative trails it.
    const l = lead * D2R;
    const blade = add(scale(radial, Math.cos(l)), scale(tangent, Math.sin(l)));
    const edge = add(scale(tangent, Math.cos(l)), scale(radial, -Math.sin(l)));
    return { grip: gripPos, blade, edge };
  }
}

/** Plant feet given in start-relative space, compensating for the clip's root motion offset. */
export function feet(p, spec, offset = [0, 0, 0]) {
  for (const side of ['Left', 'Right']) {
    const f = spec[side];
    if (!f) continue;
    const [x, z, yaw = 0, pitch = 0, lift = 0] = f;
    const local = sub([x, G + lift + 0.5 * Math.sin(Math.abs(pitch) * D2R), z], offset);
    p = plantFoot(p, side, local, { yaw, pitch });
  }
  return p;
}

/** Put the katana on an arc (or explicit grip/blade/edge) with one or two hands. */
export function wield(p, w, { two = true, offset = [0, 0, 0], roll = 0 } = {}) {
  const f = w.arc ? w.arc.frame(w.theta, w.spin ?? 0) : w;
  const gp = sub(f.grip, offset);
  if (!two) return grip(p, gp, f.blade, f.edge);
  const out = wieldTwoHanded(p, gp, f.blade, f.edge, { roll });
  const err = twoHandError(out);
  if (err > 0.04) out._twoHandErr = err;
  return out;
}

/** Interpolated root-motion path, identical to what the runtime will sample. */
export function pathFn(keys, length) {
  const ch = [1, 2, 3].map((i) => compileChannel(keys.map((k) => ({ t: k[0], v: k[i], e: 0 })), length, false));
  return (t) => ch.map((c) => evalChannel(c, t));
}

export function keyPath(c, keys) {
  for (const [t, x, y, z] of keys) c.key(t, pose({ RootMotion: { p: [x, y, z] } }));
}

export function bladeTipWorld(p) {
  const w = fk(p);
  return pointOf(w, 'Weapon', [0, 3.45, 0.12]);
}

export function easeSamples(n, fn) {
  return Array.from({ length: n }, (_, i) => fn((i + 1) / n));
}

export const outCubic = (x) => 1 - Math.pow(1 - x, 3);
export const outQuart = (x) => 1 - Math.pow(1 - x, 4);
export const inOutSine = (x) => -(Math.cos(Math.PI * x) - 1) / 2;
export const inCubic = (x) => x * x * x;
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerp3 = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);

export { eulerQuat, quatRotate };

// ---------------------------------------------------------------- swing path baking
// Samples the blade (base/tip points in root space, root motion included) across each
// SwingStart..SwingEnd window of a compiled clip and resamples it uniformly by tip arc length.
// Runtimes reveal these samples as the clip time passes them, producing smooth slash ribbons
// that are exact to the animation regardless of frame rate.
import { sampleClip } from './core/animator.mjs';
import { RIGS } from './core/rig.mjs';
import { mulXform } from './core/xform.mjs';
import { KATANA_POINTS, VM_WEAPON_SCALE } from './weapon.mjs';

function fkFromXforms(sample, rigName = 'R15') {
  const rig = RIGS[rigName];
  const out = { [rig.root]: { p: [0, 0, 0], q: [0, 0, 0, 1] } };
  for (const def of rig.joints) {
    const c0 = { p: def.c0, q: def.c0r ? eulerQuat(def.c0r) : [0, 0, 0, 1] };
    const c1inv = { p: def.c1.map((x) => -x), q: [0, 0, 0, 1] };
    const tf = sample[def.name] ?? { p: [0, 0, 0], q: [0, 0, 0, 1] };
    out[def.part1] = mulXform(mulXform(out[def.part0], mulXform(c0, tf)), c1inv);
  }
  return out;
}

function bladeAt(clipObj, t) {
  const s = sampleClip(clipObj, t);
  const w = fkFromXforms(s, clipObj.rig);
  const rm = s.RootMotion ? s.RootMotion.p : [0, 0, 0];
  const at = (local) => {
    const x = w.Weapon;
    const r = quatRotate(x.q, local);
    return [x.p[0] + r[0] + rm[0], x.p[1] + r[1] + rm[1], x.p[2] + r[2] + rm[2]];
  };
  const k = clipObj.rig === 'VM' ? VM_WEAPON_SCALE : 1;
  const sc = (v) => v.map((x) => x * k);
  return { base: at(sc(KATANA_POINTS.base)), tip: at(sc(KATANA_POINTS.tip)) };
}

export function bakeSwings(clipObj, { hz = 240, samples = 28 } = {}) {
  const starts = clipObj.markers.filter((m) => m.name === 'SwingStart');
  const ends = clipObj.markers.filter((m) => m.name === 'SwingEnd');
  const swings = [];
  for (const st of starts) {
    const en = ends.find((e) => e.t > st.t) ?? { t: clipObj.length };
    const raw = [];
    for (let t = st.t; t <= en.t + 1e-9; t += 1 / hz) raw.push({ t, ...bladeAt(clipObj, t) });
    let acc = 0;
    raw.forEach((r, k) => {
      if (k > 0) acc += Math.hypot(r.tip[0] - raw[k - 1].tip[0], r.tip[1] - raw[k - 1].tip[1], r.tip[2] - raw[k - 1].tip[2]);
      r.d = acc;
    });
    const out = [];
    for (let k = 0; k < samples; k++) {
      const d = (acc * k) / (samples - 1);
      let j = raw.findIndex((r) => r.d >= d - 1e-9);
      if (j < 1) j = 1;
      const a = raw[j - 1];
      const b = raw[j];
      const u = b.d > a.d ? Math.min(Math.max((d - a.d) / (b.d - a.d), 0), 1) : 0;
      const l = (x, y) => x.map((v, n) => +(v + (y[n] - v) * u).toFixed(3));
      out.push({ t: +(a.t + (b.t - a.t) * u).toFixed(4), base: l(a.base, b.base), tip: l(a.tip, b.tip) });
    }
    swings.push({ t0: st.t, t1: en.t, kind: st.slash ?? 'Slash', length: +acc.toFixed(2), points: out });
  }
  return swings;
}
