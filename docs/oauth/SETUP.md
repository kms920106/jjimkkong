# 로그인 설정 가이드

코드는 이미 다 들어가 있다. 이 문서는 **콘솔에서 해야 하는 일**과 그 결과를 어디에
넣는지만 다룬다. 프로토콜 세부는 [NAVER-LOGIN.md](NAVER-LOGIN.md)에 있다.

## 0. 마이그레이션

새 테이블(`AuthIdentity`, `Session`, `PhoneVerification`)과 `UserProfile.phone`이 추가된다.

```bash
cd frontend
npm run db:deploy     # 또는 개발 DB라면 npm run db:migrate
```

기존 `UserProfile` 행은 그대로 남고 `phone`만 `NULL`로 붙는다. `SavedPost`는 건드리지 않는다.

## 1. AUTH_SECRET

pending 로그인 쿠키에 서명하는 값. 아무 랜덤 문자열이나 32자 이상이면 된다.

```bash
openssl rand -base64 32
```

`frontend/.env`의 `AUTH_SECRET`에 넣는다. 이 값을 바꾸면 진행 중인 로그인만 깨지고,
이미 발급된 세션은 DB에 있으므로 살아남는다.

## 2. 네이버 로그인 애플리케이션

https://developers.naver.com > Application > 애플리케이션 등록

| 항목 | 값 |
|------|-----|
| 사용 API | **네이버 로그인** |
| 제공 정보 | 이메일 · 이름 · **휴대전화번호**(권장) |
| 서비스 URL | `http://localhost:4000` (개발) / 배포 도메인 |
| Callback URL | `http://localhost:4000/api/auth/naver/callback` |

발급받은 값을 넣는다:

```
NAVER_LOGIN_CLIENT_ID=
NAVER_LOGIN_CLIENT_SECRET=
```

> **지역검색 키(`NAVER_CLIENT_ID`)와 다른 애플리케이션이다.** 섞어 쓰면 401이 온다.

**휴대전화번호를 제공 정보에 넣는 이유**: 이 앱은 전화번호로 계정을 식별한다. 네이버가
번호를 주면 로그인이 한 번에 끝나고, 안 주면 SMS 인증 단계로 넘어간다. 다만 네이버는
필수로 지정한 항목도 사용자가 거부할 수 있으므로, SMS 경로는 어차피 있어야 한다.

**Callback URL은 글자 하나까지 일치해야 한다.** 배포 후에는 콘솔에 배포 도메인의 콜백도
추가하고, Vercel 환경변수에 `AUTH_BASE_URL=https://<배포도메인>`을 넣는다.

> `AUTH_BASE_URL`은 **프로덕션에서 필수다.** 없으면 로그인 라우트가 에러를 던진다. 대신
> 요청 origin으로 넘어가면 Host 헤더 — 즉 호출자가 조작할 수 있는 값 — 가 제공자에게
> 보내는 `redirect_uri`에 들어가기 때문에, 조용히 넘어가는 대신 배포 시점에 터지게 했다.

**검수**: 통과 전에는 본인 계정과 멤버로 등록한 계정만 로그인된다. 개발에는 지장이 없다.

## 3. Solapi (SMS 인증)

https://solapi.com

1. 가입 후 **발신번호 등록** — 통신서비스 가입증명원이 필요하고 영업일 1~3일 걸린다.
   **가장 오래 걸리는 단계이므로 먼저 시작할 것.** 미등록 번호로 보내면 그냥 실패한다.
2. **API Key 관리**에서 키 쌍 발급
3. 잔액 충전 (건당 과금)

```
SOLAPI_API_KEY=
SOLAPI_API_SECRET=
SOLAPI_SENDER_PHONE=01012345678
```

이 셋이 없으면 SMS 인증 경로는 503을 돌려준다. 네이버가 전화번호를 주는 경우와 테스트
계정 로그인은 SMS 없이도 동작한다.

## 4. 확인

```bash
cd frontend && npm run dev
```

- `http://localhost:4000/login` → "네이버로 계속하기"
- 네이버가 번호를 준 경우: 바로 `/`로 들어간다
- 안 준 경우: `/login/verify`에서 번호 입력 → 문자 수신 → 6자리 입력 → `/`

DB에서 결과를 볼 수 있다:

```bash
npm run db:studio   # UserProfile / AuthIdentity / Session
```

## 카카오·애플을 추가할 때

`frontend/src/lib/auth/providers/naver.ts`를 본떠 파일 하나를 만들고,
`providers/index.ts`의 `FACTORIES`에 등록하면 끝이다. 라우트(`/api/auth/kakao/start`),
세션, 계정 연결은 이미 공용이라 손댈 필요가 없다.

- **카카오**: `AuthProvider.KAKAO`는 enum에 이미 있다. 전화번호(`phone_number`)는 비즈앱
  심사를 통과해야 받을 수 있으므로, 그전까지는 SMS 인증 경로를 타게 된다.
- **애플**: `response_mode=form_post`가 필요하다 — `extraAuthorizeParams`에 넣고, 콜백을
  POST로도 받아야 한다. client secret이 고정 문자열이 아니라 ES256으로 서명한 JWT이고
  주기적으로 재발급해야 하므로, `OAuthProviderConfig.clientSecret`을 함수로 바꾸는 작은
  변경이 함께 필요하다. 또 이름·이메일은 **최초 1회 인증 때만** 오므로 그때 저장해야 한다.

이메일이 같아도 계정은 전화번호로만 병합된다. 네이버로 가입한 사람이 같은 번호로 카카오
로그인을 하면 `AuthIdentity` 행만 하나 늘고 저장한 링크는 그대로 이어진다.
