import * as THREE from 'three';
import { OrbitControls } from '../lib/addons/controls/OrbitControls.js';
import { EffectComposer } from '../lib/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../lib/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../lib/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../lib/addons/postprocessing/OutputPass.js';
import {
  shared, makeCausticTexture, makeBackground, makeFloor, makeLightRays,
  makeParticles, makeBubbles, makeSurface, FOG_COLOR, WATER_TOP,
} from './env.js';
import { buildReef } from './reef.js';
import { Clownfish } from './fish.js';
import { FoodSystem } from './food.js';
import { loadState, saveState, simulate, catchUp, dayCount, careMessages, formatAway, RATES, stageName, welcomeNewFish } from './state.js';

export const APP = { name: '俺の水族館', version: '0.6.0' };

const QUALITY = {
  low: { label: '軽量', dpr: 1, shadows: false, shadowSize: 0, bloom: false, particles: 120, coral: 0.55 },
  mid: { label: '標準', dpr: 1.5, shadows: true, shadowSize: 1024, bloom: false, particles: 240, coral: 1 },
  high: { label: '高画質', dpr: 2, shadows: true, shadowSize: 2048, bloom: true, particles: 420, coral: 1 },
};
const qKey = (() => { try { return localStorage.getItem('reef.quality') || 'mid'; } catch { return 'mid'; } })();
const Q = QUALITY[qKey] || QUALITY.mid;

