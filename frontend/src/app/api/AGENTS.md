<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-19 | Updated: 2026-08-19 -->

# src/app/api

## Purpose
**인가가 실제로 일어나는 유일한 층.** proxy(미들웨어)가 삭제되고 페이지가 로그인 없이
열리게 되면서, 라우트 핸들러의 `requireUser()`가 유일한 게이트가 됐다.

## Key Files
| File | Description |
|------|-------------|
| `ingest/route.ts` | `POST` — metadata → extract → geocode. `maxDuration = 60` |
| `posts/route.ts` | `GET` 목록 / `POST` 저장. 확인된 장소를 **서버에서 다시 지오코딩**한다. `maxDuration = 60` |
| `posts/[id]/route.ts` | `DELETE` — `deleteMany({ where: { id, userId } })` 그 자체가 소유권 검사다 |
| `settings/route.ts` | `PATCH` — 닉네임·지도 제공자. 두 필드 모두 optional(생략 = 그대로, 빈 닉네임 = 이메일 폴백으로 복귀) |
| `settings/profile/route.ts` | `PATCH` — 프로필 사진·닉네임·상태메세지. **multipart**이고 텍스트 두 필드는 항상 온다 |
| `account/route.ts` | `DELETE` — 회원탈퇴. `withdrawnAt`만 찍는다(예외 둘: `Session` 삭제, 프로필 사진 blob 삭제) |
| `settings/password/route.ts` | `POST` — 비밀번호 설정·변경. 이미 있으면 **현재 비밀번호**를 요구한다(최초 설정은 세션만) |
| `settings/password/verify/route.ts` | `POST` — 현재 비밀번호 확인만. 아무것도 쓰지 않는 사전 검사이고 권한을 주지 않는다 |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `auth/` | OAuth start·callback, SMS send·verify, logout (see `auth/AGENTS.md`) |
| `ingest/`, `posts/`, `settings/`, `account/` | 위 표 참고 |

## For AI Agents

### Working In This Directory

**모든 핸들러가 `requireUser()`를 부르고 반환된 `userId`로 쿼리를 한정한다.**
Prisma는 테이블 소유자로 접속해 Postgres RLS를 우회하므로, DB가 대신 막아주지 않는다.
`deleteMany({ where: { id, userId } })`를 `delete({ where: { id } })`로 줄이면 그 행이
모든 사용자에게 조용히 열린다.

**클라이언트가 보낸 좌표는 절대 믿지 않는다.** `Place`는 사용자 간 공유이고
`[name, address]`가 키다. 요청 본문의 lat/lng을 그대로 받으면 한 사용자가 남의 핀을
옮길 수 있다. `POST /api/posts`는 이름과 지역 힌트만 받고 서버에서 다시 지오코딩하며,
이미 있는 `Place`는 `update: {}`로 upsert한다 — 다른 게시글의 것이기도 하기 때문이다.

**저장 트랜잭션 안에서는 장소를 정렬한 뒤 upsert한다.** 동시에 도는 트랜잭션들이 락을
같은 순서로 잡게 하기 위해서다. 이 정렬을 빼면 데드락이 난다.

**재저장은 장소를 덧붙이는 게 아니라 교체한다.** `SavedPost`가 `[userId, sourceUrl]`에
유니크라 같은 링크는 갱신되고, 다시 인제스트했을 때 장소가 줄어도 고아 행이 남지 않는다.

**탈퇴는 삭제가 아니라 상태 변경이다.** `UserProfile`·`AuthIdentity`·`SavedPost`는 전부
남는다. `Session`만 지우는데, 남겨두면 살아 있는 쿠키가 탈퇴 계정을 가리킨 채
`requireUser()` 검사 하나에만 의존하게 되기 때문이다. **UI 문구로 "모두 삭제"라고 쓰지
말 것** — 데이터는 남는다. "다시 볼 수 없고 재로그인 시 새 계정으로 시작한다"고만 약속한다.

