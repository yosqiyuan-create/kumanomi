// Reef: live rocks, corals, anemone
import * as THREE from 'three';
import { mergeVertices } from '../lib/addons/utils/BufferGeometryUtils.js';
import { makeRng, fbm3, noise3, sandHeight } from './noise.js';
import { addCaustics, shared } from './env.js';

const col = (hex) => new THREE.Color(hex);

// ---------- Sway injection (soft corals, tentacles) ----------
function swayExtra(amount, speed = 1.0) {
  const fn = (shader) => {
    shader.uniforms.uSwayAmt = { value: amount };
    shader.uniforms.uSwaySpd = { value: speed };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uSwayAmt;\nuniform float uSwaySpd;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec3 base = modelMatrix[3].xyz;
#ifdef USE_INSTANCING
  base += instanceMatrix[3].xyz;
#endif
  float ph = base.x*1.7 + base.z*1.3;
  float h = max(position.y, 0.0);
  float t = uTime*uSwaySpd;
  vec3 off = vec3(sin(t*1.1 + ph) + 0.4*sin(t*2.3 + ph*2.1), 0.0, cos(t*0.9 + ph*1.4) + 0.3*sin(t*1.9+ph));
  transformed += off * uSwayAmt * h * h;
}`);
  };
  fn.key = 'sway';
  return fn;
}

// Emission tinted by instance color (fluorescent polyps)
function glowExtra() {
  const fn = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )\n totalEmissiveRadiance *= vColor;\n#endif');
  };
  fn.key = 'glow';
  return fn;
}

// ---------- Rocks ----------
function makeRockGeometry(rng, r, sy) {
  let g = new THREE.IcosahedronGeometry(1, 4);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const seed = rng() * 100;
  const p = g.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const brown = col('#8a5a6a'), grey = col('#7a6a8a'), pink = col('#e06a9a'), purple = col('#8a4ac0'), green = col('#5aa040'), white = col('#f0c060'), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n1 = fbm3(x * 1.3 + seed, y * 1.3, z * 1.3, 4);
    const n2 = fbm3(x * 4.5, y * 4.5 + seed, z * 4.5, 3);
    const n3 = noise3(x * 11, y * 11, z * 11 + seed);
    const ridged = 1 - Math.abs(noise3(x * 3.2 + seed, y * 3.2, z * 3.2));
    const pits = Math.max(0, noise3(x * 7 - seed, y * 7, z * 7) - 0.35);
    const k = 1 + 0.36 * n1 + 0.12 * n2 + 0.05 * ridged * ridged + 0.03 * n3 - 0.12 * pits;
    x *= k * r; y *= k * r * sy; z *= k * r;
    if (y < -0.15 * r) y = -0.15 * r + (y + 0.15 * r) * 0.15;
    p.setXYZ(i, x, y, z);
    // coralline algae + film algae colouring
    const m = fbm3(x * 1.8 + 5, y * 1.8, z * 1.8 - seed, 3) * 0.5 + 0.5;
    c.copy(brown).lerp(grey, 0.5 + 0.5 * n2);
    c.lerp(pink, THREE.MathUtils.smoothstep(m, 0.55, 0.8) * 0.85);
    c.lerp(purple, THREE.MathUtils.smoothstep(n2 * 0.5 + 0.5, 0.72, 0.92) * 0.5);
    const top = THREE.MathUtils.smoothstep(y / (r * sy), 0.1, 0.9);
    c.lerp(green, top * 0.45 * (0.5 + 0.5 * fbm3(x * 2.5, y * 2.5 + 9, z * 2.5, 2)));
    if (n3 > 0.55) c.lerp(white, 0.5);
    c.multiplyScalar(1 - 0.45 * pits);
    const shade = 0.82 + 0.28 * n3;
    colors[i * 3] = c.r * shade; colors[i * 3 + 1] = c.g * shade; colors[i * 3 + 2] = c.b * shade;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

// ---------- Branching coral (instanced) ----------
function growColony(rng, origin, normal, opts, out) {
  const { len, rad, depth: maxD, spread, upBias, base, tip } = opts;
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const rec = (pos, dir, l, r, d) => {
    const end = pos.clone().addScaledVector(dir, l);
    out.push({ a: pos, dir: dir.clone(), len: l, r, t: d / maxD, base, tip, origin });
    if (d >= maxD || r < 0.008) { out.push({ cap: true, a: end, r: r * 0.85, t: 1, base, tip, origin }); return; }
    const n = d === 0 ? (opts.rootN ?? 3) + Math.floor(rng() * 3) : (rng() < (opts.split ?? 0.7) ? 2 : 1);
    for (let i = 0; i < n; i++) {
      const nd = dir.clone();
      const ax = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
      q.setFromAxisAngle(ax, spread * (0.4 + rng()) * (i === 0 && n === 1 ? 0.4 : 1));
      nd.applyQuaternion(q);
      nd.y += upBias;
      nd.normalize();
      rec(end, nd, l * (0.78 + rng() * 0.15), r * 0.8, d + 1);
    }
  };
  const start = normal.clone().lerp(up, 0.6).normalize();
  rec(origin.clone(), start, len, rad, 0);
}

// Sway computed from world height above the colony base, so connected segments bend together
function swayWorldExtra(amount, speed = 1.0) {
  const fn = (shader) => {
    shader.uniforms.uSwayAmt = { value: amount };
    shader.uniforms.uSwaySpd = { value: speed };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uSwayAmt;\nuniform float uSwaySpd;\nattribute vec3 aBase;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  vec3 wp = (instanceMatrix * vec4(transformed, 1.0)).xyz;
  float h = max(wp.y - aBase.y, 0.0);
  float ph = aBase.x*1.7 + aBase.z*1.3;
  float t = uTime*uSwaySpd;
  vec3 off = vec3(sin(t*1.1 + ph) + 0.4*sin(t*2.3 + ph*2.1), 0.0, cos(t*0.9 + ph*1.4) + 0.3*sin(t*1.9+ph));
  off *= uSwayAmt * h * h;
  transformed += inverse(mat3(instanceMatrix)) * off;
}
#endif`);
  };
  fn.key = 'swayw';
  return fn;
}

