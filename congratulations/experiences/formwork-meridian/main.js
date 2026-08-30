/* ============================================================
   MERIDIAN — the readout
   Odometer digits · live pressure gauge · segmented control ·
   numbered stepper · scroll-linked extraction line.
   Vanilla JS, no dependencies. Enhancements gate on the .js class,
   so with JS disabled every panel and step is already visible.
   ============================================================ */
(() => {
  'use strict';
  document.documentElement.classList.add('js');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasIO = 'IntersectionObserver' in window;
  const easeOut = p => 1 - Math.pow(1 - p, 3);
  const easeIn  = p => p * p;

  /* ---------- odometer: rolling digit columns ---------- */
  // Each digit becomes a clipped column holding a 0–9 reel; translateY selects
  // the digit. Non-digits (units, ., :, ±, $, ,) render as fixed spans.
  function buildOdometer(el, str) {
    el.classList.add('odo');
    const frag = document.createDocumentFragment();
    for (const ch of str) {
      if (ch >= '0' && ch <= '9') {
        const col = document.createElement('span'); col.className = 'odo-col';
        const reel = document.createElement('span'); reel.className = 'odo-reel';
        for (let d = 0; d <= 9; d++) {
          const dg = document.createElement('span');
          dg.className = 'odo-d'; dg.textContent = d;
          reel.appendChild(dg);
        }
        col.appendChild(reel);
        frag.appendChild(col);
      } else {
        const s = document.createElement('span');
        s.className = 'odo-fixed'; s.textContent = ch;
        frag.appendChild(s);
      }
    }
    el.textContent = '';
    el.appendChild(frag);
    el._mask = str.replace(/[0-9]/g, '#');
  }

  function setReel(reel, digit, animate) {
    if (!animate || reduce) {
      reel.style.transition = 'none';
      reel.style.transform = `translateY(-${digit}em)`;
      requestAnimationFrame(() => { reel.style.transition = ''; });
    } else {
      reel.style.transform = `translateY(-${digit}em)`;
    }
  }

  // rollTo(el, "93.5 °C") — rebuilds only when the digit/unit shape changes,
  // otherwise the existing reels animate from their current value to the new one.
  function rollTo(el, str, animate) {
    const mask = str.replace(/[0-9]/g, '#');
    if (el._mask !== mask) {
      buildOdometer(el, str);
      if (animate && !reduce) void el.offsetWidth; // commit the 0 state so 0→N animates
    }
    const cols = el.querySelectorAll('.odo-col');
    let ci = 0;
    for (const ch of str) {
      if (ch >= '0' && ch <= '9') setReel(cols[ci++].firstChild, +ch, animate);
    }
    el._val = str;
  }

  /* ---------- roll-in stats on view ---------- */
  (function initRolls() {
    const els = [...document.querySelectorAll('[data-roll]')];
    els.forEach(el => buildOdometer(el, el.dataset.odo)); // reels rest at 0
    if (reduce) { els.forEach(el => rollTo(el, el.dataset.odo, false)); return; }
    if (hasIO) {
      const io = new IntersectionObserver((entries, obs) => {
        entries.forEach(e => {
          if (e.isIntersecting) { rollTo(e.target, e.target.dataset.odo, true); obs.unobserve(e.target); }
        });
      }, { threshold: 0.4 });
      els.forEach(el => io.observe(el));
    } else {
      els.forEach(el => rollTo(el, el.dataset.odo, true));
    }
  })();

  /* ---------- nav backdrop + extraction line ---------- */
  (function scrollBits() {
    const nav = document.getElementById('nav');
    const fill = document.getElementById('extractionFill');
    const pct = document.getElementById('extractionPct');
    let ticking = false;
    function update() {
      ticking = false;
      if (nav) nav.classList.toggle('scrolled', scrollY > 20);
      const max = document.documentElement.scrollHeight - innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
      if (fill) fill.style.height = (p * 100) + '%';
      if (pct) pct.textContent = Math.round(p * 100) + '%';
    }
    function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', update);
    update();
  })();

  /* ---------- hero pressure gauge ---------- */
  (function gauge() {
    const canvas = document.getElementById('gauge');
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rTimer = document.getElementById('rTimer');
    const rPressure = document.getElementById('rPressure');
    const rYield = document.getElementById('rYield');
    const setReadout = (el, v) => { if (el && el.firstChild) el.firstChild.nodeValue = v; };

    const dpr = Math.min(devicePixelRatio || 1, 2);
    let size = 360;
    function resize() {
      size = canvas.clientWidth || 360;
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(current.bar);
    }

    const MAXBAR = 9;
    const START = Math.PI * 0.75;     // 135° — down-left
    const SWEEP = Math.PI * 1.5;      // 270° clockwise
    const RAMP = 2.4, HOLD = 20, DROP = 1.3, REST = 2;
    const SHOT_END = RAMP + HOLD + DROP;
    const CYCLE = SHOT_END + REST;
    const YIELD_MAX = 100;
    let current = { bar: 0, timer: 0, yld: 0 };

    function stateAt(t) {
      let bar;
      if (t < RAMP)                bar = easeOut(t / RAMP) * MAXBAR;
      else if (t < RAMP + HOLD)    bar = MAXBAR;
      else if (t < SHOT_END)       bar = MAXBAR * (1 - easeIn((t - RAMP - HOLD) / DROP));
      else                         bar = 0;
      const timer = t < SHOT_END ? t : SHOT_END;
      const y0 = RAMP * 0.4;
      let yld;
      if (t <= y0)            yld = 0;
      else if (t < SHOT_END)  yld = easeOut((t - y0) / (SHOT_END - y0)) * YIELD_MAX;
      else                    yld = YIELD_MAX;
      return { bar, timer, yld };
    }

    function draw(bar) {
      const c = size / 2, R = size * 0.40, k = size / 360;
      ctx.clearRect(0, 0, size, size);
      // machined tick marks — major every 1.0 bar, minor every 0.2
      for (let i = 0; i <= 45; i++) {
        const major = i % 5 === 0;
        const ang = START + (i / 45) * SWEEP;
        const r1 = R, r2 = R - (major ? 14 : 8) * k;
        ctx.beginPath();
        ctx.moveTo(c + Math.cos(ang) * r1, c + Math.sin(ang) * r1);
        ctx.lineTo(c + Math.cos(ang) * r2, c + Math.sin(ang) * r2);
        ctx.strokeStyle = major ? 'rgba(169,158,144,.85)' : 'rgba(110,100,88,.6)';
        ctx.lineWidth = major ? 1.4 : 1;
        ctx.stroke();
        if (major) {
          const rl = R - 27 * k;
          ctx.fillStyle = 'rgba(169,158,144,.9)';
          ctx.font = `${Math.round(11 * k)}px "IBM Plex Mono", monospace`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(String(i / 5), c + Math.cos(ang) * rl, c + Math.sin(ang) * rl);
        }
      }
      // background track
      const tr = R + 7 * k;
      ctx.beginPath(); ctx.arc(c, c, tr, START, START + SWEEP);
      ctx.strokeStyle = 'rgba(244,237,228,.10)'; ctx.lineWidth = 2 * k; ctx.stroke();
      // copper progress arc up to the needle
      const frac = bar / MAXBAR, nAng = START + frac * SWEEP;
      if (frac > 0.001) {
        ctx.beginPath(); ctx.arc(c, c, tr, START, nAng);
        ctx.strokeStyle = '#C8622C'; ctx.lineWidth = 3 * k; ctx.lineCap = 'round'; ctx.stroke();
      }
      // copper needle
      ctx.save();
      ctx.translate(c, c); ctx.rotate(nAng);
      ctx.beginPath(); ctx.moveTo(-R * 0.16, 0); ctx.lineTo(R * 0.9, 0);
      ctx.strokeStyle = '#E98A4B'; ctx.lineWidth = 2.4 * k; ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(233,138,75,.55)'; ctx.shadowBlur = 8 * k;
      ctx.stroke();
      ctx.restore();
      // hub
      ctx.beginPath(); ctx.arc(c, c, size * 0.045, 0, Math.PI * 2);
      ctx.fillStyle = '#1B1512'; ctx.fill();
      ctx.lineWidth = 1.5 * k; ctx.strokeStyle = '#C8622C'; ctx.stroke();
    }

    resize();
    addEventListener('resize', resize);

    if (reduce) {
      // one static frame: held at nine bars, reference shot values
      current = { bar: 9, timer: 27, yld: 100 };
      draw(9);
      setReadout(rTimer, '27.0'); setReadout(rPressure, '9.0'); setReadout(rYield, '100');
      return;
    }

    let t = 0, last = performance.now(), raf = null, visible = true, running = false;
    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (visible) t = (t + dt) % CYCLE;
      current = stateAt(t);
      draw(current.bar);
      setReadout(rTimer, current.timer.toFixed(1));
      setReadout(rPressure, current.bar.toFixed(1));
      setReadout(rYield, String(Math.round(current.yld)));
      raf = requestAnimationFrame(frame);
    }
    function start() { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
    function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = null; }

    if (hasIO) {
      const io = new IntersectionObserver(entries => {
        visible = entries[0].isIntersecting;
        if (visible) start(); else stop();
      }, { threshold: 0.05 });
      io.observe(canvas);
    } else { start(); }
  })();

  /* ---------- method: segmented control (real tablist) ---------- */
  (function method() {
    const tablist = document.querySelector('.segmented');
    if (!tablist) return;
    const tabs = [...tablist.querySelectorAll('[role="tab"]')];
    const thumb = document.getElementById('segThumb');
    const panel = document.getElementById('brewPanel');
    const brewTitle = document.getElementById('brewTitle');
    const brewCode = document.getElementById('brewCode');
    const recipe = document.getElementById('recipe');
    const specEls = {};
    document.querySelectorAll('.brew [data-key]').forEach(el => specEls[el.dataset.key] = el);
    const imgs = [...document.querySelectorAll('.brew-img')];

    const M = {
      espresso: { title: 'FOCUS', code: 'READ 01',
        dose: '01', grind: 'steady', water: 'given', temp: 'yours', time: 'today', yield: 'clear',
        recipe: ['You placed your attention on the card that was here.',
                 'You repeated that small act without needing a perfect rhythm.',
                 'Enough focused moments joined together to clear the due queue.'] },
      pourover: { title: 'RECALL', code: 'READ 02',
        dose: '02', grind: 'active', water: 'tested', temp: 'yours', time: 'today', yield: 'deeper',
        recipe: ['You reached into memory before letting each card move on.',
                 'Every retrieval gave the path back another pass.',
                 'The clear queue now holds the trace of all that recall.'] },
      coldbrew: { title: 'PERSISTENCE', code: 'READ 03',
        dose: '03', grind: 'durable', water: 'shown', temp: 'yours', time: 'earned', yield: 'true',
        recipe: ['You met another card whenever another card was due.',
                 'You reset and continued, even when the rhythm changed.',
                 'Then the last due card passed, and dailyKpiCompleted became true after all due cards were complete and 100 new questions were answered.'] }
    };

    function moveThumb(tab) {
      thumb.style.width = tab.offsetWidth + 'px';
      thumb.style.transform = `translateX(${tab.offsetLeft - thumb.offsetLeft}px)`;
    }
    function swapText(el, txt, animate) {
      if (!animate || reduce) { el.textContent = txt; el.style.opacity = '1'; return; }
      el.style.opacity = '0';
      setTimeout(() => { el.textContent = txt; el.style.opacity = '1'; }, 150);
    }
    function renderRecipe(lines) {
      recipe.textContent = '';
      lines.forEach(l => { const li = document.createElement('li'); li.textContent = l; recipe.appendChild(li); });
    }
    function swapRecipe(lines, animate) {
      if (!animate || reduce) { renderRecipe(lines); recipe.style.opacity = '1'; return; }
      recipe.style.opacity = '0';
      setTimeout(() => { renderRecipe(lines); recipe.style.opacity = '1'; }, 150);
    }

    let currentMethod = 'espresso';
    function activate(name, { focus = false, animate = true } = {}) {
      const tab = tabs.find(t => t.dataset.method === name);
      if (!tab) return;
      currentMethod = name;
      tabs.forEach(t => {
        const sel = t === tab;
        t.setAttribute('aria-selected', sel ? 'true' : 'false');
        t.tabIndex = sel ? 0 : -1;
      });
      panel.setAttribute('aria-labelledby', tab.id);
      moveThumb(tab);
      const d = M[name];
      rollTo(specEls.dose,  d.dose,  animate);
      swapText(specEls.grind, d.grind, animate);
      rollTo(specEls.water, d.water, animate);
      rollTo(specEls.temp,  d.temp,  animate);
      rollTo(specEls.time,  d.time,  animate);
      rollTo(specEls.yield, d.yield, animate);
      brewTitle.textContent = d.title;
      brewCode.textContent = d.code;
      swapRecipe(d.recipe, animate);
      imgs.forEach(im => im.classList.toggle('is-active', im.dataset.method === name));
      if (focus) tab.focus();
    }

    tabs.forEach(t => t.addEventListener('click', () => activate(t.dataset.method, { focus: true })));
    tablist.addEventListener('keydown', e => {
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      let n = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = tabs.length - 1;
      if (n !== null) { e.preventDefault(); activate(tabs[n].dataset.method, { focus: true }); }
    });

    // build initial (espresso) state without animation, then place the thumb once laid out
    activate('espresso', { animate: false });
    const place = () => moveThumb(tabs.find(t => t.dataset.method === currentMethod));
    requestAnimationFrame(place);
    addEventListener('load', place);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
    addEventListener('resize', place);
  })();

  /* ---------- process: numbered stepper + auto-advance ---------- */
  (function process() {
    const steps = [...document.querySelectorAll('.step')];
    if (!steps.length) return;
    const imgs = [...document.querySelectorAll('.walk-img')];
    const bar = document.getElementById('walkProgress');
    const caption = document.getElementById('walkCaption');
    const walk = document.querySelector('.walk');
    const names = ['Start', 'Reach', 'Check', 'Reset', 'Persist', 'Clear'];
    const details = [
      'you gave the first due card your attention.',
      'you asked memory to meet you halfway.',
      'you noticed what came back and what did not.',
      'you met the next card with a fresh attempt.',
      'you kept going while a due card remained.',
      'the final due card released the pressure.'
    ];
    const DUR = 6000;
    let active = 0, raf = null, startT = 0, paused = false, visible = true;

    function render(i) {
      active = i;
      steps.forEach((s, k) => {
        s.classList.toggle('is-active', k === i);
        s.classList.toggle('is-done', k < i);
        if (k === i) s.setAttribute('aria-current', 'step'); else s.removeAttribute('aria-current');
      });
      imgs.forEach((im, k) => im.classList.toggle('is-active', k === i));
      caption.textContent = `Step ${String(i + 1).padStart(2, '0')} — ${names[i]} · ${details[i]}`;
    }
    function resetBar() { if (bar) bar.style.width = '0%'; startT = performance.now(); }
    function jump(i) { render(i); resetBar(); }

    steps.forEach((s, i) => {
      s.addEventListener('click', () => jump(i));
      s.addEventListener('focus', () => { paused = true; });
      s.addEventListener('blur', () => { paused = false; });
    });

    render(0);
    if (reduce) { if (bar) bar.style.width = '0%'; return; } // no autoplay

    if (walk) {
      walk.addEventListener('pointerenter', () => { paused = true; });
      walk.addEventListener('pointerleave', () => { paused = false; });
    }
    if (hasIO) {
      const io = new IntersectionObserver(e => { visible = e[0].isIntersecting; }, { threshold: 0.2 });
      io.observe(document.querySelector('.process'));
    }

    function tick(now) {
      if (!paused && visible) {
        const p = Math.min(1, (now - startT) / DUR);
        if (bar) bar.style.width = (p * 100) + '%';
        if (p >= 1) jump((active + 1) % steps.length);
      } else {
        // hold progress while paused/offscreen
        const w = bar ? parseFloat(bar.style.width) || 0 : 0;
        startT = now - (w / 100) * DUR;
      }
      raf = requestAnimationFrame(tick);
    }
    resetBar();
    raf = requestAnimationFrame(tick);
  })();
})();
