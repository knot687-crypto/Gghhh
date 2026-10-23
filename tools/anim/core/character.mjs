// CharacterAnimator: drives an Animator from gameplay state. JS twin of
// src/ReplicatedStorage/AAAMotion/Animation/CharacterAnimator.luau - keep the two in sync.
//
// Layers: 0 locomotion (speed-blended, phase-synced) | 1 full-body actions | 2 upper-body
// overlay | 3 additive (flinches, landings). After blending, a procedural pass adds lean into
// turns/acceleration (pivoting at the feet) and hit-stop jitter.
import { Animator } from './animator.mjs';
import { R15, rigJointNames } from './rig.mjs';
import { mulXform, quatFromEulerXYZ, quatMul, quatRotate } from './xform.mjs';

export const LAYER = { LOCO: 0, ACTION: 1, OVERLAY: 2, ADDITIVE: 3 };

const D2R = Math.PI / 180;

export const LOCO_SETS = {
  sheathed: { idle: 'Idle', moving: [['Walk', 6], ['Run', 16], ['Sprint', 26]] },
  armed: { idle: 'CombatIdle', moving: [['Walk', 6], ['Run', 16], ['Sprint', 26]] },
  crouch: { idle: 'CrouchIdle', moving: [['CrouchWalk', 8]] },
};

const LOCO_CLIPS = ['Idle', 'Walk', 'Run', 'Sprint', 'CombatIdle', 'CrouchIdle', 'CrouchWalk', 'Rise', 'Fall'];

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

// Critically damped spring toward a target (stable for any dt).
function damp(cur, vel, target, halfLife, dt) {
  const omega = 1.386 / Math.max(halfLife, 1e-4); // ln(4) / halfLife ~ critically damped
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target;
  const temp = (vel + omega * change) * dt;
  const newVel = (vel - omega * temp) * exp;
  const out = target + (change + temp) * exp;
  return [out, newVel];
}

// ---------------------------------------------------------------- inertialization
// Actions start and stop at once; the difference between the pose that was on screen and the
// new pose becomes a per-joint offset that decays to zero with a critically damped spring
// (inertialization, in Holden's spring form). The offset starts with the old motion's velocity
// minus the new one's, so movement carries through the switch instead of cross-fading through
// an in-between pose, and the new animation plays undiluted from its first frame.
const INERT_SKIP = new Set(['RootMotion', 'Camera']);
const LN2 = Math.log(2);

function quatLog(q) {
  let [x, y, z, w] = q;
  if (w < 0) {
    x = -x;
    y = -y;
    z = -z;
    w = -w;
  }
  const s = Math.hypot(x, y, z);
  if (s < 1e-9) return [2 * x, 2 * y, 2 * z];
  const a = (2 * Math.atan2(s, w)) / s;
  return [x * a, y * a, z * a];
}

function quatExp(v) {
  const a = Math.hypot(v[0], v[1], v[2]);
  if (a < 1e-9) return [0, 0, 0, 1];
  const k = Math.sin(a / 2) / a;
  return [v[0] * k, v[1] * k, v[2] * k, Math.cos(a / 2)];
}

const conj = (q) => [-q[0], -q[1], -q[2], q[3]];

// Decays (x, v) toward zero over dt (critically damped, half-life h), in place.
function decay(x, v, h, dt) {
  const y = (2 * LN2) / Math.max(h, 1e-4);
  const e = Math.exp(-y * dt);
  for (let i = 0; i < 3; i++) {
    const j1 = v[i] + x[i] * y;
    x[i] = e * (x[i] + j1 * dt);
    v[i] = e * (v[i] - j1 * y * dt);
  }
}

export class Inertializer {
  constructor() {
    this.off = null; // joint -> { r, w, p, v }: rotation-vector offset + its velocity, position offset + velocity
    this.halfLife = 0.05;
    this.pending = 0;
    this.prev = null; // pose shown last frame
    this.vel = {}; // its velocity: joint -> { w, v }
    this.raw0 = null; // new target at the switch (its velocity is removed one frame later)
  }

