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
      '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\n totalEmissiveRadiance *= vColor;\n#endif');
  };
  fn.key = 'glow';
  return fn;
}

// ---------- Rocks ----------
function makeRockGeometry(rng, r, sy) {
  let g = new THREE.IcosahedronGeometry(1, 5);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const seed = rng() * 100;
  const p = g.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const brown = col('#7a6c58'), grey = col('#8d877a'), pink = col('#c4708a'), purple = col('#7b5490'), green = col('#5f7438'), white = col('#d9d2c2'), c = new THREE.Color();
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
    out.push({ a: pos, dir: dir.clone(), len: l, r, t: d / maxD, base, tip });
    if (d >= maxD || r < 0.008) { out.push({ cap: true, a: end, r: r * 0.85, t: 1, base, tip }); return; }
    const n = d === 0 ? 4 + Math.floor(rng() * 3) : (rng() < 0.7 ? 2 : 1);
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

function buildBranchMesh(segs, extraMat) {
  const cyl = new THREE.CylinderGeometry(0.8, 1, 1, 7, 1, false);
  cyl.translate(0, 0.5, 0);
  const sph = new THREE.SphereGeometry(1, 8, 6);
  const branches = segs.filter((s) => !s.cap), caps = segs.filter((s) => s.cap);
  const mat = addCaustics(new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, ...extraMat }), 0.9);
  const mB = new THREE.InstancedMesh(cyl, mat, branches.length);
  const mC = new THREE.InstancedMesh(sph, mat, caps.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), c = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  branches.forEach((b, i) => {
    q.setFromUnitVectors(up, b.dir);
    s.set(b.r, b.len * 1.04, b.r);
    m4.compose(b.a, q, s);
    mB.setMatrixAt(i, m4);
    c.copy(b.base).lerp(b.tip, Math.pow(b.t, 1.4));
    mB.setColorAt(i, c);
  });
  caps.forEach((b, i) => {
    m4.compose(b.a, q.identity(), s.set(b.r, b.r, b.r));
    mC.setMatrixAt(i, m4);
    mC.setColorAt(i, c.copy(b.tip).multiplyScalar(1.1));
  });
  for (const m of [mB, mC]) { m.castShadow = true; m.receiveShadow = true; }
  const g = new THREE.Group(); g.add(mB, mC);
  return g;
}

