// Animation curves.
//
// A compiled channel is { t: number[], v: number[], m: number[], e: number[] }:
//   t  key times (seconds, ascending)
//   v  key values (degrees for rotation channels, studs for position channels)
//   m  key tangents (value units per second), precomputed at build time
//   e  ease code of the segment that LEAVES each key (see easing.mjs)
//
// Tangents are "auto-clamped" like Blender/Maya: smooth Catmull-Rom style slopes that go flat on
// local extrema and are limited so a segment never overshoots its keys. Because tangents are
// baked in, runtimes only need evalChannel(), which is mirrored exactly in Luau.

import { EASE_FN } from './easing.mjs';

const EPS = 1e-6;

function autoTangent(t0, v0, t1, v1, t2, v2) {
  const d0 = (v1 - v0) / (t1 - t0);
  const d1 = (v2 - v1) / (t2 - t1);
  if (d0 * d1 <= 0) return 0;
  let m = (v2 - v0) / (t2 - t0);
  const lim = 3 * Math.min(Math.abs(d0), Math.abs(d1));
  if (Math.abs(m) > lim) m = Math.sign(m) * lim;
  return m;
}

// keys: [{ t, v, e }] in any order. Keys sharing a time are merged (last one wins).
export function compileChannel(rawKeys, length, loop) {
  const byTime = new Map();
  for (const k of rawKeys) {
    let t = k.t;
    if (loop) {
      t = ((t % length) + length) % length;
      if (length - t < EPS) t = 0;
    } else {
      t = Math.min(Math.max(t, 0), length);
    }
    const key = Math.round(t * 1e5) / 1e5;
    byTime.set(key, { t: key, v: k.v, e: k.e ?? 0 });
  }
  const keys = [...byTime.values()].sort((a, b) => a.t - b.t);
  const n = keys.length;
  if (n === 0) return null;

  if (!loop) {
    const m = keys.map((k, i) =>
      i === 0 || i === n - 1
        ? 0
        : autoTangent(keys[i - 1].t, keys[i - 1].v, k.t, k.v, keys[i + 1].t, keys[i + 1].v),
    );
    return { t: keys.map((k) => k.t), v: keys.map((k) => k.v), m, e: keys.map((k) => k.e) };
  }

  // Looping: lay out three cycles so every key has neighbours, compute tangents, then keep the
  // window [last key of previous cycle .. first key of next cycle] which covers [0, length).
  const ext = [];
  for (const c of [-1, 0, 1]) for (const k of keys) ext.push({ t: k.t + c * length, v: k.v, e: k.e });
  const tangents = ext.map((k, i) =>
    i === 0 || i === ext.length - 1
      ? 0
      : autoTangent(ext[i - 1].t, ext[i - 1].v, k.t, k.v, ext[i + 1].t, ext[i + 1].v),
  );
  const lo = n - 1;
  const hi = 2 * n;
  const out = { t: [], v: [], m: [], e: [] };
  for (let i = lo; i <= hi; i++) {
    out.t.push(ext[i].t);
    out.v.push(ext[i].v);
    out.m.push(tangents[i]);
    out.e.push(ext[i].e);
  }
  return out;
}

export function evalChannel(ch, time) {
  const t = ch.t;
  const n = t.length;
  if (n === 1 || time <= t[0]) return ch.v[0];
  if (time >= t[n - 1]) return ch.v[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= time) lo = mid;
    else hi = mid;
  }
  const i = lo;
  const h = t[i + 1] - t[i];
  const u = (time - t[i]) / h;
  const v0 = ch.v[i];
  const v1 = ch.v[i + 1];
  const e = ch.e[i];
  if (e === 0) {
    const u2 = u * u;
    const u3 = u2 * u;
    return (
      (2 * u3 - 3 * u2 + 1) * v0 +
      (u3 - 2 * u2 + u) * h * ch.m[i] +
      (-2 * u3 + 3 * u2) * v1 +
      (u3 - u2) * h * ch.m[i + 1]
    );
  }
  if (e === 1) return v0 + (v1 - v0) * u;
  if (e === 2) return v0;
  return v0 + (v1 - v0) * EASE_FN[e](u);
}

// Wraps/clamps a playback time into the range a channel expects.
export function clipLocalTime(clip, time) {
  if (clip.loop) return ((time % clip.length) + clip.length) % clip.length;
  return Math.min(Math.max(time, 0), clip.length);
}
