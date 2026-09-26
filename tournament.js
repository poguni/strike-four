// 토너먼트/리그전: 교사가 대회 방을 만들고 라운드를 진행한다.
// 대진 생성·승패 반영·진출 처리는 모두 Supabase 함수(RPC)가 하고, 이 파일은 화면과 호출만 담당한다.

const T_ADMIN_KEY = 'numball_tournament_admin'; // 교사: { sessionId, token }
const T_CURRENT_KEY = 'numball_current_tournament'; // 학생: { sessionId }
const T_MIN_PLAYERS = { league: 3, tournament: 3 };
const T_MINUTES_PER_ROUND = 5;

const T_FORMAT_LABEL = { league: '리그', tournament: '토너먼트' };
const T_FORMAT_DESC = {
  tournament:
    '지면 탈락하는 단판 승부예요. 인원이 안 맞으면 일부는 부전승으로 올라가요. 무승부면 연장전(최대 2번), 그래도 비기면 동전 던지기로 정해요.',
  league:
    '모두가 여러 라운드에서 서로 다른 상대와 대결해요. 승 3점·무 1점·패 0점, 쉬는 라운드는 1점이에요. 동점이면 승수, 그다음 이긴 경기의 평균 시도 횟수가 적은 순이에요.',
};

let tState = null;
let selectedTournamentFormat = 'tournament';
let pendingTournamentResume = null;
let tEnteringRoom = null;

function tReadJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch (error) {
    return null;
  }
}

function tEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function tById(id) {
  return document.getElementById(id);
}

function cleanupTournament() {
  tById('t-board').hidden = true;
  if (tState) {
    if (tState.channel) supabaseClient.removeChannel(tState.channel);
    if (tState.reloadTimer) clearTimeout(tState.reloadTimer);
    tState.timers.forEach((timer) => clearTimeout(timer));
  }
  tState = null;
}

/* ---------- 허브(대회 만들기 / 이어가기) ---------- */

function updateFormatUi() {
  document.querySelectorAll('.t-format-card').forEach((btn) => {
    const on = btn.dataset.format === selectedTournamentFormat;
    btn.classList.toggle('selected', on);
    btn.setAttribute('aria-checked', String(on));
  });
  tById('tournament-format-desc').textContent = T_FORMAT_DESC[selectedTournamentFormat];
  tById('tournament-league-rounds-row').hidden = selectedTournamentFormat !== 'league';
}

async function refreshResumeBox() {
  const box = tById('tournament-resume-box');
  box.hidden = true;
  pendingTournamentResume = null;

  const admin = tReadJson(T_ADMIN_KEY);
  const current = tReadJson(T_CURRENT_KEY);
  const target = admin ? { role: 'teacher', sessionId: admin.sessionId, token: admin.token } :
    current ? { role: 'student', sessionId: current.sessionId } : null;
  if (!target) return;

  const { data, error } = await supabaseClient
    .from('tournaments')
    .select('id, status, format')
    .eq('session_id', target.sessionId)
    .maybeSingle();
  if (error) return; // 네트워크 오류로 관리 토큰/참가 정보를 지우지 않는다
  if (!data || data.status === 'cancelled' || (data.status === 'finished' && target.role === 'student')) {
    localStorage.removeItem(admin ? T_ADMIN_KEY : T_CURRENT_KEY);
    return;
  }
  pendingTournamentResume = { ...target, tournament: data };
  const who = target.role === 'teacher' ? '내가 만든' : '참가 중인';
  const stateText = { recruiting: '참가자를 모으는 중이에요', running: '진행 중이에요', finished: '끝났어요' }[data.status];
  tById('tournament-resume-text').textContent = `${who} ${T_FORMAT_LABEL[data.format]} 대회가 ${stateText}.`;
  const discardBtn = tById('tournament-discard-btn');
  discardBtn.hidden = target.role !== 'teacher';
  discardBtn.textContent = data.status === 'finished' ? '결과 닫고 새로 만들기' : '대회 취소하고 새로 만들기';
  box.hidden = false;
}

function openTournamentHub() {
  showScreen('screen-tournament-hub');
  tById('tournament-hub-status').textContent = '';
  tById('tournament-create-btn').disabled = false;
  updateFormatUi();
  refreshResumeBox();
}

async function discardTeacherTournament() {
  const target = pendingTournamentResume;
  if (!target || target.role !== 'teacher') return;
  const finished = target.tournament.status === 'finished';
  if (!finished && !window.confirm('진행 중인 대회를 취소할까요? 경기 중인 학생 화면도 종료돼요.')) return;
  const button = tById('tournament-discard-btn');
  button.disabled = true;
  try {
    if (!finished) {
      const { error } = await supabaseClient.rpc('cancel_tournament', {
        p_tournament_id: target.tournament.id,
        p_token: target.token,
      });
      if (error) throw error;
    }
    localStorage.removeItem(T_ADMIN_KEY);
    tById('tournament-resume-box').hidden = true;
    pendingTournamentResume = null;
    showToast(finished ? '이전 대회를 닫았어요. 새 대회를 만들 수 있어요.' : '대회를 취소했어요. 새 대회를 만들 수 있어요.');
  } catch (error) {
    console.error(error);
    showToast('대회를 취소하지 못했어요. 잠시 후 다시 시도해주세요.');
  } finally {
    button.disabled = false;
  }
}

