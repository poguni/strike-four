# 홈런 숫자야구 (Strike Four)

로그인 없이 이름/닉네임만으로 즐기는 숫자야구 웹 게임. 혼자 AI와 연습하거나, 교사가 배포한 QR로 학급 친구들과 랜덤 매칭되어 대전할 수 있다.

기획/설계 문서는 [`docs/`](./docs) 폴더 참고:
- [숫자야구 게임 앱 PRD.md](./docs/숫자야구%20게임%20앱%20PRD.md) — 기능 정의, 게임 규칙, 기술 스택
- [DESIGN.md](./docs/DESIGN.md) — 테마(파스텔톤/모던 클린) 디자인 가이드
- [IMPLEMENTATION_PROMPTS.md](./docs/IMPLEMENTATION_PROMPTS.md) — Phase별 구현 순서

## 로컬 실행

빌드 도구 없이 정적 파일만으로 동작한다. 아래 둘 중 하나로 실행:

- `index.html`을 브라우저로 바로 열기
- 또는 로컬 서버로 실행(권장, 추후 fetch/Realtime 연동 시 필요):
  ```
  npx serve .
  ```

## 배포 (GitHub Pages)

- 배포 URL: https://poguni.github.io/strike-four/
- 사이트 소스는 저장소 **루트**의 `index.html`이다. GitHub Pages 설정 시 소스를 `main` 브랜치의 `/ (root)`로 지정한다 (`docs/` 폴더는 기획 문서 전용이라 Pages 소스로 사용하지 않음).
- 설정 경로: 저장소 Settings → Pages → Source에서 브랜치 `main`, 폴더 `/ (root)` 선택

## 폴더 구조

```
index.html          # 진입점, 화면(section.screen)들을 모두 포함하고 JS로 전환
styles.css          # 전역 스타일 + 테마 시스템(Phase 1) + 연습 화면(Phase 3) + 세션 화면(Phase 4)
app.js              # 메인 화면: 테마, 닉네임/사용자 식별, 화면 전환(showScreen)
game.js             # 숫자야구 판정 로직 + 난이도별 AI (DOM 비의존, 순수 함수)
practice.js         # 혼자 연습하기 화면 로직 (난이도 선택 → 대전 → 결과)
supabase-config.js  # Supabase 프로젝트 URL/공개 anon 키 (공개 키라 커밋됨, 아래 "Supabase 연동" 참고)
session.js          # 학급 세션 생성/참가, 대기열, 랜덤 매칭 (Phase 4)
room.js             # 1:1 실시간 대전: 턴 동기화, 타이머, 재접속/부전승, 재대결 (Phase 5)
leaderboard.js      # 학급(교사) 단위 리더보드 집계/표시 (Phase 6)
tournament.js       # 토너먼트/리그전: 대회 만들기, 교사 대시보드, 학생 대기 화면, 대진표/순위표
docs/               # PRD, 디자인 가이드, Phase별 구현 프롬프트
design-reference/   # 최종 디자인 시안 HTML 목업(모바일/PC × 파스텔/모던)
```

## Supabase 연동

- 프로젝트: `Strike Four` (Supabase, ap-northeast-2)
- `supabase-config.js`에 프로젝트 URL과 **publishable(anon) 키**가 들어있다. 이 키는 공개적으로 노출되도록 설계된 키이고(RLS로 접근 범위를 통제), 빌드 과정이 없는 GitHub Pages 배포 특성상 어차피 배포된 JS에 그대로 포함되므로 `.gitignore` 처리하지 않고 커밋했다.
- 실제 데이터 보안은 Supabase의 Row Level Security(RLS)와, 매칭·판정처럼 원자성/정합성이 중요한 쓰기 작업을 처리하는 `SECURITY DEFINER` 함수들이 담당한다. 테이블에 대한 직접 UPDATE/DELETE는 anon 키로 거의 허용되지 않는다.
  - `match_waiting_players` / `leave_waiting_player` / `rejoin_lobby`: 세션 대기열·매칭 (Phase 4)
  - `submit_guess` / `skip_turn` / `forfeit_room`: 1:1 대전 진행(`finish_room`은 이 함수들 안에서만 호출되며 anon 키로 직접 실행할 수 없다). 제한 시간이 지나면 `submit_guess`가 입력을 거부하고 `skip_turn`이 턴을 상대에게 넘긴다(상대 화면이 요청하고, 내 화면도 3초 뒤 스스로 요청). 한 선수가 연속 3번 시간 초과하면 자동 몰수패 처리되고, 상대가 최근 20초 안에 움직였다면 `forfeit_room`은 부전승을 인정하지 않는다. 상대의 비밀번호(`room_secrets` 테이블)는 RLS 정책이 아예 없어 anon 키로는 절대 조회할 수 없고, 오직 `submit_guess` 함수 내부에서만 판정에 사용된다 (Phase 5)
  - `match_results`: `finish_room()`이 대전 종료 시마다 teacher_id·닉네임과 함께 기록하는 결과 테이블. SELECT는 누구나 가능(집계용)하지만 INSERT 정책은 없어 `finish_room()` 내부에서만 기록되고, 조작된 승리 기록을 직접 끼워 넣을 수 없다 (Phase 6)
  - `get_room_reveal`: 대전이 끝난(`status = 'finished'`) 방에 한해서만 양쪽의 정답과 시도 횟수를 반환한다. 끝나지 않은 방에 대해 호출하면 예외를 던져, 진행 중인 대전에서는 절대 상대 정답을 알아낼 수 없다
  - `sessions.turn_seconds` / `sessions.max_attempts`: 교사가 학급 방 화면에서 조정하는 턴 시간(20/30/40/50초)·시도 횟수(10~20회). `sessions` 테이블은 이 두 컬럼에 한해서만(컬럼 단위 GRANT) anon 키의 UPDATE를 허용하고, `capacity = 0`(학급 방)인 경우만 RLS로 허용한다 — 코드, teacher_id 등 다른 컬럼은 여전히 수정 불가

