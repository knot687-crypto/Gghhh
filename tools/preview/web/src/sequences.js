// Scripted showcase sequences. Each returns { duration, badge } after scheduling events/shots.
import * as THREE from 'three';
import { LAYOUT } from '/anim/layout.mjs';
import { Viewmodel } from './viewmodel.js';

const ROOT_H = 2.83;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const F = V(0, 0, -1);

// Teleport an actor and reset its movement state (used at section cuts).
function place(a, x, z, yawDeg = 0, groundY = 0) {
  a.pos.set(x, groundY + ROOT_H, z);
  a.yaw = (yawDeg * Math.PI) / 180;
  a.vel.set(0, 0, 0);
  a.mode = 'ground';
  a.grounded = true;
  a.moveDir = null;
  a.targetSpeed = 0;
  a.faceTarget = null;
  a.crouch = false;
  a.blocking = false;
  a.pendingHits = [];
  a.stunT = 0;
  a.gettingUp = false;
  a.anim.stopAction(0.01);
  a.anim.prevYaw = a.yaw;
}

class Script {
  constructor(app) {
    this.app = app;
    this.shotList = [];
  }
  at(t, fn) {
    this.app.at(t, fn);
  }
  when(t0, cond, fn) {
    this.app.when(t0, cond, fn);
  }
  // Fade through black around a section change; `fn` runs at the midpoint.
  cut(t, fn, dur = 0.24) {
    this.at(t - dur / 2, () => this.app.fadeTo(1, dur / 2));
    this.at(t, fn);
    this.at(t + 0.001, () => this.app.fadeTo(0, dur / 2));
  }
  caption(t, title, sub, dur = 3) {
    this.app.hud.caption(title, sub, t, dur);
  }
  prompt(t, key, label, dur = 1.2) {
    this.app.hud.prompts.push({ t, key, label, dur });
  }
  shot(t, spec) {
    this.shotList.push({ t, ...spec });
  }
  done(duration, badge) {
    this.app.shots(this.shotList);
    this.at(duration - 0.4, () => this.app.fadeTo(1, 0.4));
    this.app.fade = 1;
    this.app.fadeTo(0, 0.5);
    return { duration, badge };
  }
}

const box = (name) => LAYOUT.boxes.find((b) => b.name === name);

