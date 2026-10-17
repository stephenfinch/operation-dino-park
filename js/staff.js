// Rangers, ACU helicopters, safari jeeps and balloons.
import * as THREE from 'three';
import { G } from './state.js';
import { BLD, FENCES, DISEASES, DAY_SECONDS, SIZE_RANK, PARTY, buildingPrice } from './data.js';
import { clamp, rand, dist, dist2, angleLerp, lerp, chance, pick } from './util.js';
import { MAT, jeepGeometry, heliGeometry, rotorGeometry, balloonGeometry } from './models.js';

const geoCache = {};
const geo = (k, f) => geoCache[k] || (geoCache[k] = f());

function vehicleMesh(g) { const m = new THREE.Mesh(g, MAT.std); m.castShadow = true; return m; }

// ============ RANGER ============
export class Ranger {
  constructor(game, station) {
    this.kind = 'ranger';
    this.g = game; this.b = station;
    this.x = station.cx; this.z = station.cz + 1.2; this.heading = 0;
    this.state = 'idle'; this.task = null; this.workT = 0; this.scanT = rand(0, 2);
    this.mesh = vehicleMesh(geo('ranger', () => jeepGeometry(0x3a5a30, 0xd8d0a0)));
    game.root.add(this.mesh);
  }
  get busyText() { return this.task ? { fence: 'Repairing a fence', heal: 'Treating a dinosaur', bld: 'Repairing a building', immunize: 'Vaccinating a dinosaur', revive: 'Reviving a dinosaur' }[this.task.type] : this.state === 'return' ? 'Returning to base' : 'Standing by'; }
  findTask() {
    const g = this.g, map = g.map, park = g.park, R = BLD.ranger.range;
    let best = null, bs = 1e9;
    const consider = (t, score) => { if (score < bs && !g.claimed.has(t.key)) { bs = score; best = t; } };
    for (const d of g.dinos) {
      if (d.dead || d.carried) continue;
      const dd = dist(d.x, d.z, this.b.cx, this.b.cz);
      if (dd > R) continue;
      if (d.coma) consider({ type: 'revive', dino: d, key: 'd' + d.id }, dd - 20);
      else if (d.disease && park.has(DISEASES[d.disease].vaccine)) consider({ type: 'heal', dino: d, key: 'd' + d.id }, dd);
      else if (d.immunize?.length) consider({ type: 'immunize', dino: d, key: 'd' + d.id }, dd + 5);
      else if (d.health < 45 && !d.disease) consider({ type: 'heal', dino: d, key: 'd' + d.id }, dd + 10);
    }
    for (const e of g.damagedFences) {
      const c = map.edgeCenter(e.h, e.i);
      const dd = dist(c.x, c.z, this.b.cx, this.b.cz);
      if (dd > R) continue;
      const hp = map.fenceHp(e.h, e.i), t = map.fenceType(e.h, e.i);
      if (!t) continue;
      const frac = hp / FENCES[t].hp;
      if (frac > 0.8) continue;
      consider({ type: 'fence', e, key: `f${e.h ? 'h' : 'v'}${e.i}`, x: c.x, z: c.z }, dd + frac * 40 - (hp <= 0 ? 30 : 0));
    }
    for (const b of g.buildings.values()) {
      if (!b.broken && b.hp >= 100) continue;
      const dd = dist(b.cx, b.cz, this.b.cx, this.b.cz);
      if (dd > R) continue;
      consider({ type: 'bld', b, key: 'b' + b.id, x: b.cx, z: b.cz + b.footprint.h / 2 + 0.5 }, dd + 15);
    }
    return best;
  }
  update(dt) {
    const g = this.g;
    if (this.b.removed) { this.dispose(); return; }
    switch (this.state) {
      case 'idle':
      case 'return': {
        this.scanT -= dt;
        if (this.scanT <= 0) {
          this.scanT = 1.5;
          const t = this.findTask();
          if (t) { this.task = t; g.claimed.add(t.key); this.state = 'drive'; break; }
        }
        if (this.state === 'return') { if (this.driveTo(this.b.cx, this.b.cz + 1.2, dt)) this.state = 'idle'; }
        break;
      }
      case 'drive': {
        const t = this.task;
        if (!this.valid(t)) { this.finish(); break; }
        const onDino = !!t.dino;
        const tx = onDino ? t.dino.x + 1.2 : t.x, tz = onDino ? t.dino.z + 1.2 : t.z;
        if (this.driveTo(tx, tz, dt)) { this.state = 'work'; this.workT = onDino ? 4 : 7; }
        break;
      }
      case 'work': {
        const t = this.task;
        if (!this.valid(t)) { this.finish(); break; }
        this.workT -= dt;
        if (this.workT <= 0) { this.complete(t); this.finish(); }
        break;
      }
    }
    const y = Math.max(g.map.heightAt(this.x, this.z), -0.25);
    this.mesh.position.set(this.x, y, this.z);
    this.mesh.rotation.y = -this.heading;
  }
  valid(t) {
    if (!t) return false;
    if (t.dino) return !t.dino.dead && !t.dino.removed && !t.dino.carried;
    if (t.type === 'bld') return !t.b.removed;
    if (t.type === 'fence') return this.g.map.fenceType(t.e.h, t.e.i) > 0;
    return false;
  }
  complete(t) {
    const g = this.g, map = g.map;
    if (t.type === 'heal') { t.dino.cure(true); t.dino.health = Math.min(100, t.dino.health + 35); }
    else if (t.type === 'immunize') { for (const id of t.dino.immunize) t.dino.vaccinate(id, true); g.notify(`Rangers vaccinated ${t.dino.sp.name} "${t.dino.name}". It is immune for life.`, 'good', { dino: t.dino }); t.dino.immunize = []; }
    else if (t.type === 'revive') { const d = t.dino; d.coma = false; d.tranq = 0; d.state = 'idle'; d.stateT = 2; d.stress = 30; d.health = Math.min(100, d.health + 20); g.notify(`Rangers revived ${d.sp.name} "${d.name}" with an adrenaline shot.`, 'good', { dino: d }); }
    else if (t.type === 'fence') {
      const ty = map.fenceType(t.e.h, t.e.i);
      const wasBroken = map.fenceHp(t.e.h, t.e.i) <= 0;
      g.park.forceSpend(Math.round(FENCES[ty].cost * 0.25), 'Upkeep');
      map.setFenceHp(t.e.h, t.e.i, FENCES[ty].hp);
      if (wasBroken) { map.ver.fence++; map.regionsDirty = true; g.notify('Rangers repaired a broken fence.', 'good'); }
    } else if (t.type === 'bld') {
      g.park.forceSpend(Math.round(BLD[t.b.type].cost * 0.1), 'Upkeep');
      t.b.hp = 100; if (t.b.shut) { t.b.shut = false; g.bldVersion++; } if (t.b.broken) { t.b.broken = false; g.bldVersion++; g.notify(`Rangers repaired the ${BLD[t.b.type].name}.`, 'good'); }
    }
  }
  finish() { if (this.task) this.g.claimed.delete(this.task.key); this.task = null; this.state = 'return'; this.scanT = 0.5; }
  driveTo(x, z, dt) {
    const d = dist(this.x, this.z, x, z);
    if (d < 0.3) return true;
    const a = Math.atan2(z - this.z, x - this.x);
    this.heading = angleLerp(this.heading, a, Math.min(1, dt * 5));
    const sp = Math.min(4.2 * dt, d);
    this.x += Math.cos(a) * sp; this.z += Math.sin(a) * sp;
    return false;
  }
  dispose() { this.g.root.remove(this.mesh); this.removed = true; if (this.task) this.g.claimed.delete(this.task.key); }
}

