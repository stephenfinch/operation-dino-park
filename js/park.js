// Park-level simulation: clock, economy, rating, weather, research, expeditions, hatcheries, missions.
import { G } from './state.js';
import { VTYPES, PARTY, DAY_SECONDS, SPECIES, SPECIES_BY_ID, RESEARCH, RESEARCH_BY_ID, RESEARCH_RENAMED, SITES, SITE_BY_ID, QUALITY, TEAM_COSTS, MAX_TEAMS, GEMS, BLD, FENCES, MISSIONS, FEED, feederFood, DIG_DAYS } from './data.js';
import { clamp, rand, randi, pick, chance, fmtMoney, lerp } from './util.js';

export const INCOME_CATS = ['Entry', 'Shops', 'Rides', 'Hotels', 'Photos', 'Sales'];
export const EXPENSE_CATS = ['Construction', 'Upkeep', 'Staff', 'Feed', 'Stock', 'Research', 'Expeditions', 'Hatchery', 'Fines'];
const PROGRESS_KEY = 'isla-genesis:progress';

export function loadProgress() {
  try {
    const p = Object.assign({ missions: {}, exercises: {}, siteB: false, career5: false }, JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}'));
    // version 2 replaced the mission list with the original's ten missions: old completions no longer apply
    if (p.v !== 2) { p.missions = {}; p.v = 2; }
    return p;
  }
  catch (e) { return { missions: {}, siteB: false, career5: false }; }
}
export function saveProgress(p) { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ } }

// Map day fraction (0 = 06:00) to clock hour. Night (21:00-06:00) passes 2x faster.
export function hourFromFrac(d) { return d < 0.75 ? 6 + (d / 0.75) * 15 : (21 + ((d - 0.75) / 0.25) * 9) % 24; }

export class Park {
  constructor(game, opts) {
    this.g = game;
    this.mode = opts.mode;
    this.mission = opts.mission || null;
    this.unlimited = opts.mode === 'sandbox' || opts.mode === 'siteb';
    this.money = this.unlimited ? 1e9 : (this.mission?.money ?? 100000);
    this.name = opts.name || 'Isla Genesis';
    this.dayFrac = 0.12;
    this.day = 1;
    this.fee = 200;
    // Mix of guest interest types; starts weighted toward neutral guests, as in the original.
    this.vdist = { violent: 1, nonviolent: 1, environmental: 1, neutral: 3 };
    // As in the original, a new park starts closed; the player opens it when ready.
    this.parkOpen = this.mode === 'demo' || !!this.mission?.open;
    this.everOpened = this.parkOpen;
    this.rating = { value: 0, stars: 0, dino: 0, visitor: 2.5, safety: 100, dinoScore: 0 };
    this.dna = {};
    for (const s of SPECIES) this.dna[s.id] = 0;
    if (this.mode === 'sandbox' || this.mode === 'siteb') for (const s of SPECIES) this.dna[s.id] = 100;
    if (this.mission?.dna) Object.assign(this.dna, this.mission.dna);
    this.research = { done: new Set(this.mission?.research || []), active: [] };
    if (this.mode === 'sandbox') for (const r of RESEARCH) this.research.done.add(r.id);
    this.teams = 1;
    this.expeditions = [];
    // Dig spot quality as in the original: 5 Rich, 4 Good, 3 Average, 2 Mediocre, 1 Poor, 0 Exhausted.
    this.siteQuality = Object.fromEntries(SITES.map((s) => [s.id, [0, 1, 2].map(() => (chance(0.5) ? 5 : 4))]));
    this.siteUses = Object.fromEntries(SITES.map((s) => [s.id, [0, 0, 0]]));
    // Hunting grounds the park has acquired: one to start, one more per star, at most five.
    this.claimed = [];
    this.digLog = [];
    this.fossils = [];     // inventory of finds: fossils, amber, gems
    this.seqQueue = [];    // DNA sequencing queue in the Genetics Lab
    this.market = { offers: [], next: 0.2, drift: 1, mod: rand(0.9, 1.1) };
    this.weather = { type: 'clear', left: 0.6, next: null, warned: false };
    this.storminess = this.mission?.storms || 1;
    this.blackout = 0;
    this.twister = null;
    this.ledger = { today: this._blankLedger(), history: [] };
    this.stats = { hatched: 0, escapes: 0, deaths: 0, visitorDeaths: 0, retired: 0, retiredCarn: 0, photoPoints: 0, photoSpecies: new Set(), photos: 0, visitorsTotal: 0, satisfaction: [], typeSat: {}, peakVisitors: 0, lastEscapeDay: 0, firstHatchDay: 0 };
    this.missionState = { done: false, failed: false, goals: [] };
    if (this.mode === 'career') this.startCareer();
    this._hourAcc = 0;
    this._lastHour = Math.floor(this.clockHour);
    this._checkT = 0;
  }

  // A new park, as in the original: one hunting ground is already owned, the first dig team is at work there,
  // and the genomes of one small herbivore and one small carnivore from it are already past 50%.
  startCareer() {
    const site = SITE_BY_ID[pick(['judithA', 'morrisonA', 'flaming'])];
    this.claimed = [site.id];
    const small = (diet) => site.species.map((id) => SPECIES_BY_ID[id]).filter((sp) => sp.diet === diet && sp.cat[0] === 'S');
    for (const diet of ['herb', 'carn']) { const sp = pick(small(diet)); if (sp) this.dna[sp.id] = Math.round(rand(52, 62)); }
    this.expeditions.push({ site: site.id, spot: 0, teams: 1, left: DIG_DAYS, total: DIG_DAYS });
  }
  _blankLedger() { const o = {}; for (const c of INCOME_CATS) o[c] = 0; for (const c of EXPENSE_CATS) o[c] = 0; return o; }

