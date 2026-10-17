// The original's PC cheat codes: key sequences of arrow keys and [ ] typed during play.
// The sequences are the original's; the effects are ours. Names here are our own descriptions.
import { G } from './state.js';
import { SPECIES, RESEARCH, MISSIONS, EXERCISES, DISEASES } from './data.js';
import { loadProgress, saveProgress } from './park.js';

const KEY = { arrowup: 'U', arrowdown: 'D', arrowleft: 'L', arrowright: 'R', '[': '[', ']': ']' };
const seq = (s) => s.split(' ').join('');
const CHEATS = [
  ['U [ D [', '+$10,000', (g) => g.park.earn(10000, 'Sales')],
  ['[ R R [ ] D', '+$250,000', (g) => g.park.earn(250000, 'Sales')],
  ['[ ] [ ] D D', 'Money set to $0', (g) => { g.park.money = 0; }],
  ['D [ ] D', 'Fossil Market restocked', (g) => { g.park.market.next = 0; g.park.market.closed = false; g.park.cheatMarket = true; }],
  ['L D R U [ ] [ ]', 'Three dig sites without star requirements', (g) => { g.park.cheatSites = 3; }],
  ['R [ U [ [ D', 'Park rating +1 star', (g) => { g.park.ratingBonus = (g.park.ratingBonus || 0) + 1; }],
  ['[ ] D D [ R', 'Park rating set to three stars', (g) => { g.park.ratingFloor = 3; }],
  ['U U ] [ U U', 'Dinosaurs no longer get sick', (g) => { g.park.noDisease = true; for (const d of g.dinos) d.disease = null; }],
  ['D U D L ] ] ]', 'Every dinosaur falls sick', (g) => { for (const d of g.dinos) if (!d.dead) { d.immune = []; d.catchDisease(); } }],
  ['[ [ [ L L L', 'Every carnivore is stressed', (g) => { for (const d of g.dinos) if (d.sp.diet === 'carn') d.stress = 100; }],
  ['[ L U L U L [', 'No more rampages', (g) => { g.park.noRampage = true; }],
  ['] [ U D U D', 'A Land Cruiser blows up', (g) => { const j = g.vehicles.find((v) => v.kind === 'jeep'); if (j) { j.state = 'tour'; j.hit(999); } }],
  ['] U [ D', 'Genomes set to 55%', (g) => { for (const s of SPECIES) if (g.park.dna[s.id] > 0) g.park.dna[s.id] = 55; }],
  ['] U ] R [ D', 'Genomes set to 100%', (g) => { for (const s of SPECIES) if (g.park.dna[s.id] > 0) g.park.dna[s.id] = 100; }],
  ['[ ] [ R D ]', 'Genomes set to 0%', (g) => { for (const s of SPECIES) g.park.dna[s.id] = 0; }],
  ['D D D L R [ D U', 'All research complete', (g) => { for (const r of RESEARCH) g.park.research.done.add(r.id); g.park.research.active = []; }],
  ['L R L R ]', 'Every guest dies', (g) => { for (const v of g.visitors.list) if (!v.gone) g.visitors.kill(v, null, 'cheat'); }],
  ['] R R R R ]', 'All missions, exercises and Site B unlocked', () => { const p = loadProgress(); for (const m of MISSIONS) p.missions[m.id] = true; for (const e of EXERCISES) p.exercises[e.id] = true; p.siteB = true; saveProgress(p); }],
  ['[ ] L D R R', 'The Land Cruiser camera becomes a rifle', (g) => { g.driveBy = true; }],
  ['] ] ] [ R', 'Zombie dinosaurs', (g) => { g.zombies = !g.zombies; for (const d of g.dinos) d.mesh?.traverse((o) => { if (o.isMesh && o.material?.color) { o.material = o.material.clone(); o.material.color.multiplyScalar(g.zombies ? 0.55 : 1 / 0.55).offsetHSL(0, g.zombies ? -0.3 : 0.3, 0); } }); }],
  ['D ] D ] D ]', 'Heatwave', (g) => g.park.forceWeather('heat')],
  ['] [ ] D U D', 'Thunderstorm', (g) => g.park.forceWeather('storm')],
  ['] ] L R U R', 'Storm cleared', (g) => g.park.forceWeather('clear')],
  ['[ ] L R [ ]', 'No more twisters', (g) => { g.park.noTwister = true; g.park.twister = null; }],
  ['L U R D [ ]', 'Twister!', (g) => g.park.forceWeather('twister')],
  ['[ ] D ] [', 'Every dinosaur dies', (g) => { for (const d of g.dinos) if (!d.dead) d.die('extinction'); }],
  ['] L D D D D', 'No more fatality fines', (g) => { g.park.noFines = true; }],
  ['] D [ U U U', 'Every guest is happy', (g) => { for (const v of g.visitors.list) v.happy = 100; }],
  ['[ L L ] ] R', 'All fences Low Security', (g) => g.setAllFences(1)],
  ['D D L R [ [ U', 'All fences High Security', (g) => g.setAllFences(3)],
  ['U ] D [ L L', 'All fences destroyed', (g) => g.setAllFences(0)],
  ['R R ] ] [ D', 'All paths dirty', (g) => { for (let i = 0; i < g.map.path.length; i++) if (g.map.path[i] === 1) g.dirt[i] = 1; g.litterDirty = true; }],
].map(([s, name, fn]) => ({ code: seq(s), name, fn }));
const LONGEST = Math.max(...CHEATS.map((c) => c.code.length));

let buf = '';
export function cheatKey(k) {
  const t = KEY[k];
  if (!t) { if (k.length === 1) buf = ''; return; }
  buf = (buf + t).slice(-LONGEST);
  const g = G.game;
  if (!g || g.mode === 'demo') return;
  // longest match first, so a short code inside a longer one does not fire early
  const hit = CHEATS.filter((c) => buf.endsWith(c.code)).sort((a, b) => b.code.length - a.code.length)[0];
  if (!hit) return;
  buf = '';
  hit.fn(g);
  g.notify(`Cheat: ${hit.name}.`, 'info');
  G.ui?.refreshTop?.();
}
export { DISEASES };