// segs: {a, dir, len, r, t, base, tip, origin} or caps {cap, a, r, tip, origin}
function buildBranchMesh(segs, opts = {}) {
  const { sway = 0, swaySpeed = 0.6, roughness = 0.7, glow = 0, caus = 0.9 } = opts;
  const cyl = new THREE.CylinderGeometry(0.8, 1, 1, 6, 1, true);
  cyl.translate(0, 0.5, 0);
  const sph = new THREE.SphereGeometry(1, 5, 3);
  const branches = segs.filter((s) => !s.cap), caps = segs.filter((s) => s.cap);
  const extras = [];
  if (sway) extras.push(swayWorldExtra(sway, swaySpeed));
  if (glow) extras.push(glowExtra());
  const extra = extras.length ? Object.assign((sh) => extras.forEach((e) => e(sh)), { key: 'b' }) : null;
  const mat = addCaustics(new THREE.MeshStandardMaterial({
    roughness, metalness: 0, emissive: new THREE.Color(glow, glow, glow),
  }), caus, extra);
  const group = new THREE.Group();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), c = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  const make = (geo, list, setter) => {
    if (!list.length) return;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    const base = new Float32Array(list.length * 3);
    list.forEach((b, i) => {
      setter(b, i, m);
      base[i * 3] = b.origin.x; base[i * 3 + 1] = b.origin.y; base[i * 3 + 2] = b.origin.z;
    });
    geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(base, 3));
    m.castShadow = false; m.receiveShadow = true;
    group.add(m);
  };
  make(cyl, branches, (b, i, m) => {
    q.setFromUnitVectors(up, b.dir);
    m4.compose(b.a, q, s.set(b.r, b.len * 1.04, b.r));
    m.setMatrixAt(i, m4);
    m.setColorAt(i, c.copy(b.base).lerp(b.tip, Math.pow(b.t, 1.3)));
  });
  make(sph, caps, (b, i, m) => {
    m4.compose(b.a, q.identity(), s.set(b.r, b.r, b.r));
    m.setMatrixAt(i, m4);
    m.setColorAt(i, c.copy(b.tip).multiplyScalar(1.08));
  });
  return group;
}