**탈퇴 라우트는 요청 본문을 아예 읽지 않는다.** 읽지 않는 본문은 침입 경로가 될 수 없다.
게이트는 `requireSameOrigin()` + 세션이고, 확인은 `AlertDialog` 하나다(문구 입력 없음).
**소프트 삭제라서 이 정도로 충분하다** — 하드 삭제로 되돌린다면 타이핑 확인을 다시 넣을 것.

**에러는 `toErrorResponse()`로 나간다.** 라우트마다 에러 형태를 만들지 말고 `lib/api.ts`에
분기를 추가한다. 새 에러 클래스를 만들었으면 거기 매핑도 함께 넣어야 500으로 감춰지지 않는다.

### Testing Requirements
로그아웃 상태에서 `POST /api/posts`, `DELETE /api/posts/:id`, `PATCH /api/settings`,
`PATCH /api/settings/profile`, `DELETE /api/account`가 전부 401인지 확인한다. **다른 계정의 post id로 DELETE를 보내
404/무변화가 나오는지**도 함께 본다 — 소유권 검사가 살아 있다는 증거는 이것뿐이다.

### Common Patterns
```ts
export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const user = await requireUser();
    const body = Schema.parse(await request.json());
    ...
  } catch (error) {
    return toErrorResponse(error);
  }
}
```

## Dependencies

### Internal
- `../../lib/auth.ts`, `../../lib/api.ts`, `../../lib/prisma.ts`
- `../../lib/ingest/*` — ingest·posts가 부른다
- `../../lib/serialize.ts`, `../../lib/types.ts`

### External
- Zod, Prisma, Next.js Route Handlers

<!-- MANUAL: -->

## `settings/profile`은 왜 `settings`와 따로인가

**본문 형식이 다르다.** 사진은 `File`로 오므로 JSON에 담으려면 base64를 거쳐야 하고, 그러면
모든 업로드가 3분의 1씩 커진다. 그래서 이 라우트만 `formData()`를 읽는다.

`fetch`에 **`Content-Type`을 직접 지정하지 말 것** — 브라우저가 multipart boundary를 붙여야
하는데, 헤더를 명시하면 boundary가 빠져서 서버 파싱이 깨진다.

**텍스트 두 필드는 항상 함께 온다.** 폼이 자기 상태 전체를 제출하므로 `/api/settings`의
"생략 = 그대로" 규칙이 여기에는 없다. 반면 사진은 세 상태다 — 파일이 오면 교체,
`removeImage=1`이면 삭제, 둘 다 없으면 그대로. **"파일이 없으면 삭제"로 줄이지 말 것:**
닉네임만 고친 저장이 사진을 매번 조용히 지운다.

**대체된 blob은 행이 커밋된 뒤에 지우고, 그 URL은 update와 같은 트랜잭션에서 다시 읽는다.**
먼저 지우면 update가 실패했을 때 행이 없는 blob을 가리킨다. 그리고 `requireUser()`가 준 행의
`imageUrl`은 업로드 *전에* 읽은 값이라서, 저장이 두 번 겹치면 둘 다 같은 옛 URL만 지우고 서로가
대체한 blob은 아무도 지우지 않는다. 삭제 실패는 무시한다(best effort) — 이미 새 사진을 가리키고
있으므로, blob 하나가 남는 것이 성공한 저장을 실패로 되돌리는 것보다 낫다.

**`maxDuration = 60`이 붙어 있다.** 6MB 본문 + 스토리지 왕복은 기본 타임아웃을 넘길 수 있고,
플랫폼 타임아웃은 504라서 한국어 메시지도 로그도 남지 않는다.

**탈퇴 라우트도 사진만은 실제로 지운다.** 소프트 삭제의 예외이고, 이유는 `imageUrl`이 행
데이터가 아니라 공개 blob URL이기 때문이다 — 자세한 것은 루트 AGENTS.md 참고.

**사진 삭제 대상 URL은 항상 그 행에서 읽어 온 값이다.** 요청 본문의 URL로 `del()`을 부르면
남의 blob을 지우는 경로가 된다.