const setStatus = (t) => { const el = document.getElementById('splash-status'); if (el) el.textContent = t; };
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function init() {
  const startedAt = performance.now();
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.dpr));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = Q.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.055);
  shared.uCaus.value = makeCausticTexture(256);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 120);

  setStatus('海をつくっています…');
  await nextFrame();
  scene.add(makeBackground());
  scene.add(new THREE.HemisphereLight('#9fe6ff', '#4a3b2a', 1.1));
  const sun = new THREE.DirectionalLight('#eafcff', 2.6);
  sun.position.set(2.5, 14, 4);
  sun.target.position.set(0, 0, -0.5);
  sun.castShadow = Q.shadows;
  if (Q.shadows) {
    sun.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
    Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 2, far: 30 });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
  }
  scene.add(sun, sun.target);
  scene.add(makeFloor());
  scene.add(makeSurface());
  const rays = makeLightRays(8);
  scene.add(rays);
  const particles = makeParticles(Q.particles);
  scene.add(particles);
  scene.add(makeBubbles(new THREE.Vector3(3.9, 0.15, -1.2)));

  setStatus('サンゴを育てています…');
  await nextFrame();
  const reef = buildReef(scene, Q);

  setStatus('クマノミを呼んでいます…');
  await nextFrame();
  const food = new FoodSystem(scene, reef.obstacles);
  const state = loadState();
  const awaySec = catchUp(state);
  saveState(state);
  const spawnFish = () => {
    const f = new Clownfish(scene, { pos: reef.anemonePos.clone().add(new THREE.Vector3(0.6, 0.4, 0.3)), hunger: state.fish.hunger });
    f.health = state.fish.health;
    f.setGrowth(state.fish.growth);
    if (!state.fish.alive) f.die(true);
    return f;
  };
  let fish = spawnFish();
  const world = { food, obstacles: reef.obstacles, anemonePos: reef.anemonePos };

  // camera + controls
  const target = new THREE.Vector3(-0.3, 1.5, -0.9);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 2.5;
  controls.maxDistance = 13;
  controls.minPolarAngle = 1.0;
  controls.maxPolarAngle = 1.72;
  controls.minAzimuthAngle = -1.0;
  controls.maxAzimuthAngle = 1.0;
  controls.rotateSpeed = 0.6;

  function placeCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    camera.fov = aspect < 1 ? 62 : 48;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    const dist = aspect < 1 ? 7.0 : 8.0;
    camera.position.set(target.x, target.y + 0.7, target.z + dist);
    controls.update();
  }
  placeCamera();

  // post processing
  let composer = null;
  if (Q.bloom) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.55, 0.85));
    composer.addPass(new OutputPass());
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 1 ? 62 : 48;
    camera.updateProjectionMatrix();
    if (composer) composer.setSize(w, h);
    const s = h * renderer.getPixelRatio();
    particles.material.uniforms.uScale.value = s;
    scene.traverse((o) => { if (o.isPoints && o.material.uniforms?.uScale) o.material.uniforms.uScale.value = s; });
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- feeding by tap ----
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 350;
    down = null;
    if (moved > 10 || !quick) return;
    const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    if (ray.ray.intersectPlane(plane, hit)) {
      feed(THREE.MathUtils.clamp(hit.x, -4.2, 4.2), THREE.MathUtils.clamp(hit.y, 1.2, WATER_TOP - 0.2), 0);
    }
  });
  // height of the top of the visible area at depth z (so the food is seen falling)
  function visibleTop(x, z) {
    const pl = new THREE.Plane(new THREE.Vector3(0, 0, 1), -z);
    ray.setFromCamera(new THREE.Vector2(0, 0.62), camera);
    const h = new THREE.Vector3();
    return ray.ray.intersectPlane(pl, h) ? h.y : 4;
  }
  const toast = document.getElementById('toast');
  let toastTimer = 0;
  function showToast(text, ms = 1400) {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), ms);
  }
  function feed(x, y, z) {
    if (!state.fish.alive) return;
    food.drop(x, y, z, 10);
    showToast(fish.hunger > 0.95 ? 'おなかいっぱいみたい' : 'エサをあげました');
    hideHint();
  }
  // respond on touch release as well as click (iPhone), ignoring the duplicate
  let lastFeed = 0;
  const feedBtn = document.getElementById('btn-feed');
  const onFeedBtn = (e) => {
    e.preventDefault();
    const now = performance.now();
    if (now - lastFeed < 400) return;
    lastFeed = now;
    feedFromButton();
  };
  feedBtn.addEventListener('pointerup', onFeedBtn);
  feedBtn.addEventListener('click', onFeedBtn);
  function feedFromButton() {
    const x = world.anemonePos.x + 0.4 + (Math.random() - 0.5) * 0.8, z = world.anemonePos.z + 0.3;
    feed(x, THREE.MathUtils.clamp(visibleTop(x, z), world.anemonePos.y + 1.0, WATER_TOP - 0.2), z);
  }

  // ---- quality ----
  const qBtn = document.getElementById('btn-quality');
  qBtn.textContent = '画質：' + Q.label;
  qBtn.addEventListener('click', () => {
    const order = ['low', 'mid', 'high'];
    const next = order[(order.indexOf(qKey) + 1) % 3];
    try { localStorage.setItem('reef.quality', next); } catch {}
    location.reload();
  });
  // ---- close-up (follow the fish) ----
  let follow = false;
  const camBtn = document.getElementById('btn-camera');
  const lim = { minD: controls.minDistance, maxD: controls.maxDistance, minA: controls.minAzimuthAngle, maxA: controls.maxAzimuthAngle, minP: controls.minPolarAngle, maxP: controls.maxPolarAngle };
  function setFollow(on) {
    follow = on;
    camBtn.textContent = on ? '全体を見る' : '近くで見る';
    if (on) {
      Object.assign(controls, { minDistance: 0.7, maxDistance: 4, minAzimuthAngle: -Infinity, maxAzimuthAngle: Infinity, minPolarAngle: 0.35, maxPolarAngle: 2.5 });
      const dir = camera.position.clone().sub(controls.target).normalize();
      controls.target.copy(fish.object.position);
      camera.position.copy(fish.object.position).addScaledVector(dir, 1.7);
    } else {
      Object.assign(controls, { minDistance: lim.minD, maxDistance: lim.maxD, minAzimuthAngle: lim.minA, maxAzimuthAngle: lim.maxA, minPolarAngle: lim.minP, maxPolarAngle: lim.maxP });
      placeCamera();
    }
    controls.update();
  }
  camBtn.addEventListener('click', () => setFollow(!follow));
  const _fd = new THREE.Vector3();
  function updateFollow(dt) {
    if (!follow) return;
    _fd.copy(fish.object.position).sub(controls.target).multiplyScalar(Math.min(1, dt * 3));
    controls.target.add(_fd);
    camera.position.add(_fd);
  }

  // ---- hint ----
  const hint = document.getElementById('hint');
  let hintTimer = setTimeout(() => hideHint(), 9000);
  function hideHint() { hint.classList.add('hide'); clearTimeout(hintTimer); }

  // ---- water change ----
  let cleaning = 0; // amount of dirt still to remove (animated)
  const waterBtn = document.getElementById('btn-water');
  let lastWater = 0;
  const onWater = (e) => {
    e.preventDefault();
    const now = performance.now();
    if (now - lastWater < 600) return;
    lastWater = now;
    if (state.tank.dirt < 0.08) { showToast('水はきれいです'); return; }
    cleaning = Math.min(state.tank.dirt, 0.6);
    showToast('水換えをしました');
    hideHint();
  };
  waterBtn.addEventListener('pointerup', onWater);
  waterBtn.addEventListener('click', onWater);

  // ---- water look follows how dirty the tank is ----
  const cleanFog = FOG_COLOR.clone(), dirtyFog = new THREE.Color('#3d5a3a');
  function applyWater(dirt) {
    const k = THREE.MathUtils.smoothstep(dirt, 0.2, 1.0);
    FOG_COLOR.copy(cleanFog).lerp(dirtyFog, k * 0.85);
    scene.fog.color.copy(FOG_COLOR);
    scene.fog.density = 0.055 + 0.08 * k;
    shared.uCausStrength.value = 1.0 - 0.55 * k;
  }

  // ---- name ----
  const nameEl = document.getElementById('fish-name');
  const dayEl = document.getElementById('day-count');
  const msgEl = document.getElementById('care-msg');
  nameEl.textContent = state.fish.name;
  nameEl.addEventListener('click', () => {
    const n = window.prompt('クマノミの名前をつけてください', state.fish.name);
    if (n && n.trim()) { state.fish.name = n.trim().slice(0, 12); nameEl.textContent = state.fish.name; saveState(state); }
  });

  // ---- status ----
  const bars = { hunger: document.getElementById('hunger-bar'), health: document.getElementById('health-bar'), water: document.getElementById('water-bar') };
  function setBar(el, v) {
    el.style.width = Math.round(v * 100) + '%';
    el.classList.toggle('low', v < 0.25);
  }
  function updateHud() {
    setBar(bars.hunger, state.fish.hunger);
    setBar(bars.health, state.fish.health);
    setBar(bars.water, 1 - state.tank.dirt);
    dayEl.textContent = `${stageName(state.fish.growth)}・飼って${dayCount(state)}日目`;
    const m = careMessages(state);
    msgEl.textContent = m[0] || '';
    msgEl.style.display = m.length ? 'block' : 'none';
  }
  updateHud();
  applyWater(state.tank.dirt);

  // ---- death / farewell ----
  const deathEl = document.getElementById('death');
  const causeText = { hunger: 'おなかがすいたままでした', water: '水が汚れたままでした', both: 'おなかがすいて、水も汚れていました' };
  let deathShown = false;
  function showDeath(delay = 0) {
    if (deathShown) return;
    deathShown = true;
    if (follow) setFollow(false);
    const f = state.fish;
    document.getElementById('death-title').textContent = `${f.name}は天国へ旅立ちました`;
    document.getElementById('death-days').textContent = `いっしょに過ごした日数：${dayCount(state)}日`;
    document.getElementById('death-cause').textContent = '原因：' + (causeText[f.cause] || '弱ってしまいました');
    setTimeout(() => deathEl.classList.add('show'), delay);
  }
  function checkDeath(delay) {
    if (!state.fish.alive) {
      fish.die();
      showDeath(delay);
    }
  }
  document.getElementById('btn-newfish').addEventListener('click', () => {
    const f = state.fish;
    state.graves.push({ name: f.name, days: dayCount(state), diedAt: f.diedAt || Date.now(), cause: f.cause || '' });
    const name = (window.prompt('新しいクマノミの名前をつけてください', 'クマノミ') || 'クマノミ').trim().slice(0, 12) || 'クマノミ';
    welcomeNewFish(state, name);
    saveState(state);
    scene.remove(fish.object);
    fish = spawnFish();
    window.__reef.fish = fish;
    nameEl.textContent = state.fish.name;
    deathEl.classList.remove('show');
    deathShown = false;
    updateHud();
    showToast(`${name}がやってきました！`, 2200);
  });

  // ---- save / resume ----
  function resumeFromBackground() {
    const away = catchUp(state);
    fish.hunger = state.fish.hunger; fish.health = state.fish.health;
    applyWater(state.tank.dirt);
    updateHud();
    if (!state.fish.alive) { checkDeath(300); return; }
    const a = formatAway(away);
    if (a && away > 600) showToast(a + '！' + (careMessages(state)[0] || 'みんな元気です'), 2600);
  }
  setInterval(() => saveState(state), 10000);
  window.addEventListener('pagehide', () => saveState(state));

  // warm up shaders, then reveal
  setStatus('もうすぐです…');
  renderer.compile(scene, camera);
  await nextFrame();
  if (composer) composer.render(); else renderer.render(scene, camera);
  const wait = Math.max(0, 2200 - (performance.now() - startedAt));
  setTimeout(() => {
    document.getElementById('splash').classList.add('hide');
    document.getElementById('hud').classList.add('show');
    hint.classList.add('show');
    if (!state.fish.alive) { showDeath(1200); return; }
    const a = formatAway(awaySec);
    if (a && awaySec > 600) setTimeout(() => showToast(a + '！' + (careMessages(state)[0] || 'みんな元気です'), 2800), 900);
  }, wait);

  // ---- loop ----
  const clock = new THREE.Clock();
  let running = true;
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) { clock.getDelta(); resumeFromBackground(); } else saveState(state);
  });
  let hudT = 0;
  function loop() {
    requestAnimationFrame(loop);
    if (!running) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    shared.uTime.value += dt;
    const t = shared.uTime.value;
    food.update(dt, t);
    // real-time care simulation
    state.fish.hunger = fish.hunger;
    simulate(state, dt);
    if (food.rotted) { state.tank.dirt = Math.min(1, state.tank.dirt + food.rotted * RATES.dirtPerRottenPellet); food.rotted = 0; }
    if (cleaning > 0) { const d = Math.min(cleaning, dt * 0.35); cleaning -= d; state.tank.dirt = Math.max(0, state.tank.dirt - d); }
    fish.hunger = state.fish.hunger; fish.health = state.fish.health;
    if (!state.fish.alive && !fish.dead) checkDeath(3000);
    const dbg = window.__reef && window.__reef.paused;
    if (!dbg) fish.update(dt, world);
    state.fish.hunger = fish.hunger;
    rays.userData.update(camera);
    if (!dbg) { updateFollow(dt); controls.update(); }
    hudT += dt;
    if (hudT > 0.5) { hudT = 0; updateHud(); applyWater(state.tank.dirt); fish.setGrowth(state.fish.growth); }
    if (composer) composer.render(); else renderer.render(scene, camera);
  }
  loop();
  window.__reef = { scene, camera, fish, food, controls, renderer, world, state };
}

init().catch((err) => {
  console.error(err);
  setStatus('うまく起動できませんでした。ページを開き直してください。');
});
