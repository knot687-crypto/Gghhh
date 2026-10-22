// Minimal rigid-transform math matching Roblox CFrame semantics:
//   xform = { p: [x, y, z], q: [x, y, z, w] }  ==  CFrame.new(p) * rotation(q)
// fromChannels() matches CFrame.new(px, py, pz) * CFrame.Angles(rad(rx), rad(ry), rad(rz)).

const D2R = Math.PI / 180;

export const IDENTITY = Object.freeze({ p: [0, 0, 0], q: [0, 0, 0, 1] });

export function quatFromEulerXYZ(rx, ry, rz) {
  const c1 = Math.cos(rx / 2);
  const s1 = Math.sin(rx / 2);
  const c2 = Math.cos(ry / 2);
  const s2 = Math.sin(ry / 2);
  const c3 = Math.cos(rz / 2);
  const s3 = Math.sin(rz / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

export function fromChannels(c) {
  return {
    p: [c.px ?? 0, c.py ?? 0, c.pz ?? 0],
    q: quatFromEulerXYZ((c.rx ?? 0) * D2R, (c.ry ?? 0) * D2R, (c.rz ?? 0) * D2R),
  };
}

export function quatMul(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatRotate(q, v) {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  const ix = w * vx + y * vz - z * vy;
  const iy = w * vy + z * vx - x * vz;
  const iz = w * vz + x * vy - y * vx;
  const iw = -x * vx - y * vy - z * vz;
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

export function slerp(a, b, t) {
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let k0;
  let k1;
  if (cos > 0.9995) {
    k0 = 1 - t;
    k1 = t;
  } else {
    const theta = Math.acos(cos);
    const sin = Math.sin(theta);
    k0 = Math.sin((1 - t) * theta) / sin;
    k1 = Math.sin(t * theta) / sin;
  }
  const out = [a[0] * k0 + bx * k1, a[1] * k0 + by * k1, a[2] * k0 + bz * k1, a[3] * k0 + bw * k1];
  const len = Math.hypot(...out);
  return out.map((x) => x / len);
}

export function lerpXform(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return {
    p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t],
    q: slerp(a.q, b.q, t),
  };
}

export function mulXform(a, b) {
  const rp = quatRotate(a.q, b.p);
  return { p: [a.p[0] + rp[0], a.p[1] + rp[1], a.p[2] + rp[2]], q: quatMul(a.q, b.q) };
}
