// First-person viewmodel (preview twin of AAAMotion/FirstPerson/Viewmodel.luau).
// Mirrors the subject actor's actions onto FP_* clips, adds procedural bob/sway, and drives the
// camera from the "Camera" virtual joint.
import * as THREE from 'three';
import { Animator } from '/anim/core/animator.mjs';
import { VM, rigJointNames } from '/anim/core/rig.mjs';
import { MOVE } from '/anim/tuning.mjs';
import { buildAvatar, STYLES } from './avatar.js';
import { VM_WEAPON_SCALE } from '/anim/weapon.mjs';

const EYE = 1.5; // camera height above the root part centre (Roblox R15 head offset)

const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

export class Viewmodel {
  constructor(app, actor) {
    this.app = app;
    this.actor = actor;
    this.avatar = buildAvatar({ rig: VM, style: STYLES.hero, hidden: ['UpperTorso'], scabbard: false });
    this.avatar.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
      }
    });
    if (this.avatar.katana) this.avatar.katana.group.scale.setScalar(VM_WEAPON_SCALE);
    app.scene.add(this.avatar.root);
    this.anim = new Animator(rigJointNames(VM));
    this.idle = this.anim.play(app.clips.FP_Idle, { layer: 0, fadeIn: 0 });
    this.sprint = this.anim.play(app.clips.FP_Sprint, { layer: 0, fadeIn: 0, weight: 0, speed: 0 });
    this.sprint.weight = 0;
    this.action = null;
    this.yawOffset = 0;
    this.pitch = 0;
    this.bob = 0;
    this.sway = { x: 0, y: 0, roll: 0 };
    this.prevYaw = actor.yaw;
    this.prevPitch = 0;
    this.camJoint = { p: [0, 0, 0], q: [0, 0, 0, 1] };
    this.ribbons = [];
    // Mirror actor actions.
    const orig = actor.anim.play.bind(actor.anim);
    actor.anim.play = (name, opts = {}) => {
      const tr = orig(name, opts);
      this.onActorPlay(name, tr, opts);
      return tr;
    };
    this.anim.onMarker((track, m) => this.onMarker(track, m));
    actor.avatar.setVisible(false);
    actor.fpMode = true;
  }

  onActorPlay(name, track, opts) {
    const alias = /^(Dash|AirDash)/.test(name) ? 'Dash' : name === 'LandLight' ? 'Land' : name;
    const fp = this.app.clips[`FP_${alias}`];
    if (!fp) {
      // Movement actions without a dedicated FP clip fall back to the free-hand traversal pose.
      return;
    }
    const layer = fp.additive ? 3 : 1;
    if (layer === 1 && this.action) this.action.stop(opts.fadeIn ?? 0.08);
    const tr = this.anim.play(fp, { layer, fadeIn: opts.fadeIn ?? 0.06, fadeOut: 0.15, speed: opts.speed ?? 1, hold: opts.hold ?? false });
    tr.mirrors = track;
    if (layer === 1) this.action = tr;
  }

  onMarker(track, m) {
    if (m.name === 'SwingStart') {
      const swing = (track.clip.swings ?? []).find((s) => Math.abs(s.t0 - m.t) < 1e-4);
      if (!swing) return;
      const clock = { t: track.time, track };
      this.ribbons.push(clock);
      const vm = this;
      this.app.vfx.startRibbon(swing, { pos: new THREE.Vector3(), quat: new THREE.Quaternion() }, () => clock.t, {
        heavy: /Spin|Overhead|Thrust/.test(swing.kind),
        follow: () => ({ pos: vm.avatar.root.position, quat: vm.avatar.root.quaternion }),
      });
    }
  }

  update(dt) {
    const a = this.actor;
    const grounded = a.grounded && a.mode !== 'slide';
    const speed = grounded ? a.speed : 0;
    // Sprint cycle synced to the third-person locomotion phase.
    const sprintW = grounded && speed > 20 && !this.actionActive ? 1 : 0;
    if (this.sprint.targetWeight !== sprintW) this.sprint.fadeTo(sprintW, 0.2);
    if (this.idle.targetWeight !== 1 - sprintW) this.idle.fadeTo(1 - sprintW, 0.2);
    this.sprint.time = a.anim.phase * this.sprint.clip.length;
    this.anim.update(dt * (a.anim.freeze > 0 ? 0.02 : 1));
    if (this.action && this.action.done) this.action = null;
    for (const c of this.ribbons) {
      if (c.track && !c.track.done) c.t = c.track.time;
      else c.t += dt;
    }
    this.ribbons = this.ribbons.filter((c) => c.t < 3);

    // Procedural bob (walk/run) and sway (camera turn lag).
    const moving = grounded && speed > 2 && !this.actionActive;
    const ph = a.anim.phase * Math.PI * 2;
    const amp = moving ? Math.min(speed / MOVE.walkSpeed, 1.4) : 0;
    this.bob = damp(this.bob, amp, 10, dt);
    const yawRate = Math.atan2(Math.sin(a.yaw + this.yawOffset - this.prevYaw), Math.cos(a.yaw + this.yawOffset - this.prevYaw)) / Math.max(dt, 1e-4);
    this.prevYaw = a.yaw + this.yawOffset;
    const pitchRate = (this.pitch - this.prevPitch) / Math.max(dt, 1e-4);
    this.prevPitch = this.pitch;
    this.sway.x = damp(this.sway.x, THREE.MathUtils.clamp(-yawRate * 0.012, -0.12, 0.12), 12, dt);
    this.sway.y = damp(this.sway.y, THREE.MathUtils.clamp(-pitchRate * 0.01, -0.1, 0.1), 12, dt);
    const strafe = a.vel.dot(a.right);
    this.sway.roll = damp(this.sway.roll, THREE.MathUtils.clamp(-strafe * 0.12, -3, 3), 8, dt);
    this.bobOffset = new THREE.Vector3(Math.sin(ph) * 0.035 * this.bob + this.sway.x, -Math.abs(Math.cos(ph)) * 0.05 * this.bob + this.sway.y, 0);
    const pose = this.anim.evaluate();
    this.camJoint = pose.Camera ?? { p: [0, 0, 0], q: [0, 0, 0, 1] };
    this.pose = pose;
  }

  get actionActive() {
    return !!(this.action && !this.action.stopping && !this.action.done);
  }

  // Base camera: actor head, actor yaw + look offset, scripted pitch.
  updateCamera(dt, shot) {
    const a = this.actor;
    if (shot.yawOffset !== undefined) this.yawOffset = damp(this.yawOffset, (shot.yawOffset * Math.PI) / 180, shot.turnRate ?? 6, dt);
    if (shot.pitch !== undefined) this.pitch = damp(this.pitch, (shot.pitch * Math.PI) / 180, shot.turnRate ?? 6, dt);
    const base = new THREE.Object3D();
    base.position.copy(a.pos).add(new THREE.Vector3(0, EYE, 0));
    base.rotation.set(this.pitch, a.yaw + this.yawOffset, 0, 'YXZ');
    base.updateMatrixWorld();
    // Viewmodel root = base camera moved by the camera joint's translation and part of its
    // rotation (arms stay framed during big camera moves but still counter-move a little),
    // plus bob/sway in camera space.
    const cj = this.camJoint;
    const vmQuat = base.quaternion.clone().multiply(new THREE.Quaternion().slerp(new THREE.Quaternion(...cj.q), 0.35));
    const vmPos = this.bobOffset ? this.bobOffset.clone().applyQuaternion(base.quaternion) : new THREE.Vector3();
    vmPos.add(new THREE.Vector3(...cj.p).applyQuaternion(base.quaternion));
    this.avatar.root.position.copy(base.position).add(vmPos);
    this.avatar.root.quaternion.copy(vmQuat);
    this.avatar.applyPose(this.pose ?? {});
    // Camera = base * Camera joint (+ strafe roll), then bob.
    const cam = this.app.camera;
    cam.position.copy(base.position).add(new THREE.Vector3(...cj.p).applyQuaternion(base.quaternion));
    cam.quaternion.copy(base.quaternion).multiply(new THREE.Quaternion(...cj.q));
    cam.rotateZ((this.sway.roll * Math.PI) / 180);
    const bobCam = this.bob * 0.04 * Math.abs(Math.cos(a.anim.phase * Math.PI * 2));
    cam.position.y -= bobCam;
    cam.fov = shot.fov ?? MOVE.fov.base;
    this.app.subject = a;
  }

  applyShake(fx) {
    const cam = this.app.camera;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 1);
    cam.position.addScaledVector(right, fx.off.x * 0.5).addScaledVector(up, fx.off.y * 0.5);
    cam.rotateZ(fx.rot.z);
    cam.rotateX(fx.rot.x);
    cam.fov += fx.fov;
    cam.updateProjectionMatrix();
  }
}
