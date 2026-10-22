// Video director: deterministic fixed-step simulation of a scripted sequence, cinematic camera,
// camera FX (shake, FOV kick, impact frames, flash, slow-mo) and a 2D HUD.
import * as THREE from 'three';
import { LAYOUT } from '/anim/layout.mjs';
import { SHAKES } from '/anim/vfx.mjs';
import { Actor, fwdOf, rightOf } from './actor.js';
import { createPost } from './post.js';
import { VFX } from './vfx.js';
import { buildWorld } from './world.js';
import { rng } from './rng.js';

const ROOT_H = 2.83;

// ----------------------------------------------------------------------------- camera FX
class CameraFX {
  constructor(app) {
    this.app = app;
    this.shakes = [];
    this.kicks = [];
    this.impact = 0;
    this.flashV = 0;
    this.flashColor = new THREE.Color(1, 1, 1);
    this.slow = null;
    this.R = rng(99);
    this.aberration = 0;
  }

  // Shakes only apply when the source actor is the camera subject (as in-game: local player).
  shake(name, actor = null, scale = 1) {
    if (actor && this.app.subject && actor !== this.app.subject && !this.app.shakeAll) scale *= 0.35;
    const [amp, freq, dur, rot] = SHAKES[name];
    const ph = [this.R() * 100, this.R() * 100, this.R() * 100];
    this.shakes.push({ amp: amp * scale, freq, dur, rot: rot * scale, age: 0, ph });
    this.aberration = Math.max(this.aberration, 0.6 * scale * (amp / 0.45));
  }

  fovKick(deg, dur = 0.3, actor = null) {
    if (actor && this.app.subject && actor !== this.app.subject) return;
    this.kicks.push({ deg, dur, age: 0 });
  }

  // One impact frame per strike: hits landing in the same beat don't re-trigger it.
  impactFrame(dur) {
    if (this.impactCooldown > 0 && this.impact <= 0) return;
    this.impact = Math.max(this.impact, dur);
    this.impactCooldown = dur + 0.35;
  }

  flash(strength, color = '#ffffff') {
    this.flashV = Math.max(this.flashV, strength);
    this.flashColor.set(color);
  }

  slowmo(scale, dur) {
    this.slow = { scale, dur, age: 0 };
  }

  get timeScale() {
    if (!this.slow) return 1;
    const k = this.slow.age / this.slow.dur;
    if (k >= 1) return 1;
    // hold, then ease back to real time
    return k < 0.6 ? this.slow.scale : this.slow.scale + (1 - this.slow.scale) * ((k - 0.6) / 0.4);
  }

  update(dt) {
    const off = new THREE.Vector3();
    const rot = new THREE.Euler();
    for (const s of this.shakes) {
      s.age += dt;
      const k = Math.max(0, 1 - s.age / s.dur);
      const e = k * k;
      const t = s.age * s.freq * Math.PI * 2;
      off.x += Math.sin(t + s.ph[0]) * s.amp * e;
      off.y += Math.sin(t * 1.13 + s.ph[1]) * s.amp * e;
      rot.z += (Math.sin(t * 0.9 + s.ph[2]) * s.rot * e * Math.PI) / 180;
      rot.x += (Math.sin(t * 1.07 + s.ph[0]) * s.rot * 0.5 * e * Math.PI) / 180;
    }
    this.shakes = this.shakes.filter((s) => s.age < s.dur);
    let fov = 0;
    for (const k of this.kicks) {
      k.age += dt;
      const x = k.age / k.dur;
      fov += k.deg * (x < 0.15 ? x / 0.15 : Math.pow(1 - (x - 0.15) / 0.85, 2));
    }
    this.kicks = this.kicks.filter((k) => k.age < k.dur);
    if (this.slow) {
      this.slow.age += dt;
      if (this.slow.age >= this.slow.dur) this.slow = null;
    }
    const impact = this.impact > 0 ? 1 : 0;
    this.impact = Math.max(0, this.impact - dt);
    this.impactCooldown = Math.max(0, (this.impactCooldown ?? 0) - dt);
    const flash = this.flashV;
    this.flashV = Math.max(0, this.flashV - dt * 3.2);
    this.aberration = Math.max(0, this.aberration - dt * 2.5);
    return { off, rot, fov, impact, flash, aberration: this.aberration };
  }
}

