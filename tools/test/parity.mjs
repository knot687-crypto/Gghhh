// Parity test: runs the same scripted scenario through the JS CharacterAnimator (which drives
// the preview videos) and the Luau CharacterAnimator (which runs in Roblox), then compares every
// sampled joint transform and every emitted event.
//   node test/parity.mjs [path/to/luaurun]
// luaurun is the tiny Luau host in test/luaurun (see its README).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CharacterAnimator } from '../anim/core/character.mjs';
import { R15 } from '../anim/core/rig.mjs';
import { build } from '../anim/build.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.resolve(ROOT, '../src/ReplicatedStorage/AAAMotion');
const runner = process.argv[2] ?? path.join(ROOT, 'test/luaurun/luaurun');

// ------------------------------------------------------------------ scenario
const DT = 1 / 60;
const N = 720;
const EVERY = 3;
const lerpKeys = (keys, f) => {
  for (let i = 1; i < keys.length; i++) {
    if (f <= keys[i][0]) {
      const [f0, v0] = keys[i - 1];
      const [f1, v1] = keys[i];
      return v0 + ((v1 - v0) * (f - f0)) / (f1 - f0);
    }
  }
  return keys[keys.length - 1][1];
};
const SPEED = [[0, 0], [120, 26], [200, 26], [260, 8], [330, 8], [380, 12], [500, 0], [560, 16], [720, 16]];
const CMDS = {
  100: [['play', 'DashForward', {}]],
  200: [['play', 'Light1', { fadeIn: 0.06 }]],
  226: [['play', 'Light2', { fadeIn: 0.05 }]],
  240: [['hitstop', 0.1, 0.05]],
  300: [['overlay', 'ArmedRun', 0.2]],
  380: [['play', 'LandHeavy', { fadeIn: 0.03 }]],
  440: [['play', 'HeavyCharge', { fadeIn: 0.12 }]],
  500: [['play', 'HeavyRelease', { fadeIn: 0.05 }]],
  520: [['overlay', null, 0.2]],
  600: [['play', 'Block', { fadeIn: 0.08 }]],
  640: [['stop', 0.15]],
  650: [['play', 'HitFront', { fadeIn: 0.02 }]],
  680: [['play', 'Vault', {}]],
};
const frames = [];
for (let f = 0; f < N; f++) {
  const grounded = !(f >= 330 && f < 380);
  frames.push({
    state: {
      speed: lerpKeys(SPEED, f),
      vy: grounded ? 0 : 50 - (f - 330) * 2.2,
      grounded,
      crouch: f >= 260 && f < 320,
      armed: f >= 290,
      yaw: Math.sin(f / 45) * 1.2,
    },
    cmds: CMDS[f] ?? [],
  });
}

// ------------------------------------------------------------------ JS reference
const clips = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/clips.json'), 'utf8'));
const anim = new CharacterAnimator(clips);
const jsOut = [];
let frame = 0;
anim.on((name, data) => jsOut.push(`E ${frame} ${name} ${data?.foot ?? data?.to ?? ''}`));
for (let f = 0; f < N; f++) {
  frame = f;
  for (const c of frames[f].cmds) {
    if (c[0] === 'play') anim.play(c[1], c[2]);
    else if (c[0] === 'stop') anim.stopAction(c[1]);
    else if (c[0] === 'overlay') anim.setOverlay(c[1], c[2]);
    else if (c[0] === 'hitstop') anim.hitStop(c[1], c[2]);
  }
  anim.update(DT, frames[f].state);
  const pose = anim.evaluate();
  if (f % EVERY === 0) {
    for (const j of R15.joints) {
      const t = pose[j.name];
      if (!t) continue;
      let q = t.q;
      if (q[3] < 0) q = q.map((x) => -x);
      jsOut.push(['P', f, j.name, ...t.p, ...q]);
    }
  }
}

