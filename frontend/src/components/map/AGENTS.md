<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-19 | Updated: 2026-08-19 -->

# src/components/map

## Purpose
지도 제공자 3종과 그 앞의 스위치. 사용자가 설정에서 고른 `mapProvider`에 따라 하나만
렌더링된다. SDK 로딩과 공용 타입은 여기가 아니라 `lib/map/`에 있다.

## Key Files
| File | Description |
|------|-------------|
| `PlaceSheetHost.tsx` | 지도 + 핀 선택 + communal sources 조회 + 장소 시트. **홈과 `/links/[id]/map`이 공유한다** |
| `MapView.tsx` | 스위치. provider를 **key로** 갖는 별도 컴포넌트를 고른다 |
| `NaverMap.tsx` | 네이버 지도(기본) |
| `KakaoMap.tsx` | 카카오맵 |
| `GoogleMap.tsx` | Google Maps |
| `MapLoadError.tsx` | SDK 로딩 실패 시의 대체 화면 |

## For AI Agents

### Working In This Directory

**`PlaceSheetHost`는 hook이 아니라 컴포넌트다.** 가장 미묘한 계약이 JSX에 있어서다 —
`<PlaceSheet>`는 열기/닫기 애니메이션을 위해 항상 mount돼 있어야 하고(Base UI는 진짜
`false→true` edge만 애니메이션한다), hook으로 빼면 그 JSX가 호출부마다 복제된다.

