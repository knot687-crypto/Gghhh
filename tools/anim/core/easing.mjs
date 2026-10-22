// Easing library shared by the clip compiler, the preview renderer and (mirrored 1:1) the
// Luau runtime in src/ReplicatedStorage/AAAMotion/Animation/Easing.luau.
//
// The index of each name in EASE_NAMES is the integer code stored in compiled clips, so the
// order must never change. New easings can only be appended.

export const EASE_NAMES = [
  'smooth', // 0  auto-clamped cubic Hermite (handled by the curve evaluator, not a time warp)
  'linear', // 1
  'constant', // 2  hold the value until the next key
  'inQuad', 'outQuad', 'inOutQuad', // 3-5
  'inCubic', 'outCubic', 'inOutCubic', // 6-8
  'inQuart', 'outQuart', 'inOutQuart', // 9-11
  'inQuint', 'outQuint', 'inOutQuint', // 12-14
  'inSine', 'outSine', 'inOutSine', // 15-17
  'inExpo', 'outExpo', 'inOutExpo', // 18-20
  'inCirc', 'outCirc', 'inOutCirc', // 21-23
  'inBack', 'outBack', 'inOutBack', // 24-26
  'outElastic', // 27
  'outBounce', // 28
];

export const EASE_CODE = Object.fromEntries(EASE_NAMES.map((n, i) => [n, i]));

const PI = Math.PI;
const C1 = 1.70158;
const C2 = C1 * 1.525;
const C3 = C1 + 1;
const C4 = (2 * PI) / 3;

function outBounce(t) {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) {
    t -= 1.5 / d1;
    return n1 * t * t + 0.75;
  }
  if (t < 2.5 / d1) {
    t -= 2.25 / d1;
    return n1 * t * t + 0.9375;
  }
  t -= 2.625 / d1;
  return n1 * t * t + 0.984375;
}

// Indexed by ease code. Entries 0 and 2 are never called as time warps.
export const EASE_FN = [
  (t) => t, // smooth (unused as a warp)
  (t) => t, // linear
  () => 0, // constant
  (t) => t * t,
  (t) => 1 - (1 - t) * (1 - t),
  (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  (t) => t * t * t,
  (t) => 1 - Math.pow(1 - t, 3),
  (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  (t) => t * t * t * t,
  (t) => 1 - Math.pow(1 - t, 4),
  (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
  (t) => t * t * t * t * t,
  (t) => 1 - Math.pow(1 - t, 5),
  (t) => (t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2),
  (t) => 1 - Math.cos((t * PI) / 2),
  (t) => Math.sin((t * PI) / 2),
  (t) => -(Math.cos(PI * t) - 1) / 2,
  (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  (t) =>
    t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
  (t) => 1 - Math.sqrt(1 - t * t),
  (t) => Math.sqrt(1 - (t - 1) * (t - 1)),
  (t) =>
    t < 0.5 ? (1 - Math.sqrt(1 - 4 * t * t)) / 2 : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2,
  (t) => C3 * t * t * t - C1 * t * t,
  (t) => 1 + C3 * Math.pow(t - 1, 3) + C1 * Math.pow(t - 1, 2),
  (t) =>
    t < 0.5
      ? (Math.pow(2 * t, 2) * ((C2 + 1) * 2 * t - C2)) / 2
      : (Math.pow(2 * t - 2, 2) * ((C2 + 1) * (t * 2 - 2) + C2) + 2) / 2,
  (t) => (t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * C4) + 1),
  outBounce,
];

export function easeCode(name) {
  if (name === undefined || name === null) return 0;
  if (typeof name === 'number') return name;
  const code = EASE_CODE[name];
  if (code === undefined) throw new Error(`Unknown easing "${name}"`);
  return code;
}
