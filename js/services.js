// Park services from the original: litter and the Cleaner Station's cleaners, Trash Cans, Auto Lures and
// Sentry Turrets. Mixed into Game (see the end of game.js).
import * as THREE from 'three';
import { G } from './state.js';
import { BLD } from './data.js';
import { MAT } from './models.js';
import { PEOPLE, peopleLoaded } from './people.js';
import { clamp, rand, chance, dist, dist2 } from './util.js';

const LITTER_MAX = 3000;
const BIN_R = 3;          // a trash can catches litter within this many tiles
const SWEEP = 0.45;       // dirt removed per second of sweeping
const LITTER_COLS = [0xf4f2ea, 0xd83a2a, 0xf0c030, 0x3a78d0, 0xe8e0c8];

export class Cleaner {
  constructor(game, station) {
    this.g = game; this.b = station; this.kind = 'cleaner';
    const t = station.access;
    this.tile = t; this.next = -1; this.route = []; this.state = 'seek'; this.t = rand(0, 2);
    const W = game.map.W;
    this.x = (t % W) + 0.5; this.z = Math.floor(t / W) + 0.5; this.heading = 0; this.anim = rand(0, 4);
    this.mesh = new THREE.Group();
    this.body = new THREE.Mesh(peopleLoaded() ? PEOPLE.baked[0].walk[0] : new THREE.CapsuleGeometry(0.1, 0.4, 2, 6), peopleLoaded() ? cleanerMat() : MAT.std);
    this.body.castShadow = true;
    const cart = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.16), new THREE.MeshStandardMaterial({ color: 0x3a9a3a, roughness: 0.8 }));
    cart.position.set(0.28, 0.14, 0); cart.castShadow = true;
    this.mesh.add(this.body, cart);
    game.root.add(this.mesh);
  }
  get busyText() { return this.state === 'sweep' ? 'Sweeping' : this.route.length ? 'Heading to litter' : 'Patrolling'; }
  dispose() { this.removed = true; this.g.root.remove(this.mesh); }
  update(dt) {
    const g = this.g, map = g.map, W = map.W;
    if (this.b.removed || this.b.access < 0) { this.dispose(); return; }
    if (this.state === 'sweep') {
      this.t -= dt;
      g.dirt[this.tile] = Math.max(0, g.dirt[this.tile] - SWEEP * dt);
      if (this.t <= 0 || g.dirt[this.tile] <= 0.02) { g.dirt[this.tile] = 0; g.litterDirty = true; this.state = 'seek'; this.t = 0.3; }
    } else if (!this.route.length) {
      this.t -= dt;
      if (this.t <= 0) { this.t = 2; this.route = g.routeToLitter(this.tile, this.b); if (!this.route.length && map.path[this.tile] !== 1) this.route = g.routeToLitter(this.tile, this.b, true); }
    } else {
      const nt = this.route[0];
      const tx = (nt % W) + 0.5, tz = Math.floor(nt / W) + 0.5;
      const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz), sp = 1.5 * dt;
      if (d > 0.01) this.heading = Math.atan2(dz, dx);
      if (d <= sp) {
        this.x = tx; this.z = tz; this.tile = nt; this.route.shift();
        if (!this.route.length && g.dirt[nt] > 0.04) { this.state = 'sweep'; this.t = 3; }
      } else { this.x += (dx / d) * sp; this.z += (dz / d) * sp; this.anim += dt * 6; }
    }
    const y = Math.max(0, map.heightAt(this.x, this.z));
    this.mesh.position.set(this.x, y, this.z);
    this.mesh.rotation.y = -this.heading;
    if (peopleLoaded()) {
      const poses = PEOPLE.baked[0];
      const set = this.state === 'sweep' ? poses.idle : this.route.length ? poses.walk : poses.idle;
      this.body.geometry = set[Math.floor(this.state === 'sweep' ? this.anim * 0.5 : this.anim) % set.length];
      if (this.state === 'sweep') this.anim += dt * 3;
    }
  }
}

