<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-19 | Updated: 2026-08-19 -->

# src/lib/map

## Purpose
지도 제공자 3종(네이버·카카오·구글)이 공유하는 것들: SDK 로더, 공용 타입, 마커 조회 훅.
제공자별 렌더링은 여기가 아니라 `components/map/`에 있다.

## Key Files
| File | Description |
|------|-------------|
| `loader.ts` | `loadNaverMaps()`/`loadKakaoMaps()`/`loadGoogleMaps()` — 페이지당 한 번만 주입하고 전역이 실제 사용 가능해진 뒤 resolve |
| `types.ts` | `MapMarker`, `FocusRequest`, `MapViewProps`, `DEFAULT_CENTER`(서울시청)·`DEFAULT_ZOOM`·`FOCUS_ZOOM` |
| `useMarkerLookup.ts` | 마커를 ref에 담아 id로 조회하는 훅 |
| `externalLinks.ts` | 외부 지도 앱 URL·길찾기 링크. `/links` 카드와 `PlaceSheet`가 공유 |

## For AI Agents

### Working In This Directory

**`load` 이벤트만으로는 아무것도 보장되지 않는다.** 권한 없는 키도 200을 돌려주지만
그 본문은 네임스페이스를 정의하지 않는다. 그래서 로더는 전역 객체가 실제로 나타난 뒤에야
resolve한다. 카카오는 `autoload=false`로 주입되므로 `kakao.maps.load()` 콜백까지
기다려야 한다.

**`FocusRequest`의 nonce를 지우지 말 것.** 같은 장소를 두 번 눌러도 다시 중심에 와야
하는데, React는 상태가 그대로면 렌더를 건너뛴다. `placeIds`만으로는 두 번째 클릭이
아무 일도 일으키지 않는다.

**`FocusRequest.placeIds`는 배열이다.** 게시글 하나가 장소 여러 곳을 담을 수 있어서
(릴스 하나에 6곳), "이것 보여줘"와 "이것들 보여줘"가 서로 다른 카메라 이동이기 때문이다.
단일 id로 되돌리면 `/links`의 "N곳 모두 보기"를 표현할 수 없다. 홈은 `?place=`를
쉼표로 끊어 읽는다.

**마커는 effect 의존성이 아니라 ref(`useMarkerLookup`)에 담는다.** 그러지 않으면 무관한
게시글을 저장할 때마다 마커 배열이 새로 만들어지고, 카메라가 마지막으로 포커스한 핀으로
끌려간다.

**로더는 페이지당 한 번이다.** `pending` 맵이 중복 주입을 막는다. 제공자를 추가하면
같은 패턴(고유 script id + 전역 확인)을 따른다.

**외부 지도 링크는 퍼머링크가 아니라 이름 검색이다**(`externalLinks.ts`). 어느 제공자도
링크 걸 place id를 주지 않고, `place.naverLink`는 지도 페이지가 아니라 업체 홈페이지다.
예외는 게시글 자체가 지도 링크인 경우(`Platform.NAVER`/`KAKAO`)뿐이고, `targetForApp()`이
그 퍼머링크를 **자기 제공자 자리에 끼워 넣는다** — 줄을 하나 더 만들면 정확도만 다른
네이버맵 항목이 둘이 된다. `/links`와 `PlaceSheet`가 같은 함수를 쓴다.

**그 링크는 URL 문자열이 아니라 `MapTarget`이다. 이유는 iOS 홈화면 앱이다.**
루트 AGENTS.md의 "이 앱은 iOS 홈화면에 추가해서 쓴다" 절이 근거이고, 요약하면:
Universal Link는 iOS가 네이티브 앱에 넘기므로 **우리 창이 navigate하지 않아** 보던
게시글이 남지만, Universal Link가 아닌 https URL은 그냥 웹 페이지로 열려 화면을 덮는다.
그래서 두 종류를 타입으로 구분한다.

- `kind: "url"` — 카카오·구글·퍼머링크. 앵커 기본 동작에 그대로 맡긴다.
- `kind: "scheme"` — 네이버 전용. `openMapApp()`이 처리한다.

**세 제공자의 URL은 임의로 바꾸지 말 것. 각각 실측으로 고른 형태다.**

