// Deterministic PRNG (mulberry32) so every render of a timeline is identical, which lets the
// renderer split a video into chunks that are simulated independently and joined seamlessly.
export function rng(seed = 1) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const range = (R, a, b) => a + (b - a) * R();
