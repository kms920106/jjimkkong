<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-19 | Updated: 2026-08-19 -->

# docs/oauth

## Purpose
네이버 로그인을 켜는 데 필요한 두 가지: 콘솔 설정 절차(`SETUP.md`)와 프로토콜
레퍼런스(`NAVER-LOGIN.md`). 코드는 이미 다 들어가 있고, 이 문서들은 코드 밖에서
해야 하는 일만 다룬다.

## Key Files
| File | Description |
|------|-------------|
| `SETUP.md` | 마이그레이션 → 네이버 애플리케이션 등록 → 콜백 URL → 환경변수 채우기 순서 |
| `NAVER-LOGIN.md` | 네이버 로그인 공식 devguide 요약 — 토큰 교환, 프로필 조회, `resultcode` 규약 |

## For AI Agents

### Working In This Directory
- `NAVER-LOGIN.md`는 **원본 문서의 요약**이다. 이 앱의 구현 세부를 섞어 넣지 말 것 —
  제공자를 추가할 때 다음 사람이 "네이버가 이렇게 동작한다"와 "우리가 이렇게 짰다"를
  구분하지 못하게 된다.
- 네이버 로그인 키(`NAVER_LOGIN_CLIENT_ID`)는 지역검색 키(`NAVER_CLIENT_ID`)와
  **다른 애플리케이션**이다. 문서에서 이 둘을 절대 같은 이름으로 부르지 말 것.
- 콜백 URL은 `AUTH_BASE_URL`로 고정할 수 있다. 프로덕션 절차에 이걸 빠뜨리면
  프리뷰 배포 도메인이 콜백에 들어가 네이버가 거부한다.

### Testing Requirements
`http://localhost:4000/api/auth/naver/callback`이 네이버 콘솔에 등록되어 있어야
로컬에서 로그인이 돈다. 등록 전에는 동의 화면 다음이 그냥 실패한다.

### Common Patterns
네이버 응답은 **HTTP 200으로도 실패한다.** 토큰 엔드포인트는 200 본문에 `error`를,
프로필 엔드포인트는 `resultcode`를 담아 보낸다. 문서에 예시 응답을 적을 때는 성공
케이스만 적지 말고 이 실패 형태를 함께 남긴다.

## Dependencies

### Internal
- `frontend/src/lib/auth/providers/naver.ts` — 이 문서의 프로토콜 구현
- `frontend/src/app/api/auth/[provider]/` — start·callback 라우트

### External
- https://developers.naver.com/docs/login/devguide/devguide.md

<!-- MANUAL: -->