  trigger(halfLife) {
    this.pending = this.pending > 0 ? Math.min(this.pending, halfLife) : halfLife;
  }

  apply(pose, dt) {
    const prev = this.prev;
    if (this.pending > 0 && prev) {
      this.halfLife = this.pending;
      this.off = {};
      for (const [j, t] of Object.entries(pose)) {
        if (INERT_SKIP.has(j) || !prev[j]) continue;
        const d = prev[j];
        const vel = this.vel[j];
        this.off[j] = {
          r: quatLog(quatMul(d.q, conj(t.q))),
          w: vel ? [...vel.w] : [0, 0, 0],
          p: [d.p[0] - t.p[0], d.p[1] - t.p[1], d.p[2] - t.p[2]],
          v: vel ? [...vel.v] : [0, 0, 0],
        };
      }
      this.raw0 = { ...pose };
    } else if (this.raw0 && this.off && dt > 0) {
      for (const [j, o] of Object.entries(this.off)) {
        const a = this.raw0[j];
        const b = pose[j];
        if (!a || !b) continue;
        const tw = quatLog(quatMul(b.q, conj(a.q)));
        for (let i = 0; i < 3; i++) {
          o.w[i] -= tw[i] / dt;
          o.v[i] -= (b.p[i] - a.p[i]) / dt;
        }
      }
      this.raw0 = null;
    }
    this.pending = 0;
    let out = pose;
    if (this.off) {
      out = { ...pose };
      let live = false;
      for (const [j, o] of Object.entries(this.off)) {
        const t = pose[j];
        if (!t) continue;
        decay(o.r, o.w, this.halfLife, dt);
        decay(o.p, o.v, this.halfLife, dt);
        out[j] = { q: quatMul(quatExp(o.r), t.q), p: [t.p[0] + o.p[0], t.p[1] + o.p[1], t.p[2] + o.p[2]] };
        if (Math.hypot(...o.r) > 1e-4 || Math.hypot(...o.p) > 1e-4 || Math.hypot(...o.w) > 1e-3 || Math.hypot(...o.v) > 1e-3) live = true;
      }
      if (!live && !this.raw0) this.off = null;
    }
    if (prev && dt > 0) {
      for (const [j, t] of Object.entries(out)) {
        const d = prev[j];
        if (INERT_SKIP.has(j) || !d) continue;
        const w = quatLog(quatMul(t.q, conj(d.q)));
        this.vel[j] = { w: [w[0] / dt, w[1] / dt, w[2] / dt], v: [(t.p[0] - d.p[0]) / dt, (t.p[1] - d.p[1]) / dt, (t.p[2] - d.p[2]) / dt] };
      }
    }
    if (dt > 0 || !prev) this.prev = { ...out };
    return out;
  }
}

// An action's requested fade time -> inertialization half-life.
export const blendHalfLife = (fade) => Math.max(0.02, fade * 0.55);

export class CharacterAnimator {
  constructor(clips, { rig = 'R15' } = {}) {
    this.clips = clips;
    this.rig = rig;
    this.animator = new Animator(rigJointNames(rig === 'R15' ? R15 : rig));
    this.loco = {};
    this.phase = 0;
    this.action = null;
    this.overlay = null;
    this.listeners = [];
    this.timeScale = 1;
    this.freeze = 0;
    this.freezeShake = 0;
    this.shakeSeed = 1;
    this.lean = { roll: 0, rollV: 0, pitch: 0, pitchV: 0 };
    this.prevYaw = null;
    this.prevSpeed = 0;
    this.legLength = 1.83;
    this.inert = new Inertializer();
    this.lastDt = 0;
    this.state = { speed: 0, vy: 0, grounded: true, crouch: false, armed: false, yaw: 0, moving: true };
    this.animator.onMarker((track, marker) => this.emit(marker.name, marker, track));
    for (const name of LOCO_CLIPS) {
      const clip = clips[name];
      if (!clip) continue;
      this.loco[name] = this.animator.play(clip, { layer: LAYER.LOCO, weight: 0, fadeIn: 0, speed: 0, loop: true });
      this.loco[name].weight = 0;
      this.loco[name].targetWeight = 0;
    }
  }

