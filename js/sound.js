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

    // 1) flowing water placed all around the listener (3D, HRTF for headphones)
    //    each spot swells on its own, so currents seem to pass from different directions
    const spots = [
      { p: [-7, 2.5, 1], f: [0.047, 0.071], band: false },
      { p: [7, 3.0, 0], f: [0.053, 0.083], band: false },
      { p: [0, 3.5, -8], f: [0.041, 0.097], band: true },
      { p: [-4, 6.5, -3], f: [0.059, 0.031], band: true },
      { p: [5, 1.0, 6], f: [0.067, 0.037], band: true },
    ];
    spots.forEach((sp, i) => {
      const s = src(i * 1.73);
      const f1 = ctx.createBiquadFilter();
      if (sp.band) {
        f1.type = 'bandpass'; f1.frequency.value = 330 + i * 40; f1.Q.value = 1.0;
        this._swell(f1.frequency, 140, [sp.f[1] * 0.8, sp.f[0] * 1.3]);
      } else {
        f1.type = 'lowpass'; f1.frequency.value = 560; f1.Q.value = 0.4;
      }
      const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 1000; f2.Q.value = 0.3;
      const g = ctx.createGain(); g.gain.value = sp.band ? 0.1 : 0.12;
      this._swell(g.gain, sp.band ? 0.08 : 0.09, sp.f);
      const pan = this._panner3D(sp.p, 6, 0.5);
      s.connect(f1).connect(f2).connect(g).connect(pan).connect(this.master);
    });

    // 3) deep pressure of the open water
    const c = src(6.3);
    const cLp = ctx.createBiquadFilter(); cLp.type = 'lowpass'; cLp.frequency.value = 110; cLp.Q.value = 0.6;
    const cG = ctx.createGain(); cG.gain.value = 0.17;
    this._swell(cG.gain, 0.045, [0.029, 0.061]);
    c.connect(cLp).connect(cG).connect(this.master);
  }

  _panner3D(pos, ref = 3, roll = 0.8) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = roll;
    p.maxDistance = 60;
    if (p.positionX) { p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2]; }
    else p.setPosition(pos[0], pos[1], pos[2]);
    return p;
  }

  // Follow the camera: where you look decides where sounds come from
  updateListener(camera) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const L = this.ctx.listener;
    const p = camera.position;
    const e = camera.matrixWorld.elements;
    const fx = -e[8], fy = -e[9], fz = -e[10];   // camera forward
    const ux = e[4], uy = e[5], uz = e[6];       // camera up
    if (L.positionX) {
      const t = this.ctx.currentTime, k = 0.05;
      L.positionX.setTargetAtTime(p.x, t, k); L.positionY.setTargetAtTime(p.y, t, k); L.positionZ.setTargetAtTime(p.z, t, k);
      L.forwardX.setTargetAtTime(fx, t, k); L.forwardY.setTargetAtTime(fy, t, k); L.forwardZ.setTargetAtTime(fz, t, k);
      L.upX.setTargetAtTime(ux, t, k); L.upY.setTargetAtTime(uy, t, k); L.upZ.setTargetAtTime(uz, t, k);
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  // output for an effect at a 3D position (falls back to plain output)
  _fxAt(pos) {
    if (!pos) return this.fx;
    const pan = this._panner3D([pos.x, pos.y, pos.z], 2.5, 1.0);
    pan.connect(this.fx);
    return pan;
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
  plop(pos) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const out = this._fxAt(pos);
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
      o.connect(g).connect(out);
      o.start(t); o.stop(t + 0.1);
    }
  }

  eat(pos) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._fxAt(pos);
    const s = this._noiseSource();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    s.connect(bp).connect(g).connect(out);
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
