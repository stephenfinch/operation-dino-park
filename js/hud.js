// In-game HUD in the style of the original: status top-left, counters/selection top-right,
// medallion arc bottom-left with a radial build wheel, mail bottom-right, minimap tab on the left.
import { G } from './state.js';
import { CHARGEABLE, MENUS, VTYPES, BUILDINGS, BLD, FENCES, FLORA, RESEARCH_BY_ID, SPECIES_BY_ID, ADVISORS, DISEASES, SITEB_BUILDINGS, BIAS } from './data.js';
import { fmtMoney, fmtInt, clamp } from './util.js';
import { ICON } from './icons.js';
import { PATH_COST, TRACK_COST, WATER_COST, HILL_COST } from './game.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const WEATHER = { clear: 'Sunny', cloudy: 'Overcast', rain: 'Raining', storm: 'Thunderstorm', twister: 'Twister', heat: 'Heatwave' };

// Each category shows a 3D picture of something inside it, as the original's build menu does.
export const BUILD_CATS = [
  { id: 'paths', label: 'Paths', short: 'Paths', icon: 'path', thumb: (T) => T.path(1) },
  { id: 'cleaner', label: 'Cleaner Station', short: 'Cleaners', icon: 'badge', thumb: (T) => T.building('cleaner'), direct: 'cleaner' },
  { id: 'attraction', label: 'Attractions', short: 'Attractions', icon: 'binoculars', thumb: (T) => T.building('platform') },
  { id: 'nature', label: 'Environment', short: 'Environment', icon: 'palm', thumb: (T) => T.flora(1) },
  { id: 'amenity', label: 'Amenities', short: 'Amenities', icon: 'kiosk', thumb: (T) => T.building('snack') },
  { id: 'enclosure', label: 'Enclosures', short: 'Enclosures', icon: 'fence', thumb: (T) => T.building('hatchery') },
  { id: 'staff', label: 'Security', short: 'Security', icon: 'badge', thumb: (T) => T.building('ranger') },
  { id: 'bulldoze', label: 'Demolish', short: 'Demolish', icon: 'bulldoze' },
];

