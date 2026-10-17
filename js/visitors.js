// Park visitors: needs, path-following, attractions, panic. Rendered with instancing.
import * as THREE from 'three';
import { G } from './state.js';
import { BLD, DAY_SECONDS, SPECIES_BY_ID, PARTY, VTYPES, MENUS, buildingPrice } from './data.js';
import { INF, T } from './map.js';
import { clamp, rand, randi, pick, chance, dist, dist2, visitorName, lerp } from './util.js';
import { MAT, visitorGeometries, heliGeometry, rotorGeometry } from './models.js';
import { PEOPLE, POSES, peopleLoaded } from './people.js';

const MAX = 600;
// the large carnivores that swallow guests whole in the original; guests often freeze in front of them
const SWALLOWERS = new Set(['tyrannosaurus', 'spinosaurus', 'acrocanthosaurus', 'allosaurus']);
const PER_POSE = 160; // instances per character pose frame
const SHIRTS = [0xe04040, 0x3a7ad0, 0xf0c030, 0x40a050, 0xf08030, 0xa050c0, 0xffffff, 0x30b0b0, 0xe070a0, 0x2a2a2a, 0xc0e040];
const NEED_CAT = { hunger: 'hunger', thirst: 'thirst', bladder: 'bladder', energy: 'energy', shop: 'shop' };
const NEED_THOUGHT = {
  hunger: ["I'm starving! Where's the food?", 'I could eat a Triceratops.'],
  thirst: ["So thirsty... where's a drinks stand?", 'I need a drink.'],
  bladder: ['I really need a restroom!', 'Where are the toilets?!'],
  energy: ["I'm exhausted. Is there anywhere to rest?", 'My feet hurt.'],
  shop: ["I'd love a souvenir.", 'Is there a gift shop?'],
};
const COMPLAINT = { hunger: 'food', thirst: 'drinks', bladder: 'restrooms', energy: 'rest', shop: 'shops' };

let VID = 1;

