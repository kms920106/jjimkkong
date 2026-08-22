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
| `prisma.ts` | Prisma 싱글턴. 풀링된 `DATABASE_URL` + `PrismaPg` 어댑터, hot reload용 globalThis 캐시. **`withDeleteGuard()`로 감싼다** |
| `prisma-guard.ts` | `withDeleteGuard()` — 하드 삭제를 Postgres에 닿기 전에 막는 Prisma Client Extension. `HARD_DELETE_ALLOWED`, `HardDeleteBlockedError`, `DestructiveSqlBlockedError` |
| `types.ts` | 클라이언트와 공유하는 DTO(`SavedPostDTO`, `IngestResponse`, `ProfileDTO` 등) |
| `serialize.ts` | Prisma 행 → DTO 변환과 `savedPostInclude` |
| `legal.ts` | 약관·개인정보처리방침이 읽는 운영자 정보와 시행일 |
| `profile-image.ts` | 프로필 사진 Vercel Blob 업로드·삭제. `file.type` 일치 검사 + `MAX_UPLOAD_BYTES`, `ProfileImageError`. **실패하면 throw한다** |
| `post-thumbnail.ts` | 인스타그램 썸네일을 Blob으로 백업. `backupThumbnail()` / `deleteThumbnailBlob()`. **절대 throw하지 않는다** — 실패 시 원본 URL로 폴백 |
| `image-bytes.ts` | 매직바이트 → MIME 판정과 allowlist. 위 두 모듈이 공유 (SVG 제외 = blob 오리진 XSS) |
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
- **`new PrismaClient`는 반드시 `withDeleteGuard()`로 감싼다.** 자리는 셋이다 —
  여기 싱글턴과 `../../scripts/backfill-*.ts` 둘. 아래 `prisma-guard.ts` 절 참고.

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

## `prisma-guard.ts`

**이 파일이 이 저장소에서 기계적으로 강제되는 첫 불변조건이다.** 나머지 규칙은 전부 산문이고,
어긴 코드가 lint와 build를 그대로 통과한다 — 깨졌다는 사실은 행이 사라진 뒤에 알게 된다.

**Prisma Client Extension이 옳은 이음매인 이유는 호출과 와이어 사이에 앉기 때문이다.**
차단된 `delete`/`deleteMany`는 `HardDeleteBlockedError`로 throw되고 Postgres에 닿지 않으며,
어느 파일이 어떻게 불렀는지와 무관하다. 정적 분석은 그 약속을 할 수 없다 —
`prisma[model].delete()`가 모든 lint 규칙을 지나간다. `../../eslint-rules/no-hard-delete.mjs`는
조기 경보이고 **강제는 여기다.**

**`lib/prisma.ts` 안이 아니라 공용 팩토리로 둔 이유가 있다.** `new PrismaClient`가 세 곳에
있다 — 앱 싱글턴과, `DIRECT_URL`에 닿기 위해 자기 클라이언트를 만드는 백필 스크립트 둘.
**싱글턴만 감싸면 손으로 라이브 데이터에 돌리는 쪽이 무방비로 남는다.**

**`HARD_DELETE_ALLOWED`에 모델을 추가하는 것은 "이 행은 사용자 데이터가 아니다"라는 선언이고,
이유를 주석으로 적어야 한다.** 지금 넷 — `Session`·`PhoneVerification`·`PasswordAttempt`·
`SavedPostPlace`. 이 목록은 `eslint-rules/no-hard-delete.mjs`(camelCase delegate 이름),
`.claude/hooks/block-hard-delete.mjs`, `docs/db-permissions.md`의 표에 각각 복제되어 있다 —
**넷은 함께 움직인다.** 판단 근거는 여기에만 적고 나머지는 목록만 든다(복제하면 어긋난다).

**`UserProfile`을 여기 넣지 말 것.** `onDelete: Cascade`는 **Postgres가 이 extension 아래에서
실행하므로** 여기서 볼 수 없다. `UserProfile`에 걸린 세 cascade(`AuthIdentity`·`Session`·
`SavedPost`)를 지키는 것은 삭제가 애초에 DB에 닿지 않는다는 사실이고, allowlist에 넣으면
셋이 한 번에 다시 무장된다.

**raw SQL 검사는 모델 훅과 별개로 필요하다.** Prisma는 raw 쿼리에 보고할 모델이 없어서
`$allModels` 훅을 지나가지 않는다. 그래서 `$executeRaw`·`$executeRawUnsafe`·`$queryRaw`·
`$queryRawUnsafe` 넷이 각자 자기 텍스트를 다시 검사한다. **`DROP COLUMN`과 `DROP INDEX`는
일부러 목록에 없다** — 둘 다 이 저장소의 정당한 마이그레이션에 나오고(평문 전화번호 컬럼 삭제,
unique index를 partial로 교체), 마이그레이션은 애초에 이 클라이언트를 지나지 않는다. 넣으면
false positive만 생긴다.

**이건 정규식이다. 실수를 잡을 뿐 작정한 호출자를 막지 못한다.** 절대적인 정지는 DELETE 권한이
없는 Postgres role뿐이고, 그건 `docs/db-permissions.md`에 절차만 있다(아직 미적용).