// ============ ACU HELICOPTER ============
export class Heli {
  constructor(game, base) {
    this.kind = 'heli';
    this.g = game; this.b = base;
    this.x = base.cx + 0.85; this.z = base.cz; this.y = 0.15; this.heading = 0;
    this.task = null; this.phase = ''; this.t = 0; this.carry = null;
    this.mesh = new THREE.Group();
    const body = vehicleMesh(geo('heli', heliGeometry));
    this.rotor = vehicleMesh(geo('rotor', rotorGeometry));
    this.rotor.position.y = 0.8;
    this.mesh.add(body, this.rotor);
    this.mesh.scale.setScalar(1.15);
    game.root.add(this.mesh);
    this.spin = 0;
  }
  get busyText() {
    if (!this.task) return 'On the helipad';
    const n = this.task.dino ? `${this.task.dino.sp.name} "${this.task.dino.name}"` : '';
    return { tranq: `Tranquilizing ${n}`, move: `Relocating ${n}`, retire: `Retiring ${n}`, sell: `Selling ${n}`, carcass: 'Removing a carcass', recapture: `Recapturing ${n}`, rescue: 'Rescuing stranded guests' }[this.task.type] || 'Busy';
  }
  // Player-flown mode: WASD flies toward where the camera looks; the HUD scope aims the guns.
  fuelMax() { return this.g.park.has('battery') ? 240 : 120; }
  flyManual(dt) {
    const g = this.g, k = G.engine.keys, cam = G.engine.cam;
    // fuel: missions fly on unlimited fuel; otherwise the helicopter must return to refuel
    if (g.mode !== 'mission') {
      this.fuel = Math.max(0, (this.fuel ?? this.fuelMax()) - dt);
      if (this.fuel <= 0) { g.exitControl(); g.notify('The ranger helicopter is out of fuel and is returning to its station.', 'warn', null, 'warden'); return; }
    }
    const look = this.heading - cam.rideYaw;
    const turn = (look - this.heading) * Math.min(1, dt * 1.5);
    this.heading += turn; cam.rideYaw -= turn;
    let vx = 0, vz = 0;
    if (k.has('w')) { vx += Math.cos(look); vz += Math.sin(look); }
    if (k.has('s')) { vx -= Math.cos(look); vz -= Math.sin(look); }
    if (k.has('a')) { vx += Math.sin(look); vz -= Math.cos(look); }
    if (k.has('d')) { vx -= Math.sin(look); vz += Math.cos(look); }
    const W = g.map.W, sp = (g.park.weather.type === 'storm' || g.park.weather.type === 'twister' ? 3 : 6) * dt;
    this.x = clamp(this.x + vx * sp, -10, W + 10); this.z = clamp(this.z + vz * sp, -10, W + 10);
    const ground = Math.max(0, g.map.heightAt(this.x, this.z));
    const want = ground + (k.has('q') ? 3 : k.has('e') ? 11 : 7);
    this.y += clamp(want - this.y, -4 * dt, 4 * dt);
    this.reload = Math.max(0, (this.reload || 0) - dt);
    this.spin += dt * 30; this.rotor.rotation.y = this.spin;
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.set(0, -this.heading, vx || vz ? -0.12 : 0, 'YXZ');
    if (G.audio) G.audio.heliNear(this.x, this.z);
  }
  update(dt) {
    const g = this.g;
    if (this.b.removed) { this.dropCarry(); this.dispose(); return; }
    if (this.controlled) { this.flyManual(dt); return; }
    // refuel on the pad
    if (!this.task && this.y < 0.5) this.fuel = Math.min(this.fuelMax(), (this.fuel ?? this.fuelMax()) + dt * 15);
    if (!this.task) {
      // without the Gyro Stabilizer the helicopter only takes off in a storm to rescue stranded guests
      const w = g.park.weather.type, grounded = (w === 'storm' || w === 'twister') && !g.park.has('gyro');
      const t = g.nextAcuTask(grounded);
      if (t) { this.task = t; this.phase = 'fly'; this.t = 0; }
    }
    const t = this.task;
    let tx = this.b.cx + 0.85, tz = this.b.cz, ty = 0.15;
    if (t && t.type === 'rescue') {
      // winch stranded guests aboard and fly them to the Park Entrance
      const vs = t.vs.filter((v) => !v.gone && v.plan === 'stranded');
      if (this.phase === 'fly') {
        if (!vs.length) { this.endTask(); return; }
        tx = vs[0].x; tz = vs[0].z; ty = Math.max(0, g.map.heightAt(tx, tz)) + 2.2;
        if (dist(this.x, this.z, tx, tz) < 0.6 && Math.abs(this.y - ty) < 0.6) { this.phase = 'act'; this.t = 2.5; }
      } else if (this.phase === 'act') {
        tx = this.x; tz = this.z; ty = this.y;
        this.t -= dt;
        if (this.t <= 0) {
          t.aboard = vs; for (const v of vs) { v.plan = 'ride'; v.inB = null; }
          const ent = g.entrances()[0];
          if (!ent) { for (const v of vs) g.visitors.leavePark(v, false); this.endTask(); return; }
          t.ent = ent; t.dest = g.entrancePad(ent); this.phase = 'carry';
        }
      } else if (this.phase === 'carry') {
        tx = t.dest.x; tz = t.dest.z; ty = 4;
        if (dist(this.x, this.z, tx, tz) < 0.6) { ty = t.dest.y + 1; if (Math.abs(this.y - ty) < 0.4) { for (const v of t.aboard) if (!v.gone) g.visitors.returnFromRide(v, t.ent, 0); g.notify(`The ranger helicopter rescued ${t.aboard.length} stranded guest${t.aboard.length > 1 ? 's' : ''}.`, 'good', null, 'warden'); this.endTask(); return; } }
      }
    } else if (t) {
      const d = t.dino;
      if (d && (d.removed || (d.dead && t.type !== 'carcass' && t.type !== 'retire' && this.phase !== 'carry'))) { this.endTask(); return; }
      if (this.phase === 'fly') {
        tx = d.x; tz = d.z; ty = d.len * 0.6 + 4;
        if (dist(this.x, this.z, tx, tz) < 0.6 && Math.abs(this.y - ty) < 0.8) { this.phase = 'act'; this.t = t.type === 'carcass' ? 1 : g.park.has('tranq') ? 1.0 : 2.0; }
      } else if (this.phase === 'act') {
        tx = d.x; tz = d.z; ty = d.len * 0.6 + 3;
        this.t -= dt;
        if (this.t <= 0) this.act(t);
      } else if (this.phase === 'carry') {
        const dest = t.dest;
        tx = dest.x; tz = dest.z; ty = 5;
        const dd = dist(this.x, this.z, tx, tz);
        if (dd < 0.5) { ty = d.len * 0.4 + 1.6; if (Math.abs(this.y - ty) < 0.3) this.deliver(t); }
      }
    }
    // flight
    const dx = tx - this.x, dz = tz - this.z, dd = Math.hypot(dx, dz);
    const climbFirst = dd > 1 && this.y < 3;
    if (!climbFirst && dd > 0.01) {
      const sp = Math.min(7.5 * dt, dd);
      this.x += (dx / dd) * sp; this.z += (dz / dd) * sp;
      this.heading = angleLerp(this.heading, Math.atan2(dz, dx), Math.min(1, dt * 3));
    }
    const targetY = climbFirst ? 5 : ty;
    this.y += clamp(targetY - this.y, -3 * dt, 3 * dt);
    const airborne = this.y > 0.3 || this.task;
    this.spin += dt * (airborne ? 30 : 4);
    this.rotor.rotation.y = this.spin;
    const tilt = !climbFirst && dd > 1 ? 0.15 : 0;
    this.mesh.position.set(this.x, Math.max(this.y, g.map.heightAt(this.x, this.z)), this.z);
    this.mesh.rotation.set(0, -this.heading, -tilt, 'YXZ');
    if (this.carry) {
      const c = this.carry;
      c.x = this.x; c.z = this.z; c.carryY = this.y - 0.6 - c.len * 0.35;
    }
    if (airborne && G.audio) G.audio.heliNear(this.x, this.z);
  }
  act(t) {
    const g = this.g, d = t.dino;
    G.audio?.playAt('dart', d.x, d.z, 0.8);
    if (t.type === 'retire') {
      d.die('retired');
      g.park.stats.retired++;
      if (d.sp.diet === 'carn') g.park.stats.retiredCarn++;
      g.notify(`ACU retired ${d.sp.name} "${d.name}".`, 'info', { dino: d });
      t.type = 'carcass';
      this.pickup(d, { x: this.b.cx - 0.7, z: this.b.cz, remove: true });
      return;
    }
    if (t.type === 'carcass') { this.pickup(d, { x: this.b.cx - 0.7, z: this.b.cz, remove: true }); return; }
    // tranquilize
    const days = g.park.has('tranq') ? 0.28 : 0.18;
    if (!d.dead) d.tranquilize(days);
    if (t.type === 'tranq') { g.notify(`ACU tranquilized ${d.sp.name} "${d.name}".`, 'info', { dino: d }); this.endTask(); return; }
    if (t.type === 'sell') { this.pickup(d, { x: d.x < g.map.W / 2 ? -8 : g.map.W + 8, z: d.z, remove: true, sell: true }); return; }
    if (t.type === 'recapture') { this.pickup(d, g.safeDrop(d.home.x, d.home.z, d) || { x: d.home.x, z: d.home.z }); return; }
    if (t.type === 'move') { this.pickup(d, g.safeDrop(t.dest.x, t.dest.z, d) || t.dest); return; }
    this.endTask();
  }
  pickup(d, dest) {
    this.task.dest = dest;
    this.phase = 'carry';
    this.carry = d;
    d.carried = true; d.path = null;
    this.g.markRegionsDirty();
  }
  deliver(t) {
    const g = this.g, d = this.carry;
    if (!d) { this.endTask(); return; }
    if (t.dest.remove) {
      if (t.dest.sell) { const v = d.sellValue(); g.park.earn(v, 'Sales'); g.notify(`Sold ${d.sp.name} "${d.name}" for $${v.toLocaleString()}.`, 'good'); g.park.stats.retired++; if (d.sp.diet === 'carn') g.park.stats.retiredCarn++; }
      d.carried = false;
      g.removeDino(d);
    } else {
      d.carried = false;
      d.x = t.dest.x; d.z = t.dest.z;
      if (t.type === 'move') d.home = { x: d.x, z: d.z };
      d.escaped = false;
      g.markRegionsDirty();
      g.notify(`${d.sp.name} "${d.name}" has been relocated.`, 'good', { dino: d });
    }
    this.carry = null;
    this.endTask();
  }
  dropCarry() { if (this.carry) { this.carry.carried = false; this.carry = null; } }
  endTask() { if (this.task) this.g.acuDone(this.task); this.task = null; this.phase = ''; }
  camPos() { return { x: this.x + Math.cos(this.heading) * 0.3, y: this.y - 0.45, z: this.z + Math.sin(this.heading) * 0.3, yaw: this.heading }; }
  dispose() { this.g.root.remove(this.mesh); this.removed = true; if (this.task) this.g.acuDone(this.task); }
}

