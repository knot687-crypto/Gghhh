// Authoring DSL.
//
//   const stance = pose({ Root: { p: [0, -0.1, 0], r: [-4, 20, 0] }, Waist: { r: [4, -15, 0] } });
//   export const Idle = clip('Idle', { length: 2.4, loop: true }, (c) => {
//     c.key(0, stance);
//     c.key(1.2, stance.add({ Waist: { r: [2, 0, 0] } }), { lag: { Neck: 0.1 } });
//   });
//
// A key's `ease` applies to the segment that leaves it. `lag` shifts individual joints' keys in
// time (overlapping action / follow-through). Every joint a clip ever keys is "owned" by that
// clip; joints it never keys pass through to lower animation layers.

import { compileChannel } from './curve.mjs';
import { easeCode } from './easing.mjs';
import { mirrorName } from './rig.mjs';

const CH = ['rx', 'ry', 'rz', 'px', 'py', 'pz'];
const ZERO = [0, 0, 0];

function normJoint(j) {
  return { r: j.r ? [...j.r] : [...ZERO], p: j.p ? [...j.p] : [...ZERO] };
}

export class Pose {
  constructor(joints = {}) {
    this.j = {};
    for (const [name, value] of Object.entries(joints)) this.j[name] = normJoint(value);
  }

  clone() {
    return new Pose(this.j);
  }

  // Replace r and/or p of the listed joints.
  with(over) {
    const out = this.clone();
    for (const [name, value] of Object.entries(over)) {
      const cur = out.j[name] ?? normJoint({});
      out.j[name] = { r: value.r ? [...value.r] : cur.r, p: value.p ? [...value.p] : cur.p };
    }
    return out;
  }

  // Add rotation/position deltas to the listed joints.
  add(delta) {
    const out = this.clone();
    for (const [name, value] of Object.entries(delta)) {
      const cur = out.j[name] ?? normJoint({});
      out.j[name] = {
        r: cur.r.map((x, i) => x + (value.r?.[i] ?? 0)),
        p: cur.p.map((x, i) => x + (value.p?.[i] ?? 0)),
      };
    }
    return out;
  }

  // Scale every channel (useful for additive poses).
  scale(s) {
    const out = this.clone();
    for (const name of Object.keys(out.j)) {
      out.j[name] = { r: out.j[name].r.map((x) => x * s), p: out.j[name].p.map((x) => x * s) };
    }
    return out;
  }

  // Mirror across the character's sagittal plane.
  mirror() {
    const out = new Pose();
    for (const [name, value] of Object.entries(this.j)) {
      out.j[mirrorName(name)] = {
        r: [value.r[0], -value.r[1], -value.r[2]],
        p: [-value.p[0], value.p[1], value.p[2]],
      };
    }
    return out;
  }

  // Linear channel blend toward another pose (joints missing on one side count as zero).
  blend(other, w) {
    const out = new Pose();
    const names = new Set([...Object.keys(this.j), ...Object.keys(other.j)]);
    for (const name of names) {
      const a = this.j[name] ?? normJoint({});
      const b = other.j[name] ?? normJoint({});
      out.j[name] = {
        r: a.r.map((x, i) => x + (b.r[i] - x) * w),
        p: a.p.map((x, i) => x + (b.p[i] - x) * w),
      };
    }
    return out;
  }

  only(names) {
    const out = new Pose();
    for (const n of names) if (this.j[n]) out.j[n] = normJoint(this.j[n]);
    return out;
  }

  omit(names) {
    const out = this.clone();
    for (const n of names) delete out.j[n];
    return out;
  }
}

export const pose = (joints) => new Pose(joints);

// Euler filter: IK solves every key independently, so a key can come out as a different but
// equivalent angle triple (wrapped by 360 deg, or the alternate XYZ solution
// (rx + 180, 180 - ry, rz + 180)). Interpolating channels between such keys spins the joint the
// long way round. Re-express each rotation key as the equivalent triple closest to the previous
// key; key orientations are unchanged, only the in-betweens take the short path.
function closestEuler(prev, r) {
  let best = null;
  let bestD = Infinity;
  for (const c of [r, [r[0] + 180, 180 - r[1], r[2] + 180]]) {
    const w = c.map((v, i) => v + 360 * Math.round((prev[i] - v) / 360));
    const d = (w[0] - prev[0]) ** 2 + (w[1] - prev[1]) ** 2 + (w[2] - prev[2]) ** 2;
    if (d < bestD - 1e-9) {
      bestD = d;
      best = w;
    }
  }
  return best;
}