  on(fn) {
    this.listeners.push(fn);
  }

  emit(name, data, track) {
    for (const fn of this.listeners) fn(name, data, track);
  }

  // ---------------------------------------------------------------- actions
  play(name, opts = {}) {
    const clip = this.clips[name];
    if (!clip) throw new Error(`unknown clip ${name}`);
    const layer = opts.layer ?? (clip.additive ? LAYER.ADDITIVE : clip.meta?.overlay ? LAYER.OVERLAY : LAYER.ACTION);
    const fadeIn = opts.fadeIn ?? (layer === LAYER.ADDITIVE ? 0.02 : 0.08);
    // Full-body actions switch instantly and are inertialized (see Inertializer).
    const inertial = layer === LAYER.ACTION;
    if (inertial) {
      if (this.action && !this.action.stopping) this.action.stop(0);
      this.inert.trigger(blendHalfLife(fadeIn));
    }
    const track = this.animator.play(clip, {
      layer,
      fadeIn: inertial ? 0 : fadeIn,
      fadeOut: inertial ? 0 : opts.fadeOut ?? 0.15,
      speed: opts.speed ?? 1,
      hold: opts.hold ?? false,
      loop: opts.loop,
      weight: opts.weight ?? 1,
      mask: opts.mask ?? null,
    });
    if (layer === LAYER.ACTION) {
      this.action = track;
      track.endBlend = blendHalfLife(opts.fadeOut ?? 0.15);
    }
    if (clip.meta?.weapon) this.emit('WeaponAttach', { to: clip.meta.weapon, initial: true }, track);
    return track;
  }

  stopAction(fade = 0.15) {
    if (this.action) {
      this.action.stop(0);
      this.inert.trigger(blendHalfLife(fade));
    }
    this.action = null;
  }

  setOverlay(name, fade = 0.2) {
    if (this.overlay && this.overlay.clip.name === name && !this.overlay.stopping) return;
    if (this.overlay) this.overlay.stop(fade);
    this.overlay = name ? this.animator.play(this.clips[name], { layer: LAYER.OVERLAY, fadeIn: fade, loop: true }) : null;
  }

  hitStop(duration, shake = 0) {
    this.freeze = Math.max(this.freeze, duration);
    this.freezeShake = shake;
  }

  get actionActive() {
    return !!(this.action && !this.action.stopping && !this.action.done);
  }

