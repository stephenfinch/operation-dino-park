// Missions and exercises in the style of the original: island layouts (setups), the free-driving Land Cruiser,
// the helicopter muster and ammunition, VIP rescues and haywire hatcheries. Mixed into Game (see game.js).
import * as THREE from 'three';
import { G } from './state.js';
import { BLD, SPECIES_BY_ID, SIZE_RANK } from './data.js';
import { T } from './map.js';
import { MAT, jeepGeometry } from './models.js';
import { PEOPLE, peopleLoaded } from './people.js';
import { clamp, rand, randi, pick, chance, dist, dist2, angleLerp, lerp } from './util.js';

// ---------- layout helpers ----------
function centre(g) { const e = g.map.entrance; return { x: e.x + 1, y: e.y - 34 }; }
function ground(g, x0, y0, x1, y1, trees = 0, kinds = [1, 2, 3, 4, 5]) {
  const map = g.map;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!map.inb(x, y)) continue;
    const i = map.idx(x, y);
    if (map.terrain[i] === T.SEA || map.bld[i] >= 0 || map.path[i]) continue;
    map.terrain[i] = T.GRASS; map.rockH[i] = 0;
    map.flora[i] = trees && Math.random() < trees ? pick(kinds) : 0;
  }
}
function lake(g, cx, cy, r) {
  const map = g.map;
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    if (!map.inb(x, y) || Math.hypot(x - cx, y - cy) > r + 0.3) continue;
    const i = map.idx(x, y);
    if (map.terrain[i] !== T.SEA) { map.terrain[i] = T.WATER; map.flora[i] = 0; }
  }
}
function pen(g, x0, y0, x1, y1, fence) {
  for (const e of g.fenceEdgesRect(x0, y0, x1 + 1, y1 + 1)) if (g.fenceEdgeValid(e)) g.map.setFence(e.h, e.i, fence);
}
function wall(g, ax, ay, bx, by, fence) {
  for (const e of g.fenceEdgesLine(ax, ay, bx, by)) if (g.fenceEdgeValid(e)) g.map.setFence(e.h, e.i, fence);
}
function path(g, ax, ay, bx, by) { for (const i of g.pathTilesL(ax, ay, bx, by)) { g.map.path[i] = 1; g.map.flora[i] = 0; } g.map.ver.path++; }
function bld(g, type, x, y, rot = 0) {
  let b = g.placeBuilding(type, x, y, rot, { free: true, silent: true, preset: true });
  // nudge the building around if the spot is blocked
  for (let k = 1; !b && k < 6; k++) b = g.placeBuilding(type, x + (k % 2 ? k : -k), y + (k > 2 ? 2 : 0), rot, { free: true, silent: true, preset: true });
  if (b) b.preset = true;
  return b;
}
function spawn(g, sp, n, x0, y0, x1, y1, o = {}) {
  const out = [];
  for (let k = 0; k < n; k++) {
    let x, z, tries = 0;
    do { x = rand(x0, x1); z = rand(y0, y1); tries++; } while (tries < 30 && !g.map.dinoPassable(g.map.idx(Math.floor(x), Math.floor(z))));
    const d = g.spawnDino(sp, x, z, { age: 6, genome: 85, hunger: 85, thirst: 85, ...o });
    if (o.tag) d.tag = o.tag;
    if (o.stress) d.stress = o.stress;
    out.push(d);
  }
  return out;
}
function finish(g) { g.map.computeHeights(); g.map.ver.path++; g.map.ver.flora++; g.map.regionsDirty = true; g.map.computeRegions(); }

