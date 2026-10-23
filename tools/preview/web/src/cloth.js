// Cloth tails (headband + obi knot): JS twin of AAAMotion/VFX/ClothTails.luau. See anim/cloth.mjs.
//
// Each tail is a chain pinned at its knot, integrated with air drag and gravity in sub-steps,
// kept inextensible with follow-the-leader constraints (with the DFTL velocity correction that
// removes their jitter), straightened a little at the knot and between links, fluttered by speed
// and pushed out of capsules around the body. Rendered as a tapered double-sided ribbon.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CLOTH } from '/anim/cloth.mjs';

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const ab = new THREE.Vector3();

function pushOutOfCapsule(p, a, b, r) {
  ab.subVectors(b, a);
  const L2 = ab.lengthSq();
  let t = L2 > 1e-9 ? tmp.subVectors(p, a).dot(ab) / L2 : 0;
  t = Math.min(1, Math.max(0, t));
  tmp.copy(a).addScaledVector(ab, t); // closest point on the axis
  tmp2.subVectors(p, tmp);
  const d = tmp2.length();
  if (d >= r) return;
  if (d < 1e-6) tmp2.set(0, 0, 1);
  else tmp2.multiplyScalar(1 / d);
  p.copy(tmp).addScaledVector(tmp2, r);
}

