// Touch screens: on-screen buttons for what the mouse's right button and the keyboard do.
// A tool bar (rotate / done) while building, and a drive pad while riding a vehicle.
import { G } from './state.js';

const coarse = matchMedia('(pointer: coarse)');
const root = document.documentElement;
const setTouch = (on) => root.classList.toggle('touch', on);
setTouch(coarse.matches);
coarse.addEventListener?.('change', (e) => setTouch(e.matches));
window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') setTouch(true); }, true);

const bar = document.createElement('div');
bar.id = 'tbar';
bar.hidden = true;
bar.innerHTML = `<button class="btn" data-t="rotate">⟳ Rotate</button><button class="btn primary" data-t="done">✓ Done</button>`;
bar.addEventListener('click', (e) => {
  const t = e.target.closest('[data-t]')?.dataset.t;
  if (t === 'rotate') G.tools.rotate();
  if (t === 'done') G.tools.setTool({ type: 'select' });
  G.audio?.play('click');
});

// Holding a pad button holds down the matching key, so vehicles drive exactly as with W A S D.
const pad = document.createElement('div');
pad.id = 'pad';
pad.hidden = true;
pad.innerHTML = `<div class="dpad">
  <button data-k="w" class="up" aria-label="Forward">▲</button><button data-k="a" class="lt" aria-label="Left">◀</button>
  <button data-k="d" class="rt" aria-label="Right">▶</button><button data-k="s" class="dn" aria-label="Back">▼</button></div>
<div class="extra">
  <button data-k="e" class="heli" aria-label="Fly higher">Up</button><button data-k="q" class="heli" aria-label="Fly lower">Down</button>
  <button data-x="rifle" class="rifle">Rifle</button><button data-x="horn" class="car">Horn</button></div>`;
const keys = () => G.engine.keys;
const release = (b) => { if (b.dataset.k) keys().delete(b.dataset.k); b.classList.remove('on'); };
pad.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  e.preventDefault();
  b.setPointerCapture?.(e.pointerId);
  b.classList.add('on');
  if (b.dataset.k) keys().add(b.dataset.k);
  const g = G.game, v = G.engine.cam.follow;
  if (b.dataset.x === 'rifle') g?.heliShoot('rifle');
  if (b.dataset.x === 'horn' && v) g?.horn(v);
});
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(ev, (e) => { const b = e.target.closest('button'); if (b) release(b); });
pad.addEventListener('contextmenu', (e) => e.preventDefault());

document.body.append(bar, pad);

let last = '';
// Called once a frame; only touches the DOM when what should show changes.
export function updateTouch() {
  const g = G.game, cam = G.engine.cam;
  let state = 'none';
  if (root.classList.contains('touch') && g && g.mode !== 'demo' && !G.ui.modalOpen()) {
    if (cam.mode === 'ride') state = 'ride:' + (cam.follow?.kind || '') + (g.rifle || g.driveBy ? ':rifle' : '');
    else if (G.tools.tool.type !== 'select') state = 'tool:' + G.tools.tool.type;
  }
  if (state === last) return;
  if (last.startsWith('ride')) for (const b of pad.querySelectorAll('button')) release(b);
  last = state;
  bar.hidden = !state.startsWith('tool');
  bar.querySelector('[data-t="rotate"]').hidden = state !== 'tool:building';
  const [, kind, rifle] = state.split(':');
  const drive = ['cruiser', 'jeep', 'balloon', 'heli'].includes(kind);
  pad.hidden = !state.startsWith('ride') || !drive;
  pad.querySelectorAll('.heli').forEach((b) => (b.hidden = kind !== 'heli'));
  pad.querySelector('.rifle').hidden = !(kind === 'heli' || ((kind === 'cruiser' || kind === 'jeep') && rifle));
  pad.querySelector('.car').hidden = !(kind === 'cruiser' || kind === 'jeep');
  // the jeep only speeds up and slows down
  pad.querySelectorAll('.lt, .rt').forEach((b) => (b.hidden = kind === 'jeep'));
}

// Turning a phone re-fits the build wheel to the new screen.
window.addEventListener('resize', () => { if (G.ui?.wheelOpen) G.ui.renderWheel(); });
