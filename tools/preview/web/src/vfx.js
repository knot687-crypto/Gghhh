// Preview VFX: Roblox-ParticleEmitter-like particles, swing ribbons, and effect primitives driven
// by the shared recipes in /anim/vfx.mjs (the Luau VFX module implements the same recipes).
import * as THREE from 'three';
import { EFFECTS, PARTICLES, RIBBON } from '/anim/vfx.mjs';
import { crackTexture, glowSprite, ringSprite, smokeSprite, sparkSprite, streakSprite } from './textures.js';
import { rng } from './rng.js';

const D2R = Math.PI / 180;
const tmpV = new THREE.Vector3();

// Cross-section of a slash ribbon from the inner edge (0) to the blade tip (1).
const RIBBON_ROWS = [
  { at: 0, alpha: 0, color: 'tailColor' },
  { at: 0.58, alpha: 0.035, color: 'tailColor' },
  { at: 0.85, alpha: 0.2, color: 'edgeColor' },
  { at: 0.965, alpha: 0.95, color: 'coreColor' },
  { at: 1, alpha: 0.4, color: 'edgeColor' },
];

function seqNum(seq, t) {
  if (!Array.isArray(seq)) return seq;
  if (t <= seq[0][0]) return seq[0][1];
  for (let i = 1; i < seq.length; i++) {
    if (t <= seq[i][0]) {
      const [t0, v0] = seq[i - 1];
      const [t1, v1] = seq[i];
      return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
  }
  return seq[seq.length - 1][1];
}

function prepColors(seq) {
  if (typeof seq === 'string') seq = [[0, seq], [1, seq]];
  return seq.map(([t, hex]) => [t, new THREE.Color(hex)]);
}
function seqColor(seq, t, out) {
  if (t <= seq[0][0]) return out.copy(seq[0][1]);
  for (let i = 1; i < seq.length; i++) {
    if (t <= seq[i][0]) {
      const [t0, c0] = seq[i - 1];
      const [t1, c1] = seq[i];
      return out.copy(c0).lerp(c1, (t - t0) / (t1 - t0));
    }
  }
  return out.copy(seq[seq.length - 1][1]);
}

// Random unit vector within `deg` of `dir`.
function coneDir(R, dir, deg, out) {
  const cosMax = Math.cos(Math.min(deg, 180) * D2R);
  const cz = cosMax + (1 - cosMax) * R();
  const sz = Math.sqrt(Math.max(0, 1 - cz * cz));
  const phi = R() * Math.PI * 2;
  const a = Math.abs(dir.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(dir, a).normalize();
  const v = new THREE.Vector3().crossVectors(dir, u);
  return out
    .copy(dir)
    .multiplyScalar(cz)
    .addScaledVector(u, Math.cos(phi) * sz)
    .addScaledVector(v, Math.sin(phi) * sz)
    .normalize();
}

// ------------------------------------------------------------------------- particles
class ParticlePool {
  constructor(scene, texture, additive, max = 3000) {
    this.max = max;
    this.list = [];
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 4 * 3);
    this.col = new Float32Array(max * 4 * 4);
    this.uv = new Float32Array(max * 4 * 2);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) {
      this.uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo = geo;
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: !additive,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 10;
    this.additive = additive;
    scene.add(this.mesh);
  }

  update(dt) {
    for (const p of this.list) {
      p.age += dt;
      p.vel.addScaledVector(p.acc, dt);
      if (p.drag) p.vel.multiplyScalar(Math.pow(0.5, p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      p.rot += p.rotSpeed * dt;
    }
    this.list = this.list.filter((p) => p.age < p.life);
  }

  render(camera) {
    const camPos = camera.position;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const fwd = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2).negate();
    if (!this.additive) this.list.sort((a, b) => b.pos.distanceToSquared(camPos) - a.pos.distanceToSquared(camPos));
    const n = Math.min(this.list.length, this.max);
    const c = new THREE.Color();
    const ax = new THREE.Vector3();
    const ay = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const p = this.list[i];
      const k = p.age / p.life;
      const size = seqNum(p.spec.size, k) * p.sizeScale;
      const sq = p.spec.squash ? seqNum(p.spec.squash, k) : 0;
      const h = (size / 2) * Math.pow(2, sq / 1.5);
      const w = (size / 2) * Math.pow(2, -sq / 3);
      const o = p.spec.orientation ?? 'facing';
      if (o === 'velocityParallel' && p.vel.lengthSq() > 1e-6) {
        ay.copy(p.vel).addScaledVector(fwd, -p.vel.dot(fwd));
        if (ay.lengthSq() < 1e-8) ay.copy(up);
        ay.normalize();
        ax.crossVectors(ay, fwd).normalize();
      } else if (o === 'velocityPerpendicular' && p.vel.lengthSq() > 1e-6) {
        const v = tmpV.copy(p.vel).normalize();
        ax.crossVectors(v, Math.abs(v.y) < 0.9 ? up : right).normalize();
        ay.crossVectors(v, ax).normalize();
      } else {
        const cs = Math.cos(p.rot * D2R);
        const sn = Math.sin(p.rot * D2R);
        ax.copy(right).multiplyScalar(cs).addScaledVector(up, sn);
        ay.copy(up).multiplyScalar(cs).addScaledVector(right, -sn);
      }
      const corners = [
        [-w, -h],
        [w, -h],
        [w, h],
        [-w, h],
      ];
      for (let v = 0; v < 4; v++) {
        const [cx, cy] = corners[v];
        this.pos[(i * 4 + v) * 3] = p.pos.x + ax.x * cx + ay.x * cy;
        this.pos[(i * 4 + v) * 3 + 1] = p.pos.y + ax.y * cx + ay.y * cy;
        this.pos[(i * 4 + v) * 3 + 2] = p.pos.z + ax.z * cx + ay.z * cy;
      }
      seqColor(p.colors, k, c);
      const alpha = 1 - seqNum(p.spec.transparency ?? 0, k);
      for (let v = 0; v < 4; v++) {
        const b = (i * 4 + v) * 4;
        this.col[b] = c.r;
        this.col[b + 1] = c.g;
        this.col[b + 2] = c.b;
        this.col[b + 3] = Math.max(0, alpha) * p.alphaScale;
      }
    }
    this.geo.setDrawRange(0, n * 6);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

// ------------------------------------------------------------------------- VFX manager
export class VFX {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.opts = opts;
    this.R = rng(1234);
    this.time = 0;
    this.tex = {
      spark: sparkSprite(),
      glow: glowSprite(),
      streak: streakSprite(),
      smoke: smokeSprite(),
      ring: ringSprite(),
    };
    this.pools = {};
    this.items = [];
    this.ribbons = [];
    this.ghosts = [];
    this.lights = [];
    for (let i = 0; i < (opts.lights ?? 4); i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.userData.free = true;
      scene.add(l);
      this.lights.push(l);
    }
    this.colorCache = new Map();
    this.crackTex = crackTexture();
    this.rockGeo = new THREE.IcosahedronGeometry(0.5, 0);
    this.rockMat = new THREE.MeshStandardMaterial({ color: 0x77706a, roughness: 0.95, flatShading: true });
    this.ghostMat = new THREE.MeshBasicMaterial({
      color: 0x58cfff,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
  }

  pool(textureName, additive) {
    const key = textureName + (additive ? '+' : '');
    if (!this.pools[key]) this.pools[key] = new ParticlePool(this.scene, this.tex[textureName], additive);
    return this.pools[key];
  }

  colors(spec, override) {
    const key = spec === override ? spec : JSON.stringify(override ?? spec.color);
    if (!this.colorCache.has(key)) this.colorCache.set(key, prepColors(override ?? spec.color));
    return this.colorCache.get(key);
  }

  /**
   * Emit `count` particles of a preset at `origin` with emission direction `dir` (default +Y of
   * `basis`). `basis` is a quaternion used for ring/sphere shapes.
   */
  emit(presetName, count, origin, { dir = null, basis = null, sizeScale = 1, speedScale = 1, color = null, alphaScale = 1 } = {}) {
    const spec = PARTICLES[presetName];
    const R = this.R;
    const pool = this.pool(spec.texture, (spec.lightEmission ?? 0) >= 0.5);
    const q = basis ?? new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const baseDir = (dir ? dir.clone() : up).normalize();
    for (let i = 0; i < count; i++) {
      const pos = new THREE.Vector3().copy(origin);
      const vdir = new THREE.Vector3();
      if (spec.shape === 'ring') {
        const a = R() * Math.PI * 2;
        const radial = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).applyQuaternion(q);
        pos.addScaledVector(radial, spec.shapeRadius ?? 0.5);
        coneDir(R, radial, spec.spread ?? 0, vdir);
      } else if (spec.shape === 'sphere') {
        const s = coneDir(R, new THREE.Vector3(0, 1, 0), 180, new THREE.Vector3());
        pos.addScaledVector(s, (spec.shapeRadius ?? 1) * sizeScale);
        vdir.copy(s).multiplyScalar(spec.inward ? -1 : 1);
      } else {
        coneDir(R, baseDir, spec.spread ?? 0, vdir);
      }
      const speed = (spec.speed[0] + (spec.speed[1] - spec.speed[0]) * R()) * speedScale;
      const life = spec.lifetime[0] + (spec.lifetime[1] - spec.lifetime[0]) * R();
      pool.list.push({
        spec,
        pos,
        vel: vdir.multiplyScalar(speed),
        acc: new THREE.Vector3(...(spec.acceleration ?? [0, 0, 0])),
        drag: spec.drag ?? 0,
        age: 0,
        life,
        rot: spec.rotation ? spec.rotation[0] + (spec.rotation[1] - spec.rotation[0]) * R() : 0,
        rotSpeed: spec.rotSpeed ? spec.rotSpeed[0] + (spec.rotSpeed[1] - spec.rotSpeed[0]) * R() : 0,
        sizeScale,
        colors: this.colors(spec, color ? [[0, color], [1, color]] : null),
        alphaScale,
      });
    }
  }

  /** Play a named recipe at a frame. dirs: { slash, normal, forward } world vectors. */
  play(name, origin, { basis = null, slash = null, normal = null, forward = null, scale = 1 } = {}) {
    const recipe = EFFECTS[name];
    if (!recipe) throw new Error('no effect ' + name);
    const q = basis ?? new THREE.Quaternion();
    for (const e of recipe) {
      const s = scale * (e.sizeScale ?? 1);
      if (e.type === 'particles') {
        let dir = null;
        if (e.align === 'slash' && slash) dir = slash;
        if (e.align === 'normal' && normal) dir = normal;
        let basisQ = q;
        if (e.plane === 'forward' && forward) {
          basisQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), forward.clone().normalize());
        }
        this.emit(e.preset, e.count, origin, { dir, basis: basisQ, sizeScale: s, speedScale: e.speedScale ?? 1, color: e.color ?? null });
      } else if (e.type === 'crossFlash') {
        this.crossFlash(origin, e.size * scale, e.width * scale, e.duration, e.color);
      } else if (e.type === 'ring') {
        let n = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
        if (e.face === 'slash' && slash) n = slash.clone();
        if (e.face === 'forward' && forward) n = forward.clone();
        if (e.face === 'normal' && normal) n = normal.clone();
        this.ring(origin, n, e.radius0 * scale, e.radius1 * scale, e.thickness * scale, e.duration, e.color, e.face === 'camera');
      } else if (e.type === 'rocks') {
        this.rocks(origin, e.count, e.radius * scale, e.size, e.duration);
      } else if (e.type === 'cracks') {
        this.cracks(origin, e.radius * scale, e.duration);
      } else if (e.type === 'light') {
        this.light(origin, e.color, e.range * scale, e.brightness, e.duration);
      } else if (e.type === 'glint') {
        this.glint(origin, e.size * scale, e.duration, e.color);
      }
    }
  }

  crossFlash(origin, size, width, duration, color) {
    const mat = new THREE.MeshBasicMaterial({
      map: this.tex.streak,
      color: new THREE.Color(color),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const g = new THREE.Group();
    const a0 = this.R() * Math.PI;
    for (const a of [a0, a0 + Math.PI / 2 + (this.R() - 0.5) * 0.5]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(width, size), mat);
      m.rotation.z = a;
      g.add(m);
    }
    g.position.copy(origin);
    g.renderOrder = 30;
    this.scene.add(g);
    this.items.push({ kind: 'billboard', obj: g, mat, age: 0, life: duration, update: (k) => {
      const s = k < 0.25 ? k / 0.25 : 1 + (k - 0.25) * 0.4;
      g.scale.set(1, s, 1);
      mat.opacity = k < 0.25 ? 1 : Math.pow(1 - (k - 0.25) / 0.75, 1.5);
    } });
  }

  glint(origin, size, duration, color) {
    const mat = new THREE.MeshBasicMaterial({
      map: this.tex.spark,
      color: new THREE.Color(color),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    m.position.copy(origin);
    m.renderOrder = 30;
    this.scene.add(m);
    this.items.push({ kind: 'billboard', obj: m, mat, age: 0, life: duration, update: (k) => {
      const s = Math.sin(Math.PI * Math.min(k * 1.2, 1));
      m.scale.setScalar(Math.max(s, 0.001));
      m.rotation.z = k * 1.5;
      mat.opacity = s;
    } });
  }

  ring(origin, normal, r0, r1, thickness, duration, color, billboard = false) {
    const mat = new THREE.MeshBasicMaterial({
      map: this.tex.ring,
      color: new THREE.Color(color),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    m.position.copy(origin);
    if (!billboard) m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
    m.renderOrder = 25;
    this.scene.add(m);
    this.items.push({ kind: billboard ? 'billboard' : 'mesh', obj: m, mat, age: 0, life: duration, update: (k) => {
      const e = 1 - Math.pow(1 - k, 3);
      const r = r0 + (r1 - r0) * e;
      m.scale.set(r, r, 1);
      mat.opacity = Math.pow(1 - k, 1.4) * Math.min(1, thickness * 1.8);
    } });
  }

  rocks(origin, count, radius, size, duration) {
    const R = this.R;
    const group = new THREE.Group();
    group.position.copy(origin);
    const rocks = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + (R() - 0.5) * 0.4;
      const s = size[0] + (size[1] - size[0]) * R();
      const m = new THREE.Mesh(this.rockGeo, this.rockMat);
      m.scale.set(s * (0.8 + R() * 0.6), s * (1.0 + R() * 0.8), s * (0.8 + R() * 0.6));
      const r = radius * (0.85 + R() * 0.3);
      m.position.set(Math.cos(a) * r, -s, Math.sin(a) * r);
      // tilt outward like the ground was blasted open
      m.lookAt(new THREE.Vector3(Math.cos(a) * r * 3, s * 2.2, Math.sin(a) * r * 3));
      m.rotateX(Math.PI / 2);
      m.rotateY(R() * Math.PI);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
      rocks.push({ m, s, delay: (r / radius) * 0.05 });
    }
    this.scene.add(group);
    this.items.push({ kind: 'mesh', obj: group, age: 0, life: duration, update: (k, age) => {
      for (const rk of rocks) {
        const t = Math.max(0, age - rk.delay);
        const pop = Math.min(t / 0.07, 1);
        const sink = Math.max(0, (age - (duration - 0.6)) / 0.6);
        rk.m.position.y = -rk.s + rk.s * 1.25 * (1 - Math.pow(1 - pop, 3)) - sink * rk.s * 1.4;
      }
    } });
  }

  cracks(origin, radius, duration) {
    const mat = new THREE.MeshBasicMaterial({
      map: this.crackTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), mat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = this.R() * Math.PI * 2;
    m.position.set(origin.x, origin.y + 0.02, origin.z);
    m.renderOrder = 5;
    this.scene.add(m);
    this.items.push({ kind: 'mesh', obj: m, mat, age: 0, life: duration, update: (k) => {
      const grow = Math.min(k * duration / 0.06, 1);
      m.scale.setScalar(0.4 + 0.6 * grow);
      mat.opacity = k < 0.7 ? 0.95 : 0.95 * (1 - (k - 0.7) / 0.3);
    } });
  }

  light(origin, color, range, brightness, duration) {
    const l = this.lights.find((x) => x.userData.free) ?? this.lights[0];
    if (!l) return;
    l.userData.free = false;
    l.position.copy(origin);
    l.color.set(color);
    l.distance = range;
    this.items.push({ kind: 'light', obj: l, age: 0, life: duration, update: (k) => {
      l.intensity = brightness * 6 * Math.pow(1 - k, 2);
    }, done: () => {
      l.intensity = 0;
      l.userData.free = true;
    } });
  }

  // Ghost copy of an avatar at its current pose.
  afterimage(avatar, { life = 0.32, color = 0x58cfff, opacity = 0.42 } = {}) {
    avatar.root.updateMatrixWorld(true);
    const mat = this.ghostMat.clone();
    mat.color.set(color);
    const g = new THREE.Group();
    avatar.root.traverse((o) => {
      if (o.isMesh && o.visible && o.material !== undefined && !o.userData.noGhost) {
        const m = new THREE.Mesh(o.geometry, mat);
        o.matrixWorld.decompose(m.position, m.quaternion, m.scale);
        g.add(m);
      }
    });
    g.renderOrder = 15;
    this.scene.add(g);
    this.items.push({ kind: 'mesh', obj: g, mat, age: 0, life, update: (k) => {
      mat.opacity = opacity * Math.pow(1 - k, 1.6);
    } });
  }

  // ------------------------------------------------------------------- swing ribbons
  // Starts a ribbon for a baked swing. `frameAt(t)` returns { pos, quat } of the action's start
  // frame (root part at clip time 0) so samples land in world space.
  startRibbon(swing, startFrame, clipTimeFn, { heavy = false, follow = null } = {}) {
    const rb = { swing, startFrame, clipTime: clipTimeFn, revealed: [], heavy, done: false, follow };
    const max = swing.points.length;
    const R = RIBBON_ROWS.length;
    rb.pos = new Float32Array(max * R * 3);
    rb.col = new Float32Array(max * R * 4);
    const idx = [];
    for (let i = 0; i < max - 1; i++) {
      for (let r = 0; r < R - 1; r++) {
        const a = i * R + r;
        const b = (i + 1) * R + r;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(rb.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(rb.col, 4).setUsage(THREE.DynamicDrawUsage));
    rb.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    rb.mesh.frustumCulled = false;
    rb.mesh.renderOrder = 22;
    this.scene.add(rb.mesh);
    this.ribbons.push(rb);
    return rb;
  }

  updateRibbons() {
    const cols = RIBBON_ROWS.map((r) => new THREE.Color(RIBBON[r.color]));
    const tail = new THREE.Color(RIBBON.tailColor);
    const R = RIBBON_ROWS.length;
    const c = new THREE.Color();
    const inner = new THREE.Vector3();
    const v = new THREE.Vector3();
    for (const rb of this.ribbons) {
      const life = RIBBON.life * (rb.heavy ? 1.5 : 1);
      const t = rb.clipTime();
      const pts = rb.swing.points;
      while (rb.revealed.length < pts.length && pts[rb.revealed.length].t <= t) {
        const p = pts[rb.revealed.length];
        const toWorld = (x) => new THREE.Vector3(...x).applyQuaternion(rb.startFrame.quat).add(rb.startFrame.pos);
        rb.revealed.push({ base: toWorld(p.base), tip: toWorld(p.tip), t: p.t, lb: p.base, lt: p.tip });
      }
      if (rb.follow) {
        // Viewmodel ribbons live in camera space and move with the view.
        const f = rb.follow();
        for (const r of rb.revealed) {
          r.base.set(...r.lb).applyQuaternion(f.quat).add(f.pos);
          r.tip.set(...r.lt).applyQuaternion(f.quat).add(f.pos);
        }
      }
      const n = rb.revealed.length;
      for (let i = 0; i < n; i++) {
        const r = rb.revealed[i];
        const k = Math.min(Math.max(0, t - r.t) / life, 1);
        const fade = Math.pow(1 - k, 2.4);
        // Crescent: older samples thin out toward the cutting edge.
        const width = Math.max(0.06, Math.pow(1 - k, 0.9));
        inner.lerpVectors(r.tip, r.base, width);
        for (let row = 0; row < R; row++) {
          const spec = RIBBON_ROWS[row];
          v.lerpVectors(inner, r.tip, spec.at);
          const vi = i * R + row;
          rb.pos[vi * 3] = v.x;
          rb.pos[vi * 3 + 1] = v.y;
          rb.pos[vi * 3 + 2] = v.z;
          c.copy(cols[row]).lerp(tail, k * 0.8);
          const boost = rb.heavy ? 1.25 : 1;
          rb.col[vi * 4] = c.r * boost;
          rb.col[vi * 4 + 1] = c.g * boost;
          rb.col[vi * 4 + 2] = c.b * boost;
          rb.col[vi * 4 + 3] = spec.alpha * fade;
        }
      }
      rb.mesh.geometry.setDrawRange(0, Math.max(0, n - 1) * (R - 1) * 6);
      rb.mesh.geometry.attributes.position.needsUpdate = true;
      rb.mesh.geometry.attributes.color.needsUpdate = true;
      const last = rb.revealed[n - 1];
      if (n === pts.length && last && t - last.t > life * 1.2) rb.done = true;
    }
    for (const rb of this.ribbons.filter((r) => r.done)) {
      this.scene.remove(rb.mesh);
      rb.mesh.geometry.dispose();
    }
    this.ribbons = this.ribbons.filter((r) => !r.done);
  }

  update(dt, camera) {
    this.time += dt;
    for (const p of Object.values(this.pools)) p.update(dt);
    for (const it of this.items) {
      it.age += dt;
      const k = Math.min(it.age / it.life, 1);
      it.update(k, it.age);
      if (it.kind === 'billboard') it.obj.quaternion.copy(camera.quaternion);
    }
    for (const it of this.items.filter((x) => x.age >= x.life)) {
      if (it.done) it.done();
      else this.scene.remove(it.obj);
    }
    this.items = this.items.filter((x) => x.age < x.life);
    this.updateRibbons();
  }

  render(camera) {
    for (const p of Object.values(this.pools)) p.render(camera);
  }
}
