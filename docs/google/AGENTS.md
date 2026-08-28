<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-28 | Updated: 2026-08-28 -->

# docs/google

## Purpose
구글맵을 지도 제공자로 켜는 데 쓰는 `NEXT_PUBLIC_GOOGLE_MAPS_KEY`(Google Cloud Console의
Maps JavaScript API 키)를 발급하는 절차. 코드는 이미 다 들어가 있고, 이 문서는 코드 밖에서
해야 하는 일만 다룬다.

## Key Files
| File | Description |
|------|-------------|
| `SETUP.md` | 프로젝트 생성 → 결제 계정 연결 → Maps JavaScript API 사용 설정 → 키 발급·제한 → `.env` 채우기 |

## For AI Agents

### Working In This Directory
- **이 키는 지도 렌더링 전용이다.** 인제스트 파이프라인의 지오코딩은 이 앱에서 구글이 아니라
  네이버 지역검색이 하므로 이 키를 쓰지 않는다. 실제 사용처는 `src/lib/map/loader.ts`의
  `loadGoogleMaps()` **한 곳뿐**이다.
- **`NEXT_PUBLIC_GOOGLE_MAPS_KEY`는 선택 환경변수다.** 기본 제공자가 네이버라서, 비어 있으면
  `/settings`에서 구글맵을 고른 사용자만 `MapLoadError`를 본다. 앱 전체가 막히지 않는다.
- **카카오와 달리 이 API는 유료다.** 월 무료 크레딧(2026년 기준 $200, 구글이 언제든 바꿀 수
  있다)이 있어도 그 한도를 받으려면 프로젝트에 결제 계정이 연결돼 있어야 한다. `SETUP.md`의
  "결제 계정 연결" 단계를 지우지 말 것 — 없으면 API 사용 설정을 해도 요청이 막힌다.
- **키 발급 즉시 리퍼러 제한 + API 제한을 둘 다 걸어야 한다.** 하나만 걸면 그 키로 다른
  도메인에서 이 API를 쓰거나, 이 도메인에서 다른 유료 Maps API를 쓰는 경로가 열려 있다.
  `NEXT_PUBLIC_*`은 클라이언트 번들에 그대로 실려 나가므로, 이 두 제한이 이 키의 유일한
  접근 제어다.
- **도메인은 포트까지 등록해야 하고 이 앱의 dev 포트는 4000이다**(3000이 아니다).
  `http://localhost:3000/*`으로 적어 두면 로컬에서 계속 실패한다.
- 배포 도메인을 리퍼러 제한에 빠뜨리면 로컬에서는 지도가 뜨고 프로덕션에서만 깨진다 —
  이 저장소의 다른 지도 제공자들과 똑같은 함정이다.
- Google Cloud 프로젝트는 다른 구글 API(예: 유튜브 Data API, `docs/youtube/`)와 공유해도
  된다 — API마다 켜고 끄는 단위이지 프로젝트를 나눌 필요는 없다.

### Testing Requirements
키를 넣은 뒤 dev 서버를 **재시작**해야 반영된다(`NEXT_PUBLIC_*`은 번들에 인라인된다).
검증은 `/settings`가 아니라 `AppDrawer`에서 구글맵을 고르고, 저장된 핀이 프레임되는지 +
핀 클릭으로 출처 시트가 열리는지 + `/links` 상세에서 돌아올 때 카메라가 그 핀으로
이동하는지까지 봐야 끝난 것이다.

실패 문구는 두 가지로 갈린다: 키가 비면 `NEXT_PUBLIC_GOOGLE_MAPS_KEY가 없습니다.`,
키·리퍼러 제한·API 사용 설정 중 하나가 틀리면 `구글 지도 SDK를 초기화하지 못했습니다.
API 키와 허용 도메인을 확인해 주세요.` 후자는 원인을 구별하지 못하므로 **브라우저 콘솔의
`RefererNotAllowedMapError`/`ApiNotActivatedMapError`를 함께 확인**한다.

## Dependencies

### Internal
- `frontend/src/lib/map/loader.ts` — 이 키의 유일한 사용처(`loadGoogleMaps()`)
- `frontend/src/components/map/GoogleMap.tsx` — SDK를 실제로 쓰는 컴포넌트
- `frontend/.env.example` — 문서가 지시하는 환경변수의 정본

### External
- Google Cloud Console (https://console.cloud.google.com)
- Maps JavaScript API (https://developers.google.com/maps/documentation/javascript)

<!-- MANUAL: -->
