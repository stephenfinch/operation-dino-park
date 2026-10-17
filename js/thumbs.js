// Renders 3D models to small images for UI icons and portraits.
import * as THREE from 'three';
import { BLD, SPECIES_BY_ID, WORLD_SCALE } from './data.js';
import { natureLoaded, floraVariants, NATURE_MAT } from './nature.js';
import { MAT, buildingGeometry, createDinoMesh, floraGeometry, leafMaterial, fenceGeometry, statueGeometry, jeepGeometry, heliGeometry, balloonGeometry } from './models.js';

export class Thumbs {
  constructor() {
    this.cache = new Map();
    try {
      const canvas = document.createElement('canvas');
      this.r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.r.setPixelRatio(1);
      this.r.outputColorSpace = THREE.SRGBColorSpace;
      this.r.toneMapping = THREE.ACESFilmicToneMapping;
      this.scene = new THREE.Scene();
      this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x404830, 1.3));
      const d = new THREE.DirectionalLight(0xfff0dd, 2.2); d.position.set(3, 5, 4); this.scene.add(d);
      this.cam = new THREE.PerspectiveCamera(28, 1.25, 0.05, 200);
    } catch (e) { this.r = null; }
  }

  render(key, obj, o = {}) {
    if (this.cache.has(key)) return this.cache.get(key);
    if (!this.r) return '';
    const w = o.w || 160, h = o.h || 128;
    this.r.setSize(w, h, false);
    this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
    this.scene.add(obj);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const r = Math.max(s.x, s.y * 1.15, s.z) * 0.5;
    const dir = new THREE.Vector3(...(o.dir || [1, 0.75, 1.25])).normalize();
    const dist = r / Math.tan((this.cam.fov * Math.PI) / 360) * (o.zoom || 1.15);
    this.cam.position.copy(c).addScaledVector(dir, dist);
    this.cam.lookAt(c);
    this.r.render(this.scene, this.cam);
    const url = this.r.domElement.toDataURL('image/png');
    this.scene.remove(obj);
    this.cache.set(key, url);
    return url;
  }

  building(id) {
    if (this.cache.has('b:' + id)) return this.cache.get('b:' + id);
    const def = BLD[id];
    const extra = id === 'statue' ? { statue: statueGeometry(SPECIES_BY_ID.tyrannosaurus) } : null;
    const ms = def.model || def.size;
    const geo = buildingGeometry(id, ms[0], ms[1], extra);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo.body, MAT.std));
    if (geo.glow) g.add(new THREE.Mesh(geo.glow, MAT.std));
    return this.render('b:' + id, g, { dir: [0.9, 0.85, 1.3] });
  }

  species(id, big) {
    const key = 's:' + id + (big ? ':b' : '');
    if (this.cache.has(key)) return this.cache.get(key);
    const sp = SPECIES_BY_ID[id];
    const m = createDinoMesh(sp);
    m.userData.scaler.scale.setScalar(WORLD_SCALE);
    m.rotation.y = 0.5;
    return this.render(key, m, { dir: [0.35, 0.32, 1], zoom: 0.78, w: big ? 320 : 160, h: big ? 200 : 110 });
  }

  speciesMesh(id) {
    const m = createDinoMesh(SPECIES_BY_ID[id]);
    m.userData.scaler.scale.setScalar(WORLD_SCALE);
    m.rotation.y = 0.5;
    return m;
  }

  flora(id) {
    if (this.cache.has('f:' + id)) return this.cache.get('f:' + id);
    const g = new THREE.Group();
    if (natureLoaded()) { const v = floraVariants(id, 1)[0]; if (v) { g.add(new THREE.Mesh(v, NATURE_MAT)); return this.render('f:' + id, g, { dir: [1, 0.6, 1.3] }); } }
    const fg = floraGeometry(id);
    if (fg.trunk) g.add(new THREE.Mesh(fg.trunk, id === 6 ? MAT.std : MAT.bark));
    if (fg.leaves) g.add(new THREE.Mesh(fg.leaves, leafMaterial(fg.leafKind)));
    return this.render('f:' + id, g, { dir: [1, 0.6, 1.3] });
  }

  fence(t) {
    const g = new THREE.Group();
    for (let k = 0; k < 3; k++) { const m = new THREE.Mesh(fenceGeometry(t), MAT.std); m.position.x = k - 1.5; g.add(m); }
    return this.render('fe:' + t, g, { dir: [0.5, 0.5, 1.3] });
  }

  vehicle(kind) {
    const geo = kind === 'heli' ? heliGeometry() : kind === 'balloon' ? balloonGeometry() : kind === 'ranger' ? jeepGeometry(0x3a5a30, 0xd8d0a0) : jeepGeometry();
    return this.render('v:' + kind, new THREE.Mesh(geo, MAT.std));
  }

  path(kind) {
    const key = 'p:' + kind;
    if (this.cache.has(key)) return this.cache.get(key);
    const g = new THREE.Group();
    const col = kind === 2 ? 0x9a7a52 : 0xd9ccb0;
    for (let k = 0; k < 3; k++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 1), new THREE.MeshStandardMaterial({ color: col }));
      m.position.set(k - 1, 0, k === 2 ? 1 : 0);
      g.add(m);
    }
    const grass = new THREE.Mesh(new THREE.BoxGeometry(4, 0.04, 3), new THREE.MeshStandardMaterial({ color: 0x5f9e3e }));
    grass.position.y = -0.04; g.add(grass);
    return this.render(key, g, { dir: [0.6, 1.2, 1] });
  }

  terrain(kind) {
    const key = 't:' + kind;
    if (this.cache.has(key)) return this.cache.get(key);
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.5, 0.3, 20), new THREE.MeshStandardMaterial({ color: kind === 'water' ? 0x6a6a48 : 0x5f9e3e, flatShading: true }));
    g.add(base);
    if (kind === 'hill') { const m = new THREE.Mesh(new THREE.ConeGeometry(1.0, 1.3, 9), new THREE.MeshStandardMaterial({ color: 0x6e8a46, flatShading: true })); m.position.y = 0.75; g.add(m); const r = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.6, 7), new THREE.MeshStandardMaterial({ color: 0x8a8478, flatShading: true })); r.position.set(0.35, 0.5, 0.3); g.add(r); return this.render(key, g, { dir: [0.4, 1, 1] }); }
    if (kind === 'flat') { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, 0.4, 9), new THREE.MeshStandardMaterial({ color: 0x6e8a46, flatShading: true })); m.position.y = 0.3; g.add(m); return this.render(key, g, { dir: [0.4, 1, 1] }); }
    if (kind === 'water') { const w = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.32, 20), new THREE.MeshStandardMaterial({ color: 0x2a86a8 })); w.position.y = 0.02; g.add(w); }
    else { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 0.35, 8), new THREE.MeshStandardMaterial({ color: 0x7a6448, flatShading: true })); m.position.y = 0.2; g.add(m); }
    return this.render(key, g, { dir: [0.4, 1, 1] });
  }
}
