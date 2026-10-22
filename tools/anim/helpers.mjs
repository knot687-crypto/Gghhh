// Shared authoring helpers.
import { pose } from './core/dsl.mjs';

const D2R = Math.PI / 180;

/**
 * Root joint channels that rotate the body by `rx` degrees (about X) around `pivot`, a point in
 * Root-joint space (the joint sits at the bottom of the HumanoidRootPart, so [0, 1, 0] is the
 * root part's centre). Used for flips and rolls so the body spins about its centre of mass.
 */
export function pivotX(rx, pivot = [0, 1, 0], extra = [0, 0, 0]) {
  const t = rx * D2R;
  const [, cy, cz] = pivot;
  const ry = cy * Math.cos(t) - cz * Math.sin(t);
  const rz = cy * Math.sin(t) + cz * Math.cos(t);
  return { r: [rx, 0, 0], p: [extra[0], cy - ry + extra[1], cz - rz + extra[2]] };
}

// Same about the Z axis (cartwheels / side rolls).
export function pivotZ(rz, pivot = [0, 1, 0], extra = [0, 0, 0]) {
  const t = rz * D2R;
  const [cx, cy] = pivot;
  const rx = cx * Math.cos(t) - cy * Math.sin(t);
  const ry = cx * Math.sin(t) + cy * Math.cos(t);
  return { r: [0, 0, rz], p: [cx - rx + extra[0], cy - ry + extra[1], extra[2]] };
}

export const lerp = (a, b, t) => a + (b - a) * t;

// Root-motion track helper: keys a virtual "RootMotion" joint with position offsets (studs) in
// the character's facing frame (+X right, +Y up, +Z back). Runtimes move the root part along it.
export function rootMotion(points) {
  return points.map(([t, x, y, z]) => [t, pose({ RootMotion: { p: [x, y, z] } })]);
}
