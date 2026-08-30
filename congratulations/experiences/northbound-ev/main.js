/* ============================================================
   NORTHBOUND — interactions + signature terrain
   Progressive enhancement: the page is fully readable without this file.
   The topographic terrain is three.js; if WebGL is missing or the visitor
   prefers reduced motion, the static SVG topo-map stays on screen instead.
   ============================================================ */
'use strict';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------- hero intro + scroll reveals ---------- */
const hero = $('.hero');
requestAnimationFrame(() => hero && hero.classList.add('loaded'));

const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
}, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' });
$$('.reveal').forEach(el => io.observe(el));

/* ---------- animated counters ---------- */
const fmtNum = (n, dec) => {
  const s = n.toFixed(dec);
  const [int, frac] = s.split('.');
  const withSep = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? withSep + '.' + frac : withSep;
};
const cio = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const el = e.target, to = parseFloat(el.dataset.to), dec = +(el.dataset.dec || 0);
    cio.unobserve(el);
    if (reduce) { el.textContent = fmtNum(to, dec); continue; }
    const dur = 1500, t0 = performance.now();
    const tick = (t) => {
      const p = clamp((t - t0) / dur, 0, 1), e2 = 1 - Math.pow(1 - p, 3);
      el.textContent = fmtNum(to * e2, dec);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}, { threshold: 0.5 });
$$('.s-num').forEach(c => cio.observe(c));

/* ---------- range ring ---------- */
const ringFill = $('#ringFill'), ringPct = $('#ringPct');
const RING_C = 2 * Math.PI * 74; // 464.9
let ringRevealed = false;
const setRing = (pct) => {
  if (!ringFill) return;
  ringFill.style.transition = reduce ? 'none' : 'stroke-dashoffset 1.25s var(--ease)';
  ringFill.style.strokeDashoffset = (RING_C * (1 - pct / 100)).toFixed(1);
  if (ringPct) ringPct.textContent = pct + '%';
};
if (ringFill) {
  const rio = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      rio.unobserve(e.target);
      ringRevealed = true;
      setRing(ROUTES[currentRoute].batt);
    }
  }, { threshold: 0.5 });
  rio.observe(ringFill);
}

/* ---------- trip-planner: route corridors ---------- */
const ICON = {
  car: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 16h16M6 16l1.5-5A2 2 0 0 1 9.4 9.6h5.2a2 2 0 0 1 1.9 1.4L18 16M7.5 19a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6Zm9 0a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6Z" stroke="currentColor" stroke-width="1.4"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="none"><path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor"/></svg>',
  coffee: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 9h12v4a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9Zm12 1h2a2 2 0 0 1 0 4h-2M6 3v2M9 3v2M12 3v2" stroke="currentColor" stroke-width="1.4"/></svg>',
  trail: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3 4 20h16L12 3Zm0 6-3 7m3-7 3 7" stroke="currentColor" stroke-width="1.4"/></svg>',
  walk: '<svg viewBox="0 0 24 24" fill="none"><path d="M13 4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM11 8l-2 4 2 2v6m2-8 3 2m-8-4 2-2" stroke="currentColor" stroke-width="1.4"/></svg>',
  view: '<svg viewBox="0 0 24 24" fill="none"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="12" r="2.4" stroke="currentColor" stroke-width="1.4"/></svg>',
};