// ---------- Brain coral ----------
function makeBrainCoral(rng, r) {
  let g = new THREE.SphereGeometry(1, 72, 40, 0, Math.PI * 2, 0, Math.PI * 0.56);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const ridgeC = col('#b8b06a'), grooveC = col('#3f4a26'), c = new THREE.Color();
  const seed = rng() * 50;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = x * 9 + 3.2 * fbm3(x * 1.4 + seed, y * 1.4, z * 1.4, 3) + 1.6 * fbm3(x * 3, y * 3, z * 3 + seed, 2) + z * 2;
    const ridge = Math.pow(Math.abs(Math.sin(t)), 0.55);
    const k = r * (1 + 0.055 * ridge);
    p.setXYZ(i, x * k, Math.max(y, -0.05) * k * 0.82, z * k);
    c.copy(grooveC).lerp(ridgeC, ridge);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, addCaustics(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), 0.9));
  m.castShadow = m.receiveShadow = true;
  return m;
}

// ---------- Table coral ----------
function makeTableCoral(rng, r) {
  const grp = new THREE.Group();
  const seed = rng() * 30;
  let g = new THREE.CylinderGeometry(r, r * 0.9, 0.07, 64, 6);
  g = mergeVertices(g.deleteAttribute('uv').deleteAttribute('normal'));
  const p = g.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const inner = col('#7c8a52'), rim = col('#d8d79a'), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = Math.sqrt(x * x + z * z) / r;
    const a = Math.atan2(z, x);
    const wob = 1 + 0.12 * noise3(Math.cos(a) * 2 + seed, Math.sin(a) * 2, 0) + 0.04 * noise3(Math.cos(a) * 7, Math.sin(a) * 7, seed);
    x *= wob; z *= wob;
    y += 0.12 * r * d * d + 0.015 * noise3(x * 12, z * 12, seed);
    p.setXYZ(i, x, y, z);
    c.copy(inner).lerp(rim, THREE.MathUtils.smoothstep(d, 0.75, 1.0));
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  const mat = addCaustics(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), 1.0);
  const plate = new THREE.Mesh(g, mat);
  plate.position.y = 0.22;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.24, 10), new THREE.MeshStandardMaterial({ color: '#6c7148', roughness: 0.9 }));
  stem.position.y = 0.11;
  plate.castShadow = plate.receiveShadow = stem.castShadow = true;
  grp.add(stem, plate);
  return grp;
}

// ---------- Lathe tube (tentacles / fingers) ----------
function tubeGeometry(profile, colorsAlong, seg = 8, rows = 10) {
  const pts = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    pts.push(new THREE.Vector2(Math.max(0.0001, profile(t)), t));
  }
  const g = new THREE.LatheGeometry(pts, seg);
  g.deleteAttribute('uv');
  const p = g.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    colorsAlong(p.getY(i), c);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

// ---------- Anemone (bubble-tip) ----------
function makeAnemone(rng) {
  const grp = new THREE.Group();
  const R = 0.5;
  const colMat = addCaustics(new THREE.MeshStandardMaterial({ color: '#8a5a3a', roughness: 0.8 }), 0.7);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.85, R * 0.6, 0.22, 32), colMat);
  column.position.y = 0.11;
  grp.add(column);
  const brown = col('#6f5a36'), green = col('#7d7a3e'), bulb = col('#d4646c'), tipC = col('#f2d4c8');
  const geo = tubeGeometry(
    (t) => 0.032 + 0.016 * Math.exp(-Math.pow((t - 0.78) / 0.12, 2)) - 0.012 * t - (t > 0.93 ? (t - 0.93) * 0.25 : 0),
    (t, c) => {
      c.copy(brown).lerp(green, Math.min(1, t * 1.4));
      c.lerp(bulb, THREE.MathUtils.smoothstep(t, 0.6, 0.78));
      c.lerp(tipC, THREE.MathUtils.smoothstep(t, 0.88, 1.0));
    }, 8, 14);
  const N = 190;
  const mat = addCaustics(new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.5, emissive: new THREE.Color('#2a0a10'),
  }), 0.6, swayExtra(0.14, 0.9));
  const inst = new THREE.InstancedMesh(geo, mat, N);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const rr = Math.sqrt((i + 0.5) / N) * R * 0.95;
    const a = i * golden;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const out = rr / R;
    const dir = new THREE.Vector3(x * 1.6, 1 - out * 0.55, z * 1.6).normalize();
    dir.x += (rng() - 0.5) * 0.25; dir.z += (rng() - 0.5) * 0.25; dir.normalize();
    q.setFromUnitVectors(up, dir);
    const L = 0.32 + rng() * 0.16 - out * 0.05;
    m4.compose(new THREE.Vector3(x, 0.2, z), q, new THREE.Vector3(1, L, 1));
    inst.setMatrixAt(i, m4);
  }
  inst.castShadow = true;
  grp.add(inst);
  return grp;
}

