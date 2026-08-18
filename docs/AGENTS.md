<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-19 | Updated: 2026-08-19 -->

# docs

## Purpose
외부 제공자 연동을 실제로 켜기 위한 절차 문서. 코드가 아니라 **콘솔에서 해야 하는 일**과
발급받은 값을 어느 환경변수에 넣는지를 다룬다. 아키텍처 규칙은 여기가 아니라 루트
[AGENTS.md](../AGENTS.md)에 있다.

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `oauth/` | 네이버 로그인 설정 절차와 API 레퍼런스 (see `oauth/AGENTS.md`) |
| `domain/` | 비어 있음. 도메인/DNS 관련 문서 자리 |

## For AI Agents

### Working In This Directory
- 이 문서들은 **절차**를 적는 곳이다. "왜 이렇게 설계했는가"는 루트 `AGENTS.md`에 쓴다.
- 실제 키·시크릿을 절대 붙여넣지 말 것. 값의 *형태*와 *발급처*만 적는다.
- 환경변수를 새로 추가했다면 여기와 `frontend/.env.example` 양쪽을 함께 고친다.

### Testing Requirements
문서에 적힌 절차는 실제로 한 번 따라가서 로그인이 끝까지 도는지 확인한 것만 남긴다.
테스트 계정 로그인은 삭제됐으므로 검증 경로는 진짜 네이버 + Solapi 키뿐이다.

## Dependencies

### Internal
- `frontend/src/lib/auth/` — 여기 문서가 설명하는 흐름의 구현체
- `frontend/.env.example` — 문서가 지시하는 환경변수의 정본

### External
- 네이버 개발자센터 (로그인 애플리케이션)
- Solapi (SMS 발송)

<!-- MANUAL: -->