// ============ SAFARI JEEP ============
export class SafariJeep {
  constructor(game, station, n) {
    this.kind = 'jeep';
    this.g = game; this.b = station; this.n = n;
    this.state = 'wait'; this.s = 0; this.waitT = 0; this.pass = []; this.funAcc = 0; this.viewT = 0;
    this.mesh = vehicleMesh(geo('safari', () => jeepGeometry(0xe0a020, 0x2a6a2a)));
    game.root.add(this.mesh);
    this.x = station.cx; this.z = station.cz; this.heading = 0; this.controlled = false; this.speed = 0;
    this.hp = 100;
    this.park();
  }
  // Rammed by an angry dinosaur. A wrecked Land Cruiser strands its guests until the ranger helicopter comes.
  hit(dmg) {
    if (this.hp <= 0) return;
    this.hp = Math.max(0, this.hp - dmg);
    if (this.controlled) G.engine.shake = Math.max(G.engine.shake || 0, 0.6);
    G.audio?.playAt('crash', this.x, this.z, 0.8);
    if (this.hp > 0) { for (const v of this.pass) if (!v.gone && chance(0.3)) this.g.visitors.think(v, 'AAAH! It is attacking the car!', true); return; }
    const g = this.g, map = g.map, tile = map.idx(clamp(Math.floor(this.x), 0, map.W - 1), clamp(Math.floor(this.z), 0, map.H - 1));
    this.state = 'wrecked'; this.t = 0;
    g.burst(this.x, 0.6, this.z, 0x404040, 40);
    let stranded = 0;
    for (const v of this.pass) {
      if (v.gone) continue;
      v.inB = null; v.x = this.x + rand(-0.6, 0.6); v.z = this.z + rand(-0.6, 0.6); v.tile = tile; v.next = -1;
      v.happy = Math.max(0, v.happy - 30);
      if (map.path[tile] === 1) { v.plan = 'wander'; v.steps = 3; } else { v.plan = 'stranded'; v.strandT = 0; stranded++; }
    }
    this.pass = [];
    g.park.safetyHit(8);
    for (const d of g.dinos) if (d.jeepTarget === this) { d.jeepTarget = null; d.setState('idle', 3); }
    if (G.engine.cam.follow === this) g.exitControl();
    g.notify(`A dinosaur has wrecked a Safari Land Cruiser!${stranded ? ` ${stranded} guests are stranded: the ranger helicopter will try to rescue them.` : ''}`, 'danger', { x: this.x, z: this.z }, 'warden');
  }
  park() {
    const b = this.b;
    const r = b.route;
    if (r && r.length) { this.x = r[0].x + (this.n ? 0.25 : -0.25); this.z = r[0].z; }
    else { this.x = b.cx + (this.n - 0.5) * 0.9; this.z = b.cz; }
  }
  get busyText() { return this.state === 'stalled' ? 'Broken down on the track' : this.state === 'wrecked' ? 'Wrecked: a replacement is on its way' : this.state === 'tour' ? `On tour (${this.pass.length} guests)` : this.b.route && this.b.route.length > 4 ? `Boarding (${this.pass.length}/4)` : 'No track connected'; }
  update(dt) {
    const g = this.g, b = this.b;
    if (b.removed) { this.unload(); this.dispose(); return; }
    const route = b.route;
    const valid = route && route.length > 4 && !b.broken;
    if (this.state === 'stalled') {
      // broken down out on the track: drive it home yourself, or rangers tow it back after a while
      this.t += dt;
      if (this.controlled) { this.state = 'tour'; }
      else if (this.t > 45) { this.unload(); this.state = 'wait'; this.s = 0; this.park(); this.place(); g.notify('Rangers towed the broken-down Land Cruiser back to its station.', 'info', null, 'warden'); }
      return;
    }
    if (this.state === 'wrecked') {
      // a replacement car arrives at the station after a while
      this.t += dt;
      this.mesh.rotation.z = Math.min(0.5, this.t);
      if (this.t > 60) { this.state = 'wait'; this.hp = 100; this.s = 0; this.mesh.rotation.z = 0; g.park.forceSpend(1000, 'Upkeep'); this.park(); this.place(); }
      return;
    }
    if (this.state === 'wait') {
      if (!valid) { this.park(); this.place(); return; }
      if (this.n > 0 && b.jeeps[0].state === 'wait') { this.park(); this.place(); return; } // queue behind first jeep
      this.waitT += dt;
      while (this.pass.length < 4 && b.queue && b.queue.length) {
        const v = b.queue.shift();
        if (v.gone) continue;
        v.plan = 'ride';
        const fare = buildingPrice(b);
        v.money -= fare; g.park.earn(fare * PARTY, 'Rides');
        b.income = (b.income || 0) + fare * PARTY; b.visits = (b.visits || 0) + 1;
        this.pass.push(v);
      }
      if (this.controlled || this.pass.length >= 4 || (this.pass.length && this.waitT > 6)) { this.state = 'tour'; this.s = 0; this.funAcc = 0; this.waitT = 0; this.rideSp = new Set(); }
      this.s = 0;
    } else if (this.state === 'tour') {
      if (!valid) { this.unload(); this.state = 'wait'; return; }
      let sp = 2.0;
      if (this.controlled) {
        const k = G.engine.keys;
        let target = 0.6;
        if (k.has('w')) target = 3.2; else if (k.has('s')) target = -1.2; else if (k.has(' ')) target = 0;
        this.speed = lerp(this.speed, target, Math.min(1, dt * 2));
        sp = this.speed;
        // driving it yourself, you can run over small dinosaurs (Dryosaurus, Gallimimus, raptors...)
        if (Math.abs(sp) > 1.8) for (const d of g.dinos) {
          if (d.dead || d.len > 1.6 || dist2(d.x, d.z, this.x, this.z) > 0.5) continue;
          d.die('run over by a Land Cruiser'); g.burst(d.x, 0.3, d.z, 0xa02020, 14);
        }
      } else {
        // the automatic tour stops for a dinosaur on the track and honks until it moves
        const ahead = g.dinos.find((d) => !d.dead && d.tranq <= 0 && dist2(d.x, d.z, this.x + Math.cos(this.heading) * 1.2, this.z + Math.sin(this.heading) * 1.2) < (0.6 + d.len * 0.3) ** 2);
        if (ahead) { sp = 0; this.honkT = (this.honkT || 0) - dt; if (this.honkT <= 0) { this.honkT = 2.5; G.audio?.playAt('honk', this.x, this.z, 0.6); if (ahead.state !== 'hunt_jeep') ahead.fleeFrom(this, 2); } }
      }
      this.s = Math.max(0, this.s + sp * dt);
      // Land Cruisers sometimes break down on the track (the Let's Play saw this often)
      if (!this.controlled && chance(dt * 0.0015)) { this.state = 'stalled'; this.t = 0; g.notify('A Land Cruiser has broken down on the safari track. Take control to drive it back, or the rangers will tow it.', 'warn', { x: this.x, z: this.z }, 'warden'); this.place(); return; }
      this.viewT -= dt;
      if (this.viewT <= 0) {
        this.viewT = 1;
        g.rideExperience(b, this.x, this.z, 9);
        for (const d of g.dinos) {
          if (d.dead || d.carried) continue;
          const r2 = dist2(d.x, d.z, this.x, this.z);
          if (r2 < 81) { this.funAcc += d.sp.value * 0.35 * d.growth * (d.state === 'hunt' || d.state === 'fight' ? 2 : 1); this.rideSp?.add(d.sp.id); }
          // large carnivores and Triceratops may charge a car driving through their enclosure
          if (r2 < 64 && d.tranq <= 0 && !['hunt_jeep', 'sleep', 'flee'].includes(d.state) && ((d.sp.diet === 'carn' && SIZE_RANK[d.sp.size] >= 3) || d.sp.id === 'triceratops')
            && d.region() && d.region() === g.map.regionAt(this.x, this.z) && !g.beaconNear(this.x, this.z)
            && chance((d.sp.diet === 'carn' ? 0.05 : 0.025) * (d.hunger < 50 || d.stress > 60 ? 2 : 1))) { d.jeepTarget = this; d.path = null; d.setState('hunt_jeep', 12); d.roar(1); }
        }
      }
      if (this.s >= b.routeLen) { this.unload(); this.state = 'wait'; this.s = 0; }
    }
    this.place();
  }
  place() {
    const route = this.b.route;
    if (this.state === 'tour' && route && route.length > 1) {
      const p = sampleRoute(route, this.b.routeCum, this.s);
      this.x = p.x; this.z = p.z;
      this.heading = angleLerp(this.heading, p.a, 0.2);
    }
    const y = Math.max(this.g.map.heightAt(this.x, this.z), -0.2) + 0.04;
    this.mesh.position.set(this.x, y, this.z);
    this.mesh.rotation.y = -this.heading;
  }
  unload() {
    for (const v of this.pass) if (!v.gone) this.g.visitors.returnFromRide(v, this.b, Math.min(80, this.funAcc), this.rideSp?.size || 0);
    this.pass = [];
  }
  camPos() { return { x: this.x - Math.cos(this.heading) * 0.05, y: this.mesh.position.y + 0.62, z: this.z - Math.sin(this.heading) * 0.05, yaw: this.heading }; }
  dispose() { this.g.root.remove(this.mesh); this.removed = true; }
}