// ------------------------------------------------------------------ Luau run
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aaa-parity-'));
const lua = (v) => {
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toPrecision(17);
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `{${v.map(lua).join(',')}}`;
  return `{${Object.entries(v).map(([k, x]) => `${k}=${lua(x)}`).join(',')}}`;
};
fs.writeFileSync(path.join(tmp, 'scenario.luau'), `return ${lua({ dt: DT, every: EVERY, frames })}\n`);
const manifest = [];
const walk = (d, rel = '') => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(path.join(d, e.name), r);
    else if (e.name.endsWith('.luau')) manifest.push(r);
  }
};
walk(SRC);
fs.writeFileSync(path.join(tmp, 'manifest.txt'), manifest.join('\n'));
const out = execFileSync(runner, [
  path.join(ROOT, 'test/luau/parity.luau'),
  path.join(ROOT, 'test/luau/mock.luau'),
  SRC,
  path.join(tmp, 'manifest.txt'),
  path.join(tmp, 'scenario.luau'),
], { maxBuffer: 1 << 28 }).toString();
fs.rmSync(tmp, { recursive: true, force: true });

// ------------------------------------------------------------------ compare
const luauLines = out.trim().split('\n');
const luauP = new Map();
const luauE = [];
for (const l of luauLines) {
  const p = l.split(' ');
  if (p[0] === 'P') luauP.set(`${p[1]} ${p[2]}`, p.slice(3).map(Number));
  else if (p[0] === 'E') luauE.push(l.trim());
}
let maxP = 0;
let maxQ = 0;
let worst = '';
let count = 0;
for (const row of jsOut) {
  if (typeof row === 'string') continue;
  const [, f, name, ...vals] = row;
  const lv = luauP.get(`${f} ${name}`);
  if (!lv) throw new Error(`missing Luau sample ${f} ${name}`);
  count++;
  const dp = Math.max(...[0, 1, 2].map((i) => Math.abs(vals[i] - lv[i])));
  // Quaternion angle difference (radians), normalised and numerically stable near zero:
  // angle = 4 * atan2(|a - b|, |a + b|) with b sign-aligned to a.
  const norm = (q) => {
    const l = Math.hypot(...q);
    return q.map((x) => x / l);
  };
  const a = norm(vals.slice(3, 7));
  let b = norm(lv.slice(3, 7));
  if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0) b = b.map((x) => -x);
  const diff = Math.hypot(...a.map((x, i) => x - b[i]));
  const sum = Math.hypot(...a.map((x, i) => x + b[i]));
  const dq = 4 * Math.atan2(diff, sum);
  if (dp > maxP) maxP = dp;
  if (process.env.PARITY_VERBOSE && dq > 1e-4) console.log(`  frame ${f} ${name}: rot ${((dq * 180) / Math.PI).toFixed(4)} deg`);
  if (dq > maxQ) {
    maxQ = dq;
    worst = `frame ${f} ${name}`;
  }
}
const jsE = jsOut.filter((r) => typeof r === 'string').map((s) => s.trim());
const eventsMatch = jsE.length === luauE.length && jsE.every((e, i) => e === luauE[i]);
console.log(`samples compared: ${count} (${N} frames, every ${EVERY}th, ${R15.joints.length - 1} joints)`);
console.log(`max position error: ${maxP.toExponential(2)} studs`);
console.log(`max rotation error: ${((maxQ * 180) / Math.PI).toExponential(2)} deg (at ${worst})`);
console.log(`events: JS ${jsE.length}, Luau ${luauE.length}, identical order: ${eventsMatch}`);
if (!eventsMatch) {
  for (let i = 0; i < Math.max(jsE.length, luauE.length); i++) {
    if (jsE[i] !== luauE[i]) {
      console.log(`  first mismatch #${i}: JS "${jsE[i]}" vs Luau "${luauE[i]}"`);
      break;
    }
  }
}
const ok = maxP < 1e-4 && maxQ < 1e-4 && eventsMatch;
console.log(ok ? 'PARITY OK' : 'PARITY FAILED');

// Hit geometry sanity checks (Combat/HitQuery against the baked swing paths).
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'aaa-hits-'));
fs.writeFileSync(path.join(tmp2, 'manifest.txt'), manifest.join('\n'));
const hits = execFileSync(runner, [path.join(ROOT, 'test/luau/hitquery.luau'), path.join(ROOT, 'test/luau/mock.luau'), SRC, path.join(tmp2, 'manifest.txt')]).toString();
fs.rmSync(tmp2, { recursive: true, force: true });
const hitsOk = hits.includes('HITQUERY OK');
console.log(hits.split('\n').filter((l) => l.startsWith('FAIL') || l.startsWith('HITQUERY')).join('\n'));
process.exit(ok && hitsOk ? 0 : 1);
