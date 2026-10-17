// DOM user interface: HUD, menus, inspector, modals, main menu.
import { G, saveSettings } from './state.js';
import { CHARGEABLE, MENUS, BIAS, SITEB_BUILDINGS, FEED, feederFood, buildingPrice as buildingPriceOf, VTYPES, ADVISORS, PARTY, SPECIES, SPECIES_BY_ID, BUILDINGS, BLD, FENCES, FLORA, RESEARCH, RESEARCH_BY_ID, SITES, SITE_BY_ID, QUALITY, CONTINENTS, MISSIONS, EXERCISES, CAREER, DISEASES, MAX_TEAMS, DAY_SECONDS, SIZE_RANK } from './data.js';
import { INCOME_CATS, EXPENSE_CATS, loadProgress, saveProgress } from './park.js';
import { fmtMoney, fmtInt, clamp } from './util.js';
import { Thumbs } from './thumbs.js';
import { HudMethods, advisorFor } from './hud.js';
import { ICON, FOSSIL_ICONS, AMBER_ICON, GEM_ICON } from './icons.js';
import { listSaves, saveGame, loadSave, deleteSave, exportSave, importSaveFile, latestSave, canExport } from './save.js';
import { T, ISLAND_FORM_NAMES } from './map.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const starHTML = (v) => { let s = ''; for (let i = 1; i <= 5; i++) s += v >= i ? '★' : v >= i - 0.5 ? '<span style="opacity:.6">★</span>' : '<span class="off">★</span>'; return s; };
const barCol = (v) => (v > 60 ? 'var(--leaf)' : v > 30 ? 'var(--warn)' : 'var(--danger)');
const bar = (label, v, col) => `<div class="bar"><span>${label}</span><div class="track"><div class="fill" style="width:${clamp(v, 0, 100)}%;background:${col || barCol(v)}"></div></div><span class="v">${Math.round(v)}</span></div>`;
const days = (d) => (d < 1 ? `${Math.max(1, Math.round(d * 24))} h` : `${d.toFixed(1)} d`);
// game days to months (2 days a month): "1 month", "1.5 months", "3 weeks"
const months = (d) => { const m = d / 2; return m < 0.75 ? `${Math.max(1, Math.round(m * 4))} week${Math.round(m * 4) > 1 ? "s" : ""}` : `${Math.round(m * 2) / 2} month${m > 1.25 ? "s" : ""}`; };
const fenceFor = (str) => FENCES.find((f) => f && f.armor >= str) || FENCES[FENCES.length - 1];
const WEATHER = { clear: 'Sunny', cloudy: 'Cloudy', rain: 'Rain', storm: 'Thunderstorm', twister: 'Twister', heat: 'Heatwave' };

const CATS = [
  { id: 'select', label: 'Select', tool: { type: 'select' } },
  { id: 'fences', label: 'Fences' },
  { id: 'paths', label: 'Paths' },
  { id: 'amenity', label: 'Amenities' },
  { id: 'attraction', label: 'Attractions' },
  { id: 'science', label: 'Science' },
  { id: 'staff', label: 'Staff' },
  { id: 'feeder', label: 'Feeders' },
  { id: 'nature', label: 'Nature' },
  { id: 'sep' },
  { id: 'hatchery', label: 'Hatchery', modal: 'hatchery' },
  { id: 'expeditions', label: 'Fossils', modal: 'expeditions' },
  { id: 'research', label: 'Research', modal: 'research' },
  { id: 'park', label: 'Park', modal: 'park' },
  { id: 'sep' },
  { id: 'bulldoze', label: 'Bulldoze', tool: { type: 'bulldoze' } },
];

// Expected lifespan at a genome level, in the original's months/years (1 month = 2 game days).
function lifespanText(sp, dna, boosted) {
  if (dna < 50) return 'Not viable';
  const gt = Math.min(1, (dna - 50) / 50), frac = dna >= 100 ? 1 : gt * gt * 0.5;
  const months = Math.round(((12 + (sp.life - 12) * frac) * (boosted ? 1.2 : 1)) / 2);
  return months >= 24 ? `${Math.round(months / 12)} years` : `${months} months`;
}

