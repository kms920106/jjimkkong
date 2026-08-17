# jjimkkong (찜꽁) — 에이전트 가이드

## 이 서비스는 무엇인가

**지도가 붙은 링크 보관함**이다. 사용자는 다른 앱(인스타그램, 유튜브)을 보다가 기억해 둘
만한 장소를 발견하면 링크를 복사해서, 이 서비스로 돌아와 붙여넣는다. 서비스는 그 게시글을
읽어 실제로 존재하는 장소를 골라내고 지도에 핀을 꽂는다.

제품 전체가 입력창 하나다. 링크를 붙여넣으면 장소가 지도에 올라온다. 아래 내용은 전부 이
동작 하나를 성립시키기 위해 존재한다.

```
링크 붙여넣기 → 게시글 메타데이터 수집 → LLM이 장소 이름 추출 → 네이버가 좌표 조회
             → 게시글 + 장소 저장 → 지도에 핀 렌더링
```

브라우저 확장도, share-target 연동도 없다. 사용자가 직접 다른 앱에서 URL을 복사해 `/`의
입력 폼에 붙여넣는다. 받아들이는 링크는 인스타그램 post/reel, 유튜브 watch/shorts,
그리고 네이버·카카오 지도의 장소 링크(단축 링크 `naver.me`/`kko.to` 포함)뿐이고,
그 외에는 400을 돌려준다.

**지도 링크는 캡션이 아니라 장소 그 자체다.** 게시글은 여러 장소를 *언급*하지만 지도
링크는 장소 하나를 *지목*한다. 그래서 `metadata.ts`가 og 태그에서 이름을 읽어
`place`에 담아 주고, 인제스트 라우트는 LLM 추출을 건너뛰고 곧장 지오코딩한다 —
제공자가 이미 정확히 알려준 이름을 모델이 다시 쓰게 둘 이유가 없다.

네이버와 카카오는 `Platform.NAVER` / `Platform.KAKAO`로 나뉘어 저장되며, 목록의 탭도
이걸로 갈린다. 이름을 읽는 자리가 서로 다르다: 네이버는 og:description(og:title은 늘
`네이버지도`라는 고정 문자열), 카카오는 og:title에 이름·og:description에 도로명 주소가
온다. 카카오의 주소는 지오코딩 힌트로 그대로 넘긴다.

## 구조

저장소 루트에는 문서만 있다. 코드는 전부 [frontend/](frontend/)에 있으며, UI와 백엔드를
겸하는 단일 Next.js 16 App Router 앱이다. **모든 명령은 `frontend/`에서 실행한다.**
Vercel의 Root Directory도 `frontend`다.

```
frontend/src/
  app/
    (app)/          로그인 후 페이지 — 홈(붙여넣기 + 지도 + 목록), 설정
    api/            ingest, posts, settings, dev-login
    api/auth/       [provider]/start·callback, phone/send·verify, logout
    login/          로그인 + login/verify(휴대폰 인증)
  components/       HomeClient(메인 플로우 전체), CaptionPrompt, map/*
  lib/
    ingest/         metadata.ts → extract.ts → geocode.ts  (파이프라인, 이 순서대로)
    map/            SDK 로더, 지도 공용 타입, 마커 조회 훅
    auth/           세션·OAuth·계정연결·SMS 인증 (아래 "인증" 절)
    auth.ts         requireUser() — 모든 라우트의 소유권 게이트
  generated/prisma/ Prisma 클라이언트 생성물 — 생성 파일, gitignore, 직접 수정 금지
  proxy.ts          Next proxy(미들웨어); 페이지 이동 전용, /api에는 절대 걸지 않음
```

## 명령어

```bash
cd frontend
npm install            # postinstall에서 prisma generate 실행
npm run dev            # http://localhost:4000  (3000이 아니라 4000)
npm run build
npm run lint
npm run db:migrate     # prisma migrate dev — DIRECT_URL 사용
npm run db:deploy      # prisma migrate deploy — CI/운영용, 빌드 중 실행 금지
npm run db:studio
```

