# 프로필 사진 저장소 설정 가이드 (Vercel Blob)

코드는 이미 다 들어가 있다. 이 문서는 **콘솔에서 해야 하는 일**과 그 결과를 어디에
넣는지만 다룬다. 코드 쪽 이유는 루트 [AGENTS.md](../../AGENTS.md)와
[frontend/src/lib/AGENTS.md](../../frontend/src/lib/AGENTS.md)에 있다.

이 저장소는 DB만 Supabase(Postgres)를 쓴다. **프로필 사진 파일은 Supabase가 아니라
Vercel Blob**이라는 별도 서비스에 올라간다 — 헷갈리기 쉬우니 처음부터 구분해 둔다.

## 1. Blob 스토어 생성

https://vercel.com 로그인 → 이 프로젝트 선택 → **Storage** 탭 → Create Database →
**Blob** 선택. "Create Blob Store" 폼에서 채울 항목:

| 항목 | 값 |
|------|-----|
| Store Name | 아무 이름(예: `jjimkkong-blob`) |
| Region | 아무 리전이나 되지만 **생성 후 변경 불가**. 앱 사용자가 한국이면 Seoul(icn1) |
| Access | **Public** — 아래 이유 참고. Private로 만들면 안 된다 |
| Custom Environment Variable Prefix | 기본값 `BLOB` 그대로 둔다 |
| Add a read-write token env var to this connection | **체크한다** — 아래 이유 참고 |

**Access는 반드시 Public.** `UserProfile.imageUrl`은 이 blob의 절대 URL 그 자체이고
앱은 그 URL을 그대로 `<img src>`에 꽂아 서빙한다(라우트 핸들러를 거치지 않는다 —
루트 [AGENTS.md](../../AGENTS.md)의 "데이터 모델" 참고). Private로 만들면 그 URL을
열 때마다 토큰이 필요해져서 아바타가 그냥 깨진다. 콘솔은 Private를
"Recommended"라고 표시하지만 그건 민감한 파일을 올리는 일반적인 경우의 권장값이고,
공개돼야 하는 프로필 사진에는 해당하지 않는다.

**"Add a read-write token env var to this connection"은 체크한다.** 체크하지 않고
만들면 프로젝트에는 `BLOB_STORE_ID`/`BLOB_WEBHOOK_PUBLIC_KEY`만 연결되고
`BLOB_READ_WRITE_TOKEN`(업로드·삭제에 실제로 쓰는 키)은 따로 만들어야 한다. 체크해서
만들면 이 토큰이 곧바로 프로덕션·프리뷰 환경변수로 주입되므로 배포 쪽에는 별도로
할 일이 없다.

Create를 누르면 스토어가 생성된다.

## 2. 로컬 개발 환경

방금 만든 스토어 페이지 → **`.env.local`** 탭(또는 프로젝트 Settings →
Environment Variables에서 `BLOB_READ_WRITE_TOKEN` 검색)에 로컬용 토큰이 있다.
그 값을 `frontend/.env`에 넣는다:

```
BLOB_READ_WRITE_TOKEN=
```

## 3. 확인

토큰 없이도 `/profile` 페이지는 열리고 닉네임·상태메세지 저장은 된다 —
사진 업로드만 실패한다(`profile-image.ts`가 `BlobError`를 400으로 매핑해서
"잠시 후 다시 시도해 주세요"로 보이지만, 재시도로 풀리는 문제가 아니라 토큰
누락이니 서버 로그의 `BlobError`를 확인할 것).

로그인 상태에서 `/profile` → 사진 선택 → 완료를 눌러 아바타가 바뀌는지,
새로고침 후에도 유지되는지 확인한다. 두 번 연속 업로드해서 이전 사진이 더 이상
서빙되지 않는지(같은 자리를 덮어쓰지 않고 매번 새 URL을 받는지)도 함께 본다.

## 4. 스토어 용량·비용

Blob은 저장된 바이트와 대역폭 기준으로 과금된다. 클라이언트가 업로드 전에
512px WEBP로 다운스케일하므로(`ProfileEditClient.tsx`) 사진 1장은 대체로
수십 KB 안팎이다. 대체된 사진은 저장 시점에 지워지고, 회원탈퇴 시에도
지워진다 — 고아 파일이 쌓이지 않는다.
