@AGENTS.md

## AI 규칙

명령어에 대한 답변은 한국어로 하도록 합니다.

나에게 무언가를 되물어 확인해야 할 때는, 자유 서술형으로 답을 요구하지 말고 **항상 선택지를 체크리스트(선택 가능한 항목 목록) 형태로 제시**하여 내가 키보드로 타이핑하지 않고 마우스 클릭만으로 답할 수 있게 합니다. 즉, 질문이 발생하면 가능한 답안들을 명확한 항목으로 나열해 그중에서 고르도록 하고, 여러 개를 동시에 고를 수 있는 질문이면 다중 선택이 가능함을 함께 알려줍니다.

## GIT 규칙

NO_COMMIT_OR_ROLLBACK

명령된 작업(리팩터링/기능 구현 등)이 끝나면, 커밋은 직접 실행하지 않되(NO_COMMIT_OR_ROLLBACK) **추천 커밋 메시지를 항상 함께 제시**합니다. 최근 커밋 로그(`git log`)의 컨벤션(`{type}({scope}): {한글 요약}` 형태, 예: `refactor(naming): ...`, `feat(point): ...`, `style(response): ...`)을 따르고, 본문은 무엇을 왜 바꿨는지(동작 변경 여부 포함) 한국어로 서술합니다. 신설 규칙이 있어 CLAUDE.md/AGENTS.md를 갱신한 경우 그 사실도 본문에 언급합니다.

사용자가 명시적으로 git commit 또는 git push를 요청한 경우에는, 현재 브랜치가 `main`를 포함한 어떤 브랜치이든 별도로 확인 질문을 하지 않고 바로 진행합니다. 이 저장소는 현재 `main` 브랜치를 기본으로 사용하며, 사용자가 커밋/푸시를 요청한 것 자체가 대상 브랜치에 대한 승인으로 간주합니다.

## PRISMA 마이그레이션 규칙

**`prisma migrate dev`가 "reset해야 한다 / All data will be lost"를 낸다고 곧바로 reset하지 않습니다.**
이 저장소의 `DATABASE_URL`/`DIRECT_URL`은 로컬이 아니라 라이브 Supabase를 가리키므로, reset은
실제 데이터를 지우는 되돌릴 수 없는 작업입니다. 이 경고는 스키마 자체가 틀렸다는 뜻이 아니라,
`_prisma_migrations` 테이블의 통기록과 디스크의 마이그레이션 파일 체크섬이 다르다는 뜻일 뿐이고,
원인은 대부분 다음 중 하나입니다:

- 어떤 마이그레이션이 과거에 실패(rollback)한 뒤 재실행되어 성공했는데, **실패했던 시도의 행이
  `_prisma_migrations`에 그대로 남아** drift로 잡히는 경우 (2026-08-19에 실제로 겪은 원인).
- 이미 적용된 마이그레이션 파일의 SQL을 나중에 손으로 고친 경우.

**진단 순서:**
1. reset하지 말고 먼저 원인을 확인합니다. `prisma/lib/prisma.ts`가 쓰는 것과 같은 방식으로
   (`engineType = "client"`라 일반 PrismaClient는 adapter 없이 못 뜬다) 임시 스크립트를 만들어
   `_prisma_migrations` 테이블을 조회합니다:
   ```ts
   import { prisma } from "./src/lib/prisma";
   const rows = await prisma.$queryRawUnsafe(
     `SELECT id, migration_name, checksum, started_at, finished_at, rolled_back_at
      FROM "_prisma_migrations" ORDER BY started_at`
   );
   ```
   `npx tsx --env-file=.env <스크립트>`로 실행합니다(top-level await은 안 되므로 `main()` 함수로 감쌀 것).
2. 같은 `migration_name`이 여러 행으로 나오고 그중 하나가 `rolled_back_at`이 찍혀 있다면, 디스크의
   현재 파일 체크섬(`shasum -a 256 <migration.sql>`)을 각 행의 `checksum`과 대조합니다. 파일이
   **성공한 행**(`rolled_back_at`이 null)의 체크섬과 일치하면 스키마와 데이터는 정상이고, drift는
   순전히 실패했던 행이 남아 있어서 생긴 것입니다.
3. 그 경우 **stale한 행 하나만** `id`로 지정해 지웁니다 (`DELETE FROM "_prisma_migrations" WHERE id = '...'`).
   테이블 전체나 다른 조건으로 지우지 않습니다 — 성공한 마이그레이션들의 정당한 기록을 건드리면
   안 됩니다.
