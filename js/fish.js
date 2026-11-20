// Procedural clownfish (Amphiprion ocellaris) model + swimming behaviour
import * as THREE from 'three';
import { mergeGeometries } from '../lib/addons/utils/BufferGeometryUtils.js';
import { addCaustics, WATER_TOP } from './env.js';
import { sandHeight } from './noise.js';

// Body profile: u (0 = tail peduncle, 1 = nose), half height, half width, centre y
const BODY = [
  [0.00, 0.058, 0.020, 0.000],
  [0.08, 0.066, 0.025, 0.000],
  [0.20, 0.104, 0.042, 0.002],
  [0.35, 0.148, 0.060, 0.004],
  [0.50, 0.170, 0.069, 0.006],
  [0.62, 0.174, 0.071, 0.006],
  [0.74, 0.160, 0.067, 0.004],
  [0.84, 0.130, 0.058, 0.000],
  [0.92, 0.092, 0.044, -0.006],
  [0.97, 0.056, 0.028, -0.012],
  [0.99, 0.030, 0.016, -0.015],
  [1.00, 0.000, 0.000, -0.016],
];
const X0 = -0.36, X1 = 0.40; // body x range (tail -> nose)
const ux = (u) => X0 + (X1 - X0) * u;

function profile(u) {
  u = Math.min(1, Math.max(0, u));
  let i = 0;
  while (i < BODY.length - 2 && BODY[i + 1][0] < u) i++;
  const p0 = BODY[Math.max(0, i - 1)], p1 = BODY[i], p2 = BODY[i + 1], p3 = BODY[Math.min(BODY.length - 1, i + 2)];
  const t = (u - p1[0]) / (p2[0] - p1[0]);
  const cr = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  return { hh: Math.max(0, cr(p0[1], p1[1], p2[1], p3[1])), hw: Math.max(0, cr(p0[2], p1[2], p2[2], p3[2])), yc: cr(p0[3], p1[3], p2[3], p3[3]) };
}

const C = {
  orange: new THREE.Color('#ff6408'),
  orangeDeep: new THREE.Color('#e84a00'),
  belly: new THREE.Color('#ff8a2a'),
  white: new THREE.Color('#fbf8f2'),
  black: new THREE.Color('#120d0a'),
  iris: new THREE.Color('#e08a10'),
};

function bodyColor(u, yn, out) {
  const bands = [
    { c: 0.770 - 0.03 * yn * yn, w: 0.034 },
    { c: 0.455 + 0.055 * Math.max(0, 1 - Math.abs(yn) * 1.5), w: 0.040 },
    { c: 0.085, w: 0.028 },
  ];
  const edge = 0.013;
  out.copy(C.orange);
  if (yn > 0.4) out.lerp(C.orangeDeep, (yn - 0.4) * 0.8);
  if (yn < -0.3) out.lerp(C.belly, (-0.3 - yn) * 0.8);
  for (const b of bands) {
    const d = Math.abs(u - b.c) - b.w;
    if (d < 0) { out.copy(C.white); return out; }
    if (d < edge) { out.copy(C.black); return out; }
    if (d < edge + 0.006) { out.lerp(C.black, 1 - (d - edge) / 0.006); }
  }
  return out;
}

