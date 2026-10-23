// Preview actor: avatar + CharacterAnimator + a kinematic movement/combat state machine that
// mirrors the Luau MovementController/CombatController closely enough to preview gameplay.
import * as THREE from 'three';
import { CharacterAnimator } from '/anim/core/character.mjs';
import { evalChannel } from '/anim/core/curve.mjs';
import { R15 } from '/anim/core/rig.mjs';
import { ATTACKS, DEFENSE, MOVE } from '/anim/tuning.mjs';
import { buildAvatar, STYLES } from './avatar.js';
import { ClothTails } from './cloth.js';

const ROOT_H = 2.83; // HumanoidRootPart centre above the ground
const UP = new THREE.Vector3(0, 1, 0);

export const fwdOf = (yaw) => new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
export const rightOf = (yaw) => new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
const yawOf = (v) => Math.atan2(-v.x, -v.z);
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

function sampleRootMotion(clip, t) {
  const ch = clip.tracks.RootMotion;
  if (!ch) return null;
  const tt = Math.min(Math.max(t, 0), clip.length);
  return new THREE.Vector3(ch.px ? evalChannel(ch.px, tt) : 0, ch.py ? evalChannel(ch.py, tt) : 0, ch.pz ? evalChannel(ch.pz, tt) : 0);
}

export class Actor {
  constructor(app, { name, style = 'hero', armed = false, position = [0, 0, 0], yaw = 0, weapon = true }) {
    this.app = app;
    this.name = name;
    this.style = style;
    this.avatar = buildAvatar({ rig: R15, style: STYLES[style], weapon, scabbard: weapon });
    app.scene.add(this.avatar.root);
    const look = STYLES[style];
    this.cloth = look.cloth ? new ClothTails(this.avatar, { sash: look.sash, band: look.band ?? look.sash }, app.scene) : null;
    this.anim = new CharacterAnimator(app.clips);
    this.pos = new THREE.Vector3(position[0], position[1] + ROOT_H, position[2]);
    this.yaw = (yaw * Math.PI) / 180;
    this.vel = new THREE.Vector3();
    this.grounded = true;
    this.groundY = position[1];
    this.armed = armed;
    this.crouch = false;
    this.mode = 'ground';
    this.moveDir = null;
    this.targetSpeed = 0;
    this.faceTarget = null;
    this.timers = {};
    this.airDashes = MOVE.dash.airDashes;
    this.jumps = 0;
    this.blocking = false;
    this.blockStart = -1;
    this.hitTargets = new Set();
    this.pendingHits = [];
    this.flashT = 0;
    this.glow = 0.35;
    this.glowTarget = 0.35;
    this.afterimageT = 0;
    this.chargeT = 0;
    this.ribbonClocks = [];
    this.avatar.setWeaponAttach(armed ? 'hand' : 'sheath');
    this.anim.on((n, d, tr) => this.onEvent(n, d, tr));
    this.materials = [];
    this.avatar.root.traverse((o) => {
      if (o.isMesh && o.material && o.material.emissive && !this.materials.includes(o.material)) this.materials.push(o.material);
    });
  }

  get forward() {
    return fwdOf(this.yaw);
  }

