<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-26 | Updated: 2026-08-26 -->

# docs/kakao

## Purpose
카카오맵을 지도 제공자로 켜는 데 쓰는 `NEXT_PUBLIC_KAKAO_MAP_KEY`(카카오 개발자 콘솔의
JavaScript 키)를 발급하는 절차. 코드는 이미 다 들어가 있고, 이 문서는 코드 밖에서 해야 하는
일만 다룬다.

## Key Files
| File | Description |
|------|-------------|
| `SETUP.md` | 앱 생성 → 카카오맵 사용 설정 ON → Web 도메인 등록 → JavaScript 키 복사 → `.env` 채우기 |

## For AI Agents

### Working In This Directory
- **이 키는 지도 렌더링 전용이다.** 카카오 지도 링크 인제스트(`place.map.kakao.com`,
  `kko.to`)는 og 태그만 파싱하고 좌표는 네이버 지역검색이 조회하므로 키를 쓰지 않는다.
  실제 사용처는 `src/lib/map/loader.ts`의 `loadKakaoMaps()` **한 곳뿐**이다 — 문서를 고칠
  때 이 경계를 흐리지 말 것. "카카오 링크가 저장 안 된다"와 "카카오 지도가 안 뜬다"는
  원인이 전혀 다르다.
- **`NEXT_PUBLIC_KAKAO_MAP_KEY`는 선택 환경변수다.** 기본 제공자가 네이버라서, 비어 있으면
  `/settings`에서 카카오맵을 고른 사용자만 `MapLoadError`를 본다. 앱 전체가 막히지 않는다.
- **콘솔 절차에 공식 지도 가이드에 없는 단계가 하나 있다: "제품 설정 > 카카오맵 > 사용
  설정 ON".** 401 문의의 가장 흔한 원인이므로 `SETUP.md`에서 지우지 말 것. 공식 가이드만
  따라가면 이 단계가 누락된다.
- **도메인은 포트까지 등록해야 하고 이 앱의 dev 포트는 4000이다**(3000이 아니다).
  `http://localhost:3000`으로 적어 두면 로컬에서 계속 401이 난다.
- **도메인 등록 자리는 `앱 설정 > 앱 > 플랫폼 키 > JavaScript 키 > JavaScript SDK 도메인`이다.**
  2025-12-03 콘솔 개편으로 앱 단위 "플랫폼"에서 앱 키 단위로 내려갔다 — 인터넷의 안내와
  카카오 지도 가이드 일부가 아직 옛 경로("앱 설정 > 플랫폼")를 적고 있으므로 `SETUP.md`의
  경고를 지우지 말 것. 좌측 메뉴에 "플랫폼"이 없고 "플랫폼 키"만 있으면 개편 후 콘솔이다.
- **`제품 링크 관리 > 웹 도메인`은 다른 자리다** — 카카오톡 공유·메시지의 링크 연결용이고
  지도 SDK 검증과 무관하다. 혼동이 잦아서 `SETUP.md`에 명시해 뒀다.
- 앱 키는 종류별 최대 5개까지 만들 수 있고 하나가 대표 키다. 도메인은 **`.env`에 넣은 그
  키**의 목록에 등록해야 한다 — 다른 키에 등록하면 401이 그대로다.
- 카카오는 `autoload=false`로 주입되므로 `kakao.maps.load()` 콜백까지 기다려야 SDK가
  쓸 수 있는 상태가 된다 — 코드 쪽 이유는
  [frontend/src/lib/map/AGENTS.md](../../frontend/src/lib/map/AGENTS.md)에 있다.
- 카카오 개발자 콘솔에는 JavaScript 키 외에 REST API 키·네이티브 앱 키·Admin 키가 같은
  화면에 있다. `NEXT_PUBLIC_*`은 클라이언트 번들에 실려 나가므로 **JavaScript 키가 아닌
  것을 이 자리에 넣으면 노출 사고다.**
- 나중에 카카오 소셜 로그인을 붙이면 같은 앱을 쓰되 키는 다르다(REST API 키). `AuthProvider`
  enum에는 `KAKAO`가 이미 있지만 provider 서술자는 아직 없다 — 루트
  [AGENTS.md](../../AGENTS.md)의 "제공자 추가는 파일 하나다" 참고.

### Testing Requirements
키를 넣은 뒤 dev 서버를 **재시작**해야 반영된다(`NEXT_PUBLIC_*`은 번들에 인라인된다).
검증은 `/settings`… 가 아니라 `AppDrawer`에서 카카오맵을 고르고, 저장된 핀이 프레임되는지
+ 핀 클릭으로 출처 시트가 열리는지 + `/links` 상세에서 돌아올 때 카메라가 그 핀으로
이동하는지까지 봐야 끝난 것이다. 지도가 렌더된 것만으로는 마커·포커스 경로가 검증되지 않는다.

실패 문구는 두 가지로 갈린다: 키가 비면 `NEXT_PUBLIC_KAKAO_MAP_KEY가 없습니다.`,
키·도메인·사용설정 중 하나가 틀리면 `카카오맵을 불러오지 못했습니다.` 후자는 셋을 구별하지
못하므로 **브라우저 콘솔의 `dapi.kakao.com/v2/maps/sdk.js` 401을 함께 확인**한다.

## Dependencies

### Internal
- `frontend/src/lib/map/loader.ts` — 이 키의 유일한 사용처(`loadKakaoMaps()`)
- `frontend/src/components/map/KakaoMap.tsx` — SDK를 실제로 쓰는 컴포넌트
- `frontend/.env.example` — 문서가 지시하는 환경변수의 정본

### External
- 카카오 개발자 콘솔 (https://developers.kakao.com)
- Kakao Maps JavaScript SDK (https://apis.map.kakao.com/web/guide/)

<!-- MANUAL: -->