// ------------------------------------------------------------------------- MOVEMENT (TP)
function movement(app) {
  const S = new Script(app);
  const hero = app.actor({ name: 'hero', style: 'hero', position: [0, 0, 30], yaw: 0 });
  app.subject = hero;
  app.speedSubject = hero;

  // Title + idle
  S.shot(0, { type: 'orbit', actor: hero, radius: 8.5, height: 0.9, angle: 25, speed: 14, look: [0, 0.5, 0], fov: 42 });
  S.caption(0.4, 'MOVEMENT', 'AAA Motion Pack  ·  third-person showcase', 2.6);
  S.shot(3.0, { type: 'follow', actor: hero, worldYaw: 0, offset: [4.2, 0.4, -5.6], look: [0, 0.35, 0], fov: 40, smooth: 0.3 });
  S.caption(3.1, 'IDLE', 'Breathing  ·  weight shift  ·  hand resting on the saya', 2.6);

  // Walk -> run -> sprint
  S.cut(5.8, () => place(hero, -20, 44, 0));
  S.shot(5.8, { type: 'follow', actor: hero, worldYaw: 0, offset: [8.5, 0.9, 0.4], look: [0, 0.25, 0], lead: 1.5, fov: 40, smooth: 0.08 });
  S.at(6.0, () => hero.move(F, 6));
  S.caption(6.0, 'WALK', 'Heel-strike gait  ·  IK-planted feet', 1.6);
  S.at(7.6, () => hero.move(F, 16));
  S.caption(7.6, 'RUN', 'Phase-synced blend tree  ·  zero foot sliding at design speed', 1.6);
  S.at(9.2, () => hero.move(F, 26));
  S.caption(9.2, 'SPRINT', 'Forward lean  ·  high knee drive  ·  procedural lean into turns', 2.2);
  S.prompt(9.2, 'SHIFT', 'Sprint', 1.6);

  // Slide
  S.shot(11.3, { type: 'follow', actor: hero, worldYaw: 0, offset: [4.5, -1.3, -8.5], look: [0, -0.7, 0], fov: 46, smooth: 0.12, blend: true });
  S.at(11.5, () => hero.slide());
  S.prompt(11.5, 'C', 'Slide', 1.3);
  S.caption(11.5, 'SLIDE', 'Momentum slide  ·  sparks  ·  dust trail', 2.2);
  S.at(13.2, () => hero.move(null));

  // Jump + double jump
  S.cut(14.6, () => place(hero, 20, 34, 0));
  S.shot(14.6, { type: 'follow', actor: hero, worldYaw: 0, offset: [11, 0.6, 1.5], look: [0, 1.6, -1], fov: 44, smooth: 0.12 });
  S.at(14.8, () => hero.move(F, 16));
  S.at(15.2, () => hero.jump());
  S.prompt(15.2, 'SPACE', 'Jump', 0.8);
  S.at(15.52, () => hero.doubleJump());
  S.prompt(15.52, 'SPACE', 'Double jump', 1.2);
  S.caption(15.2, 'DOUBLE JUMP', 'Tucked front flip  ·  air-ring burst', 2.6);
  S.at(16.9, () => hero.move(null));

  // Four-way dash
  S.cut(18.4, () => {
    place(hero, 0, 22, 0);
    hero.face(0);
  });
  S.shot(18.4, { type: 'follow', actor: hero, worldYaw: 0, offset: [9.5, 3.4, 8], look: [0, 0.2, -1], fov: 46, smooth: 0.32 });
  S.caption(18.6, 'DASH  ·  4-WAY', 'Afterimages  ·  wind burst  ·  FOV punch  ·  skid brake', 5.2);
  const dashes = ['Forward', 'Right', 'Back', 'Left'];
  dashes.forEach((d, i) => {
    S.at(18.8 + i * 1.05, () => hero.dash(d));
    S.prompt(18.8 + i * 1.05, 'Q', `Dash ${d.toLowerCase()}`, 0.9);
  });

  // Air dash
  S.cut(23.6, () => place(hero, -6, 40, 0));
  S.shot(23.6, { type: 'follow', actor: hero, worldYaw: 0, offset: [10.5, 1.4, 3], look: [0, 1.2, -2], fov: 46, smooth: 0.14 });
  S.at(23.8, () => hero.move(F, 18));
  S.at(24.1, () => hero.jump());
  S.at(24.42, () => hero.dash('Forward'));
  S.prompt(24.42, 'Q', 'Air dash', 1);
  S.caption(24.1, 'AIR DASH', 'Mid-air burst  ·  streamlined pose', 2.4);
  S.at(25.5, () => hero.move(null));

  // Wall run + wall jump (wall on the hero's right)
  const wall = box('WallRunWall');
  const wallX = wall.center[0] - wall.size[0] / 2;
  const dist = app.clips.WallRunRight.meta.wallDistance;
  S.cut(27.0, () => place(hero, wallX - dist - 1.5, -22, 0));
  S.shot(27.0, { type: 'follow', actor: hero, worldYaw: 0, offset: [-7.5, 2.6, 10], look: [1.5, 0.8, -4], fov: 46, smooth: 0.12 });
  S.at(27.15, () => hero.move(F, 26));
  S.at(27.55, () => hero.jump());
  S.at(27.75, () => hero.wallRun('Right', wallX, { dir: F }));
  S.caption(27.6, 'WALL RUN', 'Body tilts off the wall  ·  feet strike the wall plane', 2.4);
  S.at(29.05, () => hero.wallJump());
  S.prompt(29.05, 'SPACE', 'Wall jump', 1.2);
  S.caption(29.1, 'WALL JUMP', 'Kick-off twist into the air', 1.8);
  S.at(29.5, () => hero.move(V(-0.5, 0, -1), 16));
  S.at(30.6, () => hero.move(null));

  // Vault
  const rail = box('VaultRail');
  const railNear = rail.center[2] + app.clips.Vault.meta.obstacle.distance;
  S.cut(31.8, () => place(hero, rail.center[0], rail.center[2] + 20, 0));
  S.shot(31.8, { type: 'follow', actor: hero, worldYaw: 0, offset: [12, 1.6, 1.0], look: [0, 0.6, -1.5], fov: 42, smooth: 0.1 });
  S.at(31.95, () => hero.move(F, 16));
  S.when(31.95, () => hero.pos.z <= railNear, () => hero.rootAction('Vault'));
  S.caption(32.6, 'VAULT', 'Speed vault  ·  root motion follows the hand plant', 2.6);
  S.at(34.9, () => hero.move(null));

  // Mantle
  const block = box('MantleBlock');
  const blockFace = block.center[2] + block.size[2] / 2;
  S.cut(35.8, () => place(hero, block.center[0], blockFace + 16, 0));
  S.shot(35.8, { type: 'track', actor: hero, pos: [block.center[0] + 15, 7.5, blockFace + 5], look: [0, 1, -1], fov: 42 });
  S.at(35.95, () => hero.move(F, 15));
  S.when(35.95, () => hero.pos.z <= blockFace + app.clips.Mantle.meta.obstacle.distance, () => {
    hero.move(null);
    hero.rootAction('Mantle');
  });
  S.caption(36.6, 'MANTLE', 'Ledge climb  ·  hands lock to the edge', 2.8);

  // Crouch
  S.cut(40.2, () => place(hero, 12, 14, 0));
  S.shot(40.2, { type: 'follow', actor: hero, worldYaw: 0, offset: [5.5, 0.2, -7], look: [0, -0.4, 0], fov: 40, smooth: 0.2 });
  S.at(40.3, () => (hero.crouch = true));
  S.prompt(40.3, 'CTRL', 'Crouch', 1.2);
  S.caption(40.4, 'CROUCH', 'Low guard  ·  crouch walk', 2.8);
  S.at(41.4, () => hero.move(F, 8));
  S.at(43.0, () => hero.move(null));

  // Heavy landing + roll from the tower
  const tower = box('DropTower');
  const top = tower.center[1] + tower.size[1] / 2;
  S.cut(44.0, () => {
    hero.crouch = false;
    place(hero, tower.center[0], tower.center[2] - 2.5, 0, top);
    hero.forceLanding = 'heavy';
  });
  S.shot(44.0, { type: 'track', actor: hero, pos: [tower.center[0] + 16, 5, tower.center[2] - 14], look: [0, 0.2, 0], fov: 44 });
  S.at(44.25, () => hero.move(F, 10));
  S.at(44.75, () => hero.move(null));
  S.caption(44.6, 'HEAVY LANDING', 'Three-point superhero landing  ·  cracks  ·  shockwave', 3);
  S.cut(48.3, () => {
    place(hero, tower.center[0], tower.center[2] + 3, 0, top);
    hero.forceLanding = 'roll';
  });
  S.at(48.45, () => hero.move(F, 18));
  S.caption(48.9, 'LANDING ROLL', 'Keeps momentum on big drops', 2.6);
  S.at(50.6, () => hero.move(null));

  // Outro
  S.cut(52.0, () => place(hero, 0, 30, 20));
  S.shot(52.0, { type: 'orbit', actor: hero, radius: 9, height: 1.2, angle: -20, speed: 16, look: [0, 0.5, 0], fov: 42 });
  S.caption(52.2, 'MOVEMENT SET', '28 clips  ·  third + first person  ·  ready for Roblox', 3);
  return S.done(55.5, 'AAA MOTION PACK  ·  MOVEMENT');
}

