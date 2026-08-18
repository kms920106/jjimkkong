<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-19 | Updated: 2026-08-19 -->

# frontend

## Purpose
이 저장소의 코드 전부. UI와 백엔드를 겸하는 단일 Next.js 16 App Router 앱이며,
Vercel의 Root Directory도 여기다. **모든 명령은 이 디렉터리에서 실행한다.**

위의 `nextjs-agent-rules` 블록은 `next dev`가 다시 써 넣는 자동 생성물이다.
지우지 말고 작업물과 함께 커밋한다. 아래 내용은 사람이 쓴 것이다.

## Key Files
| File | Description |
|------|-------------|
| `package.json` | 스크립트·의존성. `dev`는 4000 포트, `postinstall`이 `prisma generate` |
| `next.config.ts` | Next 설정 |
| `prisma.config.ts` | Prisma CLI 설정 (스키마 위치, 마이그레이션에 쓸 `DIRECT_URL`) |
| `components.json` | shadcn/ui 설정 — style `base-nova`, baseColor `neutral`, 아이콘 lucide |
| `tsconfig.json` | strict, `@/*` → `src/*` |
| `eslint.config.mjs` | `npm run lint`가 읽는 설정 |
| `postcss.config.mjs` | Tailwind v4 플러그인 |
| `.env.example` | 환경변수 정본. 새 변수는 발급처 주석과 함께 여기에도 추가 |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `src/` | 애플리케이션 코드 전부 (see `src/AGENTS.md`) |
| `prisma/` | 스키마와 마이그레이션 (see `prisma/AGENTS.md`) |
| `scripts/` | 일회성 운영 스크립트 (see `scripts/AGENTS.md`) |
| `public/` | 정적 자산. Next 기본 SVG만 있고 실제로 쓰이지 않는다 |

## For AI Agents

### Working In This Directory
- 명령은 전부 `cd frontend` 후에 실행한다. 루트에는 `package.json`이 없다.
- `src/generated/prisma/`는 생성물이다. gitignore되어 있고 직접 고치지 말 것 —
  `prisma/schema.prisma`를 고치고 `npm run db:generate`를 돌린다.
- 마이그레이션은 `DIRECT_URL`(5432)로 돈다. 풀러(6543)에는 마이그레이션 엔진이 쓰는
  prepared statement와 advisory lock이 없다. 앱 자체는 풀링된 `DATABASE_URL`을 쓴다.
- 마이그레이션은 Vercel 빌드 중에 실행되지 않는다. `db:deploy`를 빌드에 끼워 넣지 말 것.

### Testing Requirements
**테스트 스위트는 없다.** 검증은 세 가지다:

```bash
npm run lint
npm run build
npm run dev     # http://localhost:4000 에서 실제 플로우를 돌려본다
```

타입체크만 통과했다고 동작한다고 말하지 말 것 — 이 코드베이스에서 실제로 깨지는
지점은 전부 네트워크 경계(네이버·Solapi·LLM·인스타그램)다.

### Common Patterns
- 사용자에게 보이는 문자열은 전부 한국어, 코드·주석·식별자는 영어.
- 요청 본문은 라우트 경계에서 Zod로 검증한다.
- 에러는 `src/lib/api.ts`의 `toErrorResponse()`를 거친다. 라우트마다 에러 형태를
  새로 만들지 말고 거기에 분기를 추가한다.

## Dependencies

### External
- Next.js 16.3 / React 19.2 — App Router
- Prisma 6.19 + `@prisma/adapter-pg` — Postgres
- Zod 4 — 경계 검증
- Tailwind CSS v4 + shadcn/ui (`@base-ui/react`, lucide, sonner, next-themes)
- `solapi` — SMS 발송
- `node-html-parser` — 인스타그램 og 태그·embed 파싱

<!-- MANUAL: -->
