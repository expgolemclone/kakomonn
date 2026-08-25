/* NEON SPRAWL — infinite retrowave terrain grid (three.js) + motion */
import * as THREE from 'three';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.getElementById('grid');

function initGrid() {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); }
  catch (e) { return; }
  if (!renderer.getContext()) return;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xff2e97, 0.019);
  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 320);
  camera.position.set(0, 2.4, 6);
  camera.lookAt(0, 0.6, -40);

  const L = 80, W = 74, SEGX = 74, SEGZ = 80;
  const k1 = 2 * Math.PI / L * 3, k2 = 2 * Math.PI / L * 5;
  function heightFn(x, z) {
    const ax = Math.abs(x);
    const edge = Math.min(1, Math.max(0, (ax - 8) / 24));   // flat valley until |x|>8
    const ridge = Math.pow(edge, 1.6) * (9 + 3 * Math.sin(x * 0.6));
    const roll = Math.sin(z * k1) * 0.8 + Math.sin(z * k2 + 1.0) * 0.5; // tiles over L
    return ridge + roll * (0.5 + edge * 1.6);
  }
  function makePlane() {
    const g = new THREE.PlaneGeometry(W, L, SEGX, SEGZ);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, heightFn(p.getX(i), p.getZ(i)));
    const m = new THREE.MeshBasicMaterial({ color: 0x2de2e6, wireframe: true, transparent: true, opacity: 0.92 });
    return new THREE.Mesh(g, m);
  }
  const a = makePlane(), b = makePlane();
  a.position.z = 0; b.position.z = -L;
  scene.add(a, b);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  const clock = new THREE.Clock();
  const SPEED = 15;
  function tick() {
    const dt = Math.min(clock.getDelta(), 0.05);
    for (const p of [a, b]) { p.position.z += SPEED * dt; if (p.position.z > L) p.position.z -= 2 * L; }
    renderer.render(scene, camera);
    if (!reduce) requestAnimationFrame(tick);
  }
  renderer.render(scene, camera);
  if (!reduce) requestAnimationFrame(tick);
}
try { initGrid(); } catch (e) { /* CSS sky remains as fallback */ }

/* ---- motion layer ---- */
const hero = document.querySelector('.hero');
requestAnimationFrame(() => requestAnimationFrame(() => hero.classList.add('loaded')));
setTimeout(() => hero.classList.add('loaded'), 400);

function countUp(el) {
  const to = +el.dataset.to, dur = 1700, start = performance.now();
  (function step(now) {
    const p = Math.min(1, (now - start) / dur);
    el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(step);
  })(performance.now());
}

const revealAll = () => {
  document.querySelectorAll('.reveal').forEach(e => e.classList.add('is-in'));
  document.querySelectorAll('.s-num').forEach(e => e.textContent = e.dataset.to);
};
window.addEventListener('load', () => {
  if (!window.gsap) { revealAll(); return; }
  gsap.registerPlugin(ScrollTrigger);
  gsap.utils.toArray('.reveal:not(.hero .reveal)').forEach(el =>
    ScrollTrigger.create({ trigger: el, start: 'top 88%', onEnter: () => el.classList.add('is-in') }));
  if (!reduce) {
    document.querySelectorAll('.s-num').forEach(el =>
      ScrollTrigger.create({ trigger: el, start: 'top 90%', once: true, onEnter: () => countUp(el) }));
  } else {
    document.querySelectorAll('.s-num').forEach(e => e.textContent = e.dataset.to);
  }
});
setTimeout(() => { if (!window.gsap) revealAll(); }, 2500);
