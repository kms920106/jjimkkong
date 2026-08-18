<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-19 | Updated: 2026-08-19 -->

# src/app

## Purpose
Next.js 16 App Router의 라우트 트리. 페이지와 API 라우트가 여기 있고, 실제 로직은
전부 `../lib/`에 있다. 라우트가 하는 일은 (1) 입력을 Zod로 검증하고, (2) `lib/`을
순서대로 부르고, (3) 에러를 `toErrorResponse()`에 넘기는 것뿐이다.

## Key Files
| File | Description |
|------|-------------|
| `layout.tsx` | 루트 레이아웃 — 폰트(Geist), `ThemeProvider`, sonner 토스터 |
| `globals.css` | Tailwind v4 + shadcn 토큰. 다크 팔레트는 `.dark` 클래스에 걸린다 |
| `favicon.ico` | 파비콘 |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `(app)/` | 사용자에게 보이는 페이지 전부 (see `(app)/AGENTS.md`) |
| `api/` | API 라우트 — 인가가 실제로 일어나는 유일한 층 (see `api/AGENTS.md`) |
| `verify-phone/` | 휴대폰 인증 관문. `(app)` 밖에 있는 이유가 있다 (see `verify-phone/AGENTS.md`) |

## For AI Agents

### Working In This Directory

**리다이렉트로 페이지를 막지 말 것.** proxy(미들웨어)는 삭제됐다. 페이지를 세션으로
걷어내던 장치가 없어졌으므로 인가는 전부 라우트 핸들러의 `requireUser()` 한 곳에서만
일어난다. 페이지에 `requireUser()`를 다시 넣으면 "로그인 없이 접속 가능"이라는 전제가
깨지고, 미들웨어를 되살리면 세션이 만료된 `fetch()`가 401 대신 로그인 페이지 HTML을
받아 `res.json()`이 깨진다.

**페이지가 비어 보이는 것과 막히는 것은 다르다.** 로그아웃 상태의 홈은 핀도 목록도
비어 있지만, 그건 `getUser()`가 null이라 조회할 `userId`가 없기 때문이다. 저장·삭제·
설정 변경은 그대로 401이다.

**세션 쿠키를 읽는 페이지에는 `export const dynamic = "force-dynamic"`을 건다.**
없으면 Next가 정적으로 굽고 모든 사용자가 같은 화면을 본다.

**긴 작업에는 `maxDuration`을 건다.** `/api/ingest`(메타데이터 + LLM + 지오코딩)와
`/api/posts`(장소마다 네이버 호출 1회)는 Vercel 기본 10초를 넘긴다.

### Testing Requirements
`npm run dev` → `http://localhost:4000`. 최소 확인 세트:
로그아웃 상태로 홈이 열리는지 / 링크 붙여넣기 → 후보 → 저장 / 로그인 왕복 →
`/verify-phone` → 원래 경로 복귀 / 로그아웃 상태에서 저장이 401인지.

### Common Patterns
- 라우트 핸들러는 `try { ... } catch (error) { return toErrorResponse(error) }` 형태다.
- 상태를 바꾸는 라우트는 `requireSameOrigin(request)`을 먼저 부른다.
- 사용자에게 보이는 문자열은 한국어.

## Dependencies

### Internal
- `../lib/` — 모든 로직
- `../components/` — 페이지가 렌더링하는 클라이언트 컴포넌트

### External
- Next.js 16 App Router (`RouteContext<...>`, `LayoutProps<...>` 타입 헬퍼)

<!-- MANUAL: -->
