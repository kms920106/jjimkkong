<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-19 | Updated: 2026-08-19 -->

# src/app/api/auth

## Purpose
로그인 왕복의 라우트들. 로직은 전부 `lib/auth/`에 있고 여기서는 쿠키를 굽고 리다이렉트를
정하는 일만 한다.

## Key Files
| File | Description |
|------|-------------|
| `[provider]/start/route.ts` | OAuth state·`RETURN_TO_COOKIE`를 굽고 제공자 동의 화면으로 보낸다. `?next=`로 받은 경로는 `safeReturnPath()`를 거친다 |
| `[provider]/callback/route.ts` | 코드 교환 → 프로필 조회 → `linkProviderIdentity()`. 재방문이면 세션, 그 외 전부 pending 쿠키 → `/verify-phone` |
| `phone/send/route.ts` | pending 쿠키를 열고 `startPhoneVerification()` |
| `phone/verify/route.ts` | 코드 검증 → `completeIdentityLink()` → 세션 발급 |
| `logout/route.ts` | `destroySession()` + 쿠키 삭제 |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `[provider]/` | 제공자별 start·callback. 슬러그가 `toAuthProvider()`로 enum이 된다 |
| `phone/` | SMS 발송·검증 |
| `logout/` | 로그아웃 |

## For AI Agents

### Working In This Directory

**`[provider]`는 하나의 라우트가 모든 제공자를 처리한다.** 제공자를 추가해도 여기는
건드리지 않는다 — `lib/auth/providers/`에 서술자를 하나 더 넣으면 된다. 애플만 예외로
`response_mode=form_post` 때문에 callback을 POST로도 받아야 한다.

**첫 로그인은 예외 없이 `/verify-phone`으로 간다.** 제공자가 전화번호를 줬는지 여부는
분기를 바꾸지 않는다 — 줬으면 입력값이 미리 채워질 뿐이다. 제공자 응답을 근거로 세션을
바로 발급하는 분기를 만들지 말 것.

**콜백의 pendingPhone 분기는 `RETURN_TO_COOKIE`를 지우지 않는다.** `/verify-phone`이
그 쿠키를 읽어 원래 페이지로 돌아가야 하기 때문이다.

**로그인 실패는 `?auth=login&error=<slug>`로 홈에 알린다.** `HomeClient`가 이걸 초기
상태로 한 번 읽고 URL에서 지운다 — 남겨두면 새로고침이 이미 닫은 drawer를 다시 연다.
여기로 오는 건 실패한 로그인뿐이고, 정상 첫 로그인은 `/verify-phone`으로 간다.

**`phone/send`는 어떤 번호로 보낼지 제한하지 않는다.** 사용자가 번호를 고르고 그 번호를
증명하는 것이 설계다. 어느 계정에 붙을지는 *증명된 번호*가 결정하고, 게이트는 문자
코드다. 제공자 번호와 대조하는 검사를 넣지 말 것.

**발송 제한은 번호별과 로그인별 두 축이다.** pending 쿠키는 TTL 10분 동안 의도적으로
재사용 가능하므로, 번호별 제한만 두면 OAuth 왕복 한 번으로 30초마다 새 번호에 문자를
보낼 수 있다. 한쪽만 남기지 말 것.

**세션 발급 전에 기존 세션을 파기한다**(세션 고정 방지).

### Testing Requirements
진짜 네이버 키와 Solapi 키가 있어야 검증된다 — 테스트 계정 로그인은 삭제됐고,
**다시 만들지 말 것.**

돌려 볼 경로: (1) 신규 가입, (2) 같은 번호를 가진 기존 계정 병합, (3) 재방문 로그인(SMS
없이 바로 세션), (4) `?next=/links`로 시작해 `/links`로 복귀, (5) 동의 거부 → 홈에
에러 drawer, (6) 탈퇴 후 같은 네이버 계정 재로그인 → **새 프로필**(이전 링크 안 보임).

### Common Patterns
리다이렉트 응답에 쿠키를 실을 때는 `NextResponse.redirect()`에 `set*Cookie()` 헬퍼를
쓴다. 쿠키 옵션(`httpOnly`, `sameSite`, `maxAge`)을 라우트마다 새로 적지 말 것.

## Dependencies

### Internal
- `../../../lib/auth/pending.ts`, `session.ts`, `link.ts`, `oauth.ts`, `sms.ts`, `urls.ts`
- `../../../lib/auth/providers/` — 슬러그 → 서술자
- `../../verify-phone/` — 첫 로그인의 다음 화면

### External
- 네이버 로그인 OAuth 2.0, Solapi

<!-- MANUAL: -->
