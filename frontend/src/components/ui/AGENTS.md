<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-19 | Updated: 2026-08-19 -->

# src/components/ui

## Purpose
shadcn/ui가 생성한 프리미티브. `@base-ui/react` 위에 Tailwind 클래스와 CVA variant를
얹은 것으로, 제품 로직은 하나도 들어 있지 않다.

## Key Files
| File | Description |
|------|-------------|
| `drawer.tsx`, `sheet.tsx`, `dialog.tsx`, `alert-dialog.tsx` | 오버레이 4종. 로그인·설정·붙여넣기·탈퇴 확인이 각각 쓴다 |
| `button.tsx`, `input.tsx`, `label.tsx`, `textarea.tsx`, `radio-group.tsx` | 폼 요소 |
| `card.tsx`, `badge.tsx`, `alert.tsx`, `separator.tsx`, `avatar.tsx`, `skeleton.tsx` | 표시 요소 |
| `tabs.tsx` | `/links`의 플랫폼 탭 |
| `scroll-area.tsx` | 스크롤 컨테이너 |
| `sonner.tsx` | 토스터. 루트 레이아웃에 마운트된다 |

## For AI Agents

### Working In This Directory

**여기 파일은 CLI 생성물에 가깝다.** 손으로 크게 고치면 다음 `shadcn add`가 덮어쓰거나
충돌한다. 제품 고유의 동작은 여기 넣지 말고 `../`의 컴포넌트에서 조합한다.

**설정은 `frontend/components.json`에 있다** — style `base-nova`, baseColor `neutral`,
아이콘 lucide, `rsc: true`. 새 프리미티브는 손으로 만들지 말고
`npx shadcn@latest add <name>`으로 추가한다. 그래야 스타일이 갈라지지 않는다.

**다크 팔레트는 `.dark` 클래스에 걸린다**(`prefers-color-scheme`이 아니라).
`ThemeProvider`(next-themes)가 그 클래스를 다는 주체이므로, 여기서 미디어 쿼리로
다크 스타일을 새로 쓰지 말 것.

**토큰은 `src/app/globals.css`의 CSS 변수다.** 색을 하드코딩하지 말고 토큰을 쓴다.

**드러난 문자열은 여전히 한국어여야 한다** — 생성물이라도 사용자에게 보이는 기본 라벨
(닫기, 취소 등)이 있으면 번역한다.

### Testing Requirements
`npm run build`로 타입을 확인하고, 라이트/다크 양쪽에서 실제로 본다.
오버레이는 모바일 뷰포트에서 한 번 더 확인한다 — 이 앱의 주 사용 환경이다.

### Common Patterns
`cn()`으로 클래스를 병합하고, variant는 `class-variance-authority`로 선언한다.
DOM을 노출하는 컴포넌트는 ref를 전달한다.

## Dependencies

### Internal
- `../../lib/utils.ts` — `cn()`
- `../../app/globals.css` — 색·반경 토큰

### External
- `@base-ui/react`, `class-variance-authority`, `tailwind-merge`, `clsx`,
  `lucide-react`, `sonner`, `tw-animate-css`

<!-- MANUAL: -->
