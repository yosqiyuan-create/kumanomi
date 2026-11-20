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

export const APP = { name: 'サンゴ礁アクアリウム', version: '0.3.0' };

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
  const fish = new Clownfish(scene, { pos: reef.anemonePos.clone().add(new THREE.Vector3(0.6, 0.4, 0.3)) });
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
    if (ray.ray.intersectPlane(plane, hit)) feed(THREE.MathUtils.clamp(hit.x, -4.2, 4.2), (Math.random() - 0.5) * 1.2);
  });
  function feed(x, z) {
    food.drop(x, z, 10);
    hideHint();
  }
  document.getElementById('btn-feed').addEventListener('click', () => {
    feed(world.anemonePos.x + (Math.random() - 0.5) * 1.2, world.anemonePos.z + (Math.random() - 0.5) * 0.6);
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
  document.getElementById('btn-camera').addEventListener('click', () => placeCamera());

  // ---- hint ----
  const hint = document.getElementById('hint');
  let hintTimer = setTimeout(() => hideHint(), 9000);
  function hideHint() { hint.classList.add('hide'); clearTimeout(hintTimer); }

  // ---- status ----
  const bar = document.getElementById('hunger-bar');

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
  }, wait);

  // ---- loop ----
  const clock = new THREE.Clock();
  let running = true;
  document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) clock.getDelta(); });
  function loop() {
    requestAnimationFrame(loop);
    if (!running) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    shared.uTime.value += dt;
    const t = shared.uTime.value;
    food.update(dt, t);
    fish.update(dt, world);
    rays.userData.update(camera);
    controls.update();
    bar.style.width = Math.round(fish.hunger * 100) + '%';
    if (composer) composer.render(); else renderer.render(scene, camera);
  }
  loop();
  window.__reef = { scene, camera, fish, food, controls, renderer, world };
}

init().catch((err) => {
  console.error(err);
  setStatus('うまく起動できませんでした。ページを開き直してください。');
});
