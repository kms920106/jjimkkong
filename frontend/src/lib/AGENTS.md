<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-19 | Updated: 2026-08-19 -->

# src/lib

## Purpose
도메인 로직. 외부 네트워크(인스타그램·유튜브·LLM·네이버 지역검색·네이버 로그인·Solapi)와
DB에 닿는 코드가 전부 여기 있고, `app/`의 라우트는 이것들을 순서대로 부르며 경계에서
검증만 한다.

## Key Files
| File | Description |
|------|-------------|
| `auth.ts` | `requireUser()` / `getUser()` — 모든 라우트의 소유권 게이트, `UnauthorizedError` |
| `api.ts` | `requireSameOrigin()`, `toErrorResponse()` — 알려진 에러 클래스를 상태 코드로 매핑하고 나머지는 500 뒤로 감춘다 |
| `prisma.ts` | Prisma 싱글턴. 풀링된 `DATABASE_URL` + `PrismaPg` 어댑터, hot reload용 globalThis 캐시 |
| `types.ts` | 클라이언트와 공유하는 DTO(`SavedPostDTO`, `IngestResponse`, `ProfileDTO` 등) |
| `serialize.ts` | Prisma 행 → DTO 변환과 `savedPostInclude` |
| `legal.ts` | 약관·개인정보처리방침이 읽는 운영자 정보와 시행일 |
| `utils.ts` | `cn()` — shadcn의 clsx + tailwind-merge |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `ingest/` | 링크 → 장소 파이프라인 3단계 (see `ingest/AGENTS.md`) |
| `auth/` | 세션·OAuth·계정연결·전화번호 암호화·SMS (see `auth/AGENTS.md`) |
| `map/` | 지도 SDK 로더와 공용 타입 (see `map/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- **에러는 `toErrorResponse()` 한 곳에서 상태 코드가 된다.** 라우트마다 에러 형태를
  새로 만들지 말고 여기에 분기를 추가한다. `ZodError`는 400이 된다.
- `requireUser()`는 `withdrawnAt: null`로 조회한다. 탈퇴는 소프트 삭제라 행이 남아
  있으므로, 이 필터를 빼면 탈퇴 계정이 그대로 정상 로그인 상태가 된다.
- 페이지는 `requireUser()`가 아니라 `getUser()`를 부른다. 로그아웃 상태에서도
  페이지는 열리고(빈 지도·빈 목록), 실제 게이트는 라우트 핸들러뿐이다.
- `prisma.ts`는 **풀링된 `DATABASE_URL`**을 쓴다. 마이그레이션용 `DIRECT_URL`을
  여기에 넣지 말 것.

### Testing Requirements
여기 코드는 전부 네트워크 경계에 붙어 있어서 타입체크로 검증되지 않는다.
`npm run dev`로 실제 링크를 붙여넣고, 실제 로그인을 한 번 돌린다.

### Common Patterns
- 외부 응답은 **HTTP 상태만 믿지 않는다.** 네이버는 200 본문에 `error`/`resultcode`를
  담아 실패를 알린다.
- 외부 호출에는 전부 타임아웃을 건다(`AbortSignal`). 재시도는 5xx·타임아웃만, 429는
  재시도하지 않는다.
- 실패 사유를 뭉뚱그리지 않는다 — `matched: false`(지도에 없음)와
  `lookupFailed: true`(검색이 죽음)는 UI 문구가 다르다.

## Dependencies

### Internal
- `../generated/prisma/` — Prisma 클라이언트
- `../app/api/*` — 이 모듈들의 유일한 호출자

### External
- Zod, Prisma + `@prisma/adapter-pg`, `node-html-parser`, `solapi`, Node `crypto`

<!-- MANUAL: -->