// ----------------------------------------------------------------------------- HUD
class HUD {
  constructor(w, h) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.g = this.canvas.getContext('2d');
    this.w = w;
    this.h = h;
    this.captions = [];
    this.speedLines = 0;
    this.letterbox = 0;
    this.R = rng(7);
    this.lines = Array.from({ length: 70 }, () => ({ a: this.R() * Math.PI * 2, l: 0.2 + this.R() * 0.35, w: 1 + this.R() * 3, s: this.R() }));
    this.badge = null;
    this.prompts = [];
    this.crosshair = false;
  }

  caption(title, sub, t, dur = 3.2, opts = {}) {
    this.captions.push({ title, sub, t, dur, ...opts });
  }

  draw(src, time) {
    const { g, w, h } = this;
    g.drawImage(src, 0, 0, w, h);
    const S = h / 720;
    // speed lines (anime radial streaks)
    if (this.speedLines > 0.01) {
      g.save();
      g.translate(w / 2, h / 2);
      for (const ln of this.lines) {
        const flick = (Math.sin(time * 40 + ln.s * 50) + 1) / 2;
        if (flick < 0.35) continue;
        const r0 = (0.42 + ln.s * 0.25) * Math.hypot(w, h) * 0.5;
        const r1 = r0 + ln.l * Math.hypot(w, h) * 0.5;
        g.strokeStyle = `rgba(255,255,255,${0.18 * this.speedLines * flick})`;
        g.lineWidth = ln.w * S;
        g.beginPath();
        g.moveTo(Math.cos(ln.a) * r0, Math.sin(ln.a) * r0);
        g.lineTo(Math.cos(ln.a) * r1, Math.sin(ln.a) * r1);
        g.stroke();
      }
      g.restore();
    }
    if (this.letterbox > 0) {
      g.fillStyle = '#000';
      const bh = this.letterbox * h * 0.1;
      g.fillRect(0, 0, w, bh);
      g.fillRect(0, h - bh, w, bh);
    }
    if (this.crosshair) {
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.beginPath();
      g.arc(w / 2, h / 2, 2.2 * S, 0, Math.PI * 2);
      g.fill();
    }
    for (const c of this.captions) {
      const age = time - c.t;
      if (age < 0 || age > c.dur) continue;
      const inK = Math.min(age / 0.35, 1);
      const outK = Math.min((c.dur - age) / 0.35, 1);
      const a = Math.min(inK, outK);
      const ease = 1 - Math.pow(1 - inK, 3);
      const x = (c.x ?? 64) * S - (1 - ease) * 40 * S;
      const y = (c.y ?? 600) * S;
      g.save();
      g.globalAlpha = a;
      g.fillStyle = 'rgba(8,12,22,0.55)';
      g.fillRect(x - 18 * S, y - 50 * S, (c.boxW ?? 520) * S, (c.sub ? 82 : 60) * S);
      g.fillStyle = '#46c8ff';
      g.fillRect(x - 18 * S, y - 50 * S, 5 * S, (c.sub ? 82 : 60) * S);
      g.font = `700 ${40 * S}px Rajdhani, Inter, sans-serif`;
      g.fillStyle = '#ffffff';
      g.fillText(c.title, x, y);
      if (c.sub) {
        g.font = `600 ${19 * S}px Inter, sans-serif`;
        g.fillStyle = 'rgba(214,232,255,0.92)';
        g.fillText(c.sub, x, y + 26 * S);
      }
      g.restore();
    }
    let slot = 0;
    for (const p of this.prompts) {
      const age = time - p.t;
      if (age < 0 || age > p.dur) continue;
      const a = Math.min(age / 0.15, (p.dur - age) / 0.2, 1);
      const x = (p.x ?? 1060) * S;
      const y = ((p.y ?? 80) + slot * 42) * S;
      slot += 1;
      g.save();
      g.globalAlpha = a;
      g.font = `700 ${22 * S}px Rajdhani, Inter, sans-serif`;
      const tw = g.measureText(p.key).width + 20 * S;
      g.fillStyle = 'rgba(255,255,255,0.92)';
      g.fillRect(x, y - 24 * S, tw, 32 * S);
      g.fillStyle = '#0b1220';
      g.fillText(p.key, x + 10 * S, y);
      g.font = `600 ${19 * S}px Inter, sans-serif`;
      g.fillStyle = '#ffffff';
      g.fillText(p.label, x + tw + 10 * S, y - 2 * S);
      g.restore();
    }
    if (this.badge) {
      g.save();
      g.font = `700 ${18 * S}px Rajdhani, Inter, sans-serif`;
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.fillText(this.badge, 26 * S, 40 * S);
      g.fillStyle = '#46c8ff';
      g.fillRect(26 * S, 48 * S, 46 * S, 3 * S);
      g.restore();
    }
  }
}