// ---------- Brain coral ----------
function makeBrainCoral(rng, r) {
  let g = new THREE.SphereGeometry(1, 96, 64, 0, Math.PI * 2, 0, Math.PI * 0.56);
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

// ---------- Main reef builder ----------
export function buildReef(scene, quality) {
  const rng = makeRng(42);
  const obstacles = [];
  const rocks = [];
  const rockMat = addCaustics(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), 1.0);
  const rockSpecs = [
    [-3.3, 0.25, -2.3, 1.45, 0.78], [-1.1, 0.2, -2.7, 1.7, 0.85], [1.3, 0.25, -2.4, 1.5, 0.8],
    [3.4, 0.2, -2.0, 1.3, 0.72], [-2.1, 1.35, -2.6, 1.0, 0.85], [0.3, 1.55, -2.8, 0.95, 0.9],
    [2.5, 1.15, -2.4, 0.85, 0.8], [2.3, 0.05, 0.6, 0.65, 0.6], [-3.5, 0.05, 0.4, 0.6, 0.6],
    [-0.2, 0.05, -1.2, 0.7, 0.55],
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

  // surface placement by raycasting down
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  scene.updateMatrixWorld(true);
  const place = (x, z) => {
    ray.set(new THREE.Vector3(x, 20, z), down);
    const hit = ray.intersectObjects(rocks, false)[0];
    if (hit) {
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      return { p: hit.point, n };
    }
    return { p: new THREE.Vector3(x, sandHeight(x, z), z), n: new THREE.Vector3(0, 1, 0) };
  };

  // Branching corals
  const segs = [];
  const colonies = [
    { x: 1.4, z: -1.9, base: '#5b3f78', tip: '#c7a8ff', len: 0.28, rad: 0.05, depth: 5 },
    { x: -2.7, z: -1.6, base: '#5f6a2c', tip: '#e2f08a', len: 0.26, rad: 0.05, depth: 5 },
    { x: 0.1, z: -2.0, base: '#2d4f73', tip: '#8fd6ff', len: 0.3, rad: 0.055, depth: 5 },
    { x: 3.1, z: -1.4, base: '#7a4a3a', tip: '#ffb08a', len: 0.24, rad: 0.045, depth: 5 },
    { x: -1.6, z: -2.0, base: '#3a6a5a', tip: '#a8ffd8', len: 0.22, rad: 0.04, depth: 5 },
    { x: 2.2, z: -2.6, base: '#5b3f78', tip: '#e0b8ff', len: 0.22, rad: 0.04, depth: 4 },
    { x: -0.4, z: -1.5, base: '#7a3a5a', tip: '#ff9ad0', len: 0.2, rad: 0.04, depth: 4 },
    { x: 2.0, z: 0.2, base: '#3a5f7a', tip: '#a0e8ff', len: 0.18, rad: 0.035, depth: 4 },
    { x: -3.4, z: 0.2, base: '#6a6a2a', tip: '#f4f07a', len: 0.18, rad: 0.035, depth: 4 },
    { x: -1.9, z: -2.5, base: '#2d4f73', tip: '#7fc8ff', len: 0.2, rad: 0.04, depth: 4 },
    { x: 3.0, z: -2.4, base: '#7a4a3a', tip: '#ffc09a', len: 0.2, rad: 0.04, depth: 4 },
  ];
  for (const c of colonies) {
    const { p, n } = place(c.x, c.z);
    growColony(rng, p, n, { len: c.len, rad: c.rad * 1.25, depth: c.depth, spread: 0.6, upBias: 0.3, base: col(c.base), tip: col(c.tip) }, segs);
  }
  scene.add(buildBranchMesh(segs, {}));

  // Sea fans (gorgonians): planar branching, thin, swaying
  const fanSegs = [];
  for (const [x, z, hex] of [[-1.9, -3.4, '#c8402a'], [1.9, -3.5, '#d8702a']]) {
    const { p } = place(x, z);
    const planeRng = makeRng(Math.floor(x * 100 + 500));
    const rec = (pos, dir, l, r, d) => {
      const end = pos.clone().addScaledVector(dir, l);
      fanSegs.push({ a: pos, dir: dir.clone(), len: l, r, t: d / 7, base: col(hex).multiplyScalar(0.7), tip: col(hex) });
      if (d >= 7) return;
      for (let i = 0; i < 2; i++) {
        const ang = (i === 0 ? -1 : 1) * (0.25 + planeRng() * 0.35);
        const nd = dir.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), ang);
        nd.y += 0.25; nd.normalize();
        rec(end, nd, l * 0.82, r * 0.8, d + 1);
      }
    };
    rec(p, new THREE.Vector3(0, 1, 0), 0.4, 0.025, 0);
  }
  {
    const fan = buildBranchMesh(fanSegs, {});
    fan.children.forEach((m) => {
      m.material = addCaustics(new THREE.MeshStandardMaterial({ roughness: 0.8 }), 0.8, swayExtra(0.015, 0.5));
    });
    scene.add(fan);
  }

  // Brain corals
  for (const [x, z, r] of [[1.5, 1.0, 0.42], [-2.9, 1.1, 0.3], [3.3, -0.4, 0.28]]) {
    const { p } = place(x, z);
    const b = makeBrainCoral(rng, r);
    b.position.copy(p).y -= 0.04;
    b.rotation.y = rng() * 6;
    scene.add(b);
    obstacles.push({ c: p.clone().add(new THREE.Vector3(0, r * 0.3, 0)), r: r * 1.05 });
  }

  // Table corals on rock tops
  for (const [x, z, r] of [[-0.9, -2.3, 0.6], [2.7, -2.1, 0.45]]) {
    const { p } = place(x, z);
    const t = makeTableCoral(rng, r);
    t.position.copy(p);
    t.rotation.y = rng() * 6;
    scene.add(t);
  }

  // Finger leather corals
  for (const [x, z, s] of [[0.8, 0.3, 1.0], [-2.3, -0.5, 0.8], [3.6, 0.6, 0.7]]) {
    const { p } = place(x, z);
    const f = makeFingerCoral(rng, s);
    f.position.copy(p);
    scene.add(f);
  }

  // Zoanthid / mushroom polyps (fluorescent) on rocks
  {
    const palette = ['#1fd04a', '#ff6a10', '#12a8ff', '#ff2f8a', '#a8f020'];
    const disc = new THREE.CylinderGeometry(1, 0.55, 1, 14);
    disc.translate(0, 0.5, 0);
    const clusters = 12, per = 22;
    const mat = addCaustics(new THREE.MeshStandardMaterial({ roughness: 0.5, emissive: new THREE.Color(0.22, 0.22, 0.22) }), 0.4, glowExtra());
    const inst = new THREE.InstancedMesh(disc, mat, clusters * per);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    let k = 0;
    const spots = [[-3.0, -1.9], [-0.6, -1.8], [1.0, -2.0], [3.6, -1.7], [-1.9, -2.3], [0.7, -2.6], [2.3, 0.4], [-3.5, 0.3], [-0.1, -1.0], [-2.4, -1.2], [2.0, -1.6], [-0.4, -1.4]];
    spots.forEach(([sx, sz], ci) => {
      const cc = col(palette[ci % palette.length]);
      for (let i = 0; i < per; i++) {
        const { p, n } = place(sx + (rng() - 0.5) * 0.45, sz + (rng() - 0.5) * 0.45);
        q.setFromUnitVectors(up, n);
        const s = 0.045 + rng() * 0.035;
        m4.compose(p, q, new THREE.Vector3(s, s * 0.7, s));
        inst.setMatrixAt(k, m4);
        inst.setColorAt(k, cc.clone().multiplyScalar(0.75 + rng() * 0.3));
        k++;
      }
    });
    scene.add(inst);
  }

  // Anemone — home of the clownfish
  const anemPos = place(-1.2, 0.1).p;
  const anemone = makeAnemone(rng);
  anemone.position.copy(anemPos);
  scene.add(anemone);

  return { obstacles, anemonePos: anemPos.clone().add(new THREE.Vector3(0, 0.45, 0)), rocks };
}
