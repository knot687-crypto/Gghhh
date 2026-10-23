// Ground locomotion: idle, walk, run, sprint, crouch. Katana sheathed at the left hip.
import { clip, pose } from '../core/dsl.mjs';
import { holdScabbard, plantFoot } from '../core/kinematics.mjs';
import { R15 } from '../core/rig.mjs';
import { gait } from '../gait.mjs';
import { perform } from '../perform.mjs';

const G = R15.ground;
const SHEATHED = { weapon: 'sheath' };

// ---------------------------------------------------------------- Idle
// Relaxed contrapposto, left hand resting on the scabbard, slow breathing and weight drift.
function idleBase({ drop = 0.1, shift = 0.06, breath = 0 } = {}) {
  let p = pose({
    Root: { p: [shift, -drop - breath * 0.012, 0], r: [-1.5, 9, -1.2 + shift * 8] },
    Waist: { r: [-1 + breath * 1.6, -7, 1.5 - shift * 6] },
    Neck: { r: [0.5 - breath * 0.8, -3, -0.8] },
    RightShoulder: { r: [4, -4, 5 + breath * 1.2] },
    RightElbow: { r: [14, 0, 0] },
    RightWrist: { r: [6, 0, -4] },
    LeftShoulder: { r: [0, 0, -4] },
    LeftElbow: { r: [30, 0, 0] },
    LeftWrist: { r: [0, 0, 0] },
  });
  p = plantFoot(p, 'Left', [-0.62, G, -0.22], { yaw: 10 });
  p = plantFoot(p, 'Right', [0.62, G, 0.24], { yaw: -16 });
  p = holdScabbard(p, { along: 0.78 });
  return p;
}

export const Idle = clip('Idle', { length: 3.6, loop: true, ...SHEATHED }, (c) => {
  c.key(0, idleBase({ breath: 0 }));
  c.key(1.5, idleBase({ breath: 1, shift: 0.075 }), { lag: { Neck: 0.12, RightShoulder: 0.1 } });
  c.key(2.5, idleBase({ breath: 0.35, shift: 0.07 }));
});

// ---------------------------------------------------------------- Walk
export const Walk = gait('Walk', {
  T: 0.84,
  speed: 6,
  duty: 0.6,
  footX: 0.46,
  contactBias: 0.56,
  bob: 0.035,
  bobMid: -0.05,
  sway: 0.035,
  pelvisYaw: 5,
  pelvisRoll: 2.5,
  lean: 2,
  leanPulse: 0.6,
  spineLean: 0.5,
  shoulderYaw: 4,
  contactPitch: 14,
  toeOffPitch: -24,
  swingAbduct: 1.5,
  swing: [
    { s: 0.25, hip: -2, knee: -52, ankle: 4 },
    { s: 0.55, hip: 24, knee: -48, ankle: 8 },
    { s: 0.82, hip: 30, knee: -12, ankle: 10 },
  ],
  arms: { bias: 2, swing: 17, elbow: 18, elbowSwing: 8, out: 7, inward: 4, lag: 0.05, wrist: 4 },
  meta: SHEATHED,
});

// ---------------------------------------------------------------- Run (jog at default WalkSpeed 16)
export const Run = gait('Run', {
  T: 0.5,
  speed: 16,
  duty: 0.38,
  footX: 0.38,
  contactBias: 0.5,
  bob: 0.085,
  bobMid: -0.13,
  sway: 0.03,
  pelvisYaw: 9,
  pelvisRoll: 3.5,
  lean: 9,
  leanPulse: 1.5,
  spineLean: 3,
  shoulderYaw: 9,
  contactPitch: 4,
  toeOffPitch: -34,
  swingAbduct: 3,
  swing: [
    { s: 0.2, hip: -16, knee: -96, ankle: -18 },
    { s: 0.5, hip: 46, knee: -112, ankle: 4 },
    { s: 0.8, hip: 54, knee: -48, ankle: 10 },
  ],
  arms: { bias: -2, swing: 38, elbow: 82, elbowSwing: 12, out: 10, inward: 9, lag: 0.04, wrist: 10 },
  meta: SHEATHED,
});

