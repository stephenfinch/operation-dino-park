// Live goats and cattle released by Carnivore Feeders, as in the original: the carnivores hunt them down.
import * as THREE from 'three';
import { G } from './state.js';
import { FEED, feederFood } from './data.js';
import { rand, chance, dist, dist2 } from './util.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// a pseudo-species so the dinosaur combat code can treat livestock as prey
const SP = {
  goat: { id: 'goat', name: 'Goat', diet: 'herb', cat: 'SH', size: 'S', hp: 30, len: 0.55, spd: 0.5, run: 1.6, meat: 2 },
  cow: { id: 'cow', name: 'Cow', diet: 'herb', cat: 'SH', size: 'S', hp: 70, len: 0.95, spd: 0.35, run: 1.1, meat: 4 },
};
// Animated low-poly cow by Quaternius (CC0, from the official Quaternius account on Poly Pizza).
// Quaternius has no goat, so the feeder goat is the same model, smaller and recoloured.
const MODEL = { goat: 'Cow', cow: 'Cow' };
const CLIP = { walk: 'walk', run: 'gallop', idle: 'eating', death: 'death' };
const GOAT_COLS = { Main: 0xe6e0d2, Main_Light: 0xf4f0e6, Muzzle: 0x9a8a7a };
const farm = {};
let loading = null;
export function loadFarm(base = 'assets/models/quaternius-farm/') {
  if (!loading) {
    const loader = new GLTFLoader();
    loading = Promise.all([...new Set(Object.values(MODEL))].map(async (n) => {
      try {
        const b64 = window.ISLA_MODELS?.[n];
        const g = b64 ? await loader.parseAsync(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer, '') : await loader.loadAsync(base + n + '.glb');
        g.scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(g.scene);
        const clips = {};
        for (const a of g.animations) clips[a.name.toLowerCase()] = a;
        g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
        farm[n] = { scene: g.scene, clips, len: Math.max(box.max.z - box.min.z, box.max.x - box.min.x), minY: box.min.y };
      } catch (e) { console.warn('Could not load model', n, e); }
    }));
  }
  return loading;
}
function part(w, h, d, x, y, z) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; }
// Simple stand-in until the models have loaded.
function boxMesh(kind) {
  const s = kind === 'cow' ? 1.7 : 1;
  const m = new THREE.Mesh(part(0.42 * s, 0.3 * s, 0.18 * s, 0, 0.3 * s, 0), new THREE.MeshLambertMaterial({ color: kind === 'cow' ? 0x6a4a32 : 0xe8e2d4 }));
  const root = new THREE.Group(); root.add(m); return root;
}
function animalMesh(kind, len) {
  const f = farm[MODEL[kind]];
  if (!f) return { root: boxMesh(kind) };
  const root = new THREE.Group(), inner = cloneSkinned(f.scene);
  if (kind === 'goat') inner.traverse((o) => {
    if (!o.isMesh) return;
    const tint = (mt) => { const c = GOAT_COLS[mt.name]; if (!c) return mt; const n = mt.clone(); n.color.setHex(c); return n; };
    o.material = Array.isArray(o.material) ? o.material.map(tint) : tint(o.material);
  });
  const k = len / f.len;
  inner.scale.setScalar(k); inner.position.y = -f.minY * k;
  inner.rotation.y = Math.PI / 2; // model faces +Z; our heading 0 is +X
  root.add(inner);
  const mixer = new THREE.AnimationMixer(inner);
  return { root, mixer, clips: f.clips };
}

