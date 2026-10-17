// General helpers: math, noise, formatting.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const chance = (p) => Math.random() < p;
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const dist2 = (ax, az, bx, bz) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);
export const dist = (ax, az, bx, bz) => Math.sqrt(dist2(ax, az, bx, bz));

export function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function valueNoise(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

export function fbm(x, y, seed = 0, oct = 4) {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    v += valueNoise(x * f, y * f, seed + i * 17) * amp;
    norm += amp; amp *= 0.5; f *= 2;
  }
  return v / norm;
}

export function fmtMoney(n) {
  const s = n < 0 ? '-' : '';
  n = Math.abs(n);
  if (n >= 1e9) return `${s}$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${s}$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e4) return `${s}$${(n / 1e3).toFixed(1)}K`;
  return `${s}$${Math.round(n).toLocaleString('en-US')}`;
}

export const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
export const pct = (n) => `${Math.round(n)}%`;

// Binary min-heap keyed by numeric priority.
export class Heap {
  constructor() { this.items = []; this.pri = []; }
  get size() { return this.items.length; }
  push(item, p) {
    const it = this.items, pr = this.pri;
    it.push(item); pr.push(p);
    let i = it.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (pr[par] <= pr[i]) break;
      [it[par], it[i]] = [it[i], it[par]];
      [pr[par], pr[i]] = [pr[i], pr[par]];
      i = par;
    }
  }
  pop() {
    const it = this.items, pr = this.pri;
    const top = it[0];
    const li = it.pop(), lp = pr.pop();
    if (it.length) {
      it[0] = li; pr[0] = lp;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < it.length && pr[l] < pr[m]) m = l;
        if (r < it.length && pr[r] < pr[m]) m = r;
        if (m === i) break;
        [it[m], it[i]] = [it[i], it[m]];
        [pr[m], pr[i]] = [pr[i], pr[m]];
        i = m;
      }
    }
    return top;
  }
}

// Compact array encoding for saves: run-length encode then base64.
export function encodeArr(arr) {
  const out = [];
  let i = 0;
  while (i < arr.length) {
    const v = arr[i];
    let n = 1;
    while (i + n < arr.length && arr[i + n] === v && n < 65535) n++;
    out.push(v, n);
    i += n;
  }
  return out.join(',');
}

export function decodeArr(str, Type, len) {
  const a = new Type(len);
  if (!str) return a;
  const parts = str.split(',');
  let k = 0;
  for (let i = 0; i < parts.length; i += 2) {
    const v = Number(parts[i]), n = Number(parts[i + 1]);
    for (let j = 0; j < n && k < len; j++) a[k++] = v;
  }
  return a;
}

const FIRST = ['Rex', 'Blue', 'Clover', 'Spike', 'Maple', 'Juno', 'Echo', 'Bramble', 'Pebble', 'Atlas', 'Nova', 'Fern', 'Cinder', 'Moss', 'Tango', 'Delta', 'Ember', 'Scout', 'Olive', 'Bolt', 'Sable', 'Rumble', 'Kiwi', 'Thorn', 'Willow', 'Hazel', 'Quill', 'Ruby', 'Storm', 'Basil', 'Pippin', 'Domino', 'Yuki', 'Zephyr', 'Mango', 'Biscuit', 'Ripley', 'Ellie', 'Grant', 'Muldoon'];
export const randomName = () => pick(FIRST);

const VFIRST = ['Alex', 'Sam', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Jamie', 'Avery', 'Quinn', 'Rowan', 'Skyler', 'Parker', 'Drew', 'Reese', 'Charlie', 'Emerson', 'Finley', 'Harper', 'Kai', 'Logan', 'Noor', 'Priya', 'Mateo', 'Yara', 'Hiro', 'Lena', 'Omar', 'Zoe', 'Ivan'];
const VLAST = ['Smith', 'Garcia', 'Chen', 'Okafor', 'Novak', 'Silva', 'Kim', 'Patel', 'Müller', 'Rossi', 'Haddad', 'Nguyen', 'Larsen', 'Costa', 'Ivanova', 'Brooks', 'Mendez', 'Sato', 'Dubois', 'Walsh'];
export const visitorName = () => `${pick(VFIRST)} ${pick(VLAST)}`;