// ---------------------------------------------------------------- Sprint (WalkSpeed 26)
export const Sprint = gait('Sprint', {
  T: 0.42,
  speed: 26,
  duty: 0.3,
  footX: 0.34,
  contactBias: 0.42,
  bob: 0.1,
  bobMid: -0.16,
  sway: 0.025,
  pelvisYaw: 11,
  pelvisRoll: 3,
  lean: 17,
  leanPulse: 2.5,
  spineLean: 5,
  shoulderYaw: 12,
  headStab: 0.75,
  contactPitch: -8,
  toeOffPitch: -42,
  swingAbduct: 3,
  swing: [
    { s: 0.18, hip: -18, knee: -128, ankle: -24 },
    { s: 0.48, hip: 66, knee: -122, ankle: 2 },
    { s: 0.8, hip: 70, knee: -52, ankle: 4 },
  ],
  arms: { bias: -6, swing: 54, elbow: 94, elbowSwing: 16, out: 9, inward: 12, lag: 0.035, wrist: 14 },
  meta: SHEATHED,
});

// ---------------------------------------------------------------- Crouch
function crouchBase({ breath = 0 } = {}) {
  let p = pose({
    Root: { p: [0.04, -0.88 - breath * 0.015, 0], r: [-14, 8, 0] },
    Waist: { r: [-8 + breath * 1.2, -6, 0] },
    Neck: { r: [20 - breath, -2, 0] },
    RightShoulder: { r: [26, -4, 10] },
    RightElbow: { r: [40, 0, 0] },
    RightWrist: { r: [10, 0, 0] },
    LeftShoulder: { r: [0, 0, -4] },
    LeftElbow: { r: [30, 0, 0] },
  });
  p = plantFoot(p, 'Left', [-0.66, G, -0.42], { yaw: 12 });
  p = plantFoot(p, 'Right', [0.66, G, 0.36], { yaw: -18, pitch: -14 });
  return holdScabbard(p, { along: 0.78 });
}

export const CrouchIdle = clip('CrouchIdle', { length: 2.6, loop: true, ...SHEATHED }, (c) => {
  c.key(0, crouchBase({ breath: 0 }));
  c.key(1.3, crouchBase({ breath: 1 }), { lag: { Neck: 0.15 } });
});

export const CrouchWalk = gait('CrouchWalk', {
  T: 0.74,
  speed: 8,
  duty: 0.62,
  footX: 0.58,
  contactBias: 0.52,
  bob: 0.03,
  bobMid: -0.86,
  sway: 0.05,
  pelvisYaw: 6,
  pelvisRoll: 2,
  lean: 15,
  leanPulse: 1,
  spineLean: 6,
  shoulderYaw: 5,
  contactPitch: 6,
  toeOffPitch: -22,
  swingAbduct: 2,
  swing: [
    { s: 0.25, hip: 30, knee: -118, ankle: 4 },
    { s: 0.55, hip: 62, knee: -128, ankle: 6 },
    { s: 0.82, hip: 66, knee: -96, ankle: 8 },
  ],
  arms: { bias: 18, swing: 14, elbow: 40, elbowSwing: 8, out: 10, inward: 4, lag: 0.05, wrist: 8 },
  extra: (phi, p) => holdScabbard(p, { along: 0.78 }),
  meta: SHEATHED,
});

