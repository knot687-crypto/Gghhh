// Procedural textures so the preview needs no external assets. Particle sprites approximate the
// built-in Roblox textures the runtime uses (sparkles_main, smoke_main, explosion shockwave ...).
import * as THREE from 'three';
import { rng } from './rng.js';

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { repeat = null, srgb = true, mips = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.anisotropy = 8;
  t.generateMipmaps = mips;
  return t;
}

// Concrete floor tiles: 1 texture repeat = 16x16 studs, tiles of 4 studs.
export function groundTexture() {
  const R = rng(7);
  const [c, g] = canvas(1024);
  g.fillStyle = '#7d7f84';
  g.fillRect(0, 0, 1024, 1024);
  const tile = 256;
  for (let ty = 0; ty < 4; ty++) {
    for (let tx = 0; tx < 4; tx++) {
      const l = 118 + Math.floor(R() * 18);
      g.fillStyle = `rgb(${l},${l + 2},${l + 6})`;
      g.fillRect(tx * tile, ty * tile, tile, tile);
      for (let i = 0; i < 900; i++) {
        const a = R() * 0.07;
        g.fillStyle = R() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 0.7})`;
        const s = 1 + R() * 5;
        g.fillRect(tx * tile + R() * tile, ty * tile + R() * tile, s, s);
      }
      // soft blotches
      for (let i = 0; i < 6; i++) {
        const x = tx * tile + R() * tile;
        const y = ty * tile + R() * tile;
        const r = 20 + R() * 60;
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, `rgba(0,0,0,${0.05 + R() * 0.05})`);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
  }
  g.strokeStyle = 'rgba(30,32,38,0.85)';
  g.lineWidth = 4;
  for (let i = 0; i <= 4; i++) {
    g.beginPath();
    g.moveTo(i * tile, 0);
    g.lineTo(i * tile, 1024);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i * tile);
    g.lineTo(1024, i * tile);
    g.stroke();
  }
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    g.beginPath();
    g.moveTo(i * tile + 3, 0);
    g.lineTo(i * tile + 3, 1024);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i * tile + 3);
    g.lineTo(1024, i * tile + 3);
    g.stroke();
  }
  return tex(c, { repeat: [1, 1] });
}

export function stoneTexture(seed = 3, base = [92, 90, 96]) {
  const R = rng(seed);
  const [c, g] = canvas(512);
  g.fillStyle = `rgb(${base.join(',')})`;
  g.fillRect(0, 0, 512, 512);
  const bw = 128;
  const bh = 64;
  for (let row = 0; row < 8; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let col = -1; col < 5; col++) {
      const l = (R() - 0.5) * 26;
      g.fillStyle = `rgb(${base[0] + l},${base[1] + l},${base[2] + l})`;
      g.fillRect(col * bw + off + 3, row * bh + 3, bw - 6, bh - 6);
      for (let i = 0; i < 120; i++) {
        g.fillStyle = `rgba(0,0,0,${R() * 0.12})`;
        g.fillRect(col * bw + off + R() * bw, row * bh + R() * bh, 2 + R() * 4, 2 + R() * 3);
      }
    }
  }
  return tex(c, { repeat: [1, 1] });
}

export function woodTexture(seed = 5) {
  const R = rng(seed);
  const [c, g] = canvas(256);
  g.fillStyle = '#a77b4f';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i++) {
    const y = R() * 256;
    g.strokeStyle = `rgba(${R() < 0.5 ? '70,40,20' : '200,160,110'},${0.12 + R() * 0.2})`;
    g.lineWidth = 1 + R() * 3;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 256; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 3);
    g.stroke();
  }
  return tex(c, { repeat: [1, 1] });
}

export function faceTexture() {
  const [c, g] = canvas(256);
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = '#1b1b22';
  for (const x of [88, 168]) {
    g.beginPath();
    g.ellipse(x, 118, 13, 22, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = 'rgba(255,255,255,0.9)';
  for (const x of [92, 172]) {
    g.beginPath();
    g.ellipse(x, 110, 4, 6, 0, 0, Math.PI * 2);
    g.fill();
  }
  // determined brows
  g.strokeStyle = '#1b1b22';
  g.lineWidth = 9;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(66, 84);
  g.lineTo(108, 94);
  g.moveTo(190, 84);
  g.lineTo(148, 94);
  g.stroke();
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(108, 176);
  g.quadraticCurveTo(128, 184, 148, 176);
  g.stroke();
  return tex(c);
}

export function torsoTexture(main = '#2a3550', trim = '#d9d4c7', sash = '#8c1d24') {
  // Gi-style crossed collar painted on the front of the UpperTorso.
  const [c, g] = canvas(512, 410);
  g.fillStyle = main;
  g.fillRect(0, 0, 512, 410);
  g.fillStyle = 'rgba(255,255,255,0.03)';
  for (let i = 0; i < 40; i++) g.fillRect(0, i * 11, 512, 4);
  g.fillStyle = trim;
  g.beginPath();
  g.moveTo(170, 0);
  g.lineTo(230, 0);
  g.lineTo(330, 300);
  g.lineTo(290, 330);
  g.closePath();
  g.fill();
  g.fillStyle = '#c9c3b5';
  g.beginPath();
  g.moveTo(342, 0);
  g.lineTo(282, 0);
  g.lineTo(226, 170);
  g.lineTo(262, 200);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(0, 340, 512, 70);
  g.fillStyle = sash;
  g.fillRect(0, 352, 512, 58);
  return tex(c);
}

export function wrapTexture() {
  // Katana handle wrap (tsuka-ito diamonds).
  const [c, g] = canvas(64, 256);
  g.fillStyle = '#e8e2d2';
  g.fillRect(0, 0, 64, 256);
  g.fillStyle = '#16161a';
  for (let y = -32; y < 256; y += 32) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(32, y + 16);
    g.lineTo(64, y);
    g.lineTo(64, y + 14);
    g.lineTo(32, y + 30);
    g.lineTo(0, y + 14);
    g.closePath();
    g.fill();
  }
  return tex(c, { repeat: [3, 1] });
}

// ---------- particle sprites (white, tinted by the particle colour) ----------

export function glowSprite() {
  const [c, g] = canvas(128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.75)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.18)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return tex(c, { srgb: false });
}

export function sparkSprite() {
  // 4-point star like sparkles_main.
  const [c, g] = canvas(128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 30);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'lighter';
  for (const [w, h] of [
    [6, 62],
    [62, 6],
  ]) {
    const lg = g.createRadialGradient(64, 64, 0, 64, 64, 62);
    lg.addColorStop(0, 'rgba(255,255,255,0.95)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg;
    g.beginPath();
    g.ellipse(64, 64, w, h, 0, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c, { srgb: false });
}

export function streakSprite() {
  // Elongated spark streak (used for velocity-aligned sparks and speed lines).
  const [c, g] = canvas(32, 128);
  const grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.35, 'rgba(255,255,255,1)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.beginPath();
  g.ellipse(16, 64, 7, 62, 0, 0, Math.PI * 2);
  g.fill();
  return tex(c, { srgb: false });
}

export function smokeSprite(seed = 11) {
  const R = rng(seed);
  const [c, g] = canvas(128);
  for (let i = 0; i < 26; i++) {
    const a = R() * Math.PI * 2;
    const d = R() * 28;
    const x = 64 + Math.cos(a) * d;
    const y = 64 + Math.sin(a) * d;
    const r = 16 + R() * 26;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(255,255,255,${0.16 + R() * 0.12})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return tex(c, { srgb: false });
}

export function ringSprite() {
  const [c, g] = canvas(256);
  const grd = g.createRadialGradient(128, 128, 70, 128, 128, 126);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.25)');
  grd.addColorStop(0.82, 'rgba(255,255,255,1)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  return tex(c, { srgb: false });
}

export function crackTexture(seed = 4) {
  // Radial ground cracks (decal on the floor for heavy impacts).
  const R = rng(seed);
  const [c, g] = canvas(512);
  g.clearRect(0, 0, 512, 512);
  const grd = g.createRadialGradient(256, 256, 0, 256, 256, 120);
  grd.addColorStop(0, 'rgba(0,0,0,0.75)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = 'rgba(10,10,12,0.95)';
  g.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    let a = (i / 14) * Math.PI * 2 + R() * 0.3;
    let x = 256;
    let y = 256;
    let w = 7;
    const len = 150 + R() * 90;
    g.beginPath();
    g.moveTo(x, y);
    for (let d = 0; d < len; d += 14) {
      a += (R() - 0.5) * 0.7;
      x += Math.cos(a) * 14;
      y += Math.sin(a) * 14;
      g.lineWidth = Math.max(1, w * (1 - d / len));
      g.lineTo(x, y);
      if (R() < 0.12) {
        // branch
        g.stroke();
        g.beginPath();
        g.moveTo(x, y);
        const b = a + (R() < 0.5 ? 0.8 : -0.8);
        g.lineTo(x + Math.cos(b) * 34, y + Math.sin(b) * 34);
        g.stroke();
        g.beginPath();
        g.moveTo(x, y);
      }
    }
    g.stroke();
    w -= 0.2;
  }
  return tex(c, { srgb: true });
}
