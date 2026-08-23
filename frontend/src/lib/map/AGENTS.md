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
예외는 게시글 자체가 지도 링크인 경우뿐이고, `hrefForApp()`이 그 퍼머링크를 **자기 제공자
자리에 끼워 넣는다** — 줄을 하나 더 만들면 정확도만 다른 항목이 둘이 된다. `/links`와
`PlaceSheet`가 같은 함수를 쓴다.

**그 예외는 카카오에만 있고, 비대칭이 의도된 것이다.** 퍼머링크도 결국 홈화면 앱의 앵커에
실리므로 **Universal Link가 아니면 게시글을 날린다** — 이 파일이 막으려는 그 실패다.
`canonicalize()`가 저장하는 형태로 판정한다:

| 플랫폼 | 저장되는 퍼머링크 | AASA | 처리 |
|---|---|---|---|
| KAKAO | `place.map.kakao.com/<id>` | O (`/*`) | 퍼머링크를 쓴다 |
| NAVER | `map.naver.com/p/entry/place/<id>` | **X** | 퍼머링크를 버리고 `naverMapUrl()`의 좌표 핀으로 떨어진다 |

네이버 퍼머링크를 "복원"하지 말 것. 사용자가 볼 수 없는 정확도보다 페이지를 잃지 않는 것이
낫다.

**카카오·구글은 Apple Universal Link이고, iOS 홈화면 앱에서는 그게 설계의 전부다. 네이버만
`nmap://` 스킴이다**(아래 "네이버만 `nmap://` 스킴이고" 참고).
루트 AGENTS.md의 "이 앱은 iOS 홈화면에 추가해서 쓴다" 절이 근거다. Universal Link는 iOS가
네이티브 앱에 바로 넘기므로 **우리 창이 navigate하지 않아** 보던 게시글이 그대로 남고, 앱이
없으면 같은 URL이 제공자의 웹 지도를 띄운다 — 그 두 성질을 공짜로 얻는 것이 이 방식을 쓰는
이유다. 네이버는 그 선택지가 없어서 스킴을 쓰고, 앱 미설치 시의 거동도 그만큼 다르다.

**어느 쪽이든 앵커의 `href`에 들어가는 것이 전부다.** `onClick`도, 타이머도, 호출부에서
스킴/URL을 갈라 보는 분기도 없다 — `hrefForApp()`이 돌려주는 문자열을 그대로 쓴다.

**호스트와 경로는 임의로 바꾸지 말 것. 각각 실측으로 고른 형태다.**

| 제공자 | 형태 | 이유 |
|---|---|---|
| 네이버 | `nmap://place?lat=&lng=&name=&appname=` | 어느 네이버 호스트도 외부 앱에서 오는 탭을 claim하지 않는다. 공식 문서가 주는 유일한 수단 |
| 카카오 | `m.map.kakao.com/actions/searchView?q=` | `map.kakao.com`의 AASA는 문자열이 닫히지 않은 **깨진 JSON**이고, 모바일 UA에서 `/?q=`는 `applink.map.kakao.com`(앱 설치 안내 페이지)으로 302된다 |
| 구글 | `google.com/maps/search/?api=1&query=` | 공식 문서상 Universal Link |

**네이버만 `nmap://` 스킴이고, 거기 도달하기까지 두 번 틀렸다. 둘 다 되돌리지 말 것.**

