// Video mode entry: builds an App for a named sequence and renders frames on demand.
import { App } from './director.js';
import { SEQUENCES } from './sequences.js';

let app = null;

async function init({ seq, width = 1280, height = 720, fps = 60, opts = {} }) {
  const clips = await (await fetch('/data/clips.json')).json();
  if (document.fonts) {
    await document.fonts.load('700 40px Rajdhani');
    await document.fonts.load('600 20px Inter');
    await document.fonts.ready;
  }
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  app = new App({ canvas, width, height, clips, fps, opts });
  const info = SEQUENCES[seq](app);
  app.duration = info.duration;
  app.hud.badge = info.badge ?? null;
  return { duration: info.duration, frames: Math.round(info.duration * fps) };
}

// Simulate without rendering up to (not including) frame index n.
function seek(n) {
  while (app.frame < n) app.step();
  return app.frame;
}

function frame(quality = 0.94) {
  app.step();
  const c = app.render();
  return c.toDataURL('image/jpeg', quality);
}

window.AAAV = { init, seek, frame, get app() { return app; } };
window.AAAV_READY = true;