const ROUTES = {
  coastal: {
    km: 'TRUE', stops: 'due queue clear', arrive: 'reached now', batt: 100,
    stats: [['dailyKpiCompleted', 'milestone'], ['achieved', 'status'], ['0', 'dueCardsRemaining'], ['100%', 'credit yours']],
    chip: ['TRUE', '1', '0', '100%'],
    from: 'Due queue opened', fromC: 'FOCUS · CALLED', to: 'dailyKpiCompleted', toC: 'STATUS · ACHIEVED',
    items: [
      { k: 'origin', place: 'Due queue opened', coord: 'FOCUS · CALLED', time: 'THEN' },
      { k: 'stop', drive: 'Met the next card · stayed present', place: 'First Light', coord: 'ATTENTION · ON', time: 'BEGAN',
        net: 'Your focus found the trail', grade: 'YES', adapter: false, dwell: 'PRESENT',
        meta: ['NOTICED', 'ENGAGED', { avail: 'NO SHORTCUTS' }, 'YOUR EFFORT'],
        tags: [{ i: 'coffee', t: 'Met the moment' }, { i: 'walk', t: 'Held the line' }] },
      { k: 'stop', drive: 'Kept the thread · through uncertainty', place: 'Steady Ground', coord: 'ATTENTION · HELD', time: 'FARTHER',
        net: 'Distraction did not choose the ending', grade: 'YES', adapter: false, dwell: 'STAYED',
        meta: ['RETURNED', 'CONTINUED', { avail: 'ROUTE OPEN' }, 'YOUR CHOICE'],
        tags: [{ i: 'coffee', t: 'Came back' }, { i: 'view', t: 'Saw it through' }] },
      { k: 'dest', drive: 'Carried focus to the far edge', place: 'dailyKpiCompleted', coord: 'STATUS · ACHIEVED', time: 'NOW' },
    ],
  },
  alpine: {
    km: 'TRUE', stops: 'due queue clear', arrive: 'reached now', batt: 100,
    stats: [['dailyKpiCompleted', 'milestone'], ['achieved', 'status'], ['0', 'dueCardsRemaining'], ['100%', 'credit yours']],
    chip: ['TRUE', '1', '0', '100%'],
    from: 'Due queue opened', fromC: 'WORK · IN MOTION', to: 'dailyKpiCompleted', toC: 'STATUS · ACHIEVED',
    items: [
      { k: 'origin', place: 'Due queue opened', coord: 'THE ROUTE · BEGAN', time: 'THEN' },
      { k: 'stop', drive: 'Kept moving · one card at a time', place: 'Attention Pass', coord: 'FOCUS · HELD', time: 'MIDWAY',
        net: 'Focus held through the climb', grade: 'YES', adapter: false, dwell: 'STAYED',
        meta: ['PRESENT', 'STEADY', { avail: 'NO SHORTCUTS' }, 'YOUR EFFORT'],
        tags: [{ i: 'coffee', t: 'Met the moment' }, { i: 'trail', t: 'Kept the line' }] },
      { k: 'stop', drive: 'Returned after uncertainty', place: 'Recall Ridge', coord: 'MEMORY · RETRIEVED', time: 'HIGH GROUND',
        net: 'Memory brought back into reach', grade: 'YES', adapter: true, dwell: 'RETURNED',
        meta: ['RECALLED', 'RETRIED', { avail: 'KEPT GOING' }, 'YOUR WORK'],
        tags: [{ i: 'coffee', t: 'Found the memory' }, { i: 'fast', t: 'Turn completed' }] },
      { k: 'dest', drive: 'Carried the route to its end', place: 'dailyKpiCompleted', coord: 'STATUS · ACHIEVED', time: 'NOW' },
    ],
  },
  desert: {
    km: 'TRUE', stops: 'due queue clear', arrive: 'reached now', batt: 100,
    stats: [['dailyKpiCompleted', 'milestone'], ['achieved', 'status'], ['0', 'dueCardsRemaining'], ['100%', 'credit yours']],
    chip: ['TRUE', '1', '0', '100%'],
    from: 'Due queue opened', fromC: 'RESOLVE · TESTED', to: 'dailyKpiCompleted', toC: 'STATUS · ACHIEVED',
    items: [
      { k: 'origin', place: 'Due queue opened', coord: 'RESOLVE · TESTED', time: 'THEN' },
      { k: 'stop', drive: 'Reached the hard card · did not turn back', place: 'Hard Turn', coord: 'PATIENCE · HELD', time: 'EARLY',
        net: 'Difficulty became part of the route', grade: 'YES', adapter: true, dwell: 'PAUSED',
        meta: ['NOT EASY', 'STILL HERE', { avail: 'PATH FOUND' }, 'YOUR PATIENCE'],
        tags: [{ i: 'coffee', t: 'Made room' }, { i: 'view', t: 'Stayed honest' }] },
      { k: 'stop', drive: 'Tried the path again', place: 'Return Point', coord: 'EFFORT · RENEWED', time: 'MIDWAY',
        net: 'A second pass opened the view', grade: 'YES', adapter: false, dwell: 'RETRIED',
        meta: ['ADJUSTED', 'RETRIEVED', { avail: 'MOVING AGAIN' }, 'YOUR COURAGE'],
        tags: [{ i: 'coffee', t: 'Came back' }, { i: 'trail', t: 'Found a way' }] },
      { k: 'stop', drive: 'Met the final stretch', place: 'Last Ridge', coord: 'RESOLVE · INTACT', time: 'NEARLY THERE',
        net: 'The unfinished edge disappeared', grade: 'YES', adapter: false, dwell: 'FINISHED',
        meta: ['NO RUSH', 'NO RETREAT', { avail: 'HORIZON CLEAR' }, 'YOUR RESOLVE'],
        tags: [{ i: 'view', t: 'Saw the end' }, { i: 'walk', t: 'Crossed it' }] },
      { k: 'dest', drive: 'Finished the full route', place: 'dailyKpiCompleted', coord: 'STATUS · ACHIEVED', time: 'NOW' },
    ],
  },
};