export const HudMethods = {
  hudSkeleton() {
    return `
  <div id="status-tl">
    <div class="money" id="h-money"></div>
    <div class="date" id="h-date"></div>
    <div class="rating" id="h-stars" data-act="modal" data-k="park" data-tab="overview" data-tip="Park rating"></div>
    <div class="weather" id="h-weather"></div>
    <div class="speedrow" id="t-speed">
      <button class="medal xs" data-act="speed" data-n="0" data-tip="Pause (Space)">${ICON.pause}</button>
      <button class="medal xs" data-act="speed" data-n="1" data-tip="Normal speed (1)">${ICON.play}</button>
      <button class="medal xs" data-act="speed" data-n="2" data-tip="Fast (2)">${ICON.ff}</button>
      <button class="medal xs" data-act="speed" data-n="3" data-tip="Fastest (3)"><b>3</b></button>
    </div>
    <div class="gaterow">
      <button class="gatebtn" id="h-open" data-act="hud2" data-do="toggleOpen"></button>
      <button class="gatebtn emerg" id="h-emerg" data-act="hud2" data-do="emergency" data-tip="Declare an emergency: guests run to the Visitor Shelters. No fatality fines while it lasts.">Emergency</button>
      <span class="fee" data-tip="Entry fee per guest. Click the Park Gate for details.">
        <button class="medal xs" data-act="hud2" data-do="fee:-10" aria-label="Lower entry fee"><b>−</b></button>
        <span id="h-fee"></span>
        <button class="medal xs" data-act="hud2" data-do="fee:10" aria-label="Raise entry fee"><b>+</b></button>
      </span>
    </div>
    <span class="saved-flash" id="t-saved" hidden>Game saved</span>
  </div>
  <div id="counters" class="glass">
    <button class="cnt" data-act="modal" data-k="park" data-tab="dinosaurs" data-tip="Dinosaurs"><span class="v" id="h-dinos">0</span><i>${ICON.dino}</i></button>
    <button class="cnt" data-act="modal" data-k="park" data-tab="visitors" data-tip="Visitors"><span class="v" id="h-vis">0</span><i>${ICON.person}</i></button>
  </div>
  <div id="selpanel" hidden></div>
  <div id="arc">
    <button class="medal big" id="m-build" data-act="hud" data-do="build" data-tip="Build fences, paths, the Hatchery and more">${ICON.hardhat}<span class="lbl">Build</span></button>
    <button class="medal big" id="m-park" data-act="hud" data-do="park" data-tip="Reports: performance, visitors, security, dinosaurs, finance, structures, entertainment">${ICON.paper}<span class="lbl">Reports</span></button>
    <button class="medal big" id="m-dino" data-act="hud" data-do="dinos" data-tip="Dinosaurs: Fossil Hunt, Fossil Market, Genetics Lab, Dinopedia">${ICON.dino}<span class="lbl">Dinosaurs</span></button>
    <button class="medal big" id="m-hand" data-act="hud" data-do="hand" data-tip="Actions: park entrance, research, emergency, chopper, Land Cruiser">${ICON.hand}<span class="lbl">Actions</span></button>
    <button class="medal big" id="m-opt" data-act="modal" data-k="gamemenu" data-tip="Options">${ICON.gear}<span class="lbl">Options</span></button>
  </div>
  <div id="wheel" hidden></div>
  <div id="buildcard" class="glass card-holo" hidden></div>
  <div id="fan" hidden></div>
  <button class="medal mail" id="m-mail" data-act="hud" data-do="mail" data-tip="Messages">${ICON.mail}<span class="badge" id="mail-n" hidden>0</span></button>
  <div id="mailbox" class="glass" hidden></div>
  <button id="mm-tab" class="glass" data-act="hud" data-do="minimap" data-tip="Island map">${ICON.map}</button>`;
  },

  // ---------- top-left / counters ----------
  refreshTop() {
    const g = G.game;
    if (!g) return;
    const p = g.park;
    this.$('h-money').textContent = p.unlimited ? 'UNLIMITED' : (p.money < 0 ? '-$' : '$') + fmtInt(Math.abs(p.money));
    this.$('h-money').classList.toggle('neg', p.money < 0);
    this.$('h-date').textContent = p.dayNight ? `${p.dateText()} · ${p.clockText().split('  ')[1]}` : p.dateText();
    let st = '';
    for (let i = 1; i <= 5; i++) st += `<span class="${p.rating.stars >= i ? 'on' : p.rating.stars >= i - 0.5 ? 'half' : 'off'}">${ICON.star}</span>`;
    this.$('h-stars').innerHTML = st;
    const temp = (p.weather.type === 'heat' ? 39 : p.weather.type === 'clear' ? 31 : p.weather.type === 'cloudy' ? 27 : 23) + Math.sin((p.elapsed || 0) / 97) * 2.5;
    const fc = p.weather.queue ? p.weather.queue.slice(0, 3).map((f) => WEATHER[f.type]).join(', then ') : '';
    const wEl = this.$('h-weather');
    wEl.innerHTML = `${temp.toFixed(1)}°C ${WEATHER[p.weather.type]}${p.blackout > 0 ? ' <span class="blackout">· Power out</span>' : ''}`;
    wEl.dataset.tip = fc ? `Forecast: ${fc}` : '';
    this.$('h-dinos').textContent = g.dinos.filter((d) => !d.dead).length;
    this.$('h-vis').textContent = g.mode === 'siteb' ? '–' : g.visitors.count;
    const ob = this.$('h-open');
    if (ob) {
      const siteb = g.mode === 'siteb';
      ob.parentElement.hidden = siteb;
      ob.textContent = p.parkOpen ? 'Park Open' : 'Park Closed';
      const eb = this.$('h-emerg');
      if (eb) { eb.classList.toggle('on', !!p.emergency); eb.textContent = p.emergency ? 'All Clear' : 'Emergency'; }
      ob.classList.toggle('open', !!p.parkOpen);
      ob.dataset.tip = p.parkOpen ? 'Click to close the park. Guests will go home.' : 'Click to open the park to visitors.';
      const fair = p.fairFee();
      this.$('h-fee').innerHTML = `Entry <b class="${p.fee > fair ? 'hi' : ''}">$${p.fee}</b>`;
    }
    const unread = g.mail ? g.mail.filter((m) => !m.read).length : 0;
    const b = this.$('mail-n'); b.hidden = !unread; b.textContent = unread;
  },

  // ---------- medallion arc actions ----------
  hudAction(k) {
    G.audio?.play('click');
    if (k === 'build') { this.wheelOpen ? this.closeWheel() : this.openWheel(); return; }
    if (k === 'park') { this.openFan('park'); return; }
    if (k === 'dinos') { this.openFan('dinos'); return; }
    if (k === 'hand') { this.openFan('hand'); return; }
    if (k === 'mail') { this.toggleMail(); G.game?.flag?.('mail'); return; }
    if (k === 'minimap') { this.$('minimap-wrap').classList.toggle('open'); G.game?.flag?.('minimap'); return; }
  },

  // Small fans of options that pop out of the arc medallions.
  openFan(kind) {
    const fan = this.$('fan');
    if (this.fanKind === kind && !fan.hidden) { fan.hidden = true; this.fanKind = null; return; }
    this.closeWheel();
    this.fanKind = kind;
    const g = G.game;
    const opts = {
      // the original's three menus: Reports, Dinosaurs and Actions
      park: [['modal:park:overview', 'Performance', 'star'], ['modal:park:visitors', 'Visitor', 'person'], ['modal:park:security', 'Security', 'shield'], ['modal:park:dinosaurs', 'Dinosaur', 'dino'], ['modal:park:finances', 'Finance', 'paper'], ['modal:park:structures', 'Structure', 'kiosk'], ['modal:park:entertainment', 'Entertainment', 'binoculars'], ['modal:album', 'Photo Album', 'camera']],
      dinos: [['modal:expeditions', 'Fossil Hunt', 'skull'], ['modal:market', 'Fossil Market', 'hay'], ['modal:genetics', 'Genetics Lab', 'dna'], ['modal:hatchery', 'Hatchery', 'egg'], ['modal:dinopedia', 'Dinopedia', 'info'], ['modal:park:dinosaurs', 'Dinosaur Summary', 'dino']],
      hand: (g.mode === 'mission' ? [] : [['place:entrance', 'Place Park Entrance', 'kiosk'], ['modal:research', 'Research', 'research'], ['emergency', g.park.emergency ? 'All Clear' : 'Declare Emergency', 'stress']]).concat([['ctl:heli', 'Go To Chopper', 'heli'], ['ctl:safari', 'Go To Land Cruiser', 'path'], ['ctl:balloon', 'Ride the Balloon', 'binoculars'], ['ctl:select', 'Select', 'select']]),
    }[kind];
    const base = { park: 1, dinos: 2, hand: 3 }[kind];
    fan.innerHTML = opts.map(([act, label, icon], i) => `<button class="medal fanitem" style="--i:${i};--n:${opts.length};--b:${base}" data-act="fan" data-do="${act}" data-tip="${esc(label)}">${ICON[icon]}<span>${esc(label)}</span></button>`).join('');
    fan.className = 'fan-' + kind;
    fan.hidden = false;
  },
  fanAction(a) {
    this.$('fan').hidden = true; this.fanKind = null;
    const [type, x, y] = a.split(':');
    if (type === 'modal') { this.openModal(x, y); return; }
    if (type === 'emergency') { G.game.setEmergency(!G.game.park.emergency); this.refreshTop(); return; }
    if (type === 'place') { G.tools.setTool({ type: 'building', id: x }); this.toast({ text: 'Click to place the Park Entrance. R rotates it. Its gate faces the arrow side; the helipad goes behind.', kind: 'info' }); return; }
    const g = G.game;
    if (type === 'ctl') {
      if (x === 'select') { G.tools.setTool({ type: 'select' }); return; }
      if (x === 'heli') { const h = g.helis[0]; if (!h) { this.toast({ text: 'Build a Ranger Station first (Build → Security).', kind: 'warn' }); return; } g.takeControlHeli(h); return; }
      const v = g.vehicles.find((j) => j.kind === (x === 'safari' ? 'jeep' : 'balloon') && (x === 'balloon' || (j.b.route && j.b.route.length > 4)));
      if (!v) { this.toast({ text: x === 'safari' ? 'You need a Safari Ride with a track first.' : 'You need a Balloon Tour first.', kind: 'warn' }); return; }
      g.takeControl(v);
    }
  },

  // ---------- radial build wheel ----------
  openWheel(cat) {
    this.$('fan').hidden = true; this.fanKind = null;
    this.wheelOpen = true;
    this.wheelCat = cat || null;
    this.renderWheel();
    this.$('m-build').classList.add('on');
  },
  closeWheel() {
    this.wheelOpen = false;
    this.$('wheel').hidden = true;
    this.$('buildcard').hidden = true;
    this.$('m-build')?.classList.remove('on');
  },
  wheelItems(cat) {
    const g = G.game, park = g.park, T = this.thumbs;
    const siteb = g.mode === 'siteb';
    const items = [];
    const bld = (b) => {
      const locked = (b.research && !park.has(b.research)) || (siteb && !SITEB_BUILDINGS.includes(b.id));
      items.push({ key: 'b:' + b.id, name: b.name, img: T.building(b.id), cost: b.cost, locked, why: b.research && !park.has(b.research) ? `Research ${RESEARCH_BY_ID[b.research].name}` : siteb ? 'Not allowed on Site B' : '', desc: b.desc || '', meta: `${b.size[0]}×${b.size[1]} · upkeep ${fmtMoney(b.upkeep * 2)}/month${b.limit ? ` · limit ${b.limit}` : ''}`, count: g.buildingsOf(b.id).length });
    };
    const ofCat = (c) => BUILDINGS.filter((b) => b.cat === c && !b.legacy);
    if (cat === 'enclosure') for (const f of FENCES.filter(Boolean)) items.push({ key: 'f:' + f.id, name: f.name, img: T.fence(f.id), cost: f.cost * 3, unit: '/section', locked: (f.research && !park.has(f.research)) || siteb, why: f.research && !park.has(f.research) ? `Research ${RESEARCH_BY_ID[f.research].name}` : siteb ? 'No fences on Site B' : '', desc: f.desc + ' Building over an existing fence upgrades it for the difference in price.', meta: 'Drag to build. Hold Shift for a straight line.' });
    if (cat === 'paths') {
      items.push({ key: 'p:path', name: 'Path', img: T.path(1), cost: PATH_COST, unit: '/tile', locked: siteb, desc: 'Guests walk on paths. Every building entrance must touch one. Busy paths get dirty.', meta: 'Drag to lay an L-shaped path.' });
      items.push({ key: 'p:track', name: 'Safari Track', img: T.path(2), cost: TRACK_COST, unit: '/tile', locked: !park.has('safari') || siteb, why: !park.has('safari') ? 'Research Safari Adventure' : '', desc: 'Land Cruiser track for the Safari Adventure. It passes through fences; gates are added automatically.', meta: 'Start it next to a Safari Adventure station.' });
      ofCat('paths').forEach(bld);
    } else if (cat === 'nature') {
      items.push({ key: 'n:paleo', name: 'Paleo Trees', img: T.flora(2), cost: 30, unit: '/plant', desc: 'Cloned prehistoric plants: tree ferns, cycads and ferns. Healthy food for herbivores, and Dino Nerds love them.', meta: 'Paints a patch of plants.' });
      items.push({ key: 'n:modern', name: 'Modern Trees', img: T.flora(1), cost: 10, unit: '/plant', desc: 'Palms and jungle trees. Cheaper, but herbivores that eat them can get Gastric Poisoning.', meta: 'Paints a patch of trees.' });
      for (const f of FLORA.filter(Boolean)) items.push({ key: 'n:' + f.id, name: f.name, img: T.flora(f.id), cost: f.cost, desc: f.graze ? 'Herbivores graze on it.' : f.forest ? 'Counts toward forest cover.' : 'Decorative rock.', meta: 'Single plants.' });
      items.push({ key: 't:water', name: 'Lake', img: T.terrain('water'), cost: WATER_COST, unit: '/tile', desc: 'Dinosaurs need water inside their enclosure.', meta: '' });
      items.push({ key: 't:raise', name: 'Mountain', img: T.terrain('hill'), cost: HILL_COST, unit: '/tile', desc: 'Build hills and mountains. Drag again to make them taller. Dinosaurs cannot climb them, and Dino Nerds love the view.', meta: '' });
      items.push({ key: 't:lower', name: 'Flatten', img: T.terrain('flat'), cost: HILL_COST, unit: '/tile', desc: 'Lower or flatten hills to clear building space.', meta: '' });
      items.push({ key: 't:land', name: 'Fill Water', img: T.terrain('land'), cost: WATER_COST, unit: '/tile', desc: 'Turn water back into grassland.', meta: '' });
    } else ofCat(cat).forEach(bld);
    return items;
  },
  renderWheel() {
    const w = this.$('wheel');
    w.hidden = false;
    const cat = this.wheelCat;
    let ring, label;
    if (!cat) {
      ring = BUILD_CATS.map((c) => c.thumb
        ? `<button class="medal ringitem img" data-act="wheel" data-do="cat:${c.id}" data-label="${esc(c.label)}"><img alt="" src="${c.thumb(this.thumbs)}"><span class="cap">${esc(c.short)}</span></button>`
        : `<button class="medal ringitem" data-act="wheel" data-do="cat:${c.id}" data-label="${esc(c.label)}">${ICON[c.icon]}<span class="cap">${esc(c.short)}</span></button>`);
      label = 'Build';
    } else {
      const c = BUILD_CATS.find((x) => x.id === cat);
      const items = this.wheelItems(cat);
      this._items = Object.fromEntries(items.map((it) => [it.key, it]));
      ring = [`<button class="medal ringitem back" data-act="wheel" data-do="back" data-label="Back">${ICON.close}</button>`]
        .concat(items.map((it) => `<button class="medal ringitem img ${it.locked ? 'locked' : ''}" data-act="wheel" data-do="item:${it.key}" data-label="${esc(it.name)}" data-key="${it.key}"><img alt="" src="${it.img}"><span class="cap">${esc(it.short || it.name.replace(/ (Security )?Fence$/, '').replace(/^Viewing /, ''))}</span></button>`));
      label = c.label;
      if (cat === 'enclosure') ring.push(`<button class="medal ringitem toggle" data-act="wheel" data-do="fencemode" data-label="${this.fenceMode === 'line' ? 'Line mode' : 'Enclosure mode'}"><b>${this.fenceMode === 'line' ? '—' : '▢'}</b></button>`);
      if (cat === 'nature') ring.push(`<button class="medal ringitem toggle" data-act="wheel" data-do="brush" data-label="Brush size ${(this.brushSize ?? 1) * 2 + 1}"><b>${(this.brushSize ?? 1) * 2 + 1}</b></button>`);
    }
    const n = ring.length;
    const R = Math.max(128, n * 19);
    w.style.setProperty('--R', R + 'px');
    w.innerHTML = `<div class="hub glass" id="wheel-label">${esc(label)}</div>` + ring.map((h, i) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      return h.replace('class="medal ringitem', `style="left:${(Math.cos(a) * R).toFixed(1)}px;top:${(Math.sin(a) * R).toFixed(1)}px" class="medal ringitem`);
    }).join('');
    w.onmouseover = (e) => {
      const b = e.target.closest('.ringitem');
      if (!b) return;
      this.$('wheel-label').textContent = b.dataset.label;
      if (b.dataset.key) this.showBuildCard(this._items[b.dataset.key]);
    };
    w.onmouseout = (e) => { if (e.target.closest('.ringitem')) this.$('wheel-label').textContent = label; };
  },
  showBuildCard(it) {
    const c = this.$('buildcard');
    if (!it) { c.hidden = true; return; }
    c.hidden = false;
    c.innerHTML = `<div class="holo"><img alt="" src="${it.img}"><span class="price">${fmtMoney(it.cost)}${it.unit || ''}</span></div>
<h3>${esc(it.name)}</h3><p>${esc(it.desc)}</p>${it.meta ? `<p class="meta">${esc(it.meta)}</p>` : ''}${it.locked && it.why ? `<p class="lock">Locked: ${esc(it.why)}</p>` : ''}${it.count != null ? `<div class="count">${it.count} built</div>` : ''}`;
  },
  wheelAction(a) {
    G.audio?.play('click');
    if (a === 'back') { this.wheelCat = null; this.$('buildcard').hidden = true; this.renderWheel(); return; }
    if (a === 'fencemode') { this.fenceMode = this.fenceMode === 'line' ? 'rect' : 'line'; if (G.tools.tool.type === 'fence') G.tools.tool.mode = this.fenceMode; this.renderWheel(); return; }
    if (a === 'brush') { this.brushSize = ((this.brushSize ?? 1) + 1) % 4; if (G.tools.tool.size != null) G.tools.tool.size = this.brushSize; this.renderWheel(); return; }
    if (a.startsWith('cat:')) {
      const id = a.slice(4);
      if (id === 'bulldoze') { this.closeWheel(); G.tools.setTool({ type: 'bulldoze' }); this.toast({ text: 'Demolish: click or drag over things to remove them. Right-click to stop.', kind: 'info' }); return; }
      const dc = BUILD_CATS.find((c) => c.id === id)?.direct;
      if (dc) { this.wheelCat = id; this._items = Object.fromEntries(this.wheelItems(id).map((it) => [it.key, it])); this.wheelAction('item:b:' + dc); return; }
      this.wheelCat = id; this.renderWheel(); return;
    }
    if (a.startsWith('item:')) {
      const key = a.slice(5), it = this._items[key];
      if (it.locked) { this.toast({ text: it.why || 'Not available yet.', kind: 'warn' }); return; }
      const [k, v] = key.split(':');
      let tool = null;
      if (k === 'b') tool = { type: 'building', id: v };
      if (k === 'f') tool = { type: 'fence', fence: Number(v), mode: this.fenceMode || 'rect' };
      if (k === 'p') tool = { type: v };
      if (k === 'n') tool = { type: 'flora', flora: isNaN(Number(v)) ? v : Number(v), size: this.brushSize ?? 1 };
      if (k === 't') tool = { type: v, size: this.brushSize ?? 1 };
      this.closeWheel();
      G.tools.setTool(tool);
    }
  },

  // ---------- selection status panel (top-right) ----------
  meter(icon, v, tip) {
    const c = v > 60 ? 'good' : v > 30 ? 'mid' : 'bad';
    return `<div class="meter" data-tip="${esc(tip)} ${Math.round(v)}%"><i>${ICON[icon]}</i><div class="mbar"><div class="${c}" style="height:${clamp(v, 0, 100)}%"></div></div></div>`;
  },
  refreshSelPanel() {
    const g = G.game, sp = this.$('selpanel'), cnt = this.$('counters');
    const sel = g?.selected;
    if (!sel || sel.ref?.removed || (sel.kind === 'visitor' && sel.ref.gone) || !this.$('ride').hidden) { sp.hidden = true; cnt.hidden = !!(!this.$('ride').hidden); return; }
    cnt.hidden = true; sp.hidden = false;
    let meters = '', name = '';
    if (sel.kind === 'dino') {
      const d = sel.ref;
      name = `${d.name} · ${d.sp.name}`;
      if (!d.dead) meters = this.meter('dino', d.comfort, 'Comfort') + this.meter('smile', 100 - d.stress, 'Calm') + this.meter('meat', d.hunger, 'Food') + this.meter('drop', d.thirst, 'Water') + this.meter('zz', 100 - clamp(((d.awake || 0) / 500) * 100, 0, 100), 'Rested') + this.meter('cross', d.health, 'Health');
      else meters = '<div class="deadnote">Deceased</div>';
    } else if (sel.kind === 'building') {
      const b = sel.ref, def = BLD[b.type];
      name = def.name;
      meters = this.meter('cross', b.hp, 'Condition');
      if (def.fn === 'entrance') {
        const p = g.park, fair = p.fairFee();
        meters = `<div class="gatepanel"><button class="gatebtn ${p.parkOpen ? 'open' : ''}" data-act="hud2" data-do="toggleOpen">${p.parkOpen ? 'Park Open' : 'Park Closed'}</button>
<label>Entry fee <b>$${p.fee}</b><input type="range" id="fee" min="0" max="2000" step="10" value="${p.fee}" aria-label="Entry fee"></label>
<small>Guests think $${fair} is fair at ${p.rating.stars} stars.${p.fee > fair ? ' <span class="hi">They will complain.</span>' : ''}</small></div>`;
      }
      if (def.fn === 'feeder') meters += this.meter('hay', (b.stock / def.stock) * 100, 'Stock');
      if (CHARGEABLE(b.type)) meters += `<button class="og-btn small" data-act="kiosk" data-b="${b.id}">${MENUS[b.type] ? 'Menu & prices' : 'Admission'}</button>`;
    } else if (sel.kind === 'visitor') {
      const v = sel.ref;
      name = `${v.name} · ${VTYPES[v.vtype || 'neutral'].name} guest`;
      meters = this.meter('smile', v.happy, 'Happiness') + this.meter('meat', 100 - v.hunger, 'Fed') + this.meter('drop', 100 - v.thirst, 'Refreshed') + this.meter('zz', v.energy, 'Energy') + this.meter('shield', 100 - (v.panic > 0 ? 80 : 10), 'Safety');
    } else if (sel.kind === 'vehicle') { name = { ranger: 'Ranger Jeep', heli: 'Ranger Helicopter', jeep: 'Safari Jeep', balloon: 'Tour Balloon' }[sel.ref.kind]; }
    else if (sel.kind === 'enclosure') { name = 'Enclosure'; }
    const infoOpen = !this.$('info').hidden;
    sp.innerHTML = `<div class="glass meters">${meters}<button class="medal sm ${infoOpen ? 'on' : ''}" data-act="hud2" data-do="info" data-tip="Details">${ICON.info}</button><button class="medal sm" data-act="closeInfo" data-tip="Deselect">${ICON.close}</button></div><div class="selname">${esc(name)}</div>`;
    // keep the details card just below the selection panel, however tall it is
    const info = this.$('info');
    if (info && window.innerWidth > 760) info.style.top = `${sp.offsetTop + sp.offsetHeight + 8}px`;
  },

  // ---------- mail ----------
  addMail(n) {
    const g = G.game;
    if (!g) return;
    g.mail = g.mail || [];
    g.mail.unshift({ text: n.text, kind: n.kind, who: n.who || 'admin', date: g.park.dateText(), read: false, focus: n.focus });
    if (g.mail.length > 60) g.mail.pop();
  },
  toggleMail() {
    const box = this.$('mailbox');
    if (!box.hidden) { box.hidden = true; return; }
    const g = G.game;
    const list = (g.mail || []).slice(0, 40);
    box.innerHTML = `<h3>Messages</h3>` + (list.length ? list.map((m, i) => {
      const a = ADVISORS[m.who] || ADVISORS.admin;
      return `<div class="msg ${m.read ? '' : 'unread'} ${m.kind}" data-act="hud2" data-do="mail:${i}"><span class="ava" style="--c:${a.col}">${a.name.split(' ').map((w) => w[0]).filter((c) => /[A-Z]/.test(c)).slice(-2).join('')}</span><div><b>${esc(a.name)}</b> <small>${esc(a.role)} · ${m.date}</small><p>${esc(m.text)}</p></div></div>`;
    }).join('') : '<p class="empty">No messages yet.</p>');
    for (const m of g.mail || []) m.read = true;
    box.hidden = false;
    this.refreshTop();
  },
};

// Pick the advisor who would deliver a message.
export function advisorFor(text, kind) {
  const t = text.toLowerCase();
  if (/escape|rampage|fence|acu|helicopter|ranger|retire|tranquil|attack/.test(t)) return 'warden';
  if (/sick|disease|cured|died|health|vaccine|flu|tick|rabies|belly|bumblefoot|poison/.test(t)) return 'vet';
  if (/expedition|dig|fossil|amber|market|site/.test(t)) return 'paleo';
  if (/research|genome|dna|extract|incubat|hatch|genetic/.test(t)) return 'genetics';
  if (/storm|twister|tornado|weather|lightning|power|damage|wreck|repair/.test(t)) return 'admin';
  if (/money|profit|loss|bank|sold|fee|expensive|budget/.test(t)) return 'finance';
  if (/rating|star|mission|well done|congrat/.test(t)) return 'founder';
  if (/visitor|guest|ladies|attraction|released|photo/.test(t)) return 'pr';
  return 'admin';
}
