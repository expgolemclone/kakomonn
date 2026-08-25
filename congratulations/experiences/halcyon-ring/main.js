/* ============================================================
   HALCYON RING — interactions
   Progressive enhancement: the page is fully readable without
   this file. Motion is timed to breath — nothing snaps.
   ============================================================ */
(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const easeInOutSine = (p) => -(Math.cos(Math.PI * p) - 1) / 2;
  const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);

  /* ---------- 1 · the flowing dusk gradient ---------- */
  // Drawn tiny (≈14% of the viewport) and stretched by CSS — the upscale
  // is what makes the fields look like slow atmospheric light, for free.
  const dusk = document.getElementById('dusk');
  const dctx = dusk && dusk.getContext('2d');
  const FIELDS = [
    { c: '109,106,224', a: 0.44, r: 0.95, cx: 0.24, cy: 0.34, dx: 0.16, dy: 0.11, sx: 0.000037, sy: 0.000029, p: 0.0 },
    { c: '229,169,176', a: 0.28, r: 0.80, cx: 0.76, cy: 0.60, dx: 0.14, dy: 0.13, sx: 0.000031, sy: 0.000041, p: 2.1 },
    { c: '232,198,138', a: 0.17, r: 0.55, cx: 0.62, cy: 0.18, dx: 0.12, dy: 0.08, sx: 0.000043, sy: 0.000027, p: 4.2 },
    { c: '84,58,152',   a: 0.42, r: 1.05, cx: 0.40, cy: 0.90, dx: 0.10, dy: 0.10, sx: 0.000023, sy: 0.000033, p: 1.3 },
  ];
  let DW = 0, DH = 0;
  const sizeDusk = () => {
    if (!dusk) return;
    DW = dusk.width = Math.max(2, Math.round(innerWidth * 0.14));
    DH = dusk.height = Math.max(2, Math.round(innerHeight * 0.14));
  };
  const drawDusk = (t) => {
    if (!dctx) return;
    dctx.globalCompositeOperation = 'source-over';
    dctx.fillStyle = '#141026';
    dctx.fillRect(0, 0, DW, DH);
    dctx.globalCompositeOperation = 'lighter';
    for (const f of FIELDS) {
      const x = (f.cx + f.dx * Math.sin(t * f.sx + f.p)) * DW;
      const y = (f.cy + f.dy * Math.cos(t * f.sy + f.p * 1.7)) * DH;
      const r = f.r * Math.max(DW, DH);
      const g = dctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${f.c},${f.a})`);
      g.addColorStop(1, `rgba(${f.c},0)`);
      dctx.fillStyle = g;
      dctx.fillRect(0, 0, DW, DH);
    }
  };

  /* ---------- faint stars, drawn once ---------- */
  const stars = document.getElementById('stars');
  const drawStars = () => {
    if (!stars) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = stars.width = Math.round(innerWidth * dpr);
    const h = stars.height = Math.round(innerHeight * dpr);
    const sctx = stars.getContext('2d');
    sctx.clearRect(0, 0, w, h);
    const n = Math.round((innerWidth * innerHeight) / 14000);
    for (let i = 0; i < n; i++) {
      const x = Math.random() * w;
      const y = Math.pow(Math.random(), 1.6) * h; // denser near the top
      const rr = (Math.random() * 0.9 + 0.35) * dpr;
      sctx.globalAlpha = Math.random() * 0.5 + 0.15;
      sctx.fillStyle = Math.random() < 0.12 ? '#e8c68a' : '#efe9f4';
      sctx.beginPath();
      sctx.arc(x, y, rr, 0, Math.PI * 2);
      sctx.fill();
    }
    sctx.globalAlpha = 1;
  };

  /* ---------- 2 · the breathing ring (4 · 7 · 8) ---------- */
  const PHASES = [
    { name: 'breathe in', dur: 4 },
    { name: 'hold', dur: 7 },
    { name: 'breathe out', dur: 8 },
  ];
  const CYCLE = 19; // seconds
  const AMP = 0.14; // scale amplitude
  const breathScale = document.getElementById('breathScale');
  const breathHalo = document.getElementById('breathHalo');
  const breathPhase = document.getElementById('breathPhase');
  const breathCount = document.getElementById('breathCount');
  const breathToggle = document.getElementById('breathToggle');
  let breathing = !reduce;
  let breathStart = performance.now();
  let pausedAt = 0;
  let lastPhase = -1, lastCount = -1;

  const breathFrame = (now) => {
    const t = ((now - breathStart) / 1000) % CYCLE;
    let phase, local, scale;
    if (t < 4) { phase = 0; local = t / 4; scale = 1 + AMP * easeInOutSine(local); }
    else if (t < 11) { phase = 1; local = (t - 4) / 7; scale = 1 + AMP + 0.006 * Math.sin(local * Math.PI * 2); }
    else { phase = 2; local = (t - 11) / 8; scale = 1 + AMP * (1 - easeInOutSine(local)); }
    if (breathScale) breathScale.style.transform = `scale(${scale.toFixed(4)})`;
    if (breathHalo) {
      breathHalo.style.transform = `scale(${(scale * 1.04).toFixed(4)})`;
      breathHalo.style.opacity = (0.55 + (scale - 1) / AMP * 0.45).toFixed(3);
    }
    if (phase !== lastPhase) {
      lastPhase = phase;
      if (breathPhase) {
        breathPhase.classList.add('fading');
        setTimeout(() => {
          breathPhase.textContent = PHASES[phase].name;
          breathPhase.classList.remove('fading');
        }, 180);
      }
    }
    const remaining = Math.max(1, Math.ceil(PHASES[phase].dur - local * PHASES[phase].dur));
    if (remaining !== lastCount && breathCount) { lastCount = remaining; breathCount.textContent = String(remaining); }
  };

  if (breathToggle && !reduce) {
    breathToggle.hidden = false;
    breathToggle.addEventListener('click', () => {
      breathing = !breathing;
      breathToggle.setAttribute('aria-pressed', String(!breathing));
      breathToggle.textContent = breathing ? 'Pause the breath' : 'Resume the breath';
      if (breathing) breathStart = performance.now() - pausedAt;
      else pausedAt = performance.now() - breathStart;
    });
  }
  if (reduce && breathPhase && breathCount) {
    breathPhase.textContent = 'breathe with it';
    breathCount.textContent = '4 · 7 · 8';
  }

  /* ---------- shared render loop ---------- */
  sizeDusk();
  drawStars();
  addEventListener('resize', () => { sizeDusk(); drawStars(); if (reduce) drawDusk(0); }, { passive: true });
  if (reduce) {
    drawDusk(0);
  } else {
    let lastDusk = 0;
    const loop = (now) => {
      if (now - lastDusk > 66) { drawDusk(now); lastDusk = now; } // ~15fps is plenty for weather
      if (breathing) breathFrame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /* ---------- hero intro + scroll reveals ---------- */
  const hero = document.querySelector('.hero');
  requestAnimationFrame(() => hero && hero.classList.add('loaded'));
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

  /* ---------- score dial ---------- */
  const dialValue = document.getElementById('dialValue');
  const dialNum = document.getElementById('dialNum');
  if (dialValue && dialNum) {
    const score = +dialNum.dataset.score || 87;
    const TRACK = 424.1; // 270° of a r=90 circle
    const full = TRACK * (score / 100);
    const dio = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        dio.unobserve(e.target);
        if (reduce) {
          dialValue.setAttribute('stroke-dasharray', `${full} 565.5`);
          dialNum.textContent = String(score);
          continue;
        }
        const t0 = performance.now(), dur = 2100;
        const tick = (t) => {
          const p = clamp((t - t0) / dur, 0, 1);
          const ee = easeInOutSine(easeOutCubic(p));
          dialValue.setAttribute('stroke-dasharray', `${(full * ee).toFixed(1)} 565.5`);
          dialNum.textContent = String(Math.round(score * ee));
          if (p < 1) requestAnimationFrame(tick);
        };
        dialValue.setAttribute('stroke-dasharray', '0 565.5');
        dialNum.textContent = '0';
        requestAnimationFrame(tick);
      }
    }, { threshold: 0.5 });
    dio.observe(dialValue.closest('.dial'));
  }

  /* ---------- contributors + hypnogram (staggered on view) ---------- */
  for (const id of ['contrib', 'hypno']) {
    const el = document.getElementById(id);
    if (!el) continue;
    const o = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); o.unobserve(e.target); }
    }, { threshold: 0.3 });
    o.observe(el);
  }

  /* ---------- animated counters ---------- */
  const counters = document.querySelectorAll('.s-num');
  const cio = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target, to = parseFloat(el.dataset.to), dec = +(el.dataset.dec || 0);
      cio.unobserve(el);
      if (reduce) { el.textContent = to.toFixed(dec); continue; }
      const dur = 1900, t0 = performance.now();
      const tick = (t) => {
        const p = clamp((t - t0) / dur, 0, 1);
        el.textContent = (to * easeOutCubic(p)).toFixed(dec);
        if (p < 1) requestAnimationFrame(tick);
      };
      el.textContent = (0).toFixed(dec);
      requestAnimationFrame(tick);
    }
  }, { threshold: 0.5 });
  counters.forEach((c) => cio.observe(c));
})();
