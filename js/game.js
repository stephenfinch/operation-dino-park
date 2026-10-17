// Game: owns the world and all simulation systems.
import * as THREE from 'three';
import { G } from './state.js';
import { BLD, FENCES, FLORA, SPECIES_BY_ID, SPECIES, DAY_SECONDS, SIZE_RANK, MISSIONS, EXERCISES, CAREER, WORLD_SCALE, DISEASES, SITES, SITEB_BUILDINGS } from './data.js';
import { GameMap, T, INF, islandSize } from './map.js';
import { WorldView } from './world.js';
import { Park } from './park.js';
import { Dino, resetDinoIds } from './dino.js';
import { VisitorSystem } from './visitors.js';
import { Ranger, Heli, SafariJeep, Balloon } from './staff.js';
import { Ambient } from './ambient.js';
import { ServiceMethods } from './services.js';
import { LivestockMethods, Livestock } from './livestock.js';
import { MissionMethods } from './missions.js';
import { clamp, rand, randi, pick, chance, dist, dist2, encodeArr, decodeArr, fmtMoney } from './util.js';

export const PATH_COST = 50, TRACK_COST = 150, WATER_COST = 20, HILL_COST = 40;
// The original caps safari track at 800 m; a tile is about 4 m.
export const TRACK_MAX = 200;
// The original allows 500 pieces of footpath.
export const PATH_MAX = 500;

export class Game {
  constructor(opts) {
    G.game = this;
    this.opts = opts;
    this.mode = opts.mode;
    this.mission = opts.mission || (opts.mode === 'career' ? CAREER : null);
    this.root = new THREE.Group();
    G.engine.scene.add(this.root);
    // Missions with a pre-built park use a round island so the layout always fits.
    this.genParams = opts.params || this.mission?.params || (this.mission?.preset || this.mission?.setup ? { form: 'round', size: 0.25, mountains: 0.1, rivers: 0 } : undefined);
    this.map = new GameMap(opts.save ? opts.save.map.W || 96 : islandSize(this.genParams));
    this.seed = opts.save ? opts.save.seed : opts.seed ?? this.mission?.seed ?? randi(1, 99999);
    this.buildings = new Map();
    this.nextBid = 1;
    this.bldVersion = 0;
    this.dinos = [];
    this.rangers = [];
    this.helis = [];
    this.vehicles = [];
    this.accessIndex = new Map();
    this.claimed = new Set();
    this.acuQueue = [];
    this.acuAuto = true;
    this.damagedFences = [];
    this.flags = {};
    this.time = 0;
    this.speed = 1;
    this.photos = [];
    this.notes = [];
    this.effects = [];
    this.selected = null;
    this._rs = new Map(); this._rsT = 0;
    this._dfT = 0;
    this._lastHour = -1;
    resetDinoIds(1);

    if (opts.save) {
      this.loadMap(opts.save.map);
    } else {
      this.map.generate(this.seed, { params: this.genParams });
      if (this.mission?.preset) this.clearPresetArea();
    }
    this.park = new Park(this, { mode: this.mode === 'demo' ? 'demo' : this.mode, mission: this.mission, name: opts.name });
    this.initServices();
    this.initLivestock();
    this.initMission();
    this.visitors = new VisitorSystem(this);
    this.view = new WorldView(this.map, this.root);
    G.engine.bounds = { w: this.map.W, h: this.map.H };

    if (opts.save) this.loadState(opts.save);
    else {
      // In Operation Genesis mode the player places the entrance, as in the original.
      if (this.mode !== 'siteb' && this.mode !== 'career') this.placeEntrance();
      if (this.mission?.preset) this.buildPreset(this.mission.preset);
      if (this.mission?.setup) this.setupMission();
      if (this.mode === 'demo' && !opts.preview) this.buildDemo();
      const e = this.map.entrance;
      G.engine.cam.tx = e.x + 1.5; G.engine.cam.tz = e.y - 8; G.engine.cam.tdist = 38; G.engine.cam.tyaw = 0; G.engine.cam.tpitch = 0.85;
      if (this.mode === 'siteb') { G.engine.cam.tz = this.map.H / 2; G.engine.cam.tdist = 60; }
      G.engine.cam.x = G.engine.cam.tx; G.engine.cam.z = G.engine.cam.tz;
    }
    this.map.computeRegions();
    this.afterRegions(true);
    this.view.update();
    this.ambient = new Ambient(this);
  }

  dispose() {
    for (const d of this.dinos) d.dispose();
    G.engine.scene.remove(this.root);
    this.root.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
    this.view.terrainGeo?.dispose();
    this.view.pathMesh?.geometry.dispose();
    for (const e of this.effects) e.pts.geometry.dispose();
    if (G.game === this) G.game = null;
  }

  // ======================= NOTIFICATIONS =======================
  notify(text, kind = 'info', focus, who) {
    if (this.mode === 'demo') return;
    // Collapse bursts of identical messages (e.g. a twister flattening a fence line).
    const now = performance.now();
    this._recent = this._recent || new Map();
    const last = this._recent.get(text);
    this._recent.set(text, now);
    if (last && now - last < 5000) return;
    const n = { text, kind, day: this.park?.day || 1, focus: focus || undefined, who };
    this.notes.unshift(n);
    if (this.notes.length > 120) this.notes.pop();
    G.ui?.toast(n);
  }

  // ======================= BUILDINGS =======================
  footprint(type, cx, cy, rot) {
    const [w, h] = BLD[type].size;
    const fw = rot % 2 ? h : w, fh = rot % 2 ? w : h;
    return { x: cx - Math.floor((fw - 1) / 2), y: cy - Math.floor((fh - 1) / 2), w: fw, h: fh };
  }
  accessTile(fp, rot) {
    const m = this.map;
    let x, y;
    if (rot === 0) { x = fp.x + Math.floor(fp.w / 2); y = fp.y + fp.h; }
    else if (rot === 1) { x = fp.x + fp.w; y = fp.y + Math.floor(fp.h / 2); }
    else if (rot === 2) { x = fp.x + Math.floor(fp.w / 2); y = fp.y - 1; }
    else { x = fp.x - 1; y = fp.y + Math.floor(fp.h / 2); }
    return m.inb(x, y) ? m.idx(x, y) : -1;
  }
  backTile(fp, rot) { return this.accessTile(fp, (rot + 2) % 4); }

  canPlace(type, cx, cy, rot, free, preset) {
    const def = BLD[type], map = this.map, park = this.park;
    const fp = this.footprint(type, cx, cy, rot);
    const res = { ok: false, fp, access: -1, reason: '' };
    if (def.research && !park.has(def.research) && !preset) { res.reason = 'Requires research'; return res; }
    if (this.mode === 'siteb' && !SITEB_BUILDINGS.includes(type)) { res.reason = 'Not allowed on Site B'; return res; }
    if (def.limit && this.buildingsOf(type).length >= def.limit) { res.reason = `You can build at most ${def.limit}`; return res; }
    if (this.mode === 'siteb' && type === 'hatchery' && this.countBuildings('hatchery') >= 8) { res.reason = 'Site B allows 8 hatcheries'; return res; }
    for (let y = fp.y; y < fp.y + fp.h; y++) for (let x = fp.x; x < fp.x + fp.w; x++) {
      if (!map.inb(x, y)) { res.reason = 'Out of bounds'; return res; }
      const i = map.idx(x, y);
      if (!map.isLand(i)) { res.reason = 'Needs dry, flat land'; return res; }
      if (map.bld[i] >= 0) { res.reason = 'Something is in the way'; return res; }
      if (map.path[i]) { res.reason = 'Blocked by a path'; return res; }
      if (x + 1 < fp.x + fp.w) { const e = map.edgeBetween(x, y, x + 1, y); if (map.fenceType(e.h, e.i)) { res.reason = 'A fence is in the way'; return res; } }
      if (y + 1 < fp.y + fp.h) { const e = map.edgeBetween(x, y, x, y + 1); if (map.fenceType(e.h, e.i)) { res.reason = 'A fence is in the way'; return res; } }
    }
    if (type === 'dome_pod') {
      if (map.regionsDirty) { map.computeRegions(); this.afterRegions(false); }
      const r = map.regions[map.region[map.idx(fp.x, fp.y)]];
      if (!r || r.public) { res.reason = 'Place the dome inside an enclosure'; return res; }
    }
    if (def.pathside && !this.touches(fp, (i) => map.path[i] === 1)) { res.reason = 'Place it beside a footpath'; return res; }
    if (def.onFence && !this.touchesFence(fp)) { res.reason = 'Place it against an enclosure fence'; return res; }
    res.access = def.path ? this.accessTile(fp, rot) : -1;
    if (def.path && res.access < 0) { res.reason = 'Entrance faces off the map'; return res; }
    if (def.path && map.bld[res.access] >= 0) { res.reason = 'Entrance is blocked'; return res; }
    if (!free && !park.canAfford(def.cost)) { res.reason = 'Not enough money'; return res; }
    res.ok = true;
    if (def.path && map.path[res.access] !== 1) res.warn = 'Connect a footpath to the entrance';
    // Hatcheries sit in the fence line: the gate at the back opens into the enclosure.
    if (type === 'hatchery' && this.mode !== 'siteb') {
      const bt = this.backTile(fp, rot), r = bt >= 0 ? map.regions[map.region[bt]] : null;
      if (!r || r.public) res.warn = 'Put the back gate against an enclosure fence';
    }
    return res;
  }