// ---------- Finger leather coral ----------
function makeFingerCoral(rng, scale = 1) {
  const cream = col('#cbbf8e'), tipc = col('#e9e3bf');
  const geo = tubeGeometry((t) => 0.06 * (1 - t * 0.35) * (t > 0.85 ? Math.sqrt(Math.max(0, (1 - t) / 0.15)) : 1),
    (t, c) => c.copy(cream).lerp(tipc, t), 10, 10);
  const mat = addCaustics(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), 0.9, swayExtra(0.06, 0.6));
  const N = 16;
  const inst = new THREE.InstancedMesh(geo, mat, N);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < N; i++) {
    const a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * 0.25 * scale;
    const dir = new THREE.Vector3(Math.cos(a) * rr * 2, 1, Math.sin(a) * rr * 2).normalize();
    q.setFromUnitVectors(up, dir);
    const L = (0.35 + rng() * 0.3) * scale;
    m4.compose(new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr), q, new THREE.Vector3(scale, L, scale));
    inst.setMatrixAt(i, m4);
  }
  inst.castShadow = true;
  return inst;
}

// ---------- Instanced tube clusters (torch corals, fingers) ----------
function torchGeometry() {
  return tubeGeometry(
    (t) => 0.022 - 0.006 * t + 0.016 * Math.exp(-Math.pow((t - 0.93) / 0.06, 2)) - (t > 0.97 ? (t - 0.97) * 0.6 : 0),
    (t, c) => c.setScalar(0.25 + 0.75 * THREE.MathUtils.smoothstep(t, 0.55, 0.95)), 5, 8);
}

function mushroomGeometry() {
  // domed disc with a darker mouth and lighter rim
  const g = new THREE.SphereGeometry(1, 12, 3, 0, Math.PI * 2, 0, Math.PI * 0.5);
  g.scale(1, 0.25, 1);
  g.deleteAttribute('uv');
  const p = g.attributes.position;
  const colr = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const d = Math.hypot(p.getX(i), p.getZ(i));
    const v = d < 0.12 ? 0.35 : 0.8 + 0.35 * d + 0.08 * Math.sin(Math.atan2(p.getZ(i), p.getX(i)) * 14) * d;
    colr[i * 3] = colr[i * 3 + 1] = colr[i * 3 + 2] = v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  return g;
}

