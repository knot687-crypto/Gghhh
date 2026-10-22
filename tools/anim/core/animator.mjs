// Layered clip player (JS twin of AAAMotion/Animation/AnimationPlayer.luau).
//
// Per joint, layers are applied in ascending order. Inside a layer, the normal tracks that own the
// joint are averaged by weight (incremental slerp); the layer then overrides what is below it by
// min(totalWeight, 1). Additive tracks are multiplied on afterwards (result * lerp(I, add, w)).

import { clipLocalTime, evalChannel } from './curve.mjs';
import { IDENTITY, fromChannels, lerpXform, mulXform } from './xform.mjs';

export function sampleClip(clip, time) {
  const t = clipLocalTime(clip, time);
  const out = {};
  for (const [joint, chans] of Object.entries(clip.tracks)) {
    const c = {};
    for (const [name, ch] of Object.entries(chans)) c[name] = evalChannel(ch, t);
    out[joint] = fromChannels(c);
  }
  return out;
}

export function sampleClipChannels(clip, time) {
  const t = clipLocalTime(clip, time);
  const out = {};
  for (const [joint, chans] of Object.entries(clip.tracks)) {
    const c = { rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0 };
    for (const [name, ch] of Object.entries(chans)) c[name] = evalChannel(ch, t);
    out[joint] = c;
  }
  return out;
}

export class Track {
  constructor(animator, clip, opts = {}) {
    this.animator = animator;
    this.clip = clip;
    this.layer = opts.layer ?? 0;
    this.time = opts.time ?? 0;
    this.prevTime = this.time;
    this.speed = opts.speed ?? 1;
    this.loop = opts.loop ?? clip.loop;
    this.mask = opts.mask ?? null;
    this.hold = opts.hold ?? false;
    this.fadeOut = opts.fadeOut ?? 0.15;
    this.weight = (opts.fadeIn ?? 0.12) > 0 ? 0 : opts.weight ?? 1;
    this.fadeTo(opts.weight ?? 1, opts.fadeIn ?? 0.12);
    this.stopping = false;
    this.done = false;
    this.name = opts.name ?? clip.name;
    this.firedEnd = false;
  }

  fadeTo(target, time) {
    this.targetWeight = target;
    this.fadeRate = time > 0 ? Math.abs(target - this.weight) / time : Infinity;
  }

  stop(fade = this.fadeOut) {
    if (this.stopping) return;
    this.stopping = true;
    this.fadeTo(0, fade);
  }

  get length() {
    return this.clip.length;
  }

  get progress() {
    return this.time / this.clip.length;
  }
}

export class Animator {
  constructor(jointNames) {
    this.joints = jointNames;
    this.tracks = [];
    this.timeScale = 1;
    this.listeners = [];
  }

  onMarker(fn) {
    this.listeners.push(fn);
  }

  play(clip, opts = {}) {
    const track = new Track(this, clip, opts);
    this.tracks.push(track);
    this.tracks.sort((a, b) => a.layer - b.layer);
    return track;
  }

  stopLayer(layer, fade) {
    for (const t of this.tracks) if (t.layer === layer) t.stop(fade);
  }

  fire(track, marker) {
    for (const fn of this.listeners) fn(track, marker);
  }

  update(dt) {
    const sdt = dt * this.timeScale;
    for (const tr of this.tracks) {
      tr.prevTime = tr.time;
      tr.time += sdt * tr.speed;
      const L = tr.clip.length;
      if (tr.loop) {
        if (tr.time >= L || tr.time < 0) {
          const wrapped = ((tr.time % L) + L) % L;
          // Fire markers across the wrap.
          for (const m of tr.clip.markers) if (m.t > tr.prevTime || m.t <= wrapped) this.fire(tr, m);
          tr.time = wrapped;
          tr.prevTime = tr.time;
          continue;
        }
      } else if (tr.time >= L) {
        tr.time = L;
        if (!tr.hold && !tr.stopping) tr.stop(0.0001);
      } else if (!tr.hold && !tr.stopping && tr.time >= L - tr.fadeOut && tr.speed > 0) {
        tr.stop(Math.max(L - tr.time, 0.0001) / Math.max(tr.speed, 1e-3));
      }
      for (const m of tr.clip.markers) if (m.t > tr.prevTime && m.t <= tr.time) this.fire(tr, m);
    }
    for (const tr of this.tracks) {
      if (tr.weight !== tr.targetWeight) {
        const step = tr.fadeRate * dt;
        if (Math.abs(tr.targetWeight - tr.weight) <= step || !isFinite(step)) tr.weight = tr.targetWeight;
        else tr.weight += Math.sign(tr.targetWeight - tr.weight) * step;
      }
      if (tr.stopping && tr.weight <= 0) tr.done = true;
    }
    this.tracks = this.tracks.filter((t) => !t.done);
  }

  evaluate() {
    const result = {};
    for (const j of this.joints) result[j] = IDENTITY;
    const samples = this.tracks.map((tr) => (tr.weight > 0 ? sampleClip(tr.clip, tr.time) : null));
    let i = 0;
    while (i < this.tracks.length) {
      const layer = this.tracks[i].layer;
      let k = i;
      while (k < this.tracks.length && this.tracks[k].layer === layer) k++;
      for (const j of this.joints) {
        let acc = null;
        let accW = 0;
        for (let n = i; n < k; n++) {
          const tr = this.tracks[n];
          const s = samples[n];
          if (!s || tr.clip.additive || !s[j]) continue;
          const w = tr.weight * (tr.mask ? tr.mask[j] ?? tr.mask.default ?? 1 : 1);
          if (w <= 0) continue;
          if (accW === 0) acc = s[j];
          else acc = lerpXform(acc, s[j], w / (accW + w));
          accW += w;
        }
        if (acc) result[j] = lerpXform(result[j], acc, Math.min(accW, 1));
        for (let n = i; n < k; n++) {
          const tr = this.tracks[n];
          const s = samples[n];
          if (!s || !tr.clip.additive || !s[j]) continue;
          const w = tr.weight * (tr.mask ? tr.mask[j] ?? tr.mask.default ?? 1 : 1);
          if (w <= 0) continue;
          result[j] = mulXform(result[j], lerpXform(IDENTITY, s[j], Math.min(w, 1)));
        }
      }
      i = k;
    }
    return result;
  }
}
