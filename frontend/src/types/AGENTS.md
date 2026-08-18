<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-19 | Updated: 2026-08-19 -->

# src/types

## Purpose
전역 타입 선언(`.d.ts`). 값을 만들어내지 않고 타입만 얹는다.

## Key Files
| File | Description |
|------|-------------|
| `maps.d.ts` | 세 지도 SDK가 스크립트 태그로 주입한 뒤 전역에 다는 네임스페이스(`naver.maps`, `kakao.maps`, `google.maps`) 선언 |

## For AI Agents

### Working In This Directory
- 여기 있는 타입은 **런타임 보장이 아니다.** SDK는 `lib/map/loader.ts`가 스크립트를
  주입한 뒤에야 존재하므로, 로더의 Promise가 resolve되기 전에 이 전역을 만지면
  선언이 있어도 `undefined`다.
- 앱이 실제로 쓰는 API만 선언한다. SDK 전체를 옮겨 적으면 유지가 안 된다.
- 새 지도 제공자를 추가하면 여기와 `lib/map/loader.ts`, `components/map/`가 함께 는다.

### Testing Requirements
`npm run build`의 타입체크가 전부다. **타입이 맞는다고 SDK가 그렇게 동작한다는 보장은
없다** — 실제 지도는 브라우저에서 띄워 확인한다.

## Dependencies

### Internal
- `../lib/map/loader.ts`, `../components/map/*` — 이 선언의 소비자

### External
- 네이버 지도 / 카카오맵 / Google Maps JavaScript SDK

<!-- MANUAL: -->