// ---------- Main reef builder ----------
export function buildReef(scene, quality) {
  const rng = makeRng(42);
  const obstacles = [];
  const rocks = [];
  const rockMat = addCaustics(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), 1.0);
  const rockSpecs = [
    [-3.3, 0.25, -2.3, 1.45, 0.78], [-1.1, 0.2, -2.7, 1.7, 0.85], [1.3, 0.25, -2.4, 1.5, 0.8],
    [3.4, 0.2, -2.0, 1.3, 0.72], [-2.1, 1.35, -2.6, 1.0, 0.85], [0.3, 1.55, -2.8, 0.95, 0.9],
    [2.5, 1.15, -2.4, 0.85, 0.8], [2.4, 0.05, 0.5, 0.75, 0.6], [-3.6, 0.05, 0.3, 0.75, 0.6],
    [-0.2, 0.05, -1.3, 0.7, 0.55], [4.3, 0.05, -0.4, 0.8, 0.7], [-4.5, 0.1, -1.0, 0.9, 0.75],
  ];
  for (const [x, y, z, r, sy] of rockSpecs) {
    const m = new THREE.Mesh(makeRockGeometry(rng, r, sy), rockMat);
    m.position.set(x, y + sandHeight(x, z), z);
    m.rotation.y = rng() * Math.PI * 2;
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    rocks.push(m);
    obstacles.push({ c: new THREE.Vector3(x, y + r * sy * 0.35, z), r: r * 1.0 });
  }

  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  scene.updateMatrixWorld(true);
  const place = (x, z, rockOnly = false) => {
    ray.set(new THREE.Vector3(x, 20, z), down);
    const hit = ray.intersectObjects(rocks, false)[0];
    if (hit) return { p: hit.point, n: hit.face.normal.clone().transformDirection(hit.object.matrixWorld), rock: true };
    if (rockOnly) return null;
    return { p: new THREE.Vector3(x, sandHeight(x, z), z), n: new THREE.Vector3(0, 1, 0), rock: false };
  };

  const anemXZ = new THREE.Vector2(-1.2, 0.1);
  const dens = quality?.coral ?? 1;
  const pal = {
    purple: ['#4a2f6a', '#d9b4ff'], pink: ['#7a2e55', '#ffa6d8'], yellow: ['#6a5a1c', '#fff27a'],
    green: ['#2f5a2a', '#a6ff6a'], blue: ['#1f3f6a', '#8fd8ff'], orange: ['#7a3a1c', '#ffb66a'],
    teal: ['#1f5a55', '#7affe6'], red: ['#6a1f24', '#ff7a6a'], lilac: ['#5a3a6a', '#ffd0f6'],
  };
  const palKeys = Object.keys(pal);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  // ---- candidate spots over the whole rock surface (top, sides and front) ----
  const spots = [];
  const cell = 0.17;
  const grid = new Map();
  const gkey = (p) => `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)},${Math.floor(p.z / cell)}`;
  const tooClose3 = (p, d) => {
    const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell), cz = Math.floor(p.z / cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const arr = grid.get(`${cx + i},${cy + j},${cz + k}`);
      if (arr && arr.some((q) => q.distanceToSquared(p) < d * d)) return true;
    }
    return false;
  };
  const addSpot = (sp) => {
    const k = gkey(sp.p);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(sp.p);
    spots.push(sp);
  };
  const tooClose = (x, z, d) => tooClose3(new THREE.Vector3(x, sandHeight(x, z), z), d);
  for (const rock of rocks) {
    const pos = rock.geometry.attributes.position, nor = rock.geometry.attributes.normal;
    const order = [...Array(pos.count).keys()].sort(() => rng() - 0.5);
    const nm = new THREE.Matrix3().getNormalMatrix(rock.matrixWorld);
    for (const i of order) {
      const p = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(rock.matrixWorld);
      const n = new THREE.Vector3(nor.getX(i), nor.getY(i), nor.getZ(i)).applyMatrix3(nm).normalize();
      if (n.y < -0.35) continue;
      if (p.y < sandHeight(p.x, p.z) + 0.06) continue;
      if (Math.hypot(p.x - anemXZ.x, p.z - anemXZ.y) < 0.75 && p.y < 1.0) continue;
      if (tooClose3(p, 0.2)) continue;
      if (rng() > dens) continue;
      addSpot({ x: p.x, z: p.z, p, n, rock: true, wall: n.y < 0.45 });
    }
  }
  // sand corals at the edges and middle ground, leaving the front-centre open
  for (let i = 0; i < 160; i++) {
    const x = -4.8 + rng() * 9.6, z = -1.8 + rng() * 4.6;
    if (Math.hypot(x - anemXZ.x, z - anemXZ.y) < 1.0) continue;
    if (z > 0.9 && Math.abs(x + 0.3) < 0.9) continue;
    if (tooClose(x, z, 0.42)) continue;
    const h = place(x, z);
    if (h.rock) continue;
    if (rng() <= dens) addSpot({ x, z, ...h });
  }

  const tan = (s, r) => {
    const t1 = new THREE.Vector3().crossVectors(s.n, Math.abs(s.n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
    const t2 = new THREE.Vector3().crossVectors(s.n, t1);
    return s.p.clone().addScaledVector(t1, (rng() - 0.5) * r).addScaledVector(t2, (rng() - 0.5) * r).addScaledVector(s.n, -0.01);
  };
  const branchSegs = [], bushSegs = [], softSegs = [];
  const torches = [], mushrooms = [], zoas = [];
  const up = new THREE.Vector3(0, 1, 0);

  for (const s of spots) {
    const r = rng();
    const colors = pal[pick(palKeys)];
    if (!s.rock) {
      // sand: brain, bushy, torch, soft tree
      if (r < 0.3) s.type = 'brain'; else if (r < 0.55) s.type = 'bush'; else if (r < 0.8) s.type = 'torch'; else s.type = 'soft';
    } else if (r < 0.22) s.type = 'branch';
    else if (r < 0.44) s.type = 'bush';
    else if (r < 0.56) s.type = 'torch';
    else if (r < 0.70) s.type = 'zoa';
    else if (r < 0.82) s.type = 'mushroom';
    else if (r < 0.94) s.type = 'soft';
    else if (r < 0.97) s.type = s.wall ? 'zoa' : 'table';
    else s.type = s.wall ? 'mushroom' : 'brain';

    switch (s.type) {
      case 'branch': {
        const size = 0.8 + rng() * 0.6;
        growColony(rng, s.p, s.n, { len: 0.22 * size, rad: 0.055 * size, depth: 4, spread: 0.6, upBias: 0.3,
          rootN: 2, split: 0.65, base: col(colors[0]), tip: col(colors[1]) }, branchSegs);
        obstacles.push({ c: s.p.clone().add(new THREE.Vector3(0, 0.35 * size, 0)), r: 0.28 * size });
        break;
      }
      case 'bush': { // cauliflower / Pocillopora-like
        const size = 0.7 + rng() * 0.5;
        growColony(rng, s.p, s.n, { len: 0.1 * size, rad: 0.045 * size, depth: 3, spread: 0.9, upBias: 0.15,
          rootN: 4, split: 0.8, base: col(colors[0]), tip: col(colors[1]) }, bushSegs);
        break;
      }
      case 'soft': { // tree soft coral, translucent and swaying
        const size = 0.8 + rng() * 0.5;
        const c2 = pick([pal.pink, pal.red, pal.orange, pal.lilac, pal.purple]);
        growColony(rng, s.p, s.n, { len: 0.18 * size, rad: 0.05 * size, depth: 4, spread: 0.75, upBias: 0.25,
          rootN: 2, split: 0.75, base: col(c2[1]).multiplyScalar(0.8), tip: col(c2[1]) }, softSegs);
        break;
      }
      case 'torch': {
        const tint = col(pick(['#6aff8a', '#ffb04a', '#5ae8ff', '#ff7ad0', '#d6ff4a']));
        const n = 8 + Math.floor(rng() * 7);
        for (let i = 0; i < n; i++) {
          const a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * 0.13;
          const dir = new THREE.Vector3(Math.cos(a) * rr * 2.5, 1, Math.sin(a) * rr * 2.5).add(s.n.clone().multiplyScalar(1.2)).normalize();
          torches.push({ p: s.rock ? tan(s, 0.26) : s.p.clone().add(new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr)), dir, L: 0.16 + rng() * 0.14, tint });
        }
        break;
      }
      case 'mushroom': {
        const c = col(pick(['#3cff8a', '#ff5a3a', '#4aa0ff', '#c46aff', '#ff3ab0', '#2ae0d0']));
        const n = 5 + Math.floor(rng() * 6);
        for (let i = 0; i < n; i++) {
          const h = { p: tan(s, 0.3), n: s.n };
          if (h) mushrooms.push({ p: h.p, n: h.n, s: 0.05 + rng() * 0.07, c });
        }
        break;
      }
      case 'zoa': {
        const c = col(pick(['#1fd04a', '#ff6a10', '#12a8ff', '#ff2f8a', '#a8f020', '#ffd21a']));
        const n = 14 + Math.floor(rng() * 12);
        for (let i = 0; i < n; i++) {
          const h = { p: tan(s, 0.26), n: s.n };
          if (h) zoas.push({ p: h.p, n: h.n, s: 0.035 + rng() * 0.03, c });
        }
        break;
      }
      case 'table': {
        const t = makeTableCoral(rng, 0.3 + rng() * 0.3);
        t.position.copy(s.p);
        t.rotation.y = rng() * 6;
        scene.add(t);
        break;
      }
      case 'brain': {
        const r0 = 0.18 + rng() * 0.2;
        const b = makeBrainCoral(rng, r0);
        b.position.copy(s.p).y -= 0.03;
        b.rotation.y = rng() * 6;
        scene.add(b);
        obstacles.push({ c: s.p.clone().add(new THREE.Vector3(0, r0 * 0.3, 0)), r: r0 * 1.05 });
        break;
      }
    }
  }

  // Sea fans behind the reef
  for (const [x, z, hex] of [[-2.4, -3.5, '#d8402a'], [1.9, -3.6, '#e07a2a'], [-0.2, -3.7, '#c8306a'], [3.6, -3.1, '#e8b02a']]) {
    const h = place(x, z);
    const fr = makeRng(Math.floor(x * 100 + 500));
    const origin = h.p.clone();
    const rec = (pos, dir, l, r, d) => {
      const end = pos.clone().addScaledVector(dir, l);
      softSegs.push({ a: pos, dir: dir.clone(), len: l, r, t: d / 7, base: col(hex).multiplyScalar(0.7), tip: col(hex), origin });
      if (d >= 7) return;
      for (let i = 0; i < 2; i++) {
        const nd = dir.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), (i === 0 ? -1 : 1) * (0.25 + fr() * 0.35));
        nd.y += 0.25; nd.normalize();
        rec(end, nd, l * 0.82, r * 0.8, d + 1);
      }
    };
    rec(origin, new THREE.Vector3(0, 1, 0), 0.42, 0.025, 0);
  }

  scene.add(buildBranchMesh(branchSegs, { roughness: 0.7, glow: 0.12 }));
  scene.add(buildBranchMesh(bushSegs, { roughness: 0.8, glow: 0.08 }));
  scene.add(buildBranchMesh(softSegs, { roughness: 0.6, sway: 0.05, swaySpeed: 0.5, glow: 0.18, caus: 0.6 }));

  // torches
  if (torches.length) {
    const mat = addCaustics(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, emissive: new THREE.Color(0.35, 0.35, 0.35) }),
      0.5, Object.assign((sh) => { swayExtra(0.25, 1.0)(sh); glowExtra()(sh); }, { key: 't' }));
    const inst = new THREE.InstancedMesh(torchGeometry(), mat, torches.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    torches.forEach((t, i) => {
      q.setFromUnitVectors(up, t.dir);
      m4.compose(t.p, q, new THREE.Vector3(1, t.L, 1));
      inst.setMatrixAt(i, m4);
      inst.setColorAt(i, t.tint);
    });
    scene.add(inst);
  }

  // mushrooms + zoanthids (fluorescent discs)
  const discs = (list, geo, emis) => {
    if (!list.length) return;
    const mat = addCaustics(new THREE.MeshStandardMaterial({ vertexColors: !!geo.attributes.color, roughness: 0.45, emissive: new THREE.Color(emis, emis, emis) }), 0.45, glowExtra());
    const inst = new THREE.InstancedMesh(geo, mat, list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    list.forEach((d, i) => {
      q.setFromUnitVectors(up, d.n);
      m4.compose(d.p, q, new THREE.Vector3(d.s, d.s * 0.8, d.s));
      inst.setMatrixAt(i, m4);
      inst.setColorAt(i, d.c.clone().multiplyScalar(0.8 + rng() * 0.3));
    });
    scene.add(inst);
  };
  discs(mushrooms, mushroomGeometry(), 0.25);
  {
    const zg = new THREE.CylinderGeometry(1, 0.55, 1, 8);
    zg.translate(0, 0.5, 0);
    discs(zoas, zg, 0.25);
  }

  // Anemone — home of the clownfish
  const anemPos = place(anemXZ.x, anemXZ.y).p;
  const anemone = makeAnemone(rng);
  anemone.position.copy(anemPos);
  scene.add(anemone);

  return { obstacles, anemonePos: anemPos.clone().add(new THREE.Vector3(0, 0.45, 0)), rocks, spotCount: spots.length };
}
