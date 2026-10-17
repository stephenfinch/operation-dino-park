// Procedural low-poly models. Everything is built from primitives with baked vertex colours.
import * as THREE from 'three';
import { hasRig, createRiggedDino, rigsLoaded } from './rigged.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD_SCALE } from './data.js';
import { detail, skin, bark, foliage } from './textures.js';
import { valueNoise } from './util.js';

export const MAT = {
  std: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.02, map: detail() }),
  dino: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.0, map: skin(), bumpMap: skin(), bumpScale: 1.2 }),
  // faceted, to sit alongside the low-poly animated models
  dinoFlat: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0.0 }),
  dead: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, color: 0x8a7a70, map: skin() }),
  glow: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: 0xffd890, emissiveIntensity: 0, map: detail() }),
  bark: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, map: bark() }),
  ghostOk: new THREE.MeshBasicMaterial({ color: 0x40ff80, transparent: true, opacity: 0.45, depthWrite: false }),
  ghostBad: new THREE.MeshBasicMaterial({ color: 0xff4040, transparent: true, opacity: 0.45, depthWrite: false }),
};

const _c = new THREE.Color(), _c2 = new THREE.Color();
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

// Prepare a geometry: transformed (keeping smooth normals and uvs), non-indexed, vertex-coloured.
function prep(geo, color, o = {}) {
  let g = geo.clone();
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (o.scale) g.scale(o.scale[0], o.scale[1], o.scale[2]);
  if (o.rot) { _e.set(o.rot[0] || 0, o.rot[1] || 0, o.rot[2] || 0, o.order || 'XYZ'); g.applyMatrix4(_m.makeRotationFromEuler(_e)); }
  if (o.pos) g.translate(o.pos[0], o.pos[1], o.pos[2]);
  if (g.index) g = g.toNonIndexed();
  if (o.flat) g.computeVertexNormals();
  const pos = g.attributes.position, nor = g.attributes.normal;
  const n = pos.count;
  const col = new Float32Array(n * 3);
  _c.set(color);
  for (let i = 0; i < n; i++) {
    let r = _c.r, gg = _c.g, b = _c.b;
    if (o.shade) {
      const out = o.shade(pos.getX(i), pos.getY(i), pos.getZ(i), nor.getX(i), nor.getY(i), nor.getZ(i));
      r = out.r; gg = out.g; b = out.b;
    }
    col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// Part collector -> merged geometry.
export class Parts {
  constructor() { this.list = []; }
  add(geo, color, o) { this.list.push(prep(geo, color, o)); return this; }
  box(w, h, d, color, pos = [0, 0, 0], rot, shade) { return this.add(new THREE.BoxGeometry(w, h, d), color, { pos, rot, shade }); }
  cyl(rt, rb, h, color, pos = [0, 0, 0], rot, seg = 8, shade) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, { pos, rot, shade }); }
  cone(r, h, color, pos = [0, 0, 0], rot, seg = 6, shade) { return this.add(new THREE.ConeGeometry(r, h, seg), color, { pos, rot, shade }); }
  sph(r, color, pos = [0, 0, 0], scale = [1, 1, 1], seg = [8, 6], rot, shade) {
    return this.add(new THREE.SphereGeometry(r, seg[0], seg[1]), color, { pos, scale, rot, shade });
  }
  ico(r, color, pos = [0, 0, 0], scale = [1, 1, 1], detail = 0, shade) { return this.add(new THREE.IcosahedronGeometry(r, detail), color, { pos, scale, shade }); }
  // tube along +X from 0..len
  tubeX(r0, r1, len, color, pos = [0, 0, 0], rot, seg = 7, shade) {
    const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
    g.rotateZ(-Math.PI / 2); g.translate(len / 2, 0, 0);
    return this.add(g, color, { pos, rot, shade });
  }
  // tube from point a to point b
  tubeAB(a, b, r0, r1, color, seg = 6, shade) {
    const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = dir.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
    g.translate(a[0], a[1], a[2]);
    return this.add(g, color, { shade });
  }
  merge() {
    if (!this.list.length) return null;
    const g = mergeGeometries(this.list, false);
    g.computeBoundingSphere();
    return g;
  }
}

