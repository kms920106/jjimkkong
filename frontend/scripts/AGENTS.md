<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-19 | Updated: 2026-08-19 -->

# scripts

## Purpose
손으로 한 번 돌리는 운영 스크립트. 앱 런타임에 포함되지 않고, 마이그레이션만으로는 할
수 없는 일 — 앱 키가 있어야 계산되는 값 — 을 채운다.

## Key Files
| File | Description |
|------|-------------|
| `backfill-phone-encryption.ts` | 평문으로 남은 전화번호를 `phoneHash`/`phoneEnc` 쌍으로 봉인. `encrypt_phone`과 `drop_phone_plaintext` 마이그레이션 **사이**에 한 번 실행 |
| `backfill-thumbnail-backup.ts` | 백업 도입 전에 저장된 인스타그램 썸네일을 Blob으로 복구. `saved_post_thumbnail_backup` 마이그레이션 **적용 후** 실행 |
| `reingest-post.ts` | 지정한 `Post` 행을 다시 인제스트해 덮어쓴다. **생성 이후 `Post`를 고칠 수 있는 유일한 쓰기 경로.** 아래 참고 |
| `verify-soft-delete.ts` | 소프트 삭제와 재저장 되살리기를 라이브 DB에 대고 확인. 프로브 행을 남긴다 |
| `verify-int-id-readiness.ts` | `int_ids` 마이그레이션의 사전 점검. 읽기만 한다 — 아래 참고 |

## For AI Agents

### Working In This Directory
- 이 스크립트들은 `lib/prisma.ts`를 쓰지 않고 **자기 클라이언트를 만든다.** 그쪽은
  풀링된 `DATABASE_URL`에 묶여 있고 hot reload용으로 `globalThis`에 캐시되므로
  일회성 스크립트에 맞지 않는다. 어댑터(`PrismaPg`)는 선택이 아니다 — 생성된
  클라이언트가 `engineType: "client"`라 폴백할 네이티브 엔진이 없다.
- 새 스크립트도 **idempotent하게** 쓴다. 중간에 죽으면 다시 돌릴 수 있어야 한다
  (백필은 해시가 없고 평문이 남은 행만 건드린다).
- 되돌릴 수 없는 데이터 손실 앞에서는 **건너뛴 행을 경고로 출력한다.** 백필이 유효하지
  않은 번호 형식을 목록으로 찍는 이유는, 다음 마이그레이션이 원본을 지우기 때문이다.

### Testing Requirements
```bash
npx tsx --env-file=.env scripts/backfill-phone-encryption.ts
```
`PHONE_ENCRYPTION_KEY`와 `DIRECT_URL`이 필요하다. **앱이 쓸 키와 같아야 한다** —
다르면 봉인된 값이 앱이 나중에 계산하는 값과 영원히 매칭되지 않는다.

```bash
npx tsx --env-file=.env scripts/backfill-thumbnail-backup.ts
# --delay-ms=<n>  행당 지연 (기본 2500)
# --limit=<n>     첫 실행을 조심스럽게 해 볼 때
```
`BLOB_READ_WRITE_TOKEN`과 `DIRECT_URL`이 필요하다. 저장된 URL은 이미 만료됐으므로
그걸 다시 fetch할 수 없고, `fetchMetadata()`로 **게시글 페이지를 다시 읽어** og:image를
새로 얻는다. 즉 행마다 인스타그램 요청이 하나씩 나가므로 **순차 + 지연**이고,
차단 형태의 실패가 연속 5회면 중단한다 — 계속 두드리면 IP 평판만 잃고, idempotent하니
나중에 다시 돌리면 남은 행부터 이어진다.

### Common Patterns
스크립트 맨 위 블록 주석에 (1) 무엇을 하는지, (2) 어느 마이그레이션 사이에 끼는지,
(3) 어떤 환경변수가 필요한지, (4) idempotent 여부를 적는다.

## `reingest-post.ts`가 특별한 이유

`Post`는 저장한 모든 회원이 함께 읽으므로 **생성 이후 어떤 요청도 고칠 수 없다** —
나중 저장이 고칠 수 있으면 한 회원의 재저장이 다른 회원이 보는 내용을 바꾼다. 대가는
인스타가 차단 중일 때 인제스트된 게시물이 그 결과(썸네일 없음, 캡션 없음)에 고정되고
**사용자가 다시 저장해도 고쳐지지 않는다**는 것이다. 게다가 이후 저장자는 파이프라인을
건너뛰므로 손상이 퍼지기만 하고 낫지 않는다.

