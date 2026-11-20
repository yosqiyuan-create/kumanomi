// Underwater environment: caustics, background, sand, light shafts, particles, bubbles, surface
import * as THREE from 'three';
import { makeRng, fbm3, sandHeight } from './noise.js';

export const shared = {
  uTime: { value: 0 },
  uCaus: { value: null },
  uCausStrength: { value: 1.0 },
};

export const WATER_TOP = 7.0;
export const FOG_COLOR = new THREE.Color('#0d5873');

// ---------- Caustic texture (tileable Voronoi edges) ----------
export function makeCausticTexture(size = 256) {
  const rng = makeRng(7);
  const cells = 7;
  const pts = [];
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    pts.push([(i + 0.15 + 0.7 * rng()) / cells, (j + 0.15 + 0.7 * rng()) / cells]);
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x / size, py = y / size;
      const cx = Math.floor(px * cells), cy = Math.floor(py * cells);
      let f1 = 9, f2 = 9;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        let ix = cx + dx, iy = cy + dy, ox = 0, oy = 0;
        if (ix < 0) { ix += cells; ox = -1; } else if (ix >= cells) { ix -= cells; ox = 1; }
        if (iy < 0) { iy += cells; oy = -1; } else if (iy >= cells) { iy -= cells; oy = 1; }
        const p = pts[iy * cells + ix];
        const qx = p[0] + ox - px, qy = p[1] + oy - py;
        const d = Math.sqrt(qx * qx + qy * qy) * cells;
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
      }
      const e = f2 - f1;
      let v = Math.exp(-e * 9.0);
      v = Math.pow(v, 1.6);
      const k = (y * size + x) * 4;
      const b = Math.min(255, Math.round(v * 255));
      data[k] = data[k + 1] = data[k + 2] = b; data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const CAUSTIC_GLSL = /* glsl */`
uniform float uTime;
uniform sampler2D uCaus;
uniform float uCausStrength;
uniform float uCausLocal;
varying vec3 vCWP;
varying vec3 vCWN;
float causLayer(vec2 p){
  vec2 w = vec2(sin(p.y*4.0+uTime*0.8), cos(p.x*4.0+uTime*0.7))*0.018;
  float a = texture(uCaus, p + vec2(0.020,0.012)*uTime + w).r;
  float b = texture(uCaus, p*1.17 + vec2(-0.015,0.022)*uTime - w).r;
  return a*b*2.2 + (a+b)*0.12;
}
vec3 causticColor(vec3 wp){
  vec2 p = wp.xz*0.30 + vec2(wp.y*0.04, -wp.y*0.03);
  float r = causLayer(p);
  float g = causLayer(p + vec2(0.0035));
  float b = causLayer(p + vec2(0.0070));
  return vec3(r,g,b);
}
`;

let _matId = 0;
// Adds animated caustic light to a lit material. extra(shader) lets callers inject more.
export function addCaustics(mat, strength = 1.0, extra = null) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uCaus = shared.uCaus;
    shader.uniforms.uCausStrength = shared.uCausStrength;
    shader.uniforms.uCausLocal = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vCWP;\nvarying vec3 vCWN;')
      .replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 cwp = vec4(transformed, 1.0);
  vec3 cn = objectNormal;
#ifdef USE_INSTANCING
  cwp = instanceMatrix * cwp;
  cn = mat3(instanceMatrix) * cn;