let currentRoute = 'alpine';

const nodeHTML = (it) => {
  if (it.k === 'origin')
    return `<div class="tl-node"><span class="tl-dot" aria-hidden="true"></span>
      <div class="tl-place"><b>${it.place}</b><span class="tl-coord mono">${it.coord}</span><span class="tl-time">${it.time}</span></div></div>`;
  const drive = `<div class="tl-drive">${ICON.car}${it.drive}</div>`;
  if (it.k === 'dest')
    return `<div class="tl-node">${drive}<span class="tl-dot end" aria-hidden="true"></span>
      <div class="tl-place"><b>${it.place}</b><span class="tl-coord mono">${it.coord}</span><span class="tl-time">${it.time}</span></div></div>`;
  const meta = it.meta.map(m => typeof m === 'string' ? `<span>${m}</span>` : `<span class="avail">${m.avail}</span>`).join('');
  const tags = it.tags.map(t => `<span class="tag ${t.i === 'fast' ? 'fast' : ''}">${ICON[t.i] || ICON.trail}${t.t}</span>`).join('');
  const badges = `<span class="stopcard-badge grade">${it.grade}</span>` + (it.adapter ? '<span class="stopcard-badge adapter">Turn met</span>' : '');
  return `<div class="tl-node">${drive}<span class="tl-dot charge" aria-hidden="true"></span>
    <div class="tl-place"><b>${it.place}</b><span class="tl-coord mono">${it.coord}</span><span class="tl-time">${it.time}</span></div>
    <div class="stopcard"><div class="stopcard-top"><span class="stopcard-net">${it.net}</span>${badges}
      <span class="stopcard-dwell mono">${ICON.bolt}${it.dwell}</span></div>
    <div class="stopcard-meta mono">${meta}</div>
    <div class="stopcard-tags">${tags}</div></div></div>`;
};

const renderRoute = (key) => {
  const r = ROUTES[key]; if (!r) return;
  currentRoute = key;
  const set = (id, v) => { const el = $('#' + id); if (el) el.textContent = v; };
  set('sumKm', r.km); set('sumStops', r.stops); set('sumArrive', r.arrive);
  set('odFrom', r.from); set('odFromCoord', r.fromC); set('odTo', r.to); set('odToCoord', r.toC);
  const stats = $('#sumStats');
  if (stats) stats.innerHTML = r.stats.map(([v, l]) => `<div class="ss"><b>${v}</b><span>${l}</span></div>`).join('');
  const tl = $('#timeline');
  if (tl) tl.innerHTML = r.items.map(nodeHTML).join('');
  // hero chip mirrors the featured summary
  const chipLead = $('.route-chip .rc-lead b'), chipSpan = $('.route-chip .rc-lead span');
  if (chipLead) chipLead.innerHTML = r.km.replace(' ', '&nbsp;');
  if (chipSpan) chipSpan.textContent = `· ${r.stops} · ${r.arrive.replace('arrive ', 'arrive ')}`;
  const chipStats = $$('.route-chip .rc-stat b');
  if (chipStats[0]) chipStats[0].textContent = r.chip[1];
  if (chipStats[1]) chipStats[1].textContent = r.chip[2];
  if (chipStats[2]) chipStats[2].textContent = r.chip[3];
  if (ringRevealed) setRing(r.batt); else if (ringPct) ringPct.textContent = r.batt + '%';
  const rrSoc = $('#rrSoc'); if (rrSoc) rrSoc.textContent = r.batt + '%';
  if (window.__nbTerrain) window.__nbTerrain.setStops(r.items.filter(i => i.k === 'stop').length);
};

