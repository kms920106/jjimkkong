<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-19 | Updated: 2026-08-19 -->

# src/lib/auth

## Purpose
인증 전부. Supabase Auth는 쓰지 않는다 — 네이버가 Supabase의 기본 제공자 목록에 없어서
OAuth 핸드셰이크와 세션을 앱이 직접 소유한다.

```
LoginDrawer → /api/auth/naver/start → 네이버 동의 → /api/auth/naver/callback
   → linkProviderIdentity()
   → 재방문(AuthIdentity 있음): 세션 발급 → 원래 경로
   → 그 외 전부(첫 로그인): pending 쿠키 → /verify-phone → SMS → 세션 발급
```

## Key Files
| File | Description |
|------|-------------|
| `session.ts` | DB 세션. 쿠키 `<sessionId>.<secret>`, DB에는 secret의 SHA-256만 |
| `pending.ts` | pending 로그인 쿠키 2장, OAuth state, `RETURN_TO_COOKIE`, `safeReturnPath()` |
| `link.ts` | `linkProviderIdentity()` / `completeIdentityLink()` — 계정 생성·병합의 분기점 |
| `oauth.ts` | `buildAuthorizeUrl()`, `exchangeCodeForToken()`, `fetchProviderProfile()` |
| `phone.ts` | `normalizeKoreanMobile()` → branded `LocalMobile`, 표시·마스킹 헬퍼 |
| `phone-crypto.ts` | `sealPhone()`/`blindIndex()`/`decryptPhone()` — HMAC 블라인드 인덱스 + AES-256-GCM |
| `sms.ts` | `startPhoneVerification()`/`verifyPhoneCode()` — 코드 생성·만료·시도 제한, Solapi 발송 |
| `urls.ts` | `baseUrl()`/`callbackUrl()` — `AUTH_BASE_URL`로 프로덕션 콜백 고정 |
| `password.ts` | scrypt 해싱·검증. `s1.<salt>.<derived>`, `burnPasswordComparison()` |
| `password-policy.ts` | 길이 상수만. `node:crypto`를 안 물어서 클라이언트에서 import 가능 |
| `password-attempts.ts` | 비밀번호 시도 예산 2축(caller / account) + 윈도우 밖 행 스윕 |
| `phone-login.ts` | challenge 쿠키 2장. `intent`·`verifiedPhone`·`verificationId`를 나른다 |
| `phone-challenge-flow.ts` | 가입·재설정 공용 SMS 단계, `spendProvenPhone()` (1회용 소비) |
| `sender-key.ts` | IP의 HMAC. 발신자별 예산의 키 (leftmost XFF — 위조 가능, 주석 참고) |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `providers/` | 제공자별 OAuth 서술자 (see `providers/AGENTS.md`) |

## For AI Agents

### Working In This Directory

**제공자 로그인의 첫 로그인은 예외 없이 SMS 인증을 거친다.** 신규 가입도 기존 계정 병합도 같다.
제공자 경로에서 세션이 바로 나오는 곳은 **이미 연결된 `AuthIdentity`가 있는 재방문 하나뿐**이다.

**단, 이제 SMS 없이 세션이 나오는 경로가 하나 더 있다: `POST /api/auth/phone/login`**
(휴대폰번호 + 비밀번호). 번호는 가입 때 SMS로 한 번 증명했고 비밀번호가 그 증명을 이어받는다 —
매 로그인마다 문자를 보내면 로그인마다 비용이 들고 사용자는 문자를 기다려야 한다. 자세한 규칙은
루트 AGENTS.md의 비밀번호 절을 볼 것.
예전엔 제공자가 "통신사 인증했다"고 말한 번호면 통과시켰고, 그 필드
(`ProviderProfile.phoneVerified`)는 **삭제됐다** — 제공자가 주는 번호는 그 계정 주인이
언젠가 등록해 둔 값일 뿐, 지금 로그인하는 사람이 그 번호로 문자를 받을 수 있다는 증명이
아니다. **새 제공자를 추가할 때 그런 플래그를 다시 만들지 말 것.**