테스트 스위트는 없다. 검증은 `npm run lint` + `npm run build` + 브라우저에서 직접 플로우를
돌려보는 것이다. 타입체크만 통과했다고 변경이 동작한다고 말하지 말 것 — 이 코드베이스에서
문제가 생기는 지점은 전부 네트워크 경계다.

## 인제스트 파이프라인

[frontend/src/lib/ingest/](frontend/src/lib/ingest/)의 모듈 세 개를 `POST /api/ingest`가
순서대로 호출한다.

**1. `metadata.ts` — 게시글 본문 가져오기**
`classifyUrl()`이 플랫폼을 판별하고 나머지는 전부 거부한다. `canonicalize()`는 트래킹
파라미터를 떼어내 같은 게시글이 항상 한 행으로 저장되게 한다(`/reel/`, `/reels/`, `/tv/`,
`/p/`가 전부 하나의 인스타그램 퍼머링크로 수렴).

- 유튜브: `YOUTUBE_API_KEY`가 있으면 Data API v3를 쓴다. 설명 전문을 얻을 수 있는 유일한
  경로이고, 크리에이터가 장소를 실제로 나열하는 곳이 바로 거기다. 키가 없으면 oEmbed로
  떨어지는데 제목·작성자만 오고 설명이 없으므로 `needsManualCaption: true`가 된다.
- 인스타그램: 크롤러 UA로 `embed/captioned/`를 먼저 시도하고, 실패하면 `og:description`으로
  넘어간다. 여기에는 캡션이 여전히 통째로 담겨 있으며, 앞에 붙은 인게이지먼트 껍데기
  (`46K likes, 361 comments - handle on May 16: "…"`)를 `parseOgCaption()`이 벗겨낸다.
  둘 다 비어 있으면 `needsManualCaption: true`가 되고 UI가 `CaptionPrompt`를 띄워
  사용자가 캡션을 직접 붙여넣게 한다.

인스타그램 실패는 구체적인 `FailureReason`과 함께 로깅한다. 조직적 차단, 셀렉터 파손,
타임아웃은 각각 정반대의 대응이 필요하므로 하나의 경고로 뭉뚱그리지 말 것.

**2. `extract.ts` — LLM이 캡션에서 장소 이름을 뽑아낸다**
OpenAI 호환 `/chat/completions` 엔드포인트면 무엇이든 동작하고, 기본값은 Gemini 호환
레이어를 가리킨다. `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL`만 바꾸면 **코드 수정 없이**
제공자를 교체할 수 있다 — 이 성질을 깨뜨리지 말 것. 5xx와 타임아웃은 재시도하고 429는
재시도하지 않는다(`LlmRateLimitedError` → 429와 할당량 안내 메시지로 표면화). 응답은
`strict` json_schema를 걸었더라도 Zod로 다시 검증한다. 제공자를 갈아끼우면 `response_format`을
무시할 수 있기 때문이다.

**3. `geocode.ts` — 네이버 지역검색이 이름을 좌표로 바꾼다**
병렬이 아니라 순차 호출이다. 네이버는 하나의 client id에서 몰아치는 요청을 거부한다.
지역 힌트를 붙인 질의를 먼저 시도한다(`대림창고`보다 `성수동 대림창고`가 낫다).
`mapx`/`mapy`는 WGS84 도 단위에 1e7을 곱한 값이다.

`matched: false`와 `lookupFailed: true`는 서로 다른 뜻이고 UI도 각각 다른 문구를 보여준다
— "지도에 없음"과 "검색이 일시적으로 죽음"은 다르다. 합치지 말 것.

## 반드시 지켜야 할 것

**소유권 검사는 DB가 아니라 애플리케이션에서 한다.** Prisma는 테이블 소유자로 접속하므로
Postgres RLS를 우회한다. 모든 라우트 핸들러는 `requireUser()`를 호출하고 반환된 `userId`로
쿼리를 한정해야 한다. `deleteMany({ where: { id, userId } })` 그 자체가 소유권 검사다 —
이걸 `delete({ where: { id } })`로 줄이면 그 행이 모든 사용자에게 조용히 열린다.

