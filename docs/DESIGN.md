# 숫자야구 게임(Strike Four) 앱 — DESIGN.md

두 가지 디자인 테마(파스텔톤 / 모던 클린)를 사용자가 드롭다운으로 직접 선택해 전환할 수 있도록 하는 구현 가이드입니다.
PRD의 "기능 4. 테마 선택(디자인 모드 전환)" 섹션과 함께 참고하세요.

- PRD: https://claude.ai/code/artifact/da3e7862-10d5-4eb3-9a87-c6be775decbc
- 디자인 시안(캔버스): https://claude.ai/artifact/HP91tHDjvU33EHMoBrk5jA

---

## 1. 테마 전환 방식 요약

- 최상위 요소(`<html>` 또는 `<body>`)에 `data-theme="pastel"` 또는 `data-theme="modern"` 속성을 부여
- 색상·폰트·radius 등 모든 스타일 값은 CSS 커스텀 속성(변수)으로 정의하고, 테마별 값은 `[data-theme="..."]` 셀렉터 안에서만 재정의
- 드롭다운에서 테마를 바꾸면 JS로 속성값만 토글 → 페이지 새로고침 없이 즉시 전체 화면에 반영
- 선택한 테마는 `localStorage`에 저장(닉네임 저장과 동일한 패턴) → 재방문 시 자동 적용
- 기본값(최초 방문자): `pastel`

```js
const THEME_KEY = 'numball_theme';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
}

// 최초 로드 시
const savedTheme = localStorage.getItem(THEME_KEY) || 'pastel';
applyTheme(savedTheme);

// 드롭다운 변경 시
document.getElementById('theme-select').addEventListener('change', (e) => {
  applyTheme(e.target.value);
});
```

## 2. 드롭다운 UI 스펙

- 위치: 메인 화면 우측 상단(헤더 영역)
- 컴포넌트: `<select>` 또는 커스텀 드롭다운
- 옵션:
  | value | label |
  | --- | --- |
  | `pastel` | 🎨 파스텔톤 |
  | `modern` | ⬛ 모던 클린 |

```html
<select id="theme-select" aria-label="디자인 테마 선택">
  <option value="pastel">파스텔톤</option>
  <option value="modern">모던 클린</option>
</select>
```

- 드롭다운 자체의 스타일도 테마 토큰(색상·radius·폰트)을 따라야 두 테마 모두에서 자연스럽게 보임

## 3. 디자인 토큰 (CSS 변수)

두 시안(파스텔톤 / 모던 클린)에서 실제 사용된 값을 기준으로 정리했습니다. `:root`에 공통 변수를 선언하고, `[data-theme="pastel"]` / `[data-theme="modern"]` 블록에서 값만 재정의하는 구조를 권장합니다.

```css
/* 공통 폰트 로드 */
@import url('https://fonts.googleapis.com/css2?family=Jua&family=Gowun+Dodum&family=Noto+Sans+KR:wght@400;500;700;900&display=swap');

:root {
  --radius-pill: 999px;
  --radius-lg: 20px;
  --radius-md: 16px;
  --radius-sm: 14px;
}

/* ===== 1. 파스텔톤 (초등학생용) ===== */
[data-theme="pastel"] {
  --font-display: 'Jua', sans-serif;
  --font-body: 'Gowun Dodum', sans-serif;

  --bg-gradient: linear-gradient(180deg, #FFF3F7 0%, #F1F6FF 52%, #F2FFF6 100%);
  --text-primary: #5B4B77;
  --text-muted: #9C8AB5;

  --card-bg: rgba(255, 255, 255, 0.75);
  --card-shadow: 0 6px 14px rgba(170, 150, 210, 0.18);

  --accent-primary-grad: linear-gradient(90deg, #FFAFC4, #C6A6FF);
  --accent-primary-shadow: 0 8px 18px rgba(199, 150, 220, 0.45);

  --accent-blue-bg: #F5FBFF;   --accent-blue-border: #BFE3FF; --accent-blue-text: #5B87B0;
  --accent-pink-bg: #FFF6FA;   --accent-pink-border: #FFD9EC; --accent-pink-text: #C1709A;
  --accent-yellow-bg: #FFFBEA; --accent-yellow-border: #FFE29A; --accent-yellow-text: #B8860B;

  --pill-success-bg: #D8F5E3; --pill-success-text: #4E9C72;
  --list-divider: dashed 1.5px #E7D9F0;

  --radius-btn: 18px;
  --shape: rounded; /* 버튼·카드 모두 완전 라운드 / pill 위주 */
}

/* ===== 2. 모던 클린 ===== */
[data-theme="modern"] {
  --font-display: 'Noto Sans KR', sans-serif;
  --font-body: 'Noto Sans KR', sans-serif;

  --bg-gradient: #FAFAFB;
  --text-primary: #16171B;
  --text-muted: #8A8A93;

  --card-bg: #FFFFFF;
  --card-border: 1px solid #EAEAEC;
  --card-shadow: none;

  --accent-primary-bg: #111114;
  --accent-primary-text: #FFFFFF;

  --accent-blue: #4F46E5;
  --accent-blue-tint-bg: #EEF0FF;

  --divider: 1px solid #F1F1F3;

  --radius-btn: 14px;
  --shape: soft-square; /* 14~16px 라운드, pill 사용 안 함 */
}
```

