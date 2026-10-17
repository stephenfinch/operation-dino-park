// Dinosaur simulation and animation.
import * as THREE from 'three';
import { G } from './state.js';
import { SPECIES_BY_ID, DAY_SECONDS, FENCES, DISEASES, SIZE_RANK, WORLD_SCALE, BLD, FEED, FLORA, feederFood } from './data.js';
import { clamp, rand, randi, pick, chance, angleLerp, dist, dist2, randomName, lerp } from './util.js';
import { createDinoMesh, setDinoMaterial, MAT } from './models.js';
import { play } from './rigged.js';
import { T } from './map.js';

let NEXT_ID = 1;
// Rampage rules from the original: only these species attack fences when stressed. Dilophosaurus, Ceratosaurus and
// Albertosaurus collapse into a coma instead. Only these three can break a High Security fence; raptors never try
// High fences, but test Medium ones for a weak spot to climb.
const RAMPAGERS = new Set(['tyrannosaurus', 'spinosaurus', 'carcharodontosaurus', 'allosaurus', 'acrocanthosaurus', 'velociraptor', 'triceratops']);
const COMATOSE = new Set(['dilophosaurus', 'ceratosaurus', 'albertosaurus']);
const BREAKS_HIGH = new Set(['tyrannosaurus', 'spinosaurus', 'carcharodontosaurus']);
// Death duels from the original: Tyrannosaurus against these four ends with one of them killed outright.
const DUELISTS = new Set(['spinosaurus', 'triceratops', 'ankylosaurus', 'stegosaurus']);
// Herd-leader contests: these species butt heads (harmlessly) until one gives way; the winner leads the herd.
const DOMINANCE = new Set(['pachycephalosaurus', 'torosaurus']);
export function resetDinoIds(n = 1) { NEXT_ID = n; }

// ---- Predator and prey rules from the original (per-species notes on the fan wiki) ----
const LARGE_CARN = new Set(['tyrannosaurus', 'spinosaurus', 'carcharodontosaurus', 'acrocanthosaurus', 'allosaurus']);
const HADROS = new Set(['edmontosaurus', 'corythosaurus', 'parasaurolophus', 'ouranosaurus']);
const UNARMED_SMALL = new Set(['dryosaurus', 'gallimimus', 'homalocephale']);
const TAIL_SWINGERS = new Set(['stegosaurus', 'kentrosaurus', 'ankylosaurus']);
// Would this predator hunt that animal?
export function huntable(pred, prey) {
  if (prey.livestock) return true; // goats and cattle from the feeders
  const p = pred.sp.id, q = prey.sp.id, hungry = pred.hunger < 20;
  // Brachiosaurus is never attacked, except by a rampaging Spinosaurus
  if (q === 'brachiosaurus') return p === 'spinosaurus' && pred.stress > 80;
  if (prey.sp.diet === 'carn') {
    // Allosaurus is food for the other large carnivores; small carnivores are prey when the big ones are hungry
    if (q === 'allosaurus') return p !== 'allosaurus' && LARGE_CARN.has(p);
    if (LARGE_CARN.has(p) && prey.sp.cat === 'SC') return hungry && (p !== 'allosaurus' || q !== 'albertosaurus');
    if (p === q) return (p === 'ceratosaurus' && pred.hunger < 10) || (p === 'albertosaurus' && (prey.health < 40 || !!prey.disease));
    if (p === 'albertosaurus' && q === 'ceratosaurus') return hungry;
    if (p === 'dilophosaurus' && q === 'velociraptor') return pred.hunger < 10;
    // a rampaging raptor may attack a sleeping or sedated T. rex
    if (p === 'velociraptor' && q === 'tyrannosaurus') return (prey.state === 'sleep' || prey.tranq > 0) && pred.stress > 80;
    return false;
  }
  switch (p) {
    case 'dilophosaurus': return UNARMED_SMALL.has(q) || (q === 'kentrosaurus' && hungry);
    case 'velociraptor': return q !== 'ankylosaurus';
    case 'ceratosaurus': return prey.sp.cat === 'SH' || (q === 'ouranosaurus' && hungry);
    case 'albertosaurus': return (HADROS.has(q) && q !== 'edmontosaurus') || UNARMED_SMALL.has(q) || q === 'pachycephalosaurus' || (q === 'styracosaurus' && hungry);
    case 'allosaurus': return q !== 'ankylosaurus' && q !== 'triceratops';
    case 'spinosaurus': case 'tyrannosaurus': return true;
    default: return q !== 'ankylosaurus' || hungry; // Acrocanthosaurus, Carcharodontosaurus
  }
}
// Would these two carnivores fight over territory?
function rivals(a, b) {
  const p = a.sp.id, q = b.sp.id, pair = (x, y) => (p === x && q === y) || (p === y && q === x);
  if (pair('acrocanthosaurus', 'carcharodontosaurus')) return false; // they share an enclosure peacefully
  if (p === 'allosaurus' && LARGE_CARN.has(q)) return false;        // the most cowardly large carnivore
  if (a.sp.cat === 'SC' && LARGE_CARN.has(q)) return p === 'ceratosaurus' && q === 'allosaurus' && chance(0.2);
  if (pair('ceratosaurus', 'velociraptor') || (pair('dilophosaurus', 'velociraptor') && a.hunger > 40 && b.hunger > 40)) return false;
  if ((a.losses || 0) >= 3 && !(p === 'spinosaurus')) return false; // beaten too often: discouraged
  return true;
}
// Does this herbivore stand its ground against that carnivore?
function fightsBack(h, c) {
  const q = h.sp.id, small = c.sp.cat === 'SC';
  if (q === 'triceratops' || q === 'ankylosaurus' || q === 'stegosaurus') return true;
  if (q === 'styracosaurus' || q === 'pachycephalosaurus') return small && c.sp.id !== 'albertosaurus';
  if (q === 'torosaurus') return small;
  return false;
}

const STATE_TEXT = {
  idle: 'Resting', move: 'Wandering', drink: 'Going to drink', drinking: 'Drinking', feed: 'Going to the feeder', eating: 'Eating',
  graze: 'Looking for plants', grazing: 'Grazing', hunt: 'Hunting', carcass: 'Going to a carcass', feeding: 'Feeding on a kill',
  flee: 'Fleeing!', fight: 'Fighting', rampage: 'Attacking a fence!', sleep: 'Sleeping', tranq: 'Tranquilized', carried: 'Being airlifted',
  hunt_visitor: 'Hunting visitors!', defend: 'Defending itself', dead: 'Dead', socialize: 'Socializing', play: 'Playing', bash: 'Attacking a fence!', joust: 'Contesting the herd lead', hunt_jeep: 'Charging the Land Cruiser!', rear: 'Rearing up to scare a carnivore',
};

export class Dino {
  constructor(game, spId, x, z, o = {}) {
    this.g = game;
    this.sp = SPECIES_BY_ID[spId];
    this.id = o.id || NEXT_ID++;
    if (this.id >= NEXT_ID) NEXT_ID = this.id + 1;
    this.name = o.name || randomName();
    this.x = x; this.z = z;
    this.heading = o.heading ?? rand(0, Math.PI * 2);
    this.genome = o.genome ?? 60;
    this.age = o.age ?? 0;
    // Half a game year (12 days) at 50% DNA, rising non-linearly; a complete genome jumps to the full lifespan.
    const gt = Math.max(0, Math.min(1, (this.genome - 50) / 50));
    const lifeFrac = this.genome >= 100 ? 1 : gt * gt * 0.5;
    this.lifespan = o.lifespan || (12 + (this.sp.life - 12) * lifeFrac) * (game.park.has('genome') ? 1.2 : 1) * rand(0.92, 1.08);
    this.health = o.health ?? 100;
    this.hunger = o.hunger ?? 75;
    this.thirst = o.thirst ?? 75;
    this.huntUrge = o.huntUrge ?? 80;
    this.comfort = o.comfort ?? 70;
    this.stress = o.stress ?? 0;
    this.disease = o.disease || null;
    this.immune = o.immune || [];
    this.toxin = o.toxin || 0;
    this.coma = !!o.coma; this.weakSpot = o.weakSpot || null; this.leader = !!o.leader; this.losses = o.losses || 0; this.nursery = o.nursery || null;
    this.tranq = o.tranq || 0;
    this.dead = !!o.dead;
    this.deadT = o.deadT || 0;
    this.cause = o.cause || '';
    this.meat = o.meat ?? SIZE_RANK[this.sp.size] * 2;
    this.home = o.home || { x, z };
    this.escaped = !!o.escaped;
    this.kills = o.kills || 0;
    this.born = o.born ?? game.park.day;
    this.parts = {};
    this.state = this.dead ? 'dead' : 'idle';
    this.stateT = rand(0.5, 3);
    this.path = null; this.pathI = 0;
    this.goal = null;
    this.target = null;
    this.speedNow = 0;
    this.phase = rand(0, 10);
    this.t = rand(0, 100);
    this.attackCd = 0;
    this.roarT = rand(10, 40);
    this.cT = rand(0, 2);
    this.repathT = 0;
    this.carried = false;
    this.mesh = createDinoMesh(this.sp);
    this.mesh.userData.dino = this;
    if (this.dead) setDinoMaterial(this.mesh, MAT.dead);
    game.root.add(this.mesh);
    const m = this.sp.model;
    this.lenM = m.bodyL + m.tailL + m.neckL * Math.cos(m.neckAng) + m.headL;
    this.animate(0);
  }

