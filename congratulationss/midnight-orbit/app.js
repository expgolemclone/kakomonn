function parseMilestone(search) {
  const value = new URLSearchParams(search).get('milestone');
  if (value === null) {
    return null;
  }
  if (!/^\d{1,4}$/.test(value)) {
    throw new Error('milestone must be an integer between 0 and 9999');
  }
  return value;
}

const milestone = parseMilestone(window.location.search);
const milestoneValue = document.querySelector('#milestone-value');
const paradeButton = document.querySelector('#parade-button');
const statusMessage = document.querySelector('#status-message');
const confettiLayer = document.querySelector('#confetti-layer');
const stage = document.querySelector('.stage');

if (milestone !== null) {
  milestoneValue.textContent = milestone;
}

const colors = ['#d58a5f', '#b6f0e6', '#6d3bc0', '#f4e8d7'];
let isRunning = false;

function createConfetti(index) {
  const piece = document.createElement('span');
  const left = ((index * 47) % 97) + Math.random() * 3;
  const duration = 1600 + ((index * 83) % 1400);
  const drift = -90 + ((index * 31) % 180);
  const angle = (index * 29) % 180;

  piece.className = 'confetti';
  piece.style.left = `${left}%`;
  piece.style.background = colors[index % colors.length];
  piece.style.setProperty('--duration', `${duration}ms`);
  piece.style.setProperty('--drift', `${drift}px`);
  piece.style.setProperty('--angle', `${angle}deg`);
  piece.addEventListener('animationend', () => piece.remove(), { once: true });
  return piece;
}

function launchParade() {
  if (isRunning) {
    return;
  }

  isRunning = true;
  statusMessage.textContent = `軌道 ${milestoneValue.textContent} から祝賀信号を送信しました.`;
  stage.classList.add('is-celebrating');

  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 72; index += 1) {
    fragment.append(createConfetti(index));
  }
  confettiLayer.append(fragment);

  window.setTimeout(() => {
    stage.classList.remove('is-celebrating');
    isRunning = false;
  }, 900);
}

paradeButton.addEventListener('click', launchParade);
