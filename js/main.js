// Boot: create engine, UI, input and audio; run the main loop.
import { G, loadSettings } from './state.js';
import { Engine } from './engine.js';
import { Game, missionById } from './game.js';
import { UI } from './ui.js';
import { Tools } from './tools.js';
import { AudioEngine } from './audio.js';
import './save.js';
import { loadRigs } from './rigged.js';
import { loadNature } from './nature.js';
import { loadPeople } from './people.js';
import { loadFarm } from './livestock.js';
import { updateTouch } from './touch.js';

// Keep recent errors for debugging from the browser console (ISLA_ERRORS).
window.ISLA_ERRORS = [];
window.addEventListener('error', (e) => { window.ISLA_ERRORS.push(String(e.error?.stack || e.message)); if (window.ISLA_ERRORS.length > 30) window.ISLA_ERRORS.shift(); });
window.addEventListener('unhandledrejection', (e) => window.ISLA_ERRORS.push('promise: ' + String(e.reason?.stack || e.reason)));

loadSettings();
const canvas = document.getElementById('c');
G.engine = new Engine(canvas);
G.audio = new AudioEngine();
G.tools = new Tools(G.engine, canvas);
G.ui = new UI();

let lastOpts = null;

function replaceGame(game) {
  if (G.game && G.game !== game) G.game.dispose();
  G.game = game;
}

function startDemo() {
  replaceGame(null);
  const g = new Game({ mode: 'demo', seed: 777 });
  g.park.dayFrac = 0.18;
  G.game = g;
  const cam = G.engine.cam;
  Object.assign(cam, { mode: 'orbit', follow: null, tdist: 70, tpitch: 0.55, tx: 52, tz: 50, x: 52, z: 50, dist: 70, pitch: 0.55 });
  G.ui.showMenu('main');
  G.audio.startMusic();
}

G.main = {
  newGame(opts) {
    lastOpts = opts;
    G.audio.stopMusic();
    G.tools.setTool({ type: 'select' });
    G.tools.hoverB = null; G.ui?.cursorTip(null);
    if (G.game) G.game.dispose();
    G.game = null;
    const g = new Game(opts);
    G.game = g;
    G.ui.onGameStart();
    G.tools.setTool({ type: 'select' });
    if (g.mission && (opts.mode === 'mission' || opts.mode === 'exercise')) G.ui.openModal('briefing');
    else if (opts.mode === 'career') { G.ui.openModal('briefing'); }
    else if (opts.mode === 'siteb') { g.notify('Welcome to Site B. Build hatcheries and let up to 60 dinosaurs roam free.', 'info'); G.ui.openModal('sitebSetup'); }
    else if (opts.mode === 'sandbox') g.notify('Sandbox: unlimited money, all research and full genomes.', 'info');
  },
  startFromSave(d) {
    const mission = d.missionId ? missionById(d.missionId) : null;
    lastOpts = { mode: d.mode, mission, name: d.name };
    G.audio.stopMusic();
    if (G.game) G.game.dispose();
    G.game = null;
    const g = new Game({ mode: d.mode, mission, save: d, name: d.name });
    G.game = g;
    G.ui.onGameStart();
    G.tools.setTool({ type: 'select' });
    g.notify(`Loaded "${d.name}".`, 'good');
  },
  restart() { if (lastOpts) this.newGame({ ...lastOpts, save: undefined }); },
  // Live island preview for the island generation screen.
  previewIsland(P) {
    if (G.game) G.game.dispose();
    G.game = null;
    const g = new Game({ mode: 'demo', seed: P.seed, params: P, preview: true });
    G.game = g;
    const cam = G.engine.cam;
    const W = g.map.W;
    Object.assign(cam, { mode: 'orbit', follow: null, tdist: W * 1.25, tpitch: 0.95, tx: W * 0.56, tz: W * 0.52 });
  },
  toMenu() {
    if (G.engine.cam.mode === 'ride') G.game?.exitControl();
    G.tools.setTool({ type: 'select' });
    startDemo();
  },
};

window.addEventListener('pointerdown', () => G.audio.init(), { once: false });
window.addEventListener('keydown', () => G.audio.init());

// Autosave when the tab is hidden or closed, so a park is never lost.
const saveOnLeave = () => { const g = G.game; if (g && g.mode !== 'demo' && G.settings.autosave) G.save.autosave(); };
document.addEventListener('visibilitychange', () => { if (document.hidden) saveOnLeave(); });
window.addEventListener('pagehide', saveOnLeave);

// The animated dinosaur models load first; if they fail, the procedural models are used instead.
Promise.allSettled([loadRigs(), loadNature(), loadPeople(), loadFarm()]).finally(() => {
  startDemo();
  document.getElementById('loading')?.remove();
});

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const g = G.game;
  if (g) {
    if (g.mode === 'demo') {
      G.engine.cam.tyaw += dt * 0.05;
      g.update(dt);
    } else g.update(dt);
    G.engine.setAtmosphere(g.park.hour, g.park.weather.type, dt);
    G.audio.update(dt, g.park.isNight, g.park.weather.type);
  }
  G.engine.updateCamera(dt);
  G.ui.update(dt);
  updateTouch();
  G.engine.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug handle for the browser console.
window.ISLA = G;

// Offline play and "Add to Home Screen": the service worker caches the game as it loads.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then((reg) => {
      // Hand over everything this first visit already fetched, so it is cached too.
      const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => /^https?:/.test(u));
      reg.active?.postMessage({ type: 'cache', urls: [location.href, ...urls] });
    }).catch(() => { /* no offline mode */ });
  });
}