// ======================= DINOSAURS =======================
// Sweep an elliptical cross-section along +X through a list of rings: {x, y, ry, rz, belly?}.
export function loft(inRings, seg = 14, capEnd = true, capStart = true) {
  // Rounded (hemispherical) ends so overlapping parts blend instead of showing flat discs.
  const rings = inRings.slice();
  const dome = (r, dir) => {
    const out = [];
    const R = (r.ry + r.rz) / 2;
    for (let k = 1; k <= 4; k++) {
      const ang = (k / 4) * Math.PI / 2;
      const sc = Math.max(0.02, Math.cos(ang));
      out.push({ x: r.x + dir * Math.sin(ang) * R * 0.85, y: r.y, ry: r.ry * sc, rz: r.rz * sc, belly: r.belly });
    }
    return out;
  };
  if (capStart) rings.unshift(...dome(rings[0], -1).reverse());
  if (capEnd) rings.push(...dome(rings[rings.length - 1], 1));
  const pos = [], uv = [], idx = [];
  const n = rings.length;
  // keep texture cells roughly square: u advances by length / circumference
  let avgR = 0; for (const r of inRings) avgR += (r.ry + r.rz) / 2; avgR = Math.max(0.01, avgR / inRings.length);
  const circ = Math.PI * 2 * avgR;
  for (let i = 0; i < n; i++) {
    const r = rings[i];
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const ry = c < 0 ? r.ry * (r.belly ?? 1) : r.ry;
      pos.push(r.x, r.y + c * ry, s * r.rz);
      uv.push((r.x - rings[0].x) / circ, j / seg);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * (seg + 1) + j, b = a + seg + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function dinoShade(sp) {
  const m = sp.model;
  const top = new THREE.Color(sp.col), bot = new THREE.Color(sp.col2);
  const dark = top.clone().multiplyScalar(0.55);
  const f = 1 / Math.max(0.15, m.bodyH * 0.32);
  return (x, y, z, nx, ny) => {
    const t = Math.min(1, Math.max(0, ny * 0.8 + 0.5));
    _c2.copy(bot).lerp(top, t);
    if (ny > 0.6) _c2.lerp(dark, (ny - 0.6) * 0.8);
    // mottling
    const mot = valueNoise(x * f * 1.7 + 11, (y + z) * f * 1.7 + 3, 7);
    _c2.multiplyScalar(0.86 + mot * 0.26);
    if (sp.stripes && ny > -0.25) {
      const s = Math.sin(x * f * 2.2 + Math.sin(y * f) * 0.8);
      if (s > 0.35) _c2.lerp(dark, Math.min(0.65, (s - 0.35) * 1.6) * Math.min(1, (ny + 0.25) * 2));
    }
    return _c2;
  };
}
const solidShade = (hex, k = 0.2) => {
  const c = new THREE.Color(hex), d = c.clone().multiplyScalar(1 - k);
  return (x, y, z, nx, ny) => { _c2.copy(d).lerp(c, Math.max(0, ny * 0.5 + 0.5)); return _c2; };
};

const dinoCache = new Map();

export function dinoGeometry(sp) {
  if (dinoCache.has(sp.id)) return dinoCache.get(sp.id);
  const m = sp.model;
  const shade = dinoShade(sp);
  const S = (geo) => geo; // geometry already in metres; scaled at group level
  const cx = m.bodyL * 0.3, cy = m.bodyH * 0.1;
  const spineY = (x) => { const u = (x - cx) / (m.bodyL * 0.62); return cy + m.bodyH * Math.sqrt(Math.max(0, 1 - u * u)); };
  const out = {};
  const featCol = sp.plateCol || sp.sailCol || new THREE.Color(sp.col).multiplyScalar(0.75).getHex();
  // --- Torso (+ back features) ---
  {
    const p = new Parts();
    const rings = [];
    const N = 16;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const x = lerpN(-m.bodyL * 0.34, m.bodyL * 1.0, t);
      // full at the belly, tapering to tail base behind and neck in front
      const prof = 0.5 + 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.75);
      const front = t > 0.8 ? 1 - (t - 0.8) * 1.6 : 1;
      rings.push({ x, y: cy + (t - 0.45) * m.bodyH * 0.12, ry: m.bodyH * prof * front, rz: m.bodyR * prof * (0.85 + 0.15 * front), belly: 1.05 });
    }
    p.add(loft(rings, 16, true, true), sp.col, { shade });
    if (sp.plates) {
      const n = sp.plates === 'stego' ? 9 : 6;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const x = lerpN(-m.bodyL * 0.28, m.bodyL * 0.8, t);
        const s = m.bodyH * (sp.plates === 'stego' ? 0.35 + 0.55 * Math.sin(Math.PI * (0.15 + t * 0.75)) : 0.35);
        const z = (i % 2 ? 1 : -1) * m.bodyR * 0.12;
        if (sp.plates === 'kentro' && t < 0.45) {
          p.cone(s * 0.18, s * 1.2, featCol, [x, spineY(x) + s * 0.5, z], [0, 0, 0.5], 5, solidShade(0xd8d0b0));
        } else {
          p.box(s, s, m.bodyR * 0.05, featCol, [x, spineY(x) + s * 0.3, z], [0, 0, Math.PI / 4], solidShade(featCol, 0.3));
        }
      }
      if (sp.plates === 'kentro') {
        for (const sd of [-1, 1]) p.cone(m.bodyH * 0.08, m.bodyH * 0.9, 0xd8d0b0, [m.bodyL * 0.05, cy, sd * m.bodyR * 0.9], [sd * 1.2, 0, 0.6], 5);
      }
    }
    if (sp.sail) {
      const L = m.bodyL + m.tailL + m.neckL + m.headL;
      const H = sp.sail * L;
      const n = 11;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const x = lerpN(-m.bodyL * 0.25, m.bodyL * 0.85, t);
        const h = H * Math.pow(Math.sin(Math.PI * (0.08 + t * 0.84)), 0.8);
        p.box(m.bodyL * 1.1 / n + 0.02, h, m.bodyR * 0.06, sp.sailCol || featCol, [x, spineY(x) + h / 2 - m.bodyH * 0.1, 0], null,
          (x2, y2, z2, nx, ny) => { _c2.set(sp.sailCol || featCol).lerp(_c.set(0x2a1a10), Math.max(0, (y2 - spineY(x2)) / H) * 0.4); return _c2; });
      }
    }
    if (sp.ridge) {
      for (let i = 0; i < 8; i++) {
        const x = lerpN(-m.bodyL * 0.2, m.bodyL * 0.85, i / 7);
        p.cone(m.bodyR * 0.08, m.bodyH * 0.22, featCol, [x, spineY(x) + m.bodyH * 0.05, 0], null, 4);
      }
    }
    if (sp.armor) {
      for (let i = 0; i < 18; i++) {
        const x = lerpN(-m.bodyL * 0.25, m.bodyL * 0.85, (i % 6) / 5);
        const z = ((Math.floor(i / 6) - 1) * 0.45) * m.bodyR;
        const y = spineY(x) - Math.abs(z) * 0.35;
        p.cone(m.bodyR * 0.08, m.bodyH * 0.18, 0x5a4a38, [x, y, z], null, 4);
      }
      for (const sd of [-1, 1]) for (let i = 0; i < 5; i++) {
        const x = lerpN(-m.bodyL * 0.2, m.bodyL * 0.8, i / 4);
        p.cone(m.bodyR * 0.07, m.bodyR * 0.35, 0xd0c4a8, [x, cy - m.bodyH * 0.1, sd * m.bodyR * 1.0], [sd * Math.PI / 2, 0, 0], 4);
      }
    }
    out.torso = p.merge();
  }
  // --- Neck ---
  {
    const p = new Parts();
    const nr = [];
    // taper so the tip always fits inside the head
    const r0 = m.neckR * 1.75, r1 = Math.min(m.neckR * 0.9, m.headH * 0.42);
    const xEnd = m.neckL * (r1 < m.neckR * 0.9 ? 1.0 : 1.05);
    for (let i = 0; i < 7; i++) {
      const t = i / 6, k = Math.pow(t, 0.7);
      const r = r0 + (r1 - r0) * k;
      nr.push({ x: lerpN(-m.neckL * 0.22, xEnd, t), y: 0, ry: r * 1.12, rz: r, belly: 1.08 });
    }
    p.add(loft(nr, 12, true, true), sp.col, { shade });
    if (sp.sail && sp.diet === 'carn') p.box(m.neckL * 0.8, m.neckR * 0.9, m.neckR * 0.1, sp.sailCol || featCol, [m.neckL * 0.4, m.neckR * 1.1, 0]);
    out.neck = p.merge();
  }
  // --- Head ---
  {
    const p = new Parts();
    const hl = m.headL, hh = m.headH, hw = m.headW;
    p.sph(1, sp.col, [hl * 0.28, 0, 0], [hl * 0.38, hh * 0.52, hw * 0.52], [14, 10], null, shade);
    p.sph(1, sp.col, [hl * 0.66, -hh * 0.06, 0], [hl * 0.38, hh * 0.36, hw * 0.37], [14, 10], null, shade);
    for (const sd of [-1, 1]) p.sph(hh * 0.085, 0x1a1408, [hl * 0.42, hh * 0.2, sd * hw * 0.43], [1, 1, 1], [8, 6]);
    if (m.teeth) for (const sd of [-1, 1]) for (let i = 0; i < 5; i++) {
      p.cone(hh * 0.035, hh * 0.13, 0xf4f0e0, [hl * (0.5 + i * 0.09), -hh * 0.38, sd * hw * 0.28], [Math.PI, 0, 0], 4);
    }
    const hornCol = 0xe8dcc0;
    const frillCol = sp.frillCol || new THREE.Color(sp.col).lerp(new THREE.Color(0xc07040), 0.4).getHex();
    if (sp.horns === 'trike') {
      for (const sd of [-1, 1]) p.cone(hh * 0.12, hl * 0.55, hornCol, [hl * 0.55, hh * 0.55, sd * hw * 0.28], [0, 0, -1.1], 6);
      p.cone(hh * 0.1, hl * 0.18, hornCol, [hl * 0.88, hh * 0.25, 0], [0, 0, -0.5], 5);
    } else if (sp.horns === 'styraco') {
      p.cone(hh * 0.14, hl * 0.55, hornCol, [hl * 0.78, hh * 0.45, 0], [0, 0, -0.35], 6);
    } else if (sp.horns === 'nasal') {
      p.cone(hh * 0.12, hh * 0.55, hornCol, [hl * 0.72, hh * 0.38, 0], [0, 0, -0.2], 5);
      for (const sd of [-1, 1]) p.cone(hh * 0.08, hh * 0.25, frillCol, [hl * 0.35, hh * 0.45, sd * hw * 0.3], null, 4);
    } else if (sp.horns === 'bull') {
      for (const sd of [-1, 1]) p.cone(hh * 0.14, hh * 0.6, 0x5a3a2a, [hl * 0.3, hh * 0.5, sd * hw * 0.5], [sd * 0.9, 0, 0], 5);
    }
    if (sp.frill) {
      const r = sp.frill === 'huge' ? hl * 0.62 : sp.frill === 'spiky' ? hl * 0.38 : hl * 0.48;
      const lean = 0.85;
      // a shallow curved shield, concave side forward
      const fg = new THREE.SphereGeometry(r, 18, 6, 0, Math.PI * 2, 0, 0.75);
      fg.scale(1, 0.35, 1);
      fg.rotateZ(Math.PI / 2 + lean);
      p.add(fg, frillCol, { pos: [-hl * 0.02, hh * 0.45, 0], shade: (x, y, z, nx, ny, nz) => { _c2.set(frillCol).multiplyScalar(0.75 + Math.abs(nx) * 0.25 + Math.max(0, ny) * 0.2); if (Math.hypot(x + hl * 0.02, y - hh * 0.45, z) > r * 0.82) _c2.multiplyScalar(0.7); return _c2; } });
      if (sp.frill === 'spiky') {
        for (let i = 0; i < 6; i++) {
          const a = -0.9 + (i / 5) * 1.8;
          const dx = -Math.sin(lean) * Math.cos(a) * r, dy = Math.cos(lean) * Math.cos(a) * r, dz = Math.sin(a) * r;
          p.tubeAB([-hl * 0.02 + dx, hh * 0.45 + dy, dz], [-hl * 0.02 + dx * 2.2, hh * 0.45 + dy * 2.2, dz * 2.0], hh * 0.06, 0.005, hornCol, 4);
        }
      }
    }
    if (sp.crest === 'tube') p.tubeAB([hl * 0.45, hh * 0.35, 0], [-hl * 0.9, hh * 1.4, 0], hh * 0.16, hh * 0.12, sp.col2 === 0xf0e0b8 ? 0xc05a2a : featCol, 6);
    if (sp.crest === 'helmet') p.sph(1, 0xc06a3a, [hl * 0.3, hh * 0.6, 0], [hl * 0.32, hh * 0.55, hw * 0.12], [8, 6], null, solidShade(0xc06a3a, 0.3));
    if (sp.crest === 'double') for (const sd of [-1, 1]) p.sph(1, 0xc84a2a, [hl * 0.45, hh * 0.55, sd * hw * 0.18], [hl * 0.38, hh * 0.32, hw * 0.05], [8, 6], null, solidShade(0xc84a2a, 0.3));
    if (sp.dome || sp.flatDome) {
      p.sph(1, 0x8a7a6a, [hl * 0.28, hh * 0.32, 0], [hl * 0.32, hh * (sp.flatDome ? 0.3 : 0.48), hw * 0.55], [9, 7], null, solidShade(0xb0a090, 0.35));
      for (let i = 0; i < 6; i++) p.cone(hh * 0.05, hh * 0.15, 0xd8d0c0, [hl * (0.0 + (i % 3) * 0.05), hh * 0.15, (i < 3 ? -1 : 1) * hw * 0.48], [i < 3 ? -1 : 1, 0, 0], 4);
    }
    out.head = p.merge();
    const j = new Parts();
    j.sph(1, sp.col2, [hl * 0.34, -hh * 0.06, 0], [hl * 0.42, hh * 0.14, hw * 0.31], [12, 8], null, solidShade(sp.col2, 0.25));
    if (m.teeth) for (const sd of [-1, 1]) for (let i = 0; i < 4; i++) j.cone(hh * 0.03, hh * 0.1, 0xf4f0e0, [hl * (0.25 + i * 0.1), hh * 0.06, sd * hw * 0.22], null, 4);
    out.jaw = j.merge();
  }
  // --- Tail (4 segments along -X) ---
  {
    const r0 = Math.min(m.bodyH, m.bodyR) * 0.7;
    const seg = m.tailL / 4;
    out.tail = [];
    for (let i = 0; i < 4; i++) {
      const p = new Parts();
      const ra = r0 * (1 - i * 0.24), rb = r0 * (1 - (i + 1) * 0.24) + r0 * 0.04;
      // tail runs along -X: loft along +X then mirror by building rings with negative x
      const tr = [];
      for (let k = 0; k < 4; k++) { const u = k / 3; const r = ra + (rb - ra) * u; tr.push({ x: -seg * (1.18 * u) + seg * (i === 0 ? 0.35 : 0.1), y: 0, ry: r * 1.15, rz: r * 0.9, belly: 1.1 }); }
      tr.reverse();
      p.add(loft(tr, 12, true, true), sp.col, { shade });
      if (sp.plates === 'stego' && i < 2) {
        for (let k = 0; k < 2; k++) {
          const s = m.bodyH * (0.45 - i * 0.18 - k * 0.08);
          p.box(s, s, m.bodyR * 0.05, featCol, [-seg * (0.3 + k * 0.45), ra * 0.8 + s * 0.25, (k % 2 ? 1 : -1) * m.bodyR * 0.08], [0, 0, Math.PI / 4], solidShade(featCol, 0.3));
        }
      }
      if (sp.plates === 'kentro' && i < 3) {
        for (const sd of [-1, 1]) p.cone(ra * 0.25, m.bodyH * 0.5, 0xd8d0b0, [-seg * 0.5, ra * 0.6, sd * ra * 0.5], [sd * 0.6, 0, 0.6], 4);
      }
      if (sp.tailSpikes && i === 3) {
        for (const sd of [-1, 1]) for (let k = 0; k < 2; k++) p.cone(rb * 0.6 + 0.04, m.bodyH * 0.6, 0xe8dcc0, [-seg * (0.4 + k * 0.4), rb, sd * rb], [sd * 0.9, 0, 0.9], 5);
      }
      if (sp.club && i === 3) p.sph(1, 0x6a5a44, [-seg * 1.05, 0, 0], [m.bodyR * 0.35, m.bodyR * 0.18, m.bodyR * 0.3], [8, 6]);
      if (sp.sail && i === 0 && sp.diet === 'herb') p.box(seg * 0.8, m.bodyH * 0.3, m.bodyR * 0.05, featCol, [-seg * 0.4, ra + m.bodyH * 0.1, 0]);
      if (sp.armor) for (const sd of [-1, 1]) p.cone(ra * 0.2, ra * 0.5, 0xd0c4a8, [-seg * 0.5, 0, sd * ra * 0.9], [sd * Math.PI / 2, 0, 0], 4);
      out.tail.push(p.merge());
    }
    out.tailSeg = seg;
    out.tailR0 = r0;
  }
  // --- Legs ---
  const legGeo = (len, r, biped) => {
    const p = new Parts();
    // limb lofted from hip (x=0) to ankle (x=len), then turned to hang down; y offset becomes forward
    const lr = [];
    const K = 9;
    for (let k = 0; k < K; k++) {
      const t = k / (K - 1);
      const fwd = biped ? (t < 0.45 ? (t / 0.45) * 0.16 : 0.16 - ((t - 0.45) / 0.55) * 0.24) * len : (t < 0.5 ? 0.04 * len * t : 0.02 * len);
      const thigh = biped ? 1.85 : 1.5;
      const rad = t < 0.2 ? r * (thigh * 0.8 + (t / 0.2) * thigh * 0.2) : t < 0.45 ? r * thigh - ((t - 0.2) / 0.25) * r * (thigh - (biped ? 1.05 : 1.1)) : r * (biped ? 1.05 : 1.1) - ((t - 0.45) / 0.55) * r * (biped ? 0.5 : 0.2);
      lr.push({ x: t * len * 0.97, y: fwd, ry: rad * (t < 0.45 ? 1.15 : 1), rz: rad * 0.85 });
    }
    const lg = loft(lr, 10, true, true);
    lg.rotateZ(-Math.PI / 2);
    p.add(lg, sp.col, { shade });
    if (biped) {
      p.box(r * 3.4, r * 0.45, r * 1.5, new THREE.Color(sp.col).multiplyScalar(0.6).getHex(), [r * 1.1 - len * 0.08, -len + r * 0.22, 0]);
      for (const sd of [-1, 0, 1]) p.cone(r * 0.22, r * 1.4, 0x2a2018, [r * 2.4 - len * 0.08, -len + r * 0.15, sd * r * 0.45], [0, 0, -Math.PI / 2], 5);
    } else {
      p.cyl(r * 0.95, r * 1.05, r * 0.4, new THREE.Color(sp.col).multiplyScalar(0.55).getHex(), [r * 0.15 + len * 0.02, -len + r * 0.2, 0], null, 10);
    }
    return p.merge();
  };
  const _unusedLegGeo = (len, r, biped) => {
    const p = new Parts();
    if (biped) {
      p.sph(1, sp.col, [len * 0.06, -len * 0.2, 0], [r * 2.0, len * 0.32, r * 1.45], [12, 9], null, shade);
      p.tubeAB([len * 0.12, -len * 0.42, 0], [-len * 0.06, -len * 0.82, 0], r * 0.9, r * 0.6, sp.col, 10, shade);
      p.tubeAB([-len * 0.06, -len * 0.82, 0], [0.02, -len * 0.98, 0], r * 0.6, r * 0.5, sp.col, 10, shade);
      p.box(r * 3.6, r * 0.5, r * 1.6, new THREE.Color(sp.col).multiplyScalar(0.7).getHex(), [r * 1.2, -len + r * 0.25, 0]);
    } else {
      p.sph(1, sp.col, [0, -len * 0.2, 0], [r * 1.6, len * 0.34, r * 1.35], [12, 9], null, shade);
      p.tubeAB([0, -len * 0.4, 0], [0, -len, 0], r * 0.95, r * 0.85, sp.col, 10, shade);
      p.cyl(r * 1.05, r * 1.1, r * 0.4, new THREE.Color(sp.col).multiplyScalar(0.65).getHex(), [r * 0.15, -len + r * 0.2, 0], null, 7);
    }
    return p.merge();
  };
  const biped = m.plan === 'biped';
  const backPivotY = -0.1 * m.bodyH;
  out.backLegLen = m.hipH + backPivotY;
  out.backLeg = legGeo(out.backLegLen, m.legR, biped);
  if (!biped) {
    const fx = m.bodyL * 0.78, fy = -0.12 * m.bodyH;
    const worldY = m.hipH + fx * Math.sin(m.pitch) + fy * Math.cos(m.pitch);
    out.frontLegLen = Math.max(0.3, worldY);
    out.frontLeg = legGeo(out.frontLegLen, m.legR * m.frontR, false);
    out.frontPivot = [fx, fy];
  }
  if (m.armL > 0 && biped) {
    const p = new Parts();
    p.tubeAB([0, 0, 0], [m.armL * 0.4, -m.armL * 0.7, 0], m.legR * 0.45, m.legR * 0.3, sp.col, 5, shade);
    p.tubeAB([m.armL * 0.4, -m.armL * 0.7, 0], [m.armL * 0.85, -m.armL * 0.85, 0], m.legR * 0.3, m.legR * 0.2, sp.col, 5, shade);
    out.arm = p.merge();
  }
  out.cx = cx; out.cy = cy;
  dinoCache.set(sp.id, out);
  return out;
}
const lerpN = (a, b, t) => a + (b - a) * t;

