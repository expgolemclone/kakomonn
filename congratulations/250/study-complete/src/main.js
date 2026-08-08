import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import './style.css';

gsap.registerPlugin(ScrollTrigger);

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const confettiPalette = ['#0ae448', '#f0f0e8', '#ff7a1a', '#ff4d95', '#5c7cff', '#ffd84d'];
const circleRadius = 86;
const circleCircumference = 2 * Math.PI * circleRadius;

function required(selector, root = document) {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`Required element was not found, ${selector}`);
  return element;
}

const hero = required('.hero');
const confettiField = required('[data-confetti]');
const finaleParticleField = required('[data-finale-particles]');
const progressCircle = required('.dial-progress');
const progressNumber = required('[data-progress-number]');
const checkStroke = required('.check-stroke');
const replayButton = required('[data-replay]');
const burstButton = required('[data-burst]');

let introTimeline;

function splitText() {
  document.querySelectorAll('[data-split]').forEach((line) => {
    const nodes = [...line.childNodes];
    line.textContent = '';

    nodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        [...node.textContent.replace(/\s+/g, '')].forEach((letter) => {
          const span = document.createElement('span');
          span.className = 'char';
          span.textContent = letter;
          line.appendChild(span);
        });
        return;
      }

      line.appendChild(node);
    });
  });
}

function splitWords() {
  document.querySelectorAll('[data-word-reveal]').forEach((element) => {
    const words = element.textContent.trim().split(/\s+/);
    element.textContent = '';

    words.forEach((word, index) => {
      const wrapper = document.createElement('span');
      wrapper.className = 'word-clip';
      const span = document.createElement('span');
      span.className = 'word';
      span.textContent = word;
      wrapper.appendChild(span);
      element.appendChild(wrapper);
      if (index < words.length - 1) element.append(' ');
    });
  });
}

function createRays(count = 28) {
  const rayField = required('[data-rays]');
  rayField.replaceChildren();

  for (let index = 0; index < count; index += 1) {
    const ray = document.createElement('i');
    ray.style.setProperty('--ray-index', index);
    ray.style.setProperty('--ray-count', count);
    rayField.appendChild(ray);
  }
}

function createConfetti(count = 84) {
  confettiField.replaceChildren();

  for (let index = 0; index < count; index += 1) {
    const piece = document.createElement('span');
    piece.className = index % 5 === 0 ? 'confetti confetti-dot' : 'confetti';
    piece.style.left = `${gsap.utils.random(1, 99)}%`;
    piece.style.background = confettiPalette[index % confettiPalette.length];
    piece.style.width = `${gsap.utils.random(5, 12)}px`;
    piece.style.height = `${gsap.utils.random(12, 34)}px`;
    confettiField.appendChild(piece);
  }
}

function createFinaleParticles(count = 34) {
  finaleParticleField.replaceChildren();

  for (let index = 0; index < count; index += 1) {
    const particle = document.createElement('span');
    particle.style.left = `${gsap.utils.random(0, 100)}%`;
    particle.style.top = `${gsap.utils.random(0, 100)}%`;
    particle.style.setProperty('--particle-size', `${gsap.utils.random(3, 11)}px`);
    finaleParticleField.appendChild(particle);
  }
}

function animateConfetti({ intensity = 1, delay = 0, originY = -120 } = {}) {
  const pieces = gsap.utils.toArray('.confetti');

  gsap.killTweensOf(pieces);
  gsap.set(pieces, {
    y: () => gsap.utils.random(originY - 70, originY + 45),
    x: 0,
    rotationX: () => gsap.utils.random(-180, 180),
    rotationY: () => gsap.utils.random(-180, 180),
    rotation: () => gsap.utils.random(-120, 120),
    scale: () => gsap.utils.random(0.55, 1.2),
    opacity: 0,
  });

  gsap.to(pieces, {
    y: () => window.innerHeight * gsap.utils.random(0.95, 1.52),
    x: () => gsap.utils.random(-260, 260) * intensity,
    rotationX: () => gsap.utils.random(-1080, 1080),
    rotationY: () => gsap.utils.random(-1080, 1080),
    rotation: () => gsap.utils.random(-960, 960),
    opacity: 1,
    duration: () => gsap.utils.random(2.2, 4.8),
    delay,
    stagger: { each: 0.009, from: 'random' },
    ease: 'power1.in',
  });
}

