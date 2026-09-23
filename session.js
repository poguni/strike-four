// Phase 4: Supabase 연동 — 학급 세션 생성 & 랜덤 매칭

const TEACHER_ID_KEY = 'numball_teacher_id';
const SESSION_EXPIRY_MS = 60 * 60 * 1000; // 1시간: 미사용 방 코드 만료

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

let currentSession = null; // { id, code, capacity, teacher_id }
let lobbyChannel = null;
let teacherChannel = null;

function getTeacherId() {
  let id = localStorage.getItem(TEACHER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(TEACHER_ID_KEY, id);
  }
  return id;
}

function generateSessionCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function cleanupRealtime() {
  if (lobbyChannel) {
    supabaseClient.removeChannel(lobbyChannel);
    lobbyChannel = null;
  }
  if (teacherChannel) {
    supabaseClient.removeChannel(teacherChannel);
    teacherChannel = null;
  }
}

async function createSession(capacity, teacherId) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateSessionCode();
    const { data, error } = await supabaseClient
      .from('sessions')
      .insert({ code, capacity, teacher_id: teacherId })
      .select()
      .single();
    if (!error) return data;
    if (error.code !== '23505') throw error; // 코드 중복이 아니면 즉시 실패 처리
  }
  throw new Error('방 코드 생성에 반복적으로 실패했습니다.');
}

async function findSessionByCode(code) {
  const { data, error } = await supabaseClient
    .from('sessions')
    .select('*')
    .eq('code', code)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function joinSession(sessionId, playerId, nickname) {
  const { data, error } = await supabaseClient
    .from('session_players')
    .insert({ session_id: sessionId, player_id: playerId, nickname })
    .select()
    .single();
  if (!error) return data;

  if (error.code === '23505') {
    // 이미 참가했던 세션에 새로고침 등으로 다시 들어온 경우: 기존 행을 그대로 사용
    const { data: existing, error: fetchError } = await supabaseClient
      .from('session_players')
      .select('*')
      .eq('session_id', sessionId)
      .eq('player_id', playerId)
      .single();
    if (fetchError) throw fetchError;
    return existing;
  }
  throw error;
}

async function triggerMatch(sessionId) {
  const { data, error } = await supabaseClient.rpc('match_waiting_players', { p_session_id: sessionId });
  if (error) {
    console.error('매칭 시도 실패', error);
    return null;
  }
  return data && data.length ? data[0] : null;
}

async function updateSessionSetting(field, value) {
  if (!currentSession || currentSession.capacity !== 0) return;
  currentSession[field] = value;
  const { error } = await supabaseClient.from('sessions').update({ [field]: value }).eq('id', currentSession.id);
  if (error) console.error(error);
}

function isMe(matchResult) {
  const myId = getPlayerId();
  return matchResult.player_a === myId || matchResult.player_b === myId;
}

function buildJoinUrl(code) {
  return `${window.location.origin}${window.location.pathname}?code=${code}`;
}

function renderQrCode(container, url, size) {
  container.innerHTML = '';
  // eslint-disable-next-line no-undef
  new QRCode(container, { text: url, width: size, height: size });
}

function renderSessionCodeAndQr(code) {
  document.getElementById('create-session-code').textContent = code;
  const joinUrl = buildJoinUrl(code);

  renderQrCode(document.getElementById('create-session-qr'), joinUrl, 180);

  const linkEl = document.getElementById('create-session-link');
  linkEl.href = joinUrl;
  linkEl.textContent = joinUrl;
}

function openQrModal() {
  if (!currentSession) return;
  const joinUrl = buildJoinUrl(currentSession.code);
  document.getElementById('qr-modal-code').textContent = currentSession.code;
  // 모달 안쪽 여백(overlay+card+qr-box)을 뺀 만큼만 렌더링해 좁은 화면에서 잘리지 않게 한다.
  const size = Math.max(160, Math.min(320, window.innerWidth - 140));
  renderQrCode(document.getElementById('qr-modal-content'), joinUrl, size);
  document.getElementById('qr-modal').hidden = false;
}

function closeQrModal() {
  document.getElementById('qr-modal').hidden = true;
}

async function refreshTeacherCounts(sessionId) {
  const { count: waitingCount } = await supabaseClient
    .from('session_players')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('state', 'waiting');
  const { count: matchedPairs } = await supabaseClient
    .from('rooms')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionId);
  document.getElementById('create-session-counts').textContent =
    `대기 중 ${waitingCount ?? 0}명 · 매칭된 쌍 ${matchedPairs ?? 0}쌍`;
}

