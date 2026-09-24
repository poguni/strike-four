// Phase 5: 실시간 게임 진행 (턴 동기화 & 판정)
// 판정 로직은 클라이언트가 아니라 Supabase의 submit_guess() 함수 안에서만 실행된다.
// (상대 비밀번호는 room_secrets 테이블에 있고, anon 키로는 절대 조회할 수 없음)

const ROOM_KEY = 'numball_current_room';

let roomState = null;
let turnTimerHandle = null;
let forfeitTimeoutHandle = null;

function saveCurrentRoom(sessionId, roomId, opponentNickname) {
  localStorage.setItem(ROOM_KEY, JSON.stringify({ sessionId, roomId, opponentNickname }));
}

function clearCurrentRoom() {
  localStorage.removeItem(ROOM_KEY);
}

function getSavedRoom() {
  try {
    const raw = localStorage.getItem(ROOM_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function stopTurnTimer() {
  if (turnTimerHandle) {
    clearInterval(turnTimerHandle);
    turnTimerHandle = null;
  }
}

function cancelForfeitCheck() {
  if (forfeitTimeoutHandle) {
    clearTimeout(forfeitTimeoutHandle);
    forfeitTimeoutHandle = null;
  }
}

function cleanupRoomRealtime() {
  stopTurnTimer();
  cancelForfeitCheck();
  if (roomState) {
    if (roomState.channel) {
      supabaseClient.removeChannel(roomState.channel);
      roomState.channel = null;
    }
    if (roomState.presenceChannel) {
      supabaseClient.removeChannel(roomState.presenceChannel);
      roomState.presenceChannel = null;
    }
  }
}

function renderRoomGuessDisplay() {
  const slots = document.querySelectorAll('#room-guess-display .guess-slot');
  slots.forEach((slot, i) => {
    slot.textContent = roomState.currentDigits[i] ?? '';
  });

  const canPlay = roomState.isMyTurn && roomState.status !== 'finished' && !roomState.timedOut;
  document.querySelectorAll('#room-keypad [data-digit]').forEach((btn) => {
    btn.disabled = !canPlay || roomState.currentDigits.includes(btn.dataset.digit);
  });
  document.querySelector('#room-keypad [data-action="clear"]').disabled = !canPlay;
  document.querySelector('#room-keypad [data-action="submit"]').disabled =
    !canPlay || roomState.currentDigits.length !== 4;
}

function updateRoomAttemptStatus() {
  const el = document.getElementById('room-attempt-status');
  if (!el || !roomState || !roomState.maxAttempts) return;
  const current = Math.min(roomState.myAttemptCount + 1, roomState.maxAttempts);
  el.textContent = `${current}번째 시도 중 (총 ${roomState.maxAttempts}회)`;
}

function renderAttemptRow(attempt) {
  const isMine = attempt.player_id === roomState.myId;
  const boardId = isMine ? 'room-my-attack-log' : 'room-opponent-attack-log';
  const log = document.getElementById(boardId);
  const item = document.createElement('li');

  if (attempt.skipped) {
    item.textContent = '⏱️ 시간 초과로 턴을 넘겼어요';
    log.appendChild(item);
    log.scrollTop = log.scrollHeight;
    return;
  }

  if (isMine) {
    roomState.myAttemptCount += 1;
  } else {
    roomState.opponentAttemptCount += 1;
  }
  const attemptNumber = isMine ? roomState.myAttemptCount : roomState.opponentAttemptCount;

  const number = document.createElement('span');
  number.className = 'attack-log-number';
  number.textContent = `#${String(attemptNumber).padStart(2, '0')}`;

  const body = document.createElement('span');
  body.className = 'attack-log-body';
  body.textContent = attempt.guess;

  item.appendChild(number);
  item.appendChild(body);
  item.appendChild(createResultBadges(attempt.strikes, attempt.balls));
  log.appendChild(item);
  log.scrollTop = log.scrollHeight;

  if (isMine) updateRoomAttemptStatus();
}

function startTurnTimer() {
  stopTurnTimer();
  const timerEl = document.getElementById('room-timer');
  if (!roomState.turnDeadline || roomState.status === 'finished') {
    timerEl.textContent = '';
    return;
  }
  const deadline = new Date(roomState.turnDeadline).getTime();
  let lastSkipRequestAt = 0;

  function tick() {
    const remainingMs = deadline - Date.now();
    const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
    timerEl.textContent = `${remainingSec}초`;
    if (remainingMs > 0) return;

    if (roomState.isMyTurn && !roomState.timedOut) {
      // 내 제한 시간이 끝났으면 더 이상 입력하지 못하게 막는다.
      roomState.timedOut = true;
      roomState.currentDigits = [];
      renderRoomGuessDisplay();
    }
    // 시간 초과된 턴을 넘겨 달라고 서버에 요청한다. 상대 턴이면 즉시, 내 턴이면 상대 화면이 처리할 시간을 3초 준 뒤.
    // 서버가 아직 마감 전이라고 판단하면(시계 차이) 무시하므로 3초마다 다시 요청한다.
    const overdueMs = -remainingMs;
    const grace = roomState.isMyTurn ? 3000 : 0;
    if (overdueMs >= grace && Date.now() - lastSkipRequestAt >= 3000) {
      lastSkipRequestAt = Date.now();
      supabaseClient
        .rpc('skip_turn', { p_room_id: roomState.roomId, p_expected_turn_player: roomState.turnPlayerId })
        .then(({ error }) => {
          if (error) console.error(error);
        });
    }
  }

  tick();
  turnTimerHandle = setInterval(tick, 250);
}

function scheduleForfeitCheck() {
  cancelForfeitCheck();
  forfeitTimeoutHandle = setTimeout(() => {
    supabaseClient
      .rpc('forfeit_room', { p_room_id: roomState.roomId, p_remaining_player_id: getPlayerId() })
      .then(({ error }) => {
        if (error) console.error(error);
      });
  }, 25000);
}

function subscribeRoomPresence(roomId) {
  const presenceChannel = supabaseClient.channel(`room-presence-${roomId}`, {
    config: { presence: { key: getPlayerId() } },
  });
  presenceChannel
    .on('presence', { event: 'leave' }, ({ key }) => {
      if (key === roomState.opponentId) {
        document.getElementById('room-opponent-name').textContent =
          `상대: ${roomState.opponentNickname} (연결 끊김, 25초 후 부전승 처리)`;
        scheduleForfeitCheck();
      }
    })
    .on('presence', { event: 'join' }, ({ key }) => {
      if (key === roomState.opponentId) {
        cancelForfeitCheck();
        document.getElementById('room-opponent-name').textContent = `상대: ${roomState.opponentNickname}`;
      }
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await presenceChannel.track({ online_at: new Date().toISOString() });
      }
    });
  roomState.presenceChannel = presenceChannel;
}

function applyRoomState(room) {
  roomState.playerA = room.player_a;
  roomState.playerB = room.player_b;
  roomState.opponentId = room.player_a === roomState.myId ? room.player_b : room.player_a;
  roomState.maxAttempts = room.max_attempts;
  roomState.status = room.status;
  roomState.turnPlayerId = room.turn_player_id;
  roomState.turnDeadline = room.turn_deadline;
  roomState.winnerPlayerId = room.winner_player_id;
  roomState.forfeited = room.forfeited;
  roomState.tournamentMatchId = room.tournament_match_id || null;
  roomState.isMyTurn = room.turn_player_id === roomState.myId;
  roomState.timedOut = false;

  document.getElementById('room-turn-indicator').textContent = roomState.isMyTurn ? '내 차례' : '상대 차례';
  renderRoomGuessDisplay();
  updateRoomAttemptStatus();
  startTurnTimer();

  if (room.status === 'finished') {
    showRoomResult();
  }
}

function subscribeRoom(roomId) {
  const channel = supabaseClient
    .channel(`room-${roomId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'attempts', filter: `room_id=eq.${roomId}` },
      (payload) => renderAttemptRow(payload.new)
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
      (payload) => applyRoomState(payload.new)
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        showToast('연결이 불안정해요. 자동으로 다시 연결을 시도해요.');
      }
    });
  roomState.channel = channel;
  subscribeRoomPresence(roomId);
}

async function loadRoomAndSubscribe(roomId) {
  const { data: room, error } = await supabaseClient.from('rooms').select('*').eq('id', roomId).single();
  if (error || !room) {
    console.error(error);
    showToast('방 정보를 불러오지 못했어요. 메인으로 이동할게요.');
    goHome();
    return;
  }
  applyRoomState(room);

  const { data: attempts } = await supabaseClient
    .from('attempts')
    .select('*')
    .eq('room_id', roomId)
    .order('created_at');
  (attempts || []).forEach(renderAttemptRow);

  subscribeRoom(roomId);
}

function enterRoom(sessionId, roomId, opponentNickname) {
  if (roomState && roomState.roomId === roomId && roomState.status === 'active' && !document.getElementById('screen-room-game').hidden) {
    return; // 이미 이 방에 들어와 있음 (중복 입장 방지)
  }
  cleanupRoomRealtime();
  roomState = {
    sessionId,
    roomId,
    opponentNickname,
    myId: getPlayerId(),
    currentDigits: [],
    isMyTurn: false,
    status: 'active',
    myAttemptCount: 0,
    opponentAttemptCount: 0,
  };
  saveCurrentRoom(sessionId, roomId, opponentNickname);

  document.getElementById('room-my-attack-log').innerHTML = '';
  document.getElementById('room-opponent-attack-log').innerHTML = '';
  document.getElementById('room-opponent-name').textContent = `상대: ${opponentNickname}`;
  showScreen('screen-room-game');
  loadRoomAndSubscribe(roomId);
}

async function submitMyGuess(guess) {
  roomState.currentDigits = [];
  renderRoomGuessDisplay();
  try {
    const { error } = await supabaseClient.rpc('submit_guess', {
      p_room_id: roomState.roomId,
      p_player_id: getPlayerId(),
      p_guess: guess,
    });
    if (error) throw error;
    // 결과 반영은 attempts/rooms에 대한 Realtime 구독으로 양쪽 화면에 동일하게 들어온다.
  } catch (error) {
    console.error(error);
    showToast('입력을 처리하지 못했어요. 다시 시도해주세요.');
  }
}

// 토너먼트 무승부: 연장전 안내 또는 동전 던지기 결과를 결과 화면에 반영한다.
async function annotateTournamentDraw(trophy, title, detail) {
  try {
    const { data: match } = await supabaseClient
      .from('tournament_matches')
      .select('status, result_type, winner_id')
      .eq('id', roomState.tournamentMatchId)
      .maybeSingle();
    if (!match) return;
    if (match.status === 'tiebreak') {
      title.textContent = '무승부! 연장전으로 결판내요';
      detail.textContent = `${detail.textContent} 잠시 후 연장전이 자동으로 시작돼요.`.trim();
    } else if (match.result_type === 'coin') {
      const won = match.winner_id === roomState.myId;
      trophy.textContent = won ? '🏆' : '😅';
      title.textContent = won ? '동전 던지기로 승리! 🎉' : '동전 던지기로 아쉽게 패배';
      if (won) fireConfetti();
    }
  } catch (error) {
    console.error(error);
  }
}

async function showRoomResult() {
  cleanupRoomRealtime();
  clearCurrentRoom();

  const trophy = document.getElementById('room-result-trophy');
  const title = document.getElementById('room-result-title');
  const detail = document.getElementById('room-result-detail');

  const amWinner = roomState.winnerPlayerId === roomState.myId;
  const isDraw = roomState.winnerPlayerId === null;

  trophy.textContent = isDraw ? '🤝' : amWinner ? '🏆' : '😅';

  if (amWinner) {
    title.textContent = roomState.forfeited ? '부전승! 🎉' : '홈런! 승리했어요 🎉';
  } else if (isDraw) {
    title.textContent = '무승부예요';
  } else {
    title.textContent = roomState.forfeited ? '부전패예요' : '아쉬워요, 패배했어요';
  }

  detail.textContent = '결과를 불러오는 중...';
  showScreen('screen-room-result');
  if (amWinner) fireConfetti();

  const inTournament = Boolean(roomState.tournamentMatchId);
  document.getElementById('room-rematch-btn').hidden = inTournament;
  document.getElementById('room-tournament-btn').hidden = !inTournament;
  if (inTournament) ensureTournamentSubscription();

  if (roomState.forfeited) {
    detail.textContent = amWinner
      ? '상대가 나가서 부전승으로 처리됐어요.'
      : '연결이 끊겨 부전패로 처리됐어요.';
    return;
  }

  try {
    const { data, error } = await supabaseClient.rpc('get_room_reveal', { p_room_id: roomState.roomId });
    if (error) throw error;
    const reveal = data && data[0];
    if (!reveal) throw new Error('no reveal data');

    const isA = roomState.myId === reveal.player_a;
    const mySecret = isA ? reveal.player_a_secret : reveal.player_b_secret;
    const myAttempts = isA ? reveal.player_a_attempts : reveal.player_b_attempts;
    const opponentSecret = isA ? reveal.player_b_secret : reveal.player_a_secret;
    const opponentAttempts = isA ? reveal.player_b_attempts : reveal.player_a_attempts;

    if (isDraw) {
      detail.textContent =
        `내 숫자는 ${mySecret}(상대 ${opponentAttempts}번 시도), 상대 숫자는 ${opponentSecret}(나 ${myAttempts}번 시도)였어요.`;
    } else if (amWinner) {
      detail.textContent =
        `${myAttempts}번 만에 상대 숫자(${opponentSecret})를 맞혔어요. 상대는 ${opponentAttempts}번 시도했어요.`;
    } else {
      detail.textContent = `상대가 ${opponentAttempts}번 만에 내 숫자(${mySecret})를 맞혔어요.`;
    }
  } catch (error) {
    console.error(error);
    detail.textContent = amWinner ? '내가 먼저 상대의 숫자를 맞혔어요.' : '상대가 먼저 내 숫자를 맞혔어요.';
  }

  if (inTournament && isDraw) await annotateTournamentDraw(trophy, title, detail);
}

async function tryResumeRoom() {
  const saved = getSavedRoom();
  if (!saved) return;
  const { data: room, error } = await supabaseClient.from('rooms').select('status').eq('id', saved.roomId).maybeSingle();
  if (error || !room || room.status === 'finished') {
    clearCurrentRoom();
    return;
  }
  enterRoom(saved.sessionId, saved.roomId, saved.opponentNickname);
}

function initRoom() {
  document.getElementById('room-keypad').addEventListener('click', (event) => {
    const btn = event.target.closest('.keypad-btn');
    if (!btn || !roomState || !roomState.isMyTurn) return;

    if (btn.dataset.digit !== undefined && btn.dataset.digit !== '') {
      if (roomState.currentDigits.length < 4 && !roomState.currentDigits.includes(btn.dataset.digit)) {
        roomState.currentDigits.push(btn.dataset.digit);
        renderRoomGuessDisplay();
      }
      return;
    }
    if (btn.dataset.action === 'clear') {
      roomState.currentDigits.pop();
      renderRoomGuessDisplay();
      return;
    }
    if (btn.dataset.action === 'submit' && roomState.currentDigits.length === 4) {
      submitMyGuess(roomState.currentDigits.join(''));
    }
  });

  document.getElementById('room-rematch-btn').addEventListener('click', async () => {
    if (!currentSession) {
      goHome();
      return;
    }
    try {
      await supabaseClient.rpc('rejoin_lobby', { p_session_id: currentSession.id, p_player_id: getPlayerId() });
      enterLobby(currentSession);
    } catch (error) {
      console.error(error);
      showToast('재대결에 실패했어요. 메인으로 이동할게요.');
      goHome();
    }
  });

  document.getElementById('room-tournament-btn').addEventListener('click', returnToTournament);
  document.getElementById('room-result-home-btn').addEventListener('click', goHome);

  document.addEventListener('identity-ready', tryResumeRoom);
}

document.addEventListener('DOMContentLoaded', initRoom);