async function createTournament() {
  const status = tById('tournament-hub-status');
  const button = tById('tournament-create-btn');
  button.disabled = true;
  status.textContent = '대회 방을 만드는 중...';
  try {
    const teacherId = getTeacherId();
    const leagueRounds = selectedTournamentFormat === 'league' ? Number(tById('tournament-league-rounds').value) || null : null;
    let created = null;
    for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
      const { data, error } = await supabaseClient.rpc('create_tournament', {
        p_teacher_id: teacherId,
        p_code: generateSessionCode(),
        p_format: selectedTournamentFormat,
        p_turn_seconds: Number(tById('tournament-turn-seconds').value),
        p_max_attempts: Number(tById('tournament-max-attempts').value),
        p_digits: Number(tById('tournament-digits').value),
        p_league_rounds: leagueRounds,
      });
      if (!error) {
        created = data && data[0];
      } else if (error.code !== '23505') {
        throw error;
      }
    }
    if (!created) throw new Error('방 코드 생성에 반복적으로 실패했습니다.');

    localStorage.setItem(T_ADMIN_KEY, JSON.stringify({ sessionId: created.session_id, token: created.admin_token }));
    setLastTeacherId(teacherId);
    status.textContent = '';
    await openTournament({ role: 'teacher', sessionId: created.session_id, token: created.admin_token });
  } catch (error) {
    console.error(error);
    status.textContent = '대회 방을 만들지 못했어요. 다시 시도해주세요.';
  } finally {
    button.disabled = false;
  }
}

/* ---------- 대회 화면 열기 / 데이터 로딩 / 실시간 ---------- */

async function openTournament({ role, sessionId, token, silent }) {
  cleanupTournament();
  const state = {
    role,
    sessionId,
    token: token || null,
    tournamentId: null,
    session: null,
    tournament: null,
    players: [],
    matches: [],
    channel: null,
    loadSeq: 0,
    reloadTimer: null,
    timers: new Set(),
    tiebreakScheduled: new Set(),
    qrRendered: false,
    celebrated: false,
    lastStatus: null,
    busy: false,
  };
  tState = state;
  if (!silent) {
    showScreen('screen-tournament');
    tById('tournament-title').textContent = '대회';
    tById('tournament-status').textContent = '불러오는 중...';
  }

  const { data: session, error } = await supabaseClient.from('sessions').select('*').eq('id', sessionId).maybeSingle();
  if (tState !== state) return;
  if (error || !session) {
    console.error(error);
    if (error) {
      // 네트워크 오류: 저장된 참가 정보는 지우지 않는다.
      if (silent) cleanupTournament();
      else tById('tournament-status').textContent = '대회 정보를 불러오지 못했어요. 메인으로 돌아가 다시 시도해주세요.';
      return;
    }
    showToast('대회 정보를 찾을 수 없어요.');
    if (role === 'student') localStorage.removeItem(T_CURRENT_KEY);
    if (silent) cleanupTournament();
    else goHome();
    return;
  }
  state.session = session;
  currentSession = session; // QR 크게 보기 등 기존 기능이 사용
  if (role === 'student') {
    localStorage.setItem(T_CURRENT_KEY, JSON.stringify({ sessionId }));
    setLastTeacherId(session.teacher_id);
  }

  const loaded = await loadTournamentData();
  if (tState !== state) return;
  if (!loaded) {
    if (silent) cleanupTournament();
    else tById('tournament-status').textContent = '대회 정보를 불러오지 못했어요. 메인으로 돌아가 다시 시도해주세요.';
    return;
  }
  if (silent && role === 'student' && ['finished', 'cancelled'].includes(state.tournament.status)) {
    localStorage.removeItem(T_CURRENT_KEY);
    cleanupTournament();
    return;
  }
  subscribeTournament();
}

async function loadTournamentData() {
  const state = tState;
  const seq = ++state.loadSeq;

  const { data: tournament, error } = await supabaseClient
    .from('tournaments')
    .select('*')
    .eq('session_id', state.sessionId)
    .maybeSingle();
  if (error || !tournament) {
    console.error(error);
    showToast('대회 정보를 불러오지 못했어요.');
    return false;
  }

  const playersQuery =
    tournament.status === 'recruiting'
      ? supabaseClient.from('session_players').select('player_id, nickname').eq('session_id', state.sessionId).order('joined_at')
      : supabaseClient.from('tournament_players').select('player_id, nickname, status').eq('tournament_id', tournament.id).order('seed');
  const [playersRes, matchesRes] = await Promise.all([
    playersQuery,
    supabaseClient.from('tournament_matches').select('*').eq('tournament_id', tournament.id).order('round').order('slot'),
  ]);
  if (tState !== state || seq !== state.loadSeq) return false;
  if (playersRes.error || matchesRes.error) {
    console.error(playersRes.error || matchesRes.error);
    return false;
  }

  state.tournamentId = tournament.id;
  state.tournament = tournament;
  state.players = (playersRes.data || []).map((p) => ({ ...p, status: p.status || 'active' }));
  state.matches = matchesRes.data || [];
  renderTournament();
  return true;
}