function buildProgressAnimation() {
  const value = { progress: 0 };
  const timeline = gsap.timeline();

  gsap.set(progressCircle, {
    strokeDasharray: circleCircumference,
    strokeDashoffset: circleCircumference,
  });
  gsap.set(checkStroke, { strokeDasharray: 160, strokeDashoffset: 160 });
  progressNumber.textContent = '0';

  timeline
    .to(value, {
      progress: 100,
      duration: 1.15,
      ease: 'power3.inOut',
      onUpdate: () => {
        const rounded = Math.round(value.progress);
        progressNumber.textContent = String(rounded);
        gsap.set(progressCircle, {
          strokeDashoffset: circleCircumference * (1 - value.progress / 100),
        });
      },
    })
    .to(checkStroke, { strokeDashoffset: 0, duration: 0.38, ease: 'power2.out' }, '-=0.18')
    .to('.medal-core', { scale: 1.08, duration: 0.14, yoyo: true, repeat: 1 }, '-=0.2')
    .to('.sunburst i', {
      scaleY: 1.45,
      opacity: 1,
      duration: 0.32,
      stagger: { each: 0.012, from: 'center' },
      yoyo: true,
      repeat: 1,
      ease: 'power2.out',
    }, '-=0.35');

  return timeline;
}

function buildIntro() {
  if (introTimeline) introTimeline.kill();

  const chars = gsap.utils.toArray('.char');
  const revealItems = gsap.utils.toArray('[data-reveal]');
  const introLines = gsap.utils.toArray('[data-intro-line]');

  gsap.set('.intro-wipe', { display: 'grid', yPercent: 0 });
  gsap.set(introLines, { yPercent: 115, rotate: 4, opacity: 0 });
  gsap.set('.intro-progress i', { scaleX: 0 });
  gsap.set(chars, {
    yPercent: 155,
    rotationX: -80,
    rotationZ: () => gsap.utils.random(-8, 8),
    scale: 0.72,
    opacity: 0,
  });
  gsap.set(revealItems, { y: 44, opacity: 0 });
  gsap.set('.celebration-stage', { scale: 0.18, rotation: -75, opacity: 0 });
  gsap.set('.spark', { scale: 0, rotation: -160, opacity: 0 });
  gsap.set('.orbit-labels span', { scale: 0, opacity: 0 });
  gsap.set('.completion-rail i', { scaleX: 0 });

  introTimeline = gsap.timeline({ defaults: { ease: 'power4.out' } });
  introTimeline
    .to(introLines, {
      yPercent: 0,
      rotate: 0,
      opacity: 1,
      duration: 0.52,
      stagger: 0.065,
      delay: 0.08,
    })
    .to('.intro-progress i', { scaleX: 1, duration: 0.5, ease: 'power2.inOut' }, '-=0.38')
    .to(introLines, { yPercent: -112, opacity: 0, duration: 0.34, stagger: 0.035 }, '+=0.12')
    .to('.intro-wipe', { yPercent: -100, duration: 0.65, ease: 'power4.inOut' }, '-=0.1')
    .to(chars, {
      yPercent: 0,
      rotationX: 0,
      rotationZ: 0,
      scale: 1,
      opacity: 1,
      duration: 0.78,
      stagger: { each: 0.026, from: 'edges' },
    }, '-=0.34')
    .to(revealItems, { y: 0, opacity: 1, duration: 0.55, stagger: 0.07 }, '-=0.72')
    .to('.celebration-stage', {
      scale: 1,
      rotation: 0,
      opacity: 1,
      duration: 0.78,
      ease: 'back.out(1.7)',
    }, '-=0.86')
    .to('.orbit-labels span', {
      scale: 1,
      opacity: 1,
      duration: 0.35,
      stagger: 0.055,
      ease: 'back.out(2.6)',
    }, '-=0.6')
    .to('.spark', {
      scale: 1,
      rotation: 0,
      opacity: 1,
      duration: 0.35,
      stagger: 0.045,
      ease: 'back.out(2.8)',
    }, '-=0.55')
    .add(buildProgressAnimation(), '-=0.78')
    .to('.completion-rail i', {
      scaleX: 1,
      duration: 0.5,
      stagger: 0.1,
      ease: 'power2.inOut',
    }, '-=1.15')
    .add(() => animateConfetti({ delay: 0.02 }), '-=0.82');

  return introTimeline;
}

