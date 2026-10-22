// Writes the particle/decal textures the Roblox VFX use to assets/textures/*.png (the same
// procedural sprites the preview renders with). Upload them and paste the ids into
// AAAMotion/Config.Textures.
//   node preview/export-textures.mjs
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { CHROME, CHROME_ARGS, startServer } from './server.mjs';

const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../assets/textures');
const server = await startServer(0);
const browser = await chromium.launch({ executablePath: CHROME, args: CHROME_ARGS });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/video.html`);
  await page.waitForFunction(() => window.AAAV_READY);
  const images = await page.evaluate(async () => {
    const T = await import('/src/textures.js');
    const png = (tex) => tex.image.toDataURL('image/png');
    // Roblox particles are square: draw the streak into a square canvas.
    const streak = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      const grd = g.createLinearGradient(0, 0, 0, 128);
      grd.addColorStop(0, 'rgba(255,255,255,0)');
      grd.addColorStop(0.35, 'rgba(255,255,255,1)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.ellipse(64, 64, 7, 62, 0, 0, Math.PI * 2);
      g.fill();
      return c.toDataURL('image/png');
    };
    return {
      spark: png(T.sparkSprite()),
      glow: png(T.glowSprite()),
      streak: streak(),
      smoke: png(T.smokeSprite()),
      ring: png(T.ringSprite()),
      crack: png(T.crackTexture()),
    };
  });
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, url] of Object.entries(images)) {
    const file = path.join(OUT, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    console.log(file, fs.statSync(file).size);
  }
} finally {
  await browser.close();
  server.close();
}
