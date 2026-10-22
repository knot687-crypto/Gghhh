// Contact sheets for animation review.
//   node preview/sheet.mjs --clip Run,Sprint --n 8 --views side,front --out ../out/sheets
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { build } from '../anim/build.mjs';
import { CHROME, CHROME_ARGS, startServer } from './server.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]?.startsWith('--') ? 'true' : arr[i + 1]]);
    return acc;
  }, []),
);

const clips = await build();
const names = (args.clip ?? '').split(',').filter(Boolean);
const outDir = path.resolve(args.out ?? '/tmp/claude-0/sheets');
fs.mkdirSync(outDir, { recursive: true });

const server = await startServer(0);
const port = server.address().port;
const browser = await chromium.launch({ executablePath: CHROME, args: CHROME_ARGS });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('pageerror', (e) => console.error('pageerror:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.error('console:', m.text());
});
await page.goto(`http://127.0.0.1:${port}/index.html`);
await page.waitForFunction(() => window.AAA_READY);
await page.evaluate(() => window.AAA.init({ width: 400, height: 400 }));

for (const name of names) {
  const clip = clips[name];
  if (!clip) {
    console.error('unknown clip', name);
    continue;
  }
  const n = Number(args.n ?? 8);
  let times;
  if (args.times) times = args.times.split(',').map(Number);
  else {
    const end = clip.loop ? clip.length * (1 - 1 / n) : clip.length;
    times = Array.from({ length: n }, (_, i) => (n === 1 ? 0 : (end * i) / (n - 1)));
  }
  const views = (args.views ?? (clip.rig === 'VM' ? 'fp' : 'side,front')).split(',');
  const url = await page.evaluate(
    (o) => window.AAA.sheet(o),
    {
      clip: name,
      times,
      views,
      cellW: Number(args.w ?? (clip.rig === 'VM' ? 360 : 240)),
      cellH: Number(args.h ?? (clip.rig === 'VM' ? 220 : 300)),
      style: args.style ?? 'hero',
    },
  );
  const file = path.join(outDir, `${name}${args.suffix ?? ''}.png`);
  fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  console.log(file);
}
await browser.close();
server.close();
