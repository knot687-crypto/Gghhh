// Jumping, falling, double jump flip and landings.
import { clip, pose } from '../core/dsl.mjs';
import { holdScabbard, plantFoot, reach } from '../core/kinematics.mjs';
import { R15 } from '../core/rig.mjs';
import { pivotX } from '../helpers.mjs';

const G = R15.ground;
const SHEATHED = { weapon: 'sheath' };

export const RISE = pose({
  Root: { p: [0, 0.05, 0], r: [-5, 4, 0] },
  Waist: { r: [3, -4, 0] },
  Neck: { r: [2, 0, 0] },
  LeftHip: { r: [62, 0, -5] },
  LeftKnee: { r: [-100, 0, 0] },
  LeftAnkle: { r: [-22, 0, 0] },
  RightHip: { r: [-10, 0, 5] },
  RightKnee: { r: [-38, 0, 0] },
  RightAnkle: { r: [-32, 0, 0] },
  RightShoulder: { r: [48, 0, 32] },
  RightElbow: { r: [40, 0, 0] },
  RightWrist: { r: [0, 0, 0] },
  LeftShoulder: { r: [30, 0, -38] },
  LeftElbow: { r: [34, 0, 0] },
  LeftWrist: { r: [0, 0, 0] },
});

export const FALL = pose({
  Root: { p: [0, 0, 0], r: [-4, 0, 0] },
  Waist: { r: [-3, 0, 0] },
  Neck: { r: [-9, 0, 0] },
  LeftHip: { r: [30, 0, -7] },
  LeftKnee: { r: [-46, 0, 0] },
  LeftAnkle: { r: [8, 0, 0] },
  RightHip: { r: [10, 0, 7] },
  RightKnee: { r: [-26, 0, 0] },
  RightAnkle: { r: [4, 0, 0] },
  RightShoulder: { r: [22, 0, 72] },
  RightElbow: { r: [28, 0, 0] },
  RightWrist: { r: [0, 0, 0] },
  LeftShoulder: { r: [14, 0, -68] },
  LeftElbow: { r: [32, 0, 0] },
  LeftWrist: { r: [0, 0, 0] },
});

const TUCK = pose({
  Waist: { r: [-24, 0, 0] },
  Neck: { r: [-22, 0, 0] },
  LeftHip: { r: [118, 0, -8] },
  LeftKnee: { r: [-148, 0, 0] },
  LeftAnkle: { r: [-28, 0, 0] },
  RightHip: { r: [112, 0, 8] },
  RightKnee: { r: [-146, 0, 0] },
  RightAnkle: { r: [-28, 0, 0] },
  RightShoulder: { r: [62, 0, -6] },
  RightElbow: { r: [104, 0, 0] },
  RightWrist: { r: [10, 0, 0] },
  LeftShoulder: { r: [62, 0, 6] },
  LeftElbow: { r: [104, 0, 0] },
  LeftWrist: { r: [10, 0, 0] },
});

export const JumpStart = clip('JumpStart', { length: 0.32, ...SHEATHED }, (c) => {
  // Push-off: compressed frame, explosive extension with arms driving up, then knee tuck.
  c.key(
    0,
    pose({
      Root: { p: [0, -0.32, 0], r: [-14, 0, 0] },
      Waist: { r: [-8, 0, 0] },
      Neck: { r: [12, 0, 0] },
      LeftHip: { r: [38, 0, -3] },
      LeftKnee: { r: [-62, 0, 0] },
      LeftAnkle: { r: [22, 0, 0] },
      RightHip: { r: [30, 0, 3] },
      RightKnee: { r: [-58, 0, 0] },
      RightAnkle: { r: [26, 0, 0] },
      RightShoulder: { r: [-30, 0, 14] },
      RightElbow: { r: [20, 0, 0] },
      RightWrist: { r: [0, 0, 0] },
      LeftShoulder: { r: [-30, 0, -14] },
      LeftElbow: { r: [20, 0, 0] },
      LeftWrist: { r: [0, 0, 0] },
    }),
  );
  c.key(
    0.07,
    pose({
      Root: { p: [0, 0.14, 0], r: [-3, 0, 0] },
      Waist: { r: [4, 0, 0] },
      Neck: { r: [4, 0, 0] },
      LeftHip: { r: [8, 0, -2] },
      LeftKnee: { r: [-8, 0, 0] },
      LeftAnkle: { r: [-38, 0, 0] },
      RightHip: { r: [-4, 0, 2] },
      RightKnee: { r: [-6, 0, 0] },
      RightAnkle: { r: [-40, 0, 0] },
      RightShoulder: { r: [118, 0, 22] },
      RightElbow: { r: [24, 0, 0] },
      RightWrist: { r: [0, 0, 0] },
      LeftShoulder: { r: [108, 0, -22] },
      LeftElbow: { r: [26, 0, 0] },
      LeftWrist: { r: [0, 0, 0] },
    }),
    { ease: 'outCubic' },
  );
  c.key(0.32, RISE, { lag: { RightShoulder: 0.03, LeftShoulder: 0.03 } });
});

