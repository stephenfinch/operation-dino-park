// Animated low-poly dinosaurs from Quaternius' "Animated Dinosaur Pack" (CC0 1.0, quaternius.com).
// tools/fbxview.html converted the FBX files to GLB with one mesh each; the red channel of the vertex
// colour stores the original material slot, so every species can be recoloured from its own palette.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// Which rig each species uses. Species not listed keep their procedural model.
export const RIG_OF = {
  tyrannosaurus: 'Trex', albertosaurus: 'Trex', allosaurus: 'Trex', acrocanthosaurus: 'Trex', carcharodontosaurus: 'Trex', ceratosaurus: 'Trex', spinosaurus: 'Trex',
  velociraptor: 'Velociraptor', dilophosaurus: 'Velociraptor', dryosaurus: 'Velociraptor',
  parasaurolophus: 'Parasaurolophus', edmontosaurus: 'Parasaurolophus', corythosaurus: 'Parasaurolophus', ouranosaurus: 'Parasaurolophus',
  triceratops: 'Triceratops', torosaurus: 'Triceratops', styracosaurus: 'Triceratops',
  stegosaurus: 'Stegosaurus', kentrosaurus: 'Stegosaurus',
  brachiosaurus: 'Apatosaurus', camarasaurus: 'Apatosaurus',
};
// What each material slot of a rig is: main skin, belly, stripes/accent, dark (eyes, claws), mouth, horn, crest.
const SLOTS = {
  Apatosaurus: ['main', 'dark', 'belly', 'accent'],
  Parasaurolophus: ['main', 'accent', 'belly', 'crest'],
  Stegosaurus: ['main', 'belly', 'plate'],
  Trex: ['main', 'dark', 'accent', 'mouth', 'belly'],
  Triceratops: ['main', 'horn', 'belly'],
  Velociraptor: ['main', 'dark', 'belly'],
};
const FILES = Object.keys(SLOTS);
const rigs = new Map();
let loading = null;

export function loadRigs(base = 'assets/models/quaternius/') {
  if (!loading) {
    const loader = new GLTFLoader();
    loading = Promise.all(FILES.map(async (n) => {
      try {
        // The single-file build embeds the models as base64; the dev build fetches them.
        const b64 = window.ISLA_MODELS?.[n];
        const g = b64 ? await loader.parseAsync(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer, '') : await loader.loadAsync(base + n + '.glb');
        prepareRig(n, g);
      } catch (e) { console.warn('Could not load model', n, e); }
    }));
  }
  return loading;
}

function prepareRig(name, gltf) {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  let mesh = null;
  scene.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; });
  if (!mesh) return;
  const box = new THREE.Box3().setFromObject(scene);
  const clips = {};
  for (const a of gltf.animations) clips[a.name.toLowerCase()] = a;
  rigs.set(name, { scene, mesh, clips, len: box.max.z - box.min.z, minY: box.min.y, zMid: (box.max.z + box.min.z) / 2, slotOf: decodeSlots(mesh.geometry) });
}

// Slot index per vertex, decoded once from the red channel.
function decodeSlots(geo) {
  const c = geo.attributes.color, n = c.count, out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.min(7, Math.floor(c.getX(i) * 8));
  return out;
}

export function rigsLoaded() { return rigs.size > 0; }
export function hasRig(sp) { return rigs.has(RIG_OF[sp.id]); }

const _a = new THREE.Color(), _b = new THREE.Color();
function palette(sp) {
  const main = new THREE.Color(sp.col), belly = new THREE.Color(sp.col2);
  const feat = new THREE.Color(sp.frillCol || sp.sailCol || 0xb0603a);
  return {
    main,
    belly: belly.clone().lerp(main, 0.25),
    accent: main.clone().lerp(_a.set(0x1a1410), 0.35),
    dark: new THREE.Color(0x1a1612),
    mouth: new THREE.Color(0x8a3a34),
    horn: new THREE.Color(0xe2d6b8),
    crest: feat,
    plate: main.clone().lerp(feat, 0.55),
  };
}

