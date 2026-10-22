// Exports the clips as Roblox KeyframeSequences (.rbxmx) for the Animation Editor / standard
// Animator workflow:
//   export/AAAMotionAnimations.rbxmx       one Folder with every sequence (Insert from File)
//   export/KeyframeSequences/<rig>/<Name>.rbxmx
//
// Poses are baked from the evaluated curves with adaptive keyframes (linear easing): a key is
// placed wherever linear interpolation would deviate from the authored motion by more than
// 0.3 deg / 0.004 studs, plus a key at every marker (exported as KeyframeMarkers, so
// AnimationTrack:GetMarkerReachedSignal("HitStart") works). Additive clips are baked onto
// their stance (Hit* onto CombatIdle, LandLight onto Idle) because KeyframeSequences are absolute.
// Root motion (vault, mantle, lunge, attack steps) has no KeyframeSequence equivalent; the
// AAAMotion runtime applies it, or move the HumanoidRootPart yourself.
//   node anim/export-rbxmx.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { sampleClip } from './core/animator.mjs';
import { R15, VM } from './core/rig.mjs';
import { IDENTITY, lerpXform, mulXform } from './core/xform.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.resolve(ROOT, '../export');
const clips = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/clips.json'), 'utf8'));

const RATE = 480;
const TOL_ROT = (0.3 * Math.PI) / 180;
const TOL_POS = 0.004;
const ADDITIVE_BASE = { HitFront: 'CombatIdle', HitBack: 'CombatIdle', HitLeft: 'CombatIdle', HitRight: 'CombatIdle', LandLight: 'Idle', FP_Land: 'FP_Idle' };
// Pose name for the weapon joint: the katana's root part, attached with a Motor6D from RightHand.
const WEAPON_PART = 'Handle';

const PRIORITY = { Idle: 0, Movement: 1, Action: 2, Action2: 3, Action3: 4, Action4: 5, Core: 1000 };
const LOCO = new Set(['Idle', 'Walk', 'Run', 'Sprint', 'CombatIdle', 'CrouchIdle', 'CrouchWalk', 'Rise', 'Fall', 'FP_Idle', 'FP_Sprint']);

function priorityOf(clip) {
  if (clip.name === 'Idle' || clip.name === 'CombatIdle' || clip.name === 'CrouchIdle' || clip.name === 'FP_Idle') return PRIORITY.Idle;
  if (LOCO.has(clip.name)) return PRIORITY.Movement;
  if (ADDITIVE_BASE[clip.name]) return PRIORITY.Action2;
  return PRIORITY.Action;
}

// Angle between unit quaternions (stable near zero).
const angle = (a, b) => {
  const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  const d = Math.hypot(a[0] - s * b[0], a[1] - s * b[1], a[2] - s * b[2], a[3] - s * b[3]);
  const p = Math.hypot(a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2], a[3] + s * b[3]);
  return 4 * Math.atan2(d, p);
};

function poseAt(clip, t, jointNames) {
  const s = sampleClip(clip, t);
  const base = ADDITIVE_BASE[clip.name] ? sampleClip(clips[ADDITIVE_BASE[clip.name]], 0) : null;
  const out = {};
  for (const j of jointNames) {
    if (base) out[j] = s[j] ? mulXform(base[j] ?? IDENTITY, s[j]) : base[j] ?? IDENTITY;
    else out[j] = s[j] ?? IDENTITY;
  }
  return out;
}

// Greedy keyframe reduction over uniformly sampled poses.
function reduceKeys(samples, jointNames) {
  const keys = [0];
  let i = 0;
  const n = samples.length;
  while (i < n - 1) {
    let j = i + 1;
    while (j + 1 < n) {
      const cand = j + 1;
      let ok = true;
      for (let m = i + 1; m < cand && ok; m++) {
        const u = (samples[m].t - samples[i].t) / (samples[cand].t - samples[i].t);
        for (const jn of jointNames) {
          const a = samples[i].pose[jn];
          const b = samples[cand].pose[jn];
          const x = lerpXform(a, b, u);
          const y = samples[m].pose[jn];
          if (angle(x.q, y.q) > TOL_ROT || Math.hypot(x.p[0] - y.p[0], x.p[1] - y.p[1], x.p[2] - y.p[2]) > TOL_POS) {
            ok = false;
            break;
          }
        }
      }
      if (!ok) break;
      j = cand;
    }
    keys.push(j);
    i = j;
  }
  return keys.map((k) => samples[k].t);
}

const num = (x) => {
  const v = Math.abs(x) < 1e-9 ? 0 : x;
  return String(+v.toFixed(6));
};