  // As in the original (baby dinosaurs were cut), animals leave the hatchery full-grown.
  get growth() { return 1; }
  get len() { return this.lenM * WORLD_SCALE * this.growth; }
  get radius() { return Math.max(0.35, this.len * 0.3); }
  get stateText() { const t = this.paralysed ? 'Paralysed' : this.coma && this.state === 'tranq' ? 'In a coma' : STATE_TEXT[this.state] || this.state; return this.disease && !this.dead ? `${t} (sick)` : t; }
  get maxHp() { return this.sp.hp; }
  get tile() { return { x: Math.floor(this.x), y: Math.floor(this.z) }; }
  region() { return this.g.map.regionAt(this.x, this.z); }
  sellValue() { return Math.round(this.sp.cost * 0.4 * (this.health / 100)); }

  // ---------------- main update ----------------
  update(dt) {
    this.t += dt;
    if (this.dead) {
      this.deadT += dt / DAY_SECONDS;
      this.animate(dt);
      if (this.deadT > 4 && !this.carried) this.g.removeDino(this);
      return;
    }
    const dd = dt / DAY_SECONDS;
    const siteb = this.g.park.mode === 'siteb';
    this.age += dd;
    if (this.state !== 'sleep') this.awake = (this.awake || 0) + dt;
    const big = SIZE_RANK[this.sp.size];
    this.hunger = Math.max(0, this.hunger - dd * (38 + big * 6));
    // heatwaves double water use, as in the original
    this.thirst = Math.max(0, this.thirst - dd * 55 * (this.g.park.weather.type === 'heat' ? 2 : 1) * (this.disease ? DISEASES[this.disease].thirst || 1 : 1));
    // untreated rabies ends in a seizure and a coma
    if (this.disease) { this.diseaseT = (this.diseaseT || 0) + dd; const ds = DISEASES[this.disease]; if (ds.coma && this.diseaseT > ds.coma && !this.coma && this.tranq <= 0) { this.diseaseT = 0; this.fallComatose(); } if (ds.aggro) this.stress = Math.min(100, this.stress + dd * 40); } else this.diseaseT = 0;
    if (this.sp.diet === 'carn') this.huntUrge = Math.max(0, this.huntUrge - dd * 30);
    // health
    let dh = 0;
    if (this.hunger < 12) dh -= 35;
    if (this.thirst < 12) dh -= 45;
    if (this.disease) { const ds = DISEASES[this.disease]; dh -= ds.dmg; if (chance(dd * 0.06)) this.cure(false); }
    if (dh === 0 && this.hunger > 30 && this.thirst > 30) dh = 18;
    // only Tick Infestation, Rabies and Gastric Poisoning can kill
    this.health = clamp(this.health + dh * dd, this.disease && !DISEASES[this.disease].fatal && this.hunger > 12 && this.thirst > 12 ? Math.min(this.health, 25) : 0, 100);
    if (this.health <= 0) { this.die(this.lastHitBy && this.g.time - this.lastHitT < 10 ? `killed by ${this.lastHitBy}` : this.disease ? DISEASES[this.disease].name : this.hunger < 12 ? 'starvation' : this.thirst < 12 ? 'dehydration' : 'injuries'); return; }
    if (this.age > this.lifespan) { this.die('old age'); return; }
    // comfort & stress
    this.cT -= dt;
    if (this.cT <= 0) {
      this.cT = 2;
      this.computeComfort();
      if (siteb) this.stress = 0;
      else if (this.comfort < 45) this.stress = clamp(this.stress + (45 - this.comfort) * 0.05 * 2, 0, 100);
      else if (this.comfort > 58) this.stress = clamp(this.stress - 1.2, 0, 100);
      // thunderstorms and twisters unsettle the animals; heatwaves wear them down
      const wt = this.g.park.weather.type;
      if (!siteb && (wt === 'storm' || wt === 'twister')) this.stress = clamp(this.stress + 0.9, 0, 100);
      else if (!siteb && wt === 'heat' && this.thirst < 40) this.stress = clamp(this.stress + 0.5, 0, 100);
    }
    this.attackCd -= dt;
    if (this.carried) { this.state = 'carried'; this.speedNow = 0; this.animate(dt); return; }
    // Dinosaurs keep clear of an emitting avoidance beacon.
    this.bT = (this.bT || Math.random()) - dt;
    if (this.bT <= 0) {
      this.bT = 1;
      // rampaging animals ignore the beacons, and smash one if they pass right by it
      const raging = this.state === 'rampage' || this.state === 'bash' || this.disease === 'rabies';
      if (raging) for (const b of this.g.buildingsOf('beacon')) if (!b.broken && dist2(b.cx, b.cz, this.x, this.z) < 4) { b.hp -= 40; this.biteT = 0.35; if (b.hp <= 0) { b.hp = 0; b.broken = true; this.g.bldVersion++; this.g.notify(`${this.sp.name} "${this.name}" smashed an Avoidance Beacon!`, 'warn', { dino: this }, 'warden'); } }
      const bc = !raging && this.tranq <= 0 && this.state !== 'flee' && this.state !== 'sleep' && this.g.beaconNear(this.x, this.z);
      if (bc) { this.fleeFrom({ x: bc.cx, z: bc.cz }, 4); this.stress = clamp(this.stress + 2, 0, 100); }
      // Brachiosaurus rears up on its hind legs to scare off carnivores that come close.
      else if (this.sp.id === 'brachiosaurus' && this.tranq <= 0 && !['flee', 'sleep', 'rear'].includes(this.state) && (this.rearCd = (this.rearCd || 0) - 1) <= 0) {
        const c = this.g.nearestDino(this, (d) => !d.dead && d.tranq <= 0 && d.sp.diet === 'carn' && d.state !== 'rampage', 7);
        if (c) {
          this.rearCd = 15; this.target = c; this.path = null; this.setState('rear', 3); this.roar(1);
          if (c.state === 'hunt' && c.target === this) c.target = null;
          c.fleeFrom(this, 4); c.stress = clamp(c.stress + 3, 0, 100);
        }
      }
      // Kentrosaurus panics around large herbivores, especially Brachiosaurus.
      else if (this.sp.id === 'kentrosaurus' && this.state !== 'flee' && this.state !== 'sleep' && this.tranq <= 0) {
        const big = this.g.nearestDino(this, (d) => !d.dead && d.sp.diet === 'herb' && SIZE_RANK[d.sp.size] >= 3 && d.sp.id !== 'stegosaurus', 5);
        if (big) { this.fleeFrom(big, 3); this.stress = clamp(this.stress + (big.sp.id === 'brachiosaurus' ? 4 : 2), 0, 100); }
        else this.senseDanger();
      }
      else if (this.sp.diet === 'herb' || this.sp.cat === 'SC') this.senseDanger();
    }
    if (this.tranq > 0) {
      this.tranq -= dd;
      if (this.coma) { this.health = Math.max(0, this.health - 18 * dd); if (this.health <= 0) { this.die('a stress coma'); return; } if (this.tranq <= 0) this.coma = false; }
      this.state = 'tranq'; this.speedNow = 0; this.path = null;
      if (this.tranq <= 0) { this.tranq = 0; this.state = 'idle'; this.stateT = 2; this.stress = Math.max(0, this.stress - 30); }
      this.animate(dt);
      return;
    }
    // random roar
    this.roarT -= dt;
    if (this.roarT <= 0) { this.roarT = rand(25, 70); if (this.state !== 'sleep') this.roar(0.5); }
    this.act(dt);
    this.animate(dt);
  }