**복제하지 말 것.** 안에 있는 것은 배선이 아니라 **각각 고친 버그가 있는 correctness 장치
네 개**다: placeId 기준 stale 응답 가드(닫은 핀의 sources가 다른 시트에 도착하는 것),
own+communal의 `sourceUrl` 중복 제거(같은 게시물이 두 번 나오는 것), 객체가 아니라 id로
선택 보관(삭제된 게시물의 장소가 계속 렌더되는 것), truthy 아닌 `!== null`(place 0이 "선택
없음"으로 읽히는 것). **사본만 따로 읽으면 어느 것도 틀려 보이지 않는다** — `PostGrid`를
공유한 것과 같은 판단이다.

밖으로 빼낸 결합이 둘 있고 둘 다 홈에만 필요하다: `suppressed`(URL 시트·캡션 프롬프트가
열릴 때 non-modal 시트를 물러나게 한다 — 안 하면 modal이 닿을 수 없는 시트 위에 포커스를
가둔다)와 `children`이 받는 `selectedPlace`(+ 버튼이 카드가 뜰 때 숨어야 한다. 시트가
`<body>`로 portal되므로 z-index로는 해결되지 않는다).

**`initialSelectedPlaceId`는 첫 페인트부터 시트를 연다.** 그래서 도착 시 슬라이드업이
없는데, 그건 버그가 아니라 그 화면의 요구다 — 사용자가 장소를 눌러 지도를 보러 온 것이므로
없던 것이 들어오는 애니메이션은 거짓이다. **effect로 미루지 말 것**(lint의
`react-hooks/set-state-in-effect`가 막고, 한 프레임 늦으면 요청하지 않은 두 번째 전환이 된다).

**provider가 key인 것은 의도다.** 전환하면 이전 지도를 재사용하지 않고 완전히 해체한다.
세 SDK는 인스턴스 수명·마커 API가 서로 달라서, 공용 컨테이너를 재사용하려 들면 이전
제공자의 DOM 잔재 위에 새 지도가 그려진다.

**`FocusRequest`의 nonce를 무시하지 말 것.** 같은 장소를 두 번 눌러도 다시 중심에 와야
하는데 React는 상태가 그대로면 렌더를 건너뛴다.

**`placeIds`가 여러 개일 때와 하나일 때는 카메라 동작이 다르다.** 하나면 `FOCUS_ZOOM`으로
줌인해서 어느 골목인지 읽게 하고, 여러 개면 전부 들어올 때까지 물러나 `fitBounds`한다
(카카오는 `setBounds`). 이 분기를 지우고 항상 줌인하면 `/links`의 "N곳 모두 보기"가 첫
장소만 확대해서 나머지를 화면 밖으로 밀어낸다 — 요청한 것과 정반대다. 마커 effect의
`fitBounds`로 대신할 수도 없다: 그건 사용자가 저장한 **모든** 핀을 담고, 이건 그 게시글의
장소만 담는다.

**카카오의 `setBounds`는 클램프해야 한다.** 레벨이 반대 방향이라, 한 건물 안의 두 장소처럼
몇 미터짜리 bounds를 주면 최소 레벨까지 파고들어 옥상만 보인다. `LEVEL_FOCUS`보다 더 깊게
들어갔으면 되돌리고, padding 인자도 넘긴다(안 넘기면 경계의 마커가 화면 끝에서 잘린다).
네이버·구글은 `fitBounds`에 padding을 넘기고 자체 상한이 있어서 이 문제가 덜하다.

**마커 effect의 카메라 이동은 focus 요청이 있으면 건너뛴다**(`focusPendingRef`).
`/links`에서 `?place=`를 달고 들어오면 두 effect가 같은 커밋에서 돌고, 마커 쪽은 저장된
**모든** 핀을, focus 쪽은 그 게시글의 핀만 프레이밍한다. 세 SDK 모두 이 카메라 이동을
내부적으로 지연시키므로 둘 다 실행하면 어느 쪽이 이기는지가 경합이 되고, 지는 쪽이 하필
사용자가 요청한 것이다. 이 ref는 **의존성이 아니라 ref여야 한다** — `focusRequest`를
의존성에 넣으면 포커스마다 핀 전체를 다시 만든다. 또 렌더 중에 쓰지 말 것(React 19의
`react-hooks/refs`가 막는다). 별도 effect에서 갱신하고, 초기값은 `useRef()` 인자로 준다.

**마커를 effect 의존성에 넣지 말 것.** `useMarkerLookup`의 ref를 쓴다. 배열을 의존성에
두면 무관한 게시글을 저장할 때마다 카메라가 마지막 포커스 핀으로 끌려간다.

**세 제공자의 커스텀 마커 API가 서로 다르다. 이건 취향이 아니라 SDK의 제약이다.**
마크업은 `lib/map/markerContent.ts` 한 곳에서 만들고, 각 제공자는 자기 SDK가 받는 형태로
넘긴다:

| 제공자 | API | 콘텐츠 형태 | 클릭 |
|---|---|---|---|
| 네이버 | `Marker`의 `icon: {content, size, anchor}` | HTML **문자열** | `Event.addListener` (기존과 동일) |
| 카카오 | `CustomOverlay` | 문자열 또는 **엘리먼트** | **DOM 리스너** — 오버레이는 이벤트 타깃이 아니다 |
| 구글 | `marker.AdvancedMarkerElement` | **DOM 노드** | `addListener` |

- **카카오는 `Marker`로 할 수 없다** — 이미지만 받고 마크업은 못 받는다. 그리고
  `CustomOverlay`에는 `addListener`도 `clearInstanceListeners`도 없으므로, 클릭은
  content 엘리먼트에 붙이고 **같은 노드에서 `removeEventListener`로 떼야 한다.**
  그래서 `TrackedMarker`가 `{ overlay, element, handler }` 셋을 함께 들고 있다.
  선택 상태를 `setContent(문자열)`로 갱신하지 말 것 — 노드가 교체되면서 리스너가 조용히
  사라진다. 클래스만 토글한다.
- **구글은 `mapId`와 `libraries=marker` 둘 다 필요하고, 없으면 조용히 실패한다**(지도는
  뜨고 핀만 안 보인다). 로더가 `google.maps.marker`를 따로 확인하는 이유이고,
  `DEMO_MAP_ID` 폴백은 개발용이다 — 프로덕션에는 실제 Map ID를 넣는다.
  레거시 `google.maps.Marker`는 v3.56부터 deprecated이고 DOM 콘텐츠를 받지 못한다.
  `AdvancedMarkerElement`는 `setMap()`이 없고 `map` 대입으로 떼는데, ref 배열에서 꺼낸
  객체에 직접 대입하면 `react-hooks/immutability`가 error로 막으므로 `detach()` 헬퍼에
  인자로 넘긴다.

**핀의 z-index는 위도에서 뽑는다(`markerZIndex()`). 상수로 되돌리지 말 것.**
처음에는 모든 핀이 같은 `zIndex: 100`이었는데, 그러면 순서가 동점이라 **DOM 순서로 결정되고
같은 칩이 매번 이긴다** — 라벨은 옛 점 마커보다 훨씬 넓어서 겹침이 예외가 아니라 정상이므로,
아래 깔린 핀은 아예 **클릭이 불가능**했다(실측: 서울 전체 줌에서 15개 중 4개). 위도순은 지도
앱의 관례이고(남쪽이 앞), 무엇보다 **핀마다 값이 달라진다**는 점이 핵심이다.

**칩 폭도 이 문제의 일부다.** `max-width`를 9.5rem에서 7rem으로 줄인 뒤 완전 차단이 4개 →
1개(같은 건물의 두 상점)로 떨어졌다. `MARKER_WIDTH`도 같이 맞춰 두지만, 실측해 보면
**네이버는 선언한 `size`가 아니라 렌더된 내용에 맞춰 wrapper를 잡고 anchor를 거기서 다시
계산한다**(44px~112px 칩 전부 stem이 좌표 정중앙, dx 0·dy ≤1px). 즉 이 상수가 위치를
좌우하지는 않으므로, 핀이 좌표에서 밀리는 증상을 이 상수 탓으로 진단하지 말 것.

**SDK 전역 가드는 이제 세 제공자 전부에 있다.** 예전에는 네이버에만 있었고 카카오·구글의
마커/포커스 effect는 `if (!map)`만 보고 있었다 — 마커 형태를 커스텀 오버레이로 바꾸면서
그 effect들이 만지는 네임스페이스가 늘었고(`CustomOverlay`,
`marker.AdvancedMarkerElement`), 구글은 여기에 `libraries=marker` 의존이 추가돼서
**코어는 인증됐지만 marker 라이브러리가 없는 키**라는 새 실패 경로가 생겼다. 로더는
페이지당 한 번만 도는데 이 effect는 마커가 바뀔 때마다 도므로, 가드는 effect 안에 있어야
한다.

**구글은 `gmp-click`을 쓴다.** `addListener("click")`도 동작하지만 SDK가 "superseded"
경고를 찍고, `gmpClickable: true`를 켜면 **키보드 포커스와 스크린리더 안내(`title`)까지**
따라온다. 라벨이 div라서 `title`이 유일한 접근성 이름이므로 세 제공자 모두 남겨 둔다.

**`selectedPlaceId`를 마커 effect의 의존성에 넣지 말 것.** 그 effect는 핀을 전부 파괴하고
다시 만들므로, 핀을 탭할 때마다 전체가 재생성되고 **끝의 `fitBounds`/`setBounds`가 카메라를
사용자가 보던 곳에서 끌고 간다.** 대신 세 제공자 모두:

1. `bySelectableId` ref에 `placeId → 마커`를 들고,
2. 별도 effect에서 **이전 선택과 새 선택 두 개만** 다시 그리고,
3. `paintedSelection` ref로 지금 칠해진 것을 기억한다(마커가 재생성되면 null로 리셋).

마커 effect 쪽은 `selectedPlaceIdRef`로 현재 선택을 **읽기만** 한다 — 다른 이유로 재생성될
때 선택된 핀이 선택 상태로 그려져야 하기 때문이다.

**SDK 전역은 로더 Promise가 resolve된 뒤에만 만진다.** 타입 선언(`types/maps.d.ts`)이
있다고 런타임에 존재한다는 뜻이 아니다. 카카오는 `autoload=false`라 `kakao.maps.load()`
콜백까지 기다려야 한다.

**로딩 실패는 `MapLoadError`로 보인다.** 조용히 빈 div를 남기지 말 것 — 원인이 거의 항상
콘솔의 허용 도메인 미등록인데, 그건 화면에 아무 단서가 없으면 찾는 데 오래 걸린다.

### Testing Requirements
**세 제공자를 다 띄워 본다.** 한 곳에서 되는 것이 다른 곳에서 된다는 보장이 없다.
각 콘솔의 허용 도메인에 `http://localhost:4000`과 배포 도메인이 등록되어 있어야 하고,
없으면 지도는 **아무 말 없이** 렌더링에 실패한다.

확인 항목: 핀이 보이는가 / 같은 핀 두 번 클릭에 카메라가 반응하는가 / 다른 게시글 저장 시
카메라가 튀지 않는가 / 제공자 전환 후 이전 지도가 남지 않는가.

### Common Patterns
각 구현은 같은 `MapViewProps`를 받고, 마운트 시 로더를 await한 뒤 지도를 만들고,
언마운트에서 정리한다. 새 제공자도 이 형태를 따른다.

## Dependencies

### Internal
- `../../lib/map/loader.ts` — SDK 주입
- `../../lib/map/types.ts` — `MapMarker`, `FocusRequest`, `MapViewProps`, 기본 좌표·줌
- `../../lib/map/useMarkerLookup.ts`
- `../../types/maps.d.ts` — 전역 SDK 타입

### External
- 네이버 지도 / 카카오맵 / Google Maps JavaScript SDK

<!-- MANUAL: -->

**`map`이 set됐다는 것만으로 SDK를 쓸 수 있다고 보지 말 것.** 권한 없는 키도 스크립트를
200으로 주고 `new naver.maps.Map()`까지 성공하므로 `map`은 채워지는데 네임스페이스는 반쪽이다.
그래서 **마커 effect와 포커스 effect 둘 다** `window.naver?.maps`를 먼저 확인하고 없으면 바로
빠진다. 예전에는 이 검사가 unmount 경로에만 있었고, 마커 집합이 바뀔 때마다 도는 effect에는
없어서 낙관적 핀 도입(저장 한 번에 마커가 두 번 바뀐다) 직후
`Cannot read properties of null (reading 'Event')`로 **페이지 전체가 죽었다.**
지도가 안 보이는 것과 앱이 죽는 것은 다르다.

포커스 effect도 같은 이유로 위험하다 — `/?place=<id>`로 들어오면 `focusRequest`가 초기 상태에
채워져 **첫 커밋에 바로 돈다.** 즉 마커 effect의 가드가 소용없는 시점에 먼저 터진다. 새 effect를
추가할 때도 `if (!map)`만으로는 부족하다는 것을 기억할 것.