function scheduleTournamentReload(delay = 150) {
  if (!tState) return;
  if (tState.reloadTimer) clearTimeout(tState.reloadTimer);
  const state = tState;
  state.reloadTimer = setTimeout(() => {
    state.reloadTimer = null;
    if (tState === state) loadTournamentData();
  }, delay);
}

function enterMyTournamentRoom(roomId) {
  const onRoomScreen = !tById('screen-room-game').hidden;
  if (roomState && roomState.roomId === roomId && onRoomScreen) return;
  if (tEnteringRoom === roomId) return; // 같은 방에 짧은 시간 안에 두 번 들어가지 않도록
  tEnteringRoom = roomId;
  setTimeout(() => {
    if (tEnteringRoom === roomId) tEnteringRoom = null;
  }, 3000);
  fetchOpponentAndEnterRoom(tState.sessionId, roomId);
}

function subscribeTournament() {
  const state = tState;
  const id = state.tournamentId;
  const myId = getPlayerId();
  const onChange = () => scheduleTournamentReload();

  state.channel = supabaseClient
    .channel(`tournament-${id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${id}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_matches', filter: `tournament_id=eq.${id}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_players', filter: `tournament_id=eq.${id}` }, onChange)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'session_players', filter: `session_id=eq.${state.sessionId}` },
      (payload) => {
        if (state.role === 'student' && payload.eventType === 'UPDATE') {
          const row = payload.new;
          if (row.player_id === myId && row.state === 'matched' && row.room_id) {
            enterMyTournamentRoom(row.room_id);
          }
        }
        onChange();
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        scheduleTournamentReload(0); // 구독이 연결되기 전에 놓친 변경을 다시 가져온다
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        showToast('연결이 불안정해요. 자동으로 다시 연결을 시도해요.');
      }
    });
}

/* ---------- 계산 도우미 ---------- */

function tNameMap() {
  return new Map(tState.players.map((p) => [p.player_id, p.nickname || '이름 없음']));
}

function computeStandings(players, matches) {
  const rows = new Map(
    players.map((p) => [
      p.player_id,
      { id: p.player_id, name: p.nickname || '이름 없음', removed: p.status === 'removed', w: 0, d: 0, l: 0, pts: 0, attemptSum: 0, attemptWins: 0 },
    ])
  );
  matches
    .filter((m) => m.status === 'done')
    .forEach((m) => {
      if (m.result_type === 'bye') {
        const rest = rows.get(m.winner_id);
        if (rest) rest.pts += 1;
        return;
      }
      const a = rows.get(m.player_a);
      const b = m.player_b ? rows.get(m.player_b) : null;
      if (m.winner_id) {
        const win = rows.get(m.winner_id);
        const lose = m.winner_id === m.player_a ? b : a;
        if (win) {
          win.w += 1;
          win.pts += 3;
          if (m.result_type === 'played' && m.winner_attempts) {
            win.attemptSum += m.winner_attempts;
            win.attemptWins += 1;
          }
        }
        if (lose) lose.l += 1;
      } else {
        [a, b].forEach((r) => {
          if (r) {
            r.d += 1;
            r.pts += 1;
          }
        });
      }
    });
  const avg = (r) => (r.attemptWins ? r.attemptSum / r.attemptWins : Infinity);
  return Array.from(rows.values()).sort(
    (x, y) => y.pts - x.pts || y.w - x.w || avg(x) - avg(y) || x.name.localeCompare(y.name, 'ko')
  );
}

function tRoundName(round, total) {
  const left = total - round;
  if (left === 0) return '결승';
  if (left === 1) return '준결승';
  return `${2 ** (left + 1)}강`;
}

function tEstimate(t, n) {
  if (n < T_MIN_PLAYERS[t.format]) return '';
  let rounds;
  if (t.format === 'league') {
    const max = n % 2 === 1 ? n : n - 1;
    rounds = Math.min(Math.max(t.league_rounds || Math.min(n - 1, 5), 1), max);
  } else {
    rounds = Math.ceil(Math.log2(n));
  }
  return `예상: ${rounds}라운드, 약 ${rounds * T_MINUTES_PER_ROUND}분`;
}