  // ---------------- needs / comfort ----------------
  computeComfort() {
    const g = this.g, r = this.region();
    const p = this.parts;
    p.food = this.hunger;
    p.water = r && r.water.length ? Math.min(100, this.thirst + 20) : Math.min(this.thirst, 25);
    p.health = this.health;
    if (!r) { this.comfort = 50; return; }
    const rs = g.regionStats(r.id);
    const n = rs.species[this.sp.id] || 1;
    const [hmin, hmax] = this.sp.herd;
    p.social = n < hmin ? 100 - (hmin - n) * 28 : n > hmax ? 100 - (n - hmax) * 22 : 100;
    const ratio = r.area / Math.max(1, rs.space);
    p.space = 100 * Math.pow(Math.min(1, ratio), 1.5);
    const f = r.forest / Math.max(1, r.area);
    p.environment = clamp(100 - Math.abs(f - this.sp.forest) * 190, 0, 100);
    if (this.sp.diet === 'herb') p.safety = rs.carnMax >= SIZE_RANK[this.sp.size] ? 25 : rs.carnMax > 0 ? 65 : 100;
    else p.safety = rs.bigCarnSpecies > 1 && SIZE_RANK[this.sp.size] >= 3 ? 55 : 100;
    if (this.sp.diet === 'carn') p.hunt = this.huntUrge;
    for (const k in p) p[k] = clamp(p[k], 0, 100);
    const w = { food: 0.17, water: 0.13, health: 0.1, social: 0.15, space: 0.15, environment: 0.15, safety: 0.1, hunt: 0.1 };
    let s = 0, ws = 0;
    for (const k in p) { s += p[k] * w[k]; ws += w[k]; }
    let c = s / ws;
    if (this.disease) c -= DISEASES[this.disease].comfort;
    this.comfort = clamp(c, 0, 100);
  }

  // Can this animal catch the disease? Rabies strikes carnivores (and Gallimimus); Gastric Poisoning only herbivores.
  canCatch(id) {
    const ds = DISEASES[id];
    if (this.immune?.includes(id)) return false;
    if (ds.carnOnly && this.sp.diet !== 'carn' && this.sp.id !== 'gallimimus') return false;
    if (ds.herbOnly && this.sp.diet !== 'herb') return false;
    return true;
  }
  catchDisease(forced) {
    if (this.g.park.noDisease) return;
    const ids = Object.keys(DISEASES).filter((k) => k !== 'gastric' && this.canCatch(k));
    if (forced && !this.canCatch(forced)) return;
    let tot = 0; for (const k of ids) tot += DISEASES[k].chance * (DISEASES[k].herbBias && this.sp.diet === 'herb' ? DISEASES[k].herbBias : 1);
    let r = Math.random() * tot, pickId = ids[0];
    for (const k of ids) { r -= DISEASES[k].chance * (DISEASES[k].herbBias && this.sp.diet === 'herb' ? DISEASES[k].herbBias : 1); if (r <= 0) { pickId = k; break; } }
    if (!forced && !pickId) return;
    this.disease = forced || pickId;
    (this.g.park.stats.cases ||= {})[this.disease] = true;
    this.g.notify(`${this.sp.name} "${this.name}" has caught ${DISEASES[this.disease].name}.`, 'warn', { dino: this });
  }
  // A vaccine cures the disease and makes the animal immune to it for life.
  vaccinate(id, quiet) {
    (this.immune ||= []).includes(id) || this.immune.push(id);
    if (this.disease === id) { this.disease = null; if (!quiet) this.g.notify(`Rangers cured ${this.name}'s ${DISEASES[id].name}. It is now immune.`, 'good', { dino: this }); }
  }
  cure(byRanger = true) {
    if (!this.disease) return;
    const n = DISEASES[this.disease].name;
    if (byRanger) { this.vaccinate(this.disease); return; }
    this.disease = null;
  }
  // Eating modern plants slowly poisons herbivores (the original's Gastric Poisoning).
  eatModern(k) {
    this.toxin = (this.toxin || 0) + k;
    if (!this.disease && this.toxin > 4 && this.canCatch('gastric') && chance(0.02 * this.toxin)) { this.toxin = 0; this.catchDisease('gastric'); }
  }

  // ---------------- decision making ----------------
  setState(s, t = 0) { this.state = s; this.stateT = t; }

  goTo(x, z, state, tol = 0.5) {
    const map = this.g.map;
    const sx = Math.floor(this.x), sy = Math.floor(this.z), tx = Math.floor(x), ty = Math.floor(z);
    const path = map.findPath(sx, sy, tx, ty, 6000);
    if (!path) return false;
    this.path = path; this.pathI = 0;
    this.goal = { x, z, tol };
    this.state = state;
    return true;
  }

  act(dt) {
    const s = this.state;
    const run = ['hunt', 'flee', 'fight', 'hunt_visitor', 'rampage', 'play', 'hunt_jeep'].includes(s) || (s === 'move' && this.escaped && this.sp.diet === 'carn');
    // Bumblefoot makes it limp; ticks make it restless; Gastric Poisoning at its height paralyses it
    const ds = this.disease ? DISEASES[this.disease] : null;
    if (ds?.paralyse && this.health < ds.paralyse && !['sleep', 'tranq'].includes(s)) { this.speedNow = 0; this.path = null; if (s !== 'idle') this.setState('idle', 3); this.paralysed = true; return; }
    this.paralysed = false;
    const speed = (run ? this.sp.run : this.sp.spd) * (ds?.slow || 1) * (ds?.manic || 1);
    switch (s) {
      case 'idle':
      case 'socialize':
        this.speedNow = 0;
        this.stateT -= dt;
        if (this.stateT <= 0) this.think();
        break;
      case 'move': case 'drink': case 'feed': case 'graze': case 'carcass': case 'rampage': case 'play':
        if (this.follow(dt, speed)) this.arrive();
        break;
      case 'drinking': case 'eating': case 'grazing': case 'feeding':
        this.speedNow = 0;
        this.stateT -= dt;
        if (this.stateT <= 0) this.finishEating();
        break;
      case 'sleep':
        this.speedNow = 0;
        this.stateT -= dt;
        if (((this.g.park.dayNight ? !this.g.park.isNight : true) && this.stateT <= 0) || this.hunger < 25 || this.thirst < 25 || this.escaped) this.setState('idle', 1);
        break;
      case 'flee':
        this.stateT -= dt;
        this.fleeStep(dt);
        if (this.stateT <= 0) this.setState('idle', 1);
        break;
      case 'hunt': case 'fight': case 'defend': case 'hunt_visitor': case 'joust':
        this.chase(dt, speed);
        break;
      case 'rear':
        this.speedNow = 0;
        if (this.target && !this.target.dead) this.faceTo(this.target.x, this.target.z, dt * 3);
        this.stateT -= dt;
        if (this.stateT <= 0) { this.target = null; this.setState('idle', 1); }
        break;
      case 'bash':
        this.speedNow = 0;
        this.bash(dt);
        break;
      case 'hunt_jeep': this.huntJeep(dt); break;
      default:
        this.setState('idle', 1);
    }
  }

