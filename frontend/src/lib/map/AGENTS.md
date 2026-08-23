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
낫다. `launchApp`에 id로 장소를 여는 형태가 있는지는 **실기기로만 확인된다** — 그 SPA는 아무
경로에나 200을 돌려주므로 HTTP 상태는 근거가 되지 않는다.

**생성되는 세 URL은 전부 Apple Universal Link이고, iOS 홈화면 앱에서는 그게 설계의 전부다.**
루트 AGENTS.md의 "이 앱은 iOS 홈화면에 추가해서 쓴다" 절이 근거다. Universal Link는 iOS가
네이티브 앱에 바로 넘기므로 **우리 창이 navigate하지 않아** 보던 게시글이 그대로 남고, 앱이
없으면 같은 URL이 제공자의 웹 지도를 띄운다. 그래서 커스텀 스킴도, 우리가 만드는 폴백
타이머도 필요하지 않다.

**호스트와 경로는 임의로 바꾸지 말 것. 각각 실측으로 고른 형태다.**

| 제공자 | 형태 | 이유 |
|---|---|---|
| 네이버 | `inapp.map.naver.com/launchApp/place?lat=&lng=&name=` | `map.naver.com`에는 AASA가 **없지만** `launchApp/*`에는 있다. `m.` 호스트는 이 호스트로 302하면서 **쿼리스트링을 버리므로**(실측) 앱 없는 사용자가 장소가 아닌 빈 지도로 떨어진다 |
| 카카오 | `m.map.kakao.com/actions/searchView?q=` | `map.kakao.com`의 AASA는 문자열이 닫히지 않은 **깨진 JSON**이고, 모바일 UA에서 `/?q=`는 `applink.map.kakao.com`(앱 설치 안내 페이지)으로 302된다 |
| 구글 | `google.com/maps/search/?api=1&query=` | 공식 문서상 Universal Link |

**네이버에 `nmap://` 스킴을 다시 만들지 말 것. 그게 이 파일이 한 번 실패한 지점이다.**
`map.naver.com`에 AASA가 없는 것만 보고 스킴이 유일한 길이라고 판단해 `nmap://place` +
1.5초 타이머 폴백을 직접 구현한 적이 있다. 그 폴백이 스킴과 경쟁해서 **이겼고**, 앱은 우리
폴백의 `/search?query=`를 받아 좌표로 지목한 핀 대신 **이름 검색 결과**
("위치 정보 없음 / 서울특별시 중구 중심으로 …")를 띄웠다. 앱이 없을 때는 같은 폴백이
게시글을 웹 지도로 덮었다.

**타이머로 핸드오프 성공을 감지할 수 없다는 것이 근본 이유다.** standalone 모드에서는 Page
Visibility API가 잘못된 상태로 발화한다(WebKit
[#202399](https://bugs.webkit.org/show_bug.cgi?id=202399)) — 취소 신호를 그 API에 걸면 앱이
정상적으로 떴는데도 폴백이 살아남는다. 네이버 자신의 launch 페이지도 같은 문제를 못 풀어서
2500ms 타이머 휴리스틱을 쓴다. **정확성을 그 API에 걸지 말 것.**

**`appname`과 `fallbackUrl`은 이 URL에서 아무 일도 하지 않는다.** `appname`은 raw `nmap://`의
필수 파라미터이지만 launch 페이지는 `appSchemeName`(허용값 `nmap`/`navermaps`)만 읽는다.
`fallbackUrl`은 `^https?://([a-z0-9.]+)\.naver\.com` 검사를 통과해야 하므로 우리 도메인을
넘길 수 없다 — 앱이 없을 때 찜꽁으로 돌아오게 만들 방법은 없고, 이건 카카오·구글과 같은
수용한 트레이드오프다.

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
