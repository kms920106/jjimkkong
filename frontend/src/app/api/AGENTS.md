<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-19 | Updated: 2026-08-19 -->

# src/app/api

## Purpose
**인가가 실제로 일어나는 유일한 층.** proxy(미들웨어)가 삭제되고 페이지가 로그인 없이
열리게 되면서, 라우트 핸들러의 `requireMember()`가 유일한 게이트가 됐다.

## Key Files
| File | Description |
|------|-------------|
| `ingest/route.ts` | `POST` — metadata → extract → geocode. 같은 canonical `sourceUrl`의 `Post`가 이미 있으면 **저장된 값을 즉시 돌려주고 세 단계를 전부 건너뛴다.** `maxDuration = 60` |
| `posts/route.ts` | `GET` 목록 / `POST` 저장. 새 게시글이면 확인된 장소를 **서버에서 다시 지오코딩**하고, 이미 있는 `Post`면 건너뛴다. `maxDuration = 60` |
| `posts/[id]/route.ts` | `DELETE` — **소프트 삭제.** `Bookmark`에 `deletedAt`을 찍고, `where`의 `memberId`가 소유권 검사다. 썸네일 blob은 건드리지 않는다 |
| `places/[id]/sources/route.ts` | `GET` — 이 장소를 언급한 게시글 전부. 인증 없다. 공유 `Post`에 매달린 `PostPlace`를 읽으므로 `deletedAt` relation 필터도, `memo`도 없다 |
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

**모든 핸들러가 `requireMember()`를 부르고 반환된 `memberId`로 쿼리를 한정한다.**
Prisma는 테이블 소유자로 접속해 Postgres RLS를 우회하므로, DB가 대신 막아주지 않는다.
`where`에서 `memberId`를 빼면 그 행이 모든 사용자에게 조용히 열린다. 소프트 삭제 모델에서는
그 검사가 `findFirst({ where: { id, memberId, deletedAt: null } })` + `update`의 모양으로
있다 — `lib/prisma-guard.ts`는 **삭제를 막을 뿐 잘못 범위 잡힌 update를 막지 못한다.**

**하드 삭제는 `lib/prisma-guard.ts`가 런타임에서 막는다.** `delete`/`deleteMany`가 허용된
모델은 셋(`Session`·`PhoneVerification`·`PasswordAttempt`)이고, 나머지는
`HardDeleteBlockedError`로 throw되며 Postgres에 닿지 않는다. **새 라우트에서 행을 지워야
한다고 느끼면 그건 대개 소프트 삭제해야 한다는 신호다** — 자세한 것은 루트 AGENTS.md와
`lib/AGENTS.md` 참고.

**클라이언트가 보낸 좌표는 절대 믿지 않는다.** `Place`는 사용자 간 공유이고
`[name, address]`가 키다. 요청 본문의 lat/lng을 그대로 받으면 한 사용자가 남의 핀을
옮길 수 있다. `POST /api/posts`는 이름과 지역 힌트만 받고 서버에서 다시 지오코딩하며,
이미 있는 `Place`는 `update: {}`로 upsert한다 — 다른 게시글의 것이기도 하기 때문이다.

**단 이미 있는 `Post`에는 지오코딩을 하지 않는다.** 장소 목록은 공유 `Post`에 이미
`PostPlace`로 붙어 있고 그 행들은 첫 저장이 쓴 뒤 바뀌지 않으므로, 다시 조회할 것이 없다.
지오코딩 여부를 결정하는 `findUnique`는 트랜잭션 **밖**에서 먼저 돈다 — 초 단위 네트워크가
트랜잭션 안에 들어가면 안 된다.

**저장 트랜잭션 안에서는 장소를 정렬한 뒤 upsert한다.** 동시에 도는 트랜잭션들이 락을
같은 순서로 잡게 하기 위해서다. 이 정렬을 빼면 데드락이 난다.

