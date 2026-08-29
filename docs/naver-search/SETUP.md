# 네이버 지역검색 API 설정 가이드

코드는 이미 다 들어가 있다([frontend/src/lib/ingest/geocode.ts](../../frontend/src/lib/ingest/geocode.ts)).
이 문서는 **콘솔에서 해야 하는 일**과 그 결과를 어디에 넣는지만 다룬다. 코드 쪽 이유(동시성
제한, 캐싱, 클라이언트 좌표를 믿지 않는 이유)는 루트 [AGENTS.md](../../AGENTS.md)의
"인제스트 파이프라인" 절, 3번 `geocode.ts` 항목에 있다.

`NAVER_CLIENT_ID`/`NAVER_CLIENT_SECRET`는 **필수**다. 없으면 인제스트 3단계(지오코딩)가
전부 실패해 어떤 링크를 붙여넣어도 장소가 지도에 올라오지 않는다.

**이 키는 로그인용 키와 다른 애플리케이션이다.** `NAVER_LOGIN_CLIENT_ID`/
`NAVER_LOGIN_CLIENT_SECRET`([docs/oauth/SETUP.md](../oauth/SETUP.md))는 네이버
**개발자센터**(developers.naver.com)의 로그인 애플리케이션이고, 이 문서가 다루는
지역검색 키는 네이버 **클라우드 플랫폼**(NCP, ncloud.com)의 별개 콘솔에서 나온다.
둘을 섞어 쓰면 불친절한 401이 온다 — 루트 AGENTS.md의 "네이버 로그인 키는 지역검색
키와 다른 애플리케이션이다" 참고.

## 1. NCP 콘솔에서 지역검색 API 신청

1. https://www.ncloud.com 가입/로그인 (개인 인증 필요 — 휴대폰 본인인증).
2. 콘솔(console.ncloud.com) → 좌측 상단 메뉴 → **AI·Application Service** →
   **AI NAVER API** → **Application**.
3. **Application 등록** 클릭.
4. Application 이름 입력(식별용, 예: `jjimkkong`) 후 **사용할 API**에서
   **지역 검색(Search - Local)** 체크 → 등록.

## 2. 인증 정보 확인

등록한 Application 상세 화면에 두 값이 나온다:

| 값 | 코드에서 쓰이는 이름 |
|---|---|
| Client ID | `NAVER_CLIENT_ID` |
| Client Secret | `NAVER_CLIENT_SECRET` |

이 값들은 이 앱의 실제 요청 헤더(`X-NCP-APIGW-API-KEY-ID`/`X-NCP-APIGW-API-KEY`,
[geocode.ts](../../frontend/src/lib/ingest/geocode.ts#L38) 참고)로 그대로 들어간다.
엔드포인트는 `naverapihub.apigw.ntruss.com/search/v1/local`이다 — 예전 문서에 흔한
`openapi.naver.com/v1/search/local.json` + `X-Naver-Client-Id` 조합은 **개발자센터
쪽 레거시 방식**이고 이 저장소는 쓰지 않는다. 헤더 이름이 다르면 잘못된 콘솔에서
값을 복사한 것이다.

## 3. 로컬 환경변수

`frontend/.env`의 다음 두 줄에 붙여넣는다:

```
NAVER_CLIENT_ID=
NAVER_CLIENT_SECRET=
```

`NEXT_PUBLIC_` 접두어가 없다 — 이 키는 서버(`POST /api/ingest`, `POST /api/posts`)에서만
쓰이고 클라이언트 번들에 노출되지 않는다. 지도 렌더링용 `NEXT_PUBLIC_NAVER_MAP_CLIENT_ID`
(네이버 지도 SDK, 별도 애플리케이션)와 혼동하지 말 것 — 이 문서는 지오코딩 API 키만
다룬다.

## 4. 확인

```bash
cd frontend && npm run dev
```

1. http://localhost:4000 접속 → 로그인.
2. 인스타그램/유튜브 링크 하나를 입력창에 붙여넣고 저장.
3. 진행 바가 `geocoding` 단계를 지나 핀이 지도에 뜨는지 확인.

**실패는 조용하지 않다.** 키가 비어 있으면 인제스트가 시작하자마자
`NAVER_CLIENT_ID / NAVER_CLIENT_SECRET are not set` 에러로 죽는다(서버 로그).
키는 있는데 콘솔에서 값을 잘못 복사했거나 지역검색 API를 신청하지 않은 상태면
개별 장소 조회가 `lookupFailed: true`로 실패해 "검색이 일시적으로 죽음" 문구가
토스트에 뜬다 — 루트 AGENTS.md의 "`matched: false`와 `lookupFailed: true`는 서로
다른 뜻" 참고.

API 요청/응답 필드의 상세 레퍼런스는 [LOCAL-SEARCH.md](LOCAL-SEARCH.md) 참고.

## 5. 무료 여부 및 제한

지역검색 API는 무료이나 **일 25,000건** 호출 한도가 있다(NCP 콘솔의 Application
상세에서 실시간 사용량 확인 가능). 이 앱은 저장 1회당 장소 수만큼(보통 1~5회) 호출을
쓰고, 같은 질의는 10분 캐싱되므로([geocode.ts](../../frontend/src/lib/ingest/geocode.ts)의
`cachedSearch`) 실제 소모량은 저장 건수보다 낮다. 한도 초과 시 429가 오고 이 앱은
재시도하지 않는다 — 신호는 서버 로그의 `lookupFailed` 증가다.

**동시성을 임의로 올리지 말 것.** 코드가 이미 동시성 3으로 제한돼 있다 — NCP가 한
Client ID에서 몰아치는 요청을 거부하기 때문이다. 자세한 이유는 루트 AGENTS.md 참고.
