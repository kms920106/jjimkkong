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
| `schema.prisma` | 모델 10개(`UserProfile`, `AuthIdentity`, `Session`, `PhoneVerification`, `SavedPost`, `Place`, `SavedPostPlace`)와 enum 3개(`MapProvider`, `Platform`, `AuthProvider`) |
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

**`@unique`를 되살리지 말 것.** `UserProfile.phoneHash`와
`AuthIdentity[provider, providerUserId]`는 **partial unique index**
(`WHERE "withdrawnAt" IS NULL`)이고, Prisma 스키마 언어로 표현할 수 없어서 마이그레이션
raw SQL에만 있다. 그래서 스키마에는 평범한 `@@index`가 적혀 있다. `@unique`로 바꾸면
탈퇴한 사용자가 영구히 재가입 불가가 된다. `findUnique`가 컴파일되지 않는 것도 의도된
것이다 — `findFirst` + `withdrawnAt: null`을 쓴다.

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
