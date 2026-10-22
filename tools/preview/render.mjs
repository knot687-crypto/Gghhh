// Renders a scripted sequence to MP4 (or stills) with headless Chromium + ffmpeg.
//   node preview/render.mjs --seq movement --out ../media/movement.mp4 --workers 2
//   node preview/render.mjs --seq test --stills 30,90,240 --out /tmp/stills
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { build } from '../anim/build.mjs';
import { CHROME, CHROME_ARGS, startServer } from './server.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const seq = arg('seq', 'test');
const W = Number(arg('w', 1280));
const H = Number(arg('h', 720));
const FPS = Number(arg('fps', 60));
const workers = Number(arg('workers', 3));
const out = path.resolve(arg('out', `/tmp/claude-0/${seq}.mp4`));
const stills = arg('stills', null);
const range = arg('frames', null);
const crf = arg('crf', '17');
const OPTS = JSON.parse(arg('opts', '{"samples":0,"lights":2,"shadow":"pcf","lambert":true,"fxaa":true}'));

await build();
const server = await startServer(0);
const url = `http://127.0.0.1:${server.address().port}/video.html`;

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: Math.min(W, 1920), height: Math.min(H, 1080) } });
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.error('console:', m.text());
  });
  await page.goto(url);
  await page.waitForFunction(() => window.AAAV_READY);
  const info = await page.evaluate((o) => window.AAAV.init(o), { seq, width: W, height: H, fps: FPS, opts: OPTS });
  return { page, info };
}

const toBuf = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');

async function renderStills() {
  const browser = await chromium.launch({ executablePath: CHROME, args: CHROME_ARGS });
  const { page } = await openPage(browser);
  fs.mkdirSync(out, { recursive: true });
  const frames = stills.split(',').map(Number).sort((a, b) => a - b);
  for (const f of frames) {
    await page.evaluate((n) => window.AAAV.seek(n), f);
    const data = await page.evaluate(() => window.AAAV.frame(0.92));
    const file = path.join(out, `${seq}_${String(f).padStart(5, '0')}.jpg`);
    fs.writeFileSync(file, toBuf(data));
    console.log(file);
  }
  await browser.close();
}

// Resumable rendering: the frame range is cut into short segments, each encoded to its own MP4
// and renamed into place only when complete. Re-running the same command skips finished
// segments, so an interrupted render resumes where it stopped.
function segmentDir(total) {
  const h = crypto.createHash('sha1');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = [path.join(ROOT, 'build/clips.json'), ...walk(path.join(ROOT, 'preview/web')), ...walk(path.join(ROOT, 'anim'))];
  for (const f of files.sort()) h.update(fs.readFileSync(f));
  h.update(JSON.stringify({ seq, W, H, FPS, OPTS, crf, total }));
  const dir = path.join(ROOT, 'build/render', `${seq}-${h.digest('hex').slice(0, 10)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function encoder(file) {
  const ff = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', crf, '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-f', 'mp4', file,
  ]);
  ff.stderr.on('data', (d) => process.stderr.write(d));
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c)))));
  return { ff, done };
}

async function renderWorker(segments, progress) {
  if (!segments.length) return;
  const browser = await chromium.launch({ executablePath: CHROME, args: CHROME_ARGS });
  const { page } = await openPage(browser);
  for (const seg of segments) {
    await page.evaluate((n) => window.AAAV.seek(n), seg.start);
    const tmpFile = seg.file + '.part';
    const { ff, done } = encoder(tmpFile);
    for (let f = seg.start; f < seg.end; f++) {
      const data = await page.evaluate(() => window.AAAV.frame(0.95));
      if (!ff.stdin.write(toBuf(data))) await new Promise((r) => ff.stdin.once('drain', r));
      progress();
    }
    ff.stdin.end();
    await done;
    fs.renameSync(tmpFile, seg.file);
  }
  await browser.close();
}

async function renderVideo() {
  const probe = await chromium.launch({ executablePath: CHROME, args: CHROME_ARGS });
  const { info } = await openPage(probe);
  await probe.close();
  let [a, b] = range ? range.split(':').map(Number) : [0, info.frames];
  b = Math.min(b, info.frames);
  const total = b - a;
  const dir = segmentDir(`${a}:${b}`);
  const SEG = Number(arg('segment', 240));
  const segs = [];
  for (let s = a, i = 0; s < b; s += SEG, i++) {
    segs.push({ start: s, end: Math.min(b, s + SEG), file: path.join(dir, `seg_${String(i).padStart(4, '0')}.mp4`) });
  }
  const todo = segs.filter((s) => !fs.existsSync(s.file));
  const todoFrames = todo.reduce((n, s) => n + s.end - s.start, 0);
  console.log(`${seq}: ${segs.length} segments in ${dir}, ${todo.length} to render (${todoFrames} frames)`);
  const t0 = Date.now();
  let done = 0;
  let last = 0;
  const progress = () => {
    done += 1;
    if (Date.now() - last > 15000) {
      last = Date.now();
      const rate = done / ((Date.now() - t0) / 1000);
      console.log(`  ${done}/${todoFrames} frames  ${rate.toFixed(2)} fps  eta ${((todoFrames - done) / rate / 60).toFixed(1)} min`);
    }
  };
  // Interleave so each worker only ever seeks forward.
  const lanes = Array.from({ length: workers }, () => []);
  todo.forEach((s, i) => lanes[i % workers].push(s));
  await Promise.all(lanes.map((lane) => renderWorker(lane, progress)));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const list = path.join(dir, 'list.txt');
  fs.writeFileSync(list, segs.map((s) => `file '${s.file}'`).join('\n'));
  await new Promise((res, rej) => {
    const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out]);
    p.stderr.on('data', (d) => process.stderr.write(d));
    p.on('close', (c) => (c === 0 ? res() : rej(new Error('concat failed'))));
  });
  console.log(`${out}  (${total} frames, ${todoFrames} rendered in ${((Date.now() - t0) / 60000).toFixed(1)} min)`);
}

try {
  if (stills) await renderStills();
  else await renderVideo();
} finally {
  server.close();
}