function eulerFilter(chans, length, loop) {
  // Same time normalisation and de-duplication compileChannel applies (last key at a time wins).
  const byTime = new Map();
  chans.rx.forEach((k, i) => {
    let t = k.t;
    if (loop) {
      t = ((t % length) + length) % length;
      if (length - t < 1e-6) t = 0;
    } else t = Math.min(Math.max(t, 0), length);
    const key = Math.round(t * 1e5) / 1e5;
    byTime.set(key, { t: key, r: [chans.rx[i].v, chans.ry[i].v, chans.rz[i].v], e: [chans.rx[i].e, chans.ry[i].e, chans.rz[i].e] });
  });
  const keys = [...byTime.values()].sort((a, b) => a.t - b.t);
  for (let i = 1; i < keys.length; i++) keys[i].r = closestEuler(keys[i - 1].r, keys[i].r);
  if (loop && keys.length > 1) {
    // The cycle must close on itself: if the last key needs a different triple to reach the
    // first one, keep the original keys rather than create a jump at the seam.
    const wrap = closestEuler(keys[keys.length - 1].r, keys[0].r);
    if (wrap.some((v, i) => Math.abs(v - keys[0].r[i]) > 1e-6)) return;
  }
  for (let i = 0; i < 3; i++) chans[CH[i]] = keys.map((k) => ({ t: k.t, v: k.r[i], e: k.e[i] }));
}

class ClipBuilder {
  constructor(name, opts) {
    this.name = name;
    this.opts = { rig: 'R15', loop: false, additive: false, ...opts };
    if (!(this.opts.length > 0)) throw new Error(`Clip ${name} needs a positive length`);
    this.keys = [];
    this.markers = [];
  }

  key(t, p, opts = {}) {
    if (!(p instanceof Pose)) throw new Error(`Clip ${this.name}: key at ${t} is not a Pose`);
    this.keys.push({ t, pose: p, ease: opts.ease, jointEase: opts.jointEase ?? {}, lag: opts.lag ?? {} });
    return this;
  }

  marker(t, name, data = {}) {
    this.markers.push({ t, name, ...data });
    return this;
  }

  build() {
    const { length, loop } = this.opts;
    const raw = {};
    for (const k of this.keys) {
      for (const [joint, value] of Object.entries(k.pose.j)) {
        const t = k.t + (k.lag[joint] ?? 0);
        const e = easeCode(k.jointEase[joint] ?? k.ease);
        raw[joint] ??= Object.fromEntries(CH.map((c) => [c, []]));
        for (let i = 0; i < 3; i++) {
          raw[joint][CH[i]].push({ t, v: value.r[i], e });
          raw[joint][CH[i + 3]].push({ t, v: value.p[i], e });
        }
      }
    }
    for (const chans of Object.values(raw)) eulerFilter(chans, length, loop);
    const tracks = {};
    for (const [joint, chans] of Object.entries(raw)) {
      tracks[joint] = {};
      for (const c of CH) {
        const compiled = compileChannel(chans[c], length, loop);
        if (!compiled) continue;
        const allZero = compiled.v.every((x) => Math.abs(x) < 1e-9);
        if (allZero) continue;
        const constant = compiled.v.every((x) => Math.abs(x - compiled.v[0]) < 1e-9);
        tracks[joint][c] = constant ? { t: [0], v: [compiled.v[0]], m: [0], e: [0] } : compiled;
      }
    }
    const markers = this.markers
      .map((m) => ({ ...m, t: Math.min(Math.max(m.t, 0), length) }))
      .sort((a, b) => a.t - b.t);
    const { rig, additive, ...meta } = this.opts;
    delete meta.length;
    delete meta.loop;
    return { name: this.name, rig, length, loop, additive, tracks, markers, meta };
  }
}

export function clip(name, opts, fn) {
  const b = new ClipBuilder(name, opts);
  fn(b);
  return b.build();
}

// Mirror a compiled clip left<->right (used for wall-run/dash/wall-jump variants).
export function mirrorClip(src, name, metaOverrides = {}) {
  const flip = new Set(['ry', 'rz', 'px']);
  const swap = (n) => (n.startsWith('Left') ? 'Right' + n.slice(4) : n.startsWith('Right') ? 'Left' + n.slice(5) : n);
  const tracks = {};
  for (const [joint, chans] of Object.entries(src.tracks)) {
    const out = {};
    for (const [c, ch] of Object.entries(chans)) {
      out[c] = flip.has(c) ? { t: [...ch.t], v: ch.v.map((x) => -x), m: ch.m.map((x) => -x), e: [...ch.e] } : ch;
    }
    tracks[swap(joint)] = out;
  }
  const markers = src.markers.map((m) => {
    const o = { ...m };
    for (const [k, v] of Object.entries(o)) if (typeof v === 'string' && /^(Left|Right)/.test(v) && k !== 'name') o[k] = swap(v);
    return o;
  });
  return { ...src, name, tracks, markers, meta: { ...src.meta, ...metaOverrides } };
}