function tMatchStateText(m, names) {
  const winner = names.get(m.winner_id);
  if (m.status === 'done') {
    if (m.result_type === 'bye') {
      if (m.player_b) return `부전승: ${winner || '-'}`;
      return tState.tournament.format === 'league' ? '이번 라운드는 쉬어요 (+1점)' : '부전승으로 진출';
    }
    if (m.result_type === 'draw') return '무승부';
    const suffix = { forfeit: ' (몰수)', admin: ' (교사 처리)', coin: ' (동전 던지기)' }[m.result_type] || '';
    return `승: ${winner || '-'}${suffix}`;
  }
  if (m.status === 'active') return '경기 중';
  if (m.status === 'tiebreak') return `연장전 준비 중 (${m.tiebreak_count}번째 무승부)`;
  return '대기';
}

/* ---------- 화면 그리기 ---------- */

function tPillKind(m) {
  if (m.status === 'active') return 'live';
  if (m.status === 'tiebreak') return 'tie';
  if (m.status === 'done') return 'done';
  return 'wait';
}

function tBuildMatchRow(m, names, withActions) {
  const myId = getPlayerId();
  const mine = m.player_a === myId || m.player_b === myId;
  const li = tEl('li', `t-match is-${m.status}${mine ? ' is-mine' : ''}`);
  const nameA = names.get(m.player_a) || '?';
  const nameB = m.player_b ? names.get(m.player_b) || '?' : null;
  const decided = m.status === 'done' && m.result_type !== 'bye';

  const head = tEl('div', 't-match-head');
  const sides = tEl('div', 't-match-sides');
  sides.appendChild(tEl('span', 't-side' + (decided && m.winner_id === m.player_a ? ' is-winner' : ''), nameA));
  if (nameB) {
    sides.appendChild(tEl('span', 't-vs', 'VS'));
    sides.appendChild(tEl('span', 't-side' + (decided && m.winner_id === m.player_b ? ' is-winner' : ''), nameB));
  } else {
    sides.appendChild(tEl('span', 't-vs', '부전'));
  }
  head.appendChild(sides);
  head.appendChild(tEl('span', `t-pill t-pill--${tPillKind(m)}`, tMatchStateText(m, names)));
  li.appendChild(head);

  if (withActions && m.status !== 'done' && m.player_b) {
    const actions = tEl('div', 't-match-actions');
    const add = (label, action, player) => {
      const btn = tEl('button', 't-mini', label);
      btn.type = 'button';
      btn.addEventListener('click', () => resolveMatch(m, action, player, label));
      actions.appendChild(btn);
    };
    add(`${nameA} 몰수패`, 'forfeit', m.player_a);
    add(`${nameB} 몰수패`, 'forfeit', m.player_b);
    add('동전 던지기', 'coin', null);
    if (tState.tournament.format === 'league') add('무승부 처리', 'draw', null);
    li.appendChild(actions);
  }
  return li;
}

function tRenderStandings(container, standings) {
  const myId = getPlayerId();
  const medals = ['🥇', '🥈', '🥉'];
  const wrap = tEl('div', 't-card t-table-wrap');
  const table = tEl('table', 't-table');
  const head = tEl('tr');
  ['순위', '이름', '승점', '승', '무', '패'].forEach((label) => head.appendChild(tEl('th', '', label)));
  table.appendChild(head);
  standings.forEach((row, index) => {
    const tr = tEl('tr', row.id === myId ? 'is-me' : '');
    tr.appendChild(tEl('td', 'rank', medals[index] || String(index + 1)));
    tr.appendChild(tEl('td', 'name', row.removed ? `${row.name} (제외)` : row.name));
    tr.appendChild(tEl('td', 'pts', String(row.pts)));
    [row.w, row.d, row.l].forEach((value) => tr.appendChild(tEl('td', '', String(value))));
    table.appendChild(tr);
  });
  wrap.appendChild(table);
  container.appendChild(wrap);
}

function tRenderBracket(container, names) {
  const t = tState.tournament;
  const rounds = new Map();
  tState.matches.forEach((m) => {
    if (!rounds.has(m.round)) rounds.set(m.round, []);
    rounds.get(m.round).push(m);
  });
  Array.from(rounds.keys())
    .sort((a, b) => a - b)
    .forEach((round) => {
      const box = tEl('section', 't-round');
      box.appendChild(tEl('h4', 't-round-title', tRoundName(round, t.total_rounds)));
      const list = tEl('ul', 't-matches');
      rounds.get(round).forEach((m) => list.appendChild(tBuildMatchRow(m, names, false)));
      box.appendChild(list);
      container.appendChild(box);
    });
}

