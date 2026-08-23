<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-19 | Updated: 2026-08-19 -->

# src

## Purpose
애플리케이션 코드 전부. 페이지·API 라우트(`app/`), React 컴포넌트(`components/`),
도메인 로직(`lib/`)의 세 층으로 나뉜다. 층 사이의 규칙은 하나다 — **네트워크와 DB에
닿는 일은 전부 `lib/`에 있고, 라우트는 그걸 순서대로 부르며 경계에서 검증만 한다.**

## Key Files
| File | Description |
|------|-------------|
| `types/maps.d.ts` | 지도 SDK 3종의 전역 네임스페이스 선언(`naver`, `kakao`, `google`) |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `app/` | 페이지와 API 라우트 (see `app/AGENTS.md`) |
| `components/` | React 컴포넌트 (see `components/AGENTS.md`) |
| `lib/` | 도메인 로직 — 인제스트·인증·지도·DB (see `lib/AGENTS.md`) |
| `types/` | 전역 타입 선언 |
| `generated/prisma/` | **생성물.** gitignore. 직접 수정 금지 — `prisma/schema.prisma`를 고친다 |

## For AI Agents

### Working In This Directory
- 경로 별칭은 `@/*` → `src/*`. 상대 경로 `../../..`를 쓰지 말 것.
- TypeScript strict. `any`로 빠져나가지 말고 Zod로 좁힌다.
- **소유권 검사는 애플리케이션에서 한다.** Prisma가 테이블 소유자로 접속해 Postgres
  RLS를 우회하므로, 모든 라우트 핸들러가 `requireMember()`를 부르고 반환된 `memberId`로
  쿼리를 한정해야 한다.
- 사용자에게 보이는 문자열은 한국어, 식별자·주석은 영어.

### Testing Requirements
`npm run lint` + `npm run build` + 브라우저 실행. 테스트 스위트는 없다.
타입이 통과했다는 것과 동작한다는 것은 다르다 — 실제 실패는 전부 외부 API 경계에서 난다.

### Common Patterns
- 서버 컴포넌트가 기본이고, 상호작용이 있는 것만 `"use client"`를 붙인다.
- 서버 → 클라이언트로 넘기는 데이터는 `lib/serialize.ts`의 DTO를 거친다
  (Prisma `Decimal`/`Date`는 그대로 직렬화되지 않는다).
- 주석은 *왜*를 적는다. 대개 어렵게 알아낸 외부 동작의 기록이므로, 코드를 고칠 때
  주석을 방치하면 다음 사람이 그 주석이 막던 버그를 다시 넣는다.

## Dependencies

### Internal
- `../prisma/schema.prisma` — `generated/prisma/`의 원본

### External
- Next.js 16 App Router, React 19, Zod 4, Prisma 6, Tailwind v4 + shadcn/ui

<!-- MANUAL: -->