1. **첫 번째**: `map.naver.com`에 AASA가 없는 것을 보고 `nmap://`을 골랐는데 — 여기까지는
   맞았다 — 거기에 **1.5초 타이머 폴백**을 붙였다. 그 폴백이 스킴과 경쟁해서 **이겼고**, 앱은
   폴백의 `/search?query=`를 받아 좌표로 지목한 핀 대신 **이름 검색 결과**("위치 정보 없음 /
   서울특별시 중구 중심으로 …")를 띄웠다. 앱이 없을 때는 같은 폴백이 게시글을 웹 지도로 덮었다.
2. **두 번째**: `m.map.naver.com`·`inapp.map.naver.com`의 AASA에서 `launchApp/*`을 발견하고
   그 https URL로 바꿨다. **홈화면 앱에서 동작하지 않는다** — 앱이 설치돼 있는데도 우리 창이
   그 페이지로 **이동**하고 URL에 `#applink`가 붙고 앱은 실행되지 않았다.

**`#applink`가 두 번째 실패의 증거다.** 그 해시는 네이버 launch SPA가 자기 JS로 붙인다
(`location.hash.indexOf("applink")<0 && …`) — `navermaps://` 시도 *이전에*. 즉 페이지가
끝까지 로드되어 스크립트를 실행했다는 뜻이고, **iOS가 URL을 claim하지 않았다는** 뜻이다.
이어진 `navermaps://`도 실패했다(문서에 없는 내부 스킴이다).

**서버 쪽에서 검사할 수 있는 것은 전부 통과한다. 다시 확인하지 말 것:**

- Apple **자신의 CDN 사본**(`app-site-association.cdn-apple.com/a/v1/…`, iOS가 실제로 읽는
  파일)이 200이고 배포 앱 `6379BPE45W.com.nhncorp.NaverMap`에 `/launchApp/*`을 준다.
- `/launchApp/place`는 `/launchApp/*` 패턴에 매칭된다.
- 네이버는 `application/json`으로 서빙한다. **카카오는 `text/plain`인데도 동작한다.**
- 실제 앵커 탭이었다(프로그래매틱 이동이 아니다).

그래서 AASA는 원인이 아니다. 외부에서 확인할 수 없는 나머지 절반이 **앱 바이너리의
Associated Domains 엔타이틀먼트**이고, 호스트 이름 `inapp`이 답을 시사한다 — 네이버 자기 앱의
인앱 웹뷰용이고 외부 앱에서 오는 링크 대상이 아니다. **standalone에서 Universal Link 자체가
안 되는 것은 아니다** — 카카오·구글이 평범한 https로 앱을 띄우며 찜꽁을 유지한다(확인됨).

**타이머·App Store 폴백·`onClick`을 붙이지 말 것. 공식 문서가 타이머를 권해도 그렇다.**
폴백은 핸드오프 성공 여부를 판정해야 하는데 standalone에서는 판정할 수 없다 — Page Visibility
API가 잘못된 상태로 발화한다(WebKit
[#202399](https://bugs.webkit.org/show_bug.cgi?id=202399)). 그 추측이 첫 번째 실패의 원인
그 자체다. 대가는 앱 없는 방문자가 iOS의 "페이지를 열 수 없습니다"만 보는 것이고(카카오·구글은
웹 지도로 떨어진다), 반대쪽 대가가 "보던 게시글을 잃는 것"이라 감수했다. 네이버가 이 앱의
기본 제공자라는 점도 근거다.

**`appname`은 필수다.** 공식 문서상 모든 `nmap://` URL에 있어야 하는 호출자 라벨이고, 웹에서는
사이트 도메인을 쓰라고 한다. `window.location.hostname`으로 읽지 말 것 — 이 함수는 서버
렌더에서도 평가되므로(두 호출부가 렌더 본문에서 href를 만든다) SSR 분기의 값이 하이드레이션된
트리에 박힌다.

**공식 문서는 `nmap://` 하나뿐이다.** `launchApp`은 NCloud 문서에 **없다**(리버스 엔지니어링한
내부 페이지였다). `navermaps://`도 없다. 공식 스킴 문서는
[NCloud maps-url-scheme](https://guide.ncloud-docs.com/docs/maps-url-scheme).

**지도 버튼에 `target="_blank"`를 붙이지 말 것.** standalone에서 그건 새 탭이 아니라
**in-app 브라우저 오버레이**이고, 사용자가 닫아야 하는 시트를 만들면서 Universal Link
핸드오프를 가린다. `rel`도 `noreferrer`만 둔다 — `noopener`는 존재하지 않는 새 browsing
context를 규율하는 값이라 무의미하고, 남겨두면 `_blank`가 아직 있는 것처럼 읽힌다.
(인스타그램 `SourceLink`의 `_blank`는 그대로 둔다 — 이미 잘 동작한다.)

**두 렌더 지점은 반드시 함께 움직인다**: `components/PostDetailClient.tsx`의 `PlaceCard`와
`components/PlaceSheet.tsx`. 둘 다 `hrefForApp()`만 쓰는 단순 앵커다.

**단 퍼머링크를 찾는 방식은 다르고, 달라야 한다.** `PlaceCard`는 게시글 하나를 보는 화면이라
그 게시글을 그대로 넘긴다. `PlaceSheet`는 **장소** 화면이라 그 핀을 언급한 모든 게시글이
`sources`에 들어오고 네이버·카카오가 함께 있을 수 있다 — 그래서 앱마다
`exactSourceFor(app.provider)`로 찾는다. 하나를 골라 시트 전체에 쓰면 먼저 정렬된 쪽이
이기고 다른 제공자 버튼은 조용히 퍼머링크를 잃는다.

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
