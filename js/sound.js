// Aquarium sounds synthesized with the Web Audio API (no audio files needed)
// - filter pump hum, water trickle, air-stone bubbles (ambience)
// - effects: food plop, eating, water change

const PREF = 'ore-no-suizokukan.sound';

export class AquariumSound {
  constructor() {
    let on = true;
    try { on = localStorage.getItem(PREF) !== 'off'; } catch {}
    this.enabled = on;
    this.ctx = null;
    this.master = null;
    this.timer = null;
  }

  // Must be called from a user gesture (iPhone requirement)
  start() {
    if (!this.enabled) return;
    if (this.ctx) { this.resume(); return; }
    try {
      // play even when the iPhone ringer switch is on silent (iOS 17+)
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch {}
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    this.noise = this._noiseBuffer(4);
    this._ambience();
    this.master.gain.linearRampToValueAtTime(2.2, this.ctx.currentTime + 2.5);
    this._startBubbles();
  }

  resume() {
    if (!this.ctx || !this.enabled) return;
    if (this.ctx.state !== 'running') this.ctx.resume();
    if (!this.timer) this._startBubbles();
  }

  suspend() {
    if (!this.ctx) return;
    clearInterval(this.timer); this.timer = null;
    this.ctx.suspend();
  }

  setEnabled(on) {
    this.enabled = on;
    try { localStorage.setItem(PREF, on ? 'on' : 'off'); } catch {}
    if (on) {
      if (!this.ctx) this.start();
      else { this.resume(); this.master.gain.setTargetAtTime(2.2, this.ctx.currentTime, 0.3); }
    } else if (this.ctx) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
      setTimeout(() => { if (!this.enabled) this.suspend(); }, 800);
    }
  }

  _noiseBuffer(sec) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  _noiseSource() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.loopStart = Math.random();
    return s;
  }

  _ambience() {
    const ctx = this.ctx, now = ctx.currentTime;

    // 1) filter pump: low rumble + faint motor hum
    const rumble = this._noiseSource();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140; lp.Q.value = 0.7;
    const rg = ctx.createGain(); rg.gain.value = 0.22;
    rumble.connect(lp).connect(rg).connect(this.master);
    rumble.start(now);
    for (const [f, g] of [[100, 0.012], [200, 0.005], [300, 0.002]]) {
      const o = ctx.createOscillator(); o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = g;
      o.connect(og).connect(this.master); o.start(now);
    }

    // 2) water trickle from the filter outlet: band-passed noise with slow wobble
    const tr = this._noiseSource();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.9;
    const tg = ctx.createGain(); tg.gain.value = 0.06;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.23;
    const lfoG = ctx.createGain(); lfoG.gain.value = 260;
    lfo.connect(lfoG).connect(bp.frequency);
    const amp = ctx.createOscillator(); amp.frequency.value = 0.41;
    const ampG = ctx.createGain(); ampG.gain.value = 0.02;
    amp.connect(ampG).connect(tg.gain);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { pan.pan.value = -0.35; tr.connect(bp).connect(tg).connect(pan).connect(this.master); }
    else tr.connect(bp).connect(tg).connect(this.master);
    tr.start(now); lfo.start(now); amp.start(now);

    // 3) high sparkle of moving water
    const sp = this._noiseSource();
    const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 3200; hp.Q.value = 1.5;
    const sg = ctx.createGain(); sg.gain.value = 0.012;
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.13;
    const lfo2G = ctx.createGain(); lfo2G.gain.value = 0.008;
    lfo2.connect(lfo2G).connect(sg.gain);
    sp.connect(hp).connect(sg).connect(this.master);
    sp.start(now); lfo2.start(now);

    // bubbles bus (air stone on the right side)
    this.bubbleBus = ctx.createGain();
    this.bubbleBus.gain.value = 0.55;
    const bbp = ctx.createBiquadFilter(); bbp.type = 'highpass'; bbp.frequency.value = 180;
    if (ctx.createStereoPanner) {
      const bpan = ctx.createStereoPanner(); bpan.pan.value = 0.4;
      this.bubbleBus.connect(bbp).connect(bpan).connect(this.master);
    } else this.bubbleBus.connect(bbp).connect(this.master);
  }

  // one small bubble "blip": a short rising sine
  _bubble(t, vol, f0) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const dur = 0.035 + Math.random() * 0.05;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * (1.8 + Math.random() * 1.4), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.bubbleBus);
    o.start(t); o.stop(t + dur + 0.02);
  }

  _startBubbles() {
    clearInterval(this.timer);
    let next = this.ctx.currentTime + 0.1;
    let burst = 0;
    this.timer = setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const horizon = this.ctx.currentTime + 0.25;
      if (next < this.ctx.currentTime) next = this.ctx.currentTime + 0.02;
      while (next < horizon) {
        // air stone: steady stream with little bursts
        if (burst <= 0 && Math.random() < 0.08) burst = 4 + Math.floor(Math.random() * 8);
        const big = Math.random() < 0.15;
        this._bubble(next, big ? 0.09 : 0.035 + Math.random() * 0.03, big ? 220 + Math.random() * 200 : 450 + Math.random() * 700);
        const gap = burst > 0 ? 0.015 + Math.random() * 0.03 : 0.04 + Math.random() * 0.12;
        burst--;
        next += gap;
      }
    }, 100);
  }

  // ---- effects ----
  plop() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    for (let i = 0; i < 5; i++) {
      const t = ctx.currentTime + i * (0.03 + Math.random() * 0.05);
      const o = ctx.createOscillator();
      const f = 700 + Math.random() * 500;
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.35, t + 0.07);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + 0.12);
    }
  }

  eat() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(1500, t);
    o.frequency.exponentialRampToValueAtTime(600, t + 0.03);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.06);
  }

  waterChange() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noiseSource();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(2200, t + 1.2);
    lp.frequency.exponentialRampToValueAtTime(500, t + 3.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.4);
    g.gain.setValueAtTime(0.35, t + 2.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
    n.connect(lp).connect(g).connect(this.master);
    n.start(t); n.stop(t + 3.5);
    // extra bubbles while pouring
    for (let i = 0; i < 40; i++) this._bubble(t + 0.3 + Math.random() * 2.6, 0.05 + Math.random() * 0.05, 250 + Math.random() * 600);
  }
}