export class VisitorSystem {
  constructor(game) {
    this.g = game;
    this.list = [];
    this.fields = new Map();
    this.fv = '';
    this.spawnT = 2;
    this.complaints = { food: 0, drinks: 0, restrooms: 0, rest: 0, shops: 0, dinos: 0, fee: 0, danger: 0, litter: 0 };
    this.warnedNoPath = false;
    const geo = visitorGeometries();
    this.bodyMesh = new THREE.InstancedMesh(geo.body, MAT.std, MAX);
    this.restMesh = new THREE.InstancedMesh(geo.rest, MAT.std, MAX);
    this.umbMesh = new THREE.InstancedMesh(geo.umbrella, MAT.std, MAX);
    this.umbMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.umbMesh.count = 0; this.umbMesh.frustumCulled = false; game.root.add(this.umbMesh);
    this.bodyMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    for (const m of [this.bodyMesh, this.restMesh]) { m.count = 0; m.castShadow = true; m.frustumCulled = false; game.root.add(m); }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3(); this._c = new THREE.Color();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  get count() { return this.list.length; }
  avgHappiness() { return this.list.length ? this.list.reduce((a, v) => a + v.happy, 0) / this.list.length : 50; }

  // ---------- distance fields ----------
  field(key) {
    const map = this.g.map;
    const ver = `${map.ver.path}|${map.ver.bld}|${map.ver.fence}|${this.g.bldVersion}`;
    if (ver !== this.fv) { this.fields.clear(); this.fv = ver; this.g.rebuildAccessIndex(); }
    let f = this.fields.get(key);
    if (f) return f;
    const src = [];
    if (key === 'exit') for (const b of this.g.entrances()) src.push(b.access);
    else {
      for (const b of this.g.buildings.values()) {
        if (b.broken || b.shut || b.access < 0) continue;
        const def = BLD[b.type];
        if (key === 'view' ? def.fn === 'view' : key === 'safari' ? def.fn === 'safari' && b.route && b.route.length > 4 : key === 'balloon' ? def.fn === 'balloon' : key === 'shelter' ? def.fn === 'shelter' : def.need === key || def.also === key) src.push(b.access);
      }
      // tired guests also head for benches (the path tile beside each bench)
      if (key === 'energy') for (const b of this.g.buildings.values()) if (b.type === 'bench' && !b.broken) { const t = this.g.benchTile(b); if (t >= 0) src.push(t); }
    }
    f = map.bfsField(src);
    f.empty = src.length === 0;
    this.fields.set(key, f);
    return f;
  }

  // ---------- spawning ----------
  update(dt) {
    const g = this.g, park = g.park;
    if (park.mode === 'siteb' || park.mode === 'demo') return;
    // Each helicopter trip lands at one of the park's entrances.
    const ents = g.entrances().filter((b) => g.map.path[b.access] === 1);
    const exitTile = g.entranceAccess();
    if (!ents.length && exitTile >= 0 && !this.warnedNoPath && park.day >= 1 && g.time > 20) {
      this.warnedNoPath = true;
      g.notify('Visitors can\'t get in! Build a footpath from the Park Entrance.', 'warn', { x: exitTile % g.map.W + 0.5, z: Math.floor(exitTile / g.map.W) + 0.5 });
    }
    this.updateCopter(dt, ents.length > 0 && park.isOpen, ents);
    for (let i = 0; i < this.list.length; i++) {
      const v = this.list[i];
      this.updateVisitor(v, dt);
      if (v.gone) { this.list.splice(i--, 1); }
    }
    park.stats.peakVisitors = Math.max(park.stats.peakVisitors, this.list.length);
    for (const k in this.complaints) this.complaints[k] *= Math.pow(0.5, dt / DAY_SECONDS);
  }

  // Guests fly in by tourist helicopter, up to 25 per trip, more often as the park's rating rises.
  // How natural and prehistoric the view around a tile is (0..1), after the original's authenticity weights:
  // water, prehistoric plants and hills add; buildings and paths take away.
  localAuth(cx, cy, R) {
    const map = this.g.map;
    let n = 0, water = 0, paleo = 0, modern = 0, hill = 0, bld = 0, path = 0;
    for (let y = cy - R; y <= cy + R; y += 2) for (let x = cx - R; x <= cx + R; x += 2) {
      if (!map.inb(x, y)) continue;
      const i = map.idx(x, y), t = map.terrain[i];
      if (t === T.SEA) continue;
      n++;
      if (t === T.WATER) water++;
      else if (t === T.ROCK && map.rockH[i] > 1.2) hill++;
      const f = map.flora[i];
      if (f === 2 || f === 4 || f === 5) paleo++; else if (f === 1 || f === 3) modern++;
      if (map.bld[i] >= 0) bld++;
      if (map.path[i]) path++;
    }
    if (!n) return 0.5;
    return clamp(0.3 + (0.8 * water + 2.2 * paleo + 0.5 * modern + 1.2 * hill - 2.4 * bld - 0.9 * path) / n, 0, 1);
  }

  // Emergency: everyone runs for a shelter, or for the exit if there is no shelter to reach.
  emergency() {
    const sh = this.field('shelter');
    for (const v of this.list) {
      if (v.gone || v.plan === 'ride' || v.plan === 'queue' || (v.plan === 'inside' && BLD[v.inB?.type]?.fn === 'shelter')) continue;
      v.plan = 'flee'; v.field = !sh.empty && sh[v.tile] < INF ? 'shelter' : 'exit'; v.inB = null;
      if (chance(0.2)) this.think(v, 'An emergency? Get to the shelter!', true);
    }
  }
  allClear() {
    for (const v of this.list) if (v.plan === 'inside' && BLD[v.inB?.type]?.fn === 'shelter') { v.stayT = rand(0, 3); }
  }
  // Closing time: everyone still in the park heads for the exit.
  closePark() {
    for (const v of this.list) {
      if (v.gone || v.plan === 'leave' || v.plan === 'ride' || v.plan === 'inside' || v.plan === 'queue') continue; // these leave once they come out
      v.plan = 'leave'; v.field = 'exit';
      if (Math.random() < 0.3) this.think(v, 'The park is closing already?');
    }
  }
  updateCopter(dt, open, ents) {
    const g = this.g, park = g.park;
    const c = (this.copter = this.copter || { state: 'away', t: 4, x: 0, z: 0, y: 14, load: 0 });
    if (c.state === 'away' && ents.length && (!c.ent || !ents.includes(c.ent))) c.ent = ents[Math.floor(Math.random() * ents.length)];
    if (c.ent && (c.ent.removed || c.ent.broken)) { c.ent = null; if (c.state !== 'away') c.state = 'out'; }
    const ent = c.ent, pad = ent ? g.entrancePad(ent) : c.lastPad;
    if (!pad) return;
    c.lastPad = pad;
    const exitTile = ent ? ent.access : -1;
    if (!c.mesh) {
      c.mesh = new THREE.Group();
      c.mesh.add(new THREE.Mesh(heliGeometry(0xeeeeea, 0xc0301a), MAT.std));
      c.rotor = new THREE.Mesh(rotorGeometry(), MAT.std); c.rotor.position.y = 0.8; c.mesh.add(c.rotor);
      c.mesh.scale.setScalar(1.6); c.mesh.traverse((o) => { o.castShadow = true; });
      g.root.add(c.mesh);
    }
    const toward = (tx, ty, tz, sp) => {
      const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz);
      if (d > 0.05) { const s = Math.min(sp * dt, d); c.x += (dx / d) * s; c.z += (dz / d) * s; c.heading = Math.atan2(dz, dx); }
      c.y += clamp(ty - c.y, -3 * dt, 3 * dt);
      return d < 0.3 && Math.abs(ty - c.y) < 0.15;
    };
    if (c.state === 'away') {
      c.t -= dt;
      c.x = pad.x; c.z = pad.z + 70; c.y = 14;
      const cap = Math.min(park.visitorCapacity(), MAX);
      if (c.t <= 0 && open && !park.emergency && this.list.length < cap) {
        const fair = park.fairFee();
        const feeOk = park.fee <= fair ? 1 : Math.pow(fair / park.fee, 2);
        // each tourist helicopter brings 5 to 15 guests, as in the original (fewer if the fee is off-putting or the park is nearly full)
        c.load = Math.max(1, Math.min(cap - this.list.length, Math.round(randi(5, 15) * Math.min(1, feeOk + 0.2))));
        if (feeOk < 1) this.complaints.fee += (1 - feeOk) * 3;
        c.state = 'in';
      } else if (c.t <= 0) c.t = 5;
    } else if (c.state === 'in') {
      if (toward(pad.x, pad.y + 0.1, pad.z, 9)) { c.state = 'land'; c.t = 0.6; }
    } else if (c.state === 'land') {
      c.t -= dt;
      if (c.t <= 0 && c.load > 0 && exitTile >= 0) { c.t = 0.15; c.load--; this.spawn(exitTile); }
      if (exitTile < 0) c.load = 0;
      if (c.load <= 0 && c.t <= 0) { c.state = 'out'; }
    } else if (c.state === 'out') {
      if (toward(pad.x - 30, 16, pad.z + 60, 9)) { c.state = 'away'; c.ent = null; c.t = clamp(28 - park.rating.stars * 4.5, 6, 28) * rand(0.8, 1.2); }
    }
    const flying = c.state !== 'away';
    c.mesh.visible = flying;
    c.rotor.rotation.y += dt * (c.state === 'land' ? 18 : 30);
    c.mesh.position.set(c.x, c.y, c.z);
    c.mesh.rotation.y = -(c.heading || 0);
    if (flying) G.audio?.heliNear(c.x, c.z);
  }