function tBuildChampionLines(names, standings) {
  const t = tState.tournament;
  const lines = [];
  if (t.format === 'tournament') {
    if (!t.champion_player_id) return lines;
    lines.push(['🏆 우승', names.get(t.champion_player_id)]);
    const final = tState.matches.find((m) => m.round === t.total_rounds && m.slot === 0);
    if (final && final.winner_id) {
      const runnerUp = final.winner_id === final.player_a ? final.player_b : final.player_a;
      lines.push(['🥈 준우승', names.get(runnerUp)]);
    }
    if (t.total_rounds >= 2) {
      const semiLosers = tState.matches
        .filter((m) => m.round === t.total_rounds - 1 && m.winner_id && m.player_b)
        .map((m) => names.get(m.winner_id === m.player_a ? m.player_b : m.player_a));
      if (semiLosers.length) lines.push(['🥉 공동 3위', semiLosers.join(', ')]);
    }
  } else {
    ['🏆 1위', '🥈 2위', '🥉 3위'].forEach((label, index) => {
      if (standings[index]) lines.push([label, standings[index].name]);
    });
  }
  return lines;
}

function tStudentStatus(t, names, standings) {
  const myId = getPlayerId();
  const me = tState.players.find((p) => p.player_id === myId);
  if (t.status === 'cancelled') return '선생님이 대회를 취소했어요. 메인으로 돌아가 다음 대회를 기다려요.';
  if (t.status === 'recruiting') {
    return `선생님이 대회를 시작하길 기다리고 있어요. 지금까지 ${tState.players.length}명이 참가했어요.`;
  }
  if (!me) return '이 대회의 참가자가 아니에요. 대진표를 구경할 수 있어요.';
  if (me.status === 'removed') return '이번 대회에서는 제외됐어요.';
  if (t.status === 'finished') {
    if (t.format === 'tournament') {
      return t.champion_player_id === myId ? '🏆 우승했어요! 축하해요!' : `대회가 끝났어요. 우승은 ${names.get(t.champion_player_id) || '-'} 친구예요!`;
    }
    const rank = standings.findIndex((r) => r.id === myId) + 1;
    return `대회가 끝났어요. 내 순위는 ${rank}위예요!`;
  }
  const myDone = tState.matches.filter((m) => m.status === 'done' && (m.player_a === myId || m.player_b === myId));
  if (t.format === 'tournament' && myDone.some((m) => m.winner_id && m.winner_id !== myId)) {
    return '아쉽지만 탈락했어요. 친구들을 응원하면서 기다려요!';
  }
  const mine = tState.matches.find((m) => m.round === t.current_round && (m.player_a === myId || m.player_b === myId));
  if (!mine) return '다음 라운드를 기다리고 있어요.';
  if (mine.status === 'active') return '지금 경기 중이에요!';
  if (mine.status === 'tiebreak') return '무승부! 곧 연장전이 시작돼요.';
  if (mine.status === 'pending') return '곧 경기가 시작돼요.';
  if (mine.result_type === 'bye') return '이번 라운드는 쉬어가요. 다음 라운드를 기다려요.';
  if (!mine.winner_id) return '무승부였어요. 다른 친구들의 경기가 끝나길 기다려요.';
  return mine.winner_id === myId
    ? '이겼어요! 다른 친구들의 경기가 끝나면 다음 라운드가 시작돼요.'
    : '졌어요. 다음 라운드를 기다려요.';
}

function tTeacherStatus(t) {
  if (t.status === 'recruiting') {
    const min = T_MIN_PLAYERS[t.format];
    const n = tState.players.length;
    const estimate = tEstimate(t, n);
    return `참가자 ${n}명 (최소 ${min}명)${estimate ? ` · ${estimate}` : ''}`;
  }
  if (t.status === 'finished') return '대회가 끝났어요.';
  if (t.status === 'cancelled') return '대회가 취소됐어요. 새 대회를 만들 수 있어요.';
  const round = tState.matches.filter((m) => m.round === t.current_round);
  const done = round.filter((m) => m.status === 'done').length;
  const allDone = round.length > 0 && done === round.length;
  return `라운드 ${t.current_round} / ${t.total_rounds} · 경기 ${done}/${round.length} 완료` +
    (allDone && t.current_round < t.total_rounds ? ' — 다음 라운드를 시작할 수 있어요.' : '');
}

function tScheduleTiebreaks() {
  const state = tState;
  const myId = getPlayerId();
  state.matches.forEach((m) => {
    if (m.status !== 'tiebreak') return;
    const involvesMe = m.player_a === myId || m.player_b === myId;
    if (state.role === 'student' && !involvesMe) return;
    const key = `${m.id}:${m.tiebreak_count}`;
    if (state.tiebreakScheduled.has(key)) return;
    state.tiebreakScheduled.add(key);
    // 학생은 결과 화면을 볼 시간을 준 뒤, 교사 화면은 (학생이 나갔을 때를 대비해) 조금 더 늦게 시작한다.
    const timer = setTimeout(() => {
      supabaseClient.rpc('start_tiebreak', { p_match_id: m.id }).then(({ error }) => {
        if (error) console.error(error);
      });
    }, state.role === 'student' ? 5000 : 9000);
    state.timers.add(timer);
  });
}

