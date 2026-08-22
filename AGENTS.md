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
    (app)/          모든 페이지 — 홈(붙여넣기 + 지도 + 목록), 링크 목록, 프로필 수정,
                    설정(+비밀번호 변경), 약관·개인정보
    api/            ingest, posts, settings, account
    api/auth/       [provider]/start·callback, phone/send·verify, logout
    verify-phone/   휴대폰 인증 — 모든 첫 로그인이 반드시 거치는 관문
  components/       HomeClient(메인 플로우 전체), LoginDrawer, PhoneVerifyForm,
                    CaptionPrompt, ProfileEditClient, SettingsClient, map/*
  lib/
    ingest/         metadata.ts → extract.ts → geocode.ts  (파이프라인, 이 순서대로)
    map/            SDK 로더, 지도 공용 타입, 마커 조회 훅
    auth/           세션·OAuth·계정연결·SMS 인증 (아래 "인증" 절)
    auth.ts         requireUser() — 모든 라우트의 소유권 게이트
  generated/prisma/ Prisma 클라이언트 생성물 — 생성 파일, gitignore, 직접 수정 금지
```

**페이지는 전부 로그인 없이 열린다.** 로그인 페이지도, proxy(미들웨어)도 없다. 페이지는
`requireUser()` 대신 `getUser()`를 부르고, 세션이 없으면 빈 지도·빈 목록을 렌더링한 뒤
`LoginDrawer`로 로그인을 권한다. 저장·삭제 같은 실제 동작은 여전히 API가 막는다 — 라우트
핸들러의 `requireUser()`가 유일한 게이트다.

유일한 예외가 `/verify-phone`이다. 이건 로그인 진입점이 아니라 이미 시작된 로그인의 후반부라서,
pending 쿠키가 없으면 홈으로 돌려보낸다. 세션을 요구하는 게 아니므로 위 원칙과 충돌하지 않는다.

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

# 일회성: 평문으로 남은 전화번호를 암호화한다. 아래 "전화번호 암호화 마이그레이션" 참고.
npx tsx --env-file=.env scripts/backfill-phone-encryption.ts

# 일회성: 백업 도입 전에 저장된 인스타그램 썸네일을 Blob으로 복구한다.
# 아래 "인스타그램 썸네일은 만료된다" 참고. --delay-ms / --limit 옵션이 있다.
npx tsx --env-file=.env scripts/backfill-thumbnail-backup.ts
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

**1.5. `post-thumbnail.ts` — 인스타그램 썸네일을 Blob으로 복사한다**
아래 "인스타그램 썸네일은 만료된다"를 참고. 인스타그램에만 적용되고, 실패하면 조용히
원본 URL을 쓴다.

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

**리다이렉트로 페이지를 막지 말 것.** proxy(미들웨어)는 삭제됐다. 페이지를 세션으로 걷어내던
장치가 없어졌으니, 인가는 전부 라우트 핸들러의 `requireUser()` 한 곳에서만 일어난다. 페이지에
`requireUser()`를 다시 넣으면 로그인 없이 접속 가능하다는 전제가 깨지고, 미들웨어를 되살리면
세션이 만료된 `fetch()`가 401 대신 로그인 페이지 HTML을 받아 `res.json()`이 깨진다.

**페이지가 비어 보이는 것과 막히는 것은 다르다.** 로그아웃 상태의 홈은 핀이 없고 목록은
비어 있지만, 그건 `getUser()`가 null을 돌려줘서 조회할 `userId`가 없기 때문이다. 저장·삭제·
설정 변경은 그대로 401이다. 클라이언트의 `signedIn` 플래그는 UI를 고르는 값일 뿐 권한이
아니다 — 이걸 근거로 서버 검사를 생략하지 말 것.

**회원탈퇴는 삭제가 아니라 상태 변경이다.** `DELETE /api/account`는 아무것도 지우지 않는다 —
`UserProfile`·`AuthIdentity`·`SavedPost`는 전부 남고 `withdrawnAt`만 찍힌다(`Session`만 예외로
삭제한다. 남겨두면 살아 있는 쿠키가 탈퇴 계정을 가리킨 채 `requireUser()` 검사 하나에만 의존하게
된다). 이 플래그가 장식이 아니게 만드는 건 **세 곳의 필터**이고, 셋은 반드시 함께 움직인다:

1. `requireUser()`가 `withdrawnAt: null`로 조회한다 — 하드 삭제와 달리 행이 남아 있으므로,
   이 필터를 빼면 탈퇴 계정이 그대로 정상 로그인 상태가 된다.
2. `linkProviderIdentity()`의 identity 조회가 탈퇴 행을 건너뛴다 — 여기서 걸러지지 않으면
   탈퇴 계정이 재방문 로그인으로 세션을 받는다. (예전에는 여기에 phone 조회도 있었지만,
   첫 로그인이 전부 SMS로 가면서 그 조회는 사라졌다. 살아 있는 행만 병합 대상으로 보는
   판단은 아래 3번으로 옮겨졌다.)
3. `attachIdentity()` 트랜잭션 안의 owner 조회도 마찬가지다 — 여기가 재로그인 시 신규 생성이냐
   재사용이냐를 가르는 지점이다.

**unique는 살아 있는 행에만 걸린다.** 탈퇴 행이 전화번호와 제공자 id를 그대로 들고 있으므로,
`UserProfile.phoneHash`와 `AuthIdentity[provider, providerUserId]`의 전역 unique를 그대로 두면 같은
사람이 다시 가입할 수 없다. 둘 다 **partial unique index**(`WHERE "withdrawnAt" IS NULL`)로
바뀌었고, Prisma 스키마 언어로는 표현할 수 없어서 마이그레이션 raw SQL에만 있다. 그래서
스키마에는 `@unique`가 아니라 평범한 `@@index`가 적혀 있다 — **다시 `@unique`로 되돌리면
탈퇴한 사용자가 영구히 재가입 불가가 된다.** 전화번호로 `findUnique`를 쓸 수 없게 된 것도
의도된 것이다(컴파일이 깨진다). 반드시 `findFirst` + `withdrawnAt: null`을 쓸 것.

**재로그인하면 새 `UserProfile`이 생긴다.** 탈퇴 계정은 그대로 보존되고, 같은 네이버 계정으로
다시 들어와도 이전 링크는 보이지 않는다. `AuthIdentity.withdrawnAt`은 `UserProfile`의 것을
비정규화한 값이다 — partial unique index가 자기 테이블 컬럼만 읽을 수 있어서 필요하고, 같은
트랜잭션에서 함께 쓰므로 어긋날 수 없다.

**탈퇴를 되돌리는 경로는 없다.** 로그인이 닿는 조회는 전부 `withdrawnAt: null`로 걸러지므로,
탈퇴한 계정으로 다시 들어오면 새 `UserProfile`이 생기고 이전 데이터는 보이지 않는다.

탈퇴를 되돌릴 수 있는 유일한 형태는 **이미 아는 프로필 id에 대고 직접 `upsert`/`update`를
하는 것**이고, 지금 그런 호출부는 없다. 예전에는 있었다 — 테스트 로그인이 고정 uuid를
upsert하면서 `withdrawnAt`을 `null`로 되돌렸고, 그게 탈퇴 테스트 한 번에 모든 환경의 유일한
진입로가 막히는 걸 막는 장치였다. 그 로그인은 삭제됐지만 **고정 id를 upsert하는 코드를 다시
넣으면 같은 구멍이 돌아온다.** 계정은 반드시 제공자 identity나 전화번호로 찾을 것 — 둘 다
탈퇴 행을 건너뛴다.

**탈퇴 확인은 `AlertDialog` 하나다.** 문구 입력은 없고, 라우트는 요청 본문을 아예 읽지 않는다 —
읽지 않는 본문은 침입 경로가 될 수 없다. 실제 게이트는 `requireSameOrigin()` + 세션이고, 이
라우트에 닿을 수 있는 호출자는 이미 계정 주인이다. **탈퇴가 소프트 삭제라서 이 정도로 충분하다**
— 되돌릴 수 없는 하드 삭제로 되돌린다면 타이핑 확인 같은 추가 게이트를 다시 넣을 것.

**UI 문구로 "모두 삭제"라고 쓰지 말 것** — 데이터는 남는다. 사용자에게는 "다시 볼 수 없고
재로그인 시 새 계정으로 시작한다"고만 약속한다.

**테스트 계정 로그인은 삭제됐다.** `lib/dev-auth.ts`, `POST /api/dev-login`, `prisma/seed.ts`,
`AuthProvider.DEV`가 전부 사라졌다. 인증되지 않은 누구든 한 번의 POST로 고정된 uuid가 될 수
있는 우회로였다. **다시 만들지 말 것** — "로컬에서만"이라는 의도로 들어와도 이 코드베이스에는
그걸 강제할 환경 분기가 없었고, 실제로 프로덕션 빌드에서도 켜져 있었다. 로그인 흐름을 손으로
확인해야 하면 네이버 로그인 키와 Solapi 키를 채워서 진짜 경로로 들어갈 것.

**프로필 사진의 타입은 요청 헤더가 아니라 파일의 매직바이트가 결정한다.** 코드는
[frontend/src/lib/profile-image.ts](frontend/src/lib/profile-image.ts)에 있다.
`file.type`은 multipart 파트 헤더, 즉 **호출자가 쓴 문자열**이다. 그걸 allowlist로 검사하고
그대로 `contentType`에 박으면 검사한 것은 호출자의 주장뿐이고, 아무 바이트나 자기가 고른
타입으로 blob 오리진에 올릴 수 있다. 그래서 앞 12바이트를 읽어 실제 포맷을 판정하고
(`sniff()`), 선언된 값이 그와 **일치할 때만** 통과시킨다. 저장하는 `contentType`도 판정 결과다.

allowlist 자체도 필요하다 — `image/`로 시작하는지 보는 prefix 검사로 되돌리지 말 것.
`image/svg+xml`이 그 검사를 통과하면서 스크립트를 실어 나르고, Blob은 시키는 대로 서빙하므로
누가 그 사진 URL을 직접 여는 순간 blob 오리진에서 XSS가 된다.

**HEIC은 서버 allowlist에 없다.** iOS Safari는 HEIC를 디코드하므로 클라이언트의 `downscale()`이
WEBP로 다시 인코딩해서 보낸다. 디코드 못 하는 브라우저는 원본을 보내게 되는데, 그 브라우저는
받아서 **표시도 못 한다** — 저장은 성공하고 아바타는 비어 보인다. 파일 선택기의 `accept`에는
HEIC를 남겨 둔다(아이폰 사진 대부분이 HEIC라 빼면 선택이 막힌다).

**사진 blob의 키에는 랜덤 접미어를 붙인다**(`addRandomSuffix`). 사용자 id만으로 고정 키를 쓰면
같은 자리를 덮어쓰게 되고, URL이 그대로라서 **blob CDN이 이전 이미지를 계속 서빙한다** — 사용자는
새 사진을 올리고 옛 사진을 본다. 매번 새 URL이 나오게 하고, 대체된 blob은 행이 커밋된 *뒤에*
지운다. 순서를 뒤집으면 update가 실패했을 때 존재하지 않는 blob을 가리키는 행이 남는다.

**사진 변경은 세 상태다: 교체 / 삭제 / 그대로.** 파일이 오면 교체, `removeImage=1`이면 삭제,
둘 다 없으면 손대지 않는다. "파일이 없으면 삭제"로 줄이지 말 것 — 닉네임만 고친 저장이 매번
사진을 조용히 지운다.

**지울 blob의 URL은 update와 같은 트랜잭션 안에서 다시 읽는다.** `requireUser()`가 준 행은
업로드 *전에* 읽은 값이라서, 동시에 두 번 저장하면(더블탭, 탭 두 개) 둘 다 같은 옛 URL을 보고
그것만 지운다 — 서로가 대체한 blob은 아무도 지우지 않고 참조 없는 과금 대상으로 남는다.

**탈퇴는 사진만 예외로 실제로 지운다.** 탈퇴는 소프트 삭제지만 `imageUrl`은 행 데이터가 아니라
**공개된 blob CDN URL**이다. 앱에서 닿을 수 없게 되는 것과 URL을 아는 사람이 못 받는 것은
다르고, 얼굴 사진이 영구히 열려 있는 것은 탈퇴가 약속한 바가 아니다. 트랜잭션이 커밋된 뒤
best effort로 지우고 컬럼은 `null`로 만든다.

**설정은 페이지(`/settings`)다.** `AppDrawer`가 비밀번호·약관·로그아웃·회원탈퇴를 들고
있었지만, 그 항목들은 하나같이 다른 화면으로 나가거나 세션을 끝낸다 — 도착과 동시에 닫아야
하는 패널은 페이지가 할 일을 대신하는 것이다.

**지도 제공자 선택만 drawer에 남는다.** 바로 뒤에 보이는 지도를 바꾸는 유일한 설정이라,
선택과 그 결과 사이에 페이지 이동을 끼우면 안 된다. `/settings`가 전부 같은 모양의 행으로만
이루어진 목록이라는 점도 있다 — 라디오 카드 하나가 섞이면 그것만 실수처럼 보인다.
같은 이유로 **회원탈퇴 행도 빨간색이 아니다**; 경고는 확인 다이얼로그가 나른다.

**비밀번호 변경도 별도 페이지(`/settings/password`)다.** 3단계 중 가운데에서 사용자가 문자
앱으로 나갔다 돌아오는데, 그때 패널이 열려 있다는 보장이 없으면 방금 SMS 한 통으로 얻은 증명을
잃는다. `/profile`을 페이지로 만든 것과 같은 판단이며, 거기서는 파일 선택기가 같은 역할을 한다.
**둘 다 `requireUser()`를 쓰지 않는다** — 약관·개인정보 행은 로그아웃 상태에서도 살아 있어야
하고, 게이트는 언제나처럼 API다.

**인스타그램 썸네일은 만료된다.** `scontent-*.cdninstagram.com` URL은 서명 URL이고
`oh`/`oe`/`_nc_ohc`가 서명과 만료 시각이다. 저장한 날에는 보이던 썸네일이 며칠 뒤
`403 URL signature expired`가 되어 `/links`의 카드가 전부 깨진다. **원본 URL을 다시
fetch해도 재서명되지 않으므로** 인제스트 시점에 바이트를 Vercel Blob으로 복사하는 것이
유일한 해결이다. 코드는
[frontend/src/lib/post-thumbnail.ts](frontend/src/lib/post-thumbnail.ts)에 있다.

유튜브(`i.ytimg.com`)와 지도 og:image는 서명이 없어 영구적이다. **백업은 인스타그램에만
한다** — 나머지는 없는 문제에 저장공간과 전송량을 쓰는 것이다.

**백업은 `/api/posts`가 아니라 `/api/ingest`에서 한다. 이유는 SSRF다.** posts에서 하면
서버가 `body.post.thumbnail`, 즉 **클라이언트가 준 임의의 URL을 fetch**하게 된다. 이 저장소가
lat/lng을 받지 않고 서버에서 재지오코딩하는 것과 똑같은 원칙에 걸린다. ingest 시점에는 서버가
방금 자기가 인스타그램 HTML에서 파싱한 URL만 fetch한다. og:image 값도 결국 인스타가 준
문자열이므로 호스트 allowlist와 `redirect: "manual"`은 여전히 필요하다 — 3xx를 따라가면
allowlist가 첫 홉에만 걸린 셈이 된다.

**`thumbnail`은 "렌더할 URL", `thumbnailSource`는 "백업됐다는 술어"다.** 별도 blob 컬럼을
만들지 않은 이유는 렌더 지점이 넷이라서다 — `thumbnailBlobUrl ?? thumbnail` 폴백을 네 곳에
쓰게 되고, 한 곳만 빠뜨리면 **그 화면만** 깨진다. `thumbnailSource IS NOT NULL`로 백업 여부를
판정할 것. blob 호스트 문자열 매칭으로 바꾸지 말 것 — 호스트가 바뀌면 전부 오판한다.
만료된 원본 URL도 지우지 않는다: 재백업 때 게시글을 다시 스크레이핑(=인스타 차단에 노출)하지
않고 출처를 아는 유일한 값이다.

**`post-thumbnail.ts`는 절대 throw하지 않는다.** `profile-image.ts`와 정반대 계약이고 그게
두 파일이 따로 있는 이유다. 프로필 사진 업로드는 사용자가 요청한 동작 자체이므로 400으로
말해 주는 게 맞다. 썸네일 백업은 요청한 적 없는 부수 작업이다. `BLOB_READ_WRITE_TOKEN`이
없다는 이유로(로컬 개발의 정상 상태) 링크 저장이 실패하면 배포 설정 하나가 제품을 멈춘다.
**만료될 URL로 저장하는 것이 저장하지 못하는 것보다 언제나 낫다.** `lib/api.ts`에 이 경로의
에러 클래스를 추가하지 말 것.

**재저장은 썸네일이 null이면 컬럼을 건드리지 않는다.** 다른 필드는 `?? null`로 덮어쓰지만
이것만 조건부다 — 인스타가 차단 중일 때의 재인제스트는 `thumbnail: null`을 들고 오고,
덮어쓰면 여전히 유효한 blob을 잃고 그 blob은 미참조로 남는다. 사용자가 썸네일을 *지우는*
경로는 없으므로 null을 "지워라"로 읽지 말 것.

**썸네일 blob을 지우기 전에 참조 수를 센다. 이게 blob의 소유권 검사다.**
`thumbnail`은 요청 본문으로 오고, **썸네일 blob URL은 공개다** — `SavedPostDTO`에 실려 나가고
`GET /api/places/[id]/sources`는 인증 없이 모든 사용자의 게시글을 돌려준다. 그래서 로그인한
누구든 **남의 썸네일 URL을 자기 게시글에 저장할 수 있다.** 정상적인 첫 저장의 blob은 방금
인제스트가 만들어 아직 어떤 행에도 없으므로, 저장 시점에는 "이미 참조된 것"과 "남의 것"이
구별되지 않는다. 그래서 저장 경로에서 거부하지 않고 **삭제 직전에** 다른 행이 그 URL을
참조하는지 세고 0일 때만 지운다. 남의 blob은 주인의 행이 여전히 참조하므로 삭제되지 않는다.

`isOwnThumbnailBlob()`은 이 검사의 **절반일 뿐이다.** "우리 스토어의 썸네일인가"만 답하고
"이 사용자의 것인가"는 답하지 못한다. **이것만 보고 지우지 말 것.** 호스트는 실제 서빙 형태인
`<store>.public.blob.vercel-storage.com`으로 좁혀야 한다 — `.blob.vercel-storage.com`까지
넓히면 다른 Vercel 고객의 스토어도 우리 것으로 오판한다. 경로 prefix(`/post-thumbnail/`)도
필요하다: 같은 스토어에 프로필 사진이 `/profile/`로 들어 있어서, 잘못 지우면 아바타가 사라진다.

이 참조 카운트가 매 저장·삭제마다 돌기 때문에 `SavedPost.thumbnail`에 인덱스가 있다.
장식이 아니다 — 빼면 저장할 때마다 풀스캔이다.

대체·삭제 시 **지울 URL은 `profile-image`와 같이 트랜잭션 안에서 읽어** 커밋 후에 지운다.
저장 경로에는 남은 경합이 하나 있다: 새 링크를 동시에 두 번 저장하면 둘 다 `previous`를
null로 읽어 한쪽이 자기가 대체한 blob을 모른 채 넘어가 **blob 하나가 누수된다.** 닫으려면
`SELECT … FOR UPDATE`나 serializable이 필요하고, 대가는 이미지 하나의 저장공간이라 감수했다.

**탈퇴 시 썸네일 blob은 지우지 않는다.** 프로필 사진은 지운다. 판단이 다른 이유는 프로필
사진이 **본인의 얼굴**이고 탈퇴가 약속하는 것이 "나를 더 이상 찾을 수 없게 한다"라는 것이기
때문이다. 게시글 썸네일은 인스타그램이 이미 전 세계에 공개한 남의 게시물 이미지의 사본이고
사용자에 대해 아무것도 말하지 않는다. 게다가 탈퇴는 소프트 삭제라서 `SavedPost` 행 자체가
남는다 — 행을 남기고 이미지만 지우면 복원 가능성만 잃고 프라이버시는 얻지 못한다.

**`src/generated/prisma/`는 생성물이다.** gitignore되어 있고 `prisma generate`가 다시 쓴다.
대신 `prisma/schema.prisma`를 수정한다.

**전화번호 암호화 마이그레이션은 3단계다.** 두 마이그레이션 사이에 백필이 끼기 때문이다 —
HMAC과 AES는 앱 키를 요구하므로 SQL로는 계산할 수 없다.

```bash
npx prisma migrate deploy   # 20260817160000_encrypt_phone 까지
npx tsx --env-file=.env scripts/backfill-phone-encryption.ts
npx prisma migrate deploy   # 20260817160100_drop_phone_plaintext
```

백필을 건너뛰고 두 번째 마이그레이션을 적용하면 그 계정들은 번호를 잃고 다음 로그인에서 SMS
재인증을 하게 된다(깨지지는 않는다 — `phoneHash`가 NULL인 건 SMS 인증 전 계정과 같은 상태다).
백필은 idempotent해서 중간에 죽으면 다시 돌리면 된다. 유효한 휴대폰 번호 형식이 아닌 행은
건너뛰고 목록을 경고로 출력한다 — 두 번째 마이그레이션이 원본을 지우므로 그 목록은 실제로
잃게 되는 데이터다.

**살아 있는 트래픽에 적용한다면 이 순서로는 안 된다.** 구버전 앱 인스턴스가 `phoneHash`를
NULL로 둔 신규 행을 쓰는 창이 생기고, Postgres는 unique index에서 NULL을 서로 다른 값으로
취급하므로 그 행들이 병합 키 유일성을 그대로 통과한다 — 한 번호가 살아 있는 계정 둘을 갖는다.
그때는 컬럼 추가 → dual-write 배포 → 백필 → unique index 추가 → 읽기 전환 배포 → 컬럼 삭제로
쪼갤 것. 지금 한 번에 한 이유는 이 앱에 번호를 든 살아 있는 계정이 아직 없었기 때문이다.

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
LoginDrawer → /api/auth/naver/start?next=<현재 경로> → 네이버 동의 화면
   → /api/auth/naver/callback → 토큰 교환 → 프로필 조회 → linkProviderIdentity()
   → 재방문(AuthIdentity 있음): 세션 발급 → <원래 경로>
   → 그 외 전부(첫 로그인): pending 쿠키 → /verify-phone (페이지)
                     → SMS 인증 → 세션 발급 → <원래 경로>
```

제공자가 전화번호를 줬는지 여부는 **분기를 바꾸지 않는다.** 줬으면 `/verify-phone`의 입력값이
미리 채워지는 것뿐이다.

**제공자 선택은 drawer, 휴대폰 인증은 페이지다.** `LoginDrawer`는 보던 화면을 떠나지 않아야
하는 진입점이라 하단 drawer이고, `/verify-phone`은 반드시 통과해야 하는 관문이라 페이지다.
페이지인 이유는 **렌더 자체를 거부할 수 있어야** 하기 때문이다 — pending 쿠키 없이 들어오면
`redirect("/")`로 돌려보낸다. drawer 안에 두면 검증할 대상이 있는지 모르는 상태로 폼을 먼저
그리게 되고, 그 폼의 모든 제출은 401밖에 될 수 없다.

**시작 경로는 `?next=`로 넘기고 `RETURN_TO_COOKIE`에 담긴다.** 제공자 왕복은 다른 오리진을
거치므로 쿼리스트링이나 메모리에 든 값은 살아남지 못한다. `/verify-phone`도 이 쿠키를 읽어
인증을 마친 뒤 원래 페이지로 보낸다 — 그래서 콜백의 pendingPhone 분기는 이 쿠키를 지우지
않는다. 돌아오는 경로는 `safeReturnPath()`가 앱 내부로 제한한다. 절대 URL이나 `//evil.com`을
그대로 받으면 로그인이 오픈 리다이렉트가 된다.

**`safeReturnPath()`는 문자열을 검사하지 않고 파싱해서 확인한다.** 임시 오리진에 대고
`new URL()`로 풀어 본 뒤 그 오리진이 그대로 남았는지만 본다. 막아야 하는 대상이 바로
`new URL()`이 문자열을 어떻게 재해석하는지이기 때문에, 입력을 패턴으로 걸러내는 방식은
계속 뚫린다 — 파서는 authority 자리에서 `\`를 `/`와 같게 취급하고, 탭·개행 같은 C0 제어문자는
authority를 찾기 *전에* 떼어낸다. 그래서 `/\evil.com`과 `/<TAB>/evil.com`은 둘 다
`startsWith("/")`와 `startsWith("//")` 검사를 통과하면서 `http://evil.com/`으로 풀린다.
`startsWith` 기반 블랙리스트로 되돌리지 말 것.

**로그인 실패는 `?auth=login&error=<slug>`로 알린다.** `HomeClient`가 이걸 초기 상태로 한 번
읽고 URL에서 지운다 — 남겨두면 새로고침이 이미 닫은 drawer를 다시 열어버린다. 여기로 오는
건 실패한 로그인뿐이다. 정상적으로 진행된 첫 로그인은 `/verify-phone`으로 간다.

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

**휴대폰 계정은 `AuthIdentity`를 만들지 않는다** — 제공자 계정이 없으므로 담을 provider id가
없다. `upsertPhonePassword()`가 `phoneHash`로 프로필을 찾고 없으면 만든다.

**가입과 로그인은 이제 별개의 화면·별개의 라우트다.** 예전에는 한 호출이었고 그게 열거
방지책이었다("이 번호에 계정이 있나"를 HTTP로 답하지 않기 위해). 지금은 사용자가 가입이냐
로그인이냐를 직접 고르므로 서버가 그 질문에 답할 필요가 없어졌고, 대신 **각 라우트의 응답이
자기 안에서 균일해야 한다**는 요구로 옮겨갔다 — `login`은 세 실패를 한 문구로, `reset/send`는
계정 없는 번호에도 성공을 답한다. 이 균일성을 깨는 분기를 넣지 말 것.

**단 `signup/password`는 이미 비밀번호가 있는 계정을 거부한다**(`PhoneAlreadyRegisteredError`
→ 409). 위의 균일성 요구에 대한 의도된 예외이고, 예외가 성립하는 이유는 **이 지점에 닿은
호출자는 이미 그 번호를 SMS로 증명했다**는 것이다 — 열거를 하려면 번호마다 문자 한 통과 정확한
코드 한 개를 지불해야 하고, 그 코드는 번호의 실제 소유자에게만 간다. 그래서 `send`/`verify`는
여전히 균일하고, 여기서만 답한다.

거부하는 이유는 `upsertPhonePassword()`가 원래 그 계정의 `passwordHash`를 **덮어썼기** 때문이다.
가입 화면이 사실상 두 번째 비밀번호 재설정 경로였고, `reset/password`와 달리
`destroyAllSessionsForUser()`를 부르지 않으므로 **이전 소유자의 세션이 그대로 살아남았다.**
통신사가 번호를 재활용하면 새 소유자가 SMS로 증명해서 이전 소유자의 계정을 인수한다.

**병합 경로는 그대로 살아 있다.** 거부하는 조건은 "계정이 있다"가 아니라 `passwordHash`가 이미
있다는 것이다 — 네이버로만 가입한 사람(`passwordHash`가 null)은 여전히 같은 프로필에 비밀번호를
붙인다. 이 조건을 "owner가 있으면 거부"로 넓히지 말 것: 그러면 문서화된 병합 불변조건이 깨진다.
**거부는 두 겹이고 둘 다 필요하다.** `signup/verify`가 코드 검증 *직후*·증명 발급 *직전*에
먼저 거부하고(`phone-challenge-flow.ts`), `upsertPhonePassword()`가 트랜잭션 안에서 다시
거부한다.

- verify 쪽만 두면 두 요청 사이(verify → password)에 그 계정이 비밀번호를 갖게 되는 경합에서
  덮어쓰기가 통과한다. 진짜 가드는 트랜잭션 쪽이다.
- 트랜잭션 쪽만 두면 `spendProvenPhone()`이 이미 `spentAt`을 **다른 트랜잭션에서 커밋한** 뒤라
  409의 롤백이 그걸 되돌리지 못한다. 사용자는 비밀번호 화면에 갇혀서, 다시 누르면 409가 아니라
  401(`휴대폰 인증이 필요합니다`)을 받고 복구에 SMS를 한 통 더 써야 한다 — 재발송 쿨다운이나
  시간당 상한에 걸리면 그마저 막힌다. verify 쪽 거부는 **증명을 아예 발급하지 않으므로** 그
  막다른 길을 없앤다.

검사는 owner 조회와 **같은 트랜잭션 안**에 있어야 한다 — 밖으로 빼면 동시 요청 둘이 모두
"비밀번호 없음"을 읽고 둘 다 쓴다.

**거부가 누설하는 것은 "계정이 있다"가 아니라 "비밀번호가 있는 계정이 있다"다.** 네이버로만
가입한 번호(`passwordHash`가 null)는 여전히 성공을 답하고 병합된다.

병합은 자동으로 성립한다. `upsertPhonePassword()`·`replacePhonePassword()`·
`attachIdentity()`와 `POST /api/auth/phone/login`이 전부 같은 owner 조회
(`phoneHash` + `withdrawnAt: null`)를 쓰기 때문이다 — **탈퇴 필터가 걸린 자리가 이제 여럿이고,
전부 반드시 함께 움직인다.** 하나라도 빼면 탈퇴 계정이 그 경로로 그대로 살아난다.

**로그인 경로는 이제 셋이다: 제공자, 휴대폰+비밀번호, 그리고 휴대폰 SMS(제공자 첫 로그인의 후반부).**
휴대폰+비밀번호는 `UserProfile.passwordHash`(scrypt, `s1.<salt>.<derived>`)를 쓴다.

**비밀번호는 번호가 아니라 계정에 걸린다.** `phoneHash`는 병합 키다 — 번호에 credential을
매달면 그 번호가 나중에 병합되는 계정으로 비밀번호가 따라가고, 통신사가 번호를 재활용하면
이전 소유자의 비밀번호가 새 소유자에게 넘어간다. 사람이 비밀번호를 소유한다.

**비밀번호는 SMS로 번호를 증명한 뒤에만 설정된다.** 이 순서가 없으면 남의 번호에 비밀번호를
걸어 계정을 선점할 수 있다. 증명은 challenge 쿠키의 `verifiedPhone`이 나르고, 그 값을 쓰는
쪽은 `provenPhone()` 하나뿐이다 — 요청 본문의 번호를 절대 믿지 않는다(믿으면 A를 증명하고
B에 비밀번호를 걸 수 있다).

**challenge 쿠키에는 `intent`(`signup` | `reset`)가 있고 SMS `purpose`에 섞인다.**
가입용으로 발급된 코드가 재설정을 완료하거나 그 반대가 되면 안 된다. `verifyPhoneCode`는
`purpose`를 정확히 일치 비교하므로, 이 접두어가 실제 격리 장치다.

**`POST /api/auth/phone/login`은 세 가지 실패를 한 문구로 답한다.** 계정 없음 / 비밀번호
미설정 / 비밀번호 불일치. 구분하면 어떤 번호가 가입돼 있고 그중 어느 것이 비밀번호를 쓰는지
누설된다. 타이밍도 맞춰야 해서 계정이 없어도 `burnPasswordComparison()`으로 scrypt 비용을
똑같이 지불한다 — **빠른 실패 경로를 추가하지 말 것.** 그게 곧 오라클이다.

**비밀번호 시도 예산은 SMS 예산과 별개다.** SMS 세 축은 전부 *발송*을 세는데 비밀번호 시도는
발송이 없다. `PasswordAttempt` 테이블이 caller(senderKey) 기준으로 센다. 계정 기준이 아닌
이유가 중요하다 — 계정 기준이면 아무나 특정 사용자의 번호를 계속 찍어서 그 사람을 잠글 수
있고, 무차별 대입 방어가 서비스 거부 도구로 바뀐다.

**비밀번호 재설정은 그 계정의 모든 세션을 파기한다**(`destroyAllSessionsForUser`).
재설정은 보통 "누가 내 계정에 들어온 것 같다"의 대응이므로, 상대 세션이 계속 살아 있으면
의미가 없다. 세션을 DB에 두는 이유가 바로 이것이다.

**`/api/settings/password`는 세션만으로 통과시키지 않는다.** 세션 + 그 계정 번호로의 SMS
재인증 + **이미 비밀번호가 있으면 현재 비밀번호**까지 요구한다.

세 번째가 필요한 이유가 미묘하다. SMS 증명은 2차 인증처럼 보이지만 아니다 — 세션을 훔친
공격자는 **공개된 재설정 흐름으로 자기가 가진 번호의 증명을 받아올 수 있다.** 그래서 "증명이
있다"는 사실만으로는 주인과 공격자가 구별되지 않는다. 구별하는 건 기존 비밀번호를 아는지다.
최초 설정에는 알아야 할 것이 없으므로 요구하지 않는다.

**비밀번호 시도 예산은 두 축이다.** caller(`senderKey`)와 account(번호 해시). caller 축만
두면 안 되는 이유: `senderKey`는 leftmost `x-forwarded-for`라 헤더 하나 바꾸면 리셋된다.
SMS 쪽은 그 아래에 번호별 상한이 깔려 있지만 비밀번호 로그인에는 그런 바닥이 없어서,
caller 축 단독이면 추측 공간이 사실상 무제한이 된다. account 축은 **잠금이 아니다** —
계정 행에 쓰지 않고 윈도우가 지나면 풀리므로, 남이 내 로그인을 영구히 막는 도구가 되지 않는다.
**계정이 없는 번호에도 카운트해야 한다.** 없을 때 건너뛰면 rate limit의 유무 자체가
"이 번호가 가입돼 있나"의 오라클이 된다.

**로그인 성공은 예산을 되돌린다**(`clearPasswordAttempts`). 성공까지 세면 NAT·CGNAT 뒤의
평범한 사용자들이 *평범한 로그인*으로 남의 몫까지 소진한다. 실패만 쌓여야 한다.

**SMS 증명은 서버측에서 1회용이다**(`PhoneVerification.spentAt`). `consumedAt`만으로는
부족하다 — 코드 redeem은 서명 쿠키를 돌려주고 비밀번호 단계는 *나중 요청*에서 그걸 읽으므로,
쿠키 값을 복사해 둔 호출자가 TTL 10분 동안 비밀번호를 반복해서 덮어쓸 수 있다. 응답에서
쿠키를 지우는 건 **협조적인 브라우저에 대한 요청일 뿐 무효화가 아니다.**
`spendProvenPhone()`이 조건부 `updateMany`로 claim하므로 같은 쿠키를 든 동시 요청 둘이
모두 성공할 수 없다.

**SMS 발송 제한은 세 축이다.** 번호별(`phoneHash`), 시도별(`purpose`), 그리고
발신자별(`senderKey`). 세 번째가 나중에 추가된 이유가 중요하다: 시도별 예산은
`purpose`를 세는데, 휴대폰 단독 로그인의 `purpose`는 **발송 요청 자신이 발급한다** —
challenge 쿠키를 버리면 새 nonce가 나오고 예산이 리셋된다. OAuth 쪽은 nonce가
제공자 인증을 거친 콜백에서만 나오므로 리셋에 동의 화면 왕복이 드는데, 공개 폼에는
물릴 비용이 없다. 그래서 번호별 상한만 남고, 그건 정의상 여러 번호로 퍼지는 걸 못 본다.
`senderKey`(IP의 HMAC)가 **caller가 못 버리는 유일한 키다.** 세 축 중 하나라도 빼지 말 것.

`senderKey`는 `x-forwarded-for`의 **맨 왼쪽** 값에서 나온다 — 즉 위조 가능한 쪽이다.
맨 오른쪽(프록시 주소)을 쓰면 모든 방문자가 한 키로 뭉쳐서 per-caller 예산이 전역 예산이
되고, 첫 남용자가 전체를 소진시킨다. 위조로 이 축을 벗어나도 안쪽 두 축은 그대로 걸리므로
마지막 방어선이 아니다. 제대로 막으려면 edge rate rule이 필요하다.

**`startPhoneVerification()`의 retire 스윕은 `purpose`까지 걸어야 한다.** 번호만으로
쓸면(`{ phoneHash, consumedAt: null }`) 휴대폰 로그인 발송이 진행 중인 `/verify-phone`의
코드를 조용히 무효화한다 — 사용자는 문자로 받은 코드를 들고 "먼저 요청해 주세요"를 본다.
경로가 하나였을 때는 같은 뜻이었지만 지금은 아니다.

**계정 병합 키는 이메일이 아니라 전화번호다.** 제공자가 주는 이메일은 검증 여부를 보장할 수
없고, 검증 안 된 이메일로 매칭하면 그 제공자에서 이메일만 바꿔도 남의 계정을 가져간다.

**전화번호는 하이픈 없는 로컬 숫자 11자리로 정규화한다.** `01012345678`이고 E.164가 아니다.
`/verify-phone`의 입력은 타이핑되는 대로 숫자만 남기므로 `010-1234-5678`을 붙여넣어도 조용히
`01012345678`이 된다(서버는 어차피 다시 정규화한다 — 이건 편의이고 검사가 아니다). 나라가
하나뿐이라 `+82`는 모든 소비자가 다시 떼어내는 상수 접두어였고, Solapi도 로컬 숫자를 원한다.
`normalizeKoreanMobile()`은 branded `LocalMobile`을 돌려주는데, 이건 장식이 아니다 —
정규화되지 않은 문자열이 `blindIndex()`에 닿으면 아무것도 매칭하지 않는 해시가 나오고,
그 실패는 에러가 아니라 조용한 조회 실패다.

**전화번호는 두 컬럼에 나뉘어 암호화 저장된다.** 코드는
[frontend/src/lib/auth/phone-crypto.ts](frontend/src/lib/auth/phone-crypto.ts)에 있다.

| 컬럼 | 내용 | 용도 |
|---|---|---|
| `phoneHash` | HMAC-SHA256, `v1:` 접두 | partial unique index + 모든 조회 |
| `phoneEnc` | AES-256-GCM, 랜덤 IV, `v1.` 접두 | 복호화 → `01012345678` |

**한 컬럼으로는 안 되기 때문이다.** 랜덤 IV 인증 암호화는 같은 번호가 매번 다른 암호문이
되므로 unique index와 `findFirst({ phone })`가 전부 깨진다. 반대로 결정적 암호화만 두면
사용자에게 번호를 다시 보여줄 수 없다. 그래서 결정적 해시가 유일성과 조회를, 암호문이 복구를
맡는다. **`blindIndex()`가 equality를 누설하는 것은 감수한 대가다** — 테이블을 가진 사람은 두
행이 같은 번호인지 알 수 있고, HMAC 키까지 가진 사람은 찍은 번호를 확인할 수 있다(한국 휴대폰
번호 공간은 ~10^8로 전수조사가 쉽다). 그래서 **키는 절대 DB에 두지 않는다.**

**두 컬럼은 항상 함께 움직인다.** `sealPhone()` 하나로 쌍을 만들고, DB의 CHECK 제약
(`("phoneHash" IS NULL) = ("phoneEnc" IS NULL)`)이 반쪽 행을 거부한다. 해시만 있으면 주인에게
번호를 못 보여주고, 암호문만 있으면 매칭이 안 돼서 그 사람은 다음 로그인에 조용히 계정을 하나
더 갖는다. 둘 다 상태가 아니라 손상이다.

**`hashCode()`에는 평문 번호를 넘긴다.** 컬럼이 blind index를 저장하더라도 그렇다. 두 호출부
(`sms.ts`의 발송·검증)는 이미 평문을 손에 들고 있다 — 사용자가 같은 요청에 보냈기 때문이다.
평문을 쓰면 테이블 덤프만으로는 그 해시가 어느 번호에서 나왔는지 알 수 없어서 10^6짜리 코드
공간을 오프라인으로 갈아낼 수 없다. blind index를 접으면 그 저항이 사라진다.

**번호로 지원 조회를 하려면 먼저 해시해야 한다.** 컬럼에 HMAC이 들어 있으니 Studio에
`01012345678`을 타이핑해도 아무것도 안 나온다. `blindIndex()`를 통과시킨 값으로 조회할 것.

**`AuthIdentity.phone`은 암호화하지 않고 삭제했다.** 아무도 읽지 않는 support용 데이터였고,
쓰이는 자리가 두 곳(제공자 원본 / 정규화된 값)이라 형식이 이미 어긋나 있었다. 키 없이 읽을 수
없는 디버그 데이터는 디버그 데이터가 아니다. 복구 가능한 사본은 `UserProfile.phoneEnc` 하나다.

**키 회전은 구현되어 있지 않다.** `phoneEnc` 쪽은 원리상 싸지만 `phoneHash` 쪽은 아니다 — 모든
해시가 바뀌고, 두 세대가 공존하는 동안 한 사람의 구·신 해시가 서로 다른 값이라서 partial unique
index가 중복을 막지 못한다. 그게 바로 이 index가 지키려는 계정 병합 불변조건이다. 양쪽 `v1`
표식은 나중에 그걸 가능하게 하려고 있는 것이니 **떼지 말 것**.

**`PHONE_ENCRYPTION_KEY`를 잃으면 저장된 번호는 못 읽고 못 맞춘다.** 모든 계정이 SMS 재인증을
해야 한다. `AUTH_SECRET`과 분리한 이유가 이것이다 — 그쪽 회전은 진행 중인 로그인만 잃는다.
길이 검사는 **디코드한 바이트 수**로 한다. 문자 32개는 엔트로피 32바이트를 보장하지 않는다.

**첫 로그인은 예외 없이 SMS 인증을 거친다.** 신규 가입도, 기존 계정 병합도 똑같다.
`linkProviderIdentity()`에서 세션이 바로 나오는 경로는 **이미 연결된 `AuthIdentity`가 있는
재방문 로그인 하나뿐**이고, 나머지는 전부 `pendingPhone`으로 나간다.

예전에는 제공자가 "통신사 인증했다"고 말한 번호(`ProviderProfile.phoneVerified`)면 신규 생성을
바로 통과시켰다. 그 필드는 **삭제됐다.** 제공자가 주는 번호는 그 계정 주인이 언젠가 등록해 둔
값일 뿐이고, 지금 이 로그인을 진행하는 사람이 그 번호로 문자를 받을 수 있다는 증명은 아니다.
동의 화면을 읽지 않고 넘긴 경우도, 제공자 기록이 오래된 경우도 전부 여기에 걸린다. 번호는
계정 병합 키이자 이 앱이 가진 유일한 추가 credential이므로, 세션을 가질 기기에서 직접 증명한다.

**`ProviderProfile.phone`은 이제 힌트다.** `/verify-phone`의 입력값을 미리 채워 넣는 데만
쓰이고(`normalizeKoreanMobile()`을 통과시켜 넘긴다), 저장되는 번호는 항상 SMS로 증명된 쪽이다.
`completeIdentityLink()`는 제공자가 준 번호를 절대 대신 쓰지 않는다 — 둘이 일치할 때도
그렇다. **새 제공자를 추가할 때 `phoneVerified` 같은 플래그를 다시 만들지 말 것.** 그 플래그의
존재 자체가 "제공자의 말로 가입을 통과시키는 경로"를 되살린다.

**네이버는 필수 항목도 사용자가 거부할 수 있다.** `response` 안의 `id`를 빼면 전부 optional로
다뤄야 한다. 전화번호가 안 와도 로그인 흐름은 바뀌지 않는다 — 어차피 SMS 인증을 거치므로,
입력값이 미리 채워지지 않는 차이만 있다.

**네이버 응답은 200으로도 실패한다.** `resultcode`가 `"00"`인지 따로 봐야 하고, 토큰
엔드포인트도 200 본문에 `error`를 담아 보낸다. HTTP 상태만 믿지 말 것.

**Solapi에는 OTP 전용 API가 없다.** 인증번호는 일반 SMS로 나가고, 코드 생성·만료·시도 횟수
제한은 전부 `sms.ts`와 `PhoneVerification`이 직접 관리한다. 발신번호는 Solapi 콘솔에 사전
등록·승인(영업일 1~3일)되어 있어야 하고, 미등록 번호로 보내면 그냥 실패한다.

**SMS 발송 제한은 두 축이다.** 번호별(재발송 30초, 시간당 5회, 시도 10회)과 **로그인별**
(`MAX_SENDS_PER_PENDING`, `purpose` 기준 3회). 번호별 제한만으로는 한 로그인이 여러 번호로
퍼지는 걸 못 막는다 — pending 쿠키는 TTL 10분 동안 의도적으로 재사용 가능하므로, OAuth 왕복
한 번으로 30초마다 새 번호에 문자를 보낼 수 있게 된다. 첫 로그인이 전부 이 경로를 지나게
되면서 이 엔드포인트가 유일한 가입 경로가 됐기 때문에 두 축이 다 필요하다. **한쪽만 남기지
말 것.** `purpose`에 인덱스가 걸려 있는 이유도 이 카운트가 매 발송마다 돌기 때문이다.

`phone/send`는 어떤 번호로 보낼지를 제한하지 않는다 — 사용자가 번호를 고르고 그 번호를
증명하는 것이 설계다. 어느 계정에 붙을지는 *증명된 번호*가 결정하고(`attachIdentity()`),
그 게이트는 문자 코드다. 제공자가 준 번호와 대조하는 검사를 넣지 말 것: 번호를 바꿔야 하는
정상 사용자를 막으면서 보안은 나아지지 않는다.

**네이버 로그인 키는 지역검색 키와 다른 애플리케이션이다.** `NAVER_LOGIN_CLIENT_ID`와
`NAVER_CLIENT_ID`를 섞어 쓰면 불친절한 401이 온다.

## 데이터 모델

`UserProfile`은 사람 하나다. 제공자별 필드는 들고 있지 않다 — 한 사람이 여러 제공자로
로그인할 수 있기 때문이다. `phoneHash`가 살아 있는 행 사이에서 유니크이고 계정 병합의 키다
(`phoneEnc`가 같은 번호의 복호화 가능한 사본 — 위 "전화번호는 두 컬럼에" 참고). 사용자가 고른
`mapProvider`도 여기에 담는다.

사용자가 직접 고치는 표시용 필드는 `nickname`·`statusMessage`·`imageUrl` 셋이고, `/profile`
페이지가 전부 한 요청으로 쓴다. 셋 다 nullable이며 **빈 제출은 `null`로 정규화한다** — `""`를
저장하면 "없음" 상태가 둘이 되고, 화면마다 어느 쪽을 검사하는지가 갈린다.

`imageUrl`은 이미지 바이트가 아니라 **Vercel Blob의 절대 URL**이다. 사진은 blob CDN에서
바로 나가므로 이 행도, 라우트 핸들러도 거치지 않는다.

`AuthIdentity`는 `UserProfile`에 붙은 소셜 로그인 하나다. `[provider, providerUserId]`에
유니크가 걸려 있다 — 제공자 id는 그 제공자 안에서만 유일하므로 `providerUserId` 단독
유니크는 카카오 id와 네이버 id가 충돌할 수 있다. 네이버와 카카오를 둘 다 연결한 사람은
여기 두 행, `UserProfile` 한 행이다.

`Session`은 로그인한 브라우저 하나, `PhoneVerification`은 진행 중인 SMS 인증 하나다.

`SavedPost.thumbnail`은 **항상 렌더 가능한 URL**이다. 인스타그램 행은 우리 Blob을,
나머지는 플랫폼 CDN을 가리킨다. `thumbnailSource`는 백업 전 원본이고 백업된 행에서만
non-null이다 — 위 "인스타그램 썸네일은 만료된다" 참고.

`SavedPost`는 `[userId, sourceUrl]`에 유니크가 걸려 있다 — 같은 링크를 다시 저장하면
중복되지 않고 갱신된다. 재저장은 장소 집합을 덧붙이는 게 아니라 **교체**하므로, 다시
인제스트했을 때 장소가 줄어들어도 고아 행이 남지 않는다.

`Place`는 전역 공유이고 `[name, address]`에 유니크가 걸려 있다. `SavedPostPlace`가 둘을
잇고 선택적 메모를 들고 있다. 저장 트랜잭션 안에서는 장소를 정렬한 뒤 upsert하는데,
동시에 실행되는 트랜잭션들이 락을 같은 순서로 잡게 하기 위해서다.

**그 정렬은 사용자가 보는 순서가 아니다.** `SavedPostPlace.position`이 게시글이 장소를
언급한 원래 순서를 들고 있고, `savedPostInclude`가 `orderBy: { position: "asc" }`로 읽는다.
둘 중 하나라도 빼면 행은 복합 PK 순서(=무작위 cuid 순)로 돌아오고, `/links`가 장소에 매기는
1·2·3 번호가 **존재하지 않는 동선을 사실처럼 제시한다** — 데이트코스는 순서가 의미인
게시글이라 이게 그냥 미관 문제가 아니다. `position`은 이름/주소 키로 찾으므로(락 정렬용
`localeCompare`와 같은 NUL 구분자를 쓴다) 서로 다른 질의 둘이 한 `Place`로 합쳐져도
번호에 구멍이 나지 않는다.

기존 행은 전부 `position` 기본값 0이다. 즉 이 컬럼이 생기기 전에 저장된 게시글은 다시
저장할 때까지 순서가 여전히 임의다.

## 지도

세 개의 제공자가 `MapView` 스위치 하나 뒤에 있고, `/settings`에서 사용자별로 고른다: 네이버(기본),
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
`AUTH_SECRET`, `PHONE_ENCRYPTION_KEY`, `LLM_API_KEY`, 네이버 검색 키 쌍,
`NEXT_PUBLIC_NAVER_MAP_CLIENT_ID`가 필요하다.
실제 네이버 로그인에는 `NAVER_LOGIN_CLIENT_ID`/`NAVER_LOGIN_CLIENT_SECRET`이, SMS 인증에는
`SOLAPI_API_KEY`/`SOLAPI_API_SECRET`/`SOLAPI_SENDER_PHONE`이 추가로 필요하다. 테스트 계정
로그인이 사라졌으므로 이 키들이 없으면 **로그인할 방법이 없다** — 첫 로그인은 예외 없이 SMS
인증을 거치기 때문이다.
선택: `AUTH_BASE_URL`(프로덕션 콜백 URL 고정), `YOUTUBE_API_KEY`(없으면 유튜브 캡션은 항상 수동 입력),
`NEXT_PUBLIC_KAKAO_MAP_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_KEY`, `LLM_*` 오버라이드,
`BLOB_READ_WRITE_TOKEN`(프로필 사진 업로드 + 인스타그램 썸네일 백업. 없으면 `/profile`의
닉네임·상태메세지 저장은 되고 사진 업로드만 실패하며, 링크 저장은 성공하지만 썸네일이
만료될 인스타 URL로 저장된다 — 로컬 개발의 정상 상태다).

`.env*`는 `.env.example`만 빼고 gitignore된다. 실제 키를 절대 커밋하지 말 것. 새 변수를
추가할 때는 발급처를 적은 주석과 함께 `.env.example`에도 넣는다.

## Playwright 테스트 계정

**Playwright로 로그인이 필요한 플로우를 테스트할 때는 `.env`의 `PLAYWRIGHT_TEST_PHONE` /
`PLAYWRIGHT_TEST_PASSWORD`로 로그인한다.** 이 계정은 `/verify-phone`을 이미 거쳐 SMS로
증명된 실제 계정이고, 휴대폰+비밀번호 로그인 화면(위 "인증" 절의 세 번째 로그인 경로)으로
들어간다. 매번 새 번호로 SMS 인증을 다시 태울 필요가 없다.

**테스트 계정 로그인을 우회하는 새 코드(고정 uuid upsert, `AuthProvider.DEV` 같은 것)를
만들지 말 것** — 위 "테스트 계정 로그인은 삭제됐다" 절 그대로다. 이 계정은 진짜 로그인
경로로만 들어간다.

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

## 디렉터리별 AGENTS.md

이 파일이 루트다. 각 디렉터리에 그곳에서 일할 때 필요한 것만 적은 AGENTS.md가 있고,
전부 `<!-- Parent: -->` 태그로 이 파일까지 이어진다. 특정 디렉터리를 고칠 때는 여기와
해당 파일을 같이 읽는다.

| Directory | Purpose |
|-----------|---------|
| [frontend/](frontend/AGENTS.md) | 코드 전부. 명령·설정·검증 방법 |
| [frontend/src/](frontend/src/AGENTS.md) | 앱 코드의 세 층(app / components / lib) |
| [frontend/src/app/](frontend/src/app/AGENTS.md) | 라우트 트리 |
| [frontend/src/app/(app)/](frontend/src/app/(app)/AGENTS.md) | 로그인 없이 열리는 페이지들 |
| [frontend/src/app/api/](frontend/src/app/api/AGENTS.md) | 인가가 실제로 일어나는 유일한 층 |
| [frontend/src/app/api/auth/](frontend/src/app/api/auth/AGENTS.md) | OAuth·SMS·로그아웃 라우트 |
| [frontend/src/app/verify-phone/](frontend/src/app/verify-phone/AGENTS.md) | 첫 로그인의 관문 |
| [frontend/src/components/](frontend/src/components/AGENTS.md) | 컴포넌트 |
| [frontend/src/components/map/](frontend/src/components/map/AGENTS.md) | 지도 제공자 3종과 스위치 |
| [frontend/src/components/ui/](frontend/src/components/ui/AGENTS.md) | shadcn/ui 프리미티브 |
| [frontend/src/lib/](frontend/src/lib/AGENTS.md) | 도메인 로직 |
| [frontend/src/lib/ingest/](frontend/src/lib/ingest/AGENTS.md) | 링크 → 장소 파이프라인 |
| [frontend/src/lib/auth/](frontend/src/lib/auth/AGENTS.md) | 세션·OAuth·전화번호 암호화·SMS |
| [frontend/src/lib/auth/providers/](frontend/src/lib/auth/providers/AGENTS.md) | 제공자 서술자 |
| [frontend/src/lib/map/](frontend/src/lib/map/AGENTS.md) | SDK 로더와 공용 타입 |
| [frontend/src/types/](frontend/src/types/AGENTS.md) | 전역 타입 선언 |
| [frontend/prisma/](frontend/prisma/AGENTS.md) | 스키마와 마이그레이션 |
| [frontend/scripts/](frontend/scripts/AGENTS.md) | 일회성 운영 스크립트 |
| [docs/](docs/AGENTS.md) | 외부 제공자 설정 절차 |
| [docs/oauth/](docs/oauth/AGENTS.md) | 네이버 로그인 설정과 레퍼런스 |
| [docs/blob/](docs/blob/AGENTS.md) | 프로필 사진 저장소(Vercel Blob) 설정 절차 |

`frontend/AGENTS.md` 위쪽의 `nextjs-agent-rules` 블록은 `next dev`가 다시 써 넣는
자동 생성물이다. 지우지 말고 작업물과 함께 커밋한다.