이 스크립트가 그 탈출구이고, 규칙이 셋이다:

1. **id를 명시적으로 받는다. "전부 고치기" 모드는 없다.** 재스크레이핑할 행을 조건으로
   고르는 것은 인스타 요청 예산을 한 번에 Meta에 쏟는 것이고, 그게 바로 고치려는 손상을
   만든 실패다. 후보를 찾는 SQL이 파일 주석에 있다 — 보고 나서 고를 것.
2. **`--dry-run`을 먼저 돌린다.** fetch가 비어서 돌아올 수 있고, 쓸 만한 행을 차단된
   읽기로 덮는 것이 아무것도 안 하는 것보다 나쁘다. 캡션과 썸네일이 둘 다 없으면
   스크립트가 스스로 쓰기를 거부한다.
3. **장소는 추가만 하고 제거하지 않는다.** 장소가 줄어든 재인제스트는 교정이라기보다
   잘린 읽기일 가능성이 훨씬 높고, `PostPlace` 행 제거는 애초에 허용되지 않는다
   (`HARD_DELETE_ALLOWED`에 없다). 기존 행의 `position`도 건드리지 않는다 — 부분
   재읽기가 창작자가 쓴 동선을 다시 번호 매기면 안 된다.

**라우트 핸들러에 이 능력을 주지 말 것.** "저장이 공유 행을 고칠 수 있다"는 것이
게시물/찜 분리가 부정하려고 존재하는 바로 그 성질이다.

### `verify-int-id-readiness.ts` — 마이그레이션 사전 점검

```bash
npx tsx --env-file=.env scripts/verify-int-id-readiness.ts
```

`20260825120000_int_ids`를 적용해도 되는 상태인지 **읽기만 해서** 답한다. 아무것도
쓰지 않고 아무것도 지우지 않으며, 마이그레이션이 실패할 상태면 exit 1이다.

보는 것은 셋이다. **`Session`·`PhoneVerification`·`PasswordAttempt`가 비어 있는지**
(두 테이블의 id가 서명 쿠키에 실려 있어서, 번호가 바뀌면 살아 있는 쿠키가 다른 회원의
행을 가리킨다 — 로그아웃이 아니라 계정 탈취다), **부모 없는 자식 행이 없는지**(모든 FK가
drop·recreate되므로 orphan 하나가 재생성을 중간에 깨뜨린다), 그리고 **탈퇴 계정용 partial
unique index 두 개가 제자리인지**(이 마이그레이션이 건드리지 않아야 하는 것들이라, 트러스트가
아니라 확인으로 둔다).

**세 테이블을 비우는 것은 이 스크립트가 하지 않는다.** 훅이 마이그레이션 안의 행 삭제를
거부하고 `withDeleteGuard()`가 앱 코드의 `deleteMany`를 거부하므로, 손으로 실행하는 단계다.
이 스크립트는 그게 됐는지만 보고한다. 마이그레이션 자신도 같은 가드를 갖고 있지만 그쪽은
컬럼을 이미 만들고 채운 *뒤에* Postgres 예외로 터지므로, 먼저 물어볼 자리가 필요했다.

적용이 끝난 DB에서는 "이미 적용되었습니다"만 출력하고 통과한다 — 변환된 DB에서 돌려도
경고처럼 보이지 않게 하려는 것이다.

## Dependencies

### Internal
- `../src/lib/auth/phone.ts` — `normalizeKoreanMobile()`
- `../src/lib/auth/phone-crypto.ts` — `sealPhone()`, `decryptPhone()`
- `../src/lib/ingest/metadata.ts` — `fetchMetadata()` (썸네일 백필의 재스크레이핑)
- `../src/lib/post-thumbnail.ts` — `fetchAndPutThumbnail()`, `backupThumbnail()`, `isOwnThumbnailBlob()`
- `../src/lib/post-author-image.ts` — `backupAuthorImage()`, `isOwnAuthorImageBlob()`
- `../src/lib/ingest/extract.ts` / `geocode.ts` — 재인제스트가 파이프라인 전체를 다시 돈다
- `../src/lib/prisma-guard.ts` — `withDeleteGuard()`. **모든 스크립트가 자기 클라이언트를 이걸로 감싼다**
- `../src/generated/prisma/client`
- `../prisma/migrations/` — 실행 시점이 마이그레이션 순서에 묶여 있다

### External
- `tsx` (실행), `dotenv`(`--env-file`)

<!-- MANUAL: -->
