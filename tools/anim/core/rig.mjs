// Rig definitions.
//
// Joints follow Roblox Motor6D semantics exactly:
//   Part1.CFrame = Part0.CFrame * C0 * Transform * C1:Inverse()
// All default R15 rig attachments are axis aligned, so C0/C1 are pure translations and a clip's
// rotation keys are expressed in the parent part's axes: +X right, +Y up, +Z back (-Z forward).
//
// Rotation cheat sheet (Euler XYZ degrees, same as CFrame.Angles):
//   Shoulder/Hip  +X swings the limb forward/up       Knee  -X bends (shin goes back)
//   Elbow         +X bends (forearm comes forward/up) Waist/Neck/Root  -X pitches forward
//   Any joint     +Y turns toward the character's left (counter-clockwise seen from above)
//   Any joint     +Z rolls the top toward the left; RightShoulder +Z / LeftShoulder -Z raise the
//                 arm out to the side.

const v = (x, y, z) => [x, y, z];

export const R15 = {
  name: 'R15',
  root: 'HumanoidRootPart',
  // Studs. The real avatar's hip height is measured at runtime and positional keys are scaled.
  hipHeight: 1.83,
  parts: {
    HumanoidRootPart: v(2, 2, 1),
    LowerTorso: v(2, 0.4, 1),
    UpperTorso: v(2, 1.6, 1),
    Head: v(1.2, 1.2, 1.2),
    LeftUpperArm: v(1, 1.169, 1),
    LeftLowerArm: v(1, 1.052, 1),
    LeftHand: v(1, 0.3, 1),
    RightUpperArm: v(1, 1.169, 1),
    RightLowerArm: v(1, 1.052, 1),
    RightHand: v(1, 0.3, 1),
    LeftUpperLeg: v(1, 1.217, 1),
    LeftLowerLeg: v(1, 1.193, 1),
    LeftFoot: v(1, 0.3, 1),
    RightUpperLeg: v(1, 1.217, 1),
    RightLowerLeg: v(1, 1.193, 1),
    RightFoot: v(1, 0.3, 1),
  },
  // Ordered parent-before-child.
  joints: [
    { name: 'Root', part0: 'HumanoidRootPart', part1: 'LowerTorso', c0: v(0, -1, 0), c1: v(0, -0.2, 0) },
    { name: 'Waist', part0: 'LowerTorso', part1: 'UpperTorso', c0: v(0, 0.2, 0), c1: v(0, -0.8, 0) },
    { name: 'Neck', part0: 'UpperTorso', part1: 'Head', c0: v(0, 0.8, 0), c1: v(0, -0.5, 0) },
    { name: 'LeftShoulder', part0: 'UpperTorso', part1: 'LeftUpperArm', c0: v(-1, 0.563, 0), c1: v(0.5, 0.394, 0) },
    { name: 'LeftElbow', part0: 'LeftUpperArm', part1: 'LeftLowerArm', c0: v(0, -0.334, 0), c1: v(0, 0.192, 0) },
    { name: 'LeftWrist', part0: 'LeftLowerArm', part1: 'LeftHand', c0: v(0, -0.501, 0), c1: v(0, 0.125, 0) },
    { name: 'RightShoulder', part0: 'UpperTorso', part1: 'RightUpperArm', c0: v(1, 0.563, 0), c1: v(-0.5, 0.394, 0) },
    { name: 'RightElbow', part0: 'RightUpperArm', part1: 'RightLowerArm', c0: v(0, -0.334, 0), c1: v(0, 0.192, 0) },
    { name: 'RightWrist', part0: 'RightLowerArm', part1: 'RightHand', c0: v(0, -0.501, 0), c1: v(0, 0.125, 0) },
    { name: 'LeftHip', part0: 'LowerTorso', part1: 'LeftUpperLeg', c0: v(-0.5, -0.2, 0), c1: v(0, 0.421, 0) },
    { name: 'LeftKnee', part0: 'LeftUpperLeg', part1: 'LeftLowerLeg', c0: v(0, -0.411, 0), c1: v(0, 0.2, 0) },
    { name: 'LeftAnkle', part0: 'LeftLowerLeg', part1: 'LeftFoot', c0: v(0, -0.547, 0), c1: v(0, 0.101, 0) },
    { name: 'RightHip', part0: 'LowerTorso', part1: 'RightUpperLeg', c0: v(0.5, -0.2, 0), c1: v(0, 0.421, 0) },
    { name: 'RightKnee', part0: 'RightUpperLeg', part1: 'RightLowerLeg', c0: v(0, -0.411, 0), c1: v(0, 0.2, 0) },
    { name: 'RightAnkle', part0: 'RightLowerLeg', part1: 'RightFoot', c0: v(0, -0.547, 0), c1: v(0, 0.101, 0) },
    // Weapon grip. Matches the R15 RightGripAttachment: 0.15 below the hand centre, rotated -90 X so
    // the weapon's +Y (blade direction) points forward when the arm hangs at rest.
    { name: 'Weapon', part0: 'RightHand', part1: 'Weapon', c0: v(0, -0.15, 0), c0r: v(-90, 0, 0), c1: v(0, 0, 0) },
  ],
  // Where the Weapon joint re-parents when the katana is sheathed at the left hip. Worn tachi-style
  // (edge down and out) with the handle angled across toward the belly, so the right hand can
  // reach and grip it exactly for the draw. Part0 becomes LowerTorso and C0 becomes this frame.
  sheath: { part0: 'LowerTorso', c0: v(-0.219, 0.151, -0.952), c0r: v(-52.3, 35.8, 150.3) },
  // Sole height in HumanoidRootPart space when standing (HipHeight + half the root part).
  ground: -2.83,
};

