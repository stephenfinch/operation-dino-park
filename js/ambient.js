// Ambient life: drifting clouds, circling pterosaurs and the ferry pier at the gate.
import * as THREE from 'three';
import { T } from './map.js';
import { MAT, Parts } from './models.js';
import { rand, clamp } from './util.js';
import { G } from './state.js';

function cloudGeometry() {
  const p = new Parts();
  const n = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) p.ico(rand(2.2, 3.6), 0xffffff, [i * 2.6 - n * 1.3 + rand(-0.5, 0.5), rand(-0.3, 0.6), rand(-1.2, 1.2)], [1, 0.55, 0.8], 1);
  return p.merge();
}

function pteroGeometry() {
  const body = new Parts();
  body.tubeX(0.12, 0.03, 1.1, 0x6a4a3a, [-0.55, 0, 0]);
  body.cone(0.06, 0.55, 0xc0502a, [0.62, 0.12, 0], [0, 0, -1.2], 4);
  body.cone(0.05, 0.45, 0x6a4a3a, [0.75, -0.02, 0], [0, 0, -Math.PI / 2], 4);
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.Float32BufferAttribute([0.25, 0, 0, -0.35, 0, 0, -0.1, 0, 1.6, 0.25, 0, 0, -0.1, 0, 1.6, -0.35, 0, 0], 3));
  const wp = new Parts();
  wp.add(wing, 0x8a5a40);
  return { body: body.merge(), wing: wp.merge() };
}

export class Ambient {
  constructor(game) {
    this.g = game;
    this.root = new THREE.Group();
    game.root.add(this.root);
    const W = game.map.W;
    // clouds
    this.cloudMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, transparent: true, opacity: 0.9, fog: false });
    this.clouds = [];
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(cloudGeometry(), this.cloudMat);
      m.position.set(rand(-50, W + 50), rand(30, 42), rand(-50, W + 50));
      m.scale.setScalar(rand(1.3, 2.1));
      m.rotation.y = rand(0, Math.PI);
      m.userData.speed = rand(0.6, 1.4);
      m.userData.always = i < 9;
      this.root.add(m);
      this.clouds.push(m);
    }
    // pterosaurs
    const pg = pteroGeometry();
    this.pteros = [];
    for (let i = 0; i < 5; i++) {
      const grp = new THREE.Group();
      grp.add(new THREE.Mesh(pg.body, MAT.std));
      const wm = (this.wingMat = this.wingMat || new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, side: THREE.DoubleSide }));
      const l = new THREE.Mesh(pg.wing, wm), r = new THREE.Mesh(pg.wing, wm);
      r.scale.z = -1;
      grp.add(l, r);
      grp.scale.setScalar(0.9);
      grp.userData = { l, r, cx: rand(25, W - 25), cz: rand(25, W - 25), rad: rand(14, 30), h: rand(16, 26), w: rand(0.12, 0.22) * (Math.random() < 0.5 ? 1 : -1), a: rand(0, 6.28), ph: rand(0, 6) };
      this.root.add(grp);
      this.pteros.push(grp);
    }
    this.buildPier();
    this.t = 0;
  }

  // Visitor helipad just outside the gate, on stilts if it reaches the water.
  buildPier() {
    const map = this.g.map, e = map.entrance;
    // Only the old 3×2 gate needs this separate pier; today's Park Entrance has its own helipad.
    if (!e || !this.g.buildingsOf('gate').length) return;
    const x = e.x + 1.5, z = e.y + 4.6;
    const p = new Parts();
    p.cyl(1.55, 1.6, 0.16, 0xb4b2aa, [0, 0.5, 0], null, 20);
    p.cyl(1.25, 1.25, 0.02, 0x3a3a3a, [0, 0.59, 0], null, 20);
    p.box(0.16, 0.02, 1.0, 0xf2f0e8, [-0.32, 0.61, 0]); p.box(0.16, 0.02, 1.0, 0xf2f0e8, [0.32, 0.61, 0]); p.box(0.5, 0.02, 0.16, 0xf2f0e8, [0, 0.61, 0]);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; p.box(0.12, 1.4, 0.12, 0x6a6a64, [Math.cos(a) * 1.2, -0.2, Math.sin(a) * 1.2]); }
    p.box(0.9, 0.12, 2.6, 0x9a7a52, [0, 0.35, -2.1], [0.2, 0, 0]);
    const pad = new THREE.Mesh(p.merge(), MAT.std);
    pad.position.set(x, 0, z);
    pad.castShadow = true; pad.receiveShadow = true;
    this.root.add(pad);
    map.helipad = { x, z, y: 0.62 };
  }

  update(dt, weather) {
    this.t += dt;
    const W = this.g.map.W;
    const stormy = weather === 'storm' || weather === 'twister';
    const cloudy = weather !== 'clear';
    const target = stormy ? 0.35 : weather === 'rain' ? 0.6 : 1;
    // Thin the clouds out when the camera is up among them so they never hide the park.
    const camY = G.engine.camera.position.y;
    this.cloudMat.opacity = 0.9 * clamp(1 - (camY - 22) / 30, 0.18, 1);
    const c = this.cloudMat.color;
    c.setScalar(c.r + (target - c.r) * Math.min(1, dt));
    for (const m of this.clouds) {
      m.visible = cloudy || m.userData.always;
      m.position.x += m.userData.speed * dt * (stormy ? 3 : 1);
      if (m.position.x > W + 70) m.position.x = -70;
    }
    for (const p of this.pteros) {
      const u = p.userData;
      u.a += u.w * dt;
      p.position.set(u.cx + Math.cos(u.a) * u.rad, u.h + Math.sin(this.t * 0.5 + u.ph) * 1.5, u.cz + Math.sin(u.a) * u.rad);
      p.rotation.y = -(u.a + (u.w > 0 ? Math.PI / 2 : -Math.PI / 2));
      p.rotation.z = u.w > 0 ? -0.25 : 0.25;
      const flap = Math.sin(this.t * 5 + u.ph);
      const glide = Math.sin(this.t * 0.4 + u.ph) > 0.3 ? 0.15 : 1;
      u.l.rotation.x = flap * 0.6 * glide;
      u.r.rotation.x = -flap * 0.6 * glide;
      p.visible = !stormy;
    }

  }
}
