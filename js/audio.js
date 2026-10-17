// Procedural audio with the Web Audio API. No sound files needed.
import { G } from './state.js';
import { clamp, rand, pick } from './util.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.rainLevel = 0;
    this.heliT = 0;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.amb = ctx.createGain(); this.amb.connect(this.master);
    this.mus = ctx.createGain(); this.mus.connect(this.master);
    this.setVolume(G.settings.volume, G.settings.music);
    // noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // brown noise for wind / jungle bed
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    // ambience bed
    this.bed = this.loop(this.brown, 'lowpass', 500, 0.0, this.amb);
    this.rain = this.loop(this.noise, 'bandpass', 2500, 0.0, this.amb, 0.6);
    this.rotor = this.loop(this.noise, 'lowpass', 300, 0.0, this.sfx);
    // rotor chop LFO
    const lfo = ctx.createOscillator(); lfo.frequency.value = 13;
    const lg = ctx.createGain(); lg.gain.value = 0.5;
    lfo.connect(lg); lg.connect(this.rotor.g.gain); lfo.start();
    this.ready = true;
    this.birdT = 2; this.bugT = 1;
    if (this.wantMusic) this.startMusic();
  }

  setVolume(v, m) {
    if (!this.ctx) return;
    this.master.gain.value = v;
    this.mus.gain.value = m;
  }

  loop(buf, type, freq, gain, dest, q = 1) {
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(dest); src.start();
    return { src, f, g };
  }

  env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  tone(freq, dur, type = 'sine', vol = 0.2, when = 0, dest) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    const g = this.ctx.createGain();
    o.connect(g); g.connect(dest || this.sfx);
    this.env(g, t, 0.01, vol, dur);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }

  noiseHit(dur, type, freq, vol, when = 0, dest, q = 1) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + when;
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    s.connect(f); f.connect(g); g.connect(dest || this.sfx);
    this.env(g, t, 0.005, vol, dur);
    s.start(t, Math.random()); s.stop(t + dur + 0.1);
    return { s, f, g };
  }

  play(name) {
    if (!this.ready) return;
    const ctx = this.ctx;
    switch (name) {
      case 'click': this.tone(880, 0.05, 'triangle', 0.08); break;
      case 'hover': this.tone(1400, 0.03, 'sine', 0.025); break;
      case 'build': this.noiseHit(0.15, 'lowpass', 600, 0.4); this.tone(140, 0.15, 'square', 0.06); break;
      case 'path': this.noiseHit(0.1, 'bandpass', 1200, 0.15); break;
      case 'demolish': this.noiseHit(0.5, 'lowpass', 400, 0.6); this.noiseHit(0.3, 'bandpass', 900, 0.2, 0.1); break;
      case 'error': this.tone(200, 0.12, 'square', 0.06); this.tone(150, 0.15, 'square', 0.06, 0.1); break;
      case 'ding': this.tone(1046, 0.4, 'sine', 0.15); this.tone(1568, 0.5, 'sine', 0.1, 0.08); break;
      case 'cash': this.tone(1318, 0.08, 'square', 0.05); this.tone(1760, 0.2, 'square', 0.05, 0.07); break;
      case 'fanfare': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.12, i * 0.11)); break;
      case 'fail': [392, 330, 262].forEach((f, i) => this.tone(f, 0.45, 'triangle', 0.12, i * 0.2)); break;
      case 'shutter': this.noiseHit(0.04, 'highpass', 3000, 0.4); this.noiseHit(0.06, 'highpass', 2000, 0.3, 0.07); break;
      case 'alarm': for (let i = 0; i < 4; i++) { const t = ctx.currentTime + i * 0.5; const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(600, t); o.frequency.linearRampToValueAtTime(900, t + 0.25); o.frequency.linearRampToValueAtTime(600, t + 0.5); const g = ctx.createGain(); o.connect(g); g.connect(this.sfx); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.07, t + 0.05); g.gain.linearRampToValueAtTime(0.0001, t + 0.48); o.start(t); o.stop(t + 0.5); } break;
      case 'thunder': { const h = this.noiseHit(2.8, 'lowpass', 300, 0.9); if (h) h.f.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 2.5); this.noiseHit(0.3, 'lowpass', 1500, 0.4); break; }
    }
  }

  // Positional one-shots, attenuated by distance from the camera focus.
  playAt(name, x, z, vol = 1, o = {}) {
    if (!this.ready) return;
    const cam = G.engine.cam;
    const camH = G.engine.camera.position.y;
    const d = Math.hypot(x - cam.x, z - cam.z) + camH * 0.4;
    const att = clamp(1 - d / 70, 0, 1) ** 1.6 * vol;
    if (att < 0.02) return;
    switch (name) {
      case 'roar': this.roar(o.size || 2, o.carn, att); break;
      case 'thud': this.noiseHit(0.25, 'lowpass', 250, 0.6 * att); this.tone(60, 0.2, 'sine', 0.3 * att); break;
      case 'crash': this.noiseHit(0.9, 'lowpass', 700, 0.9 * att); this.noiseHit(0.5, 'bandpass', 2400, 0.3 * att, 0.05, null, 3); break;
      case 'zap': this.noiseHit(0.25, 'highpass', 3500, 0.5 * att); this.tone(120, 0.3, 'sawtooth', 0.15 * att); break;
      case 'scream': { const t = this.ctx.currentTime; const o2 = this.ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.setValueAtTime(rand(700, 900), t); o2.frequency.linearRampToValueAtTime(rand(500, 650), t + 0.6); const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 2; const g = this.ctx.createGain(); o2.connect(f); f.connect(g); g.connect(this.sfx); this.env(g, t, 0.03, 0.12 * att, 0.6); o2.start(t); o2.stop(t + 0.7); break; }
      case 'dart': this.noiseHit(0.08, 'bandpass', 2000, 0.4 * att, 0, null, 4); break;
      case 'shot': this.noiseHit(0.12, 'lowpass', 1800, 0.7 * att); this.noiseHit(0.05, 'highpass', 2500, 0.35 * att); break;
      case 'spray': this.noiseHit(1.2, 'highpass', 4000, 0.18 * att); break;
      case 'honk': this.tone(415, 0.35, 'square', 0.08 * att); this.tone(523, 0.35, 'square', 0.06 * att); break;
    }
  }

  roar(size, carn, vol) {
    const ctx = this.ctx, t = ctx.currentTime;
    const base = carn ? 140 / size + 30 : 260 / size + 50;
    const dur = 0.6 + size * 0.35 + rand(0, 0.4);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(base * 1.4, t);
    o.frequency.linearRampToValueAtTime(base * 1.1, t + dur * 0.3);
    o.frequency.exponentialRampToValueAtTime(base * 0.6, t + dur);
    const o2 = ctx.createOscillator(); o2.type = 'square';
    o2.frequency.setValueAtTime(base * 0.5, t); o2.frequency.exponentialRampToValueAtTime(base * 0.35, t + dur);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(carn ? 900 : 1600, t); f.frequency.exponentialRampToValueAtTime(carn ? 300 : 500, t + dur); f.Q.value = 4;
    const g = ctx.createGain();
    const growl = ctx.createOscillator(); growl.frequency.value = carn ? rand(25, 40) : rand(6, 12);
    const gg = ctx.createGain(); gg.gain.value = carn ? 0.5 : 0.25;
    growl.connect(gg); gg.connect(g.gain);
    o.connect(f); o2.connect(f); f.connect(g); g.connect(this.sfx);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35 * vol, t + 0.12);
    g.gain.setValueAtTime(0.3 * vol, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const n = this.noiseHit(dur, 'bandpass', carn ? 500 : 1200, 0.25 * vol, 0, null, 2);
    for (const x of [o, o2, growl]) { x.start(t); x.stop(t + dur + 0.1); }
  }

  setRain(level) { this.rainLevel = level; }
  heliNear(x, z) {
    const cam = G.engine.cam;
    const d = Math.hypot(x - cam.x, z - cam.z) + G.engine.camera.position.y * 0.3;
    this.heliVol = Math.max(this.heliVol || 0, clamp(1 - d / 60, 0, 1) * 0.35);
    this.heliT = 0.3;
  }

  // Called every frame
  update(dt, night, weather) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const camH = G.engine.camera.position.y;
    const near = clamp(1 - camH / 120, 0.15, 1);
    this.bed.g.gain.setTargetAtTime((0.12 + (weather === 'storm' ? 0.25 : 0)) * near, t, 0.5);
    this.bed.f.frequency.setTargetAtTime(weather === 'storm' || weather === 'twister' ? 900 : 450, t, 0.5);
    this.rain.g.gain.setTargetAtTime(this.rainLevel * 0.18, t, 1);
    this.heliT -= dt;
    if (this.heliT <= 0) this.heliVol = 0;
    this.rotor.g.gain.setTargetAtTime(this.heliVol || 0, t, 0.2);
    if (G.game && G.game.speed === 0) return;
    // birds by day, insects by night
    this.birdT -= dt;
    if (this.birdT <= 0 && !night && weather !== 'storm' && weather !== 'rain') {
      this.birdT = rand(0.6, 3.5);
      const f0 = rand(1800, 3600), n = Math.floor(rand(2, 6));
      for (let i = 0; i < n; i++) {
        const tt = t + i * rand(0.08, 0.16);
        const o = this.ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(f0 * rand(0.9, 1.1), tt); o.frequency.exponentialRampToValueAtTime(f0 * rand(0.6, 1.4), tt + 0.08);
        const g = this.ctx.createGain(); o.connect(g); g.connect(this.amb);
        this.env(g, tt, 0.01, 0.03 * near, 0.09);
        o.start(tt); o.stop(tt + 0.12);
      }
    }
    this.bugT -= dt;
    if (this.bugT <= 0 && night && weather === 'clear') {
      this.bugT = rand(0.4, 1.2);
      const f = rand(4000, 5200);
      for (let i = 0; i < 3; i++) this.tone(f, 0.03, 'sine', 0.012 * near, i * 0.06, this.amb);
    }
  }

  // ---------- generative theme for menus ----------
  startMusic() {
    this.wantMusic = true;
    if (!this.ready || this.musicOn) return;
    this.musicOn = true;
    const chords = [[62, 66, 69], [57, 61, 64], [59, 62, 66], [55, 59, 62], [62, 66, 69], [55, 59, 62], [57, 61, 64], [57, 61, 64]];
    const melody = [74, 76, 78, 76, 74, 73, 71, 73, 74, 69, 71, 73, 74, 78, 76, 74];
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    let bar = 0;
    const playBar = () => {
      if (!this.musicOn) return;
      const ctx = this.ctx, t = ctx.currentTime + 0.05, len = 2.4;
      const ch = chords[bar % chords.length];
      for (const n of ch) {
        for (const det of [-4, 4]) {
          const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(n - 12); o.detune.value = det;
          const g = ctx.createGain(); o.connect(g); g.connect(this.mus);
          g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.035, t + 0.6); g.gain.linearRampToValueAtTime(0.0001, t + len + 0.4);
          o.start(t); o.stop(t + len + 0.5);
        }
      }
      const bo = ctx.createOscillator(); bo.type = 'sine'; bo.frequency.value = mtof(ch[0] - 24);
      const bg = ctx.createGain(); bo.connect(bg); bg.connect(this.mus); this.env(bg, t, 0.05, 0.09, len);
      bo.start(t); bo.stop(t + len + 0.2);
      for (let i = 0; i < 2; i++) {
        const m = melody[(bar * 2 + i) % melody.length];
        const tt = t + i * (len / 2) + 0.2;
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = mtof(m);
        const vib = ctx.createOscillator(); vib.frequency.value = 5; const vg = ctx.createGain(); vg.gain.value = 3; vib.connect(vg); vg.connect(o.frequency);
        const g = ctx.createGain(); o.connect(g); g.connect(this.mus);
        g.gain.setValueAtTime(0.0001, tt); g.gain.linearRampToValueAtTime(0.05, tt + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, tt + len / 2 + 0.3);
        o.start(tt); o.stop(tt + len / 2 + 0.4); vib.start(tt); vib.stop(tt + len / 2 + 0.4);
      }
      bar++;
      this.musicTimer = setTimeout(playBar, len * 1000);
    };
    playBar();
  }
  stopMusic() { this.wantMusic = false; this.musicOn = false; clearTimeout(this.musicTimer); }
}
