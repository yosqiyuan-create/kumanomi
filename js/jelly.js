// Jellyfish viewing tank: one species per tank, switchable; procedural bells, verlet tentacles and arms
import * as THREE from 'three';
import { OrbitControls } from '../lib/addons/controls/OrbitControls.js';
import { shared, makeParticles } from './env.js';
import { SPECIES } from './jellies/index.js';

export const LIGHTS = {
  blue: { label: '青', top: '#0a3a8c', bot: '#010410', rim: '#86b8ff' },
  purple: { label: '紫', top: '#3c1474', bot: '#05020e', rim: '#d0a2ff' },
  rainbow: { label: '虹', top: '#0a3a8c', bot: '#010410', rim: '#ffffff' },
  white: { label: '白', top: '#1c4058', bot: '#02070b', rim: '#ffffff' },
};

const PREF = 'ore-no-suizokukan.jelly';
const UP = new THREE.Vector3(0, 1, 0);
const R_TANK = 2.6, Y_MIN = 0.7, Y_MAX = 5.6;

// ---------- bell ----------
function bellGeometry(height, flare) {
  const pts = [];
  const N = 34;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const th = t * (Math.PI / 2) * flare;
    pts.push(new THREE.Vector2(Math.max(0.0005, Math.sin(th)), Math.cos(th) * height));
  }
  // curled lip under the rim
  const last = pts[pts.length - 1];
  pts.push(new THREE.Vector2(last.x * 0.985, last.y - 0.035));
  pts.push(new THREE.Vector2(last.x * 0.94, last.y - 0.045));
  const g = new THREE.LatheGeometry(pts, 96);
  g.computeVertexNormals();
  return g;
}

const BELL_VS = /* glsl */`
uniform float uTime; uniform float uPulse; uniform float uPhase; uniform float uContract; uniform float uLobes;
varying vec3 vN; varying vec3 vView; varying vec3 vLocal; varying float vT;
#include <common>
#include <fog_pars_vertex>
float pf(float ph){ ph = fract(ph); return ph < 0.28 ? sin(ph / 0.28 * 1.5708) : 1.0 - smoothstep(0.28, 1.0, ph); }
void main(){
  float t = uv.y;
  vec3 p = position;
  float k = smoothstep(0.1, 1.0, t);
  float c = pf(uPhase - t * 0.18);             // contraction wave runs from the top to the margin
  float ang = atan(p.z, p.x);
  // eight shallow lobes with small notches at the margin
  float lobe = 1.0 - pow(abs(sin(ang * uLobes * 0.5)), 6.0);
  p.xz *= 1.0 - 0.035 * (1.0 - lobe) * k * k * k;
  p.xz *= 1.0 - uContract * c * k;
  p.y *= 1.0 + 0.7 * uContract * c;
  p.y += 0.012 * sin(ang * 8.0 + uTime * 2.0) * k * k + 0.02 * c * k * k * k;
  vLocal = position; vT = t;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  vView = -mvPosition.xyz;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const BELL_FS = /* glsl */`