  think() {
    const g = this.g, r = this.region();
    if (!r) { this.setState('idle', 2); return; }
    const carn = this.sp.diet === 'carn';
    // Escaped carnivores go after visitors; penned ones go after guests stranded in their enclosure.
    if (this.escaped && carn && this.hunger < 90 && g.park.mode !== 'siteb') {
      const v = g.visitors.nearest(this.x, this.z, 18);
      if (v) { this.target = v; this.setState('hunt_visitor', 25); return; }
    }
    if (carn && !this.escaped && this.hunger < 90) {
      const v = g.visitors.list.find((o) => !o.gone && o.plan === 'stranded' && dist2(o.x, o.z, this.x, this.z) < 324 && g.map.regionAt(o.x, o.z) === r);
      if (v) { this.target = v; this.setState('hunt_visitor', 25); return; }
    }
    // recently pushed by the helicopter's muster: stand still rather than drift back to the herd
    if (this.musteredAt != null && g.time - this.musteredAt < 5) { this.setState('idle', 0.5); return; }
    // raptors kill goats and cattle for sport, even when they are not hungry
    if (this.sp.id === 'velociraptor' && chance(0.2)) {
      const live = g.liveLivestock(r);
      if (live.length) { this.target = live[randi(0, live.length - 1)]; this.setState('hunt', 20); this.repathT = 0; return; }
    }
    // Dryosaurus is famous for playing instead of eating and drinking, and often starves
    const careless = this.sp.id === 'dryosaurus' && this.hunger > 15 && this.thirst > 15 && chance(0.3);
    if (!careless && this.thirst < 40 && r.water.length) {
      const w = this.nearestTile(r.water, 30);
      if (w != null && this.goTo((w % g.map.W) + 0.5, Math.floor(w / g.map.W) + 0.5, 'drink')) return;
    }
    if (!careless && (this.hunger < 45 || (carn && this.huntUrge < 25 && this.hunger < 85))) {
      if (this.seekFood(r)) return;
    }
    if (this.stress > 65 && g.park.mode !== 'siteb' && chance(0.25 + this.sp.aggr * 0.6)) {
      // rabies drives a carnivore to attack anything, even its own kind
      if (carn && (chance(0.5) || this.disease === 'rabies') && this.startFight(r)) return;
      if (RAMPAGERS.has(this.sp.id) || this.disease === 'rabies') { if (this.startRampage(r)) return; }
      else if (COMATOSE.has(this.sp.id) && this.stress > 92) { this.fallComatose(); return; }
    }
    // Herd-leader contests (Pachycephalosaurus, Torosaurus): two rivals butt heads until one gives way.
    if (DOMINANCE.has(this.sp.id) && this.stress < 50 && this.health > 60 && chance(0.06)) {
      const rival = g.nearestDino(this, (d) => d.sp === this.sp && d !== this && !d.dead && d.tranq <= 0 && d.state !== 'joust' && d.health > 60, 14);
      if (rival) { this.target = rival; this.setState('joust', 14); rival.target = this; rival.setState('joust', 14); this.jousts = 0; rival.jousts = 0; return; }
    }
    // An Auto Lure spraying this dinosaur's scent draws it in.
    const lure = g.lureFor(this);
    if (lure && dist2(lure.cx, lure.cz, this.x, this.z) > 16 && this.goTo(lure.cx + rand(-2.5, 2.5), lure.cz + rand(-2.5, 2.5), 'move')) return;
    // Content herbivores play and socialise with their herd (Fun Lovers love to watch this).
    if (!carn && this.comfort > 68 && this.stress < 30 && chance(0.18)) {
      const mate = g.nearestDino(this, (d) => !d.dead && d !== this && (d.sp === this.sp || d.sp.id === this.sp.friend), 12);
      if (mate) {
        const a = rand(0, Math.PI * 2);
        if (this.goTo(mate.x + Math.cos(a) * 3, mate.z + Math.sin(a) * 3, 'play')) return;
      }
    }
    const sleepy = g.park.dayNight ? g.park.isNight : (this.awake || 0) > (this.sleepAt || (this.sleepAt = rand(300, 520)));
    if (sleepy && !this.escaped && this.hunger > 35 && this.thirst > 35 && this.stress < 60 && chance(0.7)) {
      this.awake = 0; this.sleepAt = rand(300, 520);
      this.setState('sleep', g.park.dayNight ? rand(10, 30) : rand(70, 100));
      return;
    }
    // newborns stay near their hatchery for their first months
    if (this.nursery && this.age < this.nursery.until && chance(0.6)) {
      const n = this.nursery;
      if (this.goTo(n.x + rand(-6, 6), n.z + rand(-6, 6), 'move')) return;
    }
    // herd up with conspecifics sometimes; Gallimimus and Dryosaurus herds split up past six or seven
    if (chance(0.35)) {
      const grp = (d) => {
        if (d.sp.id !== 'gallimimus' && d.sp.id !== 'dryosaurus') return 0;
        let rank = 0; for (const o of g.dinos) if (o.sp === d.sp && !o.dead && o.id < d.id && o.region() === r) rank++;
        return Math.floor(rank / 7);
      };
      const mine = grp(this);
      const mate = g.nearestDino(this, (d) => d.sp === this.sp && !d.dead && grp(d) === mine, 30);
      if (mate && dist(mate.x, mate.z, this.x, this.z) > 4) {
        if (this.goTo(mate.x + rand(-2, 2), mate.z + rand(-2, 2), 'move')) return;
      }
    }
    if (chance(0.3)) { this.setState('idle', rand(2, 7)); return; }
    // wander to a random reachable tile nearby
    for (let k = 0; k < 6; k++) {
      const i = r.tiles[randi(0, r.tiles.length - 1)];
      const tx = (i % g.map.W) + 0.5, tz = Math.floor(i / g.map.W) + 0.5;
      if (dist2(tx, tz, this.x, this.z) > 18 * 18) continue;
      if (g.map.terrain[i] === T.WATER && chance(0.7)) continue;
      if (this.goTo(tx + rand(-0.3, 0.3), tz + rand(-0.3, 0.3), 'move')) return;
    }
    this.setState('idle', rand(2, 5));
  }

