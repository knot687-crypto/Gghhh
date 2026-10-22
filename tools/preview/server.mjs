// Tiny static server for the preview page (three.js, anim core, built clip data, fonts).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tools = path.resolve(here, '..');

const ROUTES = [
  ['/three/', path.join(tools, 'node_modules/three/')],
  ['/fonts/', path.join(tools, 'node_modules/@fontsource/rajdhani/files/')],
  ['/anim/', path.join(tools, 'anim/')],
  ['/data/', path.join(tools, 'build/')],
  ['/', path.join(here, 'web/')],
];

const TYPES = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.html': 'text/html',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};

export function startServer(port = 0) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let file = null;
    for (const [prefix, dir] of ROUTES) {
      if (url.startsWith(prefix)) {
        file = path.join(dir, url.slice(prefix.length) || 'index.html');
        break;
      }
    }
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

export const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
export const CHROME_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