// ---------- mission and exercise layouts ----------
export const SETUPS = {
  // Safari: an open savanna with lakes. Allosaurus will charge the Land Cruiser; don't run over the Dilophosaurus.
  picture(g) {
    const c = centre(g);
    ground(g, c.x - 32, c.y - 28, c.x + 32, c.y + 30, 0.06);
    lake(g, c.x + 9, c.y - 6, 4); lake(g, c.x - 14, c.y + 8, 3); lake(g, c.x + 2, c.y - 20, 3);
    path(g, c.x, c.y + 31, c.x, c.y + 24);
    finish(g);
    spawn(g, 'allosaurus', 2, c.x + 14, c.y - 24, c.x + 26, c.y - 12);
    spawn(g, 'brachiosaurus', 2, c.x - 10, c.y - 18, c.x + 6, c.y - 6);
    spawn(g, 'camarasaurus', 2, c.x - 24, c.y - 12, c.x - 12, c.y);
    spawn(g, 'dilophosaurus', 8, c.x - 20, c.y + 4, c.x + 20, c.y + 18);
    spawn(g, 'kentrosaurus', 3, c.x + 10, c.y + 2, c.x + 22, c.y + 12);
    spawn(g, 'stegosaurus', 3, c.x - 6, c.y - 4, c.x + 8, c.y + 6);
    g.addCruiser(c.x + 0.5, c.y + 24);
  },
  // Ranger Attack: carnivores loose among the herbivores.
  attack(g) {
    const c = centre(g);
    ground(g, c.x - 30, c.y - 28, c.x + 30, c.y + 28, 0.12);
    lake(g, c.x - 8, c.y - 6, 4); lake(g, c.x + 12, c.y + 8, 3);
    finish(g);
    bld(g, 'ranger', c.x + 1, c.y + 26, 0);
    spawn(g, 'gallimimus', 10, c.x - 20, c.y - 20, c.x + 20, c.y + 10);
    spawn(g, 'corythosaurus', 6, c.x - 18, c.y - 18, c.x + 18, c.y + 14);
    spawn(g, 'tyrannosaurus', 3, c.x - 22, c.y - 22, c.x + 22, c.y + 12, { tag: 'target', stress: 90 });
    spawn(g, 'carcharodontosaurus', 2, c.x - 22, c.y - 22, c.x + 22, c.y + 12, { tag: 'target', stress: 90 });
    spawn(g, 'velociraptor', 8, c.x - 22, c.y - 22, c.x + 22, c.y + 12, { tag: 'target', stress: 90 });
    g.startHeli();
  },
  // Dino Muster: herbivores loose on the north side, a muster paddock in the south with its north side open.
  muster(g) {
    const c = centre(g);
    ground(g, c.x - 30, c.y - 30, c.x + 30, c.y + 26, 0.1);
    lake(g, c.x + 16, c.y - 18, 3);
    const z = { x0: c.x - 8, y0: c.y + 12, x1: c.x + 8, y1: c.y + 22 };
    wall(g, z.x0, z.y0, z.x0, z.y1 + 1, 1); wall(g, z.x1 + 1, z.y0, z.x1 + 1, z.y1 + 1, 1); wall(g, z.x0, z.y1 + 1, z.x1 + 1, z.y1 + 1, 1);
    finish(g);
    g.setMusterZone(z);
    bld(g, 'ranger', c.x + 18, c.y + 20, 0);
    spawn(g, 'edmontosaurus', 7, c.x - 20, c.y - 26, c.x + 4, c.y - 14);
    spawn(g, 'parasaurolophus', 7, c.x - 4, c.y - 26, c.x + 20, c.y - 12);
    spawn(g, 'tyrannosaurus', 4, c.x - 26, c.y - 8, c.x + 26, c.y + 4, { tag: 'target', hunger: 40 });
    g.startHeli();
  },
  // Safari: alternating heatwaves and thunderstorms.
  weather(g) {
    const c = centre(g);
    ground(g, c.x - 30, c.y - 28, c.x + 30, c.y + 30, 0.08);
    lake(g, c.x, c.y - 4, 4); lake(g, c.x - 18, c.y + 10, 3);
    path(g, c.x, c.y + 31, c.x, c.y + 24);
    finish(g);
    g.park.weatherCycle = ['heat', 'storm'];
    g.park.weather = { type: 'heat', left: 1.2, queue: [] };
    spawn(g, 'gallimimus', 6, c.x - 20, c.y - 20, c.x, c.y);
    spawn(g, 'dryosaurus', 6, c.x, c.y - 20, c.x + 20, c.y);
    spawn(g, 'stegosaurus', 3, c.x - 20, c.y, c.x, c.y + 14);
    spawn(g, 'ceratosaurus', 2, c.x + 12, c.y - 22, c.x + 24, c.y - 10);
    spawn(g, 'corythosaurus', 4, c.x + 4, c.y + 2, c.x + 20, c.y + 16);
    spawn(g, 'homalocephale', 5, c.x - 24, c.y - 10, c.x - 8, c.y + 4);
    spawn(g, 'velociraptor', 3, c.x + 18, c.y - 6, c.x + 26, c.y + 6);
    g.addCruiser(c.x + 0.5, c.y + 24);
  },
  // Ranger Rescue: rampaging carnivores in a storm; the president waits in a shelter.
  president(g) {
    const c = centre(g);
    ground(g, c.x - 30, c.y - 28, c.x + 30, c.y + 28, 0.12);
    lake(g, c.x + 10, c.y - 10, 3);
    finish(g);
    g.park.weatherCycle = ['storm'];
    g.park.weather = { type: 'storm', left: 9, queue: [] };
    bld(g, 'ranger', c.x + 1, c.y + 26, 0);
    const sh = bld(g, 'shelter', c.x - 16, c.y - 18, 0);
    spawn(g, 'velociraptor', 12, c.x - 26, c.y - 26, c.x + 26, c.y + 10, { tag: 'target', stress: 95 });
    spawn(g, 'carcharodontosaurus', 4, c.x - 26, c.y - 26, c.x + 26, c.y + 10, { tag: 'target', stress: 95 });
    spawn(g, 'spinosaurus', 2, c.x - 26, c.y - 26, c.x + 26, c.y + 10, { tag: 'target', stress: 95 });
    const ent = g.entrances()[0];
    g.addVip('The president', sh.cx, sh.cz + 1.6, g.entrancePad(ent));
    g.startHeli();
  },
  // Safari: carnivores only (plus their prey).
  danger(g) {
    const c = centre(g);
    ground(g, c.x - 30, c.y - 28, c.x + 30, c.y + 30, 0.08);
    lake(g, c.x - 6, c.y - 4, 4);
    path(g, c.x, c.y + 31, c.x, c.y + 24);
    finish(g);
    spawn(g, 'gallimimus', 8, c.x - 24, c.y - 20, c.x + 24, c.y + 10);
    spawn(g, 'homalocephale', 5, c.x - 24, c.y - 20, c.x + 24, c.y + 10);
    spawn(g, 'ouranosaurus', 4, c.x - 24, c.y - 20, c.x + 24, c.y + 10);
    spawn(g, 'corythosaurus', 4, c.x - 24, c.y - 20, c.x + 24, c.y + 10);
    spawn(g, 'styracosaurus', 3, c.x - 24, c.y - 20, c.x + 24, c.y + 10);
    spawn(g, 'velociraptor', 4, c.x - 24, c.y - 24, c.x - 8, c.y - 8, { hunger: 30 });
    spawn(g, 'carcharodontosaurus', 1, c.x + 10, c.y - 24, c.x + 24, c.y - 10, { hunger: 30 });
    spawn(g, 'tyrannosaurus', 1, c.x - 24, c.y, c.x - 10, c.y + 12, { hunger: 30 });
    spawn(g, 'spinosaurus', 1, c.x + 10, c.y, c.x + 24, c.y + 12, { hunger: 30 });
    g.addCruiser(c.x + 0.5, c.y + 24);
  },
  // Ranger Rescue by Land Cruiser: rifle at the Ranger Station, founder in the shelter, drive him to the entrance.
  founder(g) {
    const c = centre(g);
    ground(g, c.x - 30, c.y - 30, c.x + 30, c.y + 28, 0.1);
    lake(g, c.x - 4, c.y - 2, 3);
    finish(g);
    const rs = bld(g, 'ranger', c.x + 20, c.y + 4, 0);
    const sh = bld(g, 'shelter', c.x - 18, c.y - 22, 0);
    spawn(g, 'torosaurus', 4, c.x - 10, c.y - 10, c.x + 10, c.y + 10);
    spawn(g, 'styracosaurus', 3, c.x - 20, c.y - 4, c.x - 4, c.y + 10);
    spawn(g, 'parasaurolophus', 4, c.x + 4, c.y - 18, c.x + 20, c.y - 6);
    spawn(g, 'corythosaurus', 4, c.x - 4, c.y - 26, c.x + 10, c.y - 14);
    spawn(g, 'tyrannosaurus', 2, c.x - 24, c.y - 26, c.x + 24, c.y - 10);
    spawn(g, 'carcharodontosaurus', 1, c.x + 8, c.y - 26, c.x + 24, c.y - 14);
    spawn(g, 'spinosaurus', 1, c.x - 26, c.y - 4, c.x - 12, c.y + 8);
    g.rifleAt = { x: rs.cx, z: rs.cz + 2 };
    const ent = g.entrances()[0];
    g.addVip('The founder', sh.cx, sh.cz + 1.6, { x: ent.cx - Math.sin(ent.rot * Math.PI / 2) * -3, z: ent.cz - 3.5, y: 0 });
    g.helisGrounded = true;
    g.addCruiser(c.x + 0.5, c.y + 26);
  },
  // Ranger Attack: three haywire hatcheries keep releasing carnivores until their power boxes are shot out.
  cleanup(g) {
    const c = centre(g);
    ground(g, c.x - 30, c.y - 30, c.x + 30, c.y + 28, 0.1);
    finish(g);
    bld(g, 'ranger', c.x + 1, c.y + 26, 0);
    for (const [x, y] of [[c.x - 18, c.y - 18], [c.x + 18, c.y - 18], [c.x, c.y - 2]]) {
      const h = bld(g, 'hatchery', x, y, 0);
      if (h) { h.power = true; h.spawnT = rand(8, 20); h.spawnLeft = 4; g.addPowerBox(h); }
    }
    spawn(g, 'styracosaurus', 6, c.x - 20, c.y + 4, c.x + 20, c.y + 16);
    spawn(g, 'corythosaurus', 4, c.x - 20, c.y + 4, c.x + 20, c.y + 16);
    spawn(g, 'ouranosaurus', 4, c.x - 20, c.y - 10, c.x + 20, c.y + 4);
    spawn(g, 'velociraptor', 6, c.x - 24, c.y - 26, c.x + 24, c.y - 4, { tag: 'target', stress: 80 });
    spawn(g, 'carcharodontosaurus', 1, c.x - 24, c.y - 26, c.x + 24, c.y - 4, { tag: 'target', stress: 80 });
    spawn(g, 'spinosaurus', 1, c.x - 24, c.y - 26, c.x + 24, c.y - 4, { tag: 'target', stress: 80 });
    g.startHeli();
  },
  // Dino Muster through a maze of fences; carnivores and avoidance beacons make it harder.
  maze(g) {
    const c = centre(g);
    ground(g, c.x - 30, c.y - 30, c.x + 30, c.y + 28, 0.05);
    for (let k = 0; k < 4; k++) {
      const y = c.y - 20 + k * 8, gap = k % 2 ? c.x + 16 : c.x - 16;
      wall(g, c.x - 26, y, gap - 3, y, 1); wall(g, gap + 3, y, c.x + 26, y, 1);
    }
    const z = { x0: c.x - 6, y0: c.y + 16, x1: c.x + 6, y1: c.y + 24 };
    wall(g, z.x0, z.y0, z.x0, z.y1 + 1, 1); wall(g, z.x1 + 1, z.y0, z.x1 + 1, z.y1 + 1, 1); wall(g, z.x0, z.y1 + 1, z.x1 + 1, z.y1 + 1, 1);
    finish(g);
    g.setMusterZone(z);
    bld(g, 'ranger', c.x + 20, c.y + 22, 0);
    for (const [x, y] of [[c.x - 10, c.y - 8], [c.x + 10, c.y], [c.x - 4, c.y + 8]]) bld(g, 'beacon', x, y, 0);
    spawn(g, 'edmontosaurus', 6, c.x - 20, c.y - 28, c.x + 20, c.y - 22);
    spawn(g, 'ouranosaurus', 6, c.x - 20, c.y - 28, c.x + 20, c.y - 22);
    spawn(g, 'velociraptor', 6, c.x - 24, c.y - 10, c.x + 24, c.y + 6, { tag: 'target' });
    spawn(g, 'carcharodontosaurus', 1, c.x - 24, c.y - 10, c.x + 24, c.y + 6, { tag: 'target' });
    g.startHeli();
  },
  // Safari for the park calendar: a bit of everything.
  calendar(g) {
    const c = centre(g);
    ground(g, c.x - 30, c.y - 28, c.x + 30, c.y + 30, 0.08);
    lake(g, c.x - 4, c.y - 6, 4); lake(g, c.x + 14, c.y + 10, 3);
    path(g, c.x, c.y + 31, c.x, c.y + 24);
    finish(g);
    spawn(g, 'dryosaurus', 6, c.x - 24, c.y - 20, c.x, c.y);
    spawn(g, 'gallimimus', 6, c.x, c.y - 20, c.x + 24, c.y);
    spawn(g, 'homalocephale', 4, c.x - 24, c.y, c.x - 8, c.y + 14);
    spawn(g, 'corythosaurus', 4, c.x + 4, c.y + 2, c.x + 20, c.y + 18);
    spawn(g, 'styracosaurus', 4, c.x - 10, c.y - 10, c.x + 10, c.y + 10);
    spawn(g, 'stegosaurus', 3, c.x - 20, c.y - 24, c.x - 4, c.y - 10);
    spawn(g, 'ceratosaurus', 2, c.x + 12, c.y - 24, c.x + 24, c.y - 12, { hunger: 35 });
    spawn(g, 'velociraptor', 3, c.x + 16, c.y - 4, c.x + 26, c.y + 8, { hunger: 35 });
    spawn(g, 'tyrannosaurus', 1, c.x - 26, c.y - 26, c.x - 12, c.y - 14, { hunger: 35 });
    g.addCruiser(c.x + 0.5, c.y + 24);
  },

  // ----- exercises (park-building) -----
  welcome(g) {
    const c = centre(g);
    ground(g, c.x - 30, c.y - 24, c.x + 30, c.y + 30, 0.12);
    path(g, c.x, c.y + 31, c.x, c.y - 20); path(g, c.x - 24, c.y + 6, c.x + 24, c.y + 6);
    pen(g, c.x - 24, c.y - 20, c.x - 3, c.y + 4, 1); lake(g, c.x - 14, c.y - 10, 3);
    pen(g, c.x + 3, c.y - 20, c.x + 14, c.y + 4, 2); lake(g, c.x + 8, c.y - 14, 2);
    pen(g, c.x + 16, c.y - 20, c.x + 28, c.y + 4, 3); lake(g, c.x + 22, c.y - 14, 2);
    finish(g);
    bld(g, 'feeder_herb', c.x - 8, c.y - 4, 0); bld(g, 'feeder_herb', c.x + 8, c.y - 2, 0); bld(g, 'feeder_goat', c.x + 22, c.y - 4, 0);
    bld(g, 'ranger', c.x - 10, c.y + 12, 0);
    spawn(g, 'dryosaurus', 15, c.x - 22, c.y - 18, c.x - 5, c.y + 2);
    spawn(g, 'triceratops', 1, c.x + 5, c.y - 18, c.x + 12, c.y + 2);
    const rex = spawn(g, 'tyrannosaurus', 1, c.x + 18, c.y - 18, c.x + 26, c.y + 2)[0];
    g.tutorialRex = rex;
  },
  origins(g) {
    const c = centre(g);
    ground(g, c.x - 30, c.y - 24, c.x + 30, c.y + 30, 0.1);
    path(g, c.x, c.y + 31, c.x, c.y - 20);
    pen(g, c.x - 24, c.y - 20, c.x - 3, c.y + 10, 1); lake(g, c.x - 14, c.y - 8, 3);
    pen(g, c.x + 3, c.y - 20, c.x + 24, c.y + 10, 1); lake(g, c.x + 14, c.y - 8, 3);
    finish(g);
    spawn(g, 'corythosaurus', 4, c.x - 22, c.y - 18, c.x - 5, c.y + 8);
    g.park.claimed = ['hellA'];
    g.park.dna.torosaurus = 62;
    g.park.expeditions = [];
  },
  visitors(g) {
    const c = centre(g);
    ground(g, c.x - 30, c.y - 24, c.x + 30, c.y + 30, 0.1);
    path(g, c.x, c.y + 31, c.x, c.y - 20); path(g, c.x - 26, c.y + 8, c.x + 26, c.y + 8);
    pen(g, c.x - 26, c.y - 20, c.x - 3, c.y + 5, 1); lake(g, c.x - 14, c.y - 10, 3);
    pen(g, c.x + 3, c.y - 20, c.x + 26, c.y + 5, 3); lake(g, c.x + 14, c.y - 10, 3);
    finish(g);
    bld(g, 'feeder_herb', c.x - 8, c.y - 4, 0); bld(g, 'feeder_goat', c.x + 8, c.y - 4, 0);
    spawn(g, 'dryosaurus', 8, c.x - 24, c.y - 18, c.x - 5, c.y + 3);
    spawn(g, 'kentrosaurus', 3, c.x - 24, c.y - 18, c.x - 5, c.y + 3);
    spawn(g, 'stegosaurus', 2, c.x - 24, c.y - 18, c.x - 5, c.y + 3);
    bld(g, 'hatchery', c.x + 14, c.y + 13, 2);
    g.park.dna.tyrannosaurus = 62;
    g.park.research.done.add('fence_med'); g.park.research.done.add('fence_high');
  },
  secure(g) {
    const c = centre(g);
    ground(g, c.x - 30, c.y - 24, c.x + 30, c.y + 30, 0.1);
    path(g, c.x, c.y + 31, c.x, c.y - 20); path(g, c.x - 26, c.y + 8, c.x + 26, c.y + 8);
    pen(g, c.x - 26, c.y - 20, c.x - 3, c.y + 5, 2); lake(g, c.x - 14, c.y - 10, 3);
    pen(g, c.x + 3, c.y - 20, c.x + 26, c.y + 5, 2); lake(g, c.x + 14, c.y - 10, 3);
    finish(g);
    bld(g, 'feeder_goat', c.x - 8, c.y - 4, 0); bld(g, 'feeder_goat', c.x + 8, c.y - 4, 0);
    bld(g, 'snack', c.x + 2, c.y + 11, 3); bld(g, 'restroom', c.x - 3, c.y + 11, 1);
    spawn(g, 'tyrannosaurus', 1, c.x - 24, c.y - 18, c.x - 5, c.y + 3, { stress: 50 });
    spawn(g, 'velociraptor', 4, c.x + 5, c.y - 18, c.x + 24, c.y + 3, { stress: 50 });
    g.park.setOpen(true);
  },
  openRange(g) { const c = centre(g); ground(g, c.x - 32, c.y - 28, c.x + 32, c.y + 30, 0.12); path(g, c.x, c.y + 31, c.x, c.y + 20); finish(g); },
  classic(g) { const c = centre(g); ground(g, c.x - 32, c.y - 28, c.x + 32, c.y + 30, 0.14); path(g, c.x, c.y + 31, c.x, c.y + 20); finish(g); },
  lostWorld(g) {
    const c = centre(g);
    ground(g, c.x - 32, c.y - 28, c.x + 32, c.y + 30, 0.2);
    path(g, c.x, c.y + 31, c.x, c.y + 20);
    pen(g, c.x - 26, c.y - 22, c.x - 4, c.y + 2, 1); pen(g, c.x + 4, c.y - 22, c.x + 26, c.y + 2, 1);
    finish(g);
    spawn(g, 'homalocephale', 4, c.x - 24, c.y - 20, c.x - 6, c.y);
    spawn(g, 'styracosaurus', 3, c.x - 24, c.y - 20, c.x - 6, c.y);
    spawn(g, 'corythosaurus', 3, c.x + 6, c.y - 20, c.x + 24, c.y);
    spawn(g, 'ankylosaurus', 2, c.x + 6, c.y - 20, c.x + 24, c.y);
    spawn(g, 'pachycephalosaurus', 3, c.x - 24, c.y - 20, c.x - 6, c.y);
    spawn(g, 'gallimimus', 5, c.x + 6, c.y - 20, c.x + 24, c.y);
    spawn(g, 'velociraptor', 4, c.x - 28, c.y + 4, c.x + 28, c.y + 14, { tag: 'wildRaptor' });
    g.helisGrounded = false;
  },
  abodes(g) { const c = centre(g); ground(g, c.x - 32, c.y - 28, c.x + 32, c.y + 30, 0.12); path(g, c.x, c.y + 31, c.x, c.y + 20); finish(g); },
  storm(g) {
    const c = centre(g); ground(g, c.x - 30, c.y - 28, c.x + 30, c.y + 30, 0.1); path(g, c.x, c.y + 31, c.x, c.y + 20); finish(g);
    g.park.weatherCycle = ['storm', 'rain', 'storm', 'cloudy', 'storm', 'twister'];
  },
};

