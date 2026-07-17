import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const entry = resolve('dist/index.html');
const distDir = dirname(entry);
let html = await readFile(entry, 'utf8');

const cssHref = html.match(/<link[^>]+href="([^"]+\.css)"[^>]*>/)?.[1];
const scriptSrc = html.match(/<script[^>]+src="([^"]+\.js)"[^>]*><\/script>/)?.[1];

if (!cssHref || !scriptSrc) {
  throw new Error('Built CSS or JavaScript asset was not found in dist/index.html');
}

const assetPath = (path) => resolve(distDir, path.replace(/^\.\//, ''));
const [css, javascript] = await Promise.all([
  readFile(assetPath(cssHref), 'utf8'),
  readFile(assetPath(scriptSrc), 'utf8'),
]);

html = html
  .replace(/<link[^>]+href="[^"]+\.css"[^>]*>/, `<style>${css}</style>`)
  .replace(/<script[^>]+src="[^"]+\.js"[^>]*><\/script>/, `<script type="module">${javascript}<\/script>`);

const browser = await chromium.launch({
  headless: true,
});

async function openPage({ viewport, reducedMotion }) {
  const page = await browser.newPage({ viewport, reducedMotion });
  const browserErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.setContent(html, { waitUntil: 'load', timeout: 15000 });
  await page.waitForSelector('[data-burst]');
  await page.waitForFunction(() => document.querySelectorAll('.confetti').length === 84);
  await page.waitForFunction(() => document.querySelectorAll('.sunburst i').length === 28);
  await page.waitForFunction(() => document.querySelectorAll('.finale-particles span').length === 34);
  return { page, browserErrors };
}

async function collectLayout(page) {
  return page.evaluate(() => {
    const medalText = document.querySelector('.medal-core strong');
    const medal = document.querySelector('.medal-core');
    const chars = [...document.querySelectorAll('.char')];
    return {
      title: document.title,
      heading: document.querySelector('h1')?.getAttribute('aria-label'),
      completionCopy: document.querySelector('.completion-message h2')?.textContent.trim(),
      confettiCount: document.querySelectorAll('.confetti').length,
      rayCount: document.querySelectorAll('.sunburst i').length,
      finaleParticleCount: document.querySelectorAll('.finale-particles span').length,
      sectionCount: document.querySelectorAll('main section').length,
      flowCardCount: document.querySelectorAll('[data-flow-card]').length,
      checklistCount: document.querySelectorAll('.proof-card li').length,
      pageHeight: document.documentElement.scrollHeight,
      hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      medalTextFits: medalText && medal
        ? medalText.getBoundingClientRect().width <= medal.getBoundingClientRect().width
        : false,
      visibleCharacterCount: chars.filter((char) => Number(getComputedStyle(char).opacity) > 0.98).length,
      progressNumber: document.querySelector('[data-progress-number]')?.textContent,
      progressDashOffset: Number.parseFloat(getComputedStyle(document.querySelector('.dial-progress')).strokeDashoffset),
      checkDashOffset: Number.parseFloat(getComputedStyle(document.querySelector('.check-stroke')).strokeDashoffset),
    };
  });
}

function assertLayout(result, viewportWidth, browserErrors) {
  if (result.title !== 'Congratulations, You Finished Today') throw new Error(`Unexpected title, ${result.title}`);
  if (result.heading !== 'Congratulations, you finished today’s study') throw new Error(`Unexpected heading, ${result.heading}`);
  if (result.completionCopy !== '今日も, やり切った.') throw new Error(`Unexpected completion copy, ${result.completionCopy}`);
  if (result.confettiCount !== 84) throw new Error(`Unexpected confetti count, ${result.confettiCount}`);
  if (result.rayCount !== 28) throw new Error(`Unexpected ray count, ${result.rayCount}`);
  if (result.finaleParticleCount !== 34) throw new Error(`Unexpected finale particle count, ${result.finaleParticleCount}`);
  if (result.sectionCount !== 3) throw new Error(`Unexpected section count, ${result.sectionCount}`);
  if (result.flowCardCount !== 3) throw new Error(`Unexpected flow card count, ${result.flowCardCount}`);
  if (result.checklistCount !== 3) throw new Error(`Unexpected checklist count, ${result.checklistCount}`);
  if (result.pageHeight <= 2300) throw new Error(`Page height is too small, ${result.pageHeight}`);
  if (result.hasHorizontalOverflow) throw new Error(`Unexpected horizontal overflow at ${viewportWidth}px`);
  if (!result.medalTextFits) throw new Error(`Medal text overflows at ${viewportWidth}px`);
  if (result.visibleCharacterCount !== 15) throw new Error(`Not all title characters are visible, ${result.visibleCharacterCount}`);
  if (result.progressNumber !== '100') throw new Error(`Progress did not reach 100, ${result.progressNumber}`);
  if (Math.abs(result.progressDashOffset) > 1) throw new Error(`Progress ring did not complete, ${result.progressDashOffset}`);
  if (Math.abs(result.checkDashOffset) > 1) throw new Error(`Check mark did not complete, ${result.checkDashOffset}`);
  if (browserErrors.length > 0) throw new Error(`Browser errors, ${browserErrors.join(' | ')}`);
}

async function verifyMotion() {
  const { page, browserErrors } = await openPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'no-preference',
  });

  await page.waitForTimeout(6100);
  const firstMotionState = await page.evaluate(() => ({
    wipeBottom: document.querySelector('.intro-wipe').getBoundingClientRect().bottom,
    animatedConfetti: [...document.querySelectorAll('.confetti')]
      .filter((piece) => piece.style.transform.length > 0).length,
    titleTransform: getComputedStyle(document.querySelector('.title-line-top')).transform,
    gridPosition: getComputedStyle(document.querySelector('.motion-grid')).backgroundPosition,
    marqueeTransform: getComputedStyle(document.querySelector('.marquee-track')).transform,
  }));

  await page.waitForTimeout(700);
  const secondMotionState = await page.evaluate(() => ({
    titleTransform: getComputedStyle(document.querySelector('.title-line-top')).transform,
    gridPosition: getComputedStyle(document.querySelector('.motion-grid')).backgroundPosition,
    marqueeTransform: getComputedStyle(document.querySelector('.marquee-track')).transform,
  }));

  if (firstMotionState.wipeBottom > 2) throw new Error(`Intro wipe is still visible, ${firstMotionState.wipeBottom}`);
  if (firstMotionState.animatedConfetti === 0) throw new Error('Confetti animation did not start');
  if (firstMotionState.titleTransform === secondMotionState.titleTransform) throw new Error('Ambient title motion did not change');
  if (firstMotionState.gridPosition === secondMotionState.gridPosition) throw new Error('Background grid motion did not change');
  if (firstMotionState.marqueeTransform === secondMotionState.marqueeTransform) throw new Error('Marquee motion did not change');

  await page.locator('.manifesto-copy').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  const manifestoState = await page.evaluate(() => ({
    wordOpacity: Number(getComputedStyle(document.querySelector('.word')).opacity),
    checklistOpacity: Number(getComputedStyle(document.querySelector('.proof-card li')).opacity),
  }));
  if (manifestoState.wordOpacity < 0.98) throw new Error(`Word reveal did not complete, ${manifestoState.wordOpacity}`);
  if (manifestoState.checklistOpacity < 0.98) throw new Error(`Checklist reveal did not complete, ${manifestoState.checklistOpacity}`);

  await page.locator('.finale-copy h2').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1300);
  const finaleOpacity = await page.locator('[data-finale-line]').first().evaluate((element) => Number(getComputedStyle(element).opacity));
  if (finaleOpacity < 0.98) throw new Error(`Finale reveal did not complete, ${finaleOpacity}`);

  await page.locator('[data-burst]').click();
  await page.waitForTimeout(1000);
  const burstState = await page.evaluate(() => ({
    scrollY: window.scrollY,
    movingConfetti: [...document.querySelectorAll('.confetti')]
      .filter((piece) => getComputedStyle(piece).transform !== 'none').length,
  }));
  if (burstState.scrollY > 80) throw new Error(`Burst button did not return to the hero, ${burstState.scrollY}`);
  if (burstState.movingConfetti === 0) throw new Error('Burst button did not restart confetti');

  await page.locator('[data-replay]').click();
  await page.waitForTimeout(520);
  const replayStartState = await page.evaluate(() => ({
    wipeBottom: document.querySelector('.intro-wipe').getBoundingClientRect().bottom,
    progressNumber: document.querySelector('[data-progress-number]').textContent,
  }));
  if (replayStartState.wipeBottom < 500) throw new Error(`Replay intro did not reopen, ${replayStartState.wipeBottom}`);
  if (replayStartState.progressNumber !== '0') throw new Error(`Replay progress did not reset, ${replayStartState.progressNumber}`);

  await page.waitForTimeout(5900);
  const replayEndState = await page.evaluate(() => ({
    wipeBottom: document.querySelector('.intro-wipe').getBoundingClientRect().bottom,
    progressNumber: document.querySelector('[data-progress-number]').textContent,
  }));
  if (replayEndState.wipeBottom > 2) throw new Error(`Replay intro did not close, ${replayEndState.wipeBottom}`);
  if (replayEndState.progressNumber !== '100') throw new Error(`Replay progress did not finish, ${replayEndState.progressNumber}`);

  const result = await collectLayout(page);
  assertLayout(result, 1440, browserErrors);
  await page.close();
  return {
    ...result,
    firstMotionState,
    secondMotionState,
    manifestoState,
    finaleOpacity,
    burstState,
    replayStartState,
    replayEndState,
  };
}

async function verifyStatic({ viewport, screenshot }) {
  const { page, browserErrors } = await openPage({ viewport, reducedMotion: 'reduce' });
  const result = await collectLayout(page);
  assertLayout(result, viewport.width, browserErrors);
  await page.screenshot({ path: screenshot, fullPage: true });
  await page.close();
  return result;
}

try {
  const motion = await verifyMotion();
  const desktop = await verifyStatic({
    viewport: { width: 1440, height: 1000 },
    screenshot: 'preview.png',
  });
  const mobile = await verifyStatic({
    viewport: { width: 390, height: 844 },
    screenshot: 'preview-mobile.png',
  });
  console.log(JSON.stringify({ motion, desktop, mobile }, null, 2));
} finally {
  await browser.close();
}