  nearestTile(list, samples) {
    const W = this.g.map.W;
    let best = null, bd = 1e9;
    const n = Math.min(samples, list.length);
    for (let k = 0; k < n; k++) {
      const i = list.length <= samples ? list[k] : list[randi(0, list.length - 1)];
      const d = dist2((i % W) + 0.5, Math.floor(i / W) + 0.5, this.x, this.z);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  seekFood(r) {
    const g = this.g;
    if (this.sp.diet === 'herb') {
      // sauropods browse the treetops
      if (SIZE_RANK[this.sp.size] >= 4) {
        const trees = g.regionTreeTiles(r);
        if (trees.length) { const i = this.nearestTile(trees, 25); if (i != null && this.goTo((i % g.map.W) + 0.5, Math.floor(i / g.map.W) + 0.5, 'graze', 1.4)) { this.target = i; return true; } }
      }
      // sauropods never use feeders, as in the original: they need trees
      const f = SIZE_RANK[this.sp.size] >= 4 ? [] : g.regionFeeders(r.id, 'herb').filter((b) => b.stock > 0);
      if (f.length) {
        const b = f.reduce((a, c) => (dist2(a.cx, a.cz, this.x, this.z) < dist2(c.cx, c.cz, this.x, this.z) ? a : c));
        const t = g.feederApproach(b, r.id, this);
        if (t && this.goTo(t.x, t.z, 'feed')) { this.target = b; return true; }
      }
      const forage = r.graze.length ? r.graze : SIZE_RANK[this.sp.size] >= 4 ? g.regionTreeTiles(r) : [];
      if (forage.length) {
        const i = this.nearestTile(forage, 25);
        if (i != null && this.goTo((i % g.map.W) + 0.5, Math.floor(i / g.map.W) + 0.5, 'graze', 0.9)) { this.target = i; return true; }
      }
      return false;
    }
    // carnivore: a carcass, live goats or cattle from the feeder, or other prey
    const carcass = g.nearestDino(this, (d) => d.dead && d.meat > 0 && !d.carried && d.region() === r, 40) || g.livestockCarcass(this, r, 40);
    if (carcass) { this.target = carcass; if (this.goTo(carcass.x, carcass.z, 'carcass', this.len * 0.5 + carcass.len * 0.3)) return true; }
    // the Carnivore Feeder releases a live goat or cow, which the carnivore hunts down
    let live = g.liveLivestock(r);
    if (!live.length) for (const b of g.regionFeeders(r.id, 'carn')) { const a = g.releaseLivestock(b, r.id); if (a) { live = [a]; break; } }
    const wantHunt = this.huntUrge < 50 || chance(0.35);
    const prey = this.findPrey(r);
    const goat = live.length ? live.reduce((a, c) => (dist2(a.x, a.z, this.x, this.z) < dist2(c.x, c.z, this.x, this.z) ? a : c)) : null;
    const target = prey && (wantHunt || !goat) ? prey : goat || prey;
    if (target) {
      this.target = target; this.setState('hunt', 30); this.repathT = 0;
      if (chance(0.5)) this.roar(1);
      return true;
    }
    return false;
  }

  findPrey(r) {
    // each predator has its own prey (see huntable); favourite prey comes first
    // a big pack of Dilophosaurus (eight or more) panics and keeps failing to hunt
    if (this.sp.id === 'dilophosaurus' && (this.g.regionStats(r.id).species.dilophosaurus || 0) >= 8 && chance(0.6)) return null;
    // at most four raptors latch on to one animal at a time
    const crowded = (d) => this.sp.id === 'velociraptor' && this.g.dinos.filter((o) => o.target === d && o.state === 'hunt' && o.sp.id === 'velociraptor').length >= 4;
    const ok = (d) => !d.dead && d !== this && d.region() === r && !d.carried && huntable(this, d) && !crowded(d);
    return (this.sp.prey && this.g.nearestDino(this, (d) => d.sp.id === this.sp.prey && ok(d), 60)) || this.g.nearestDino(this, ok, 60);
  }

  // Prey reacts to predators before they strike: most flee (Gallimimus scatter early); armed herbivores
  // stand their ground; everything but its rivals runs from Tyrannosaurus.
  senseDanger() {
    if (['flee', 'sleep', 'defend', 'fight', 'joust', 'rear', 'hunt', 'hunt_visitor', 'rampage', 'bash'].includes(this.state) || this.tranq > 0 || this.escaped && this.sp.diet === 'carn') return;
    const g = this.g, r = this.region();
    if (!r || g.park.mode === 'siteb' && chance(0.3)) return;
    const R = this.sp.id === 'gallimimus' || this.sp.id === 'dryosaurus' ? 10 : 7;
    const c = g.nearestDino(this, (d) => !d.dead && d !== this && d.tranq <= 0 && d.sp.diet === 'carn' && d.state !== 'sleep' && d.region() === r &&
      ((d.state === 'hunt' && d.target === this) || huntable(d, this) && dist2(d.x, d.z, this.x, this.z) < 16 || (d.sp.id === 'tyrannosaurus' && !DUELISTS.has(this.sp.id) && this.sp.id !== 'spinosaurus')), R);
    if (!c) {
      // Triceratops charges any carnivore that comes close; Stegosaurus panics and swings its tail
      if (this.sp.id === 'triceratops' || this.sp.id === 'stegosaurus') {
        const near = g.nearestDino(this, (d) => !d.dead && d.tranq <= 0 && d.sp.diet === 'carn' && d.region() === r && d.sp.id !== 'tyrannosaurus', 6);
        if (near) { this.target = near; this.setState('defend', 6); this.roar(1); this.stress = clamp(this.stress + 3, 0, 100); }
      }
      return;
    }
    this.stress = clamp(this.stress + 2, 0, 100);
    if (this.sp.diet === 'herb' && fightsBack(this, c)) { this.target = c; this.path = null; this.setState('defend', 8); this.roar(1); return; }
    this.fleeFrom(c, UNARMED_SMALL.has(this.sp.id) ? 6 : 4);
  }

  startFight(r) {
    const rival = this.g.nearestDino(this, (d) => !d.dead && d !== this && d.sp.diet === 'carn' && d.region() === r && !d.carried && d.tranq <= 0 &&
      (this.disease === 'rabies' || ((d.sp !== this.sp || (this.g.regionStats(r.id).species[this.sp.id] || 0) > this.sp.herd[1]) && rivals(this, d))), 30);
    if (!rival) return false;
    this.target = rival; this.setState('fight', 25);
    this.roar(1);
    return true;
  }

  startRampage(r) {
    if (!r.fenceEdges.length || this.g.park.noRampage) return false;
    const map = this.g.map;
    // pick weakest nearby edges
    let best = null, bs = -1e9;
    for (let k = 0; k < 12; k++) {
      const e = pick(r.fenceEdges);
      const t = map.fenceType(e.h, e.i);
      if (!t || (t === 3 && !BREAKS_HIGH.has(this.sp.id))) continue;
      const c = map.edgeCenter(e.h, e.i);
      // raptors remember a weak spot they found before
      const weak = this.weakSpot && this.weakSpot.h === e.h && this.weakSpot.i === e.i ? 30 : 0;
      const score = -FENCES[t].armor * 6 - dist(c.x, c.z, this.x, this.z) * 0.3 + rand(0, 4) + weak;
      if (score > bs) { bs = score; best = e; }
    }
    if (!best) return false;
    const tiles = map.edgeTiles(best.h, best.i);
    const mine = tiles.find(([x, y]) => map.inb(x, y) && map.region[map.idx(x, y)] === r.id);
    if (!mine) return false;
    const c = map.edgeCenter(best.h, best.i);
    const tx = mine[0] + 0.5, tz = mine[1] + 0.5;
    if (!this.goTo(tx + (c.x - tx) * 0.3, tz + (c.z - tz) * 0.3, 'rampage', 0.4)) return false;
    this.target = best;
    this.roar(1);
    if (this.g.watched(this, false, true) && (!this.g.flags.rampageWarned || chance(0.3))) this.g.notify(`${this.sp.name} "${this.name}" is attacking a fence!`, 'danger', { dino: this });
    this.g.flags.rampageWarned = true;
    return true;
  }

  arrive() {
    const s = this.state, g = this.g;
    this.path = null;
    switch (s) {
      case 'drink': this.setState('drinking', rand(3, 5)); break;
      case 'feed': {
        const b = this.target;
        if (!b || b.removed || b.stock <= 0) { this.setState('idle', 1); break; }
        this.faceTo(b.cx, b.cz);
        this.setState('eating', 5);
        break;
      }
      case 'graze': this.setState('grazing', rand(5, 8)); break;
      case 'carcass': {
        const c = this.target;
        if (!c || !c.dead || c.removed || c.meat <= 0) { this.setState('idle', 1); break; }
        this.faceTo(c.x, c.z);
        this.setState('feeding', 7);
        break;
      }
      case 'rampage': {
        const e = this.target;
        const c = g.map.edgeCenter(e.h, e.i);
        this.faceTo(c.x, c.z);
        this.setState('bash', 22);
        this.bashT = 0;
        break;
      }
      default: this.setState('idle', rand(1, 4));
    }
  }

  finishEating() {
    const s = this.state, g = this.g;
    if (s === 'drinking') this.thirst = 100;
    else if (s === 'eating') {
      const b = this.target;
      if (b && !b.removed && b.stock > 0) {
        b.stock--;
        const food = FEED[feederFood(b)];
        this.hunger = Math.min(100, this.hunger + food.meal * (this.disease ? DISEASES[this.disease].appetite || 1 : 1));
        if (food.modern && this.sp.diet === 'herb') this.eatModern(1);
        if (this.sp.diet === 'carn') this.huntUrge = Math.min(100, this.huntUrge + 12);
        if (this.hunger < 70 && b.stock > 0) { this.setState('eating', 4); return; }
      }
    } else if (s === 'grazing') {
      this.hunger = Math.min(100, this.hunger + 22 * (this.disease ? DISEASES[this.disease].appetite || 1 : 1));
      const i = this.target;
      if (typeof i === 'number' && FLORA[g.map.flora[i]]?.modern) this.eatModern(0.6);
      if (typeof i === 'number' && chance(0.08)) g.setFlora(i, 0, true);
      if (this.hunger < 60 && chance(0.6)) { this.setState('grazing', 5); return; }
    } else if (s === 'feeding') {
      const c = this.target;
      if (c && c.dead && c.meat > 0) {
        c.meat--;
        this.hunger = Math.min(100, this.hunger + 45);
        if (this.hunger < 90 && c.meat > 0) { this.setState('feeding', 6); return; }
      }
    }
    this.target = null;
    this.setState('idle', rand(1, 4));
  }

  // ---------------- combat ----------------
  chase(dt, speed) {
    const g = this.g, tgt = this.target;
    this.stateT -= dt;
    const isVisitor = this.state === 'hunt_visitor';
    const gone = !tgt || tgt.removed || (isVisitor ? tgt.gone : tgt.dead || tgt.carried) || this.stateT <= 0;
    if (gone) {
      if (tgt && !isVisitor && tgt.dead && this.sp.diet === 'carn' && tgt.meat > 0 && !tgt.carried) {
        this.target = tgt;
        if (this.goTo(tgt.x, tgt.z, 'carcass', this.len * 0.5 + tgt.len * 0.3)) return;
      }
      if (this.stateT <= 0 && this.state === 'hunt') { this.huntUrge = Math.min(100, this.huntUrge + 5); this.stress = Math.min(100, this.stress + 5); }
      this.target = null; this.setState('idle', 1.5); return;
    }
    if (!isVisitor && tgt.region() !== this.region()) { this.target = null; this.setState('idle', 1); return; }
    const reach = isVisitor ? this.len * 0.4 + 0.25 : this.len * 0.42 + tgt.len * 0.35;
    const d = dist(this.x, this.z, tgt.x, tgt.z);
    if (d > reach) {
      // Dilophosaurus spits venom from a few metres away: the victim is blinded and stops for a moment.
      // Guests hit by the venom wipe their eyes, then collapse.
      if (this.sp.id === 'dilophosaurus' && d < reach + 4 && (this.spitCd = (this.spitCd || 0) - dt) <= 0) {
        this.spitCd = rand(6, 9);
        this.faceTo(tgt.x, tgt.z, 1); this.biteT = 0.4;
        for (const f of [0.35, 0.65, 0.95]) g.burst(lerp(this.x, tgt.x, f), 1 + this.len * 0.12, lerp(this.z, tgt.z, f), 0x9adf3a, 6);
        G.audio?.playAt('spray', this.x, this.z, 0.4);
        if (isVisitor) { if (chance(0.6)) { g.visitors.kill(tgt, this); this.target = null; this.setState('idle', 3); return; } }
        else if (tgt.tranq <= 0 && !tgt.dead) { tgt.stress = clamp(tgt.stress + 8, 0, 100); tgt.path = null; tgt.setState('idle', 1.8); }
      }
      this.repathT -= dt;
      if (this.repathT <= 0 || !this.path) {
        this.repathT = 0.8;
        const p = g.map.findPath(Math.floor(this.x), Math.floor(this.z), Math.floor(tgt.x), Math.floor(tgt.z), 3000);
        this.path = p; this.pathI = 0; this.goal = { x: tgt.x, z: tgt.z, tol: reach * 0.8 };
      } else if (this.goal) { this.goal.x = tgt.x; this.goal.z = tgt.z; }
      if (this.path) this.follow(dt, speed);
      else this.steer(dt, tgt.x, tgt.z, speed);
      return;
    }
    this.speedNow = 0;
    this.faceTo(tgt.x, tgt.z, dt * 6);
    if (this.attackCd > 0) return;
    this.attackCd = rand(0.8, 1.3);
    this.biteT = 0.35;
    if (isVisitor) { g.visitors.kill(tgt, this); this.hunger = Math.min(100, this.hunger + 20); this.target = null; this.setState('idle', 3); this.roar(1); return; }
    if (this.state === 'joust') { this.joust(tgt); return; }
    const pack = this.sp.pack ? 1.2 : 1;
    // a T. rex with more kills behind it fights better (death duels with Spinosaurus)
    const veteran = this.sp.id === 'tyrannosaurus' ? 1 + Math.min(this.kills, 5) * 0.06 : 1;
    const dmg = this.sp.atk * this.growth * rand(0.7, 1.3) * pack * veteran;
    // death duel: once either animal is badly hurt, the other finishes it in one move
    const duel = (this.sp.id === 'tyrannosaurus' && DUELISTS.has(tgt.sp.id)) || (tgt.sp.id === 'tyrannosaurus' && DUELISTS.has(this.sp.id));
    if (duel && tgt.health - (dmg / tgt.maxHp) * 100 < 30) {
      tgt.health = 0; tgt.die(`a death duel with ${this.sp.name}`);
      this.kills++; this.stress = Math.max(0, this.stress - 40);
      g.notify(`DEATH DUEL! ${this.sp.name} "${this.name}" has killed ${tgt.sp.name} "${tgt.name}"!`, 'danger', { dino: this });
      g.excite(this.x, this.z, 25);
      this.roar(1.2);
      this.target = null; this.setState('idle', 3);
      return;
    }
    // one-blow kills from the original: Triceratops kills any small carnivore but Albertosaurus, Torosaurus kills
    // a raptor, Stegosaurus and Ankylosaurus kill an attacking Ceratosaurus, and Ankylosaurus kills a Kentrosaurus
    const q = tgt.sp.id, p = this.sp.id;
    if ((p === 'triceratops' && tgt.sp.cat === 'SC' && q !== 'albertosaurus') || (p === 'torosaurus' && q === 'velociraptor') ||
      ((p === 'stegosaurus' || p === 'ankylosaurus') && q === 'ceratosaurus') || (p === 'ankylosaurus' && q === 'kentrosaurus')) {
      tgt.takeHit(tgt.maxHp * 2, this);
    } else tgt.takeHit(dmg, this);
    // a raptor riding a big animal sometimes falls off and hurts itself
    if (this.sp.id === 'velociraptor' && tgt.sp && SIZE_RANK[tgt.sp.size] >= 3 && chance(0.15)) this.health = Math.max(1, this.health - 6);
    // a panicking stegosaur or ankylosaur swings its tail and can hit herbivores standing nearby
    if (TAIL_SWINGERS.has(p) && this.state === 'defend') {
      for (const o of g.dinos) if (o !== tgt && o !== this && !o.dead && o.sp.diet === 'herb' && dist2(o.x, o.z, this.x, this.z) < (this.len * 0.6) ** 2) o.takeHit(dmg * 0.3, this);
      // ...and Land Cruisers driving past
      for (const v of g.vehicles) if ((v.kind === 'jeep' || v.kind === 'cruiser') && v.hp > 0 && dist2(v.x, v.z, this.x, this.z) < (this.len * 0.6) ** 2) v.hit?.(12);
    }
    if (chance(0.25)) this.roar(0.8);
    g.excite(this.x, this.z, 3);
    if (tgt.dead) {
      this.kills++;
      if (this.sp.diet === 'carn') { this.huntUrge = 100; this.stress = Math.max(0, this.stress - 30); }
      if (this.state === 'fight' || this.state === 'defend') { this.target = null; this.setState('idle', 2); }
    } else if (this.state === 'fight' && tgt.health < 35) {
      // the loser runs; after a few defeats Acrocanthosaurus, T. rex and Carcharodontosaurus stop picking fights
      tgt.losses = (tgt.losses || 0) + 1;
      tgt.fleeFrom(this, 8); this.target = null; this.setState('idle', 2); this.stress = Math.max(0, this.stress - 25);
      // a territorial fight satisfies a large carnivore's urge to hunt for a while
      if (LARGE_CARN.has(this.sp.id)) this.huntUrge = Math.min(100, this.huntUrge + 40);
    }
  }

  // One head-butt in a herd-leader contest. After a few clashes the weaker animal backs off and the winner wears the crown.
  joust(rival) {
    const g = this.g;
    this.attackCd = rand(1.2, 1.8);
    this.biteT = 0.35;
    rival.hitFlash = 0.2;
    g.excite(this.x, this.z, 2);
    G.audio?.playAt('thud', this.x, this.z, 0.5);
    this.jousts = (this.jousts || 0) + 1;
    if (this.jousts < 3 + (this.id % 3)) return;
    const mine = this.health + this.kills * 5 + rand(-20, 20), theirs = rival.health + rival.kills * 5 + rand(-20, 20);
    const [win, lose] = mine >= theirs ? [this, rival] : [rival, this];
    for (const d of g.dinos) if (d.sp === win.sp && d.region() === win.region()) d.leader = false;
    win.leader = true;
    lose.fleeFrom(win, 4);
    win.target = null; win.setState('idle', 2);
    if (chance(0.5)) g.notify(`${win.sp.name} "${win.name}" won a head-butting contest and now leads the herd.`, 'info', { dino: win }, 'vet');
  }

  takeHit(dmg, attacker, cause = 'injuries') {
    this.health = clamp(this.health - (dmg / this.maxHp) * 100, 0, 100);
    if (attacker) { this.lastHitBy = attacker.sp.name; this.lastHitT = this.g.time; }
    this.hitFlash = 0.3;
    if (!attacker) {
      // Hit by the environment (lightning): panic and bolt.
      this.stress = clamp(this.stress + 20, 0, 100);
      if (this.health <= 0) { this.die(cause); return; }
      this.fleeFrom({ x: this.x + rand(-1, 1), z: this.z + rand(-1, 1) }, 5);
      return;
    }
    if (this.state === 'sleep' || this.state === 'idle' || this.state === 'move' || this.state === 'eating' || this.state === 'grazing' || this.state === 'drinking') {
      if (this.sp.diet === 'herb' && (fightsBack(this, attacker) || this.sp.id === 'kentrosaurus') && this.tranq <= 0) { this.target = attacker; this.setState('defend', 10); this.roar(1); }
      // a young T. rex with few kills backs down from a Spinosaurus that has already beaten it
      else if (this.sp.id === 'tyrannosaurus' && attacker.sp.id === 'spinosaurus' && this.kills < 2 && (this.losses || 0) >= 1) this.fleeFrom(attacker, 6);
      else if (this.sp.diet === 'carn' && this.tranq <= 0 && !((this.losses || 0) >= 3 && this.sp.id !== 'spinosaurus') && !(this.sp.id === 'allosaurus' && LARGE_CARN.has(attacker.sp.id))) { this.target = attacker; this.setState('fight', 12); }
      else this.fleeFrom(attacker, 6);
    }
    if (this.health <= 0) this.die(attacker ? `killed by ${attacker.sp.name}` : 'injuries');
  }

  fleeFrom(src, t) {
    if (this.tranq > 0 || this.dead) return;
    this.fleeSrc = { x: src.x, z: src.z };
    this.path = null;
    this.setState('flee', t);
  }
  fleeStep(dt) {
    const s = this.fleeSrc;
    if (!s) return;
    const a = Math.atan2(this.z - s.z, this.x - s.x) + Math.sin(this.t) * 0.4;
    this.steer(dt, this.x + Math.cos(a) * 4, this.z + Math.sin(a) * 4, this.sp.run);
  }

  // Charge the Land Cruiser (missions and Safari Adventure): large carnivores and Triceratops ram it, as in the original.
  huntJeep(dt) {
    const car = this.jeepTarget && !this.jeepTarget.removed ? this.jeepTarget : this.g.cruiser;
    this.stateT -= dt;
    if (!car || car.hp <= 0 || this.stateT <= 0 || (car.kind === 'jeep' && car.state !== 'tour')) { this.jeepTarget = null; this.setState('idle', 3); return; }
    const reach = this.len * 0.45 + 0.9, d = dist(this.x, this.z, car.x, car.z);
    if (d > reach) { this.steer(dt, car.x, car.z, this.sp.run * 0.9); return; }
    this.speedNow = 0;
    this.faceTo(car.x, car.z, dt * 6);
    if (this.attackCd > 0) return;
    this.attackCd = rand(1.0, 1.6); this.biteT = 0.35;
    car.hit(this.sp.diet === 'carn' ? 6 + SIZE_RANK[this.sp.size] * 3 : 9);
    if (chance(0.3)) this.roar(1);
    if (chance(0.25)) this.setState('idle', 4); // sometimes it loses interest
  }

  // Too stressed to cope: the animal collapses and slowly weakens until it recovers or is revived.
  fallComatose() {
    this.coma = true;
    this.tranq = 1.2;
    this.stress = 60;
    this.g.notify(`${this.sp.name} "${this.name}" has collapsed into a coma from stress!`, 'danger', { dino: this });
  }
  // Leap over a fence to the tile on its far side.
  climbFence(e) {
    const map = this.g.map;
    const r = this.region();
    const out = map.edgeTiles(e.h, e.i).find(([x, y]) => map.inb(x, y) && (!r || map.region[map.idx(x, y)] !== r.id));
    if (!out) return;
    this.x = out[0] + 0.5; this.z = out[1] + 0.5;
    this.path = null; this.target = null;
    this.setState('idle', 0.5);
    G.audio?.playAt('thud', this.x, this.z, 0.5);
    if (this.g.watched(this)) this.g.notify(`A Velociraptor has climbed the fence! "${this.name}" is loose.`, 'danger', { dino: this });
  }

  bash(dt) {
    const g = this.g, map = g.map, e = this.target;
    this.stateT -= dt;
    if (!e || !map.fenceIntact(e.h, e.i) || this.stateT <= 0) {
      this.stress = Math.max(0, this.stress - 25);
      this.target = null; this.setState('idle', 2); return;
    }
    this.bashT -= dt;
    if (this.bashT > 0) return;
    this.bashT = rand(0.9, 1.4);
    this.biteT = 0.4;
    const t = map.fenceType(e.h, e.i);
    // Velociraptors test Low and Medium fences for a weak point: some tries get a shock, some get them over.
    if (this.sp.id === 'velociraptor' && t <= 2) {
      const known = this.weakSpot && this.weakSpot.h === e.h && this.weakSpot.i === e.i;
      if (known || chance(t === 1 ? 0.45 : 0.22)) { this.weakSpot = { h: e.h, i: e.i }; this.climbFence(e); return; }
      if (!map.blackout) { G.audio?.playAt('zap', this.x, this.z, 0.8); g.sparks(map.edgeCenter(e.h, e.i)); this.health = Math.max(1, this.health - 4); this.fleeFrom(map.edgeCenter(e.h, e.i), 3); return; }
    }
    let armor = FENCES[t].armor;
    // every fence tier is electrified; a blackout weakens them all
    const electric = !map.blackout;
    if (map.blackout) armor = Math.max(1, armor - 1.5);
    const str = this.sp.str * (this.disease === 'rabies' ? 1.2 : 1);
    const dmg = 14 * Math.pow(str / armor, 2.5) * rand(0.7, 1.3) * (this.growth);
    const hp = map.fenceHp(e.h, e.i) - dmg;
    G.audio?.playAt('thud', this.x, this.z, 0.6);
    if (electric) {
      G.audio?.playAt('zap', this.x, this.z, 0.8);
      this.health = Math.max(1, this.health - 3);
      g.sparks(map.edgeCenter(e.h, e.i));
      if (str <= armor) { map.setFenceHp(e.h, e.i, Math.max(1, hp)); this.fleeFrom(map.edgeCenter(e.h, e.i), 5); this.stress = Math.max(0, this.stress - 15); return; }
    }
    if (hp <= 0) {
      g.breakFence(e.h, e.i, this);
      this.target = null; this.setState('idle', 1); this.stress = Math.max(0, this.stress - 20);
    } else map.setFenceHp(e.h, e.i, hp);
  }

  // ---------------- movement ----------------
  canStep(ax, ay, bx, by) {
    if (ax === bx && ay === by) return true;
    const map = this.g.map;
    if (!map.inb(bx, by) || !map.dinoPassable(map.idx(bx, by))) return false;
    const dx = bx - ax, dy = by - ay;
    if (Math.abs(dx) + Math.abs(dy) === 1) return map.dinoCross(ax, ay, bx, by);
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return false;
    const viaA = map.inb(bx, ay) && map.dinoPassable(map.idx(bx, ay)) && map.dinoCross(ax, ay, bx, ay) && map.dinoCross(bx, ay, bx, by);
    const viaB = map.inb(ax, by) && map.dinoPassable(map.idx(ax, by)) && map.dinoCross(ax, ay, ax, by) && map.dinoCross(ax, by, bx, by);
    return viaA || viaB;
  }

  steer(dt, tx, tz, speed) {
    const dx = tx - this.x, dz = tz - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) { this.speedNow = 0; return true; }
    const want = Math.atan2(dz, dx);
    const turn = (SIZE_RANK[this.sp.size] >= 3 ? 2.2 : 4) * dt;
    let diff = ((want - this.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.heading += clamp(diff, -turn, turn);
    const slow = Math.abs(diff) > 1.2 ? 0.35 : 1;
    const v = Math.min(speed * slow, d / Math.max(dt, 1e-3));
    this.speedNow = lerp(this.speedNow, v, Math.min(1, dt * 4));
    const step = this.speedNow * dt;
    const nx = this.x + Math.cos(this.heading) * step, nz = this.z + Math.sin(this.heading) * step;
    const ax = Math.floor(this.x), ay = Math.floor(this.z), bx = Math.floor(nx), by = Math.floor(nz);
    if (this.canStep(ax, ay, bx, by)) { this.x = nx; this.z = nz; return false; }
    // blocked
    this.speedNow = 0;
    this.blocked = (this.blocked || 0) + dt;
    if (this.blocked > 1.5) { this.blocked = 0; this.path = null; if (this.state !== 'flee') this.setState('idle', 1); else this.fleeSrc = { x: nx, z: nz }; }
    return false;
  }

  follow(dt, speed) {
    const map = this.g.map;
    if (!this.path || this.pathI >= this.path.length) {
      if (this.goal) {
        const d = dist(this.x, this.z, this.goal.x, this.goal.z);
        if (d > this.goal.tol) { this.steer(dt, this.goal.x, this.goal.z, speed); if (dist(this.x, this.z, this.goal.x, this.goal.z) > this.goal.tol) return false; }
      }
      this.speedNow = 0;
      return true;
    }
    const i = this.path[this.pathI];
    const last = this.pathI === this.path.length - 1;
    let tx = (i % map.W) + 0.5, tz = Math.floor(i / map.W) + 0.5;
    if (last && this.goal) { tx = this.goal.x; tz = this.goal.z; }
    const d = dist(this.x, this.z, tx, tz);
    if (d < (last ? (this.goal ? this.goal.tol : 0.3) : 0.45)) { this.pathI++; if (last) { this.speedNow = 0; return true; } return false; }
    this.steer(dt, tx, tz, speed);
    return false;
  }

  faceTo(x, z, k = 1) { this.heading = angleLerp(this.heading, Math.atan2(z - this.z, x - this.x), Math.min(1, k)); }

  // ---------------- lifecycle ----------------
  tranquilize(days) {
    if (this.dead) return;
    this.tranq = days;
    this.state = 'tranq'; this.path = null; this.target = null;
  }
  die(cause) {
    if (this.dead) return;
    this.dead = true; this.cause = cause; this.state = 'dead'; this.deadT = 0; this.path = null; this.tranq = 0;
    setDinoMaterial(this.mesh, MAT.dead);
    const g = this.g;
    g.park.stats.deaths++;
    if (cause !== 'retired') g.notify(`${this.sp.name} "${this.name}" has died (${cause}).`, cause === 'old age' ? 'info' : 'warn', { dino: this });
    g.onDinoDeath?.(this);
    if (G.engine.cam.follow === this && G.engine.cam.mode === 'ride') { G.engine.cam.mode = 'follow'; }
  }
  roar(vol = 1) { G.audio?.playAt('roar', this.x, this.z, vol, { size: SIZE_RANK[this.sp.size], carn: this.sp.diet === 'carn' }); this.biteT = 0.8; }

  // ---------------- animation ----------------
  animate(dt) {
    const u = this.mesh.userData, m = this.sp.model;
    const g = this.g;
    const s = WORLD_SCALE * this.growth;
    u.scaler.scale.setScalar(s);
    const gy = Math.max(g.map.heightAt(this.x, this.z), -0.4);
    this.mesh.position.set(this.x, this.carried ? this.carryY : gy, this.z);
    this.mesh.rotation.y = -this.heading;
    if (u.rig) { this.animateRig(dt, u.rig); return; }
    const legLen = m.hipH * s;
    this.phase += dt * this.speedNow / Math.max(0.15, legLen) * 1.9;
    const lying = this.state === 'sleep' || this.state === 'tranq' || this.state === 'carried';
    const k = Math.min(1, dt * 4);
    if (this.dead) {
      u.body.rotation.x = lerp(u.body.rotation.x, Math.PI / 2 * 0.92, k);
      u.body.position.y = lerp(u.body.position.y, m.bodyR * 0.9, k);
      for (const l of u.legs) l.g.rotation.z = lerp(l.g.rotation.z, l.base + (l.front ? 0.5 : -0.3), k);
      u.neck.rotation.z = lerp(u.neck.rotation.z, 0.1, k);
      u.jaw.rotation.z = lerp(u.jaw.rotation.z, -0.3, k);
      return;
    }
    u.body.rotation.x = lerp(u.body.rotation.x, 0, k);
    if (lying) {
      u.body.position.y = lerp(u.body.position.y, m.bodyH * 0.95, k * 0.6);
      for (const l of u.legs) l.g.rotation.z = lerp(l.g.rotation.z, l.base + (l.front ? 1.25 : -1.25), k * 0.6);
      u.neck.rotation.z = lerp(u.neck.rotation.z, u.baseNeck * 0.3 - 0.15, k * 0.5);
      u.head.rotation.y = 0;
      for (let i = 0; i < u.tail.length; i++) u.tail[i].rotation.y = Math.sin(this.t * 0.3 + i) * 0.03;
      u.jaw.rotation.z = 0;
      return;
    }
    const amp = Math.min(0.75, this.speedNow * 0.32 / Math.max(0.2, legLen) + 0.0);
    for (const l of u.legs) l.g.rotation.z = lerp(l.g.rotation.z, l.base + Math.sin(this.phase + l.ph) * amp, Math.min(1, dt * 12));
    for (const a of u.arms) a.rotation.z = Math.sin(this.phase) * amp * 0.3 + 0.2;
    u.body.position.y = m.hipH + Math.abs(Math.sin(this.phase)) * m.hipH * 0.035 * Math.min(1, amp * 3) - (m.plan === 'biped' ? 0 : 0);
    // head pose
    const eating = this.state === 'drinking' || this.state === 'eating' || this.state === 'grazing' || this.state === 'feeding';
    let neckT = u.baseNeck, headT = u.baseHead, look = Math.sin(this.t * 0.4 + this.id) * 0.35;
    if (eating) {
      const browse = this.state === 'grazing' && SIZE_RANK[this.sp.size] >= 4;
      neckT = browse ? u.baseNeck + 0.15 : u.baseNeck - 0.9 - m.pitch; headT = u.baseHead - (browse ? 0 : 0.5) + Math.sin(this.t * 6) * 0.08; look = 0;
    }
    if (this.state === 'hunt' || this.state === 'fight' || this.state === 'hunt_visitor' || this.state === 'defend') { neckT = u.baseNeck - 0.15; look = 0; }
    if (this.state === 'rear') { neckT = u.baseNeck + 0.35; headT = u.baseHead - 0.2; look = 0; }
    if (this.state === 'bash') { neckT = u.baseNeck - 0.35 + Math.max(0, this.bashT || 0) * 0.4; look = 0; }
    u.neck.rotation.z = lerp(u.neck.rotation.z, neckT, k);
    u.head.rotation.z = lerp(u.head.rotation.z, headT, k);
    u.neck.rotation.y = lerp(u.neck.rotation.y, this.speedNow > 0.1 ? 0 : look * 0.6, k * 0.5);
    this.biteT = Math.max(0, (this.biteT || 0) - dt);
    u.jaw.rotation.z = lerp(u.jaw.rotation.z, this.biteT > 0 ? -0.55 : eating ? -0.15 - Math.abs(Math.sin(this.t * 6)) * 0.2 : 0, Math.min(1, dt * 14));
    const sway = 0.05 + this.speedNow * 0.04;
    for (let i = 0; i < u.tail.length; i++) u.tail[i].rotation.y = Math.sin(this.t * 1.6 + this.phase * 0.5 - i * 0.7) * sway;
  }

  // Animated model: pick a clip from the current state.
  animateRig(dt, r) {
    const s = this.state;
    let clip = 'idle', speed = 1, once = false;
    if (this.dead) { clip = 'death'; once = true; }
    else if (s === 'sleep' || s === 'tranq' || s === 'carried') { clip = 'death'; once = true; speed = 0.5; }
    else if (this.biteT > 0 || (['fight', 'defend', 'bash', 'rear'].includes(s) && this.speedNow < 0.3)) clip = 'attack';
    else if (this.speedNow > 0.05) {
      const running = this.speedNow > this.sp.spd * 1.3;
      clip = running ? 'run' : 'walk';
      speed = clamp(this.speedNow / (running ? this.sp.run : this.sp.spd), 0.5, 2);
    } else if (['eating', 'grazing', 'feeding', 'drinking'].includes(s)) { clip = 'idle'; speed = 1.6; }
    const a = play(r, clip, 0.3, once);
    if (a) a.timeScale = speed;
    this.biteT = Math.max(0, (this.biteT || 0) - dt);
    r.mixer.update(dt);
  }

  camPos() {
    // Over-the-shoulder: just behind and above the head.
    const hp = (this._hp = this._hp || new THREE.Vector3());
    this.mesh.userData.head.getWorldPosition(hp);
    const L = this.len, c = Math.cos(this.heading), s = Math.sin(this.heading);
    return { x: hp.x - c * L * 0.32, y: hp.y + L * 0.12 + 0.15, z: hp.z - s * L * 0.32, yaw: this.heading };
  }

  dispose() { this.g.root.remove(this.mesh); this.removed = true; }

  toJSON() {
    return {
      id: this.id, sp: this.sp.id, name: this.name, x: this.x, z: this.z, heading: this.heading, genome: this.genome, age: this.age, lifespan: this.lifespan,
      health: this.health, hunger: this.hunger, thirst: this.thirst, huntUrge: this.huntUrge, comfort: this.comfort, stress: this.stress, disease: this.disease, immune: this.immune, toxin: this.toxin, coma: this.coma, weakSpot: this.weakSpot, leader: this.leader, losses: this.losses || 0, nursery: this.nursery,
      tranq: this.tranq, dead: this.dead, deadT: this.deadT, cause: this.cause, meat: this.meat, home: this.home, escaped: this.escaped, kills: this.kills, born: this.born,
    };
  }
}