#endif
  cwp = modelMatrix * cwp;
  vCWP = cwp.xyz;
  vCWN = normalize(mat3(modelMatrix) * cn);
}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + CAUSTIC_GLSL)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  float up = clamp(vCWN.y * 0.75 + 0.25, 0.0, 1.0);
  float depthF = mix(0.6, 1.0, clamp(vCWP.y / 7.0, 0.0, 1.0));
  reflectedLight.directDiffuse += diffuseColor.rgb * causticColor(vCWP) * up * depthF * uCausStrength * uCausLocal;
}`);
    if (extra) extra(shader);
  };
  const key = 'caus' + (++_matId);
  mat.customProgramCacheKey = () => key;
  return mat;
}

// ---------- Background gradient dome ----------
export function makeBackground() {
  const geo = new THREE.SphereGeometry(60, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uTime: shared.uTime, uFog: { value: FOG_COLOR } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vDir; uniform float uTime; uniform vec3 uFog;
      void main(){
        float y = vDir.y;
        vec3 deep = uFog*0.25;
        vec3 top  = vec3(0.10,0.42,0.55);
        vec3 c = mix(uFog, deep, smoothstep(0.0,-0.7,y));
        c = mix(c, top, smoothstep(0.05,0.9,y));
        float glow = pow(max(y,0.0),6.0)*0.6;
        c += vec3(0.25,0.45,0.5)*glow;
        gl_FragColor = vec4(c,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}

// ---------- Sand floor ----------
function makeSandTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  const rng = makeRng(3);
  for (let i = 0; i < 256 * 256; i++) {
    const x = i % 256, y = (i / 256) | 0;
    const n = fbm3(x * 0.08, y * 0.08, 1.7, 3) * 0.5 + 0.5;
    const grain = rng();
    let v = 0.82 + 0.1 * n + (grain - 0.5) * 0.22;
    if (grain > 0.985) v *= 0.55; // dark grains
    if (grain < 0.01) v = 1.05;   // shell bits
    img.data[i * 4] = Math.min(255, v * 236);
    img.data[i * 4 + 1] = Math.min(255, v * 222);
    img.data[i * 4 + 2] = Math.min(255, v * 192);
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 10);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function makeFloor() {
  const geo = new THREE.PlaneGeometry(50, 50, 100, 100);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, sandHeight(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();
  const mat = addCaustics(new THREE.MeshStandardMaterial({
    map: makeSandTexture(), roughness: 0.95, metalness: 0,
  }), 1.25);
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

// ---------- Light shafts ----------
export function makeLightRays(count = 7) {
  const group = new THREE.Group();
  const rng = makeRng(11);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    side: THREE.DoubleSide,
    uniforms: { uTime: shared.uTime },
    vertexShader: `attribute float aPhase; varying vec2 vUv; varying float vPh;
      void main(){ vUv = uv; vPh = aPhase; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform float uTime; varying vec2 vUv; varying float vPh;
      void main(){
        float edge = pow(sin(3.14159*vUv.x), 2.0);
        float fall = pow(vUv.y, 1.8);
        float flick = 0.55 + 0.45*sin(uTime*0.35 + vPh*6.28) * sin(uTime*0.21 + vPh*3.1);
        float a = edge*fall*flick*0.11;
        gl_FragColor = vec4(vec3(0.75,0.95,1.0)*a, a);
      }`,
  });
  for (let i = 0; i < count; i++) {
    const w = 0.6 + rng() * 1.1;
    const geo = new THREE.PlaneGeometry(w, 10, 1, 1);
    geo.translate(0, -5, 0);
    const ph = new Float32Array(4).fill(rng());
    geo.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    const m = new THREE.Mesh(geo, mat);
    m.position.set(-5 + rng() * 10, WATER_TOP + 0.3, -3 + rng() * 4);
    m.userData.tilt = 0.18 + rng() * 0.12;
    m.frustumCulled = false;
    group.add(m);
  }
  group.userData.update = (camera) => {
    for (const m of group.children) {
      const yaw = Math.atan2(camera.position.x - m.position.x, camera.position.z - m.position.z);
      m.rotation.set(0, 0, 0);
      m.rotateY(yaw);
      m.rotateZ(m.userData.tilt);
    }
  };
  return group;
}

// ---------- Floating particles (marine snow) ----------
export function makeParticles(count = 260) {
  const rng = makeRng(21);
  const pos = new Float32Array(count * 3);
  const ph = new Float32Array(count);
  const sz = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = -8 + rng() * 16;
    pos[i * 3 + 1] = rng() * WATER_TOP;
    pos[i * 3 + 2] = -6 + rng() * 11;
    ph[i] = rng();
    sz[i] = 0.5 + rng() * 1.2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: shared.uTime, uScale: { value: 300 } },
    vertexShader: `attribute float aPhase; attribute float aSize; uniform float uTime; uniform float uScale; varying float vA;
      void main(){
        vec3 p = position;
        float t = uTime;
        p.x += sin(t*0.13 + aPhase*37.0)*0.35;
        p.z += cos(t*0.11 + aPhase*23.0)*0.35;
        p.y = mod(p.y - t*0.04*(0.5+aPhase) , 7.0);
        vec4 mv = modelViewMatrix*vec4(p,1.0);
        gl_PointSize = aSize * uScale * 0.012 / -mv.z * 10.0;
        vA = clamp(1.0 - (-mv.z-2.0)/18.0, 0.0, 1.0);
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: `varying float vA;
      void main(){ vec2 c = gl_PointCoord-0.5; float d = length(c); float a = smoothstep(0.5,0.0,d)*0.45*vA;
        gl_FragColor = vec4(0.8,0.95,0.95,a); }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

// ---------- Bubbles from an air stone ----------
export function makeBubbles(origin, count = 70) {
  const rng = makeRng(31);
  const off = new Float32Array(count * 3);
  const ph = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    off[i * 3] = (rng() - 0.5) * 0.15;
    off[i * 3 + 1] = rng();          // start fraction
    off[i * 3 + 2] = (rng() - 0.5) * 0.15;
    ph[i] = rng();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(off, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: shared.uTime, uOrigin: { value: origin.clone() }, uScale: { value: 300 } },
    vertexShader: `attribute float aPhase; uniform float uTime; uniform vec3 uOrigin; uniform float uScale; varying float vA;
      void main(){
        float speed = 0.9 + aPhase*0.7;
        float h = 7.0 - uOrigin.y;
        float y = mod(position.y*h + uTime*speed, h);
        vec3 p = uOrigin + vec3(position.x, y, position.z);
        p.x += sin(uTime*6.0 + aPhase*40.0)*0.03*(y*0.3+0.2);
        p.z += cos(uTime*5.0 + aPhase*30.0)*0.03*(y*0.3+0.2);
        vec4 mv = modelViewMatrix*vec4(p,1.0);
        float s = 0.03 + aPhase*0.05 + y*0.004;
        gl_PointSize = s * uScale / -mv.z * 2.2;
        vA = smoothstep(h, h-0.3, y);
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: `varying float vA;
      void main(){ vec2 c = gl_PointCoord-0.5; float d = length(c);
        if(d>0.5) discard;
        float ring = smoothstep(0.30,0.48,d)*smoothstep(0.5,0.46,d);
        float hl = smoothstep(0.16,0.0,length(c-vec2(-0.15,-0.15)));
        float a = (ring*0.75 + hl*0.9 + 0.06)*vA;
        gl_FragColor = vec4(vec3(0.85,0.97,1.0), a); }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

// ---------- Water surface seen from below ----------
export function makeSurface() {
  const geo = new THREE.PlaneGeometry(240, 240, 1, 1);
  geo.rotateX(Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    uniforms: { uTime: shared.uTime, uCaus: shared.uCaus, uFog: { value: FOG_COLOR } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform float uTime; uniform sampler2D uCaus; uniform vec3 uFog; varying vec3 vW;
      void main(){
        vec2 p = vW.xz*0.12;
        float a = texture(uCaus, p + vec2(0.01,0.006)*uTime).r;
        float b = texture(uCaus, p*1.3 - vec2(0.008,0.012)*uTime).r;
        float pat = clamp(a*0.7 + b*0.5, 0.0, 1.0);
        float dist = length(vW.xz - cameraPosition.xz);
        float fade = exp(-dist*0.09);
        vec3 col = mix(vec3(0.06,0.36,0.47), vec3(0.62,0.9,0.98), pat*0.6*fade);
        col += vec3(0.18,0.3,0.3)*fade;
        float fogF = exp(-dist*0.055);
        col = mix(uFog, col, fogF);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = WATER_TOP + 0.4;
  m.frustumCulled = false;
  return m;
}