  spawn(tile) {
    const g = this.g, map = g.map, park = g.park;
    const x = (tile % map.W) + 0.5, z = Math.floor(tile / map.W) + 0.5;
    const fee = park.fee;
    const vtype = park.pickVType();
    const v = {
      vtype,
      id: VID++, name: visitorName(), x, z, tile, next: -1, last: -1, off: rand(-0.3, 0.3), speed: rand(0.75, 1.05),
      hunger: rand(0, 40), thirst: rand(0, 40), bladder: rand(0, 30), energy: rand(80, 100), fun: rand(35, 55), shop: rand(0, 50),
      // visit length as in the original: a few minutes, longer in a highly rated park
      stay: rand(150, 420) + (park.rating.stars / 5) * rand(0, 480),
      money: rand(120, 320), happy: rand(55, 72), seen: new Set(), thought: 'What a beautiful island!', thoughtT: 0,
      color: pick(VTYPES[vtype].shirts), plan: 'wander', steps: randi(3, 10), field: null, inB: null, stayT: 0, t: 0, panic: 0, tried: {}, rideT: 0, bob: rand(0, 6),
    };
    if (fee > park.fairFee()) { v.happy -= (fee - park.fairFee()) * 0.6; v.thought = 'The entry fee is a rip-off!'; this.complaints.fee++; }
    v.money -= 0; // entry paid at gate
    park.earn(fee * PARTY, 'Entry');
    park.stats.visitorsTotal++;
    this.list.push(v);
    return v;
  }

  think(v, text, force) {
    if (!force && v.thoughtT > 0) return;
    v.thought = text; v.thoughtT = 6;
    // the guest's passport keeps their last few remarks
    (v.log ||= []).unshift(text);
    if (v.log.length > 5) v.log.pop();
  }

