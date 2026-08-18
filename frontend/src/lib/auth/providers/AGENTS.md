<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-19 | Updated: 2026-08-19 -->

# src/lib/auth/providers

## Purpose
제공자별 OAuth 서술자. 라우트·세션·계정연결은 이미 공용이라, 제공자를 추가하는 일은
**여기 파일 하나 + enum 값 하나 + `FACTORIES` 한 줄**이 전부다.

## Key Files
| File | Description |
|------|-------------|
| `types.ts` | `OAuthProviderConfig`, `ProviderProfile`, `OAuthConfigError`, `OAuthFlowError` |
| `index.ts` | `FACTORIES` 레지스트리, 슬러그↔enum 변환(`toAuthProvider`), `isProviderEnabled`, `getProvider` |
| `naver.ts` | 네이버 서술자 — authorize/token/profile URL과 `ProfileSchema` |

## For AI Agents

### Working In This Directory

**제공자 추가는 파일 하나다.** `OAuthProviderConfig`를 하나 만들고, `AuthProvider`
enum(`prisma/schema.prisma`)과 `index.ts`의 `FACTORIES`·`SLUGS`에 등록하면 끝이다.
카카오·애플이 이 자리에 들어온다. 애플은 `response_mode=form_post`가 필요하므로
`extraAuthorizeParams`를 쓰고 callback을 POST로도 받아야 한다.

**`phoneVerified` 같은 플래그를 다시 만들지 말 것.** 그 필드는 삭제됐다. 존재 자체가
"제공자의 말로 가입을 통과시키는 경로"를 되살린다. 제공자가 주는 번호는 `phone`
힌트로만 넘기고, 저장되는 번호는 항상 SMS로 증명된 쪽이다.

**네이버는 필수 항목도 사용자가 거부할 수 있다.** `response` 안의 `id`를 빼면 전부
optional로 다뤄야 한다. 전화번호가 안 와도 로그인 흐름은 바뀌지 않는다 — 어차피 SMS
인증을 거치므로 입력값이 미리 채워지지 않는 차이뿐이다.

**네이버 응답은 200으로도 실패한다.** `resultcode`가 `"00"`인지 따로 봐야 하고,
토큰 엔드포인트도 200 본문에 `error`를 담아 보낸다. HTTP 상태만 믿지 말 것.

**`isProviderEnabled()`는 키 유무로 판단한다.** 키가 없는 제공자는 `LoginDrawer`에
나타나지 않아야 한다 — 눌러도 `OAuthConfigError`밖에 안 되는 버튼을 보여주지 말 것.

### Testing Requirements
콘솔에 콜백 URL(`http://localhost:4000/api/auth/<slug>/callback`)이 등록되어 있어야
동의 화면 다음이 돈다. 새 제공자를 추가했다면 (1) 신규 가입, (2) 같은 번호를 가진 기존
계정과의 병합, (3) 재방문 로그인 세 경로를 모두 돌려 본다.

### Common Patterns
프로필 응답은 Zod 스키마로 좁힌다. 제공자가 필드를 늘리거나 형을 바꿔도 앱이 조용히
`undefined`를 들고 진행하지 않게 하기 위해서다.

## Dependencies

### Internal
- `../oauth.ts` — 이 서술자를 소비하는 공용 핸드셰이크
- `../link.ts` — `ProviderProfile`을 계정에 붙인다
- `../../../app/api/auth/[provider]/` — 슬러그로 서술자를 고른다
- `prisma/schema.prisma`의 `AuthProvider` enum

### External
- 네이버 로그인 OAuth 2.0 (`docs/oauth/NAVER-LOGIN.md`)

<!-- MANUAL: -->