  get right() {
    return rightOf(this.yaw);
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  partPos(part, local = [0, 0, 0]) {
    return this.avatar.worldPoint(part, new THREE.Vector3(...local));
  }

  // ------------------------------------------------------------------ commands
  move(dir, speed = MOVE.walkSpeed) {
    this.moveDir = dir ? dir.clone().setY(0).normalize() : null;
    this.targetSpeed = dir ? speed : 0;
  }

  face(yawDeg) {
    this.faceTarget = (yawDeg * Math.PI) / 180;
  }

  setArmed(on) {
    this.armed = on;
    this.avatar.setWeaponAttach(on ? 'hand' : 'sheath');
  }

  play(name, opts) {
    return this.anim.play(name, opts);
  }

  jump() {
    if (!this.grounded) return this.doubleJump();
    this.vel.y = MOVE.jumpVelocity;
    this.grounded = false;
    this.mode = 'air';
    this.jumps = 1;
    this.play('JumpStart', { fadeIn: 0.05 });
    this.app.vfx.emit('FootDust', 4, this.feetPos());
  }

  doubleJump() {
    this.vel.y = MOVE.doubleJumpVelocity;
    this.jumps = 2;
    this.play('DoubleJump', { fadeIn: 0.05 });
  }

  dash(dir = 'Forward') {
    const air = !this.grounded;
    if (air && this.airDashes <= 0) return;
    if (air) this.airDashes -= 1;
    const f = this.forward;
    const r = this.right;
    const d = { Forward: f, Back: f.clone().negate(), Left: r.clone().negate(), Right: r }[dir];
    this.dashDir = d.clone();
    this.dashT = 0;
    this.mode = 'dash';
    this.dashAir = air;
    this.vel.y = air ? MOVE.airDash.upVelocity : 0;
    this.play(air ? 'AirDash' : `Dash${dir}`, { fadeIn: 0.04 });
    this.app.fx.fovKick(10, 0.35, this);
  }

  slide() {
    this.mode = 'slide';
    this.slideT = 0;
    const sp = Math.max(this.speed, MOVE.slide.boost);
    const dir = this.speed > 1 ? this.vel.clone().setY(0).normalize() : this.forward;
    this.vel.set(dir.x * sp, 0, dir.z * sp);
    const tr = this.play('SlideEnter', { fadeIn: 0.05, hold: true });
    this.slideEnter = tr;
  }

  wallRun(side, wallX, opts = {}) {
    this.mode = 'wallrun';
    this.wallSide = side;
    this.wallX = wallX;
    this.wallT = 0;
    this.vel.y = MOVE.wallRun.startUpVelocity;
    this.wallDir = opts.dir ?? this.forward;
    this.play(`WallRun${side}`, { fadeIn: 0.12 });
  }

  wallJump() {
    const side = this.wallSide;
    const away = side === 'Left' ? this.right : this.right.clone().negate();
    this.vel.copy(this.wallDir).multiplyScalar(MOVE.wallRun.speed * 0.8).addScaledVector(away, MOVE.wallRun.jumpOut);
    this.vel.y = MOVE.wallRun.jumpUp;
    this.mode = 'air';
    this.grounded = false;
    this.jumps = 1;
    this.airDashes = MOVE.dash.airDashes;
    this.play(`WallJump${side}`, { fadeIn: 0.05 });
    const foot = this.feetPos().addScaledVector(away, -1.5);
    this.app.vfx.play('WallKick', foot, { normal: away });
  }

  rootAction(name, { fadeIn = 0.08, speed = 1 } = {}) {
    const tr = this.play(name, { fadeIn, speed });
    this.mode = 'root';
    this.rootTrack = tr;
    this.rootStart = { pos: this.pos.clone(), yaw: this.yaw };
    this.vel.set(0, 0, 0);
    return tr;
  }

  attack(name) {
    const def = ATTACKS[name];
    if (!this.armed && name !== 'Draw') this.setArmed(true);
    this.hitTargets = new Set();
    this.currentAttack = def;
    this.blocking = false;
    const tr = this.rootAction(def.clip, { fadeIn: name === 'Light1' ? 0.06 : 0.05 });
    tr.attackName = name;
    this.attackTrack = tr;
    return tr;
  }

  charge() {
    this.setArmed(true);
    this.mode = 'charge';
    this.chargeT = 0;
    this.play('HeavyCharge', { fadeIn: 0.12 });
  }

  release() {
    this.chargeT = 0;
    this.glowTarget = 0.35;
    return this.attack('Heavy');
  }

  aerialSlam() {
    this.setArmed(true);
    this.mode = 'aerial';
    this.vel.set(this.vel.x * 0.3, ATTACKS.Aerial.diveVelocity * 0.35, this.vel.z * 0.3);
    this.play('AerialSlam', { fadeIn: 0.08 });
    this.app.vfx.play('DashBurst', this.pos.clone(), { forward: new THREE.Vector3(0, -1, 0) });
  }

  block(on) {
    if (on && !this.blocking) {
      this.blocking = true;
      this.blockStart = this.app.time;
      this.setArmed(true);
      this.play('Block', { fadeIn: 0.08 });
    } else if (!on && this.blocking) {
      this.blocking = false;
      this.anim.stopAction(0.15);
    }
  }

  // ------------------------------------------------------------------ helpers
  feetPos() {
    return new THREE.Vector3(this.pos.x, this.pos.y - ROOT_H + 0.05, this.pos.z);
  }

  actionTime() {
    return this.anim.action ? this.anim.action.time : 0;
  }

  flash(strength = 1) {
    this.flashT = 0.14 * strength;
  }

  // ------------------------------------------------------------------ events from animation
  onEvent(name, data, track) {
    const vfx = this.app.vfx;
    switch (name) {
      case 'WeaponAttach':
        // Initial events only matter for the draw/sheath clips; movement clips keep the current
        // weapon state, markers switch it.
        if (data.initial) {
          if (track.clip.name === 'Draw') this.avatar.setWeaponAttach('sheath');
          else if (track.clip.name === 'Sheath' || track.clip.group === 'combat') this.avatar.setWeaponAttach('hand');
        } else {
          this.avatar.setWeaponAttach(data.to);
          this.armed = data.to === 'hand';
        }
        break;
      case 'Footstep':
        if (data.speed > 19 && this.grounded) vfx.play('Footstep', this.partPos(`${data.foot}Foot`, [0, -0.15, 0]));
        break;
      case 'Stomp':
        vfx.emit('FootDust', 6, this.partPos(`${data.foot}Foot`, [0, -0.15, 0]), { sizeScale: 1.2 });
        this.app.fx.shake('Land', this, 0.5);
        break;
      case 'DoubleJumpBurst':
        vfx.play('DoubleJump', this.feetPos().add(new THREE.Vector3(0, 0.6, 0)));
        this.app.fx.fovKick(6, 0.3, this);
        break;
      case 'DashStart': {
        const p = this.pos.clone().addScaledVector(UP, -0.6);
        vfx.play('DashBurst', p, { forward: this.dashDir ? this.dashDir.clone().negate() : this.forward.clone().negate() });
        this.afterimageT = 0;
        break;
      }
      case 'DashBrake':
        if (this.grounded) vfx.emit('DustPuff', 6, this.feetPos(), { sizeScale: 0.8 });
        break;
      case 'SlideStart':
        vfx.play('SlideStart', this.feetPos());
        break;
      case 'HandPlant':
        vfx.play('HandPlant', this.partPos(data.hand === 'Both' ? 'RightHand' : `${data.hand}Hand`, [0, -0.15, 0]));
        break;
      case 'Land':
        if (data.strength === 'heavy') {
          vfx.play('LandHeavy', this.feetPos());
          this.app.fx.shake('Heavy', this);
        } else if (data.strength === 'roll') {
          vfx.play('Land', this.feetPos());
        } else vfx.play('Land', this.feetPos());
        break;
      case 'SwingStart': {
        const clip = track.clip;
        const swing = (clip.swings ?? []).find((s) => Math.abs(s.t0 - data.t) < 1e-4);
        if (swing) {
          const startFrame = {
            pos: this.rootStart ? this.rootStart.pos.clone() : this.pos.clone(),
            quat: new THREE.Quaternion().setFromAxisAngle(UP, this.rootStart ? this.rootStart.yaw : this.yaw),
          };
          const clock = { t: track.time, track };
          this.ribbonClocks.push(clock);
          if (!this.fpMode) vfx.startRibbon(swing, startFrame, () => clock.t, { heavy: /Spin|Overhead|Thrust/.test(swing.kind) });
          this.currentSwing = { swing, startFrame };
        }
        this.glowTarget = 2.6;
        break;
      }
      case 'SwingEnd':
        this.glowTarget = 0.35;
        break;
      case 'HitStart':
        this.scheduleHits(track, data);
        break;
      case 'HeavyImpact':
      case 'SlamImpact': {
        const tip = this.avatar.katana.group.localToWorld(this.avatar.katana.points.tip.clone());
        const ground = new THREE.Vector3(tip.x, this.groundY, tip.z);
        if (name === 'SlamImpact') ground.set(this.pos.x, this.groundY, this.pos.z).addScaledVector(this.forward, 1.5);
        vfx.play(name, ground);
        this.app.fx.shake('Heavy', this, 1.2);
        this.app.fx.impactFrame(0.07);
        this.app.fx.flash(0.35, '#dff6ff');
        const def = ATTACKS[name === 'SlamImpact' ? 'Aerial' : 'Heavy'];
        this.radialHits(ground, def.radius ?? 9, def);
        break;
      }
      case 'BlockImpact':
        break;
      case 'BodyImpact':
        vfx.play('Land', this.feetPos());
        vfx.emit('DustPuff', 5, this.pos.clone().setY(this.groundY + 0.2), { sizeScale: 1.2 });
        break;
      case 'KipUp':
        vfx.emit('DustPuff', 4, this.feetPos(), { sizeScale: 0.8 });
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ hits (attacker side)
  scheduleHits(track, marker) {
    const def = this.currentAttack;
    if (!def || !this.currentSwing) return;
    const finisher = !!marker.finisher;
    const box = def.hitbox;
    const victims = this.app.actors.filter((a) => a !== this && !a.dead && !this.hitTargets.has(a.name + (finisher ? '!' : '')));
    for (const v of victims) {
      const rel = v.pos.clone().sub(this.pos);
      const yaw = this.rootStart ? this.rootStart.yaw : this.yaw;
      const lx = rel.dot(rightOf(yaw));
      const lz = -rel.dot(fwdOf(yaw));
      const ly = rel.y;
      if (!box) continue;
      if (Math.abs(lx - box.offset[0]) > box.size[0] / 2 + 1) continue;
      if (Math.abs(lz - box.offset[2]) > box.size[2] / 2 + 1) continue;
      if (Math.abs(ly - box.offset[1]) > box.size[1] / 2 + 2) continue;
      // Find the swing sample where the blade passes closest to the victim's chest.
      const { swing, startFrame } = this.currentSwing;
      const chest = v.pos.clone().add(new THREE.Vector3(0, 0.6, 0));
      let best = null;
      for (let i = 0; i < swing.points.length; i++) {
        const p = swing.points[i];
        if (p.t < track.time - 0.02) continue;
        const base = new THREE.Vector3(...p.base).applyQuaternion(startFrame.quat).add(startFrame.pos);
        const tip = new THREE.Vector3(...p.tip).applyQuaternion(startFrame.quat).add(startFrame.pos);
        const seg = new THREE.Line3(base, tip);
        const cp = seg.closestPointToPoint(chest, true, new THREE.Vector3());
        const d = cp.distanceTo(chest);
        if (!best || d < best.d) {
          const nxt = swing.points[Math.min(i + 1, swing.points.length - 1)];
          const prv = swing.points[Math.max(i - 1, 0)];
          const dir = new THREE.Vector3(...nxt.tip).sub(new THREE.Vector3(...prv.tip)).applyQuaternion(startFrame.quat).normalize();
          best = { d, t: p.t, point: cp, dir };
        }
      }
      if (!best) continue;
      this.hitTargets.add(v.name + (finisher ? '!' : ''));
      this.pendingHits.push({ victim: v, at: best.t, point: best.point, dir: best.dir, finisher, def, track });
    }
  }

  processPendingHits() {
    const keep = [];
    for (const h of this.pendingHits) {
      if (h.track.time >= h.at || h.track.done) this.applyHit(h);
      else keep.push(h);
    }
    this.pendingHits = keep;
  }

  applyHit(h) {
    const { victim, def } = h;
    const fin = h.finisher && def.finisher ? { ...def, ...def.finisher } : def;
    const point = h.point.clone().lerp(victim.pos.clone().add(new THREE.Vector3(0, 0.5, 0)), 0.5);
    const result = victim.receiveHit(this, { ...fin, point, dir: h.dir, finisher: h.finisher || !!def.knockback });
    if (result === 'parried' || result === 'blocked') return;
    this.app.vfx.play(fin.effect ?? 'Hit', point, { slash: h.dir, normal: this.forward });
    this.anim.hitStop(fin.hitStop ?? 0.07, 0);
    this.app.fx.shake(fin.shake ?? 'Light', this);
    if (fin.impactFrame) this.app.fx.impactFrame(fin.impactFrame);
    if (h.finisher) this.app.fx.flash(0.25, '#e8f8ff');
  }

  radialHits(center, radius, def) {
    for (const v of this.app.actors) {
      if (v === this || v.dead) continue;
      const d = v.pos.clone().setY(center.y).distanceTo(center);
      if (d > radius) continue;
      const dir = v.pos.clone().sub(center).setY(0).normalize();
      v.receiveHit(this, { ...def, point: v.pos.clone(), dir, finisher: true, from: center });
      this.app.vfx.play('Hit', v.pos.clone().add(new THREE.Vector3(0, 0.4, 0)), { slash: dir });
    }
  }

  // ------------------------------------------------------------------ hits (victim side)
  receiveHit(attacker, info) {
    const toAttacker = attacker.pos.clone().sub(this.pos).setY(0).normalize();
    const facingDot = toAttacker.dot(this.forward);
    if (this.blocking && facingDot > 0.2 && !info.guardBreak) {
      const sinceBlock = this.app.time - this.blockStart;
      const contact = this.avatar.katana.group.localToWorld(this.avatar.katana.points.mid.clone());
      if (sinceBlock <= DEFENSE.parryWindow) {
        this.play('Parry', { fadeIn: 0.02 });
        this.blocking = false;
        this.app.vfx.play('Parry', contact, { normal: toAttacker });
        attacker.stagger('Parried');
        this.app.fx.slowmo(DEFENSE.parrySlowmo[0], DEFENSE.parrySlowmo[1]);
        this.app.fx.flash(0.16, '#fff2c8');
        this.app.fx.shake('Parry', this);
        this.app.fx.impactFrame(0.05);
        this.anim.hitStop(0.1, 0);
        attacker.anim.hitStop(0.1, 0.05);
        return 'parried';
      }
      this.play('BlockHit', { fadeIn: 0.02 });
      this.queueResume = { name: 'Block', at: this.app.time + 0.3 };
      this.vel.addScaledVector(toAttacker, -DEFENSE.blockPush);
      this.app.vfx.play('Block', contact, { normal: toAttacker });
      this.app.fx.shake('Light', this);
      this.anim.hitStop(0.06, 0.04);
      attacker.anim.hitStop(0.06, 0);
      return 'blocked';
    }
    if (this.blocking && info.guardBreak) {
      this.blocking = false;
      this.stagger('GuardBreak');
    }
    this.flash(1);
    this.anim.hitStop(info.hitStop ?? 0.07, 0.07);
    const away = toAttacker.clone().negate();
    if (info.knockback || info.finisher) {
      this.launch(away.multiplyScalar(info.knockback ?? 30), info.launch ?? 20);
      return 'hit';
    }
    if (info.launch) {
      this.launch(away.multiplyScalar(info.push ?? 4), info.launch);
      return 'hit';
    }
    const sideDot = toAttacker.dot(this.right);
    const flinch = facingDot > 0.5 ? 'HitFront' : facingDot < -0.5 ? 'HitBack' : sideDot > 0 ? 'HitRight' : 'HitLeft';
    this.play(flinch, { fadeIn: 0.02 });
    this.vel.addScaledVector(away, info.push ?? 6);
    this.stunT = info.stun ?? 0.4;
    return 'hit';
  }

  stagger(name) {
    this.rootAction(name, { fadeIn: 0.03 });
    this.stunT = 0.8;
  }

  launch(horizontal, up) {
    this.mode = 'flight';
    this.grounded = false;
    this.vel.set(horizontal.x, up, horizontal.z);
    this.play('Knockback', { fadeIn: 0.05 });
    this.spinYaw = 0;
  }

  // ------------------------------------------------------------------ update
  groundAt(x, z) {
    return this.app.groundAt(x, z);
  }

  update(dt) {
    const mv = MOVE;
    const time = this.app.time;
    if (this.queueResume && time >= this.queueResume.at) {
      if (this.blocking) this.play(this.queueResume.name, { fadeIn: 0.1 });
      this.queueResume = null;
    }
    const effDt = this.anim.freeze > 0 ? dt * 0.02 : dt;
    this.groundY = this.groundAt(this.pos.x, this.pos.z);

    switch (this.mode) {
      case 'ground':
      case 'charge': {
        const target = this.moveDir && this.mode === 'ground' ? this.moveDir.clone().multiplyScalar(this.targetSpeed) : new THREE.Vector3();
        if (this.blocking) target.multiplyScalar(Math.min(1, mv.blockSpeed / Math.max(this.targetSpeed, 1)));
        const hv = new THREE.Vector3(this.vel.x, 0, this.vel.z);
        const diff = target.clone().sub(hv);
        const step = mv.accelGround * effDt * (this.stunT > 0 ? 0.3 : 1);
        if (diff.length() <= step) hv.copy(target);
        else hv.addScaledVector(diff.normalize(), step);
        this.vel.set(hv.x, 0, hv.z);
        this.pos.addScaledVector(this.vel, effDt);
        if (hv.length() > 1.5 && !this.blocking && this.faceTarget === null) {
          const want = yawOf(hv);
          this.yaw += angDiff(this.yaw, want) * Math.min(1, effDt * 12);
        }
        if (this.pos.y - ROOT_H > this.groundY + 1.0) {
          // Walked off a ledge: start falling instead of snapping down.
          this.mode = 'air';
          this.grounded = false;
          this.vel.y = 0;
          break;
        }
        this.pos.y = this.groundY + ROOT_H;
        this.grounded = true;
        if (this.mode === 'charge') {
          this.chargeT += dt;
          this.glowTarget = 0.6 + Math.min(this.chargeT, 1.5) * 1.6;
          const tip = this.avatar.katana.group.localToWorld(this.avatar.katana.points.mid.clone());
          if (Math.floor((this.chargeT - dt) * 40) !== Math.floor(this.chargeT * 40)) this.app.vfx.emit('ChargeMotes', 2, tip, { sizeScale: 0.8 });
        }
        break;
      }
      case 'air':
      case 'aerial': {
        this.vel.y -= mv.gravity * effDt * (this.mode === 'aerial' ? 1.6 : 1);
        if (this.mode === 'aerial') this.vel.y = Math.max(this.vel.y, ATTACKS.Aerial.diveVelocity) + (this.vel.y > ATTACKS.Aerial.diveVelocity ? 0 : 0);
        if (this.moveDir && this.mode === 'air') {
          const target = this.moveDir.clone().multiplyScalar(this.targetSpeed);
          const hv = new THREE.Vector3(this.vel.x, 0, this.vel.z);
          const diff = target.sub(hv);
          const step = mv.accelAir * effDt;
          if (diff.length() <= step) hv.add(diff);
          else hv.addScaledVector(diff.normalize(), step);
          this.vel.x = hv.x;
          this.vel.z = hv.z;
        }
        this.pos.addScaledVector(this.vel, effDt);
        const hv = new THREE.Vector3(this.vel.x, 0, this.vel.z);
        if (hv.length() > 2 && this.faceTarget === null) this.yaw += angDiff(this.yaw, yawOf(hv)) * Math.min(1, effDt * 6);
        this.grounded = false;
        if (this.pos.y <= this.groundY + ROOT_H && this.vel.y <= 0) this.land();
        break;
      }
      case 'dash': {
        this.dashT += effDt;
        const D = this.dashAir ? mv.airDash : mv.dash;
        const k = Math.min(this.dashT / D.duration, 1);
        const sp = D.speed + (mv.dash.endSpeed - D.speed) * (1 - Math.pow(1 - k, 2));
        this.vel.x = this.dashDir.x * sp;
        this.vel.z = this.dashDir.z * sp;
        if (this.dashAir) this.vel.y -= mv.gravity * 0.25 * effDt;
        this.pos.addScaledVector(this.vel, effDt);
        if (!this.dashAir) this.pos.y = this.groundY + ROOT_H;
        this.afterimageT -= effDt;
        if (this.afterimageT <= 0 && k < 0.95 && !this.fpMode) {
          this.app.vfx.afterimage(this.avatar, this.dashAir ? { life: 0.24, opacity: 0.26 } : {});
          this.afterimageT = this.dashAir ? 0.05 : mv.dash.afterimageInterval;
        }
        if (k >= 1) {
          this.mode = this.dashAir ? 'air' : 'ground';
          if (!this.dashAir) this.vel.multiplyScalar(0.55);
        }
        break;
      }
      case 'slide': {
        this.slideT += effDt;
        const hv = new THREE.Vector3(this.vel.x, 0, this.vel.z);
        const sp = Math.max(0, hv.length() - mv.slide.friction * effDt);
        hv.setLength(sp);
        this.vel.set(hv.x, 0, hv.z);
        this.pos.addScaledVector(this.vel, effDt);
        this.pos.y = this.groundY + ROOT_H;
        if (this.slideEnter && this.slideEnter.time >= this.slideEnter.clip.length - 1e-3 && !this.slideLoop) {
          this.slideLoop = this.play('Slide', { fadeIn: 0.1 });
        }
        if (Math.floor((this.slideT - effDt) * 30) !== Math.floor(this.slideT * 30)) {
          const foot = this.partPos('LeftFoot', [0, -0.15, -0.5]);
          this.app.vfx.emit('SlideSparks', 2, foot, { dir: hv.clone().negate().normalize().add(new THREE.Vector3(0, 0.6, 0)) });
          this.app.vfx.emit('FootDust', 1, foot, { sizeScale: 1.1 });
        }
        if (sp < mv.slide.exitSpeed || this.slideT > mv.slide.maxTime || this.slideStop) {
          this.mode = 'ground';
          this.slideLoop = null;
          this.slideStop = false;
          this.anim.stopAction(0.2);
        }
        break;
      }
      case 'wallrun': {
        this.wallT += effDt;
        const W = mv.wallRun;
        this.vel.x = this.wallDir.x * W.speed;
        this.vel.z = this.wallDir.z * W.speed;
        this.vel.y -= mv.gravity * W.gravityScale * effDt;
        this.vel.y *= Math.pow(0.5, effDt * 3);
        this.pos.addScaledVector(this.vel, effDt);
        this.yaw += angDiff(this.yaw, yawOf(this.wallDir)) * Math.min(1, effDt * 10);
        if (this.wallX !== undefined) {
          const dist = this.app.clips[`WallRun${this.wallSide}`].meta.wallDistance;
          this.pos.x = this.wallX + (this.wallSide === 'Left' ? dist : -dist);
        }
        this.grounded = false;
        break;
      }
      case 'root': {
        const tr = this.rootTrack;
        const rm = sampleRootMotion(tr.clip, tr.time);
        if (rm) {
          const world = rm.clone().applyAxisAngle(UP, this.rootStart.yaw);
          const prev = this.pos.clone();
          this.pos.copy(this.rootStart.pos).add(world);
          if (effDt > 0) this.vel.copy(this.pos).sub(prev).divideScalar(Math.max(effDt, 1e-4));
        }
        const end = tr.done || tr.stopping || tr.time >= tr.clip.length - 0.12;
        if (end) {
          // Hand the body back to locomotion (inertialized) as control returns.
          if (tr === this.anim.action) this.anim.stopAction(0.15);
          this.groundY = this.groundAt(this.pos.x, this.pos.z);
          this.vel.set(0, 0, 0);
          if (this.pos.y > this.groundY + ROOT_H + 0.3) this.mode = 'air';
          else {
            this.mode = 'ground';
            this.pos.y = this.groundY + ROOT_H;
          }
          this.currentAttack = null;
        }
        break;
      }
      case 'flight': {
        this.vel.y -= mv.gravity * effDt;
        this.pos.addScaledVector(this.vel, effDt);
        this.grounded = false;
        if (Math.floor((time - dt) * 40) !== Math.floor(time * 40)) this.app.vfx.emit('WindBurst', 1, this.pos.clone(), { dir: this.vel.clone().normalize().negate(), alphaScale: 0.5 });
        if (this.pos.y <= this.groundY + ROOT_H && this.vel.y < 0) {
          this.pos.y = this.groundY + ROOT_H;
          this.vel.multiplyScalar(0.25).setY(0);
          this.mode = 'down';
          this.downT = 0;
          this.grounded = true;
          this.play('KnockdownLand', { fadeIn: 0.04, hold: true });
          this.app.fx.shake('Land', this, 0.6);
        }
        break;
      }
      case 'down': {
        this.downT += effDt;
        this.vel.multiplyScalar(Math.pow(0.02, effDt));
        this.pos.addScaledVector(this.vel, effDt);
        if (this.downT > 0.75 && !this.gettingUp) {
          this.gettingUp = true;
          this.play('GetUp', { fadeIn: 0.06 });
        }
        if (this.downT > 1.75) {
          this.mode = 'ground';
          this.gettingUp = false;
          this.vel.set(0, 0, 0);
        }
        break;
      }
      default:
        break;
    }
    if (this.faceTarget !== null && this.mode !== 'root' && this.mode !== 'flight') {
      this.yaw += angDiff(this.yaw, this.faceTarget) * Math.min(1, dt * 10);
    }
    if (this.stunT > 0) this.stunT -= dt;

    // Animation state.
    this.anim.update(dt, {
      speed: this.mode === 'root' || this.mode === 'down' || this.mode === 'flight' ? 0 : Math.hypot(this.vel.x, this.vel.z),
      vy: this.vel.y,
      grounded: this.grounded,
      crouch: this.crouch,
      armed: this.armed,
      yaw: this.yaw,
    });
    const moving = this.grounded && this.speed > 3 && !this.anim.actionActive;
    if (this.armed && moving) this.anim.setOverlay(this.speed > 12 ? 'ArmedRun' : 'ArmedWalk', 0.2);
    else this.anim.setOverlay(null, 0.2);

    for (const c of this.ribbonClocks) {
      if (c.track && !c.track.done) c.t = c.track.time;
      else c.t += effDt * this.anim.timeScale;
    }
    this.ribbonClocks = this.ribbonClocks.filter((c) => c.t < 3);
    this.processPendingHits();

    const pose = this.anim.evaluate();
    this.avatar.root.position.copy(this.pos);
    this.avatar.root.rotation.set(0, this.yaw, 0);
    this.avatar.applyPose(pose);
    // Secondary motion (cloth) freezes with the body during hit-stop.
    this.cloth?.update(this.anim.freeze > 0 ? dt * 0.02 : dt);

    // Blade glow and hit flash.
    this.glow += (this.glowTarget - this.glow) * Math.min(1, dt * 18);
    if (this.avatar.katana) this.avatar.katana.edgeMat.emissiveIntensity = this.glow;
    if (this.flashT > 0) this.flashT -= dt;
    const f = Math.max(0, this.flashT / 0.14);
    for (const m of this.materials) {
      if (!m.userData.baseEmissive) m.userData.baseEmissive = { c: m.emissive.clone(), i: m.emissiveIntensity };
      if (f > 0) {
        m.emissive.setRGB(1, 1, 1);
        m.emissiveIntensity = f * f * 0.16;
      } else if (m.userData.flashed) {
        m.emissive.copy(m.userData.baseEmissive.c);
        m.emissiveIntensity = m.userData.baseEmissive.i;
      }
      m.userData.flashed = f > 0;
    }
  }

  land() {
    const impact = -this.vel.y;
    this.pos.y = this.groundY + ROOT_H;
    this.vel.y = 0;
    this.grounded = true;
    this.airDashes = MOVE.dash.airDashes;
    this.jumps = 0;
    if (this.mode === 'aerial') {
      this.mode = 'ground';
      this.attack('Aerial');
      return;
    }
    this.mode = 'ground';
    if (this.forceLanding === 'roll' || (impact > MOVE.land.heavySpeed && this.speed > MOVE.land.rollSpeed)) {
      this.play('LandRoll', { fadeIn: 0.04 });
    } else if (this.forceLanding === 'heavy' || impact > MOVE.land.heavySpeed) {
      this.play('LandHeavy', { fadeIn: 0.03 });
      this.vel.multiplyScalar(0.1);
    } else {
      this.play('LandLight', { fadeIn: 0.02 });
    }
    this.forceLanding = null;
  }
}
