// Phase 3: 숫자야구 판정 로직 + 난이도별 AI (DOM에 의존하지 않는 순수 로직)

function generateSecret(count = 4) {
  const digits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = digits.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [digits[i], digits[j]] = [digits[j], digits[i]];
  }
  return digits.slice(0, count).join('');
}

function judge(secret, guess) {
  let strikes = 0;
  let balls = 0;
  for (let i = 0; i < secret.length; i += 1) {
    if (guess[i] === secret[i]) {
      strikes += 1;
    } else if (secret.includes(guess[i])) {
      balls += 1;
    }
  }
  return { strikes, balls, outs: secret.length - strikes - balls };
}

function isValidGuess(guess, count = 4) {
  return guess.length === count && /^\d+$/.test(guess) && new Set(guess).size === count;
}

// 입력 칸(.guess-slot)을 자릿수만큼 만든다. 이미 같은 개수면 그대로 둔다.
function renderGuessSlots(containerId, count) {
  const container = document.getElementById(containerId);
  if (!container || container.children.length === count) return;
  container.innerHTML = '';
  for (let i = 0; i < count; i += 1) {
    const slot = document.createElement('span');
    slot.className = 'guess-slot';
    container.appendChild(slot);
  }
}

function generateAllCandidates(count = 4) {
  const candidates = [];
  const build = (prefix) => {
    if (prefix.length === count) {
      candidates.push(prefix);
      return;
    }
    for (let d = 0; d <= 9; d += 1) {
      if (!prefix.includes(String(d))) build(prefix + d);
    }
  };
  build('');
  return candidates;
}

function filterCandidates(candidates, guess, result) {
  return candidates.filter((candidate) => {
    const r = judge(candidate, guess);
    return r.strikes === result.strikes && r.balls === result.balls;
  });
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function shuffledCopy(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// 후보군 안에서, 가능한 모든 결과(S/B 조합)로 나눴을 때 "최악의 경우 남는 후보 수"가
// 가장 적은 수를 고른다 (제약 전파 기반 미니맥스). 후보가 많을 때 모든 후보를 다음 수
// 후보로 검토하면 크롬북 같은 저사양 기기에서 수백 ms~수 초까지 걸릴 수 있어, 검토할
// 후보 자체는 최대 GUESS_SAMPLE_CAP개로 샘플링한다(정답 후보 좁히기 정확도는 그대로 유지).
const GUESS_SAMPLE_CAP = 150;

function pickMinimaxGuess(candidates) {
  const guessPool = candidates.length > GUESS_SAMPLE_CAP
    ? shuffledCopy(candidates).slice(0, GUESS_SAMPLE_CAP)
    : candidates;

  let bestGuess = guessPool[0];
  let bestWorstCase = Infinity;
  guessPool.forEach((guess) => {
    const buckets = new Map();
    candidates.forEach((candidate) => {
      const r = judge(candidate, guess);
      const key = `${r.strikes}-${r.balls}`;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    });
    const worstCase = Math.max(...buckets.values());
    if (worstCase < bestWorstCase) {
      bestWorstCase = worstCase;
      bestGuess = guess;
    }
  });
  return bestGuess;
}

// level: 'easy' | 'normal' | 'hard'
function createAI(level, count = 4) {
  const allCandidates = generateAllCandidates(count);
  let candidates = allCandidates;
  let firstMove = true;

  function nextGuess() {
    if (level === 'easy') {
      return pickRandom(allCandidates);
    }
    if (firstMove) {
      // 첫 수는 힌트가 없어 후보가 5040개 그대로라 미니맥스 계산이 무겁다.
      // normal/hard 모두 첫 수는 후보 중 랜덤으로 시작하고, 이후부터 난이도가 갈린다.
      firstMove = false;
      return pickRandom(candidates);
    }
    if (level === 'normal') {
      return pickRandom(candidates);
    }
    return pickMinimaxGuess(candidates);
  }

  function registerResult(guess, result) {
    candidates = filterCandidates(candidates, guess, result);
  }

  return { nextGuess, registerResult };
}
