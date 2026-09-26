// Phase 3: 혼자 연습하기(vs AI) 화면 로직

let practiceState = null;
let selectedLevel = 'easy';
let selectedDigits = 4;
const PRACTICE_DIGITS_KEY = 'numball_practice_digits';

function logAttempt(logId, attemptNumber, guess, result) {
  const log = document.getElementById(logId);
  const item = document.createElement('li');

  const number = document.createElement('span');
  number.className = 'attack-log-number';
  number.textContent = `#${String(attemptNumber).padStart(2, '0')}`;

  const body = document.createElement('span');
  body.className = 'attack-log-body';
  body.textContent = guess;

  item.appendChild(number);
  item.appendChild(body);
  item.appendChild(createResultBadges(result.strikes, result.balls));
  log.appendChild(item);
  log.scrollTop = log.scrollHeight;
}

function updatePracticeStatus() {
  const current = Math.min(practiceState.myAttempts + 1, practiceState.maxAttempts);
  document.getElementById('practice-remaining').textContent =
    `${current}번째 시도 중 (총 ${practiceState.maxAttempts}회)`;
}

function renderGuessDisplay() {
  const slots = document.querySelectorAll('#guess-display .guess-slot');
  slots.forEach((slot, i) => {
    slot.textContent = practiceState.currentDigits[i] ?? '';
  });

  document.querySelectorAll('#keypad [data-digit]').forEach((btn) => {
    const disabled = !practiceState.isMyTurn || practiceState.currentDigits.includes(btn.dataset.digit);
    btn.disabled = disabled;
  });
  document.querySelector('#keypad [data-action="clear"]').disabled = !practiceState.isMyTurn;
  document.querySelector('#keypad [data-action="submit"]').disabled =
    !practiceState.isMyTurn || practiceState.currentDigits.length !== practiceState.digits;
}

function setPracticeTurn(who) {
  practiceState.isMyTurn = who === 'me';
  document.getElementById('practice-turn-indicator').textContent =
    who === 'me' ? '내 차례' : '상대(AI) 차례';
  renderGuessDisplay();
}

function endPracticeGame(outcome) {
  const trophy = document.getElementById('practice-result-trophy');
  const title = document.getElementById('practice-result-title');
  const detail = document.getElementById('practice-result-detail');

  if (outcome === 'win') {
    trophy.textContent = '🏆';
    title.textContent = '홈런! 승리했어요 🎉';
    detail.textContent =
      `${practiceState.myAttempts}번 만에 상대 숫자(${practiceState.aiSecret})를 맞혔어요. 상대는 ${practiceState.aiAttempts}번 시도했어요.`;
  } else if (outcome === 'lose') {
    trophy.textContent = '😅';
    title.textContent = '아쉬워요, 상대가 먼저 홈런을 쳤어요';
    detail.textContent =
      `상대가 ${practiceState.aiAttempts}번 만에 내 숫자(${practiceState.mySecret})를 맞혔어요.`;
  } else {
    trophy.textContent = '🤝';
    title.textContent = '무승부예요! 다음엔 더 잘할 수 있어요';
    detail.textContent =
      `내 숫자는 ${practiceState.mySecret}(상대 ${practiceState.aiAttempts}번 시도), 상대 숫자는 ${practiceState.aiSecret}(나 ${practiceState.myAttempts}번 시도)였어요. 다시 도전해봐요!`;
  }

  showScreen('screen-practice-result');
  if (outcome === 'win') fireConfetti();
}

function resolveAiTurn() {
  const guess = practiceState.ai.nextGuess();
  const result = judge(practiceState.mySecret, guess);
  practiceState.ai.registerResult(guess, result);
  practiceState.aiAttempts += 1;
  logAttempt('ai-attack-log', practiceState.aiAttempts, guess, result);

  if (result.strikes === practiceState.digits) {
    endPracticeGame('lose');
    return;
  }
  if (practiceState.myAttempts >= practiceState.maxAttempts) {
    endPracticeGame('fail');
    return;
  }
  setPracticeTurn('me');
}

