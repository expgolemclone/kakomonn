/* ============================================================
  STILLWATER — interactions
   Progressive enhancement: the page reads fine without this file.
   Signature systems: (1) layered wave-fields on canvas,
   (2) scroll-depth descent (HUD + veil), (3) tide chart + counters.
   ============================================================ */
(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const TAU = Math.PI * 2;
  const hasGSAP = () => typeof window.gsap !== 'undefined' && typeof window.ScrollTrigger !== 'undefined';

  /* ---------- hero intro + reveals ---------- */
  const hero = document.querySelector('.hero');
  requestAnimationFrame(() => hero && hero.classList.add('loaded'));
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));

  /* ============================================================
     1 · THE STILLWATER — layered wave-fields
     Each canvas draws 3–4 sine bands (two summed sines per band)
     flowing at different speeds/phases. One shared rAF loop; only
     canvases in the viewport are drawn. Reduced motion → one frame.
     ============================================================ */
  const HERO_LAYERS = [
    { y: .28, amp: 16, l1: 560, l2: 350, s1: .46, s2: .30, fill: 'rgba(43,180,166,.10)' },
    { y: .44, amp: 21, l1: 440, l2: 270, s1: .38, s2: .52, fill: 'rgba(43,180,166,.14)', stroke: 'rgba(191,233,223,.28)' },
    { y: .62, amp: 24, l1: 360, l2: 220, s1: .58, s2: .40, fill: 'rgba(16,64,88,.55)', stroke: 'rgba(191,233,223,.16)' },
    { y: .80, amp: 17, l1: 300, l2: 180, s1: .72, s2: .5, fill: 'rgba(6,26,43,.85)' },
  ];
  const DIV_LAYERS = [
    { y: .34, amp: 10, l1: 500, l2: 310, s1: .40, s2: .28, fill: 'rgba(43,180,166,.08)' },
    { y: .52, amp: 12, l1: 380, l2: 240, s1: .50, s2: .42, fill: 'rgba(43,180,166,.12)', stroke: 'rgba(191,233,223,.22)' },
    { y: .70, amp: 10, l1: 300, l2: 190, s1: .62, s2: .5, fill: 'rgba(191,233,223,.05)', stroke: 'rgba(191,233,223,.12)' },
  ];

  class WaveField {
    constructor(canvas) {
      this.c = canvas;
      this.ctx = canvas.getContext('2d');
      this.layers = canvas.dataset.waves === 'hero' ? HERO_LAYERS : DIV_LAYERS;
      this.seed = (+canvas.dataset.seed || 0) * 2.39;
      this.visible = false;
      this.resize();
    }
    resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const r = this.c.getBoundingClientRect();
      this.dpr = dpr;
      this.w = this.c.width = Math.max(1, Math.round(r.width * dpr));
      this.h = this.c.height = Math.max(1, Math.round(r.height * dpr));
    }
    draw(t) {
      const { ctx, w, h, dpr } = this;
      ctx.clearRect(0, 0, w, h);
      this.layers.forEach((L, i) => {
        const mid = h * L.y;
        const A = L.amp * dpr;
        const step = 8 * dpr;
        const open = new Path2D();
        for (let x = 0; x <= w + step; x += step) {
          const u = x / dpr;
          const y = mid
            + A * .62 * Math.sin(u / L.l1 * TAU + t * L.s1 + this.seed + i * 1.7)
            + A * .38 * Math.sin(u / L.l2 * TAU - t * L.s2 + this.seed * 1.7 + i * 2.3);
          if (x === 0) open.moveTo(x, y); else open.lineTo(x, y);
        }
        const closed = new Path2D(open);
        closed.lineTo(w + step, h); closed.lineTo(0, h); closed.closePath();
        ctx.fillStyle = L.fill;
        ctx.fill(closed);
        if (L.stroke) {
          ctx.strokeStyle = L.stroke;
          ctx.lineWidth = 1.2 * dpr;
          ctx.stroke(open);
        }
      });
    }
  }

  const fields = [...document.querySelectorAll('canvas.wavefield')].map(c => new WaveField(c));
  if (fields.length) {
    const wio = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const f = fields.find(f => f.c === e.target);
        if (f) f.visible = e.isIntersecting;
      }
    }, { rootMargin: '80px 0px' });
    fields.forEach(f => wio.observe(f.c));

    const drawStatic = () => fields.forEach(f => f.draw(7.3));
    if (reduce) {
      drawStatic();
    } else {
      const loop = (now) => {
        const t = now / 1000;
        for (const f of fields) if (f.visible) f.draw(t);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
    let rT;
    addEventListener('resize', () => {
      clearTimeout(rT);
      rT = setTimeout(() => { fields.forEach(f => f.resize()); if (reduce) drawStatic(); }, 150);
    }, { passive: true });
  }

  /* ============================================================
     2 · THE DESCENT — depth HUD + veil + hero-wave parallax
     The page background gradient does the color work in pure CSS;
     JS adds the instrument (metres + zone) and GSAP adds the veil.
     ============================================================ */
  const hudDepth = document.getElementById('hudDepth');
  const hudZone = document.getElementById('hudZone');
  const veil = document.querySelector('.depth-veil');
  const depthNow = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    return max > 0 ? clamp(scrollY / max, 0, 1) : 0;
  };
  const setHud = () => {
    if (!hudDepth) return;
    const p = depthNow();
    const d = Math.round(p * 1000);
    hudDepth.textContent = String(d).padStart(4, '0');
    hudZone.textContent = d < 180 ? 'sunlight zone' : d < 860 ? 'twilight zone' : 'midnight zone';
  };
  let hudTick = false;
  addEventListener('scroll', () => {
    if (hudTick) return;
    hudTick = true;
    requestAnimationFrame(() => { setHud(); hudTick = false; });
  }, { passive: true });
  setHud();

  addEventListener('load', () => {
    if (!hasGSAP() || reduce) {
      // fallback: veil follows scroll without GSAP
      if (veil) addEventListener('scroll', () => { veil.style.opacity = (depthNow() * .45).toFixed(3); }, { passive: true });
      return;
    }
    window.gsap.registerPlugin(window.ScrollTrigger);
    if (veil) {
      window.gsap.to(veil, {
        opacity: .45, ease: 'none',
        scrollTrigger: { trigger: document.body, start: 'top top', end: 'bottom bottom', scrub: true }
      });
    }
    const heroWaves = document.querySelector('.hero-waves');
    if (heroWaves) {
      window.gsap.to(heroWaves, {
        yPercent: 22, ease: 'none',
        scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true }
      });
    }
  });

  /* ============================================================
     3 · DATA — animated counters + the tide chart
     ============================================================ */
  const counters = document.querySelectorAll('.s-num');
  const fmtNum = (v, dec, sep) => {
    if (sep) return Math.round(v).toLocaleString('en-US');
    return v.toFixed(dec);
  };
  const cio = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target;
      const to = parseFloat(el.dataset.to), dec = +(el.dataset.dec || 0), sep = !!el.dataset.sep;
      cio.unobserve(el);
      if (reduce) { el.textContent = fmtNum(to, dec, sep); continue; }
      const dur = 1400, t0 = performance.now();
      const tick = (t) => {
        const p = clamp((t - t0) / dur, 0, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = fmtNum(to * eased, dec, sep);
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }, { threshold: 0.5 });
  counters.forEach(c => cio.observe(c));

  /* Tide chart — bars rise like a tide coming in. */
  const chart = document.getElementById('tideChart');
  if (chart) {
    const DATA = [['OPEN', 10], ['MEET', 22], ['WORK', 37], ['RECALL', 55], ['CHECK', 72], ['CLEAR', 88], ['DONE', 100]];
    const YMAX = 100, GRID = [0, 25, 50, 75, 100];
    const ctx = chart.getContext('2d');
    let cw = 0, ch = 0, dpr = 1, played = false;

    const size = () => {
      dpr = Math.min(devicePixelRatio || 1, 2);
      const r = chart.getBoundingClientRect();
      cw = chart.width = Math.max(1, Math.round(r.width * dpr));
      ch = chart.height = Math.max(1, Math.round(r.height * dpr));
    };

    const draw = (progress) => {
      // progress: array of 0..1 per bar
      ctx.clearRect(0, 0, cw, ch);
      const mono = `${11 * dpr}px "IBM Plex Mono", monospace`;
      const mL = 44 * dpr, mR = 8 * dpr, mT = 26 * dpr, mB = 30 * dpr;
      const pw = cw - mL - mR, ph = ch - mT - mB;
      // gridlines + y labels
      ctx.font = mono;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (const g of GRID) {
        const y = mT + ph - (g / YMAX) * ph;
        ctx.strokeStyle = 'rgba(234,244,247,.07)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(mL, y); ctx.lineTo(cw - mR, y); ctx.stroke();
        ctx.fillStyle = 'rgba(92,125,142,.9)';
        ctx.fillText(String(g), mL - 8 * dpr, y);
      }
      const slot = pw / DATA.length;
      const bw = slot * .56;
      DATA.forEach(([year, val], i) => {
        const p = progress[i];
        const hVal = (val / YMAX) * ph * p;
        const x = mL + slot * i + (slot - bw) / 2;
        const y = mT + ph - hVal;
        // liquid fill
        const grad = ctx.createLinearGradient(0, y, 0, mT + ph);
        grad.addColorStop(0, 'rgba(43,180,166,.85)');
        grad.addColorStop(1, 'rgba(43,180,166,.16)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        const rr = Math.min(5 * dpr, bw / 2, Math.max(0.01, hVal));
        ctx.roundRect(x, y, bw, Math.max(0.01, hVal), [rr, rr, 0, 0]);
        ctx.fill();
        // foam cap
        if (hVal > 2) {
          ctx.strokeStyle = 'rgba(191,233,223,.9)';
          ctx.lineWidth = 2 * dpr;
          ctx.beginPath(); ctx.moveTo(x + 1, y + dpr); ctx.lineTo(x + bw - 1, y + dpr); ctx.stroke();
        }
        // value label
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        if (p > .92) {
          ctx.fillStyle = `rgba(191,233,223,${((p - .92) / .08).toFixed(2)})`;
          ctx.fillText(String(val), x + bw / 2, y - 8 * dpr);
        }
        // year label
        ctx.fillStyle = 'rgba(157,188,203,.85)';
        ctx.fillText(String(year), x + bw / 2, mT + ph + 20 * dpr);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
      });
    };

    const play = () => {
      if (played) return;
      played = true;
      if (reduce) { draw(DATA.map(() => 1)); return; }
      const t0 = performance.now(), stag = 110, dur = 750;
      const tick = (t) => {
        const prog = DATA.map((_, i) => {
          const p = clamp((t - t0 - i * stag) / dur, 0, 1);
          return 1 - Math.pow(1 - p, 3);
        });
        draw(prog);
        if (prog[DATA.length - 1] < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    size();
    draw(DATA.map(() => 0));
    const chio = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { play(); chio.unobserve(chart); }
    }, { threshold: 0.35 });
    chio.observe(chart);
    let cT;
    addEventListener('resize', () => {
      clearTimeout(cT);
      cT = setTimeout(() => { size(); draw(DATA.map(() => played ? 1 : 0)); }, 150);
    }, { passive: true });
  }

  /* ============================================================
     4 · CLAIMS — acknowledge the win (accessible toggle)
     ============================================================ */
  document.querySelectorAll('.ev-join').forEach(btn => {
    const card = btn.closest('.event');
    const count = card && card.querySelector('.ev-count');
    const base = count ? +count.textContent : 0;
    btn.addEventListener('click', () => {
      const held = btn.getAttribute('aria-pressed') === 'true';
      btn.setAttribute('aria-pressed', String(!held));
      btn.firstChild.textContent = held ? 'Claim' : 'Claimed ✓';
      if (count) count.textContent = String(held ? base : base - 1);
    });
  });

  /* ============================================================
     5 · PAUSE — presets + timing + live reflection
     ============================================================ */
  const form = document.getElementById('donateForm');
  if (form) {
    const impactLine = document.getElementById('impactLine');
    const donateBtn = document.getElementById('donateBtn');
    const status = document.getElementById('formStatus');
    const customAmt = document.getElementById('customAmt');
    const customRadio = document.getElementById('amtCustomRadio');
    const PRESET = {
      10: {
        once: 'Take 10 seconds. Drop your shoulders, soften your gaze, and notice: nothing due remains.',
        monthly: 'Next session, begin with 10 seconds to remember: you have reached done before.',
      },
      25: {
        once: 'Take 25 seconds. Watch the current move, breathe slowly, and let "finished" become real.',
        monthly: 'Next session, keep 25 seconds at the door for this memory: you know how to finish.',
      },
      50: {
        once: 'Take 50 seconds. Let the page move without you. The queue is clear; there is nowhere to rush.',
        monthly: 'Next session, take 50 seconds before the first card and bring this calm back with you.',
      },
      100: {
        once: 'Take 100 seconds. Stand, stretch, find water, and give this completed session a real ending.',
        monthly: 'Next session, reserve 100 seconds to arrive slowly and remember the finish already behind you.',
      },
    };

    const currentAmount = () => {
      const v = form.elements.amount.value;
      if (v === 'custom') {
        const n = parseFloat(customAmt.value);
        return Number.isFinite(n) && n >= 1 ? Math.min(n, 25000) : 0;
      }
      return +v;
    };

    const update = () => {
      const amt = currentAmount();
      const monthly = form.elements.freq.value === 'monthly';
      if (!amt) {
        impactLine.textContent = 'Enter a pause length and give this finish room to land.';
        donateBtn.textContent = 'Mark the moment';
        return;
      }
      const preset = PRESET[amt];
      if (preset) {
        impactLine.textContent = monthly ? preset.monthly : preset.once;
      } else {
        impactLine.textContent = monthly
          ? `Next session, reserve ${amt.toLocaleString('en-US')} seconds to remember how this completed moment felt.`
          : `Take ${amt.toLocaleString('en-US')} seconds. Breathe, look away from the work, and let the finish be enough.`;
      }
      donateBtn.textContent = monthly ? `Carry ${amt.toLocaleString('en-US')}s forward` : `Take ${amt.toLocaleString('en-US')} seconds`;
      if (status.classList.contains('show')) { status.classList.remove('show'); status.textContent = ''; }
    };

    form.addEventListener('change', update);
    customAmt.addEventListener('focus', () => { customRadio.checked = true; update(); });
    customAmt.addEventListener('input', () => { customRadio.checked = true; update(); });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const amt = currentAmount();
      if (!amt) { customAmt.focus(); update(); return; }
      status.textContent = 'Moment marked. dueCardsCompleted is true, and this finish is yours.';
      status.classList.add('show');
    });

    update();
  }
})();