uniform vec3 uColor; uniform vec3 uPat; uniform vec3 uRim; uniform float uOpacity; uniform float uRimStr; uniform int uPattern; uniform float uPulse;
varying vec3 vN; varying vec3 vView; varying vec3 vLocal; varying float vT;
#include <common>
#include <fog_pars_fragment>
float h31(vec3 c){ return fract(sin(dot(c, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main(){
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 2.2);
  vec3 col = uColor; float a = uOpacity;
  vec2 q = vLocal.xz;
  if (uPattern == 1) {            // Aurelia aurita
    float r = length(q);
    float ang = atan(q.y, q.x);
    // four horseshoe-shaped gonads, open side toward the centre
    float m = 0.0, pouch = 0.0;
    for (int k = 0; k < 4; k++) {
      float an = float(k) * 1.5708 + 0.7854;
      vec2 c = vec2(cos(an), sin(an)) * 0.29;
      vec2 d = q - c;
      float rr = length(d);
      float band = smoothstep(0.07, 0.015, abs(rr - 0.105));
      float facing = dot(normalize(d + 1e-5), -normalize(c));      // 1 = toward centre
      band *= smoothstep(0.9, 0.5, facing);                        // gap -> horseshoe
      band *= 0.7 + 0.3 * sin(atan(d.y, d.x) * 16.0 + rr * 60.0);  // folded, frilly tissue
      m = max(m, band);
      pouch = max(pouch, smoothstep(0.12, 0.05, rr) * 0.35);
    }
    m *= 1.0 - smoothstep(0.32, 0.55, vT);
    // branching radial canals + ring canal
    float wob = sin(r * 22.0 + ang * 3.0) * 0.015;
    float c8 = smoothstep(0.965, 1.0, abs(cos((ang + wob) * 8.0)));
    float c16 = smoothstep(0.975, 1.0, abs(cos((ang + wob) * 16.0 + 1.5708))) * smoothstep(0.5, 0.75, r);
    float canals = max(c8, c16) * smoothstep(0.38, 0.6, r);
    float ring = smoothstep(0.025, 0.0, abs(vT - 0.93));
    col = mix(col, uPat, m * 0.8);
    col = mix(col, uPat * 0.9 + 0.1, pouch * 0.6);
    float top = 1.0 - smoothstep(0.55, 0.95, vT);                 // canals show mainly from above
    a += m * 0.32 + pouch * 0.08 + (canals * 0.12 * top + ring * 0.22) * (1.0 - m);
    col += vec3(0.5) * (canals * 0.18 * top + ring * 0.35);
    // soft milky thickness that varies across the jelly
    a += 0.05 * sin(q.x * 17.0) * sin(q.y * 15.0);
  } else if (uPattern == 2) {     // Mastigias: white spots
    vec3 sp = vLocal * 6.0;
    vec3 cell = floor(sp); vec3 f = fract(sp) - 0.5;
    float h = h31(cell);
    vec3 off = (vec3(h, fract(h * 7.31), fract(h * 3.17)) - 0.5) * 0.45;
    float s = smoothstep(0.24, 0.17, length(f - off)) * step(0.22, h);
    col = mix(col * (0.85 + 0.3 * vT), uPat, s); a = mix(a, 0.97, s);
  }
  col += uRim * fres * uRimStr * (0.8 + 0.4 * uPulse);
  a = clamp(a + fres * uRimStr * 0.55, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// ---------- verlet chain ----------
class Chain {
  constructor(n, segLen, start) {
    this.n = n; this.seg = segLen;
    this.p = []; this.o = [];
    for (let i = 0; i < n; i++) {
      const v = start.clone(); v.y -= i * segLen;
      this.p.push(v); this.o.push(v.clone());
    }
  }
  update(root, dt, gravity, drag, flow) {
    this.p[0].copy(root); this.o[0].copy(root);
    const g = gravity * dt * dt;
    for (let i = 1; i < this.n; i++) {
      const p = this.p[i], o = this.o[i];
      const vx = (p.x - o.x) * drag, vy = (p.y - o.y) * drag, vz = (p.z - o.z) * drag;
      o.copy(p);
      p.x += vx + flow.x * dt; p.y += vy - g + flow.y * dt; p.z += vz + flow.z * dt;
    }
    for (let it = 0; it < 2; it++) {
      for (let i = 1; i < this.n; i++) {
        const a = this.p[i - 1], b = this.p[i];
        let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-5;
        const k = this.seg / d;
        b.x = a.x + dx * k; b.y = a.y + dy * k; b.z = a.z + dz * k;
      }
    }
  }
}

const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- one species tank ----------
class Population {
  constructor(scene, cfg, rimColor) {
    this.cfg = cfg;
    this.group = new THREE.Group();
    scene.add(this.group);
    const bc = cfg.bell;
    const geo = bellGeometry(bc.height, bc.flare);
    const baseMat = new THREE.ShaderMaterial({
      vertexShader: BELL_VS, fragmentShader: BELL_FS,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 }, uPulse: { value: 0 }, uPhase: { value: 0 }, uContract: { value: cfg.pulse.contract }, uLobes: { value: cfg.bell.lobes || 0 },
        uColor: { value: new THREE.Color(bc.color) }, uPat: { value: new THREE.Color(bc.patternColor) },
        uRim: { value: rimColor.clone() }, uOpacity: { value: bc.opacity }, uRimStr: { value: bc.rim },
        uPattern: { value: bc.pattern === 'rings' ? 1 : bc.pattern === 'spots' ? 2 : 0 },
      }]),
    });
    this.jellies = [];
    for (let i = 0; i < cfg.count; i++) {
      const R = rnd(cfg.size[0], cfg.size[1]);
      const mat = baseMat.clone();
      mat.uniforms.uTime = shared.uTime;
      mat.uniforms.uRim.value = rimColor.clone();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 3;
      mesh.scale.setScalar(R);
      this.group.add(mesh);
      let inner = null;
      if (bc.inner) {
        const im = mat.clone();
        im.uniforms.uTime = shared.uTime;
        im.uniforms.uOpacity.value = bc.opacity * bc.inner;
        im.uniforms.uPattern.value = 0;
        im.uniforms.uRimStr.value = bc.rim * 0.5;
        im.uniforms.uRim.value = rimColor.clone();
        inner = new THREE.Mesh(geo, im);
        inner.scale.set(0.9, 0.8, 0.9);
        inner.position.y = -0.03;
        inner.renderOrder = 2;
        mesh.add(inner);
      }
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R_TANK * 0.85;
      const j = {
        mesh, R, mat, inner,
        pos: new THREE.Vector3(Math.cos(a) * r, rnd(Y_MIN + 0.5, Y_MAX - 0.5), Math.sin(a) * r),
        vel: new THREE.Vector3(),
        up: new THREE.Vector3(rnd(-0.3, 0.3), 1, rnd(-0.3, 0.3)).normalize(),
        wander: new THREE.Vector3(rnd(-1, 1), 0, rnd(-1, 1)),
        period: rnd(cfg.pulse.period[0], cfg.pulse.period[1]),
        phase: Math.random(),
        pulse: 0,
        targetY: rnd(Y_MIN + 0.3, Y_MAX - 0.6),
        retarget: rnd(5, 20),
      };
      mesh.position.copy(j.pos);
      mesh.quaternion.setFromUnitVectors(UP, j.up);
      // tentacles from the rim
      j.tents = [];
      if (cfg.tentacles) {
        const tc = cfg.tentacles;
        for (let k = 0; k < tc.count; k++) j.tents.push(new Chain(tc.segments, tc.length * R / tc.segments * 1.6, j.pos));
      }
      // oral arms from under the bell
      j.arms = [];
      const ac = cfg.arms;
      for (let k = 0; k < ac.count; k++) j.arms.push(new Chain(ac.segments, ac.length * R / ac.segments * 1.7, j.pos));
      this.jellies.push(j);
    }

    // tentacle lines (all jellies in one draw)
    if (cfg.tentacles) {
      const tc = cfg.tentacles;
      const nSeg = cfg.count * tc.count * (tc.segments - 1);
      this.linePos = new Float32Array(nSeg * 2 * 3);
      const lcol = new Float32Array(nSeg * 2 * 3);
      let w = 0;
      for (let j = 0; j < cfg.count; j++) for (let k = 0; k < tc.count; k++) {
        const bright = 0.6 + 0.4 * Math.random();
        for (let sgi = 1; sgi < tc.segments; sgi++) {
          for (const e of [sgi - 1, sgi]) {
            const f = bright * Math.pow(1 - e / (tc.segments - 1), 1.3);
            lcol[w++] = f; lcol[w++] = f; lcol[w++] = f;
          }
        }
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3).setUsage(THREE.DynamicDrawUsage));
      lg.setAttribute('color', new THREE.BufferAttribute(lcol, 3));
      this.lineMat = new THREE.LineBasicMaterial({ color: new THREE.Color(tc.color), vertexColors: true, transparent: true, opacity: tc.opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
      this.lines = new THREE.LineSegments(lg, this.lineMat);
      this.lines.frustumCulled = false;
      this.lines.renderOrder = 1;
      scene.add(this.lines);
    }

    // oral arms
    const ac = cfg.arms;
    if (ac.style === 'ribbon') this._buildRibbons(scene);
    else this._buildBeads(scene);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3();
    this._v = new THREE.Vector3(); this._d = new THREE.Vector3(); this._flow = new THREE.Vector3();
    this._t1 = new THREE.Vector3(); this._t2 = new THREE.Vector3(); this._rad = new THREE.Vector3();
  }

  // Aurelia oral arms: long, folded (gutter-shaped) curtains with densely ruffled, whitish edges
  _buildRibbons(scene) {
    const cfg = this.cfg, ac = cfg.arms;
    this.ROWS = 44; this.COLS = 9;
    const arms = cfg.count * ac.count;
    const vPer = this.ROWS * this.COLS;
    this.ribPos = new Float32Array(arms * vPer * 3);
    const col = new Float32Array(arms * vPer * 4);
    const idx = [];
    const base = new THREE.Color(ac.color);
    for (let a = 0; a < arms; a++) {
      for (let r = 0; r < this.ROWS; r++) {
        const f = r / (this.ROWS - 1);
        for (let c = 0; c < this.COLS; c++) {
          const u = c / (this.COLS - 1) * 2 - 1;          // -1 .. 1 across the arm
          const edge = Math.pow(Math.abs(u), 3);           // 0 middle, 1 at the frilled edges
          const k = (a * vPer + r * this.COLS + c) * 4;
          const wv = 0.55 + 0.45 * edge;
          col[k] = base.r * wv + 0.2 * edge; col[k + 1] = base.g * wv + 0.2 * edge; col[k + 2] = base.b * wv + 0.2 * edge;
          col[k + 3] = ac.opacity * (0.18 + 0.82 * edge) * (1 - Math.pow(f, 2.2) * 0.85) * Math.min(1, r / 2 + 0.3);
          if (r < this.ROWS - 1 && c < this.COLS - 1) {
            const i0 = a * vPer + r * this.COLS + c;
            idx.push(i0, i0 + this.COLS, i0 + 1, i0 + 1, i0 + this.COLS, i0 + this.COLS + 1);
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.ribPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    g.setIndex(idx);
    this.ribMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: true });
    this.ribbons = new THREE.Mesh(g, this.ribMat);
    this.ribbons.frustumCulled = false;
    this.ribbons.renderOrder = 1;
    scene.add(this.ribbons);
    this._cp = new THREE.Vector3(); this._cq = new THREE.Vector3();
  }

  _buildBeads(scene) {
    const cfg = this.cfg, ac = cfg.arms;
    const beads = cfg.count * ac.count * (ac.segments - 1);
    const armMat = new THREE.MeshStandardMaterial({
      color: '#ffffff', roughness: 0.5, transparent: ac.opacity < 1, opacity: ac.opacity,
      emissive: new THREE.Color(ac.color).multiplyScalar(0.25), depthWrite: ac.opacity >= 0.9,
    });
    this.armMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), armMat, beads);
    this.armMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.armMesh.frustumCulled = false;
    this.armMesh.renderOrder = 2;
    const c = new THREE.Color(ac.color), c2 = new THREE.Color();
    let k = 0;
    for (let j = 0; j < cfg.count; j++) for (let a = 0; a < ac.count; a++) for (let s = 1; s < ac.segments; s++) {
      this.armMesh.setColorAt(k++, c2.copy(c).multiplyScalar(0.85 + 0.3 * Math.random()));
    }
    scene.add(this.armMesh);
    if (ac.club) {
      this.clubMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshStandardMaterial({
        color: ac.club.color, roughness: 0.4, emissive: new THREE.Color(ac.club.color).multiplyScalar(0.3),
      }), cfg.count * ac.count);
      this.clubMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.clubMesh.frustumCulled = false;
      scene.add(this.clubMesh);
    }
  }

  setRim(color) {
    for (const j of this.jellies) { j.mat.uniforms.uRim.value.copy(color); if (j.inner) j.inner.material.uniforms.uRim.value.copy(color); }
    if (this.lineMat && this.cfg.id === 'mizukurage') this.lineMat.color.copy(color).lerp(new THREE.Color('#ffffff'), 0.5);
  }

  dispose(scene) {
    scene.remove(this.group);
    for (const j of this.jellies) { j.mat.dispose(); if (j.inner) j.inner.material.dispose(); }
    if (this.lines) { scene.remove(this.lines); this.lines.geometry.dispose(); this.lineMat.dispose(); }
    if (this.armMesh) { scene.remove(this.armMesh); this.armMesh.dispose(); }
    if (this.ribbons) { scene.remove(this.ribbons); this.ribbons.geometry.dispose(); this.ribMat.dispose(); }
    if (this.clubMesh) { scene.remove(this.clubMesh); this.clubMesh.dispose(); }
  }

  update(dt, t) {
    const cfg = this.cfg, ac = cfg.arms, tc = cfg.tentacles;
    const m = this._m, q = this._q, sc = this._s, v = this._v, d = this._d, flow = this._flow;
    let li = 0, ai = 0, ci = 0;
    for (const j of this.jellies) {
      // pulse: quick contraction, slow relaxation; thrust at each contraction
      const prev = j.phase;
      j.phase = (j.phase + dt / j.period) % 1;
      // each jelly drifts toward its own preferred depth: weak pulses let it sink, strong ones lift it
      j.retarget -= dt;
      if (j.retarget < 0) { j.targetY = rnd(Y_MIN + 0.3, Y_MAX - 0.6); j.retarget = rnd(10, 25); }
      const climb = THREE.MathUtils.clamp((j.targetY - j.pos.y) * 0.8 + 0.5, 0.15, 1.2);
      if (j.phase < prev) j.vel.addScaledVector(j.up, cfg.pulse.thrust * climb * (0.8 + 0.4 * Math.random()));
      const p = j.phase;
      j.pulse = p < 0.28 ? Math.sin(p / 0.28 * Math.PI / 2) : 1 - THREE.MathUtils.smoothstep(p, 0.28, 1.0);
      j.mat.uniforms.uPulse.value = j.pulse;
      j.mat.uniforms.uPhase.value = j.phase;
      if (j.inner) { j.inner.material.uniforms.uPulse.value = j.pulse; j.inner.material.uniforms.uPhase.value = j.phase; }

      // gentle circular current + keep inside the tank
      const rr = Math.hypot(j.pos.x, j.pos.z);
      flow.set(-j.pos.z, 0, j.pos.x).multiplyScalar(0.045 / Math.max(0.6, rr));
      j.wander.x += (Math.random() - 0.5) * dt * 0.6; j.wander.z += (Math.random() - 0.5) * dt * 0.6;
      j.wander.clampLength(0, 1);
      d.set(j.wander.x * 0.35, 1, j.wander.z * 0.35);
      if (rr > R_TANK * 0.75) { d.x -= j.pos.x / rr * 0.9; d.z -= j.pos.z / rr * 0.9; }
      if (j.pos.y > Y_MAX - 0.3) d.y = 0.2;             // lean away near the top
      if (j.pos.y < Y_MIN + 0.4) d.y = 1.6;
      d.normalize();
      j.up.lerp(d, Math.min(1, dt * 0.35)).normalize();

      j.vel.multiplyScalar(Math.exp(-dt * 1.4));
      j.vel.y -= cfg.sink * dt;
      j.pos.addScaledVector(j.vel, dt).addScaledVector(flow, dt);
      if (j.pos.y < Y_MIN) j.pos.y = Y_MIN;
      j.mesh.position.copy(j.pos);
      j.mesh.quaternion.setFromUnitVectors(UP, j.up);
      j.mesh.updateMatrixWorld();

      const R = j.R, contract = 1 - cfg.pulse.contract * j.pulse;
      // tentacles hang from the rim
      if (tc) {
        const rimY = Math.cos(Math.PI / 2 * cfg.bell.flare) * cfg.bell.height - 0.04;
        for (let k = 0; k < j.tents.length; k++) {
          const ang = k / j.tents.length * Math.PI * 2;
          v.set(Math.cos(ang) * 0.96 * contract, rimY, Math.sin(ang) * 0.96 * contract).applyMatrix4(j.mesh.matrixWorld);
          const ch = j.tents[k];
          ch.update(v, dt, 0.35, 0.93, flow);
          for (let s = 1; s < ch.n; s++) {
            const a = ch.p[s - 1], b = ch.p[s];
            this.linePos[li++] = a.x; this.linePos[li++] = a.y; this.linePos[li++] = a.z;
            this.linePos[li++] = b.x; this.linePos[li++] = b.y; this.linePos[li++] = b.z;
          }
        }
      }
      // oral arms
      for (let k = 0; k < j.arms.length; k++) {
        const ang = k / j.arms.length * Math.PI * 2 + 0.4;
        const rootR = this.ribbons ? 0.17 : 0.12;
        v.set(Math.cos(ang) * rootR, cfg.bell.height * 0.1, Math.sin(ang) * rootR).applyMatrix4(j.mesh.matrixWorld);
        const ch = j.arms[k];
        if (this.ribbons) {
          this._rad.set(Math.cos(ang), 0, Math.sin(ang)).applyQuaternion(j.mesh.quaternion);
          this._t2.copy(flow).addScaledVector(this._rad, 0.05);
          ch.update(v, dt, 0.45, 0.88, this._t2);
        } else ch.update(v, dt, 0.5, 0.9, flow);
        if (this.ribbons) {
          const rad = this._rad.set(Math.cos(ang), 0, Math.sin(ang)).applyQuaternion(j.mesh.quaternion);
          const P = this.ribPos, ROWS = this.ROWS, COLS = this.COLS;
          const armIdx = this.jellies.indexOf(j) * ac.count + k;
          const len = ac.length * R;
          const cp = this._cp, cq = this._cq;
          for (let r = 0; r < ROWS; r++) {
            const f = r / (ROWS - 1);
            // smooth point along the chain
            const fi = f * (ch.n - 1), i0 = Math.min(ch.n - 2, Math.floor(fi)), w0 = fi - i0;
            cp.lerpVectors(ch.p[i0], ch.p[i0 + 1], w0);
            d.subVectors(ch.p[i0 + 1], ch.p[i0]).normalize();
            const t1 = this._t1.copy(rad).addScaledVector(d, -rad.dot(d)).normalize();   // across the arm
            const t2 = this._t2.crossVectors(d, t1).normalize();                         // depth of the fold
            const width = R * ac.radius[0] * (1.15 - 0.8 * f) * (1 + 0.12 * Math.sin(f * 5 + t * 0.7 + k));
            const sway = R * 0.04 * Math.sin(f * 4 + t * 0.9 + k * 1.7) * f;
            for (let c = 0; c < COLS; c++) {
              const u = c / (COLS - 1) * 2 - 1;
              const au = Math.abs(u);
              // gutter-shaped fold, and many small ruffles along both edges
              const fold = (u * u - 0.35) * width * 0.55;
              const ruf = Math.pow(au, 2.5) * width * 0.38 * Math.sin(f * len / R * 34 + u * 2 + t * 1.3 + k * 3);
              const ruf2 = Math.pow(au, 3) * width * 0.18 * Math.sin(f * len / R * 71 - t * 0.8 + k);
              cq.copy(cp)
                .addScaledVector(t1, u * width + sway)
                .addScaledVector(t2, fold + ruf + ruf2)
                .addScaledVector(d, ruf * 0.25);
              const o = ((armIdx * ROWS + r) * COLS + c) * 3;
              P[o] = cq.x; P[o + 1] = cq.y; P[o + 2] = cq.z;
            }
          }
          continue;
        }
        for (let s = 1; s < ch.n; s++) {
          const a = ch.p[s - 1], b = ch.p[s];
          d.subVectors(b, a);
          const len = d.length() || 1e-4;
          q.setFromUnitVectors(UP, d.divideScalar(len));
          const f = (s - 1) / (ch.n - 2);
          const rad = R * THREE.MathUtils.lerp(ac.radius[0], ac.radius[1], f) * (1 + 0.25 * Math.sin(s * 2.3 + t * 1.5 + k));
          v.addVectors(a, b).multiplyScalar(0.5);
          m.compose(v, q, sc.set(rad, len * 0.75, rad * (ac.club ? 1 : 0.55)));
          this.armMesh.setMatrixAt(ai++, m);
        }
        if (this.clubMesh) {
          const tip = ch.p[ch.n - 1];
          const cs = R * ac.club.size;
          m.compose(tip, q, sc.set(cs * 0.8, cs * 1.5, cs * 0.8));
          this.clubMesh.setMatrixAt(ci++, m);
        }
      }
    }
    if (this.lines) this.lines.geometry.attributes.position.needsUpdate = true;
    if (this.armMesh) {
      this.armMesh.instanceMatrix.needsUpdate = true;
      if (this.armMesh.instanceColor) this.armMesh.instanceColor.needsUpdate = true;
    }
    if (this.ribbons) this.ribbons.geometry.attributes.position.needsUpdate = true;
    if (this.clubMesh) this.clubMesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------- tank ----------
export class JellyTank {
  constructor(renderer, particleCount = 200) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2('#020812', 0.07);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 100);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    Object.assign(this.controls, { enablePan: false, enableRotate: false, enableDamping: true, minDistance: 3, maxDistance: 12, autoRotateSpeed: 0.35 });
    this.controls.target.set(0, 3.1, 0);
    this.controls.enabled = false;

    // background gradient (light colour)
    this.bgU = { uTop: { value: new THREE.Color() }, uBot: { value: new THREE.Color() } };
    const bg = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: this.bgU,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uTop; uniform vec3 uBot; varying vec3 vD;
        void main(){ float y = vD.y; vec3 c = mix(uBot, uTop, smoothstep(-0.4, 0.75, y)); c += uTop * pow(max(y,0.0), 5.0) * 0.8;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    bg.frustumCulled = false;
    this.scene.add(bg);
    this.scene.add(new THREE.HemisphereLight('#bfe6ff', '#0a1020', 1.2));
    const top = new THREE.DirectionalLight('#ffffff', 1.6);
    top.position.set(1, 10, 3);
    this.scene.add(top);
    this.particles = makeParticles(particleCount);
    this.scene.add(this.particles);

    let pref = {};
    try { pref = JSON.parse(localStorage.getItem(PREF) || '{}'); } catch {}
    this.pref = { species: pref.species || SPECIES[0].id, lights: pref.lights || {} };
    this.index = Math.max(0, SPECIES.findIndex((s) => s.id === this.pref.species));
    this.pop = null;
    this.rim = new THREE.Color();
    this.setSpecies(this.index);
  }

  get species() { return SPECIES[this.index]; }
  get lightKey() { return this.pref.lights[this.species.id] || this.species.lights[0]; }

  savePref() { try { localStorage.setItem(PREF, JSON.stringify(this.pref)); } catch {} }

  setSpecies(i) {
    this.index = (i + SPECIES.length) % SPECIES.length;
    this.pref.species = this.species.id;
    this.savePref();
    if (this.pop) this.pop.dispose(this.scene);
    this.pop = new Population(this.scene, this.species, this.rim);
    this.applyLight();
    // let tentacles settle before showing
    for (let k = 0; k < 40; k++) this.pop.update(1 / 30, k / 30);
  }

  nextLight() {
    const L = this.species.lights;
    this.pref.lights[this.species.id] = L[(L.indexOf(this.lightKey) + 1) % L.length];
    this.savePref();
    this.applyLight();
    return LIGHTS[this.lightKey].label;
  }

  applyLight(hue = null) {
    const L = LIGHTS[this.lightKey];
    this.bgU.uTop.value.set(L.top);
    this.bgU.uBot.value.set(L.bot);
    this.rim.set(L.rim);
    if (hue !== null) {
      this.rim.setHSL(hue, 0.85, 0.7);
      this.bgU.uTop.value.setHSL((hue + 0.05) % 1, 0.8, 0.2);
      this.bgU.uBot.value.setHSL((hue + 0.1) % 1, 0.8, 0.02);
    }
    this.scene.fog.color.copy(this.bgU.uBot.value).lerp(this.bgU.uTop.value, 0.3);
    if (this.pop) this.pop.setRim(this.rim);
  }

  setSize(w, h) {
    this.camera.aspect = w / h;
    this.camera.fov = this.camera.aspect < 1 ? 62 : 50;
    this.camera.updateProjectionMatrix();
  }

  resetCamera() {
    const portrait = this.camera.aspect < 1;
    this.controls.target.set(0, 3.1, 0);
    this.camera.position.set(0, 3.4, portrait ? 8.2 : 7.2);
    this.controls.update();
  }

  update(dt) {
    const t = shared.uTime.value;
    if (this.lightKey === 'rainbow') this.applyLight((t * 0.03) % 1);
    this.pop.update(dt, t);
    this.controls.update();
  }
}