function setupAmbientMotion() {
  gsap.to('.sunburst', { rotation: 360, duration: 18, ease: 'none', repeat: -1 });
  gsap.to('.dial-glint', { rotation: 360, duration: 5.5, ease: 'none', repeat: -1 });
  gsap.to('.medal', { y: -15, rotation: 2.5, duration: 2.2, ease: 'sine.inOut', yoyo: true, repeat: -1 });
  gsap.to('.orbit-labels', { rotation: 360, duration: 20, ease: 'none', repeat: -1 });
  gsap.to('.orbit-labels span', { rotation: -360, duration: 20, ease: 'none', repeat: -1 });
  gsap.to('.orbit-one', { rotation: 360, duration: 26, ease: 'none', repeat: -1 });
  gsap.to('.orbit-two', { rotation: -360, duration: 19, ease: 'none', repeat: -1 });
  gsap.to('.orbit-three', { rotation: 360, duration: 12, ease: 'none', repeat: -1 });
  gsap.to('.title-line-top', { x: 13, duration: 2.8, yoyo: true, repeat: -1, ease: 'sine.inOut' });
  gsap.to('.title-line-bottom', { x: -17, duration: 3.4, yoyo: true, repeat: -1, ease: 'sine.inOut' });
  gsap.to('.bangs', { scale: 1.14, rotation: 3, duration: 0.72, yoyo: true, repeat: -1, ease: 'power2.inOut' });
  gsap.to('.live-dot', { scale: 1.8, opacity: 0.25, duration: 0.75, yoyo: true, repeat: -1, ease: 'sine.inOut' });
  gsap.to('.spark-a, .spark-c', { y: -15, x: 7, duration: 1.4, yoyo: true, repeat: -1, ease: 'sine.inOut' });
  gsap.to('.spark-b, .spark-d', { y: 14, x: -6, duration: 1.9, yoyo: true, repeat: -1, ease: 'sine.inOut' });
  gsap.to('.aurora-a', {
    xPercent: 20,
    yPercent: -12,
    scale: 1.22,
    duration: 7,
    yoyo: true,
    repeat: -1,
    ease: 'sine.inOut',
  });
  gsap.to('.aurora-b', {
    xPercent: -18,
    yPercent: 18,
    scale: 0.82,
    duration: 8.5,
    yoyo: true,
    repeat: -1,
    ease: 'sine.inOut',
  });
  gsap.to('.motion-grid', {
    backgroundPosition: '68px 42px',
    duration: 7,
    ease: 'none',
    repeat: -1,
  });
  gsap.to('.marquee-track', { xPercent: -50, duration: 20, ease: 'none', repeat: -1 });
  gsap.to('.finale-particles span', {
    y: () => gsap.utils.random(-55, 55),
    x: () => gsap.utils.random(-35, 35),
    scale: () => gsap.utils.random(0.5, 1.7),
    opacity: () => gsap.utils.random(0.15, 0.65),
    duration: () => gsap.utils.random(2.2, 5.4),
    yoyo: true,
    repeat: -1,
    ease: 'sine.inOut',
    stagger: { each: 0.025, from: 'random' },
  });

  const rayTweens = gsap.utils.toArray('.sunburst i').map((ray, index) => gsap.to(ray, {
    scaleY: index % 3 === 0 ? 1.22 : 0.84,
    opacity: index % 4 === 0 ? 1 : 0.52,
    duration: 0.8 + (index % 5) * 0.16,
    yoyo: true,
    repeat: -1,
    ease: 'sine.inOut',
  }));

  const stageX = gsap.quickTo('.celebration-stage', 'x', { duration: 0.7, ease: 'power3.out' });
  const stageY = gsap.quickTo('.celebration-stage', 'y', { duration: 0.7, ease: 'power3.out' });
  const copyX = gsap.quickTo('.hero-copy', 'x', { duration: 1.1, ease: 'power3.out' });
  const copyY = gsap.quickTo('.hero-copy', 'y', { duration: 1.1, ease: 'power3.out' });
  const gridX = gsap.quickTo('.motion-grid', 'x', { duration: 1.4, ease: 'power3.out' });
  const gridY = gsap.quickTo('.motion-grid', 'y', { duration: 1.4, ease: 'power3.out' });

  hero.addEventListener('pointermove', (event) => {
    const bounds = hero.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;
    stageX(x * 34);
    stageY(y * 23);
    copyX(x * -9);
    copyY(y * -6);
    gridX(x * -18);
    gridY(y * -12);
  });

  hero.addEventListener('pointerleave', () => {
    stageX(0);
    stageY(0);
    copyX(0);
    copyY(0);
    gridX(0);
    gridY(0);
  });

  return rayTweens;
}

function setupMagneticButton() {
  const buttonX = gsap.quickTo(burstButton, 'x', { duration: 0.35, ease: 'power3.out' });
  const buttonY = gsap.quickTo(burstButton, 'y', { duration: 0.35, ease: 'power3.out' });
  const arrowX = gsap.quickTo('.burst-button-arrow', 'x', { duration: 0.3, ease: 'power3.out' });
  const arrowY = gsap.quickTo('.burst-button-arrow', 'y', { duration: 0.3, ease: 'power3.out' });

  burstButton.addEventListener('pointermove', (event) => {
    const bounds = burstButton.getBoundingClientRect();
    const x = event.clientX - (bounds.left + bounds.width / 2);
    const y = event.clientY - (bounds.top + bounds.height / 2);
    buttonX(x * 0.09);
    buttonY(y * 0.13);
    arrowX(x * 0.11);
    arrowY(y * 0.16);
  });

  burstButton.addEventListener('pointerleave', () => {
    buttonX(0);
    buttonY(0);
    arrowX(0);
    arrowY(0);
  });
}