function tFillPodium(box, lines) {
  lines.forEach(([label, name], index) => {
    const [medal, ...rest] = label.split(' ');
    const row = tEl('div', 't-podium-row' + (index === 0 ? ' is-first' : ''));
    row.appendChild(tEl('span', 't-podium-medal', medal));
    row.appendChild(tEl('span', 't-podium-label', rest.join(' ')));
    row.appendChild(tEl('strong', 't-podium-name', name || '-'));
    box.appendChild(row);
  });
}

/* ---------- 칠판용 보기 (교사가 전자칠판에 띄우는 읽기 전용 화면) ---------- */

function openBoardView() {
  if (!tState || tState.role !== 'teacher') return;
  tState.boardOpen = true;
  tState.boardQrKey = null;
  tById('t-board').hidden = false;
  renderTournament();
}

function closeBoardView() {
  if (tState) tState.boardOpen = false;
  tById('t-board').hidden = true;
}

// 진행 중 경기의 추측 내용은 불러오지도 보여주지도 않는다(칠판을 보는 학생에게 힌트가 되지 않도록).
function renderBoardView(names, standings, currentRound) {
  const state = tState;
  const t = state.tournament;
  tById('t-board-icon').textContent = t.format === 'league' ? '📊' : '🏆';
  const title = tById('t-board-title');
  title.textContent = `${T_FORMAT_LABEL[t.format]} 대회`;
  if (state.session && state.session.digits === 3) {
    title.appendChild(tEl('span', 'digits-badge', '3자리'));
  }
  tById('t-board-status').textContent = tTeacherStatus(t);

  // 모집 중: 참가 코드/QR + 참가자
  const recruiting = t.status === 'recruiting';
  tById('t-board-recruit').hidden = !recruiting;
  if (recruiting) {
    tById('t-board-code').textContent = state.session.code;
    tById('t-board-count').textContent = `현재 ${state.players.length}명 참가`;
    if (state.boardQrKey !== state.session.code) {
      state.boardQrKey = state.session.code;
      renderQrCode(tById('t-board-qr'), buildJoinUrl(state.session.code), 260);
    }
  }
  const chips = tById('t-board-chips');
  chips.innerHTML = '';
  if (recruiting) {
    state.players.forEach((p) => chips.appendChild(tEl('li', 't-chip', p.nickname || '이름 없음')));
  }

  // 우승/순위
  const podium = tById('t-board-podium');
  podium.innerHTML = '';
  const finished = t.status === 'finished';
  const lines = finished ? tBuildChampionLines(names, standings) : [];
  podium.hidden = lines.length === 0;
  tFillPodium(podium, lines);
  if (finished && lines.length && !state.boardCelebrated) {
    state.boardCelebrated = true;
    fireConfetti();
  }

  // 본문: 리그는 이번 라운드 + 순위표, 토너먼트는 대진표
  const main = tById('t-board-main');
  main.innerHTML = '';
  if (t.status !== 'running' && !finished) return;
  if (t.format === 'league') {
    if (t.status === 'running') {
      const box = tEl('section');
      box.appendChild(tEl('h3', 't-section-title', `라운드 ${t.current_round} 경기`));
      const list = tEl('ul', 't-matches');
      currentRound.forEach((m) => list.appendChild(tBuildMatchRow(m, names, false)));
      box.appendChild(list);
      main.appendChild(box);
    }
    const table = tEl('section');
    table.appendChild(tEl('h3', 't-section-title', '순위표'));
    tRenderStandings(table, standings);
    main.appendChild(table);
  } else {
    tRenderBracket(main, names);
  }
}

