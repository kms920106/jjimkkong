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

## Dependencies

### Internal
- `../src/lib/auth/phone.ts` — `normalizeKoreanMobile()`
- `../src/lib/auth/phone-crypto.ts` — `sealPhone()`, `decryptPhone()`
- `../src/lib/ingest/metadata.ts` — `fetchMetadata()` (썸네일 백필의 재스크레이핑)
- `../src/lib/post-thumbnail.ts` — `fetchAndPutThumbnail()`
- `../src/generated/prisma/client`
- `../prisma/migrations/` — 실행 시점이 마이그레이션 순서에 묶여 있다

### External
- `tsx` (실행), `dotenv`(`--env-file`)

<!-- MANUAL: -->
