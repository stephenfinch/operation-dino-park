// Procedural canvas textures (no image files). All tile seamlessly.
import * as THREE from 'three';
import { mulberry32 } from './util.js';

const cache = new Map();

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Periodic value noise so textures tile.
function makeNoise(seed, period) {
  const r = mulberry32(seed);
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const at = (x, y) => g[(((y % period) + period) % period) * period + (((x % period) + period) % period)];
  return (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  };
}
function fbmP(noises, x, y, base) {
  let v = 0, a = 0.5, n = 0;
  for (let i = 0; i < noises.length; i++) { const f = base << i; v += noises[i](x * f, y * f) * a; n += a; a *= 0.5; }
  return v / n;
}

function tex(c, o = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = o.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (o.repeat) t.repeat.set(o.repeat[0], o.repeat[1]);
  t.needsUpdate = true;
  return t;
}

function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

// Luminance detail for terrain: grass blades and soil grain; hue comes from vertex colours.
export function grassDetail() {
  return cached('grass', () => {
    const S = 512, c = canvas(S), x = c.getContext('2d');
    const img = x.createImageData(S, S);
    const ns = [makeNoise(11, 8), makeNoise(12, 16), makeNoise(13, 32), makeNoise(14, 64)];
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const n = fbmP(ns, i / S, j / S, 8);
      const v = 0.72 + n * 0.38;
      const k = (j * S + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.min(255, v * 255);
      img.data[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    const r = mulberry32(5);
    // grass blades
    for (let b = 0; b < 9000; b++) {
      const px = r() * S, py = r() * S, len = 3 + r() * 7, ang = -Math.PI / 2 + (r() - 0.5) * 0.9;
      const l = 150 + r() * 105;
      x.strokeStyle = `rgba(${l},${l},${l},${0.25 + r() * 0.35})`;
      x.lineWidth = 0.7 + r() * 0.9;
      for (const ox of [0, S, -S]) for (const oy of [0, S, -S]) {
        if (Math.abs(ox) + Math.abs(oy) && (px > 12 && px < S - 12 && py > 12 && py < S - 12)) continue;
        x.beginPath(); x.moveTo(px + ox, py + oy); x.lineTo(px + ox + Math.cos(ang) * len, py + oy + Math.sin(ang) * len); x.stroke();
      }
    }
    for (let b = 0; b < 2500; b++) {
      const l = r() * 90;
      x.fillStyle = `rgba(${l},${l},${l},0.25)`;
      x.fillRect(r() * S, r() * S, 1.5, 1.5);
    }
    return tex(c);
  });
}

// Fine grain for buildings/vehicles.
export function detail() {
  return cached('detail', () => {
    const S = 256, c = canvas(S), x = c.getContext('2d');
    const img = x.createImageData(S, S);
    const ns = [makeNoise(21, 8), makeNoise(22, 16), makeNoise(23, 32), makeNoise(24, 64)];
    const r = mulberry32(7);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const n = fbmP(ns, i / S, j / S, 4);
      const v = 0.8 + n * 0.22 + (r() - 0.5) * 0.06;
      const k = (j * S + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.min(255, v * 255);
      img.data[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return tex(c);
  });
}

// Reptile skin: scales over mottling. Greyscale; species colour comes from vertex colours.
export function skin() {
  return cached('skin', () => {
    const S = 256, c = canvas(S), x = c.getContext('2d');
    const img = x.createImageData(S, S);
    const r = mulberry32(31);
    const pts = [];
    for (let i = 0; i < 700; i++) pts.push([r() * S, r() * S]);
    const ns = [makeNoise(33, 4), makeNoise(34, 8), makeNoise(35, 16)];
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      let d1 = 1e9, d2 = 1e9;
      for (const [px, py] of pts) {
        let dx = Math.abs(i - px), dy = Math.abs(j - py);
        if (dx > S / 2) dx = S - dx; if (dy > S / 2) dy = S - dy;
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
      }
      const edge = Math.min(1, (Math.sqrt(d2) - Math.sqrt(d1)) / 1.6);
      const m = fbmP(ns, i / S, j / S, 4);
      const v = (0.9 + edge * 0.08) * (0.8 + m * 0.3);
      const k = (j * S + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.min(255, v * 255);
      img.data[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return tex(c, { repeat: [2, 2] });
  });
}

// Flagstone footpath, full colour.
export function flagstone() {
  return cached('flag', () => {
    const S = 256, c = canvas(S), x = c.getContext('2d');
    x.fillStyle = '#7d6e58'; x.fillRect(0, 0, S, S);
    const r = mulberry32(41);
    const cols = ['#cdb995', '#c2ad86', '#d6c4a0', '#b9a27c', '#c8b28c', '#bfae90'];
    const cell = 32;
    for (let gy = 0; gy < S / cell; gy++) for (let gx = 0; gx < S / cell; gx++) {
      const ox = gx * cell + (gy % 2) * cell / 2;
      for (const wrap of [0, -S]) {
        const cx = ox + wrap, cy = gy * cell;
        x.fillStyle = cols[Math.floor(r() * cols.length)];
        x.beginPath();
        const n = 6;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + r() * 0.4;
          const rad = cell * (0.42 + r() * 0.1);
          const px = cx + cell / 2 + Math.cos(a) * rad, py = cy + cell / 2 + Math.sin(a) * rad * 0.9;
          k ? x.lineTo(px, py) : x.moveTo(px, py);
        }
        x.closePath(); x.fill();
      }
    }
    const img = x.getImageData(0, 0, S, S);
    for (let k = 0; k < img.data.length; k += 4) { const n = (r() - 0.5) * 22; img.data[k] += n; img.data[k + 1] += n; img.data[k + 2] += n; }
    x.putImageData(img, 0, 0);
    return tex(c);
  });
}

// Packed dirt for the safari track.
export function dirt() {
  return cached('dirt', () => {
    const S = 256, c = canvas(S), x = c.getContext('2d');
    const img = x.createImageData(S, S);
    const ns = [makeNoise(51, 8), makeNoise(52, 16), makeNoise(53, 32)];
    const r = mulberry32(55);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const n = fbmP(ns, i / S, j / S, 8) + (r() - 0.5) * 0.12;
      const k = (j * S + i) * 4;
      img.data[k] = 130 + n * 70; img.data[k + 1] = 102 + n * 55; img.data[k + 2] = 70 + n * 40; img.data[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    for (let p = 0; p < 300; p++) { const l = 90 + r() * 90; x.fillStyle = `rgb(${l},${l * 0.9},${l * 0.75})`; x.beginPath(); x.arc(r() * S, r() * S, 1 + r() * 2, 0, 7); x.fill(); }
    return tex(c);
  });
}

// Alpha-cut foliage cards.
function leafCanvas(kind) {
  const W = 256, H = kind === 'palm' || kind === 'fern' ? 64 : 256;
  const c = canvas(W, H), x = c.getContext('2d');
  const r = mulberry32(kind.length * 97);
  x.clearRect(0, 0, W, H);
  if (kind === 'palm' || kind === 'fern' || kind === 'cycad') {
    const mid = H / 2;
    x.strokeStyle = kind === 'cycad' ? '#556b2a' : '#6b7a35'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(0, mid); x.lineTo(W, mid); x.stroke();
    const n = kind === 'fern' ? 46 : 54;
    for (let i = 0; i < n; i++) {
      const t = i / n, px = 6 + t * (W - 12);
      const len = (kind === 'fern' ? 26 : 30) * Math.sin(Math.PI * (0.12 + t * 0.85));
      for (const s of [-1, 1]) {
        const g = 70 + r() * 50;
        x.fillStyle = kind === 'palm' ? `rgb(${50 + r() * 30},${g + 40},${30 + r() * 15})` : `rgb(${40 + r() * 20},${g + 30},${30})`;
        x.beginPath();
        x.moveTo(px - 2, mid);
        x.quadraticCurveTo(px + 10, mid + s * len * 0.55, px + 16, mid + s * len);
        x.quadraticCurveTo(px + 1, mid + s * len * 0.6, px - 3, mid);
        x.fill();
      }
    }
  } else if (kind === 'leaves') {
    for (let i = 0; i < 420; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 118;
      const px = 128 + Math.cos(a) * d, py = 128 + Math.sin(a) * d;
      const g = 80 + r() * 70;
      x.fillStyle = `rgb(${30 + r() * 30},${g},${25 + r() * 20})`;
      x.save(); x.translate(px, py); x.rotate(r() * 6.28);
      x.beginPath(); x.ellipse(0, 0, 9 + r() * 5, 4 + r() * 2, 0, 0, 7); x.fill();
      x.restore();
    }
  } else if (kind === 'needles') {
    x.fillStyle = '#21402a'; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 2200; i++) {
      const px = r() * W, py = r() * H, g = 50 + r() * 60;
      x.strokeStyle = `rgb(${20 + r() * 20},${g},${30 + r() * 15})`; x.lineWidth = 1.2;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + (r() - 0.5) * 8, py + 6 + r() * 6); x.stroke();
    }
  }
  return c;
}
export function foliage(kind) {
  return cached('leaf:' + kind, () => {
    const t = tex(leafCanvas(kind));
    if (kind !== 'needles') {
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      // thin alpha-cut leaflets vanish when mipmapped; sample the full-size texture instead
      if (kind !== 'leaves') { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
    }
    return t;
  });
}

export function bark() {
  return cached('bark', () => {
    const S = 128, c = canvas(S), x = c.getContext('2d');
    x.fillStyle = '#6a5038'; x.fillRect(0, 0, S, S);
    const r = mulberry32(61);
    for (let i = 0; i < 260; i++) {
      const px = r() * S, l = 60 + r() * 70;
      x.strokeStyle = `rgba(${l},${l * 0.8},${l * 0.6},0.6)`; x.lineWidth = 1 + r() * 2;
      x.beginPath(); x.moveTo(px, 0); x.bezierCurveTo(px + (r() - 0.5) * 10, S / 3, px + (r() - 0.5) * 10, S * 2 / 3, px, S); x.stroke();
    }
    for (let i = 0; i < 18; i++) { x.fillStyle = 'rgba(40,30,20,0.4)'; x.fillRect(0, r() * S, S, 1.5); }
    return tex(c);
  });
}

// Water normal map (tileable).
export function waterNormals() {
  return cached('wn', () => {
    const S = 256, c = canvas(S), x = c.getContext('2d');
    const ns = [makeNoise(71, 8), makeNoise(72, 16), makeNoise(73, 32), makeNoise(74, 64)];
    const h = new Float32Array(S * S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) h[j * S + i] = fbmP(ns, i / S, j / S, 4);
    const img = x.createImageData(S, S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const hl = h[j * S + ((i - 1 + S) % S)], hr = h[j * S + ((i + 1) % S)], hu = h[((j - 1 + S) % S) * S + i], hd = h[((j + 1) % S) * S + i];
      let nx = (hl - hr) * 6, ny = (hu - hd) * 6, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const k = (j * S + i) * 4;
      img.data[k] = (nx * 0.5 + 0.5) * 255; img.data[k + 1] = (ny * 0.5 + 0.5) * 255; img.data[k + 2] = (nz * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return tex(c, { linear: true });
  });
}

// "Danger – high voltage" sign used on fences (no words needed: red band, bolt, white field).
export function dangerSign() {
  return cached('sign', () => {
    const c = canvas(64, 32), x = c.getContext('2d');
    x.fillStyle = '#f2f0e8'; x.fillRect(0, 0, 64, 32);
    x.fillStyle = '#c4261d'; x.fillRect(0, 0, 64, 10);
    x.fillStyle = '#fff'; x.font = 'bold 8px sans-serif'; x.textAlign = 'center'; x.fillText('DANGER', 32, 8.5);
    x.fillStyle = '#111'; x.font = 'bold 9px sans-serif'; x.fillText('10,000 V', 24, 24);
    x.beginPath(); x.arc(52, 21, 8, 0, 7); x.strokeStyle = '#c4261d'; x.lineWidth = 2; x.stroke();
    x.fillStyle = '#111'; x.beginPath(); x.moveTo(53, 14); x.lineTo(48, 22); x.lineTo(52, 22); x.lineTo(50, 28); x.lineTo(56, 19); x.lineTo(52, 19); x.closePath(); x.fill();
    const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  });
}
