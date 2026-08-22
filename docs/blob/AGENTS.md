<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-22 | Updated: 2026-08-22 -->

# docs/blob

## Purpose
프로필 사진 저장소(Vercel Blob)를 켜는 데 필요한 콘솔 절차. 코드는 이미 다
들어가 있고, 이 문서는 코드 밖에서 해야 하는 일만 다룬다.

## Key Files
| File | Description |
|------|-------------|
| `SETUP.md` | Blob 스토어 생성 → 프로젝트 연결 → 로컬 `.env` 토큰 채우기 순서 |

## For AI Agents

### Working In This Directory
- **Supabase가 아니다.** 이 저장소는 DB에만 Supabase(Postgres)를 쓰고, 파일은
  별도 서비스인 Vercel Blob에 올라간다. 문서에서 이 둘을 섞어 부르지 말 것 —
  실제로 헷갈려서 Supabase 대시보드를 찾아본 사례가 있었다.
- `BLOB_READ_WRITE_TOKEN`은 프로덕션·프리뷰 배포에는 Vercel이 스토어 연결 시
  자동 주입한다. 로컬 개발용만 사람이 `.env`에 직접 넣는다.
- 코드 쪽 이유(매직바이트 검증, 세 상태 교체 로직, 탈퇴 시 삭제 등)는 여기가
  아니라 루트 [AGENTS.md](../../AGENTS.md)와
  [frontend/src/lib/AGENTS.md](../../frontend/src/lib/AGENTS.md)에 있다. 이
  디렉터리는 콘솔 절차만 다룬다.

### Testing Requirements
토큰 없이도 `/profile`은 열리고 닉네임·상태메세지는 저장된다 — 사진 업로드만
실패한다. 토큰을 넣은 뒤에는 로그인 상태에서 사진을 두 번 연속 올려, 이전 사진이
남지 않고(같은 자리를 덮어쓰지 않음) 새 URL로 교체되는지까지 확인해야 검증이
끝난 것이다.

## Dependencies

### Internal
- `frontend/src/lib/profile-image.ts` — 이 문서가 설명하는 스토어의 구현체
- `frontend/.env.example` — 문서가 지시하는 환경변수의 정본

### External
- Vercel Blob (https://vercel.com/docs/storage/vercel-blob)

<!-- MANUAL: -->
