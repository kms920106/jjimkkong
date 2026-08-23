<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-19 | Updated: 2026-08-19 -->

# src/app/(app)

## Purpose
사용자에게 보이는 페이지 전부. 라우트 그룹이라 URL에는 `(app)`이 나타나지 않는다.
**여기 페이지는 전부 로그인 없이 열린다.**

## Key Files
| File | Description |
|------|-------------|
| `layout.tsx` | 공용 크롬 없음(의도). 홈은 전체화면 지도가 자기 버튼을 띄우고, 나머지 페이지는 각자 헤더를 들고 온다 |
| `page.tsx` | 홈 `/` — 붙여넣기 입력 + 지도 + 목록. `getUser()`로 세션을 읽고 `HomeClient`에 넘긴다 |
| `links/page.tsx` | `/links` — 저장한 링크 그리드. 플랫폼 탭으로 갈린다 |
| `links/[id]/page.tsx` | `/links/[id]` — 게시글 상세. 썸네일·캡션 + 장소 swiper. 여기만 `notFound()`를 쓴다 |
| `links/[id]/loading.tsx` | 위와 같은 이유의 스켈레톤. 그리드는 눌린 티가 안 나므로 특히 필요하다 |
| `profile/page.tsx` | `/profile` — 프로필 수정(사진·닉네임·상태메세지). drawer의 연필이 여기로 온다 |
| `profile/loading.tsx` | 위와 같은 이유의 스켈레톤. 아래 "`/links`는 `loading.tsx`가 필요하다" 참고 |
| `settings/page.tsx` | `/settings` — 설정 목록. 비밀번호·약관·지도·로그아웃·회원탈퇴 |
| `settings/loading.tsx` | 위와 같은 이유의 스켈레톤 |
| `settings/password/page.tsx` | `/settings/password` — 비밀번호 설정·변경(현재 → 새 비밀번호 2단계) |
| `settings/password/loading.tsx` | 위와 같은 이유의 스켈레톤 |
| `terms/page.tsx` | `/terms` — 이용약관 |
| `privacy/page.tsx` | `/privacy` — 개인정보처리방침 |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `links/` | 저장 링크 그리드와 게시글 상세(`[id]/`) |
| `profile/` | 프로필 수정 페이지 |
| `settings/` | 설정 목록과 비밀번호 변경 페이지 |
| `terms/`, `privacy/` | 법적 고지 — 정적 산문, 서버 컴포넌트 |

## For AI Agents

### Working In This Directory

**`requireUser()`를 페이지에 넣지 말 것.** 페이지는 `getUser()`를 부르고, 세션이 없으면
빈 지도·빈 목록을 렌더링한 뒤 `LoginDrawer`로 로그인을 권한다. 실제 게이트는 API다.

**세션 쿠키를 읽으므로 `dynamic = "force-dynamic"`이 필요하다.** 홈과 링크 목록에 이미
걸려 있다. 새 페이지가 `getUser()`를 부르면 여기도 붙인다.

**`layout.tsx`에 공용 헤더를 넣지 말 것.** 홈이 전체화면 지도라서 그렇다. 헤더가 필요한
페이지는 `LegalPage` 같은 자기 크롬을 쓴다.

**법적 문서는 서버 컴포넌트로 둔다.** 상호작용이 없는 산문이므로 브라우저로 보낼 이유가
없다. 운영자 정보와 시행일은 `lib/legal.ts`에 있으니 페이지에 하드코딩하지 말 것 —
두 문서가 같은 값을 각자 들고 있으면 한쪽만 갱신된다.

### Testing Requirements
**로그아웃 상태로 먼저 연다.** 홈·링크·설정·비밀번호·약관·개인정보가 전부 열리고,
홈에서 저장을 시도하면 401이 나야 한다. 로그인 상태에서 핀과 목록이 채워지는지 확인한다.

### Common Patterns
- 서버 컴포넌트가 세션과 초기 데이터를 읽어 `*Client` 컴포넌트에 props로 넘긴다.
- Prisma 행은 `toSavedPostDTO()`를 거쳐 넘긴다. 직접 넘기면 직렬화가 깨진다.
- `metadata` export로 페이지 제목을 준다(`… · 찜꽁`).

## Dependencies

### Internal
- `../../lib/auth.ts` (`getUser`), `../../lib/serialize.ts`, `../../lib/legal.ts`
- `../../components/HomeClient.tsx`, `LinksClient.tsx`, `LegalPage.tsx`

### External
- Next.js App Router 라우트 그룹

<!-- MANUAL: -->

## `/links`는 `loading.tsx`가 필요하다

이 페이지는 `force-dynamic`이라 세션 조회와 게시글 조회가 끝나야 HTML이 존재한다. 즉
`<Link href="/links">`의 prefetch가 미리 만들어 둘 payload가 없다. `loading.tsx`가 없으면
라우터가 클릭 시점에 그릴 것이 아무것도 없어서, drawer가 닫힌 뒤 서버 왕복이 끝날 때까지
**이전 화면이 그대로 멈춰 있다** — 사용자에게는 느린 게 아니라 버튼이 안 먹은 것으로 보인다.

스켈레톤의 컨테이너 클래스는 `LinksClient`의 최상위(`flex w-full flex-col gap-4 px-4 py-6`)와
**정확히 같아야 한다.** 다르면 실제 데이터로 교체되는 순간 레이아웃이 튄다. 헤더를 공유하지 않고
복제한 이유는 스켈레톤이 `posts`/`mapProvider`/`signedIn` 없이 렌더돼야 하기 때문이다 —
그게 바로 아직 기다리는 중인 값들이다.

## `/links`는 그리드이고, 상세는 `/links/[id]`다

