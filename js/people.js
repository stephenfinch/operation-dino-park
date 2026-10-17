// Park guests from Quaternius' "Animated Men Pack" and "Animated Women Pack" (CC0 1.0, quaternius.com).
// Hundreds of guests are on screen at once, so each character's animations are baked once into a few
// static poses (idle, walk and run frames) drawn with instancing. Shirts and dresses take a per-guest colour.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const CHARS = ['Man', 'Man_2', 'Man_LongSleeve', 'Man_Suit', 'Woman', 'Woman_Casual', 'Woman_Dress', 'Woman_TankTop'];
// [clip, fraction of the clip] samples for each pose
export const POSES = {
  idle: [['idle', 0.1], ['idle', 0.55]],
  walk: [['walk', 0], ['walk', 0.25], ['walk', 0.5], ['walk', 0.75]],
  run: [['run', 0], ['run', 0.25], ['run', 0.5], ['run', 0.75]],
};
// Parts that take the guest's colour (the suit keeps its own).
const TINT = /^(Shirt|Dress)$/;
const HEIGHT = 0.74; // a 1.85 m person in world units

export const PEOPLE = { count: CHARS.length, baked: [], material: null, wheel: false };
let loading = null;

export function loadPeople(base = 'assets/models/quaternius-people/') {
  if (!loading) {
    loading = (async () => {
      try {
        const M = window.DINOPARK_MODELS, loader = new GLTFLoader();
        const get = (n) => (M?.[n] ? loader.parseAsync(Uint8Array.from(atob(M[n]), (c) => c.charCodeAt(0)).buffer, '') : loader.loadAsync(base + n + '.glb'));
        const baked = await Promise.all(CHARS.map(async (c) => bake(await get(c), c !== 'Man_Suit')));
        PEOPLE.baked = baked;
        PEOPLE.material = tintMaterial();
      } catch (e) { console.warn('Could not load guest models', e); PEOPLE.baked = []; }
    })();
  }
  return loading;
}
export function peopleLoaded() { return PEOPLE.baked.length > 0 && !!PEOPLE.material; }

// Vertex colours carry each part's colour; the instance colour only tints vertices marked as clothing.
function tintMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <color_pars_vertex>', '#include <color_pars_vertex>\nattribute float tint;')
      .replace('#include <color_vertex>', `vColor = vec3(1.0);
#ifdef USE_COLOR
  vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor *= mix(vec3(1.0), instanceColor.rgb, tint);
#endif`);
  };
  return m;
}

const v3 = new THREE.Vector3();
function bake(gltf, tintable) {
  const scene = gltf.scene, mixer = new THREE.AnimationMixer(scene);
  const clips = Object.fromEntries(gltf.animations.map((a) => [a.name.split(/[_|]/).pop().toLowerCase(), a]));
  const meshes = [];
  scene.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
  scene.updateMatrixWorld(true);
  const rest = new THREE.Box3().setFromObject(scene);
  const k = HEIGHT / (rest.max.y - rest.min.y);
  // the models face +Z; guests in the game face +X
  const fix = new THREE.Matrix4().makeRotationY(Math.PI / 2).multiply(new THREE.Matrix4().makeScale(k, k, k));
  const out = {};
  for (const [pose, samples] of Object.entries(POSES)) {
    out[pose] = samples.map(([name, f]) => {
      mixer.stopAllAction();
      const clip = clips[name] || clips.idle || gltf.animations[0];
      const action = mixer.clipAction(clip);
      action.reset().play();
      action.time = clip.duration * f;
      mixer.update(0);
      scene.updateMatrixWorld(true);
      const parts = [];
      for (const m of meshes) {
        const src = m.geometry, pos = src.attributes.position, n = pos.count;
        const arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          v3.fromBufferAttribute(pos, i);
          m.applyBoneTransform(i, v3);
          v3.applyMatrix4(m.matrixWorld);
          arr[i * 3] = v3.x; arr[i * 3 + 1] = v3.y; arr[i * 3 + 2] = v3.z;
        }
        const mat = Array.isArray(m.material) ? m.material[0] : m.material;
        const tint = tintable && TINT.test(mat.name);
        // tinted clothing starts light so the guest's colour shows true
        const c = tint ? new THREE.Color(0.86, 0.86, 0.86) : mat.color;
        const col = new Float32Array(n * 3), tt = new Float32Array(n).fill(tint ? 1 : 0);
        for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.setAttribute('tint', new THREE.BufferAttribute(tt, 1));
        if (src.index) g.setIndex(src.index.clone());
        g.computeVertexNormals();
        parts.push(g.index ? g : g.toNonIndexed());
      }
      const g = mergeGeometries(parts);
      g.applyMatrix4(fix);
      g.computeBoundingBox();
      g.translate(0, -g.boundingBox.min.y, 0);
      return g;
    });
  }
  mixer.stopAllAction();
  return out;
}