  // ---------- per-visitor update ----------
  updateVisitor(v, dt) {
    const g = this.g, park = g.park, map = g.map;
    v.t += dt;
    v.thoughtT -= dt;
    // needs
    if (v.plan !== 'inside' || !v.inB || BLD[v.inB.type].need !== 'energy') {
      v.hunger = Math.min(100, v.hunger + dt * 0.5);
      v.thirst = Math.min(100, v.thirst + dt * 0.62 * (park.weather.type === 'heat' ? 1.8 : 1));
      v.bladder = Math.min(100, v.bladder + dt * 0.45);
      v.energy = Math.max(0, v.energy - dt * 0.4);
      v.shop = Math.min(100, v.shop + dt * 0.25);
    }
    v.fun = Math.max(0, v.fun - dt * 0.4);
    // happiness target
    // Base mood, plus fun and variety of species seen, minus unmet needs.
    const needPen = (Math.max(0, v.hunger - 55) + Math.max(0, v.thirst - 55) + Math.max(0, v.bladder - 55)) * 0.35 + Math.max(0, 30 - v.energy) * 0.5;
    let target = 35 + v.fun * 0.4 + Math.min(16, v.seen.size * 2.5) + (v.joy || 0) - needPen;
    if (v.panic > 0) target -= v.cam ? 20 : 30;
    if (v.cam) target += 4; // security cameras reassure guests
    if (v.vtype === 'environmental' && v.auth != null) target += (v.auth - 0.5) * 14;
    const w = park.weather.type;
    if (w === 'storm' || w === 'twister') target -= 15;
    else if (w === 'rain') target -= park.has('weatherguard') ? 3 : 9;
    else if (w === 'heat') { target -= 6; if (chance(dt * 0.01)) this.think(v, pick(["It's so hot! I wish there was somewhere air-conditioned.", 'This heat is unbearable.'])); }
    v.happy = clamp(lerp(v.happy, target, Math.min(1, dt * 0.03)), 0, 100);
    v.panic = Math.max(0, v.panic - dt);

    // watching dinosaurs
    v.viewT = (v.viewT || rand(0, 1)) - dt;
    if (v.viewT <= 0 && v.plan !== 'ride') {
      v.viewT = 1;
      v.cam = !!g.cameraNear(v.x, v.z);
      if (v.vtype === 'environmental' && (v.authT = (v.authT || 0) - 1) <= 0) {
        v.authT = 5;
        v.auth = this.localAuth(Math.floor(v.x), Math.floor(v.z), 6);
        if (v.auth > 0.75 && chance(0.15)) this.think(v, pick(['It feels like stepping back in time.', 'Look at those ancient plants!']));
        else if (v.auth < 0.25 && chance(0.15)) this.think(v, pick(['Too much concrete. Where is the nature?', 'This does not look prehistoric at all.']));
      }
      let R = 6.5, mul = 1, ox = v.x, oz = v.z;
      if (v.plan === 'inside' && v.inB && BLD[v.inB.type].fn === 'view') {
        const b = v.inB, bias = b.menu?.bias || 'neutral';
        const vp = g.viewPoint(b);
        R = BLD[b.type].view + (b.type === 'platform' && park.has('binoculars') ? 4 : 0); mul = BLD[b.type].fun || 1.2; ox = vp.cx; oz = vp.cz;
        // a themed attraction thrills its own kind of guest and bores the others a little
        if (bias !== 'neutral') mul *= bias === v.vtype ? 1.5 : v.vtype === 'neutral' ? 1 : 0.75;
      }
      if (v.plan !== 'inside' || mul > 1 || (v.inB && BLD[v.inB.type].fn === 'view')) this.watch(v, ox, oz, R, mul);
    }
    // danger check
    v.dangerT = (v.dangerT || rand(0, 1)) - dt;
    if (v.dangerT <= 0) {
      v.dangerT = 1;
      const d = g.escapedNear(v.x, v.z, 13);
      if (d && v.plan !== 'inside' && v.plan !== 'ride') {
        if (v.plan !== 'flee') { v.happy -= 12; this.complaints.danger += 0.5; this.think(v, pick(['AAAH! A dinosaur is loose!', 'RUN!!', 'This is NOT part of the tour!']), true); if (chance(0.15)) G.audio?.playAt('scream', v.x, v.z, 0.6); }
        v.panic = 8;
        const sh = this.field('shelter');
        // as in the original, guests often freeze (running on the spot) when a large carnivore comes close
        if (v.plan !== 'freeze' && SWALLOWERS.has(d.sp.id) && dist2(d.x, d.z, v.x, v.z) < 49 && chance(0.5)) { v.plan = 'freeze'; v.freezeT = rand(1.5, 3.5); v.moving = false; }
        else if (v.plan !== 'freeze') { v.plan = 'flee'; v.field = sh.empty || sh[v.tile] >= INF ? 'exit' : 'shelter'; }
      } else if ((w === 'storm' || w === 'twister') && v.plan !== 'inside' && v.plan !== 'ride' && v.plan !== 'flee' && v.plan !== 'leave') {
        const sh = this.field('shelter');
        if (!sh.empty && sh[v.tile] < INF) { v.plan = 'flee'; v.field = 'shelter'; this.think(v, 'Storm! Get to the shelter!'); }
        else if (chance(0.08)) { v.plan = 'leave'; v.field = 'exit'; this.think(v, "This weather is awful. I'm going home."); }
      }
    }

    switch (v.plan) {
      case 'inside': this.updateInside(v, dt); return;
      // stranded off the paths after a balloon crash: waiting for the helicopter, slowly weakening
      case 'stranded': v.moving = false; v.happy = Math.max(0, v.happy - dt * 0.3); v.strandT = (v.strandT || 0) + dt; if (chance(dt * 0.02)) this.think(v, pick(['Help! Over here!', 'Is anyone coming for us?'])); if (v.strandT > 300) this.kill(v, null, 'exposure'); return;
      case 'sit': v.energy = Math.min(100, v.energy + dt * 5); v.stayT -= dt; v.moving = false; if (v.stayT <= 0) { v.plan = 'wander'; v.steps = randi(3, 8); } return;
      case 'queue': case 'ride': return; // handled by staff (jeeps / balloon)
      case 'freeze': { v.moving = false; v.freezeT -= dt; if (v.freezeT <= 0) { const sh = this.field('shelter'); v.plan = 'flee'; v.field = sh.empty || sh[v.tile] >= INF ? 'exit' : 'shelter'; } return; }
    }
    // leaving conditions
    if (v.plan !== 'leave' && v.plan !== 'flee') {
      const late = park.hour >= 19 || park.hour < 6;
      if (late || !park.parkOpen || v.energy < 4 || v.t > v.stay || v.money < 3) {
        v.plan = 'leave'; v.field = 'exit';
        if (v.energy < 4) this.think(v, 'Time to go home. What a day!');
        else if (v.money < 3) this.think(v, "I've spent all my money!");
      }
    }
    this.move(v, dt);
  }

