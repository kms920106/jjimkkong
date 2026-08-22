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
| `profile-image.ts` | 프로필 사진 Vercel Blob 업로드·삭제. 매직바이트 판정 + allowlist + `MAX_UPLOAD_BYTES`, `ProfileImageError` |
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

## `profile-image.ts`

**타입은 매직바이트가 결정한다.** `file.type`은 호출자가 쓴 헤더라서, 그것만 검사하고 그대로
`contentType`에 박으면 아무 바이트나 자기가 고른 타입으로 서빙된다. `sniff()`이 앞 12바이트로
실제 포맷을 판정하고, 선언값이 일치할 때만 통과시키며, 저장하는 `contentType`도 판정 결과다.
WEBP는 RIFF 컨테이너라 8바이트째의 `WEBP`까지 봐야 한다 — 앞 4바이트만 보면 WAV·AVI가 통과한다.

allowlist도 유지한다. `image/`로 시작하는지 보는 방식으로 바꾸지 말 것 — `image/svg+xml`이
통과하면서 스크립트를 실어 나르고, Blob은 시키는 대로 서빙하므로 그 사진 URL을 직접 여는
순간 blob 오리진에서 XSS가 된다.

**HEIC은 allowlist에 없다.** 클라이언트가 WEBP로 다시 인코딩해서 보내고, 그걸 못 하는
브라우저는 그 파일을 표시도 못 한다 — 저장 성공 + 빈 아바타가 되는 편보다 거부가 낫다.

**`MAX_UPLOAD_BYTES`는 export한다.** 라우트가 `content-length`로 명백히 큰 본문을 파싱 전에
떨궈내는데, 두 검사가 같은 숫자를 가리키지 않으면 한쪽은 장식이다. `content-length`는
호출자가 쓰는 값이므로 진짜 게이트는 여기 있는 `file.size` 검사다.

**키에 랜덤 접미어를 붙인다.** 사용자 id만으로 고정 키를 쓰면 같은 자리를 덮어쓰고, URL이
그대로라서 CDN이 이전 이미지를 계속 서빙한다 — 새 사진을 올리고 옛 사진을 보게 된다.

**`deleteProfileImage()`는 실패를 삼킨다.** 행이 이미 새 URL을 가리키고 있으므로, blob 하나가
남는 것이 성공한 저장을 실패로 되돌리는 것보다 낫다. 인자로는 **교체되는 행에서 읽어 온 URL만**
넘긴다 — 요청 본문의 URL을 넘기면 남의 blob을 지우는 경로가 된다.

**`BlobError`는 `ProfileImageError`로 감싼다.** 압도적으로 흔한 원인이 `BLOB_READ_WRITE_TOKEN`
누락인데, 그대로 두면 일반 500이 되어 어떤 환경변수가 없는지 흔적이 남지 않는다.
