// Underwater coral-reef soundscape, synthesized with the Web Audio API (no audio files)
// What a diver actually hears on a reef:
//  - snapping shrimp: dense crackling, the dominant reef sound
//  - a low, steady ocean presence (no surface waves)

const PREF = 'ore-no-suizokukan.sound';
export const SOUND_MODES = ['sea', 'off'];
export const SOUND_LABEL = { sea: '音：オン', off: '音：オフ' };

export class AquariumSound {
  constructor() {
    let m = 'sea';
    try { m = localStorage.getItem(PREF) || 'sea'; } catch {}
    if (m !== 'off') m = 'sea';
    this.mode = SOUND_MODES.includes(m) ? m : 'sea';
    this.ctx = null;
  }

  get enabled() { return this.mode !== 'off'; }

  // Must be called from a user gesture (iPhone requirement)
  start() {
    if (!this.enabled) return;
    if (this.ctx) { this.resume(); return; }
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    // effects are heard through water: muffled
    this.fx = ctx.createGain();
    const fxLp = ctx.createBiquadFilter(); fxLp.type = 'lowpass'; fxLp.frequency.value = 1800;
    this.fx.connect(fxLp).connect(this.master);

    this.noise = this._noiseBuffer(4);
    this._ambience();
    this.master.gain.linearRampToValueAtTime(1.8, ctx.currentTime + 3);
  }

  resume() {
    if (!this.ctx || !this.enabled) return;
    if (this.ctx.state !== 'running') this.ctx.resume();
  }

  suspend() {
    if (!this.ctx) return;
    this.ctx.suspend();
  }

  // toggle: on <-> off
  nextMode() {
    const i = SOUND_MODES.indexOf(this.mode);
    this.setMode(SOUND_MODES[(i + 1) % SOUND_MODES.length]);
    return this.mode;
  }

  setMode(m) {
    this.mode = m;
    try { localStorage.setItem(PREF, m); } catch {}
    if (m === 'off') {
      if (this.ctx) {
        this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
        setTimeout(() => { if (this.mode === 'off') this.suspend(); }, 800);
      }
      return;
    }
    if (!this.ctx) { this.start(); return; }
    this.resume();
    this.master.gain.setTargetAtTime(1.8, this.ctx.currentTime, 0.3);
  }

  // ---------- building blocks ----------
  _noiseBuffer(sec) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  _noiseSource() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise; s.loop = true;
    return s;
  }

  // Snapping shrimp: thousands of tiny sharp clicks, mostly faint, a few close and loud
  _crackleBuffer(sec = 7) {
    const ctx = this.ctx, sr = ctx.sampleRate, len = Math.floor(sr * sec);
    const buf = ctx.createBuffer(2, len, sr);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const rate = 420; // clicks per second
    const n = Math.floor(rate * sec);
    const decay = sr * 0.00018;
    for (let k = 0; k < n; k++) {
      const pos = Math.floor(Math.random() * (len - 64));
      const r = Math.random();
      const amp = 0.04 + 0.9 * Math.pow(r, 7);      // most are distant
      const pan = Math.random();
      const gl = amp * Math.sqrt(1 - pan), gr = amp * Math.sqrt(pan);
      for (let j = 0; j < 48; j++) {
        const v = Math.exp(-j / decay) * (Math.random() * 2 - 1) * (j === 0 ? 1.6 : 1);
        L[pos + j] += v * gl;
        R[pos + j] += v * gr;
      }
    }
    // normalise so the loudest snap never clips
    let pk = 0;
    for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
    const k = 1 / (pk || 1);
    for (let i = 0; i < len; i++) { L[i] *= k; R[i] *= k; }
    return buf;
  }

  _ambience() {
    const ctx = this.ctx, now = ctx.currentTime;

    // 1) snapping shrimp crackle (high, bright, constant)
    const cr = ctx.createBufferSource();
    cr.buffer = this._crackleBuffer(7); cr.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800; hp.Q.value = 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 11000;
    const cg = ctx.createGain(); cg.gain.value = 0.4;
    // very slow density drift so it never sounds like a loop
    const drift = ctx.createOscillator(); drift.frequency.value = 0.031;
    const driftG = ctx.createGain(); driftG.gain.value = 0.12;
    drift.connect(driftG).connect(cg.gain);
    cr.connect(hp).connect(lp).connect(cg).connect(this.master);
    cr.start(now); drift.start(now);

    // 2) low ocean presence: deep, steady, no wave rhythm
    const lo = this._noiseSource();
    const l1 = ctx.createBiquadFilter(); l1.type = 'lowpass'; l1.frequency.value = 160; l1.Q.value = 0.5;
    const l2 = ctx.createBiquadFilter(); l2.type = 'lowpass'; l2.frequency.value = 160; l2.Q.value = 0.5;
    const lg = ctx.createGain(); lg.gain.value = 0.32;
    lo.connect(l1).connect(l2).connect(lg).connect(this.master);
    lo.start(now);

    // 3) faint mid "hush" of the water body
    const mid = this._noiseSource();
    const mb = ctx.createBiquadFilter(); mb.type = 'bandpass'; mb.frequency.value = 500; mb.Q.value = 0.6;
    const mg = ctx.createGain(); mg.gain.value = 0.015;
    mid.connect(mb).connect(mg).connect(this.master);
    mid.start(now);
  }

  _panner(p) {
    if (!this.ctx.createStereoPanner) return null;
    const s = this.ctx.createStereoPanner(); s.pan.value = p; return s;
  }

  _out(node, pan, bus) {
    const p = this._panner(pan);
    if (p) node.connect(p).connect(bus); else node.connect(bus);
  }

  _bubble(t, vol, f0, bus) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const dur = 0.04 + Math.random() * 0.07;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * (1.5 + Math.random()), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // ---------- effects (muffled, heard from inside the water) ----------
  plop() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    for (let i = 0; i < 6; i++) {
      const t = ctx.currentTime + i * (0.03 + Math.random() * 0.06);
      const o = ctx.createOscillator();
      const f = 380 + Math.random() * 300;
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 1.9, t + 0.05);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(g).connect(this.fx);
      o.start(t); o.stop(t + 0.1);
    }
  }

  eat() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = this._noiseSource();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    s.connect(bp).connect(g).connect(this.fx);
    s.start(t, Math.random() * 3); s.stop(t + 0.05);
  }

  waterChange() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noiseSource();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.8;
    lp.frequency.setValueAtTime(250, t);
    lp.frequency.exponentialRampToValueAtTime(900, t + 1.0);
    lp.frequency.exponentialRampToValueAtTime(300, t + 3.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.5);
    g.gain.setValueAtTime(0.5, t + 2.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
    n.connect(lp).connect(g).connect(this.fx);
    n.start(t); n.stop(t + 3.5);
    for (let i = 0; i < 45; i++) this._bubble(t + 0.3 + Math.random() * 2.6, 0.06 + Math.random() * 0.06, 150 + Math.random() * 400, this.fx);
  }
}