// ---------- the Land Cruiser (driven freely in Safari and Rescue missions) ----------
export class LandCruiser {
  constructor(game, x, z) {
    this.kind = 'cruiser';
    this.g = game; this.x = x; this.z = z; this.heading = -Math.PI / 2; this.speed = 0; this.hp = 100;
    this.mesh = new THREE.Mesh(jeepGeometry(0xe0a020, 0x2a6a2a), MAT.std);
    this.mesh.scale.setScalar(1.4); this.mesh.castShadow = true;
    game.root.add(this.mesh);
    this.controlled = false;
  }
  get busyText() { return `Land Cruiser · ${Math.round(this.hp)}% condition`; }
  blocked(x, z) {
    const map = this.g.map, tx = Math.floor(x), ty = Math.floor(z), ox = Math.floor(this.x), oy = Math.floor(this.z);
    if (!map.inb(tx, ty)) return true;
    const i = map.idx(tx, ty), t = map.terrain[i];
    if (t === T.SEA || (t === T.ROCK && map.rockH[i] > 1.2)) return true;
    const b = map.bld[i] >= 0 ? this.g.buildings.get(map.bld[i]) : null;
    if (b && !['feeder_herb', 'feeder_goat'].includes(b.type)) return true;
    if (tx !== ox || ty !== oy) {
      // fences block the cruiser unless broken
      if (tx !== ox && ty !== oy) return this.blocked(x, this.z) || this.blocked(this.x, z);
      const e = map.edgeBetween(ox, oy, tx, ty);
      if (map.fenceType(e.h, e.i) && map.fenceIntact(e.h, e.i)) return true;
    }
    return false;
  }
  update(dt) {
    const g = this.g, map = g.map;
    if (this.hp <= 0) { this.place(); return; }
    if (this.controlled) {
      const k = G.engine.keys;
      const water = map.terrain[map.idx(Math.floor(this.x), Math.floor(this.z))] === T.WATER;
      const top = water ? 1.5 : 4.8;
      let target = 0;
      if (k.has('w')) target = top; else if (k.has('s')) target = -1.8;
      this.speed = lerp(this.speed, target, Math.min(1, dt * (target === 0 ? 2.5 : 1.4)));
      const steer = (k.has('a') ? 1 : 0) - (k.has('d') ? 1 : 0);
      this.heading -= steer * dt * 1.6 * clamp(Math.abs(this.speed) / 2, 0.3, 1) * Math.sign(this.speed || 1);
    } else this.speed = lerp(this.speed, 0, Math.min(1, dt * 2));
    const nx = this.x + Math.cos(this.heading) * this.speed * dt, nz = this.z + Math.sin(this.heading) * this.speed * dt;
    if (this.blocked(nx, nz)) { if (Math.abs(this.speed) > 2.5) { this.hit(4, true); } this.speed *= -0.25; }
    else { this.x = nx; this.z = nz; }
    // running over small dinosaurs costs points, as in the original
    if (Math.abs(this.speed) > 1.8) for (const d of g.dinos) {
      if (d.dead || d.len > 1.6 || dist2(d.x, d.z, this.x, this.z) > 0.5) continue;
      d.die('run over by the Land Cruiser');
      g.park.stats.missionPoints = (g.park.stats.missionPoints || 0) - 10;
      G.ui?.scopeMsg?.(`Ran over a ${d.sp.name}! −10 points`);
      g.burst(d.x, 0.3, d.z, 0xa02020, 14);
    }
    this.place();
  }
  hit(dmg, quiet) {
    if (this.hp <= 0) return;
    this.hp = Math.max(0, this.hp - dmg);
    G.engine.shake = Math.max(G.engine.shake || 0, quiet ? 0.2 : 0.6);
    if (!quiet) G.audio?.playAt('crash', this.x, this.z, 0.8);
    if (this.hp <= 0) {
      this.g.burst(this.x, 0.6, this.z, 0x404040, 40);
      this.g.notify('The Land Cruiser has been wrecked!', 'danger', null, 'warden');
      if (this.g.vip?.state === 'aboard') this.g.vip.dead = true;
    }
  }
  place() {
    const y = Math.max(this.g.map.heightAt(this.x, this.z), -0.2) + 0.04;
    this.mesh.position.set(this.x, y, this.z);
    this.mesh.rotation.set(this.hp <= 0 ? 0.6 : 0, -this.heading, this.hp <= 0 ? 1.2 : 0);
  }
  camPos() { return { x: this.x - Math.cos(this.heading) * 0.1, y: this.mesh.position.y + 0.85, z: this.z - Math.sin(this.heading) * 0.1, yaw: this.heading }; }
  dispose() { this.g.root.remove(this.mesh); this.removed = true; }
}

