// Compiles every clip module into tools/build/clips.json (consumed by the preview and exporters).
// Clip files are cached by a content hash of the file, the clip files it imports and the shared
// authoring sources, so only edited files pay the IK cost again.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../build');
const cacheDir = path.join(outDir, 'cache');

function sharedHash() {
  const h = crypto.createHash('sha1');
  const files = [
    ...fs.readdirSync(path.join(here, 'core')).map((f) => path.join(here, 'core', f)),
    // Authoring sources clips depend on (exporters and this file are deliberately excluded).
    ...fs
      .readdirSync(here)
      .filter((f) => f.endsWith('.mjs') && f !== 'build.mjs' && !f.startsWith('export-'))
      .map((f) => path.join(here, f)),
  ].sort();
  for (const f of files) h.update(fs.readFileSync(f));
  return h.digest('hex');
}

function fileHash(dir, file, shared, seen = new Set()) {
  const h = crypto.createHash('sha1');
  h.update(shared);
  const visit = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    h.update(src);
    for (const m of src.matchAll(/from '\.\/([\w-]+\.mjs)'/g)) visit(m[1]);
  };
  visit(file);
  return h.digest('hex');
}

export async function loadClips({ verbose = false } = {}) {
  const dir = path.join(here, 'clips');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort();
  const shared = sharedHash();
  fs.mkdirSync(cacheDir, { recursive: true });
  const all = {};
  for (const f of files) {
    const hash = fileHash(dir, f, shared);
    const cacheFile = path.join(cacheDir, `${path.basename(f, '.mjs')}.${hash}.json`);
    let list;
    if (fs.existsSync(cacheFile)) {
      list = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    } else {
      const t0 = Date.now();
      const mod = await import(path.join(dir, f) + `?t=${Date.now()}`);
      list = mod.default ?? [];
      for (const old of fs.readdirSync(cacheDir).filter((x) => x.startsWith(path.basename(f, '.mjs') + '.'))) {
        fs.unlinkSync(path.join(cacheDir, old));
      }
      fs.writeFileSync(cacheFile, JSON.stringify(list));
      if (verbose) console.log(`  compiled ${f} (${list.length} clips, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }
    for (const c of list) {
      if (all[c.name]) throw new Error(`Duplicate clip name ${c.name} (${f})`);
      all[c.name] = { ...c, group: path.basename(f, '.mjs') };
    }
  }
  return all;
}

export async function build(opts = {}) {
  const clips = await loadClips(opts);
  const { bakeSwings } = await import('./combat-kit.mjs');
  for (const c of Object.values(clips)) {
    if (c.markers.some((m) => m.name === 'SwingStart')) c.swings = bakeSwings(c);
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'clips.json'), JSON.stringify(clips));
  return clips;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const clips = await build({ verbose: true });
  console.log(`built ${Object.keys(clips).length} clips -> ${path.relative(process.cwd(), outDir)}/clips.json`);
}