  // The original has no day/night; it is optional here (Options → Day/night cycle).
  get dayNight() { return !!G.settings.dayNight && this.mode !== 'demo'; }
  get hour() { return this.dayNight ? hourFromFrac(this.dayFrac) : 13; }
  // The economy keeps ticking hourly even when the sky is fixed at midday.
  get clockHour() { return hourFromFrac(this.dayFrac); }
  get isNight() { const h = this.hour; return h >= 20.5 || h < 6; }
  get isOpen() { const h = this.hour; return this.parkOpen && h >= 7 && h < 18; }
  setOpen(on) {
    if (this.parkOpen === on) return;
    if (on && !this.g.entrances().length) { this.g.notify('Place a Park Entrance first (Build → Amenities, or Actions → Place Park Entrance).', 'warn', null, 'admin'); return; }
    this.parkOpen = on;
    if (on) { this.everOpened = true; this.openedDay ??= this.day; this.g.flag?.('opened'); }
    const g = this.g;
    if (on) { g.notify(`${this.name} is open! The first helicopter of guests is on its way.`, 'good', null, 'pr'); G.audio?.play('fanfare'); }
    else { g.visitors.closePark(); g.notify('The park is closed. Guests are heading home.', 'info', null, 'admin'); }
  }
  // The kinds of guests a park attracts drift toward what it offers.
  updateVisitorMix() {
    const g = this.g;
    let carn = 0, herb = 0;
    for (const d of g.dinos) { if (d.dead || d.escaped) continue; if (d.sp.diet === 'carn') carn += d.sp.value; else herb += d.sp.value; }
    const tot = carn + herb;
    const auth = this.parkAuthenticity();
    const target = {
      violent: 0.5 + (tot ? 2.4 * carn / tot : 0),
      nonviolent: 0.5 + (tot ? 2.4 * herb / tot : 0),
      environmental: 0.4 + 2.6 * auth,
      neutral: 2,
    };
    for (const k in this.vdist) this.vdist[k] = lerp(this.vdist[k], target[k], 0.2);
  }
  // Average authenticity of what guests see from the footpaths (0..1).
  parkAuthenticity() {
    const map = this.g.map, paths = [];
    for (let i = 0; i < map.path.length; i++) if (map.path[i] === 1) paths.push(i);
    if (!paths.length) return 0.4;
    let s = 0;
    const n = Math.min(60, paths.length);
    for (let k = 0; k < n; k++) { const i = paths[Math.floor(Math.random() * paths.length)]; s += this.g.visitors.localAuth(i % map.W, Math.floor(i / map.W), 6); }
    return s / n;
  }
  pickVType() {
    let t = 0;
    for (const k in this.vdist) t += this.vdist[k];
    let r = Math.random() * t;
    for (const k in this.vdist) { r -= this.vdist[k]; if (r <= 0) return k; }
    return 'neutral';
  }
  // entry fees run into the hundreds, as in the original (the Let's Play charged $280 early on and $780 at 3.5 stars)
  setFee(v) { this.fee = clamp(Math.round(v / 10) * 10, 0, 5000); }
  // Calendar as in the original: 1 month = 300 s of game time, starting January 2000.
  dateText() {
    const m = Math.floor((this.elapsed || 0) / 300);
    return `${['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][m % 12]} ${2000 + Math.floor(m / 12)}`;
  }
  get months() { return (this.elapsed || 0) / 300; }
  clockText() {
    const h = this.hour, hh = Math.floor(h), mm = Math.floor((h - hh) * 60 / 10) * 10;
    return `Day ${this.day}  ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  // ---------- money ----------
  canAfford(c) { return this.unlimited || this.money >= c; }
  spend(c, cat = 'Construction') {
    if (c <= 0) return true;
    if (!this.canAfford(c)) return false;
    if (!this.unlimited) this.money -= c;
    this.ledger.today[cat] = (this.ledger.today[cat] || 0) + c;
    return true;
  }
  forceSpend(c, cat) { if (!this.unlimited) this.money -= c; this.ledger.today[cat] = (this.ledger.today[cat] || 0) + c; }
  earn(c, cat = 'Shops') {
    if (!this.unlimited) this.money += c;
    this.ledger.today[cat] = (this.ledger.today[cat] || 0) + c;
  }
  has(rid) { return this.research.done.has(rid); }

  // ---------- update ----------
  update(dt) {
    const dd = dt / DAY_SECONDS;
    this.elapsed = (this.elapsed || 0) + dt;
    this.dayFrac += dd;
    if (this.dayFrac >= 1) { this.dayFrac -= 1; this.day++; this.dailyTick(); }
    const h = Math.floor(this.clockHour);
    if (h !== this._lastHour) { this._lastHour = h; this.hourlyTick(); }
    this.updateWeather(dt, dd);
    this.updateResearch(dd);
    this.updateExpeditions(dd);
    this.updateHatcheries(dd);
    if (this.blackout > 0) {
      this.blackout -= dd;
      if (this.blackout <= 0) { this.blackout = 0; this.g.map.blackout = false; this.g.notify('Power restored. Electric fences are live again.', 'good'); }
    }
    this._checkT -= dt;
    if (this._checkT <= 0) { this._checkT = 1.5; this.checkMission(); }
  }

  hourlyTick() {
    const g = this.g;
    // upkeep and wages, charged hourly
    let upkeep = 0, staff = 0;
    for (const b of g.buildings.values()) {
      const def = BLD[b.type];
      if (def.fn === 'ranger' || def.fn === 'acu') staff += def.upkeep / 24;
      else if (def.fn === 'cleaner') staff += (def.upkeep + (b.hired || 0) * 75) / 24; // $150 a month per cleaner
      else upkeep += def.upkeep / 24;
    }
    if (this.mode !== 'siteb') { this.forceSpend(upkeep, 'Upkeep'); this.forceSpend(staff, 'Staff'); }
    this.computeRating();
    this.rating.safety = clamp(this.rating.safety + 1.2, 0, 100);
  }

  dailyTick() {
    const g = this.g;
    this.updateVisitorMix();
    // Carnivore Feeders on automatic drop a live goat or cow every month (two days), as in the original,
    // whether or not a carnivore is waiting: uneaten animals stay and wander the enclosure.
    if (this.day % 2 === 0) for (const b of g.buildingsOf('feeder_goat').concat(g.buildingsOf('feeder_cow'))) {
      if (b.menu?.auto === false || b.broken) continue;
      let r = -1;
      for (const [rid, list] of g.feedersByRegion) if (list.includes(b) && !g.map.regions[rid]?.public) { r = rid; break; }
      if (r >= 0 && g.livestock.filter((a) => !a.dead && !a.removed && a.feeder === b.id).length < 6) { b.stock = Math.max(b.stock, 1); g.releaseLivestock(b, r, true); }
    }
    // feeders restock
    for (const b of g.buildings.values()) {
      const def = BLD[b.type];
      if (def.fn === 'feeder' && b.stock < def.stock && b.menu?.auto !== false) {
        const need = def.stock - b.stock;
        const cost = need * FEED[feederFood(b)].cost;
        if (this.mode === 'siteb' || this.canAfford(cost)) { if (this.mode !== 'siteb') this.forceSpend(cost, 'Feed'); b.stock = def.stock; }
      }
    }
    this.ledger.history.push({ day: this.day - 1, ...this.ledger.today, money: this.money, visitors: g.visitors.count, stars: this.rating.stars });
    if (this.ledger.history.length > 60) this.ledger.history.shift();
    this.ledger.today = this._blankLedger();
    // A board meeting every quarter (six game days), as in the original's Performance report.
    if (this.mode === 'career' && this.day > 1 && (this.day - 1) % 6 === 0) this.boardReview();
    g.onNewDay?.();
  }

  boardReview() {
    const g = this.g, h = this.ledger.history.slice(-6);
    const inc = h.reduce((a, d) => a + INCOME_CATS.reduce((x, k) => x + (d[k] || 0), 0), 0);
    const exp = h.reduce((a, d) => a + EXPENSE_CATS.reduce((x, k) => x + (d[k] || 0), 0), 0);
    const profit = Math.round(inc - exp), stars = this.rating.stars, prev = this.lastReview?.stars ?? 0;
    const sat = this.stats.satisfaction.slice(-30), avg = sat.length ? sat.reduce((a, b) => a + b, 0) / sat.length : 50;
    const q = Math.floor((this.months || 0) / 3);
    const notes = [];
    notes.push(profit >= 0 ? `a profit of ${fmtMoney(profit)}` : `a loss of ${fmtMoney(-profit)}`);
    notes.push(stars > prev ? `the rating up to ${stars} stars` : stars < prev ? `the rating down to ${stars} stars` : `the rating steady at ${stars} stars`);
    notes.push(`guests leaving ${Math.round(avg)}% happy`);
    const good = profit >= 0 && stars >= prev && avg >= 45;
    const verdict = good ? 'The board is delighted. Keep up the good work.' : this.money < 0 ? 'The board is alarmed: the park is in debt. Cut costs or raise income before the next meeting.' : 'The board has concerns. We expect to see improvement next quarter.';
    // in debt at two meetings running, the board shuts the park down (as the original's finance director warns)
    this.debtMeetings = this.money < 0 ? (this.debtMeetings || 0) + 1 : 0;
    const warn = this.debtMeetings === 1 ? ' If the park is still in debt at the next meeting, the board will close it.' : '';
    g.notify(`Quarterly board meeting (${['first', 'second', 'third', 'fourth'][q % 4]} quarter ${2000 + Math.floor(q / 4)}): ${notes.join(', ')}. ${verdict}${warn}`, good ? 'good' : 'warn', null, good ? 'founder' : 'finance');
    this.lastReview = { stars, profit, day: this.day };
    if (this.debtMeetings >= 2 && this.mode === 'career' && !this.unlimited) { this.shutDown = true; g.speed = 0; G.ui?.openModal('shutdown'); }
  }

  // ---------- rating ----------
  computeRating() {
    const g = this.g;
    let score = 0;
    const species = new Set();
    for (const d of g.dinos) {
      if (d.dead || d.escaped) continue;
      const sp = d.sp;
      score += sp.value * (0.5 + 0.5 * d.health / 100) * (0.55 + 0.45 * d.comfort / 100) * d.growth;
      species.add(sp.id);
    }
    score *= 1 + 0.07 * Math.max(0, species.size - 1);
    const th = [0, 8, 35, 90, 190, 340];
    let ds = 5;
    for (let i = 1; i < th.length; i++) if (score < th[i]) { ds = i - 1 + (score - th[i - 1]) / (th[i] - th[i - 1]); break; }
    this.rating.dinoScore = score;
    this.rating.dino = clamp(ds, 0, 5);
    const sat = this.stats.satisfaction;
    let vs;
    if (sat.length >= 5) vs = sat.reduce((a, b) => a + b, 0) / sat.length / 20;
    else if (g.visitors.count > 5) vs = g.visitors.avgHappiness() / 20;
    else vs = 2.5;
    this.rating.visitor = clamp(vs, 0, 5);
    const safe = this.rating.safety / 20;
    let target = this.rating.dino * 0.5 + this.rating.visitor * 0.35 + safe * 0.15;
    target = Math.min(target, this.rating.dino + 0.6);
    if (this.mode === 'siteb') target = this.rating.dino;
    target = clamp(Math.max(target + (this.ratingBonus || 0), this.ratingFloor || 0), 0, 5); // cheat codes
    this.rating.value = lerp(this.rating.value, target, 0.35);
    const prev = this.rating.stars;
    this.rating.stars = clamp(Math.floor(this.rating.value * 2 + 0.15) / 2, 0, 5);
    if (this.rating.stars > prev && this.day > 1) { g.notify(`Park rating rose to ${this.rating.stars} stars!`, 'good'); G.audio?.play('fanfare'); }
    if (this.rating.stars >= 5 && this.mode === 'career') {
      const p = loadProgress(); if (!p.career5) { p.career5 = true; p.siteB = true; saveProgress(p); g.notify('5 stars! Site B mode is now unlocked.', 'good'); }
      // reaching five stars completes Operation Genesis (the career goal screen shows it)
      this.completed = true;
    }
  }
  safetyHit(n) { this.rating.safety = clamp(this.rating.safety - n, 0, 100); }

  // The original allows at most 100 guests in the park at once (60 dinosaurs); fewer while the rating is low.
  visitorCapacity() {
    let cap = 30 + this.rating.stars * 14;
    for (const b of this.g.buildings.values()) cap += (BLD[b.type].capacity || 0) / 4;
    return Math.round(Math.min(cap, 100));
  }
  fairFee() { return Math.round(100 + this.rating.stars * 200); }

  // ---------- weather ----------
  // Weather as in the original: Sunny, Heatwave, Rain, Thunderstorm and Twister. The control room keeps a
  // forecast (about three months ahead) and warns of twisters two months before they arrive.
  forecast() {
    const w = this.weather;
    w.queue ||= [];
    let t = w.left;
    for (const f of w.queue) t += f.dur;
    while (w.queue.length < 3 || t < 6) { const f = this.rollWeather(); w.queue.push(f); t += f.dur; }
    return w.queue;
  }
  // Force a weather type now (the cheat codes): it replaces the current spell.
  forceWeather(type) {
    const w = this.weather;
    w.queue = [{ type, dur: type === 'clear' ? rand(0.5, 1) : type === 'twister' ? 0.22 : 0.4 }, ...(w.queue || [])];
    w.left = 0;
    if (type === 'clear') this.twister = null;
  }
  updateWeather(dt, dd) {
    const w = this.weather, g = this.g;
    w.left -= dd;
    if (this.mode === 'siteb' && w.type === 'twister') w.left = 0;
    const q = this.forecast();
    w.next = q[0];
    // warnings: twisters two months (4 days) ahead, storms half a day ahead
    let ahead = w.left;
    for (const f of q) {
      if (f.type === 'twister' && !f.warned && ahead < 4) { f.warned = true; g.notify(`Weather report: a TWISTER is forecast in about ${Math.max(1, Math.round(ahead / 2))} month${ahead > 3 ? 's' : ''}. Build Visitor Shelters, and declare an emergency when it arrives.`, 'warn', null, 'admin'); }
      if (f.type === 'storm' && !f.warned && ahead < 0.5) { f.warned = true; g.notify('Weather report: a thunderstorm is on its way.', 'warn', null, 'admin'); }
      if (f.type === 'heat' && !f.warned && ahead < 0.5) { f.warned = true; g.notify('Weather report: a heatwave is coming. Dinosaurs and guests will be thirsty.', 'info', null, 'admin'); }
      ahead += f.dur;
    }
    if (w.left <= 0) {
      const prev = w.type;
      const nx = q.shift();
      w.type = nx.type; w.left = nx.dur; w.next = q[0];
      if (w.type === 'storm' || w.type === 'twister') this.onStormStart();
      if (w.type === 'twister') this.spawnTwister();
      if (w.type === 'heat') g.notify('A heatwave has hit the island.', 'warn', null, 'admin');
      if (prev === 'storm' || prev === 'twister') g.notify('The storm has passed.', 'info', null, 'admin');
      if (prev === 'heat') g.notify('The heatwave is over.', 'info', null, 'admin');
      G.audio?.setRain(w.type === 'rain' ? 0.5 : w.type === 'storm' || w.type === 'twister' ? 1 : 0);
    }
    // lightning protection from the Weather Guard research (and the old Weather Station)
    const ws = this.has('weatherguard') || g.hasBuilding('weather') ? 0.5 : 1;
    if (w.type === 'storm' || w.type === 'twister') {
      this.thunderT = (this.thunderT ?? rand(4, 10)) - dt;
      if (this.thunderT <= 0) { // thunder about every 10 s; one clap in five brings lightning
        this.thunderT = rand(7, 13);
        setTimeout(() => G.audio?.play('thunder'), 300 + Math.random() * 900);
        if (chance(0.2)) { G.engine.flash = 1; g.lightningStrike(ws); } else G.engine.flash = 0.35;
      }
      if (chance(dt * 0.05 * ws)) g.stormDamageFence(rand(20, 60) * ws);
    }
    // Heatwaves slowly kill trees; rain makes the jungle spread.
    this._floraT = (this._floraT || 0) - dt;
    if (this._floraT <= 0) {
      this._floraT = 2;
      if (w.type === 'heat') g.weatherFlora(-1);
      else if (w.type === 'rain') g.weatherFlora(1);
    }
    if (this.twister) {
      const t = this.twister;
      t.left -= dt;
      t.ang += rand(-0.6, 0.6) * dt;
      t.x += Math.cos(t.ang) * 1.6 * dt; t.z += Math.sin(t.ang) * 1.6 * dt;
      const c = g.map.W / 2;
      // steer back towards island centre
      const toC = Math.atan2(c - t.z, c - t.x);
      if (Math.hypot(t.x - c, t.z - c) > c * 0.8) t.ang = toC;
      g.twisterDamage(t, dt);
      if (t.left <= 0) this.twister = null;
    }
  }
  rollWeather() {
    // missions can force a weather pattern (e.g. heatwave and storm in turn)
    const cyc = this.g.mission?.weatherCycle || this.weatherCycle;
    if (cyc) { this._cyc = ((this._cyc ?? -1) + 1) % cyc.length; return { type: cyc[this._cyc], dur: 1.2 }; }
    const s = this.storminess;
    const r = Math.random() * (1 + 0.25 * s);
    if (this.mode === 'siteb') return { type: r < 0.6 ? 'clear' : r < 0.85 ? 'cloudy' : 'rain', dur: rand(0.3, 0.8) };
    if (r < 0.42) return { type: 'clear', dur: rand(0.5, 1.2) };
    if (r < 0.5 && this.day > 2) return { type: 'heat', dur: rand(0.5, 1.0) };
    if (r < 0.7) return { type: 'cloudy', dur: rand(0.2, 0.5) };
    if (r < 0.92) return { type: 'rain', dur: rand(0.15, 0.4) };
    if (r < 0.92 + 0.22 * s && (this.day > 3 || s > 1)) return { type: 'storm', dur: rand(0.12, 0.3) };
    if (this.day > 6 && chance(0.4) && !this.noTwister) return { type: 'twister', dur: 0.22 };
    return { type: 'rain', dur: 0.2 };
  }
  onStormStart() {
    const g = this.g;
    g.notify(this.weather.type === 'twister' ? 'A TWISTER is tearing across the island!' : 'A tropical storm has hit the island!', 'danger');
    G.audio?.play('alarm');
    const hasElec = g.map.fenceH.some((t) => t > 0) || g.map.fenceV.some((t) => t > 0);
    if (hasElec && chance(this.has('weatherguard') ? 0.15 : 0.3)) {
      this.blackout = 0.12;
      g.map.blackout = true;
      g.notify('POWER FAILURE! The electric fences are down.', 'danger');
    }
  }
  spawnTwister() {
    const W = this.g.map.W;
    const a = rand(0, Math.PI * 2);
    this.twister = { x: W / 2 + Math.cos(a) * W * 0.42, z: W / 2 + Math.sin(a) * W * 0.42, ang: a + Math.PI + rand(-0.5, 0.5), left: 50 };
  }

  // ---------- research ----------
  // One research project at a time, as in the original (Genetics Labs from older saves add more).
  researchSlots() { return 1 + this.g.countBuildings('research'); }
  canResearch(id) {
    const r = RESEARCH_BY_ID[id];
    if (!r) return { ok: false, why: 'Unknown research' };
    if (this.research.done.has(id) || this.research.active.some((a) => a.id === id)) return { ok: false, why: 'Already researched' };
    if (r.req.some((q) => !this.research.done.has(q))) return { ok: false, why: 'Requires ' + r.req.map((q) => RESEARCH_BY_ID[q].name).join(', ') };
    if (r.ring && this.mode === 'career' && !this.everOpened) return { ok: false, why: 'Available once the park has opened' };
    if (r.built && this.mode === 'career' && !(r.built === 'entrance' ? this.g.entrances().length : this.g.hasBuilding(r.built))) return { ok: false, why: `Build a ${BLD[r.built].name} first` };
    if (r.needCase && !this.stats.cases?.[r.needCase] && this.mode !== 'sandbox') return { ok: false, why: 'Needs a case of the disease to study first' };
    if (this.researchSlots() <= this.research.active.length) return { ok: false, why: 'The lab is busy with other research' };
    if (!this.canAfford(r.cost)) return { ok: false, why: 'Not enough money' };
    return { ok: true };
  }
  startResearch(id) {
    const c = this.canResearch(id);
    if (!c.ok) { this.g.notify(c.why, 'warn'); return false; }
    const r = RESEARCH_BY_ID[id];
    this.spend(r.cost, 'Research');
    this.research.active.push({ id, left: r.days, total: r.days });
    this.g.notify(`Research started: ${r.name}`, 'info');
    return true;
  }
  updateResearch(dd) {
    const slots = this.researchSlots();
    for (let i = 0; i < this.research.active.length; i++) {
      const a = this.research.active[i];
      if (i >= slots) break; // paused if centres demolished
      a.left -= dd;
      if (a.left <= 0) {
        this.research.done.add(a.id);
        this.research.active.splice(i--, 1);
        this.g.notify(`Research complete: ${RESEARCH_BY_ID[a.id].name}`, 'good');
        G.audio?.play('ding');
        G.ui?.refreshBuildMenu?.();
      }
    }
  }

  // ---------- fossil hunt (dig teams) ----------
  // Each hunting ground has three dig spots needing 1, 2 and 3 teams; bigger digs find more.
  freeTeams() { let used = 0; for (const e of this.expeditions) used += e.teams; return this.teams - used; }
  teamCost() { return TEAM_COSTS[this.teams] ?? Infinity; }
  buyTeam() {
    if (this.teams >= MAX_TEAMS) return false;
    if (!this.everOpened && this.mode !== 'sandbox') { this.g.notify('You can hire more dig teams once the park has opened to the public.', 'warn', null, 'paleo'); return false; }
    const c = this.teamCost();
    if (!this.spend(c, 'Expeditions')) { this.g.notify('Not enough money to hire another dig team.', 'warn', null, 'paleo'); return false; }
    this.teams++;
    this.g.notify(`A new dig team has joined the expedition crew (${this.teams} teams).`, 'good', null, 'paleo');
    return true;
  }
  siteUnlocked(site) { return this.mode === 'sandbox' || this.claimed.includes(site.id); }
  siteSlots() { return this.mode === 'sandbox' ? SITES.length : Math.min(5, Math.max(this.cheatSites || 0, 1 + Math.floor(this.rating.stars))); }
  canClaim(site) {
    if (this.siteUnlocked(site)) return { ok: false, why: 'Already acquired' };
    if (!this.claimed.length && !site.starter) return { ok: false, why: 'Your first hunting ground must be one of the starter sites' };
    if (this.claimed.length >= this.siteSlots()) return { ok: false, why: this.claimed.length >= 5 ? 'You can hold at most five hunting grounds' : `Raise your park to ${this.claimed.length} star${this.claimed.length > 1 ? 's' : ''} to acquire another site` };
    return { ok: true };
  }
  claimSite(id) {
    const s = SITE_BY_ID[id], c = this.canClaim(s);
    if (!c.ok) { this.g.notify(c.why, 'warn', null, 'paleo'); return false; }
    this.claimed.push(id);
    this.g.notify(`${s.name} acquired. Send dig teams there to look for fossils.`, 'good', null, 'paleo');
    return true;
  }
  spotQuality(siteId, spot) { return this.siteQuality[siteId][spot]; }
  canDig(siteId, spot = 0) {
    const s = SITE_BY_ID[siteId];
    if (!this.siteUnlocked(s)) return { ok: false, why: 'Acquire this site first' };
    const e = this.expeditions.find((x) => x.site === siteId && x.spot === spot);
    const cap = s.areas?.[spot]?.[1] ?? 2;
    if (e && e.teams >= cap) return { ok: false, why: `This area holds at most ${cap} teams` };
    if (this.freeTeams() < 1) return { ok: false, why: 'No free dig teams' };
    return { ok: true };
  }
  // As in the original, hunting grounds are free: you pay for teams, not digs.
  digCost() { return 0; }
  startDig(siteId, spot = 0) {
    const c = this.canDig(siteId, spot);
    if (!c.ok) { this.g.notify(c.why, 'warn', null, 'paleo'); return false; }
    // another team joins the area (several teams can dig one area, up to its limit)
    const e = this.expeditions.find((x) => x.site === siteId && x.spot === spot);
    if (e) e.teams++;
    else this.expeditions.push({ site: siteId, spot, teams: 1, left: DIG_DAYS, total: DIG_DAYS });
    this.g.notify(`A dig team was sent to ${SITE_BY_ID[siteId].name}${e ? ` (${e.teams} teams there now)` : ''}. Teams keep digging until you move them.`, 'info', null, 'paleo');
    return true;
  }
  // Bring a site's teams home so they can be sent somewhere else. Work in progress is lost.
  // Bring one team home from an area (all of them with all = true).
  recallDig(siteId, spot = 0, all = false) {
    const k = this.expeditions.findIndex((e) => e.site === siteId && e.spot === spot);
    if (k < 0) return false;
    const e = this.expeditions[k];
    const n = all ? e.teams : 1;
    e.teams -= n;
    if (e.teams <= 0) this.expeditions.splice(k, 1);
    this.g.notify(`${n} dig team${n > 1 ? 's' : ''} recalled from ${SITE_BY_ID[siteId].name}.`, 'info', null, 'paleo');
    return true;
  }
  updateExpeditions(dd) {
    // Teams stay at their dig spot and start again after every report, until recalled.
    for (const e of this.expeditions) {
      e.left -= dd;
      if (e.left > 0) continue;
      e.left += e.total;
      e.digs = (e.digs || 0) + 1;
      const before = this.siteQuality[e.site][e.spot || 0];
      e.total = DIG_DAYS; // every dig takes 240 s, as in the original
      this.finishDig(e.site, e.spot || 0, e.teams || 1);
      if (before > 0 && this.siteQuality[e.site][e.spot || 0] === 0) this.g.notify(`The dig spot at ${SITE_BY_ID[e.site].name} is exhausted. Move the team to another site.`, 'warn', null, 'paleo');
    }
    this.updateSequencing(dd);
    this.updateMarket(dd);
  }
  // Item value in dollars, used by the market.
  // Sale value: fossils about $750 and amber about $1,000 as in the original, a little more for rich finds.
  itemValue(it) {
    if (it.kind === 'gem') return GEMS[it.gem];
    if (it.kind === 'amber') return Math.round(800 + it.dna * 20);
    return Math.round(550 + it.dna * 40);
  }
  // Fossil Market asking price: about $3,200 for a medium 1-star fossil up to $10,700 for a 5-star one.
  marketPrice(it) {
    const stars = it.kind === 'amber' ? 3 : SPECIES_BY_ID[it.sp].stars;
    return Math.round((1325 + 1875 * stars) * (0.4 + it.dna / 12) / 10) * 10;
  }
  finishDig(siteId, spot, teams = 1) {
    const s = SITE_BY_ID[siteId];
    const q = this.siteQuality[siteId][spot];
    const failP = [0.75, 0.5, 0.3, 0.18, 0.08, 0.04][q];
    const found = [];
    // each team makes one find attempt, plus a bonus on a rich area
    const tries = teams + (q >= 3 ? 1 : 0);
    const rw = { common: 3, uncommon: 2, rare: 1 };
    for (let k = 0; k < tries; k++) {
      if (chance(failP)) continue;
      if (chance(0.1)) { // amber: species unknown until sequenced
        found.push({ kind: 'amber', sp: pick(SPECIES).id, dna: Math.round(rand(8, 18) * (q + 1) / 5 * 10) / 10 });
        continue;
      }
      let tot = 0; for (const id of s.species) tot += rw[SPECIES_BY_ID[id].rarity];
      let r = Math.random() * tot, spId = s.species[0];
      for (const id of s.species) { r -= rw[SPECIES_BY_ID[id].rarity]; if (r <= 0) { spId = id; break; } }
      const dna = [rand(0.5, 2), rand(1, 4), rand(2, 6), rand(3, 8), rand(6, 14), rand(8, 16)][q] * (this.has('extract') ? 1.4 : 1);
      found.push({ kind: 'fossil', sp: spId, dna: Math.round(dna * 10) / 10 });
    }
    // ores: silver is most common; gold is limited to 90 pieces across all sites, as in the original
    // ores: silver is most common; each site holds a fixed number of gold ores (90 in all)
    this.goldBySite ||= {};
    for (let k = 0; k < teams; k++) if (chance(0.1)) {
      const r = Math.random(), goldLeft = (s.gold ?? 10) - (this.goldBySite[siteId] || 0);
      const gem = r < 0.6 ? 'silver' : r < 0.85 || goldLeft <= 0 ? 'opal' : 'gold';
      if (gem === 'gold') { this.goldBySite[siteId] = (this.goldBySite[siteId] || 0) + 1; this.goldFound = (this.goldFound || 0) + 1; }
      found.push({ kind: 'gem', gem });
    }
    // a fossil of a species whose genome is already complete is sold automatically, as in the original
    let autoSold = 0;
    for (const it of found) {
      it.id = this.nextItem = (this.nextItem || 0) + 1; it.value = this.itemValue(it);
      if (it.kind === 'fossil' && this.dna[it.sp] >= 100) { const p = Math.round(it.value * this.market.mod); this.earn(p, 'Sales'); autoSold += p; it.sold = true; continue; }
      this.fossils.push(it);
    }
    this.stats.finds = (this.stats.finds || 0) + found.length;
    // Spots wear out with use: 18 team-digs from Rich to Good, 15 per stage down to Poor, then 5 more to exhausted.
    const uses = (this.siteUses[siteId][spot] += teams);
    const limit = [0, 5, 15, 15, 15, 18][q];
    if (q > 0 && uses >= limit) { this.siteQuality[siteId][spot] = q - 1; this.siteUses[siteId][spot] = 0; }
    const parts = found.map((f) => f.kind === 'gem' ? `${f.gem}` : f.kind === 'amber' ? 'a piece of amber' : `${SPECIES_BY_ID[f.sp].name} fossil`);
    const text = `${s.name}: ` + (parts.length ? 'found ' + parts.join(', ') + '. ' + (autoSold ? `Fossils of complete genomes were sold for ${fmtMoney(autoSold)}. ` : '') + 'Items are waiting in the Genetics Lab.' : 'the dig found nothing of value.');
    this.digLog.unshift({ day: this.day, date: this.dateText(), text });
    if (this.digLog.length > 30) this.digLog.pop();
    if (found.length) this.g.notify(text, 'good', null, 'paleo');
    G.audio?.play('ding');
    G.ui?.refreshModal?.();
  }

  // ---------- genetics lab: DNA sequencing ----------
  sequencers() { return 1 + this.g.countBuildings('research'); }
  queueSequence(itemId) {
    const it = this.fossils.find((f) => f.id === itemId);
    if (!it || it.kind === 'gem' || this.seqQueue.some((q) => q.id === itemId)) return false;
    const t = 0.4 * (this.has('extract') ? 0.6 : 1); // ~60 s per item, as in the original
    this.seqQueue.push({ id: itemId, left: t, total: t });
    return true;
  }
  updateSequencing(dd) {
    const n = this.sequencers();
    for (let i = 0; i < Math.min(n, this.seqQueue.length); i++) {
      const q = this.seqQueue[i];
      q.left -= dd;
      if (q.left > 0) continue;
      this.seqQueue.splice(i--, 1);
      const k = this.fossils.findIndex((f) => f.id === q.id);
      if (k < 0) continue;
      const it = this.fossils[k];
      this.fossils.splice(k, 1);
      const before = this.dna[it.sp];
      this.dna[it.sp] = Math.min(100, before + it.dna);
      const sp = SPECIES_BY_ID[it.sp];
      this.g.notify(`DNA sequenced from ${it.kind === 'amber' ? 'amber' : 'a fossil'}: ${sp.name} +${(this.dna[it.sp] - before).toFixed(1)}% (now ${this.dna[it.sp].toFixed(1)}%).`, 'good', null, 'genetics');
      if (before < 50 && this.dna[it.sp] >= 50) this.g.notify(`${sp.name} genome passed 50%. It can now be incubated!`, 'good', null, 'genetics');
      G.ui?.refreshModal?.();
    }
  }
  sellItem(itemId) {
    const k = this.fossils.findIndex((f) => f.id === itemId);
    if (k < 0) return false;
    const it = this.fossils[k];
    const price = Math.round(it.value * this.market.mod);
    this.fossils.splice(k, 1);
    this.seqQueue = this.seqQueue.filter((q) => q.id !== itemId);
    this.earn(price, 'Sales');
    this.market.mod = Math.max(0.503, this.market.mod - rand(0.05, 0.1)); // selling depresses the price
    this.g.notify(`Sold ${it.kind === 'gem' ? it.gem : it.kind === 'amber' ? 'amber' : SPECIES_BY_ID[it.sp].name + ' fossil'} for ${fmtMoney(price)}.`, 'good', null, 'paleo');
    return true;
  }

  // ---------- fossil market ----------
  // In Operation Genesis the market opens to buyers 15 weeks (about 3.5 months) after the park first opens.
  marketOpen() { return this.mode !== 'career' || this.cheatMarket || (this.everOpened && this.day >= (this.openedDay ?? this.day) + 7); }
  updateMarket(dd) {
    const m = this.market;
    if (!this.marketOpen()) { m.offers = []; m.next = 0; m.closed = true; return; }
    if (m.closed) { m.closed = false; this.g.notify('The Fossil Market is now open. Buy fossils and amber to raise your DNA.', 'good', null, 'paleo'); }
    m.next -= dd;
    m.drift -= dd;
    if (m.drift <= 0) { m.drift = 1; m.mod = clamp(m.mod + rand(-0.1, 0.15), 0.503, 1.5); }
    if (m.next <= 0) {
      m.next = rand(3, 5);
      const unlocked = SITES.filter((s) => this.siteUnlocked(s));
      m.offers = [];
      for (let i = 0, n = randi(12, 20); i < n; i++) {
        let it;
        if (chance(0.2)) it = { kind: 'amber', sp: pick(SPECIES).id, dna: Math.round(rand(6, 16) * 10) / 10 };
        else { const s = pick(unlocked.length ? unlocked : SITES); it = { kind: 'fossil', sp: pick(s.species), dna: Math.round(rand(2, 12) * 10) / 10 }; }
        it.price = this.marketPrice(it);
        m.offers.push(it);
      }
      if (this.day > 1) this.g.notify('A new shipment has arrived at the Fossil Market.', 'info', null, 'paleo');
    }
  }
  buyOffer(i) {
    const o = this.market.offers[i];
    if (!o) return false;
    if (!this.spend(o.price, 'Expeditions')) { this.g.notify('Not enough money.', 'warn', null, 'finance'); return false; }
    this.market.offers.splice(i, 1);
    const it = { kind: o.kind, sp: o.sp, dna: o.dna, id: this.nextItem = (this.nextItem || 0) + 1 };
    it.value = this.itemValue(it);
    this.fossils.push(it);
    return true;
  }

  // ---------- hatcheries ----------
  incubateCheck(spId, extra = false) {
    const sp = SPECIES_BY_ID[spId];
    if (this.dna[spId] < 50) return { ok: false, why: 'Need at least 50% genome' };
    const hs = this.g.buildingsOf('hatchery').filter((b) => !b.broken && b.slots.length < BLD.hatchery.slots);
    if (!hs.length) return { ok: false, why: this.g.countBuildings('hatchery') ? 'All incubators busy' : 'Build a Hatchery first' };
    if (this.mode !== 'sandbox' && this.g.dinos.filter((d) => !d.dead).length + this.pendingHatch() >= 60) return { ok: false, why: 'The park is limited to 60 dinosaurs' };
    if (!this.canAfford(extra ? sp.cost / 2 : sp.cost)) return { ok: false, why: 'Not enough money' };
    return { ok: true, hatchery: hs[0] };
  }
  pendingHatch() { let n = 0; for (const b of this.g.buildingsOf('hatchery')) n += b.slots.length; return n; }
  // Extra eggs in the same batch cost half price (from the original's data).
  incubate(spId, hatchery, extra = false) {
    const c = this.incubateCheck(spId, extra);
    if (!c.ok) { this.g.notify(c.why, 'warn'); return false; }
    const h = hatchery && hatchery.slots.length < BLD.hatchery.slots ? hatchery : c.hatchery;
    const sp = SPECIES_BY_ID[spId];
    this.spend(extra ? Math.round(sp.cost / 2) : sp.cost, 'Hatchery');
    const days = sp.incubate * (this.has('incub') ? 0.65 : 1) * (this.mode === 'sandbox' ? 0.3 : 1);
    h.slots.push({ sp: spId, genome: this.dna[spId], left: days, total: days, ready: false });
    this.g.notify(`Incubating ${sp.name} at the hatchery.`, 'info');
    G.audio?.play('click');
    return true;
  }
  updateHatcheries(dd) {
    for (const b of this.g.buildingsOf('hatchery')) {
      for (const s of b.slots) {
        if (s.ready) continue;
        s.left -= dd;
        if (s.left <= 0) s.ready = true;
      }
      // A batch hatches together but leaves the gate one animal at a time, as in the original.
      const el = this.elapsed || 0;
      if (el - (b.lastRelease ?? -99) < 8) continue;
      const s = b.slots.find((x) => x.ready && !x.waiting);
      if (!s) continue;
      if (this.g.autoRelease(b, s)) { b.lastRelease = el; continue; }
      s.waiting = true;
      this.g.notify(`A ${SPECIES_BY_ID[s.sp].name} has hatched! Open the Hatchery to release it.`, 'good', { building: b });
      G.audio?.play('ding');
    }
  }

  // ---------- missions ----------
  goalValue(goal) {
    const g = this.g, st = this.stats;
    const alive = g.dinos.filter((d) => !d.dead);
    switch (goal.type) {
      case 'hatched': return st.hatched;
      case 'visitors': return st.peakVisitors * PARTY;
      case 'stars': return this.rating.stars;
      case 'herbSpecies': return new Set(alive.filter((d) => d.sp.diet === 'herb').map((d) => d.sp.id)).size;
      case 'avgComfort': return alive.length >= 3 ? alive.reduce((a, d) => a + d.comfort, 0) / alive.length : 0;
      case 'photoPoints': return st.photoPoints;
      case 'photoSpecies': return st.photoSpecies.size;
      case 'speciesCount': return alive.filter((d) => d.sp.id === goal.species).length;
      case 'containDays': return st.firstHatchDay ? this.day - Math.max(st.lastEscapeDay, st.firstHatchDay) : 0;
      case 'money': return this.money;
      case 'retiredCarn': return st.retiredCarn;
      case 'maxEscapes': return st.escapes;
      case 'minHerb': return alive.filter((d) => d.sp.diet === 'herb').length;
      // action missions
      case 'missionPoints': return goal.carn ? st.carnPoints || 0 : st.missionPoints || 0;
      case 'cruiserAlive': return g.cruiser && g.cruiser.hp <= 0 ? 0 : 1;
      case 'tagLeft': return alive.filter((d) => d.tag === goal.tag).length;
      case 'carnLeft': return alive.filter((d) => d.sp.diet === 'carn').length;
      case 'mustered': return g.musterCount ? g.musterCount(goal.species) : 0;
      case 'photoWhen': return st.photoWhen?.includes(goal.species + ':' + goal.weather) ? 1 : 0;
      case 'photoTag': return st.photoTags?.includes(goal.tag) ? 1 : 0;
      case 'photoOf': return st.photoSpecies.has(goal.species) ? 1 : 0;
      case 'vip': return g.vip ? { waiting: 0, aboard: 1, delivered: 2 }[g.vip.state] : 0;
      case 'vipAlive': return g.vip?.dead ? 0 : 1;
      case 'rifle': return g.rifle ? 1 : 0;
      case 'powerOff': return g.buildingsOf('hatchery').filter((b) => b.power === false).length;
      case 'beaconsLeft': return g.buildingsOf('beacon').length;
      // exercises
      case 'flag': return g.flags.ex?.has(goal.flag) ? 1 : 0;
      case 'finds': return st.finds || 0;
      case 'built': return g.buildingsOf(goal.b).filter((b) => !b.preset).length;
      case 'dna': return this.dna[goal.species] || 0;
      case 'research': return this.research.done.has(goal.id) ? 1 : 0;
      // every fence panel on the island upgraded to at least this tier
      case 'fencesAt': { const m = g.map; let any = 0; for (const arr of [m.fenceH, m.fenceV]) for (let i = 0; i < arr.length; i++) if (arr[i]) { any = 1; if (m.fenceType(arr === m.fenceH, i) < goal.n) return 0; } return any; }
      case 'cleaners': return g.cleaners?.length || 0;
      case 'bias': return g.buildingsOf(goal.b).some((b) => b.menu?.bias === goal.bias) ? 1 : 0;
      case 'rideExp': { const bs = g.buildingsOf(goal.b); return bs.length ? Math.round(Math.max(...bs.map((b) => (b.exp?.[goal.exp] || 0) * 100))) : 0; }
      case 'withinMonths': return Math.floor(this.months || 0);
    }
    return 0;
  }
  goalMet(goal) {
    const v = this.goalValue(goal);
    if (goal.type === 'maxEscapes') return v < goal.n;
    if (goal.type === 'minHerb') return v >= goal.n;
    if (goal.type === 'containDays') return v >= goal.days;
    if (goal.type === 'tagLeft' || goal.type === 'carnLeft' || goal.type === 'beaconsLeft') return v <= goal.n;
    if (goal.type === 'withinMonths') return v < goal.n;
    if (['cruiserAlive', 'vipAlive', 'photoWhen', 'photoTag', 'photoOf', 'rifle', 'flag', 'research', 'bias', 'fencesAt'].includes(goal.type)) return v >= 1;
    return v >= (goal.n ?? 1);
  }
  checkMission() {
    const m = this.mission;
    if (!m || this.missionState.done || this.missionState.failed) return;
    const goals = m.goals.map((goal) => ({ goal, met: this.goalMet(goal), value: this.goalValue(goal) }));
    this.missionState.goals = goals;
    if (goals.some((x) => x.goal.fail && !x.met)) {
      this.missionState.failed = true;
      G.ui?.missionEnd(false);
      return;
    }
    // timed missions fail when the clock runs out
    if (m.timeLimit && (this.g.missionTime ?? 1) <= 0 && !goals.filter((x) => !x.goal.fail && !x.goal.optional).every((x) => x.met)) {
      this.missionState.failed = true;
      G.ui?.missionEnd(false);
      return;
    }
    if (goals.filter((x) => !x.goal.fail && !x.goal.optional).every((x) => x.met)) {
      this.missionState.done = true;
      if (this.mode === 'mission' || this.mode === 'exercise') {
        const p = loadProgress();
        (this.mode === 'mission' ? (p.missions ||= {}) : (p.exercises ||= {}))[m.id] = true;
        if (MISSIONS.every((mm) => p.missions?.[mm.id])) p.siteB = true;
        saveProgress(p);
      }
      G.ui?.missionEnd(true);
    }
  }

  // ---------- serialization ----------
  toJSON() {
    return {
      mode: this.mode, missionId: this.mission?.id || null, money: this.money, name: this.name, dayFrac: this.dayFrac, elapsed: this.elapsed, day: this.day, fee: this.fee, feeV2: true, parkOpen: this.parkOpen, vdist: this.vdist,
      rating: this.rating, dna: this.dna, research: { done: [...this.research.done], active: this.research.active }, teams: this.teams,
      expeditions: this.expeditions, siteQuality: this.siteQuality, siteUses: this.siteUses, claimed: this.claimed, goldFound: this.goldFound, goldBySite: this.goldBySite, debtMeetings: this.debtMeetings || 0, completed: !!this.completed, cheats: { ratingBonus: this.ratingBonus, ratingFloor: this.ratingFloor, noDisease: this.noDisease, noRampage: this.noRampage, noTwister: this.noTwister, noFines: this.noFines, cheatSites: this.cheatSites, cheatMarket: this.cheatMarket }, everOpened: this.everOpened, openedDay: this.openedDay, emergency: this.emergency, lastReview: this.lastReview, digLog: this.digLog, fossils: this.fossils, seqQueue: this.seqQueue, market: this.market, nextItem: this.nextItem, weather: this.weather, storminess: this.storminess,
      blackout: this.blackout, ledger: this.ledger, stats: { ...this.stats, photoSpecies: [...this.stats.photoSpecies], satisfaction: this.stats.satisfaction.slice(-60) },
      missionState: { done: this.missionState.done, failed: this.missionState.failed },
    };
  }
  fromJSON(o) {
    Object.assign(this, {
      money: o.money, name: o.name, dayFrac: o.dayFrac, elapsed: o.elapsed || 0, day: o.day, fee: o.feeV2 ? o.fee : Math.min(5000, Math.round(((o.fee ?? 30) * 8) / 10) * 10), parkOpen: o.parkOpen ?? true, vdist: o.vdist || { violent: 1, nonviolent: 1, environmental: 1, neutral: 3 }, rating: o.rating, dna: o.dna, teams: o.teams,
      expeditions: o.expeditions, siteQuality: o.siteQuality && Array.isArray(Object.values(o.siteQuality)[0]) ? (o.siteUses ? o.siteQuality : Object.fromEntries(Object.entries(o.siteQuality).map(([k, a]) => [k, a.map((q) => (q >= 3 ? 4 : q))]))) : Object.fromEntries(SITES.map((s) => [s.id, [4, 4, 4]])),
      siteUses: o.siteUses || Object.fromEntries(SITES.map((s) => [s.id, [0, 0, 0]])), goldFound: o.goldFound || 0, goldBySite: o.goldBySite || {}, ...(o.cheats || {}), debtMeetings: o.debtMeetings || 0, completed: !!o.completed, everOpened: o.everOpened ?? !!o.parkOpen, openedDay: o.openedDay ?? (o.everOpened || o.parkOpen ? 0 : undefined), emergency: !!o.emergency, lastReview: o.lastReview,
      claimed: o.claimed || SITES.filter((s) => (o.rating?.stars || 0) >= s.stars || o.expeditions?.some((e) => e.site === s.id)).map((s) => s.id), digLog: o.digLog || [], fossils: o.fossils || [], seqQueue: o.seqQueue || [], market: o.market || { offers: [], next: 0.2, drift: 1, mod: 1 }, nextItem: o.nextItem || 0, weather: o.weather, storminess: o.storminess,
      blackout: o.blackout || 0, ledger: o.ledger,
    });
    // research renamed or removed in later versions
    const ren = (id) => (id in RESEARCH_RENAMED ? RESEARCH_RENAMED[id] : id);
    this.research = { done: new Set(o.research.done.map(ren).filter((id) => RESEARCH_BY_ID[id])), active: o.research.active.map((a) => ({ ...a, id: ren(a.id) })).filter((a) => RESEARCH_BY_ID[a.id]) };
    // saves from before Medium fences needed research keep them
    this.research.done.add('fence_med');
    this.stats = { ...this.stats, ...o.stats, photoSpecies: new Set(o.stats.photoSpecies || []) };
    this.missionState = { done: o.missionState?.done, failed: o.missionState?.failed, goals: [] };
    this._lastHour = Math.floor(this.clockHour);
    this.g.map.blackout = this.blackout > 0;
  }
}

export { QUALITY, FENCES };