// Build an animated instance (THREE.Group) for a species.
export function createDinoMesh(sp, opts = {}) {
  const m = sp.model;
  if (!opts.procedural && hasRig(sp)) return createRiggedDino(sp, m.bodyL + m.tailL + m.neckL + m.headL);
  const geo = dinoGeometry(sp);
  const mat = rigsLoaded() ? MAT.dinoFlat : MAT.dino;
  const mk = (g) => { const me = new THREE.Mesh(g, mat); me.castShadow = true; return me; };
  const root = new THREE.Group();
  const scaler = new THREE.Group();
  root.add(scaler);
  const body = new THREE.Group();
  body.position.set(0, m.hipH, 0);
  body.rotation.z = m.pitch;
  scaler.add(body);
  const torso = mk(geo.torso); body.add(torso);
  const neck = new THREE.Group();
  neck.position.set(m.bodyL * 0.8, m.bodyH * 0.35, 0);
  neck.rotation.z = m.neckAng;
  body.add(neck);
  neck.add(mk(geo.neck));
  const head = new THREE.Group();
  head.position.set(m.neckL, 0, 0);
  head.rotation.z = -(m.neckAng + m.pitch) - 0.08;
  neck.add(head);
  head.add(mk(geo.head));
  const jaw = new THREE.Group();
  jaw.position.set(m.headL * 0.12, -m.headH * 0.3, 0);
  head.add(jaw);
  jaw.add(mk(geo.jaw));
  const tail = [];
  let parent = body;
  for (let i = 0; i < 4; i++) {
    const t = new THREE.Group();
    if (i === 0) t.position.set(-m.bodyL * 0.22, m.bodyH * 0.15, 0);
    else t.position.set(-geo.tailSeg, 0, 0);
    t.rotation.z = i === 0 ? -m.pitch * 0.6 + m.tailAng : 0.02;
    t.add(mk(geo.tail[i]));
    parent.add(t);
    tail.push(t);
    parent = t;
  }
  const legs = [];
  const side = m.bodyR * 0.62;
  for (const sd of [-1, 1]) {
    const l = new THREE.Group();
    l.position.set(0, -0.1 * m.bodyH, sd * side);
    l.add(mk(geo.backLeg));
    body.add(l);
    legs.push({ g: l, base: -m.pitch, ph: sd > 0 ? 0 : Math.PI, front: false });
  }
  if (geo.frontLeg) {
    for (const sd of [-1, 1]) {
      const l = new THREE.Group();
      l.position.set(geo.frontPivot[0], geo.frontPivot[1], sd * side * 0.9);
      l.add(mk(geo.frontLeg));
      body.add(l);
      legs.push({ g: l, base: -m.pitch, ph: sd > 0 ? Math.PI : 0, front: true });
    }
  }
  const arms = [];
  if (geo.arm) {
    for (const sd of [-1, 1]) {
      const a = new THREE.Group();
      a.position.set(m.bodyL * 0.78, -m.bodyH * 0.3, sd * m.bodyR * 0.55);
      a.add(mk(geo.arm));
      body.add(a);
      arms.push(a);
    }
  }
  root.userData = { scaler, body, neck, head, jaw, tail, legs, arms, sp, baseNeck: m.neckAng, baseHead: head.rotation.z };
  return root;
}

export function setDinoMaterial(root, mat) {
  root.traverse((o) => { if (o.isMesh) o.material = mat; });
}

export function dinoWorldScale(sp) { return WORLD_SCALE; }

// Bronze statue (merged rest pose of a Tyrannosaurus).
export function statueGeometry(sp) {
  const g = createDinoMesh(sp, { procedural: true });
  const s = 0.11;
  g.scale.setScalar(s);
  g.position.set(0, 0.45, 0);
  g.rotation.y = -0.6;
  g.updateMatrixWorld(true);
  const list = [];
  g.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);
    const col = geo.attributes.color;
    for (let i = 0; i < col.count; i++) {
      const l = (col.getX(i) + col.getY(i) + col.getZ(i)) / 3;
      col.setXYZ(i, 0.45 + l * 0.35, 0.3 + l * 0.25, 0.12 + l * 0.1);
    }
    list.push(geo);
  });
  return list;
}

// ======================= VISITORS =======================
export function visitorGeometries() {
  const body = new Parts();
  body.box(0.16, 0.2, 0.1, 0xffffff, [0, 0.33, 0]);
  body.box(0.05, 0.16, 0.05, 0xffffff, [0, 0.33, 0.1]);
  body.box(0.05, 0.16, 0.05, 0xffffff, [0, 0.33, -0.1]);
  const rest = new Parts();
  rest.sph(0.065, 0xe0b090, [0, 0.5, 0], [1, 1, 1], [6, 5]);
  rest.box(0.06, 0.23, 0.06, 0x3a4a6a, [0, 0.115, 0.045]);
  rest.box(0.06, 0.23, 0.06, 0x3a4a6a, [0, 0.115, -0.045]);
  rest.box(0.13, 0.03, 0.13, 0xd8c8a0, [0, 0.57, 0]);
  // umbrella, shown in the rain and tinted by guest type
  const umb = new Parts();
  umb.cone(0.24, 0.1, 0xffffff, [0.06, 0.74, 0], null, 8);
  umb.cyl(0.008, 0.008, 0.3, 0x3a3a3a, [0.06, 0.56, 0]);
  return { body: body.merge(), rest: rest.merge(), umbrella: umb.merge() };
}

// ======================= FLORA =======================
// Leaf materials use alpha-cut canvas textures; a matching depth material gives leaf-shaped shadows.
const leafMats = {};
export function leafMaterial(kind) {
  if (leafMats[kind]) return leafMats[kind];
  const map = foliage(kind);
  const opaque = kind === 'needles';
  const m = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.85, side: THREE.DoubleSide, alphaTest: opaque ? 0 : 0.3 });
  m.userData.depth = opaque ? null : new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.3, side: THREE.DoubleSide });
  leafMats[kind] = m;
  return m;
}