function matrix(q) {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

let ref = 0;
const nextRef = () => `RBX${(ref++).toString(16).toUpperCase().padStart(8, '0')}`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function cframeXml(xf) {
  const m = matrix(xf.q);
  const names = ['R00', 'R01', 'R02', 'R10', 'R11', 'R12', 'R20', 'R21', 'R22'];
  return `<CoordinateFrame name="CFrame"><X>${num(xf.p[0])}</X><Y>${num(xf.p[1])}</Y><Z>${num(xf.p[2])}</Z>${m.map((v, i) => `<${names[i]}>${num(v)}</${names[i]}>`).join('')}</CoordinateFrame>`;
}

function poseXml(name, xf, weight, children, indent) {
  const pad = '\t'.repeat(indent);
  return `${pad}<Item class="Pose" referent="${nextRef()}"><Properties><string name="Name">${esc(name)}</string>${cframeXml(xf)}<token name="EasingDirection">0</token><token name="EasingStyle">0</token><float name="Weight">${weight}</float></Properties>\n${children}${pad}</Item>\n`;
}

function sequenceXml(clip, rig) {
  const jointNames = rig.joints.map((j) => j.name);
  const L = clip.length;
  // Uniform grid plus every authored key time, so sharp corners land exactly on a sample.
  const grid = new Set();
  const steps = Math.max(1, Math.ceil(L * RATE));
  for (let k = 0; k <= steps; k++) grid.add(+Math.min((k / steps) * L, L).toFixed(6));
  for (const chans of Object.values(clip.tracks)) for (const ch of Object.values(chans)) for (const t of ch.t) if (t >= 0 && t <= L) grid.add(+t.toFixed(6));
  const samples = [...grid]
    .sort((a, b) => a - b)
    // A loop's last key must equal its first so Roblox wraps seamlessly.
    .map((t) => ({ t, pose: poseAt(clip, clip.loop && Math.abs(t - L) < 1e-9 ? 0 : t, jointNames) }));
  const times = new Set(reduceKeys(samples, jointNames).map((t) => +t.toFixed(5)));
  const markers = (clip.markers ?? []).filter((m) => m.t <= L + 1e-6);
  for (const m of markers) times.add(+m.t.toFixed(5));
  const sorted = [...times].sort((a, b) => a - b);

  // Joint tree: parent part -> [{ joint, part1 }]
  const childrenOf = {};
  for (const j of rig.joints) (childrenOf[j.part0] ??= []).push(j);

  let frames = '';
  for (const t of sorted) {
    const pose = poseAt(clip, clip.loop && Math.abs(t - L) < 1e-6 ? 0 : t, jointNames);
    const build = (part, indent) =>
      (childrenOf[part] ?? [])
        .map((j) => {
          const name = j.name === 'Weapon' ? WEAPON_PART : j.part1;
          return poseXml(name, pose[j.name] ?? IDENTITY, 1, build(j.part1, indent + 1), indent);
        })
        .join('');
    const tree = poseXml(rig.root, IDENTITY, 0, build(rig.root, 4), 3);
    const marks = markers
      .filter((m) => Math.abs(+m.t.toFixed(5) - t) < 1e-6)
      .map((m) => {
        const value = m.slash ?? m.foot ?? m.hand ?? m.strength ?? m.to ?? (m.finisher ? 'finisher' : m.launch ? 'launch' : '');
        return `\t\t\t<Item class="KeyframeMarker" referent="${nextRef()}"><Properties><string name="Name">${esc(m.name)}</string><string name="Value">${esc(value)}</string></Properties></Item>\n`;
      })
      .join('');
    frames += `\t\t<Item class="Keyframe" referent="${nextRef()}"><Properties><string name="Name">Keyframe</string><float name="Time">${num(t)}</float></Properties>\n${tree}${marks}\t\t</Item>\n`;
  }
  return {
    xml: `\t<Item class="KeyframeSequence" referent="${nextRef()}"><Properties><string name="Name">${esc(clip.name)}</string><bool name="Loop">${clip.loop ? 'true' : 'false'}</bool><token name="Priority">${priorityOf(clip)}</token></Properties>\n${frames}\t</Item>\n`,
    keys: sorted.length,
  };
}

const HEADER = '<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">\n';
const wrap = (body) => `${HEADER}${body}</roblox>\n`;
const folder = (name, body) => `<Item class="Folder" referent="${nextRef()}"><Properties><string name="Name">${esc(name)}</string></Properties>\n${body}</Item>\n`;

// One Folder with every sequence. Rojo (if installed) converts it to the compact binary .rbxm
// that ships in export/; --split also writes one .rbxmx per clip.
const split = process.argv.includes('--split');
const groups = { ThirdPerson: [], FirstPerson: [] };
let totalKeys = 0;
for (const clip of Object.values(clips).sort((a, b) => a.name.localeCompare(b.name))) {
  const rig = clip.rig === 'VM' ? VM : R15;
  const group = clip.rig === 'VM' ? 'FirstPerson' : 'ThirdPerson';
  const { xml, keys } = sequenceXml(clip, rig);
  totalKeys += keys;
  groups[group].push(xml);
  if (split) {
    const dir = path.join(OUT, 'KeyframeSequences', group);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${clip.name}.rbxmx`), wrap(xml));
  }
}
const all = folder('AAAMotionAnimations', folder('ThirdPerson', groups.ThirdPerson.join('')) + folder('FirstPerson', groups.FirstPerson.join('')));
const xmlPath = path.join(ROOT, 'build/AAAMotionAnimations.rbxmx');
fs.writeFileSync(xmlPath, wrap(all));
fs.mkdirSync(OUT, { recursive: true });
let out = path.join(OUT, 'AAAMotionAnimations.rbxm');
const project = path.join(ROOT, 'build/animations.project.json');
fs.writeFileSync(project, JSON.stringify({ name: 'AAAMotionAnimations', tree: { $path: 'AAAMotionAnimations.rbxmx' } }));
try {
  execFileSync('rojo', ['build', project, '-o', out], { stdio: 'pipe' });
} catch {
  out = path.join(OUT, 'AAAMotionAnimations.rbxmx');
  fs.copyFileSync(xmlPath, out);
}
console.log(`exported ${groups.ThirdPerson.length} third-person + ${groups.FirstPerson.length} first-person sequences, ${totalKeys} keyframes -> ${path.relative(process.cwd(), out)} (${(fs.statSync(out).size / 1e6).toFixed(2)} MB)`);