**`PostPlace`는 첫 저장이 쓴 뒤 바뀌지 않는다.** 그게 창작자가 게시글에서 나열한 장소
목록이고, 재저장이 덧붙이거나 교체하는 대상이 아니다. 회원이 쓰는 것은 `BookmarkMemo`이고
그쪽은 `upsert`다 — 아무것도 지우지 않으므로, 언급하지 않은 메모를 떨어뜨리지 않고 언급한
것만 갱신한다.

**재저장은 소프트 삭제된 `Bookmark`를 되살린다.** `deletedAt`을 `null`로 되돌리는 것이
그 부활이고, 그래서 `memberSeq`와 메모가 그대로 남아 URL도 노트도 예전 그대로다. 옆에 새
행을 만들지 않는 것은 `[memberId, postId]`가 이제 **진짜 유니크**(live-only partial index가
아니라)이기 때문이다 — 옛 `[userId, sourceUrl]` partial unique index는 사라졌다.
`Bookmark`의 유니크는 `[memberId, postId]`와 `[memberId, memberSeq]` 둘이다.

**링크 삭제도 삭제가 아니라 상태 변경이다.** `DELETE /api/posts/[id]`는 `Bookmark`에
`deletedAt`을 찍을 뿐이고, 그 행이 메모와 `memberSeq`를 그대로 들고 있는 것이 위의 부활을
가능하게 한다. 삭제는 **북마크의 id로 지정하고**(`memberSeq`가 아니라 — 그건 표시용이고,
쓰기를 그걸로 라우팅하면 어떤 행인지 모르고 "내 세 번째 북마크"를 겨눌 수 있다) 소유권은
어느 쪽이든 `memberId` 한정이 지킨다.

**썸네일 blob은 이 라우트가 건드리지 않는다.** 이미지는 공유 `Post`의 것이고 다른 회원이
아직 그 링크를 북마크하고 있을 수 있으므로, 한 사람의 취소가 모두의 사진을 깨뜨려서는 안
된다. **저장·삭제 경로의 blob 참조 카운트 로직은 전부 사라졌다** — blob이 소유 행 하나만
갖고, 한 번 쓰인 뒤 대체되지 않으므로 셀 것이 없다.

이 라우트를 고칠 때 **읽기 필터를 함께 본다.** 이 디렉터리에 셋이 있다 —
`GET /api/posts`, `POST /api/posts`의 기존 `Bookmark` 조회, 그리고
`DELETE /api/posts/[id]`의 `findFirst`. 나머지는 페이지(`(app)/page.tsx`,
`(app)/links/page.tsx`, `(app)/links/[id]/page.tsx`, `(app)/author/[id]/page.tsx`,
`(app)/settings/page.tsx`)에 있다. 전체 목록과 각각이 빠졌을 때 무슨 일이 생기는지는
루트 AGENTS.md에 있다.

**`GET /api/places/[id]/sources`는 이제 이 목록에 없고, 그 이유가 남길 만하다.** 예전에는
회원별 조인 테이블을 읽었으므로 저장한 **회원마다** 행이 하나씩 나왔고, 지운 링크가 낯선
사람에게 보이지 않게 하려면 **relation 필터**(`post: { deletedAt: null }`)가 필요했다 —
빠뜨리면 프라이버시 버그였고, 컬럼이 다른 테이블에 있어서 빠뜨리기 쉬웠다. 지금은 공유
`Post`에 매달린 `PostPlace`를 읽는다: 회원도 `deletedAt`도 없고 게시글당 한 행이므로,
회원별로 누설될 것이 아예 없다. 그래서 `memo`도 돌려주지 않는다(메모는 `BookmarkMemo`,
즉 그 회원의 것이다). 모든 회원이 북마크를 취소한 뒤에도 장소는 자기 출처를 유지하는데,
그건 의도다 — 핀이 공유물이므로 시트는 "지금 누가 들고 있나"가 아니라 "어느 게시글이 이
장소를 언급하나"를 말한다.