**클라이언트가 보낸 좌표는 절대 믿지 않는다.** `Place` 행은 사용자 간에 공유되며
`[name, address]`를 키로 쓴다. 요청 본문의 lat/lng을 그대로 받으면 한 사용자가 다른
사용자의 핀을 옮길 수 있다. `POST /api/posts`는 이름과 지역 힌트만 받고 서버에서 다시
지오코딩한다. 이미 있는 `Place` 행은 `update: {}`로 upsert한다 — 다른 게시글의 것이기도
하기 때문이다.

**proxy는 의도적으로 `/api`를 제외한다.** proxy의 리다이렉트 분기는 세션이 만료된
`fetch()`에 `/login`으로 가는 307을 돌려주고, 그 HTML 본문이 `res.json()`을 깨뜨린다.
클라이언트가 기대하는 것은 401이다. 라우트 핸들러는 이미 `requireUser()`를 호출한다.

**proxy의 세션 검사는 쿠키가 있는지만 본다.** Edge 런타임이라 DB도 `node:crypto`도 못 쓴다.
이건 인가 게이트가 아니라 사용자 편의를 위한 리다이렉트이고, 실제 검증은 모든 라우트가
부르는 `requireUser()`가 DB에 대고 한다. 위조 쿠키는 proxy를 통과해서 401을 만난다. 이
구분을 헷갈려서 proxy에 권한 판단을 얹지 말 것.

**`dev-auth.ts`는 살아 있는 인증 우회다.** 네이버 로그인 검수가 끝나지 않아 프로덕션 빌드를
포함해 무조건 활성화되어 있다. 인증되지 않은 누구든 `POST /api/dev-login`으로 고정된 dev uuid가
될 수 있다. 이 앱을 외부에 공개하기 전에 반드시 차단하거나 제거해야 한다 — 배경 장식이
아니라 미해결 항목으로 취급할 것.

**`src/generated/prisma/`는 생성물이다.** gitignore되어 있고 `prisma generate`가 다시 쓴다.
대신 `prisma/schema.prisma`를 수정한다.

**마이그레이션은 `DIRECT_URL`(5432 포트)로 실행한다.** 풀러(6543)에는 마이그레이션 엔진이
의존하는 prepared statement와 advisory lock이 없다. 앱 자체는 풀링된 `DATABASE_URL`로
동작한다. 마이그레이션은 Vercel 빌드 중에 실행되지 않는다.

**`frontend/AGENTS.md`는 `next dev`가 덮어쓴다.** 그 안의 Next.js 규칙 블록은 자동 생성물이다.
프로젝트 가이드는 루트인 이 파일에 쓰고, 다시 생성된 블록은 맞서 싸우지 말고 작업물과 함께
커밋한다.

## 인증

Supabase Auth는 쓰지 않는다. 네이버가 Supabase의 기본 제공자 목록에 없어서, OAuth 핸드셰이크와
세션을 전부 앱이 직접 소유한다. 코드는 [frontend/src/lib/auth/](frontend/src/lib/auth/)에 있다.

```
/api/auth/naver/start → 네이버 동의 화면 → /api/auth/naver/callback
   → 토큰 교환 → 프로필 조회 → linkProviderIdentity()
   → 전화번호 있음: 세션 발급 → /
   → 전화번호 없음: pending 쿠키 → /login/verify → SMS 인증 → 세션 발급
```

**제공자 추가는 파일 하나다.** `providers/`에 `OAuthProviderConfig`를 하나 만들고
`AuthProvider` enum과 `providers/index.ts`의 `FACTORIES`에 등록하면 끝이다. 라우트·세션·계정
연결은 이미 공용이다. 카카오·애플이 이 자리에 들어온다. 애플은 `response_mode=form_post`가
필요하므로 `extraAuthorizeParams`를 쓰고 callback을 POST로도 받아야 한다.

**세션은 DB에 있다.** 쿠키는 `<sessionId>.<secret>`이고 DB에는 secret의 SHA-256만 있다.
자기완결적 JWT였다면 로그아웃·탈퇴 후에도 만료까지 살아 있다 — 즉시 무효화가 필요해서
이렇게 했다. 대조는 `timingSafeEqual`로 한다. 로그인할 때는 기존 세션을 먼저 파기한다
(세션 고정 방지). `destroySession()`은 id만 보고 지우지 않고 secret까지 확인한다 — id는
cuid라 추측 가능해서, 확인 없이 지우면 남을 강제 로그아웃시킬 수 있다.

