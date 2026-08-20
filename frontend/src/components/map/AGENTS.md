<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-19 | Updated: 2026-08-19 -->

# src/components/map

## Purpose
지도 제공자 3종과 그 앞의 스위치. 사용자가 설정에서 고른 `mapProvider`에 따라 하나만
렌더링된다. SDK 로딩과 공용 타입은 여기가 아니라 `lib/map/`에 있다.

## Key Files
| File | Description |
|------|-------------|
| `MapView.tsx` | 스위치. provider를 **key로** 갖는 별도 컴포넌트를 고른다 |
| `NaverMap.tsx` | 네이버 지도(기본) |
| `KakaoMap.tsx` | 카카오맵 |
| `GoogleMap.tsx` | Google Maps |
| `MapLoadError.tsx` | SDK 로딩 실패 시의 대체 화면 |

## For AI Agents

### Working In This Directory

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
