// Katana geometry shared by the preview model, the swing baker and the Luau weapon builder.
// Weapon part space: origin = grip centre, +Y toward the tip, cutting edge toward -Z.
export const KATANA = {
  bladeStart: 0.5,
  bladeEnd: 3.55,
  baseWidth: 0.2,
  tipWidth: 0.15,
  sori: 0.17,
  handleStart: -0.95,
  guardY: 0.45,
  offHand: 0.62,
  trailBase: 0.75,
  trailMid: 2.3,
  trailTip: 3.45,
};

// Cross-section frame of the blade at fraction s (0 = habaki, 1 = tip).
export function bladeFrame(s) {
  const W = KATANA.baseWidth + (KATANA.tipWidth - KATANA.baseWidth) * s;
  const y = KATANA.bladeStart + (KATANA.bladeEnd - KATANA.bladeStart) * s;
  const c = KATANA.sori * s * s;
  let zE = -W * 0.55 + c;
  const zB = W * 0.45 + c;
  const k = 0.88;
  if (s > k) {
    const u = (s - k) / (1 - k);
    zE = zE + (zB - zE) * Math.pow(u, 1.6);
  }
  const zS = zE + (zB - zE) * 0.62;
  let tS = 0.034 - 0.012 * s;
  let tB = 0.022 - 0.006 * s;
  if (s > k) {
    const u = (s - k) / (1 - k);
    tS *= 1 - u * 0.85;
    tB *= 1 - u * 0.85;
  }
  return { y, zE, zS, zB, tS, tB, W };
}

// Blade centre-line point at a height along the weapon's +Y axis.
export function bladePointAt(y) {
  const s = (y - KATANA.bladeStart) / (KATANA.bladeEnd - KATANA.bladeStart);
  const f = bladeFrame(s);
  return [0, f.y, +((f.zE + f.zB) / 2).toFixed(4)];
}

export const KATANA_POINTS = {
  base: bladePointAt(KATANA.trailBase),
  mid: bladePointAt(KATANA.trailMid),
  tip: bladePointAt(KATANA.trailTip),
};

// First-person viewmodels show the katana slightly smaller so the long handle doesn't swamp the
// lower screen (standard viewmodel presentation scaling).
export const VM_WEAPON_SCALE = 0.8;
