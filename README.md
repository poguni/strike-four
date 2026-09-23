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
docs/               # PRD, 디자인 가이드, Phase별 구현 프롬프트
design-reference/   # 최종 디자인 시안 HTML 목업(모바일/PC × 파스텔/모던)
```

## Supabase 연동

- 프로젝트: `Strike Four` (Supabase, ap-northeast-2)
- `supabase-config.js`에 프로젝트 URL과 **publishable(anon) 키**가 들어있다. 이 키는 공개적으로 노출되도록 설계된 키이고(RLS로 접근 범위를 통제), 빌드 과정이 없는 GitHub Pages 배포 특성상 어차피 배포된 JS에 그대로 포함되므로 `.gitignore` 처리하지 않고 커밋했다.
- 실제 데이터 보안은 Supabase의 Row Level Security(RLS)와, 매칭·판정처럼 원자성/정합성이 중요한 쓰기 작업을 처리하는 `SECURITY DEFINER` 함수들이 담당한다. 테이블에 대한 직접 UPDATE/DELETE는 anon 키로 거의 허용되지 않는다.
  - `match_waiting_players` / `leave_waiting_player` / `rejoin_lobby`: 세션 대기열·매칭 (Phase 4)
  - `submit_guess` / `skip_turn` / `forfeit_room` / `finish_room`: 1:1 대전 진행. 상대의 비밀번호(`room_secrets` 테이블)는 RLS 정책이 아예 없어 anon 키로는 절대 조회할 수 없고, 오직 `submit_guess` 함수 내부에서만 판정에 사용된다 (Phase 5)
  - `match_results`: `finish_room()`이 대전 종료 시마다 teacher_id·닉네임과 함께 기록하는 결과 테이블. SELECT는 누구나 가능(집계용)하지만 INSERT 정책은 없어 `finish_room()` 내부에서만 기록되고, 조작된 승리 기록을 직접 끼워 넣을 수 없다 (Phase 6)
  - `get_room_reveal`: 대전이 끝난(`status = 'finished'`) 방에 한해서만 양쪽의 정답과 시도 횟수를 반환한다. 끝나지 않은 방에 대해 호출하면 예외를 던져, 진행 중인 대전에서는 절대 상대 정답을 알아낼 수 없다
  - `sessions.turn_seconds` / `sessions.max_attempts`: 교사가 학급 방 화면에서 조정하는 턴 시간(20/30/40초)·시도 횟수(10~20회). `sessions` 테이블은 이 두 컬럼에 한해서만(컬럼 단위 GRANT) anon 키의 UPDATE를 허용하고, `capacity = 0`(학급 방)인 경우만 RLS로 허용한다 — 코드, teacher_id 등 다른 컬럼은 여전히 수정 불가

## 진행 상황

- [x] Phase 0: 프로젝트 셋업
- [x] Phase 1: 테마 시스템 & 메인 화면 정적 레이아웃
- [x] Phase 2: 닉네임 & 로컬 사용자 식별
- [x] Phase 3: 혼자 연습하기 (vs AI)
- [x] Phase 4: Supabase 연동 — 학급 세션 생성 & 랜덤 매칭
- [x] Phase 5: 실시간 게임 진행 (턴 동기화 & 판정)
- [x] Phase 6: 리더보드 / 랭킹 (학급 단위)
- [ ] Phase 7: `docs/IMPLEMENTATION_PROMPTS.md` 참고