function buildBody() {
  const NU = 72, NA = 32, n = 2.4;
  const pos = [], colr = [], idx = [];
  const c = new THREE.Color();
  for (let i = 0; i < NU; i++) {
    const u = i / (NU - 1);
    const { hh, hw, yc } = profile(u);
    for (let j = 0; j <= NA; j++) {
      const th = (j / NA) * Math.PI * 2;
      const cs = Math.cos(th), sn = Math.sin(th);
      const ex = 2 / n;
      const z = hw * Math.sign(cs) * Math.pow(Math.abs(cs), ex);
      const yn = Math.sign(sn) * Math.pow(Math.abs(sn), ex);
      pos.push(ux(u), yc + hh * yn, z);
      bodyColor(u, yn, c);
      colr.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < NU - 1; i++) for (let j = 0; j < NA; j++) {
    const a = i * (NA + 1) + j, b = a + NA + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Fin as a grid between a base polyline and an outline polyline
function buildFin(base, tip, nV = 8, opts = {}) {
  const { blackFrom = 0.78, whiteTip = false } = opts;
  const pos = [], colr = [], idx = [];
  const c = new THREE.Color();
  const nS = base.length;
  for (let i = 0; i < nS; i++) {
    for (let v = 0; v <= nV; v++) {
      const t = v / nV;
      const p = base[i].clone().lerp(tip[i], t);
      pos.push(p.x, p.y, p.z);
      c.copy(C.orange);
      const ray = 0.5 + 0.5 * Math.sin(i * 2.2);
      c.multiplyScalar(0.92 + 0.12 * ray);
      if (t > blackFrom) c.lerp(C.black, Math.min(1, (t - blackFrom) / 0.07));
      if (whiteTip && t > 0.97) c.lerp(C.white, 0.6);
      colr.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < nS - 1; i++) for (let v = 0; v < nV; v++) {
    const a = i * (nV + 1) + v, b = a + nV + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);

function dorsalFin() {
  const base = [], tip = [];
  const N = 30;
  for (let i = 0; i < N; i++) {
    const s = i / (N - 1);
    const u = 0.16 + s * 0.54;
    const { hh, yc } = profile(u);
    const y0 = yc + hh * 0.93;
    let h;
    if (s < 0.55) h = 0.15 * Math.pow(Math.sin(Math.PI * Math.min(1, s / 0.55 * 0.92 + 0.04)), 0.75);
    else {
      const k = (s - 0.55) / 0.45;
      h = 0.055 + 0.03 * Math.abs(Math.sin(k * Math.PI * 4.5)) - 0.05 * k * k;
      if (k < 0.08) h *= 0.6;
    }
    h = Math.max(0.012, h);
    base.push(V(ux(u), y0 - 0.01));
    tip.push(V(ux(u) - h * 0.35, y0 + h));
  }
  return buildFin(base, tip, 7);
}

function analFin() {
  const base = [], tip = [];
  const N = 16;
  for (let i = 0; i < N; i++) {
    const s = i / (N - 1);
    const u = 0.17 + s * 0.24;
    const { hh, yc } = profile(u);
    const y0 = yc - hh * 0.93;
    const h = Math.max(0.01, 0.12 * Math.pow(Math.sin(Math.PI * (s * 0.9 + 0.05)), 0.7));
    base.push(V(ux(u), y0 + 0.01));
    tip.push(V(ux(u) - h * 0.45, y0 - h));
  }
  return buildFin(base, tip, 6);
}

function caudalFin() {
  const base = [], tip = [];
  const N = 22;
  const { hh } = profile(0.0);
  for (let i = 0; i < N; i++) {
    const s = i / (N - 1);
    const a = (s - 0.5) * 1.55;
    const L = 0.15 + 0.04 * Math.cos((s - 0.5) * Math.PI);
    const by = (s - 0.5) * 2 * hh * 0.9;
    base.push(V(X0 + 0.015, by));
    tip.push(V(X0 - L * Math.cos(a * 0.7), by + L * Math.sin(a)));
  }
  return buildFin(base, tip, 9, { blackFrom: 0.8 });
}

function pelvicFin(side) {
  const base = [], tip = [];
  const N = 8;
  for (let i = 0; i < N; i++) {
    const s = i / (N - 1);
    const u = 0.64 + s * 0.05;
    const { hh, yc } = profile(u);
    const y0 = yc - hh * 0.9;
    const L = 0.08 + 0.05 * Math.sin(Math.PI * s);
    base.push(V(ux(u), y0, side * 0.02));
    tip.push(V(ux(u) - L * 0.9, y0 - L * 0.55, side * (0.02 + L * 0.35)));
  }
  return buildFin(base, tip, 6);
}

function pectoralGeometry() {
  // local: base along y at origin, extends to -x
  const base = [], tip = [];
  const N = 12;
  for (let i = 0; i < N; i++) {
    const s = i / (N - 1);
    const by = (s - 0.5) * 0.06;
    const a = (s - 0.5) * 1.6;
    const L = 0.09 + 0.025 * Math.cos((s - 0.5) * Math.PI);
    base.push(V(0, by));
    tip.push(V(-L * Math.cos(a * 0.6), by + L * Math.sin(a) * 0.7));
  }
  return buildFin(base, tip, 6, { blackFrom: 0.86 });
}

function eyeGeometry(side) {
  const g = new THREE.SphereGeometry(0.03, 20, 14);
  g.deleteAttribute('uv');
  const p = g.attributes.position;
  const colr = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  const out = new THREE.Vector3(0.15, 0.1, side).normalize();
  const d = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    d.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    const k = d.dot(out);
    if (k > 0.78) c.copy(C.black);
    else if (k > 0.5) c.copy(C.iris).lerp(C.black, k > 0.72 ? 0.6 : 0);
    else c.copy(C.orange);
    colr[i * 3] = c.r; colr[i * 3 + 1] = c.g; colr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  const u = 0.875;
  const { hw, yc } = profile(u);
  g.translate(ux(u), yc + 0.04, side * hw * 0.78);
  return g;
}

function swimExtra(uniforms) {
  const fn = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uSwimT;\nuniform float uAmp;\nuniform float uTurn;\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float L = clamp((0.40 - transformed.x) / 0.96, 0.0, 1.25);
  float wave = sin(uSwimT - transformed.x * 7.5);
  transformed.z += uAmp * (0.03 + L * L) * wave + uTurn * L * L;
  vLocal = position;
}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;')
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float sc = sin(vLocal.x*190.0 + sin(vLocal.y*190.0)*1.4) * sin(vLocal.y*190.0 + vLocal.x*60.0);
  diffuseColor.rgb *= 0.96 + 0.05*sc;
}`);
  };
  fn.key = 'swim';
  return fn;
}

export class Clownfish {
  constructor(scene, opts = {}) {
    this.scale = opts.scale ?? 0.85;
    this.uniforms = { uSwimT: { value: 0 }, uAmp: { value: 0.03 }, uTurn: { value: 0 } };
    const parts = [
      buildBody(), dorsalFin(), analFin(), caudalFin(), pelvicFin(1), pelvicFin(-1), eyeGeometry(1), eyeGeometry(-1),
    ];
    const geo = mergeGeometries(parts, false);
    const mat = addCaustics(new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.35, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.2,
      sheen: 0.5, sheenColor: new THREE.Color('#ffd2a8'), sheenRoughness: 0.4, side: THREE.DoubleSide,
    }), 0.45, swimExtra(this.uniforms));
    this.body = new THREE.Mesh(geo, mat);
    this.body.castShadow = true;

    const finMat = addCaustics(new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.4, clearcoat: 0.4, side: THREE.DoubleSide, transparent: true, opacity: 0.92,
    }), 0.4);
    const pg = pectoralGeometry();
    this.pecs = [1, -1].map((side) => {
      const m = new THREE.Mesh(pg, finMat);
      const u = 0.79;
      const { hw, yc } = profile(u);
      m.position.set(ux(u), yc - 0.02, side * hw * 1.02);
      m.userData.side = side;
      return m;
    });

    this.model = new THREE.Group();
    this.model.rotation.y = -Math.PI / 2; // build axis +x -> object +z
    this.model.add(this.body, ...this.pecs);
    this.object = new THREE.Group();
    this.object.add(this.model);
    this.object.scale.setScalar(this.scale);
    scene.add(this.object);

    this.pos = opts.pos ? opts.pos.clone() : new THREE.Vector3(0, 2, 0);
    this.vel = new THREE.Vector3(0.1, 0, 0);
    this.target = this.pos.clone();
    this.state = 'wander';
    this.wait = 0;
    this.stateTime = 0;
    this.speed = 0;
    this.finT = 0;
    this.turnS = 0;
    this.hunger = opts.hunger ?? 0.55;
    this.bite = 0;
    this.object.position.copy(this.pos);
    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._fwd = new THREE.Vector3(0, 0, 1);
  }

  pickWanderTarget(world) {
    const h = world.anemonePos;
    const r = Math.random() < 0.6 ? 0.6 + Math.random() * 1.4 : 1.5 + Math.random() * 2.2;
    const a = Math.random() * Math.PI * 2;
    const x = THREE.MathUtils.clamp(h.x + Math.cos(a) * r, -4.2, 4.2);
    const z = THREE.MathUtils.clamp(h.z + Math.sin(a) * r * 0.7, -1.6, 1.8);
    const y = THREE.MathUtils.clamp(h.y + Math.random() * 2.2, sandHeight(x, z) + 0.45, 5.5);
    this.target.set(x, y, z);
  }

  update(dt, world) {
    this.stateTime += dt;
    this.hunger = Math.max(0, this.hunger - dt * 0.0006);
    let maxSpeed = 0.45;

    // food has priority
    let food = null, best = 1e9;
    for (const f of world.food.pellets) {
      if (!f.alive || f.pos.y > WATER_TOP - 0.05) continue;
      const d = f.pos.distanceToSquared(this.pos);
      if (d < best) { best = d; food = f; }
    }
    if (food && this.hunger < 0.98) {
      this.state = 'food';
      this.target.copy(food.pos);
      maxSpeed = 1.0;
      if (Math.sqrt(best) < 0.11 * this.scale + 0.03) {
        world.food.eat(food);
        this.hunger = Math.min(1, this.hunger + 0.06);
        this.bite = 1;
      }
    } else if (this.state === 'food') {
      this.state = 'wander';
      this.pickWanderTarget(world);
    }

    if (this.state === 'home') {
      const t = this.stateTime;
      const h = world.anemonePos;
      this.target.set(h.x + Math.cos(t * 0.7) * 0.22, h.y - 0.05 + Math.sin(t * 1.3) * 0.06, h.z + Math.sin(t * 0.7) * 0.18);
      maxSpeed = 0.3;
      if (this.stateTime > this.homeFor) { this.state = 'wander'; this.pickWanderTarget(world); this.stateTime = 0; }
    } else if (this.state === 'wander') {
      const d = this.pos.distanceTo(this.target);
      if (this.wait > 0) {
        this.wait -= dt;
        maxSpeed = 0.06;
        if (this.wait <= 0) {
          if (Math.random() < 0.3) { this.state = 'home'; this.stateTime = 0; this.homeFor = 5 + Math.random() * 8; }
          else this.pickWanderTarget(world);
        }
      } else if (d < 0.18) {
        this.wait = 0.8 + Math.random() * 2.5;
      }
    }

    // steering
    const desired = this.target.clone().sub(this.pos);
    const dist = desired.length();
    const arrive = THREE.MathUtils.clamp(dist / 0.6, 0, 1);
    desired.normalize().multiplyScalar(maxSpeed * arrive);

    // avoidance
    const push = new THREE.Vector3();
    for (const o of world.obstacles) {
      const d = this.pos.clone().sub(o.c);
      const L = d.length();
      const lim = o.r + 0.3;
      if (L < lim && L > 1e-4) push.addScaledVector(d.divideScalar(L), (lim - L) * 3.0);
    }
    const floor = sandHeight(this.pos.x, this.pos.z) + 0.3;
    if (this.pos.y < floor) push.y += (floor - this.pos.y) * 4;
    if (this.pos.y > 6.3) push.y -= (this.pos.y - 6.3) * 4;
    if (this.pos.x < -4.5) push.x += 2; if (this.pos.x > 4.5) push.x -= 2;
    if (this.pos.z < -2.0) push.z += 2; if (this.pos.z > 2.2) push.z -= 2;
    if (this.state === 'home') push.multiplyScalar(0.15);
    desired.add(push);

    this.vel.lerp(desired, Math.min(1, dt * (this.state === 'food' ? 3.2 : 1.8)));
    this.pos.addScaledVector(this.vel, dt);
    this.speed = this.vel.length();

    // orientation
    const prevFwd = this._fwd.clone();
    if (this.speed > 0.035) {
      const dir = this.vel.clone().normalize();
      dir.y = THREE.MathUtils.clamp(dir.y, -0.5, 0.5);
      dir.normalize();
      this._m.lookAt(dir, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
      this._q.setFromRotationMatrix(this._m);
      this.object.quaternion.slerp(this._q, Math.min(1, dt * 3.5));
    } else {
      // level out while hovering
      const f = this._fwd.clone(); f.y *= 0.9; f.normalize();
      this._m.lookAt(f, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
      this._q.setFromRotationMatrix(this._m);
      this.object.quaternion.slerp(this._q, Math.min(1, dt * 1.5));
    }
    this._fwd.set(0, 0, 1).applyQuaternion(this.object.quaternion);
    const turnRate = (prevFwd.x * this._fwd.z - prevFwd.z * this._fwd.x) / Math.max(dt, 1e-3);
    this.turnS += (THREE.MathUtils.clamp(-turnRate * 0.05, -0.08, 0.08) - this.turnS) * Math.min(1, dt * 4);

    // body animation
    const hover = this.speed < 0.1;
    const freq = 5.5 + this.speed * 12;
    this.uniforms.uSwimT.value += dt * freq;
    const targetAmp = hover ? 0.018 : 0.03 + this.speed * 0.07;
    this.uniforms.uAmp.value += (targetAmp - this.uniforms.uAmp.value) * Math.min(1, dt * 3);
    this.uniforms.uTurn.value = this.turnS;
    this.finT += dt * (hover ? 11 : 8);
    for (const p of this.pecs) {
      const s = p.userData.side;
      p.rotation.set(0, s * (0.55 + 0.45 * Math.sin(this.finT + (s > 0 ? 0 : Math.PI))), 0);
    }
    this.bite = Math.max(0, this.bite - dt * 4);

    this.object.position.copy(this.pos);
    if (hover) this.object.position.y += Math.sin(performance.now() * 0.002) * 0.015;
    this.object.scale.setScalar(this.scale * (1 + this.bite * 0.04));
  }
}