// Per-species geometry (shared by every animal of that species): vertex colours from the palette,
// with a little per-vertex noise so flat faces read as skin.
const speciesGeo = new Map();
function geometryFor(sp, rig) {
  if (speciesGeo.has(sp.id)) return speciesGeo.get(sp.id);
  const geo = rig.mesh.geometry.clone();
  const pal = palette(sp), slots = SLOTS[rigName(sp)], n = geo.attributes.position.count;
  const col = new Float32Array(n * 3), pos = geo.attributes.position;
  for (let i = 0; i < n; i++) {
    const role = slots[rig.slotOf[i]] || 'main';
    _b.copy(pal[role] || pal.main);
    if (role === 'main' || role === 'accent') {
      const h = Math.sin(pos.getX(i) * 0.013 + pos.getZ(i) * 0.021) * Math.cos(pos.getY(i) * 0.017 - pos.getZ(i) * 0.009);
      _b.multiplyScalar(0.9 + h * 0.12);
    }
    col[i * 3] = _b.r; col[i * 3 + 1] = _b.g; col[i * 3 + 2] = _b.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // Crestless hadrosaurs: collapse the crest triangles so they vanish.
  if (rigName(sp) === 'Parasaurolophus' && !sp.crest) {
    const crest = slots.indexOf('crest'), p = geo.attributes.position.array;
    let ax = 0, ay = 0, az = 0, c = 0;
    for (let i = 0; i < n; i++) if (rig.slotOf[i] === crest) { ax += p[i * 3]; ay += p[i * 3 + 1]; az += p[i * 3 + 2]; c++; }
    if (c) for (let i = 0; i < n; i++) if (rig.slotOf[i] === crest) { p[i * 3] = ax / c; p[i * 3 + 1] = ay / c - 20; p[i * 3 + 2] = az / c; }
  }
  speciesGeo.set(sp.id, geo);
  return geo;
}
const rigName = (sp) => RIG_OF[sp.id];

export const RIG_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0 });

// Build an animated instance. Returns a Group shaped like the procedural one: userData.scaler holds
// the model (scaled by the caller), userData.rig drives the animation clips.
export function createRiggedDino(sp, lenM) {
  const rig = rigs.get(rigName(sp));
  const root = new THREE.Group();
  const scaler = new THREE.Group();
  root.add(scaler);
  const model = cloneSkinned(rig.scene);
  let mesh = null, head = null, torso = null;
  model.traverse((o) => {
    if (o.isSkinnedMesh) { mesh = o; o.geometry = geometryFor(sp, rig); o.material = RIG_MAT; o.castShadow = true; o.frustumCulled = false; }
    if (o.name === 'Head') head = o;
    if (o.name === 'Torso') torso = o;
  });
  // model space is centimetres, facing +Z; the game faces +X and works in metres
  const k = lenM / rig.len;
  const holder = new THREE.Group();
  holder.rotation.y = Math.PI / 2;
  holder.scale.setScalar(k);
  holder.position.y = -rig.minY * k;
  model.position.z = -rig.zMid;
  holder.add(model);
  scaler.add(holder);
  if (torso && (sp.id === 'spinosaurus' || sp.id === 'ouranosaurus')) addSail(model, torso, rig, sp);
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const [k2, clip] of Object.entries(rig.clips)) actions[k2] = mixer.clipAction(clip);
  const r = { mixer, actions, cur: null, mesh };
  play(r, 'idle', 0);
  mixer.update(Math.random() * 2);
  root.userData = { scaler, rig: r, head: head || model, sp };
  return root;
}

// A skin sail along the back for Spinosaurus and Ouranosaurus.
function addSail(model, torso, rig, sp) {
  model.updateMatrixWorld(true);
  const L = rig.len, h = L * (sp.id === 'spinosaurus' ? 0.16 : 0.1);
  const shape = new THREE.Shape();
  shape.moveTo(-L * 0.17, 0);
  shape.quadraticCurveTo(-L * 0.06, h * 1.25, L * 0.1, h * 0.6);
  shape.lineTo(L * 0.14, 0);
  shape.lineTo(-L * 0.17, 0);
  const g = new THREE.ShapeGeometry(shape, 8);
  g.rotateY(-Math.PI / 2); // lay along +Z (model forward)
  const sail = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: sp.sailCol || 0x9a4a32, side: THREE.DoubleSide, flatShading: true, roughness: 0.8 }));
  const tp = model.worldToLocal(torso.getWorldPosition(new THREE.Vector3()));
  const back = new THREE.Box3().setFromObject(rig.scene);
  sail.position.set(0, back.max.y * (sp.id === 'spinosaurus' ? 0.72 : 0.62), tp.z);
  sail.castShadow = true;
  model.add(sail);
  torso.attach(sail);
}

export function play(r, name, fade = 0.25, once = false) {
  const a = r.actions[name];
  if (!a || r.cur === name) return a;
  const prev = r.cur && r.actions[r.cur];
  a.reset();
  a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
  a.clampWhenFinished = once;
  a.enabled = true;
  a.play();
  if (prev && fade > 0) prev.crossFadeTo(a, fade, false); else if (prev) prev.stop();
  r.cur = name;
  return a;
}