  watch(v, x, z, R, mul) {
    const g = this.g;
    let gain = 0, best = null, bestV = 0;
    let thr = 0, fun = 0, aut = 0, na = 0;
    const R2 = R * R;
    for (const d of g.dinos) {
      if (d.carried) continue;
      const r2 = dist2(d.x, d.z, x, z);
      const rr = R + d.len * 0.4;
      if (r2 > rr * rr) continue;
      if (d.dead) { gain -= 1.5; continue; }
      let val = d.sp.value * 0.22 * d.growth;
      const action = d.state === 'hunt' || d.state === 'fight' || d.state === 'defend' || d.state === 'hunt_visitor' || d.state === 'joust' || d.state === 'rear';
      if (action || d.state === 'feeding') val *= 2.2;
      // Each guest type has its own taste (the original's entertainment analysers).
      const carn = d.sp.diet === 'carn';
      if (v.vtype === 'violent') val *= (carn ? 1.7 : 0.55) * (action ? 1.4 : 1) * (d.sp.id === 'brachiosaurus' ? 2 : 1);
      else if (v.vtype === 'nonviolent') {
        // Fun Lovers like herbivores living happy lives: content, healthy, playing together
        val *= carn ? 0.6 : 1.2 + 0.8 * (d.comfort / 100) + (d.state === 'play' ? 1 : ['socialize', 'grazing', 'eating'].includes(d.state) ? 0.4 : 0);
        if (action && d.state !== 'joust' && d.state !== 'rear') { val *= 0.25; if (chance(0.25)) this.think(v, pick(['That is horrible to watch!', 'I came to see gentle giants, not this.'])); }
      } else if (v.vtype === 'environmental') {
        const ea = g.regionStats(g.map.regionAt(d.x, d.z)?.id ?? -1).auth ?? 0.5;
        val *= 0.3 + 0.6 * (v.auth ?? 0.5) + 0.8 * ea;
        if (ea < 0.45 && chance(0.06)) this.think(v, pick(['Those dinosaurs never lived together!', 'Mixing Jurassic and Cretaceous animals? Really?']));
      }
      // sick dinosaurs are less appealing, and guests complain about the lack of care (Dino Belly most of all)
      if (d.disease) { val *= d.disease === 'belly' ? 0.4 : 0.7; if (chance(0.03)) { this.complaints.dinos += 0.2; this.think(v, pick(['That dinosaur looks sick.', "Doesn't anyone look after these animals?"])); } }
      // looking from a path through a Medium or High fence is harder than from an attraction
      if (v.plan !== 'inside') { const ft = g.regionStats(g.map.regionAt(d.x, d.z)?.id ?? -1).fenceTier || 0; if (ft >= 2) val *= ft === 3 ? 0.45 : 0.7; }
      if (!v.seen.has(d.sp.id)) { v.seen.add(d.sp.id); val += d.sp.value * 1.6; if (d.sp.value > bestV) { bestV = d.sp.value; best = d; } }
      gain += val;
      // the three parts of the original's "dino experience": thrills, fun and authenticity
      if (carn) thr += d.sp.value * (action || d.state === 'feeding' ? 2 : 0.4); else fun += d.sp.value * (d.comfort / 100) * (d.state === 'play' ? 2 : 1);
      if (action && !carn) thr += d.sp.value;
      aut += g.regionStats(g.map.regionAt(d.x, d.z)?.id ?? -1).auth ?? 0.5; na++;
    }
    const b = v.plan === 'inside' && v.inB && BLD[v.inB.type].fn === 'view' ? v.inB : null;
    if (b) {
      const e = (b.exp ||= { thr: 0, fun: 0, aut: 0 }), k = 0.05;
      e.thr += (Math.min(1, thr / 20) - e.thr) * k; e.fun += (Math.min(1, fun / 20) - e.fun) * k; e.aut += ((na ? aut / na : 0) - e.aut) * k;
    }
    // Dino Nerds hate seeing feeders and hatcheries: they spoil the natural look.
    if (v.vtype === 'environmental' && gain > 0) {
      let eyes = 0;
      for (const o of g.buildings.values()) { const fn = BLD[o.type].fn; if ((fn === 'feeder' || fn === 'hatchery') && dist2(o.cx, o.cz, x, z) < R2) eyes++; }
      if (eyes) { gain /= 1 + 0.4 * eyes; if (chance(0.05)) this.think(v, pick(['A feeding machine? That ruins the whole effect.', 'I can see the hatchery from here. So much for nature.'])); }
    }
    if (gain > 0) v.fun = Math.min(100, v.fun + gain * mul);
    else if (gain < 0) { v.fun = Math.max(0, v.fun + gain); if (chance(0.2)) this.think(v, 'Ew, is that a dead dinosaur?'); }
    if (best) this.think(v, pick([`Wow, a ${best.sp.name}!`, `I've never seen a ${best.sp.name} before!`, `Look at that ${best.sp.name}!`]), true);
  }

  updateInside(v, dt) {
    const b = v.inB;
    if (this.g.park.emergency && b && BLD[b.type].fn === 'shelter') return; // wait for the all-clear
    v.stayT -= dt;
    if (!b || b.removed || v.stayT <= 0 || (b.broken)) {
      v.plan = 'wander'; v.steps = randi(3, 10); v.inB = null;
      if (b && BLD[b.type].fn === 'view' && v.fun > 70) this.think(v, 'Amazing views!');
    }
  }

  // Choose what to do next at a tile.
  decide(v) {
    const g = this.g;
    if (v.plan === 'leave' || v.plan === 'flee') return;
    // needs
    const urg = [
      ['bladder', v.bladder - 60], ['hunger', v.hunger - 58], ['thirst', v.thirst - 55], ['energy', 30 - v.energy], ['shop', v.shop - 75],
    ].filter((n) => n[1] > 0 && !(v.tried[n[0]] > v.t)).sort((a, b) => b[1] - a[1]);
    for (const [need] of urg) {
      const f = this.field(need);
      if (!f.empty && f[v.tile] < INF) { v.plan = 'goto'; v.field = need; return; }
      // As in the original, shopping is a treat, not a need: no stand, no complaint.
      if (need === 'shop') { v.shop = 30; v.tried.shop = v.t + 60; continue; }
      v.tried[need] = v.t + 25;
      this.complaints[COMPLAINT[need]] += 1;
      this.think(v, pick(NEED_THOUGHT[need]), true);
      v.happy -= 3;
      if (need === 'energy' && v.energy < 25) { v.plan = 'leave'; v.field = 'exit'; return; }
    }
    if (v.fun < 60 && chance(0.6)) {
      const opts = [];
      for (const k of ['view', 'safari', 'balloon']) {
        if (v.tried[k] > v.t) continue;
        const f = this.field(k);
        if (!f.empty && f[v.tile] < INF) opts.push(k, k === 'view' ? null : k);
      }
      const choice = opts.filter(Boolean);
      if (choice.length) { const k = pick(choice); v.plan = 'goto'; v.field = k; return; }
      if (v.fun < 25 && g.dinos.length < 2) { this.complaints.dinos += 0.5; this.think(v, 'Where are all the dinosaurs?'); }
    }
    v.plan = 'wander'; v.steps = randi(4, 14);
  }