$$('.route-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.route-tab').forEach(t => t.setAttribute('aria-selected', 'false'));
    tab.setAttribute('aria-selected', 'true');
    renderRoute(tab.dataset.route);
  });
});

/* ============================================================
   SIGNATURE — three.js topographic terrain + self-drawing route
   ============================================================ */
function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (_) { return false; }
}

async function initTerrain() {
  if (reduce || !webglOK()) return;            // SVG fallback stays visible
  const mount = $('#terrain');
  if (!mount) return;
  let THREE;
  try { THREE = await import('three'); }
  catch (_) { return; }                        // CDN blocked → keep SVG

  THREE.ColorManagement.enabled = false;       // author colors write straight to the framebuffer

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 900);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));   // DPR cap 2
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x000000, 0);
  mount.appendChild(renderer.domElement);

  /* ---- procedural heightfield ---- */
  const frac = (x) => x - Math.floor(x);
  const hash = (x, y) => frac(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
  const vnoise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };
  const fbm = (x, y) => {
    let f = 0, amp = 0.5, fr = 1;
    for (let i = 0; i < 5; i++) { f += amp * vnoise(x * fr, y * fr); fr *= 2; amp *= 0.5; }
    return f;
  };
  const AMP = 26, SIZE = 300, SEG = 200;
  const heightAt = (x, z) => {
    let h = fbm(x * 0.012 + 12, z * 0.012 + 5);
    // two long ridges so the route has something to weave between
    h += 0.42 * Math.exp(-(((x + 70) ** 2 + (z + 40) ** 2) / 5200));
    h += 0.5 * Math.exp(-(((x - 80) ** 2 + (z - 60) ** 2) / 6200));
    return Math.pow(clamp(h, 0, 1.4), 1.25) * AMP;
  };

  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const heights = new Float32Array(pos.count);
  let maxY = 0.0001;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y); heights[i] = y; if (y > maxY) maxY = y;
  }
  const norm = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) norm[i] = heights[i] / maxY;
  geo.setAttribute('aHeight', new THREE.BufferAttribute(norm, 1));
  geo.computeVertexNormals();

  const terrainMat = new THREE.ShaderMaterial({
    uniforms: {
      uLow: { value: new THREE.Color('#161d10') },
      uMid: { value: new THREE.Color('#43431f') },
      uHigh: { value: new THREE.Color('#c98a4b') },
      uContour: { value: new THREE.Color('#b7c29e') },
      uBg: { value: new THREE.Color('#12180f') },
      uFogNear: { value: 120 }, uFogFar: { value: 470 },
    },
    extensions: { derivatives: true },
    vertexShader: `
      attribute float aHeight; varying float vH; varying float vFog;
      uniform float uFogNear; uniform float uFogFar;
      void main(){
        vH = aHeight;
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        vFog = smoothstep(uFogNear, uFogFar, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      precision highp float; varying float vH; varying float vFog;
      uniform vec3 uLow, uMid, uHigh, uContour, uBg;
      void main(){
        vec3 base = mix(uLow, uMid, smoothstep(0.0,0.55,vH));
        base = mix(base, uHigh, smoothstep(0.62,1.0,vH));
        float bands = 15.0;
        float f = vH * bands;
        float w = fwidth(f);
        float line = abs(fract(f-0.5)-0.5) / max(w, 1e-4);
        float contour = 1.0 - clamp(line, 0.0, 1.0);
        vec3 col = mix(base, uContour, contour*0.8);
        col = mix(col, uBg, clamp(vFog,0.0,1.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const terrain = new THREE.Mesh(geo, terrainMat);
  scene.add(terrain);

  /* ---- the route: a curve that hugs the surface ---- */
  const routeXZ = [
    [-134, -120], [-96, -78], [-64, -34], [-30, 2], [4, 18],
    [40, -2], [72, -44], [104, -84], [138, -128],
  ];
  const routePts = routeXZ.map(([x, z]) => new THREE.Vector3(x, heightAt(x, z) + 2.4, z));
  const curve = new THREE.CatmullRomCurve3(routePts, false, 'catmullrom', 0.4);

  const tubeGeo = new THREE.TubeGeometry(curve, 320, 0.62, 10, false);
  const tube = new THREE.Mesh(tubeGeo, new THREE.MeshBasicMaterial({ color: 0x6cff6a }));
  scene.add(tube);
  const glowGeo = new THREE.TubeGeometry(curve, 320, 1.9, 10, false);
  const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
    color: 0x6cff6a, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  scene.add(glow);
  const tubeCount = tubeGeo.index.count, glowCount = glowGeo.index.count;
  tubeGeo.setDrawRange(0, 0); glowGeo.setDrawRange(0, 0);

  /* ---- pulsing charging-node markers ---- */
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(108,255,106,1)');
    grd.addColorStop(0.4, 'rgba(108,255,106,.5)');
    grd.addColorStop(1, 'rgba(108,255,106,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const NODE_U = [0.3, 0.5, 0.7];
  const nodes = NODE_U.map((u) => {
    const p = curve.getPointAt(u);
    const grp = new THREE.Group(); grp.position.copy(p);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 16), new THREE.MeshBasicMaterial({ color: 0xdfffdd }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.set(9, 9, 1);
    grp.add(core); grp.add(halo);
    grp.visible = false; grp.userData = { u, halo, core };
    scene.add(grp);
    return grp;
  });
  let activeStops = 2;

  /* ---- camera choreography ---- */
  const eye = new THREE.Vector3(-24, 84, 168);
  const look = new THREE.Vector3(0, AMP * 0.28, -6);
  camera.position.copy(eye);
  camera.lookAt(look);
  let scrollP = 0, targetP = 0;
  const onScroll = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    targetP = max > 0 ? clamp(scrollY / max, 0, 1) : 0;
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---- resize ---- */
  let rw = innerWidth, rh = innerHeight;
  const onResize = () => {
    rw = innerWidth; rh = innerHeight;
    camera.aspect = rw / rh; camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(rw, rh);
  };
  addEventListener('resize', onResize);

  /* ---- loop ---- */
  let draw = 0;                 // route reveal 0..1
  const start = performance.now();
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  let raf = 0, running = true;

  const frame = (now) => {
    if (!running) return;
    // self-drawing route intro (~2.6s)
    const dp = clamp((now - start - 500) / 2600, 0, 1);
    draw = easeOut(dp);
    tubeGeo.setDrawRange(0, Math.floor(tubeCount * draw));
    glowGeo.setDrawRange(0, Math.floor(glowCount * draw));

    // reveal + pulse nodes as the line passes, only up to the active stop count
    const t = now * 0.001;
    nodes.forEach((n, idx) => {
      const on = idx < activeStops && draw >= n.userData.u - 0.02;
      n.visible = on;
      if (on) {
        const pulse = 0.85 + Math.sin(t * 2.4 + idx) * 0.35;
        n.userData.halo.material.opacity = 0.5 + pulse * 0.4;
        n.userData.halo.scale.setScalar(8 + pulse * 2.4);
        n.userData.core.scale.setScalar(0.8 + pulse * 0.25);
      }
    });

    // camera advance along the corridor on scroll, with a slow idle drift
    scrollP += (targetP - scrollP) * 0.06;
    const p = scrollP;
    const idle = reduce ? 0 : Math.sin(t * 0.25) * 6;
    eye.set(-24 + p * 74 + idle, 84 - p * 40, 168 - p * 118);
    look.set(p * 46, AMP * (0.28 - p * 0.06), -6 - p * 44);
    camera.position.lerp(eye, 0.08);
    camera.lookAt(look);

    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  mount.classList.add('gl-live');

  /* ---- pause when hidden ---- */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { running = false; cancelAnimationFrame(raf); }
    else if (!running) { running = true; raf = requestAnimationFrame(frame); }
  });

  /* ---- expose + dispose ---- */
  window.__nbTerrain = { setStops: (n) => { activeStops = clamp(n, 1, NODE_U.length); } };
  addEventListener('pagehide', () => {
    running = false; cancelAnimationFrame(raf);
    geo.dispose(); terrainMat.dispose(); tubeGeo.dispose(); glowGeo.dispose();
    tube.material.dispose(); glow.material.dispose(); glowTex.dispose();
    nodes.forEach(n => { n.userData.core.geometry.dispose(); n.userData.core.material.dispose(); n.userData.halo.material.dispose(); });
    renderer.dispose();
  }, { once: true });
}

initTerrain();