let _cleanerMat = null;
function cleanerMat() {
  // Cleaners wear white overalls: vertex colours only, with no per-guest shirt tint.
  if (!_cleanerMat) _cleanerMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  return _cleanerMat;
}

export const ServiceMethods = {
  initServices() {
    const N = this.map.W * this.map.H;
    this.dirt = new Float32Array(N);
    this.cleaners = [];
    this.binMask = null; this.binVer = -1;
    this.litterDirty = true; this._litT = 0; this._lureT = 0; this._turT = 0;
    const geo = new THREE.BoxGeometry(0.09, 0.012, 0.06);
    this.litterMesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), LITTER_MAX);
    this.litterMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(LITTER_MAX * 3), 3);
    this.litterMesh.count = 0; this.litterMesh.frustumCulled = false; this.litterMesh.receiveShadow = true;
    this.root.add(this.litterMesh);
  },

  // ---------- litter ----------
  binNear(i) {
    if (this.binVer !== this.bldVersion) {
      const map = this.map, W = map.W, m = new Uint8Array(W * map.H);
      for (const b of this.buildings.values()) {
        if (b.type !== 'bin' || b.broken) continue;
        for (let y = b.y - BIN_R; y <= b.y + BIN_R; y++) for (let x = b.x - BIN_R; x <= b.x + BIN_R; x++) if (map.inb(x, y)) m[map.idx(x, y)] = 1;
      }
      this.binMask = m; this.binVer = this.bldVersion;
    }
    return this.binMask[i] === 1;
  },
  // The path tile a bench faces.
  benchTile(b) {
    const map = this.map;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const x = b.x + dx, y = b.y + dy;
      if (map.inb(x, y) && map.path[map.idx(x, y)] === 1) return map.idx(x, y);
    }
    return -1;
  },
  // A bench beside this path tile, if any (benches sit next to the path).
  benchNear(i) {
    const map = this.map, W = map.W, x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!map.inb(x + dx, y + dy)) continue;
      const b = this.buildings.get(map.bld[map.idx(x + dx, y + dy)]);
      if (b && b.type === 'bench' && !b.broken) return b;
    }
    return null;
  },
  // A guest drops litter on a path tile; trash cans nearby catch most of it.
  addLitter(i, k) {
    if (this.map.path[i] !== 1) return;
    const before = this.dirt[i];
    this.dirt[i] = Math.min(1, before + k * (this.binNear(i) ? 0.2 : 1));
    if ((before < 0.1) !== (this.dirt[i] < 0.1) || Math.floor(before * 8) !== Math.floor(this.dirt[i] * 8)) this.litterDirty = true;
  },
  dirtyPaths() { let n = 0; for (let i = 0; i < this.dirt.length; i++) if (this.dirt[i] > 0.3) n++; return n; },
  // Cleanliness of the whole path network, 0..1 (1 = spotless).
  cleanliness() {
    let n = 0, s = 0;
    const p = this.map.path;
    for (let i = 0; i < p.length; i++) if (p[i] === 1) { n++; s += this.dirt[i]; }
    return n ? clamp(1 - (s / n) * 1.8, 0, 1) : 1;
  },
  // Breadth-first search along footpaths from `from` to the nearest dirty tile within the station's range.
  routeToLitter(from, station, anyway) {
    const map = this.map, W = map.W, R = 30;
    const prev = new Map([[from, -1]]), q = [from];
    let best = -1, bestDirt = 0.06;
    for (let k = 0; k < q.length && k < 6000; k++) {
      const i = q[k];
      if (this.dirt[i] > bestDirt && !this.cleaners.some((c) => c !== this && c.route.at(-1) === i)) { best = i; break; }
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!map.inb(nx, ny)) continue;
        const ni = map.idx(nx, ny);
        if (prev.has(ni) || (map.path[ni] !== 1 && !anyway) || Math.abs(nx - station.cx) > R || Math.abs(ny - station.cz) > R) continue;
        if (anyway && map.path[ni] !== 1 && !map.isLand(ni)) continue;
        prev.set(ni, i); q.push(ni);
      }
    }
    if (best < 0) return [];
    const route = [];
    for (let i = best; i !== from && i >= 0; i = prev.get(i)) route.unshift(i);
    return route;
  },
  syncCleaners(b) {
    const mine = this.cleaners.filter((c) => c.b === b);
    while (mine.length < (b.hired || 0) && b.access >= 0) { const c = new Cleaner(this, b); this.cleaners.push(c); mine.push(c); }
    while (mine.length > (b.hired || 0)) mine.pop().dispose();
    this.cleaners = this.cleaners.filter((c) => !c.removed);
  },
  renderLitter() {
    if (!this.litterDirty) return;
    this.litterDirty = false;
    const map = this.map, W = map.W, m = this.litterMesh, mat = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    let n = 0;
    for (let i = 0; i < this.dirt.length && n < LITTER_MAX; i++) {
      const d = this.dirt[i];
      if (d < 0.1) continue;
      const x = i % W, y = (i / W) | 0, h = Math.max(0, map.heightAt(x + 0.5, y + 0.5)) + 0.02;
      const k = Math.min(7, Math.floor(d * 8));
      for (let j = 0; j < k && n < LITTER_MAX; j++) {
        const hsh = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453, f = hsh - Math.floor(hsh), f2 = (hsh * 7.3) % 1;
        pos.set(x + 0.15 + f * 0.7, h, y + 0.15 + Math.abs(f2) * 0.7);
        q.setFromAxisAngle(up, f * 6.28);
        mat.compose(pos, q, sc);
        m.setMatrixAt(n, mat);
        m.setColorAt(n, c.setHex(LITTER_COLS[(i + j) % LITTER_COLS.length]));
        n++;
      }
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  },

  // ---------- weather and plants ----------
  // Heatwaves kill a few trees (dir -1); rain lets plants spread to the grass beside them (dir +1).
  weatherFlora(dir) {
    const map = this.map, W = map.W;
    for (let k = 0; k < 30; k++) {
      const i = (Math.random() * map.flora.length) | 0;
      if (dir < 0) { if (map.flora[i] >= 1 && map.flora[i] <= 5 && chance(0.25)) this.setFlora(i, 0, true); continue; }
      if (!map.flora[i] || map.flora[i] === 6) continue;
      const x = (i % W) + ((Math.random() * 3) | 0) - 1, y = ((i / W) | 0) + ((Math.random() * 3) | 0) - 1;
      if (!map.inb(x, y)) continue;
      const j = map.idx(x, y);
      if (!map.flora[j] && map.isLand(j) && map.bld[j] < 0 && !map.path[j] && chance(0.3)) this.setFlora(j, map.flora[i], true);
    }
  },

  // ---------- emergency mode ----------
  // Declaring an emergency sends guests to shelters (or out of the park) and stops new arrivals. As in the
  // original, deaths during an emergency bring no fines and no loss of rating.
  setEmergency(on) {
    const park = this.park;
    if (park.emergency === on) return;
    park.emergency = on;
    if (on) {
      this.flag?.('emergency');
      this.notify('EMERGENCY DECLARED. Guests are heading for the Visitor Shelters.', 'danger', null, 'warden');
      G.audio?.play('alarm');
      this.visitors.emergency();
    } else {
      this.notify('The emergency is over. Guests are coming out of the shelters.', 'good', null, 'warden');
      this.visitors.allClear();
    }
  },

  // ---------- auto lures ----------
  sprayLure(b) {
    if (b.broken || b.spray > 0) return;
    b.spray = 30;
    this.burst(b.cx, 1.0, b.cz, (b.menu?.gas || 'herb') === 'herb' ? 0x9ae070 : 0xe07a5a, 26);
  },
  // The lure a dinosaur should head for, if any is spraying its kind of scent nearby.
  lureFor(d) {
    for (const b of this.buildings.values()) {
      if (b.type !== 'lure' || !(b.spray > 0) || b.broken) continue;
      if ((b.menu?.gas || 'herb') !== d.sp.diet) continue;
      const R = BLD.lure.range;
      if (dist2(b.cx, b.cz, d.x, d.z) < R * R) return b;
    }
    return null;
  },

  // ---------- per-step update ----------
  updateServices(dt) {
    for (let i = 0; i < this.cleaners.length; i++) { this.cleaners[i].update(dt); if (this.cleaners[i].removed) this.cleaners.splice(i--, 1); }
    this._litT -= dt;
    if (this._litT <= 0) { this._litT = 1.5; this.renderLitter(); }
    // lures: emission schedule (monthly = every 300 s of game time) and automatic mode
    this._lureT -= dt;
    const lureTick = this._lureT <= 0;
    if (lureTick) this._lureT = 1;
    for (const b of this.buildings.values()) {
      if (b.type === 'lure') {
        if (b.spray > 0) { b.spray -= dt; if (chance(dt * 3)) this.burst(b.cx, 1.0, b.cz, (b.menu?.gas || 'herb') === 'herb' ? 0x9ae070 : 0xe07a5a, 4); }
        if (!lureTick || b.spray > 0) continue;
        const fr = b.menu?.freq || 'auto', el = this.park.elapsed || 0;
        b.nextSpray ??= el + 300;
        if ((fr === 'month' || fr === 'bimonth') && el >= b.nextSpray) { b.nextSpray = el + (fr === 'month' ? 300 : 600); this.sprayLure(b); }
        if (fr === 'auto' && this.dinos.some((d) => d.escaped && !d.dead && d.sp.diet === (b.menu?.gas || 'herb') && dist2(d.x, d.z, b.cx, b.cz) < BLD.lure.range ** 2)) this.sprayLure(b);
      } else if (b.type === 'turret') this.updateTurret(b, dt);
    }
  },
  updateTurret(b, dt) {
    b.cool = (b.cool || 0) - dt;
    if (b.cool > 0 || b.broken || b.manual) return;
    const tg = b.menu?.target || 'carn';
    if (tg === 'none') return;
    const R = BLD.turret.range;
    let best = null, bd = R * R;
    for (const d of this.dinos) {
      if (d.dead || d.carried || (tg !== 'all' && d.sp.diet !== tg)) continue;
      const threat = d.escaped || d.state === 'bash' || d.state === 'rampage' || d.state === 'hunt_visitor';
      if (!threat) continue;
      const r2 = dist2(d.x, d.z, b.cx, b.cz);
      if (r2 < bd) { bd = r2; best = d; }
    }
    if (!best) return;
    b.cool = 0.9;
    const y = Math.max(0, this.map.heightAt(best.x, best.z)) + 0.6;
    this.tracer(b.cx, 1.0 + Math.max(0, this.map.heightAt(b.cx, b.cz)), b.cz, best.x, y, best.z);
    G.audio?.playAt?.('shot', b.cx, b.cz, 0.7);
    if (!b.warned) { b.warned = true; this.notify(`Sentry Turret firing on ${best.sp.name} "${best.name}"!`, 'danger', { dino: best }); }
    best.takeHit(best.maxHp * 0.14, null, 'the sentry turret');
    if (best.dead) { this.park.stats.retired++; if (best.sp.diet === 'carn') this.park.stats.retiredCarn++; b.warned = false; }
  },
  tracer(x0, y0, z0, x1, y1, z1) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xfff0a0, transparent: true }));
    this.root.add(line);
    // fades out through the shared effects list (updateEffects fades .material and removes it)
    this.effects.push({ pts: line, vel: [], t: 0.15 });
  },

  serializeServices() {
    const out = [];
    for (let i = 0; i < this.dirt.length; i++) if (this.dirt[i] > 0.02) out.push(i, Math.round(this.dirt[i] * 100));
    return { dirt: out };
  },
  loadServices(s) {
    if (!s?.dirt) return;
    for (let k = 0; k < s.dirt.length; k += 2) this.dirt[s.dirt[k]] = s.dirt[k + 1] / 100;
    this.litterDirty = true;
  },
};