function renderTournament() {
  const state = tState;
  if (!state || !state.tournament) return;
  const t = state.tournament;
  const isTeacher = state.role === 'teacher';
  const names = tNameMap();
  const showBoardData = t.status === 'running' || t.status === 'finished' || (t.status === 'cancelled' && state.matches.length > 0);
  tById('tournament-icon').textContent = t.format === 'league' ? '📊' : '🏆';
  if (!isTeacher && t.status === 'cancelled') localStorage.removeItem(T_CURRENT_KEY);
  const standings = t.format === 'league' && showBoardData ? computeStandings(state.players, state.matches) : [];

  tById('tournament-title').textContent = `${T_FORMAT_LABEL[t.format]} 대회`;
  if (state.session && state.session.digits === 3) {
    const badge = document.createElement('span');
    badge.className = 'digits-badge';
    badge.textContent = '3자리';
    tById('tournament-title').appendChild(badge);
  }
  tById('tournament-status').textContent = isTeacher ? tTeacherStatus(t) : tStudentStatus(t, names, standings);

  // 교사: 코드/QR (모집 중에만)
  const recruit = tById('tournament-recruit');
  recruit.hidden = !(isTeacher && t.status === 'recruiting');
  if (!recruit.hidden && !state.qrRendered) {
    state.qrRendered = true;
    tById('tournament-code').textContent = state.session.code;
    const joinUrl = buildJoinUrl(state.session.code);
    renderQrCode(tById('tournament-qr'), joinUrl, 160);
    const link = tById('tournament-link');
    link.href = joinUrl;
    link.textContent = joinUrl;
  }

  // 교사 버튼
  const isOver = t.status === 'finished' || t.status === 'cancelled';
  tById('tournament-teacher-actions').hidden = !isTeacher || isOver;
  tById('tournament-new-actions').hidden = !isTeacher || !isOver;
  tById('tournament-cancel-btn').hidden = isOver;
  const startBtn = tById('tournament-start-btn');
  const nextBtn = tById('tournament-next-btn');
  const finishBtn = tById('tournament-finish-btn');
  startBtn.hidden = t.status !== 'recruiting';
  startBtn.disabled = state.players.length < T_MIN_PLAYERS[t.format] || state.busy;
  startBtn.textContent =
    state.players.length < T_MIN_PLAYERS[t.format]
      ? `참가 마감 및 대회 시작 (${T_MIN_PLAYERS[t.format] - state.players.length}명 더 필요)`
      : '참가 마감 및 대회 시작';
  const currentRound = state.matches.filter((m) => m.round === t.current_round);
  const roundDone = currentRound.length > 0 && currentRound.every((m) => m.status === 'done');
  nextBtn.hidden = t.status !== 'running';
  nextBtn.disabled = !(roundDone && t.current_round < t.total_rounds) || state.busy;
  finishBtn.hidden = t.status !== 'running';

  // 학생 버튼
  const myId = getPlayerId();
  const myActive = state.matches.find(
    (m) => m.status === 'active' && m.room_id && (m.player_a === myId || m.player_b === myId)
  );
  tById('tournament-student-actions').hidden = isTeacher || t.status === 'recruiting' || t.status === 'cancelled';
  tById('tournament-goto-room-btn').hidden = !myActive;
  tById('tournament-practice-btn').hidden = Boolean(myActive) || isOver;

  // 우승/순위 안내
  const championBox = tById('tournament-champion');
  championBox.innerHTML = '';
  if (t.status === 'finished') {
    const lines = tBuildChampionLines(names, standings);
    championBox.hidden = lines.length === 0;
    tFillPodium(championBox, lines);
    const iAmFirst = t.format === 'tournament' ? t.champion_player_id === myId : standings[0] && standings[0].id === myId;
    if (!isTeacher && iAmFirst && !state.celebrated) {
      state.celebrated = true;
      fireConfetti();
    }
  } else {
    championBox.hidden = true;
  }

  // 이번 라운드 경기 (진행 중일 때)
  const matchesTitle = tById('tournament-matches-title');
  const matchesList = tById('tournament-matches');
  matchesList.innerHTML = '';
  matchesTitle.hidden = t.status !== 'running';
  if (t.status === 'running') {
    matchesTitle.textContent = `이번 라운드 경기 (${T_FORMAT_LABEL[t.format] === '토너먼트' ? tRoundName(t.current_round, t.total_rounds) : `라운드 ${t.current_round}`})`;
    currentRound.forEach((m) => matchesList.appendChild(tBuildMatchRow(m, names, isTeacher)));
  }

  // 순위표 / 대진표
  const boardTitle = tById('tournament-board-title');
  const board = tById('tournament-board');
  board.innerHTML = '';
  boardTitle.hidden = !showBoardData;
  if (showBoardData) {
    boardTitle.textContent = t.format === 'league' ? '순위표' : '대진표';
    if (t.format === 'league') tRenderStandings(board, standings);
    else tRenderBracket(board, names);
  }

  // 참가자 목록
  const list = tById('tournament-players');
  list.innerHTML = '';
  const activeCount = state.players.filter((p) => p.status !== 'removed').length;
  tById('tournament-players-summary').textContent = `참가자 ${activeCount}명`;
  state.players.forEach((p) => {
    const li = tEl('li', 't-chip' + (p.status === 'removed' ? ' is-removed' : ''));
    li.appendChild(tEl('span', '', p.nickname || '이름 없음'));
    if (isTeacher && p.status !== 'removed' && !isOver) {
      const btn = tEl('button', 't-chip-x', '✕');
      btn.type = 'button';
      btn.setAttribute('aria-label', `${p.nickname || '참가자'} 제외`);
      btn.addEventListener('click', () => removePlayer(p));
      li.appendChild(btn);
    }
    list.appendChild(li);
  });
  if (state.lastStatus !== t.status) {
    tById('tournament-players-box').open = t.status === 'recruiting';
    state.lastStatus = t.status;
  }

  tById('tournament-board-actions').hidden = !isTeacher || t.status === 'cancelled';
  if (state.boardOpen) renderBoardView(names, standings, currentRound);

  tScheduleTiebreaks();
}

/* ---------- 교사 조작 ---------- */