// A bent strip (frond) from `base`, pointing along angle `yaw`, rising `tilt` then drooping.
function frond(len, width, tilt, droop, yaw, base, segs = 6) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const along = t * len;
    const up = Math.sin(tilt) * along - droop * t * t * len;
    const out = Math.cos(tilt) * along;
    const w = width * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, t * 0.95 + 0.05)));
    for (const sd of [-1, 1]) {
      const lx = out, ly = up, lz = sd * w / 2;
      // rotate around Y by yaw
      const x = lx * Math.cos(yaw) - lz * Math.sin(yaw), z = lx * Math.sin(yaw) + lz * Math.cos(yaw);
      pos.push(base[0] + x, base[1] + ly, base[2] + z);
      uv.push(t, sd < 0 ? 0 : 1);
    }
  }
  for (let i = 0; i < segs; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function card(size, yaw, center) {
  const g = new THREE.PlaneGeometry(size, size);
  g.rotateY(yaw);
  g.translate(center[0], center[1], center[2]);
  return g;
}

const floraCache = {};
// Returns { trunk, leaves, leafKind }. Units: tiles (1 tile ≈ 2.5 m).
export function floraGeometry(id) {
  if (floraCache[id]) return floraCache[id];
  const t = new Parts(), l = new Parts();
  let kind = null;
  const tint = (k) => new THREE.Color(1, 1, 1).multiplyScalar(k).getHex();
  switch (id) {
    case 1: { // palm: curved trunk, drooping fronds
      kind = 'palm';
      let x = 0, y = 0;
      for (let i = 0; i < 6; i++) {
        const nx = x + 0.05 * (i + 1) * 0.6, ny = y + 0.48;
        t.tubeAB([x, y, 0], [nx, ny, 0], 0.11 - i * 0.012, 0.1 - i * 0.012, 0x9a8a70, 8);
        x = nx; y = ny;
      }
      t.sph(0.14, 0x6a5030, [x, y - 0.05, 0], [1, 0.8, 1], [8, 6]);
      for (let i = 0; i < 9; i++) l.add(frond(1.5 + (i % 3) * 0.15, 0.55, 0.45, 1.05, (i / 9) * Math.PI * 2, [x, y, 0]), tint(0.95 + (i % 2) * 0.08));
      for (let i = 0; i < 4; i++) l.add(frond(1.0, 0.45, 1.1, 0.5, (i / 4) * Math.PI * 2 + 0.4, [x, y, 0]), tint(1.05));
      break;
    }
    case 2: { // tree fern: fibrous trunk with a crown of long arching fronds
      kind = 'fern';
      let x = 0, y = 0;
      for (let i = 0; i < 4; i++) { const nx = x + 0.03 * (i - 1), ny = y + 0.42; t.tubeAB([x, y, 0], [nx, ny, 0], 0.11 - i * 0.008, 0.1 - i * 0.008, 0x5a4636, 8); x = nx; y = ny; }
      t.sph(0.12, 0x4a3a28, [x, y, 0], [1, 0.7, 1], [8, 6]);
      for (let i = 0; i < 11; i++) l.add(frond(1.25 + (i % 3) * 0.12, 0.42, 0.55, 0.95, (i / 11) * Math.PI * 2, [x, y, 0]), tint(0.92 + (i % 2) * 0.1));
      for (let i = 0; i < 4; i++) l.add(frond(0.7, 0.32, 1.2, 0.4, (i / 4) * Math.PI * 2 + 0.3, [x, y, 0]), tint(1.05));
      break;
    }
    case 3: { // jungle / broadleaf tree
      kind = 'leaves';
      t.cyl(0.1, 0.16, 1.4, 0x8a7258, [0, 0.7, 0], null, 8);
      t.tubeAB([0, 1.0, 0], [0.45, 1.5, 0.15], 0.07, 0.04, 0x8a7258, 6);
      t.tubeAB([0, 1.1, 0], [-0.4, 1.55, -0.2], 0.07, 0.04, 0x8a7258, 6);
      const clumps = [[0, 1.85, 0, 1.5], [0.5, 1.6, 0.2, 1.1], [-0.45, 1.62, -0.25, 1.1], [0.1, 2.15, -0.1, 1.0], [-0.1, 1.5, 0.45, 0.9]];
      for (const [cx, cy, cz, sz] of clumps) for (let k = 0; k < 3; k++) {
        const g = card(sz, (k / 3) * Math.PI, [cx, cy, cz]);
        g.rotateX(0.25 * (k - 1)); l.add(g, tint(0.9 + k * 0.06));
      }
      for (let k = 0; k < 2; k++) { const g = new THREE.PlaneGeometry(1.5, 1.5); g.rotateX(-Math.PI / 2); g.rotateY(k * 0.8); g.translate(0, 2.0 + k * 0.15, 0); l.add(g, tint(1)); }
      break;
    }
    case 4: { // fern
      kind = 'fern';
      for (let i = 0; i < 10; i++) l.add(frond(0.7 + (i % 3) * 0.1, 0.3, 0.9, 0.85, (i / 10) * Math.PI * 2, [0, 0.02, 0]), tint(0.92 + (i % 2) * 0.1));
      break;
    }
    case 5: { // cycad
      kind = 'cycad';
      t.cyl(0.16, 0.2, 0.5, 0x7a6448, [0, 0.25, 0], null, 9);
      for (let i = 0; i < 12; i++) l.add(frond(0.95, 0.38, 0.75, 0.75, (i / 12) * Math.PI * 2, [0, 0.5, 0]), tint(0.95 + (i % 2) * 0.08));
      break;
    }
    case 6: { // boulder
      t.add(new THREE.DodecahedronGeometry(0.45, 1), 0x8a857e, { pos: [0, 0.15, 0], scale: [1.2, 0.72, 1], shade: solidShade(0x9a958e, 0.4) });
      t.add(new THREE.DodecahedronGeometry(0.24, 1), 0x7a756e, { pos: [0.4, 0.06, 0.18], scale: [1, 0.8, 1] });
      break;
    }
  }
  floraCache[id] = { trunk: t.merge(), leaves: l.merge(), leafKind: kind };
  return floraCache[id];
}

// ======================= FENCES =======================
// One edge segment runs along +X from 0 to 1. Three electrified tiers.
export function fenceGeometry(type) {
  const p = new Parts();
  const conc = 0xb4b2aa, steel = 0x6a6e72, wire = 0xc8ccd0;
  const lamps = (h, w) => { p.box(w * 0.7, 0.07, w * 0.7, 0x2a6aff, [0 - w * 0.15, h + 0.035, 0]); p.box(w * 0.5, 0.06, w * 0.5, 0xff9a20, [w * 0.2, h + 0.03, 0]); };
  if (type === 1) {
    p.box(1.0, 0.16, 0.24, conc, [0.5, 0.08, 0], null, solidShade(conc, 0.3));
    p.box(0.26, 0.28, 0.32, conc, [0, 0.14, 0], null, solidShade(conc, 0.3));
    p.box(0.1, 1.0, 0.1, steel, [0, 0.5, 0]);
    lamps(1.0, 0.1);
    for (let k = 0; k < 5; k++) p.box(1.0, 0.012, 0.012, wire, [0.5, 0.32 + k * 0.14, 0]);
  } else if (type === 2) {
    p.box(1.0, 0.3, 0.3, conc, [0.5, 0.15, 0], null, solidShade(conc, 0.3));
    p.box(0.32, 0.42, 0.38, conc, [0, 0.21, 0], null, solidShade(conc, 0.3));
    p.box(0.13, 1.35, 0.13, steel, [0, 0.67, 0]);
    p.box(0.2, 0.06, 0.2, 0x4a4e52, [0, 1.35, 0]);
    lamps(1.38, 0.13);
    for (let k = 0; k < 7; k++) p.box(1.0, 0.014, 0.014, wire, [0.5, 0.42 + k * 0.13, 0]);
  } else {
    p.box(1.0, 0.75, 0.34, conc, [0.5, 0.375, 0], null, solidShade(conc, 0.3));
    p.box(1.02, 0.08, 0.4, 0x8e8c84, [0.5, 0.78, 0]);
    for (const zz of [-0.18, 0.18]) p.box(0.98, 0.05, 0.02, 0x8a887e, [0.5, 0.3, zz]);
    p.box(0.42, 1.0, 0.46, conc, [0, 0.5, 0], null, solidShade(conc, 0.3));
    p.box(0.16, 1.85, 0.16, steel, [0, 0.92, 0]);
    lamps(1.86, 0.16);
    for (let k = 0; k < 6; k++) p.box(1.0, 0.016, 0.016, wire, [0.5, 0.95 + k * 0.15, 0]);
    p.box(0.16, 0.1, 0.36, 0xd8b020, [0.5, 0.55, 0]);
  }
  return p.merge();
}
export function brokenFenceGeometry() {
  const p = new Parts();
  p.box(1.0, 0.16, 0.26, 0xffffff, [0.5, 0.08, 0]);
  p.box(0.12, 0.9, 0.12, 0xdddddd, [0.35, 0.25, 0.15], [0.9, 0.3, 0.9]);
  for (let k = 0; k < 3; k++) p.box(0.9, 0.015, 0.015, 0xcccccc, [0.5, 0.15 + k * 0.05, 0.3 + k * 0.08], [0, 0.2, -0.15]);
  for (let k = 0; k < 5; k++) p.box(0.15, 0.1, 0.12, 0xbbbbbb, [0.3 + k * 0.15, 0.05, -0.2 + (k % 2) * 0.35], [k, k * 2, 0]);
  return p.merge();
}
export function gateGeometry() {
  const p = new Parts();
  for (const x of [0, 1]) { p.box(0.3, 0.3, 0.36, 0xb4b2aa, [x, 0.15, 0]); p.box(0.16, 1.6, 0.16, 0x4a4e52, [x, 0.8, 0]); p.box(0.12, 0.06, 0.12, 0xff3020, [x, 1.63, 0]); }
  for (let i = 0; i < 6; i++) p.box(0.17, 0.12, 0.06, i % 2 ? 0x202020 : 0xf0c020, [0.08 + i * 0.17, 1.15, 0]);
  p.box(1, 0.05, 0.05, 0x606060, [0.5, 1.4, 0]);
  return p.merge();
}

// ======================= BUILDINGS =======================
const bldCache = new Map();
const W = 0xf0ece0, ROOF = 0x7a3a2a, DARK = 0x2a2a2a, WOOD = 0x8a6a44, CONC = 0xb4b0a6, GLASS = 0x8ad0e0;

export function buildingGeometry(id, w, h, extra) {
  const key = id;
  if (bldCache.has(key)) return bldCache.get(key);
  const p = new Parts();   // solid
  const gl = new Parts();  // glows at night
  const hw = w / 2, hh = h / 2;
  const pad = (c = 0xc8c0b0) => p.box(w - 0.06, 0.08, h - 0.06, c, [0, 0.04, 0]);
  const windows = (cx, cy, cz, width, rows, cols, face = 'z', size = 0.12) => {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const ox = (c - (cols - 1) / 2) * (width / cols);
      if (face === 'z') gl.box(size, size * 1.2, 0.02, 0x30404a, [cx + ox, cy + r * size * 2.2, cz]);
      else gl.box(0.02, size * 1.2, size, 0x30404a, [cx, cy + r * size * 2.2, cz + ox]);
    }
  };
  const door = (x, z, c = DARK, dw = 0.22, dh = 0.34) => p.box(dw, dh, 0.03, c, [x, dh / 2 + 0.08, z]);
  const hipRoof = (cx, cy, cz, rw, rd, rh, col) => {
    const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1);
    g.rotateY(Math.PI / 4);
    p.add(g, col, { scale: [rw, rh, rd], pos: [cx, cy + rh / 2, cz], shade: solidShade(col, 0.35) });
  };
  switch (id) {
    case 'entrance': {
      // Park Entrance as in the original: a domed visitor centre behind a great arched gate with torches,
      // and a helipad on stilts behind it where the tourist helicopters land.
      pad(0x9a9282);
      // the dome building
      p.cyl(1.6, 1.7, 1.1, 0xd8c8a0, [0, 0.55, -0.3], null, 18);
      p.add(new THREE.SphereGeometry(1.6, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), 0xc8b890, { pos: [0, 1.1, -0.3], scale: [1, 0.85, 0.82], shade: (x, y, z, nx, ny) => { _c2.set(0xd0bf94).multiplyScalar(0.78 + ny * 0.25 + (Math.sin(Math.atan2(z, x) * 12) > 0.7 ? -0.06 : 0)); return _c2; } });
      p.cyl(0.28, 0.34, 0.4, 0x8a7a5a, [0, 2.45, -0.3], null, 10); p.cone(0.36, 0.3, 0x6a5a3a, [0, 2.8, -0.3], null, 10);
      windows(0, 0.5, 1.36, 1.6, 1, 4, 'z', 0.16);
      door(0, 1.42, 0x4a3020, 0.6, 0.62);
      for (const sd of [-1, 1]) { p.box(0.9, 0.08, 0.5, 0x8a6a44, [sd * 1.6, 0.3, 0.6]); p.cyl(0.32, 0.32, 0.04, 0xffffff, [sd * 1.75, 0.7, 0.75], null, 8); p.cone(0.5, 0.2, sd < 0 ? 0xd03030 : 0x2a6aa0, [sd * 1.75, 1.05, 0.75], null, 8); }
      p.box(0.25, 0.55, 0.22, 0x5a6a7a, [-2.2, 0.36, 0.1]); gl.box(0.18, 0.12, 0.02, 0x9ad0ff, [-2.2, 0.5, 0.22]); // cash machine
      // the gate at the front: tapering stone pillars with torches and a timber lintel
      const gz = 1.15;
      for (const sd of [-1, 1]) {
        const pg = new THREE.CylinderGeometry(0.2, 0.36, 3.0, 4, 1); pg.rotateY(Math.PI / 4);
        p.add(pg, 0x5a5850, { pos: [sd * 1.15, 1.5, gz], shade: solidShade(0x6a675c, 0.45) });
        for (const y of [1.1, 2.2]) { p.cyl(0.14, 0.09, 0.12, 0x2a2620, [sd * 1.15, y, gz + 0.3], null, 8); gl.cone(0.08, 0.28, 0xffa040, [sd * 1.15, y + 0.18, gz + 0.3], null, 6); }
        p.add(new THREE.IcosahedronGeometry(0.4, 1), 0x3a6a2a, { pos: [sd * 1.15, 3.05, gz], scale: [1.2, 0.6, 1.1] });
        p.box(1.0, 2.0, 0.09, 0x5a3a20, [sd * 0.62, 1.05, gz + 0.35], [0, sd * 1.25, 0]);
      }
      p.box(2.8, 0.4, 0.34, 0x5a4028, [0, 2.65, gz], null, solidShade(0x6a4a30, 0.3));
      p.box(1.7, 0.32, 0.06, 0xb8401a, [0, 2.65, gz + 0.19]);
      p.box(1.4, 0.2, 0.07, 0xf0c040, [0, 2.65, gz + 0.2]);
      p.add(new THREE.IcosahedronGeometry(0.45, 1), 0x4a7a32, { pos: [0, 2.95, gz], scale: [2.4, 0.42, 0.8] });
      // helipad on stilts behind the building (outside the footprint, so it may stand over water)
      const hz = -3.3, hy = 0.62;
      p.cyl(1.45, 1.5, 0.16, 0xb4b2aa, [0, hy - 0.08, hz], null, 20);
      p.cyl(1.2, 1.2, 0.02, 0x3a3a3a, [0, hy + 0.01, hz], null, 20);
      p.box(0.16, 0.02, 1.0, 0xf2f0e8, [-0.32, hy + 0.03, hz]); p.box(0.16, 0.02, 1.0, 0xf2f0e8, [0.32, hy + 0.03, hz]); p.box(0.5, 0.02, 0.16, 0xf2f0e8, [0, hy + 0.03, hz]);
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; p.box(0.12, 2.0, 0.12, 0x6a6a64, [Math.cos(a) * 1.15, hy - 1.1, hz + Math.sin(a) * 1.15]); }
      p.box(0.9, 0.1, 1.8, 0x9a7a52, [0, hy - 0.2, hz + 1.9], [0.25, 0, 0]);
      for (const a of [0, 1.57, 3.14, 4.71]) gl.box(0.06, 0.06, 0.06, 0x40ff60, [Math.cos(a) * 1.3, hy + 0.05, hz + Math.sin(a) * 1.3]);
      break;
    }
    case 'gate': {
      // tall tapering stone pillars with torches, a timber lintel and open wooden doors
      pad(0x8a8274);
      for (const sd of [-1, 1]) {
        const pg = new THREE.CylinderGeometry(0.22, 0.42, 3.4, 4, 1); pg.rotateY(Math.PI / 4);
        p.add(pg, 0x5a5850, { pos: [sd * 1.25, 1.7, 0], shade: solidShade(0x6a675c, 0.45) });
        p.box(0.62, 0.18, 0.62, 0x4a483f, [sd * 1.25, 0.09, 0]);
        for (const y of [1.2, 2.5]) { p.cyl(0.16, 0.1, 0.14, 0x2a2620, [sd * 1.25 + sd * 0.0, y, 0.34], null, 8); gl.cone(0.09, 0.32, 0xffa040, [sd * 1.25, y + 0.2, 0.34], null, 6); }
        p.add(new THREE.IcosahedronGeometry(0.45, 1), 0x3a6a2a, { pos: [sd * 1.25, 3.45, 0], scale: [1.2, 0.6, 1.1] });
      }
      p.box(3.1, 0.42, 0.36, 0x5a4028, [0, 2.95, 0], null, solidShade(0x6a4a30, 0.3));
      p.box(1.8, 0.36, 0.06, 0xb8401a, [0, 2.95, 0.2]);
      p.box(1.5, 0.22, 0.07, 0xf0c040, [0, 2.95, 0.21]);
      p.add(new THREE.IcosahedronGeometry(0.5, 1), 0x4a7a32, { pos: [0, 3.25, 0], scale: [2.6, 0.45, 0.8] });
      for (const sd of [-1, 1]) {
        p.box(1.0, 2.0, 0.09, 0x5a3a20, [sd * 0.98, 1.05, 0.48], [0, sd * 1.1, 0]);
        p.box(0.95, 0.07, 0.11, 0x3a2410, [sd * 0.98, 0.5, 0.48], [0, sd * 1.1, 0]);
        p.box(0.95, 0.07, 0.11, 0x3a2410, [sd * 0.98, 1.6, 0.48], [0, sd * 1.1, 0]);
        p.box(0.28, 0.32, 0.28, 0xf0c020, [sd * 1.6, 0.16, 0.9]);
        for (let k = 0; k < 2; k++) p.box(0.29, 0.06, 0.29, 0x202020, [sd * 1.6, 0.08 + k * 0.14, 0.9]);
      }
      break;
    }
    case 'visitor_center': {
      // big thatched lodge with a wide veranda and steps, as at the original's main gate
      pad(0xc8b890);
      p.box(3.4, 0.25, 2.4, 0xb4a888, [0, 0.12, -0.1]);
      p.box(3.0, 1.0, 2.0, 0xd8c8a0, [0, 0.75, -0.1], null, solidShade(0xe0d0a8, 0.25));
      const roof = new THREE.ConeGeometry(2.6, 1.6, 8, 1); roof.rotateY(Math.PI / 8);
      p.add(roof, 0xb08a48, { pos: [0, 2.05, -0.1], scale: [1.05, 1, 0.85], shade: (x, y, z, nx, ny) => { _c2.set(0xc09a50).multiplyScalar(0.75 + (Math.sin(y * 18) > 0.6 ? -0.12 : 0.05) + ny * 0.2); return _c2; } });
      p.cyl(0.08, 0.08, 0.5, 0x6a4a28, [0, 3.0, -0.1], null, 6);
      for (const x of [-1.4, -0.7, 0, 0.7, 1.4]) p.box(0.14, 1.2, 0.14, 0x6a4a28, [x, 0.85, 1.05]);
      p.box(3.3, 0.1, 0.6, 0x8a6a44, [0, 0.3, 1.1]);
      for (let i = 0; i < 3; i++) p.box(1.2, 0.1, 0.22, 0xc8bca0, [0, 0.05 + i * 0.1, 1.55 - i * 0.18]);
      windows(0, 0.7, 0.92, 2.4, 1, 5, 'z', 0.2);
      door(0, 0.92, 0x4a3020, 0.5, 0.6);
      for (const sd of [-1, 1]) p.add(new THREE.IcosahedronGeometry(0.35, 1), 0x3a7a2a, { pos: [sd * 1.75, 0.35, 1.3], scale: [1, 0.8, 1] });
      break;
    }
    case 'restroom': {
      // thatched wash block with separate doors, as at the film park
      pad(0xc8bca0);
      p.box(1.45, 0.72, 1.0, 0xe2d6b8, [0, 0.44, -0.18], null, solidShade(0xeadcc0, 0.25));
      hipRoof(0, 0.8, -0.18, 1.85, 1.4, 0.5, 0xa88a48);
      door(-0.36, 0.33, 0x3a6aa0, 0.24, 0.42); door(0.36, 0.33, 0xc04060, 0.24, 0.42);
      p.box(0.14, 0.14, 0.02, 0xffffff, [-0.36, 0.66, 0.33]); p.box(0.14, 0.14, 0.02, 0xffffff, [0.36, 0.66, 0.33]);
      p.box(0.5, 0.25, 0.25, 0xb4ad9c, [0, 0.17, 0.5]); p.cyl(0.08, 0.08, 0.04, 0xd8d8d8, [0, 0.31, 0.5], null, 8);
      for (const sd of [-1, 1]) p.add(new THREE.IcosahedronGeometry(0.22, 1), 0x3a7a2a, { pos: [sd * 0.82, 0.22, 0.55], scale: [1, 0.8, 1] });
      gl.box(0.1, 0.1, 0.1, 0xfff0c0, [0, 0.72, 0.34]);
      break;
    }
    case 'snack': {
      // kiosk: serving hut with a striped awning, menu board, drink machines and a parasol table
      pad(0xc8bca0);
      p.box(1.3, 0.78, 0.95, 0xe8dcc0, [0, 0.47, -0.3], null, solidShade(0xf0e2c4, 0.25));
      hipRoof(0, 0.86, -0.3, 1.75, 1.35, 0.55, 0xb08a48);
      p.box(1.2, 0.36, 0.2, 0x8a6a44, [0, 0.26, 0.26]);
      p.box(1.24, 0.04, 0.26, 0xd8c8a0, [0, 0.46, 0.26]);
      for (let i = 0; i < 8; i++) p.box(0.16, 0.04, 0.42, i % 2 ? 0xffffff : 0xd03030, [-0.56 + i * 0.16, 0.8, 0.3], [0.4, 0, 0]);
      gl.box(0.8, 0.2, 0.02, 0x40303a, [0, 0.64, 0.18]);
      for (let k = 0; k < 2; k++) {
        p.box(0.22, 0.62, 0.2, k ? 0xf08a20 : 0xc82a2a, [0.78, 0.39, 0.15 - k * 0.32]);
        gl.box(0.02, 0.26, 0.14, 0xfff0c0, [0.9, 0.48, 0.15 - k * 0.32]);
      }
      p.cyl(0.24, 0.24, 0.03, 0xffffff, [-0.6, 0.34, 0.62], null, 10); p.cyl(0.025, 0.025, 0.72, 0x9a9a9a, [-0.6, 0.44, 0.62], null, 4);
      p.cone(0.38, 0.16, 0xd03030, [-0.6, 0.86, 0.62], null, 8);
      for (const a of [0, 2.1, 4.2]) p.box(0.12, 0.2, 0.12, 0x8a6a44, [-0.6 + Math.cos(a) * 0.36, 0.18, 0.62 + Math.sin(a) * 0.36]);
      break;
    }
    case 'drinks':
      pad(); p.box(0.7, 0.5, 0.6, 0xe0f0f0, [0, 0.33, -0.05]);
      p.box(0.82, 0.06, 0.72, 0x30a0d0, [0, 0.6, -0.05]);
      p.cyl(0.16, 0.12, 0.4, 0xe03030, [0, 0.85, -0.05], null, 10); p.cyl(0.17, 0.17, 0.04, 0xffffff, [0, 1.06, -0.05], null, 10);
      p.cyl(0.02, 0.02, 0.3, 0xffffff, [0.05, 1.2, -0.05], [0, 0, 0.3], 4);
      gl.box(0.5, 0.18, 0.02, 0x40303a, [0, 0.4, 0.26]);
      break;
    case 'restaurant':
      pad(); p.box(1.7, 0.75, 1.5, 0xf2e6d0, [0, 0.45, -0.1]);
      hipRoof(0, 0.82, -0.1, 1.95, 1.75, 0.45, 0xc03a2a);
      p.cyl(0.38, 0.4, 0.14, 0xd89a48, [0, 1.38, -0.1], null, 12); p.cyl(0.42, 0.42, 0.06, 0x50a030, [0, 1.47, -0.1], null, 12);
      p.cyl(0.4, 0.4, 0.1, 0x6a3a1a, [0, 1.54, -0.1], null, 12); p.sph(0.4, 0xe0a050, [0, 1.6, -0.1], [1, 0.45, 1], [12, 6]);
      windows(0, 0.45, 0.66, 1.4, 1, 4, 'z', 0.16); door(0, 0.66);
      for (const sd of [-1, 1]) { p.cyl(0.2, 0.2, 0.04, 0xffffff, [sd * 0.6, 0.35, 0.85], null, 8); p.cyl(0.03, 0.03, 0.6, 0xd03030, [sd * 0.6, 0.6, 0.85], null, 4); p.cone(0.32, 0.18, 0xd03030, [sd * 0.6, 0.95, 0.85], null, 8); }
      break;
    case 'giftshop': {
      // souvenir stand: open-fronted booth with shelves and a big dinosaur balloon tethered above
      pad(0xc8bca0);
      p.box(1.4, 0.8, 0.9, 0x8a5aa0, [0, 0.48, -0.3], null, solidShade(0x9a6ab0, 0.25));
      p.box(1.55, 0.08, 1.05, 0x4a2a5a, [0, 0.92, -0.3]);
      for (let i = 0; i < 8; i++) p.box(0.19, 0.04, 0.4, i % 2 ? 0xffffff : 0x7a4a90, [-0.66 + i * 0.19, 0.8, 0.3], [0.4, 0, 0]);
      p.box(1.2, 0.3, 0.2, 0x6a4a30, [0, 0.22, 0.22]);
      for (let i = 0; i < 6; i++) p.box(0.1, 0.12, 0.08, [0xf0c020, 0x40a040, 0xd03030, 0x3070d0][i % 4], [-0.45 + i * 0.18, 0.43, 0.22]);
      gl.box(1.0, 0.18, 0.02, 0x40303a, [0, 0.62, 0.16]);
      p.cyl(0.006, 0.006, 1.3, 0xffffff, [0.55, 1.5, -0.3], null, 3);
      const rx = 0.55, ry = 2.25, rz = -0.3, RG = 0x3a9a3a;
      p.sph(0.32, RG, [rx, ry, rz], [1.3, 0.8, 0.7], [10, 8]);
      p.sph(0.17, RG, [rx + 0.42, ry + 0.25, rz], [1.3, 0.9, 0.8], [8, 6]);
      p.cone(0.18, 0.55, RG, [rx - 0.5, ry - 0.05, rz], [0, 0, Math.PI / 2], 8);
      for (const sd of [-1, 1]) p.box(0.08, 0.3, 0.08, RG, [rx + 0.1, ry - 0.32, rz + sd * 0.12]);
      gl.box(0.04, 0.04, 0.04, 0xffffff, [rx + 0.52, ry + 0.3, rz + 0.1]);
      break;
    }
    case 'bungalow': {
      // rest area: a shaded courtyard with two gazebos, benches and vending machines
      pad(0xb8b098);
      for (const [x, z] of [[-0.48, -0.42], [0.48, 0.38]]) {
        for (const [px, pz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) p.box(0.05, 0.55, 0.05, WOOD, [x + px, 0.32, z + pz]);
        const hex = new THREE.ConeGeometry(0.55, 0.32, 6, 1); p.add(hex, 0x3a6a3a, { pos: [x, 0.74, z], shade: solidShade(0x4a7a44, 0.35) });
        p.box(0.4, 0.05, 0.16, 0x7a5a38, [x, 0.2, z]); p.cyl(0.14, 0.14, 0.03, 0xd8d0c0, [x, 0.26, z + 0.15], null, 8);
      }
      for (let k = 0; k < 2; k++) { p.box(0.2, 0.55, 0.18, k ? 0x2a7ac0 : 0xc82a2a, [0.62, 0.36, -0.55 + k * 0.24]); gl.box(0.02, 0.22, 0.12, 0xfff0c0, [0.51, 0.44, -0.55 + k * 0.24]); }
      for (const [x, z] of [[-0.6, 0.55], [0.0, 0.62]]) { p.box(0.4, 0.04, 0.12, 0x8a6a44, [x, 0.18, z]); p.box(0.4, 0.14, 0.03, 0x8a6a44, [x, 0.26, z + 0.06]); }
      p.add(new THREE.IcosahedronGeometry(0.25, 1), 0x3a7a2a, { pos: [0.65, 0.25, 0.65], scale: [1, 0.9, 1] });
      break;
    }
    case 'hotel':
      pad(); p.box(2.4, 2.6, 2.0, 0xe8e0d0, [0, 1.38, -0.2], null, solidShade(0xf0e8d8, 0.2));
      p.box(2.6, 0.12, 2.2, 0x4a4a52, [0, 2.72, -0.2]);
      p.box(1.0, 0.5, 0.8, 0xe8e0d0, [0, 3.0, -0.2]);
      windows(0, 0.7, 0.81, 2.0, 5, 6, 'z', 0.15);
      windows(1.21, 0.7, -0.2, 1.6, 5, 4, 'x', 0.15); windows(-1.21, 0.7, -0.2, 1.6, 5, 4, 'x', 0.15);
      p.box(1.2, 0.08, 0.5, 0xb03030, [0, 0.62, 1.0]); door(0, 0.82, 0x3a2a20, 0.4, 0.45);
      gl.box(1.0, 0.25, 0.04, 0xd8a840, [0, 2.45, 0.82]);
      break;
    case 'platform': {
      // tall timber lookout tower with a thatched canopy and a stair
      for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) p.box(0.14, 2.4, 0.14, WOOD, [x, 1.2, z]);
      for (const y of [0.8, 1.6]) for (const sd of [-1, 1]) { p.box(1.3, 0.06, 0.06, 0x6a4a28, [0, y, sd * 0.6], [0, 0, sd * 0.5]); p.box(0.06, 0.06, 1.3, 0x6a4a28, [sd * 0.6, y, 0], [sd * 0.5, 0, 0]); }
      p.box(1.6, 0.12, 1.6, 0xa07a50, [0, 2.4, 0]);
      for (const sd of [-1, 1]) { p.box(1.6, 0.05, 0.05, WOOD, [0, 2.75, sd * 0.78]); p.box(0.05, 0.05, 1.6, WOOD, [sd * 0.78, 2.75, 0]); }
      for (const [x, z] of [[-0.75, -0.75], [0.75, -0.75], [-0.75, 0.75], [0.75, 0.75]]) p.box(0.07, 0.75, 0.07, WOOD, [x, 2.8, z]);
      hipRoof(0, 3.15, 0, 2.2, 2.2, 0.75, 0xb89a50);
      for (let i = 0; i < 9; i++) p.box(0.5, 0.06, 0.2, 0x8a6a44, [0.6 - i * 0.0, 0.15 + i * 0.25, 0.75 + i * 0.0 - (i * 0.15) + 0.65]);
      p.box(0.06, 0.4, 0.06, 0x3a3a3a, [0, 3.7, 0]); p.box(0.4, 0.25, 0.02, 0xf0e8d0, [0.2, 3.8, 0]);
      break;
    }
    case 'vent':
      p.box(0.85, 0.45, 0.85, CONC, [0, 0.23, 0], null, solidShade(CONC, 0.3));
      p.box(0.95, 0.06, 0.95, 0x7a766e, [0, 0.48, 0]);
      gl.box(0.6, 0.1, 0.02, 0x203038, [0, 0.33, -0.43]);
      door(0, 0.43, 0x5a4a3a, 0.2, 0.3);
      break;
    case 'dome':
      // access door: a small concrete kiosk with steps down to the tunnel and a glass cap
      p.box(0.85, 0.5, 0.85, CONC, [0, 0.25, -0.02], null, solidShade(CONC, 0.3));
      p.add(new THREE.SphereGeometry(0.36, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), GLASS, { pos: [0, 0.5, -0.05] });
      p.box(0.5, 0.06, 0.12, 0x6a665e, [0, 0.03, 0.44]); p.box(0.5, 0.06, 0.1, 0x7a766e, [0, 0.09, 0.36]);
      door(0, 0.42, 0x2a3a40, 0.36, 0.38);
      gl.box(0.5, 0.1, 0.02, 0x9ae0f0, [0, 0.58, 0.43]);
      break;
    case 'balloon_pole':
      // tall mast with a weather vane on top, as in the original
      p.box(0.3, 0.12, 0.3, CONC, [0, 0.06, 0]);
      p.cyl(0.05, 0.06, 3.2, 0xd8d0c0, [0, 1.7, 0], null, 6);
      p.box(0.5, 0.04, 0.04, 0x3a3a3a, [0, 3.3, 0]); p.box(0.04, 0.04, 0.5, 0x3a3a3a, [0, 3.3, 0]);
      p.box(0.06, 0.2, 0.3, 0xc03030, [0.18, 3.45, 0]);
      gl.box(0.08, 0.08, 0.08, 0xff4020, [0, 3.36, 0]);
      break;
    case 'dome_pod':
      pad(0xa0a0a0);
      p.cyl(0.95, 0.95, 0.25, CONC, [0, 0.12, 0], null, 16);
      p.add(new THREE.SphereGeometry(0.92, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), GLASS, { pos: [0, 0.25, 0], shade: (x, y, z, nx, ny) => { _c2.set(0x9ae0f0).lerp(_c.set(0x4a8aa0), Math.max(0, 0.5 - ny * 0.5)); return _c2; } });
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI; const g = new THREE.TorusGeometry(0.93, 0.02, 4, 16, Math.PI); g.rotateY(a); p.add(g, 0x5a6a70, { pos: [0, 0.25, 0] }); }
      gl.box(0.4, 0.08, 0.02, 0xffffff, [0, 0.4, 0.96]);
      break;
    case 'safari':
      pad(0x908a70); p.box(2.6, 0.75, 1.3, 0xd8c8a0, [0, 0.45, -0.3]);
      p.box(2.8, 0.08, 1.5, 0x3a6a3a, [0, 0.86, -0.3]);
      for (let i = 0; i < 3; i++) p.box(0.6, 0.55, 0.02, 0x3a3020, [-0.85 + i * 0.85, 0.35, 0.36]);
      p.box(1.6, 0.3, 0.05, 0xe0a030, [0, 1.05, 0.3]); p.box(0.08, 0.3, 0.08, WOOD, [-0.7, 0.9, 0.3]); p.box(0.08, 0.3, 0.08, WOOD, [0.7, 0.9, 0.3]);
      gl.box(1.2, 0.12, 0.06, 0x2a5a2a, [0, 1.05, 0.33]);
      break;
    case 'balloon':
      p.cyl(1.3, 1.4, 0.15, 0xa8a090, [0, 0.08, 0], null, 16);
      p.cyl(1.0, 1.0, 0.03, 0xd8d0c0, [0, 0.17, 0], null, 16);
      p.box(0.15, 1.4, 0.15, 0x7a6a5a, [1.1, 0.7, -1.1]); p.box(0.15, 1.4, 0.15, 0x7a6a5a, [-1.1, 0.7, -1.1]);
      p.box(0.9, 0.55, 0.6, W, [-0.9, 0.35, 1.0]); hipRoof(-0.9, 0.62, 1.0, 1.1, 0.8, 0.3, 0xc03030);
      gl.box(0.12, 0.12, 0.02, 0x30404a, [-0.75, 0.4, 1.31]);
      break;
    case 'hatchery': {
      // concrete hatchery: high-walled nursery bed of plants, control tower, hazard-striped ramp gate at the back
      pad(0x8a8a80);
      p.box(2.6, 0.9, 1.6, CONC, [0, 0.45, 0.35], null, solidShade(CONC, 0.3));
      p.box(1.8, 0.1, 1.0, 0x5a4a30, [0, 0.92, 0.35]);
      for (let i = 0; i < 9; i++) p.add(new THREE.IcosahedronGeometry(0.22, 0), 0x3a8a3a, { pos: [-0.7 + (i % 3) * 0.7, 1.1, 0.0 + Math.floor(i / 3) * 0.32], scale: [1, 1.3, 1] });
      for (const sd of [-1, 1]) p.box(0.1, 0.4, 1.6, 0x9a988e, [sd * 1.25, 1.1, 0.35]);
      p.box(1.0, 1.6, 0.8, 0xc8c8c0, [0, 0.8, 1.05], null, solidShade(0xd8d8d0, 0.2));
      p.box(1.1, 0.12, 0.9, 0x6a6a64, [0, 1.65, 1.05]);
      windows(0, 1.05, 1.46, 0.8, 1, 3, 'z', 0.14); door(0, 1.46, 0x3a4048, 0.35, 0.45);
      // ramp gate at the back (release side)
      p.box(1.2, 1.3, 0.4, 0x9a988e, [0, 0.65, -0.95]);
      for (let i = 0; i < 5; i++) p.box(0.22, 0.14, 0.42, i % 2 ? 0x202020 : 0xf0c020, [-0.44 + i * 0.22, 1.2, -0.95]);
      p.box(0.9, 0.06, 0.6, 0x7a786e, [0, 0.05, -1.3], [-0.25, 0, 0]);
      gl.box(0.08, 0.08, 0.08, 0xff3020, [0.55, 1.36, -0.95]); gl.box(0.08, 0.08, 0.08, 0xff3020, [-0.55, 1.36, -0.95]);
      break;
    }
    case 'research':
      pad(); p.box(2.4, 1.3, 1.9, 0xd8dce0, [0, 0.73, -0.2], null, solidShade(0xe0e4e8, 0.2));
      p.box(1.4, 0.7, 1.2, 0xc8ccd0, [-0.4, 1.73, -0.4]);
      windows(0, 0.45, 0.76, 2.0, 2, 6, 'z', 0.14); windows(-0.4, 1.55, 0.21, 1.1, 1, 4, 'z', 0.14);
      p.cyl(0.03, 0.03, 0.8, 0x808080, [0.8, 1.8, -0.6], null, 4);
      p.add(new THREE.SphereGeometry(0.35, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.5), 0xf0f0f0, { pos: [0.75, 1.6, 0.25], rot: [-0.8, 0, 0] });
      door(0.6, 0.76, 0x404850, 0.3, 0.4);
      gl.cyl(0.04, 0.04, 0.1, 0xff3030, [0.8, 2.25, -0.6], null, 4);
      break;
    case 'ranger': {
      // ranger station: lodge, radio mast and a helipad (the helicopter parks on the pad)
      pad(0x8a9070);
      p.box(1.25, 0.8, 1.6, 0x5a7a4a, [-0.72, 0.48, -0.2], null, solidShade(0x6a8a5a, 0.25));
      hipRoof(-0.72, 0.88, -0.2, 1.5, 1.85, 0.4, 0x3a4a30);
      windows(-0.72, 0.45, 0.61, 0.9, 1, 3, 'z', 0.14); door(-0.4, 0.61);
      p.box(0.4, 0.2, 0.3, 0x2a2a2a, [-0.72, 0.15, 0.9]);
      for (const [x, z] of [[-1.2, -1.15], [-1.0, -1.15], [-1.2, -0.95], [-1.0, -0.95]]) p.box(0.04, 1.9, 0.04, 0x8a8a8a, [x, 0.95, z]);
      p.box(0.3, 0.04, 0.3, 0x8a8a8a, [-1.1, 1.9, -1.05]); gl.box(0.06, 0.06, 0.06, 0xff3020, [-1.1, 1.95, -1.05]);
      p.cyl(0.62, 0.62, 0.06, 0x505050, [0.85, 0.08, 0], null, 16);
      p.cyl(0.58, 0.58, 0.02, 0xd8a030, [0.85, 0.115, 0], null, 16);
      p.cyl(0.5, 0.5, 0.025, 0x404040, [0.85, 0.12, 0], null, 16);
      p.box(0.08, 0.02, 0.45, 0xffffff, [0.68, 0.135, 0]); p.box(0.08, 0.02, 0.45, 0xffffff, [1.02, 0.135, 0]); p.box(0.36, 0.02, 0.08, 0xffffff, [0.85, 0.135, 0]);
      for (const a of [0, 1.57, 3.14, 4.71]) gl.box(0.05, 0.05, 0.05, 0x40ff60, [0.85 + Math.cos(a) * 0.6, 0.14, Math.sin(a) * 0.6]);
      p.box(0.5, 0.35, 0.35, 0xd8d0b0, [0.85, 0.2, 1.1]); p.box(0.25, 0.25, 0.2, 0xd8d0b0, [1.2, 0.15, -1.15]);
      break;
    }
    case 'cleaner': {
      // cleaner station: maintenance depot with roller doors, a supply shed and a sweeper cart
      pad(0xa8a8a0);
      p.box(1.5, 0.85, 1.0, 0x5a8ab0, [0, 0.5, -0.3], null, solidShade(0x6a9ac0, 0.25));
      p.box(1.6, 0.08, 1.1, 0x3a4a5a, [0, 0.96, -0.3]);
      for (const x of [-0.38, 0.38]) { p.box(0.55, 0.55, 0.02, 0xd8d8d8, [x, 0.36, 0.21]); for (let k = 0; k < 5; k++) p.box(0.55, 0.012, 0.025, 0xa0a0a0, [x, 0.16 + k * 0.1, 0.22]); }
      gl.box(0.7, 0.14, 0.02, 0xf0f0f0, [0, 0.8, 0.21]);
      p.box(0.32, 0.18, 0.2, 0x40a040, [0.45, 0.17, 0.62]); p.box(0.1, 0.22, 0.18, 0x40a040, [0.31, 0.3, 0.62]);
      for (const x of [0.35, 0.55]) for (const z of [0.52, 0.72]) p.cyl(0.05, 0.05, 0.03, 0x202020, [x, 0.06, z], [Math.PI / 2, 0, 0], 6);
      for (let k = 0; k < 3; k++) p.cyl(0.08, 0.08, 0.22, [0x3a8a3a, 0x3a8a3a, 0xd8d8d8][k], [-0.55 + k * 0.2, 0.15, 0.62], null, 8);
      break;
    }
    case 'turret': {
      // sentry turret: armoured concrete emplacement with a twin-barrel gun on a turntable
      pad(0x8a8a80);
      p.cyl(0.8, 0.9, 0.45, CONC, [0, 0.25, 0], null, 8);
      for (let i = 0; i < 8; i++) p.box(0.18, 0.08, 0.2, i % 2 ? 0x202020 : 0xf0c020, [Math.cos(i * 0.785) * 0.82, 0.3, Math.sin(i * 0.785) * 0.82], [0, -i * 0.785, 0]);
      p.cyl(0.42, 0.48, 0.3, 0x5a6066, [0, 0.62, 0], null, 10);
      p.box(0.55, 0.32, 0.5, 0x4a5056, [0.05, 0.92, 0], null, solidShade(0x5a6066, 0.3));
      for (const sd of [-1, 1]) p.cyl(0.05, 0.05, 0.9, 0x2a2a2a, [0.65, 0.95, sd * 0.12], [0, 0, Math.PI / 2], 6);
      gl.box(0.06, 0.06, 0.06, 0xff3020, [-0.2, 1.1, 0.26]);
      break;
    }
    case 'lure': {
      // auto lure: a square gas dispenser with a vent on top
      p.box(0.6, 0.12, 0.6, 0xb4b2aa, [0, 0.06, 0]);
      p.box(0.42, 0.55, 0.42, 0x6a7a3a, [0, 0.38, 0], null, solidShade(0x7a8a4a, 0.3));
      for (let i = 0; i < 4; i++) p.box(0.44, 0.05, 0.44, i % 2 ? 0x202020 : 0xf0c020, [0, 0.16 + i * 0.05, 0]);
      p.cyl(0.1, 0.14, 0.22, 0x4a4e52, [0, 0.76, 0], null, 8);
      p.cyl(0.16, 0.12, 0.05, 0x3a3e42, [0, 0.89, 0], null, 8);
      gl.box(0.04, 0.04, 0.04, 0x80ff60, [0.22, 0.55, 0.22]);
      break;
    }
    case 'bin':
      p.cyl(0.11, 0.09, 0.32, 0x2a6a3a, [0, 0.16, 0], null, 8);
      p.cyl(0.13, 0.13, 0.04, 0x1a4a2a, [0, 0.34, 0], null, 8);
      p.box(0.06, 0.01, 0.04, 0x101010, [0, 0.365, 0]);
      break;
    case 'bench':
      for (const x of [-0.24, 0.24]) { p.box(0.04, 0.16, 0.18, 0x3a3a3a, [x, 0.08, 0]); p.box(0.04, 0.2, 0.03, 0x3a3a3a, [x, 0.24, -0.08]); }
      p.box(0.6, 0.03, 0.18, 0x8a6a44, [0, 0.17, 0]);
      p.box(0.6, 0.1, 0.03, 0x8a6a44, [0, 0.28, -0.09]);
      break;
    case 'acu':
      pad(0x707070); p.box(1.4, 1.0, 2.2, 0x5a6066, [-0.7, 0.55, 0], null, solidShade(0x6a7078, 0.25));
      p.add(new THREE.CylinderGeometry(0.75, 0.75, 2.2, 12, 1, false, 0, Math.PI), 0x6a7076, { rot: [Math.PI / 2, 0, -Math.PI / 2], pos: [-0.7, 1.05, 0] });
      p.box(1.4, 1.4, 0.06, 0xd8a030, [0.9, 0.11, 0], [-Math.PI / 2, 0, 0]);
      p.box(1.2, 0.04, 1.2, 0x404040, [0.85, 0.1, 0]);
      p.box(0.1, 0.02, 0.6, 0xffffff, [0.65, 0.13, 0]); p.box(0.1, 0.02, 0.6, 0xffffff, [1.05, 0.13, 0]); p.box(0.4, 0.02, 0.1, 0xffffff, [0.85, 0.13, 0]);
      gl.box(0.06, 0.06, 0.06, 0xff4040, [1.45, 0.15, 0.6]); gl.box(0.06, 0.06, 0.06, 0xff4040, [1.45, 0.15, -0.6]);
      p.box(0.06, 0.6, 1.2, 0x2a2a2a, [0.01, 0.4, 0]);
      break;
    case 'weather':
      pad(); p.box(0.9, 0.55, 0.8, 0xe0e0e0, [-0.4, 0.35, 0.3]); p.box(1.0, 0.06, 0.9, 0x5a5a5a, [-0.4, 0.65, 0.3]);
      p.cyl(0.04, 0.08, 2.4, 0xb0b0b0, [0.45, 1.2, -0.45], null, 5);
      for (let i = 0; i < 6; i++) p.box(0.25 - i * 0.03, 0.02, 0.02, 0xb0b0b0, [0.45, 0.3 + i * 0.35, -0.45]);
      p.sph(0.32, 0xffffff, [0.45, 2.55, -0.45], [1, 1, 1], [10, 8]);
      gl.box(0.05, 0.05, 0.05, 0xff2020, [0.45, 2.92, -0.45]);
      windows(-0.4, 0.4, 0.71, 0.6, 1, 2, 'z', 0.12);
      break;
    case 'shelter':
      pad(0x8a8a80);
      p.add(new THREE.CylinderGeometry(0.85, 0.85, 1.7, 12, 1, false, 0, Math.PI), CONC, { rot: [0, 0, Math.PI / 2], pos: [0, 0.08, 0], shade: solidShade(CONC, 0.3), scale: [1, 1, 1] });
      for (let i = 0; i < 5; i++) p.box(0.12, 0.6, 0.03, i % 2 ? 0x202020 : 0xf0c020, [-0.24 + i * 0.12, 0.38, 0.86]);
      gl.box(0.3, 0.08, 0.03, 0x30ff60, [0, 0.8, 0.8]);
      break;
    case 'feeder_herb': {
      // cross-shaped hydraulic feeding pad with a hazard-striped lift plate and bales
      const cc = 0xb8b4aa;
      p.box(0.95, 0.08, 0.36, cc, [0, 0.04, 0]); p.box(0.36, 0.08, 0.95, cc, [0, 0.04, 0]);
      for (let i = 0; i < 4; i++) p.box(0.09, 0.02, 0.3, i % 2 ? 0x202020 : 0xf0c020, [-0.13 + i * 0.09, 0.085, 0]);
      for (const [x, z] of [[0.36, 0], [-0.36, 0], [0, 0.36], [0, -0.36]]) p.box(0.2, 0.02, 0.2, 0x6a6a64, [x, 0.085, z]);
      p.box(0.32, 0.2, 0.22, 0xd8c060, [0, 0.19, 0]); p.box(0.28, 0.16, 0.2, 0xc8b050, [0.02, 0.37, 0]);
      break;
    }
    case 'camera': {
      p.cyl(0.04, 0.06, 1.6, 0x4a4e52, [0, 0.8, 0], null, 6);
      p.box(0.3, 0.14, 0.14, 0xe0e0d8, [0.08, 1.6, 0]); p.box(0.06, 0.08, 0.1, 0x202020, [0.25, 1.6, 0]);
      gl.box(0.03, 0.03, 0.03, 0xff2020, [0.0, 1.68, 0.05]);
      break;
    }
    case 'beacon': {
      p.box(0.5, 0.15, 0.5, 0xb4b2aa, [0, 0.075, 0]);
      p.cyl(0.06, 0.08, 1.1, 0x4a4e52, [0, 0.65, 0], null, 6);
      for (let i = 0; i < 4; i++) p.box(0.16, 0.06, 0.16, i % 2 ? 0x202020 : 0xf0c020, [0, 0.25 + i * 0.07, 0]);
      gl.sph(0.12, 0x80d0ff, [0, 1.26, 0], [1, 1, 1], [8, 6]);
      p.cone(0.18, 0.12, 0x4a4e52, [0, 1.12, 0], [Math.PI, 0, 0], 8);
      break;
    }
    case 'feeder_goat':
    case 'feeder_cow': {
      const big = id === 'feeder_cow';
      const s = big ? 1.8 : 0.85;
      p.box(s, 0.05, s, 0x9a8a5a, [0, 0.025, 0]);
      for (const sd of [-1, 1]) { p.box(s, 0.05, 0.04, WOOD, [0, 0.3, sd * s / 2]); p.box(0.04, 0.05, s, WOOD, [sd * s / 2, 0.3, 0]); p.box(s, 0.05, 0.04, WOOD, [0, 0.15, sd * s / 2]); p.box(0.04, 0.05, s, WOOD, [sd * s / 2, 0.15, 0]); }
      p.box(s * 0.4, s * 0.35, s * 0.35, 0xa04030, [-s * 0.25, s * 0.18, -s * 0.25]); hipRoof(-s * 0.25, s * 0.35, -s * 0.25, s * 0.5, s * 0.45, s * 0.2, 0x5a3a2a);
      const an = big ? 0x5a3a2a : 0xf0f0e8;
      for (const [x, z] of big ? [[0.3, 0.3], [0.5, -0.2]] : [[0.15, 0.2], [0.25, -0.1]]) {
        const k = big ? 2 : 1;
        p.box(0.2 * k, 0.12 * k, 0.1 * k, an, [x, 0.18 * k, z]); p.box(0.08 * k, 0.08 * k, 0.07 * k, an, [x + 0.13 * k, 0.24 * k, z]);
        for (const lx of [-0.07, 0.07]) for (const lz of [-0.03, 0.03]) p.box(0.025 * k, 0.12 * k, 0.025 * k, an, [x + lx * k, 0.06 * k, z + lz * k]);
      }
      break;
    }
    case 'fountain':
      p.cyl(0.45, 0.48, 0.18, 0xc0b8a8, [0, 0.09, 0], null, 12); p.cyl(0.38, 0.38, 0.02, 0x4aa0d0, [0, 0.17, 0], null, 12);
      p.cyl(0.08, 0.1, 0.45, 0xc0b8a8, [0, 0.35, 0], null, 8); p.cyl(0.2, 0.15, 0.06, 0xc0b8a8, [0, 0.58, 0], null, 10);
      gl.sph(0.12, 0x9ad8f0, [0, 0.66, 0], [1, 1.4, 1], [8, 6]);
      break;
    case 'statue': {
      p.box(0.6, 0.4, 0.6, 0xa09a90, [0, 0.2, 0]); p.box(0.7, 0.06, 0.7, 0x8a847a, [0, 0.42, 0]);
      if (extra && extra.statue) for (const g of extra.statue) p.list.push(g);
      break;
    }
    case 'flowers':
      p.box(0.85, 0.12, 0.85, 0x6a4a30, [0, 0.06, 0]);
      for (let i = 0; i < 12; i++) {
        const x = ((i % 4) - 1.5) * 0.18, z = (Math.floor(i / 4) - 1) * 0.24;
        p.cone(0.08, 0.18, 0x3a8a3a, [x, 0.2, z], null, 4);
        p.sph(0.06, [0xff4080, 0xffd030, 0xff7030, 0xd040ff][i % 4], [x, 0.3, z], [1, 1, 1], [5, 4]);
      }
      break;
    case 'lamp':
      p.cyl(0.03, 0.05, 1.2, 0x2a2a30, [0, 0.6, 0], null, 6); p.box(0.25, 0.03, 0.03, 0x2a2a30, [0.1, 1.15, 0]);
      gl.sph(0.08, 0xfff0c0, [0.2, 1.1, 0], [1, 1, 1], [6, 5]);
      break;
    default:
      p.box(w * 0.8, 0.6, h * 0.8, 0xcccccc, [0, 0.3, 0]);
  }
  const res = { body: p.merge(), glow: gl.merge() };
  bldCache.set(key, res);
  return res;
}