export function sampleRoute(route, cum, s) {
  let lo = 0, hi = cum.length - 1;
  while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
  const a = route[lo], b = route[Math.min(lo + 1, route.length - 1)];
  const seg = cum[lo + 1] - cum[lo] || 1;
  const t = clamp((s - cum[lo]) / seg, 0, 1);
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, a: Math.atan2(b.z - a.z, b.x - a.x) };
}

// ============ BALLOON ============
export class Balloon {
  constructor(game, station) {
    this.kind = 'balloon';
    this.g = game; this.b = station;
    this.x = station.cx; this.z = station.cz; this.y = 0.2; this.heading = 0;
    this.state = 'wait'; this.t = 0; this.pass = []; this.funAcc = 0; this.waitT = 0; this.controlled = false;
    this.mesh = vehicleMesh(geo('balloon', balloonGeometry));
    game.root.add(this.mesh);
    this.ang = 0;
  }
  get busyText() { return this.state === 'crashed' ? 'Crashed! Waiting for a new balloon' : this.state === 'fly' ? `Flying (${this.pass.length} guests)` : this.stormy() ? 'Grounded by the storm' : `Boarding (${this.pass.length}/4)`; }
  stormy() { const w = this.g.park.weather.type; return w === 'storm' || w === 'twister'; }
  // Struck by lightning: the basket falls. Guests who land on a path walk away; the rest are stranded until rescued.
  crash(cause = 'lightning') {
    const g = this.g, map = g.map, W = map.W;
    const tx = clamp(Math.floor(this.x), 0, W - 1), tz = clamp(Math.floor(this.z), 0, W - 1), tile = map.idx(tx, tz);
    this.state = 'crashed'; this.t = 0;
    g.burst(this.x, this.y, this.z, 0xfff0a0, 40);
    G.audio?.playAt('crash', this.x, this.z, 1);
    let stranded = 0;
    for (const v of this.pass) {
      if (v.gone) continue;
      v.inB = null; v.x = this.x + rand(-0.6, 0.6); v.z = this.z + rand(-0.6, 0.6); v.tile = tile; v.next = -1;
      v.happy = Math.max(0, v.happy - 30);
      if (map.path[tile] === 1) { v.plan = 'wander'; v.steps = 3; }
      else { v.plan = 'stranded'; v.strandT = 0; stranded++; }
      g.visitors.think(v, 'AAAH! The balloon is going down!', true);
    }
    this.pass = [];
    g.park.safetyHit(8);
    g.notify(`${cause === 'lightning' ? 'Lightning struck the Balloon Tour and it crashed!' : 'The Balloon Tour broke down and came down!'}${stranded ? ` ${stranded} guests are stranded: the ranger helicopter will try to rescue them.` : ''}`, 'danger', { x: this.x, z: this.z }, 'warden');
  }
  update(dt) {
    const g = this.g, b = this.b;
    if (b.removed) { this.unload(); this.dispose(); return; }
    const DUR = 55;
    if (this.state === 'crashed') {
      this.t += dt;
      this.y = lerp(this.y, g.map.heightAt(this.x, this.z) + 0.1, Math.min(1, dt * 2));
      if (this.t > 40) { this.state = 'wait'; this.x = b.cx; this.z = b.cz; this.y = 0.2; }
      this.mesh.position.set(this.x, Math.max(this.y, g.map.heightAt(this.x, this.z) + 0.1), this.z);
      this.mesh.rotation.z = Math.min(1.4, this.t);
      return;
    }
    this.mesh.rotation.z = 0;
    // in a storm the balloon stays on the ground and flights in progress head home
    if (this.stormy() && this.state === 'fly' && !this.controlled) this.state = 'return';
    if (this.state === 'wait') {
      this.waitT += dt;
      while (this.pass.length < 4 && b.queue && b.queue.length) {
        const v = b.queue.shift();
        if (v.gone) continue;
        const fare = buildingPrice(b);
        v.plan = 'ride'; v.money -= fare; g.park.earn(fare * PARTY, 'Rides');
        b.income = (b.income || 0) + fare * PARTY; b.visits = (b.visits || 0) + 1;
        this.pass.push(v);
      }
      if (!b.broken && !this.stormy() && (this.controlled || this.pass.length >= 4 || (this.pass.length && this.waitT > 8))) { this.state = 'fly'; this.t = 0; this.funAcc = 0; this.waitT = 0; this.ang = rand(0, 6.28); this.rideSp = new Set(); this.wp = 0; }
      this.x = lerp(this.x, b.cx, Math.min(1, dt)); this.z = lerp(this.z, b.cz, Math.min(1, dt)); this.y = lerp(this.y, 0.2, Math.min(1, dt));
    } else {
      this.t += dt;
      const W = g.map.W;
      const k = G.engine.keys;
      if (this.state !== 'fly') { /* returning */ } else if (this.controlled) {
        let vx = 0, vz = 0;
        const yaw = G.engine.cam.rideYaw - this.heading;
        if (k.has('w')) { vx += Math.cos(-yaw); vz += Math.sin(-yaw); }
        if (k.has('s')) { vx -= Math.cos(-yaw); vz -= Math.sin(-yaw); }
        if (k.has('a')) { vx += Math.sin(-yaw); vz -= Math.cos(-yaw); }
        if (k.has('d')) { vx -= Math.sin(-yaw); vz += Math.cos(-yaw); }
        this.x = clamp(this.x + vx * 3 * dt, 4, W - 4); this.z = clamp(this.z + vz * 3 * dt, 4, W - 4);
        this.y = lerp(this.y, 9, Math.min(1, dt * 0.5));
        if (this.t > DUR * 1.6) this.state = 'return';
      } else if ((this.poles = g.balloonPoles(b)).length) {
        // follow the route poles in order, then fly home
        const p = this.poles[Math.min(this.wp || 0, this.poles.length - 1)];
        const d = dist(this.x, this.z, p.cx, p.cz), sp = 2.2 * dt;
        if (d > 0.01) { this.x += (p.cx - this.x) / d * Math.min(sp, d); this.z += (p.cz - this.z) / d * Math.min(sp, d); }
        this.y = lerp(this.y, 9, Math.min(1, dt * 0.5));
        if (d < 1) { this.wp = (this.wp || 0) + 1; if (this.wp >= this.poles.length) this.state = 'return'; }
        if (this.t > DUR * 4) this.state = 'return';
      } else {
        const R = 20;
        const prog = this.t / DUR;
        this.ang += dt * 0.11;
        const cx = clamp(b.cx, R + 4, W - R - 4), cz = clamp(b.cz, R + 4, W - R - 4);
        const ramp = Math.min(1, prog * 5, (1 - prog) * 5);
        const tx = lerp(b.cx, cx + Math.cos(this.ang) * R, ramp), tz = lerp(b.cz, cz + Math.sin(this.ang) * R, ramp);
        this.x = lerp(this.x, tx, Math.min(1, dt * 0.8)); this.z = lerp(this.z, tz, Math.min(1, dt * 0.8));
        this.y = 0.2 + ramp * 9;
        if (this.t >= DUR) this.state = 'return';
      }
      // balloons occasionally break down and land wherever they are
      if (this.state === 'fly' && !this.controlled && this.y > 4 && chance(dt * 0.0008)) { this.crash('breakdown'); return; }
      this.viewT = (this.viewT || 0) - dt;
      if (this.viewT <= 0) {
        this.viewT = 1;
        if (this.state === 'fly') g.rideExperience(b, this.x, this.z, 16);
        for (const d of g.dinos) if (!d.dead && !d.carried && dist2(d.x, d.z, this.x, this.z) < 256) { this.funAcc += d.sp.value * 0.25 * d.growth; this.rideSp?.add(d.sp.id); }
      }
      if (this.state === 'return') {
        this.x = lerp(this.x, b.cx, Math.min(1, dt * 0.6)); this.z = lerp(this.z, b.cz, Math.min(1, dt * 0.6));
        if (dist(this.x, this.z, b.cx, b.cz) < 0.5) { this.y = lerp(this.y, 0.2, Math.min(1, dt)); if (this.y < 0.4) { this.unload(); this.state = 'wait'; } }
      }
    }
    this.mesh.position.set(this.x, Math.max(this.y, g.map.heightAt(this.x, this.z) + 0.15), this.z);
    this.mesh.rotation.y = Math.sin(g.time * 0.2) * 0.3;
  }
  unload() { for (const v of this.pass) if (!v.gone) this.g.visitors.returnFromRide(v, this.b, Math.min(90, this.funAcc), this.rideSp?.size || 0); this.pass = []; }
  camPos() { return { x: this.x, y: this.mesh.position.y + 0.55, z: this.z, yaw: this.heading }; }
  dispose() { this.g.root.remove(this.mesh); this.removed = true; }
}
