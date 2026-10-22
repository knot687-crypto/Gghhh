// Blade sweep renders:  node preview/sweep.mjs Light1:0.08:0.3:0.19 Light2:... --views threeq,front,top
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { build } from '../anim/build.mjs';
import { CHROME, CHROME_ARGS, startServer } from './server.mjs';

const specs = process.argv.slice(2).filter((a) => a.includes(':'));
const viewsArg = process.argv.indexOf('--views');
const views = viewsArg > 0 ? process.argv[viewsArg + 1].split(',') : ['threeq', 'front', 'top'];
const skipBuild = process.argv.includes('--nobuild');
if (!skipBuild) await build();
const outDir = '/tmp/claude-0/sheets';
fs.mkdirSync(outDir, { recursive: true });
const server = await startServer(0);
const browser = await chromium.launch({ executablePath: CHROME, args: CHROME_ARGS });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('pageerror:', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
await page.waitForFunction(() => window.AAA_READY);
await page.evaluate(() => window.AAA.init({ width: 400, height: 400 }));
for (const s of specs) {
  const [clip, t0, t1, at] = s.split(':');
  const url = await page.evaluate((o) => window.AAA.sweep(o), { clip, t0: +t0, t1: +t1, at: +at, views, cellW: 380, cellH: 380 });
  const file = path.join(outDir, `${clip}_sweep.png`);
  fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  console.log(file);
}
await browser.close();
server.close();