  move(v, dt) {
    const g = this.g, map = g.map, W = map.W;
    if (v.next < 0) {
      if (map.path[v.tile] !== 1) {
        // stranded (path removed)
        const n = this.neighbors(v.tile, true);
        if (n.length) v.next = n[0]; else { this.leavePark(v, false); return; }
      } else this.pickNext(v);
      if (v.next < 0) return;
    }
    const nx = (v.next % W) + 0.5, nz = Math.floor(v.next / W) + 0.5;
    const cx = (v.tile % W) + 0.5, cz = Math.floor(v.tile / W) + 0.5;
    const dx = nx - cx, dz = nz - cz;
    const tx = nx - dz * v.off, tz = nz + dx * v.off;
    const ddx = tx - v.x, ddz = tz - v.z, d = Math.hypot(ddx, ddz);
    const sp = v.speed * (v.plan === 'flee' ? 2.3 : 1) * (v.energy < 20 ? 0.7 : 1);
    v.heading = Math.atan2(ddz, ddx);
    if (d <= sp * dt) {
      v.x = tx; v.z = tz;
      v.last = v.tile; v.tile = v.next; v.next = -1;
      this.arriveTile(v);
    } else { v.x += (ddx / d) * sp * dt; v.z += (ddz / d) * sp * dt; v.moving = true; }
  }