**탈퇴는 삭제가 아니라 상태 변경이다.** `Member`·`AuthIdentity`·`Bookmark`는 전부
남는다. `Session`만 지우는데, 남겨두면 살아 있는 쿠키가 탈퇴 계정을 가리킨 채
`requireMember()` 검사 하나에만 의존하게 되기 때문이다. **UI 문구로 "모두 삭제"라고 쓰지
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

소프트 삭제는 **지운 뒤에 확인해야 하는 것이 셋**이다: 홈 지도·`/links`·`/settings` 개수와
그 작성자 페이지에서 사라졌는가, `/links/<seq>`가 404가 되는가, 그리고 **같은 링크를 다시
저장하면 옛 북마크가 그대로 되살아나는가**(같은 `memberSeq`, 같은 메모 — 옆에 새 행이 생기면
안 된다). 행이 남는다는 점 때문에 화면에서 사라진 것만으로는 아무것도 증명되지 않는다.
반면 **그 장소의 시트(`/api/places/[id]/sources`)에서는 사라지지 않는 것이 정상이다** —
위의 설명 참고.

### Common Patterns
```ts
export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const member = await requireMember();
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
먼저 지우면 update가 실패했을 때 행이 없는 blob을 가리킨다. 그리고 `requireMember()`가 준 행의
`imageUrl`은 업로드 *전에* 읽은 값이라서, 저장이 두 번 겹치면 둘 다 같은 옛 URL만 지우고 서로가
대체한 blob은 아무도 지우지 않는다. 삭제 실패는 무시한다(best effort) — 이미 새 사진을 가리키고
있으므로, blob 하나가 남는 것이 성공한 저장을 실패로 되돌리는 것보다 낫다.

**`maxDuration = 60`이 붙어 있다.** 6MB 본문 + 스토리지 왕복은 기본 타임아웃을 넘길 수 있고,
플랫폼 타임아웃은 504라서 한국어 메시지도 로그도 남지 않는다.

**탈퇴 라우트도 사진만은 실제로 지운다.** 소프트 삭제의 예외이고, 이유는 `imageUrl`이 행
데이터가 아니라 공개 blob URL이기 때문이다 — 자세한 것은 루트 AGENTS.md 참고.

**사진 삭제 대상 URL은 항상 그 행에서 읽어 온 값이다.** 요청 본문의 URL로 `del()`을 부르면
남의 blob을 지우는 경로가 된다.

**`POST /api/ingest`는 이미 있는 게시글이면 세 단계를 전부 건너뛴다.** 같은 canonical
`sourceUrl`의 `Post`가 있으면 크롤·LLM 호출·지오코딩 없이 저장된 값을 그대로 돌려준다 —
남이 이미 저장한 링크를 붙여넣는 것이 그 셋을 하나도 태우지 않고 북마크된다. 판정 키가
`sourceUrl`인 이유는 그게 게시글의 정체이기 때문이다. 그래서 **`describePost()`가 정규화한
값으로 조회한다** — 원본 문자열로 찾으면 트래킹 파라미터 하나가 이미 있는 게시글을 새 것으로
보이게 한다. 수동 캡션이 왔다는 것은 이 건너뛰기를 취소할 이유가 **아니다.**

**`POST /api/ingest`만 스트리밍(NDJSON)이다.** 나머지 라우트는 전부 한 번에 답한다.
스트리밍 라우트에서는 첫 바이트와 함께 status가 확정되므로 **그 뒤의 실패를 `toErrorResponse()`로
돌려줄 수 없다** — `describeError()`로 같은 문구·status를 얻어 `error` 이벤트로 본문에 실어
보낸다. 인증(`requireMember()`)과 Zod 검증은 스트림을 열기 전에 두어 401/400이 진짜 status로
남게 한다. 자세한 내용은 루트 AGENTS.md의 "`POST /api/ingest`는 NDJSON을 스트리밍한다" 참고.
