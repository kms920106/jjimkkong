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
| `links/page.tsx` | `/links` — 저장한 링크 목록. 플랫폼 탭으로 갈린다 |
| `terms/page.tsx` | `/terms` — 이용약관 |
| `privacy/page.tsx` | `/privacy` — 개인정보처리방침 |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `links/` | 저장 링크 목록 페이지 |
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
**로그아웃 상태로 먼저 연다.** 홈·링크·약관·개인정보 네 페이지가 전부 열리고,
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
