// Dev-only balance bot. In the browser console on the running game:
//   const bot = await import('/tools/bot.js'); bot.setup(); bot.run(5)
// It builds a sensible starter park in Career mode and plays it, logging one line per day.
import { G } from '../js/state.js';
import { SPECIES, SITES, BLD, DISEASES, RESEARCH } from '../js/data.js';
import { T } from '../js/map.js';

const RESEARCH_ORDER = ['fence_med', 'souvenir', 'restarea', 'fountain', 'vac_tick', 'vac_gastric', 'vac_bumble', 'vac_belly', 'vac_flu', 'vac_rabies', 'extract', 'camera', 'shelter', 'balloon', 'safari', 'dome', 'fence_high', 'incub', 'immunize', 'beacon', 'lure', 'retire', 'binoculars', 'weatherguard'];

export function setup(mode = 'career') {
  G.main.newGame({ mode, name: 'Bot Park' });
  G.ui.closeModal();
  const g = G.game, m = g.map, e = m.entrance, cx = e.x + 1, ey = e.y;
  if (!g.entrances().length) g.placeEntrance();
  g.park.setOpen(true);
  for (let y = ey - 40; y < ey; y++) for (let x = cx - 32; x <= cx + 32; x++) {
    if (!m.inb(x, y)) continue;
    const i = m.idx(x, y);
    if (m.terrain[i] === T.ROCK || m.terrain[i] === T.WATER) m.terrain[i] = T.GRASS;
  }
  m.computeHeights();
  g.placePaths(g.pathTilesL(cx, ey - 6, cx, ey - 38), 1);
  g.placePaths(g.pathTilesL(cx - 28, ey - 8, cx + 28, ey - 8), 1);
  g.placePaths(g.pathTilesL(cx - 28, ey - 37, cx + 28, ey - 37), 1);
  g.placeFences(g.fenceEdgesRect(cx - 27, ey - 36, cx - 1, ey - 9), 1);
  const lake = [];
  for (let y = ey - 33; y <= ey - 29; y++) for (let x = cx - 24; x <= cx - 18; x++) lake.push(m.idx(x, y));
  g.paintTerrain(lake, T.WATER);
  for (let y = ey - 35; y <= ey - 10; y++) for (let x = cx - 26; x <= cx - 2; x++) {
    const i = m.idx(x, y);
    if (!m.flora[i] && m.isLand(i) && Math.random() < 0.3) g.setFlora(i, [1, 2, 3, 4, 5][Math.floor(Math.random() * 5)]);
  }
  g.placeBuilding('feeder_herb', cx - 10, ey - 20, 0);
  g.placeBuilding('feeder_herb', cx - 18, ey - 14, 0);
  for (const [t, y] of [['restroom', ey - 12], ['snack', ey - 15], ['restroom', ey - 24], ['snack', ey - 27]]) {
    const w = BLD[t].size[0];
    g.placeBuilding(t, cx + 1 + Math.floor((w - 1) / 2), y, 3);
  }
  for (const y of [ey - 10, ey - 18, ey - 30, ey - 35]) { g.placeBuilding('bin', cx - 1, y, 0); g.placeBuilding('bench', cx + 1, y + 1, 0); }
  // viewing platforms along the north path, facing it
  for (const x of [cx - 20, cx - 12, cx - 5]) {
    let done = false;
    for (const y of [ey - 39, ey - 40, ey - 36, ey - 35]) for (let rot = 0; rot < 4 && !done; rot++) { const c = g.canPlace('platform', x, y, rot); if (c.ok && m.path[c.access] === 1) { g.placeBuilding('platform', x, y, rot); done = true; } }
  }
  g.placeBuilding('hatchery', cx + 12, ey - 12, 0);
  g.placeBuilding('ranger', cx + 18, ey - 12, 0);
  g.placeBuilding('cleaner', cx + 4, ey - 20, 3);
  g.park.claimSite('morrisonA');
  G.bot = { pen: { x: cx - 14, z: ey - 22 } };
  return Math.round(g.park.money);
}

