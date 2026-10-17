// Mouse/keyboard input and construction tools with live previews.
import * as THREE from 'three';
import { G } from './state.js';
import { BLD, FENCES, FLORA, CHARGEABLE } from './data.js';
import { T } from './map.js';
import { MAT, buildingGeometry, statueGeometry } from './models.js';
import { SPECIES_BY_ID } from './data.js';
import { clamp, fmtMoney, chance, pick } from './util.js';
import { PATH_COST, PATH_MAX, TRACK_COST, TRACK_MAX, WATER_COST, HILL_COST } from './game.js';
import { cheatKey } from './cheats.js';

const OK = new THREE.Color(0x40ff80), BAD = new THREE.Color(0xff4040), DEL = new THREE.Color(0xff8040), INFO = new THREE.Color(0x60c0ff), GATE = new THREE.Color(0xf0a830);

export class Tools {
  constructor(engine, canvas) {
    this.engine = engine;
    this.canvas = canvas;
    this.tool = { type: 'select' };
    this.drag = null;
    this.mouse = { x: 0, y: 0, inUI: false };
    engine.mouse = this.mouse;
    // preview objects
    this.preview = new THREE.Group();
    engine.scene.add(this.preview);
    const tg = new THREE.PlaneGeometry(0.96, 0.96); tg.rotateX(-Math.PI / 2);
    this.tiles = new THREE.InstancedMesh(tg, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false }), 3000);
    this.tiles.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3000 * 3), 3);
    this.tiles.count = 0; this.tiles.frustumCulled = false; this.tiles.renderOrder = 4;
    this.preview.add(this.tiles);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4000 * 6), 3));
    lg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(4000 * 6), 3));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 2, depthTest: false, transparent: true }));
    this.lines.frustumCulled = false; this.lines.renderOrder = 6;
    this.preview.add(this.lines);
    // fence posts preview (boxes)
    const pg = new THREE.BoxGeometry(0.98, 0.5, 0.12); pg.translate(0.5, 0.25, 0);
    this.posts = new THREE.InstancedMesh(pg, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false }), 4000);
    this.posts.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(4000 * 3), 3);
    this.posts.count = 0; this.posts.frustumCulled = false;
    this.preview.add(this.posts);
    this.ghost = null;
    this.bind();
  }

  get busy() { return this.tool.type === 'building'; }

  setTool(t) {
    this.tool = t || { type: 'select' };
    if (this.tool.type === 'building' && this.tool.rot == null) this.tool.rot = this.lastRot || 0;
    this.drag = null;
    this.clearPreview();
    if (this.ghost) { this.preview.remove(this.ghost); this.ghost = null; }
    const grid = ['fence', 'path', 'track', 'building', 'bulldoze', 'water', 'land', 'raise', 'lower', 'flora', 'release', 'acuMove'].includes(this.tool.type);
    if (G.game) G.game.view.grid.visible = grid;
    this.canvas.style.cursor = this.tool.type === 'select' ? 'default' : this.tool.type === 'bulldoze' ? 'not-allowed' : 'crosshair';
    G.ui?.onToolChange(this.tool);
    this.updateHover();
  }

  clearPreview() { this.tiles.count = 0; this.lines.geometry.setDrawRange(0, 0); this.posts.count = 0; G.ui?.cursorTip(null); }

  bind() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.onWheel(e); }, { passive: false });
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.engine.keys.clear());
  }

  ground(e) { return this.engine.pickGround(e.clientX, e.clientY, 0); }

  // Two-finger touch: pinch to zoom, twist to rotate.
  touchDown(e) {
    this.touches = this.touches || new Map();
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size === 2) {
      const [a, b] = [...this.touches.values()];
      const cam = this.engine.cam;
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), dist: cam.tdist, yaw: cam.tyaw };
      this.down = null; this.drag = null; this.clearPreview();
      return true;
    }
    return false;
  }
  touchMove(e) {
    if (!this.touches?.has(e.pointerId)) return false;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!this.pinch || this.touches.size !== 2) return false;
    const [a, b] = [...this.touches.values()];
    const cam = this.engine.cam;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    cam.tdist = clamp(this.pinch.dist * (this.pinch.d / Math.max(20, d)), 5, G.engine.maxDist());
    cam.tyaw = this.pinch.yaw - (Math.atan2(b.y - a.y, b.x - a.x) - this.pinch.ang);
    return true;
  }
  touchUp(e) {
    if (!this.touches) return false;
    this.touches.delete(e.pointerId);
    if (this.pinch) { if (this.touches.size === 0) this.pinch = null; return true; }
    return false;
  }

  onDown(e) {
    G.audio?.init();
    if (!G.game) return;
    if (e.pointerType === 'touch' && this.touchDown(e)) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    const cam = this.engine.cam;
    this.down = { x: e.clientX, y: e.clientY, button: e.button, moved: false, yaw: cam.tyaw, pitch: cam.tpitch, tx: cam.tx, tz: cam.tz, ry: cam.rideYaw, rp: cam.ridePitch };
    if (cam.mode === 'ride') return;
    if (e.button !== 0) return;
    if (this.tool.type !== 'select') G.ui?.collapseSubmenu();
    const p = this.ground(e);
    if (!p) return;
    const t = this.tool.type;
    if (['fence', 'path', 'track', 'bulldoze', 'water', 'land', 'raise', 'lower', 'flora'].includes(t)) {
      this.drag = { sx: p.x, sz: p.z, ex: p.x, ez: p.z, brush: new Set() };
      if (['flora', 'water', 'land', 'raise', 'lower'].includes(t)) this.brush(p);
      this.updatePreview();
    }
  }

  onMove(e) {
    if (e.pointerType === 'touch' && this.touchMove(e)) return;
    this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    this.mouse.inUI = e.target !== this.canvas;
    if (!this.mouse.inUI) this.mouse.seen = true;
    const cam = this.engine.cam;
    const d = this.down;
    if (d) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
      if (cam.mode === 'ride') {
        if (d.moved) { cam.rideYaw = d.ry - dx * 0.005; cam.ridePitch = clamp(d.rp - dy * 0.004, -1.2, 0.8); }
        return;
      }
      if (d.button === 2 && d.moved) {
        cam.tyaw = d.yaw - dx * 0.006;
        cam.tpitch = clamp(d.pitch + dy * 0.004, 0.25, 1.45);
        return;
      }
      if ((d.button === 1 || (d.button === 0 && this.tool.type === 'select')) && d.moved) {
        const k = cam.tdist / window.innerHeight * 1.6;
        const fx = -Math.sin(cam.tyaw), fz = -Math.cos(cam.tyaw), rx = Math.cos(cam.tyaw), rz = -Math.sin(cam.tyaw);
        cam.tx = d.tx - rx * dx * k + fx * dy * k;
        cam.tz = d.tz - rz * dx * k + fz * dy * k;
        if (cam.mode === 'follow') { cam.mode = 'orbit'; cam.follow = null; }
        return;
      }
    }
    if (e.target !== this.canvas && !this.drag) { if (this.tool.type !== 'select') this.clearPreview(); return; }
    if (this.drag) {
      const p = this.ground(e);
      if (p) { this.drag.ex = p.x; this.drag.ez = p.z; if (['flora', 'water', 'land', 'raise', 'lower'].includes(this.tool.type)) this.brush(p); }
      this.updatePreview();
    } else this.updateHover(e);
  }

  onUp(e) {
    if (e.pointerType === 'touch' && this.touchUp(e)) { this.down = null; return; }
    const d = this.down;
    this.down = null;
    if (!G.game) return;
    const cam = this.engine.cam;
    if (!d) return;
    if (cam.mode === 'ride') {
      const heli = cam.follow && cam.follow.kind === 'heli';
      if (!d.moved && heli) { G.game.heliShoot(d.button === 2 ? 'rifle' : 'dart'); return; }
      if (!d.moved && cam.follow?.kind === 'turret') { G.game.heliShoot('rifle'); return; }
      const cruiser = cam.follow && cam.follow.kind === 'cruiser';
      if (!d.moved && (cruiser || cam.follow?.kind === 'jeep') && d.button === 2) { G.game.horn(cam.follow); return; }
      if (!d.moved && (cruiser || cam.follow?.kind === 'jeep') && (G.game.rifle || G.game.driveBy) && d.button === 0) { G.game.heliShoot('rifle'); return; }
      if (!d.moved && d.button === 0) G.game.takePhoto();
      return;
    }
    if (d.button === 2 && !d.moved) {
      if (this.tool.type !== 'select') this.setTool({ type: 'select' });
      else G.game.select(null);
      return;
    }
    if (d.button !== 0) return;
    const t = this.tool.type;
    if (this.drag) { this.commitDrag(); this.drag = null; this.clearPreview(); this.updateHover(e); return; }
    if (d.moved) return;
    const p = this.ground(e);
    if (t === 'select') {
      const s = G.game.pick(e.clientX, e.clientY);
      G.game.select(s);
      if (s) G.audio?.play('click');
      // Buildings with a panel open it in one click, as in the original.
      if (s?.kind === 'building') {
        const t = s.ref.type;
        if (CHARGEABLE(t)) { G.ui.kioskB = s.ref.id; G.ui.openModal('kiosk'); }
        else if (t === 'hatchery') G.ui.openModal('hatchery');
        else if (t === 'research') G.ui.openModal('genetics');
      }
    } else if (t === 'building' && p) {
      const tx = Math.floor(p.x), ty = Math.floor(p.z);
      const door = this.tool.door != null ? G.game.buildings.get(this.tool.door) : null;
      const st = this.tool.station != null ? G.game.buildings.get(this.tool.station) : null;
      const b = door ? G.game.placeDomePod(door, tx, ty) : st ? G.game.placeBalloonPole(st, tx, ty) : G.game.placeBuilding(this.tool.id, tx, ty, this.tool.rot);
      if (b && b.type === 'balloon') { this.setTool({ type: 'building', id: 'balloon_pole', station: b.id }); G.ui?.toast({ text: 'Now place route poles: the balloon flies from pole to pole in order. Right-click when done.', kind: 'info', noMail: true }); }
      else if (b && b.type === 'balloon_pole') { G.ui?.refreshTop(); }
      else if (b && b.type === 'dome') { this.setTool({ type: 'building', id: 'dome_pod', door: b.id }); G.ui?.toast({ text: 'Now place the glass dome inside an enclosure. A tunnel joins it to the access door.', kind: 'info', noMail: true }); }
      else if (b) { G.ui?.refreshTop(); if (door || (!e.shiftKey && BLD[this.tool.id].size[0] * BLD[this.tool.id].size[1] >= 4)) this.setTool({ type: 'select' }); }
      else G.audio?.play('error');
      this.updateHover(e);
    } else if (t === 'release' && p) {
      const g = G.game, map = g.map;
      const tx = Math.floor(p.x), ty = Math.floor(p.z);
      if (!map.inb(tx, ty) || !map.dinoPassable(map.idx(tx, ty))) { g.notify("Can't release a dinosaur there.", 'warn'); G.audio?.play('error'); return; }
      g.releaseSlot(this.tool.b, this.tool.slot, p.x, p.z);
      this.setTool({ type: 'select' });
    } else if (t === 'acuMove' && p) {
      G.game.acuTask('move', this.tool.dino, { x: p.x, z: p.z });
      this.setTool({ type: 'select' });
    }
  }

  onWheel(e) {
    const cam = this.engine.cam;
    if (cam.mode === 'ride') return;
    cam.tdist = clamp(cam.tdist * Math.pow(1.0015, e.deltaY), 5, G.engine.maxDist());
    G.game?.flag?.('camZoom');
  }

  onKey(e, down) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
    const k = e.key.toLowerCase();
    if (down) this.engine.keys.add(k); else this.engine.keys.delete(k);
    if (!down || !G.game) return;
    cheatKey(k);
    const g = G.game, cam = this.engine.cam;
    if (k === 'escape') {
      if (G.ui?.closeTop()) return;
      if (cam.mode === 'ride') { g.exitControl(); return; }
      if (this.tool.type !== 'select') this.setTool({ type: 'select' });
      else g.select(null);
      return;
    }
    if (G.ui?.modalOpen()) return;
    if (cam.mode === 'ride') {
      if (k === ' ' || k === 'p') { e.preventDefault(); if (cam.follow?.kind === 'heli') g.heliShoot('dart'); else g.takePhoto(); }
      // the helicopter's muster herds dinosaurs away from it
      if (k === 'm' && cam.follow?.kind === 'heli') { g.musterOn = !g.musterOn; G.ui?.scopeMsg(g.musterOn ? 'Muster ON: fly behind the animals to drive them' : 'Muster off'); }
      return;
    }
    if (k === ' ') { e.preventDefault(); G.ui?.setSpeed(g.speed === 0 ? (this.prevSpeed || 1) : 0); if (g.speed === 0) {} else this.prevSpeed = g.speed; return; }
    if (k === '1' || k === '2' || k === '3') { G.ui?.setSpeed(Number(k)); return; }
    if (k === 'r' && this.tool.type === 'building') { this.tool.rot = (this.tool.rot + 1) % 4; this.tool.manualRot = true; this.lastRot = this.tool.rot; if (this.ghost) { this.preview.remove(this.ghost); this.ghost = null; } this.updateHover(); return; }
    if (k === 'delete' || k === 'x') { this.setTool({ type: 'bulldoze' }); return; }
    if (k === 'tab') { e.preventDefault(); document.getElementById('mm-tab')?.click(); return; }
    if (k === 'g') { g.view.grid.visible = !g.view.grid.visible; return; }
    if (k === 'c' && g.selected?.ref) { const r = g.selected.ref; cam.tx = r.x ?? r.cx; cam.tz = r.z ?? r.cz; return; }
    if (k === 'h' || k === '?') { G.ui?.openHelp(); return; }
  }

  // ---------- brushes ----------
  brush(p) {
    const map = G.game.map;
    const r = this.tool.size ?? 1;
    const cx = Math.floor(p.x), cy = Math.floor(p.z);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r + 0.5) continue;
      const x = cx + dx, y = cy + dy;
      if (map.inb(x, y)) this.drag.brush.add(map.idx(x, y));
    }
  }

  // ---------- preview ----------
  // Buildings light up under the mouse, as in the original.
  hoverBuilding(ev) {
    const g = G.game;
    if (!g || this.engine.cam.mode === 'ride' || this.mouse.inUI || !this.mouse.seen) { this.setHoverBuilding(null); return; }
    this.engine.ray(ev.clientX, ev.clientY);
    const hits = this.engine._rc.intersectObjects([...g.view.bmeshes.values()], true);
    let b = null;
    for (const h of hits) { let o = h.object; while (o && !o.userData.building) o = o.parent; if (o) { b = o.userData.building; break; } }
    this.setHoverBuilding(b);
    if (b && this.tool.type === 'select') {
      const def = BLD[b.type];
      const extra = def.fn === 'entrance' ? (g.park.parkOpen ? 'Open' : 'Closed') + ` · entry $${g.park.fee}` : b.broken ? 'Wrecked' : b.shut ? 'Shut: badly damaged' : b.hp < 60 ? `Damaged (${Math.round(b.hp)}%)` : '';
      G.ui?.cursorTip(`<b>${def.name}</b>${extra ? `<br><small>${extra}</small>` : ''}`, ev.clientX, ev.clientY);
    }
  }
  setHoverBuilding(b) {
    if (this.hoverB === b) return;
    if (this.hoverB?.mesh) this.hoverB.mesh.traverse((o) => { if (o.isMesh && o.userData.baseMat) { o.material = o.userData.baseMat; delete o.userData.baseMat; } });
    this.hoverB = b;
    this.canvas.style.cursor = b && this.tool.type === 'select' ? 'pointer' : '';
    if (!b?.mesh) return;
    const del = this.tool.type === 'bulldoze';
    const cache = (this._hiMats = this._hiMats || new Map());
    b.mesh.traverse((o) => {
      if (!o.isMesh || o.userData.baseMat) return;
      const key = o.material.uuid + (del ? 'd' : '');
      let m = cache.get(key);
      if (!m) {
        m = o.material.clone();
        m.emissive = new THREE.Color(del ? 0x902010 : 0x6a6a30);
        m.emissiveIntensity = del ? 0.9 : 0.55;
        cache.set(key, m);
      }
      o.userData.baseMat = o.material;
      o.material = m;
    });
  }
  updateHover(e) {
    if (!G.game) return;
    const ev = e || { clientX: this.mouse.x, clientY: this.mouse.y };
    const t = this.tool.type;
    this.clearPreview();
    if (t === 'select' || t === 'bulldoze') this.hoverBuilding(ev); else this.setHoverBuilding(null);
    if (t === 'select' || this.engine.cam.mode === 'ride') { if (this.ghost) this.ghost.visible = false; return; }
    const p = this.ground(ev);
    if (!p) return;
    const g = G.game, map = g.map;
    const tx = Math.floor(p.x), ty = Math.floor(p.z);
    if (t === 'building') {
      if (!this.tool.manualRot && BLD[this.tool.id].path) {
        // face the nearest footpath automatically
        for (let k = 0; k < 4; k++) {
          const r = (this.tool.rot + k) % 4;
          const cc = g.canPlace(this.tool.id, tx, ty, r, true);
          if (cc.ok && map.path[cc.access] === 1) { this.tool.rot = r; break; }
        }
      }
      const c = g.canPlace(this.tool.id, tx, ty, this.tool.rot);
      this.showGhost(this.tool.id, c);
      const fp = c.fp;
      const list = [];
      for (let y = fp.y; y < fp.y + fp.h; y++) for (let x = fp.x; x < fp.x + fp.w; x++) list.push([x, y, c.ok ? OK : BAD]);
      if (c.access >= 0) list.push([c.access % map.W, Math.floor(c.access / map.W), map.path[c.access] === 1 ? INFO : DEL]);
      if (this.tool.id === 'hatchery') { const bt = g.backTile(fp, this.tool.rot); if (bt >= 0) list.push([bt % map.W, Math.floor(bt / map.W), GATE]); }
      this.setTiles(list);
      const def = BLD[this.tool.id];
      const extraTip = this.tool.id === 'hatchery' ? '<br><small>Amber tile: release gate. Point it into an enclosure.</small>' : def.path ? '<br><small>Blue tile: entrance (needs a footpath)</small>' : '';
      G.ui?.cursorTip(`${def.name} — ${this.tool.door != null ? 'place the dome' : this.tool.station != null ? `pole ${G.game.balloonPoles(G.game.buildings.get(this.tool.station) || {}).length + 1}, ${fmtMoney(def.cost)}` : fmtMoney(def.cost)}${c.ok ? (c.warn ? `<br><span class=warn>${c.warn}</span>` : '') : `<br><span class=bad>${c.reason}</span>`}${extraTip}<br><small>R to rotate · right-click to cancel</small>`, ev.clientX, ev.clientY);
      return;
    }
    if (this.ghost) this.ghost.visible = false;
    if (t === 'fence') {
      const vx = Math.round(p.x), vz = Math.round(p.z);
      this.setLines([[vx, vz, vx + 0.001, vz, OK]], 0.6);
      this.setTiles([]);
      const f = FENCES[this.tool.fence];
      const hit = g.fenceEdgeAt(p.x, p.z);
      if (hit && map.fenceType(hit.h, hit.i) < this.tool.fence) {
        const to = map.fenceType(hit.h, hit.i) + 1, run = g.fenceRun(hit.h, hit.i), { cost } = g.fenceCost(run, to);
        G.ui?.cursorTip(`Upgrade this fence line to ${FENCES[to].name}<br><b>${fmtMoney(cost)}</b> for ${run.length} panels <small>(click)</small>`, ev.clientX, ev.clientY);
      } else G.ui?.cursorTip(`${f.name} — ${fmtMoney(f.cost)} per panel<br><small>Drag to build${this.tool.mode === 'rect' ? ' an enclosure' : ' a line'}. Click a weaker fence to upgrade it.</small>`, ev.clientX, ev.clientY);
    } else if (t === 'release' || t === 'acuMove') {
      const ok = map.inb(tx, ty) && map.dinoPassable(map.idx(tx, ty));
      this.setTiles([[tx, ty, ok ? OK : BAD]]);
      if (t === 'release') {
        const r = ok ? map.regions[map.region[map.idx(tx, ty)]] : null;
        G.ui?.cursorTip(r && r.public ? '<span class=bad>Warning: this area is open to the public!</span>' : 'Click to release here', ev.clientX, ev.clientY);
      } else G.ui?.cursorTip('Click the drop-off point', ev.clientX, ev.clientY);
    } else {
      const r = ['flora', 'water', 'land', 'raise', 'lower'].includes(t) ? this.tool.size ?? 1 : 0;
      const list = [];
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + 0.5 && map.inb(tx + dx, ty + dy)) list.push([tx + dx, ty + dy, t === 'bulldoze' ? DEL : OK]);
      this.setTiles(list);
      const tips = { path: `Footpath — ${fmtMoney(PATH_COST)}/tile · ${G.game.pathTiles()} of ${PATH_MAX} pieces`, track: `Safari Track — ${fmtMoney(TRACK_COST)}/tile · ${G.game.trackTiles() * 4} of ${TRACK_MAX * 4} m<br><small>Can pass through fences (gates are added)</small>`, bulldoze: 'Bulldoze — drag to clear an area', water: `Dig a lake — ${fmtMoney(WATER_COST)}/tile`, land: `Fill water — ${fmtMoney(WATER_COST)}/tile`, raise: `Raise hill — ${fmtMoney(HILL_COST)}/tile<br><small>Drag repeatedly to build it higher. Hills block dinosaurs.</small>`, lower: `Lower hill — ${fmtMoney(HILL_COST)}/tile`, flora: this.tool.flora ? `${FLORA[this.tool.flora].name} — ${fmtMoney(FLORA[this.tool.flora].cost)}` : 'Mixed forest' };
      G.ui?.cursorTip(tips[t] || '', ev.clientX, ev.clientY);
    }
  }

  // The original sells fences in sections of three panels; hold Alt for single panels.
  fenceEnds(d) {
    const ax = Math.round(d.sx), az = Math.round(d.sz);
    let bx = Math.round(d.ex), bz = Math.round(d.ez);
    if (!this.engine.keys.has('alt')) {
      const dx = bx - ax, dz = bz - az;
      let nx = Math.round(Math.abs(dx) / 3), nz = Math.round(Math.abs(dz) / 3);
      if (!nx && !nz && (dx || dz)) { if (Math.abs(dx) >= Math.abs(dz)) nx = 1; else nz = 1; }
      bx = ax + Math.sign(dx) * nx * 3; bz = az + Math.sign(dz) * nz * 3;
    }
    return [ax, az, bx, bz];
  }

  updatePreview() {
    const g = G.game, map = g.map, d = this.drag, t = this.tool.type;
    if (!d) return;
    if (t === 'fence') {
      const [ax, az, bx, bz] = this.fenceEnds(d);
      const edges = this.tool.mode === 'rect' && !this.engine.keys.has('shift') ? g.fenceEdgesRect(ax, az, bx, bz) : g.fenceEdgesLine(ax, az, bx, bz);
      const { cost, n } = g.fenceCost(edges, this.tool.fence);
      const can = g.park.canAfford(cost);
      this.setPosts(edges.map((e) => ({ e, ok: g.fenceEdgeValid(e) && can })));
      const lenX = Math.abs(bx - ax), lenZ = Math.abs(bz - az);
      G.ui?.cursorTip(`${Math.ceil(n / 3)} sections (${n} panels) — <b>${fmtMoney(cost)}</b>${this.tool.mode === 'rect' ? `<br>${lenX} × ${lenZ} tiles (${lenX * lenZ} area)` : ''}${can ? '' : '<br><span class=bad>Not enough money</span>'}<br><small>Alt: single panels</small>`, this.mouse.x, this.mouse.y);
    } else if (t === 'path' || t === 'track') {
      const tiles = g.pathTilesL(Math.floor(d.sx), Math.floor(d.sz), Math.floor(d.ex), Math.floor(d.ez));
      const kind = t === 'path' ? 1 : 2;
      let n = 0;
      const list = tiles.map(([x, y]) => { const ok = g.canPathTile(map.idx(x, y), kind) || map.path[map.idx(x, y)] === kind; if (g.canPathTile(map.idx(x, y), kind)) n++; return [x, y, ok ? OK : BAD]; });
      this.setTiles(list);
      const cost = n * (kind === 1 ? PATH_COST : TRACK_COST);
      G.ui?.cursorTip(`${n} tiles — <b>${fmtMoney(cost)}</b>`, this.mouse.x, this.mouse.y);
    } else if (t === 'bulldoze') {
      const x0 = Math.floor(Math.min(d.sx, d.ex)), x1 = Math.floor(Math.max(d.sx, d.ex)), y0 = Math.floor(Math.min(d.sz, d.ez)), y1 = Math.floor(Math.max(d.sz, d.ez));
      const list = [];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (map.inb(x, y)) list.push([x, y, DEL]);
      this.setTiles(list);
    } else {
      const list = [...d.brush].map((i) => [i % map.W, Math.floor(i / map.W), OK]);
      this.setTiles(list);
      if (t === 'water' || t === 'land') G.ui?.cursorTip(`${list.length} tiles — <b>${fmtMoney(list.length * WATER_COST)}</b>`, this.mouse.x, this.mouse.y);
      if (t === 'raise' || t === 'lower') G.ui?.cursorTip(`${list.length} tiles — <b>${fmtMoney(list.length * HILL_COST)}</b>`, this.mouse.x, this.mouse.y);
    }
  }

  commitDrag() {
    const g = G.game, map = g.map, d = this.drag, t = this.tool.type;
    if (t === 'fence') {
      const [ax, az, bx, bz] = this.fenceEnds(d);
      // a click on an existing, weaker fence upgrades the whole connected fence line
      const hit = Math.hypot(d.ex - d.sx, d.ez - d.sz) < 0.3 ? g.fenceEdgeAt(d.sx, d.sz) : null;
      // as in the original, an upgrade goes one step at a time (Low → Medium → High)
      if (hit && map.fenceType(hit.h, hit.i) < this.tool.fence) { const to = map.fenceType(hit.h, hit.i) + 1; if (g.upgradeFenceRun(hit.h, hit.i, to)) { G.ui?.refreshTop(); G.ui?.toast({ text: `Fence upgraded to ${FENCES[to].name}.`, kind: 'good', noMail: true }); } return; }
      const edges = this.tool.mode === 'rect' && !this.engine.keys.has('shift') ? g.fenceEdgesRect(ax, az, bx, bz) : g.fenceEdgesLine(ax, az, bx, bz);
      if (g.placeFences(edges, this.tool.fence)) G.ui?.refreshTop();
    } else if (t === 'path' || t === 'track') {
      const tiles = g.pathTilesL(Math.floor(d.sx), Math.floor(d.sz), Math.floor(d.ex), Math.floor(d.ez));
      g.placePaths(tiles, t === 'path' ? 1 : 2);
    } else if (t === 'bulldoze') {
      const x0 = Math.floor(Math.min(d.sx, d.ex)), x1 = Math.floor(Math.max(d.sx, d.ex)), y0 = Math.floor(Math.min(d.sz, d.ez)), y1 = Math.floor(Math.max(d.sz, d.ez));
      this.bulldoze(x0, y0, x1, y1);
    } else if (t === 'flora') {
      let n = 0, cost = 0;
      for (const i of d.brush) {
        if (map.flora[i] || !(map.isLand(i) || map.terrain[i] === T.SAND) || map.bld[i] >= 0 || map.path[i]) continue;
        const group = typeof this.tool.flora === 'string' || this.tool.flora == null;
        if (group && !chance(0.6)) continue;
        // brushes as in the original: paleo trees (tree ferns, cycads, ferns) or modern trees (palms, jungle trees)
        const f = !group ? this.tool.flora : this.tool.flora === 'modern' ? pick([1, 1, 3, 3, 3]) : this.tool.flora === 'paleo' ? pick([2, 4, 4, 5, 5]) : pick([1, 2, 3, 3, 4, 4, 5]);
        if (!g.park.canAfford(cost + FLORA[f].cost)) break;
        cost += FLORA[f].cost;
        g.setFlora(i, f);
        n++;
      }
      if (n) { g.park.spend(cost, 'Construction'); G.audio?.play('path'); }
    } else if (t === 'water' || t === 'land') {
      if (g.paintTerrain([...d.brush], t === 'water' ? T.WATER : T.GRASS)) G.audio?.play('build');
    } else if (t === 'raise' || t === 'lower') {
      if (g.sculpt([...d.brush], t)) G.audio?.play('build');
    }
    G.ui?.refreshTop();
  }

  bulldoze(x0, y0, x1, y1) {
    const g = G.game, map = g.map;
    const single = x0 === x1 && y0 === y1;
    let did = false;
    const blds = new Set();
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!map.inb(x, y)) continue;
      const i = map.idx(x, y);
      if (map.bld[i] >= 0) blds.add(map.bld[i]);
    }
    for (const id of blds) { const b = g.buildings.get(id); if (b && !BLD[b.type].fixed) { g.demolish(b); did = true; } }
    if (single && did) return;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!map.inb(x, y)) continue;
      const i = map.idx(x, y);
      if (map.path[i]) { if (g.removePath(i)) did = true; if (single) return; }
      if (map.flora[i]) { g.setFlora(i, 0); did = true; if (single) return; }
    }
    // fences
    for (let y = y0; y <= y1 + 1; y++) for (let x = x0; x <= x1; x++) if (x >= 0 && x < map.W && y >= 0 && y <= map.H) { const e = { h: true, i: map.hIdx(x, y) }; if (map.fenceType(e.h, e.i)) { g.removeFence(e); did = true; } }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1 + 1; x++) if (x >= 0 && x <= map.W && y >= 0 && y < map.H) { const e = { h: false, i: map.vIdx(x, y) }; if (map.fenceType(e.h, e.i)) { g.removeFence(e); did = true; } }
    if (did) G.audio?.play('demolish');
  }

  setTiles(list) {
    const m = this.tiles, mm = new THREE.Matrix4();
    const map = G.game.map;
    let n = 0;
    for (const [x, y, col] of list) {
      if (n >= 3000) break;
      mm.makeTranslation(x + 0.5, Math.max(map.heightAt(x + 0.5, y + 0.5), -0.15) + 0.08, y + 0.5);
      m.setMatrixAt(n, mm); m.setColorAt(n, col); n++;
    }
    m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
  setLines(segs, h = 0.5) {
    const g = this.lines.geometry, p = g.attributes.position.array, c = g.attributes.color.array;
    let n = 0;
    for (const [ax, az, bx, bz, col] of segs) {
      if (n >= 4000) break;
      p.set([ax, 0.05, az, ax, h + 0.6, az], n * 6);
      c.set([col.r, col.g, col.b, col.r, col.g, col.b], n * 6);
      n++;
    }
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
    g.setDrawRange(0, n * 2);
  }
  setPosts(list) {
    const m = this.posts, map = G.game.map;
    const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), qv = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    let n = 0;
    for (const { e, ok } of list) {
      if (n >= 4000) break;
      const c = map.edgeCenter(e.h, e.i);
      const x = e.h ? c.x - 0.5 : c.x, z = e.h ? c.z : c.z - 0.5;
      p.set(x, Math.max(0, map.heightAt(c.x, c.z)), z);
      mm.compose(p, e.h ? q : qv, s);
      m.setMatrixAt(n, mm); m.setColorAt(n, ok ? OK : BAD); n++;
    }
    m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  showGhost(id, c) {
    if (!this.ghost || this.ghost.userData.id !== id) {
      if (this.ghost) this.preview.remove(this.ghost);
      const def = BLD[id];
      const extra = id === 'statue' ? { statue: statueGeometry(SPECIES_BY_ID.tyrannosaurus) } : null;
      const ms = def.model || def.size;
      const geo = buildingGeometry(id, ms[0], ms[1], extra);
      const gr = new THREE.Group();
      gr.add(new THREE.Mesh(geo.body, MAT.ghostOk));
      if (geo.glow) gr.add(new THREE.Mesh(geo.glow, MAT.ghostOk));
      // fit the model to the footprint, as the placed building is (see World.addBuilding)
      const sx = def.size[0] / ms[0], sz = def.size[1] / ms[1];
      for (const m of gr.children) { if (id === 'entrance') m.position.z = (def.size[1] - ms[1]) / 2; else m.scale.set(sx, Math.min(sx, sz), sz); }
      gr.userData.id = id;
      this.ghost = gr;
      this.preview.add(gr);
    }
    const gr = this.ghost;
    gr.visible = true;
    const fp = c.fp;
    gr.position.set(fp.x + fp.w / 2, Math.max(0, G.game.map.heightAt(fp.x + fp.w / 2, fp.y + fp.h / 2)), fp.y + fp.h / 2);
    gr.rotation.y = this.tool.rot * Math.PI / 2;
    for (const m of gr.children) m.material = c.ok ? MAT.ghostOk : MAT.ghostBad;
  }
}