function subscribeTeacherWaitCount(sessionId) {
  refreshTeacherCounts(sessionId);
  teacherChannel = supabaseClient
    .channel(`teacher-session-${sessionId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'session_players', filter: `session_id=eq.${sessionId}` }, () => {
      refreshTeacherCounts(sessionId);
      triggerMatch(sessionId);
    })
    .subscribe();
}

async function startCreateClassSession() {
  showScreen('screen-create-session');
  document.getElementById('create-session-title').textContent = '학급 방';
  document.getElementById('create-session-status').textContent = '방을 만드는 중...';
  document.getElementById('create-session-code').textContent = '------';
  document.getElementById('create-session-counts').textContent = '';
  document.getElementById('create-session-settings').hidden = true;
  try {
    const teacherId = getTeacherId();
    const session = await createSession(0, teacherId);
    currentSession = session;
    setLastTeacherId(teacherId);
    renderSessionCodeAndQr(session.code);
    document.getElementById('create-session-status').textContent =
      '학생들이 아래 QR을 스캔하거나 코드를 입력하면 자동으로 짝지어져요.';
    document.getElementById('setting-turn-seconds').value = String(session.turn_seconds);
    document.getElementById('setting-max-attempts').value = String(session.max_attempts);
    document.getElementById('create-session-settings').hidden = false;
    subscribeTeacherWaitCount(session.id);
  } catch (error) {
    console.error(error);
    document.getElementById('create-session-status').textContent = '방 생성에 실패했어요. 다시 시도해주세요.';
  }
}

async function startFriendInvite() {
  try {
    const playerId = getPlayerId();
    const nickname = getNickname();
    const session = await createSession(2, null);
    await joinSession(session.id, playerId, nickname);
    currentSession = session;

    document.getElementById('create-session-title').textContent = '친구 초대';
    document.getElementById('create-session-status').textContent =
      '친구에게 QR이나 코드를 보여주세요. 친구가 들어오면 바로 시작돼요.';
    document.getElementById('create-session-counts').textContent = '';
    document.getElementById('create-session-settings').hidden = true;
    renderSessionCodeAndQr(session.code);
    showScreen('screen-create-session');
    subscribeLobby(session.id);
  } catch (error) {
    console.error(error);
  }
}

function subscribeLobby(sessionId) {
  cleanupRealtime();
  const myId = getPlayerId();

  lobbyChannel = supabaseClient
    .channel(`lobby-${sessionId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'session_players', filter: `session_id=eq.${sessionId}` },
      async () => {
        const result = await triggerMatch(sessionId);
        if (result && isMe(result)) {
          fetchOpponentAndEnterRoom(sessionId, result.room_id);
        }
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'session_players', filter: `player_id=eq.${myId}` },
      (payload) => {
        const row = payload.new;
        if (row.state === 'matched' && row.room_id) {
          fetchOpponentAndEnterRoom(sessionId, row.room_id);
        }
      }
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        showToast('연결이 불안정해요. 자동으로 다시 연결을 시도해요.');
      }
    });
}

