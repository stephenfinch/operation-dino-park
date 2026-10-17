// Tile map: terrain, paths, flora, building occupancy, fences on tile edges,
// enclosure regions and pathfinding.
import { MAP_SIZE, FENCES, FLORA } from './data.js';
import { fbm, valueNoise, mulberry32, Heap } from './util.js';

export const T = { GRASS: 0, SAND: 1, WATER: 2, SEA: 3, ROCK: 4, DIRT: 5 };
export const INF = 32767;

// Island outlines. Each returns a value that is positive on land (roughly the distance to the coast).
export const ISLAND_FORMS = ['round', 'square', 'star', 'long', 'crescent', 'twin', 'bay', 'peninsula', 'lagoon', 'isles'];
export const ISLAND_FORM_NAMES = { random: 'Surprise me', round: 'Round', square: 'Square', star: 'Star', long: 'Long', crescent: 'Crescent', twin: 'Twin peaks', bay: 'Deep bay', peninsula: 'Peninsula', lagoon: 'Lagoon', isles: 'Separate islands' };
const circ = (u, v, x, y, r) => r - Math.hypot(u - x, v - y);
function capsule(u, v, ax, ay, bx, by, r) {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy)));
  return r - Math.hypot(u - ax - dx * t, v - ay - dy * t);
}
export function islandField(form, u, v) {
  switch (form) {
    case 'long': return (1 - Math.hypot(u / 0.9, v / 0.5)) * 0.45;
    case 'crescent': return Math.min(circ(u, v, 0, 0.05, 0.82), -circ(u, v, 0, -0.62, 0.5));
    case 'twin': return Math.max(circ(u, v, -0.4, -0.1, 0.48), circ(u, v, 0.38, 0.15, 0.5), capsule(u, v, -0.4, -0.1, 0.38, 0.15, 0.24));
    case 'bay': return Math.min(circ(u, v, 0, 0.02, 0.84), -capsule(u, v, -0.2, -0.95, 0.05, -0.1, 0.17));
    case 'peninsula': return Math.max(circ(u, v, -0.1, 0.12, 0.66), capsule(u, v, -0.1, 0.1, 0.72, -0.62, 0.22));
    case 'lagoon': return circ(u, v, 0, 0, 0.84);
    // the original's generator also made boxy, star-like and broken-up islands
    case 'square': return 0.74 - Math.max(Math.abs(u), Math.abs(v)) - 0.08 * Math.max(0, Math.min(Math.abs(u), Math.abs(v)) - 0.55);
    case 'star': { const a = Math.atan2(v, u); return 0.6 + 0.2 * Math.cos(5 * a + 0.3) - Math.hypot(u, v); }
    case 'isles': return Math.max(circ(u, v, -0.05, 0.15, 0.56), circ(u, v, -0.55, -0.55, 0.26), circ(u, v, 0.6, -0.45, 0.3), circ(u, v, 0.62, 0.55, 0.2));
    case 'lagoonCore': return circ(u, v, 0.08, -0.12, 0.3);
    default: return circ(u, v, 0, 0, 0.8);
  }
}
// Map edge length in tiles for the size parameter (0..1): 128 to 224 tiles (320 m to 560 m).
export function islandSize(params) { return 128 + Math.round(clamp01(params?.size ?? 0.5) * 12) * 8; }
const clamp01 = (x) => Math.max(0, Math.min(1, x));

export class GameMap {
  constructor(size = MAP_SIZE) {
    const W = (this.W = size), H = (this.H = size);
    this.terrain = new Uint8Array(W * H);
    this.path = new Uint8Array(W * H);      // 0 none, 1 footpath, 2 safari track
    this.flora = new Uint8Array(W * H);     // FLORA id
    this.bld = new Int32Array(W * H).fill(-1);
    this.rockH = new Float32Array(W * H);   // mountain height for ROCK tiles
    this.fenceH = new Uint8Array(W * (H + 1));
    this.fenceHHp = new Float32Array(W * (H + 1));
    this.fenceV = new Uint8Array((W + 1) * H);
    this.fenceVHp = new Float32Array((W + 1) * H);
    this.region = new Int32Array(W * H).fill(-1);
    this.regions = [];
    this.regionsDirty = true;
    this.ver = { terrain: 0, path: 0, flora: 0, fence: 0, bld: 0 };
    this.hv = null;
    this.blackout = false;
    // A* scratch
    this._g = new Float32Array(W * H);
    this._from = new Int32Array(W * H);
    this._stamp = new Uint32Array(W * H);
    this._closed = new Uint32Array(W * H);
    this._gen = 1;
  }