export const Rise = clip('Rise', { length: 0.9, loop: true, ...SHEATHED }, (c) => {
  c.key(0, RISE);
  c.key(
    0.45,
    RISE.add({
      Root: { r: [-1.5, -2, 0] },
      LeftHip: { r: [6, 0, 0] },
      LeftKnee: { r: [-6, 0, 0] },
      RightHip: { r: [-4, 0, 0] },
      RightShoulder: { r: [6, 0, 4] },
      LeftShoulder: { r: [4, 0, -5] },
    }),
  );
});

export const Fall = clip('Fall', { length: 0.7, loop: true, ...SHEATHED }, (c) => {
  c.key(0, FALL);
  c.key(
    0.35,
    FALL.add({
      Root: { r: [-2, 0, 0] },
      LeftHip: { r: [-8, 0, 0] },
      LeftKnee: { r: [8, 0, 0] },
      RightHip: { r: [10, 0, 0] },
      RightKnee: { r: [-10, 0, 0] },
      RightShoulder: { r: [-6, 0, 8] },
      LeftShoulder: { r: [-4, 0, -9] },
      RightElbow: { r: [10, 0, 0] },
      LeftElbow: { r: [-8, 0, 0] },
    }),
    { lag: { RightShoulder: 0.06, LeftShoulder: 0.04 } },
  );
});

// Tucked front flip about the centre of mass.
export const DoubleJump = clip('DoubleJump', { length: 0.58, ...SHEATHED }, (c) => {
  const pv = [0, 1.05, -0.12];
  const flip = (rx, body) => body.with({ Root: pivotX(rx, pv) });
  c.key(0, flip(0, RISE));
  c.key(
    0.06,
    flip(
      10,
      RISE.with({
        RightShoulder: { r: [150, 0, 20] },
        LeftShoulder: { r: [146, 0, -20] },
        LeftHip: { r: [20, 0, -3] },
        LeftKnee: { r: [-20, 0, 0] },
        RightHip: { r: [8, 0, 3] },
        RightKnee: { r: [-14, 0, 0] },
        Waist: { r: [8, 0, 0] },
        Neck: { r: [6, 0, 0] },
      }),
    ),
  );
  c.key(0.13, flip(-50, TUCK), { lag: { RightShoulder: 0.02, LeftShoulder: 0.02 } });
  c.key(0.2, flip(-140, TUCK));
  c.key(0.27, flip(-230, TUCK));
  c.key(0.34, flip(-305, TUCK.blend(FALL, 0.15)));
  c.key(0.42, flip(-345, TUCK.blend(FALL, 0.6)));
  c.key(0.58, flip(-360, FALL), { lag: { RightShoulder: 0.04, LeftShoulder: 0.05 } });
  c.marker(0, 'DoubleJumpBurst');
});

// Additive knee-bend on top of locomotion.
export const LandLight = clip('LandLight', { length: 0.36, additive: true, ...SHEATHED }, (c) => {
  const zero = pose({
    Root: {},
    Waist: {},
    Neck: {},
    LeftHip: {},
    LeftKnee: {},
    LeftAnkle: {},
    RightHip: {},
    RightKnee: {},
    RightAnkle: {},
    RightShoulder: {},
    LeftShoulder: {},
  });
  c.key(0, zero);
  c.key(
    0.06,
    pose({
      Root: { p: [0, -0.26, 0], r: [-6, 0, 0] },
      Waist: { r: [-5, 0, 0] },
      Neck: { r: [6, 0, 0] },
      LeftHip: { r: [20, 0, 0] },
      LeftKnee: { r: [-34, 0, 0] },
      LeftAnkle: { r: [14, 0, 0] },
      RightHip: { r: [20, 0, 0] },
      RightKnee: { r: [-34, 0, 0] },
      RightAnkle: { r: [14, 0, 0] },
      RightShoulder: { r: [-6, 0, 6] },
      LeftShoulder: { r: [-6, 0, -6] },
    }),
    { ease: 'outQuad' },
  );
  c.key(0.36, zero);
  c.marker(0, 'Land', { strength: 'light' });
});

