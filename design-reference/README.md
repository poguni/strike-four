# 디자인 시안 참고 파일

숫자야구 게임 앱의 디자인 시안 4종입니다. 그대로 브라우저에서 열어 확인할 수 있는 완성형 HTML(CSS 인라인)이며, 클로드 코드에 이 폴더를 레포(예: `design-reference/`)에 넣고 "이 4개 파일을 참고해서 실제 화면을 구현해줘"라고 전달하면 됩니다.

| 파일 | 테마 | 화면 크기 |
| --- | --- | --- |
| `mobile-pastel.html` | 파스텔톤 (초등학생용) | 390 x 844 (모바일) |
| `mobile-modern.html` | 모던 클린 | 390 x 844 (모바일) |
| `desktop-pastel.html` | 파스텔톤 (초등학생용) | 1920 x 1080 (PC) |
| `desktop-modern.html` | 모던 클린 | 1920 x 1080 (PC) |

## 클로드 코드에 전달할 때 참고 프롬프트 예시

```
design-reference/ 폴더의 4개 HTML 파일은 최종 디자인 시안이야.
- mobile-*.html : 390x844 모바일 레이아웃
- desktop-*.html : 1920x1080 PC 레이아웃

DESIGN.md의 CSS 변수·토큰과 함께 이 파일들의 실제 마크업(색상, 폰트, 간격, 아이콘 SVG)을 그대로 기준으로 삼아 구현해줘.
지금까지 만든 화면이 이 시안과 다르면 이 파일에 맞게 수정해줘.
```

## 참고

- 폰트: 파스텔톤은 Jua(타이틀)+Gowun Dodum(본문), 모던 클린은 Noto Sans KR — 모두 Google Fonts CDN 링크 포함
- 아이콘은 전부 인라인 SVG (이모지 사용 안 함)
- 원본 디자인 캔버스(파스텔/모던 각각 모바일+PC 4개 아트보드): https://claude.ai/artifact/HP91tHDjvU33EHMoBrk5jA
- 디자인 토큰/전환 로직 상세: 이전에 전달한 `DESIGN.md` 참고
