// Movement abilities: slide, dashes, air dash, wall run, wall jump, vault, mantle.
import { compileChannel, evalChannel } from '../core/curve.mjs';
import { clip, mirrorClip, pose } from '../core/dsl.mjs';
import { eulerQuat, holdScabbard, plantFoot, reach } from '../core/kinematics.mjs';
import { R15 } from '../core/rig.mjs';
import { gait } from '../gait.mjs';
import { FALL, RISE } from './air.mjs';

const G = R15.ground;
const SHEATHED = { weapon: 'sheath' };

// Interpolates a root-motion path exactly like the runtime will ([t, x, y, z] keys).
function pathFn(keys, length) {
  const ch = [1, 2, 3].map((i) => compileChannel(keys.map((k) => ({ t: k[0], v: k[i], e: 0 })), length, false));
  return (t) => ch.map((c) => evalChannel(c, t));
}
function keyPath(c, keys) {
  for (const [t, x, y, z] of keys) c.key(t, pose({ RootMotion: { p: [x, y, z] } }));
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// ---------------------------------------------------------------- Slide
function slidePose(v = 0) {
  let p = pose({
    Root: { p: [0.05, -1.36 + v * 0.02, 0.1], r: [24 + v, -12, -4] },
    Waist: { r: [8, 10, 3] },
    Neck: { r: [-26, 4, 2] },
    RightShoulder: { r: [28 + v * 3, 0, 58] },
    RightElbow: { r: [34, 0, 0] },
    RightWrist: { r: [10, 0, 0] },
  });
  p = plantFoot(p, 'Left', [-0.42, G + 0.22, -2.15], { pitch: 62, yaw: 12, roll: -8 });
  p = plantFoot(p, 'Right', [0.62, G + 0.16, -0.32], { pitch: 20, yaw: -60, roll: -70 });
  p = reach(p, 'Left', [-1.45, G + 0.1 + v * 0.02, 0.55], {});
  return p;
}

export const SlideEnter = clip('SlideEnter', { length: 0.24, ...SHEATHED }, (c) => {
  c.key(
    0,
    pose({
      Root: { p: [0, -0.2, 0], r: [-12, 0, 0] },
      Waist: { r: [-3, 0, 0] },
      Neck: { r: [10, 0, 0] },
      LeftHip: { r: [40, 0, -4] },
      LeftKnee: { r: [-60, 0, 0] },
      RightHip: { r: [-20, 0, 4] },
      RightKnee: { r: [-70, 0, 0] },
      RightShoulder: { r: [40, 0, 14] },
      RightElbow: { r: [80, 0, 0] },
      LeftShoulder: { r: [-30, 0, -12] },
      LeftElbow: { r: [70, 0, 0] },
    }),
  );
  c.key(0.24, slidePose(), { ease: 'outCubic', lag: { RightShoulder: 0.03, Neck: 0.04 } });
  c.marker(0, 'SlideStart');
});

export const Slide = clip('Slide', { length: 0.8, loop: true, ...SHEATHED }, (c) => {
  c.key(0, slidePose(0));
  c.key(0.4, slidePose(1), { lag: { RightShoulder: 0.08 } });
});

// ---------------------------------------------------------------- Dashes
const DASH_LEN = 0.44;

function dashStance(lean = 0, roll = 0) {
  let p = pose({
    Root: { p: [0, -0.42, 0], r: [lean, 0, roll] },
    Waist: { r: [-4, 0, 0] },
    Neck: { r: [-lean * 0.6, 0, -roll * 0.5] },
    RightShoulder: { r: [26, 0, 22] },
    RightElbow: { r: [60, 0, 0] },
    LeftShoulder: { r: [16, 0, -24] },
    LeftElbow: { r: [62, 0, 0] },
  });
  p = plantFoot(p, 'Left', [-0.66, G, -0.45], { yaw: 12 });
  p = plantFoot(p, 'Right', [0.66, G, 0.55], { yaw: -20, pitch: -12 });
  return p;
}

export const DashForward = clip('DashForward', { length: DASH_LEN, ...SHEATHED, dash: 'Forward' }, (c) => {
  // Explosive low burst with arms swept back, glide, then a skidding brake.
  const glide = (k) =>
    pose({
      Root: { p: [0, -0.62 - k * 0.04, 0], r: [-44 - k * 3, 0, 0] },
      Waist: { r: [-6, 0, 0] },
      Neck: { r: [38 + k * 2, 0, 0] },
      LeftHip: { r: [72, 0, -6] },
      LeftKnee: { r: [-96, 0, 0] },
      LeftAnkle: { r: [-10, 0, 0] },
      RightHip: { r: [-34, 0, 8] },
      RightKnee: { r: [-30, 0, 0] },
      RightAnkle: { r: [-40, 0, 0] },
      RightShoulder: { r: [-72 - k * 4, 0, 20] },
      RightElbow: { r: [8, 0, 0] },
      RightWrist: { r: [-20, 0, 0] },
      LeftShoulder: { r: [-70 - k * 4, 0, -20] },
      LeftElbow: { r: [8, 0, 0] },
      LeftWrist: { r: [-20, 0, 0] },
    });
  c.key(0, dashStance(-18).add({ Root: { p: [0, -0.2, 0] } }));
  c.key(0.05, glide(0), { ease: 'outQuart' });
  c.key(0.25, glide(1), { lag: { RightShoulder: 0.02, LeftShoulder: 0.03 } });
  let brake = pose({
    Root: { p: [0, -0.72, 0.1], r: [6, 8, 0] },
    Waist: { r: [-10, -6, 0] },
    Neck: { r: [6, -2, 0] },
    RightShoulder: { r: [44, 0, 30] },
    RightElbow: { r: [40, 0, 0] },
    LeftShoulder: { r: [30, 0, -40] },
    LeftElbow: { r: [36, 0, 0] },
  });
  brake = plantFoot(brake, 'Left', [-0.6, G, -1.3], { pitch: 18, yaw: 8 });
  brake = plantFoot(brake, 'Right', [0.62, G, 0.6], { pitch: -30, yaw: -14 });
  c.key(0.33, brake, { ease: 'outCubic', lag: { RightShoulder: 0.03, LeftShoulder: 0.04, Neck: 0.03 } });
  c.key(DASH_LEN, dashStance(-6));
  c.marker(0, 'DashStart', { dir: 'Forward' });
  c.marker(0.3, 'DashBrake', { dir: 'Forward' });
});

export const DashBack = clip('DashBack', { length: DASH_LEN, ...SHEATHED, dash: 'Back' }, (c) => {
  // Evasive backstep: chest pulls away first, legs follow, low landing.
  const hop = pose({
    Root: { p: [0, -0.1, 0.1], r: [20, 0, 0] },
    Waist: { r: [10, 0, 0] },
    Neck: { r: [-18, 0, 0] },
    LeftHip: { r: [46, 0, -6] },
    LeftKnee: { r: [-70, 0, 0] },
    LeftAnkle: { r: [-20, 0, 0] },
    RightHip: { r: [20, 0, 6] },
    RightKnee: { r: [-90, 0, 0] },
    RightAnkle: { r: [-26, 0, 0] },
    RightShoulder: { r: [70, 0, 18] },
    RightElbow: { r: [40, 0, 0] },
    LeftShoulder: { r: [62, 0, -20] },
    LeftElbow: { r: [44, 0, 0] },
  });
  c.key(0, dashStance(-8).add({ Root: { p: [0, -0.18, 0] } }));
  c.key(0.07, hop, { ease: 'outQuart', lag: { RightShoulder: 0.02, LeftShoulder: 0.02 } });
  c.key(0.22, hop.add({ Root: { r: [6, 0, 0] }, LeftHip: { r: [-10, 0, 0] }, RightHip: { r: [-14, 0, 0] } }));
  let land = pose({
    Root: { p: [0, -0.86, 0], r: [-12, -6, 0] },
    Waist: { r: [-6, 4, 0] },
    Neck: { r: [16, 0, 0] },
    RightShoulder: { r: [40, 0, 34] },
    RightElbow: { r: [50, 0, 0] },
    LeftShoulder: { r: [50, 0, -30] },
    LeftElbow: { r: [40, 0, 0] },
  });
  land = plantFoot(land, 'Left', [-0.7, G, -0.6], { yaw: 18 });
  land = plantFoot(land, 'Right', [0.62, G, 0.75], { pitch: -36, yaw: -16 });
  c.key(0.31, land, { ease: 'outCubic' });
  c.key(DASH_LEN, dashStance(-4));
  c.marker(0, 'DashStart', { dir: 'Back' });
  c.marker(0.3, 'DashBrake', { dir: 'Back' });
});

export const DashLeft = clip('DashLeft', { length: DASH_LEN, ...SHEATHED, dash: 'Left' }, (c) => {
  // Lateral burst: lean hard into the direction, legs scissor, skid with the outside foot.
  c.key(0, dashStance(-6, -6).add({ Root: { p: [0, -0.15, 0] } }));
  const air = pose({
    Root: { p: [-0.1, -0.5, 0], r: [-12, 18, 30] },
    Waist: { r: [-4, -10, -8] },
    Neck: { r: [10, -12, -16] },
    LeftHip: { r: [30, 0, -40] },
    LeftKnee: { r: [-60, 0, 0] },
    LeftAnkle: { r: [0, 0, 10] },
    RightHip: { r: [-6, 0, -6] },
    RightKnee: { r: [-40, 0, 0] },
    RightAnkle: { r: [-30, 0, 0] },
    RightShoulder: { r: [50, 0, -20] },
    RightElbow: { r: [70, 0, 0] },
    LeftShoulder: { r: [10, 0, -76] },
    LeftElbow: { r: [24, 0, 0] },
  });
  c.key(0.06, air, { ease: 'outQuart', lag: { LeftShoulder: 0.02, RightShoulder: 0.03 } });
  c.key(0.22, air.add({ Root: { r: [0, 2, 4] }, LeftShoulder: { r: [0, 0, -6] } }));
  let skid = pose({
    Root: { p: [-0.25, -0.78, 0], r: [-10, 22, 18] },
    Waist: { r: [-6, -14, -10] },
    Neck: { r: [10, -10, -8] },
    RightShoulder: { r: [56, 0, 10] },
    RightElbow: { r: [60, 0, 0] },
    LeftShoulder: { r: [24, 0, -58] },
    LeftElbow: { r: [30, 0, 0] },
  });
  skid = plantFoot(skid, 'Left', [-1.45, G, -0.2], { yaw: 40, roll: 14 });
  skid = plantFoot(skid, 'Right', [0.4, G, 0.4], { yaw: 10, pitch: -26 });
  c.key(0.32, skid, { ease: 'outCubic', lag: { LeftShoulder: 0.04, Neck: 0.03 } });
  c.key(DASH_LEN, dashStance(-4, -2));
  c.marker(0, 'DashStart', { dir: 'Left' });
  c.marker(0.3, 'DashBrake', { dir: 'Left' });
});

export const DashRight = mirrorClip(DashLeft, 'DashRight', { dash: 'Right' });
for (const m of DashRight.markers) if (m.dir === 'Left') m.dir = 'Right';

export const AirDash = clip('AirDash', { length: 0.42, ...SHEATHED, dash: 'Air' }, (c) => {
  const streak = (k) =>
    pose({
      Root: { p: [0, 0.2, 0], r: [-58 - k * 4, 0, 0] },
      Waist: { r: [-4, 0, 0] },
      Neck: { r: [46, 0, 0] },
      LeftHip: { r: [10, 0, -3] },
      LeftKnee: { r: [-60, 0, 0] },
      LeftAnkle: { r: [-40, 0, 0] },
      RightHip: { r: [-14, 0, 3] },
      RightKnee: { r: [-26, 0, 0] },
      RightAnkle: { r: [-40, 0, 0] },
      RightShoulder: { r: [-78 - k * 4, 0, 14] },
      RightElbow: { r: [6, 0, 0] },
      LeftShoulder: { r: [-76 - k * 4, 0, -14] },
      LeftElbow: { r: [6, 0, 0] },
    });
  c.key(0, RISE);
  c.key(0.05, streak(0), { ease: 'outQuart', lag: { RightShoulder: 0.02, LeftShoulder: 0.02 } });
  c.key(0.26, streak(1));
  c.key(0.42, FALL, { lag: { RightShoulder: 0.04, LeftShoulder: 0.05 } });
  c.marker(0, 'DashStart', { dir: 'Air' });
});

// ---------------------------------------------------------------- Wall run
export const WallRunLeft = gait('WallRunLeft', {
  T: 0.48,
  speed: 22,
  duty: 0.36,
  footX: 0.2,
  contactBias: 0.48,
  bob: 0.05,
  bobMid: -0.1,
  sway: 0.0,
  pelvisYaw: 8,
  pelvisRoll: 0,
  lean: 10,
  leanPulse: 1.5,
  spineLean: 3,
  shoulderYaw: 8,
  contactPitch: 0,
  toeOffPitch: -30,
  groundTilt: -60,
  groundShift: -0.42,
  bodyRoll: -34,
  headRoll: 0.4,
  swing: [
    { s: 0.2, hip: -14, knee: -100, ankle: -18 },
    { s: 0.5, hip: 50, knee: -110, ankle: 4 },
    { s: 0.8, hip: 56, knee: -50, ankle: 10 },
  ],
  arms: { bias: 2, swing: 36, elbow: 70, elbowSwing: 10, out: 14, inward: 6, lag: 0.04, wrist: 8 },
  extra: (phi, p) =>
    p.add({
      // Outside (right) arm flares up for balance, wall-side arm reaches toward the wall.
      RightShoulder: { r: [0, 0, 34] },
      RightElbow: { r: [-16, 0, 0] },
      LeftShoulder: { r: [0, 0, -18] },
    }),
  meta: { ...SHEATHED, wall: 'Left' },
});
export const WallRunRight = mirrorClip(WallRunLeft, 'WallRunRight', { wall: 'Right' });

// Kick off a wall on the left: push with the wall-side leg, twist away, open into a rise.
export const WallJumpLeft = clip('WallJumpLeft', { length: 0.46, ...SHEATHED, wall: 'Left' }, (c) => {
  const push = pose({
    Root: { p: [0, -0.15, 0], r: [-8, -18, -30] },
    Waist: { r: [-6, -10, 8] },
    Neck: { r: [6, 12, 18] },
    LeftHip: { r: [26, 0, -52] },
    LeftKnee: { r: [-84, 0, 0] },
    LeftAnkle: { r: [10, 0, -30] },
    RightHip: { r: [-8, 0, 8] },
    RightKnee: { r: [-40, 0, 0] },
    RightAnkle: { r: [-20, 0, 0] },
    RightShoulder: { r: [20, 0, 60] },
    RightElbow: { r: [40, 0, 0] },
    LeftShoulder: { r: [40, 0, -20] },
    LeftElbow: { r: [70, 0, 0] },
  });
  const extend = pose({
    Root: { p: [0, 0.08, 0], r: [-4, -26, 8] },
    Waist: { r: [2, -10, 4] },
    Neck: { r: [2, 16, -6] },
    LeftHip: { r: [-12, 0, -30] },
    LeftKnee: { r: [-10, 0, 0] },
    LeftAnkle: { r: [-30, 0, -10] },
    RightHip: { r: [50, 0, 10] },
    RightKnee: { r: [-92, 0, 0] },
    RightAnkle: { r: [-20, 0, 0] },
    RightShoulder: { r: [120, 0, 50] },
    RightElbow: { r: [20, 0, 0] },
    LeftShoulder: { r: [70, 0, -60] },
    LeftElbow: { r: [24, 0, 0] },
  });
  c.key(0, push);
  c.key(0.1, extend, { ease: 'outQuart', lag: { RightShoulder: 0.02, LeftShoulder: 0.03 } });
  c.key(0.46, RISE, { lag: { RightShoulder: 0.05, LeftShoulder: 0.05, Neck: 0.04 } });
  c.marker(0, 'WallKick', { wall: 'Left' });
});
export const WallJumpRight = mirrorClip(WallJumpLeft, 'WallJumpRight', { wall: 'Right' });

// ---------------------------------------------------------------- Vault (speed vault, left hand)
const VAULT_LEN = 0.58;
const VAULT_PATH = [
  [0, 0, 0, 0],
  [0.1, 0, 0.75, -1.6],
  [0.2, 0, 1.38, -3.15],
  [0.3, 0, 1.3, -4.6],
  [0.42, 0, 0.1, -6.1],
  [0.5, 0, -0.08, -7.0],
  [VAULT_LEN, 0, 0, -7.8],
];
// Rail (in start-relative space): top surface at y = 2.7 - 2.83, centred at z = -3.1.
const RAIL = { y: 2.7 - 2.83, z: -3.1 };

export const Vault = clip(
  'Vault',
  { length: VAULT_LEN, ...SHEATHED, obstacle: { height: 2.7, depth: 1.6, distance: 3.1 } },
  (c) => {
    const P = pathFn(VAULT_PATH, VAULT_LEN);
    keyPath(c, VAULT_PATH);
    const at = (t, body, hand = true) => {
      let p = body;
      if (hand) {
        const local = sub([-0.25, RAIL.y + 0.05, RAIL.z + 0.1], P(t));
        p = reach(p, 'Left', local, { rot: eulerQuat([0, 0, 0]), wRot: 0.15 });
      }
      return p;
    };
    let approach = pose({
      Root: { p: [0, -0.3, 0], r: [-16, 0, 0] },
      Waist: { r: [-6, 0, 0] },
      Neck: { r: [12, 0, 0] },
      RightShoulder: { r: [40, 0, 20] },
      RightElbow: { r: [70, 0, 0] },
      LeftShoulder: { r: [60, 0, -10] },
      LeftElbow: { r: [30, 0, 0] },
    });
    approach = plantFoot(approach, 'Left', [-0.4, G, -0.6], { pitch: -10 });
    approach = plantFoot(approach, 'Right', [0.4, G, 0.7], { pitch: -40 });
    c.key(0, approach);
    const tucked = (k) =>
      pose({
        Root: { p: [0.1, 0.05, 0], r: [-12, -10, 30 + k * 6] },
        Waist: { r: [-4, 6, -8] },
        Neck: { r: [10, 8, -24] },
        LeftHip: { r: [78, -10, 52] },
        LeftKnee: { r: [-70, 0, 0] },
        LeftAnkle: { r: [-20, 0, 0] },
        RightHip: { r: [84, -10, 58] },
        RightKnee: { r: [-58, 0, 0] },
        RightAnkle: { r: [-20, 0, 0] },
        RightShoulder: { r: [30, 0, 82] },
        RightElbow: { r: [26, 0, 0] },
      });
    c.key(0.1, at(0.1, tucked(0)), { ease: 'outCubic' });
    c.key(0.2, at(0.2, tucked(1)));
    c.key(0.28, at(0.28, tucked(0.8)));
    c.key(0.34, tucked(0.2).add({ LeftHip: { r: [-34, 0, -44] }, RightHip: { r: [-30, 0, -44] }, Root: { r: [0, 0, -16] } }), {
      lag: { LeftShoulder: 0.03 },
    });
    let land = pose({
      Root: { p: [0, -0.45, 0], r: [-14, 4, 0] },
      Waist: { r: [-6, -2, 0] },
      Neck: { r: [12, 0, 0] },
      RightShoulder: { r: [30, 0, 30] },
      RightElbow: { r: [60, 0, 0] },
      LeftShoulder: { r: [24, 0, -30] },
      LeftElbow: { r: [50, 0, 0] },
    });
    land = plantFoot(land, 'Right', [0.45, G, -0.5], { pitch: 6 });
    land = plantFoot(land, 'Left', [-0.45, G, 0.6], { pitch: -36 });
    c.key(0.43, land, { lag: { LeftShoulder: 0.03, RightShoulder: 0.04 } });
    c.key(VAULT_LEN, land.add({ Root: { p: [0, 0.2, 0] } }));
    c.marker(0.1, 'HandPlant', { hand: 'Left' });
    c.marker(0.42, 'Land', { strength: 'light' });
  },
);

// ---------------------------------------------------------------- Mantle (6.5 stud ledge)
const MANTLE_LEN = 0.92;
const MANTLE_PATH = [
  [0, 0, 0, 0],
  [0.14, 0, 2.5, 0],
  [0.3, 0, 3.55, -0.05],
  [0.48, 0, 5.4, -0.45],
  [0.64, 0, 6.6, -1.5],
  [0.8, 0, 6.5, -2.45],
  [MANTLE_LEN, 0, 6.5, -2.7],
];
const LEDGE = { y: 6.5 - 2.83, z: -1.05 };

export const Mantle = clip('Mantle', { length: MANTLE_LEN, ...SHEATHED, obstacle: { height: 6.5, distance: 1.05 } }, (c) => {
  const P = pathFn(MANTLE_PATH, MANTLE_LEN);
  keyPath(c, MANTLE_PATH);
  const hands = (p, t, spread = 0.75) => {
    const L = sub([-spread, LEDGE.y + 0.02, LEDGE.z - 0.25], P(t));
    const Rr = sub([spread, LEDGE.y + 0.02, LEDGE.z - 0.25], P(t));
    p = reach(p, 'Left', L, { rot: eulerQuat([0, 0, 0]), wRot: 0.1 });
    p = reach(p, 'Right', Rr, { rot: eulerQuat([0, 0, 0]), wRot: 0.1 });
    return p;
  };
  const wallFoot = (p, side, t, h) => plantFoot(p, side, sub([side === 'Left' ? -0.5 : 0.5, h - 2.83, LEDGE.z + 0.15], P(t)), { pitch: 70 });
  let jump = pose({
    Root: { p: [0, -0.35, 0], r: [-10, 0, 0] },
    Waist: { r: [2, 0, 0] },
    Neck: { r: [-20, 0, 0] },
    RightShoulder: { r: [60, 0, 16] },
    RightElbow: { r: [40, 0, 0] },
    LeftShoulder: { r: [60, 0, -16] },
    LeftElbow: { r: [40, 0, 0] },
  });
  jump = plantFoot(jump, 'Left', [-0.45, G, -0.2], { pitch: -10 });
  jump = plantFoot(jump, 'Right', [0.45, G, 0.35], { pitch: -30 });
  c.key(0, jump);
  const reachUp = pose({
    Root: { p: [0, 0, 0], r: [4, 0, 0] },
    Waist: { r: [6, 0, 0] },
    Neck: { r: [-24, 0, 0] },
    RightShoulder: { r: [170, 0, 10] },
    RightElbow: { r: [10, 0, 0] },
    LeftShoulder: { r: [170, 0, -10] },
    LeftElbow: { r: [10, 0, 0] },
    LeftHip: { r: [30, 0, -4] },
    LeftKnee: { r: [-50, 0, 0] },
    LeftAnkle: { r: [-30, 0, 0] },
    RightHip: { r: [6, 0, 4] },
    RightKnee: { r: [-30, 0, 0] },
    RightAnkle: { r: [-30, 0, 0] },
  });
  c.key(0.14, hands(reachUp, 0.14), { ease: 'outCubic' });
  let hang = pose({
    Root: { p: [0, 0, 0], r: [-6, 0, 0] },
    Waist: { r: [-4, 0, 0] },
    Neck: { r: [-10, 0, 0] },
  });
  hang = wallFoot(hands(hang, 0.3), 'Right', 0.3, 2.4);
  hang = hang.with({ LeftHip: { r: [20, 0, -6] }, LeftKnee: { r: [-60, 0, 0] }, LeftAnkle: { r: [-30, 0, 0] } });
  c.key(0.3, hang);
  let pull = pose({
    Root: { p: [0, -0.1, 0], r: [-28, 0, 0] },
    Waist: { r: [-16, 0, 0] },
    Neck: { r: [10, 0, 0] },
  });
  pull = hands(pull, 0.48, 0.7);
  pull = plantFoot(pull, 'Right', sub([0.45, LEDGE.y + 0.03, LEDGE.z - 0.55], P(0.48)), { pitch: -20 });
  pull = pull.with({ LeftHip: { r: [-10, 0, -6] }, LeftKnee: { r: [-70, 0, 0] }, LeftAnkle: { r: [-30, 0, 0] } });
  c.key(0.48, pull, { lag: { Neck: 0.04 } });
  let stepUp = pose({
    Root: { p: [0, -0.4, 0], r: [-24, 0, 0] },
    Waist: { r: [-8, 0, 0] },
    Neck: { r: [16, 0, 0] },
    RightShoulder: { r: [20, 0, 24] },
    RightElbow: { r: [60, 0, 0] },
    LeftShoulder: { r: [-10, 0, -28] },
    LeftElbow: { r: [40, 0, 0] },
  });
  stepUp = plantFoot(stepUp, 'Right', sub([0.45, LEDGE.y, LEDGE.z - 1.1], P(0.64)), { pitch: 0 });
  stepUp = plantFoot(stepUp, 'Left', sub([-0.45, LEDGE.y + 0.1, LEDGE.z - 0.2], P(0.64)), { pitch: -40 });
  c.key(0.64, stepUp, { ease: 'inOutSine' });
  let stand = pose({
    Root: { p: [0, -0.15, 0], r: [-6, 0, 0] },
    Waist: { r: [-2, 0, 0] },
    Neck: { r: [4, 0, 0] },
    RightShoulder: { r: [6, 0, 8] },
    RightElbow: { r: [20, 0, 0] },
    LeftShoulder: { r: [0, 0, -6] },
    LeftElbow: { r: [30, 0, 0] },
  });
  stand = plantFoot(stand, 'Right', sub([0.5, LEDGE.y, LEDGE.z - 1.1], P(0.8)));
  stand = plantFoot(stand, 'Left', sub([-0.5, LEDGE.y, LEDGE.z - 1.6], P(0.8)));
  c.key(0.8, stand);
  c.key(MANTLE_LEN, holdScabbard(stand, { along: 0.78, roll: -20 }));
  c.marker(0.14, 'HandPlant', { hand: 'Both' });
  c.marker(0.64, 'Land', { strength: 'light' });
});

export default [
  SlideEnter,
  Slide,
  DashForward,
  DashBack,
  DashLeft,
  DashRight,
  AirDash,
  WallRunLeft,
  WallRunRight,
  WallJumpLeft,
  WallJumpRight,
  Vault,
  Mantle,
];
