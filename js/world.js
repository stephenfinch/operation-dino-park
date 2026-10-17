// Renders the static world: terrain, paths/tracks, fences, flora and buildings.
import * as THREE from 'three';
import { T } from './map.js';
import { BLD, SPECIES_BY_ID, FENCES } from './data.js';
import { valueNoise } from './util.js';
import { MAT, floraGeometry, leafMaterial, fenceGeometry, brokenFenceGeometry, gateGeometry, buildingGeometry, statueGeometry } from './models.js';
import { grassDetail, flagstone, dirt, dangerSign } from './textures.js';
import { natureLoaded, floraVariants, decorGeometry, DECOR, NATURE_MAT } from './nature.js';

// Tints multiplied with the grass/soil detail texture.
const TERRAIN_COL = {
  [T.GRASS]: [0x5a8a34, 0x7a9440],
  [T.SAND]: [0xe0cf9a, 0xd2bf88],
  [T.WATER]: [0x6a6648, 0x5a5a40],
  [T.SEA]: [0xcab886, 0xb4a476],
  [T.ROCK]: [0x8a8478, 0xa29c90],
  [T.DIRT]: [0x8a7050, 0x7a6448],
};

const WHITE = new THREE.Color(1, 1, 1), DAMAGED = new THREE.Color(1, 0.45, 0.35);
const hash = (i) => { let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

export class WorldView {
  constructor(map, root) {
    this.map = map;
    this.root = root;
    this.seen = { terrain: -1, path: -1, flora: -1, fence: -1, bld: -1 };
    this.bmeshes = new Map();
    this.buildTerrain();
    // grid overlay
    const W = map.W, pts = [];
    for (let i = 0; i <= W; i++) { pts.push(i, 0, 0, i, 0, W, 0, 0, i, W, 0, i); }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.grid = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false }));
    this.grid.position.y = 0.13; this.grid.visible = false;
    root.add(this.grid);
    // flora instancing
    this.floraMeshes = [];
    if (natureLoaded()) this.initNature();
    else for (let id = 1; id <= 6; id++) {
      const fg = floraGeometry(id);
      const parts = [];
      if (fg.trunk) parts.push(new THREE.InstancedMesh(fg.trunk, id === 6 ? MAT.std : MAT.bark, 4096));
      if (fg.leaves) {
        const lm = leafMaterial(fg.leafKind);
        const m = new THREE.InstancedMesh(fg.leaves, lm, 4096);
        if (lm.userData.depth) m.customDepthMaterial = lm.userData.depth;
        parts.push(m);
      }
      for (const m of parts) { m.castShadow = id !== 4; m.receiveShadow = true; m.count = 0; m.frustumCulled = false; root.add(m); }
      this.floraMeshes[id] = parts;
    }
    // fences
    this.fenceMeshes = [];
    for (let t = 1; t <= 3; t++) {
      const m = new THREE.InstancedMesh(fenceGeometry(t), MAT.std, 6000);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(6000 * 3).fill(1), 3);
      m.castShadow = true; m.count = 0; m.frustumCulled = false;
      root.add(m); this.fenceMeshes[t] = m;
    }
    this.brokenMesh = new THREE.InstancedMesh(brokenFenceGeometry(), MAT.std, 2000);
    this.brokenMesh.count = 0; this.brokenMesh.frustumCulled = false;
    this.brokenMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(2000 * 3), 3);
    root.add(this.brokenMesh);
    this.gateMesh = new THREE.InstancedMesh(gateGeometry(), MAT.std, 600);
    this.gateMesh.count = 0; this.gateMesh.frustumCulled = false; this.gateMesh.castShadow = true;
    root.add(this.gateMesh);
    // "Danger – 10,000 V" signs on every other fence panel
    const sg = new THREE.PlaneGeometry(0.34, 0.17);
    this.signMesh = new THREE.InstancedMesh(sg, new THREE.MeshStandardMaterial({ map: dangerSign(), roughness: 0.7, side: THREE.DoubleSide }), 4000);
    this.signMesh.count = 0; this.signMesh.frustumCulled = false;
    root.add(this.signMesh);
    this.pathMesh = null; this.trackMesh = null;
    this.update();
  }

  dispose() {
    this.root.traverse((o) => { if (o.geometry && o !== this.root && !o.userData.shared) { /* geometries cached in models are shared */ } });
  }

  // ---------- terrain ----------
  buildTerrain() {
    const map = this.map, N = map.W * 2 + 1;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * N * 3);
    for (let gy = 0; gy < N; gy++) for (let gx = 0; gx < N; gx++) {
      const i = gy * N + gx;
      pos[i * 3] = gx / 2; pos[i * 3 + 2] = gy / 2;
    }
    const idx = [];
    for (let gy = 0; gy < N - 1; gy++) for (let gx = 0; gx < N - 1; gx++) {
      const a = gy * N + gx, b = a + 1, c = a + N, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * N * 3), 3));
    const uv = new Float32Array(N * N * 2);
    for (let gy = 0; gy < N; gy++) for (let gx = 0; gx < N; gx++) { const i = gy * N + gx; uv[i * 2] = gx / 2 / 3; uv[i * 2 + 1] = gy / 2 / 3; }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.terrainGeo = geo;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, map: grassDetail() });
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = true;
    this.root.add(this.terrain);
    // skirt around island to hide edges under ocean
  }

  refreshTerrain() {
    const map = this.map, N = map.W * 2 + 1;
    const pos = this.terrainGeo.attributes.position.array;
    const col = this.terrainGeo.attributes.color.array;
    const c = new THREE.Color(), c2 = new THREE.Color(), acc = new THREE.Color();
    // Per-vertex noise never changes, so compute it once.
    if (!this.noiseK) {
      this.noiseK = new Float32Array(N * N); this.noiseDry = new Float32Array(N * N);
      for (let gy = 0; gy < N; gy++) for (let gx = 0; gx < N; gx++) {
        const i = gy * N + gx;
        this.noiseK[i] = valueNoise(gx * 0.08, gy * 0.08, 3) * 0.6 + valueNoise(gx * 0.35, gy * 0.35, 9) * 0.4;
        this.noiseDry[i] = valueNoise(gx * 0.05 + 40, gy * 0.05 + 40, 21);
      }
    }
    const pal0 = {}, pal1 = {};
    for (const t in TERRAIN_COL) { pal0[t] = new THREE.Color(TERRAIN_COL[t][0]); pal1[t] = new THREE.Color(TERRAIN_COL[t][1]); }
    for (let gy = 0; gy < N; gy++) for (let gx = 0; gx < N; gx++) {
      const i = gy * N + gx;
      const h = map.hv[i];
      pos[i * 3 + 1] = h;
      const xs = gx & 1 ? [(gx - 1) >> 1] : [gx / 2 - 1, gx / 2];
      const ys = gy & 1 ? [(gy - 1) >> 1] : [gy / 2 - 1, gy / 2];
      acc.setRGB(0, 0, 0); let n = 0;
      for (const ty of ys) for (const tx of xs) {
        let t = T.SEA;
        if (map.inb(tx, ty)) t = map.terrain[map.idx(tx, ty)];
        const pal = TERRAIN_COL[t];
        const k = this.noiseK[i];
        c.copy(pal0[t]); c.lerp(pal1[t], k);
        if (t === T.GRASS) { const dry = this.noiseDry[i]; if (dry > 0.62) c.lerp(c2.set(0x9a9050), (dry - 0.62) * 1.6); }
        if (t === T.ROCK) {
          // grassy hills with bare rock only where the slope is steep
          const hl = map.hv[gy * N + Math.max(0, gx - 1)], hr = map.hv[gy * N + Math.min(N - 1, gx + 1)];
          const hu = map.hv[Math.max(0, gy - 1) * N + gx], hd = map.hv[Math.min(N - 1, gy + 1) * N + gx];
          const slope = Math.hypot(hr - hl, hd - hu);
          const rk = Math.min(1, Math.max(0, (slope - 0.45) / 0.8));
          c2.set(0x5e8636).lerp(c.set(0x7a9040), k * 0.5);
          c.set(pal[0]).lerp(acc.clone().set(pal[1]), k).multiplyScalar(0.85 + Math.min(0.3, h * 0.04));
          c2.lerp(c, rk);
          c.copy(c2);
        }
        acc.add(c); n++;
      }
      acc.multiplyScalar(1 / n);
      if (h < -0.3) acc.lerp(c.set(0x5a7a6a), Math.min(1, (-0.3 - h) * 0.7));
      col[i * 3] = acc.r; col[i * 3 + 1] = acc.g; col[i * 3 + 2] = acc.b;
    }
    this.terrainGeo.attributes.position.needsUpdate = true;
    this.terrainGeo.attributes.color.needsUpdate = true;
    this.terrainGeo.computeVertexNormals();
    this.terrainGeo.computeBoundingSphere();
  }

  // ---------- paths ----------
  refreshPaths() {
    const map = this.map, W = map.W;
    const F = { P: [], U: [], C: [] }, R = { P: [], U: [], C: [] };
    const quad = (o, x0, z0, x1, z1, y, shade = 1) => {
      o.P.push(x0, y, z0, x0, y, z1, x1, y, z0, x1, y, z0, x0, y, z1, x1, y, z1);
      const s = 0.5;
      o.U.push(x0 * s, z0 * s, x0 * s, z1 * s, x1 * s, z0 * s, x1 * s, z0 * s, x0 * s, z1 * s, x1 * s, z1 * s);
      for (let k = 0; k < 6; k++) o.C.push(shade, shade, shade);
    };
    for (let y = 0; y < map.H; y++) for (let x = 0; x < W; x++) {
      const i = map.idx(x, y), p = map.path[i];
      if (!p) continue;
      const h = Math.max(map.heightAt(x + 0.5, y + 0.5), map.heightAt(x, y), map.heightAt(x + 1, y + 1), map.heightAt(x + 1, y), map.heightAt(x, y + 1), -0.1) + 0.03;
      const same = (dx, dy) => map.inb(x + dx, y + dy) && map.path[map.idx(x + dx, y + dy)] === p;
      if (p === 1) {
        quad(F, x, y, x + 1, y + 1, h);
        const b = 0.06;
        if (!same(0, -1)) quad(F, x, y, x + 1, y + b, h + 0.004, 0.6);
        if (!same(0, 1)) quad(F, x, y + 1 - b, x + 1, y + 1, h + 0.004, 0.6);
        if (!same(-1, 0)) quad(F, x, y, x + b, y + 1, h + 0.004, 0.6);
        if (!same(1, 0)) quad(F, x + 1 - b, y, x + 1, y + 1, h + 0.004, 0.6);
      } else {
        quad(R, x + 0.1, y + 0.1, x + 0.9, y + 0.9, h);
        if (same(-1, 0)) quad(R, x, y + 0.1, x + 0.1, y + 0.9, h);
        if (same(1, 0)) quad(R, x + 0.9, y + 0.1, x + 1, y + 0.9, h);
        if (same(0, -1)) quad(R, x + 0.1, y, x + 0.9, y + 0.1, h);
        if (same(0, 1)) quad(R, x + 0.1, y + 0.9, x + 0.9, y + 1, h);
        const horiz = same(-1, 0) || same(1, 0), vert = same(0, -1) || same(0, 1);
        if (horiz) { quad(R, x, y + 0.3, x + 1, y + 0.38, h + 0.004, 0.62); quad(R, x, y + 0.62, x + 1, y + 0.7, h + 0.004, 0.62); }
        if (vert) { quad(R, x + 0.3, y, x + 0.38, y + 1, h + 0.004, 0.62); quad(R, x + 0.62, y, x + 0.7, y + 1, h + 0.004, 0.62); }
      }
    }
    const build = (o, old, tex) => {
      if (old) { this.root.remove(old); old.geometry.dispose(); }
      if (!o.P.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(o.P, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(o.U, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(o.C, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      m.receiveShadow = true;
      this.root.add(m);
      return m;
    };
    this.pathMesh = build(F, this.pathMesh, flagstone());
    this.trackMesh = build(R, this.trackMesh, dirt());
  }

  // ---------- flora ----------
  // Low-poly plant models: one instanced mesh per variant, grown to fit as the island fills up.
  initNature() {
    this.floraSets = [];
    for (let id = 1; id <= 6; id++) {
      const fg = floraGeometry(id), box = new THREE.Box3();
      for (const g of [fg.trunk, fg.leaves]) if (g) { g.computeBoundingBox(); box.union(g.boundingBox); }
      const h = Math.max(0.3, box.max.y - Math.max(0, box.min.y)) * ({ 3: 0.88, 4: 0.9, 6: 0.9 }[id] || 1.05);
      this.floraSets[id] = floraVariants(id, h).map((geo) => ({ geo, mesh: null, cap: 0 }));
    }
    this.decorSets = DECOR.map((n) => ({ geo: decorGeometry(n, 0.3), mesh: null, cap: 0 })).filter((d) => d.geo);
  }
  fillSet(set, mats, shadow) {
    if (set.cap < mats.length) {
      if (set.mesh) { this.root.remove(set.mesh); set.mesh.dispose(); }
      set.cap = Math.max(64, Math.ceil(mats.length * 1.3));
      set.mesh = new THREE.InstancedMesh(set.geo, NATURE_MAT, set.cap);
      set.mesh.castShadow = shadow; set.mesh.receiveShadow = true; set.mesh.frustumCulled = false;
      this.root.add(set.mesh);
    }
    for (let k = 0; k < mats.length; k++) set.mesh.setMatrixAt(k, mats[k]);
    set.mesh.count = mats.length;
    set.mesh.instanceMatrix.needsUpdate = true;
  }
  refreshNature() {
    const map = this.map, N = map.W * map.H;
    const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const lists = this.floraSets.map((sets) => sets ? sets.map(() => []) : null), decor = this.decorSets.map(() => []);
    for (let i = 0; i < N; i++) {
      const f = map.flora[i];
      const x = i % map.W, y = (i / map.W) | 0;
      if (!f) {
        // a sprinkle of grass tufts and flowers on open grass
        if (map.terrain[i] !== T.GRASS || map.path[i] || map.bld[i] >= 0 || !this.decorSets.length) continue;
        const r = hash(i + 4242);
        if (r > 0.02) continue;
        const k = 0;
        const px = x + 0.2 + hash(i + 11) * 0.6, pz = y + 0.2 + hash(i + 13) * 0.6, sc = 0.8 + hash(i + 17) * 0.6;
        p.set(px, map.heightAt(px, pz) - 0.01, pz); q.setFromAxisAngle(up, hash(i + 19) * 6.28); s.set(sc, sc, sc);
        decor[k].push(new THREE.Matrix4().compose(p, q, s));
        continue;
      }
      const sets = this.floraSets[f];
      if (!sets || !sets.length) continue;
      const v = Math.floor(hash(i + 555) * sets.length);
      const jx = (hash(i) - 0.5) * 0.45, jz = (hash(i + 7777) - 0.5) * 0.45;
      const px = x + 0.5 + jx, pz = y + 0.5 + jz;
      const sc = 0.75 + hash(i + 31) * 0.45;
      p.set(px, map.heightAt(px, pz) - 0.02, pz);
      q.setFromAxisAngle(up, hash(i + 99) * Math.PI * 2);
      s.set(sc, sc * (0.9 + hash(i + 5) * 0.25), sc);
      lists[f][v].push(new THREE.Matrix4().compose(p, q, s));
    }
    for (let f = 1; f <= 6; f++) (this.floraSets[f] || []).forEach((set, v) => this.fillSet(set, lists[f][v], f !== 4));
    this.decorSets.forEach((set, k) => this.fillSet(set, decor[k], false));
  }

  refreshFlora() {
    if (this.floraSets) { this.refreshNature(); return; }
    const map = this.map;
    const counts = [0, 0, 0, 0, 0, 0, 0];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < map.W * map.H; i++) {
      const f = map.flora[i];
      if (!f) continue;
      const meshes = this.floraMeshes[f];
      if (counts[f] >= 4096) continue;
      const x = i % map.W, y = (i / map.W) | 0;
      const jx = (hash(i) - 0.5) * 0.45, jz = (hash(i + 7777) - 0.5) * 0.45;
      const px = x + 0.5 + jx, pz = y + 0.5 + jz;
      const sc = (f === 1 ? 0.85 : f <= 3 ? 0.95 : 0.85) * (0.75 + hash(i + 31) * 0.45);
      p.set(px, map.heightAt(px, pz) - 0.02, pz);
      q.setFromAxisAngle(up, hash(i + 99) * Math.PI * 2);
      s.set(sc, sc * (0.9 + hash(i + 5) * 0.25), sc);
      m4.compose(p, q, s);
      for (const m of meshes) m.setMatrixAt(counts[f], m4);
      counts[f]++;
    }
    for (let f = 1; f <= 6; f++) for (const m of this.floraMeshes[f]) { m.count = counts[f]; m.instanceMatrix.needsUpdate = true; }
  }

  // ---------- fences ----------
  refreshFences() {
    const map = this.map, W = map.W, H = map.H;
    const counts = [0, 0, 0, 0];
    let nb = 0, ng = 0, ns = 0;
    const sm = new THREE.Matrix4(), sp = new THREE.Vector3(), sq = new THREE.Quaternion();
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const qh = new THREE.Quaternion(), qv = new THREE.Quaternion().setFromAxisAngle(up, -Math.PI / 2);
    const bcol = [null, new THREE.Color(0xb4b2aa), new THREE.Color(0xaaa8a0), new THREE.Color(0xa09e96)];
    const place = (h, i, x, z) => {
      const t = h ? map.fenceH[i] : map.fenceV[i];
      if (!t) return;
      const hp = h ? map.fenceHHp[i] : map.fenceVHp[i];
      const ec = map.edgeCenter(h, i);
      const y = Math.max(-0.15, map.heightAt(ec.x, ec.z)) - 0.02;
      p.set(x, y, z);
      m4.compose(p, h ? qh : qv, s);
      const tiles = map.edgeTiles(h, i);
      const isGate = tiles.every(([tx, ty]) => map.inb(tx, ty) && map.path[map.idx(tx, ty)] === 2);
      if (hp <= 0) {
        if (nb < 2000) { this.brokenMesh.setMatrixAt(nb, m4); this.brokenMesh.setColorAt(nb, bcol[t]); nb++; }
      } else if (isGate) {
        if (ng < 600) this.gateMesh.setMatrixAt(ng++, m4);
      } else {
        const mesh = this.fenceMeshes[t];
        if (counts[t] < mesh.instanceMatrix.count) { mesh.setColorAt(counts[t], hp < FENCES[t].hp * 0.5 ? DAMAGED : WHITE); mesh.setMatrixAt(counts[t]++, m4); }
        if ((x + z) % 2 === 0 && ns < 4000) {
          // sign hangs on the wires, facing out on both sides (double-sided plane)
          const hy = t === 3 ? 1.25 : t === 2 ? 0.85 : 0.62;
          sp.set(h ? x + 0.5 : x, y + hy, h ? z : z + 0.5);
          sq.setFromAxisAngle(up, h ? 0 : Math.PI / 2);
          sm.compose(sp, sq, s);
          this.signMesh.setMatrixAt(ns++, sm);
        }
      }
    };
    for (let y = 0; y <= H; y++) for (let x = 0; x < W; x++) place(true, map.hIdx(x, y), x, y);
    for (let y = 0; y < H; y++) for (let x = 0; x <= W; x++) place(false, map.vIdx(x, y), x, y);
    for (let t = 1; t <= 3; t++) { const m = this.fenceMeshes[t]; m.count = counts[t]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    this.signMesh.count = ns; this.signMesh.instanceMatrix.needsUpdate = true;
    this.brokenMesh.count = nb; this.brokenMesh.instanceMatrix.needsUpdate = true;
    if (this.brokenMesh.instanceColor) this.brokenMesh.instanceColor.needsUpdate = true;
    this.gateMesh.count = ng; this.gateMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- buildings ----------
  addBuilding(b) {
    const def = BLD[b.type];
    const extra = b.type === 'statue' ? { statue: statueGeometry(SPECIES_BY_ID.tyrannosaurus) } : null;
    const ms = def.model || def.size;
    const geo = buildingGeometry(b.type, ms[0], ms[1], extra);
    const g = new THREE.Group();
    const inner = new THREE.Group();
    const body = new THREE.Mesh(geo.body, MAT.std);
    body.castShadow = true; body.receiveShadow = true;
    inner.add(body);
    if (geo.glow) { const gl = new THREE.Mesh(geo.glow, MAT.glow); gl.castShadow = true; inner.add(gl); }
    g.add(inner);
    const fp = b.footprint;
    // models drawn for an earlier, smaller footprint are fitted to the original's sizes
    const lw = b.rot % 2 ? fp.h : fp.w, lh = b.rot % 2 ? fp.w : fp.h;
    if (b.type === 'entrance') { if (lh > ms[1]) inner.position.z = (lh - ms[1]) / 2; } // the helipad fills the back of the 5×5 plot
    else if (lw !== ms[0] || lh !== ms[1]) { const sx = lw / ms[0], sz = lh / ms[1]; inner.scale.set(sx, Math.min(sx, sz), sz); }
    const cx = fp.x + fp.w / 2, cz = fp.y + fp.h / 2;
    let y = -0.1;
    for (let ty = fp.y; ty < fp.y + fp.h; ty++) for (let tx = fp.x; tx < fp.x + fp.w; tx++) y = Math.max(y, this.map.heightAt(tx + 0.5, ty + 0.5));
    g.position.set(cx, y, cz);
    g.rotation.y = b.rot * Math.PI / 2;
    g.userData.building = b;
    this.root.add(g);
    this.bmeshes.set(b.id, g);
    b.mesh = g;
    return g;
  }
  removeBuilding(b) {
    const g = this.bmeshes.get(b.id);
    if (g) { this.root.remove(g); this.bmeshes.delete(b.id); }
  }

  update() {
    const v = this.map.ver;
    if (v.terrain !== this.seen.terrain) { this.seen.terrain = v.terrain; this.refreshTerrain(); this.seen.path = -1; this.seen.flora = -1; this.seen.fence = -1; }
    if (v.path !== this.seen.path) { this.seen.path = v.path; this.refreshPaths(); this.seen.fence = -1; }
    // decoration avoids paths and buildings, so it refreshes with them too
    if (v.flora !== this.seen.flora || (this.floraSets && (v.path !== this.seen.fp || v.bld !== this.seen.bld))) { this.seen.flora = v.flora; this.seen.fp = v.path; this.seen.bld = v.bld; this.refreshFlora(); }
    if (v.fence !== this.seen.fence) { this.seen.fence = v.fence; this.refreshFences(); }
  }
}

export function fenceColor(t) { return FENCES[t]; }