## 4. 공용 컴포넌트 스타일 가이드

| 요소 | 파스텔톤 | 모던 클린 |
| --- | --- | --- |
| 배경 | 파스텔 그라데이션 (`--bg-gradient`) | 단색 라이트 그레이 (`#FAFAFB`) |
| 타이틀 폰트 | Jua (둥글고 귀여운 손글씨체) | Noto Sans KR 900 (굵은 고딕) |
| 본문 폰트 | Gowun Dodum | Noto Sans KR 400/500 |
| 기본 버튼 | 완전 라운드(pill), 그라데이션 배경 + 소프트 섀도 | 각진 라운드(14px), 단색 검정 배경, 섀도 없음 |
| 보조 버튼 | 파스텔 톤 아웃라인(2px), 색상별로 구분 | 흰 배경 + 1px 그레이 보더, 단일 accent 색만 사용 |
| 카드 | 반투명 흰 배경 + 소프트 섀도 | 불투명 흰 배경 + 얇은 보더, 섀도 없음 |
| 리스트 구분선 | 점선(dashed) | 실선(1px solid) |
| 강조색 | 핑크/라벤더/민트/옐로 등 다색 파스텔 | 인디고 단일 accent (`#4F46E5`) |
| 아이콘 | 손그림 느낌 라운드 스트로크 | 얇은(1.6~1.8px) 미니멀 스트로크 |

> 두 테마 모두 아이콘은 이모지 대신 인라인 SVG를 사용합니다 (일관된 크로스 플랫폼 렌더링을 위함).

## 5. 접근성 & 구현 체크리스트

- [ ] `<html>`에 `data-theme` 기본값 설정 후 JS에서 `localStorage` 값으로 즉시 덮어쓰기 (깜빡임 최소화를 위해 `<head>` 최상단 인라인 스크립트에서 처리 권장)
- [ ] 드롭다운은 `<select>` 네이티브 엘리먼트 사용 (키보드/스크린리더 접근성 확보), `aria-label="디자인 테마 선택"`
- [ ] 텍스트 대비 4.5:1 이상 유지 (특히 모던 테마의 `--text-muted` 그레이 톤 확인)
- [ ] 터치 타겟 44px 이상 (초등학생 대상 파스텔 테마에서 특히 중요)
- [ ] QR 1:1 대전 등 실시간 기능에서 테마는 순수 UI 레이어이므로 게임 로직·데이터 스키마에 영향 없음을 확인
- [ ] 참가자별로 서로 다른 테마를 선택해도 동일한 방(room)에서 정상 동작하는지 확인

## 6. 참고 자료

- 두 디자인 시안 전체 화면 목업(캔버스): https://claude.ai/artifact/HP91tHDjvU33EHMoBrk5jA
- 위 캔버스의 `Pastel.dc.html`, `Modern.dc.html` 마크업이 실제 색상·레이아웃 값의 출처입니다. 구현 시 그대로 참고해 컴포넌트를 이식하세요.