**`ProviderProfile.phone`은 힌트다.** `/verify-phone` 입력값을 미리 채우는 데만 쓰이고,
저장되는 번호는 항상 SMS로 증명된 쪽이다. `completeIdentityLink()`는 둘이 일치할 때도
제공자 번호를 대신 쓰지 않는다.

**세션은 DB에 있다.** 자기완결적 JWT였다면 로그아웃·탈퇴 후에도 만료까지 살아 있다.
대조는 `timingSafeEqual`. 로그인 시 기존 세션을 먼저 파기한다(세션 고정 방지).
`destroySession()`은 id만 보고 지우지 않고 secret까지 확인한다 — id는 cuid라 추측
가능해서, 확인 없이 지우면 남을 강제 로그아웃시킬 수 있다.

**pending 로그인 쿠키는 두 장이다.** 서명된 본문과 무작위 binding 값이 각각 다른
쿠키로 나가고, 본문 안의 HMAC이 binding과 맞아야 열린다. 본문 하나로 열리게 두면
공격자가 자기 로그인 쿠키를 피해자 브라우저에 심고, 피해자가 자기 번호로 인증을 마치는
순간 공격자의 신원이 피해자 계정에 붙는다.

**`safeReturnPath()`는 문자열을 검사하지 않고 파싱해서 확인한다.** 임시 오리진에 대고
`new URL()`로 풀어 본 뒤 오리진이 그대로인지만 본다. 막아야 할 대상이 바로 `new URL()`의
재해석이기 때문이다 — 파서는 authority 자리에서 `\`를 `/`처럼 다루고, 탭·개행은
authority를 찾기 *전에* 떼어낸다. 그래서 `/\evil.com`과 `/<TAB>/evil.com`이
`startsWith("//")` 검사를 통과하면서 `http://evil.com/`으로 풀린다.
**`startsWith` 블랙리스트로 되돌리지 말 것.**

**계정 병합 키는 이메일이 아니라 전화번호다.** 제공자 이메일은 검증 여부를 보장할 수
없고, 검증 안 된 이메일로 매칭하면 그 제공자에서 이메일만 바꿔 남의 계정을 가져간다.

**전화번호는 두 컬럼에 나뉜다.** `phoneHash`(HMAC, `v1:` 접두)가 유일성과 모든 조회를,
`phoneEnc`(AES-256-GCM, 랜덤 IV, `v1.` 접두)가 복구를 맡는다. 한 컬럼으로는 안 된다 —
랜덤 IV 암호문은 매번 달라 unique index와 조회가 깨지고, 결정적 암호화만 두면 사용자에게
번호를 다시 보여줄 수 없다. `sealPhone()` 하나로 쌍을 만들고 DB CHECK가 반쪽 행을
거부한다. `blindIndex()`가 equality를 누설하는 건 감수한 대가이므로 **키는 절대 DB에
두지 않는다.** `v1` 표식은 나중의 키 회전을 위한 것이니 떼지 말 것(회전은 미구현 —
`phoneHash` 쪽은 두 세대가 공존하는 동안 partial unique index가 중복을 못 막는다).

**`hashCode()`에는 평문 번호를 넘긴다.** 컬럼이 blind index를 저장하더라도 그렇다.
평문을 쓰면 테이블 덤프만으로는 그 해시가 어느 번호에서 나왔는지 알 수 없어서 10^6짜리
코드 공간을 오프라인으로 갈아낼 수 없다.

**전화번호는 하이픈 없는 로컬 11자리(`01012345678`)다. E.164가 아니다.**
`normalizeKoreanMobile()`의 branded `LocalMobile`은 장식이 아니다 — 정규화되지 않은
문자열이 `blindIndex()`에 닿으면 아무것도 매칭하지 않는 해시가 나오고, 그 실패는
에러가 아니라 조용한 조회 실패다.

**SMS 발송 제한은 두 축이다.** 번호별(재발송 30초, 시간당 5회, 시도 10회)과
로그인별(`MAX_SENDS_PER_PENDING`, `purpose` 기준 3회). pending 쿠키는 TTL 10분 동안
의도적으로 재사용 가능하므로, 번호별 제한만 두면 OAuth 왕복 한 번으로 30초마다 새 번호에
문자를 보낼 수 있다. **한쪽만 남기지 말 것.**

