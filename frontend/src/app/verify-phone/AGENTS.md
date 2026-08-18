<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-19 | Updated: 2026-08-19 -->

# src/app/verify-phone

## Purpose
휴대폰 인증 관문. **모든 첫 로그인이 반드시 거친다** — 신규 가입이든 기존 계정 병합이든
같다. 세션이 바로 나오는 경로는 이미 연결된 `AuthIdentity`가 있는 재방문 하나뿐이다.

## Key Files
| File | Description |
|------|-------------|
| `page.tsx` | pending 쿠키 두 장을 열어 보고, 없으면 `redirect("/")`. 열리면 `PhoneVerifyForm`에 힌트 번호와 복귀 경로를 넘긴다 |

## For AI Agents

### Working In This Directory

**이건 `(app)` 밖에 있고, 그게 의도다.** `(app)`의 페이지는 전부 로그인 없이 열리지만
여기는 pending 쿠키가 없으면 렌더 자체를 거부한다. 로그인 진입점이 아니라 **이미 시작된
로그인의 후반부**라서 그렇다 — 세션을 요구하는 게 아니므로 "페이지를 리다이렉트로 막지
말라"는 원칙과 충돌하지 않는다.

**drawer가 아니라 페이지인 이유가 렌더 거부다.** drawer 안에 두면 검증할 대상이 있는지
모르는 상태로 폼을 먼저 그리게 되고, 그 폼의 모든 제출은 401밖에 될 수 없다.
제공자 선택(`LoginDrawer`)만 drawer다 — 그건 보던 화면을 떠나지 않아야 하는 진입점이다.

**복귀 경로는 `RETURN_TO_COOKIE`에서 읽는다.** 제공자 왕복이 다른 오리진을 거치므로
쿼리스트링이나 메모리 값은 살아남지 못한다. 콜백의 pendingPhone 분기가 이 쿠키를 지우지
않는 이유가 이것이다. 값은 `safeReturnPath()`로 앱 내부에 제한한다.

**제공자가 준 번호는 힌트일 뿐이다.** 입력값을 미리 채우는 데만 쓰고, 저장되는 번호는
항상 SMS로 증명된 쪽이다. 제공자 번호와 대조하는 검사를 넣지 말 것 — 번호를 바꿔야 하는
정상 사용자를 막으면서 보안은 나아지지 않는다.

### Testing Requirements
직접 `http://localhost:4000/verify-phone`을 치면 홈으로 튕겨야 한다.
정상 경로는 네이버 로그인 → 여기 → 코드 입력 → **원래 보던 경로**로 복귀다.
`?next=/links`로 시작한 로그인이 `/links`로 돌아오는지 확인한다.

### Common Patterns
서버 컴포넌트가 쿠키를 열고, 폼(`PhoneVerifyForm`)만 클라이언트다.

## Dependencies

### Internal
- `../../lib/auth/pending.ts` — `openPending`, `PENDING_COOKIE`, `PENDING_BINDING_COOKIE`, `RETURN_TO_COOKIE`, `safeReturnPath`
- `../../components/PhoneVerifyForm.tsx`
- `../api/auth/phone/send`·`verify` — 폼이 부르는 라우트

### External
- Next.js `redirect()`, `cookies()`

<!-- MANUAL: -->