// ======================= VEHICLES =======================
export function jeepGeometry(col = 0xe0a020, stripe = 0x2a6a2a) {
  const p = new Parts();
  p.box(0.75, 0.22, 0.4, col, [0, 0.22, 0]);
  p.box(0.3, 0.14, 0.38, col, [0.22, 0.38, 0]);
  p.box(0.02, 0.16, 0.36, 0x9ad0e0, [0.08, 0.42, 0], [0, 0, -0.3]);
  p.box(0.76, 0.05, 0.41, stripe, [0, 0.26, 0]);
  p.box(0.04, 0.22, 0.04, 0x303030, [-0.2, 0.42, 0.18]); p.box(0.04, 0.22, 0.04, 0x303030, [-0.2, 0.42, -0.18]); p.box(0.04, 0.04, 0.4, 0x303030, [-0.2, 0.53, 0]);
  for (const x of [-0.24, 0.24]) for (const z of [-0.2, 0.2]) p.cyl(0.1, 0.1, 0.08, 0x202020, [x, 0.1, z], [Math.PI / 2, 0, 0], 8);
  p.box(0.02, 0.06, 0.08, 0xfff0a0, [0.38, 0.25, 0.13]); p.box(0.02, 0.06, 0.08, 0xfff0a0, [0.38, 0.25, -0.13]);
  return p.merge();
}
export function heliGeometry(body = 0x4e5a2c, stripe = 0xe0b020) {
  const p = new Parts();
  const camo = (x, y, z) => { _c2.set(body); if (body === 0x4e5a2c && valueNoise(x * 4 + 3, (y + z) * 4, 5) > 0.55) _c2.set(0x6a6a3a); return _c2; };
  p.sph(0.4, body, [0, 0.35, 0], [1.4, 0.8, 0.8], [12, 9], null, camo);
  p.sph(0.25, 0x9ad0e0, [0.33, 0.4, 0], [1, 0.8, 0.9], [10, 8]);
  p.tubeX(0.12, 0.05, 1.0, body, [-1.4, 0.4, 0], null, 8, camo);
  p.box(0.06, 0.35, 0.2, stripe, [-1.38, 0.55, 0]);
  p.box(0.6, 0.05, 0.12, stripe, [0, 0.22, 0]);
  for (const z of [-0.3, 0.3]) { p.box(1.0, 0.04, 0.04, 0x303030, [0, 0.0, z]); p.box(0.04, 0.2, 0.04, 0x303030, [0.25, 0.1, z]); p.box(0.04, 0.2, 0.04, 0x303030, [-0.25, 0.1, z]); }
  p.cyl(0.04, 0.04, 0.15, 0x303030, [0, 0.72, 0], null, 6);
  return p.merge();
}
export function rotorGeometry() {
  const p = new Parts();
  p.box(2.2, 0.02, 0.1, 0x202020, [0, 0, 0]);
  p.box(0.1, 0.02, 2.2, 0x202020, [0, 0, 0]);
  return p.merge();
}
export function balloonGeometry() {
  const p = new Parts();
  const env = new THREE.SphereGeometry(1.3, 16, 12);
  p.add(env, 0xffffff, { scale: [1, 1.2, 1], pos: [0, 2.6, 0], shade: (x, y, z) => { const a = Math.atan2(z, x); return _c2.set(Math.sin(a * 8) > 0 ? 0xd83030 : 0xf0e8d0); } });
  p.cone(0.5, 0.6, 0xd83030, [0, 1.15, 0], [Math.PI, 0, 0], 12);
  p.box(0.5, 0.35, 0.5, 0x8a6a40, [0, 0.18, 0]);
  for (const [x, z] of [[0.22, 0.22], [-0.22, 0.22], [0.22, -0.22], [-0.22, -0.22]]) p.tubeAB([x, 0.35, z], [x * 2.2, 1.2, z * 2.2], 0.01, 0.01, 0x3a3a3a, 3);
  return p.merge();
}
export function goatGeometry() {
  const p = new Parts();
  p.box(0.22, 0.12, 0.1, 0xf0f0e8, [0, 0.16, 0]); p.box(0.08, 0.08, 0.07, 0xf0f0e8, [0.14, 0.23, 0]);
  for (const x of [-0.07, 0.07]) for (const z of [-0.03, 0.03]) p.box(0.025, 0.12, 0.025, 0x504840, [x, 0.06, z]);
  return p.merge();
}
