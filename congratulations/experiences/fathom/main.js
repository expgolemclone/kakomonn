/* ============================================================
   FATHOM — interactions
   Progressive enhancement: the page reads fully without JS.
   Signatures: (1) a raw-WebGL caustics light shader painting
   rippling biolum light behind the hero, and (2) a scroll-driven
   depth-column navigator that dives the water column. No libs.
   ============================================================ */
(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const root = document.documentElement;

  /* ---------- theme toggle ---------- */
  const themeBtn = document.getElementById('themeBtn');
  const syncTheme = () => {
    const dark = root.dataset.theme !== 'light';
    themeBtn.setAttribute('aria-pressed', String(dark));
    themeBtn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#05141c' : '#eef2f0');
  };
  syncTheme();
  themeBtn?.addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem('fathom-theme', root.dataset.theme); } catch (e) {}
    syncTheme();
  });

  /* ---------- hero intro ---------- */
  const hero = document.querySelector('.hero');
  requestAnimationFrame(() => hero && hero.classList.add('loaded'));

  /* ---------- reveals ---------- */
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }
  }, { threshold: 0.14, rootMargin: '0px 0px -6% 0px' });
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));

  /* ---------- animated counters ---------- */
  const fmt = (v, suf) => Math.round(v).toLocaleString('en-US') + suf;
  const cio = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target, to = parseFloat(el.dataset.to), suf = el.dataset.suffix || '';
      cio.unobserve(el);
      if (reduce) { el.textContent = fmt(to, suf); continue; }
      const dur = 1500, t0 = performance.now();
      const tick = (t) => {
        const p = clamp((t - t0) / dur, 0, 1);
        el.textContent = fmt(to * (1 - Math.pow(1 - p, 3)), suf);
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }, { threshold: 0.6 });
  document.querySelectorAll('.c-num').forEach(el => cio.observe(el));

  /* ============================================================
     Depth-column navigator — the gauge tracks the water column
     ============================================================ */
  const depths = document.getElementById('depths');
  const zones = [...document.querySelectorAll('.zone')];
  const gauge = document.getElementById('gauge');
  const gDepth = document.getElementById('gDepth');
  const gPress = document.getElementById('gPress');
  const gTemp = document.getElementById('gTemp');
  const gLight = document.getElementById('gLight');
  const gNow = document.getElementById('gNow');
  const ZONE_NAME = { sunlight: 'First light', twilight: 'The current', midnight: 'Deep work', abyss: 'The finish' };

  if (depths && zones.length && gauge) {
    let ticking = false;
    const paint = () => {
      ticking = false;
      const mid = innerHeight * 0.5;
      const sr = depths.getBoundingClientRect();
      // overall descent for the rail marker
      const p = clamp((mid - sr.top) / sr.height, 0, 1);

      // which zone is the marker over? interpolate real depth within it
      let active = zones[0], depth = 0;
      if (mid < zones[0].getBoundingClientRect().top) {
        active = zones[0]; depth = +zones[0].dataset.top;
      } else {
        active = zones[zones.length - 1];
        depth = +active.dataset.bot;
        for (const z of zones) {
          const r = z.getBoundingClientRect();
          if (mid <= r.bottom) {
            active = z;
            const frac = clamp((mid - r.top) / r.height, 0, 1);
            depth = Math.round(+z.dataset.top + (+z.dataset.bot - +z.dataset.top) * frac);
            break;
          }
        }
      }

      const pressure = 1 + depth / 10;                 // atm
      const temp = Math.max(2, 19 - depth * 0.014);    // °C
      const light = 100 * Math.exp(-depth / 150);      // %

      gDepth.textContent = depth.toLocaleString('en-US') + ' m';
      gPress.textContent = pressure.toFixed(1) + ' atm';
      gTemp.textContent = temp.toFixed(temp < 10 ? 1 : 0) + ' °C';
      gLight.textContent = (light < 1 ? light.toFixed(1) : Math.round(light)) + ' %';
      gNow.textContent = ZONE_NAME[active.dataset.zone] || '';
      gauge.style.setProperty('--p', (p * 100).toFixed(1) + '%');

      for (const z of zones) z.classList.toggle('is-active', z === active);
    };
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(paint); } };
    paint();
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll);
  }

  /* ============================================================
     Ticket demo — tier select + live total. Sends nothing.
     ============================================================ */
  const tiers = [...document.querySelectorAll('.tier')];
  const form = document.getElementById('ticketForm');
  const qtyEl = document.getElementById('tQty');
  const tfLabel = document.getElementById('tfLabel');
  const tfTotal = document.getElementById('tfTotal');
  const tfBtnTotal = document.getElementById('tfBtnTotal');
  let sel = tiers.find(t => t.classList.contains('is-sel')) || tiers[0];

  const recompute = () => {
    if (!sel) return;
    const price = +sel.dataset.price;
    const qty = clamp(parseInt(qtyEl?.value, 10) || 1, 1, 12);
    const total = (price * qty).toLocaleString('en-US') + ' sec';
    if (tfLabel) tfLabel.textContent = sel.dataset.tier + (qty > 1 ? ` × ${qty}` : '');
    if (tfTotal) tfTotal.textContent = total;
    if (tfBtnTotal) tfBtnTotal.textContent = total;
  };
  tiers.forEach(t => t.addEventListener('click', () => {
    sel = t;
    tiers.forEach(o => { o.classList.toggle('is-sel', o === t); o.setAttribute('aria-pressed', String(o === t)); });
    recompute();
  }));
  qtyEl?.addEventListener('input', recompute);
  recompute();

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = form.querySelector('#tName'), email = form.querySelector('#tEmail'), date = form.querySelector('#tDate');
      for (const el of [name, email, date]) { if (!el.checkValidity()) { el.reportValidity(); return; } }
      const label = tfLabel ? tfLabel.textContent : 'Your pause';
      form.innerHTML =
        '<div class="ticket-done"><strong>Milestone marked — dueCardsCompleted is achieved.</strong>' +
        '<span class="mono">' + label + ' · return on ' + date.value +
        '. nothing was sent or stored. the finish remains entirely yours.</span></div>';
    });
  }

  /* ============================================================
     Caustics shader — raw WebGL, one fullscreen triangle.
     Layered domain-loop caustic -> rippling biolum light, cyan
     over abyss, dimming toward the deep. Pauses off-screen.
     ============================================================ */
  const canvas = document.getElementById('caustics');
  if (!canvas) return;
  const FALLBACK = 'radial-gradient(130% 100% at 70% 0%, #0d4a56, #061a24 60%, #05141c)';
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false });
  if (!gl) { canvas.style.background = FALLBACK; return; }

  const vs = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
  const fs = `
  precision highp float;
  uniform vec2 u_res; uniform float u_t; uniform float u_dark;
  #define TAU 6.28318530718
  void main(){
    vec2 uv = gl_FragCoord.xy / u_res.xy;
    float aspect = u_res.x / max(u_res.y, 1.0);
    vec2 p = vec2(uv.x * aspect, uv.y);
    vec2 q = mod(p * TAU * 2.15, TAU) - 250.0;
    vec2 i = q;
    float c = 1.0;
    float inten = 0.0045;
    float t = u_t * 0.5 + 20.0;
    for (int n = 0; n < 5; n++) {
      float tt = t * (1.0 - (3.5 / float(n + 1)));
      i = q + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
      c += 1.0 / length(vec2(q.x / (sin(i.x + tt) / inten), q.y / (cos(i.y + tt) / inten)));
    }
    c /= 5.0;
    c = 1.17 - pow(c, 1.4);
    float glow = pow(abs(c), 7.0);
    // depth fade — light concentrates near the surface (uv.y -> 1)
    float depth = smoothstep(-0.15, 1.08, uv.y);
    glow *= 0.22 + 0.78 * depth;
    vec3 deep  = vec3(0.010, 0.034, 0.050);
    vec3 abyss = vec3(0.015, 0.062, 0.086);
    vec3 lightc = vec3(0.30, 0.96, 0.88);          // biolum cyan
    vec3 col = mix(deep, abyss, depth) + lightc * glow;
    // light theme — foamy, brighter water
    col = mix(col, vec3(0.60, 0.78, 0.75) * (0.46 + glow * 1.25), u_dark < 0.5 ? 0.60 : 0.0);
    col = pow(clamp(col, 0.0, 1.0), vec3(0.92));
    gl_FragColor = vec4(col, 1.0);
  }`;

  const compile = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
    return s;
  };
  const vso = compile(gl.VERTEX_SHADER, vs), fso = compile(gl.FRAGMENT_SHADER, fs);
  if (!vso || !fso) { canvas.style.background = FALLBACK; return; }
  const prog = gl.createProgram();
  gl.attachShader(prog, vso); gl.attachShader(prog, fso); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.style.background = FALLBACK; return; }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, 'u_res');
  const uT = gl.getUniformLocation(prog, 'u_t');
  const uDark = gl.getUniformLocation(prog, 'u_dark');

  const dpr = () => Math.min(devicePixelRatio || 1, 1.5);
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.max(1, Math.floor(w * dpr()));
    canvas.height = Math.max(1, Math.floor(h * dpr()));
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  const draw = (secs) => {
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uT, secs);
    gl.uniform1f(uDark, root.dataset.theme === 'light' ? 0.0 : 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const ro = new ResizeObserver(() => { resize(); if (reduce) draw(8.0); });
  ro.observe(canvas);
  resize();

  if (reduce) {
    draw(8.0);                                       // one static, lit frame
  } else {
    let running = true;
    const io2 = new IntersectionObserver((es) => {
      running = es[0].isIntersecting;
      if (running) requestAnimationFrame(loop);
    }, { threshold: 0 });
    io2.observe(canvas);
    const t0 = performance.now();
    let last = 0;
    const loop = (t) => {
      if (!running) return;
      if (t - last >= 33) {                          // ~30fps — light drifts slowly
        draw((t - t0) / 1000);
        last = t;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
})();
