// Renderer, scene, camera controller, lighting, sky, water and weather effects.
import * as THREE from 'three';
import { G } from './state.js';
import { clamp, lerp, angleLerp } from './util.js';
import { MAT } from './models.js';
import { Water } from 'three/addons/objects/Water.js';
import { waterNormals } from './textures.js';

const SKY_VS = `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const SKY_FS = `uniform vec3 top; uniform vec3 bottom; uniform vec3 sunCol; uniform vec3 sunDir; uniform float stars; varying vec3 vW;
float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
void main(){ vec3 d = normalize(vW - cameraPosition); float h = clamp(d.y*1.4+0.15,0.0,1.0);
 vec3 c = mix(bottom, top, pow(h,0.8));
 float s = max(dot(d, normalize(sunDir)),0.0); c += sunCol * (pow(s,180.0)*2.0 + pow(s,8.0)*0.25);
 if(stars>0.0 && d.y>0.0){ float st = step(0.9985, hash(floor(d*400.0))); c += vec3(st)*stars*h; }
 gl_FragColor = vec4(c,1.0); }`;

export class Engine {
  constructor(canvas) {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = G.settings.shadows;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    const scene = (this.scene = new THREE.Scene());
    scene.fog = new THREE.Fog(0xbfe0f0, 80, 320);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 900);

    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x5a6a3a, 0.9);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
    this.sun.castShadow = true;
    const sc = this.sun.shadow;
    sc.mapSize.set(2048, 2048);
    sc.bias = -0.0006; sc.normalBias = 0.03;
    sc.camera.near = 1; sc.camera.far = 260;
    scene.add(this.sun, this.sun.target);

    // Sky dome
    this.skyU = { top: { value: new THREE.Color(0x4a90d8) }, bottom: { value: new THREE.Color(0xbfe0f0) }, sunCol: { value: new THREE.Color(0xffe8c0) }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, stars: { value: 0 } };
    const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 24, 16), new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false }));
    sky.renderOrder = -10;
    this.sky = sky;
    scene.add(sky);

    // Ocean + seabed
    const oceanGeo = new THREE.PlaneGeometry(1400, 1400, 1, 1);
    this.waterMat = new THREE.MeshStandardMaterial({ color: 0x2a86a8, transparent: true, opacity: 0.82, roughness: 0.15, metalness: 0.1 });
    if (G.settings.reflections !== false) {
      // Reflective, animated water (sea and lakes share one plane)
      const wn = waterNormals();
      this.ocean = new Water(oceanGeo, {
        textureWidth: 512, textureHeight: 512, waterNormals: wn, sunDirection: new THREE.Vector3(0.5, 1, 0.3).normalize(),
        sunColor: 0xfff4dd, waterColor: 0x1d5566, distortionScale: 1.6, fog: true, alpha: 0.86,
      });
      this.ocean.material.transparent = true;
      this.ocean.material.uniforms.size.value = 2.2;
      this.water = this.ocean;
    } else {
      this.ocean = new THREE.Mesh(oceanGeo, this.waterMat);
      this.ocean.receiveShadow = true;
    }
    this.ocean.rotation.x = -Math.PI / 2;
    this.ocean.position.y = -0.22;
    scene.add(this.ocean);
    const bedGeo = oceanGeo.clone(); bedGeo.rotateX(-Math.PI / 2);
    const bed = new THREE.Mesh(bedGeo, new THREE.MeshStandardMaterial({ color: 0x4a6a5e, roughness: 1 }));
    bed.position.y = -1.9;
    scene.add(bed);

    // Camera controller
    this.cam = { x: 48, z: 60, yaw: 0, pitch: 0.85, dist: 42, tx: 48, tz: 60, tyaw: 0, tpitch: 0.85, tdist: 42, mode: 'orbit', follow: null, rideYaw: 0, ridePitch: -0.1 };
    this.keys = new Set();
    this.bounds = { w: 96, h: 96 };

    // Selection ring and hover tile
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32), new THREE.MeshBasicMaterial({ color: 0xffd040, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.visible = false; ring.renderOrder = 5;
    this.selRing = ring; scene.add(ring);

    // Rain
    const N = 2600;
    const rp = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) this._resetDrop(rp, i, true);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xa8c0d8, transparent: true, opacity: 0.45 }));
    this.rain.frustumCulled = false; this.rain.visible = false;
    scene.add(this.rain);
    this.rainN = N;

    // Twister
    this.twister = new THREE.Group();
    const twMat = new THREE.MeshStandardMaterial({ color: 0x6a6a6a, transparent: true, opacity: 0.55, roughness: 1, depthWrite: false, flatShading: true });
    for (let i = 0; i < 7; i++) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.6 + i * 0.55, 0.35 + i * 0.5, 2.2, 10, 1, true), twMat);
      c.position.y = 1.1 + i * 2.0;
      this.twister.add(c);
    }
    const dg = new THREE.BufferGeometry();
    const dp = new Float32Array(300 * 3);
    dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    this.debris = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0x4a3a2a, size: 0.25 }));
    this.twister.add(this.debris);
    this.twister.visible = false;
    scene.add(this.twister);

    this.flash = 0;
    this.time = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _resetDrop(a, i, anyY) {
    const c = this.cam || { x: 48, z: 48 };
    const x = c.x + (Math.random() - 0.5) * 70, z = c.z + (Math.random() - 0.5) * 70;
    const y = anyY ? Math.random() * 35 : 35;
    a[i * 6] = x; a[i * 6 + 1] = y; a[i * 6 + 2] = z;
    a[i * 6 + 3] = x + 0.08; a[i * 6 + 4] = y - 0.7; a[i * 6 + 5] = z + 0.05;
  }

  maxDist() { return Math.max(150, (this.bounds?.w || 96) * 1.15); }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setShadows(on) {
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }

  lookAt(x, z, dist) {
    this.cam.tx = x; this.cam.tz = z;
    if (dist) this.cam.tdist = dist;
  }

  // ---------- camera ----------
  updateCamera(dt) {
    const c = this.cam;
    const k = this.keys;
    if (c.mode === 'ride' && c.follow) {
      const e = c.follow;
      const p = e.camPos ? e.camPos() : { x: e.x, y: 1, z: e.z, yaw: e.heading || 0 };
      if (k.has('arrowleft')) c.rideYaw += dt * 1.5;
      if (k.has('arrowright')) c.rideYaw -= dt * 1.5;
      const yaw = -p.yaw + c.rideYaw;
      const cp = Math.cos(c.ridePitch);
      // a jolt when the vehicle is hit
      const sh = (this.shake = Math.max(0, (this.shake || 0) - dt * 1.5)) * 0.12;
      this.camera.position.set(p.x + (Math.random() - 0.5) * sh, p.y + (Math.random() - 0.5) * sh, p.z + (Math.random() - 0.5) * sh);
      this.camera.lookAt(p.x + Math.cos(-yaw) * cp * 10, p.y + Math.sin(c.ridePitch) * 10, p.z + Math.sin(-yaw) * cp * 10);
      c.x = p.x; c.z = p.z;
      this._updateShadowCam(p.x, p.z, 30);
      return;
    }
    const pan = c.tdist * 0.9 * dt;
    // tutorial: note that the player has tried each camera control
    if (G.game?.flags?.ex && !G.ui?.modalOpen?.()) {
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].some((x) => k.has(x))) G.game.flag('camMove');
      if (k.has('q') || k.has('e')) G.game.flag('camRotate');
    }
    const fx = -Math.sin(c.tyaw), fz = -Math.cos(c.tyaw), rx = Math.cos(c.tyaw), rz = -Math.sin(c.tyaw);
    let moved = false;
    if (k.has('w') || k.has('arrowup')) { c.tx += fx * pan; c.tz += fz * pan; moved = true; }
    if (k.has('s') || k.has('arrowdown')) { c.tx -= fx * pan; c.tz -= fz * pan; moved = true; }
    if (k.has('a') || k.has('arrowleft')) { c.tx -= rx * pan; c.tz -= rz * pan; moved = true; }
    if (k.has('d') || k.has('arrowright')) { c.tx += rx * pan; c.tz += rz * pan; moved = true; }
    if (k.has('q')) c.tyaw += dt * 1.6;
    if (k.has('e')) c.tyaw -= dt * 1.6;
    // R zooms in and F zooms out, as in the original (the camera tilts down as it pulls back)
    if (k.has('r') && !G.tools?.busy) { c.tdist = clamp(c.tdist * (1 - dt * 1.5), 5, this.maxDist ? this.maxDist() : 150); G.game?.flag?.('camZoom'); }
    if (k.has('f')) { c.tdist = clamp(c.tdist * (1 + dt * 1.5), 5, this.maxDist ? this.maxDist() : 150); G.game?.flag?.('camZoom'); }
    if (k.has('pageup')) c.tpitch = clamp(c.tpitch + dt, 0.25, 1.45);
    if (k.has('pagedown')) c.tpitch = clamp(c.tpitch - dt, 0.25, 1.45);
    if (k.has('=') || k.has('+')) c.tdist = clamp(c.tdist * (1 - dt * 1.5), 5, this.maxDist ? this.maxDist() : 150);
    if (k.has('-')) c.tdist = clamp(c.tdist * (1 + dt * 1.5), 5, this.maxDist ? this.maxDist() : 150);
    if (G.settings.edgeScroll && this.mouse && !this.mouse.inUI) {
      const m = 12, { x, y } = this.mouse, W = window.innerWidth, H = window.innerHeight;
      if (x < m) { c.tx -= rx * pan; c.tz -= rz * pan; moved = true; }
      if (x > W - m) { c.tx += rx * pan; c.tz += rz * pan; moved = true; }
      if (y < m) { c.tx += fx * pan; c.tz += fz * pan; moved = true; }
      if (y > H - m) { c.tx -= fx * pan; c.tz -= fz * pan; moved = true; }
    }
    if (moved && c.mode === 'follow') { c.mode = 'orbit'; c.follow = null; }
    if (c.mode === 'follow' && c.follow) {
      if (c.follow.removed) { c.mode = 'orbit'; c.follow = null; }
      else { c.tx = c.follow.x; c.tz = c.follow.z; }
    }
    c.tx = clamp(c.tx, -10, this.bounds.w + 10);
    c.tz = clamp(c.tz, -10, this.bounds.h + 10);
    const s = 1 - Math.pow(0.0005, dt);
    c.x = lerp(c.x, c.tx, s); c.z = lerp(c.z, c.tz, s);
    c.yaw = angleLerp(c.yaw, c.tyaw, s); c.pitch = lerp(c.pitch, c.tpitch, s); c.dist = lerp(c.dist, c.tdist, s);
    const gy = G.game ? Math.max(0, G.game.map.heightAt(c.x, c.z)) : 0;
    const cp = Math.cos(c.pitch);
    this.camera.position.set(c.x + Math.sin(c.yaw) * cp * c.dist, gy + Math.sin(c.pitch) * c.dist, c.z + Math.cos(c.yaw) * cp * c.dist);
    this.camera.lookAt(c.x, gy, c.z);
    this._updateShadowCam(c.x, c.z, clamp(c.dist * 0.9, 18, 75));
  }

  _updateShadowCam(x, z, half) {
    const sun = this.sun;
    const d = this.sunDir || new THREE.Vector3(0.5, 1, 0.3).normalize();
    sun.target.position.set(x, 0, z);
    sun.position.set(x + d.x * 120, d.y * 120, z + d.z * 120);
    const cam = sun.shadow.camera;
    if (cam.right !== half) {
      cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
      cam.updateProjectionMatrix();
    }
  }

  // ---------- lighting & atmosphere ----------
  setAtmosphere(hour, weather, dt) {
    this.time += dt;
    const day = Math.sin(((hour - 6) / 12) * Math.PI); // >0 during the day
    const sunUp = clamp(day * 1.6 + 0.15, 0, 1);
    const az = ((hour - 6) / 12) * Math.PI;
    const elev = Math.max(0.12, day);
    this.sunDir = new THREE.Vector3(Math.cos(az) * 0.8, elev, 0.45).normalize();
    this.skyU.sunDir.value.copy(this.sunDir);
    const dusk = clamp(1 - Math.abs(day) * 3.5, 0, 1) * (hour > 4 && hour < 20 ? 1 : 0);
    const cloud = weather === 'cloudy' ? 0.35 : weather === 'rain' ? 0.6 : weather === 'storm' || weather === 'twister' ? 0.85 : 0;
    const top = new THREE.Color(0x4a90d8).lerp(new THREE.Color(0x0a1428), 1 - sunUp);
    const bottom = new THREE.Color(0xc8e6f4).lerp(new THREE.Color(0x1c2a40), 1 - sunUp).lerp(new THREE.Color(0xf0905a), dusk * 0.7);
    const grey = new THREE.Color(0x6a7480).multiplyScalar(0.4 + sunUp * 0.6);
    top.lerp(grey, cloud); bottom.lerp(grey, cloud * 0.9);
    if (this.flash > 0) { top.lerp(new THREE.Color(0xd0d8ff), this.flash); bottom.lerp(new THREE.Color(0xd0d8ff), this.flash); }
    this.skyU.top.value.copy(top); this.skyU.bottom.value.copy(bottom);
    this.skyU.sunCol.value.set(0xffd8a0).multiplyScalar(sunUp * (1 - cloud));
    this.skyU.stars.value = (1 - sunUp) * (1 - cloud);
    this.scene.fog.color.copy(bottom);
    // Fog starts beyond the point the camera looks at, so zooming out over a big island stays clear.
    const cd = this.cam?.dist || 40;
    this.scene.fog.near = lerp(90, 25, cloud) + Math.max(0, cd - 50) * 1.1;
    this.scene.fog.far = lerp(340, 140, cloud) + Math.max(0, cd - 50) * 2.2;
    // Sun by day, a cool moon by night (the same light moves across the sky).
    const moon = (1 - sunUp) * (1 - cloud * 0.6);
    this.sun.intensity = Math.max(2.4 * sunUp * (1 - cloud * 0.75), 0.9 * moon);
    this.sun.color.set(0xfff2dd).lerp(new THREE.Color(0xff9a50), dusk * 0.8).lerp(new THREE.Color(0x9fb4ff), 1 - sunUp);
    if (sunUp < 0.15) this.sunDir.set(-0.4, 0.8, -0.3).normalize();
    this.hemi.intensity = 0.75 + 0.25 * sunUp + this.flash * 2.5;
    this.hemi.color.set(0xcfe8ff).lerp(new THREE.Color(0x5a6ab0), 1 - sunUp);
    this.hemi.groundColor.set(0x5a6a3a).lerp(new THREE.Color(0x1a2030), 1 - sunUp);
    this.renderer.toneMappingExposure = 1.05 + (1 - sunUp) * 0.35;
    this.waterMat.color.set(0x2a86a8).multiplyScalar(0.35 + 0.65 * sunUp);
    if (this.water) {
      const u = this.water.material.uniforms;
      u.time.value += dt * 0.6;
      u.sunDirection.value.copy(this.sunDir);
      u.waterColor.value.set(0x1d5566).multiplyScalar(0.3 + 0.7 * sunUp).lerp(grey, cloud * 0.4);
      u.sunColor.value.set(0xfff4dd).multiplyScalar(Math.max(0.15, sunUp * (1 - cloud * 0.7)));
      u.distortionScale.value = 1.6 + cloud * 2.5;
    }
    // building lights come on at night and whenever it rains, as in the original
    MAT.glow.emissiveIntensity = clamp(1 - sunUp * 1.3 + cloud * 0.3 + (weather === 'rain' || weather === 'storm' || weather === 'twister' ? 0.8 : 0), 0, 1) * 1.4;
    this.night = 1 - sunUp;
    this.flash = Math.max(0, this.flash - dt * 3);
    // rain
    const raining = weather === 'rain' || weather === 'storm' || weather === 'twister';
    this.rain.visible = raining;
    if (raining) {
      const a = this.rain.geometry.attributes.position.array;
      const sp = (weather === 'rain' ? 22 : 34) * dt;
      for (let i = 0; i < this.rainN; i++) {
        a[i * 6 + 1] -= sp; a[i * 6 + 4] -= sp;
        if (a[i * 6 + 4] < -0.5) this._resetDrop(a, i, false);
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.rain.material.opacity = weather === 'rain' ? 0.35 : 0.55;
    }
  }

  setTwister(tw) {
    this.twister.visible = !!tw;
    if (!tw) return;
    this.twister.position.set(tw.x, 0, tw.z);
    this.twister.children.forEach((c, i) => { if (c.isMesh) { c.rotation.y += 0.25 + i * 0.03; c.position.x = Math.sin(this.time * 2 + i) * 0.3 * i; } });
    const a = this.debris.geometry.attributes.position.array;
    for (let i = 0; i < 300; i++) {
      const t = this.time * (2 + (i % 7) * 0.3) + i;
      const h = (i * 0.37) % 14;
      const r = 0.8 + h * 0.45;
      a[i * 3] = Math.cos(t) * r; a[i * 3 + 1] = h; a[i * 3 + 2] = Math.sin(t) * r;
    }
    this.debris.geometry.attributes.position.needsUpdate = true;
  }

  // ---------- picking ----------
  ray(clientX, clientY) {
    const rc = (this._rc = this._rc || new THREE.Raycaster());
    const v = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    rc.setFromCamera(v, this.camera);
    return rc.ray;
  }
  pickGround(clientX, clientY, y = 0) {
    const ray = this.ray(clientX, clientY);
    if (Math.abs(ray.direction.y) < 1e-4) return null;
    const t = (y - ray.origin.y) / ray.direction.y;
    if (t < 0) return null;
    return { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
