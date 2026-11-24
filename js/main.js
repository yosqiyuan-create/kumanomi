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
import { EggCluster } from './eggs.js';
import { JellyTank, LIGHTS } from './jelly.js';
import { AquariumSound, SOUND_LABEL } from './sound.js';
import {
  loadState, saveState, simulate, catchUp, dayCount, careMessages, worstMessage, formatAway, RATES,
  stageName, sexName, addFish, farewell, aliveFishes, updateSexes, MAX_FISH, PAIR,
  feedNursery, moveFryToTank, releaseFry, nurseryInfo,
  exportCode, parseBackup, restoreBackup, backupSummary,
} from './state.js';

export const APP = { name: '俺の水族館', version: '0.17.2' };

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
  const world = { food, obstacles: reef.obstacles, anemonePos: reef.anemonePos, fishes, eggSpot: null };
  const eggs = new EggCluster(scene, reef.eggSpot);
  function updateEggs() {
    const c = state.breed.clutch;
    world.eggSpot = c ? reef.eggSpot : null;
    eggs.update(c ? { eggs: c.eggs, laid: c.laid, progress: Math.min(1, (Date.now() - c.laidAt) / (c.hatchAt - c.laidAt)) } : null);
  }
  updateEggs();
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
  controls.minDistance = 0.45;          // pinch out to get really close
  controls.zoomToCursor = true;          // zoom toward where the fingers are
  controls.zoomSpeed = 1.2;
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
    controls.target.copy(target);
    camera.position.set(target.x, target.y + 0.7, target.z + dist);
    controls.update();
  }
  placeCamera();

  let mode = 'menu';   // 'menu' (main screen), 'reef' (clownfish tank) or 'jelly' (jellyfish tank)
  let jelly = null;

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
    if (jelly) { jelly.setSize(w, h); jelly.scene.traverse((o) => { if (o.isPoints && o.material.uniforms?.uScale) o.material.uniforms.uScale.value = s; }); }
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- toast ----
  const toast = document.getElementById('toast');
  let toastTimer = 0;
  const toastQueue = [];
  let toastBusy = false;
  // important news: shown one after another
  function queueToast(text, ms = 3600) {
    toastQueue.push([text, ms]);
    if (!toastBusy) nextToast();
  }
  function nextToast() {
    const it = toastQueue.shift();
    if (!it) { toastBusy = false; return; }
    toastBusy = true;
    showToast(it[0], it[1]);
    setTimeout(nextToast, it[1] + 350);
  }
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
  document.addEventListener('click', unlock);
  document.addEventListener('pointerup', unlock);
  document.addEventListener('touchend', unlock);
  const soundBtn = document.getElementById('btn-sound');
  const soundLabel = () => { soundBtn.textContent = SOUND_LABEL[sound.mode]; };
  soundLabel();
  soundBtn.addEventListener('click', () => { sound.nextMode(); soundLabel(); showToast(SOUND_LABEL[sound.mode]); });

  // ---- settings: backup / restore ----
  const setEl = document.getElementById('settings');
  const setCode = document.getElementById('set-code');
  const setInfo = document.getElementById('set-info');
  function openSettings() {
    updateHud();
    setCode.value = '';
    document.getElementById('ver-info').textContent = '今のバージョン：' + APP.version;
    renderJellyHud();
    let last = '';
    try { last = localStorage.getItem('ore-no-suizokukan.lastBackup') || ''; } catch {}
    setInfo.textContent = last ? `前回のバックアップ：${last}` : 'まだバックアップしていません';
    setEl.classList.add('show');
  }
  function markBackup() {
    const d = new Date();
    const t = `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    try { localStorage.setItem('ore-no-suizokukan.lastBackup', t); } catch {}
    setInfo.textContent = `前回のバックアップ：${t}`;
  }
  onTap(document.getElementById('btn-settings'), openSettings);
  onTap(document.getElementById('btn-back'), () => showMenu());

  // ---- version up: compare with the published page, reload fresh ----
  const verNum = (v) => v.split('.').map((x) => parseInt(x, 10) || 0);
  const newer = (a, b) => { const x = verNum(a), y = verNum(b); for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] > y[i]; } return false; };
  const verUpd = document.getElementById('ver-update');
  onTap(document.getElementById('ver-check'), async () => {
    const info = document.getElementById('ver-info');
    info.textContent = '確認しています…';
    try {
      const html = await (await fetch('./index.html?v=' + Date.now(), { cache: 'no-store' })).text();
      const m = html.match(/Version (\d+\.\d+\.\d+)/);
      const latest = m ? m[1] : null;
      if (latest && newer(latest, APP.version)) {
        info.textContent = `新しいバージョン ${latest} があります（今は ${APP.version}）`;
        verUpd.style.display = '';
      } else {
        info.textContent = `今のバージョン ${APP.version} が最新です`;
        verUpd.style.display = 'none';
      }
    } catch {
      info.textContent = '確認できませんでした（通信を確認してください）';
    }
  });
  onTap(verUpd, () => {
    saveState(state);
    try { localStorage.setItem('ore-no-suizokukan.autoBackup', exportCode(state)); } catch {}
    location.replace('./?v=' + Date.now());
  });
  onTap(document.getElementById('set-close'), () => setEl.classList.remove('show'));
  onTap(document.getElementById('set-copy'), async () => {
    saveState(state);
    const code = exportCode(state);
    setCode.value = code;
    try { await navigator.clipboard.writeText(code); showToast('バックアップをコピーしました\nメモ帳などに貼って保管してください', 3000); }
    catch { setCode.select(); showToast('下の枠の文字を全部コピーして保管してください', 3000); }
    markBackup();
  });
  onTap(document.getElementById('set-file'), async () => {
    saveState(state);
    const code = exportCode(state);
    const d = new Date();
    const name = `俺の水族館_バックアップ_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.txt`;
    const file = new File([code], name, { type: 'text/plain' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: '俺の水族館 バックアップ' });
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click(); }
      markBackup();
    } catch {}
  });
  function doRestore(text) {
    const s2 = parseBackup(text);
    if (!s2) { showToast('バックアップの文字が正しくありません', 2600); return; }
    if (!window.confirm(`このデータに戻しますか？\n${backupSummary(s2)}\n（今のデータは上書きされます）`)) return;
    if (!restoreBackup(s2)) { showToast('戻せませんでした', 2400); return; }
    showToast('データを戻しました。読み込み直します…', 2000);
    setTimeout(() => location.reload(), 1200);
  }
  onTap(document.getElementById('set-restore'), () => doRestore(setCode.value));
  const fileIn = document.getElementById('set-file-in');
  onTap(document.getElementById('set-load'), () => fileIn.click());
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files && fileIn.files[0];
    if (!f) return;
    doRestore(await f.text());
    fileIn.value = '';
  });
  // ask the browser to keep this app's data (helps against automatic clean-up)
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch {}

  // ---- feeding ----
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down) return;
    if (mode === 'jelly') { jellySwipe(e); down = null; return; }
    if (mode === 'reef' && down.x < 36 && e.clientX - down.x > 70 && Math.abs(e.clientY - down.y) < 120) { down = null; showMenu(); return; }
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
    if (camBtn) camBtn.textContent = on ? '🌊 全体を見る' : '🔍 近くで見る';
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
  if (camBtn) onTap(camBtn, () => { setEl.classList.remove('show'); setFollow(!follow); });
  const _fd = new THREE.Vector3();
  function updateFollow(dt) {
    if (!follow) return;
    _fd.copy(selFish().object.position).sub(controls.target).multiplyScalar(Math.min(1, dt * 3));
    controls.target.add(_fd);
    camera.position.add(_fd);
  }

  // ---- hint ----
  const hint = document.getElementById('hint');
  let hintTimer = 0;
  function hideHint() { hint.classList.add('hide'); clearTimeout(hintTimer); }

  // ---- water change ----
  let cleaning = 0; // amount of dirt still to remove (animated)
  onTap(document.getElementById('btn-water'), () => {
    setEl.classList.remove('show');
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
  const nurseryBtn = document.getElementById('btn-nursery');
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
    mateBtn.style.display = aliveFishes(state).length < PAIR && !fishes.some((f) => f.dead) ? '' : 'none';
    nurseryBtn.style.display = state.breed.clutch || state.breed.nursery ? '' : 'none';
    const ni = nurseryInfo(state);
    nurseryBtn.textContent = ni.fry ? `🐟 稚魚水槽（${ni.fry}）` : '🥚 卵を見る';
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
    setEl.classList.remove('show');
    if (aliveFishes(state).length >= PAIR) return;
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
    if (deathShowing || !deathQueue.length || mode !== 'reef') return;
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

  // ---- breeding news ----
  const eventText = {
    'spawn': (e) => `ペアが産卵しました！（卵 約${e.n}個）\n${e.father}が卵を守っています`,
    'eggs-lost': () => '卵がだめになってしまいました…\n水をきれいに保ちましょう',
    'hatch': (e) => `卵がふ化しました！赤ちゃん${e.n}匹\n稚魚水槽でワムシをあげてください`,
    'settled': (e) => `稚魚${e.n}匹が、底で暮らせるようになりました`,
    'fry-ready': (e) => `稚魚${e.n}匹が幼魚に育ちました！\n水槽に移すか、里親に出せます`,
    'fry-lost': () => '稚魚がいなくなってしまいました…',
  };
  function drainEvents() {
    while (state.events.length) {
      const e = state.events.shift();
      const f = eventText[e.type];
      if (f) queueToast(f(e), 4200);
    }
  }

  // ---- nursery panel (eggs + fry) ----
  const nyEl = document.getElementById('nursery');
  const nyTank = document.getElementById('ny-tank');
  let nyOpen = false;
  function renderNursery() {
    const ni = nurseryInfo(state);
    document.getElementById('ny-eggs').innerHTML = ni.eggs
      ? `<b>卵</b>：約${ni.eggs}個・産卵${ni.eggDay}日目<br>ふ化まで あと約${ni.hatchIn}日（オスが守っています）`
      : '<b>卵</b>：今はありません';
    const fryBox = document.getElementById('ny-fry');
    if (ni.fry) {
      fryBox.innerHTML = `<b>稚魚</b>：${ni.fry}匹・ふ化${ni.fryDay}日目<br>${ni.fryStage}` + (ni.ready ? '' : `<br>水槽に移せるまで あと約${ni.readyIn}日`);
      const bar = document.getElementById('ny-hunger-bar');
      bar.style.width = Math.round(ni.fryHunger * 100) + '%';
      bar.classList.toggle('low', ni.fryHunger < 0.25);
      document.getElementById('ny-hunger').style.display = '';
      document.getElementById('ny-feed').style.display = '';
      const canMove = ni.ready && aliveFishes(state).length < MAX_FISH;
      document.getElementById('ny-move').style.display = canMove ? '' : 'none';
      document.getElementById('ny-release').style.display = ni.ready ? '' : 'none';
      nyTank.style.display = '';
      // little moving dots for the babies
      const want = Math.min(40, ni.fry);
      while (nyTank.children.length < want) {
        const d = document.createElement('i');
        d.style.left = (5 + Math.random() * 90) + '%';
        d.style.top = (10 + Math.random() * 80) + '%';
        d.style.animationDelay = (-Math.random() * 6) + 's';
        d.style.animationDuration = (4 + Math.random() * 4) + 's';
        nyTank.appendChild(d);
      }
      while (nyTank.children.length > want) nyTank.lastChild.remove();
      nyTank.classList.toggle('grown', ni.fryDay > 10);
    } else {
      fryBox.innerHTML = '<b>稚魚</b>：今はいません';
      for (const id of ['ny-hunger', 'ny-feed', 'ny-move', 'ny-release']) document.getElementById(id).style.display = 'none';
      nyTank.style.display = 'none';
    }
  }
  onTap(nurseryBtn, () => { setEl.classList.remove('show'); nyOpen = true; renderNursery(); nyEl.classList.add('show'); });
  onTap(document.getElementById('ny-close'), () => { nyOpen = false; nyEl.classList.remove('show'); });
  onTap(document.getElementById('ny-feed'), () => {
    if (feedNursery(state)) { sound.plop(null); showToast('ワムシをあげました'); renderNursery(); saveState(state); }
  });
  onTap(document.getElementById('ny-move'), () => {
    const n = window.prompt('水槽に移す子の名前をつけてください', 'チビ');
    if (n === null) return;
    const d = moveFryToTank(state, (n.trim() || 'チビ').slice(0, 12));
    if (!d) { showToast('今は移せません'); return; }
    spawnFish(d, true);
    saveState(state); updateHud(); renderNursery();
    showToast(`${d.name}が水槽にやってきました！`, 2400);
  });
  onTap(document.getElementById('ny-release'), () => {
    if (!window.confirm('残っている稚魚を全部、里親に出しますか？')) return;
    const n = releaseFry(state);
    saveState(state); updateHud(); renderNursery();
    showToast(`${n}匹を里親に出しました。元気でね！`, 2600);
    nyOpen = false; nyEl.classList.remove('show');
  });

  // ---- jellyfish tank (viewing only) ----
  const hudEl = document.getElementById('hud');
  const jHud = document.getElementById('jelly-hud');
  const jLightBtn = document.getElementById('btn-jlight');
  function ensureJelly() {
    if (!jelly) {
      jelly = new JellyTank(renderer, Math.round(Q.particles * 0.8));
      jelly.setSize(window.innerWidth, window.innerHeight);
      jelly.resetCamera();
      window.__reef.jelly = jelly;
    }
    return jelly;
  }
  function renderJellyHud() {
    if (jelly) jLightBtn.textContent = 'クラゲの照明：' + LIGHTS[jelly.lightKey].label;
  }
  const jHint = document.getElementById('jhint');
  let jHintShown = false;
  function enterJelly() {
    sound.start();
    if (follow) setFollow(false);
    ensureJelly();
    mode = 'jelly';
    controls.enabled = false;
    jelly.controls.enabled = true;
    hudEl.classList.remove('show');
    menuEl.classList.remove('show');
    jHud.classList.add('show');
    renderJellyHud();
    hideHint();
    if (!jHintShown) { jHintShown = true; jHint.classList.add('show'); setTimeout(() => jHint.classList.remove('show'), 5000); }
  }
  // ---- main screen (choose a tank) ----
  const menuEl = document.getElementById('menu');
  document.getElementById('m-ver').textContent = 'Version ' + APP.version;
  function showMenu() {
    if (follow) setFollow(false);
    if (jelly) { jelly.controls.enabled = false; setViewing(false); }
    mode = 'menu';
    controls.enabled = false;
    hudEl.classList.remove('show');
    jHud.classList.remove('show');
    jHint.classList.remove('show');
    nyOpen = false; nyEl.classList.remove('show');
    updateMenu();
    menuEl.classList.add('show');
  }
  function enterReef() {
    sound.start();
    placeCamera();
    mode = 'reef';
    if (jelly) jelly.controls.enabled = false;
    controls.enabled = true;
    menuEl.classList.remove('show');
    jHud.classList.remove('show');
    hudEl.classList.add('show');
    updateHud();
    if (!hintShown) { hintShown = true; hint.classList.remove('hide'); hint.classList.add('show'); hintTimer = setTimeout(() => hideHint(), 8000); }
    checkDeaths(500);
    setTimeout(showNextDeath, 600);
  }
  let hintShown = false;
  function updateMenu() {
    const st = document.getElementById('m-reef-stat');
    const alive = aliveFishes(state);
    const names = alive.map((d) => d.name).join('・');
    const msg = worstMessage(state);
    const ni = nurseryInfo(state);
    let extra = '';
    if (ni.eggs) extra = '・卵あり';
    if (ni.fry) extra += `・稚魚${ni.fry}匹`;
    if (fishes.some((f) => f.dead)) { st.textContent = 'お知らせがあります'; st.classList.remove('ok'); }
    else if (msg) { st.textContent = msg; st.classList.remove('ok'); }
    else { st.textContent = `${names}${extra}・みんな元気です`; st.classList.add('ok'); }
    const js = document.getElementById('m-jelly-stat');
    js.textContent = '';
    js.classList.add('ok');
  }
  onTap(document.getElementById('m-reef'), enterReef);
  onTap(document.getElementById('m-jelly'), enterJelly);
  function exitJelly() { showMenu(); }
  function switchSpecies(step) {
    jelly.setSpecies(jelly.index + step);
    renderJellyHud();
    jHint.classList.remove('show');
  }
  let viewing = false;
  function setViewing(on) {
    viewing = on;
    if (!jelly) return;
    jelly.controls.autoRotate = on;
    jHud.classList.toggle('show', !on && mode === 'jelly');
  }
  function jellySwipe(e) {
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    const quick = performance.now() - down.t < 600;
    if (viewing && Math.hypot(dx, dy) < 10) { setViewing(false); return; }
    if (quick && Math.abs(dx) > 60 && Math.abs(dy) < 60) switchSpecies(dx < 0 ? 1 : -1);
  }
  onTap(document.getElementById('j-back'), exitJelly);
  onTap(jLightBtn, () => { ensureJelly().nextLight(); renderJellyHud(); });

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
    updateEggs();
    drainEvents();
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
    showMenu();
    checkDeaths(1200);
    if (fishes.some((f) => f.dead)) return;
    const a = formatAway(awaySec);
    if (a && awaySec > 600) setTimeout(() => showToast(a + '！' + (worstMessage(state) || 'みんな元気です'), 2800), 900);
    setTimeout(announceSex, a && awaySec > 600 ? 4000 : 900);
    setTimeout(drainEvents, a && awaySec > 600 ? 4500 : 1400);
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
    if (mode === 'menu') {
      for (const f of fishes) f.data.hunger = f.hunger;
      hudT += dt;
      if (hudT > 0.5) { hudT = 0; updateMenu(); drainEvents(); }
      return;   // nothing to draw behind the main screen
    }
    if (mode === 'jelly') {
      for (const f of fishes) f.data.hunger = f.hunger;
      jelly.update(dt);
      sound.updateListener(jelly.camera);
      hudT += dt;
      if (hudT > 0.5) { hudT = 0; updateHud(); drainEvents(); }
      renderer.render(jelly.scene, jelly.camera);
      return;
    }
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
      updateEggs();
      drainEvents();
      if (nyOpen) renderNursery();
    }
    if (composer) composer.render(); else renderer.render(scene, camera);
  }
  loop();
  window.__reef = { sound, eggs, scene, camera, fishes, get fish() { return fishes[0]; }, food, controls, renderer, world, state };
}

init().catch((err) => {
  console.error(err);
  setStatus('うまく起動できませんでした。ページを開き直してください。');
});
