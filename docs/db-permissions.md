<!-- Parent: AGENTS.md -->

# DB 권한으로 하드 삭제를 막는 절차

**이 절차는 아직 라이브 Supabase에 적용되지 않았다.** 여기 적힌 것은 검토를 마친
기록이고, 실제로 켜려면 Supabase 대시보드 세션과 "마이그레이션이 계속 도는지"를
확인하는 테스트가 필요하다. 아래 "5. 아직 적용하지 않았다"를 먼저 읽을 것.

## 1. 왜 코드가 아니라 문서인가

루트 [AGENTS.md](../AGENTS.md)에 이미 적혀 있듯, **Prisma는 테이블 소유자로 접속하므로
Postgres RLS를 우회한다.** 그래서 하드 삭제를 정말로 불가능하게 만드는 유일한 장치는
DELETE 권한이 없는 Postgres role이다. 애플리케이션 층의 어떤 검사도 이것만큼 절대적일
수 없다 — 코드는 다음 커밋에 바뀔 수 있고, role의 권한은 그렇지 않다.

문제는 **이걸 테이블 전체에 일괄로 걸 수 없다는 것이다.** 네 모델은 반드시 삭제 가능한
상태로 남아야 하고, 그 이유는 각각 다르다
([frontend/src/lib/prisma-guard.ts](../frontend/src/lib/prisma-guard.ts)의
`HARD_DELETE_ALLOWED`와 같은 목록이다):

| 테이블 | 삭제가 필요한 이유 |
|---|---|
| `Session` | 로그아웃·탈퇴·비밀번호 재설정이 다른 세션을 **즉시** 끊는 것. 세션을 자기완결적 JWT가 아니라 DB에 둔 이유 자체가 이 즉시 무효화다 |
| `PhoneVerification` | 행을 쓴 뒤 SMS 발송이 throw했을 때의 보상 롤백. 코드는 분 단위로 만료되므로 복구할 것이 없다 |
| `PasswordAttempt` | rate-limit 윈도우를 벗어난 기록 청소와 로그인 성공 시 리셋. 세어지기 위해 존재하고 세어진 뒤에는 잊혀야 하는 행이다 |
| `SavedPostPlace` | 재저장이 장소 집합을 **교체**한다. 다시 인제스트해서 장소가 줄어들어도 고아 행이 남지 않는 것이 이 `deleteMany`다 |

즉 필요한 것은 "DELETE 없는 role"이 아니라 **"네 테이블에만 DELETE가 있는 role"**이고,
그건 한 줄짜리 `REVOKE`가 아니라 유지해야 하는 allowlist다. allowlist를 코드가 아니라
문서에 적어 두는 쪽을 고른 이유는 아래 2번이다.

## 2. 마이그레이션과 충돌한다

마이그레이션은 DDL(`CREATE TABLE`, `ALTER TABLE`, `DROP COLUMN`)을 실행하고
`DIRECT_URL`(5432)로 접속한다. 앱은 풀링된 `DATABASE_URL`(6543)로 접속한다.

**지금 이 둘은 같은 자격증명이다.** 포트만 다르고 role은 하나다. 그래서 "앱 role에서
DELETE를 회수한다"를 지금 그대로 실행하면 `prisma migrate deploy`도 같은 role로 돌기
때문에 **마이그레이션이 함께 깨진다** — DDL 자체는 소유자 권한이라 통과하겠지만, 데이터
정리를 포함한 마이그레이션(예: 백필 전 잔여 행 삭제)은 그 자리에서 죽는다.

제대로 하려면 role을 **둘로 쪼개야 한다**:

- **app role** — 앱이 `DATABASE_URL`로 쓴다. 테이블 소유자가 아니고, DDL 권한이 없고,
  DELETE는 위 네 테이블에만 있다.
- **migration/owner role** — 마이그레이션이 `DIRECT_URL`로 쓴다. 지금의 그 소유자
  계정 그대로다. 권한을 건드리지 않는다.

이 분리가 없으면 이 문서의 나머지는 적용할 수 없다. **분리 없이 SQL만 실행하지 말 것.**

## 3. SQL

Supabase SQL Editor에서 owner role로 실행한다. `<app_password>`는 실제 값을 쓰고
**저장소에 커밋하지 않는다** — `DATABASE_URL`에만 넣는다.

```sql
-- app role. 마이그레이션용 소유자 계정과 별개다.
CREATE ROLE jjimkkong_app WITH LOGIN PASSWORD '<app_password>';

GRANT CONNECT ON DATABASE postgres TO jjimkkong_app;
GRANT USAGE ON SCHEMA public TO jjimkkong_app;

-- 읽기·쓰기·갱신은 전부 허용. DELETE는 여기 없다.
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO jjimkkong_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO jjimkkong_app;

-- DELETE는 네 테이블에만. 위 1번 표의 이유 그대로다.
GRANT DELETE ON TABLE
  "Session",
  "PhoneVerification",
  "PasswordAttempt",
  "SavedPostPlace"
TO jjimkkong_app;
```