| 제공자 | 형태 | 이유 |
|---|---|---|
| 카카오 | `m.map.kakao.com/actions/searchView?q=` | **`m.` 필수.** `map.kakao.com`의 AASA는 문자열이 닫히지 않은 **깨진 JSON**이고, 모바일 UA에서 `/?q=`는 `applink.map.kakao.com`(앱 설치 안내 페이지)으로 302된다 — 이 변경이 없애려던 바로 그 화면이다. `m.` 쪽은 정상 JSON이고 `/actions/searchView`가 그 안에 있다. `map.kakao.com/actions/searchView`는 404로 리다이렉트된다(실측) |
| 구글 | `google.com/maps/search/?api=1&query=` | 공식 문서상 Universal Link. 앱이 없으면 같은 URL이 웹 지도를 띄운다 |
| 네이버 | `nmap://place?lat=&lng=&name=&appname=` | `map.naver.com`에 **AASA가 아예 없다** → https는 웹으로 열린다. 스킴만이 앱에 직접 닿는다 |

**네이버의 `nmap://`에서 `appname`은 필수 파라미터이고, `place`는 `lat`·`lng`·`name`
셋 다 요구한다**(공식 문서). 좌표가 이미 `SavedPlaceDTO`에 있으므로 이름 검색보다 정확하다.

**앵커의 `href`에는 스킴이 아니라 폴백 URL을 넣는다**(`hrefOf()`). JS 없이도, 링크 복사에도
유효해야 하고, 데스크톱 방문자에게 `nmap://`은 열 수 없는 링크다.

**지도 버튼에 `target="_blank"`를 다시 붙이지 말 것.** standalone 모드에서 그건 새 탭이
아니라 **in-app 브라우저 오버레이**이고, 사용자가 닫아야 하는 시트를 하나 더 만들면서
네이티브 앱 핸드오프를 가린다. (인스타그램 `SourceLink`의 `_blank`는 그대로 둔다 —
Universal Link라 이미 잘 동작하며 건드릴 이유가 없다.)

**`visibilitychange`는 `document`에 걸어야 한다. `window`가 아니다.** 이 이벤트는
버블링하지 않으므로(실측) window 리스너는 **영원히 발화하지 않고**, 그러면 앱이 정상적으로
열린 뒤에도 폴백 타이머가 살아남아 우리 페이지를 네이버 웹 지도로 덮는다 — 이 모듈이
막으려고 존재하는 바로 그 버그다. `pagehide`는 반대로 window 이벤트이니, 두 리스너의
대상이 서로 다르다는 것 자체가 의도된 것이다(등록과 해제의 대상도 각각 맞춰야 한다).

**진행 중인 시도는 모듈 스코프에 하나만 둔다**(`inFlight`). 게시글 하나가 장소 여섯 곳을
담을 수 있어서 네이버맵 칩 두 개가 손가락 하나 너비 안에 있고, 첫 탭의 타이머가 살아 있는
채로 두 번째를 누르면 앱이 없을 때 **두 타이머가 각각 이동을 시도한다** — 사용자가 마지막에
누른 B가 아니라 A의 지도에 도착할 수 있다. 새 시도가 이전 시도를 무효화한다.

**두 렌더 지점은 반드시 함께 움직인다**: `components/PostDetailClient.tsx`의 `PlaceCard`와
`components/PlaceSheet.tsx`. 둘 다 `targetForApp()` + `hrefOf()` + `onClick`의 같은 삼종
세트를 쓴다.

### Testing Requirements
각 지도 콘솔의 허용 도메인에 `http://localhost:4000`과 배포 도메인이 등록되어 있어야
한다. **없으면 지도는 아무 말 없이 렌더링에 실패한다** — 콘솔 에러도 안 뜨는 경우가
있으니 "코드가 맞다"로 판단하지 말고 실제로 핀이 보이는지 확인한다.

설정에서 제공자를 바꿔 가며 세 가지를 다 띄워 본다. 전환은 컴포넌트를 완전히 해체하므로
(provider가 key), 한 제공자에서 되는 것이 다른 제공자에서 된다는 보장이 없다.

### Common Patterns
좌표 기본값은 서울시청(`37.5666, 126.9784`). 저장된 핀이 없을 때의 초기 화면이다.

## Dependencies

### Internal
- `../../components/map/*` — `MapView` 스위치와 제공자별 구현
- `../../types/maps.d.ts` — 전역 SDK 타입 선언
- `../types.ts` — `MapProvider`

### External
- 네이버 지도 / 카카오맵 / Google Maps JavaScript SDK
  (`NEXT_PUBLIC_NAVER_MAP_CLIENT_ID`, `NEXT_PUBLIC_KAKAO_MAP_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_KEY`)

<!-- MANUAL: -->