  idx(x, y) { return y * this.W + x; }
  inb(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  tileAt(wx, wz) { return { x: Math.floor(wx), y: Math.floor(wz) }; }

  // ---------- Generation ----------
  // params (0..1 each), as in the original's island generator: shape (coast smoothness), trees, rivers, mountains,
  // plus size (0..1, applied when the map is created) and form (island outline).
  generate(seed = 1, opts = {}) {
    const { W, H } = this;
    const P = Object.assign({ shape: 0.5, trees: 0.5, rivers: 0.3, mountains: 0.4, form: 'random' }, opts.params || {});
    this.params = P;
    const rng = mulberry32(seed);
    const form = ISLAND_FORMS.includes(P.form) ? P.form : ISLAND_FORMS[Math.floor(rng() * ISLAND_FORMS.length)];
    this.form = form;
    const rot = form === 'round' || form === 'square' ? 0 : (rng() - 0.5) * 1.6; // keep a southern shore for the gate
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const rough = 0.12 + 0.34 * (1 - P.shape);
    const rockTh = 0.78 - 0.14 * P.mountains, rockScale = 14 + 18 * P.mountains;
    const lakeTh = 0.74 - 0.06 * P.rivers;
    const N = W * H;
    const field = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const nx = ((x + 0.5) / W) * 2 - 1, ny = ((y + 0.5) / H) * 2 - 1;
      const wx = nx + (fbm(nx * 1.7 + 3, ny * 1.7 + 3, seed + 21, 4) - 0.5) * rough * 1.6;
      const wy = ny + (fbm(nx * 1.7 + 9, ny * 1.7 + 9, seed + 22, 4) - 0.5) * rough * 1.6;
      const u = wx * cr - wy * sr, v = wx * sr + wy * cr;
      let L = islandField(form, u, v);
      L += (fbm(nx * 6 + 1, ny * 6 + 1, seed + 31, 3) - 0.5) * rough * 0.3;
      const edge = Math.max(Math.abs(nx), Math.abs(ny));
      field[y * W + x] = Math.min(L, (0.93 - edge) * 2);
    }
    // land / sea, keeping only sizeable pieces of land
    for (let i = 0; i < N; i++) this.terrain[i] = field[i] > 0 ? T.GRASS : T.SEA;
    const lab = this.labelLand();
    for (let i = 0; i < N; i++) if (lab.id[i] >= 0 && lab.size[lab.id[i]] < 40) this.terrain[i] = T.SEA;
    // distance from the sea, used for beaches, lakes and hills
    let cd = this.coastDistance();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (this.terrain[i] === T.SEA) continue;
      const beach = 1 + (valueNoise(x * 0.06, y * 0.06, seed + 41) > 0.55 ? 1 : 0) + (valueNoise(x * 0.06, y * 0.06, seed + 41) > 0.8 ? 1 : 0);
      if (cd[i] <= beach) { this.terrain[i] = T.SAND; continue; }
      const lake = fbm(x * 0.07, y * 0.07, seed + 99, 3);
      const rock = fbm(x * 0.055 + 30, y * 0.055 + 30, seed + 7, 4);
      const lagoon = form === 'lagoon' && islandField('lagoonCore', ((x + 0.5) / W) * 2 - 1, ((y + 0.5) / H) * 2 - 1) > 0;
      if (lagoon || (lake > lakeTh && cd[i] > 5)) this.terrain[i] = T.WATER;
      else if (P.mountains > 0.02 && rock > rockTh && cd[i] > 4) {
        this.terrain[i] = T.ROCK;
        this.rockH[i] = 0.8 + (rock - rockTh) * rockScale * Math.min(1, (cd[i] - 3) / 6) + rng() * 0.4;
      }
    }
    // Gate: a south-facing shore with plenty of open land behind it.
    const main = lab.size.indexOf(Math.max(...lab.size));
    let best = null, bestS = -1e9;
    for (let y = 14; y < H - 6; y++) for (let x = 9; x < W - 11; x++) {
      const i = y * W + x;
      if (lab.id[i] !== main || this.terrain[i] === T.SEA) continue;
      let ok = true;
      for (let k = 0; k < 3 && ok; k++) if (this.terrain[(y + 3) * W + x + k] !== T.SEA || this.terrain[(y + 1) * W + x + k] === T.SEA) ok = false;
      if (!ok) continue;
      let land = 0;
      for (let yy = y - 16; yy <= y; yy += 2) for (let xx = x - 8; xx <= x + 10; xx += 2) { const t = this.terrain[yy * W + xx]; if (t !== T.SEA && t !== T.WATER) land++; }
      const s = land * 2 - Math.abs(x - W / 2) * 0.25 - Math.abs(y - H * 0.8) * 0.15;
      if (s > bestS) { bestS = s; best = { x, y }; }
    }
    if (!best) best = { x: Math.floor(W / 2) - 1, y: H - 8 };
    const ex = best.x, ey = best.y - 1; // entrance occupies ey..ey+1
    this.entrance = { x: ex, y: ey, w: 3, h: 2 };
    // Rivers: wander from the heart of the island down to the sea, avoiding the gate.
    cd = this.coastDistance();
    let hx = W / 2, hy = H / 2, hd = -1;
    for (let i = 0; i < N; i++) if (lab.id[i] === main && cd[i] > hd) { hd = cd[i]; hx = i % W; hy = (i / W) | 0; }
    const nRivers = Math.round(P.rivers * (W / 48));
    for (let r = 0; r < nRivers; r++) {
      let a = rng() * Math.PI * 2;
      let x = hx + Math.cos(a) * 4 + (rng() - 0.5) * hd, y = hy + Math.sin(a) * 4 + (rng() - 0.5) * hd;
      const dirA = a + (rng() - 0.5) * 0.6;
      for (let step = 0; step < W * 3; step++) {
        const ix = Math.floor(x), iy = Math.floor(y);
        if (!this.inb(ix, iy) || this.terrain[this.idx(ix, iy)] === T.SEA) break;
        if (Math.abs(ix - ex - 1) < 11 && iy > ey - 26 && iy < ey + 4) break;
        for (const [ox, oy] of [[0, 0], [1, 0], [0, 1]]) {
          if (!this.inb(ix + ox, iy + oy)) continue;
          const k = this.idx(ix + ox, iy + oy);
          if (this.terrain[k] !== T.SEA) { this.terrain[k] = T.WATER; this.rockH[k] = 0; }
        }
        a = dirA + Math.sin(step * 0.15 + r * 3) * 0.7;
        x += Math.cos(a) * 0.8; y += Math.sin(a) * 0.8;
      }
    }
    this.treeParam = P.trees;
    // Clear the gate area.
    for (let y = ey - 14; y <= ey + 3; y++) {
      for (let x = ex - 7; x <= ex + 9; x++) {
        if (!this.inb(x, y)) continue;
        const i = this.idx(x, y);
        if (y <= ey + 1 && this.terrain[i] !== T.SEA) this.terrain[i] = T.GRASS;
        else if (y <= ey + 1 && x >= ex - 1 && x <= ex + 3) this.terrain[i] = T.GRASS;
      }
    }
    for (let y = ey; y <= ey + 1; y++) for (let x = ex; x < ex + 3; x++) this.terrain[this.idx(x, y)] = T.GRASS;
    // Flora
    if (!opts.noFlora) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = this.idx(x, y);
          const t = this.terrain[i];
          if (t !== T.GRASS && t !== T.SAND) continue;
          if (Math.abs(x - ex - 1) < 8 && y > ey - 14 && y < ey + 4) continue;
          const f = fbm(x * 0.09 + 50, y * 0.09 + 50, seed + 3, 4);
          if (t === T.SAND) { if (rng() < 0.08) this.flora[i] = 1; continue; }
          if (f > 0.68 - 0.24 * P.trees && rng() < 0.45 + 0.45 * P.trees) {
            const r = rng();
            const k = valueNoise(x * 0.2, y * 0.2, seed + 11);
            this.flora[i] = r < 0.22 ? 4 : r < 0.34 ? 5 : k > 0.66 ? 2 : k > 0.4 ? 3 : 1;
          } else if (rng() < 0.015) this.flora[i] = rng() < 0.5 ? 6 : 4;
        }
      }
    }
    this.computeHeights();
    this.regionsDirty = true;
    this.bumpAll();
  }

  // Connected pieces of land (4-neighbour).
  labelLand() {
    const { W, H } = this, N = W * H, id = new Int32Array(N).fill(-1), size = [];
    const q = new Int32Array(N);
    for (let s = 0; s < N; s++) {
      if (id[s] >= 0 || this.terrain[s] === T.SEA) continue;
      const k = size.length; let h = 0, t = 0, n = 0;
      q[t++] = s; id[s] = k;
      while (h < t) {
        const i = q[h++]; n++;
        const x = i % W, y = (i / W) | 0;
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
          if (j >= 0 && id[j] < 0 && this.terrain[j] !== T.SEA) { id[j] = k; q[t++] = j; }
        }
      }
      size.push(n);
    }
    if (!size.length) size.push(0);
    return { id, size };
  }

  // Tiles from the nearest sea tile (4-neighbour BFS).
  coastDistance() {
    const { W, H } = this, N = W * H, d = new Int16Array(N).fill(INF), q = new Int32Array(N);
    let h = 0, t = 0;
    for (let i = 0; i < N; i++) if (this.terrain[i] === T.SEA) { d[i] = 0; q[t++] = i; }
    while (h < t) {
      const i = q[h++], x = i % W, y = (i / W) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j >= 0 && d[j] === INF) { d[j] = d[i] + 1; q[t++] = j; }
      }
    }
    return d;
  }

  bumpAll() { for (const k in this.ver) this.ver[k]++; }

  // ---------- Heights ----------
  tileBaseHeight(x, y) {
    if (!this.inb(x, y)) return -1.8;
    const i = this.idx(x, y);
    switch (this.terrain[i]) {
      case T.SEA: return -1.8;
      case T.WATER: return -0.8;
      case T.SAND: return -0.06;
      case T.ROCK: return this.rockH[i];
      default: return valueNoise(x * 0.3, y * 0.3, 5) * 0.08;
    }
  }

  computeHeights() {
    const N = this.W * 2 + 1;
    const hv = (this.hv = this.hv || new Float32Array(N * N));
    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        let sum = 0, n = 0;
        const xs = gx & 1 ? [(gx - 1) >> 1] : [gx / 2 - 1, gx / 2];
        const ys = gy & 1 ? [(gy - 1) >> 1] : [gy / 2 - 1, gy / 2];
        let mn = 99;
        for (const ty of ys) for (const tx of xs) { const h = this.tileBaseHeight(tx, ty); sum += h; n++; if (h < mn) mn = h; }
        // shorelines: keep water edges low so ponds read clearly
        let h = sum / n;
        if (mn < -0.5 && h > -0.1) h = Math.min(h, -0.05);
        hv[gy * N + gx] = h;
      }
    }
    this.ver.terrain++;
  }

  heightAt(x, z) {
    const N = this.W * 2 + 1;
    let gx = x * 2, gz = z * 2;
    if (gx < 0 || gz < 0 || gx >= N - 1 || gz >= N - 1) return -1.8;
    const ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = gx - ix, fz = gz - iz;
    const hv = this.hv;
    const a = hv[iz * N + ix], b = hv[iz * N + ix + 1], c = hv[(iz + 1) * N + ix], d = hv[(iz + 1) * N + ix + 1];
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  }

  // ---------- Tile predicates ----------
  isLand(i) { const t = this.terrain[i]; return t !== T.SEA && t !== T.ROCK && t !== T.WATER; }
  isBuildable(i) { return this.isLand(i) && this.bld[i] < 0; }
  dinoPassable(i) { const t = this.terrain[i]; return t !== T.SEA && t !== T.ROCK && this.bld[i] < 0; }

  // ---------- Fences ----------
  // Horizontal edge (x,y): from vertex (x,y) to (x+1,y), between tile (x,y-1) and (x,y).
  // Vertical edge (x,y): from vertex (x,y) to (x,y+1), between tile (x-1,y) and (x,y).
  hIdx(x, y) { return y * this.W + x; }
  vIdx(x, y) { return y * (this.W + 1) + x; }

  // Returns {h: bool, i} for the edge crossed moving between orthogonal neighbours.
  edgeBetween(x, y, nx, ny) {
    if (nx === x + 1) return { h: false, i: this.vIdx(x + 1, y) };
    if (nx === x - 1) return { h: false, i: this.vIdx(x, y) };
    if (ny === y + 1) return { h: true, i: this.hIdx(x, y + 1) };
    return { h: true, i: this.hIdx(x, y) };
  }
  fenceType(h, i) { return h ? this.fenceH[i] : this.fenceV[i]; }
  fenceHp(h, i) { return h ? this.fenceHHp[i] : this.fenceVHp[i]; }
  setFenceHp(h, i, v) {
    const t = h ? this.fenceH[i] : this.fenceV[i];
    const old = h ? this.fenceHHp[i] : this.fenceVHp[i];
    if (h) this.fenceHHp[i] = v; else this.fenceVHp[i] = v;
    // re-render when a fence crosses the "damaged" threshold so the tint updates
    if (t && (old < FENCES[t].hp * 0.5) !== (v < FENCES[t].hp * 0.5)) this.ver.fence++;
  }
  fenceIntact(h, i) { const t = this.fenceType(h, i); return t > 0 && this.fenceHp(h, i) > 0; }

  setFence(h, i, type) {
    if (h) { this.fenceH[i] = type; this.fenceHHp[i] = type ? FENCES[type].hp : 0; }
    else { this.fenceV[i] = type; this.fenceVHp[i] = type ? FENCES[type].hp : 0; }
    this.ver.fence++;
    this.regionsDirty = true;
  }

  // Dinosaurs: blocked by intact fences.
  dinoCross(x, y, nx, ny) {
    const e = this.edgeBetween(x, y, nx, ny);
    return !this.fenceIntact(e.h, e.i);
  }
  // Visitors: blocked by any fence (even broken ones count as a barrier on footpaths).
  walkCross(x, y, nx, ny) {
    const e = this.edgeBetween(x, y, nx, ny);
    return this.fenceType(e.h, e.i) === 0;
  }

  // Tiles adjacent to an edge.
  edgeTiles(h, i) {
    if (h) { const W = this.W; const x = i % W, y = (i / W) | 0; return [[x, y - 1], [x, y]]; }
    const W1 = this.W + 1; const x = i % W1, y = (i / W1) | 0; return [[x - 1, y], [x, y]];
  }
  edgeCenter(h, i) {
    if (h) { const x = i % this.W, y = (i / this.W) | 0; return { x: x + 0.5, z: y }; }
    const W1 = this.W + 1; const x = i % W1, y = (i / W1) | 0; return { x, z: y + 0.5 };
  }

  // ---------- Regions (enclosures) ----------
  computeRegions() {
    const { W, H } = this;
    this.region.fill(-1);
    const regions = [];
    const stack = [];
    for (let s = 0; s < W * H; s++) {
      if (this.region[s] >= 0 || !this.dinoPassable(s)) continue;
      const id = regions.length;
      const r = { id, tiles: [], forest: 0, water: [], graze: [], public: false, fenceEdges: [] };
      this.region[s] = id;
      stack.push(s);
      while (stack.length) {
        const i = stack.pop();
        r.tiles.push(i);
        if (this.path[i] === 1) r.public = true;
        const f = this.flora[i];
        if (f && FLORA[f].forest) r.forest++;
        if (f && FLORA[f].graze) r.graze.push(i);
        if (this.terrain[i] === T.WATER) r.water.push(i);
        const x = i % W, y = (i / W) | 0;
        for (let d = 0; d < 4; d++) {
          const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0), ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
          if (!this.inb(nx, ny)) continue;
          const e = this.edgeBetween(x, y, nx, ny);
          const ft = this.fenceType(e.h, e.i);
          const ni = this.idx(nx, ny);
          if (ft > 0 && this.fenceHp(e.h, e.i) > 0) { r.fenceEdges.push(e); continue; }
          if (this.region[ni] >= 0 || !this.dinoPassable(ni)) continue;
          this.region[ni] = id;
          stack.push(ni);
        }
      }
      r.area = r.tiles.length;
      regions.push(r);
    }
    // The land outside each Park Entrance is public (the guests' side of the fences).
    for (const t of this.publicTiles || []) {
      const x = t % W, y = (t / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!this.inb(x + dx, y + dy)) continue;
        const ri = this.region[this.idx(x + dx, y + dy)];
        if (ri >= 0) regions[ri].public = true;
      }
    }
    this.regions = regions;
    this.regionsDirty = false;
  }

  regionAt(x, z) {
    const tx = Math.floor(x), ty = Math.floor(z);
    if (!this.inb(tx, ty)) return null;
    const r = this.region[this.idx(tx, ty)];
    return r >= 0 ? this.regions[r] : null;
  }

  // ---------- Dinosaur pathfinding (A*, 8-directional) ----------
  findPath(sx, sy, tx, ty, maxNodes = 5000) {
    const { W } = this;
    if (!this.inb(sx, sy) || !this.inb(tx, ty)) return null;
    const start = this.idx(sx, sy), goal = this.idx(tx, ty);
    if (start === goal) return [goal];
    const gen = ++this._gen;
    const g = this._g, from = this._from, stamp = this._stamp, closed = this._closed;
    const heap = new Heap();
    g[start] = 0; stamp[start] = gen; from[start] = -1;
    heap.push(start, 0);
    let expanded = 0;
    const hfn = (i) => { const x = i % W, y = (i / W) | 0; const dx = Math.abs(x - tx), dy = Math.abs(y - ty); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
    let best = start, bestH = hfn(start);
    while (heap.size) {
      const cur = heap.pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      if (cur === goal) { best = cur; break; }
      if (++expanded > maxNodes) break;
      const cx = cur % W, cy = (cur / W) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (!this.inb(nx, ny)) continue;
          const ni = this.idx(nx, ny);
          if (!this.dinoPassable(ni) || closed[ni] === gen) continue;
          if (dx && dy) {
            if (!this.dinoPassable(this.idx(cx + dx, cy)) || !this.dinoPassable(this.idx(cx, cy + dy))) continue;
            if (!this.dinoCross(cx, cy, cx + dx, cy) || !this.dinoCross(cx + dx, cy, nx, ny) ||
                !this.dinoCross(cx, cy, cx, cy + dy) || !this.dinoCross(cx, cy + dy, nx, ny)) continue;
          } else if (!this.dinoCross(cx, cy, nx, ny)) continue;
          const cost = g[cur] + (dx && dy ? 1.414 : 1) + (this.terrain[ni] === T.WATER ? 1.5 : 0);
          if (stamp[ni] !== gen || cost < g[ni]) {
            stamp[ni] = gen; g[ni] = cost; from[ni] = cur;
            const h = hfn(ni);
            if (h < bestH) { bestH = h; best = ni; }
            heap.push(ni, cost + h);
          }
        }
      }
    }
    // Reconstruct (to goal, or to the closest node reached).
    const out = [];
    let c = best;
    let guard = 0;
    while (c !== -1 && c !== start && guard++ < 20000) { out.push(c); c = from[c]; }
    out.reverse();
    return out.length ? out : null;
  }

  // ---------- Visitor distance fields (BFS over footpaths) ----------
  bfsField(sources) {
    const { W, H } = this;
    const dist = new Int16Array(W * H).fill(INF);
    const q = new Int32Array(W * H);
    let qh = 0, qt = 0;
    for (const s of sources) {
      if (s < 0 || this.path[s] !== 1) continue;
      if (dist[s] === 0) continue;
      dist[s] = 0; q[qt++] = s;
    }
    const W1 = W;
    while (qh < qt) {
      const i = q[qh++];
      const x = i % W1, y = (i / W1) | 0;
      const nd = dist[i] + 1;
      for (let d = 0; d < 4; d++) {
        const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0), ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (this.path[ni] !== 1 || dist[ni] <= nd) continue;
        if (!this.walkCross(x, y, nx, ny)) continue;
        dist[ni] = nd;
        q[qt++] = ni;
      }
    }
    return dist;
  }
}
