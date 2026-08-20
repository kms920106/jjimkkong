<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-19 | Updated: 2026-08-19 -->

# src/components

## Purpose
React 컴포넌트. 제품의 상호작용이 사실상 `HomeClient` 하나에 모여 있다 — 붙여넣기 →
후보 확인 → 저장 → 지도 반영이 전부 거기서 일어난다.

## Key Files
| File | Description |
|------|-------------|
| `HomeClient.tsx` | 메인 플로우 전체. 인제스트 요청, 후보 상태, 저장, 지도 포커스, 로그인 drawer 오픈 |
| `LinksClient.tsx` | `/links`의 목록·플랫폼 탭·삭제 |
| `UrlSheet.tsx` | 링크 붙여넣기 시트 |
| `CaptionPrompt.tsx` | 캡션을 못 가져왔을 때(`needsManualCaption`) 사용자가 직접 붙여넣는 다이얼로그 |
| `LoginDrawer.tsx` | 제공자 선택. 보던 화면을 떠나지 않아야 하는 진입점이라 drawer |
| `PhoneVerifyForm.tsx` | 번호 입력 → 코드 입력 2단계(`Step`). `/verify-phone` 페이지가 렌더 |
| `AppDrawer.tsx` | 설정 drawer — 닉네임, 지도 제공자, 로그아웃, 회원탈퇴(`AlertDialog`) |
| `LegalPage.tsx` | 약관·개인정보 공용 크롬. 서버 컴포넌트(정적 산문이라 브라우저로 보낼 것이 없다) |
| `ThemeProvider.tsx` | next-themes. shadcn 다크 팔레트가 `prefers-color-scheme`이 아니라 `.dark` 클래스에 걸려 있어서 필요 |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `map/` | 지도 제공자 3종과 스위치 (see `map/AGENTS.md`) |
| `ui/` | shadcn/ui 생성 프리미티브 (see `ui/AGENTS.md`) |

## For AI Agents

### Working In This Directory

**`signedIn` 플래그는 UI를 고르는 값일 뿐 권한이 아니다.** 이걸 근거로 서버 검사를
생략하지 말 것. 로그아웃 상태에서도 화면은 전부 그려지고, 막히는 건 API다.

**로그인 에러(`?auth=login&error=`)는 초기 상태로 한 번만 읽고 URL에서 지운다.**
남겨두면 새로고침이 이미 닫은 drawer를 다시 연다.

**`needsManualCaption`은 실패가 아니라 분기다.** 유튜브에 API 키가 없거나 인스타그램이
캡션을 안 줄 때 정상적으로 도달하는 상태이므로, 에러 토스트가 아니라 `CaptionPrompt`를
띄운다.

**"지도에 없음"과 "검색이 죽음"은 다른 문구다.** `matched: false`와 `lookupFailed: true`를
같은 메시지로 합치지 말 것.

**`/links` 카드의 제목은 게시글이다, 첫 장소가 아니다.** 릴스 하나가 6곳을 담을 수 있고,
그때 첫 장소를 제목으로 올리면 임의의 한 곳이 게시글 전체를 대표하면서 "홍대 데이트코스"라는
정체가 사라진다. `postTitle()`이 `post.title` → 첫 장소 → URL 순으로 떨어진다.

**장소가 2곳 이상인 카드만 접힌다.** 1곳이면 펼칠 것이 없고, 그 카드의 제목이 이미 그
장소라서 본문 줄은 이름과 주소를 그대로 한 번 더 찍는 중복이 된다. 그래서 1곳 카드는
주소·메모·`지도에서 보기`·⋯ 메뉴를 **머리에** 싣고 본문 리스트를 아예 그리지 않는다
(`single`). 접힌 카드는 장소 이름을 `·`로 이어 미리 보여준다 — 그게 없으면 접기가
정보를 감추기만 한다.

**접힌 동안 장소 줄은 마운트하지 않는다.** 6곳이면 포커스 가능한 줄 6개와 메뉴 6개인데,
숨기기만 하면 "접혔다"고 말하는 컨트롤 뒤에서 그것들이 탭 순서와 스크린리더 목록에 남는다.

**외부 지도 앱은 줄마다 배지로 늘어놓지 않는다.** 예전엔 장소마다 네이버맵·카카오맵 배지가
붙어서 6곳이면 배지 12개가 장소 이름과 경쟁했다. 지금은 ⋯ 메뉴 안에 들어가고 사용자의
`mapProvider`가 맨 위로 온다(`mapAppsFor()`). 구글을 고른 사용자에게 구글 항목이 아예
없던 문제도 이때 같이 없어졌다.

**저장할 때 좌표를 보내지 말 것.** 서버가 이름과 지역 힌트만 받아 다시 지오코딩한다.

**탈퇴 문구에 "모두 삭제"라고 쓰지 말 것.** 소프트 삭제라 데이터는 남는다. "다시 볼 수
없고 재로그인 시 새 계정으로 시작한다"까지만 약속한다.

**전화번호 입력은 타이핑되는 대로 숫자만 남긴다.** `010-1234-5678`을 붙여넣어도 조용히
`01012345678`이 된다. 이건 **편의이고 검사가 아니다** — 서버가 어차피 다시 정규화한다.

### Testing Requirements
클라이언트 상태 버그는 타입체크로 안 잡힌다. 브라우저에서 확인할 것:
같은 핀을 **두 번 연속** 눌러도 카메라가 다시 중심에 오는지(nonce),
무관한 게시글을 저장했을 때 카메라가 튀지 않는지(마커 ref),
지도 제공자를 바꿔도 이전 지도가 남지 않는지.

### Common Patterns
- 상호작용이 있는 것만 `"use client"`. `LegalPage`처럼 산문뿐이면 서버 컴포넌트로 둔다.
- 프리미티브는 `ui/`에서 가져오고 새로 만들지 않는다.
- 클래스 병합은 `lib/utils.ts`의 `cn()`.
- 사용자에게 보이는 문자열은 전부 한국어.

## Dependencies

### Internal
- `../lib/types.ts` — 서버와 공유하는 DTO
- `../lib/map/` — 로더·타입·`useMarkerLookup`
- `../lib/utils.ts` — `cn()`

### External
- React 19, `@base-ui/react`(shadcn 기반), lucide-react, sonner, next-themes

<!-- MANUAL: -->
