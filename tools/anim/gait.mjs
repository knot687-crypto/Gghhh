// Procedural locomotion-cycle generator used at authoring time.
//
// Phase 0 = left foot contact, 0.5 = right foot contact. Stance feet are solved with IK so they
// travel backwards at exactly `speed` (no foot sliding at the design speed); swing legs follow
// authored FK keys; pelvis, spine, head and arms are driven by phase functions with overlap.
import { compileChannel, evalChannel } from './core/curve.mjs';
import { clip, pose } from './core/dsl.mjs';
import { plantFoot } from './core/kinematics.mjs';
import { R15 } from './core/rig.mjs';

const TAU = Math.PI * 2;
const D2R = Math.PI / 180;
const wrap = (x) => ((x % 1) + 1) % 1;

function curve(keys, loop = false) {
  // keys: [[phase, value]], interpolated with the same auto-clamped Hermite as the runtime.
  const ch = compileChannel(
    keys.map(([t, v]) => ({ t, v, e: 0 })),
    1,
    loop,
  );
  return (t) => evalChannel(ch, t);
}

export function gait(name, cfg) {
  const {
    T,
    speed,
    duty,
    samples = 20,
    footX = 0.5,
    contactBias = 0.55,
    bob = 0.06,
    bobMid = -0.08,
    sway = 0.03,
    pelvisYaw = 6,
    pelvisRoll = 3,
    lean = 6,
    leanPulse = 2,
    spineLean = 2,
    shoulderYaw = 5,
    headStab = 0.85,
    contactPitch = 0,
    toeOffPitch = -30,
    swing, // [{ s, hip, knee, ankle }] swing-phase FK keys, s in (0,1) of the swing
    arms,
    extra = null, // (phase, pose) => pose  for clip-specific flavour
    footYaw = 0,
    markers = true,
    meta = {},
    // Wall running: feet land on a virtual ground rotated `groundTilt` degrees about the forward
    // axis (negative = wall on the left) and pushed `groundShift` studs toward it; the body rolls
    // `bodyRoll` degrees.
    groundTilt = 0,
    groundShift = 0,
    bodyRoll = 0,
  } = cfg;
  const tiltRad = groundTilt * D2R;
  const tiltPoint = ([x, y, z]) => {
    const cx = Math.cos(tiltRad);
    const sx = Math.sin(tiltRad);
    const nx = x * cx - y * sx;
    const ny = x * sx + y * cx;
    // shift along the tilted "down" direction
    return [nx + sx * groundShift, ny - cx * groundShift, z];
  };

  const travel = speed * duty * T;
  const contactZ = -travel * contactBias;
  const G = R15.ground;

  const rootAt = (phi) => {
    const step = TAU * 2 * (phi - duty / 2);
    const y = bobMid - bob * Math.cos(step);
    const px = -sway * Math.cos(TAU * (phi - duty / 2));
    const ry = -pelvisYaw * Math.cos(TAU * phi);
    const rz = -pelvisRoll * Math.cos(TAU * (phi - duty / 2));
    const rx = -lean - leanPulse * Math.cos(step);
    return { p: [px, y, 0], r: [rx, ry, rz + bodyRoll] };
  };

  const stancePitch = (u) => {
    // u in [0,1] across stance: heel/forefoot strike -> flat -> heel rise.
    if (u < 0.25) return contactPitch * (1 - u / 0.25);
    if (u < 0.55) return 0;
    const k = (u - 0.55) / 0.45;
    return toeOffPitch * k * k;
  };

  const stanceTarget = (side, u) => {
    const pitch = stancePitch(u);
    let z = contactZ + travel * u;
    if (pitch > 0) z += 0.5 * (1 - Math.cos(pitch * D2R));
    if (pitch < 0) z -= 0.5 * (1 - Math.cos(pitch * D2R));
    const y = G + 0.5 * Math.sin(Math.abs(pitch) * D2R);
    const x = side === 'Left' ? -footX : footX;
    return { pos: tiltPoint([x, y, z]), pitch };
  };

  const basePose = (phi) => {
    const root = rootAt(phi);
    const worldShoulderYaw = shoulderYaw * Math.cos(TAU * phi);
    const p = pose({
      Root: root,
      Waist: { r: [-spineLean, worldShoulderYaw - root.r[1], -(root.r[2] - bodyRoll) * 0.6] },
      Neck: {
        r: [
          -(root.r[0] - spineLean) * headStab * 0.9 + 0,
          -worldShoulderYaw * headStab,
          -(root.r[2] - bodyRoll) * 0.4 * headStab - bodyRoll * (cfg.headRoll ?? 0.5),
        ],
      },
    });
    return p;
  };

  const solveStance = (phi, side, base) => {
    const local = side === 'Left' ? phi : wrap(phi - 0.5);
    const u = local / duty;
    const { pos, pitch } = stanceTarget(side, u);
    return plantFoot(base, side, pos, { pitch, yaw: side === 'Left' ? footYaw : -footYaw, roll: groundTilt });
  };

  // Pre-solve contact and toe-off poses for both legs (needed as swing endpoints).
  const legJoints = (side) => [`${side}Hip`, `${side}Knee`, `${side}Ankle`];
  const ends = {};
  for (const side of ['Left', 'Right']) {
    const off = side === 'Left' ? 0 : 0.5;
    const contact = solveStance(wrap(off), side, basePose(wrap(off)));
    const toeOff = solveStance(wrap(off + duty - 1e-4), side, basePose(wrap(off + duty - 1e-4)));
    ends[side] = { contact, toeOff };
  }

  const swingCurves = {};
  for (const side of ['Left', 'Right']) {
    const [hip, knee, ankle] = legJoints(side);
    const c = ends[side].contact.j;
    const t = ends[side].toeOff.j;
    const mk = (joint, ch, getter) =>
      curve([[0, t[joint].r[ch]], ...swing.map((k) => [k.s, getter(k, t[joint].r[ch], c[joint].r[ch])]), [1, c[joint].r[ch]]]);
    swingCurves[side] = {
      hipX: mk(hip, 0, (k) => k.hip),
      kneeX: mk(knee, 0, (k) => k.knee),
      ankleX: mk(ankle, 0, (k) => k.ankle ?? 0),
      hipY: (s) => t[hip].r[1] + (c[hip].r[1] - t[hip].r[1]) * s,
      hipZ: (s) => {
        const zz = t[hip].r[2] + (c[hip].r[2] - t[hip].r[2]) * s;
        return zz + (side === 'Left' ? -1 : 1) * (cfg.swingAbduct ?? 2) * Math.sin(Math.PI * s);
      },
      ankleY: (s) => t[ankle].r[1] + (c[ankle].r[1] - t[ankle].r[1]) * s,
      ankleZ: (s) => t[ankle].r[2] + (c[ankle].r[2] - t[ankle].r[2]) * s,
    };
  }

  const armPose = (phi) => {
    const a = arms;
    const out = {};
    for (const side of ['Left', 'Right']) {
      const sign = side === 'Left' ? -1 : 1;
      const ph = phi - (a.lag ?? 0.04);
      const fwd = sign * Math.cos(TAU * ph); // +1 when this arm is forward
      const swingAmt = a.bias + a.swing * fwd;
      const out_ = (a.out ?? 8) - (a.inward ?? 6) * Math.max(fwd, 0);
      out[`${side}Shoulder`] = { r: [swingAmt, sign * (a.twist ?? 0), side === 'Left' ? -out_ : out_] };
      out[`${side}Elbow`] = { r: [a.elbow + a.elbowSwing * fwd, 0, 0] };
      out[`${side}Wrist`] = { r: [a.wrist ?? 0, 0, sign * (a.wristRoll ?? 0)] };
    }
    return out;
  };

  const special = [0, duty, 0.5, 0.5 + duty].map(wrap);
  const times = [...new Set([...Array.from({ length: samples }, (_, i) => i / samples), ...special].map((x) => Math.round(x * 1e4) / 1e4))].sort(
    (a, b) => a - b,
  );

  const wallMeta = {};
  if (groundTilt !== 0) {
    // Lateral distance from the root part centre to the plane the wall-side foot lands on.
    const wallSide = groundTilt < 0 ? -footX : footX;
    wallMeta.wallDistance = Math.abs(tiltPoint([wallSide, G - 0.1, 0])[0]);
  }
  return clip(name, { length: T, loop: true, speed, stride: speed * T, ...wallMeta, ...meta }, (c) => {
    for (const phi of times) {
      let p = basePose(phi).with(armPose(phi));
      for (const side of ['Left', 'Right']) {
        const off = side === 'Left' ? 0 : 0.5;
        const local = wrap(phi - off);
        if (local <= duty + 1e-6) {
          p = solveStance(phi, side, p);
        } else {
          const s = (local - duty) / (1 - duty);
          const sc = swingCurves[side];
          const [hip, knee, ankle] = legJoints(side);
          p = p.with({
            [hip]: { r: [sc.hipX(s), sc.hipY(s), sc.hipZ(s)] },
            [knee]: { r: [sc.kneeX(s), 0, 0] },
            [ankle]: { r: [sc.ankleX(s), sc.ankleY(s), sc.ankleZ(s)] },
          });
        }
      }
      if (extra) p = extra(phi, p);
      c.key(phi * T, p);
    }
    if (markers) {
      c.marker(0, 'Footstep', { foot: 'Left' });
      c.marker(0.5 * T, 'Footstep', { foot: 'Right' });
    }
  });
}
