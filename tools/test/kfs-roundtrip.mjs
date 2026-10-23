// KeyframeSequence round trip: parses the exported sequences (build/AAAMotionAnimations.rbxmx),
// interpolates them the way Roblox plays them (linear easing, slerped rotations between
// keyframes) and compares against the source curves at 240 Hz.
//   node anim/export-rbxmx.mjs && node test/kfs-roundtrip.mjs
import fs from 'node:fs';
import path from 'node:path';
import { sampleClip } from '../anim/core/animator.mjs';
import { R15, VM } from '../anim/core/rig.mjs';
import { IDENTITY, lerpXform, mulXform } from '../anim/core/xform.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const clips = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/clips.json'), 'utf8'));
const xml = fs.readFileSync(path.join(ROOT, 'build/AAAMotionAnimations.rbxmx'), 'utf8');
const ADDITIVE_BASE = { HitFront: 'CombatIdle', HitBack: 'CombatIdle', HitLeft: 'CombatIdle', HitRight: 'CombatIdle', LandLight: 'Idle', FP_Land: 'FP_Idle' };

function quatFromMatrix(m) {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  const l = Math.hypot(...q);
  return q.map((x) => x / l);
}

// Pose name -> joint name for a rig (the weapon pose is named Handle).
const poseJoint = (rig) => Object.fromEntries(rig.joints.map((j) => [j.name === 'Weapon' ? 'Handle' : j.part1, j.name]));

function parseSequences() {
  const out = {};
  const seqRe = /<Item class="KeyframeSequence"[^>]*><Properties><string name="Name">([^<]+)<\/string>([\s\S]*?)\n\t<\/Item>/g;
  for (const [, name, body] of xml.matchAll(seqRe)) {
    const frames = [];
    const kfRe = /<Item class="Keyframe"[^>]*><Properties><string name="Name">Keyframe<\/string><float name="Time">([^<]+)<\/float><\/Properties>([\s\S]*?)\t\t<\/Item>/g;
    for (const [, t, kb] of body.matchAll(kfRe)) {
      const poses = {};
      const poseRe = /<Item class="Pose"[^>]*><Properties><string name="Name">([^<]+)<\/string><CoordinateFrame name="CFrame"><X>([^<]+)<\/X><Y>([^<]+)<\/Y><Z>([^<]+)<\/Z>((?:<R\d\d>[^<]+<\/R\d\d>)+)<\/CoordinateFrame>/g;
      for (const [, pn, x, y, z, rs] of kb.matchAll(poseRe)) {
        const m = [...rs.matchAll(/<R\d\d>([^<]+)<\/R\d\d>/g)].map((r) => Number(r[1]));
        poses[pn] = { p: [Number(x), Number(y), Number(z)], q: quatFromMatrix(m) };
      }
      frames.push({ t: Number(t), poses });
    }
    out[name] = frames;
  }
  return out;
}

const angle = (a, b) => {
  const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  const d = Math.hypot(a[0] - s * b[0], a[1] - s * b[1], a[2] - s * b[2], a[3] - s * b[3]);
  const p = Math.hypot(a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2], a[3] + s * b[3]);
  return ((4 * Math.atan2(d, p)) * 180) / Math.PI;
};

const seqs = parseSequences();
let worstRot = 0;
let worstPos = 0;
let worstAt = '';
const rows = [];
for (const [name, frames] of Object.entries(seqs)) {
  const clip = clips[name];
  if (!clip) throw new Error(`exported sequence ${name} has no source clip`);
  const rig = clip.rig === 'VM' ? VM : R15;
  const map = poseJoint(rig);
  const base = ADDITIVE_BASE[name] ? sampleClip(clips[ADDITIVE_BASE[name]], 0) : null;
  let cr = 0;
  let cp = 0;
  let ca = '';
  for (let t = 0; t <= clip.length + 1e-9; t += 1 / 240) {
    let i = 0;
    while (i < frames.length - 2 && frames[i + 1].t <= t) i++;
    const a = frames[i];
    const b = frames[Math.min(i + 1, frames.length - 1)];
    const u = b.t > a.t ? Math.min(Math.max((t - a.t) / (b.t - a.t), 0), 1) : 0;
    const src = sampleClip(clip, clip.loop && Math.abs(t - clip.length) < 1e-9 ? 0 : t);
    for (const [pn, joint] of Object.entries(map)) {
      const pa = a.poses[pn];
      const pb = b.poses[pn];
      if (!pa || !pb) continue;
      const got = lerpXform(pa, pb, u);
      let want = src[joint] ?? IDENTITY;
      if (base) want = src[joint] ? mulXform(base[joint] ?? IDENTITY, src[joint]) : base[joint] ?? IDENTITY;
      const r = angle(got.q, want.q);
      const d = Math.hypot(got.p[0] - want.p[0], got.p[1] - want.p[1], got.p[2] - want.p[2]);
      if (r > cr) {
        cr = r;
        ca = `${t.toFixed(3)}s ${joint}`;
      }
      if (d > cp) cp = d;
    }
  }
  rows.push([name, cr, cp, ca, frames.length]);
  if (cr > worstRot) {
    worstRot = cr;
    worstAt = `${name} ${ca}`;
  }
  worstPos = Math.max(worstPos, cp);
}
rows.sort((x, y) => y[1] - x[1]);
for (const [n, r, p, at, k] of rows.slice(0, 8)) console.log(`  ${n.padEnd(16)} ${r.toFixed(2)} deg  ${p.toFixed(4)} studs  (${k} keyframes, worst at ${at})`);
console.log(`${rows.length} sequences: max rotation error ${worstRot.toFixed(2)} deg (${worstAt}), max position error ${worstPos.toFixed(4)} studs`);
const ok = worstRot < 2 && worstPos < 0.01;
console.log(ok ? 'KFS ROUNDTRIP OK' : 'KFS ROUNDTRIP FAILED');
process.exit(ok ? 0 : 1);
