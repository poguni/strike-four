const THEME_KEY = 'numball_theme';
const NICKNAME_KEY = 'numball_nickname';
const PLAYER_ID_KEY = 'numball_player_id';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
}

function getPlayerId() {
  let id = localStorage.getItem(PLAYER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(PLAYER_ID_KEY, id);
  }
  return id;
}

function getNickname() {
  return localStorage.getItem(NICKNAME_KEY);
}

function setNickname(name) {
  localStorage.setItem(NICKNAME_KEY, name);
}

function renderProfile() {
  const nickname = getNickname();
  document.getElementById('profile-name').textContent = nickname || '플레이어';
  document.getElementById('profile-avatar').textContent = nickname ? nickname.charAt(0) : '나';
}

function openNicknameModal(prefill) {
  const modal = document.getElementById('nickname-modal');
  const input = document.getElementById('nickname-input');
  input.value = prefill || '';
  modal.hidden = false;
  input.focus();
}

function closeNicknameModal() {
  document.getElementById('nickname-modal').hidden = true;
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((el) => {
    el.hidden = el.id !== id;
  });
}

function createResultBadges(strikes, balls) {
  const wrap = document.createElement('span');
  wrap.className = 'result-badges';

  const strikeBadge = document.createElement('span');
  strikeBadge.className = 'badge badge-strike';
  strikeBadge.textContent = `${strikes}S`;

  const ballBadge = document.createElement('span');
  ballBadge.className = 'badge badge-ball';
  ballBadge.textContent = `${balls}B`;

  wrap.appendChild(strikeBadge);
  wrap.appendChild(ballBadge);
  return wrap;
}

function fireConfetti() {
  if (typeof confetti !== 'function') return;
  confetti({ particleCount: 120, spread: 90, origin: { y: 0.6 } });
  setTimeout(() => confetti({ particleCount: 60, spread: 120, origin: { y: 0.5 } }), 250);
}

let toastHideTimer = null;
function showToast(message) {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

window.addEventListener('offline', () => {
  showToast('인터넷 연결이 끊겼어요. 연결 상태를 확인해주세요.');
});
window.addEventListener('online', () => {
  showToast('인터넷에 다시 연결됐어요.');
});

document.addEventListener('DOMContentLoaded', () => {
  // 테마 초기화
  const themeSelect = document.getElementById('theme-select');
  const savedTheme = localStorage.getItem(THEME_KEY) || 'pastel';
  themeSelect.value = savedTheme;
  themeSelect.addEventListener('change', (event) => {
    applyTheme(event.target.value);
  });

  // 로컬 사용자 식별
  getPlayerId();
  renderProfile();

  document.getElementById('nickname-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.getElementById('nickname-input');
    const value = input.value.trim();
    if (!value) {
      input.focus();
      return;
    }
    setNickname(value);
    renderProfile();
    closeNicknameModal();
    document.dispatchEvent(new CustomEvent('identity-ready'));
  });

  document.getElementById('edit-nickname-btn').addEventListener('click', () => {
    openNicknameModal(getNickname());
  });

  if (!getNickname()) {
    openNicknameModal();
  } else {
    document.dispatchEvent(new CustomEvent('identity-ready'));
  }
});
