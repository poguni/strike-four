// Phase 6: 리더보드 / 랭킹 (학급 단위)

const LAST_TEACHER_KEY = 'numball_last_teacher_id';
const RANKING_MIN_GAMES = 3;
const RANKING_LIMIT = 20;

function setLastTeacherId(teacherId) {
  if (teacherId) localStorage.setItem(LAST_TEACHER_KEY, teacherId);
}

function getLastTeacherId() {
  return localStorage.getItem(LAST_TEACHER_KEY);
}

function aggregateResults(rows) {
  const byPlayer = new Map();

  rows.forEach((row) => {
    let entry = byPlayer.get(row.player_id);
    if (!entry) {
      entry = { playerId: row.player_id, nickname: row.nickname, wins: 0, losses: 0, draws: 0, bestAttempts: null };
      byPlayer.set(row.player_id, entry);
    }
    entry.nickname = row.nickname; // rows는 오래된 순으로 정렬되어 있어 마지막에 남는 값이 최신 닉네임

    if (row.result === 'win') {
      entry.wins += 1;
      if (entry.bestAttempts === null || row.attempts_used < entry.bestAttempts) {
        entry.bestAttempts = row.attempts_used;
      }
    } else if (row.result === 'loss') {
      entry.losses += 1;
    } else {
      entry.draws += 1;
    }
  });

  return Array.from(byPlayer.values())
    .map((entry) => {
      const total = entry.wins + entry.losses + entry.draws;
      return { ...entry, total, winRate: total ? entry.wins / total : 0 };
    })
    .filter((entry) => entry.total >= RANKING_MIN_GAMES)
    .sort((a, b) => b.winRate - a.winRate || b.wins - a.wins)
    .slice(0, RANKING_LIMIT);
}

async function fetchLeaderboard(teacherId) {
  const { data, error } = await supabaseClient
    .from('match_results')
    .select('player_id, nickname, result, attempts_used')
    .eq('teacher_id', teacherId)
    .not('nickname', 'is', null)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return aggregateResults(data || []);
}

function createRankingRow(entry, index, myId) {
  const li = document.createElement('li');
  li.className = 'ranking-row' + (entry.playerId === myId ? ' is-me' : '');

  const rank = document.createElement('span');
  rank.className = 'ranking-rank';
  rank.textContent = String(index + 1);

  const name = document.createElement('span');
  name.className = 'ranking-name';
  name.textContent = entry.nickname;

  const stats = document.createElement('span');
  stats.className = 'ranking-stats';

  const record = document.createElement('span');
  record.className = 'ranking-record';
  record.textContent = `${entry.wins}승 ${entry.losses}패${entry.draws ? ` ${entry.draws}무` : ''}`;

  const rate = document.createElement('span');
  rate.className = 'ranking-rate';
  rate.textContent = `${Math.round(entry.winRate * 100)}%`;

  stats.appendChild(record);
  stats.appendChild(rate);

  if (entry.bestAttempts !== null) {
    const best = document.createElement('span');
    best.className = 'ranking-best';
    best.textContent = `최소 ${entry.bestAttempts}회 홈런`;
    stats.appendChild(best);
  }

  li.appendChild(rank);
  li.appendChild(name);
  li.appendChild(stats);
  return li;
}

function renderRanking(rankings) {
  const list = document.getElementById('ranking-list');
  const status = document.getElementById('ranking-status');
  list.innerHTML = '';

  if (rankings.length === 0) {
    status.textContent = `아직 ${RANKING_MIN_GAMES}판 이상 대전한 학생이 없어요.`;
    return;
  }
  status.textContent = '';

  const myId = getPlayerId();
  rankings.forEach((entry, index) => {
    list.appendChild(createRankingRow(entry, index, myId));
  });
}

async function openRanking() {
  showScreen('screen-ranking');
  const status = document.getElementById('ranking-status');
  document.getElementById('ranking-list').innerHTML = '';

  const teacherId = getLastTeacherId();
  if (!teacherId) {
    status.textContent = '아직 참여한 학급 방이 없어요. 방에 참가하면 랭킹이 생겨요.';
    return;
  }

  status.textContent = '불러오는 중...';
  try {
    const rankings = await fetchLeaderboard(teacherId);
    renderRanking(rankings);
  } catch (error) {
    console.error(error);
    status.textContent = '랭킹을 불러오지 못했어요. 다시 시도해주세요.';
  }
}

function initLeaderboard() {
  document.getElementById('btn-leaderboard').addEventListener('click', openRanking);
  document.getElementById('ranking-back-btn').addEventListener('click', goHome);
}

document.addEventListener('DOMContentLoaded', initLeaderboard);