  // ---------------------------------------------------------------- locomotion
  locoWeights(s) {
    const w = {};
    for (const n of Object.keys(this.loco)) w[n] = 0;
    if (!s.grounded) {
      const rise = clamp((s.vy + 6) / 18, 0, 1);
      w.Rise = rise;
      w.Fall = 1 - rise;
      return w;
    }
    const set = s.crouch ? LOCO_SETS.crouch : s.armed ? LOCO_SETS.armed : LOCO_SETS.sheathed;
    const pts = [[set.idle, 0], ...set.moving];
    const v = s.speed;
    if (v <= 0.25) {
      w[set.idle] = 1;
      return w;
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, va] = pts[i];
      const [b, vb] = pts[i + 1];
      if (v <= vb) {
        const k = clamp((v - va) / (vb - va), 0, 1);
        w[a] += 1 - k;
        w[b] += k;
        return w;
      }
    }
    w[pts[pts.length - 1][0]] = 1;
    return w;
  }

  update(dt, s) {
    Object.assign(this.state, s);
    const st = this.state;
    let adt = dt * this.timeScale;
    if (this.freeze > 0) {
      this.freeze -= dt;
      adt *= 0.02;
    }

    // Locomotion weights (smoothed by track fades).
    const w = this.locoWeights(st);
    const wasGrounded = this._wasGrounded ?? true;
    const fade = st.grounded !== wasGrounded ? 0.12 : 0.18;
    this._wasGrounded = st.grounded;
    for (const [n, tr] of Object.entries(this.loco)) {
      if (tr.targetWeight !== w[n]) tr.fadeTo(w[n], fade);
    }

    // Phase sync for cycles: advance by distance travelled / blended stride.
    let strideW = 0;
    let stride = 0;
    for (const [n, tr] of Object.entries(this.loco)) {
      const st_ = this.clips[n].meta?.stride;
      if (st_ && w[n] > 0) {
        stride += st_ * w[n];
        strideW += w[n];
      }
    }
    const blended = strideW > 0 ? stride / strideW : this.clips.Walk?.meta?.stride ?? 5;
    const prevPhase = this.phase;
    if (st.grounded) this.phase = (this.phase + (adt * st.speed) / blended) % 1;
    const movingW = strideW;
    if (movingW > 0.4 && st.grounded) {
      if (prevPhase > this.phase) this.emit('Footstep', { foot: 'Left', speed: st.speed });
      else if (prevPhase < 0.5 && this.phase >= 0.5) this.emit('Footstep', { foot: 'Right', speed: st.speed });
    }
    for (const [n, tr] of Object.entries(this.loco)) {
      const clip = this.clips[n];
      if (clip.meta?.stride) {
        tr.speed = 0;
        tr.time = this.phase * clip.length;
      } else {
        tr.speed = 1;
      }
    }
    // Overlays synced to the run cycle follow the same phase.
    if (this.overlay && this.overlay.clip.meta?.syncWith) {
      this.overlay.speed = 0;
      this.overlay.time = this.phase * this.overlay.clip.length;
    }

    this.animator.update(adt);
    this.lastDt = adt;
    if (this.action && (this.action.done || this.action.stopping)) {
      // Played to its end: hand back to locomotion through the inertializer.
      this.inert.trigger(this.action.endBlend ?? blendHalfLife(0.15));
      this.action = null;
    }

    // Lean: roll into turns (centripetal), pitch with acceleration.
    if (this.prevYaw === null) this.prevYaw = st.yaw;
    let dy = st.yaw - this.prevYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.prevYaw = st.yaw;
    const yawRate = dt > 0 ? dy / dt : 0;
    const accel = dt > 0 ? (st.speed - this.prevSpeed) / dt : 0;
    this.prevSpeed = st.speed;
    const leanScale = st.grounded && !this.actionActive ? 1 : 0.25;
    const rollTarget = clamp(yawRate * st.speed * 0.55, -16, 16) * leanScale;
    const pitchTarget = clamp(-accel * 0.22, -9, 6) * leanScale;
    [this.lean.roll, this.lean.rollV] = damp(this.lean.roll, this.lean.rollV, rollTarget, 0.12, dt);
    [this.lean.pitch, this.lean.pitchV] = damp(this.lean.pitch, this.lean.pitchV, pitchTarget, 0.1, dt);
  }

  evaluate() {
    let pose = this.animator.evaluate();
    if (pose.Root) {
      // Lean about the ground point under the root joint so the feet stay put.
      const q = quatFromEulerXYZ(this.lean.pitch * D2R, 0, this.lean.roll * D2R);
      const c = [0, -this.legLength, 0];
      const rc = quatRotate(q, c);
      const lean = { p: [c[0] - rc[0], c[1] - rc[1], c[2] - rc[2]], q };
      pose.Root = mulXform(lean, pose.Root);
    }
    pose = this.inert.apply(pose, this.lastDt);
    this.lastDt = 0;
    if (pose.Root) {
      if (this.freeze > 0 && this.freezeShake > 0) {
        this.shakeSeed = (this.shakeSeed * 16807) % 2147483647;
        const r = this.shakeSeed / 2147483647 - 0.5;
        this.shakeSeed = (this.shakeSeed * 16807) % 2147483647;
        const r2 = this.shakeSeed / 2147483647 - 0.5;
        const k = this.freezeShake;
        pose.Root = { p: [pose.Root.p[0] + r * k, pose.Root.p[1], pose.Root.p[2] + r2 * k], q: pose.Root.q };
      }
    }
    return pose;
  }

  // Root-motion delta (facing frame) of the current action between two of its times.
  rootMotion(track, t0, t1) {
    const ch = track.clip.tracks.RootMotion;
    if (!ch) return null;
    return [ch, t0, t1];
  }
}