export class ClothTails {
  constructor(avatar, colors, scene) {
    this.avatar = avatar;
    this.time = 0;
    this.materials = {};
    const mat = (key) =>
      (this.materials[key] ??= new THREE.MeshStandardMaterial({ color: colors[key], roughness: 0.78, side: THREE.DoubleSide }));
    this.tails = CLOTH.tails.map((spec) => {
      const n = spec.segments;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((n + 1) * 2 * 3), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array((n + 1) * 2 * 3), 3));
      const idx = [];
      for (let i = 0; i < n; i++) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, mat(spec.color));
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
      return {
        spec,
        n,
        len: spec.length / n,
        pts: Array.from({ length: n + 1 }, () => new THREE.Vector3()),
        vel: Array.from({ length: n + 1 }, () => new THREE.Vector3()),
        next: Array.from({ length: n + 1 }, () => new THREE.Vector3()),
        corr: Array.from({ length: n + 2 }, () => new THREE.Vector3()),
        anchor: new THREE.Vector3(),
        dir: new THREE.Vector3(),
        side: new THREE.Vector3(),
        prevAnchor: new THREE.Vector3(),
        prevDir: new THREE.Vector3(),
        init: false,
        mesh,
        geo,
      };
    });
    const b = CLOTH.band;
    this.band = new THREE.Mesh(new RoundedBoxGeometry(b.size[0], b.size[1], b.size[2], 2, 0.06), mat(b.color));
    this.band.position.fromArray(b.offset);
    this.band.castShadow = true;
    avatar.parts[b.part].add(this.band);
    this.colliders = CLOTH.colliders.map((c) => ({ ...c, wa: new THREE.Vector3(), wb: new THREE.Vector3() }));
  }

  // Call after the avatar's pose is applied, with the (time-scaled) frame time.
  update(dt) {
    const av = this.avatar;
    const visible = av.root.visible;
    for (const t of this.tails) t.mesh.visible = visible;
    if (!visible) return;
    av.root.updateMatrixWorld(true);
    for (const c of this.colliders) {
      const m = av.parts[c.part].matrixWorld;
      c.wa.fromArray(c.a).applyMatrix4(m);
      c.wb.fromArray(c.b).applyMatrix4(m);
    }
    for (const t of this.tails) {
      const m = av.parts[t.spec.part].matrixWorld;
      t.anchor.fromArray(t.spec.anchor).applyMatrix4(m);
      t.dir.fromArray(t.spec.dir).transformDirection(m);
      t.side.set(1, 0, 0).transformDirection(m);
      const jump = t.init ? t.anchor.distanceTo(t.prevAnchor) : Infinity;
      if (!t.init || jump > CLOTH.resetDistance) {
        for (let i = 0; i <= t.n; i++) {
          t.pts[i].copy(t.anchor).addScaledVector(t.dir, t.len * i);
          t.vel[i].set(0, 0, 0);
        }
        t.prevAnchor.copy(t.anchor);
        t.prevDir.copy(t.dir);
        t.init = true;
      }
      if (dt > 0) this.step(t, dt);
      t.prevAnchor.copy(t.anchor);
      t.prevDir.copy(t.dir);
      this.writeMesh(t);
    }
    this.time += dt;
  }

  step(t, dt) {
    const C = CLOTH;
    const sub = C.substeps;
    const h = dt / sub;
    const decay = Math.exp(-C.drag * h);
    const speed = t.anchor.distanceTo(t.prevAnchor) / dt;
    const A = new THREE.Vector3();
    const D = new THREE.Vector3();
    const target = new THREE.Vector3();
    const n = t.n;
    const p = t.pts;
    const q = t.next;
    for (let s = 1; s <= sub; s++) {
      const k = s / sub;
      A.lerpVectors(t.prevAnchor, t.anchor, k);
      D.lerpVectors(t.prevDir, t.dir, k).normalize();
      const time = this.time + h * s;
      // Predict.
      for (let i = 1; i <= n; i++) {
        const v = t.vel[i];
        v.y -= C.gravity * h;
        const w = Math.sin(time * (9 + speed * 0.25) - i * 0.9) * C.flutter * speed * (i / n) * h;
        v.addScaledVector(t.side, w);
        v.multiplyScalar(decay);
        q[i].copy(p[i]).addScaledVector(v, h);
      }
      q[0].copy(A);
      // Knot stiffness and bending.
      target.copy(A).addScaledVector(D, t.len);
      q[1].lerp(target, C.rootStiffness);
      for (let i = 2; i <= n; i++) {
        target.subVectors(q[i - 1], q[i - 2]).setLength(t.len).add(q[i - 1]);
        q[i].lerp(target, C.bend);
      }
      // Body collisions.
      for (let i = 1; i <= n; i++) for (const c of this.colliders) pushOutOfCapsule(q[i], c.wa, c.wb, c.r);
      // Follow the leader (inextensible), remembering each correction.
      for (let i = 1; i <= n; i++) {
        target.subVectors(q[i], q[i - 1]);
        const l = target.length();
        if (l < 1e-6) target.copy(D);
        else target.multiplyScalar(1 / l);
        target.multiplyScalar(t.len).add(q[i - 1]);
        t.corr[i].subVectors(target, q[i]);
        q[i].copy(target);
      }
      // Velocities with the DFTL correction, then commit.
      for (let i = 1; i <= n; i++) {
        t.vel[i].subVectors(q[i], p[i]).multiplyScalar(1 / h);
        if (i < n) t.vel[i].addScaledVector(t.corr[i + 1], -C.dampCorrection / h);
        p[i].copy(q[i]);
      }
      p[0].copy(A);
    }
  }

  writeMesh(t) {
    const pos = t.geo.attributes.position.array;
    const nor = t.geo.attributes.normal.array;
    const tan = new THREE.Vector3();
    const side = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    for (let i = 0; i <= t.n; i++) {
      if (i < t.n) tan.subVectors(t.pts[i + 1], t.pts[i]);
      else tan.subVectors(t.pts[i], t.pts[i - 1]);
      tan.normalize();
      side.copy(t.side).addScaledVector(tan, -t.side.dot(tan)).normalize();
      nrm.crossVectors(side, tan);
      const w = (t.spec.width * (1 - 0.3 * (i / t.n))) / 2;
      const o = i * 6;
      pos[o] = t.pts[i].x - side.x * w;
      pos[o + 1] = t.pts[i].y - side.y * w;
      pos[o + 2] = t.pts[i].z - side.z * w;
      pos[o + 3] = t.pts[i].x + side.x * w;
      pos[o + 4] = t.pts[i].y + side.y * w;
      pos[o + 5] = t.pts[i].z + side.z * w;
      for (let k = 0; k < 2; k++) {
        nor[o + k * 3] = nrm.x;
        nor[o + k * 3 + 1] = nrm.y;
        nor[o + k * 3 + 2] = nrm.z;
      }
    }
    t.geo.attributes.position.needsUpdate = true;
    t.geo.attributes.normal.needsUpdate = true;
  }

  dispose() {
    for (const t of this.tails) {
      t.mesh.removeFromParent();
      t.geo.dispose();
    }
    this.band.removeFromParent();
  }
}