function setupScrollAnimations() {
  gsap.utils.toArray('[data-scroll-reveal]').forEach((item) => {
    gsap.from(item, {
      y: 78,
      rotationX: -18,
      opacity: 0,
      duration: 1.05,
      ease: 'power4.out',
      scrollTrigger: { trigger: item, start: 'top 84%', once: true },
    });
  });

  gsap.from('.word', {
    yPercent: 115,
    rotation: 3,
    opacity: 0,
    duration: 0.9,
    stagger: 0.055,
    ease: 'power4.out',
    scrollTrigger: { trigger: '.manifesto-copy', start: 'top 79%', once: true },
  });

  gsap.from('.proof-card li', {
    x: 70,
    opacity: 0,
    duration: 0.72,
    stagger: 0.14,
    ease: 'power3.out',
    scrollTrigger: { trigger: '.proof-card', start: 'top 76%', once: true },
  });

  gsap.from('.check-icon', {
    scale: 0,
    rotation: -120,
    duration: 0.55,
    stagger: 0.14,
    ease: 'back.out(2.7)',
    scrollTrigger: { trigger: '.proof-card', start: 'top 74%', once: true },
  });

  gsap.utils.toArray('[data-flow-card]').forEach((card, index) => {
    gsap.from(card, {
      xPercent: index === 1 ? 0 : index === 0 ? -75 : 75,
      y: index === 1 ? 90 : 0,
      rotation: index === 0 ? -9 : index === 2 ? 9 : 0,
      scale: 0.82,
      opacity: 0,
      duration: 1.15,
      ease: 'power4.out',
      scrollTrigger: { trigger: card, start: 'top 88%', once: true },
    });

    gsap.to(card, {
      yPercent: index === 1 ? -8 : 8,
      rotation: index === 0 ? 2 : index === 2 ? -2 : 0,
      ease: 'none',
      scrollTrigger: {
        trigger: '.study-flow',
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
      },
    });
  });

  gsap.to('.title-line-top', {
    xPercent: -10,
    ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
  });
  gsap.to('.title-line-bottom', {
    xPercent: 10,
    ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
  });
  gsap.to('.celebration-stage', {
    yPercent: 38,
    rotation: 18,
    scale: 0.76,
    opacity: 0.22,
    ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
  });

  gsap.from('[data-finale-line]', {
    yPercent: 118,
    rotation: 4,
    opacity: 0,
    duration: 1.2,
    stagger: 0.14,
    ease: 'power4.out',
    scrollTrigger: { trigger: '.finale-copy h2', start: 'top 80%', once: true },
  });

  gsap.from('[data-done-stamp]', {
    scale: 0.18,
    rotation: -46,
    opacity: 0,
    duration: 1.05,
    ease: 'back.out(1.8)',
    scrollTrigger: { trigger: '[data-done-stamp]', start: 'top 88%', once: true },
  });

  gsap.to('[data-done-stamp]', {
    rotation: 9,
    scale: 1.04,
    duration: 1.9,
    yoyo: true,
    repeat: -1,
    ease: 'sine.inOut',
  });
}

function showReducedMotionState() {
  gsap.set('.intro-wipe', { display: 'none' });
  gsap.set(progressCircle, {
    strokeDasharray: circleCircumference,
    strokeDashoffset: 0,
  });
  gsap.set(checkStroke, { strokeDasharray: 160, strokeDashoffset: 0 });
  progressNumber.textContent = '100';
  gsap.set(
    '.char, .word, [data-reveal], [data-scroll-reveal], [data-finale-line], [data-done-stamp], .celebration-stage, .spark, .orbit-labels span, .completion-rail i',
    { clearProps: 'all' },
  );
}

function replay() {
  ScrollTrigger.refresh();
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });

  if (reduceMotion) {
    animateConfetti({ intensity: 0.72 });
    return;
  }

  window.setTimeout(() => buildIntro(), 220);
}

splitText();
splitWords();
createRays();
createConfetti();
createFinaleParticles();

if (reduceMotion) {
  showReducedMotionState();
} else {
  buildIntro();
  setupAmbientMotion();
  setupMagneticButton();
  setupScrollAnimations();
}

replayButton.addEventListener('click', replay);
burstButton.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  window.setTimeout(() => animateConfetti({ intensity: 1.55, originY: -40 }), reduceMotion ? 0 : 420);
});