**pending 로그인 쿠키는 두 장이다.** 서명된 본문과 무작위 binding 값이 각각 다른 쿠키로
나가고, 본문 안의 HMAC이 binding과 맞아야만 열린다. 본문 하나만으로 열리게 두면 공격자가
자기 로그인으로 쿠키를 만들어 피해자 브라우저에 심고, 피해자가 자기 번호로 인증을 마치는
순간 공격자의 신원이 피해자 계정에 붙는다.

**계정 병합 키는 이메일이 아니라 전화번호다.** 제공자가 주는 이메일은 검증 여부를 보장할 수
없고, 검증 안 된 이메일로 매칭하면 그 제공자에서 이메일만 바꿔도 남의 계정을 가져간다.

**이미 있는 계정에 붙는 경우는 항상 SMS 인증을 거친다.** 신규 생성만 제공자가 준 번호로
바로 통과시킨다. 기존 계정에 붙이는 건 그 사람의 저장된 링크를 통째로 넘기는 방향이라,
제공자의 말이 아니라 그 기기에서 직접 증명하게 해야 한다. `ProviderProfile.phoneVerified`가
이 구분을 들고 있다 — **새 제공자를 추가할 때 기본값은 `false`이고**, 문서로 확인한 경우에만
`true`로 둔다. 네이버 `mobile`은 통신사 인증 값이라 `true`다.

**네이버는 필수 항목도 사용자가 거부할 수 있다.** `response` 안의 `id`를 빼면 전부 optional로
다뤄야 한다. 전화번호가 안 오면 로그인은 끝나지 않고 SMS 인증 단계로 넘어간다.

**네이버 응답은 200으로도 실패한다.** `resultcode`가 `"00"`인지 따로 봐야 하고, 토큰
엔드포인트도 200 본문에 `error`를 담아 보낸다. HTTP 상태만 믿지 말 것.

**Solapi에는 OTP 전용 API가 없다.** 인증번호는 일반 SMS로 나가고, 코드 생성·만료·시도 횟수
제한은 전부 `sms.ts`와 `PhoneVerification`이 직접 관리한다. 발신번호는 Solapi 콘솔에 사전
등록·승인(영업일 1~3일)되어 있어야 하고, 미등록 번호로 보내면 그냥 실패한다.

**네이버 로그인 키는 지역검색 키와 다른 애플리케이션이다.** `NAVER_LOGIN_CLIENT_ID`와
`NAVER_CLIENT_ID`를 섞어 쓰면 불친절한 401이 온다.

## 데이터 모델

`UserProfile`은 사람 하나다. 제공자별 필드는 들고 있지 않다 — 한 사람이 여러 제공자로
로그인할 수 있기 때문이다. `phone`이 유니크이고 계정 병합의 키다. 사용자가 고른
`mapProvider`도 여기에 담는다.

`AuthIdentity`는 `UserProfile`에 붙은 소셜 로그인 하나다. `[provider, providerUserId]`에
유니크가 걸려 있다 — 제공자 id는 그 제공자 안에서만 유일하므로 `providerUserId` 단독
유니크는 카카오 id와 네이버 id가 충돌할 수 있다. 네이버와 카카오를 둘 다 연결한 사람은
여기 두 행, `UserProfile` 한 행이다.

`Session`은 로그인한 브라우저 하나, `PhoneVerification`은 진행 중인 SMS 인증 하나다.

`SavedPost`는 `[userId, sourceUrl]`에 유니크가 걸려 있다 — 같은 링크를 다시 저장하면
중복되지 않고 갱신된다. 재저장은 장소 집합을 덧붙이는 게 아니라 **교체**하므로, 다시
인제스트했을 때 장소가 줄어들어도 고아 행이 남지 않는다.