// ---------------------------------------------------------------- Run stops
// Stopping from a run (authored at 20 studs/s; runtimes scale the root motion to the entry
// speed). The next foot to land brakes far ahead with the toe up and the body counter-leans
// back over it, momentum tips the torso forward again as the other foot catches, then the
// braking foot steps in and the body settles into Idle. `side` = the braking foot.
function runStop(side) {
  const s = side === 'Right' ? 1 : -1;
  const brakeKey = side === 'Right' ? 'R' : 'L';
  const catchKey = side === 'Right' ? 'L' : 'R';
  // Idle's feet relative to the root, and the stop's travel.
  const idleL = [-0.62, -0.22, 10, 0, 0];
  const idleR = [0.62, 0.24, -16, 0, 0];
  const D = -2.82;
  const at = (f) => [f[0], f[1] + D, f[2], f[3], f[4]];
  const fin = { L: at(idleL), R: at(idleR) };
  const brakeX = 0.6 * s;
  const catchX = -0.55 * s;
  const yaw = (y) => y * s;
  const swingR = (k) => ({ RightShoulder: { r: [k, -4, 6] }, RightElbow: { r: [30 + Math.abs(k) * 0.6, 0, 0] }, RightWrist: { r: [6, 0, -4] } });
  return clip(`RunStop${side}`, { length: 0.62, ...SHEATHED, reduce: true, stopFrom: 20 }, (c) => {
    perform(c, {
      path: [
        [0, 0, 0, 0],
        [0.06, 0, 0, -1.15],
        [0.12, 0, 0, -1.95],
        [0.2, 0, 0, -2.5],
        [0.3, 0, 0, -2.78],
        [0.62, 0, 0, D],
      ],
      beats: [
        { t: 0, body: { rp: [0, -0.25, 0], rr: [-10, 0, 0], wr: [-4, 0, 0], nr: [6, 0, 0] }, right: swingR(-40), scabbard: { along: 0.78 } },
        {
          t: 0.08,
          body: { rp: [0, -0.5, 0.15], rr: [10, yaw(-6), 0], wr: [8, yaw(4), 0], nr: [-6, yaw(2), 0] },
          right: swingR(45),
          scabbard: { along: 0.78 },
          lead: { nr: 0.02 },
        },
        { t: 0.2, body: { rp: [0, -0.55, 0.05], rr: [6, yaw(-4), 0], wr: [-6, yaw(2), 0], nr: [4, 0, 0] }, right: swingR(30), scabbard: { along: 0.78 } },
        { t: 0.36, body: { rp: [0, -0.3, 0], rr: [-2, 2, 0], wr: [-3, -2, 0], nr: [2, 0, 0] }, right: swingR(10), scabbard: { along: 0.78 } },
        { t: 0.5, body: { rp: [0.04, -0.08, 0], rr: [-1, 7, -0.4], wr: [-0.6, -6, 1], nr: [0.4, -2, -0.6] }, right: swingR(2), scabbard: { along: 0.78 } },
        {
          t: 0.62,
          body: { rp: [0.06, -0.1, 0], rr: [-1.5, 9, -0.72], wr: [-1, -7, 1.14], nr: [0.5, -3, -0.8] },
          right: { RightShoulder: { r: [4, -4, 5] }, RightElbow: { r: [14, 0, 0] }, RightWrist: { r: [6, 0, -4] } },
          scabbard: { along: 0.78 },
        },
      ],
      feet: {
        [brakeKey]: [
          [0, [brakeX * 0.9, -0.5, yaw(-8), -30, 0.5]],
          [0.07, [brakeX, -2.0, yaw(-10), 18, 0], { air: true }],
          [0.12, [brakeX, -2.0, yaw(-10), 0, 0]],
          [0.32, [brakeX, -2.0, yaw(-10), 0, 0]],
          [0.46, fin[brakeKey], { h: 0.14 }],
        ],
        [catchKey]: [
          // Already pushing off behind: it swings through and catches the weight.
          [0, [catchX, 0.25, yaw(8), -32, 0.22]],
          [0.22, fin[catchKey], { air: true }],
        ],
      },
    });
    c.marker(0.07, 'DashBrake', { dir: 'Forward' });
    c.marker(0.22, 'Footstep', { foot: catchKey === 'L' ? 'Left' : 'Right', speed: 20 });
    c.marker(0.46, 'Footstep', { foot: side, speed: 10 });
  });
}
export const RunStopRight = runStop('Right');
export const RunStopLeft = runStop('Left');

export default [Idle, Walk, Run, Sprint, CrouchIdle, CrouchWalk, RunStopRight, RunStopLeft];