// ------------------------------------------------------------------------- COMBAT (TP)
function combat(app) {
  const S = new Script(app);
  const hero = app.actor({ name: 'hero', style: 'hero', position: [0, 0, -80], yaw: 0 });
  const d1 = app.actor({ name: 'dummy1', style: 'dummy', position: [0, 0, -86], yaw: 180, weapon: false });
  const d2 = app.actor({ name: 'dummy2', style: 'dummy', position: [-200, 0, 0], yaw: 180, weapon: false });
  const d3 = app.actor({ name: 'dummy3', style: 'dummy', position: [-210, 0, 0], yaw: 180, weapon: false });
  const rival = app.actor({ name: 'rival', style: 'rival', position: [-220, 0, 0], yaw: 180, armed: true });
  app.subject = hero;
  for (const d of [d1, d2, d3]) d.isDummy = true;

  S.shot(0, { type: 'orbit', actor: hero, radius: 8, height: 1, angle: -35, speed: 12, look: [0, 0.4, -1.5], fov: 42 });
  S.caption(0.4, 'COMBAT', 'Katana kit  ·  third-person showcase', 2.4);

  // Iai draw
  S.shot(2.9, { type: 'follow', actor: hero, worldYaw: 0, offset: [4.5, 0.6, -5.2], look: [0, 0.4, 0], fov: 40, smooth: 0.2 });
  S.at(3.1, () => hero.play('Draw'));
  S.prompt(3.1, '1', 'Draw', 1.2);
  S.caption(3.1, 'IAI DRAW', 'Nukitsuke  ·  the draw is the first cut', 2.4);

  // Combo
  S.shot(5.4, { type: 'follow', actor: hero, worldYaw: 0, offset: [9.5, 1.5, -2.2], look: [0, 0.4, -3], fov: 44, smooth: 0.22 });
  S.at(5.5, () => hero.move(F, 9));
  S.when(5.5, () => hero.pos.distanceTo(d1.pos) < 5.4, () => hero.move(null));
  const c0 = 6.3;
  S.at(c0, () => hero.attack('Light1'));
  S.at(c0 + 0.42, () => hero.attack('Light2'));
  S.at(c0 + 0.86, () => hero.attack('Light3'));
  S.at(c0 + 1.34, () => hero.attack('Light4'));
  ['M1', 'M1', 'M1', 'M1'].forEach((k, i) => S.prompt(c0 + [0, 0.42, 0.86, 1.34][i], k, `Light ${i + 1}`, 0.5));
  S.caption(c0, '4-HIT COMBO', 'Kesa-giri  ·  backhand  ·  rising launch  ·  whirlwind finisher', 4.2);

  // Heavy
  S.cut(11.2, () => {
    place(hero, 30, -80, 0);
    hero.setArmed(true);
    place(d1, 30, -87, 180);
    place(d2, 25.5, -89, 160);
    place(d3, 34.5, -89, 200);
  });
  S.shot(11.2, { type: 'track', actor: hero, pos: [40, 3.2, -71], look: [0, 0.2, -3], fov: 46 });
  S.at(11.5, () => hero.charge());
  S.prompt(11.5, 'M2 hold', 'Charge', 1.4);
  S.caption(11.5, 'HEAVY  ·  CHARGED CLEAVE', 'Energy gathers on the blade  ·  ground split  ·  rock eruption', 3.6);
  S.at(12.75, () => hero.release());

  // Lunge
  S.cut(16.0, () => {
    place(hero, -20, -70, 0);
    hero.setArmed(true);
    place(d1, -20, -83, 180);
  });
  S.shot(16.0, { type: 'follow', actor: hero, worldYaw: 0, offset: [9.5, 1.2, -3], look: [0, 0.3, -3], fov: 44, smooth: 0.12 });
  S.at(16.3, () => hero.attack('Lunge'));
  S.prompt(16.3, 'SHIFT+M1', 'Lunge', 1.2);
  S.caption(16.3, 'LUNGE', 'Sprint thrust  ·  closes 9 studs in 0.2 s', 2.4);

  // Aerial slam
  S.cut(19.0, () => {
    place(hero, -50, -78, 0);
    hero.setArmed(true);
    place(d1, -50, -88, 180);
    place(d2, -55.5, -86, 150);
    place(d3, -44.5, -86, 210);
  });
  S.shot(19.0, { type: 'track', actor: hero, pos: [-37, 7.5, -70], look: [0, 0, -4], fov: 48 });
  S.at(19.2, () => hero.move(F, 14));
  S.at(19.35, () => hero.jump());
  S.at(19.62, () => hero.aerialSlam());
  S.at(19.62, () => hero.move(null));
  S.prompt(19.62, 'M2 (air)', 'Slam', 1.2);
  S.caption(19.5, 'AERIAL SLAM', 'Plunging strike  ·  crater  ·  radial launch', 3);

  // Block vs rival
  S.cut(23.2, () => {
    place(hero, 0, -120, 0);
    hero.setArmed(true);
    place(rival, 0, -125.4, 180);
    rival.setArmed(true);
  });
  S.shot(23.2, { type: 'track', actor: hero, pos: [9.5, 3.4, -121.5], look: [0, 0.3, -2.7], fov: 44 });
  S.at(23.35, () => hero.block(true));
  S.prompt(23.35, 'F hold', 'Block', 1.4);
  S.at(23.8, () => rival.attack('Light1'));
  S.at(24.35, () => rival.attack('Light2'));
  S.caption(23.4, 'BLOCK', 'Guard absorbs the strike  ·  sparks  ·  pushback', 2.6);
  S.at(25.3, () => hero.block(false));

  // Parry + counter
  S.at(26.1, () => rival.attack('Light1'));
  S.at(26.16, () => hero.block(true));
  S.prompt(26.16, 'F tap', 'Perfect parry', 1.4);
  S.caption(26.2, 'PARRY', 'Perfect-timing deflect  ·  slow-mo  ·  counter window', 3.2);
  S.at(26.75, () => hero.block(false));
  S.at(26.85, () => hero.attack('Light1'));
  S.at(27.27, () => hero.attack('Light2'));
  S.at(27.71, () => hero.attack('Light3'));
  S.at(28.2, () => hero.attack('Light4'));

  // Hit reactions from different sides
  S.cut(30.4, () => {
    place(hero, 40, -120, 0);
    hero.setArmed(true);
    place(d1, 40, -125, 180);
  });
  S.shot(30.4, { type: 'track', actor: hero, pos: [47, 2.6, -117], look: [0, 0.2, -2.5], fov: 42 });
  S.caption(30.5, 'HIT REACTIONS', 'Directional flinches  ·  hit-stop  ·  impact flash', 3.4);
  S.at(30.6, () => hero.attack('Light2'));
  S.at(31.5, () => {
    d1.yaw = Math.PI / 2;
    hero.attack('Light2');
  });
  S.at(32.4, () => {
    d1.yaw = 0;
    hero.attack('Light2');
  });

  // Sheath
  S.shot(33.6, { type: 'follow', actor: hero, worldYaw: 0, offset: [4.2, 0.6, -5.4], look: [0, 0.3, 0], fov: 40, smooth: 0.3 });
  S.at(33.8, () => hero.play('Sheath'));
  S.caption(33.8, 'CHIBURI  ·  SHEATH', 'Blood flick, blade returns to the saya', 2.4);

  S.cut(36.2, () => place(hero, 0, -80, 20));
  S.shot(36.2, { type: 'orbit', actor: hero, radius: 9, height: 1.1, angle: -40, speed: 14, look: [0, 0.5, 0], fov: 42 });
  S.caption(36.4, 'COMBAT SET', '24 third-person clips  ·  slash ribbons baked from the animation', 2.8);
  return S.done(39.5, 'AAA MOTION PACK  ·  COMBAT');
}