async function fetchOpponentAndEnterRoom(sessionId, roomId) {
  const myId = getPlayerId();
  const { data: room, error } = await supabaseClient.from('rooms').select('*').eq('id', roomId).single();
  if (error) {
    console.error(error);
    return;
  }
  const opponentId = room.player_a === myId ? room.player_b : room.player_a;
  const { data: opponentRow } = await supabaseClient
    .from('session_players')
    .select('nickname')
    .eq('session_id', sessionId)
    .eq('player_id', opponentId)
    .maybeSingle();

  cleanupRealtime();
  enterRoom(sessionId, roomId, opponentRow ? opponentRow.nickname : '상대');
}

async function enterLobby(session) {
  currentSession = session;
  showScreen('screen-lobby');
  document.getElementById('lobby-session-code').textContent = session.code;
  document.getElementById('lobby-status').textContent = '상대를 기다리는 중이에요...';
  document.getElementById('invite-friend-btn').hidden = session.capacity === 2;

  subscribeLobby(session.id);
  const result = await triggerMatch(session.id);
  if (result && isMe(result)) {
    fetchOpponentAndEnterRoom(session.id, result.room_id);
  }
}

async function attemptJoinByCode(code) {
  const statusEl = document.getElementById('join-session-status');
  statusEl.textContent = '방을 찾는 중...';
  try {
    const session = await findSessionByCode(code);
    if (!session) {
      statusEl.textContent = '해당 코드의 방을 찾을 수 없어요. 코드를 다시 확인해주세요.';
      return;
    }
    if (Date.now() - new Date(session.created_at).getTime() > SESSION_EXPIRY_MS) {
      statusEl.textContent = '만료된 코드예요. 선생님께 새 코드를 요청해주세요.';
      return;
    }
    const playerId = getPlayerId();
    const nickname = getNickname();
    await joinSession(session.id, playerId, nickname);
    setLastTeacherId(session.teacher_id);
    statusEl.textContent = '';
    enterLobby(session);
  } catch (error) {
    console.error(error);
    statusEl.textContent = '입장에 실패했어요. 다시 시도해주세요.';
  }
}

function goHome() {
  cleanupRealtime();
  cleanupRoomRealtime();
  clearCurrentRoom();
  currentSession = null;
  showScreen('screen-main');
}

function initSession() {
  document.getElementById('btn-create-session').addEventListener('click', startCreateClassSession);
  document.getElementById('btn-join-session').addEventListener('click', () => {
    showScreen('screen-join-session');
    document.getElementById('join-session-status').textContent = '';
  });
  document.getElementById('create-session-back-btn').addEventListener('click', goHome);
  document.getElementById('join-session-back-btn').addEventListener('click', goHome);

  document.getElementById('create-session-qr').addEventListener('click', openQrModal);
  document.getElementById('create-session-qr').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openQrModal();
    }
  });
  document.getElementById('qr-modal-close-btn').addEventListener('click', closeQrModal);
  document.getElementById('qr-modal').addEventListener('click', (event) => {
    if (event.target.id === 'qr-modal') {
      closeQrModal();
    }
  });

  document.getElementById('setting-turn-seconds').addEventListener('change', (event) => {
    updateSessionSetting('turn_seconds', Number(event.target.value));
  });
  document.getElementById('setting-max-attempts').addEventListener('change', (event) => {
    updateSessionSetting('max_attempts', Number(event.target.value));
  });

  document.getElementById('join-session-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const code = document.getElementById('join-session-code-input').value.trim();
    if (code) attemptJoinByCode(code);
  });

  document.getElementById('invite-friend-btn').addEventListener('click', startFriendInvite);

  document.getElementById('lobby-leave-btn').addEventListener('click', async () => {
    if (currentSession) {
      try {
        await supabaseClient.rpc('leave_waiting_player', {
          p_session_id: currentSession.id,
          p_player_id: getPlayerId(),
        });
      } catch (error) {
        console.error(error);
      }
    }
    goHome();
  });

  document.addEventListener('identity-ready', () => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      showScreen('screen-join-session');
      document.getElementById('join-session-code-input').value = code;
      attemptJoinByCode(code);
    }
  });
}

document.addEventListener('DOMContentLoaded', initSession);