목록은 제목·작성자·장소 이름·장소마다의 ⋯ 메뉴를 카드마다 들고 있었다. 지금은 **썸네일만
꽉 채운 3열 그리드**이고, 셀 하나가 통째로 `/links/[id]`로 가는 링크다.

이유는 **한 화면에 들어가는 개수**다. 예전 목록은 한 화면에 4개, 그리드는 15개가 들어간다.
저장한 링크를 다시 찾는 행동은 이름을 읽는 게 아니라 **그림을 알아보는 것**이라, 스캔할
대상이 많을수록 목적에 맞는다. 버린 정보는 사라진 게 아니라 상세로 옮겼다.

**셀에는 글자를 넣지 않는다.** 캡션 한 줄을 붙이면 그리드의 빈틈없음이 깨지고, 그게
이 화면이 목록보다 나은 유일한 이유다. 대신 **접근 가능한 이름이 게시글의 정체를 나른다**
(`온천집 — 장소 3곳`) — 셀에 보이는 글자가 없으므로 이걸 빼면 스크린리더에는 링크 15개가
전부 똑같이 읽힌다. 우상단 배지는 그 이름이 이미 말한 것을 반복하므로 `aria-hidden`이다.

**`gap-px`에 `bg-border`이지 `gap-0`이 아니다.** 어두운 썸네일 둘이 붙으면 한 장의 사진으로
읽히는데, border를 쓰면 레이아웃 계산이 딸려 온다. 1px 틈이 배경색을 드러내게 하는 쪽이 싸다.

**`/links/[id]`는 이 디렉터리에서 유일하게 `notFound()`를 쓴다.** 위의 "페이지는 로그인 없이
열린다"에 대한 예외처럼 보이지만 아니다 — 게시글은 소유자에게 묶여 있어서 세션이 없으면
**조회할 `userId` 자체가 없다.** 로그아웃 상태의 홈 지도에 핀이 없는 것과 같은 상태이지,
로그인으로 걷어내는 것이 아니다. **리다이렉트로 바꾸지 말 것.** 남의 게시글도 없는 게시글과
똑같이 404여야 한다 — 구분하면 어떤 id가 존재하는지 누설된다.

`deletedAt: null` 필터가 여기에도 있어야 한다. 루트 AGENTS.md가 "함께 움직인다"고 적은
읽기 필터 목록에 이 라우트가 추가됐다 — 빠지면 지운 링크가 자기 URL에서 계속 열린다.

## 상세 하단의 장소는 가로 swiper다

세로 목록이 아니라 **CSS scroll-snap 가로 스크롤**이다. 이 페이지는 세로 예산을 이미 사진과
캡션에 다 썼고, 6곳짜리 데이트코스를 세로로 늘어놓으면 전부 접힌 화면 밑으로 내려간다.

**캐러셀 라이브러리를 넣지 않았다.** 브라우저의 터치 스크롤이 폰에서 기대되는 동작 그대로이고,
JS 없이 첫 페인트부터 동작하며, 라이브러리는 평범한 스크롤러가 공짜로 맞히는 키보드·포커스
동작을 가져가 버린다.

**카드 폭이 78%인 것은 다음 카드의 가장자리를 보이게 하려는 것이다.** 100%면 스크롤된다는
사실 자체가 화면에 없어서 정지 화면으로 읽힌다. `shrink-0`이 없으면 flex가 카드를 전부
압축해 넣어 버리므로 둘 다 필요하다.

**가로 overflow는 그 `<ul>` 안에 갇혀야 한다.** 페이지 body가 가로로 스크롤되면 폰에서
화면 전체가 흔들린다.

**분류는 `formatCategory()`를 거친다**(`lib/place-category.ts`). 네이버가 주는 값은
`음식점>일식>카레`처럼 공백이 없어서 한 덩어리로 렌더되고 아무 데서나 줄바꿈된다.
구분자에 공백을 넣으면 브라우저가 끊을 자리를 얻는다. 값이 없으면 `null`을 돌려주므로
호출부는 `{category && …}` 하나만 검사한다 — `""`를 만들면 "없음" 상태가 둘이 된다.

## `/profile`도 같은 이유로 `loading.tsx`를 갖는다

`force-dynamic`이고 drawer의 연필에서 진입하므로 위 `/links` 설명이 그대로 적용된다.
스켈레톤 컨테이너는 `ProfileEditClient`의 최상위(`mx-auto flex w-full max-w-md flex-col
gap-6 px-4 py-6`)와 정확히 같아야 한다.

**이 페이지도 `requireUser()`를 쓰지 않는다.** 로그아웃 상태에서는 폼이 disabled로 렌더되고
안내 문구가 뜬다. 실제 게이트는 `PATCH /api/settings/profile`이고, 그쪽은 401을 준다.

## `/settings`와 `/settings/password`도 `loading.tsx`를 갖는다

둘 다 `force-dynamic`이고 drawer의 `설정` 행에서 진입하므로 위 `/links` 설명이 그대로
적용된다. 스켈레톤 컨테이너는 각각 `SettingsClient`의 최상위(`mx-auto flex w-full max-w-md
flex-col gap-6 py-6` — 행이 화면 끝까지 닿아야 해서 가로 패딩이 컨테이너가 아니라 행에 있다)와
`PasswordSettingPageClient`의 최상위(`mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-6`)와
정확히 같아야 한다.

**둘 다 `requireUser()`를 쓰지 않는다.** `/settings`는 로그아웃 상태에서 약관·개인정보 행을
그대로 살려 두고(법적 고지는 로그인 뒤로 숨길 수 없다) 계정 행만 disabled로 그린다.
`/settings/password`는 폼 대신 안내 문구를 그린다. 게이트는 `PATCH /api/settings`,
`DELETE /api/account`, `POST /api/settings/password`다.