## 토너먼트/리그전

- 대회는 기존 학급 방(`sessions.mode = 'league' | 'tournament'`)에 얹은 구조다. 교사는 메인의 '토너먼트/리그전'에서 대회 방을 만들고, 학생은 기존 '방 참가하기'(QR/코드)로 들어온다. 대회 방은 자동 매칭을 하지 않고(`match_waiting_players`가 즉시 반환), 교사가 라운드를 시작할 때 서버가 대진표대로 방을 한꺼번에 만든다.
- 테이블: `tournaments`, `tournament_players`, `tournament_matches`(익명 SELECT만 허용, 쓰기는 RPC 전용), `tournament_admin`(RLS만 켜고 정책 없음 → 익명 조회 불가. 교사 브라우저에만 주는 관리 토큰 저장).
- RPC: `create_tournament`, `start_tournament`, `start_next_round`, `resolve_match`(몰수패/동전 던지기/무승부 처리), `remove_tournament_player`, `finish_tournament`, `cancel_tournament`(진행 중인 경기 방을 전적 기록 없이 닫고 대회를 `cancelled`로 바꿈)는 관리 토큰이 있어야 실행되고, `start_tiebreak`는 누구나 호출해도 상태가 `tiebreak`일 때만 동작한다. 내부 함수(`tournament_*`)는 anon 실행 권한을 회수했다.
- 토너먼트: 무작위 대진, 인원이 2의 거듭제곱이 아니면 1라운드 부전승. 무승부는 연장전(최대 2번) 후 동전 던지기. 리그: 원 돌리기(circle method) 대진으로 라운드마다 전원이 동시에 1경기, 승 3·무 1·패 0, 쉬는 라운드 1점, 순위는 승점 → 승수 → 이긴 경기 평균 시도 횟수.
- **3자리 숫자 모드**: 기본은 4자리이고, 학급 방·토너먼트/리그는 교사가 만들 때(`sessions.digits`), 혼자 연습은 시작 전에 학생이 3자리/4자리를 고른다. 방은 만들어질 때 세션의 자릿수를 `rooms.digits`로 복사해 판정(`submit_guess`, `judge_guess`, `generate_secret(p_digits)`)이 방 기준으로 일관되게 동작한다. 학급 방의 자릿수 변경은 다른 설정처럼 `capacity = 0`인 학급 방에서만 허용되고, 토너먼트/리그는 시작 후 변경할 수 없다. 랭킹·승패 기록은 3자리와 4자리를 구분하지 않고 합산한다(후속 과제).
- 대회 경기도 `finish_room()`을 거치므로 `match_results`에 기록되어 학급 랭킹·메인 화면 전적에 반영된다(부전·동전 던지기는 경기가 없으므로 제외).
- 알려진 한계: 대회 관리 토큰을 잃어버리면(브라우저 데이터 삭제) 그 대회를 계속 관리할 수 없다. 자동 라운드 진행, 3·4위전, 스위스식 매칭은 아직 없다.

## 비기능/예외 처리 (Phase 7)

- **방 코드 만료**: 생성된 지 1시간이 지난 방 코드로는 새로 참가할 수 없다(`session.js`의 `SESSION_EXPIRY_MS`). 이미 매칭되어 대전 중인 플레이어는 영향받지 않는다.
- **방 코드 충돌 재시도**: 6자리 코드가 우연히 중복되면(`23505`) 최대 5회까지 새 코드로 자동 재시도한다(`createSession`).
- **네트워크/연결 안내**: 브라우저 `online`/`offline` 이벤트, Supabase Realtime 채널의 `CHANNEL_ERROR`/`TIMED_OUT` 상태, RPC 호출 실패(입력 제출, 재대결 등) 시 화면 하단에 토스트 안내(`showToast`, `app.js`)가 뜬다 — 실패해도 빈 화면으로 멈추지 않는다.
- **QR 모달 반응형**: 확대 QR 크기를 `window.innerWidth` 기준으로 계산해 360px 폭 화면에서도 모달 밖으로 잘리지 않는다.
- **학급 간 격리**: 매칭(`match_waiting_players`)·리더보드(`match_results`) 모두 `session_id`/`teacher_id`로 스코프되어, 서로 다른 교사가 동시에 세션을 열어도 매칭·랭킹이 섞이지 않음을 실제 테스트로 확인했다.

## 진행 상황

- [x] Phase 0: 프로젝트 셋업
- [x] Phase 1: 테마 시스템 & 메인 화면 정적 레이아웃
- [x] Phase 2: 닉네임 & 로컬 사용자 식별
- [x] Phase 3: 혼자 연습하기 (vs AI)
- [x] Phase 4: Supabase 연동 — 학급 세션 생성 & 랜덤 매칭
- [x] Phase 5: 실시간 게임 진행 (턴 동기화 & 판정)
- [x] Phase 6: 리더보드 / 랭킹 (학급 단위)
- [x] Phase 7: QA(반응형/예외처리/방 코드 만료) & GitHub Pages 배포
- [x] 확장: 토너먼트/리그전 (T0~T5, 계획서: `.omc/plans/tournament-league-plan.md`)