// First-person viewmodel: the root is the camera itself. "Torso" positions an invisible
// UpperTorso under the eye; the arms are slim viewmodel arms (R15 block arms are far too thick
// right in front of the camera) with the same bone lengths as R15, so poses transfer; "Camera"
// is a virtual joint whose transform is applied to the camera.
export const VM = {
  name: 'VM',
  root: 'CameraRoot',
  parts: {
    CameraRoot: v(0.2, 0.2, 0.2),
    UpperTorso: v(1.6, 1.4, 0.8),
    LeftUpperArm: v(0.44, 0.96, 0.44),
    LeftLowerArm: v(0.42, 0.86, 0.42),
    LeftHand: v(0.46, 0.3, 0.52),
    RightUpperArm: v(0.44, 0.96, 0.44),
    RightLowerArm: v(0.42, 0.86, 0.42),
    RightHand: v(0.46, 0.3, 0.52),
  },
  joints: [
    { name: 'Torso', part0: 'CameraRoot', part1: 'UpperTorso', c0: v(0, -1.25, 0.3), c1: v(0, 0, 0) },
    { name: 'LeftShoulder', part0: 'UpperTorso', part1: 'LeftUpperArm', c0: v(-0.82, 0.5, 0), c1: v(0, 0.364, 0) },
    { name: 'LeftElbow', part0: 'LeftUpperArm', part1: 'LeftLowerArm', c0: v(0, -0.364, 0), c1: v(0, 0.3465, 0) },
    { name: 'LeftWrist', part0: 'LeftLowerArm', part1: 'LeftHand', c0: v(0, -0.3465, 0), c1: v(0, 0.125, 0) },
    { name: 'RightShoulder', part0: 'UpperTorso', part1: 'RightUpperArm', c0: v(0.82, 0.5, 0), c1: v(0, 0.364, 0) },
    { name: 'RightElbow', part0: 'RightUpperArm', part1: 'RightLowerArm', c0: v(0, -0.364, 0), c1: v(0, 0.3465, 0) },
    { name: 'RightWrist', part0: 'RightLowerArm', part1: 'RightHand', c0: v(0, -0.3465, 0), c1: v(0, 0.125, 0) },
    { name: 'Weapon', part0: 'RightHand', part1: 'Weapon', c0: v(0, -0.15, 0), c0r: v(-90, 0, 0), c1: v(0, 0, 0) },
  ],
  virtualJoints: ['Camera'],
};

export const RIGS = { R15, VM };

export function mirrorName(name) {
  if (name.startsWith('Left')) return 'Right' + name.slice(4);
  if (name.startsWith('Right')) return 'Left' + name.slice(5);
  return name;
}

export function rigJointNames(rig) {
  return [...rig.joints.map((j) => j.name), ...(rig.virtualJoints ?? [])];
}
