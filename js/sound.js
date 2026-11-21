// Underwater coral-reef soundscape, synthesized with the Web Audio API (no audio files)
// The sound of moving water heard from inside the sea:
//  - deep, muffled flow (no surface waves, no crackle)
//  - a soft current that slowly swells and eases, never rhythmic

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

  // Pink-ish noise (softer than white), separate per channel for width
  _pinkBuffer(sec) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
      // smooth the loop seam
      const fade = Math.floor(ctx.sampleRate * 0.5);
      for (let i = 0; i < fade; i++) {
        const k = i / fade;
        d[len - fade + i] = d[len - fade + i] * (1 - k) + d[i] * k;
      }
    }
    return buf;
  }

  // slow, irregular swell (sum of unrelated slow waves) driving a gain
  _swell(param, depth, freqs) {
    for (const f of freqs) {
      const o = this.ctx.createOscillator(); o.frequency.value = f;
      const g = this.ctx.createGain(); g.gain.value = depth / freqs.length;
      o.connect(g).connect(param);
      o.start();
    }
  }

  _ambience() {
    const ctx = this.ctx, now = ctx.currentTime;
    const pink = this._pinkBuffer(9);
    const src = (offset) => {
      const s = ctx.createBufferSource();
      s.buffer = pink; s.loop = true;
      s.start(now, offset);
      return s;
    };

    // 1) main flow: muffled body of moving water
    const a = src(0);
    const aLp = ctx.createBiquadFilter(); aLp.type = 'lowpass'; aLp.frequency.value = 520; aLp.Q.value = 0.4;
    const aLp2 = ctx.createBiquadFilter(); aLp2.type = 'lowpass'; aLp2.frequency.value = 900; aLp2.Q.value = 0.3;
    const aG = ctx.createGain(); aG.gain.value = 0.1;
    this._swell(aG.gain, 0.04, [0.047, 0.071, 0.113]);
    a.connect(aLp).connect(aLp2).connect(aG).connect(this.master);

    // 2) current brushing past: a soft band that drifts up and down in pitch
    const b = src(3.1);
    const bBp = ctx.createBiquadFilter(); bBp.type = 'bandpass'; bBp.frequency.value = 380; bBp.Q.value = 1.1;
    this._swell(bBp.frequency, 160, [0.037, 0.059, 0.089]);
    const bG = ctx.createGain(); bG.gain.value = 0.06;
    this._swell(bG.gain, 0.038, [0.053, 0.097, 0.031]);
    b.connect(bBp).connect(bG).connect(this.master);

    // 3) deep pressure of the open water
    const c = src(6.3);
    const cLp = ctx.createBiquadFilter(); cLp.type = 'lowpass'; cLp.frequency.value = 110; cLp.Q.value = 0.6;
    const cG = ctx.createGain(); cG.gain.value = 0.17;
    this._swell(cG.gain, 0.045, [0.029, 0.061]);
    c.connect(cLp).connect(cG).connect(this.master);
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