4. 정리 후 `npx prisma migrate status`로 드리프트가 사라졌는지 확인하고, 남은 미적용 마이그레이션은
   `npm run db:deploy`(`prisma migrate deploy`, 비대화형)로 적용합니다. `migrate dev`는 대화형이고
   드리프트가 남아 있으면 다시 reset을 물으므로, 라이브 DB에는 진단이 끝난 뒤에도 `db:deploy`를 씁니다.

**하지 말 것:**
- `prisma migrate reset`을 실행 전 사용자 확인 없이 실행하는 것. 라이브 데이터가 걸린 되돌릴 수
  없는 작업이므로, 이 프로젝트의 "위험한 행동 전 확인" 원칙이 우선합니다.
- stale 행 하나를 지우는 대신 `_prisma_migrations` 테이블을 통째로 지우거나 마이그레이션 이름
  전체를 지우는 것. 성공한 적용 이력까지 함께 사라지면 다음 `migrate deploy`가 그 마이그레이션을
  중복 적용하려 시도합니다.

**남겨 둔 컬럼·테이블은 반드시 스키마에도 선언한다. 안 하면 그게 영구 drift다.**
게시물/찜 분리(2026-08-23)에서 실제로 겪었다. 되돌릴 수 없는 삭제가 무서워서 옛
`SavedPost` 컬럼 아홉 개와 `SavedPostPlace` 테이블을 DB에 남겼는데, 그러면 **DB에는
있고 `schema.prisma`에는 없는 것**이 되어 `prisma migrate dev`가 매번 drift를 보고하고
reset을 권한다 — 위 "진단 순서"가 막으려는 바로 그 상황이고, 이번엔 stale한 행 하나가
아니라 구조적이라 지울 행도 없다. 다음 사람은 체크섬이 전부 맞고 rolled_back 행도 없는
것을 확인한 뒤 "이 가이드는 해당 없다"고 결론 내리고 reset 한 번 거리에 서게 된다.

교훈은 "남기지 말라"가 아니라 **"남기려면 선언하라"**다. 이번에는 둘로 갈랐다:

- **컬럼 아홉 개는 지웠다.** 값이 같은 트랜잭션에서 이미 `Post`/`PostPlace`/
  `BookmarkMemo`로 복사됐으므로 *중복* 기록이었다. "유일한 기록"이 아닌 것을 위해 drift를
  감수할 이유가 없다.
- **테이블은 남기고 `SavedPostPlacePreSplit` 모델로 선언했다**(`@@map`). 그 행의
  메모와 `position`은 다른 어디서도 복원할 수 없는 유일한 기록이다. FK는 떼어냈다 —
  선언에 relation이 없으면 제약도 drift이고, `postId`가 이제 `Bookmark`를 가리키므로
  남겨두면 은퇴한 행이 살아 있는 테이블의 삭제를 제약한다.

**마이그레이션을 쓴 뒤에는 `schema.prisma`와 대조할 것.** shadow DB를 띄울 수 없는
환경에서는 SQL이 만드는 컬럼 집합과 스키마 선언을 정적으로 비교하는 것만으로도 이
부류의 실수가 잡힌다.

### 커밋/푸시/Vercel 배포 전 체크리스트

**Vercel은 빌드 중 마이그레이션을 실행하지 않습니다.** `frontend/prisma/migrations/`에 새
마이그레이션이 있는데 이걸 빌드 파이프라인이 대신 적용해 줄 거라 가정하지 않습니다. 코드가
참조하는 컬럼/테이블이 라이브 DB에 없으면 배포 직후 해당 경로가 500으로 죽습니다.

커밋하기 전에 반드시:

1. `git status`로 untracked/modified 마이그레이션 디렉터리(`prisma/migrations/*`)가 있는지 확인.
2. `npx prisma migrate status`로 그 마이그레이션이 **라이브 DB에 이미 적용됐는지** 먼저 확인.
   (이미 적용돼 있는데 로컬 git에만 커밋 안 된 상태일 수도 있음 — "Database schema is up to date!"면
   재적용 불필요.)
3. 미적용 마이그레이션이 있으면 `npm run db:deploy`로 적용 — reset이 필요하다고 나오면 위
   "진단 순서"를 따르고, 절대 확인 없이 reset하지 않습니다.
4. 스키마와 짝을 이루는 코드(라우트, 컴포넌트, lib)는 **마이그레이션 파일과 같은 커밋**에
   포함시킵니다. 분리 커밋하면 배포 시점과 스키마 적용 시점이 어긋날 수 있습니다.
5. 순서는 항상: **DB 마이그레이션 적용 → git push → Vercel 배포.** 역순으로 하면 새 코드가
   아직 없는 컬럼/테이블을 찾다가 실패합니다.
6. 마이그레이션이 없는 평범한 코드 변경이라면 이 절차는 건너뜁니다 — 매번 검사하되, 대상이
   없으면 그냥 통과.