export class Livestock {
  constructor(game, kind, x, z) {
    this.g = game; this.kind = kind; this.sp = SP[kind]; this.livestock = true;
    this.x = x; this.z = z; this.heading = rand(0, Math.PI * 2);
    this.maxHp = this.sp.hp; this.health = 100; this.dead = false; this.meat = 0; this.carried = false;
    this.len = this.sp.len; this.state = 'graze'; this.t = rand(0, 3); this.phase = 0; this.tranq = 0;
    const m = animalMesh(kind, this.sp.len * 1.25);
    this.mesh = m.root; this.mixer = m.mixer; this.clips = m.clips;
    game.root.add(this.mesh);
    this.place(0);
  }
  region() { return this.g.map.regionAt(this.x, this.z); }
  faceTo() {}
  takeHit(dmg, attacker) {
    if (this.dead) return;
    this.health -= (dmg / this.maxHp) * 100;
    // a cow can kick back: raptors hunting cattle get hurt
    if (this.kind === 'cow' && attacker && attacker.sp.size !== 'XL' && chance(0.3)) attacker.takeHit?.(attacker.maxHp * 0.06, null, 'a kick from a cow');
    if (this.health <= 0) this.die();
    else this.fleeFrom(attacker || this, 3);
  }
  // play one of the model's clips (walk / run / idle / death)
  anim(name, once) {
    if (!this.mixer || this.clipName === name) return;
    const clip = this.clips[CLIP[name]];
    if (!clip) return;
    const a = this.mixer.clipAction(clip);
    if (once) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    a.reset().fadeIn(0.2).play();
    if (this.action) this.action.fadeOut(0.2);
    this.action = a; this.clipName = name;
  }
  die() {
    this.dead = true; this.health = 0; this.meat = this.sp.meat; this.deadT = 0;
    this.anim('death', true);
    G.audio?.playAt('thud', this.x, this.z, 0.4);
  }
  fleeFrom(src, t) { if (this.dead) return; this.state = 'flee'; this.t = t; this.src = { x: src.x, z: src.z }; }
  update(dt) {
    const g = this.g, map = g.map;
    if (this.dead) {
      this.deadT += dt;
      if (this.mixer) this.mixer.update(dt); else this.mesh.rotation.z = Math.min(Math.PI / 2, this.mesh.rotation.z + dt * 4);
      if (this.deadT > 240 || (this.meat <= 0 && this.deadT > 4)) this.remove();
      return;
    }
    this.t -= dt;
    // run from any carnivore that comes close
    this.senseT = (this.senseT || rand(0, 1)) - dt;
    if (this.senseT <= 0) {
      this.senseT = 0.8;
      const r = this.region();
      const c = g.nearestDino(this, (d) => !d.dead && d.tranq <= 0 && d.sp.diet === 'carn' && d.region() === r, 6);
      if (c) this.fleeFrom(c, 3);
    }
    let sp = 0, tx = this.x, tz = this.z;
    if (this.state === 'flee' && this.src) {
      const a = Math.atan2(this.z - this.src.z, this.x - this.src.x) + Math.sin(this.t * 3) * 0.5;
      tx = this.x + Math.cos(a); tz = this.z + Math.sin(a); sp = this.sp.run;
      if (this.t <= 0) { this.state = 'graze'; this.t = rand(2, 5); }
    } else if (this.state === 'walk' && this.goal) {
      tx = this.goal.x; tz = this.goal.z; sp = this.sp.spd;
      if (dist(this.x, this.z, tx, tz) < 0.2 || this.t <= 0) { this.state = 'graze'; this.t = rand(2, 6); }
    } else if (this.t <= 0) {
      this.state = 'walk'; this.t = 8;
      this.goal = { x: this.x + rand(-3, 3), z: this.z + rand(-3, 3) };
    }
    if (sp > 0) {
      const a = Math.atan2(tz - this.z, tx - this.x);
      const nx = this.x + Math.cos(a) * sp * dt, nz = this.z + Math.sin(a) * sp * dt;
      // stay inside the enclosure: only step onto tiles of the same region
      const ox = Math.floor(this.x), oz = Math.floor(this.z), ix = Math.floor(nx), iz = Math.floor(nz);
      const same = ix === ox && iz === oz || (map.inb(ix, iz) && map.inb(ox, oz) && map.region[map.idx(ix, iz)] === map.region[map.idx(ox, oz)] && map.region[map.idx(ix, iz)] >= 0);
      if (same) { this.x = nx; this.z = nz; this.heading = a; this.phase += dt * sp * 14; }
      else { this.goal = null; this.state = 'graze'; this.t = rand(1, 2); }
    }
    this.place(sp, dt);
  }
  place(sp, dt = 0) {
    const m = this.mesh;
    m.position.set(this.x, Math.max(this.g.map.heightAt(this.x, this.z), -0.2), this.z);
    m.rotation.y = -this.heading;
    if (this.mixer) { this.anim(sp > this.sp.spd * 1.5 ? 'run' : sp > 0 ? 'walk' : 'idle'); this.mixer.update(dt); }
  }
  remove() { this.removed = true; this.g.root.remove(this.mesh); }
}

export const LivestockMethods = {
  initLivestock() { this.livestock = []; },
  // A hungry carnivore in this enclosure: the feeder releases one live animal (if none is already loose).
  releaseLivestock(b, regionId, monthly = false) {
    if (b.stock <= 0) return null;
    if (!monthly && this.livestock.some((a) => !a.dead && !a.removed && a.feeder === b.id)) return null;
    const kind = feederFood(b) === 'cow' ? 'cow' : 'goat';
    const t = this.feederApproach(b, regionId, { x: b.cx + rand(-2, 2), z: b.cz + rand(-2, 2) });
    if (!t) return null;
    b.stock--;
    const a = new Livestock(this, kind, t.x, t.z);
    a.feeder = b.id;
    this.livestock.push(a);
    return a;
  },
  liveLivestock(region) { return this.livestock.filter((a) => !a.dead && !a.removed && a.region() === region); },
  livestockCarcass(d, region, r) {
    let best = null, bd = r * r;
    for (const a of this.livestock) if (a.dead && !a.removed && a.meat > 0 && a.region() === region) { const q = dist2(a.x, a.z, d.x, d.z); if (q < bd) { bd = q; best = a; } }
    return best;
  },
  updateLivestock(dt) {
    for (let i = 0; i < this.livestock.length; i++) { this.livestock[i].update(dt); if (this.livestock[i].removed) this.livestock.splice(i--, 1); }
  },
  serializeLivestock() { return this.livestock.filter((a) => !a.removed).map((a) => ({ k: a.kind, x: +a.x.toFixed(2), z: +a.z.toFixed(2), d: a.dead, m: a.meat, f: a.feeder })); },
  loadLivestock(list) {
    for (const o of list || []) { const a = new Livestock(this, o.k, o.x, o.z); a.feeder = o.f; if (o.d) { a.die(); a.meat = o.m; } this.livestock.push(a); }
  },
};
export { FEED };