// Closed Catmull-Rom spline through map points, for smooth coastlines.
function smoothPath(pts) {
  const n = pts.length, P = (i) => pts[(i + n) % n];
  let d = `M${P(0)[0].toFixed(1)} ${P(0)[1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d + 'Z';
}

export class UI {
  constructor() {
    this.root = document.getElementById('ui');
    this.thumbs = new Thumbs();
    this.cat = null;
    this.modal = null;
    this.t = 0;
    this.infoT = 0;
    this.mmT = 0;
    this.mmVer = '';
    this.toasts = [];
    this.root.innerHTML = this.skeleton();
    this.$ = (id) => document.getElementById(id);
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('input', (e) => this.onInput(e));
    this.root.addEventListener('change', (e) => this.onInput(e));
    this.root.addEventListener('mouseover', (e) => { const el = e.target.closest('[data-tip]'); if (el) this.hoverTip(el.dataset.tip, e); });
    window.addEventListener('pointerdown', () => { this.pointerHeld = true; }, true);
    window.addEventListener('pointerup', () => { this.pointerHeld = false; }, true);
    this.root.addEventListener('mousemove', (e) => { const el = e.target.closest('[data-tip]'); if (el) this.hoverTip(el.dataset.tip, e); else if (this.tipFromUI) this.cursorTip(null); });
    this.root.addEventListener('mouseout', (e) => { if (e.target.closest('[data-tip]')) this.cursorTip(null); });
    this.bindMinimap();
    this.renderToolbar();
    this.cheat = '';
    window.addEventListener('keydown', (e) => {
      if (!this.$('menu').hidden && e.key.length === 1) {
        this.cheat = (this.cheat + e.key.toLowerCase()).slice(-7);
        if (this.cheat === 'genesis') { const p = loadProgress(); p.siteB = true; saveProgress(p); this.showMenu(); this.toast({ text: 'Site B unlocked.', kind: 'good' }); }
      }
    });
  }

  skeleton() {
    return `
<div id="hud" hidden>
${this.hudSkeleton()}
  <div id="objectives" hidden></div>
  <div id="info" hidden></div>
  <div id="toasts"></div>
  <div id="minimap-wrap" class="glass"><canvas id="minimap" width="192" height="192"></canvas><div id="minimap-legend"><span>Click to travel</span><span id="mm-n"></span></div></div>
  <div id="ride" hidden>
    <div class="frame"></div><div class="flash" id="r-flash"></div>
    <div class="rec" id="r-rec">● REC</div>
    <div class="bar"><span id="r-help"></span><span class="mono" id="r-score"></span><button class="btn small primary" data-act="photo">Photo (Space)</button><button class="btn small" data-act="exitRide">Exit (Esc)</button></div>
    <div class="last" id="r-last" hidden></div>
    <div class="r-goals glass" id="r-goals" hidden></div>
  </div>
</div>
<div id="tip" hidden></div>
<div id="modal-wrap" hidden></div>
<div id="menu" hidden></div>`;
  }

  // =================== events ===================
  onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el) {
      if (e.target.id === 'modal-wrap' && !this.modalLocked) this.closeModal();
      return;
    }
    G.audio?.init();
    const a = el.dataset.act, d = el.dataset;
    const g = G.game;
    G.audio?.play('click');
    switch (a) {
      case 'speed': this.setSpeed(Number(d.n)); break;
      case 'hud': this.hudAction(d.do); return;
      case 'fan': this.fanAction(d.do); return;
      case 'wheel': this.wheelAction(d.do); return;
      case 'hud2':
        if (d.do === 'info') { this.infoOpen = !this.infoOpen; this.refreshInfo(true); this.refreshSelPanel(); }
        else if (d.do === 'toggleOpen') { g.park.setOpen(!g.park.parkOpen); this.refreshTop(); this.refreshSelPanel(); }
        else if (d.do === 'emergency') { g.setEmergency(!g.park.emergency); this.refreshTop(); }
        else if (d.do.startsWith('fee:')) { g.park.setFee(g.park.fee + Number(d.do.slice(4))); this.refreshTop(); this.refreshSelPanel(); }
        else if (d.do.startsWith('mail:')) { const m = (g.mail || [])[Number(d.do.slice(5))]; if (m) { this.focus(m.focus); this.$('mailbox').hidden = true; } }
        break;
      case 'cat': this.openCat(d.id); break;
      case 'buildHatchery': this.closeModal(); this.openWheel('science'); this.wheelAction('item:b:hatchery'); break;
      case 'tool': this.pickTool(d); break;
      case 'fenceMode': this.fenceMode = d.m; if (G.tools.tool.type === 'fence') G.tools.setTool({ ...G.tools.tool, mode: d.m }); this.renderSubmenu(); break;
      case 'brush': this.brushSize = Number(d.n); if (G.tools.tool.size != null) G.tools.tool.size = this.brushSize; this.renderSubmenu(); break;
      case 'modal': this.openModal(d.k, d.tab); break;
      case 'tab': this.modal.tab = d.tab; g?.flag?.('tab:' + d.tab); this.renderModal(); break;
      case 'closeModal': this.closeModal(); break;
      case 'closeInfo': g?.select(null); break;
      case 'incubate': if (g.park.incubate(d.sp)) this.renderModal(); break;
      case 'incubateN': { let k = 0, h = null; for (let i = 0; i < Number(d.n); i++) { const c = g.park.incubateCheck(d.sp, i > 0); if (!c.ok) break; h = h && h.slots.length < BLD.hatchery.slots ? h : c.hatchery; if (g.park.incubate(d.sp, h, i > 0)) k++; else break; } if (k) this.renderModal(); break; }
      case 'hatchCat': { const C = ['SH', 'LH', 'SC', 'LC']; this.hatchCat = C[(C.indexOf(this.hatchCat) + Number(d.d) + 4) % 4]; this.hatchSp = null; this.hatchN = 1; this.renderModal(); break; }
      case 'hatchSp': { this.hatchSp = this.nextHatchSp(Number(d.d)); this.hatchN = 1; this.renderModal(); break; }
      case 'kioskMain': case 'kioskSide': case 'kioskCharge': case 'kioskBias': {
        const b = g.buildings.get(this.kioskB), menu = b && MENUS[b.type], def = b && BLD[b.type];
        if (!b || !CHARGEABLE(b.type)) break;
        const m = (b.menu = b.menu || { main: 0, side: 0, charge: def.price });
        const dd = Number(d.d);
        if (a === 'kioskBias') { const ks = Object.keys(VTYPES); m.bias = ks[(ks.indexOf(m.bias || 'neutral') + dd + ks.length) % ks.length]; this.renderModal(); break; }
        if (!menu && a !== 'kioskCharge') break;
        if (a === 'kioskMain') m.main = (m.main + dd + menu.main.length) % menu.main.length;
        else if (a === 'kioskSide') m.side = (m.side + dd + menu.side.length) % menu.side.length;
        else m.charge = clamp(m.charge + dd * ((def.max || 50) > 50 ? 5 : 1), 0, def.max || 50);
        this.renderModal(); break;
      }
      case 'kiosk': this.kioskB = Number(d.b); this.openModal('kiosk'); break;
      case 'hatchN': this.hatchN = clamp((this.hatchN || 1) + Number(d.d), 1, 5); this.renderModal(); break;
      case 'release': { const b = g.buildings.get(Number(d.b)); const slot = b?.slots[Number(d.i)]; if (slot) { this.closeModal(); G.tools.setTool({ type: 'release', b, slot }); this.toast({ text: `Click a spot inside an enclosure to release the ${SPECIES_BY_ID[slot.sp].name}.`, kind: 'info' }); } break; }
      case 'dig': if (g.park.startDig(d.site, Number(d.spot || 0))) this.renderModal(); break;
      case 'pedia': this.pediaSel = d.key; this.renderModal(); break;
      case 'sitebPick': { const sel = (this.sitebSel ||= new Set()); if (sel.has(d.site)) sel.delete(d.site); else if (sel.size < 5) sel.add(d.site); this.renderModal(); break; }
      case 'sitebGo': {
        const p = G.game.park, ids = new Set(SITES.filter((st) => this.sitebSel.has(st.id)).flatMap((st) => st.species));
        for (const sp of SPECIES) p.dna[sp.id] = ids.has(sp.id) ? 100 : 0;
        p.claimed = [...this.sitebSel];
        this.sitebSel = null; this.closeModal(); break;
      }
      case 'claimSite': if (g.park.claimSite(d.site)) this.renderModal(); break;
      case 'recallDig': if (g.park.recallDig(d.site, Number(d.spot || 0))) this.renderModal(); break;
      case 'sequence': if (g.park.queueSequence(Number(d.id))) this.renderModal(); break;
      case 'sellItem': if (g.park.sellItem(Number(d.id))) this.renderModal(); break;
      case 'buyOffer': if (g.park.buyOffer(Number(d.i))) this.renderModal(); break;
      case 'selSite': this.siteSel = d.site; this.renderModal(); break;
      case 'marketSel': this.marketSel = d.key; this.renderModal(); break;
      case 'marketMode': this.marketMode = d.m; this.marketSel = null; this.renderModal(); break;
      case 'hireTeam': if (g.park.buyTeam()) this.renderModal(); break;
      case 'research': if (g.park.startResearch(d.id)) this.renderModal(); break;
      case 'selBld': { const b = g.buildings.get(Number(d.id)); if (b) { this.closeModal(); g.select({ kind: 'building', ref: b }); G.engine.lookAt(b.cx, b.cz); } break; }
      case 'selDino': { const dn = g.dinos.find((x) => x.id === Number(d.id)); if (dn) { this.closeModal(); g.select({ kind: 'dino', ref: dn }); G.engine.lookAt(dn.x, dn.z); } break; }
      case 'dino': this.dinoAction(d.do); break;
      case 'bld': this.bldAction(d.do, d); break;
      case 'vehicle': this.vehicleAction(d.do); break;
      case 'photo': g?.takePhoto(); break;
      case 'exitRide': g?.exitControl(); break;
      case 'confirm': this.confirmAction(el, d); break;
      case 'menu': this.menuAction(d.do, d); break;
      case 'objToggle': this.$('objectives').classList.toggle('collapsed'); break;
      case 'save': if (saveGame(d.slot, g.park.name)) { this.toast({ text: `Saved to slot ${d.slot}.`, kind: 'good' }); this.renderModal(); } break;
      case 'load': this.loadSlot(d.slot); break;
      case 'export': exportSave(); break;
      case 'import': this.$('importFile')?.click(); break;
      case 'acuAuto': g.acuAuto = !g.acuAuto; this.refreshInfo(true); break;
      case 'opt': break;
    }
  }

  onInput(e) {
    const t = e.target, g = G.game;
    if (t.id === 'fee' && g) { g.park.setFee(Number(t.value)); const o = this.$('feeOut'); if (o) o.textContent = `$${t.value}`; this.refreshTop(); const lb = t.closest('.gatepanel')?.querySelector('label b'); if (lb) lb.textContent = `$${g.park.fee}`; }
    if (t.id === 'parkName' && g && e.type === 'change') { g.park.name = t.value.slice(0, 40) || 'Isla Genesis'; this.refreshTop(); }
    if (t.id === 'dinoName' && e.type === 'change' && g?.selected?.kind === 'dino') { g.selected.ref.name = t.value.slice(0, 20) || g.selected.ref.name; }
    if (t.dataset.opt) {
      const k = t.dataset.opt;
      const v = t.type === 'checkbox' ? t.checked : Number(t.value);
      G.settings[k] = v; saveSettings();
      if (k === 'volume' || k === 'music') G.audio?.setVolume(G.settings.volume, G.settings.music);
      if (k === 'shadows') G.engine.setShadows(v);
    }
    if (t.id === 'importFile' && t.files?.[0]) {
      importSaveFile(t.files[0]).then((d) => { G.main.startFromSave(d); this.closeModal(); }).catch(() => this.toast({ text: 'That file is not a valid Isla Genesis save.', kind: 'danger' }));
    }
  }

  confirmAction(el, d) {
    if (el.dataset.armed !== '1') {
      el.dataset.armed = '1'; el.dataset.orig = el.textContent; el.textContent = 'Click again to confirm';
      setTimeout(() => { if (el.isConnected) { el.dataset.armed = '0'; el.textContent = el.dataset.orig; } }, 3000);
      return;
    }
    const g = G.game;
    switch (d.do) {
      case 'demolish': { const b = g.selected?.ref; if (b) g.demolish(b); break; }
      case 'retire': g.acuTask('retire', g.selected.ref); break;
      case 'sell': g.acuTask('sell', g.selected.ref); break;
      case 'deleteSave': deleteSave(d.slot); this.renderModal(); if (!this.$('menu').hidden) this.showMenu('load'); break;
      case 'quit': this.closeModal(); G.main.toMenu(); break;
      case 'restart': this.closeModal(); G.main.restart(); break;
    }
  }

  setSpeed(n) {
    if (!G.game) return;
    G.game.speed = n;
    for (const b of this.$('t-speed').children) b.classList.toggle('on', Number(b.dataset.n) === n);
  }

  // =================== toolbar & submenus ===================
  renderToolbar() {
    const siteb = G.game?.mode === 'siteb';
    const hide = siteb ? new Set(['fences', 'paths', 'amenity', 'attraction', 'staff', 'research', 'expeditions']) : new Set();
    const icon = (c) => {
      const T2 = this.thumbs;
      const map = { fences: () => T2.fence(2), paths: () => T2.path(1), amenity: () => T2.building('restaurant'), attraction: () => T2.building('dome'), science: () => T2.building('hatchery'), staff: () => T2.building('ranger'), feeder: () => T2.building('feeder_herb'), nature: () => T2.flora(3), hatchery: () => T2.species('triceratops'), expeditions: () => T2.flora(6), research: () => T2.building('research'), park: () => T2.building('entrance') };
      if (map[c.id]) return `<img alt="" src="${map[c.id]()}">`;
      return `<div class="ico">${c.id === 'select' ? '⌖' : c.id === 'bulldoze' ? '✕' : '?'}</div>`;
    };
    this.$('toolbar').innerHTML = CATS.filter((c) => !hide.has(c.id)).map((c) => c.id === 'sep' ? '<div class="tb-sep"></div>' :
      `<button class="tb-btn" data-act="cat" data-id="${c.id}" id="tb-${c.id}" data-tip="${c.label}">${icon(c)}<span>${c.label}</span></button>`).join('');
    this.markToolbar();
  }
  markToolbar() {
    const t = G.tools?.tool?.type || 'select';
    for (const c of CATS) {
      const el = this.$('tb-' + c.id);
      if (!el) continue;
      el.classList.toggle('on', this.cat === c.id || (!this.cat && ((c.id === 'select' && t === 'select') || (c.id === 'bulldoze' && t === 'bulldoze'))));
    }
  }
  openCat(id) {
    const c = CATS.find((x) => x.id === id);
    if (c.modal) { this.openModal(c.modal); return; }
    if (c.tool) { this.cat = null; this.$('submenu').hidden = true; G.tools.setTool(c.tool); this.markToolbar(); return; }
    this.cat = this.cat === id ? null : id;
    this.renderSubmenu();
    this.markToolbar();
  }
  collapseSubmenu() { if (this.cat) { this.cat = null; this.$('submenu').hidden = true; this.markToolbar(); this.markToolbarTool(); } }
  markToolbarTool() {
    const t = G.tools?.tool;
    if (!t) return;
    const map = { fence: 'fences', path: 'paths', track: 'paths', flora: 'nature', water: 'nature', land: 'nature' };
    let id = map[t.type];
    if (t.type === 'building') id = BLD[t.id].cat === 'deco' ? 'nature' : BLD[t.id].cat;
    if (id) this.$('tb-' + id)?.classList.add('on');
  }
  refreshBuildMenu() { if (this.cat) this.renderSubmenu(); }
  renderSubmenu() {
    const sm = this.$('submenu');
    if (!this.cat || !G.game) { sm.hidden = true; return; }
    sm.hidden = false;
    const g = G.game, park = g.park, tool = G.tools.tool;
    const T2 = this.thumbs;
    const item = (o) => `<button class="item ${o.on ? 'on' : ''} ${o.locked ? 'locked' : ''}" data-act="tool" ${Object.entries(o.data).map(([k, v]) => `data-${k}="${v}"`).join(' ')} data-tip="${esc(o.tip)}"><img alt="" src="${o.img}"><span class="nm">${o.name}</span><span class="cost">${o.cost}</span></button>`;
    let title = '', extra = '', items = '';
    const cat = this.cat;
    if (cat === 'fences') {
      title = 'Fences';
      const mode = this.fenceMode || 'rect';
      extra = `<div class="seg"><button data-act="fenceMode" data-m="rect" class="${mode === 'rect' ? 'on' : ''}">Enclosure</button><button data-act="fenceMode" data-m="line" class="${mode === 'line' ? 'on' : ''}">Line</button></div>`;
      items = FENCES.filter(Boolean).map((f) => {
        const locked = f.research && !park.has(f.research);
        return item({ name: f.name, cost: locked ? 'Research' : `${fmtMoney(f.cost)}/seg`, img: T2.fence(f.id), locked, on: tool.type === 'fence' && tool.fence === f.id, data: { type: 'fence', fence: f.id }, tip: `${f.desc}<br><small>Strength ${f.armor} · Drag on the ground to build</small>` });
      }).join('');
    } else if (cat === 'paths') {
      title = 'Paths';
      items = item({ name: 'Footpath', cost: '$60/tile', img: T2.path(1), on: tool.type === 'path', data: { type: 'path' }, tip: 'Visitors walk on footpaths. Connect every building entrance to the park gate.' }) +
        item({ name: 'Safari Track', cost: park.has('safari') ? '$150/tile' : 'Research', locked: !park.has('safari'), img: T2.path(2), on: tool.type === 'track', data: { type: 'track' }, tip: 'Jeep track for the Safari Adventure. It can pass through fences; gates are added automatically.' });
    } else if (cat === 'nature') {
      title = 'Nature & Decoration';
      const bs = this.brushSize ?? 1;
      extra = `<span>Brush</span><div class="seg">${[0, 1, 2, 3].map((n) => `<button data-act="brush" data-n="${n}" class="${bs === n ? 'on' : ''}">${n * 2 + 1}</button>`).join('')}</div>`;
      items = item({ name: 'Mixed Forest', cost: '~$250/tree', img: T2.flora(3), on: tool.type === 'flora' && !tool.flora, data: { type: 'flora', flora: '' }, tip: 'Paint a random mix of trees and plants. Herbivores graze on ferns and cycads.' }) +
        FLORA.filter(Boolean).map((f) => item({ name: f.name, cost: fmtMoney(f.cost), img: T2.flora(f.id), on: tool.type === 'flora' && tool.flora === f.id, data: { type: 'flora', flora: f.id }, tip: f.graze ? `${f.name}. Herbivores graze on it.` : f.forest ? `${f.name}. Counts toward forest cover.` : 'Decorative rock.' })).join('') +
        item({ name: 'Dig Lake', cost: '$120/tile', img: T2.terrain('water'), on: tool.type === 'water', data: { type: 'water' }, tip: 'Dinosaurs need water to drink inside their enclosure.' }) +
        item({ name: 'Fill Water', cost: '$120/tile', img: T2.terrain('land'), on: tool.type === 'land', data: { type: 'land' }, tip: 'Turn water back into grassland.' }) +
        BUILDINGS.filter((b) => b.cat === 'deco').map((b) => this.bldItem(b, item)).join('');
    } else {
      title = { amenity: 'Amenities', attraction: 'Attractions', science: 'Science', staff: 'Staff & Safety', feeder: 'Feeders' }[cat];
      items = BUILDINGS.filter((b) => b.cat === cat).map((b) => this.bldItem(b, item)).join('');
    }
    sm.innerHTML = `<h3>${title}<div class="row">${extra}</div></h3><div class="items">${items}</div>`;
  }
  bldItem(b, item) {
    const g = G.game, park = g.park;
    const locked = (b.research && !park.has(b.research)) || (g.mode === 'siteb' && !SITEB_BUILDINGS.includes(b.id));
    const tool = G.tools.tool;
    return item({ name: b.name, cost: locked ? (b.research ? 'Research' : 'Locked') : fmtMoney(b.cost), img: this.thumbs.building(b.id), locked, on: tool.type === 'building' && tool.id === b.id,
      data: { type: 'building', id: b.id }, tip: `${b.desc || ''}<br><small>${b.size[0]}×${b.size[1]} tiles · Upkeep ${fmtMoney(b.upkeep)}/day${b.research && !park.has(b.research) ? ` · Requires research: ${RESEARCH_BY_ID[b.research].name}` : ''}</small>` });
  }
  pickTool(d) {
    const g = G.game;
    let t;
    if (d.type === 'fence') {
      const f = FENCES[Number(d.fence)];
      if (f.research && !g.park.has(f.research)) { this.toast({ text: `Research ${RESEARCH_BY_ID[f.research].name} to unlock this fence.`, kind: 'warn' }); return; }
      t = { type: 'fence', fence: Number(d.fence), mode: this.fenceMode || 'rect' };
    } else if (d.type === 'building') {
      const b = BLD[d.id];
      if (b.research && !g.park.has(b.research)) { this.toast({ text: `Research ${RESEARCH_BY_ID[b.research].name} to unlock the ${b.name}.`, kind: 'warn' }); return; }
      t = { type: 'building', id: d.id };
    } else if (d.type === 'flora') t = { type: 'flora', flora: d.flora ? Number(d.flora) : null, size: this.brushSize ?? 1 };
    else if (d.type === 'water' || d.type === 'land') t = { type: d.type, size: this.brushSize ?? 1 };
    else if (d.type === 'track' && !g.park.has('safari')) { this.toast({ text: 'Research Safari Adventure to unlock the track.', kind: 'warn' }); return; }
    else t = { type: d.type };
    G.tools.setTool(t);
    this.renderSubmenu();
  }
  onToolChange(tool) {
    this.markToolbar();
    if (!this.cat) this.markToolbarTool();
    if (this.cat && !this.$('submenu').hidden) this.renderSubmenu();
  }

  // =================== top bar ===================
  refreshTop() {
    const g = G.game;
    if (!g) return;
    const p = g.park;
    const m = this.$('t-money');
    m.innerHTML = p.unlimited ? '<span class="lbl">Funds</span> Unlimited' : `<span class="lbl">Funds</span> ${fmtMoney(p.money)}`;
    m.classList.toggle('neg', p.money < 0);
    this.$('t-date').innerHTML = `<span class="lbl">${p.isNight ? 'Night' : 'Day'}</span> ${p.clockText().replace(/^Day /, '')}`;
    const w = p.weather.type;
    this.$('t-weather').innerHTML = `<span class="lbl">Weather</span> ${WEATHER[w]}${p.blackout > 0 ? ' <span class="blackout">POWER OUT</span>' : ''}`;
    this.$('t-visitors').innerHTML = g.mode === 'siteb' ? '<span class="lbl">Site B</span> No visitors' : `<span class="lbl">Guests</span> ${g.visitors.count * PARTY}/${p.visitorCapacity() * PARTY}`;
    this.$('t-dinos').innerHTML = `<span class="lbl">Dinos</span> ${g.dinos.filter((d) => !d.dead).length}`;
    this.$('t-stars').innerHTML = starHTML(p.rating.stars);
    this.$('t-park').textContent = p.name;
  }

  renderObjectives() {
    const g = G.game, el = this.$('objectives');
    const m = g?.mission;
    if (!m || g.mode === 'sandbox' || g.mode === 'siteb' || !this.$('ride').hidden) { el.hidden = true; return; }
    el.hidden = false;
    const st = g.park.missionState;
    const goals = st.goals.length ? st.goals : m.goals.map((goal) => ({ goal, met: false, value: 0 }));
    const fmtV = (x) => {
      const goal = x.goal;
      if (goal.type === 'money') return `${fmtMoney(x.value)} / ${fmtMoney(goal.n)}`;
      if (goal.type === 'avgComfort') return `${Math.round(x.value)}%`;
      if (goal.type === 'maxEscapes') return `${x.value} escapes`;
      if (goal.type === 'containDays') return `${Math.max(0, x.value)} / ${goal.days} d`;
      if (goal.type === 'stars') return `${x.value} / ${goal.n}`;
      if (['flag', 'research', 'bias', 'photoWhen', 'photoTag', 'photoOf', 'rifle', 'cruiserAlive', 'vipAlive', 'fencesAt'].includes(goal.type)) return '';
      if (goal.type === 'tagLeft' || goal.type === 'carnLeft' || goal.type === 'beaconsLeft') return `${x.value} left`;
      if (goal.type === 'withinMonths') return `${x.value} / ${goal.n} mo`;
      if (goal.type === 'rideExp') return `${x.value}% / ${goal.n}%`;
      if (goal.type === 'vip') return '';
      return `${fmtInt(x.value)} / ${fmtInt(goal.n)}`;
    };
    el.innerHTML = `<h4 data-act="objToggle"><span>${esc(m.name)}</span><span style="font-size:12px;color:var(--muted)">${st.done ? 'COMPLETE' : st.failed ? 'FAILED' : 'GOALS'}</span></h4><ul>${goals.map((x) => `<li class="${x.met && !x.goal.fail ? 'done' : ''} ${x.goal.fail && !x.met ? 'fail' : ''}"><span class="chk">${x.goal.fail ? (x.met ? '◆' : '✕') : x.met ? '✓' : '○'}</span><span class="t">${esc(x.goal.text)}</span><span class="p">${fmtV(x)}</span></li>`).join('')}</ul>`;
  }

  // =================== per-frame ===================
  update(dt) {
    const g = G.game;
    if (!g || g.mode === 'demo') return;
    this.t -= dt;
    if (this.t <= 0) { this.t = 0.25; this.refreshTop(); this.updateRide(); }
    this.infoT -= dt;
    if (this.infoT <= 0) { this.infoT = 0.5; this.refreshInfo(); this.refreshSelPanel(); this.renderObjectives(); if (this.modal && this.modal.live) this.renderModal(true); }
    this.mmT -= dt;
    if (this.mmT <= 0) { this.mmT = 0.4; this.drawMinimap(); }
    const now = performance.now();
    for (const t of this.toasts) if (!t.out && now > t.until) { t.out = true; t.el.classList.add('out'); setTimeout(() => t.el.remove(), 400); }
    this.toasts = this.toasts.filter((t) => t.el.isConnected);
  }

  // =================== toasts & tips ===================
  toast(n) {
    // Every message also goes to the mailbox, signed by the advisor responsible.
    const who = n.who || advisorFor(n.text, n.kind);
    if (G.game && G.game.mode !== 'demo' && !n.noMail) this.addMail({ ...n, who });
    const el = document.createElement('div');
    el.className = `toast ${n.kind || 'info'}`;
    const a = ADVISORS[who];
    el.innerHTML = `<b>${a ? esc(a.name) : ''}</b> ${esc(n.text)}`;
    el.addEventListener('click', () => this.focus(n.focus));
    const box = this.$('toasts');
    box.prepend(el);
    const until = performance.now() + (n.kind === 'danger' ? 9000 : 6000);
    this.toasts.push({ el, until });
    while (box.children.length > 5) box.lastChild.remove();
    if (n.kind === 'danger') G.audio?.play('error');
  }
  focus(f) {
    const g = G.game;
    if (!f || !g) return;
    if (f.dino && !f.dino.removed) { g.select({ kind: 'dino', ref: f.dino }); G.engine.lookAt(f.dino.x, f.dino.z); }
    else if (f.building && !f.building.removed) { g.select({ kind: 'building', ref: f.building }); G.engine.lookAt(f.building.cx, f.building.cz); }
    else if (f.x != null) G.engine.lookAt(f.x, f.z);
  }
  cursorTip(html, x, y) {
    const t = this.$('tip');
    this.tipFromUI = false;
    if (!html) { t.hidden = true; return; }
    t.innerHTML = html; t.hidden = false;
    const w = t.offsetWidth, h = t.offsetHeight;
    t.style.left = `${Math.min(x + 16, window.innerWidth - w - 8)}px`;
    t.style.top = `${Math.min(y + 18, window.innerHeight - h - 8)}px`;
  }
  hoverTip(html, e) { this.cursorTip(html, e.clientX, e.clientY); this.tipFromUI = true; }
  flashSaved() { const s = this.$('t-saved'); s.hidden = false; setTimeout(() => (s.hidden = true), 1800); }

  // =================== inspector ===================
  showInfo(sel) {
    this.infoSel = sel;
    this.refreshInfo(true);
  }
  refreshInfo(force) {
    const el = this.$('info');
    const sel = G.game?.selected;
    if (!this.$('ride').hidden) { el.hidden = true; return; }
    if (!sel || sel.ref?.removed || (sel.kind === 'visitor' && sel.ref.gone)) { el.hidden = true; if (sel) G.game.selected = null; return; }
    if (this.infoOpen === false) { el.hidden = true; return; }
    if (!force && el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    if (!force && el.matches(':hover') && el.querySelector('[data-armed="1"]')) return;
    el.hidden = false;
    const html = sel.kind === 'dino' ? this.dinoInfo(sel.ref) : sel.kind === 'building' ? this.bldInfo(sel.ref) : sel.kind === 'visitor' ? this.visitorInfo(sel.ref) : sel.kind === 'vehicle' ? this.vehicleInfo(sel.ref) : this.enclosureInfo(sel.ref);
    el.innerHTML = `<button class="close" data-act="closeInfo" aria-label="Close">✕</button>${html}`;
  }

  dinoInfo(d) {
    const g = G.game, sp = d.sp;
    const fence = fenceFor(sp.str);
    const dis = d.disease ? DISEASES[d.disease] : null;
    const hasAcu = g.helis.length > 0;
    const vaccines = Object.entries(DISEASES).filter(([id, ds]) => g.park.has(ds.vaccine) && d.canCatch?.(id) !== false && !d.immune?.includes(id));
    const canRetire = g.park.has('retire');
    const st = d.dead ? `<span class="pill bad">Dead · ${esc(d.cause)}</span>` : d.escaped ? '<span class="pill bad">Escaped</span>' : d.tranq > 0 ? '<span class="pill warn">Sedated</span>' : d.stress > 65 ? '<span class="pill bad">Stressed</span>' : d.comfort > 65 ? '<span class="pill good">Content</span>' : '<span class="pill warn">Uneasy</span>';
    const p = d.parts;
    const comfortRows = d.dead ? '' : `<div class="section-label">Comfort factors</div>${['food', 'water', 'health', 'social', 'space', 'environment', 'safety', 'hunt'].filter((k) => p[k] != null).map((k) => bar(k[0].toUpperCase() + k.slice(1), p[k])).join('')}`;
    return `<img class="portrait" alt="" src="${this.thumbs.species(sp.id, true)}">
<h2><input id="dinoName" type="text" value="${esc(d.name)}" aria-label="Name" style="width:100%;font-family:var(--f-display);font-size:24px;text-transform:uppercase;background:none;border:0;padding:0;color:var(--bone)"></h2>
<div class="sub">${d.leader ? '👑 Herd leader · ' : ''}${sp.name} · <span class="tag ${sp.diet}">${sp.diet === 'carn' ? 'Carnivore' : 'Herbivore'}</span> · ${st}</div>
<div class="thought">${esc(d.stateText)}${dis ? ` — <b style="color:var(--danger)">${dis.name}</b>${g.park.has(dis.vaccine) ? ' (rangers can treat)' : ' (needs vaccine research)'}` : ''}</div>
${d.dead ? '' : bar('Health', d.health) + bar('Food', d.hunger) + bar('Water', d.thirst) + bar('Comfort', d.comfort) + (sp.diet === 'carn' ? bar('Hunt urge', d.huntUrge) : '') + bar('Stress', d.stress, d.stress > 60 ? 'var(--danger)' : 'var(--info)')}
${d.immune?.length ? `<div style="font-size:12px;color:var(--good)">Immune to: ${d.immune.map((id) => DISEASES[id].name).join(', ')}</div>` : ''}
<dl class="kv"><dt>Age</dt><dd>${d.age.toFixed(1)} / ${d.lifespan.toFixed(0)} days</dd><dt>${sp.diet === 'carn' ? 'Favourite prey' : 'Friend species'}</dt><dd>${sp.diet === 'carn' ? (sp.prey === 'goat' ? 'Small mammals' : SPECIES_BY_ID[sp.prey]?.name || '—') : SPECIES_BY_ID[sp.friend]?.name || '—'}</dd><dt>Genome</dt><dd>${d.genome.toFixed(0)}%</dd><dt>Security</dt><dd>${sp.security} (${fence.name.replace(' Fence', '')})</dd><dt>Herd size</dt><dd>${sp.herd[0]}–${sp.herd[1]}</dd><dt>Prefers forest</dt><dd>${Math.round(sp.forest * 100)}%</dd><dt>Kills</dt><dd>${d.kills}</dd></dl>
${comfortRows}
<div class="actions">
 <button class="btn small" data-act="dino" data-do="follow">Follow</button>
 <button class="btn small" data-act="dino" data-do="cam" ${d.dead ? 'disabled' : ''}>Dino-cam</button>
 <button class="btn small" data-act="dino" data-do="tranq" ${!hasAcu || d.dead ? 'disabled' : ''} data-tip="${hasAcu ? 'The ranger helicopter darts it' : 'Requires a Ranger Station'}">Sedate</button>
 <button class="btn small" data-act="dino" data-do="move" ${!hasAcu || d.dead ? 'disabled' : ''} data-tip="${hasAcu ? 'Airlift it somewhere else' : 'Requires a Ranger Station'}">Move</button>
 <button class="btn small" data-act="dino" data-do="immunize" ${!g.rangers.length || d.dead || !vaccines.length ? 'disabled' : ''} data-tip="${vaccines.length ? 'Rangers give it ' + vaccines.map(([, ds]) => ds.name).join(', ') + ' vaccines' : 'No new vaccines to give. Research vaccines first.'}">Immunize</button>
 <button class="btn small" data-act="dino" data-do="immunizeAll" ${!g.rangers.length || d.dead || !vaccines.length ? 'disabled' : ''} data-tip="Vaccinate every ${sp.name}">Immunize species</button>
 <button class="btn small" data-act="confirm" data-do="sell" ${!hasAcu || d.dead ? 'disabled' : ''} data-tip="Sell for ${fmtMoney(d.sellValue())}">Sell ${fmtMoney(d.sellValue())}</button>
 <button class="btn small danger" data-act="confirm" data-do="retire" ${!hasAcu || d.dead || !canRetire ? 'disabled' : ''} data-tip="${canRetire ? 'Permanently put down this animal' : 'Research Retire first'}">Retire</button>
</div>`;
  }

  dinoAction(k) {
    const g = G.game, d = g.selected?.ref;
    if (!d) return;
    if (k === 'follow') g.followEntity(d);
    if (k === 'cam') g.dinoCam(d);
    if (k === 'tranq') g.acuTask('tranq', d);
    if (k === 'immunize' || k === 'immunizeAll') {
      const ids = Object.keys(DISEASES).filter((id) => g.park.has(DISEASES[id].vaccine));
      const list = k === 'immunize' ? [d] : g.dinos.filter((o) => o.sp === d.sp && !o.dead);
      for (const o of list) o.immunize = ids.filter((id) => o.canCatch(id) || o.disease === id);
      this.toast({ text: `Rangers will vaccinate ${list.length > 1 ? `${list.length} ${d.sp.name}` : d.name}.`, kind: 'info' });
    }
    if (k === 'move') { G.tools.setTool({ type: 'acuMove', dino: d }); this.toast({ text: 'Click where the ACU should drop it.', kind: 'info' }); }
  }

  bldInfo(b) {
    const g = G.game, def = BLD[b.type], park = g.park;
    const map = g.map;
    let status = b.broken ? '<span class="pill bad">Broken – awaiting rangers</span>' : '<span class="pill good">Operating</span>';
    if (!b.broken && def.path && b.access >= 0 && map.path[b.access] !== 1) status = '<span class="pill warn">No path to entrance</span>';
    let body = '';
    if (def.fn === 'shop' || def.fn === 'view' || def.fn === 'safari' || def.fn === 'balloon') body += `<dl class="kv"><dt>Visits</dt><dd>${fmtInt(b.visits || 0)}</dd><dt>Income</dt><dd>${fmtMoney(b.income || 0)}</dd>${def.price ? `<dt>Price</dt><dd>$${def.price}</dd>` : ''}${def.view ? `<dt>View range</dt><dd>${def.view} tiles</dd>` : ''}</dl>`;
    if (def.fn === 'hatchery') {
      body += `<div class="section-label">Incubators (${b.slots.length}/${def.slots})</div>` + (b.slots.length ? b.slots.map((s, i) => `<div class="slot"><img alt="" src="${this.thumbs.species(s.sp)}"><div><b>${SPECIES_BY_ID[s.sp].name}</b> <span class="mono" style="color:var(--muted)">${s.genome.toFixed(0)}%</span>${s.ready ? `<div class="row" style="margin-top:4px"><button class="btn small primary" data-act="release" data-b="${b.id}" data-i="${i}">Release</button></div>` : `<div class="progress" style="margin-top:6px"><div style="width:${(1 - s.left / s.total) * 100}%"></div></div><small style="color:var(--muted)">${days(Math.max(0, s.left))} left</small>`}</div></div>`).join('') : '<p style="color:var(--muted);font-size:12px">Empty. Open the Hatchery to incubate.</p>');
      body += `<p style="font-size:12px;color:var(--muted)">Hatchlings walk out of the back gate if it opens into an enclosure. Otherwise you choose where to release them.</p><button class="btn small primary" data-act="modal" data-k="hatchery">Open Hatchery</button>`;
    }
    if (def.fn === 'feeder') {
      const food = feederFood(b), F = FEED[food], kinds = def.food === 'herb' ? ['bale', 'paleo'] : ['goat', 'cow'];
      body += bar('Stock', (b.stock / def.stock) * 100) + `<div class="seg">${kinds.map((k) => `<button class="btn small ${k === food ? 'primary' : ''}" data-act="bld" data-do="food:${k}">${FEED[k].name} ${fmtMoney(FEED[k].cost)}</button>`).join('')}</div>
<label class="opt"><span>Refill automatically each morning</span><input type="checkbox" data-act="bld" data-do="autofeed" ${b.menu?.auto !== false ? 'checked' : ''}></label>
<p style="font-size:12px;color:var(--muted)">${b.stock}/${def.stock} ${F.name.toLowerCase()}s. ${F.modern ? 'Modern food can give herbivores Gastric Poisoning.' : food === 'paleo' ? 'Prehistoric plants: no risk of poisoning.' : ''}</p><button class="btn small" data-act="bld" data-do="restock" ${b.stock >= def.stock ? 'disabled' : ''}>Drop food now (${fmtMoney((def.stock - b.stock) * F.cost)})</button>`;
    }
    if (def.fn === 'cleaner') body += `<div class="og-pick"><span class="lbl">Cleaners</span><button class="og-arrow" data-act="bld" data-do="hire:-1" aria-label="Fire a cleaner">◀</button><span class="val">${b.hired || 0}</span><button class="og-arrow" data-act="bld" data-do="hire:1" aria-label="Hire a cleaner">▶</button></div><p style="font-size:12px;color:var(--muted)">Each cleaner is paid $150 a month and sweeps litter off nearby paths. A station holds up to 5. ${g.dirtyPaths()} dirty path tiles in the park.</p>`;
    if (def.fn === 'lure') {
      const gas = b.menu?.gas || 'herb', fr = b.menu?.freq || 'auto';
      body += `<div class="seg"><span style="font-size:12px">Gas:</span>${['herb', 'carn'].map((k) => `<button class="btn small ${k === gas ? 'primary' : ''}" data-act="bld" data-do="gas:${k}">${k === 'herb' ? 'Herbivore' : 'Carnivore'}</button>`).join('')}</div>
<div class="seg"><span style="font-size:12px">Emit:</span>${[['never', 'Never'], ['month', 'Monthly'], ['bimonth', 'Bimonthly'], ['auto', 'Automatic']].map(([k, n]) => `<button class="btn small ${k === fr ? 'primary' : ''}" data-act="bld" data-do="freq:${k}">${n}</button>`).join('')}</div>
<div class="actions"><button class="btn small" data-act="bld" data-do="spray" ${b.spray > 0 ? 'disabled' : ''}>${b.spray > 0 ? 'Spraying…' : 'Spray now'}</button></div><p style="font-size:12px;color:var(--muted)">Draws ${gas === 'herb' ? 'herbivores' : 'carnivores'} within ${def.range} tiles. Automatic mode sprays when one of them has escaped.</p>`;
    }
    if (def.fn === 'turret') {
      const tg = b.menu?.target || 'carn';
      body += `<div class="seg"><span style="font-size:12px">Targets:</span>${[['none', 'None'], ['carn', 'Carnivores'], ['herb', 'Herbivores'], ['all', 'All']].map(([k, n]) => `<button class="btn small ${k === tg ? 'primary' : ''}" data-act="bld" data-do="target:${k}">${n}</button>`).join('')}</div><p style="font-size:12px;color:var(--muted)">Fires on escaped or rampaging dinosaurs within ${def.range} tiles. It cannot sedate: it kills.</p><div class="actions"><button class="btn small primary" data-act="bld" data-do="turretControl">Take Control</button></div>`;
    }
    if (def.fn === 'safari') {
      body += `<dl class="kv"><dt>Track length</dt><dd>${b.route ? Math.round(b.routeLen) + ' tiles' : 'not connected'}</dd><dt>Queue</dt><dd>${(b.queue || []).length}</dd></dl>`;
      body += b.jeeps.map((j, i) => `<div style="font-size:12px">Jeep ${i + 1}: ${esc(j.busyText)}</div>`).join('');
      if (!b.route) body += '<p style="font-size:12px;color:var(--warn)">Build Safari Track starting next to the station. Loop it through your enclosures.</p>';
      body += `<div class="actions"><button class="btn small primary" data-act="bld" data-do="control" ${b.route ? '' : 'disabled'}>Take Control</button></div>`;
    }
    if (def.fn === 'balloon') { const np = g.balloonPoles(b).length; body += `<div style="font-size:12px">${esc(b.jeeps[0]?.busyText || '')}</div><div style="font-size:12px;color:var(--muted)">${np ? `Route: ${np} pole${np > 1 ? 's' : ''}` : 'No route poles: the balloon circles the station.'}</div><div class="actions"><button class="btn small primary" data-act="bld" data-do="control">Take Control</button><button class="btn small" data-act="bld" data-do="placePoles">Add route poles</button></div>`; }
    if (b.type === 'camera') body += `<label class="opt"><span>Also warn of rampaging dinosaurs</span><input type="checkbox" data-act="bld" data-do="camRampage" ${b.menu?.rampage ? 'checked' : ''}></label><p style="font-size:12px;color:var(--muted)">Cameras always report breakouts within ${def.view} tiles.</p>`;
    if (def.fn === 'view') body += `<div class="actions"><button class="btn small" data-act="bld" data-do="view">Look inside</button>${b.type === 'dome' && !g.buildings.get(b.link) ? '<button class="btn small primary" data-act="bld" data-do="placePod">Place the dome</button>' : ''}</div>`;
    if (def.fn === 'ranger') { const vac = Object.values(DISEASES).filter((ds) => park.has(ds.vaccine)).map((ds) => ds.name); body += `<div style="font-size:12px">Vaccines: ${vac.length ? esc(vac.join(', ')) : 'none researched yet'}</div>`; }
    if (def.fn === 'ranger') body += `<div style="font-size:12px">Rangers: ${esc(g.rangers.find((r) => r.b === b)?.busyText || '')}</div><div style="font-size:12px">Helicopter: ${esc(g.helis.find((h) => h.b === b)?.busyText || '')}</div><label class="opt"><span>Auto-recapture escapes &amp; remove carcasses</span><input type="checkbox" data-act="acuAuto" ${g.acuAuto ? 'checked' : ''}></label><p style="font-size:12px;color:var(--muted)">Rangers repair fences and buildings and give vaccines within ${def.range} tiles. Select a dinosaur to sedate, move, immunize or retire it.</p>`;
    if (def.fn === 'acu') body += `<div style="font-size:12px">${esc(g.helis.find((h) => h.b === b)?.busyText || '')}</div><label class="opt"><span>Auto-recapture escapes &amp; remove carcasses</span><input type="checkbox" data-act="acuAuto" ${g.acuAuto ? 'checked' : ''}></label><p style="font-size:12px;color:var(--muted)">Select a dinosaur to tranquilize, move, sell or retire it.</p>`;
    if (def.fn === 'research') body += park.research.active.length ? park.research.active.map((a) => `<div style="font-size:12px">${RESEARCH_BY_ID[a.id].name}<div class="progress"><div style="width:${(1 - a.left / a.total) * 100}%"></div></div></div>`).join('') + '<br>' : '<p style="font-size:12px;color:var(--muted)">Idle.</p>';
    if (def.fn === 'research') body += `<button class="btn small primary" data-act="modal" data-k="research">Open Research</button>`;
    if (def.fn === 'entrance') { const c = g.visitors.copter; body += `<div style="font-size:12px">Guests in the park: ${g.visitors.count} · ${!park.parkOpen ? 'Park closed' : c?.state === 'away' ? `next helicopter in about ${Math.max(1, Math.round(c.t))} s` : 'helicopter landing'}</div>`; }
    if (def.fn === 'entrance') body += `<label class="opt"><span>Entry fee</span><span class="row"><input id="fee" type="range" min="0" max="2000" step="10" value="${park.fee}"><b class="mono" id="feeOut">$${park.fee}</b></span></label><p style="font-size:12px;color:var(--muted)">Guests think ${fmtMoney(park.fairFee())} is fair for a ${park.rating.stars}-star park.</p>`;
    if (def.fn === 'weather') body += `<p style="font-size:12px;color:var(--muted)">Next: ${park.weather.next ? WEATHER[park.weather.next.type] : '…'} in about ${days(Math.max(0, park.weather.left))}.</p>`;
    return `<img class="portrait" alt="" src="${this.thumbs.building(b.type)}"><h2>${def.name}</h2><div class="sub">${status}${b.hp < 100 ? ` · Condition ${Math.round(b.hp)}%` : ''}</div>${body}
${def.fixed ? '' : `<div class="actions"><button class="btn small danger" data-act="confirm" data-do="demolish">Demolish (+${fmtMoney(def.cost * 0.4)})</button></div>`}`;
  }
  bldAction(k) {
    const g = G.game, b = g.selected?.ref;
    if (!b) return;
    const def = BLD[b.type];
    const m = (b.menu = b.menu || {});
    const [cmd, arg] = k.split(':');
    if (k === 'restock') { const c = (def.stock - b.stock) * FEED[feederFood(b)].cost; if (g.park.spend(c, 'Feed')) { b.stock = def.stock; this.refreshInfo(true); } else this.toast({ text: 'Not enough money.', kind: 'warn' }); }
    if (cmd === 'food') { if (feederFood(b) !== arg) { m.food = arg; b.stock = 0; } this.refreshInfo(true); }
    if (k === 'autofeed') { m.auto = m.auto === false; this.refreshInfo(true); }
    if (cmd === 'hire') { b.hired = clamp((b.hired || 0) + Number(arg), 0, 5); g.syncCleaners(b); this.refreshInfo(true); }
    if (cmd === 'gas') { m.gas = arg; this.refreshInfo(true); }
    if (cmd === 'freq') { m.freq = arg; this.refreshInfo(true); }
    if (k === 'spray') { g.sprayLure(b); this.refreshInfo(true); }
    if (cmd === 'target') { m.target = arg; this.refreshInfo(true); }
    if (k === 'turretControl') { this.closeModal?.(); g.takeControlTurret(b); return; }
    if (k === 'camRampage') { b.menu = { ...(b.menu || {}), rampage: !b.menu?.rampage }; this.refreshInfo(true); return; }
    if (k === 'placePoles') { G.tools.setTool({ type: 'building', id: 'balloon_pole', station: b.id }); this.toast({ text: 'Place route poles in order. Right-click when done.', kind: 'info', noMail: true }); return; }
    if (k === 'placePod') { G.tools.setTool({ type: 'building', id: 'dome_pod', door: b.id }); this.toast({ text: 'Place the glass dome inside an enclosure.', kind: 'info', noMail: true }); return; }
    if (k === 'control') { const v = b.jeeps.find((j) => j.state === 'wait') || b.jeeps[0]; if (v) g.takeControl(v); }
    if (k === 'view' && b.type === 'vent') g.flag('viewVent');
    if (k === 'view') g.viewFrom(b);
  }
  visitorInfo(v) {
    const vt = VTYPES[v.vtype || 'neutral'];
    return `<h2>${esc(v.name)}</h2><div class="sub">${esc(vt.name)} · ${v.plan === 'flee' ? '<span class="pill bad">Panicking</span>' : v.plan === 'leave' ? '<span class="pill">Leaving</span>' : '<span class="pill good">Exploring</span>'}</div>
<div class="thought">“${esc(v.thought)}”</div>
<div class="section-label">Passport</div><p style="font-size:12px;color:var(--muted);margin:0 0 4px">Likes: ${esc(vt.likes)}</p>${(v.log || []).slice(1, 5).map((t) => `<div style="font-size:12px;color:var(--dim)">“${esc(t)}”</div>`).join('')}${bar('Happiness', v.happy)}${bar('Fun', v.fun)}${bar('Fed', 100 - v.hunger)}${bar('Hydrated', 100 - v.thirst)}${bar('Bladder', 100 - v.bladder)}${bar('Energy', v.energy)}
<dl class="kv"><dt>Cash</dt><dd>$${Math.max(0, Math.round(v.money))}</dd><dt>Species seen</dt><dd>${v.seen.size}</dd><dt>Time in park</dt><dd>${(v.t / DAY_SECONDS * 24).toFixed(1)} h</dd></dl>`;
  }
  vehicleInfo(v) {
    const kind = v.kind;
    const name = { ranger: 'Ranger Jeep', heli: 'ACU Helicopter', jeep: 'Safari Jeep', balloon: 'Tour Balloon' }[kind] || 'Vehicle';
    const canControl = kind === 'jeep' || kind === 'balloon';
    return `<img class="portrait" alt="" src="${this.thumbs.vehicle(kind)}"><h2>${name}</h2><div class="sub">${esc(v.busyText)}</div>
<div class="actions"><button class="btn small" data-act="vehicle" data-do="follow">Follow</button>${canControl ? '<button class="btn small primary" data-act="vehicle" data-do="control">Take Control</button>' : ''}</div>`;
  }
  vehicleAction(k) { const g = G.game, v = g.selected?.ref; if (!v) return; if (k === 'follow') g.followEntity(v); if (k === 'control') g.takeControl(v); }
  enclosureInfo(r) {
    const g = G.game;
    const st = g.regionStats(r.id);
    const rows = Object.entries(st.species).map(([id, n]) => `<div class="row" style="justify-content:space-between;font-size:12.5px"><span>${SPECIES_BY_ID[id].name}</span><span class="mono">${n}</span></div>`).join('') || '<p style="color:var(--muted);font-size:12px">No dinosaurs.</p>';
    const forest = Math.round((r.forest / r.area) * 100);
    const herb = g.regionFeeders(r.id, 'herb').length, carn = g.regionFeeders(r.id, 'carn').length;
    let minArmor = 99;
    for (const e of r.fenceEdges) { const t = g.map.fenceType(e.h, e.i); if (t) minArmor = Math.min(minArmor, FENCES[t].armor); }
    const weakest = FENCES.find((f) => f && f.armor === minArmor);
    return `<h2>Enclosure</h2><div class="sub">${r.area} tiles</div>
<dl class="kv"><dt>Forest cover</dt><dd>${forest}%</dd><dt>Water tiles</dt><dd>${r.water.length}${r.water.length ? '' : ' ⚠'}</dd><dt>Space used</dt><dd>${Math.round((st.space / r.area) * 100)}%</dd><dt>Herbivore feeders</dt><dd>${herb}</dd><dt>Carnivore feeders</dt><dd>${carn}</dd><dt>Weakest fence</dt><dd>${weakest ? weakest.name : '—'}</dd></dl>
<div class="section-label">Residents</div>${rows}
${r.water.length ? '' : '<p style="font-size:12px;color:var(--warn)">No water! Dig a lake inside this enclosure.</p>'}`;
  }

  // =================== modals ===================
  modalOpen() { return !this.$('modal-wrap').hidden; }
  closeTop() {
    if (this.modalOpen() && !this.modalLocked) { this.closeModal(); return true; }
    if (this.wheelOpen) { if (this.wheelCat) { this.wheelCat = null; this.renderWheel(); } else this.closeWheel(); return true; }
    if (!this.$('fan').hidden) { this.$('fan').hidden = true; this.fanKind = null; return true; }
    if (!this.$('mailbox').hidden) { this.$('mailbox').hidden = true; return true; }
    if (!this.$('menu').hidden && this.menuScreen && this.menuScreen !== 'main') { this.showMenu('main'); return true; }
    return false;
  }
  openModal(kind, tab) {
    if (kind === 'gamemenu' && G.game && G.game.speed > 0) { this.menuPausedFrom = G.game.speed; this.setSpeed(0); }
    this.modal = { kind, tab: tab || this.defaultTab(kind), live: ['hatchery', 'expeditions', 'research', 'park', 'genetics', 'market'].includes(kind) };
    if (kind === 'park') G.game?.flag?.('tab:' + this.modal.tab);
    this.closeWheel(); if (this.$('fan')) this.$('fan').hidden = true;
    this.renderModal();
  }
  defaultTab(kind) { return kind === 'park' ? 'overview' : null; }
  closeModal() {
    const was = this.modal?.kind;
    this.$('modal-wrap').hidden = true; this.modal = null; this.modalLocked = false;
    // action missions start in their vehicle once the briefing closes
    if (was === 'briefing' && G.game?._autoControl) G.game.beginControl();
    if (this.pediaFromMenu) { this.pediaFromMenu = false; this.$('menu').hidden = false; }
    if (this.menuPausedFrom && G.game) { this.setSpeed(this.menuPausedFrom); }
    this.menuPausedFrom = 0;
  }
  refreshModal() { if (this.modal) this.renderModal(true); }

  renderModal(live) {
    const w = this.$('modal-wrap');
    if (!this.modal) return;
    if (live && w.contains(document.activeElement) && ['INPUT', 'SELECT'].includes(document.activeElement.tagName)) return;
    if (live && w.querySelector('[data-armed="1"]')) return;
    const scroll = w.querySelector('.modal-body')?.scrollTop || 0;
    const k = this.modal.kind;
    let head = '', body = '', tabs = '', narrow = false;
    const g = G.game;
    // Screens styled after the original's large stone panels: portrait, carved title, money, help bar, Back.
    const OG = { sitebSetup: () => this.sitebSetupModal(), expeditions: () => this.expeditionModal(), market: () => this.marketModal(), hatchery: () => this.hatcheryModal(), kiosk: () => this.kioskModal(), dinopedia: () => this.dinopediaModal(), research: () => this.researchOG() };
    if (OG[k]) {
      const o = OG[k]();
      const a = ADVISORS[o.advisor] || ADVISORS.admin;
      const initials = a.name.split(' ').filter((w) => /^[A-Z]/.test(w) && !/^Dr\.?$/.test(w)).map((w) => w[0]).join('');
      if (live && this.pointerHeld) return;
      const html = `<div class="ogwrap"><div class="ogpanel ${o.cls || ''}" role="dialog" aria-modal="true" aria-label="${esc(o.title)}">
<div class="og-head"><div class="og-portrait" style="--c:${a.col}" title="${esc(a.name)}, ${esc(a.role)}"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="24" r="12"/><path d="M8 64c2-16 12-24 24-24s22 8 24 24z"/></svg><span>${initials}</span></div>
<h2>${esc(o.title)}</h2><div class="og-money">${g.mode === 'demo' || g.mode === 'mission' ? '' : g.park.unlimited ? 'UNLIMITED' : '$' + fmtInt(Math.round(g.park.money))}</div></div>
${o.sub ? `<div class="og-sub">${o.sub}</div>` : ''}<div class="og-body">${o.body}</div></div>
<div class="og-foot"><button class="og-back" data-act="closeModal"><span class="dot"></span>Back</button><div class="og-help">${o.help || ''}</div></div></div>`;
      if (!(live && html === this._ogHTML && !w.hidden)) { w.innerHTML = html; this._ogHTML = html; }
      w.hidden = false;
      return;
    }
    switch (k) {
      case 'genetics': ({ head, body } = this.geneticsModal()); break;
      case 'market': ({ head, body } = this.marketModal()); break;
      case 'research': ({ head, body } = this.researchModal()); break;
      case 'park': ({ head, body, tabs } = this.parkModal()); break;
      case 'album': head = '<h2>Photo Album</h2>'; body = g.photos.length ? `<div class="album">${g.photos.map((p) => `<figure>${p.url ? `<img alt="Photo" src="${p.url}">` : ''}<figcaption><b class="mono">${fmtInt(p.score)} pts</b>${p.action ? ' · <span style="color:var(--amber)">Action shot</span>' : ''}<br>${p.species.map((s) => SPECIES_BY_ID[s].name).join(', ') || 'No dinosaurs in frame'}</figcaption></figure>`).join('')}</div>` : '<p class="prose">No photos yet. Select a Safari Adventure or Balloon Tour and choose <b>Take Control</b>, or use a dinosaur\'s <b>Dino-cam</b>, then press Space to take pictures. Action shots of hunts and fights score the most.</p>'; break;
      case 'gamemenu': narrow = true; head = '<h2>Paused</h2>'; body = this.gameMenu(); break;
      case 'saves': narrow = true; head = '<h2>Save & Load</h2>'; body = this.savesBody(true); break;
      case 'options': narrow = true; head = '<h2>Options</h2>'; body = this.optionsBody(); break;
      case 'help': head = '<h2>How to Play</h2>'; body = this.helpBody(); break;
      case 'briefing': narrow = true; ({ head, body } = this.briefing()); break;
      case 'missionEnd': narrow = true; ({ head, body } = this.missionEndBody()); break;
      case 'shutdown': narrow = true; this.modalLocked = true; head = '<h2>The park has been closed</h2>'; body = `<p class="prose"><b style="color:${ADVISORS.finance?.col || 'var(--amber)'}">${esc(ADVISORS.finance?.name || 'Finance')}:</b> “Two quarters in debt. The board has voted to close ${esc(G.game.park.name)}.”</p><div style="display:grid;gap:8px"><button class="btn primary" data-act="confirm" data-do="restart">Start again</button><button class="btn" data-act="confirm" data-do="quit">Main menu</button></div>`; break;
    }
    w.innerHTML = `<div class="modal ${narrow ? 'narrow' : ''}" role="dialog" aria-modal="true"><div class="modal-head">${head}${this.modalLocked ? '' : '<button class="btn small x" data-act="closeModal">Close</button>'}</div>${tabs}<div class="modal-body">${body}</div></div>`;
    w.hidden = false;
    const mb = w.querySelector('.modal-body');
    if (mb) mb.scrollTop = scroll;
    if (k === 'park' && this.modal.tab === 'finances') this.drawFinanceChart();
  }

  // Price panel for shops, rest rooms and attractions, as in the original: a Kiosk picks a meal, a side order and a
  // price; a Souvenir Stand picks a souvenir and a free gift; viewing buildings pick a theme and an admission price.
  kioskModal() {
    const g = G.game, b = g.buildings.get(this.kioskB);
    if (!b || !CHARGEABLE(b.type)) return { advisor: 'admin', title: 'Kiosk', body: '<p>This building has no prices to set.</p>' };
    const def = BLD[b.type], menu = MENUS[b.type];
    const m = (b.menu = b.menu || { main: 0, side: 0, charge: def.price });
    const n = g.buildingsOf(b.type).indexOf(b) + 1;
    const fair = Math.round(def.price * 1.3 + 0.5);
    const pick = (label, value, act, extra = '') => `<div class="og-pick"><span class="lbl">${label}</span><button class="og-arrow" data-act="${act}" data-d="-1" aria-label="Previous ${label}">◀</button><span class="val">${value}</span><button class="og-arrow" data-act="${act}" data-d="1" aria-label="Next ${label}">▶</button>${extra}</div>`;
    const stats = (cost) => `<div class="og-row og-dim"><span>Guests think $${fair} is fair.${m.charge > fair ? ' <b class="hi">Some will walk away.</b>' : ''}${cost != null ? ` Each sale costs you $${cost}.` : ''}</span><span style="margin-left:auto">Visits: ${b.visits || 0} · Takings: $${fmtInt(Math.round(b.income || 0))}</span></div>`;
    if (!menu) {
      const bias = BIAS[b.type];
      const title = bias ? bias[m.bias || 'neutral'] : def.name;
      const vt = VTYPES[m.bias || 'neutral'];
      return {
        advisor: 'pr', title: `${title} ${n}`, cls: 'kiosk',
        body: `<div class="og-picks">${bias ? pick('Theme', esc(title), 'kioskBias', `<span class="og-each">for ${esc(vt.plural)}</span>`) : ''}${pick(def.fn === 'shop' ? 'Charge' : 'Admission', `$${m.charge}`, 'kioskCharge', '<span class="og-each">per guest</span>')}</div>
<div class="og-food"><figure><span class="pic"><img alt="" src="${this.thumbs.building(b.type)}"></span><figcaption>${esc(title)}</figcaption></figure></div>
${stats()}`,
        help: bias ? 'A theme draws one kind of guest. Thrill themes suit carnivores, play themes suit herbivores, and nature themes suit authentic enclosures.' : 'Set what guests pay to use this building.',
      };
    }
    const main = menu.main[m.main] || menu.main[0], side = menu.side[m.side] || menu.side[0];
    const cost = (main[3] || 0) + (side[3] || 0);
    const sideFor = side[4] ? ` <span class="og-each">for ${esc(VTYPES[side[4]].plural)}</span>` : '';
    return {
      advisor: 'pr', title: `${def.name} ${n}`, cls: 'kiosk',
      body: `<div class="og-picks">${pick(menu.labels[0], main[0], 'kioskMain', `<span class="og-each">costs $${main[3]}</span>`)}${pick(menu.labels[1], side[0], 'kioskSide', sideFor)}${pick('Charge', `$${m.charge}`, 'kioskCharge', `<span class="og-each">profit $${m.charge - cost} each</span>`)}</div>
<div class="og-food"><figure><span>${main[1]}</span><figcaption>${menu.labels[0]}</figcaption></figure><figure><span>${side[1]}</span><figcaption>${menu.labels[1]}</figcaption></figure></div>
${stats(cost)}`,
      help: b.type === 'giftshop' ? 'Better souvenirs and free gifts make guests happier, but cost you more per sale.' : 'Better meals make guests happier but cost more to make. Each side order suits one kind of guest.',
    };
  }

  // Site B, as in the original: choose five dig sites; their species start with complete genomes.
  sitebSetupModal() {
    const sel = (this.sitebSel ||= new Set());
    const rows = SITES.map((st) => `<button class="og-spot ${sel.has(st.id) ? 'on' : ''}" data-act="sitebPick" data-site="${st.id}" style="width:100%;text-align:left;cursor:pointer"><span class="nm">${sel.has(st.id) ? '☑' : '☐'} ${esc(st.name)}</span><span style="color:var(--muted)">${st.species.map((id) => SPECIES_BY_ID[id].name).join(', ')}</span></button>`).join('');
    return { advisor: 'founder', title: 'Site B', body: `<p class="prose">Choose up to five dig sites. Their dinosaurs start with complete genomes, live long lives and roam the island free. No fences, no guests: just hatcheries, feeders and lures.</p>${rows}<div class="og-row"><span class="og-dim">${sel.size} of 5 chosen</span><button class="og-btn" data-act="sitebGo" ${sel.size ? '' : 'disabled'} style="margin-left:auto"><span class="dot"></span>Begin</button></div>`, help: 'Pick the sites whose dinosaurs you want to watch.' };
  }

  // The Dinopedia, as in the original: every species, disease and kind of guest.
  dinopediaModal() {
    const park = G.game.park;
    const sel = this.pediaSel || 'sp:tyrannosaurus';
    const cats = [['SH', 'Small Herbivores'], ['LH', 'Large Herbivores'], ['SC', 'Small Carnivores'], ['LC', 'Large Carnivores']];
    const item = (key, label) => `<button class="og-pedia-item ${key === sel ? 'on' : ''}" data-act="pedia" data-key="${key}">${esc(label)}</button>`;
    const list = cats.map(([c, n]) => `<div class="og-pedia-cat">${n}</div>${SPECIES.filter((sp) => sp.cat === c).sort((a, b) => a.name.localeCompare(b.name)).map((sp) => item('sp:' + sp.id, sp.name)).join('')}`).join('')
      + `<div class="og-pedia-cat">Diseases</div>${Object.entries(DISEASES).map(([id, d]) => item('dis:' + id, d.name)).join('')}`
      + `<div class="og-pedia-cat">Guests</div>${Object.entries(VTYPES).map(([id, t]) => item('vt:' + id, t.plural)).join('')}`;
    const [kind, id] = sel.split(':');
    let detail = '';
    if (kind === 'sp') {
      const sp = SPECIES_BY_ID[id];
      const sites = SITES.filter((st) => st.species.includes(id)).map((st) => st.name).join(', ');
      const rel = sp.diet === 'carn' ? (sp.prey === 'goat' ? 'Small mammals' : SPECIES_BY_ID[sp.prey]?.name || '—') : SPECIES_BY_ID[sp.friend]?.name || '—';
      detail = `<div class="og-pedia-pic"><img alt="" src="${this.thumbs.species(id, true)}"></div><h3>${esc(sp.name)}</h3>
<dl class="og-stats"><dt>Rating</dt><dd class="stars">${'★'.repeat(sp.stars)}</dd><dt>Class</dt><dd>${{ SH: 'Small herbivore', LH: 'Large herbivore', SC: 'Small carnivore', LC: 'Large carnivore' }[sp.cat]}</dd><dt>Period</dt><dd>${esc(sp.period)}</dd><dt>Length</dt><dd>${sp.lengthM} m</dd>
<dt>Dig sites</dt><dd>${esc(sites)}</dd><dt>Security</dt><dd>${sp.security} (${fenceFor(sp.str).name.replace(' Fence', '')})</dd><dt>${sp.diet === 'carn' ? 'Favourite prey' : 'Friend species'}</dt><dd>${esc(rel)}</dd><dt>Herd size</dt><dd>${sp.herd[0]}–${sp.herd[1]}</dd><dt>Likes forest</dt><dd>${Math.round(sp.forest * 100)}%</dd><dt>Your DNA</dt><dd>${Math.floor(park.dna[id] || 0)}%</dd></dl>
<p class="prose">${esc(sp.blurb || '')} ${esc(sp.notes || '')}</p>`;
    } else if (kind === 'dis') {
      const d = DISEASES[id];
      detail = `<h3>${esc(d.name)}</h3><p class="prose">${esc(d.desc)}</p><dl class="og-stats"><dt>Strikes</dt><dd>${d.carnOnly ? 'Carnivores (and Gallimimus)' : d.herbOnly ? 'Herbivores' : 'Any dinosaur'}</dd><dt>Can kill</dt><dd>${d.fatal ? 'Yes' : 'No'}</dd><dt>Spreads</dt><dd>${d.spread ? 'Yes' : 'No'}</dd><dt>Vaccine</dt><dd>${park.has(d.vaccine) ? 'Researched' : 'Not researched'}</dd></dl>
<p class="prose">Research the vaccine once a dinosaur catches the disease. Rangers then cure sick animals, and you can immunize any animal (or a whole species) for life. Hatchery Immunization vaccinates newborns.${id === 'gastric' ? ' Caused by eating modern plants and modern bales: feed paleo bales and plant paleo trees.' : ''}</p>`;
    } else {
      const t = VTYPES[id];
      detail = `<h3>${esc(t.plural)}</h3><p class="prose">${esc(t.likes)}.</p><p class="prose">${{ violent: 'Theme attractions as Thrill Windows, Thrill Platforms or Terror Domes beside carnivore enclosures. Keep carnivores hunting live prey.', nonviolent: 'Theme attractions as Playpens, Playtime Platforms or Dino Play Domes beside herbivores that live in friendly, contented herds.', environmental: 'Theme attractions as Wonder Windows, Scenic Platforms or Nature Domes. Keep animals from one era and dig site together, plant paleo trees, and keep feeders and hatcheries out of sight.', neutral: 'They enjoy any dinosaur, especially famous ones. Leave attractions unthemed to please them.' }[id]}</p>`;
    }
    return { advisor: 'genetics', title: 'Dinopedia', cls: 'wide', body: `<div class="og-pedia"><div class="og-pedia-list">${list}</div><div class="og-pedia-detail">${detail}</div></div>`, help: 'Choose a topic on the left.' };
  }

  // Research in the original's stone panel: one project at a time, grouped by category.
  researchOG() {
    const park = G.game.park;
    const cats = [...new Set(RESEARCH.map((r) => r.cat))];
    const act = park.research.active[0];
    const body = cats.map((c) => `<div class="og-pedia-cat">${c}</div><div class="og-research">${RESEARCH.filter((r) => r.cat === c).map((r) => {
      const done = park.research.done.has(r.id), a = park.research.active.find((x) => x.id === r.id), can = park.canResearch(r.id);
      return `<div class="og-res ${done ? 'done' : a ? 'act' : can.ok ? '' : 'dim'}"><b>${esc(r.name)}</b><small>${esc(r.desc)}</small>
${done ? '<span class="tag">Researched</span>' : a ? `<span class="og-prog"><i style="width:${(1 - a.left / a.total) * 100}%"></i></span><small>${months(Math.max(0, a.left))} left</small>` : `<span class="mono">${fmtMoney(r.cost)} · ${months(r.days)}</span><button class="og-btn small" data-act="research" data-id="${r.id}" ${can.ok ? '' : 'disabled'} data-tip="${esc(can.ok ? 'Start research' : can.why)}">Research</button>`}</div>`;
    }).join('')}</div>`).join('');
    return { advisor: 'genetics', title: 'Research', cls: 'wide', sub: act ? `<span class="og-label">Researching:</span> ${esc(RESEARCH_BY_ID[act.id].name)} · ${months(Math.max(0, act.left))} left` : '<span class="og-label">The lab is ready for a new project.</span>', body, help: 'One project runs at a time. Vaccines can only be researched once a dinosaur has caught the disease.' };
  }

  nextHatchSp(dir) {
    const park = G.game.park;
    const catOf = (sp) => sp.cat;
    const list = SPECIES.filter((sp) => catOf(sp) === this.hatchCat).sort((x, y) => (park.dna[y.id] >= 50) - (park.dna[x.id] >= 50) || x.cost - y.cost);
    const i = Math.max(0, list.findIndex((sp) => sp.id === this.hatchSp));
    return list[(i + dir + list.length) % list.length].id;
  }
  // Hatchery in the original's layout: category, species and number pickers, stats, and a size silhouette.
  hatcheryModal() {
    const g = G.game, park = g.park;
    const hs = g.buildingsOf('hatchery');
    const cats = [['SH', 'Small Herbivore'], ['LH', 'Large Herbivore'], ['SC', 'Small Carnivore'], ['LC', 'Large Carnivore']];
    const catOf = (sp) => sp.cat;
    let ci = cats.findIndex(([k]) => k === this.hatchCat);
    if (ci < 0) { const best = SPECIES.filter((sp) => park.dna[sp.id] >= 50).sort((x, y) => x.cost - y.cost)[0]; ci = Math.max(0, cats.findIndex(([k]) => k === (best ? catOf(best) : 'SH'))); }
    const list = SPECIES.filter((sp) => catOf(sp) === cats[ci][0]).sort((x, y) => (park.dna[y.id] >= 50) - (park.dna[x.id] >= 50) || x.cost - y.cost);
    let si = list.findIndex((sp) => sp.id === this.hatchSp); if (si < 0) si = 0;
    const sp = list[si];
    this.hatchCat = cats[ci][0]; this.hatchSp = sp.id;
    const free = hs.filter((b) => !b.broken).reduce((n, b) => n + BLD.hatchery.slots - b.slots.length, 0);
    const maxN = Math.max(1, Math.min(free, park.unlimited ? 9 : 1 + Math.floor(Math.max(0, park.money - sp.cost) / (sp.cost / 2))));
    const n = clamp(this.hatchN || 1, 1, Math.max(1, Math.min(maxN, 5)));
    const can = park.incubateCheck(sp.id);
    const pop = g.dinos.filter((d) => !d.dead && d.sp === sp).length;
    const dna = park.dna[sp.id];
    const pick = (label, value, act, extra = '') => `<div class="og-pick"><span class="lbl">${label}</span><button class="og-arrow" data-act="${act}" data-d="-1" aria-label="Previous ${label}">◀</button><span class="val">${value}</span><button class="og-arrow" data-act="${act}" data-d="1" aria-label="Next ${label}">▶</button>${extra}</div>`;
    const eggs = Array.from({ length: 5 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
    // silhouette panel: the animal and a 1.8 m person drawn to the same scale
    const lenM = sp.model.bodyL + sp.model.tailL + sp.model.neckL + sp.model.headL;
    const pxm = Math.min(150 / lenM, 26);
    const sil = `<div class="og-sil"><img alt="" src="${this.thumbs.species(sp.id)}" style="width:${(lenM * pxm * 1.25).toFixed(0)}px"><svg class="human" viewBox="0 0 20 60" style="height:${(1.8 * pxm).toFixed(0)}px" aria-hidden="true"><circle cx="10" cy="6" r="5"/><path d="M4 13h12l2 22h-3l-1 25h-4l-1-20-1 20H4L3 35H0z"/></svg></div>`;
    const stats = `<dl class="og-stats"><dt>Cost</dt><dd>$${fmtInt(sp.cost + (n - 1) * Math.round(sp.cost / 2))}${n > 1 ? ` <small>(extra eggs half price)</small>` : ''}</dd><dt>DNA</dt><dd>${Math.floor(dna)}%</dd><dt>Lifespan</dt><dd>${lifespanText(sp, dna, false)}</dd><dt>Population</dt><dd>${pop}</dd><dt>Rating</dt><dd class="stars">${'★'.repeat(sp.stars)}</dd><dt>Security</dt><dd>${sp.security}</dd></dl>`;
    const slots = hs.length ? hs.map((b, k) => `<div class="og-inc"><b>Hatchery ${k + 1}</b>${Array.from({ length: BLD.hatchery.slots }, (_, i) => {
      const sl = b.slots[i];
      if (!sl) return '<div class="slot empty">Empty incubator</div>';
      return `<div class="slot"><img alt="" src="${this.thumbs.species(sl.sp)}"><span>${SPECIES_BY_ID[sl.sp].name}</span>${sl.ready ? `<button class="og-btn small" data-act="release" data-b="${b.id}" data-i="${i}">Release</button>` : `<span class="og-prog"><i style="width:${(1 - sl.left / sl.total) * 100}%"></i></span><small>${days(Math.max(0, sl.left))}</small>`}</div>`;
    }).join('')}</div>`).join('') : '<div class="og-inc"><span>You have no Hatchery yet.</span><button class="og-btn" data-act="buildHatchery"><span class="dot"></span>Build a Hatchery</button></div>';
    return {
      advisor: 'genetics', title: hs.length > 1 ? 'Hatcheries' : 'Hatchery', cls: 'hatch',
      body: `<div class="og-hatch"><div class="og-picks">${pick('Category', cats[ci][1], 'hatchCat')}${pick('Species', sp.name, 'hatchSp')}${pick('Number', `<span class="eggs">${eggs}</span>`, 'hatchN')}</div>
<div class="og-hgrid">${stats}${sil}</div>
<div class="og-actions"><span class="og-dim">${can.ok ? `${free} incubator${free === 1 ? '' : 's'} free` : esc(can.why)}</span><button class="og-btn" data-act="incubateN" data-sp="${sp.id}" data-n="${n}" ${can.ok ? '' : 'disabled'}><span class="dot"></span>Incubate${n > 1 ? ` ${n} eggs` : ''}</button></div>
<div class="og-incs">${slots}</div></div>`,
      help: dna < 50 ? `You need at least 50% of the ${sp.name} genome. Send dig teams on the Fossil Hunt.` : 'Choose a species and up to five eggs. The batch hatches together and the animals leave the gate one at a time.',
    };
  }

  expeditionModal() {
    const g = G.game, park = g.park;
    const W = 1000, H = 470;
    const proj = (lon, lat) => [((lon + 180) / 360) * W, ((80 - lat) / 138) * H];
    const sel = this.siteSel || SITES[0].id;
    // ocean grid, then raised continents with smoothed coasts
    let grid = '';
    for (let lo = -150; lo <= 150; lo += 30) { const [x] = proj(lo, 0); grid += `<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`; }
    for (let la = 60; la >= -60; la -= 30) { const [, y] = proj(0, la); grid += `<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`; }
    const land = CONTINENTS.map((c) => `<path d="${smoothPath(c.map(([lo, la]) => proj(lo, la)))}"/>`).join('');
    // The six North American grounds sit close together, so (as in the original) they are drawn as a grid of pins.
    const US = ['judithB', 'judithA', 'hellA', 'hellB', 'morrisonA', 'morrisonB'];
    const [ux, uy] = proj(-104, 46);
    const pos = (s) => { const k = US.indexOf(s.id); return k >= 0 ? [ux - 26 + (k % 2) * 52, uy - 50 + Math.floor(k / 2) * 50] : proj(s.lon, s.lat); };
    const unlocked = SITES.filter((s) => park.siteUnlocked(s)).length;
    const pins = SITES.map((s) => {
      const [x, y] = pos(s);
      const active = park.expeditions.some((e) => e.site === s.id);
      const locked = !park.siteUnlocked(s);
      return `<g class="pin ${locked ? 'locked' : ''} ${active ? 'active' : ''} ${s.id === sel ? 'sel' : ''}" data-act="selSite" data-site="${s.id}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})" role="button" aria-label="${esc(s.name)}">
<circle r="17" class="rim"/><circle r="12" class="face"/>${active ? '<path class="tick" d="M-6 0l4 5 9-10"/>' : locked ? '<path class="lock" d="M-5 -1h10v8h-10zM-3 -1v-3a3 3 0 0 1 6 0v3"/>' : '<path class="bone" d="M-7 -2a2.5 2.5 0 1 1 3-3l7 7a2.5 2.5 0 1 1 -3 3z"/>'}
${active ? '<circle r="22" class="pulse"><animate attributeName="r" values="17;26;17" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.9;0;0.9" dur="2s" repeatCount="indefinite"/></circle>' : ''}</g>`;
    }).join('');
    const bracket = `<path class="bracket" d="M${ux - 56} ${uy - 66}h-8v24M${ux + 56} ${uy - 66}h8v24M${ux - 56} ${uy + 66}h-8v-24M${ux + 56} ${uy + 66}h8v-24"/>`;
    const s = SITE_BY_ID[sel];
    const AREA = { mountain: 'Mountain', plains: 'Plains', river: 'River' };
    const spots = (s.areas || [['river', 2], ['plains', 3], ['mountain', 4]]).map(([k, cap]) => [AREA[k], cap]);
    const period = [...new Set(s.species.map((id) => (SPECIES_BY_ID[id].period || '').replace(/^(Early|Late|Middle) /, '')))].join(' / ');
    const teamsHere = park.expeditions.filter((e) => e.site === s.id).reduce((a, e) => a + (e.teams || 1), 0);
    const spotHTML = spots.map(([nm, cap], k) => {
      const q = park.spotQuality(s.id, k);
      const exp = park.expeditions.find((e) => e.site === s.id && e.spot === k);
      const can = park.canDig(s.id, k);
      const n = exp?.teams || 0;
      return `<div class="og-spot ${exp ? 'on' : ''}"><span class="nm">${nm}</span><span class="q q${q}">${QUALITY[q]}</span><span class="mono" title="Teams digging here / most teams this area holds">${n}/${cap}⛺</span>${exp ? `<span class="og-prog" title="Next report"><i style="width:${(1 - exp.left / exp.total) * 100}%"></i></span>` : '<span></span>'}<span class="og-row">${exp ? `<button class="og-btn small" data-act="recallDig" data-site="${s.id}" data-spot="${k}" data-tip="Bring one team home">−</button>` : ''}<button class="og-btn small" data-act="dig" data-site="${s.id}" data-spot="${k}" ${can.ok ? '' : 'disabled'} data-tip="${esc(can.ok ? 'Send a team. Teams dig here until recalled.' : can.why)}">${exp ? '+' : 'Dig'}</button></span></div>`;
    }).join('');
    const info = `<div class="og-siteinfo"><h3>${esc(s.name)}</h3>
<dl><dt>Location</dt><dd>${esc(s.country)}</dd><dt>Period</dt><dd>${period}</dd><dt>Teams</dt><dd>${teamsHere}</dd></dl>
${park.siteUnlocked(s) ? '' : (() => { const c = park.canClaim(s); return `<div class="og-row"><button class="og-btn" data-act="claimSite" data-site="${s.id}" ${c.ok ? '' : 'disabled'}>Acquire site</button>${c.ok ? '' : `<span class="og-dim warn">${esc(c.why)}</span>`}</div>`; })()}
<div class="og-species">${s.species.map((id) => { const sp = SPECIES_BY_ID[id]; return `<div><img alt="" src="${this.thumbs.species(id)}"><span>${sp.name}</span><b class="mono">${park.dna[id].toFixed(0)}%</b><i style="width:${park.dna[id]}%"></i></div>`; }).join('')}</div>
${spotHTML}</div>`;
    const map = `<div class="og-map"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="World map of fossil hunting grounds"><defs>
<linearGradient id="ocean" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4e7090"/><stop offset="1" stop-color="#2f4c6a"/></linearGradient>
<filter id="relief" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="4" result="n"/><feDiffuseLighting in="n" surfaceScale="2.2" lighting-color="#f4ffe0" result="l"><feDistantLight azimuth="225" elevation="45"/></feDiffuseLighting><feComposite in="l" in2="SourceGraphic" operator="in" result="t"/><feBlend in="t" in2="SourceGraphic" mode="multiply"/></filter>
<filter id="drop"><feDropShadow dx="3" dy="5" stdDeviation="2.5" flood-color="#0c1a28" flood-opacity="0.75"/></filter></defs>
<rect width="${W}" height="${H}" fill="url(#ocean)"/><g class="grid">${grid}</g><g class="land" filter="url(#drop)"><g filter="url(#relief)">${land}</g></g>${bracket}${pins}</svg>
${info}<div class="og-unlocked">Hunting grounds: <b>${unlocked} / ${park.siteSlots()}</b></div></div>`;
    const log = park.digLog.slice(0, 3).map((l) => `<div><span class="mono">${l.date || 'Day ' + l.day}</span> ${esc(l.text)}</div>`).join('') || '<div>No expeditions yet.</div>';
    const tents = Array.from({ length: park.teams }, (_, i) => `<span class="tent ${i < park.freeTeams() ? '' : 'busy'}" title="${i < park.freeTeams() ? 'Free team' : 'Team digging'}">⛺</span>`).join('');
    return {
      advisor: 'paleo', title: 'Fossil Hunt', cls: 'wide',
      sub: `<span class="og-label">Available teams:</span>${tents}<span class="og-dim">${park.freeTeams()} of ${park.teams} free</span>`,
      body: `${map}<div class="og-row"><div class="og-log">${log}</div><button class="og-btn" data-act="modal" data-k="genetics">Genetics Lab (${park.fossils.length})</button>${park.teams < MAX_TEAMS ? `<button class="og-btn" data-act="hireTeam" ${park.canAfford(park.teamCost()) && (park.everOpened || park.mode === 'sandbox') ? '' : 'disabled'} data-tip="${park.everOpened || park.mode === 'sandbox' ? 'Hire another dig team' : 'Open the park first'}"><span class="dot"></span>Buy Team ${fmtMoney(park.teamCost())}</button>` : ''}</div>`,
      help: !park.claimed.length && park.mode !== 'sandbox' ? 'Choose your first hunting ground: select a starter site and press Acquire. You can hold one more for every star, up to five.' : park.freeTeams() ? 'Select a site, then send teams to its excavation areas. Each area holds two to four teams; every dig takes 240 seconds.' : 'All teams are digging. Recall a team to move it, or buy another team.',
    };
  }

  geneticsModal() {
    const g = G.game, park = g.park;
    const name = (it) => it.kind === 'gem' ? it.gem[0].toUpperCase() + it.gem.slice(1) : it.kind === 'amber' ? 'Amber (unknown species)' : `${SPECIES_BY_ID[it.sp].name} fossil`;
    const rows = park.fossils.map((it) => {
      const q = park.seqQueue.find((x) => x.id === it.id);
      const qi = park.seqQueue.indexOf(q);
      return `<tr><td>${name(it)}</td><td class="mono">${it.kind === 'gem' ? '—' : it.kind === 'amber' ? '?' : '~' + it.dna.toFixed(1) + '%'}</td><td class="mono">${fmtMoney(Math.round(it.value * park.market.mod))}</td>
<td>${q ? (qi < park.sequencers() ? `<div class="progress" style="width:90px"><div style="width:${(1 - q.left / q.total) * 100}%"></div></div>` : '<small>Queued</small>') : it.kind === 'gem' ? '' : `<button class="btn small primary" data-act="sequence" data-id="${it.id}">Sequence</button>`}</td>
<td><button class="btn small" data-act="sellItem" data-id="${it.id}">Sell</button></td></tr>`;
    }).join('');
    const dnaRows = SPECIES.slice().sort((a, b) => park.dna[b.id] - park.dna[a.id]).map((sp) => `<div class="row" style="justify-content:space-between;font-size:13px"><span>${sp.name}</span><span class="mono">${park.dna[sp.id].toFixed(1)}%</span></div><div class="dna"><div class="fill" style="width:${park.dna[sp.id]}%"></div></div>`).join('');
    return {
      head: `<h2>Genetics Lab</h2><span class="sub">${park.sequencers()} sequencer${park.sequencers() > 1 ? 's' : ''} · market prices ×${park.market.mod.toFixed(2)}</span><button class="btn small" data-act="modal" data-k="market">Fossil Market</button><button class="btn small" data-act="modal" data-k="hatchery">Hatchery</button>`,
      body: `<div class="grid2"><div style="min-width:0"><div class="section-label">Finds in storage</div>${rows ? `<div class="table-wrap"><table class="list"><thead><tr><th>Item</th><th>DNA</th><th>Sells for</th><th>Sequencing</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p style="color:var(--dim)">Storage is empty. Send dig teams out on the Fossil Hunt, or buy finds at the Fossil Market.</p>'}
<p style="font-size:13px;color:var(--dim)">Sequencing takes about a minute per item and adds its DNA to the species. Amber can hold any species – you only find out which when it is sequenced. Research the Super Extractor to sequence faster.</p></div>
<div style="min-width:0"><div class="section-label">Genome library</div><div style="display:grid;gap:3px">${dnaRows}</div></div></div>`,
    };
  }

  // Fossil Market in the original's layout: a grid of finds on the left, the selected one on the right.
  marketModal() {
    const g = G.game, park = g.park, m = park.market;
    const mode = this.marketMode || 'buy';
    const items = mode === 'buy' ? m.offers.map((o, i) => ({ ...o, key: 'o' + i, idx: i, price: o.price })) : park.fossils.map((it) => ({ ...it, key: 'f' + it.id, price: Math.round(it.value * m.mod) }));
    let sel = items.find((it) => it.key === this.marketSel) || items[0];
    // quality in stars, 1 to 5, as in the original market
    const qstars = (it) => clamp(Math.ceil(it.dna / (it.kind === 'amber' ? 4 : 3)), 1, 5);
    const quality = (it) => it.kind === 'gem' ? '—' : '★'.repeat(qstars(it)) + '☆'.repeat(5 - qstars(it));
    const icon = (it) => it.kind === 'amber' ? AMBER_ICON : it.kind === 'gem' ? GEM_ICON({ silver: '#d8dce4', gold: '#f0c840', opal: '#a8e0e8' }[it.gem]) : FOSSIL_ICONS[(it.sp.length * 7 + (it.id || it.idx || 0) * 3 + Math.round(it.dna * 10)) % FOSSIL_ICONS.length];
    const tiles = items.map((it) => `<button class="og-tile ${it.kind} ${sel && it.key === sel.key ? 'sel' : ''} ${mode === 'buy' && it.price > park.money ? 'poor' : ''} qs${it.kind === 'gem' ? 0 : qstars(it)}" data-act="marketSel" data-key="${it.key}" aria-label="${esc(it.kind === 'gem' ? it.gem : SPECIES_BY_ID[it.sp].name)}">${icon(it)}</button>`).join('');
    const empty = Math.max(0, 20 - items.length);
    const grid = `<div class="og-tiles">${tiles}${'<span class="og-tile empty"></span>'.repeat(empty)}</div>`;
    let detail = `<div class="og-detail"><p class="og-dim">${mode === 'buy' && !park.marketOpen() ? (park.everOpened ? `The Fossil Market opens to buyers 15 weeks after the park opens: about ${Math.max(1, Math.ceil(((park.openedDay ?? park.day) + 7 - park.day) / 2))} more month(s).` : 'The Fossil Market opens to buyers 15 weeks after the park first opens to the public.') : 'Nothing here.'}</p></div>`;
    if (sel) {
      if (sel.kind === 'gem') {
        detail = `<div class="og-detail"><h3>${sel.gem[0].toUpperCase() + sel.gem.slice(1)}</h3><dl><dt>Sells for</dt><dd>$${fmtInt(sel.price)}</dd></dl><p class="og-dim">A valuable find with no DNA. Sell it to fund the park.</p>
<div class="og-actions"><button class="og-btn" data-act="sellItem" data-id="${sel.id}"><span class="dot"></span>Sell</button></div></div>`;
      } else {
        const sp = SPECIES_BY_ID[sel.sp], amber = sel.kind === 'amber';
        const dna = park.dna[sp.id];
        const q = park.seqQueue.find((x) => x.id === sel.id);
        detail = `<div class="og-detail"><h3>${amber ? 'Amber' : esc(sp.name)}</h3>
<dl><dt>Quality</dt><dd>${quality(sel)}</dd><dt>${mode === 'buy' ? 'Price' : 'Sells for'}</dt><dd>$${fmtInt(sel.price)}</dd></dl>
${amber ? '<p class="og-dim">Amber can hold the DNA of any species. You find out which when it is sequenced.</p>' : `<div class="og-stars">${'★'.repeat(sp.stars)}<span>${'★'.repeat(5 - sp.stars)}</span></div>
<dl class="right"><dt></dt><dd>${(sp.period || '').replace(/^(Early|Late|Middle) /, '')}</dd><dt></dt><dd>${sp.diet === 'carn' ? 'Carnivore' : 'Herbivore'}</dd></dl>
<div class="og-rule"></div><div class="og-cur">Currently…</div>
<dl><dt>DNA</dt><dd>${Math.floor(dna)}%</dd><dt>Lifespan</dt><dd>${lifespanText(sp, dna, false)}</dd><dt>This find</dt><dd>+${sel.dna.toFixed(1)}% DNA</dd></dl>`}
<div class="og-actions">${mode === 'buy'
  ? `<button class="og-btn" data-act="buyOffer" data-i="${sel.idx}" ${park.canAfford(sel.price) ? '' : 'disabled'}><span class="dot"></span>Buy</button>`
  : `${q ? '<span class="og-dim">Sequencing…</span>' : `<button class="og-btn" data-act="sequence" data-id="${sel.id}"><span class="dot"></span>Sequence</button>`}<button class="og-btn" data-act="sellItem" data-id="${sel.id}">Sell</button>`}</div></div>`;
      }
    }
    const trend = m.mod > 1.15 ? 'high' : m.mod < 0.8 ? 'low' : 'average';
    return {
      advisor: 'paleo', title: 'Fossil Market', cls: 'market',
      sub: `<button class="og-tab ${mode === 'buy' ? 'on' : ''}" data-act="marketMode" data-m="buy">Buy (${m.offers.length})</button><button class="og-tab ${mode === 'sell' ? 'on' : ''}" data-act="marketMode" data-m="sell">Your finds (${park.fossils.length})</button><span class="og-dim" style="margin-left:auto">Selling prices are ${trend} (×${m.mod.toFixed(2)})</span><button class="og-btn small" data-act="modal" data-k="genetics">Genetics Lab</button>`,
      body: `<div class="og-split">${grid}${detail}</div>`,
      help: mode === 'buy' ? 'Purchase items to send to your Genetics Lab.' : 'Sequence finds for their DNA, or sell them. Selling many at once lowers the price.',
    };
  }

  researchModal() {
    const g = G.game, park = g.park;
    const cats = [...new Set(RESEARCH.map((r) => r.cat))];
    const slots = park.researchSlots();
    const body = cats.map((c) => `<div class="section-label" style="font-size:12px">${c}</div><div class="cards" style="margin-bottom:10px">${RESEARCH.filter((r) => r.cat === c).map((r) => {
      const done = park.research.done.has(r.id);
      const act = park.research.active.find((a) => a.id === r.id);
      const can = park.canResearch(r.id);
      return `<div class="card ${done ? '' : can.ok || act ? '' : 'dim'}"><h4>${r.name}</h4><div class="meta">${r.desc}</div>
${r.req.length ? `<div class="meta">Requires: ${r.req.map((q) => RESEARCH_BY_ID[q].name).join(', ')}</div>` : ''}${r.needCase && !done && !park.stats.cases?.[r.needCase] ? '<div class="meta">Needs a sick dinosaur to study first.</div>' : ''}
<div class="foot">${done ? '<span class="pill good">Complete</span>' : act ? `<div style="flex:1"><div class="progress"><div style="width:${(1 - act.left / act.total) * 100}%"></div></div><small style="color:var(--muted)">${months(Math.max(0, act.left))} left</small></div>` : `<span class="mono" style="color:var(--amber)">${fmtMoney(r.cost)} · ${months(r.days)}</span><button class="btn small ${can.ok ? 'primary' : ''}" data-act="research" data-id="${r.id}" ${can.ok ? '' : 'disabled'} data-tip="${esc(can.ok ? 'Start research' : can.why)}">Research</button>`}</div></div>`;
    }).join('')}</div>`).join('');
    return { head: `<h2>Research</h2><span class="sub">${park.research.active.length ? `${park.research.active.length} of ${slots} project${slots > 1 ? 's' : ''} running` : 'The lab is ready for a new project'}</span>`, body };
  }

  parkModal() {
    const g = G.game, park = g.park, tab = this.modal.tab;
    const TAB = { overview: 'Performance', visitors: 'Visitors', security: 'Security', dinosaurs: 'Dinosaurs', finances: 'Finance', structures: 'Structures', entertainment: 'Entertainment', messages: 'Messages' };
    const tabs = `<div class="tabs">${Object.entries(TAB).map(([t, l]) => `<button data-act="tab" data-tab="${t}" class="${tab === t ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    let body = '';
    if (tab === 'overview') {
      const r = park.rating;
      body = `<div class="grid2"><div><label class="opt"><span>Park name</span><input id="parkName" type="text" value="${esc(park.name)}" maxlength="40"></label>
<div class="big-stars">${starHTML(r.stars)}</div><p style="color:var(--muted)">Overall rating ${r.value.toFixed(2)} / 5</p>
${bar('Dinosaurs', r.dino * 20)}${bar('Visitors', r.visitor * 20)}${bar('Safety', r.safety)}
<p class="prose" style="font-size:13px;color:var(--muted)">The dinosaur rating counts healthy, contented, contained animals. Rare and large species are worth more, and variety adds a bonus. Visitor rating comes from how happy guests are when they leave. Escapes and injuries lower safety.</p></div>
<div><dl class="kv"><dt>Day</dt><dd>${park.day}</dd><dt>Guests in park</dt><dd>${g.visitors.count * PARTY}</dd><dt>Capacity</dt><dd>${park.visitorCapacity() * PARTY}</dd><dt>Total guests</dt><dd>${fmtInt(park.stats.visitorsTotal * PARTY)}</dd><dt>Dinosaurs hatched</dt><dd>${park.stats.hatched}</dd><dt>Escapes</dt><dd>${park.stats.escapes}</dd><dt>Dinosaur deaths</dt><dd>${park.stats.deaths}</dd><dt>Guest casualties</dt><dd>${park.stats.visitorDeaths}</dd><dt>Photo points</dt><dd>${fmtInt(park.stats.photoPoints)}</dd></dl>
<label class="opt"><span>Entry fee <small style="color:var(--muted)">(fair: ${fmtMoney(park.fairFee())})</small></span><span class="row"><input id="fee" type="range" min="0" max="2000" step="10" value="${park.fee}"><b class="mono" id="feeOut">$${park.fee}</b></span></label></div></div>`;
    } else if (tab === 'finances') {
      const t = park.ledger.today;
      const inc = INCOME_CATS.reduce((a, c) => a + (t[c] || 0), 0), exp = EXPENSE_CATS.reduce((a, c) => a + (t[c] || 0), 0);
      const row = (c) => `<tr><td>${c}</td><td class="mono" style="text-align:right">${fmtMoney(t[c] || 0)}</td></tr>`;
      body = `<div class="grid2"><div><div class="section-label">Last 20 days · <span style="color:var(--leaf)">income</span> vs. <span style="color:var(--danger)">running costs</span> (construction not shown)</div><canvas class="chart" id="finChart" width="640" height="220"></canvas></div>
<div><div class="section-label">Today</div><table class="list"><tbody>${INCOME_CATS.map(row).join('')}<tr><td><b>Income</b></td><td class="mono" style="text-align:right;color:var(--leaf)"><b>${fmtMoney(inc)}</b></td></tr>${EXPENSE_CATS.map(row).join('')}<tr><td><b>Spending</b></td><td class="mono" style="text-align:right;color:var(--danger)"><b>${fmtMoney(exp)}</b></td></tr></tbody></table></div></div>`;
    } else if (tab === 'visitors') {
      const c = g.visitors.complaints;
      const items = [['food', 'Can\'t find food'], ['drinks', 'Can\'t find drinks'], ['restrooms', 'Can\'t find a restroom'], ['rest', 'Nowhere to rest'], ['shops', 'Want a souvenir stand'], ['dinos', 'Not enough dinosaurs'], ['fee', 'Prices too high'], ['danger', 'Felt unsafe'], ['litter', 'Dirty paths']];
      const max = Math.max(5, ...items.map(([k]) => c[k]));
      const sample = g.visitors.list.slice(-8).map((v) => `<div class="thought" style="font-size:12.5px"><b>${esc(v.name)}:</b> “${esc(v.thought)}”</div>`).join('');
      const vd = park.vdist, vt = Object.values(vd).reduce((a, b) => a + b, 0) || 1;
      const now = {}; for (const v of g.visitors.list) if (!v.gone) now[v.vtype || 'neutral'] = (now[v.vtype || 'neutral'] || 0) + 1;
      const mix = Object.entries(VTYPES).map(([k, t]) => {
        const ts = park.stats.typeSat[k] || [], sat = ts.length ? ts.reduce((a, b) => a + b, 0) / ts.length : null;
        return `<div class="vtype"><span class="sw" style="background:#${t.col.toString(16).padStart(6, '0')}"></span><b>${t.name}</b><span class="mono">${Math.round((vd[k] / vt) * 100)}%</span><small>${now[k] || 0} in park${sat != null ? ` · leave ${Math.round(sat)}% happy` : ''}</small><em>${esc(t.likes)}</em></div>`;
      }).join('');
      body = `<div class="grid2"><div>${bar('Happiness', g.visitors.avgHappiness())}<div class="section-label">Guest interests</div>${mix}<p style="font-size:12px;color:var(--dim);margin:4px 0 8px">The mix shifts toward what your park offers. Umbrella colours in the rain show each guest's type.</p><div class="section-label">Complaints</div>${items.map(([k, l]) => `<div class="bar"><span style="font-size:11.5px">${l}</span><div class="track"><div class="fill" style="width:${(c[k] / max) * 100}%;background:var(--danger)"></div></div><span class="v">${Math.round(c[k])}</span></div>`).join('')}</div><div><div class="section-label">Overheard</div>${sample || '<p style="color:var(--muted)">No guests in the park.</p>'}</div></div>`;
    } else if (tab === 'dinosaurs') {
      const rows = g.dinos.slice().sort((a, b) => a.sp.name.localeCompare(b.sp.name)).map((d) => `<tr class="click" data-act="selDino" data-id="${d.id}"><td>${d.leader ? '👑 ' : ''}${esc(d.name)}</td><td>${d.sp.name}</td><td class="mono">${d.dead ? '—' : Math.round(d.health)}</td><td class="mono">${d.dead ? '—' : Math.round(d.comfort)}</td><td class="mono">${d.age.toFixed(1)}d</td><td>${d.dead ? 'Dead' : d.escaped ? '<span style="color:var(--danger)">Escaped</span>' : esc(d.stateText)}</td></tr>`).join('');
      // the original's Dinosaur Summary: every species you hold DNA for, its genome, population and lifespan
      const known = SPECIES.filter((sp) => park.dna[sp.id] > 0 || g.dinos.some((d) => d.sp === sp));
      const summary = known.map((sp) => { const n = g.dinos.filter((d) => d.sp === sp && !d.dead).length; return `<tr><td>${sp.name}</td><td class="mono">${Math.floor(park.dna[sp.id])}%</td><td class="mono">${n}</td><td>${park.dna[sp.id] >= 50 ? lifespanText(sp, park.dna[sp.id], false) : '<span style="color:var(--muted)">needs 50%</span>'}</td><td>${'★'.repeat(sp.stars)}</td></tr>`; }).join('');
      body = `${summary ? `<div class="section-label">Species</div><div class="table-wrap"><table class="list"><thead><tr><th>Species</th><th>Genome</th><th>Population</th><th>Lifespan</th><th>Rating</th></tr></thead><tbody>${summary}</tbody></table></div>` : ''}
<div class="section-label">Animals</div>${rows ? `<div class="table-wrap"><table class="list"><thead><tr><th>Name</th><th>Species</th><th>Health</th><th>Comfort</th><th>Age</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="prose">No dinosaurs yet. Open the Hatchery to incubate your first.</p>'}`;
    } else if (tab === 'security') {
      const st = park.stats, cnt = (t) => g.buildingsOf(t).length;
      const dmg = g.damagedFences.length;
      body = `<div class="grid2"><div>${bar('Security rating', park.rating.safety)}
<dl class="kv"><dt>Breakouts</dt><dd>${st.escapes}</dd><dt>Guest fatalities</dt><dd>${st.visitorDeaths}</dd><dt>Dinosaur deaths</dt><dd>${st.deaths}</dd><dt>Dinosaurs retired</dt><dd>${st.retired}</dd><dt>Loose right now</dt><dd>${g.dinos.filter((d) => d.escaped && !d.dead).length}</dd><dt>Damaged fence panels</dt><dd>${dmg}</dd></dl>
<p class="prose" style="font-size:13px;color:var(--muted)">Breakouts and fatalities lower the rating sharply. Each guest killed outside an emergency costs a $5,000 fine. Declare an emergency (top left) when a twister or a breakout threatens guests.</p></div>
<div><div class="section-label">Security facilities</div><dl class="kv"><dt>Ranger Stations</dt><dd>${cnt('ranger') + cnt('acu')}</dd><dt>Security Cameras</dt><dd>${cnt('camera')}</dd><dt>Avoidance Beacons</dt><dd>${cnt('beacon')}</dd><dt>Sentry Turrets</dt><dd>${cnt('turret')}</dd><dt>Visitor Shelters</dt><dd>${cnt('shelter')} (room for ${cnt('shelter') * 40})</dd><dt>Guests in the park</dt><dd>${g.visitors.count}</dd></dl></div></div>`;
    } else if (tab === 'structures') {
      const rows = [...g.buildings.values()].filter((b) => !BLD[b.type].legacy || BLD[b.type].fn === 'entrance').sort((a, b) => BLD[a.type].name.localeCompare(BLD[b.type].name)).map((b) => {
        const def = BLD[b.type], inside = g.visitors.list.filter((v) => v.inB === b).length;
        return `<tr class="click" data-act="selBld" data-id="${b.id}"><td>${esc(BIAS[b.type]?.[b.menu?.bias || 'neutral'] || def.name)}</td><td class="mono">${b.broken ? '<span style="color:var(--danger)">Wrecked</span>' : Math.round(b.hp) + '%'}</td><td class="mono">${inside}</td><td class="mono">${fmtInt(b.visits || 0)}</td><td class="mono">${fmtMoney(Math.round(b.income || 0))}</td><td class="mono">${fmtMoney(def.upkeep * 2)}</td></tr>`;
      }).join('');
      body = `<div class="table-wrap"><table class="list"><thead><tr><th>Structure</th><th>Condition</th><th>Inside</th><th>Visits</th><th>Takings</th><th>Upkeep / month</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    } else if (tab === 'entertainment') {
      const at = [...g.buildings.values()].filter((b) => ['view', 'safari', 'balloon'].includes(BLD[b.type].fn));
      const pct = (x) => `${Math.round((x || 0) * 100)}%`;
      const rows = at.map((b) => {
        const def = BLD[b.type], bias = b.menu?.bias || 'neutral', e = b.exp || {};
        return `<tr class="click" data-act="selBld" data-id="${b.id}"><td>${esc(BIAS[b.type]?.[bias] || def.name)}</td><td>${esc(VTYPES[bias].plural)}</td><td class="mono">$${buildingPriceOf(b)}</td><td class="mono">${fmtInt(b.visits || 0)}</td><td class="mono">${fmtMoney(Math.round(b.income || 0))}</td><td class="mono">${b.exp ? pct(e.thr) : '—'}</td><td class="mono">${b.exp ? pct(e.fun) : '—'}</td><td class="mono">${b.exp ? pct(e.aut) : '—'}</td></tr>`;
      }).join('');
      body = rows ? `<div class="table-wrap"><table class="list"><thead><tr><th>Attraction</th><th>Theme for</th><th>Price</th><th>Visits</th><th>Takings</th><th>Thrills</th><th>Fun</th><th>Authenticity</th></tr></thead><tbody>${rows}</tbody></table></div><p class="prose" style="font-size:13px;color:var(--muted)">Thrills come from carnivores hunting, feeding and fighting; Fun from content herbivores playing together; Authenticity from enclosures that hold animals of one era and dig site, with their friend species. Match each attraction's theme to what it shows best.</p>` : '<p class="prose">No attractions yet. Build Viewing Platforms and Vents beside your enclosures.</p>';
    } else if (tab === 'messages') {
      body = g.notes.map((n) => `<div style="font-size:12.5px;padding:5px 0;border-bottom:1px solid #1d2a22;border-left:3px solid var(--${n.kind === 'good' ? 'leaf' : n.kind === 'danger' ? 'danger' : n.kind === 'warn' ? 'warn' : 'info'});padding-left:8px"><span class="mono" style="color:var(--muted)">Day ${n.day}</span> ${esc(n.text)}</div>`).join('') || '<p style="color:var(--muted)">No messages.</p>';
    }
    return { head: `<h2>${esc(park.name)}</h2><span class="sub">${starHTML(park.rating.stars)}</span>`, body, tabs };
  }

  drawFinanceChart() {
    const c = this.$('finChart');
    if (!c) return;
    const ctx = c.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    const col = (n) => css.getPropertyValue(n).trim();
    const hist = G.game.park.ledger.history.slice(-20);
    const W = c.width, H = c.height, pad = { l: 56, r: 10, t: 10, b: 26 };
    ctx.clearRect(0, 0, W, H);
    const inc = hist.map((h) => INCOME_CATS.reduce((a, k) => a + (h[k] || 0), 0));
    const exp = hist.map((h) => EXPENSE_CATS.filter((k) => k !== 'Construction').reduce((a, k) => a + (h[k] || 0), 0));
    const max = Math.max(1000, ...inc, ...exp);
    const nice = Math.pow(10, Math.floor(Math.log10(max)));
    const top = Math.ceil(max / nice) * nice;
    ctx.font = '11px IBM Plex Mono, monospace';
    ctx.fillStyle = col('--muted'); ctx.strokeStyle = col('--line');
    for (let i = 0; i <= 4; i++) {
      const v = (top / 4) * i, y = H - pad.b - ((H - pad.t - pad.b) * i) / 4;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.textAlign = 'right'; ctx.fillText(fmtMoney(v), pad.l - 6, y + 4);
    }
    if (!hist.length) { ctx.textAlign = 'center'; ctx.fillText('History appears after your first full day.', W / 2, H / 2); return; }
    const bw = (W - pad.l - pad.r) / 20;
    hist.forEach((h, i) => {
      const x = pad.l + i * bw;
      const hi = ((H - pad.t - pad.b) * inc[i]) / top, he = ((H - pad.t - pad.b) * exp[i]) / top;
      ctx.fillStyle = col('--leaf'); ctx.fillRect(x + 2, H - pad.b - hi, bw / 2 - 3, hi);
      ctx.fillStyle = col('--danger'); ctx.fillRect(x + bw / 2, H - pad.b - he, bw / 2 - 3, he);
      if (i % 2 === 0 || hist.length < 10) { ctx.fillStyle = col('--muted'); ctx.textAlign = 'center'; ctx.fillText(String(h.day), x + bw / 2, H - 8); }
    });
  }

  gameMenu() {
    const g = G.game;
    const restart = g.mode === 'mission' ? '<button class="btn danger" data-act="confirm" data-do="restart">Restart mission</button>' : '';
    return `<div style="display:grid;gap:8px"><button class="btn primary" data-act="closeModal">Resume</button><button class="btn" data-act="modal" data-k="saves">Save / Load</button><button class="btn" data-act="modal" data-k="options">Options</button><button class="btn" data-act="modal" data-k="help">How to play</button>${g.mission ? '<button class="btn" data-act="modal" data-k="briefing">Mission briefing</button>' : ''}${restart}<button class="btn danger" data-act="confirm" data-do="quit">Quit to main menu</button></div>
<p style="color:var(--muted);font-size:12px;margin-top:12px">The game autosaves every morning to your browser. Unsaved progress since then is lost when you quit.</p>`;
  }
  savesBody(inGame) {
    const saves = listSaves();
    const rows = saves.map((s) => {
      const label = s.slot === 'auto' ? 'Autosave' : `Slot ${s.slot}`;
      if (s.empty) return `<div class="site"><div><h4>${label}</h4><div style="color:var(--muted);font-size:12px">Empty</div></div><div>${inGame && s.slot !== 'auto' ? `<button class="btn small primary" data-act="save" data-slot="${s.slot}">Save here</button>` : ''}</div></div>`;
      const m = s.meta || {};
      const when = new Date(s.savedAt).toLocaleString();
      const mode = s.mode === 'mission' ? `Mission: ${MISSIONS.find((x) => x.id === s.missionId)?.name || ''}` : s.mode === 'siteb' ? 'Site B' : s.mode === 'sandbox' ? 'Sandbox' : 'Operation Genesis';
      return `<div class="site"><div><h4>${esc(s.name || label)}</h4><div style="color:var(--muted);font-size:12px">${label} · ${mode} · Day ${m.day} · ${m.stars}★ · ${fmtMoney(m.money || 0)} · ${m.dinos} dinos<br>${when}</div></div>
<div class="row" style="justify-content:flex-end">${inGame && s.slot !== 'auto' ? `<button class="btn small" data-act="save" data-slot="${s.slot}">Overwrite</button>` : ''}<button class="btn small primary" data-act="load" data-slot="${s.slot}">Load</button><button class="btn small danger" data-act="confirm" data-do="deleteSave" data-slot="${s.slot}">Delete</button></div></div>`;
    }).join('');
    return `${rows}<div class="row" style="margin-top:8px">${inGame && canExport() ? '<button class="btn small" data-act="export">Export save file</button>' : ''}<button class="btn small" data-act="import">Import save file</button><input id="importFile" type="file" accept=".json,application/json" hidden></div><p style="color:var(--muted);font-size:12px">Saves live in this browser's local storage.</p>`;
  }
  loadSlot(slot) {
    const d = loadSave(slot);
    if (!d) { this.toast({ text: 'That save could not be read.', kind: 'danger' }); return; }
    this.closeModal();
    G.main.startFromSave(d);
  }
  optionsBody() {
    const s = G.settings;
    return `<label class="opt"><span>Master volume</span><input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-opt="volume" id="o-vol"></label>
<label class="opt"><span>Music</span><input type="range" min="0" max="1" step="0.05" value="${s.music}" data-opt="music" id="o-mus"></label>
<label class="opt"><span>Shadows</span><input type="checkbox" ${s.shadows ? 'checked' : ''} data-opt="shadows" id="o-sh"></label>
<label class="opt"><span>Scroll at screen edges</span><input type="checkbox" ${s.edgeScroll ? 'checked' : ''} data-opt="edgeScroll" id="o-edge"></label>
<label class="opt"><span>Autosave each morning</span><input type="checkbox" ${s.autosave ? 'checked' : ''} data-opt="autosave" id="o-auto"></label>`;
  }
  helpBody() {
    return `<div class="grid2"><div class="prose">
<h3>Getting started</h3><p>Place your <b>Park Entrance</b> first (Build → Amenities, or Actions → Place Park Entrance). Guests fly in to its helipad. Lay a <b>path</b> from its gate. Then fence an <b>enclosure</b> with trees and a lake, build a <b>Hatchery</b> (Build → Enclosures) with its back gate against the fence, and put a <b>Herbivore Feeder</b> inside. Paths are limited to 500 pieces. You start with enough DNA for one small herbivore and one small carnivore, and your first dig team is already at work.</p>
<h3>Guests</h3><p>Guests walk only on paths, and every building's entrance must touch one. They need Kiosks and Rest Rooms, benches or Rest Areas when tired, and clean paths (Trash Cans and a Cleaner Station). There are four kinds: Mainstream, Thrill Seekers (carnivore action), Fun Lovers (happy herbivores at play) and Dino Nerds (authentic enclosures). Theme your viewing buildings for the kind you want to please.</p>
<h3>DNA</h3><p>Open the <b>Fossil Hunt</b> to send dig teams. You own one hunting ground at the start and can acquire one more for each star, up to five. Each ground has three areas holding two to four teams; every dig takes 240 seconds. Extra teams can be hired once the park has opened. Sequence finds in the <b>Genetics Lab</b>; 50% genome lets you create a species. The Fossil Market opens 15 weeks after the park opens.</p>
<h3>Dinosaur comfort</h3><p>Each species wants a herd of the right size, space, the right amount of forest, water and food. Each predator hunts its own prey (see the Dinopedia), and armed herbivores such as Triceratops fight back. Carnivore Feeders release live goats or cattle for the hunt. Sauropods eat only from trees. Paleo trees and paleo bales are safe food; modern plants can cause Gastric Poisoning. Stressed animals rampage or fall into a coma.</p>
<h3>Fences</h3><p>Fences go up in sections of three panels (hold Alt for single panels). Low fences come first; research Medium and then High. Click a fence with a stronger fence tool to upgrade the whole line one step. Only Tyrannosaurus, Spinosaurus and Carcharodontosaurus can break High fences, and Velociraptors climb anything lower. Rangers repair damage.</p>
<h3>Emergencies</h3><p>Build a <b>Ranger Station</b>: its rangers repair fences and give vaccines, and its helicopter sedates and recaptures escaped animals. Research vaccines once a disease appears. Security Cameras warn you of breakouts. <b>Visitor Shelters</b> protect guests; press <b>Emergency</b> (top left, or Actions) to send everyone to them. You can take control of a Sentry Turret.</p>
<h3>Rides and photos</h3><p>Research Balloon Tour, then Safari Adventure. Place the balloon's route poles; lay safari track (up to 800 m) from a station built on a fence. Large carnivores and Triceratops charge Land Cruisers. Select the station and choose <b>Take Control</b> to drive. Press Space to photograph dinosaurs for points and cash.</p>
<h3>Money</h3><p>If the park is still in debt at two quarterly board meetings in a row, the board closes it.</p>
<h3>Weather</h3><p>Watch the forecast (hover over the weather). Twisters are forecast two months ahead; heatwaves make everyone thirsty; Weather Guard research gives guests umbrellas and protects against lightning.</p>
<h3>Site B</h3><p>Finish every mission, or reach 5 stars in Operation Genesis, to unlock Site B: a fence-free island where up to 60 dinosaurs live wild with no visitors.</p>
</div><div><h3 style="font-family:var(--f-display);color:var(--amber);text-transform:uppercase">Controls</h3><div class="keys">
<kbd>W A S D</kbd><span>Move camera (or arrow keys)</span><kbd>Q / E</kbd><span>Rotate camera</span><kbd>R / F</kbd><span>Zoom in / out (or the wheel)</span><kbd>Page Up / Down</kbd><span>Tilt camera</span><kbd>Tab</kbd><span>Island map</span>
<kbd>Right-drag</kbd><span>Rotate and tilt</span><kbd>Left-drag</kbd><span>Pan (select mode)</span><kbd>Right-click</kbd><span>Cancel tool</span>
<kbd>R</kbd><span>Rotate building while placing</span><kbd>Shift+click</kbd><span>Keep placing large buildings</span><kbd>X / Del</kbd><span>Bulldoze</span><kbd>G</kbd><span>Toggle grid</span>
<kbd>Space</kbd><span>Pause · Photo while riding</span><kbd>1 2 3</kbd><span>Game speed</span><kbd>C</kbd><span>Centre on selection</span><kbd>Esc</kbd><span>Close / cancel / exit ride</span><kbd>H</kbd><span>This help</span>
</div></div></div>`;
  }
  openHelp() { this.openModal('help'); }

  briefing() {
    const g = G.game, m = g.mission, adv = ADVISORS[m.advisor || 'founder'];
    const action = g.mode === 'mission';
    const extra = [m.timeLimit ? `Time limit: ${Math.floor(m.timeLimit / 60)}:${String(m.timeLimit % 60).padStart(2, '0')}` : '', m.ammo ? `Ammunition: ${m.ammo} rounds (hover low over the Ranger Station to reload)` : '', m.photos ? `Film: ${m.photos} photos` : '',
      m.control === 'cruiser' ? 'Drive with W A S D. Space or left-click takes a photo; right-click sounds the horn.' : '', m.control === 'heli' ? `Fly with W A S D, Q/E for height. Left-click darts, right-click fires the rifle.${m.muster ? ' Press M to switch the muster on, then fly behind the herd to drive it.' : ''}` : ''].filter(Boolean);
    return { head: `<h2>${action ? `<small style="color:var(--amber);font-size:14px">${esc(m.kind)}</small><br>` : ''}${esc(m.name)}</h2>`, body: `<p class="prose"><b style="color:${adv?.col || 'var(--amber)'}">${esc(adv?.name || '')}:</b> “${esc(m.brief)}”</p><div class="section-label">Objectives</div><ul>${m.goals.map((x) => `<li>${esc(x.text)}${x.fail ? ' <span class="pill warn">or you fail</span>' : ''}${x.optional ? ' <span class="pill">optional</span>' : ''}</li>`).join('')}</ul>${extra.map((t) => `<p style="color:var(--muted);font-size:12px;margin:2px 0">${esc(t)}</p>`).join('')}${action ? '' : `<p style="color:var(--muted);font-size:12px">Starting funds: ${fmtMoney(g.park.money)}</p>`}<button class="btn primary" data-act="closeModal">Begin</button>` };
  }
  missionEnd(win) {
    this.modal = { kind: 'missionEnd', win };
    this.modalLocked = false;
    G.audio?.play(win ? 'fanfare' : 'fail');
    this.renderModal();
  }
  missionEndBody() {
    const g = G.game, win = this.modal.win, m = g.mission;
    const list = g.mode === 'exercise' ? EXERCISES : MISSIONS;
    const idx = list.findIndex((x) => x.id === m.id);
    const next = list[idx + 1];
    const p = loadProgress();
    const adv = ADVISORS[m.advisor || 'founder'];
    const quote = win ? m.win : m.lose;
    return {
      head: `<h2>${g.mode === 'career' ? (win ? 'Operation Genesis complete' : 'The park has failed') : win ? (g.mode === 'exercise' ? 'Exercise complete' : 'Mission complete') : (g.mode === 'exercise' ? 'Exercise failed' : 'Mission failed')}</h2>`,
      body: `${quote ? `<p class="prose"><b style="color:${adv?.col || 'var(--amber)'}">${esc(adv?.name || '')}:</b> “${esc(quote)}”</p>` : ''}<p class="prose">${g.mode === 'career' && win ? `<b>${esc(g.park.name)}</b> is a five-star park. Site B is unlocked; you can keep playing.` : win ? `You completed <b>${esc(m.name)}</b>.` : `<b>${esc(m.name)}</b> has failed.`}${win && p.siteB && g.mode === 'mission' ? ' Site B is unlocked!' : ''}</p>
<div style="display:grid;gap:8px">${win ? '<button class="btn" data-act="closeModal">Keep playing</button>' : '<button class="btn primary" data-act="confirm" data-do="restart">Try again</button>'}
${win && next && (g.mode === 'mission' || g.mode === 'exercise') ? `<button class="btn primary" data-act="menu" data-do="startMission" data-id="${next.id}">Next: ${esc(next.name)}</button>` : ''}
<button class="btn" data-act="confirm" data-do="quit">Main menu</button></div>`,
    };
  }

  // =================== ride HUD ===================
  setRideMode(on, v) {
    this.$('ride').hidden = !on;
    this.closeWheel(); this.$('fan').hidden = true; this.$('mailbox').hidden = true;
    for (const id of ['arc', 'status-tl', 'counters', 'selpanel', 'info', 'minimap-wrap', 'objectives', 'm-mail', 'mm-tab']) { const el = this.$(id); if (on) { el.dataset.wasHidden = el.hidden ? '1' : '0'; el.hidden = true; } else if (el.dataset.wasHidden === '0') el.hidden = false; }
    if (!on) { this.renderObjectives(); this.refreshInfo(true); return; }
    if (this.cat) { this.cat = null; }
    G.tools.setTool({ type: 'select' });
    const kind = v?.kind;
    this.$('ride').classList.toggle('scope', kind === 'heli' || kind === 'turret');
    this.$('r-help').textContent = kind === 'cruiser' ? 'W A S D drive · drag or ←/→ to look · Space photo · right-click horn' + (G.game?.rifle ? ' · left-click rifle' : '') : kind === 'jeep' ? 'W faster · S slower/reverse · drag or ←/→ to look' : kind === 'balloon' ? 'W A S D to steer · drag to look' : kind === 'heli' ? 'WASD fly · drag to look · Q/E lower/higher · Left-click dart · Right-click rifle' : kind === 'turret' ? 'Drag or ←/→ to aim · click to fire (the turret kills, it cannot sedate)' : kind === 'view' ? 'Drag or ←/→ to look around · Space photo · Esc to leave' : 'Drag or ←/→ to look';
    const pb = this.$('ride').querySelector('[data-act="photo"]'); if (pb) pb.hidden = kind === 'heli' || kind === 'turret';
  }
  updateRide() {
    if (this.$('ride').hidden) return;
    const g = G.game, st = g.park.stats, f = G.engine.cam.follow;
    const heli = f?.kind === 'heli';
    const parts = [];
    if (g.missionTime != null) parts.push(`⏱ ${Math.floor(g.missionTime / 60)}:${String(Math.floor(g.missionTime % 60)).padStart(2, '0')}`);
    if (heli && g.ammo != null) parts.push(`Ammo ${g.ammo}`);
    if (heli && g.mode !== 'mission') parts.push(`Fuel ${Math.round(((f.fuel ?? f.fuelMax()) / f.fuelMax()) * 100)}%`);
    if (heli) parts.push(g.musterOn ? 'Muster ON (M)' : 'Muster off (M)');
    if (f?.kind === 'cruiser') parts.push(`Cruiser ${Math.round(f.hp)}%`);
    if (!heli) parts.push(`${fmtInt(st.missionPoints ?? st.photoPoints)} pts · film ${Math.max(0, (g.mission?.photos ?? 10) - (g.ridePhotos || 0))}`);
    if (heli && !g.mission) parts.push(`Retired ${st.retired}`);
    this.$('r-score').textContent = parts.join(' · ');
    const rg = this.$('r-goals');
    const ms = g.park.missionState;
    if (g.mission && g.mode !== 'career') {
      rg.hidden = false;
      const goals = ms.goals.length ? ms.goals : g.mission.goals.map((goal) => ({ goal, met: false, value: 0 }));
      rg.innerHTML = goals.filter((x) => !x.goal.fail || !x.met).map((x) => `<div class="${x.met && !x.goal.fail ? 'done' : ''}"><span>${x.goal.fail ? '✕' : x.met ? '✓' : '○'}</span> ${esc(x.goal.text)}${['missionPoints', 'mustered', 'tagLeft'].includes(x.goal.type) ? ` <b class="mono">${fmtInt(x.value)}${x.goal.type === 'tagLeft' ? ' left' : '/' + fmtInt(x.goal.n)}</b>` : ''}</div>`).join('');
    } else rg.hidden = true;
  }
  photoTaken(p) {
    const f = this.$('r-flash');
    if (f) { f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 60); }
    const last = this.$('r-last');
    if (last) { last.hidden = false; last.innerHTML = `${p.url ? `<img alt="Last photo" src="${p.url}">` : ''}<div class="mono" style="padding-top:4px"><b style="color:var(--amber)">+${fmtInt(p.score)} pts</b>${p.action ? ' · action!' : ''}</div><div>${p.species.map((s) => SPECIES_BY_ID[s].name).join(', ') || 'No dinosaurs in frame'}</div>`; }
    if (this.$('ride').hidden) this.toast({ text: `Photo: ${fmtInt(p.score)} points${p.best ? ` (${p.best})` : ''}`, kind: p.score ? 'good' : 'info' });
  }

  // =================== minimap ===================
  bindMinimap() {
    const c = this.$('minimap');
    const go = (e) => {
      const g = G.game;
      if (!g) return;
      const r = c.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * g.map.W, z = ((e.clientY - r.top) / r.height) * g.map.H;
      const cam = G.engine.cam;
      if (cam.mode !== 'ride') { cam.mode = 'orbit'; cam.follow = null; cam.tx = x; cam.tz = z; }
    };
    let down = false;
    c.addEventListener('pointerdown', (e) => { down = true; go(e); });
    window.addEventListener('pointerup', () => (down = false));
    c.addEventListener('pointermove', (e) => { if (down) go(e); });
  }
  drawMinimap() {
    const g = G.game;
    if (!g) return;
    const c = this.$('minimap'), ctx = c.getContext('2d');
    const map = g.map, W = map.W, s = c.width / W;
    const v = `${map.ver.terrain}|${map.ver.path}|${map.ver.flora}|${map.ver.fence}|${map.ver.bld}|${g.bldVersion}`;
    if (v !== this.mmVer || !this.mmBase) {
      this.mmVer = v;
      const img = ctx.createImageData(W, W);
      const col = { [T.GRASS]: [86, 140, 58], [T.SAND]: [214, 198, 140], [T.WATER]: [42, 120, 160], [T.SEA]: [24, 70, 100], [T.ROCK]: [128, 120, 108], [T.DIRT]: [130, 104, 72] };
      for (let i = 0; i < W * W; i++) {
        let c3 = col[map.terrain[i]];
        if (map.flora[i] && map.flora[i] <= 5) c3 = [52, 96, 44];
        if (map.path[i] === 1) c3 = [226, 214, 186];
        if (map.path[i] === 2) c3 = [160, 124, 80];
        if (map.bld[i] >= 0) c3 = [240, 168, 48];
        img.data.set([c3[0], c3[1], c3[2], 255], i * 4);
      }
      const off = this.mmBase || (this.mmBase = document.createElement('canvas'));
      off.width = W; off.height = W;
      off.getContext('2d').putImageData(img, 0, 0);
      // fences
      const oc = off.getContext('2d');
      oc.fillStyle = '#ece3cc';
      for (let y = 0; y <= W; y++) for (let x = 0; x < W; x++) { const i = map.hIdx(x, y); if (map.fenceH[i]) { oc.fillStyle = map.fenceHHp[i] > 0 ? '#ece3cc' : '#e8553f'; oc.fillRect(x, y - 0.5, 1, 1); } }
      for (let y = 0; y < W; y++) for (let x = 0; x <= W; x++) { const i = map.vIdx(x, y); if (map.fenceV[i]) { oc.fillStyle = map.fenceVHp[i] > 0 ? '#ece3cc' : '#e8553f'; oc.fillRect(x - 0.5, y, 1, 1); } }
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.mmBase, 0, 0, c.width, c.height);
    const blink = Math.floor(performance.now() / 300) % 2;
    for (const d of g.dinos) {
      if (d.dead) { ctx.fillStyle = '#555'; }
      else if (d.escaped) { ctx.fillStyle = blink ? '#ff3020' : '#fff'; }
      else ctx.fillStyle = d.sp.diet === 'carn' ? '#ff7a5a' : '#b8ff9a';
      const r = d.escaped ? 3 : 2;
      ctx.fillRect(d.x * s - r / 2, d.z * s - r / 2, r, r);
    }
    ctx.fillStyle = '#ffe080';
    for (const vis of g.visitors.list) if (vis.plan !== 'inside' && vis.plan !== 'ride' && vis.plan !== 'queue') ctx.fillRect(vis.x * s, vis.z * s, 1, 1);
    // camera marker
    const cam = G.engine.cam;
    ctx.strokeStyle = '#f0a830'; ctx.lineWidth = 1.5;
    const half = Math.max(4, cam.dist * 0.5) * s;
    ctx.save(); ctx.translate(cam.x * s, cam.z * s); ctx.rotate(-cam.yaw);
    ctx.strokeRect(-half, -half * 0.7, half * 2, half * 1.4);
    ctx.restore();
    this.$('mm-n').textContent = `${g.dinos.filter((d) => d.escaped && !d.dead).length ? '⚠ ESCAPE' : ''}`;
  }

  // =================== main menu ===================
  showMenu(screen = 'main') {
    document.body.classList.remove('action-mission');
    this.menuScreen = screen;
    const m = this.$('menu');
    m.hidden = false;
    this.$('hud').hidden = true;
    this.$('islandgen')?.remove();
    const p = loadProgress();
    const latest = latestSave();
    const medal = (act, icon, label, dis, extra = '') => `<button class="mb" data-act="menu" data-do="${act}" data-label="${esc(label)}" ${dis ? 'disabled' : ''} ${extra}><span class="medal">${ICON[icon]}</span><span>${esc(label)}</span></button>`;
    const gate = (inner) => `
<div class="gatewrap">
  <div class="pillar l"><div class="torch"><i></i></div><div class="torch lo"><i></i></div></div>
  <div class="gatebody">
    <div class="arch"><h1 class="logo">Isla Genesis<small>Dinosaur Park</small></h1></div>
    <div class="doors"><div class="door l"></div><div class="door r"></div>${inner}</div>
  </div>
  <div class="pillar r"><div class="torch"><i></i></div><div class="torch lo"><i></i></div></div>
</div>`;
    let html = '';
    if (screen === 'main') {
      html = gate(`<div class="medals">
${medal('continue', 'play', latest ? 'Continue' : 'Continue', !latest, latest ? `data-tip="${esc(latest.name)} · ${latest.meta ? 'day ' + latest.meta.day : ''}"` : '')}
${medal('career', 'palm', 'Operation Genesis')}
${medal('exercises', 'info', `Exercises ${Object.keys(p.exercises || {}).length}/${EXERCISES.length}`)}
${medal('missions', 'star', `Missions ${Object.keys(p.missions).length}/${MISSIONS.length}`)}
${medal('siteb', 'dino', p.siteB ? 'Site B' : 'Site B (locked)', !p.siteB, p.siteB ? '' : 'data-tip="Finish every mission or reach 5 stars in a park"')}
</div>
<div class="plaque" id="plaque">GenTec Biosciences</div>
<div class="medals">
${medal('sandbox', 'hardhat', 'Sandbox')}
${medal('load', 'paper', 'Load Park')}
${medal('options', 'gear', 'Options')}
${medal('dinopedia', 'dino', 'Dinopedia')}
${medal('help', 'info', 'How to Play')}
</div>`) + '<div class="menu-foot">An homage to the 2003 park-building classic. Dinosaur, plant and people models by Quaternius (CC0). Everything else is generated in your browser.</div>';
    } else {
      let body = '';
      if (screen === 'missions') body = `<div class="mission-list">${MISSIONS.map((ms, i) => `<div class="mission ${p.missions[ms.id] ? 'done' : ''}"><div class="num">${i + 1}</div><div><h4><small style="color:var(--amber)">${esc(ms.kind)}</small> · ${esc(ms.name)}</h4><p>${esc(ms.brief)}</p></div><button class="btn small primary" data-act="menu" data-do="startMission" data-id="${ms.id}">Play</button></div>`).join('')}</div>`;
      if (screen === 'exercises') body = `<div class="mission-list">${EXERCISES.map((ms, i) => `<div class="mission ${(p.exercises || {})[ms.id] ? 'done' : ''}"><div class="num">${i + 1}</div><div><h4>${ms.tutorial ? '<small style="color:var(--amber)">Tutorial</small> · ' : ''}${esc(ms.name)}</h4><p>${esc(ms.brief)}</p></div><button class="btn small primary" data-act="menu" data-do="startMission" data-id="${ms.id}">Play</button></div>`).join('')}</div>`;
      if (screen === 'load') body = this.savesBody(false);
      if (screen === 'options') body = this.optionsBody();
      if (screen === 'help') body = `<div style="font-size:14px">${this.helpBody()}</div>`;
      const title = { missions: 'Missions', exercises: 'Exercises', load: 'Load Park', options: 'Options', help: 'How to Play' }[screen];
      html = `<div class="menu-panel glass"><div class="row" style="justify-content:space-between;margin-bottom:10px"><h2 class="carved" style="margin:0;font-size:26px">${title}</h2><button class="btn small" data-act="menu" data-do="back">Back</button></div>${body}</div>`;
    }
    m.innerHTML = html;
    m.onmouseover = (e) => { const b = e.target.closest('.mb'); const pl = this.$('plaque'); if (pl) pl.textContent = b ? b.dataset.label : 'GenTec Biosciences'; };
  }

  // Island generation (New Park): sliders regenerate a live preview of the island.
  showIslandGen() {
    this.$('menu').hidden = true;
    this.$('islandgen')?.remove();
    const P = this.genParams || (this.genParams = { shape: 0.5, trees: 0.5, rivers: 0.3, mountains: 0.4, size: 0.5, form: 'random', seed: Math.floor(Math.random() * 99999) });
    const el = document.createElement('div');
    el.id = 'islandgen';
    el.className = 'islandgen glass';
    const sl = (k, label) => `<label for="ig-${k}">${label}<input id="ig-${k}" type="range" min="0" max="1" step="0.05" value="${P[k]}" data-gen="${k}"></label>`;
    const sizes = [[0, 'Small'], [0.5, 'Medium'], [1, 'Large']];
    const forms = Object.entries(ISLAND_FORM_NAMES).map(([k, n]) => `<option value="${k}" ${P.form === k ? 'selected' : ''}>${n}</option>`).join('');
    el.innerHTML = `<h2>Island Generation</h2>
<div class="seg" role="group" aria-label="Island size">${sizes.map(([v, n]) => `<button class="btn small ${P.size === v ? 'primary' : ''}" data-act="menu" data-do="genSize" data-v="${v}">${n}</button>`).join('')}</div>
<label for="ig-form" class="carved" style="display:grid;gap:4px;font-size:14px">Island shape<select id="ig-form" data-genform="1">${forms}</select></label>
<div class="ig-info" id="ig-info"></div>
<div class="sliders">${sl('shape', 'Smooth coast')}${sl('trees', 'Trees')}${sl('rivers', 'Rivers')}${sl('mountains', 'Mountains')}</div>
<label for="ig-name" class="carved" style="display:grid;gap:4px;font-size:14px">Park name<input id="ig-name" type="text" value="${esc(this.genName || 'Isla Genesis')}" maxlength="40"></label>
<div class="row"><button class="btn" data-act="menu" data-do="nextIsland">Next Island</button><button class="btn primary" data-act="menu" data-do="startCareer">Start</button></div>
<button class="btn small" data-act="menu" data-do="back">Back</button>`;
    this.root.appendChild(el);
    el.addEventListener('input', (e) => {
      const k = e.target.dataset.gen;
      if (k) { P[k] = Number(e.target.value); clearTimeout(this.genT); this.genT = setTimeout(() => G.main.previewIsland(P), 220); }
      if (e.target.id === 'ig-name') this.genName = e.target.value;
      if (e.target.dataset.genform) { P.form = e.target.value; G.main.previewIsland(P); this.islandInfo(); }
    });
    G.main.previewIsland(P);
    this.islandInfo();
  }
  islandInfo() {
    const m = G.game?.map, el = this.$('ig-info');
    if (!m || !el) return;
    let land = 0; for (let i = 0; i < m.W * m.H; i++) if (m.terrain[i] !== 2 && m.terrain[i] !== 3) land++;
    const km2 = (land * 2.5 * 2.5) / 1e6;
    el.textContent = `${ISLAND_FORM_NAMES[m.form] || ''} island · ${m.W * 2.5} m across · ${km2.toFixed(2)} km² of land`;
  }
  hideMenu() { this.$('menu').hidden = true; this.$('hud').hidden = false; this.$('islandgen')?.remove(); }
  menuAction(k, d) {
    const M = G.main;
    switch (k) {
      case 'continue': { const l = latestSave(); if (l) this.loadSlot(l.slot); break; }
      case 'career': this.showIslandGen(); break;
      case 'nextIsland': this.genParams.seed = Math.floor(Math.random() * 99999); M.previewIsland(this.genParams); this.islandInfo(); break;
      case 'genSize': this.genParams.size = Number(d.v); this.showIslandGen(); break;
      case 'startCareer': { const P = this.genParams; M.newGame({ mode: 'career', name: this.$('ig-name')?.value || 'Isla Genesis', seed: P.seed, params: { shape: P.shape, trees: P.trees, rivers: P.rivers, mountains: P.mountains, size: P.size, form: P.form } }); break; }
      case 'missions': this.showMenu('missions'); break;
      case 'exercises': this.showMenu('exercises'); break;
      case 'dinopedia': this.$('menu').hidden = true; this.pediaFromMenu = true; this.openModal('dinopedia'); break;
      case 'startMission': { this.closeModal(); const ms = MISSIONS.find((x) => x.id === d.id), ex = EXERCISES.find((x) => x.id === d.id); M.newGame({ mode: ms ? 'mission' : 'exercise', mission: ms || ex }); break; }
      case 'siteb': M.newGame({ mode: 'siteb', name: 'Site B' }); break;
      case 'sandbox': M.newGame({ mode: 'sandbox', name: 'Sandbox Island' }); break;
      case 'load': this.showMenu('load'); break;
      case 'options': this.showMenu('options'); break;
      case 'help': this.showMenu('help'); break;
      case 'back': if (this.$('islandgen')) M.toMenu(); else this.showMenu('main'); break;
    }
  }

  onGameStart() {
    this.hideMenu();
    this.cat = null;
    this.$('info').hidden = true;
    this.$('ride').hidden = true;
    this.$('toasts').innerHTML = '';
    this.mmBase = null; this.mmVer = '';
    for (const id of ['arc', 'status-tl', 'counters', 'minimap-wrap', 'm-mail', 'mm-tab']) this.$(id).hidden = false;
    // action missions have no park to run: hide money, the gate controls and the building menus
    const action = G.game?.mode === 'mission';
    document.body.classList.toggle('action-mission', action);
    this.closeWheel(); this.$('fan').hidden = true; this.$('mailbox').hidden = true;
    this.renderToolbar();
    this.setSpeed(1);
    this.refreshTop();
    this.renderObjectives();
  }
}

// Legacy dock/toolbar methods are replaced by the medallion HUD.
Object.assign(UI.prototype, HudMethods, {
  renderToolbar() {},
  markToolbar() {},
  renderSubmenu() {},
  collapseSubmenu() { if (this.wheelOpen) this.closeWheel(); },
  refreshBuildMenu() { if (this.wheelOpen) this.renderWheel(); },
  onToolChange() { this.$('m-build')?.classList.toggle('on', !!this.wheelOpen || !['select'].includes(G.tools?.tool?.type)); },
});

UI.prototype.scopeMsg = function (t) {
  const r = this.$('r-rec');
  if (!r) return;
  r.textContent = t; r.style.color = /retired|tranquil/.test(t) ? 'var(--good)' : 'var(--warn)';
  clearTimeout(this._scopeT); this._scopeT = setTimeout(() => { r.textContent = '● REC'; r.style.color = ''; }, 1600);
};