function resolvePlayerTurn(guess) {
  const result = judge(practiceState.aiSecret, guess);
  practiceState.myAttempts += 1;
  logAttempt('my-attack-log', practiceState.myAttempts, guess, result);
  practiceState.currentDigits = [];
  updatePracticeStatus();

  if (result.strikes === practiceState.digits) {
    endPracticeGame('win');
    return;
  }

  setPracticeTurn('ai');
  setTimeout(resolveAiTurn, 600);
}

function startPracticeGame(level, maxAttempts, digits) {
  practiceState = {
    level,
    maxAttempts,
    digits,
    mySecret: generateSecret(digits),
    aiSecret: generateSecret(digits),
    ai: createAI(level, digits),
    myAttempts: 0,
    aiAttempts: 0,
    currentDigits: [],
    isMyTurn: true,
  };

  document.getElementById('my-attack-log').innerHTML = '';
  document.getElementById('ai-attack-log').innerHTML = '';
  document.getElementById('practice-turn-indicator').textContent = '내 차례';
  updatePracticeStatus();
  renderGuessSlots('guess-display', digits);
  renderGuessDisplay();
  showScreen('screen-practice-game');
}

function initPractice() {
  document.getElementById('btn-practice').addEventListener('click', () => {
    showScreen('screen-practice-setup');
  });

  document.querySelectorAll('.difficulty-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedLevel = btn.dataset.level;
      document.querySelectorAll('.difficulty-btn').forEach((b) => {
        b.classList.toggle('selected', b === btn);
      });
    });
  });
  document.querySelector(`.difficulty-btn[data-level="${selectedLevel}"]`).classList.add('selected');

  try {
    if (localStorage.getItem(PRACTICE_DIGITS_KEY) === '3') selectedDigits = 3;
  } catch (e) { /* 저장소를 못 쓰면 기본값(4자리) */ }
  document.querySelectorAll('.digits-btn').forEach((btn) => {
    btn.classList.toggle('selected', Number(btn.dataset.digits) === selectedDigits);
    btn.addEventListener('click', () => {
      selectedDigits = Number(btn.dataset.digits);
      document.querySelectorAll('.digits-btn').forEach((b) => {
        b.classList.toggle('selected', b === btn);
      });
      try { localStorage.setItem(PRACTICE_DIGITS_KEY, String(selectedDigits)); } catch (e) { /* 무시 */ }
    });
  });

  document.getElementById('start-practice-btn').addEventListener('click', () => {
    const maxAttempts = Number(document.getElementById('attempts-select').value);
    startPracticeGame(selectedLevel, maxAttempts, selectedDigits);
  });

  document.getElementById('practice-setup-back-btn').addEventListener('click', () => {
    showScreen('screen-main');
  });

  document.getElementById('keypad').addEventListener('click', (event) => {
    const btn = event.target.closest('.keypad-btn');
    if (!btn || !practiceState || !practiceState.isMyTurn) {
      return;
    }
    if (btn.dataset.digit !== undefined && btn.dataset.digit !== '') {
      if (practiceState.currentDigits.length < practiceState.digits && !practiceState.currentDigits.includes(btn.dataset.digit)) {
        practiceState.currentDigits.push(btn.dataset.digit);
        renderGuessDisplay();
      }
      return;
    }
    if (btn.dataset.action === 'clear') {
      practiceState.currentDigits.pop();
      renderGuessDisplay();
      return;
    }
    if (btn.dataset.action === 'submit' && practiceState.currentDigits.length === practiceState.digits) {
      resolvePlayerTurn(practiceState.currentDigits.join(''));
    }
  });

  document.getElementById('practice-quit-btn').addEventListener('click', () => {
    showScreen('screen-main');
  });

  document.getElementById('practice-retry-btn').addEventListener('click', () => {
    startPracticeGame(practiceState.level, practiceState.maxAttempts, practiceState.digits);
  });

  document.getElementById('practice-home-btn').addEventListener('click', () => {
    showScreen('screen-main');
  });
}

document.addEventListener('DOMContentLoaded', initPractice);