// ------------------------------------------------------------------------- FIRST PERSON
function firstperson(app) {
  const S = new Script(app);
  const hero = app.actor({ name: 'hero', style: 'hero', position: [0, 0, 30], yaw: 0, armed: true });
  const d1 = app.actor({ name: 'dummy1', style: 'dummy', position: [-200, 0, 0], yaw: 180, weapon: false });
  const d2 = app.actor({ name: 'dummy2', style: 'dummy', position: [-210, 0, 0], yaw: 180, weapon: false });
  const rival = app.actor({ name: 'rival', style: 'rival', position: [-220, 0, 0], yaw: 180, armed: true });
  app.viewmodel = new Viewmodel(app, hero);
  app.subject = hero;
  app.speedSubject = hero;
  app.hud.crosshair = true;
  const fp = (t, o = {}) => S.shot(t, { type: 'fp', fov: 72, yawOffset: 0, pitch: -4, ...o });

  fp(0, { yawOffset: -18, turnRate: 1.2 });
  fp(1.2, { yawOffset: 14, turnRate: 1.1 });
  S.caption(0.4, 'FIRST PERSON', 'Viewmodel set  ·  camera-joint animation  ·  sway & bob', 2.6);
  fp(2.8, { yawOffset: 0, turnRate: 2.5 });

  // Sprint + slide
  S.at(3.2, () => hero.move(F, 26));
  S.caption(3.3, 'SPRINT', 'Arms pump in sync with the body cycle', 1.8);
  S.at(5.2, () => hero.slide());
  S.caption(5.2, 'SLIDE', 'View drops and rolls into the slide', 1.8);
  S.at(6.4, () => hero.move(null));

  // Vault
  const rail = box('VaultRail');
  const railNear = rail.center[2] + app.clips.Vault.meta.obstacle.distance;
  S.cut(7.6, () => place(hero, rail.center[0], rail.center[2] + 16, 0));
  fp(7.6, { pitch: -9 });
  S.at(7.75, () => hero.move(F, 16));
  S.when(7.75, () => hero.pos.z <= railNear, () => hero.rootAction('Vault'));
  S.caption(8.0, 'VAULT', 'Hand plants into view', 2.2);
  S.at(9.6, () => hero.move(null));

  // Wall run
  const wall = box('WallRunWall');
  const wallX = wall.center[0] - wall.size[0] / 2;
  const dist = app.clips.WallRunRight.meta.wallDistance;
  S.cut(10.6, () => place(hero, wallX - dist - 1.5, -22, 0));
  fp(10.6, { pitch: -2 });
  S.at(10.75, () => hero.move(F, 26));
  S.at(11.15, () => hero.jump());
  S.at(11.35, () => hero.wallRun('Right', wallX, { dir: F }));
  S.caption(11.3, 'WALL RUN', 'Camera banks away from the wall', 2.4);
  S.at(12.65, () => hero.wallJump());
  S.at(13.0, () => hero.move(V(-0.5, 0, -1), 16));
  S.at(14.0, () => hero.move(null));

  // Combo
  S.cut(15.2, () => {
    place(hero, 0, -80, 0);
    place(d1, 0, -85.2, 180);
  });
  fp(15.2, { pitch: -6 });
  const c0 = 15.7;
  S.at(c0, () => hero.attack('Light1'));
  S.at(c0 + 0.42, () => hero.attack('Light2'));
  S.at(c0 + 0.86, () => hero.attack('Light3'));
  S.at(c0 + 1.34, () => hero.attack('Light4'));
  fp(c0 + 0.9, { pitch: 4, turnRate: 3 });
  fp(c0 + 1.6, { pitch: -4, turnRate: 2 });
  S.caption(c0, '4-HIT COMBO', 'View-space slash trails  ·  camera kick on every cut', 3.6);

  // Heavy
  S.cut(20.6, () => {
    place(hero, 30, -80, 0);
    place(d1, 30, -87, 180);
    place(d2, 26, -88, 160);
  });
  fp(20.6, { pitch: -8 });
  S.at(20.9, () => hero.charge());
  S.caption(20.9, 'HEAVY', 'Charge, then split the ground', 3);
  S.at(22.2, () => hero.release());

  // Block + parry vs rival
  S.cut(24.6, () => {
    place(hero, 0, -120, 0);
    place(rival, 0, -125.4, 180);
  });
  fp(24.6, { pitch: -3 });
  S.at(24.8, () => hero.block(true));
  S.at(25.2, () => rival.attack('Light1'));
  S.caption(24.9, 'BLOCK', 'Blade braced across the view', 1.8);
  S.at(26.0, () => hero.block(false));
  S.at(26.7, () => rival.attack('Light2'));
  S.at(26.73, () => hero.block(true));
  S.caption(26.7, 'PARRY', 'Deflect  ·  slow-mo  ·  counter', 2.6);
  S.at(27.3, () => hero.block(false));
  S.at(27.4, () => hero.attack('Light1'));
  S.at(27.82, () => hero.attack('Light2'));

  // Lunge
  S.cut(29.4, () => {
    place(hero, -20, -70, 0);
    place(d1, -20, -83, 180);
  });
  fp(29.4, { pitch: -5 });
  S.at(29.7, () => hero.attack('Lunge'));
  S.caption(29.7, 'LUNGE', 'Dash thrust', 1.8);

  S.cut(31.8, () => place(hero, 0, 30, 0));
  fp(31.8, { yawOffset: 12, turnRate: 0.8 });
  S.caption(32.0, 'FIRST-PERSON SET', '24 viewmodel clips  ·  same timing as third person', 2.6);
  return S.done(34.8, 'AAA MOTION PACK  ·  FIRST PERSON');
}

function test(app) {
  return movement(app);
}

export const SEQUENCES = { test, movement, combat, firstperson };
