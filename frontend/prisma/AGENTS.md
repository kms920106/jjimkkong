<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-19 | Updated: 2026-08-19 -->

# prisma

## Purpose
데이터 모델의 정본. `schema.prisma`가 모델을, `migrations/`가 그 모델에 도달한 SQL
이력을 들고 있다. 생성된 클라이언트는 여기가 아니라 `../src/generated/prisma/`에
떨어지며 gitignore된다.

## Key Files
| File | Description |
|------|-------------|
| `schema.prisma` | 모델 10개(`UserProfile`, `AuthIdentity`, `Session`, `PhoneVerification`, `SavedPost`, `Place`, `SavedPostPlace`)와 enum 3개(`MapProvider`, `Platform`, `AuthProvider`). `UserProfile`의 `statusMessage`·`imageUrl`은 `/profile`이 쓰는 표시용 필드 |
| `migrations/` | 적용 순서대로의 SQL. Prisma 스키마 언어로 표현 못 하는 제약이 여기에만 있다 |
| `migrations/migration_lock.toml` | provider 고정(postgresql) |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `migrations/` | 타임스탬프 순 마이그레이션. 적용된 파일은 절대 수정하지 않는다 |

## For AI Agents

### Working In This Directory
**`generator client`의 `engineType = "client"`를 바꾸지 말 것.** 기본값인 `library`는
플랫폼별 `libquery_engine` 바이너리를 요구하는데, 클라이언트가 커스텀 `output` 경로에
있으면 Next.js가 그 파일을 Vercel 함수 번들에 넣지 않는다. 빌드는 통과하고 런타임에
"could not locate the Query Engine"으로 죽는다.

**`@unique`를 되살리지 말 것. 지금 partial unique index는 셋이다.**
`UserProfile.phoneHash`, `AuthIdentity[provider, providerUserId]`
(`WHERE "withdrawnAt" IS NULL`), 그리고 `SavedPost[userId, sourceUrl]`
(`WHERE "deletedAt" IS NULL`, `20260822150000_soft_delete_saved_post`). 셋 다 Prisma 스키마
언어로 표현할 수 없어서 마이그레이션 raw SQL에만 있고, 그래서 스키마에는 평범한 `@@index`가
적혀 있다.

되돌리면 **두 가지를 동시에 깨뜨린다.** 하나는 기능이다 — 탈퇴한 사용자가 영구히 재가입
불가가 되고, 한 번 지운 링크를 영구히 다시 저장할 수 없다(소프트 삭제된 행이 그
`sourceUrl`을 그대로 들고 있다). 다른 하나가 더 위험하다: **그 키의 `findUnique`/`upsert`가
조용히 다시 컴파일된다.** 그 컴파일 에러를 잃는 것이 `withdrawnAt`/`deletedAt` 필터가
사라지는 경로다. 실제로 `SavedPost` 쪽 유니크를 떼어낸 것이 `api/posts/route.ts`의
`userId_sourceUrl` 호출부 두 곳을 컴파일 에러로 깨뜨려 `upsert`를 `findFirst` +
`create`/`update`로 쪼개게 만들었고, 그게 소프트 삭제된 행을 update로 부활시키는 버그를
사전에 막았다. **`findFirst` + 상태 필터를 쓴다.**

**`@@index([userId, deletedAt, createdAt])`은 장식이 아니다.** 모든 목록 읽기가
`(userId, deletedAt IS NULL)` 필터에 `createdAt` 정렬이다 — 홈 지도, `/links`, `/settings`의
개수, `GET /api/posts`. 이전의 `@@index([userId, createdAt])`은 필터를 덮지 못해 교체됐다.

**전화번호 두 컬럼은 항상 함께 움직인다.** DB CHECK 제약
(`("phoneHash" IS NULL) = ("phoneEnc" IS NULL)`)이 반쪽 행을 거부한다. 이 제약을 빼면
해시만 있는 행(주인에게 번호를 못 보여줌)이나 암호문만 있는 행(병합 실패 → 계정 중복)이
생긴다. 둘 다 상태가 아니라 손상이다.

### Testing Requirements
```bash
npm run db:migrate    # prisma migrate dev — DIRECT_URL(5432)로 실행
npm run db:studio     # 확인용
```

`DIRECT_URL`이 아니라 풀러(6543)로 돌리면 마이그레이션 엔진이 쓰는 prepared statement와
advisory lock이 없어서 실패한다. `db:deploy`는 CI/운영용이고 **Vercel 빌드 중에 실행하지
않는다.**

전화번호 암호화 마이그레이션은 3단계다(중간에 앱 키가 필요한 백필이 낀다):
```bash
npx prisma migrate deploy   # 20260817160000_encrypt_phone 까지
npx tsx --env-file=.env scripts/backfill-phone-encryption.ts
npx prisma migrate deploy   # 20260817160100_drop_phone_plaintext
```

### Common Patterns
- **행을 지우는 마이그레이션을 쓰지 말 것.** 런타임의 하드 삭제는
  `../src/lib/prisma-guard.ts`가 막지만 **마이그레이션은 그 아래를 지난다** — 여기서 쓰는
  SQL은 아무도 검사하지 않는다. 새 상태는 `deletedAt`/`withdrawnAt` 같은 컬럼으로 표현한다.
- 삭제를 소프트로 바꿀 때는 **그 테이블의 전역 unique를 partial unique index로 함께 옮긴다.**
  지운 행이 유니크 키를 계속 점유하므로, 안 하면 같은 값을 다시 만들 수 없다. 두 선례가
  `20260817140000_soft_delete_account`와 `20260822150000_soft_delete_saved_post`다.
- 스키마의 `///` 주석은 *왜*를 적는다. 모델을 고치면 주석도 함께 고친다.
- 적용된 마이그레이션은 수정하지 않고 새 마이그레이션을 얹는다.
- 소유권은 DB가 아니라 애플리케이션에서 검사한다 — Prisma가 테이블 소유자로 접속해
  Postgres RLS를 우회하므로, RLS 정책을 추가해도 그건 방어선이 아니다.

## Dependencies

### Internal
- `../src/lib/prisma.ts` — 앱이 쓰는 클라이언트 싱글턴(풀링된 `DATABASE_URL`)
- `../src/generated/prisma/` — 이 스키마의 생성물
- `../scripts/backfill-phone-encryption.ts` — 두 마이그레이션 사이에 끼는 백필

### External
- Prisma 6.19, `@prisma/adapter-pg` (node-postgres 드라이버 어댑터)
- Supabase Postgres

<!-- MANUAL: -->
