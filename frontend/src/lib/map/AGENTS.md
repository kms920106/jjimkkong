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
