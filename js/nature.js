// Low-poly plants and rocks from Quaternius' "Ultimate Nature Pack" (CC0 1.0, quaternius.com).
// tools/fbxview.html merged each model into one vertex-coloured mesh, 1 unit tall, base at y = 0.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const src = new Map();
let loading = null;

export function loadNature(url = 'assets/models/quaternius-nature/nature.glb') {
  if (!loading) {
    loading = (async () => {
      try {
        const b64 = window.DINOPARK_MODELS?.nature;
        const loader = new GLTFLoader();
        const g = b64 ? await loader.parseAsync(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer, '') : await loader.loadAsync(url);
        g.scene.traverse((o) => { if (o.isMesh) src.set(o.name, brighten(o.geometry)); });
      } catch (e) { console.warn('Could not load plant models', e); }
    })();
  }
  return loading;
}
export function natureLoaded() { return src.size > 0; }

// The FBX colours were converted from sRGB to linear twice on import; undo one conversion.
function brighten(geo) {
  const c = geo.attributes.color, col = new THREE.Color();
  if (!c) return geo;
  for (let i = 0; i < c.count; i++) { col.setRGB(c.getX(i), c.getY(i), c.getZ(i)).convertLinearToSRGB(); c.setXYZ(i, col.r, col.g, col.b); }
  return geo;
}

export const NATURE_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0 });

// Variants per flora id (see FLORA in data.js). Tree ferns and cycads use a fern crown from the pack on a built trunk.
const VARIANTS = {
  1: ['PalmTree_1', 'PalmTree_2', 'PalmTree_3', 'PalmTree_4'],
  2: ['@treefern:Plant_3', '@treefern:Plant_1'],
  3: ['CommonTree_3', 'CommonTree_4', 'CommonTree_5', 'CommonTree_1', 'Willow_1'],
  4: ['Plant_3', 'Plant_1', 'Bush_1', 'Bush_2', 'BushBerries_2'],
  5: ['@cycad:Plant_3', '@cycad:Plant_1'],
  6: ['Rock_1', 'Rock_2', 'Rock_3', 'Rock_4', 'Rock_5', 'Rock_Moss_1', 'Rock_Moss_2', 'Rock_Moss_3'],
};
// Extra ground decoration scattered around the island.
export const DECOR = ['Flowers'];

const cache = new Map();
// Geometries for a flora id, each scaled to about `height` world units.
export function floraVariants(id, height) {
  const key = id + ':' + height.toFixed(3);
  if (cache.has(key)) return cache.get(key);
  const out = [];
  for (const v of VARIANTS[id] || []) {
    const g = v.startsWith('@') ? composite(v, height) : scaled(v, height);
    if (g) out.push(g);
  }
  cache.set(key, out);
  return out;
}
export function decorGeometry(name, height) { return scaled(name, height); }

function scaled(name, h) {
  const g0 = src.get(name);
  if (!g0) return null;
  const g = g0.clone();
  g.scale(h, h, h);
  return g;
}

// A tapering, ringed trunk with vertex colours, topped by a fern crown from the pack.
function composite(spec, h) {
  const [kind, crownName] = spec.slice(1).split(':');
  const crown0 = src.get(crownName);
  if (!crown0) return null;
  const cycad = kind === 'cycad';
  const trunkH = h * (cycad ? 0.45 : 0.72), r0 = h * (cycad ? 0.13 : 0.06), r1 = h * (cycad ? 0.1 : 0.045);
  let trunk = new THREE.CylinderGeometry(r1, r0, trunkH, 7, cycad ? 4 : 6);
  trunk.translate(0, trunkH / 2, 0);
  trunk = trunk.toNonIndexed();
  const pos = trunk.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / trunkH;
    // ringed bark: alternate light and dark bands, as on real tree ferns and cycads
    c.setHex(cycad ? 0x6a5a3a : 0x4a3a28).multiplyScalar(0.8 + 0.25 * (Math.sin(y * (cycad ? 40 : 28)) > 0 ? 1 : 0));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  trunk.setAttribute('color', new THREE.BufferAttribute(col, 3));
  trunk.deleteAttribute('uv');
  trunk.deleteAttribute('normal'); // the pack's meshes are flat-shaded and carry no normals
  const crownH = h * (cycad ? 0.75 : 0.55);
  const crown = crown0.clone();
  crown.scale(crownH * (cycad ? 1.3 : 1.5), crownH, crownH * (cycad ? 1.3 : 1.5));
  crown.translate(0, trunkH * 0.92, 0);
  if (crown.attributes.normal) crown.deleteAttribute('normal');
  return mergeGeometries([trunk, crown]);
}