**탈퇴 필터 세 곳은 함께 움직인다:** `resolveSessionWithUser()`(`requireUser()`가 쓴다),
`linkProviderIdentity()`의 identity 조회, `attachIdentity()` 트랜잭션 안의 owner 조회.
셋 다 `withdrawnAt: null`이다. **고정 id를 `upsert`하는 코드를 넣지 말 것** — 그게
탈퇴를 되돌리는 유일한 형태이고, 삭제된 테스트 로그인이 정확히 그 구멍이었다.
계정은 반드시 제공자 identity나 전화번호로 찾는다.

**`findUnique`를 쓸 수 없다.** partial unique index라서 컴파일이 깨진다.
`findFirst` + `withdrawnAt: null`이 정답이다.

**세션 조회는 프로필을 조인해서 한 번에 가져온다.** `requireUser()`는
`resolveSessionWithUser()`를 부른다 — 예전에는 `session.findUnique` 다음에
`userProfile.findFirst`를 부르는 **직렬 두 왕복**이었고, 외래키를 따라가는 사슬이라 두 번째는
첫 번째가 끝나야 시작할 수 있었다. Vercel 함수에서 풀링된 Supabase로 나가는 왕복이라 그 비용이
모든 인증된 렌더에 붙었고, `/links`는 그걸 그대로 지불하고 있었다. **다시 두 쿼리로 쪼개지 말 것.**

탈퇴 필터가 이제 `resolveSessionWithUser()` 안에 있다 — 조인 자체로는
`withdrawnAt: null`을 표현할 수 없어서 반환 직전에 걸러 `user: null`로 준다. 세션은
resolve되고 `user`만 null인 상태가 곧 "탈퇴한 계정"이므로, 호출부는 `session?.user`를 봐야
한다. `session`만 확인하면 탈퇴 계정이 통과한다.

### Testing Requirements
테스트 계정 로그인은 삭제됐다. **다시 만들지 말 것** — 인증되지 않은 누구든 한 번의
POST로 고정 uuid가 될 수 있는 우회로였고, "로컬에서만"을 강제할 환경 분기가 이
코드베이스엔 없어서 실제로 프로덕션 빌드에서도 켜져 있었다.

검증하려면 `NAVER_LOGIN_CLIENT_ID`/`NAVER_LOGIN_CLIENT_SECRET`과
`SOLAPI_API_KEY`/`SOLAPI_API_SECRET`/`SOLAPI_SENDER_PHONE`을 채우고 진짜 경로로 들어간다.
발신번호는 Solapi 콘솔에 사전 등록·승인(영업일 1~3일)되어 있어야 한다.

`PHONE_ENCRYPTION_KEY`를 잃으면 저장된 번호를 못 읽고 못 맞춘다(모든 계정이 SMS 재인증).
`AUTH_SECRET`과 분리한 이유가 이것이다 — 그쪽 회전은 진행 중인 로그인만 잃는다.
길이 검사는 **디코드한 바이트 수**로 한다. 문자 32개는 엔트로피 32바이트가 아니다.

### Common Patterns
- 네이버 로그인 키(`NAVER_LOGIN_CLIENT_ID`)와 지역검색 키(`NAVER_CLIENT_ID`)는
  **다른 애플리케이션**이다. 섞어 쓰면 불친절한 401이 온다.
- Solapi에는 OTP 전용 API가 없다. 코드 생성·만료·시도 제한은 전부 `sms.ts`와
  `PhoneVerification`이 직접 관리한다.

## Dependencies

### Internal
- `../auth.ts` — `requireUser()`/`getUser()`
- `../prisma.ts`, `../../generated/prisma/`
- `../../app/api/auth/**`, `../../app/verify-phone/` — 호출자

### External
- Node `crypto` (HMAC, AES-256-GCM, `timingSafeEqual`), Zod, `solapi`
- 네이버 로그인 OAuth 2.0

<!-- MANUAL: -->