`Place`는 전역 공유이고 `[name, address]`에 유니크가 걸려 있다. `SavedPostPlace`가 둘을
잇고 선택적 메모를 들고 있다. 저장 트랜잭션 안에서는 장소를 정렬한 뒤 upsert하는데,
동시에 실행되는 트랜잭션들이 락을 같은 순서로 잡게 하기 위해서다.

## 지도

세 개의 제공자가 `MapView` 스위치 하나 뒤에 있고, 설정에서 사용자별로 고른다: 네이버(기본),
카카오, 구글. 각각 provider를 key로 갖는 별도 컴포넌트라서, 전환하면 이전 지도를 재사용하지
않고 완전히 해체한다.

`lib/map/loader.ts`는 각 SDK를 페이지당 한 번만 로드하고, 전역 객체가 실제로 사용 가능해진
뒤에야 resolve한다 — 권한 없는 키도 200을 돌려주지만 그 본문은 네임스페이스를 정의하지
않으므로 `load` 이벤트만으로는 아무것도 보장되지 않는다. 카카오는 `autoload=false`로
주입되므로 `kakao.maps.load()` 콜백까지 기다려야 한다.

카메라 이동은 `FocusRequest { placeId, nonce }`로 전달된다. nonce가 반드시 필요하다: 같은
장소를 두 번 눌러도 다시 중심에 와야 하는데, React는 상태가 그대로면 렌더를 건너뛰기
때문이다. 마커는 effect 의존성이 아니라 ref(`useMarkerLookup`)에 담는다. 그러지 않으면
무관한 게시글을 저장할 때마다 카메라가 마지막으로 포커스한 핀으로 끌려간다.

각 지도 콘솔의 허용 도메인에 `http://localhost:4000`과 배포 도메인이 등록되어 있어야 한다.
없으면 지도는 아무 말 없이 렌더링에 실패한다.

## 환경변수

`frontend/.env.example`을 `frontend/.env`로 복사한다. 앱을 띄우려면 `DATABASE_URL`/`DIRECT_URL`,
`AUTH_SECRET`, `LLM_API_KEY`, 네이버 검색 키 쌍, `NEXT_PUBLIC_NAVER_MAP_CLIENT_ID`가 필요하다.
실제 네이버 로그인에는 `NAVER_LOGIN_CLIENT_ID`/`NAVER_LOGIN_CLIENT_SECRET`이, SMS 인증에는
`SOLAPI_API_KEY`/`SOLAPI_API_SECRET`/`SOLAPI_SENDER_PHONE`이 추가로 필요하다(없으면 테스트
계정 로그인만 동작한다).
선택: `AUTH_BASE_URL`(프로덕션 콜백 URL 고정), `YOUTUBE_API_KEY`(없으면 유튜브 캡션은 항상 수동 입력),
`NEXT_PUBLIC_KAKAO_MAP_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_KEY`, `LLM_*` 오버라이드.

`.env*`는 `.env.example`만 빼고 gitignore된다. 실제 키를 절대 커밋하지 말 것. 새 변수를
추가할 때는 발급처를 적은 주석과 함께 `.env.example`에도 넣는다.

## 컨벤션

- **AI는 사용자에게 항상 한국어로 답변한다.** 코드·주석·식별자는 영어로 유지하되, 대화 응답은 한국어.
- TypeScript strict, `@/*` → `src/*`, Tailwind v4 유틸리티 클래스는 인라인.
- **사용자에게 보이는 문자열은 전부 한국어.** 코드·주석·식별자는 영어.
- 에러는 `lib/api.ts`의 `toErrorResponse()`를 거쳐 클라이언트에 전달된다. 알려진 에러
  클래스를 상태 코드로 매핑하고 나머지는 전부 일반적인 500 뒤로 감춘다. 라우트에서 제각각
  에러 형태를 만들지 말고 여기에 분기를 추가한다.
- 요청 본문은 라우트 경계에서 Zod로 검증한다. `ZodError`는 400이 된다.
- 이 코드베이스의 주석은 *왜*를 설명하며, 대개 어렵게 알아낸 외부 동작을 기록한 것이다.
  해당 코드를 고칠 때는 주석도 함께 고칠 것. 그러지 않으면 다음 사람이 그 주석이 막고 있던
  버그를 다시 만들어 넣는다.