  // Does any tile next to the footprint pass the test?
  touches(fp, test) {
    const map = this.map;
    for (let y = fp.y - 1; y <= fp.y + fp.h; y++) for (let x = fp.x - 1; x <= fp.x + fp.w; x++) {
      const edge = (x === fp.x - 1 || x === fp.x + fp.w) !== (y === fp.y - 1 || y === fp.y + fp.h);
      if (edge && map.inb(x, y) && test(map.idx(x, y))) return true;
    }
    return false;
  }
  touchesFence(fp) {
    const map = this.map;
    for (let y = fp.y; y < fp.y + fp.h; y++) for (let x = fp.x; x < fp.x + fp.w; x++)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!map.inb(nx, ny) || (nx >= fp.x && nx < fp.x + fp.w && ny >= fp.y && ny < fp.y + fp.h)) continue;
        const e = map.edgeBetween(x, y, nx, ny);
        if (map.fenceType(e.h, e.i)) return true;
      }
    return false;
  }

  placeBuilding(type, cx, cy, rot, o = {}) {
    const c = o.fp ? { ok: true, fp: o.fp, access: BLD[type].path ? this.accessTile(o.fp, rot) : -1 } : this.canPlace(type, cx, cy, rot, o.free, o.preset);
    if (!c.ok) { if (!o.silent) this.notify(c.reason, 'warn'); return null; }
    const def = BLD[type], map = this.map;
    if (!o.free && !this.park.spend(def.cost, 'Construction')) return null;
    const fp = c.fp;
    const b = {
      id: o.id || this.nextBid++, type, rot, footprint: fp, x: fp.x, y: fp.y, access: c.access,
      cx: fp.x + fp.w / 2, cz: fp.y + fp.h / 2, hp: 100, broken: false, income: 0, visits: 0, queue: [], slots: [],
      stock: def.stock || 0, jeeps: [],
    };
    if (b.id >= this.nextBid) this.nextBid = b.id + 1;
    for (let y = fp.y; y < fp.y + fp.h; y++) for (let x = fp.x; x < fp.x + fp.w; x++) {
      const i = map.idx(x, y);
      map.bld[i] = b.id;
      if (map.flora[i]) { map.flora[i] = 0; map.ver.flora++; }
    }
    map.ver.bld++; map.regionsDirty = true; this.bldVersion++;
    this.buildings.set(b.id, b);
    this.view.addBuilding(b);
    this.spawnStaff(b);
    if (def.fn === 'entrance') { this.updatePublicTiles(); if (!o.silent && this.entrances().length === 1) this.notify('The Park Entrance is built. Lay a path from its gate into your park, then open the park when you are ready.', 'good', { building: b }, 'admin'); }
    if (!o.silent) { G.audio?.play('build'); }
    if (!o.silent && def.fn === 'ranger' && this.buildingsOf('ranger').length === 1) this.notify('The Ranger Station is staffed. Its helicopter can sedate, move, vaccinate and revive dinosaurs, herd them with the muster and winch stranded guests to safety.', 'info', { building: b }, 'warden');
    return b;
  }

  spawnStaff(b) {
    const fn = BLD[b.type].fn;
    // The Ranger Station houses both a ranger crew and the ranger helicopter, as in the original.
    if (fn === 'ranger') { this.rangers.push(new Ranger(this, b)); this.helis.push(new Heli(this, b)); }
    if (fn === 'acu') this.helis.push(new Heli(this, b));
    if (fn === 'cleaner') { b.hired = b.hired ?? 2; this.syncCleaners(b); }
    if (fn === 'safari') { this.computeRoute(b); for (let n = 0; n < 2; n++) { const j = new SafariJeep(this, b, n); b.jeeps.push(j); this.vehicles.push(j); } }
    if (fn === 'balloon') { const bl = new Balloon(this, b); b.jeeps.push(bl); this.vehicles.push(bl); }
  }

  demolish(b, refund = true) {
    const def = BLD[b.type];
    if (def.fixed) { this.notify("The park entrance can't be demolished.", 'warn'); return; }
    if (def.fn === 'entrance' && this.entrances().length <= 1 && this.park.parkOpen) { this.notify('Close the park before you demolish its only entrance.', 'warn'); return; }
    // the two halves of a Viewing Dome go together
    const other = b.link ? this.buildings.get(b.link) : null;
    if (other && b.type !== 'balloon_pole') { b.link = other.link = null; if (other.type === 'dome_pod') this.demolish(other, false); }
    if (def.fn === 'balloon') for (const p of this.balloonPoles(b)) this.demolish(p, true);
    const map = this.map, fp = b.footprint;
    for (let y = fp.y; y < fp.y + fp.h; y++) for (let x = fp.x; x < fp.x + fp.w; x++) map.bld[map.idx(x, y)] = -1;
    map.ver.bld++; map.regionsDirty = true; this.bldVersion++;
    b.removed = true;
    this.buildings.delete(b.id);
    this.view.removeBuilding(b);
    if (def.fn === 'entrance') this.updatePublicTiles();
    if (refund) this.park.earn(Math.round(def.cost * 0.4), 'Sales');
    for (const v of this.visitors.list) if (v.inB === b) { v.plan = 'wander'; v.inB = null; v.steps = 4; if (b.access >= 0) { v.tile = b.access; v.next = -1; } }
    if (b.queue) for (const v of b.queue) { v.plan = 'wander'; v.inB = null; }
    for (const j of b.jeeps) j.update?.(0);
    if (this.selected?.ref === b) this.select(null);
    G.audio?.play('demolish');
  }

  // Where guests in an attraction actually look from (a Viewing Dome's glass dome sits inside the enclosure).
  viewPoint(b) { const pod = b.link ? this.buildings.get(b.link) : null; return pod || b; }
  placeDomePod(door, tx, ty) {
    const pod = this.placeBuilding('dome_pod', tx, ty, 0, { free: true });
    if (!pod) return null;
    door.link = pod.id; pod.link = door.id;
    return pod;
  }
  // Route poles of a Balloon Tour station, in the order they were placed.
  balloonPoles(st) { return this.buildingsOf('balloon_pole').filter((p) => p.link === st.id).sort((a, b) => a.id - b.id); }
  placeBalloonPole(st, tx, ty) {
    const p = this.placeBuilding('balloon_pole', tx, ty, 0);
    if (p) p.link = st.id;
    return p;
  }
  // Every fence panel on the island to one type (0 removes them) – the cheat codes.
  setAllFences(type) {
    const m = this.map;
    for (const h of [true, false]) { const arr = h ? m.fenceH : m.fenceV; for (let i = 0; i < arr.length; i++) if (arr[i]) { if (type) m.setFence(h, i, type); else m.setFenceHp(h, i, 0); } }
    if (!type) this.notify('Every fence on the island has been destroyed!', 'danger');
    m.ver.fence++; m.regionsDirty = true;
  }
  buildingsOf(type) { const out = []; for (const b of this.buildings.values()) if (b.type === type) out.push(b); return out; }
  countBuildings(type) { let n = 0; for (const b of this.buildings.values()) if (b.type === type && !b.broken) n++; return n; }
  hasBuilding(type) { return this.countBuildings(type) > 0; }
  // Park Entrances (more than one is allowed, as in the original). Guests arrive and leave through them.
  entrances() { const out = []; for (const b of this.buildings.values()) if (BLD[b.type].fn === 'entrance' && !b.broken && b.access >= 0) out.push(b); return out; }
  entranceAccess() { return this.entrances()[0]?.access ?? -1; }
  // Where an entrance's tourist helicopter lands: the helipad behind the building.
  entrancePad(b) {
    if (b.type === 'gate') return this.map.helipad;
    const lh = b.rot % 2 ? b.footprint.w : b.footprint.h;
    const th = b.rot * Math.PI / 2, d = lh >= 5 ? 2.3 : lh / 2 + 1.8;
    const x = b.cx - Math.sin(th) * d, z = b.cz - Math.cos(th) * d;
    return { x, z, y: Math.max(0, this.map.heightAt(b.cx, b.cz)) + 0.62 };
  }
  // Mark the areas around entrances as public (guests' side of the fences).
  updatePublicTiles() { this.map.publicTiles = this.entrances().map((b) => b.access); this.map.regionsDirty = true; }
  rebuildAccessIndex() {
    this.accessIndex.clear();
    for (const b of this.buildings.values()) {
      if (b.access < 0) continue;
      if (!this.accessIndex.has(b.access)) this.accessIndex.set(b.access, []);
      this.accessIndex.get(b.access).push(b);
    }
  }
  decoNear(tile) {
    const W = this.map.W, x = tile % W, y = (tile / W) | 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (!this.map.inb(x + dx, y + dy)) continue;
      const id = this.map.bld[this.map.idx(x + dx, y + dy)];
      if (id >= 0) { const b = this.buildings.get(id); if (b && BLD[b.type].fn === 'deco') return b; }
    }
    return null;
  }

  // Builds the Park Entrance at the generator's suggested shore spot (missions and the menu backdrop;
  // in Operation Genesis mode the player places it). Its access tile is the old gate's: (e.x + 1, e.y - 1).
  placeEntrance() {
    const e = this.map.entrance, map = this.map;
    const fp = { x: e.x - 1, y: e.y, w: 5, h: 5 }; // 5×5 as in the original; the helipad fills the back
    for (let y = fp.y; y < fp.y + fp.h; y++) for (let x = fp.x; x < fp.x + fp.w; x++) {
      if (!map.inb(x, y)) continue;
      const i = map.idx(x, y);
      if (!map.isLand(i)) { map.terrain[i] = T.SAND; map.rockH[i] = 0; }
      map.flora[i] = 0; map.path[i] = 0;
    }
    map.computeHeights();
    this.placeBuilding('entrance', 0, 0, 2, { fp, free: true, silent: true });
    const ax = e.x + 1;
    for (let y = e.y - 1; y >= e.y - 6; y--) { const i = map.idx(ax, y); map.path[i] = 1; map.flora[i] = 0; }
    map.ver.path++;
  }

  // ======================= FENCES =======================
  fenceEdgesLine(ax, ay, bx, by) {
    const out = [], map = this.map;
    if (Math.abs(bx - ax) >= Math.abs(by - ay)) {
      const y = ay, x0 = Math.min(ax, bx), x1 = Math.max(ax, bx);
      for (let x = x0; x < x1; x++) if (x >= 0 && x < map.W && y >= 0 && y <= map.H) out.push({ h: true, i: map.hIdx(x, y) });
    } else {
      const x = ax, y0 = Math.min(ay, by), y1 = Math.max(ay, by);
      for (let y = y0; y < y1; y++) if (x >= 0 && x <= map.W && y >= 0 && y < map.H) out.push({ h: false, i: map.vIdx(x, y) });
    }
    return out;
  }
  fenceEdgesRect(ax, ay, bx, by) {
    const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
    if (x0 === x1 || y0 === y1) return this.fenceEdgesLine(ax, ay, bx, by);
    return [...this.fenceEdgesLine(x0, y0, x1, y0), ...this.fenceEdgesLine(x0, y1, x1, y1), ...this.fenceEdgesLine(x0, y0, x0, y1), ...this.fenceEdgesLine(x1, y0, x1, y1)];
  }
  fenceEdgeValid(e) {
    const map = this.map;
    const tiles = map.edgeTiles(e.h, e.i);
    const ins = tiles.filter(([x, y]) => map.inb(x, y));
    if (!ins.length) return false;
    const idx = ins.map(([x, y]) => map.idx(x, y));
    if (idx.length === 2 && map.path[idx[0]] === 1 && map.path[idx[1]] === 1) return false;
    if (idx.length === 2 && map.bld[idx[0]] >= 0 && map.bld[idx[0]] === map.bld[idx[1]]) return false;
    if (idx.every((i) => map.terrain[i] === T.SEA)) return false;
    return true;
  }
  // Upgrading an existing fence costs only the difference, as in the original.
  fenceCost(edges, type) {
    let c = 0, n = 0;
    for (const e of edges) {
      if (!this.fenceEdgeValid(e)) continue;
      const old = this.map.fenceType(e.h, e.i);
      if (old === type) continue;
      c += old && old < type ? FENCES[type].cost - FENCES[old].cost : FENCES[type].cost; n++;
    }
    return { cost: c, n };
  }
  // The fence edge nearest a ground point, if one is built there.
  fenceEdgeAt(wx, wz) {
    const map = this.map, W = map.W;
    const hy = Math.round(wz), hx = Math.floor(wx), vx = Math.round(wx), vy = Math.floor(wz);
    const cands = [];
    if (hx >= 0 && hx < W && hy >= 0 && hy <= map.H) cands.push({ h: true, i: map.hIdx(hx, hy), d: Math.abs(wz - hy) });
    if (vx >= 0 && vx <= W && vy >= 0 && vy < map.H) cands.push({ h: false, i: map.vIdx(vx, vy), d: Math.abs(wx - vx) });
    const hit = cands.filter((c) => c.d < 0.35 && map.fenceType(c.h, c.i)).sort((a, b) => a.d - b.d)[0];
    return hit || null;
  }
  // Every fence edge joined to this one (through shared posts) with the same fence type.
  fenceRun(h, i) {
    const map = this.map, W = map.W, H = map.H, type = map.fenceType(h, i);
    const key = (e) => (e.h ? 'h' : 'v') + e.i, seen = new Set([key({ h, i })]), out = [{ h, i }];
    const posts = (e) => { if (e.h) { const y = Math.floor(e.i / W), x = e.i % W; return [[x, y], [x + 1, y]]; } const y = Math.floor(e.i / (W + 1)), x = e.i % (W + 1); return [[x, y], [x, y + 1]]; };
    for (let k = 0; k < out.length; k++) for (const [px, py] of posts(out[k])) {
      const near = [];
      if (px - 1 >= 0 && py <= H) near.push({ h: true, i: map.hIdx(px - 1, py) });
      if (px < W && py <= H) near.push({ h: true, i: map.hIdx(px, py) });
      if (py - 1 >= 0 && px <= W) near.push({ h: false, i: map.vIdx(px, py - 1) });
      if (py < H && px <= W) near.push({ h: false, i: map.vIdx(px, py) });
      for (const e of near) if (!seen.has(key(e)) && map.fenceType(e.h, e.i) === type) { seen.add(key(e)); out.push(e); }
    }
    return out;
  }
  upgradeFenceRun(h, i, type) {
    const old = this.map.fenceType(h, i);
    if (!old || old >= type) return 0;
    return this.placeFences(this.fenceRun(h, i), type);
  }
  placeFences(edges, type) {
    if (this.mode === 'siteb') { this.notify('No fences on Site B – the dinosaurs roam free.', 'warn'); return 0; }
    const f = FENCES[type];
    if (f.research && !this.park.has(f.research)) { this.notify(`${f.name} requires research.`, 'warn'); return 0; }
    const { cost, n } = this.fenceCost(edges, type);
    if (!n) return 0;
    if (!this.park.spend(cost, 'Construction')) { this.notify('Not enough money.', 'warn'); return 0; }
    for (const e of edges) if (this.fenceEdgeValid(e) && this.map.fenceType(e.h, e.i) !== type) this.map.setFence(e.h, e.i, type);
    G.audio?.play('build');
    return n;
  }
  removeFence(e, refund = true) {
    const t = this.map.fenceType(e.h, e.i);
    if (!t) return;
    if (refund) this.park.earn(Math.round(FENCES[t].cost * 0.25), 'Sales');
    this.map.setFence(e.h, e.i, 0);
  }
  breakFence(h, i, dino) {
    const map = this.map;
    map.setFenceHp(h, i, 0);
    map.ver.fence++; map.regionsDirty = true;
    const c = map.edgeCenter(h, i);
    this.notify(dino ? `${dino.sp.name} "${dino.name}" broke through a fence!` : 'A fence has been destroyed!', 'danger', { x: c.x, z: c.z });
    G.audio?.playAt('crash', c.x, c.z, 1);
    this.burst(c.x, 0.5, c.z, 0x9a8a70, 30);
  }

  // ======================= PATHS & TERRAIN =======================
  pathTilesL(ax, ay, bx, by) {
    const out = [];
    const sx = Math.sign(bx - ax) || 1, sy = Math.sign(by - ay) || 1;
    for (let x = ax; x !== bx + sx; x += sx) out.push([x, ay]);
    for (let y = ay + sy; y !== by + sy; y += sy) out.push([bx, y]);
    return out.filter(([x, y]) => this.map.inb(x, y));
  }
  canPathTile(i, kind) {
    const map = this.map;
    if (!map.isLand(i) || map.bld[i] >= 0) return false;
    if (this.mode === 'siteb') return false;
    if (kind === 2 && !this.park.has('safari')) return false;
    return map.path[i] !== kind;
  }
  placePaths(tiles, kind) {
    const map = this.map;
    let ok = tiles.map(([x, y]) => map.idx(x, y)).filter((i) => this.canPathTile(i, kind));
    if (kind === 1 && this.mode === 'career') {
      const room = PATH_MAX - this.pathTiles();
      if (ok.length > room) { ok = ok.slice(0, Math.max(0, room)); this.notify(`You can build at most ${PATH_MAX} pieces of path.`, 'warn'); }
    }
    if (kind === 2) {
      const room = TRACK_MAX - this.trackTiles();
      if (ok.length > room) { ok = ok.slice(0, Math.max(0, room)); this.notify(`Safari track is limited to ${TRACK_MAX * 4} m.`, 'warn'); }
    }
    if (!ok.length) return 0;
    const cost = ok.length * (kind === 2 ? TRACK_COST : PATH_COST);
    if (!this.park.spend(cost, 'Construction')) { this.notify('Not enough money.', 'warn'); return 0; }
    for (const i of ok) { map.path[i] = kind; if (map.flora[i]) { map.flora[i] = 0; map.ver.flora++; } }
    map.ver.path++; map.regionsDirty = true;
    if (kind === 2) for (const b of this.buildingsOf('safari')) this.computeRoute(b);
    G.audio?.play('path');
    return ok.length;
  }
  pathTiles() { let n = 0; const p = this.map.path; for (let i = 0; i < p.length; i++) if (p[i] === 1) n++; return n; }
  trackTiles() { let n = 0; const p = this.map.path; for (let i = 0; i < p.length; i++) if (p[i] === 2) n++; return n; }
  removePath(i) {
    const map = this.map;
    if (!map.path[i]) return false;
    if (this.entrances().some((b) => b.access === i)) return false;
    const k = map.path[i];
    map.path[i] = 0; map.ver.path++; map.regionsDirty = true;
    // guests left standing off the paths are stranded until the ranger helicopter fetches them
    if (k === 1) for (const v of this.visitors.list) if (!v.gone && v.tile === i && !['inside', 'ride', 'queue', 'stranded'].includes(v.plan) && !this.visitors.neighbors(i, true).length) { v.plan = 'stranded'; v.strandT = 0; v.moving = false; this.visitors.think(v, 'Where did the path go?', true); }
    if (k === 2) for (const b of this.buildingsOf('safari')) this.computeRoute(b);
    return true;
  }
  setFlora(i, f, silent) {
    const map = this.map;
    if (map.flora[i] === f) return false;
    if (f && (!map.isLand(i) && map.terrain[i] !== T.SAND) || (f && (map.bld[i] >= 0 || map.path[i]))) return false;
    map.flora[i] = f; map.ver.flora++; map.regionsDirty = true;
    return true;
  }
  paintTerrain(tiles, t) {
    const map = this.map;
    let n = 0;
    for (const i of tiles) {
      const cur = map.terrain[i];
      if (cur === T.SEA || cur === T.ROCK || cur === t) continue;
      if (map.bld[i] >= 0 || map.path[i]) continue;
      if (t === T.WATER) { const x = i % map.W, y = (i / map.W) | 0; if (x < 3 || y < 3 || x > map.W - 4 || y > map.H - 4) continue; }
      n++;
    }
    if (!n) return 0;
    const cost = n * WATER_COST;
    if (!this.park.spend(cost, 'Construction')) { this.notify('Not enough money.', 'warn'); return 0; }
    for (const i of tiles) {
      const cur = map.terrain[i];
      if (cur === T.SEA || cur === T.ROCK || cur === t || map.bld[i] >= 0 || map.path[i]) continue;
      map.terrain[i] = t;
      if (t === T.WATER && map.flora[i]) { map.flora[i] = 0; map.ver.flora++; }
    }
    map.computeHeights();
    map.regionsDirty = true;
    return n;
  }

  // Raise or lower hills (the original's Mountain tool). Hills block dinosaurs and buildings.
  sculpt(tiles, mode) {
    const map = this.map, ok = [];
    for (const i of tiles) {
      const t = map.terrain[i];
      if (t === T.SEA || t === T.WATER || map.bld[i] >= 0 || map.path[i]) continue;
      if (mode === 'lower' && t !== T.ROCK) continue;
      if (mode === 'raise' && t === T.ROCK && map.rockH[i] >= 10) continue;
      ok.push(i);
    }
    if (!ok.length) return 0;
    if (!this.park.spend(ok.length * HILL_COST, 'Construction')) { this.notify('Not enough money.', 'warn'); return 0; }
    let flora = false;
    for (const i of ok) {
      if (mode === 'raise') {
        if (map.terrain[i] !== T.ROCK) { map.terrain[i] = T.ROCK; map.rockH[i] = 1.0; }
        else map.rockH[i] = Math.min(10, map.rockH[i] + 0.9);
        if (map.flora[i] && map.flora[i] !== 6 && map.rockH[i] > 2.5) { map.flora[i] = 0; flora = true; }
      } else {
        map.rockH[i] -= 0.9;
        if (map.rockH[i] < 0.9) { map.terrain[i] = T.GRASS; map.rockH[i] = 0; }
      }
    }
    if (flora) map.ver.flora++;
    map.computeHeights();
    map.regionsDirty = true;
    return ok.length;
  }

  // ======================= SAFARI ROUTES =======================
  computeRoute(b) {
    const map = this.map, fp = b.footprint, W = map.W;
    let start = -1, bestN = 9;
    const trackN = (i) => { const x = i % W, y = (i / W) | 0; let n = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (map.inb(x + dx, y + dy) && map.path[map.idx(x + dx, y + dy)] === 2) n++; return n; };
    for (let y = fp.y - 1; y <= fp.y + fp.h; y++) for (let x = fp.x - 1; x <= fp.x + fp.w; x++) {
      if (!map.inb(x, y)) continue;
      const inside = x >= fp.x && x < fp.x + fp.w && y >= fp.y && y < fp.y + fp.h;
      const corner = (x === fp.x - 1 || x === fp.x + fp.w) && (y === fp.y - 1 || y === fp.y + fp.h);
      if (inside || corner) continue;
      const i = map.idx(x, y);
      if (map.path[i] !== 2) continue;
      const n = trackN(i);
      if (n < bestN) { bestN = n; start = i; }
    }
    if (start < 0) { b.route = null; b.routeLen = 0; return; }
    const seq = [start], seen = new Set([start]);
    let cur = start, dir = null;
    for (let guard = 0; guard < 4000; guard++) {
      const x = cur % W, y = (cur / W) | 0;
      const nb = [];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!map.inb(nx, ny)) continue;
        const ni = map.idx(nx, ny);
        if (map.path[ni] === 2 && !seen.has(ni)) nb.push({ ni, dx, dy });
      }
      if (!nb.length) break;
      const straight = dir && nb.find((n) => n.dx === dir[0] && n.dy === dir[1]);
      const nx = straight || nb[0];
      dir = [nx.dx, nx.dy];
      cur = nx.ni; seq.push(cur); seen.add(cur);
    }
    // loop back: find earliest visited neighbour of last tile
    const last = seq[seq.length - 1], lx = last % W, ly = (last / W) | 0;
    let k = -1;
    for (let j = 0; j < seq.length - 2; j++) { const s = seq[j]; const sx = s % W, sy = (s / W) | 0; if (Math.abs(sx - lx) + Math.abs(sy - ly) === 1) { k = j; break; } }
    let full = k >= 0 ? seq.concat(seq.slice(0, k + 1).reverse()) : seq.concat(seq.slice(0, -1).reverse());
    const route = full.map((i) => ({ x: (i % W) + 0.5, z: Math.floor(i / W) + 0.5 }));
    const cum = [0];
    for (let j = 1; j < route.length; j++) cum.push(cum[j - 1] + dist(route[j - 1].x, route[j - 1].z, route[j].x, route[j].z));
    b.route = route; b.routeCum = cum; b.routeLen = cum[cum.length - 1];
  }

  // ======================= DINOSAURS =======================
  spawnDino(spId, x, z, o = {}) {
    const d = new Dino(this, spId, x, z, o);
    this.dinos.push(d);
    this.map.regionsDirty = true;
    return d;
  }
  removeDino(d) {
    d.dispose();
    const i = this.dinos.indexOf(d);
    if (i >= 0) this.dinos.splice(i, 1);
    if (this.selected?.ref === d) this.select(null);
    for (const t of this.acuQueue) if (t.dino === d) t.dead = true;
  }
  nearestDino(self, pred, r) {
    let best = null, bd = r * r;
    for (const d of this.dinos) {
      if (d === self || !pred(d)) continue;
      const dd = dist2(d.x, d.z, self.x, self.z);
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  }
  regionStats(rid) {
    return this._rs.get(rid) || { species: {}, space: 1, carnMax: 0, bigCarnSpecies: 0 };
  }
  computeRegionStats() {
    this._rs.clear();
    const map = this.map;
    const bigSets = new Map();
    for (const d of this.dinos) {
      if (d.dead || d.carried) continue;
      const tx = Math.floor(d.x), ty = Math.floor(d.z);
      if (!map.inb(tx, ty)) continue;
      const rid = map.region[map.idx(tx, ty)];
      if (rid < 0) continue;
      let s = this._rs.get(rid);
      if (!s) { s = { species: {}, space: 0, carnMax: 0, bigCarnSpecies: 0, count: 0 }; this._rs.set(rid, s); bigSets.set(rid, new Set()); }
      s.species[d.sp.id] = (s.species[d.sp.id] || 0) + 1;
      s.space += d.sp.space * (0.4 + 0.6 * d.growth);
      s.count++;
      if (d.sp.diet === 'carn') { s.carnMax = Math.max(s.carnMax, SIZE_RANK[d.sp.size]); if (SIZE_RANK[d.sp.size] >= 3) bigSets.get(rid).add(d.sp.id); }
    }
    for (const [rid, set] of bigSets) this._rs.get(rid).bigCarnSpecies = set.size;
    for (const [rid, s] of this._rs) {
      s.auth = this.enclosureAuth(s.species);
      // the strongest fence around the enclosure (guests on a path see less through Medium and High fences)
      let tier = 0; const r = map.regions[rid];
      if (r) for (let k = 0; k < r.fenceEdges.length && tier < 3; k += Math.max(1, (r.fenceEdges.length / 24) | 0)) tier = Math.max(tier, map.fenceType(r.fenceEdges[k].h, r.fenceEdges[k].i));
      s.fenceTier = tier;
    }
  }
  // How authentic an enclosure's mix is (0..1), as Dino Nerds judge it: animals from one era and one dig site,
  // and herbivores kept with their friend species.
  enclosureAuth(species) {
    const ids = Object.keys(species);
    if (!ids.length) return 0.5;
    let total = 0;
    const era = {};
    for (const id of ids) { const n = species[id]; total += n; era[SPECIES_BY_ID[id].era] = (era[SPECIES_BY_ID[id].era] || 0) + n; }
    const eraFrac = Math.max(...Object.values(era)) / total;
    let site = 0, friend = 0, herbs = 0;
    for (const id of ids) {
      const sp = SPECIES_BY_ID[id];
      const mates = SITES.filter((st) => st.species.includes(id)).flatMap((st) => st.species);
      if (ids.length === 1 || ids.some((o) => o !== id && mates.includes(o))) site += species[id];
      if (sp.diet === 'herb') { herbs += species[id]; if (sp.friend && (sp.friend === id ? species[id] > 1 : species[sp.friend])) friend += species[id]; }
    }
    return clamp(0.45 * eraFrac + 0.3 * (site / total) + 0.25 * (herbs ? friend / herbs : 0.6), 0, 1);
  }
  regionFeeders(rid, kind) { return (this.feedersByRegion.get(rid) || []).filter((b) => BLD[b.type].food === kind && !b.removed); }
  feederApproach(b, rid, dino) {
    const map = this.map, fp = b.footprint;
    let best = null, bd = 1e9;
    for (let y = fp.y - 1; y <= fp.y + fp.h; y++) for (let x = fp.x - 1; x <= fp.x + fp.w; x++) {
      if (!map.inb(x, y)) continue;
      const i = map.idx(x, y);
      if (map.region[i] !== rid) continue;
      const px = x + 0.5 + (x < fp.x ? 0.25 : x >= fp.x + fp.w ? -0.25 : 0), pz = y + 0.5 + (y < fp.y ? 0.25 : y >= fp.y + fp.h ? -0.25 : 0);
      const d = dist2(px, pz, dino.x, dino.z);
      if (d < bd) { bd = d; best = { x: px, z: pz }; }
    }
    return best;
  }
  regionTreeTiles(r) {
    if (!r._trees) { r._trees = r.tiles.filter((i) => this.map.flora[i] >= 1 && this.map.flora[i] <= 3); }
    return r._trees;
  }
  escapedNear(x, z, r) {
    for (const d of this.dinos) {
      if (!d.escaped || d.dead || d.tranq > 0 || d.carried) continue;
      if (dist2(d.x, d.z, x, z) < r * r) return d;
    }
    return null;
  }
  // Avoidance beacons emit for 20 s, then recharge for 20 s (staggered per beacon).
  beaconOn(b) { return !b.broken && ((this.park.elapsed || 0) + b.id * 7) % 40 < 20; }
  beaconNear(x, z) {
    for (const b of this.buildings.values()) {
      if (b.type !== 'beacon' || !this.beaconOn(b)) continue;
      const R = BLD.beacon.repel;
      if (dist2(b.cx, b.cz, x, z) < R * R) return b;
    }
    return null;
  }
  // Dino experience (thrills, fun, authenticity) of what a ride can see from here, blended into the
  // station's running score, as the original's Entertainment report shows for Balloon and Safari tours.
  rideExperience(b, x, z, R) {
    let thr = 0, fun = 0, aut = 0, na = 0;
    for (const d of this.dinos) {
      if (d.dead || d.carried || dist2(d.x, d.z, x, z) > R * R) continue;
      const action = ['hunt', 'fight', 'defend', 'hunt_visitor', 'joust', 'rear'].includes(d.state);
      if (d.sp.diet === 'carn') thr += d.sp.value * (action || d.state === 'feeding' ? 2 : 0.4);
      else { fun += d.sp.value * (d.comfort / 100) * (d.state === 'play' ? 2 : 1); if (action) thr += d.sp.value; }
      aut += this.regionStats(this.map.regionAt(d.x, d.z)?.id ?? -1).auth ?? 0.5; na++;
    }
    if (!na) return;
    const e = (b.exp ||= { thr: 0, fun: 0, aut: 0 }), k = 0.08;
    e.thr += (Math.min(1, thr / 20) - e.thr) * k; e.fun += (Math.min(1, fun / 20) - e.fun) * k; e.aut += (aut / na - e.aut) * k;
  }
  // Is this spot covered by a security camera, or seen by guests or staff?
  watched(d, cameraOnly, rampage) {
    for (const b of this.buildings.values()) {
      if (b.type !== 'camera' || b.broken || (rampage && !b.menu?.rampage)) continue;
      if (dist2(b.cx, b.cz, d.x, d.z) < BLD.camera.view ** 2) return 'camera';
    }
    if (cameraOnly) return null;
    if (this.visitors.nearest(d.x, d.z, 8)) return 'guests';
    if ([...this.rangers, ...this.helis].some((s) => dist2(s.x, s.z, d.x, d.z) < 144)) return 'staff';
    return null;
  }
  alarmEscape(d, late) {
    d.unseen = false;
    this.notify(late ? `${d.sp.name} "${d.name}" has been spotted outside its enclosure!` : `${d.sp.name} "${d.name}" has ESCAPED!`, 'danger', { dino: d });
    G.audio?.play('alarm');
    if (!this.helis.length) this.notify('Build a Ranger Station: its helicopter recaptures escaped dinosaurs.', 'warn');
    if (!this.hasBuilding('camera') && this.park.has('camera') && !this.flags.camTip) { this.flags.camTip = true; this.notify('Security cameras warn you the moment a dinosaur breaks out.', 'info'); }
  }
  // A badly damaged Visitor Shelter stays shut until rangers repair it.
  shutCheck(b) {
    if (b.type !== 'shelter' || b.shut || b.hp >= 50) return;
    b.shut = true; this.bldVersion++;
    if (b.hp > 0) this.notify('A Visitor Shelter is badly damaged and has shut its doors.', 'warn', { building: b }, 'admin');
  }
  cameraNear(x, z) {
    for (const b of this.buildings.values()) {
      if (b.type !== 'camera' || b.broken) continue;
      const R = BLD.camera.safety;
      if (dist2(b.cx, b.cz, x, z) < R * R) return b;
    }
    return null;
  }
  excite(x, z, amt) { this.visitors.excite(x, z, amt); }

  safeDrop(x, z, dino) {
    const map = this.map;
    const tx = Math.floor(x), ty = Math.floor(z);
    for (let r = 0; r < 8; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = tx + dx, ny = ty + dy;
        if (!map.inb(nx, ny)) continue;
        const i = map.idx(nx, ny);
        if (map.dinoPassable(i) && map.terrain[i] !== T.WATER) return { x: nx + 0.5, z: ny + 0.5 };
      }
    }
    return null;
  }

  afterRegions(initial) {
    const map = this.map;
    // feeders per region
    this.feedersByRegion = new Map();
    for (const b of this.buildings.values()) {
      if (BLD[b.type].fn !== 'feeder' || b.broken) continue;
      const fp = b.footprint, rids = new Set();
      for (let y = fp.y - 1; y <= fp.y + fp.h; y++) for (let x = fp.x - 1; x <= fp.x + fp.w; x++) {
        if (!map.inb(x, y)) continue;
        const r = map.region[map.idx(x, y)];
        if (r >= 0) rids.add(r);
      }
      for (const r of rids) { if (!this.feedersByRegion.has(r)) this.feedersByRegion.set(r, []); this.feedersByRegion.get(r).push(b); }
    }
    // no escapes on Site B, in the menu backdrop or in action missions (their dinosaurs roam free)
    if (this.mode === 'siteb' || this.mode === 'demo' || this.mode === 'mission') { for (const d of this.dinos) d.escaped = false; return; }
    for (const d of this.dinos) {
      if (d.dead || d.carried) continue;
      const r = d.region();
      const pub = r ? r.public : false;
      if (pub && !d.escaped) {
        d.escaped = true;
        if (!initial) {
          const p = this.park;
          p.stats.escapes++; p.stats.lastEscapeDay = p.day;
          p.safetyHit(SIZE_RANK[d.sp.size] * 4 + (d.sp.diet === 'carn' ? 10 : 0));
          // As in the original, security cameras (or guests and staff nearby) are what raise the alarm.
          if (this.watched(d)) this.alarmEscape(d); else d.unseen = true;
        }
      } else if (!pub && d.escaped) {
        d.escaped = false;
      }
    }
  }
  markRegionsDirty() { this.map.regionsDirty = true; }

  // Hatchery release
  autoRelease(b, slot) {
    const tile = this.backTile(b.footprint, b.rot);
    if (tile < 0) return false;
    const map = this.map;
    if (!map.dinoPassable(tile)) return false;
    const r = map.regions[map.region[tile]];
    if (!r || (r.public && this.mode !== 'siteb')) return false;
    this.releaseSlot(b, slot, (tile % map.W) + 0.5, Math.floor(tile / map.W) + 0.5);
    return true;
  }
  releaseSlot(b, slot, x, z) {
    const i = b.slots.indexOf(slot);
    if (i < 0) return null;
    b.slots.splice(i, 1);
    const d = this.spawnDino(slot.sp, x, z, { genome: slot.genome, age: 0 });
    d.nursery = { x, z, until: 4 }; // stays near the hatchery for about two months
    // the hatchery crane lowers a first meal: a live cow (a goat for small carnivores) or a bale of hay
    if (d.sp.diet === 'carn' && this.mode !== 'mission') { const a = new Livestock(this, d.sp.cat === 'SC' ? 'goat' : 'cow', x + rand(-1.5, 1.5), z + rand(-1.5, 1.5)); this.livestock.push(a); }
    else d.hunger = 100;
    this.park.stats.hatched++;
    if (!this.park.stats.firstHatchDay) this.park.stats.firstHatchDay = this.park.day;
    this.notify(`${d.sp.name} "${d.name}" released into the park.`, 'good', { dino: d });
    // Hatchery Immunization: newborns get every vaccine the park has.
    if (this.park.has('immunize')) for (const [id, ds] of Object.entries(DISEASES)) if (this.park.has(ds.vaccine)) d.vaccinate(id, true);
    // The first of each species gets a public-address announcement, as in the original.
    const ann = (this.park.stats.announced ||= []);
    if (!ann.includes(d.sp.id) && this.mode !== 'siteb' && this.mode !== 'demo') {
      ann.push(d.sp.id);
      const sp = d.sp, star = '★'.repeat(sp.stars);
      this.notify(`Attention, guests! Our newest ${star} attraction, ${/^[AEIOU]/.test(sp.name) ? 'an' : 'a'} ${sp.name}, is now on display. ${sp.blurb || ''}`, 'good', { dino: d }, 'pr');
    }
    this.burst(x, 0.4, z, 0xf0e0c0, 25);
    G.audio?.playAt('roar', x, z, 0.5, { size: 1 });
    return d;
  }

  // ======================= ACU =======================
  acuTask(type, dino, dest) {
    if (!this.helis.length) { this.notify('You need a Ranger Station for that.', 'warn'); return false; }
    if (this.acuQueue.some((t) => t.dino === dino && !t.dead) || this.claimed.has('a' + dino.id)) {
      // replace queued task
      this.acuQueue = this.acuQueue.filter((t) => t.dino !== dino);
    }
    this.acuQueue.push({ type, dino, dest, manual: true });
    this.notify(`ACU dispatched: ${type} ${dino.sp.name} "${dino.name}".`, 'info', { dino });
    return true;
  }
  nextAcuTask(grounded) {
    // stranded guests (from a balloon crash) come first, even in a storm
    if (!this.claimed.has('rescue')) {
      const vs = this.visitors.list.filter((v) => !v.gone && v.plan === 'stranded');
      if (vs.length) {
        const first = vs[0], group = vs.filter((v) => dist2(v.x, v.z, first.x, first.z) < 9);
        this.claimed.add('rescue'); return { type: 'rescue', vs: group };
      }
    }
    if (grounded) return null;
    while (this.acuQueue.length) {
      const t = this.acuQueue.shift();
      if (t.dead || t.dino.removed) continue;
      if (this.claimed.has('a' + t.dino.id)) continue;
      this.claimed.add('a' + t.dino.id);
      return t;
    }
    if (!this.acuAuto) return null;
    for (const d of this.dinos) {
      if (this.claimed.has('a' + d.id) || d.carried) continue;
      if (d.escaped && !d.dead && !d.unseen) {
        // Only return animals whose home pen is currently secure; otherwise they'd just walk out again.
        const hr = this.map.regionAt(d.home.x, d.home.z);
        if (!hr || hr.public) {
          if (!d.noHomeWarned) { d.noHomeWarned = true; this.notify(`ACU can't return ${d.sp.name} "${d.name}": its home pen is open. Repair the fence or use Move.`, 'warn', { dino: d }); }
          continue;
        }
        d.noHomeWarned = false;
        this.claimed.add('a' + d.id); return { type: 'recapture', dino: d };
      }
      if (d.dead && d.deadT > 0.15) { this.claimed.add('a' + d.id); return { type: 'carcass', dino: d }; }
    }
    return null;
  }
  acuDone(t) { if (t.type === 'rescue') this.claimed.delete('rescue'); if (t.dino) this.claimed.delete('a' + t.dino.id); }

  // ======================= DISASTERS =======================
  randomFenceEdge() {
    const map = this.map;
    for (let k = 0; k < 60; k++) {
      const h = chance(0.5);
      const i = h ? randi(0, map.fenceH.length - 1) : randi(0, map.fenceV.length - 1);
      if (map.fenceIntact(h, i)) return { h, i };
    }
    // fallback: scan damaged list for any fence
    return null;
  }
  stormDamageFence(dmg) {
    // sample many tiles to find a fence quickly
    const map = this.map;
    for (let k = 0; k < 400; k++) {
      const x = randi(0, map.W - 1), y = randi(0, map.H - 1);
      const h = chance(0.5);
      const i = h ? map.hIdx(x, y) : map.vIdx(x, y);
      if (!map.fenceIntact(h, i)) continue;
      const hp = map.fenceHp(h, i) - dmg;
      if (hp <= 0) this.breakFence(h, i, null); else map.setFenceHp(h, i, hp);
      return;
    }
  }
  // A bolt hits a dinosaur (20%), a structure (15%) or a fence (15%) for heavy damage; otherwise open ground.
  lightningStrike(ws = 1) {
    const map = this.map;
    // a balloon caught aloft in the storm is the likeliest target
    const bl = this.vehicles.find((v) => v.kind === 'balloon' && v.state !== 'wait' && v.state !== 'crashed' && v.y > 3);
    if (bl && chance(0.35 * ws)) { bl.crash(); return; }
    const r = Math.random();
    if (r < 0.2) {
      const live = this.dinos.filter((d) => !d.dead && !d.carried);
      const d = live.length ? pick(live) : null;
      if (d) { this.burst(d.x, 1.5, d.z, 0xfff0a0, 30); d.takeHit(200 * ws, null, 'lightning'); if (!d.dead) this.notify(`Lightning struck ${d.sp.name} "${d.name}"!`, 'warn', { dino: d }, 'vet'); return; }
    }
    if (r < 0.35) {
      const bs = [...this.buildings.values()].filter((b) => !BLD[b.type].fixed && !b.broken);
      const b = bs.length ? pick(bs) : null;
      if (b) {
        this.burst(b.cx, 1.5, b.cz, 0xfff0a0, 30);
        b.hp -= 60 * ws * 1000 / (BLD[b.type].health || 1000);
        this.shutCheck(b);
        if (b.hp <= 0) { b.broken = true; b.hp = 0; this.bldVersion++; this.notify(`Lightning knocked out the ${BLD[b.type].name}!`, 'warn', { building: b }, 'admin'); }
        return;
      }
    }
    if (r < 0.5) {
      const e = this.randomFenceEdge();
      if (e) { const c = map.edgeCenter(e.h, e.i); this.burst(c.x, 1, c.z, 0xfff0a0, 30); const hp = map.fenceHp(e.h, e.i) - 200 * ws; if (hp <= 0) this.breakFence(e.h, e.i, null); else map.setFenceHp(e.h, e.i, hp); return; }
    }
    const x = randi(5, map.W - 6), y = randi(5, map.H - 6), i = map.idx(x, y);
    this.burst(x + 0.5, 1, y + 0.5, 0xfff0a0, 20);
    if (map.flora[i] && map.flora[i] <= 3) this.setFlora(i, 0);
  }
  twisterDamage(t, dt) {
    const map = this.map, R = 2.6;
    const x0 = Math.floor(t.x - R), x1 = Math.ceil(t.x + R), y0 = Math.floor(t.z - R), y1 = Math.ceil(t.z + R);
    const ws = this.hasBuilding('weather') ? 0.5 : 1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!map.inb(x, y) || dist2(x + 0.5, y + 0.5, t.x, t.z) > R * R) continue;
      const i = map.idx(x, y);
      if (map.flora[i] && chance(dt * 1.5)) this.setFlora(i, 0);
      for (const e of [{ h: true, i: map.hIdx(x, y) }, { h: false, i: map.vIdx(x, y) }]) {
        if (!map.fenceIntact(e.h, e.i)) continue;
        const hp = map.fenceHp(e.h, e.i) - 160 * dt * ws;
        if (hp <= 0) this.breakFence(e.h, e.i, null); else map.setFenceHp(e.h, e.i, hp);
      }
      const b = this.buildings.get(map.bld[i]);
      if (b && !b.broken && !BLD[b.type].fixed) { b.hp -= 45 * dt * ws * 1000 / (BLD[b.type].health || 1000); this.shutCheck(b); if (b.hp <= 0) { b.broken = true; b.hp = 0; this.bldVersion++; this.notify(`The twister wrecked the ${BLD[b.type].name}!`, 'danger', { building: b }); } }
    }
    for (const v of this.visitors.list) if (!v.gone && v.plan !== 'inside' && dist2(v.x, v.z, t.x, t.z) < 3 && chance(dt * 2)) this.visitors.kill(v, null, 'twister');
    for (const d of this.dinos) if (!d.dead && dist2(d.x, d.z, t.x, t.z) < R * R) {
      d.health -= 6 * dt; d.stress = Math.min(100, d.stress + 10 * dt);
      // small and medium animals (and Allosaurus, the lightest large carnivore) can be picked up and thrown
      const light = SIZE_RANK[d.sp.size] <= 2 || d.sp.id === 'allosaurus';
      if (light && !d.carried && chance(dt * 0.8)) {
        const a = rand(0, Math.PI * 2), r = rand(3, 7), p = this.safeDrop(d.x + Math.cos(a) * r, d.z + Math.sin(a) * r, d);
        if (p) { d.x = p.x; d.z = p.z; d.path = null; }
        d.health -= rand(15, 45);
        this.burst(d.x, 1.2, d.z, 0x8a7a5a, 18);
      }
      if (d.state !== 'flee' && d.tranq <= 0) d.fleeFrom(t, 4);
      if (d.health <= 0) d.die('the twister');
    }
  }

  // ======================= EFFECTS =======================
  burst(x, y, z, color, n = 20) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3), vel = [];
    for (let k = 0; k < n; k++) { pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z; vel.push([rand(-2, 2), rand(1, 4), rand(-2, 2)]); }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 0.18, transparent: true }));
    this.root.add(pts);
    this.effects.push({ pts, vel, t: 1.2 });
  }
  sparks(c) { this.burst(c.x, 0.7, c.z, 0x9ad8ff, 18); }
  updateEffects(dt) {
    for (let k = 0; k < this.effects.length; k++) {
      const e = this.effects[k];
      e.t -= dt;
      const a = e.pts.geometry.attributes.position.array;
      for (let j = 0; j < e.vel.length; j++) { const v = e.vel[j]; v[1] -= 9 * dt; a[j * 3] += v[0] * dt; a[j * 3 + 1] = Math.max(0, a[j * 3 + 1] + v[1] * dt); a[j * 3 + 2] += v[2] * dt; }
      e.pts.geometry.attributes.position.needsUpdate = true;
      e.pts.material.opacity = Math.max(0, e.t);
      if (e.t <= 0) { this.root.remove(e.pts); e.pts.geometry.dispose(); this.effects.splice(k--, 1); }
    }
  }

  // ======================= SELECTION & PICKING =======================
  select(sel) {
    if (sel?.kind === 'building' && sel.ref.type === 'dome_pod' && this.buildings.get(sel.ref.link)) sel = { kind: 'building', ref: this.buildings.get(sel.ref.link) };
    this.selected = sel;
    if (sel?.kind === 'dino') this.flag('sel:' + sel.ref.sp.id);
    if (sel?.kind === 'building') this.flag('selb:' + sel.ref.type);
    if (sel?.kind === 'visitor') this.flag('passport');
    G.ui?.showInfo(sel);
  }
  pick(clientX, clientY) {
    const ray = G.engine.ray(clientX, clientY);
    let best = null, bt = 1e9;
    const c = new THREE.Vector3();
    for (const d of this.dinos) {
      if (d.removed) continue;
      const r = Math.max(0.45, d.len * 0.35);
      c.set(d.x, (d.carried ? d.carryY : this.map.heightAt(d.x, d.z)) + d.sp.model.hipH * WORLD_SCALE * d.growth, d.z);
      if (ray.distanceSqToPoint(c) < r * r) { const t = ray.origin.distanceTo(c); if (t < bt) { bt = t; best = { kind: 'dino', ref: d }; } }
    }
    for (const v of this.vehicles.concat(this.rangers, this.helis)) {
      if (v.removed) continue;
      c.set(v.mesh.position.x, v.mesh.position.y + 0.4, v.mesh.position.z);
      const r = v instanceof Balloon ? 1.6 : 0.6;
      if (v instanceof Balloon) c.y += 2.4;
      if (ray.distanceSqToPoint(c) < r * r) { const t = ray.origin.distanceTo(c); if (t < bt) { bt = t; best = { kind: 'vehicle', ref: v }; } }
    }
    if (best) return best;
    const vis = this.visitors.pick(ray);
    if (vis) return { kind: 'visitor', ref: vis };
    const p = G.engine.pickGround(clientX, clientY);
    if (!p) return null;
    const tx = Math.floor(p.x), ty = Math.floor(p.z);
    if (!this.map.inb(tx, ty)) return null;
    const i = this.map.idx(tx, ty);
    const b = this.buildings.get(this.map.bld[i]);
    if (b) return { kind: 'building', ref: b };
    const r = this.map.regions[this.map.region[i]];
    if (r && !r.public && this.mode !== 'siteb') return { kind: 'enclosure', ref: r, tile: i };
    return null;
  }

  // ======================= RIDE CONTROL & PHOTOS =======================
  takeControl(vehicle) {
    const cam = G.engine.cam;
    // in a mission the film lasts the whole mission; elsewhere each ride gets fresh film
    if (this.mode !== 'mission' || !this.rideSeen) { this.rideSeen = new Set(); this.ridePhotos = 0; }
    for (const v of this.vehicles) v.controlled = false;
    vehicle.controlled = true;
    cam.mode = 'ride'; cam.follow = vehicle; cam.rideYaw = 0; cam.ridePitch = vehicle instanceof Balloon ? -0.35 : -0.05;
    G.ui?.setRideMode(true, vehicle);
  }
  takeControlHeli(h) {
    if (this.helisGrounded) { this.notify('The helicopter is out of action. Use the Land Cruiser.', 'warn', null, 'admin'); return; }
    if (this.mode !== 'mission' && (h.fuel ?? h.fuelMax()) < 10) { this.notify('The ranger helicopter is refuelling. Try again shortly.', 'warn', null, 'warden'); return; }
    this.flag('flyHeli');
    if (h.task) h.endTask();
    h.dropCarry();
    h.controlled = true;
    if (h.y < 3) h.y = 3;
    const cam = G.engine.cam;
    cam.mode = 'ride'; cam.follow = h; cam.rideYaw = 0; cam.ridePitch = -0.6;
    G.ui?.setRideMode(true, h);
  }
  // Look out from inside a viewing attraction, as a guest would (the original lets you use them yourself).
  viewFrom(b) {
    const vp = this.viewPoint(b), map = this.map;
    const h = { vent: 0.7, platform: 2.6, dome: 0.55, dome_pod: 0.55 }[vp.type] ?? 1.2;
    // face the nearest dinosaur, or the side the building faces
    let yaw = (b.rot * Math.PI) / 2 + Math.PI / 2, bd = 1e9;
    for (const d of this.dinos) { if (d.dead) continue; const q = dist2(d.x, d.z, vp.cx, vp.cz); if (q < bd) { bd = q; yaw = Math.atan2(d.z - vp.cz, d.x - vp.cx); } }
    const seat = { kind: 'view', b, x: vp.cx, z: vp.cz, heading: 0, camPos() { return { x: vp.cx, y: Math.max(0, map.heightAt(vp.cx, vp.cz)) + h, z: vp.cz, yaw: 0 }; } };
    const cam = G.engine.cam;
    cam.mode = 'ride'; cam.follow = seat; cam.rideYaw = -yaw; cam.ridePitch = vp.type === 'platform' ? -0.25 : -0.02;
    if (b.type === 'vent') this.flag('viewVent');
    G.ui?.setRideMode(true, seat);
  }
  // Take manual control of a Sentry Turret, as in the original: aim with the mouse and fire. It only kills.
  takeControlTurret(b) {
    const map = this.map;
    const seat = { kind: 'turret', b, x: b.cx, z: b.cz, heading: 0, reload: 0,
      camPos() { return { x: b.cx, y: Math.max(0, map.heightAt(b.cx, b.cz)) + 1.7, z: b.cz, yaw: 0 }; } };
    b.manual = true;
    const cam = G.engine.cam;
    cam.mode = 'ride'; cam.follow = seat; cam.rideYaw = 0; cam.ridePitch = -0.15;
    G.ui?.setRideMode(true, seat);
  }
  // Fire from the ranger helicopter at whatever the scope (screen centre) is over.
  heliShoot(kind) {
    const h = G.engine.cam.follow;
    // the Land Cruiser can shoot once the rifle has been collected (Rescue the Founder); a turret only kills
    if (!h || (h.kind !== 'heli' && h.kind !== 'turret' && !(h.kind === 'cruiser' && this.rifle) && !((h.kind === 'cruiser' || h.kind === 'jeep') && this.driveBy))) return;
    if (h.kind === 'turret') { if (h.b.removed || h.b.broken) return; kind = 'rifle'; }
    if (h.reload > 0) return;
    if (kind === 'rifle' && !this.park.has('retire') && h.kind === 'heli') { G.ui?.scopeMsg('Research Retire to use the rifle'); return; }
    if (h.kind === 'turret') { h.reload = 0.6; setTimeout(() => { h.reload = 0; }, 600); }
    else if (this.ammo != null && this.ammo <= 0) { G.ui?.scopeMsg('Out of ammunition: hover low over the Ranger Station to reload'); return; }
    if (h.kind !== 'turret') {
      if (this.ammo != null) this.ammo--;
      h.reload = kind === 'rifle' ? (h.kind === 'cruiser' ? 1.2 : 2.2) : 2.0;
    }
    if (h.kind === 'cruiser') setTimeout(() => { h.reload = 0; }, 1200);
    const ray = G.engine.ray(window.innerWidth / 2, window.innerHeight / 2);
    if (kind === 'rifle' && this.shootStructures(ray)) { G.audio?.play('thunder'); return; }
    const c = new THREE.Vector3();
    let best = null, bt = 1e9;
    for (const d of this.dinos) {
      if (d.dead || d.carried) continue;
      c.set(d.x, this.map.heightAt(d.x, d.z) + d.sp.model.hipH * WORLD_SCALE * d.growth, d.z);
      const r = Math.max(0.7, d.len * 0.4);
      if (ray.distanceSqToPoint(c) < r * r) { const t = ray.origin.distanceTo(c); if (t < bt) { bt = t; best = d; } }
    }
    G.audio?.play(kind === 'rifle' ? 'thunder' : 'shutter');
    if (h.kind === 'turret') { const p = h.camPos(), q = best ? new THREE.Vector3(best.x, this.map.heightAt(best.x, best.z) + 0.6, best.z) : ray.at(30, new THREE.Vector3()); this.tracer(p.x, p.y - 0.4, p.z, q.x, q.y, q.z); }
    if (!best) { G.ui?.scopeMsg('Missed'); return; }
    if (bt > (h.kind === 'turret' ? BLD.turret.range + 8 : 34)) { G.ui?.scopeMsg('Out of range'); return; }
    const hitP = 0.8 * (best.speedNow > 1.2 ? 0.75 : best.speedNow < 0.1 ? 1.25 : 1) * (best.len < 1.2 ? 0.8 : 1);
    if (!chance(Math.min(0.97, hitP))) { G.ui?.scopeMsg('Missed'); return; }
    if (kind === 'rifle') {
      // shooting a healthy, harmless animal in front of the guests looks like big-game hunting
      const harmless = !best.escaped && !best.disease && !['rampage', 'bash', 'hunt_visitor', 'hunt_jeep'].includes(best.state) && this.mode !== 'mission';
      if (harmless) { for (const v of this.visitors.list) if (!v.gone && dist2(v.x, v.z, best.x, best.z) < 400) { v.happy -= 15; this.visitors.think(v, 'They just shot a perfectly healthy dinosaur!', true); } this.park.safetyHit(3); if (!this.flags.huntWarn) { this.flags.huntWarn = true; this.notify('Guests were upset to see rangers shoot a healthy dinosaur.', 'warn', null, 'pr'); } }
      best.die('retired');
      this.park.stats.retired++;
      if (best.sp.diet === 'carn') this.park.stats.retiredCarn++;
      G.ui?.scopeMsg(`${best.sp.name} retired`);
    } else {
      best.tranquilize(0.2);
      G.ui?.scopeMsg(`${best.sp.name} sedated`);
    }
  }
  followEntity(e) {
    const cam = G.engine.cam;
    cam.mode = 'follow'; cam.follow = e; cam.tdist = Math.min(cam.tdist, 22);
  }
  dinoCam(d) {
    const cam = G.engine.cam;
    this.rideSeen = new Set(); this.ridePhotos = 0;
    cam.mode = 'ride'; cam.follow = d; cam.rideYaw = 0; cam.ridePitch = -0.1;
    G.ui?.setRideMode(true, d);
  }
  exitControl() {
    const cam = G.engine.cam;
    if (cam.follow?.kind === 'turret') cam.follow.b.manual = false;
    for (const v of this.vehicles) v.controlled = false;
    for (const h of this.helis) h.controlled = false;
    if (cam.follow) { cam.tx = cam.follow.x; cam.tz = cam.follow.z; cam.x = cam.tx; cam.z = cam.tz; }
    cam.mode = 'orbit'; cam.follow = null;
    G.ui?.setRideMode(false);
  }
  // Photographs, scored as in the original: the bigger and more central the animal, the better, weighted by what it
  // is doing (idle 0.4, eating 0.5, hunting 0.6, stressed 0.65, territorial display or fighting 0.8, charging the
  // vehicle 1.0). A species already photographed on this ride is worth a tenth. Cash is paid per photo (max $200).
  takePhoto() {
    const cam = G.engine.camera;
    cam.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const p = new THREE.Vector3();
    const park = this.park, st = park.stats;
    const limit = this.mission?.photos ?? 10;
    this.rideSeen = this.rideSeen || new Set();
    if ((this.ridePhotos || 0) >= limit) { G.ui?.toast({ text: `The camera is out of film (${limit} photos).`, kind: 'warn', noMail: true }); return null; }
    let pts = 0, carnPts = 0;
    const species = new Set(), tags = new Set();
    let action = false, best = null, bestS = 0;
    for (const d of this.dinos) {
      if (d.removed || d.carried) continue;
      p.set(d.x, this.map.heightAt(d.x, d.z) + d.sp.model.hipH * WORLD_SCALE * d.growth, d.z);
      if (!frustum.containsPoint(p)) continue;
      const dd = cam.position.distanceTo(p);
      if (dd > 32) continue;
      const fill = clamp(d.len * 3 / dd, 0.15, 2.2);
      const ndc = p.clone().project(cam);
      const centre = 1.3 - Math.min(1, Math.hypot(ndc.x, ndc.y)) * 0.6;
      const s0 = d.state;
      let w = 0.4, tag = null;
      if (s0 === 'hunt_jeep') { w = 1.0; tag = 'hunting'; }
      else if (s0 === 'fight' || s0 === 'defend' || s0 === 'joust') { w = 0.8; tag = 'fighting'; }
      else if (s0 === 'hunt' || s0 === 'hunt_visitor') { w = 0.6; tag = 'hunting'; }
      else if (s0 === 'bash' || d.stress > 65) w = 0.65;
      else if (s0 === 'eating' || s0 === 'grazing' || s0 === 'feeding') { w = 0.5; tag = 'eating'; }
      else if (s0 === 'drinking') { w = 0.5; tag = 'drinking'; }
      else if (s0 === 'play') { w = 0.6; tag = 'playing'; }
      else if (s0 === 'sleep') { w = 0.45; tag = 'sleeping'; }
      let s = d.sp.stars * 4 * fill * centre * w;
      if (d.dead) s *= 0.3;
      if (this.rideSeen.has(d.sp.id)) s *= 0.1;
      if (tag && !d.dead && fill > 0.25) tags.add(tag);
      if (w >= 0.6 && !d.dead) action = true;
      pts += s;
      if (d.sp.diet === 'carn' && w >= 0.5 && !d.dead) carnPts += s;
      if (!d.dead && fill > 0.25) species.add(d.sp.id);
      if (s > bestS) { bestS = s; best = d; }
    }
    const score = Math.round(pts);
    this.ridePhotos = (this.ridePhotos || 0) + 1;
    for (const id of species) this.rideSeen.add(id);
    let url = null;
    try { url = G.engine.renderer.domElement.toDataURL('image/jpeg', 0.7); } catch (e) { /* ignore */ }
    const weather = park.weather.type;
    const photo = { score, species: [...species], action, tags: [...tags], weather, best: best ? best.sp.name : null, url, day: park.day, left: limit - this.ridePhotos };
    this.photos.unshift(photo);
    if (this.photos.length > 16) this.photos.pop();
    st.photos++;
    st.photoPoints += score;
    st.missionPoints = (st.missionPoints || 0) + score;
    st.carnPoints = (st.carnPoints || 0) + Math.round(carnPts);
    for (const id of species) st.photoSpecies.add(id);
    st.photoTags = [...new Set([...(st.photoTags || []), ...tags])];
    const wk = weather === 'twister' ? 'storm' : weather;
    st.photoWhen = [...new Set([...(st.photoWhen || []), ...[...species].map((id) => id + ':' + wk)])];
    if (score > 0 && this.mode !== 'mission') park.earn(Math.min(200, score * 4), 'Photos');
    G.audio?.play('shutter');
    G.ui?.photoTaken(photo);
    return photo;
  }

  // ======================= UPDATE =======================
  update(dtReal) {
    const dt = Math.min(dtReal, 0.1) * this.speed;
    if (dt > 0) {
      const steps = Math.ceil(dt / 0.05);
      for (let s = 0; s < steps; s++) this.step(dt / steps);
    }
    this.view.update();
    this.visitors.render(dtReal);
    this.updateEffects(dtReal);
    // selection ring
    const ring = G.engine.selRing;
    const sel = this.selected;
    if (sel && (sel.kind === 'dino' || sel.kind === 'vehicle') && !sel.ref.removed) {
      const e = sel.ref;
      const x = e.kind === 'dino' ? e.x : e.x ?? e.mesh.position.x;
      ring.visible = true;
      const r = sel.kind === 'dino' ? Math.max(0.6, e.len * 0.45) : 0.7;
      ring.scale.setScalar(r);
      ring.position.set(e.x, Math.max(0, this.map.heightAt(e.x, e.z)) + 0.08, e.z);
    } else if (sel && sel.kind === 'building' && !sel.ref.removed) {
      const b = sel.ref;
      ring.visible = true; ring.scale.setScalar(Math.max(b.footprint.w, b.footprint.h) * 0.75);
      ring.position.set(b.cx, Math.max(0, this.map.heightAt(b.cx, b.cz)) + 0.1, b.cz);
    } else if (sel && sel.kind === 'visitor' && !sel.ref.gone) {
      ring.visible = true; ring.scale.setScalar(0.3); ring.position.set(sel.ref.x, 0.08, sel.ref.z);
    } else ring.visible = false;
    G.engine.setTwister(this.park.twister);
    this.ambient?.update(dtReal * Math.max(this.speed, 0.15), this.park.weather.type);
  }

  step(dt) {
    this.time += dt;
    if (this.map.regionsDirty) { this.map.computeRegions(); this.afterRegions(false); }
    this.park.update(dt);
    this._rsT -= dt;
    if (this._rsT <= 0) { this._rsT = 1; this.computeRegionStats(); }
    for (let i = 0; i < this.dinos.length; i++) {
      const d = this.dinos[i];
      d.update(dt);
      if (d.removed) i--;
    }
    this.visitors.update(dt);
    for (let i = 0; i < this.rangers.length; i++) { this.rangers[i].update(dt); if (this.rangers[i].removed) this.rangers.splice(i--, 1); }
    for (let i = 0; i < this.helis.length; i++) { this.helis[i].update(dt); if (this.helis[i].removed) this.helis.splice(i--, 1); }
    this.updateServices(dt);
    this.updateLivestock(dt);
    this.updateMission(dt);
    for (let i = 0; i < this.vehicles.length; i++) { this.vehicles[i].update(dt); if (this.vehicles[i].removed) { if (G.engine.cam.follow === this.vehicles[i]) this.exitControl(); this.vehicles.splice(i--, 1); } }
    this._dfT -= dt;
    if (this._dfT <= 0) {
      this._dfT = 2.5; this.scanDamagedFences();
      for (const d of this.dinos) if (d.unseen && d.escaped && !d.dead && this.watched(d)) this.alarmEscape(d, true);
    }
    const h = Math.floor(this.park.clockHour);
    if (h !== this._lastHour) { this._lastHour = h; this.hourly(); }
    this._advT = (this._advT ?? 12) - dt;
    if (this._advT <= 0) { this._advT = 18; this.advisor(); }
  }

  // One-time tips for new players, in the spirit of the original's advisor.
  advisor() {
    if (this.mode === 'demo' || this.mode === 'siteb' || this.mode === 'mission' || this.mission?.preset || this.mission?.tutorial) return;
    const seen = (this.flags.tips = this.flags.tips || new Set());
    const park = this.park, vis = this.visitors.count;
    const alive = this.dinos.filter((d) => !d.dead);
    const has = (t) => this.hasBuilding(t);
    const anyFence = this.map.fenceH.some((t) => t) || this.map.fenceV.some((t) => t);
    const dryPen = () => {
      for (const d of alive) { const r = d.region(); if (r && !r.public && !r.water.length) return d; }
      return null;
    };
    const hungryPen = () => {
      for (const d of alive) { const r = d.region(); if (d.sp.diet === 'herb' && r && !r.public && !this.regionFeeders(r.id, 'herb').length && r.graze.length < 6) return d; }
      return null;
    };
    const tips = [
      ['entrance', () => this.mode === 'career' && !this.entrances().length && this.time > 3, 'Advisor: Welcome! First, place your Park Entrance: open Build → Amenities → Park Entrance. Guests fly in to its helipad.'],
      ['hatchery', () => !has('hatchery') && (this.mode !== 'career' || this.entrances().length), 'Advisor: Build a Hatchery so you can create dinosaurs. Open Build (the hard hat), then Enclosures → Hatchery.'],
      ['open', () => !park.parkOpen && (alive.length >= 2 || this.time > 240), 'Advisor: The park is still closed. When you are ready for guests, click "Park Closed" at the top left to open it.'],
      ['fence', () => !anyFence && this.time > 40, 'Advisor: Fence off an enclosure before you release any dinosaurs. Drag on the ground with a fence tool.'],
      ['water', () => dryPen(), 'Advisor: Some dinosaurs have no water in their enclosure. Use Build → Environment → Lake inside it.'],
      ['feeder', () => hungryPen(), 'Advisor: An enclosure has herbivores but no feeder. Place a Herbivore Feeder inside it.'],
      ['restroom', () => vis > 6 && !has('restroom'), 'Advisor: Guests are arriving. Build Rest Rooms next to a path (Build → Amenities).'],
      ['food', () => vis > 8 && !has('snack') && !has('restaurant'), 'Advisor: Hungry and thirsty guests need a Kiosk (Build → Amenities).'],
      ['litter', () => vis > 30 && !has('cleaner') && this.dirtyPaths() > 6, 'Advisor: Your paths are getting dirty. Build a Cleaner Station and some Trash Cans.'],
      ['view', () => alive.length >= 3 && !this.buildingsOf('platform').length && !this.buildingsOf('vent').length && park.day >= 2, 'Advisor: Guests love seeing dinosaurs up close. Put a Viewing Platform beside an enclosure fence.'],
      ['research', () => park.day >= 3 && !park.research.active.length && park.research.done.size < 2, 'Advisor: Open Research (Actions menu) to unlock Medium fences, attractions and security. One project runs at a time.'],
      ['dig', () => park.day >= 1 && !park.expeditions.length && !park.digLog.length && !Object.values(park.dna).some((v) => v >= 50), 'Advisor: You have no usable DNA yet. Open the Fossil Hunt, acquire a hunting ground and send your dig team.'],
      ['ranger', () => alive.length >= 4 && !has('ranger') && !has('acu'), 'Advisor: Build a Ranger Station (Build → Security). Its rangers repair fences and vaccinate dinosaurs, and its helicopter recaptures escapes.'],
      ['fee', () => vis > 4 && park.fee > park.fairFee() + 10, 'Advisor: Guests think the entry fee is too high. Select the Park Gate to change it.'],
    ];
    for (const [id, cond, text] of tips) {
      if (seen.has(id)) continue;
      const r = cond();
      if (!r) continue;
      seen.add(id);
      this.notify(text, 'info', r && r.sp ? { dino: r } : undefined);
      return;
    }
  }

  scanDamagedFences() {
    const map = this.map, out = [];
    for (let i = 0; i < map.fenceH.length; i++) { const t = map.fenceH[i]; if (t && map.fenceHHp[i] < FENCES[t].hp) out.push({ h: true, i }); }
    for (let i = 0; i < map.fenceV.length; i++) { const t = map.fenceV[i]; if (t && map.fenceVHp[i] < FENCES[t].hp) out.push({ h: false, i }); }
    this.damagedFences = out;
  }

  hourly() {
    if (this.mode === 'siteb' || this.mode === 'demo') return;
    for (const d of this.dinos) {
      if (d.dead) continue;
      if (!d.disease && chance((0.018 / 24) * (1.7 - d.comfort / 100))) d.catchDisease();
      else if (d.disease && DISEASES[d.disease].spread) {
        for (const o of this.dinos) if (o !== d && !o.dead && !o.disease && o.sp === d.sp && dist2(o.x, o.z, d.x, d.z) < 25 && chance(DISEASES[d.disease].spread / 6)) o.catchDisease(d.disease);
      }
    }
  }

  onNewDay() {
    if (G.settings.autosave && this.mode !== 'demo' && this.mode !== 'mission') G.save?.autosave();
  }

  // ======================= PRESETS =======================
  clearPresetArea() {
    const map = this.map, e = map.entrance;
    for (let y = e.y - 34; y < e.y; y++) for (let x = e.x - 28; x <= e.x + 30; x++) {
      if (!map.inb(x, y)) continue;
      const i = map.idx(x, y);
      if (map.terrain[i] === T.SEA) continue;
      map.terrain[i] = T.GRASS; map.flora[i] = 0;
    }
    map.computeHeights();
  }
  fill(x0, y0, x1, y1, fn) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (this.map.inb(x, y)) fn(this.map.idx(x, y), x, y); }

  buildPreset(kind) {
    const map = this.map, e = map.entrance, cx = e.x + 1, ey = e.y;
    const P = (x, y, k = 1) => { if (!map.inb(x, y)) return; const i = map.idx(x, y); map.path[i] = k; map.flora[i] = 0; };
    // main avenue north, a cross street near the gate and another at the top
    for (let y = ey - 1; y >= ey - 31; y--) P(cx, y);
    for (let x = cx - 14; x <= cx + 14; x++) P(x, ey - 3);
    for (let x = cx - 6; x <= cx + 6; x++) P(x, ey - 31);
    const encl = [
      { x0: cx - 24, y0: ey - 30, x1: cx - 3, y1: ey - 6, fence: 2 },
      { x0: cx + 3, y0: ey - 30, x1: cx + 26, y1: ey - 6, fence: kind === 'control' ? 3 : 2 },
    ];
    for (const en of encl) {
      for (const ed of this.fenceEdgesRect(en.x0, en.y0, en.x1 + 1, en.y1 + 1)) if (this.fenceEdgeValid(ed)) map.setFence(ed.h, ed.i, en.fence);
      this.fill(en.x0, en.y0, en.x1, en.y1, (i, x, y) => {
        if (map.terrain[i] !== T.GRASS) return;
        const n = Math.sin(x * 0.4) * Math.cos(y * 0.33);
        if (n > 0.35 && chance(0.7)) map.flora[i] = pick([1, 2, 3, 3, 4, 5]);
      });
      const px = Math.floor((en.x0 + en.x1) / 2) + 5, py = en.y0 + 4;
      this.fill(px - 2, py - 1, px + 2, py + 2, (i) => { map.terrain[i] = T.WATER; map.flora[i] = 0; });
    }
    map.computeHeights();
    map.ver.path++;
    const B = (type, x, y, rot) => this.placeBuilding(type, x, y, rot, { free: true, silent: true });
    B('restroom', cx + 1, ey - 5, 3); B('snack', cx + 1, ey - 8, 3); B('snack', cx - 2, ey - 8, 1); B('restroom', cx - 2, ey - 12, 1);
    B('feeder_herb', cx - 12, ey - 14, 0); B('feeder_herb', cx - 18, ey - 24, 0);
    B('ranger', cx + 1, ey - 33, 0);
    if (kind === 'control') { B('feeder_goat', cx + 14, ey - 14, 0); B('feeder_herb', cx + 20, ey - 20, 0); }
    else B('feeder_herb', cx + 14, ey - 14, 0);
    if (kind === 'photo' || kind === 'photo2') {
      const st = B('safari', cx - 9, ey - 5, 0); // rows ey-5..ey-4, access on the cross street
      if (st) {
        const tx = st.footprint.x - 1;
        P(tx, ey - 5, 2);
        for (let y = ey - 6; y >= ey - 20; y--) P(tx, y, 2);
        for (let x = tx - 1; x >= cx - 19; x--) P(x, ey - 20, 2);
        for (let y = ey - 19; y <= ey - 9; y++) P(cx - 19, y, 2);
        for (let x = cx - 18; x <= tx - 1; x++) P(x, ey - 9, 2);
        map.ver.path++;
        this.computeRoute(st);
      }
    }
    if (kind === 'photo2') B('balloon', cx - 5, ey - 33, 0);
    map.ver.path++; map.regionsDirty = true;
    map.computeRegions();
    const add = (sp, n, en) => { for (let k = 0; k < n; k++) { const x = rand(en.x0 + 2, en.x1 - 1), z = rand(en.y0 + 7, en.y1 - 1); this.spawnDino(sp, x, z, { age: 6, genome: 80, hunger: 90, thirst: 90 }); } };
    if (kind === 'photo') {
      add('triceratops', 3, encl[0]); add('gallimimus', 6, encl[0]); add('parasaurolophus', 4, encl[0]);
      add('stegosaurus', 2, encl[1]); add('brachiosaurus', 2, encl[1]); add('edmontosaurus', 5, encl[1]);
    } else if (kind === 'photo2') {
      add('triceratops', 3, encl[0]); add('gallimimus', 5, encl[0]); add('corythosaurus', 3, encl[0]); add('ankylosaurus', 2, encl[0]);
      add('brachiosaurus', 2, encl[1]); add('kentrosaurus', 3, encl[1]); add('styracosaurus', 3, encl[1]); add('dryosaurus', 5, encl[1]);
    } else if (kind === 'control') {
      add('edmontosaurus', 6, encl[1]); add('gallimimus', 6, encl[1]); add('parasaurolophus', 3, encl[1]);
      add('velociraptor', 3, encl[1]); add('dilophosaurus', 2, encl[1]); add('albertosaurus', 1, encl[1]); add('ceratosaurus', 1, encl[1]);
      add('triceratops', 3, encl[0]); add('dryosaurus', 5, encl[0]);
    }
  }

  buildDemo() {
    const map = this.map, W = map.W;
    const sp = ['brachiosaurus', 'triceratops', 'gallimimus', 'parasaurolophus', 'stegosaurus', 'tyrannosaurus', 'edmontosaurus', 'velociraptor', 'ankylosaurus', 'spinosaurus'];
    for (const s of sp) {
      const n = SPECIES_BY_ID[s].herd[0] + (s === 'gallimimus' ? 4 : 1);
      let x, z, tries = 0;
      do { x = rand(20, W - 20); z = rand(20, W - 30); tries++; } while (!map.dinoPassable(map.idx(Math.floor(x), Math.floor(z))) && tries < 50);
      for (let k = 0; k < Math.min(n, 4); k++) this.spawnDino(s, x + rand(-3, 3), z + rand(-3, 3), { age: 8, genome: 90, hunger: 100, thirst: 100 });
    }
    G.engine.cam.tx = W / 2; G.engine.cam.tz = W / 2;
  }

  // ======================= SAVE / LOAD =======================
  serialize(name) {
    const map = this.map, park = this.park;
    return {
      v: 1, seed: this.seed, mode: this.mode, missionId: this.mission?.id || null, name: name || park.name,
      savedAt: Date.now(),
      meta: { money: park.money, day: park.day, stars: park.rating.stars, dinos: this.dinos.filter((d) => !d.dead).length, visitors: this.visitors.count },
      map: {
        terrain: encodeArr(map.terrain), path: encodeArr(map.path), flora: encodeArr(map.flora),
        rockH: encodeArr(Array.from(map.rockH, (v) => Math.round(v * 10))),
        fenceH: encodeArr(map.fenceH), fenceV: encodeArr(map.fenceV),
        fenceHHp: encodeArr(Array.from(map.fenceHHp, Math.round)), fenceVHp: encodeArr(Array.from(map.fenceVHp, Math.round)),
        entrance: map.entrance, W: map.W, form: map.form,
      },
      park: park.toJSON(),
      buildings: [...this.buildings.values()].map((b) => ({ id: b.id, type: b.type, rot: b.rot, fp: b.footprint, hp: b.hp, broken: b.broken, income: b.income, visits: b.visits, stock: b.stock, slots: b.slots, menu: b.menu, hired: b.hired, link: b.link, exp: b.exp })),
      dinos: this.dinos.map((d) => d.toJSON()),
      nextBid: this.nextBid, acuAuto: this.acuAuto, services: this.serializeServices(), livestock: this.serializeLivestock(),
      camera: { x: G.engine.cam.tx, z: G.engine.cam.tz, yaw: G.engine.cam.tyaw, pitch: G.engine.cam.tpitch, dist: G.engine.cam.tdist },
      notes: this.notes.slice(0, 30).map((n) => ({ text: n.text, kind: n.kind, day: n.day })),
    };
  }
  loadMap(m) {
    const map = this.map, N = map.W * map.H;
    map.terrain = decodeArr(m.terrain, Uint8Array, N);
    map.path = decodeArr(m.path, Uint8Array, N);
    map.flora = decodeArr(m.flora, Uint8Array, N);
    const rh = decodeArr(m.rockH, Float32Array, N); for (let i = 0; i < N; i++) rh[i] /= 10; map.rockH = rh;
    map.fenceH = decodeArr(m.fenceH, Uint8Array, map.fenceH.length);
    map.fenceV = decodeArr(m.fenceV, Uint8Array, map.fenceV.length);
    map.fenceHHp = decodeArr(m.fenceHHp, Float32Array, map.fenceHHp.length);
    map.fenceVHp = decodeArr(m.fenceVHp, Float32Array, map.fenceVHp.length);
    map.entrance = m.entrance; map.form = m.form;
    map.computeHeights();
    map.bumpAll();
    map.regionsDirty = true;
  }
  loadState(s) {
    this.park.fromJSON(s.park);
    for (const bj of s.buildings) {
      if (bj.type === 'entrance' && bj.fp.w * bj.fp.h === 6) bj.type = 'gate'; // the 3×2 gate of earlier versions
      if (!BLD[bj.type]) continue;
      // Buildings that grew in a later version (Kiosk, Rest Rooms) take their new size where there is room.
      const [w, h] = BLD[bj.type].size, fw = bj.rot % 2 ? h : w, fh = bj.rot % 2 ? w : h;
      let fp = bj.fp;
      if (fp.w !== fw || fp.h !== fh) { const c = this.canPlace(bj.type, fp.x + Math.floor((fw - 1) / 2), fp.y + Math.floor((fh - 1) / 2), bj.rot, true); if (c.ok) fp = c.fp; }
      const b = this.placeBuilding(bj.type, 0, 0, bj.rot, { fp, free: true, silent: true, id: bj.id });
      if (!b) continue;
      Object.assign(b, { hp: bj.hp, broken: bj.broken, income: bj.income || 0, visits: bj.visits || 0, stock: bj.stock ?? b.stock, slots: bj.slots || [], menu: bj.menu, link: bj.link, exp: bj.exp });
      if (BLD[b.type].fn === 'cleaner') { b.hired = bj.hired ?? 2; this.syncCleaners(b); }
      if (b.type === 'shelter' && b.hp < 50) b.shut = true;
    }
    this.loadServices(s.services);
    this.loadLivestock(s.livestock);
    this.nextBid = Math.max(this.nextBid, s.nextBid || 1);
    let maxId = 0;
    for (const dj of s.dinos) { this.spawnDino(dj.sp, dj.x, dj.z, dj); maxId = Math.max(maxId, dj.id); }
    resetDinoIds(maxId + 1);
    this.acuAuto = s.acuAuto ?? true;
    const c = s.camera;
    if (c) Object.assign(G.engine.cam, { tx: c.x, tz: c.z, x: c.x, z: c.z, tyaw: c.yaw, yaw: c.yaw, tpitch: c.pitch, pitch: c.pitch, tdist: c.dist, dist: c.dist, mode: 'orbit', follow: null });
    this.notes = (s.notes || []).slice();
    this.map.computeRegions();
    // escaped flags were saved; don't re-announce
  }
}

export function missionById(id) { return id === 'career' ? CAREER : MISSIONS.find((m) => m.id === id) || EXERCISES.find((m) => m.id === id); }

Object.assign(Game.prototype, ServiceMethods, MissionMethods, LivestockMethods);