function stand() {
  let p = pose({
    Root: { p: [0.02, -0.1, 0], r: [-2, 6, 0] },
    Waist: { r: [-1, -4, 1] },
    Neck: { r: [0, -2, 0] },
    RightShoulder: { r: [4, -4, 6] },
    RightElbow: { r: [14, 0, 0] },
    RightWrist: { r: [6, 0, -4] },
    LeftShoulder: { r: [0, 0, -4] },
    LeftElbow: { r: [30, 0, 0] },
  });
  p = plantFoot(p, 'Left', [-0.62, G, -0.22], { yaw: 10 });
  p = plantFoot(p, 'Right', [0.62, G, 0.24], { yaw: -16 });
  return holdScabbard(p, { along: 0.78, roll: -20 });
}

// Superhero three-point landing for big falls.
export const LandHeavy = clip('LandHeavy', { length: 0.95, ...SHEATHED }, (c) => {
  const impact = (drop, lean) => {
    let p = pose({
      Root: { p: [0.05, -drop, 0], r: [-lean, 12, 2] },
      Waist: { r: [-14, -8, 2] },
      Neck: { r: [lean * 0.9 + 6, -6, 0] },
      LeftShoulder: { r: [-38, 0, -52] },
      LeftElbow: { r: [24, 0, 0] },
      LeftWrist: { r: [0, 0, 0] },
    });
    p = plantFoot(p, 'Left', [-0.72, G, -0.78], { yaw: 14 });
    p = plantFoot(p, 'Right', [0.58, G + 0.18, 0.78], { yaw: -10, pitch: -48 });
    p = reach(p, 'Right', [0.42, G + 0.12, -1.42], { rot: null });
    return p;
  };
  c.key(0, impact(1.0, 22));
  c.key(0.07, impact(1.38, 30), { ease: 'outQuad' });
  c.key(0.3, impact(1.3, 27));
  c.key(0.58, stand().add({ Root: { p: [0, -0.32, 0], r: [-8, 0, 0] }, Neck: { r: [4, 0, 0] } }), {
    lag: { LeftShoulder: 0.05, RightShoulder: 0.04 },
  });
  c.key(0.95, stand());
  c.marker(0, 'Land', { strength: 'heavy' });
});

// Momentum-preserving forward roll.
export const LandRoll = clip('LandRoll', { length: 0.74, ...SHEATHED }, (c) => {
  const curl = (rx, centre, shape) => {
    const pv = [0, 0.45, -0.25];
    const extra = [0, centre - 0, 0];
    return shape.with({ Root: pivotX(rx, pv, extra) });
  };
  const reachDown = pose({
    Waist: { r: [-22, 0, 0] },
    Neck: { r: [-10, 0, 0] },
    LeftHip: { r: [60, 0, -6] },
    LeftKnee: { r: [-90, 0, 0] },
    LeftAnkle: { r: [10, 0, 0] },
    RightHip: { r: [40, 0, 6] },
    RightKnee: { r: [-70, 0, 0] },
    RightAnkle: { r: [10, 0, 0] },
    RightShoulder: { r: [70, 0, 18] },
    RightElbow: { r: [20, 0, 0] },
    LeftShoulder: { r: [70, 0, -18] },
    LeftElbow: { r: [20, 0, 0] },
  });
  const ball = TUCK.with({ Neck: { r: [-34, 0, 0] }, Waist: { r: [-30, 0, 0] } });
  c.key(0, curl(-22, -0.5, reachDown));
  c.key(0.08, curl(-75, -0.95, reachDown.blend(ball, 0.6)));
  c.key(0.17, curl(-160, -1.15, ball));
  c.key(0.26, curl(-245, -1.15, ball));
  c.key(0.35, curl(-315, -1.05, ball.blend(reachDown, 0.3)));
  let crouch = pose({
    Root: { p: [0, -0.95, 0], r: [-26, 0, 0] },
    Waist: { r: [-12, 0, 0] },
    Neck: { r: [26, 0, 0] },
    RightShoulder: { r: [40, 0, 20] },
    RightElbow: { r: [40, 0, 0] },
    LeftShoulder: { r: [30, 0, -24] },
    LeftElbow: { r: [40, 0, 0] },
  });
  crouch = plantFoot(crouch, 'Left', [-0.5, G, -0.35]);
  crouch = plantFoot(crouch, 'Right', [0.5, G, 0.25], { pitch: -20 });
  crouch = crouch.with({ Root: { r: [-386, 0, 0] } });
  c.key(0.46, crouch);
  const up = crouch.with({ Root: { p: [0, -0.3, 0], r: [-372, 0, 0] } });
  c.key(0.74, plantFoot(plantFoot(up, 'Left', [-0.45, G, -0.5]), 'Right', [0.45, G, 0.45], { pitch: -25 }));
  c.marker(0, 'Land', { strength: 'roll' });
});

export default [JumpStart, Rise, Fall, DoubleJump, LandLight, LandHeavy, LandRoll];