**`Place`·`UserProfile`·`AuthIdentity`·`SavedPost`에는 DELETE를 주지 않는다.**
`UserProfile`은 `AuthIdentity`·`Session`·`SavedPost` 셋에 `onDelete: Cascade`를 달고
있어서 한 번의 삭제가 계정의 이력 전체를 가져가고, `SavedPost`는 `SavedPostPlace`를
끌고 간다. `Place`는 사용자 간 공유 행이라 애초에 지우는 개념이 없다. 이 넷은 전부
소프트 삭제(`withdrawnAt` / `deletedAt`)로만 사라진다.

**`ALTER DEFAULT PRIVILEGES`가 반드시 필요하다.** 위의 `ON ALL TABLES`는 *그 시점에
존재하는* 테이블에만 적용되므로, 다음 마이그레이션이 만드는 테이블에는 아무 권한도 없어서
앱이 그 테이블을 읽지도 못한다. 그렇다고 기본값을 넉넉하게 주면 **새 테이블이 조용히
DELETE까지 갖게 되어** 이 문서 전체가 무의미해진다. 그래서 기본값도 정확히 세 권한이다:

```sql
-- 소유자 role이 앞으로 만드는 테이블의 기본 권한.
-- FOR ROLE에는 마이그레이션을 실행하는 role(= 테이블 소유자)을 적는다.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO jjimkkong_app;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO jjimkkong_app;
```

새로 추가한 테이블이 하드 삭제를 필요로 한다면 `GRANT DELETE`를 **명시적으로** 한 번
더 실행한다. 그때 `prisma-guard.ts`의 `HARD_DELETE_ALLOWED`와 위 1번 표도 함께 고친다 —
셋이 어긋나면 어느 쪽이 정본인지 알 수 없게 된다.

적용 후 `DATABASE_URL`의 사용자·비밀번호를 `jjimkkong_app`으로 바꾼다.
`DIRECT_URL`은 **그대로 둔다** — 마이그레이션은 계속 소유자로 돌아야 한다.

## 4. 무엇을 대체하고 무엇을 대체하지 않는가

이건 **선택적 강화**이고, 코드 쪽 세 층 위에 얹는 네 번째 층이다:

1. 런타임 Prisma extension (`prisma-guard.ts`) — 허용되지 않은 `delete`가 wire에 닿기 전에 throw
2. ESLint 규칙 — 커밋 전 조기 경보
3. Claude Code hooks — 편집 시점의 경보
4. **이 문서의 Postgres 권한** — 마지막 절대선

**코드 층을 대체하지 않는다.** 권한 오류는 프로덕션 500으로 나타나고 어느 호출부가
잘못했는지 말해 주지 않는다. `HardDeleteBlockedError`는 모델 이름과 대안(`deletedAt` /
`withdrawnAt`)까지 담아 던지므로, 개발 중에 걸리는 쪽이 언제나 낫다.

**반대로 코드 층도 이걸 대체하지 못한다.** 두 구멍이 명확하다:

- **raw SQL.** `prisma-guard.ts`의 `$executeRawUnsafe` 검사는 **정규식**이다. 실수는
  잡지만 작정한 호출자는 잡지 못한다. `DELETE/**/FROM`이든 동적으로 조립한 문자열이든
  통과할 수 있다.
- **cascade.** `onDelete: Cascade`는 **Postgres가** 실행한다 — extension보다 완전히
  아래 층이다. 지금 이걸 막고 있는 것은 `UserProfile`이 allowlist에 없다는 사실
  하나뿐이다(삭제가 DB에 닿지 않으므로 cascade가 발화하지 않는다). 누가 allowlist에
  `UserProfile`을 추가하는 순간 세 개의 cascade가 동시에 무장된다. 권한 쪽은 그
  실수까지 막는다.

## 5. 아직 적용하지 않았다

다시 강조한다: **라이브 Supabase에는 이 role 분리가 되어 있지 않다.** 지금 `DATABASE_URL`과
`DIRECT_URL`은 같은 소유자 계정이고, 앱은 모든 테이블에 DELETE를 갖고 있다. 유효한
방어선은 코드 쪽 세 층뿐이다.

적용하려면:

1. Supabase 대시보드 SQL Editor 세션(owner 자격) — 위 3번 SQL 실행.
2. Vercel 프로젝트 환경변수의 `DATABASE_URL`을 새 app role로 교체. `DIRECT_URL`은 유지.
3. **`prisma migrate deploy`가 여전히 도는지 확인.** `DIRECT_URL`을 건드리지 않았으므로
   돌아야 하지만, 확인하지 않고 넘기면 다음 스키마 변경 때 배포 중에 알게 된다.
4. 앱에서 로그아웃(→ `Session` 삭제), 링크 재저장(→ `SavedPostPlace` 삭제),
   휴대폰 로그인 실패 후 성공(→ `PasswordAttempt` 삭제)을 각각 한 번 돌려
   **허용된 네 삭제가 실제로 통과하는지** 본다. 여기서 하나라도 막히면 `GRANT DELETE`의
   테이블 이름 대소문자가 틀린 것이다 — Prisma 테이블 이름은 PascalCase이므로 SQL에서
   반드시 큰따옴표로 감싸야 한다.