async function callTournamentAdmin(fn, extra = {}) {
  if (!tState || tState.busy) return false;
  const state = tState;
  state.busy = true;
  renderTournament();
  try {
    const { error } = await supabaseClient.rpc(fn, {
      p_tournament_id: state.tournamentId,
      p_token: state.token,
      ...extra,
    });
    if (error) throw error;
    return true;
  } catch (error) {
    console.error(error);
    showToast('처리하지 못했어요. 상태를 확인하고 다시 시도해주세요.');
    return false;
  } finally {
    state.busy = false;
    if (tState === state) await loadTournamentData();
  }
}

async function resolveMatch(match, action, player, label) {
  if (!window.confirm(`"${label}"로 이 경기를 마무리할까요?`)) return;
  await callTournamentAdmin('resolve_match', { p_match_id: match.id, p_action: action, p_player: player });
}

async function removePlayer(player) {
  if (!window.confirm(`${player.nickname || '이 참가자'}를(을) 대회에서 제외할까요?`)) return;
  await callTournamentAdmin('remove_tournament_player', { p_player: player.player_id });
}

function returnToTournament() {
  const current = tReadJson(T_CURRENT_KEY);
  if (!current) {
    goHome();
    return;
  }
  openTournament({ role: 'student', sessionId: current.sessionId });
}

// 새로고침 뒤 경기 결과 화면에서도 다음 라운드 자동 입장이 동작하도록 조용히 구독만 복구한다.
function ensureTournamentSubscription() {
  if (tState) return;
  const current = tReadJson(T_CURRENT_KEY);
  if (current) openTournament({ role: 'student', sessionId: current.sessionId, silent: true });
}

async function resumeStudentTournamentOnLoad() {
  if (joiningByCode) return; // 코드로 들어온 경우 참가 흐름이 처리
  const current = tReadJson(T_CURRENT_KEY);
  if (!current) return;
  // 진행 중이던 경기가 있으면 경기 화면이 우선이므로 조용히 구독만 한다. (await 전에 확인)
  const hasSavedRoom = Boolean(getSavedRoom());
  const { data, error } = await supabaseClient.from('tournaments').select('status').eq('session_id', current.sessionId).maybeSingle();
  if (error) return;
  if (!data || ['finished', 'cancelled'].includes(data.status)) {
    localStorage.removeItem(T_CURRENT_KEY);
    return;
  }
  openTournament({ role: 'student', sessionId: current.sessionId, silent: hasSavedRoom });
}

function initTournament() {
  tById('btn-tournament').addEventListener('click', openTournamentHub);
  tById('tournament-hub-back-btn').addEventListener('click', goHome);
  tById('tournament-back-btn').addEventListener('click', goHome);
  tById('tournament-board-btn').addEventListener('click', openBoardView);
  tById('t-board-close').addEventListener('click', closeBoardView);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !tById('t-board').hidden) closeBoardView();
  });

  document.querySelectorAll('.t-format-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedTournamentFormat = btn.dataset.format;
      updateFormatUi();
    });
  });
  tById('tournament-create-btn').addEventListener('click', createTournament);
  tById('tournament-resume-btn').addEventListener('click', () => {
    if (pendingTournamentResume) openTournament(pendingTournamentResume);
  });

  tById('tournament-qr').addEventListener('click', openQrModal);
  tById('tournament-qr').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openQrModal();
    }
  });

  tById('tournament-start-btn').addEventListener('click', () => {
    if (window.confirm('참가를 마감하고 대회를 시작할까요? 시작하면 새 참가자는 들어올 수 없어요.')) {
      callTournamentAdmin('start_tournament');
    }
  });
  tById('tournament-next-btn').addEventListener('click', () => callTournamentAdmin('start_next_round'));
  tById('tournament-finish-btn').addEventListener('click', () => {
    if (window.confirm('대회를 지금 끝낼까요? 진행 중인 경기는 그대로 남아요.')) {
      callTournamentAdmin('finish_tournament');
    }
  });

  tById('tournament-cancel-btn').addEventListener('click', () => {
    if (window.confirm('대회를 취소할까요? 진행 중인 경기가 모두 종료되고, 학생들도 대회에서 나가게 돼요.')) {
      callTournamentAdmin('cancel_tournament');
    }
  });
  tById('tournament-new-btn').addEventListener('click', () => {
    localStorage.removeItem(T_ADMIN_KEY);
    cleanupTournament();
    openTournamentHub();
  });
  tById('tournament-discard-btn').addEventListener('click', discardTeacherTournament);

  tById('tournament-goto-room-btn').addEventListener('click', () => {
    const myId = getPlayerId();
    const mine = tState && tState.matches.find((m) => m.status === 'active' && m.room_id && (m.player_a === myId || m.player_b === myId));
    if (mine) enterMyTournamentRoom(mine.room_id);
  });
  tById('tournament-practice-btn').addEventListener('click', () => showScreen('screen-practice-setup'));

  document.addEventListener('identity-ready', resumeStudentTournamentOnLoad);
}

document.addEventListener('DOMContentLoaded', initTournament);