// ---------- methods mixed into Game ----------
export const MissionMethods = {
  initMission() {
    const m = this.mission;
    this.missionTime = m?.timeLimit ?? null;
    this.ammo = m?.ammo ?? null;
    this.ammoMax = m?.ammo ?? null;
    this.flags.ex = new Set();
  },
  setupMission() {
    const fn = SETUPS[this.mission?.setup];
    if (!fn) return;
    fn(this);
    this.map.computeRegions();
    this.afterRegions(true);
  },
  flag(name) { if (this.mission && this.flags.ex && !this.flags.ex.has(name)) { this.flags.ex.add(name); this.park.checkMission?.(); } },

  addCruiser(x, z) {
    this.cruiser = new LandCruiser(this, x, z);
    this.vehicles.push(this.cruiser);
    this._autoControl = this.cruiser;
  },
  startHeli() { this._autoControl = 'heli'; },
  // Called once the game is running: put the player in the mission's vehicle.
  beginControl() {
    const a = this._autoControl;
    this._autoControl = null;
    if (a === 'heli' && this.helis[0]) this.takeControlHeli(this.helis[0]);
    else if (a && a.kind === 'cruiser') this.takeControl(a);
  },

  // The Land Cruiser's horn startles nearby dinosaurs.
  horn(v) {
    const car = v || this.cruiser;
    if (!car) return;
    G.audio?.playAt('honk', car.x, car.z, 1);
    for (const d of this.dinos) if (!d.dead && d.tranq <= 0 && dist2(d.x, d.z, car.x, car.z) < 64 && d.state !== 'hunt_jeep') d.fleeFrom(car, 2);
  },
  setMusterZone(z) {
    this.musterZone = z;
    const w = z.x1 - z.x0 + 1, h = z.y1 - z.y0 + 1;
    const geo = new THREE.PlaneGeometry(w, h); geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x40a0ff, transparent: true, opacity: 0.18, depthWrite: false }));
    m.position.set(z.x0 + w / 2, 0.15, z.y0 + h / 2);
    this.root.add(m);
    const pts = [[z.x0, z.y0], [z.x1 + 1, z.y0], [z.x1 + 1, z.y1 + 1], [z.x0, z.y1 + 1], [z.x0, z.y0]].map(([x, y]) => new THREE.Vector3(x, 0.25, y));
    this.root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x60c0ff })));
  },
  musterCount(sp) {
    const z = this.musterZone;
    if (!z) return 0;
    return this.dinos.filter((d) => !d.dead && d.sp.id === sp && d.x >= z.x0 && d.x <= z.x1 + 1 && d.z >= z.y0 && d.z <= z.y1 + 1).length;
  },

  addVip(name, x, z, dest) {
    const mesh = new THREE.Group();
    const body = peopleLoaded() ? new THREE.Mesh(PEOPLE.baked[3].idle[0], new THREE.MeshStandardMaterial({ vertexColors: true })) : new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.45, 2, 6), MAT.std);
    mesh.add(body);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.65, 24), new THREE.MeshBasicMaterial({ color: 0xffd040, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; mesh.add(ring);
    mesh.position.set(x, Math.max(0, this.map.heightAt(x, z)), z);
    this.root.add(mesh);
    this.vip = { name, x, z, dest, state: 'waiting', mesh, t: 0 };
  },
  addPowerBox(h) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.4), new THREE.MeshStandardMaterial({ color: 0x5a6066, emissive: 0x200000 }));
    const x = h.cx + 1.9, z = h.cz + 0.6, y = Math.max(0, this.map.heightAt(x, z)) + 0.35;
    box.position.set(x, y, z); box.castShadow = true;
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3020 }));
    light.position.set(0, 0.45, 0); box.add(light);
    this.root.add(box);
    h.box = { mesh: box, light, x, y, z };
  },
  // Rifle hits on targets other than dinosaurs: hatchery power boxes and avoidance beacons.
  shootStructures(ray) {
    for (const h of this.buildingsOf('hatchery')) {
      if (!h.power || !h.box) continue;
      if (ray.distanceSqToPoint(new THREE.Vector3(h.box.x, h.box.y, h.box.z)) < 0.7 * 0.7) {
        h.power = false; h.box.light.material.color.set(0x303030);
        this.sparks({ x: h.box.x, z: h.box.z });
        this.notify('Power box destroyed. That hatchery is shut down.', 'good', null, 'warden');
        return true;
      }
    }
    for (const b of this.buildingsOf('beacon')) {
      if (ray.distanceSqToPoint(new THREE.Vector3(b.cx, Math.max(0, this.map.heightAt(b.cx, b.cz)) + 1.2, b.cz)) < 0.7 * 0.7) {
        this.sparks({ x: b.cx, z: b.cz });
        this.demolish(b, false);
        this.notify('Avoidance Beacon destroyed.', 'info', null, 'warden');
        return true;
      }
    }
    return false;
  },

  // Per-step mission logic.
  updateMission(dt) {
    if (!this.mission) return;
    if (this.missionTime != null && !this.park.missionState.done && !this.park.missionState.failed) this.missionTime = Math.max(0, this.missionTime - dt);
    const ctl = G.engine.cam.follow;
    // ammunition: refill by hovering low over the Ranger Station
    if (this.ammo != null && ctl?.kind === 'heli') {
      const b = ctl.b, low = ctl.y - Math.max(0, this.map.heightAt(ctl.x, ctl.z)) < 3;
      if (low && dist(ctl.x, ctl.z, b.cx, b.cz) < 3 && this.ammo < this.ammoMax) { this.ammo = this.ammoMax; G.ui?.scopeMsg?.('Reloaded'); }
    }
    // the helicopter's muster pushes dinosaurs away from it
    if (this.musterOn && ctl?.kind === 'heli') {
      this._musT = (this._musT || 0) - dt;
      if (this._musT <= 0) {
        this._musT = 0.4;
        const alt = ctl.y - Math.max(0, this.map.heightAt(ctl.x, ctl.z));
        if (alt < 10) for (const d of this.dinos) {
          if (d.dead || d.carried || d.tranq > 0 || dist2(d.x, d.z, ctl.x, ctl.z) > 100) continue;
          // drive the animal the way the helicopter is facing, like a sheepdog behind a flock
          const hd = ctl.heading || 0;
          d.fleeFrom({ x: d.x - Math.cos(hd) * 5 + (d.x - ctl.x) * 0.15, z: d.z - Math.sin(hd) * 5 + (d.z - ctl.z) * 0.15 }, 2.5);
          d.musteredAt = this.time; // stops it wandering back to the herd for a few seconds
        }
      }
    }
    // haywire hatcheries release carnivores until their power is cut
    for (const h of this.buildingsOf('hatchery')) {
      if (!h.power || !(h.spawnLeft > 0)) continue;
      h.spawnT -= dt;
      if (h.spawnT > 0) continue;
      h.spawnT = rand(22, 32); h.spawnLeft--;
      const sp = pick(['velociraptor', 'velociraptor', 'carcharodontosaurus']);
      const d = this.spawnDino(sp, h.cx + rand(-1, 1), h.cz - 2.6, { age: 6, genome: 80 });
      d.tag = 'target'; d.stress = 80;
      this.notify(`A hatchery has released another ${SPECIES_BY_ID[sp].name}!`, 'warn', { dino: d }, 'warden');
    }
    // carnivores (and Triceratops) charge the Land Cruiser
    const car = this.cruiser;
    if (car && car.hp > 0) {
      this._carT = (this._carT || 0) - dt;
      if (this._carT <= 0) {
        this._carT = 1;
        for (const d of this.dinos) {
          if (d.dead || d.tranq > 0 || d.state === 'hunt_jeep' || d.state === 'sleep') continue;
          const angry = (d.sp.diet === 'carn' && SIZE_RANK[d.sp.size] >= 3) || d.sp.id === 'triceratops' || (d.sp.id === 'torosaurus' && chance(0.1));
          if (!angry || dist2(d.x, d.z, car.x, car.z) > 12 * 12) continue;
          if (chance(d.sp.diet === 'carn' ? 0.35 : 0.15)) { d.setState('hunt_jeep', 14); d.path = null; if (chance(0.5)) d.roar(1); }
        }
      }
    }
    // rifle pick-up and VIP
    if (this.rifleAt && !this.rifle && car && dist(car.x, car.z, this.rifleAt.x, this.rifleAt.z) < 3 && Math.abs(car.speed) < 1) {
      this.rifle = true; this.notify('You have the rifle. Left-click to shoot from the Land Cruiser.', 'good', null, 'admin');
    }
    const v = this.vip;
    if (v && !v.dead && v.state !== 'delivered') {
      const veh = ctl && (ctl.kind === 'heli' || ctl.kind === 'cruiser') ? ctl : null;
      const near = (x, z, r) => veh && dist(veh.x, veh.z, x, z) < r && (veh.kind === 'cruiser' ? Math.abs(veh.speed) < 1 : veh.y - Math.max(0, this.map.heightAt(veh.x, veh.z)) < 4.5);
      if (v.state === 'waiting' && near(v.x, v.z, 2.4)) {
        v.t += dt;
        if (v.t > 1.2) { v.state = 'aboard'; v.mesh.visible = false; this.notify(`${v.name} is aboard. Take him to the Park Entrance.`, 'good', null, 'admin'); }
      } else if (v.state === 'aboard' && near(v.dest.x, v.dest.z, 3.2)) {
        v.state = 'delivered'; v.mesh.visible = true; v.mesh.position.set(v.dest.x, Math.max(0, this.map.heightAt(v.dest.x, v.dest.z)) + (v.dest.y || 0), v.dest.z);
        this.notify(`${v.name} is safe!`, 'good', null, 'founder');
      }
      if (v.state === 'waiting') v.mesh.children[1].rotation.z += dt;
    }
    // tutorial: the Tyrannosaurus starts rampaging once the player has learned to select things
    const rex = this.tutorialRex;
    if (rex && !rex.dead && !this._rexLoose && this.flags.ex?.has('selb:ranger')) {
      this._rexLoose = true; rex.stress = 100;
      this.notify('The Tyrannosaurus is rampaging! Fly the ranger helicopter (select the Ranger Station, then Take Control) and sedate it with a dart.', 'danger', { dino: rex }, 'warden');
    }
    if (rex && this._rexLoose && rex.tranq > 0) this.flag('sedateRex');
  },
};