  neighbors(i, anyPath) {
    const map = this.g.map, W = map.W, x = i % W, y = (i / W) | 0, out = [];
    for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + ax, ny = y + ay;
      if (!map.inb(nx, ny)) continue;
      const ni = map.idx(nx, ny);
      if (map.path[ni] !== 1) continue;
      if (!anyPath && !map.walkCross(x, y, nx, ny)) continue;
      out.push(ni);
    }
    return out;
  }

  pickNext(v) {
    const n = this.neighbors(v.tile);
    if (!n.length) { v.next = -1; return; }
    if ((v.plan === 'goto' || v.plan === 'leave' || v.plan === 'flee') && v.field) {
      const f = this.field(v.field);
      let best = -1, bd = f[v.tile];
      for (const ni of n) if (f[ni] < bd || (f[ni] === bd && best < 0 && false)) { bd = f[ni]; best = ni; }
      if (best >= 0) { v.next = best; return; }
      if (f[v.tile] >= INF) { v.tried[v.field] = v.t + 20; v.plan = 'wander'; v.steps = 6; }
    }
    const opts = n.length > 1 ? n.filter((x) => x !== v.last) : n;
    v.next = pick(opts);
  }

  arriveTile(v) {
    const g = this.g;
    if (v.plan === 'goto' || v.plan === 'leave' || v.plan === 'flee') {
      const f = this.field(v.field);
      if (f[v.tile] === 0) { this.arriveTarget(v); return; }
      if (f[v.tile] >= INF && v.plan === 'goto') { v.plan = 'wander'; v.steps = 5; }
    } else if (v.plan === 'wander') {
      v.steps--;
      if (v.steps <= 0 || chance(0.08)) this.decide(v);
    }
    // Litter: every guest scuffs a little dirt onto busy paths, and a guest who has just eaten drops the
    // wrapper a few tiles later unless a trash can is close by. Dirty paths annoy everyone.
    g.addLitter(v.tile, 0.0015);
    if (v.trash > 0 && --v.trash === 0) { if (!g.binNear(v.tile)) g.addLitter(v.tile, 0.12); }
    else if (v.trash > 0 && g.binNear(v.tile)) v.trash = 0;
    if (g.dirt[v.tile] > 0.35) { v.happy -= 0.5; this.complaints.litter += 0.05; if (chance(0.05)) this.think(v, pick(['This path is filthy!', 'Why is there rubbish everywhere?'])); }
    // tired guests sit on a bench for a while
    if (v.plan === 'wander' && v.energy < 50 && chance(0.6) && g.benchNear(v.tile)) { v.plan = 'sit'; v.stayT = rand(8, 14); this.think(v, 'Ahh, a bench. My feet are killing me.'); return; }
    // nearby decoration cheers people up
    if (chance(0.15) && g.decoNear(v.tile)) { v.joy = Math.min(12, (v.joy || 0) + 1.5); if (chance(0.1)) this.think(v, 'What a lovely park.'); }
  }

  arriveTarget(v) {
    const g = this.g, park = g.park;
    const key = v.field;
    if (key === 'exit') { this.leavePark(v, true); return; }
    const bs = g.accessIndex.get(v.tile) || [];
    const b = bs.find((bb) => {
      const def = BLD[bb.type];
      if (bb.broken) return false;
      if (key === 'view') return def.fn === 'view';
      if (key === 'safari') return def.fn === 'safari';
      if (key === 'balloon') return def.fn === 'balloon';
      if (key === 'shelter') return def.fn === 'shelter';
      return def.need === key || def.also === key;
    });
    if (!b) {
      if (key === 'energy' && g.benchNear(v.tile)) { v.plan = 'sit'; v.stayT = rand(10, 16); v.tried.energy = v.t + 30; return; }
      v.plan = 'wander'; v.steps = 4; return;
    }
    const def = BLD[b.type];
    if (def.fn === 'safari' || def.fn === 'balloon') {
      if (v.money < buildingPrice(b)) { this.think(v, "I can't afford the ride."); v.plan = 'wander'; v.steps = 5; v.tried[key] = v.t + 60; return; }
      if ((b.queue || (b.queue = [])).length >= 16) { this.think(v, 'The queue is too long!'); v.tried[key] = v.t + 40; v.plan = 'wander'; v.steps = 6; return; }
      b.queue.push(v);
      v.plan = 'queue'; v.inB = b; v.tried[key] = v.t + 80;
      return;
    }
    if (def.fn === 'shelter') {
      const inside = this.list.filter((o) => o.inB === b && o.plan === 'inside').length;
      if (inside >= (def.capacity || 40)) { v.tried.shelter = v.t + 20; v.plan = 'flee'; v.field = 'exit'; this.think(v, 'The shelter is full!', true); return; }
      v.plan = 'inside'; v.inB = b; v.stayT = 12; return;
    }
    // attractions and rest areas hold a limited number of guests at once (platform 5, vent 16, rest area 8)
    if (def.inside && this.list.filter((o) => o.inB === b && o.plan === 'inside').length >= def.inside) { this.think(v, "It's full. Maybe later."); v.plan = 'wander'; v.steps = 5; v.tried[key] = v.t + 25; return; }
    const bias = b.menu?.bias;
    if (def.fn === 'view' && bias && bias !== 'neutral' && bias !== v.vtype && v.vtype !== 'neutral' && chance(0.5)) {
      this.think(v, 'That one is not really my kind of thing.'); v.plan = 'wander'; v.steps = 6; v.tried[key] = v.t + 30; return;
    }
    const menu = MENUS[b.type], m = b.menu;
    const price = buildingPrice(b);
    if (price > v.money) { this.think(v, "I can't afford it."); v.plan = 'wander'; v.steps = 5; v.tried[key] = v.t + 40; return; }
    // The player sets kiosk prices; guests think about 1.3× the usual price is fair.
    const fair = (def.price || 0) * 1.3 + 0.5;
    if (def.price && price > fair) {
      if (price > fair * 2 || chance(Math.min(0.8, (price - fair) / fair))) { this.think(v, pick(['What a rip-off!', `$${price} for that? No thanks.`])); this.complaints.fee += 0.3; v.happy -= 3; v.plan = 'wander'; v.steps = 5; v.tried[key] = v.t + 40; return; }
      v.happy -= 2;
    }
    if (menu) {
      // Better items please more; a side order made for this guest's type pleases twice as much. Each sale costs the park.
      const main = menu.main[m?.main ?? 0] || menu.main[0], side = menu.side[m?.side ?? 0] || menu.side[0];
      const appeal = (main[2] || 0) + (side[2] || 0) * (side[4] && side[4] === v.vtype ? 2.5 : 1);
      v.joy = Math.min(14, (v.joy || 0) + appeal * 0.6);
      park.forceSpend((main[3] || 0) + (side[3] || 0), 'Stock');
      b.income = (b.income || 0) - (main[3] || 0) - (side[3] || 0);
      if (chance(0.15)) this.think(v, b.type === 'giftshop' ? `I got a ${main[0].toLowerCase()}!` : side[4] === v.vtype ? `Mmm, ${side[0]}!` : `Mmm, ${main[0].toLowerCase()}!`);
    }
    if (price) {
      v.money -= price;
      const cat = def.need === 'energy' ? 'Hotels' : def.fn === 'view' ? 'Rides' : 'Shops';
      park.earn(price * PARTY, cat);
      b.income = (b.income || 0) + price * PARTY;
    }
    b.visits = (b.visits || 0) + 1;
    if (def.need) v[def.need] = def.need === 'energy' ? 100 : 0;
    if (def.need === 'hunger' || def.need === 'thirst') v.trash = randi(3, 9);
    if (def.also) v[def.also] = 0;
    if (def.need === 'shop') v.joy = Math.min(12, (v.joy || 0) + 5);
    if (def.need === 'energy') { v.t = Math.max(0, v.t - DAY_SECONDS * 0.4); v.happy = Math.min(100, v.happy + 5); }
    v.plan = 'inside'; v.inB = b; v.stayT = def.stay || 4;
    v.tried[key] = v.t + 15;
  }

  leavePark(v, exited) {
    const park = this.g.park;
    if (exited) {
      park.stats.satisfaction.push(v.happy);
      const ts = (park.stats.typeSat[v.vtype] = park.stats.typeSat[v.vtype] || []); ts.push(Math.round(v.happy)); if (ts.length > 30) ts.shift();
      if (park.stats.satisfaction.length > 60) park.stats.satisfaction.shift();
    }
    v.gone = true;
  }

  // Called by staff when a ride ends.
  // Rides that show many species impress every guest type, Thrill Seekers most of all.
  returnFromRide(v, b, funGain, nSp = 0) {
    if (nSp >= 3) funGain = Math.min(100, funGain * (1 + (nSp - 2) * (v.vtype === 'violent' ? 0.15 : 0.08)));
    v.plan = 'wander'; v.steps = randi(3, 8); v.inB = null;
    v.tile = b.access; v.next = -1;
    v.x = (b.access % this.g.map.W) + 0.5; v.z = Math.floor(b.access / this.g.map.W) + 0.5;
    v.fun = Math.min(100, v.fun + funGain);
    v.happy = Math.min(100, v.happy + funGain * 0.15);
    this.think(v, funGain > 30 ? 'That ride was INCREDIBLE!' : funGain > 10 ? 'Nice ride.' : "We didn't see any dinosaurs...", true);
  }

  nearest(x, z, r) {
    let best = null, bd = r * r;
    for (const v of this.list) {
      if (v.gone || v.plan === 'inside' || v.plan === 'queue' || v.plan === 'ride') continue;
      const d = dist2(v.x, v.z, x, z);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  kill(v, dino, cause) {
    if (v.gone) return;
    v.gone = true;
    const g = this.g, park = g.park;
    park.stats.visitorDeaths++;
    // Fatality fines and loss of security rating, unless an emergency had been declared.
    if (!park.emergency && !park.noFines) { park.safetyHit(cause === 'twister' ? 10 : 22); park.forceSpend(5000, 'Fines'); }
    G.audio?.playAt('scream', v.x, v.z, 1);
    if (dino) g.notify(`A visitor was killed by ${dino.sp.name} "${dino.name}"!`, 'danger', { dino });
    else g.notify(`A visitor was injured by the ${cause || 'disaster'}.`, 'danger', { x: v.x, z: v.z });
    for (const o of this.list) if (!o.gone && dist2(o.x, o.z, v.x, v.z) < 200) { o.happy -= 20; o.panic = 10; }
    // remove from any queue
    for (const b of g.buildings.values()) if (b.queue) { const i = b.queue.indexOf(v); if (i >= 0) b.queue.splice(i, 1); }
  }

  excite(x, z, amount) {
    for (const v of this.list) if (dist2(v.x, v.z, x, z) < 150) v.fun = Math.min(100, v.fun + amount);
  }

  pick(ray) {
    let best = null, bt = 1e9;
    const p = new THREE.Vector3();
    for (const v of this.list) {
      if (v.plan === 'inside' || v.plan === 'queue' || v.plan === 'ride') continue;
      p.set(v.x, 0.3, v.z);
      const d = ray.distanceSqToPoint(p);
      if (d < 0.12) { const t = ray.origin.distanceTo(p); if (t < bt) { bt = t; best = v; } }
    }
    return best;
  }

  // ---------- render ----------
  // Kenney characters: one instanced mesh per character, pose and frame.
  initPeople() {
    this.pm = []; this.pIdx = [];
    for (let c = 0; c < PEOPLE.count; c++) {
      this.pIdx[c] = {};
      for (const pose of Object.keys(POSES)) {
        this.pIdx[c][pose] = PEOPLE.baked[c][pose].map((geo) => {
          const im = new THREE.InstancedMesh(geo, PEOPLE.material, PER_POSE);
          im.count = 0; im.castShadow = true; im.frustumCulled = false; im.visible = false;
          im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PER_POSE * 3).fill(1), 3);
          this.g.root.add(im);
          this.pm.push(im);
          return im;
        });
      }
    }
    this.bodyMesh.visible = false; this.restMesh.visible = false;
  }

  render(dt) {
    const m = this._m, q = this._q, s = this._s, p = this._p;
    const map = this.g.map;
    const w = this.g.park.weather.type, wet = (w === 'rain' || w === 'storm') && this.g.park.has('weatherguard');
    const people = peopleLoaded();
    if (people && !this.pm) this.initPeople();
    if (this.pm) for (const im of this.pm) im.count = 0;
    let n = 0, u = 0;
    for (const v of this.list) {
      if (n >= MAX) break;
      const hidden = v.plan === 'inside' || v.plan === 'queue' || v.plan === 'ride';
      if (hidden) continue;
      if (this.pm) {
        const c = v.id % PEOPLE.count, wheel = PEOPLE.wheel && v.id % 13 === 5;
        const pose = wheel ? 'wheel' : v.plan === 'flee' || v.plan === 'freeze' ? 'run' : v.moving ? 'walk' : 'idle';
        v.anim = (v.anim ?? Math.random() * 4) + dt * (pose === 'run' ? 12 : pose === 'walk' ? 7 : pose === 'wheel' ? (v.moving ? 5 : 0) : 0.6);
        v.moving = false;
        const frames = this.pIdx[c][pose], im = frames[Math.floor(v.anim) % frames.length];
        p.set(v.x, Math.max(map.heightAt(v.x, v.z), 0) + 0.02, v.z);
        q.setFromAxisAngle(this._up, -(v.heading || 0));
        s.set(1, 1, 1);
        m.compose(p, q, s);
        if (im.count < PER_POSE) { im.setColorAt(im.count, this._c.set(v.color)); im.setMatrixAt(im.count++, m); }
        if (wet && v.plan !== 'flee' && !wheel) { s.set(1.15, 1.15, 1.15); m.compose(p, q, s); this.umbMesh.setMatrixAt(u, m); this.umbMesh.setColorAt(u, this._c.set(VTYPES[v.vtype || 'neutral'].col)); u++; }
        n++;
        continue;
      }
      v.bob += dt * (v.plan === 'flee' ? 18 : 9) * (v.moving ? 1 : 0);
      v.moving = false;
      p.set(v.x, Math.max(map.heightAt(v.x, v.z), 0) + 0.04 + Math.abs(Math.sin(v.bob)) * 0.03, v.z);
      q.setFromAxisAngle(this._up, -(v.heading || 0));
      s.set(1.15, 1.15, 1.15);
      m.compose(p, q, s);
      this.bodyMesh.setMatrixAt(n, m);
      this.restMesh.setMatrixAt(n, m);
      this.bodyMesh.setColorAt(n, this._c.set(v.color));
      if (wet && v.plan !== 'flee') { this.umbMesh.setMatrixAt(u, m); this.umbMesh.setColorAt(u, this._c.set(VTYPES[v.vtype || 'neutral'].col)); u++; }
      n++;
    }
    if (this.pm) for (const im of this.pm) { im.visible = im.count > 0; if (im.count) { im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; } }
    this.umbMesh.count = u;
    if (this.pm) { if (u) { this.umbMesh.instanceMatrix.needsUpdate = true; this.umbMesh.instanceColor.needsUpdate = true; } return; }
    this.bodyMesh.count = n; this.restMesh.count = n;
    if (u) { this.umbMesh.instanceMatrix.needsUpdate = true; this.umbMesh.instanceColor.needsUpdate = true; }
    this.bodyMesh.instanceMatrix.needsUpdate = true; this.restMesh.instanceMatrix.needsUpdate = true;
    if (this.bodyMesh.instanceColor) this.bodyMesh.instanceColor.needsUpdate = true;
  }

  clear() { this.list = []; }
}
