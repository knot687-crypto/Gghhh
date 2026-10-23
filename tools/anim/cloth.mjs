// Cloth tails: secondary motion simulated at runtime by the preview (preview/web/src/cloth.js)
// and the Roblox client (AAAMotion/VFX/ClothTails). A hachimaki headband and the obi knot each
// trail two tails that swing with the body, stream behind dashes and settle when still.
// Exported to Generated/Cloth.luau.
//
// Tails are anchored in part space (studs; R15 parts, -Z = forward) and hang along `dir` at rest.
// Each is a chain of `segments` links solved with follow-the-leader constraints (inextensible),
// air drag (so they trail behind motion), bending stiffness, a flutter that grows with speed, and
// capsule colliders around the body so they never pass through it.
export const CLOTH = {
  substeps: 3,
  gravity: 70, // studs/s^2 (lighter than the world's: cloth floats a little)
  drag: 4.2, // per second, against the air: tails trail at ~45 deg when running
  dampCorrection: 0.85, // DFTL velocity correction (removes the inextensibility jitter)
  rootStiffness: 0.55, // first link held along `dir` at the knot
  bend: 0.18, // straightening between consecutive links
  flutter: 0.9, // studs/s^2 per stud/s of speed, lateral wave along the tail
  resetDistance: 6, // anchor jumps further than this in one step (teleports) restart the tail
  tails: [
    // Obi knot at the back-left of the hips.
    { name: 'SashA', part: 'LowerTorso', anchor: [-0.62, -0.02, 0.53], dir: [-0.12, -1, 0.28], length: 2.1, width: 0.44, segments: 9, color: 'sash' },
    { name: 'SashB', part: 'LowerTorso', anchor: [-0.3, -0.04, 0.54], dir: [0.12, -1, 0.34], length: 1.65, width: 0.38, segments: 8, color: 'sash' },
    // Hachimaki knot at the back of the head.
    { name: 'BandA', part: 'Head', anchor: [-0.08, 0.17, 0.64], dir: [-0.35, -0.55, 1], length: 1.9, width: 0.26, segments: 9, color: 'band' },
    { name: 'BandB', part: 'Head', anchor: [0.08, 0.17, 0.64], dir: [0.3, -0.7, 1], length: 1.5, width: 0.23, segments: 8, color: 'band' },
  ],
  // The headband itself: a ring around the head.
  band: { part: 'Head', offset: [0, 0.17, 0], size: [1.27, 0.2, 1.27], color: 'band' },
  // Capsules (part space: from a to b, radius r) the tails are kept outside of.
  colliders: [
    { part: 'LowerTorso', a: [-0.7, 0, 0], b: [0.7, 0, 0], r: 0.5 },
    { part: 'UpperTorso', a: [-0.7, -0.45, 0], b: [0.7, -0.45, 0], r: 0.52 },
    { part: 'UpperTorso', a: [-0.7, 0.4, 0], b: [0.7, 0.4, 0], r: 0.52 },
    { part: 'LeftUpperLeg', a: [0, 0.45, 0], b: [0, -0.45, 0], r: 0.52 },
    { part: 'RightUpperLeg', a: [0, 0.45, 0], b: [0, -0.45, 0], r: 0.52 },
    { part: 'LeftLowerLeg', a: [0, 0.45, 0], b: [0, -0.45, 0], r: 0.5 },
    { part: 'RightLowerLeg', a: [0, 0.45, 0], b: [0, -0.45, 0], r: 0.5 },
    { part: 'Head', a: [0, 0, 0], b: [0, 0, 0], r: 0.66 },
  ],
};
