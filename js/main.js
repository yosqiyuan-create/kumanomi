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
import { AquariumSound, SOUND_LABEL } from './sound.js';
import {
  loadState, saveState, simulate, catchUp, dayCount, careMessages, worstMessage, formatAway, RATES,
  stageName, sexName, addFish, farewell, aliveFishes, updateSexes, MAX_FISH,
} from './state.js';

export const APP = { name: '俺の水族館', version: '0.9.0' };

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
  const femaleBefore = state.fishes.find((d) => d.sex === 'female');
  const awaySec = catchUp(state);
  saveState(state);

  // one 3D fish per saved fish
  const fishes = [];
  const world = { food, obstacles: reef.obstacles, anemonePos: reef.anemonePos, fishes };
  function spawnFish(data, arriving = false) {
    const start = arriving
      ? reef.anemonePos.clone().add(new THREE.Vector3(0.8, 2.6, 0.4))
      : reef.anemonePos.clone().add(new THREE.Vector3(0.6 - fishes.length * 1.0, 0.4 + fishes.length * 0.3, 0.3));
    const f = new Clownfish(scene, { pos: start, hunger: data.hunger });
    f.data = data;
    f.health = data.health;
    f.setGrowth(data.growth);
    if (!data.alive) f.die(true);
    fishes.push(f);
    return f;
  }
  state.fishes.forEach((d) => spawnFish(d));
  let sel = Math.max(0, state.fishes.findIndex((d) => d.alive));
  const selFish = () => fishes[Math.min(sel, fishes.length - 1)];

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

  // ---- toast ----
  const toast = document.getElementById('toast');
  let toastTimer = 0;
  function showToast(text, ms = 1400) {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), ms);
  }
  // buttons respond on touch release as well as click (iPhone), ignoring the duplicate
  function onTap(el, fn) {
    let last = 0;
    const h = (e) => { e.preventDefault(); const now = performance.now(); if (now - last < 450) return; last = now; fn(); };
    el.addEventListener('pointerup', h);
    el.addEventListener('click', h);
  }

  // ---- sound ----
  const sound = new AquariumSound();
  food.onEat = (pos) => sound.eat(pos);
  const unlock = () => sound.start();
  document.addEventListener('pointerup', unlock);
  document.addEventListener('touchend', unlock);
  const soundBtn = document.getElementById('btn-sound');
  const soundLabel = () => { soundBtn.textContent = SOUND_LABEL[sound.mode]; };
  soundLabel();
  soundBtn.addEventListener('click', () => { sound.nextMode(); soundLabel(); showToast(SOUND_LABEL[sound.mode]); });

  // ---- feeding ----
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
  function feed(x, y, z) {
    const alive = fishes.filter((f) => !f.dead);
    if (!alive.length) return;
    food.drop(x, y, z, 8 + alive.length * 4);
    sound.plop({ x, y, z });
    showToast(alive.every((f) => f.hunger > 0.95) ? 'おなかいっぱいみたい' : 'エサをあげました');
    hideHint();
  }
  onTap(document.getElementById('btn-feed'), () => {
    const x = world.anemonePos.x + 0.4 + (Math.random() - 0.5) * 0.8, z = world.anemonePos.z + 0.3;
    feed(x, THREE.MathUtils.clamp(visibleTop(x, z), world.anemonePos.y + 1.0, WATER_TOP - 0.2), z);
  });

  // ---- quality ----
  const qBtn = document.getElementById('btn-quality');
  qBtn.textContent = '画質：' + Q.label;
  qBtn.addEventListener('click', () => {
    const order = ['low', 'mid', 'high'];
    const next = order[(order.indexOf(qKey) + 1) % 3];
    try { localStorage.setItem('reef.quality', next); } catch {}
    location.reload();
  });

  // ---- close-up (follow the selected fish) ----
  let follow = false;
  const camBtn = document.getElementById('btn-camera');
  const lim = { minD: controls.minDistance, maxD: controls.maxDistance, minA: controls.minAzimuthAngle, maxA: controls.maxAzimuthAngle, minP: controls.minPolarAngle, maxP: controls.maxPolarAngle };
  function setFollow(on) {
    follow = on;
    camBtn.textContent = on ? '全体を見る' : '近くで見る';
    if (on) {
      Object.assign(controls, { minDistance: 0.7, maxDistance: 4, minAzimuthAngle: -Infinity, maxAzimuthAngle: Infinity, minPolarAngle: 0.35, maxPolarAngle: 2.5 });
      const dir = camera.position.clone().sub(controls.target).normalize();
      controls.target.copy(selFish().object.position);
      camera.position.copy(selFish().object.position).addScaledVector(dir, 1.7);
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
    _fd.copy(selFish().object.position).sub(controls.target).multiplyScalar(Math.min(1, dt * 3));
    controls.target.add(_fd);
    camera.position.add(_fd);
  }

  // ---- hint ----
  const hint = document.getElementById('hint');
  let hintTimer = setTimeout(() => hideHint(), 9000);
  function hideHint() { hint.classList.add('hide'); clearTimeout(hintTimer); }

  // ---- water change ----
  let cleaning = 0; // amount of dirt still to remove (animated)
  onTap(document.getElementById('btn-water'), () => {
    if (state.tank.dirt < 0.08) { showToast('水はきれいです'); return; }
    cleaning = Math.min(state.tank.dirt, 0.6);
    sound.waterChange();
    showToast('水換えをしました');
    hideHint();
  });

  // ---- water look follows how dirty the tank is ----
  const cleanFog = FOG_COLOR.clone(), dirtyFog = new THREE.Color('#3d5a3a');
  function applyWater(dirt) {
    const k = THREE.MathUtils.smoothstep(dirt, 0.2, 1.0);
    FOG_COLOR.copy(cleanFog).lerp(dirtyFog, k * 0.85);
    scene.fog.color.copy(FOG_COLOR);
    scene.fog.density = 0.055 + 0.08 * k;
    shared.uCausStrength.value = 1.0 - 0.55 * k;
  }

  // ---- status card (shows the selected fish) ----
  const nameEl = document.getElementById('fish-name');
  const dayEl = document.getElementById('day-count');
  const msgEl = document.getElementById('care-msg');
  const switchEl = document.getElementById('fish-switch');
  nameEl.addEventListener('click', () => {
    const d = selFish().data;
    const n = window.prompt('クマノミの名前をつけてください', d.name);
    if (n && n.trim()) { d.name = n.trim().slice(0, 12); saveState(state); updateHud(); }
  });
  onTap(switchEl, () => {
    if (fishes.length < 2) return;
    sel = (sel + 1) % fishes.length;
    updateHud();
    if (follow) setFollow(true);
    showToast(selFish().data.name);
  });
  const bars = { hunger: document.getElementById('hunger-bar'), health: document.getElementById('health-bar'), water: document.getElementById('water-bar') };
  function setBar(el, v) {
    el.style.width = Math.round(v * 100) + '%';
    el.classList.toggle('low', v < 0.25);
  }
  const mateBtn = document.getElementById('btn-mate');
  function updateHud() {
    if (sel >= fishes.length) sel = 0;
    const d = selFish().data;
    nameEl.textContent = d.name;
    switchEl.style.display = fishes.length > 1 ? 'inline-block' : 'none';
    switchEl.textContent = `${sel + 1}/${fishes.length} ▶`;
    setBar(bars.hunger, d.hunger);
    setBar(bars.health, d.health);
    setBar(bars.water, 1 - state.tank.dirt);
    const sx = sexName(d);
    dayEl.textContent = `${stageName(d.growth)}${sx ? '・' + sx : ''}・飼って${dayCount(d)}日目`;
    const m = careMessages(state, d);
    msgEl.textContent = m[0] || '';
    msgEl.style.display = m.length ? 'block' : 'none';
    mateBtn.style.display = aliveFishes(state).length < MAX_FISH && !fishes.some((f) => f.dead) ? '' : 'none';
  }

  // ---- welcome a companion (make a pair) ----
  function welcome(name) {
    const d = addFish(state, name);
    const f = spawnFish(d, true);
    sel = fishes.indexOf(f);
    saveState(state);
    updateHud();
    showToast(`${name}がやってきました！`, 2200);
  }
  onTap(mateBtn, () => {
    if (aliveFishes(state).length >= MAX_FISH) return;
    const n = window.prompt('仲間のクマノミの名前をつけてください', 'クマノミ2');
    if (n === null) return;
    welcome((n.trim() || 'クマノミ').slice(0, 12));
  });

  // ---- death / farewell (one fish at a time) ----
  const deathEl = document.getElementById('death');
  const causeText = { hunger: 'おなかがすいたままでした', water: '水が汚れたままでした', both: 'おなかがすいて、水も汚れていました' };
  const deathQueue = [];
  let deathShowing = null;
  function queueDeath(f, delay = 0) {
    if (deathQueue.includes(f) || deathShowing === f) return;
    f.die();
    deathQueue.push(f);
    setTimeout(showNextDeath, delay);
  }
  function showNextDeath() {
    if (deathShowing || !deathQueue.length) return;
    const f = deathShowing = deathQueue.shift();
    if (follow) setFollow(false);
    const d = f.data;
    document.getElementById('death-title').textContent = `${d.name}は天国へ旅立ちました`;
    document.getElementById('death-days').textContent = `いっしょに過ごした日数：${dayCount(d)}日`;
    document.getElementById('death-cause').textContent = '原因：' + (causeText[d.cause] || '弱ってしまいました');
    const others = fishes.some((o) => o !== f && !o.dead);
    document.getElementById('btn-newfish').textContent = others ? 'お別れする' : '新しいクマノミを迎える';
    deathEl.classList.add('show');
  }
  onTap(document.getElementById('btn-newfish'), () => {
    const f = deathShowing;
    if (!f) return;
    farewell(state, f.data);
    scene.remove(f.object);
    fishes.splice(fishes.indexOf(f), 1);
    deathShowing = null;
    deathEl.classList.remove('show');
    if (!fishes.some((o) => !o.dead) && !deathQueue.length) {
      const n = window.prompt('新しいクマノミの名前をつけてください', 'クマノミ');
      welcome(((n || '').trim() || 'クマノミ').slice(0, 12));
    } else {
      sel = 0;
      saveState(state);
      updateHud();
      setTimeout(showNextDeath, 600);
    }
  });
  function checkDeaths(delay) {
    for (const f of fishes) if (!f.data.alive && !f.dead) queueDeath(f, delay);
    for (const f of fishes) if (!f.data.alive && f.dead && !deathQueue.includes(f) && deathShowing !== f) { deathQueue.push(f); setTimeout(showNextDeath, delay); }
  }

  updateHud();
  applyWater(state.tank.dirt);

  // ---- save / resume ----
  let lastFemale = femaleBefore;
  function announceSex() {
    const fem = state.fishes.find((d) => d.sex === 'female' && d.alive);
    if (fem && fem !== lastFemale) showToast(`${fem.name}がメスになりました！ペアの誕生です`, 3200);
    lastFemale = fem;
  }
  function syncFromState() {
    for (const f of fishes) { f.hunger = f.data.hunger; f.health = f.data.health; }
  }
  function resumeFromBackground() {
    const away = catchUp(state);
    syncFromState();
    applyWater(state.tank.dirt);
    updateHud();
    announceSex();
    checkDeaths(300);
    const a = formatAway(away);
    if (a && away > 600 && !deathQueue.length) showToast(a + '！' + (worstMessage(state) || 'みんな元気です'), 2600);
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
    checkDeaths(1200);
    if (fishes.some((f) => f.dead)) return;
    const a = formatAway(awaySec);
    if (a && awaySec > 600) setTimeout(() => showToast(a + '！' + (worstMessage(state) || 'みんな元気です'), 2800), 900);
    setTimeout(announceSex, a && awaySec > 600 ? 4000 : 900);
  }, wait);

  // ---- loop ----
  const clock = new THREE.Clock();
  let running = true;
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) { clock.getDelta(); resumeFromBackground(); sound.resume(); } else { saveState(state); sound.suspend(); }
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
    for (const f of fishes) f.data.hunger = f.hunger;
    simulate(state, dt);
    if (food.rotted) { state.tank.dirt = Math.min(1, state.tank.dirt + food.rotted * RATES.dirtPerRottenPellet); food.rotted = 0; }
    if (cleaning > 0) { const d = Math.min(cleaning, dt * 0.35); cleaning -= d; state.tank.dirt = Math.max(0, state.tank.dirt - d); }
    syncFromState();
    for (const f of fishes) if (!f.data.alive && !f.dead) queueDeath(f, 3000);
    const dbg = window.__reef && window.__reef.paused;
    if (!dbg) for (const f of fishes) f.update(dt, world);
    for (const f of fishes) f.data.hunger = f.hunger;
    rays.userData.update(camera);
    sound.updateListener(camera);
    if (!dbg) { updateFollow(dt); controls.update(); }
    hudT += dt;
    if (hudT > 0.5) {
      hudT = 0;
      updateHud();
      applyWater(state.tank.dirt);
      for (const f of fishes) f.setGrowth(f.data.growth);
      announceSex();
    }
    if (composer) composer.render(); else renderer.render(scene, camera);
  }
  loop();
  window.__reef = { scene, camera, fishes, get fish() { return fishes[0]; }, food, controls, renderer, world, state };
}

init().catch((err) => {
  console.error(err);
  setStatus('うまく起動できませんでした。ページを開き直してください。');
});
