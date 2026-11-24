// Jellyfish viewing tank: one species per tank, switchable; procedural bells, verlet tentacles and arms
import * as THREE from 'three';
import { OrbitControls } from '../lib/addons/controls/OrbitControls.js';
import { shared, makeParticles } from './env.js';
import { SPECIES } from './jellies/index.js';
import { mergeVertices } from '../lib/addons/utils/BufferGeometryUtils.js';

// Mastigias oral arm: a solid, spongy, frilled block (two tiers) that widens downward and outward.
// Local frame: y goes down from 0 to -H, +x points away from the jelly's centre. Units = bell radius.
const hash3 = (x, y, z) => { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); };
function vnoise(x, y, z) {   // smooth 3D value noise, 0..1
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v),
           L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
function oralArmGeometry(H, color) {
  let g = new THREE.BoxGeometry(1, 1, 1, 18, 44, 10);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const P = g.attributes.position, n = P.count;
  const col = new Float32Array(n * 3), base = new THREE.Color(color), c = new THREE.Color();
  const tier = (s) => 0.75 + 0.25 * Math.sin(Math.min(1, s / 0.55) * Math.PI) * (s < 0.55 ? 1 : 0)
                      + (s >= 0.55 ? 0.8 + 0.25 * Math.sin((s - 0.55) / 0.45 * Math.PI) : 0);
  for (let i = 0; i < n; i++) {
    const bx = P.getX(i) + 0.5, by = P.getY(i), bz = P.getZ(i) * 2;
    const s = 0.5 - by;                                   // 0 top .. 1 bottom
    const out = (0.12 + 0.24 * s) * tier(s);              // outer edge, two frilly tiers
    const xin = -0.04 + 0.03 * s;
    // round off the box: pull corners in
    const ex = Math.abs(bx * 2 - 1), ez = Math.abs(bz);
    const round = 1 - 0.22 * ex * ex * ez * ez;
    let x = xin + (out - xin) * bx;
    let z = bz * (0.08 + 0.09 * s) * round * (0.75 + 0.25 * Math.sin(bx * Math.PI));
    let y = -s * H;
    if (s > 0.8) y -= (s - 0.8) / 0.2 * 0.16 * H * vnoise(x * 18, z * 18, 4.1);   // ragged, frilly lower edge
    // spongy surface: many small bumps and pits
    const sp = vnoise(x * 38, y * 38, z * 38) * 2 - 1;      // irregular sponge lumps
    const bump = sp * 0.7 + (vnoise(x * 110, y * 110, z * 110) * 2 - 1) * 0.5;
    const k = 0.02 * (0.4 + 0.6 * bx);                   // fine sponge, rougher on the outer side
    // frilly, crinkled outer edge
    const frill = Math.pow(bx, 3) * 0.06 * (vnoise(y * 14 + 3, z * 9, 1.7) * 2 - 1);
    x += bump * k * bx + frill; z += bump * k * Math.sign(z || 1) + frill * 0.5; y += bump * k * 0.4;
    P.setXYZ(i, x, y, z);
    c.copy(base).multiplyScalar(0.62 + 0.5 * Math.max(0, bump * 0.5 + 0.5) * (Math.random() < 0.15 ? 0.55 : 1) + 0.08 * s);   // tiny pits read as sponge
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export const LIGHTS = {
  blue: { label: '青', top: '#0a3a8c', bot: '#010410', rim: '#86b8ff' },
  purple: { label: '紫', top: '#3c1474', bot: '#05020e', rim: '#d0a2ff' },
  rainbow: { label: '虹', top: '#0a3a8c', bot: '#010410', rim: '#ffffff' },
  white: { label: '白', top: '#1c4058', bot: '#02070b', rim: '#ffffff' },
};

const PREF = 'ore-no-suizokukan.jelly';
const UP = new THREE.Vector3(0, 1, 0);
// swim area; resized to what the camera sees so jellies fill the whole screen
const B = { rx: 2.6, rz: 2.2, y0: 0.7, y1: 5.6, ver: 0 };
function fitBounds(camera, targetY, dist) {
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
  const halfW = halfH * camera.aspect;
  B.y0 = targetY - halfH * 1.12;
  B.y1 = targetY + halfH * 0.9;
  B.rx = Math.max(1.6, halfW * 1.05);
  B.rz = 2.2;
  B.ver++;
}
// a new spot to drift toward somewhere inside the swim area
function pickTarget(j) {
  // spots lean toward the edges so the whole screen gets used, not just the middle
  j.targetX = Math.sign(Math.random() - 0.5) * Math.pow(Math.random(), 0.6) * 0.92 * B.rx;
  j.targetZ = rnd(-0.8, 0.8) * B.rz;
  const u = Math.random();
  j.targetY = B.y0 + 0.1 + (B.y1 - 0.4 - B.y0) * (u < 0.5 ? Math.pow(2 * u, 0.7) / 2 : 1 - Math.pow(2 - 2 * u, 0.7) / 2);
}
const ell = (p) => Math.hypot(p.x / B.rx, p.z / B.rz);   // 1 = edge of the swim area

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
uniform vec3 uColor; uniform vec3 uPat; uniform vec3 uRim; uniform float uOpacity; uniform float uRimStr; uniform int uPattern; uniform float uPulse; uniform sampler2D uTex; uniform float uVar;
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
  } else if (uPattern == 3) {     // real photo of the bell seen from above (luminance = jelly)
    float lum = texture2D(uTex, q * 0.5 + 0.5).r;
    float r = length(q);
    float gon = smoothstep(0.5, 0.85, lum) * (1.0 - smoothstep(0.32, 0.6, r));
    col = uColor * (0.35 + 1.1 * lum);
    col = mix(col, uPat * (0.6 + 0.6 * lum), gon * 0.55);
    a = uOpacity * 0.3 + pow(lum, 1.5) * 0.95;
  } else if (uPattern == 5) {     // photo strip wrapped around the bell (Mastigias)
    float ang = atan(q.y, q.x);
    vec2 uvp = vec2((ang / 6.28318 + 0.5) * 2.0, clamp((vT - 0.12) / 0.84, 0.0, 1.0));
    vec3 tc = texture2D(uTex, uvp).rgb;
    float lum = dot(tc, vec3(0.333));
    float och = clamp((tc.r - tc.b) * 3.0, 0.0, 1.0);
    col = pow(tc, vec3(0.85)) * 1.45;
    col = mix(col, col * vec3(0.55, 0.38, 0.26), uVar);                 // brown individuals
    float apex = 1.0 - smoothstep(0.06, 0.26, vT);                  // plain clear jelly at the very top
    col = mix(col, vec3(0.80, 0.87, 0.93) * mix(1.0, 0.5, uVar), apex);
    lum = mix(lum, 0.3, apex); och *= 1.0 - apex;
    float spot = smoothstep(0.35, 0.6, lum);
    col = mix(col, vec3(0.97, 0.98, 0.95), spot * 0.5);
    a = 0.3 + spot * 0.7 + och * 0.55 + uVar * 0.35;
  } else if (uPattern == 4) {     // Mastigias papua: clear top, ochre band below, rows of white spots
    float ang = atan(q.y, q.x);
    float band = smoothstep(0.4, 0.55, vT) * (1.0 - smoothstep(0.9, 0.98, vT));
    vec3 top = mix(vec3(0.78, 0.86, 0.93), vec3(0.42, 0.27, 0.15), uVar);
    vec3 ochre = mix(vec3(0.66, 0.42, 0.16), vec3(0.34, 0.20, 0.09), uVar);
    col = mix(top, ochre, band);
    a = mix(uOpacity, 0.78, band) + uVar * 0.45;
    float rf = vT * 11.0; float ri = floor(rf); float rv = fract(rf);
    float n = 4.0 + ri * 3.4;
    float cf = (ang / 6.28318 + 0.5) * n + ri * 0.37;
    float cu = fract(cf);
    float elong = 1.0 + smoothstep(5.0, 10.0, ri) * 1.3;          // longer spots toward the margin
    vec2 dd = vec2(cu - 0.5, (rv - 0.5) / elong);
    float h = fract(sin(dot(vec2(floor(cf), ri), vec2(12.9898, 78.233))) * 43758.5453);
    float rad = 0.3 * (0.7 + 0.35 * h);
    float keep = mix(0.45, 0.1, smoothstep(2.0, 6.0, ri));          // sparser, bigger spots on the clear top
    float spot = smoothstep(rad, rad * 0.72, length(dd)) * step(keep, h) * step(0.5, ri);
    col = mix(col, uPat, spot); a = mix(a, 0.97, spot);
  } else if (uPattern == 6) {     // white-spotted: glowing blue dome, dense small white dots (denser toward the margin)
    float ang = atan(q.y, q.x);
    float rf = vT * 24.0; float ri = floor(rf); float rv = fract(rf);
    float n = 4.0 + ri * 3.9;               // about square cells, so the dots stay round
    float cf = (ang / 6.28318 + 0.5) * n + ri * 0.41;
    float cu = fract(cf);
    float h = fract(sin(dot(vec2(floor(cf), ri), vec2(12.9898, 78.233))) * 43758.5453);
    vec2 dd = vec2(cu - 0.5 + (h - 0.5) * 0.25, rv - 0.5 + (fract(h * 7.1) - 0.5) * 0.25);
    float rad = 0.2 * (0.75 + 0.5 * h);
    float spot = smoothstep(rad, rad * 0.55, length(dd)) * step(0.12, h) * step(1.0, ri);
    float body = 0.55 + 0.45 * smoothstep(0.1, 0.95, vT);         // thicker jelly toward the rim
    col = uColor * (0.75 + 0.5 * vT);
    a = uOpacity * body;
    col = mix(col, uPat, spot); a = mix(a, 0.95, spot);
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
  update(root, dt, gravity, drag, flow, restDir = null, stiff = 0) {
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
    // gently pull back toward the natural hanging shape (keeps arms from sticking out sideways)
    if (restDir && stiff > 0) {
      const k = 1 - Math.exp(-dt * stiff);
      for (let i = 1; i < this.n; i++) {
        const p = this.p[i];
        p.x += (root.x + restDir.x * this.seg * i - p.x) * k;
        p.y += (root.y + restDir.y * this.seg * i - p.y) * k;
        p.z += (root.z + restDir.z * this.seg * i - p.z) * k;
      }
    }
  }

  // smooth point and tangent at f (0..1) along the chain (Catmull-Rom)
  sample(f, outP, outT) {
    const n = this.n, x = f * (n - 1);
    const i = Math.min(n - 2, Math.floor(x)), t = x - i;
    const p0 = this.p[Math.max(0, i - 1)], p1 = this.p[i], p2 = this.p[i + 1], p3 = this.p[Math.min(n - 1, i + 2)];
    const t2 = t * t, t3 = t2 * t;
    for (const c of ['x', 'y', 'z']) {
      outP[c] = 0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3);
      outT[c] = 0.5 * ((-p0[c] + p2[c]) + 2 * (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t + 3 * (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t2);
    }
    outT.normalize();
  }
}

const rnd = (a, b) => a + Math.random() * (b - a);
const texCache = {};
function loadTex(url, srgb = false) {
  if (!texCache[url]) {
    const t = new THREE.TextureLoader().load(url);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;   // real photo colours need sRGB
    if (srgb) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }   // no seam line where the strip wraps
    t.wrapS = THREE.MirroredRepeatWrapping;
    t.anisotropy = 4;
    texCache[url] = t;
  }
  return texCache[url];
}

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
        uPattern: { value: { rings: 1, spots: 2, photo: 3, mastigias: 4, photoStrip: 5, whiteSpot: 6 }[bc.pattern] || 0 },
        uVar: { value: 0 },
        uTex: { value: null },
      }]),
    });
    this.jellies = [];
    for (let i = 0; i < cfg.count; i++) {
      const R = rnd(cfg.size[0], cfg.size[1]);
      const mat = baseMat.clone();
      mat.uniforms.uTime = shared.uTime;
      if (bc.texture) mat.uniforms.uTex.value = loadTex(bc.texture, bc.pattern === 'photoStrip');
      if (bc.brownChance) mat.uniforms.uVar.value = Math.random() < bc.brownChance ? 1 : 0;
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
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.85;
      const j = {
        mesh, R, mat, inner,
        pos: new THREE.Vector3(Math.cos(a) * r * B.rx, rnd(B.y0 + 0.3, B.y1 - 0.3), Math.sin(a) * r * B.rz),
        vel: new THREE.Vector3(),
        up: new THREE.Vector3(rnd(-0.3, 0.3), 1, rnd(-0.3, 0.3)).normalize(),
        wander: new THREE.Vector3(rnd(-1, 1), 0, rnd(-1, 1)),
        period: rnd(cfg.pulse.period[0], cfg.pulse.period[1]),
        phase: Math.random(),
        pulse: 0,
        targetY: 0, targetX: 0, targetZ: 0,
        retarget: rnd(5, 20),
        bver: B.ver,
      };
      pickTarget(j);
      mesh.position.copy(j.pos);
      mesh.quaternion.setFromUnitVectors(UP, j.up);
      // tentacles from the rim
      j.tents = [];
      if (cfg.tentacles) {
        const tc = cfg.tentacles;
        for (let k = 0; k < tc.count; k++) j.tents.push(new Chain(tc.segments, tc.length * R / tc.segments, j.pos));
      }
      // oral arms from under the bell
      j.arms = [];
      const ac = cfg.arms;
      for (let k = 0; k < ac.count; k++) j.arms.push(new Chain(ac.segments, ac.length * R / ac.segments * (ac.style === 'beads' ? 1.7 : 1.0), j.pos));
      j.apps = [];
      if (ac.apps) for (let k = 0; k < ac.count; k++) j.apps.push(new Chain(ac.apps.segments, ac.apps.length * R / ac.apps.segments, j.pos));
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
    else if (ac.style === 'mastigias') this._buildMastigias(scene);
    else this._buildBeads(scene);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3();
    this._v = new THREE.Vector3(); this._d = new THREE.Vector3(); this._flow = new THREE.Vector3();
    this._t1 = new THREE.Vector3(); this._t2 = new THREE.Vector3(); this._rad = new THREE.Vector3();
  }

  // Aurelia oral arms: long, folded (gutter-shaped) curtains with densely ruffled, whitish edges
  _buildRibbons(scene) {
    const cfg = this.cfg, ac = cfg.arms;
    this.ROWS = 60; this.COLS = 11;
    const arms = cfg.count * ac.count;
    const vPer = this.ROWS * this.COLS;
    this.ribPos = new Float32Array(arms * vPer * 3);
    const col = new Float32Array(arms * vPer * 4);
    const idx = [];
    const base = new THREE.Color(ac.color);
    const cream = new THREE.Color(ac.frill || '#fff0d0');
    for (let a = 0; a < arms; a++) {
      for (let r = 0; r < this.ROWS; r++) {
        const f = r / (this.ROWS - 1);
        for (let c = 0; c < this.COLS; c++) {
          const u = c / (this.COLS - 1) * 2 - 1;          // -1 .. 1 across the arm
          const edge = Math.pow(Math.abs(u), 4);           // 0 middle, 1 at the edges
          const frillEdge = u > 0 ? Math.pow(u, 3) * (1 - 0.6 * f) : 0;   // one edge carries the creamy frills
          const k = (a * vPer + r * this.COLS + c) * 4;
          const wv = 0.75 + 0.25 * edge;
          col[k] = base.r * wv + (cream.r - base.r * wv) * frillEdge;
          col[k + 1] = base.g * wv + (cream.g - base.g * wv) * frillEdge;
          col[k + 2] = base.b * wv + (cream.b - base.b * wv) * frillEdge;
          col[k + 3] = ac.opacity * (0.32 + 0.45 * edge + 0.4 * frillEdge) * (1 - Math.pow(f, 3) * 0.6) * Math.min(1, r / 6 + 0.25);
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

  // Mastigias: a fluffy, cauliflower-like mass of oral arms + long flat appendages with pale tips
  _buildMastigias(scene) {
    const cfg = this.cfg, ac = cfg.arms;
    const per = (ac.segments - 1) * ac.lumpsPerSeg;
    this.tipBase = cfg.count * ac.count * per;
    const total = this.tipBase + (ac.apps.bulb ? cfg.count * ac.count : 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, emissive: new THREE.Color(ac.emissive || '#6a4518') });
    this.lumpMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, ac.lumpDetail || 0), mat, total);
    this.lumpMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.lumpMesh.frustumCulled = false;
    const c = new THREE.Color();
    const pal = (ac.lumpColors || ['#dcae68', '#f3efe2', '#3b3328']).map((x) => new THREE.Color(x));
    const odds = ac.lumpOdds || [0.76, 0.2, 0.04];
    this.lumps = [];
    let clusters = null;
    for (let i = 0; i < this.tipBase; i++) {
      // each arm gets its own set of puffs; lumps gather around them like cauliflower florets
      if (ac.clusters && i % per === 0) {
        clusters = [];
        for (let k = 0; k < ac.clusters; k++) clusters.push({ f: Math.pow(Math.random(), ac.clusterBias || 1.3), a: Math.random() * Math.PI * 2, r: 0.4 + Math.random() * 1.6, s: 0.6 + Math.random() * 0.9 });
      }
      let r = Math.random(), ci = 0;
      while (ci < odds.length - 1 && r > odds[ci]) { r -= odds[ci]; ci++; }
      c.copy(pal[ci]).multiplyScalar(0.85 + Math.random() * 0.3);
      this.lumpMesh.setColorAt(i, c);
      if (clusters) {
        const C = clusters[(Math.random() * clusters.length) | 0];
        const g = () => (Math.random() + Math.random() + Math.random() - 1.5) * 0.7;
        this.lumps.push({ cl: true, f: THREE.MathUtils.clamp(C.f + g() * (ac.clusterSpread || 1) * 0.08, 0, 1), a: C.a + g() * (ac.clusterSpread || 1) * 0.9, rr: Math.max(0.1, C.r + g() * (ac.clusterSpread || 1) * 0.5), s: C.s * (0.5 + Math.random() * 0.7) });
      } else {
        this.lumps.push({ a: Math.random() * Math.PI * 2, rr: 0.55 + Math.random() * 0.55, s: (r < 0.2 ? 0.45 : 1) * (0.7 + Math.random() * 0.6), fo: Math.random() });
      }
    }
    for (let i = this.tipBase; i < total; i++) this.lumpMesh.setColorAt(i, c.set(ac.apps.bulb));
    scene.add(this.lumpMesh);
    if (ac.block) {
      const bm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, emissive: new THREE.Color(ac.block.emissive || '#2a2418') });
      const bg = oralArmGeometry(ac.length, ac.block.color);
      const nb = cfg.count * ac.count;
      const aPh = new Float32Array(nb); for (let i = 0; i < nb; i++) aPh[i] = Math.random() * 6.283;
      bg.setAttribute('aPhase', new THREE.InstancedBufferAttribute(aPh, 1));
      this.blockPulse = new THREE.InstancedBufferAttribute(new Float32Array(nb), 1).setUsage(THREE.DynamicDrawUsage);
      bg.setAttribute('aPulse', this.blockPulse);
      // soft body: bend and ripple every vertex on the GPU so the arms flex like jelly, not like stone
      const H = ac.length.toFixed(3), SB = (ac.block.soft ?? 1).toFixed(3);
      bm.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = shared.uTime;
        sh.vertexShader = 'attribute float aPhase; attribute float aPulse; uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          float sd = clamp(-position.y / ${H}, 0.0, 1.0);
          float ph = uTime * 1.05 + aPhase;
          float bend = sd * sd * ${SB};
          transformed.x += bend * (0.16 * sin(ph - sd * 2.6) - 0.12 * aPulse);
          transformed.z += bend * 0.14 * sin(ph * 0.83 + 1.7 - sd * 2.2);
          transformed.y += 0.05 * sd * aPulse * ${SB};
          float edge = smoothstep(0.05, 0.45, position.x);
          transformed.x += ${SB} * edge * (0.03 * sin(uTime * 2.6 + position.y * 22.0 + aPhase) + 0.02 * sin(uTime * 3.7 + position.z * 30.0));
          transformed.z += ${SB} * edge * 0.025 * sin(uTime * 2.2 + position.y * 18.0 + aPhase * 1.7);`);
      };
      bm.customProgramCacheKey = () => 'oralArmSoft' + H + SB;
      this.blockMesh = new THREE.InstancedMesh(bg, bm, nb);
      this.blockMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.blockMesh.frustumCulled = false;
      this.blockMesh.renderOrder = 2;
      scene.add(this.blockMesh);
      this._bx = new THREE.Vector3(); this._by = new THREE.Vector3(); this._bz = new THREE.Vector3();
    }
    // appendages: flat translucent straps
    const ap = ac.apps;
    this.AROWS = 40; this.ACOLS = ap.cols || 5;
    const strips = cfg.count * ac.count;
    const vPer = this.AROWS * this.ACOLS;
    this.appPos = new Float32Array(strips * vPer * 3);
    const col = new Float32Array(strips * vPer * 4);
    const idx = [];
    const body = new THREE.Color(ap.color), tip = new THREE.Color(ap.tip);
    for (let st = 0; st < strips; st++) for (let r = 0; r < this.AROWS; r++) {
      const f = r / (this.AROWS - 1);
      const tipK = THREE.MathUtils.smoothstep(f, 0.86, 0.96);
      for (let k = 0; k < this.ACOLS; k++) {
        const u = Math.abs(k / (this.ACOLS - 1) * 2 - 1);
        const o = (st * vPer + r * this.ACOLS + k) * 4;
        c.copy(body).multiplyScalar((ap.round ? 1.1 - 0.45 * u * u : 0.85 + 0.25 * u) * (ap.bumpy ? 0.8 + 0.4 * Math.random() : 1)).lerp(tip, tipK);   // round straps: lit centre, darker sides
        col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
        col[o + 3] = (ap.opacity * (0.7 + 0.3 * u)) * (1 - 0.2 * f) + tipK * 0.25;
        if (r < this.AROWS - 1 && k < this.ACOLS - 1) {
          const i0 = st * vPer + r * this.ACOLS + k;
          idx.push(i0, i0 + this.ACOLS, i0 + 1, i0 + 1, i0 + this.ACOLS, i0 + this.ACOLS + 1);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.appPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    g.setIndex(idx);
    this.appMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: true });
    this.appMesh = new THREE.Mesh(g, this.appMat);
    this.appMesh.frustumCulled = false;
    this.appMesh.renderOrder = 1;
    scene.add(this.appMesh);
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
    if (this.lumpMesh) { scene.remove(this.lumpMesh); this.lumpMesh.dispose(); }
    if (this.blockMesh) { scene.remove(this.blockMesh); this.blockMesh.geometry.dispose(); this.blockMesh.dispose(); }
    if (this.appMesh) { scene.remove(this.appMesh); this.appMesh.geometry.dispose(); this.appMat.dispose(); }
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
      // screen turned: each jelly notices a little later, so they spread out / come back gradually
      if (j.bver !== B.ver) {
        j.bver = B.ver;
        const out = ell(j.pos) > 0.95 || j.pos.y > B.y1 || j.pos.y < B.y0;
        j.retarget = out ? rnd(0, 3) : Math.min(j.retarget, rnd(0, 10));
      }
      if (j.retarget < 0) { pickTarget(j); j.retarget = rnd(12, 25); }
      // swim sideways toward its spot; faster when it is off screen
      const hx = j.targetX - j.pos.x, hz = j.targetZ - j.pos.z;
      const hp = ell(j.pos) > 1 ? 0.5 : 0.22;
      j.vel.x += THREE.MathUtils.clamp(hx, -1, 1) * hp * dt;
      j.vel.z += THREE.MathUtils.clamp(hz, -1, 1) * hp * dt;
      // above the target: pulses weaken to nothing and it sinks; below: pulses lift it
      const dy = j.targetY - j.pos.y;
      const climb = THREE.MathUtils.clamp(dy * 0.5 + 0.2, 0, 1.2);
      j.vel.y += THREE.MathUtils.clamp(dy, -1, 1) * 0.24 * dt;
      if (j.phase < prev) j.vel.addScaledVector(j.up, cfg.pulse.thrust * climb * (0.8 + 0.4 * Math.random()));
      const p = j.phase;
      j.pulse = p < 0.28 ? Math.sin(p / 0.28 * Math.PI / 2) : 1 - THREE.MathUtils.smoothstep(p, 0.28, 1.0);
      j.mat.uniforms.uPulse.value = j.pulse;
      j.mat.uniforms.uPhase.value = j.phase;
      if (j.inner) { j.inner.material.uniforms.uPulse.value = j.pulse; j.inner.material.uniforms.uPhase.value = j.phase; }

      // gentle circular current + keep inside the tank
      const rr = Math.hypot(j.pos.x, j.pos.z);
      flow.set(-j.pos.z, 0, j.pos.x).multiplyScalar(0.045 / Math.max(0.6, rr));
      if (j.pos.y < B.y0 + 0.2) j.vel.y += 0.3 * (B.y0 + 0.2 - j.pos.y);
      j.wander.x += (Math.random() - 0.5) * dt * 0.6; j.wander.z += (Math.random() - 0.5) * dt * 0.6;
      j.wander.clampLength(0, 1);
      d.set(j.wander.x * (cfg.tilt || 0.35), 1, j.wander.z * (cfg.tilt || 0.35));
      d.x += THREE.MathUtils.clamp(hx * 0.25, -0.5, 0.5); d.z += THREE.MathUtils.clamp(hz * 0.25, -0.5, 0.5);
      const e = ell(j.pos);
      if (e > 0.8) { d.x -= j.pos.x / rr * 0.9 * (e - 0.6) * 2; d.z -= j.pos.z / rr * 0.9 * (e - 0.6) * 2; }
      if (j.pos.y > B.y1 - 0.3) d.y = 0.2;             // lean away near the top
      if (j.pos.y < B.y0 + 0.4) d.y = 1.6;
      d.normalize();
      j.up.lerp(d, Math.min(1, dt * 0.35)).normalize();

      j.vel.multiplyScalar(Math.exp(-dt * 1.4));
      j.vel.y -= cfg.sink * dt;
      j.pos.addScaledVector(j.vel, dt).addScaledVector(flow, dt);
      if (j.pos.y < B.y0) j.pos.y = B.y0;
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
          // tentacles splay out like a skirt and trail behind as the bell pushes
          this._rad.set(Math.cos(ang), 0, Math.sin(ang)).applyQuaternion(j.mesh.quaternion);
          const rest = this._t1.copy(this._rad).multiplyScalar(0.3 + 0.25 * j.pulse).addScaledVector(j.up, -0.9).normalize();
          ch.update(v, dt, 0.3, 0.92, flow, rest, 0.6 + j.pulse * 0.8);
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
        const rootR = ac.rootR || (this.ribbons ? 0.17 : 0.12);
        v.set(Math.cos(ang) * rootR, cfg.bell.height * 0.1, Math.sin(ang) * rootR).applyMatrix4(j.mesh.matrixWorld);
        const ch = j.arms[k];
        if (this.ribbons) {
          this._rad.set(Math.cos(ang), 0, Math.sin(ang)).applyQuaternion(j.mesh.quaternion);
          const rest = this._t2.copy(j.up).multiplyScalar(-1).addScaledVector(this._rad, 0.22).normalize();
          ch.update(v, dt, 0.3, 0.86, flow, rest, 2.2);
        } else if (this.lumpMesh) {
          this._rad.set(Math.cos(ang), 0, Math.sin(ang)).applyQuaternion(j.mesh.quaternion);
          const rest = this._t2.copy(j.up).multiplyScalar(-1).addScaledVector(this._rad, ac.splay || 0.18).normalize();
          ch.update(v, dt, 0.3, 0.85, flow, rest, ac.stiff ?? 3.0);
        } else ch.update(v, dt, 0.5, 0.9, flow);
        if (this.lumpMesh) { this._updateMastigias(j, k, ang, ch, dt, t); continue; }
        if (this.ribbons) {
          const rad = this._rad.set(Math.cos(ang), 0, Math.sin(ang)).applyQuaternion(j.mesh.quaternion);
          const P = this.ribPos, ROWS = this.ROWS, COLS = this.COLS;
          const armIdx = this.jellies.indexOf(j) * ac.count + k;
          const len = ac.length * R;
          const cp = this._cp, cq = this._cq;
          for (let r = 0; r < ROWS; r++) {
            const f = r / (ROWS - 1);
            ch.sample(f, cp, d);                                                         // smooth centre line + tangent
            const t1 = this._t1.copy(rad).addScaledVector(d, -rad.dot(d)).normalize();   // across the arm
            const t2 = this._t2.crossVectors(d, t1).normalize();                         // depth of the fold
            // wide, frilly base -> narrow ribbon -> rounded tip (like the photo)
            const tipRound = f > 0.92 ? Math.sqrt(Math.max(0, 1 - (f - 0.92) / 0.08)) : 1;
            const width = R * (ac.radius[0] * Math.pow(1 - f, 1.4) + ac.radius[1]) * tipRound * (1 + 0.08 * Math.sin(f * 4 + t * 0.6 + k));
            const sway = R * 0.13 * Math.sin(f * 5.5 + t * 0.6 + k * 1.7) * f;   // gentle S-shaped wave
            for (let c = 0; c < COLS; c++) {
              const u = c / (COLS - 1) * 2 - 1;
              const au = Math.abs(u);
              const edge = THREE.MathUtils.smoothstep(au, 0.55, 1.0);
              // soft gutter fold, and fine small frills only along the very edges
              const fold = (u * u - 0.35) * width * 0.45;
              const frillZone = 1 - THREE.MathUtils.smoothstep(f, 0.35, 0.8);    // ruffles mostly toward the base
              const strong = u > 0 ? THREE.MathUtils.smoothstep(u, 0.3, 1.0) : edge * 0.4;
              const ph = f * len / R * 26 + t * 0.9 + k * 3;
              const ruf = strong * width * (0.05 + 0.2 * frillZone) * (Math.sin(ph) + 0.45 * Math.sin(ph * 1.9 + 1.3) + 0.25 * Math.sin(ph * 3.1 + 0.4));
              cq.copy(cp)
                .addScaledVector(t1, u * width + sway + ruf * 0.25)
                .addScaledVector(t2, fold + ruf);
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
    if (this.blockMesh) { this.blockMesh.instanceMatrix.needsUpdate = true; this.blockPulse.needsUpdate = true; }
    if (this.lumpMesh) { this.lumpMesh.instanceMatrix.needsUpdate = true; this.appMesh.geometry.attributes.position.needsUpdate = true; }
    if (this.clubMesh) this.clubMesh.instanceMatrix.needsUpdate = true;
  }
}

// Mastigias per-arm update (kept outside the main loop for clarity)
Population.prototype._updateMastigias = function (j, k, ang, ch, dt, t) {
  const cfg = this.cfg, ac = cfg.arms, ap = ac.apps, R = j.R;
  const m = this._m, q = this._q, sc = this._s, cp = this._cp || (this._cp = new THREE.Vector3()), d = this._d;
  const rad = this._rad.set(Math.cos(ang), 0, Math.sin(ang)).applyQuaternion(j.mesh.quaternion);
  const jIdx = this.jellies.indexOf(j);
  // fluffy lumps around the oral arm
  const per = (ac.segments - 1) * ac.lumpsPerSeg;
  const base = (jIdx * ac.count + k) * per;
  const t1 = this._t1, t2 = this._t2;
  for (let i = 0; i < per; i++) {
    const L = this.lumps[base + i];
    const f = L.cl ? L.f : Math.min(1, (Math.floor(i / ac.lumpsPerSeg) + L.fo) / (ac.segments - 1));
    ch.sample(f, cp, d);
    t1.copy(rad).addScaledVector(d, -rad.dot(d)).normalize();
    t2.crossVectors(d, t1).normalize();
    const thick = R * ac.lump * (1 - 0.35 * f);
    const a = L.a + Math.sin(t * 0.8 + i) * 0.1;
    cp.addScaledVector(t1, Math.cos(a) * thick * L.rr).addScaledVector(t2, Math.sin(a) * thick * L.rr);
    const sz = R * (ac.lumpSize || 0.036) * L.s * (1 - 0.25 * f);
    m.compose(cp, q.identity(), sc.set(sz, sz, sz));
    this.lumpMesh.setMatrixAt(base + i, m);
  }
  let root = ch.p[ch.n - 1];
  if (this.blockMesh) {
    const X = this._bx, Y = this._by, Z = this._bz;
    // hang along the bell axis, leaning a little with the arm's sway
    // each arm swings on its own rhythm and squeezes in/out with the bell's beat, so it never looks rigid
    const ph = t * 0.9 + k * 0.85 + jIdx * 1.3;
    Y.subVectors(ch.p[0], ch.p[ch.n - 1]).normalize().multiplyScalar(0.6).addScaledVector(j.up, 0.4);
    Z.crossVectors(rad, j.up).normalize();
    Y.addScaledVector(rad, -0.16 * Math.sin(ph) - 0.12 * j.pulse).addScaledVector(Z, 0.12 * Math.sin(ph * 1.27 + 1)).normalize();
    X.copy(rad).addScaledVector(Y, -rad.dot(Y)).normalize();
    X.applyAxisAngle(Y, 0.12 * Math.sin(ph * 0.8 + 2));            // slight twist
    Z.crossVectors(X, Y);
    m.makeBasis(X, Y, Z).scale(sc.set(R * (1 - 0.14 * j.pulse + 0.05 * Math.sin(ph * 1.6)), R * (1 + 0.1 * j.pulse), R * (1 + 0.06 * Math.sin(ph * 1.1))))
      .setPosition(ch.p[0]);
    this.blockMesh.setMatrixAt(jIdx * ac.count + k, m);
    this.blockPulse.array[jIdx * ac.count + k] = j.pulse;
    root = cp.copy(ch.p[ch.n - 1]).addScaledVector(X, R * 0.22);
  }
  // long flat appendage hanging from the end of the arm
  const app = j.apps[k];
  const rest = this._v.copy(j.up).multiplyScalar(-1).addScaledVector(rad, 0.12).normalize();
  app.update(root, dt, 0.25, 0.9, this._flow, rest, ap.stiff ?? 1.4);
  const P = this.appPos, AR = this.AROWS, AC = this.ACOLS;
  const o0 = (jIdx * ac.count + k) * AR * AC * 3;
  const len = ap.length;
  for (let r = 0; r < AR; r++) {
    const f = r / (AR - 1);
    app.sample(f, cp, d);
    t1.copy(rad).addScaledVector(d, -rad.dot(d)).normalize();
    t2.crossVectors(d, t1).normalize();
    const tipRound = f > 0.9 ? Math.sqrt(Math.max(0, 1 - (f - 0.9) / 0.1)) : 1;
    let w = R * ap.width * (0.75 + 0.35 * Math.sin(Math.min(1, f * 1.4) * Math.PI * 0.9)) * tipRound;
    if (ap.taper) w = R * ap.width * (1 - ap.taper * f) * (f > 0.82 ? Math.pow(Math.max(0, 1 - (f - 0.82) / 0.18), 0.6) : 1);
    let sway = R * 0.05 * Math.sin(f * 4 + t * 0.7 + k * 1.3) * f;
    let sway2 = 0;
    if (ap.wave) {   // a wave runs from the root to the tip, so the strap ripples and streams like a ribbon in water
      const ph = f * ap.wave.len - t * ap.wave.speed + k * 1.7 + jIdx;
      sway = R * ap.wave.amp * f * Math.sin(ph);
      sway2 = R * ap.wave.amp * 0.4 * f * Math.sin(ph * 0.8 + 1.3);
    }
    for (let c = 0; c < AC; c++) {
      const u = c / (AC - 1) * 2 - 1;
      const wave = (ap.round ? (1 - u * u) * w * ap.round : Math.abs(u) * w * 0.25 * Math.sin(f * len * 34 + t * 1.2 + k)) + sway2;   // wavy edges / rounded body
      const o = o0 + (r * AC + c) * 3;
      P[o] = cp.x + t1.x * (u * w + sway) + t2.x * wave;
      P[o + 1] = cp.y + t1.y * (u * w + sway) + t2.y * wave;
      P[o + 2] = cp.z + t1.z * (u * w + sway) + t2.z * wave;
    }
  }
  if (ap.bulb) {   // small white club at the very end
    app.sample(1, cp, d);
    const bs = R * (ap.bulbSize || 0.06);
    m.compose(cp, q.setFromUnitVectors(UP, d.normalize().negate()), sc.set(bs * 0.8, bs * 1.4, bs * 0.8));
    this.lumpMesh.setMatrixAt(this.tipBase + jIdx * ac.count + k, m);
  }
};

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
    this.setSize(window.innerWidth, window.innerHeight);   // fit swim area before spawning
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
    // use the real viewing distance (the camera is not moved when the phone turns)
    const dist = this.controls ? this.camera.position.distanceTo(this.controls.target) : 0;
    fitBounds(this.camera, 3.1, dist > 2 ? dist : (this.camera.aspect < 1 ? 8.2 : 7.2));
  }

  resetCamera() {
    const portrait = this.camera.aspect < 1;
    fitBounds(this.camera, 3.1, portrait ? 8.2 : 7.2);
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