function tick() {
  const g = G.game, p = g.park, pen = G.bot.pen;
  for (const h of g.buildingsOf('hatchery')) for (const s of h.slots.slice()) if (s.ready) g.releaseSlot(h, s, pen.x + Math.random() * 6 - 3, pen.z + Math.random() * 6 - 3);
  const alive = g.dinos.filter((d) => !d.dead);
  const herbs = SPECIES.filter((s) => s.diet === 'herb' && p.dna[s.id] >= 50 && s.str <= 2).sort((a, b) => b.value / b.cost - a.value / a.cost);
  if (alive.length < 24) for (const s of herbs) {
    // count eggs already in the hatcheries too, so herds stay within their size
    const eggs = g.buildingsOf('hatchery').reduce((a, h) => a + h.slots.filter((x) => x.sp === s.id).length, 0);
    const cnt = alive.filter((d) => d.sp === s).length + eggs;
    if (cnt < s.herd[1] && p.money > s.cost + 15000 && p.incubateCheck(s.id).ok) { p.incubate(s.id); break; }
  }
  if (p.freeTeams() > 0) {
    const opts = SITES.flatMap((s) => [0, 1, 2].map((k) => ({ s, k }))).filter(({ s, k }) => p.canDig(s.id, k).ok);
    opts.sort((a, b) => p.spotQuality(b.s.id, b.k) - p.spotQuality(a.s.id, a.k));
    const o = opts[0];
    if (o) p.startDig(o.s.id, o.k);
  }
  // a disease outbreak: research its vaccine first, then have the rangers vaccinate everyone
  if (p.research.active.length < p.researchSlots()) for (const r of RESEARCH.filter((x) => x.needCase && p.canResearch(x.id).ok)) { p.startResearch(r.id); break; }
  const vac = Object.keys(DISEASES).filter((id) => p.has(DISEASES[id].vaccine));
  if (vac.length) for (const d of alive) if (!d.immunize?.length && vac.some((id) => d.disease === id || d.canCatch(id))) d.immunize = vac.filter((id) => d.disease === id || d.canCatch(id));
  if (p.research.active.length < p.researchSlots()) for (const r of RESEARCH_ORDER) if (p.canResearch(r).ok && p.money > 30000) { p.startResearch(r); break; }
  for (const s of SITES) if (p.canClaim(s).ok) p.claimSite(s.id);
}

export function run(days = 5) {
  const g = G.game, out = [];
  for (let d = 0; d < days; d++) {
    for (let i = 0; i < 3000; i++) { g.step(0.05); if (i % 100 === 0) tick(); }
    const alive = g.dinos.filter((x) => !x.dead);
    const h = g.park.ledger.history.at(-1) || {};
    const inc = ['Entry', 'Shops', 'Rides', 'Hotels', 'Photos', 'Sales'].reduce((a, k) => a + (h[k] || 0), 0);
    const exp = ['Construction', 'Upkeep', 'Staff', 'Feed', 'Stock', 'Research', 'Expeditions', 'Hatchery'].reduce((a, k) => a + (h[k] || 0), 0);
    const sat = g.park.stats.satisfaction;
    out.push(`D${g.park.day} $${Math.round(g.park.money / 1000)}K in ${Math.round(inc / 1000)}K out ${Math.round(exp / 1000)}K guests ${g.visitors.count} litter ${g.dirtyPaths()} clean ${g.cleanliness().toFixed(2)} research ${g.park.research.done.size} happy ${g.visitors.avgHappiness().toFixed(0)} sat ${(sat.reduce((a, b) => a + b, 0) / Math.max(1, sat.length)).toFixed(0)} ★${g.park.rating.stars} (d${g.park.rating.dino.toFixed(1)} v${g.park.rating.visitor.toFixed(1)}) dinos ${alive.length} comfort ${(alive.reduce((a, x) => a + x.comfort, 0) / Math.max(1, alive.length)).toFixed(0)}`);
  }
  return out.join('\n');
}