// ----------------------------------------------------------------------------- App
export class App {
  constructor({ canvas, width, height, clips, fps = 60, opts = {} }) {
    this.opts = opts;
    this.width = width;
    this.height = height;
    this.fps = fps;
    this.dt = 1 / fps;
    this.clips = clips;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.shadowMap.enabled = opts.shadow !== 'none';
    renderer.shadowMap.type = opts.shadow === 'pcf' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.05, 2000);
    this.scene.add(this.camera);
    this.world = buildWorld(this.scene, renderer, opts);
    this.post = createPost(renderer, this.scene, this.camera, width, height, opts);
    if (opts.shadowSize) this.world.sun.shadow.mapSize.set(opts.shadowSize, opts.shadowSize);
    this.vfx = new VFX(this.scene, opts);
    if (opts.noEnv) this.scene.environment = null;
    this.fx = new CameraFX(this);
    this.hud = new HUD(width, height);
    this.actors = [];
    this.time = 0;
    this.frame = 0;
    this.events = [];
    this.shot = null;
    this.camState = { pos: new THREE.Vector3(0, 6, 12), look: new THREE.Vector3(0, 3, 0), fov: 60 };
    this.subject = null;
    this.viewmodel = null;
  }

  groundAt(x, z) {
    let y = 0;
    for (const b of LAYOUT.boxes) {
      const [cx, cy, cz] = b.center;
      const [sx, sy, sz] = b.size;
      if (Math.abs(x - cx) <= sx / 2 && Math.abs(z - cz) <= sz / 2) y = Math.max(y, cy + sy / 2);
    }
    return y;
  }

  actor(opts) {
    const a = new Actor(this, opts);
    this.actors.push(a);
    return a;
  }

  at(t, fn) {
    this.events.push({ t, fn });
    this.events.sort((a, b) => a.t - b.t);
  }

  // Fire `fn` once, the first step after `t0` where `cond()` is true.
  when(t0, cond, fn) {
    (this.watchers ??= []).push({ t0, cond, fn, done: false });
  }

  fadeTo(v, dur) {
    this.fadeAnim = { from: this.fade ?? 0, to: v, t: 0, dur };
  }

  // Camera shots: { t, type, ...params, blend }
  shots(list) {
    this.shotList = list.sort((a, b) => a.t - b.t);
  }

  currentShot() {
    let s = null;
    for (const sh of this.shotList ?? []) if (sh.t <= this.time) s = sh;
    return s;
  }

  shotTarget(sh) {
    const a = sh.actor;
    const out = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: sh.fov ?? 55 };
    const age = this.time - sh.t;
    if (sh.type === 'follow') {
      const yaw = sh.worldYaw !== undefined ? (sh.worldYaw * Math.PI) / 180 : a.yaw;
      const f = fwdOf(yaw);
      const r = rightOf(yaw);
      const [ox, oy, oz] = sh.offset;
      out.pos.copy(a.pos).addScaledVector(r, ox).addScaledVector(new THREE.Vector3(0, 1, 0), oy).addScaledVector(f, -oz);
      out.look.copy(a.pos).add(new THREE.Vector3(...(sh.look ?? [0, 0.8, 0])));
      if (sh.lead) out.look.addScaledVector(f, sh.lead);
    } else if (sh.type === 'orbit') {
      const c = sh.center ? new THREE.Vector3(...sh.center) : a.pos.clone();
      const ang = ((sh.angle + (sh.speed ?? 0) * age) * Math.PI) / 180;
      out.pos.set(c.x + Math.sin(ang) * sh.radius, c.y + sh.height, c.z + Math.cos(ang) * sh.radius);
      out.look.copy(c).add(new THREE.Vector3(...(sh.look ?? [0, 0.5, 0])));
    } else if (sh.type === 'fixed') {
      out.pos.set(...sh.pos);
      out.look.set(...sh.lookAt);
    } else if (sh.type === 'track') {
      out.pos.set(...sh.pos);
      out.look.copy(a.pos).add(new THREE.Vector3(...(sh.look ?? [0, 0.6, 0])));
    } else if (sh.type === 'dolly') {
      const k = Math.min(age / sh.dur, 1);
      const e = k * k * (3 - 2 * k);
      out.pos.set(...sh.from.map((v, i) => v + (sh.to[i] - v) * e));
      out.look.set(...sh.lookFrom.map((v, i) => v + (sh.lookTo[i] - v) * e));
    }
    return out;
  }

  updateCamera(dt) {
    const sh = this.currentShot();
    if (!sh) return;
    if (sh.type === 'fp') return this.updateFPCamera(dt, sh);
    const target = this.shotTarget(sh);
    const cut = this._lastShot !== sh && !sh.blend;
    if (this._lastShot !== sh) this._shotStart = this.time;
    this._lastShot = sh;
    const s = this.camState;
    if (cut) {
      s.pos.copy(target.pos);
      s.look.copy(target.look);
      s.fov = target.fov;
    } else {
      const k = 1 - Math.exp(-dt / (sh.smooth ?? 0.12));
      s.pos.lerp(target.pos, k);
      s.look.lerp(target.look, k);
      s.fov += (target.fov - s.fov) * k;
    }
    this.subject = sh.actor ?? this.subject;
    const fx = this.fx.update(dt);
    this.camera.position.copy(s.pos);
    this.camera.lookAt(s.look);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    this.camera.position.addScaledVector(right, fx.off.x).addScaledVector(up, fx.off.y);
    this.camera.rotateZ(fx.rot.z);
    this.camera.rotateX(fx.rot.x);
    this.camera.fov = s.fov + fx.fov;
    this.camera.updateProjectionMatrix();
    this.applyGrade(fx);
  }

  applyGrade(fx) {
    const u = this.post.grade.uniforms;
    u.impact.value = fx.impact;
    u.flash.value = Math.min(fx.flash, 0.85);
    u.flashColor.value.copy(this.fx.flashColor);
    u.aberration.value = fx.aberration;
    u.time.value = this.time;
    u.fade.value = this.fade ?? 0;
  }

  updateFPCamera(dt, sh) {
    this.viewmodel?.updateCamera(dt, sh);
    const fx = this.fx.update(dt);
    this.viewmodel?.applyShake(fx);
    this.applyGrade(fx);
  }

  step() {
    const dt = this.dt;
    const ts = this.fx.timeScale;
    const sdt = dt * ts;
    while (this.events.length && this.events[0].t <= this.time + 1e-9) this.events.shift().fn();
    for (const w of this.watchers ?? []) {
      if (!w.done && this.time >= w.t0 && w.cond()) {
        w.done = true;
        w.fn();
      }
    }
    if (this.fadeAnim) {
      const f = this.fadeAnim;
      f.t += dt;
      const k = Math.min(f.t / f.dur, 1);
      this.fade = f.from + (f.to - f.from) * k;
      if (k >= 1) this.fadeAnim = null;
    }
    // Anime speed lines follow the subject's speed (sprint, dash, slide, lunge).
    const subj = this.subject;
    if (subj) {
      const fast = subj.speed > 30 || subj.mode === 'dash' || (subj.mode === 'flight' && subj === this.speedSubject);
      const target = this.noSpeedLines ? 0 : fast ? 1 : subj.speed > 23 ? 0.45 : 0;
      this.hud.speedLines += (target - this.hud.speedLines) * Math.min(1, dt * 8);
    }
    for (const a of this.actors) a.update(sdt);
    this.viewmodel?.update(sdt);
    this.vfx.update(sdt, this.camera);
    this.updateCamera(dt);
    this.time += dt;
    this.frame += 1;
  }

  render() {
    const focus = this.subject ? this.subject.pos.clone().setY(0) : new THREE.Vector3();
    this.world.followShadow(focus);
    this.vfx.render(this.camera);
    this.post.composer.render();
    this.hud.draw(this.renderer.domElement, this.time);
    return this.hud.canvas;
  }
}
