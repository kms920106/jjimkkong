# jjimkkong (찜꽁)

인스타그램·유튜브 링크를 붙여넣으면 게시글에서 장소를 찾아 지도에 저장하는 서비스.

## 동작 방식

1. 링크를 붙여넣으면 게시글 메타데이터를 가져옵니다.
   - 유튜브: Data API v3(설명 전문) → 키가 없으면 oEmbed(제목·썸네일만)
   - 인스타그램: og 태그 파싱. 차단되면 캡션 수동 붙여넣기로 전환
2. LLM(기본값 Google Gemini)이 캡션에서 방문 가능한 장소 이름을 추출합니다.
3. 네이버 지역검색 API로 좌표를 찾습니다.
4. 후보 목록을 보여주고, 사용자가 확인한 장소만 저장합니다.
5. 저장된 장소가 지도에 표시됩니다(네이버 기본, 카카오·구글 전환 가능).

## 기술 스택

Next.js 16 (App Router) · Supabase (Auth + Postgres) · Prisma · Google Gemini (OpenAI 호환 LLM) · Tailwind CSS v4 · Vercel

## 로컬 실행

```bash
cd frontend
npm install
cp .env.example .env      # 아래 값을 채웁니다
npm run db:migrate        # 첫 실행 시 스키마 생성
npm run dev
```

### 필요한 외부 서비스

| 서비스 | 발급처 | 채울 환경변수 |
|---|---|---|
| Supabase | [supabase.com](https://supabase.com) → Project Settings > API / Database | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DATABASE_URL`, `DIRECT_URL` |
| Google Gemini (LLM) | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → Create API key | `LLM_API_KEY` |
| 네이버 검색 API | [developers.naver.com](https://developers.naver.com) → 애플리케이션 등록 → 검색 | `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` |
| 네이버 지도 | [NCP Console](https://console.ncloud.com) → Maps → Application | `NEXT_PUBLIC_NAVER_MAP_CLIENT_ID` |
| 카카오맵 (선택) | [developers.kakao.com](https://developers.kakao.com) → 앱 키 → JavaScript 키 | `NEXT_PUBLIC_KAKAO_MAP_KEY` |
| 구글 지도 (선택) | [Google Cloud Console](https://console.cloud.google.com) → Maps JavaScript API | `NEXT_PUBLIC_GOOGLE_MAPS_KEY` |
| YouTube Data API (선택) | Google Cloud Console → YouTube Data API v3 | `YOUTUBE_API_KEY` |

`DATABASE_URL`은 풀러(6543 포트, `?pgbouncer=true&connection_limit=1`), `DIRECT_URL`은 직접 연결(5432 포트)입니다. 마이그레이션은 direct 연결로만 실행됩니다.

### LLM 제공자 바꾸기

장소 추출은 OpenAI 호환 chat-completions 엔드포인트를 호출하므로, 아래 두 변수와 모델 상수 한 줄만으로 제공자를 바꿀 수 있습니다.

| 변수 | 기본값 | 설명 |
|---|---|---|
| `LLM_API_KEY` | (필수) | 제공자 API 키 |
| `LLM_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` | `/chat/completions`를 붙일 베이스 URL |

기본값은 Google Gemini의 OpenAI 호환 계층입니다. 무료 티어 한도를 넘기면 앱이 429와 함께 안내 메시지를 표시합니다.

**모델은 환경변수가 아니라 코드에서 고릅니다.** [`frontend/src/lib/ingest/llm-model.ts`](frontend/src/lib/ingest/llm-model.ts)의 `ACTIVE_LLM_TIER`에 등급 이름(`flash-lite` / `flash` / `pro`)을 적으면 되고, 그 이름이 Gemini 별칭으로 해석됩니다. 모델은 시크릿도 배포별 값도 아닌 **튜닝 값**이라 이 저장소의 다른 튜닝 상수들과 같은 자리에 둡니다 — 덤으로 오타가 런타임 404가 아니라 컴파일 에러가 됩니다. 다른 제공자(Groq·OpenRouter·자체 Ollama 등)로 옮기려면 위 두 변수와 이 상수만 바꾸면 됩니다.

> Gemini CLI(`gemini` 명령)의 OAuth 로그인과 API 키는 별개입니다. 웹앱은 AI Studio에서 발급한 API 키를 사용합니다.

### 로그인 설정

Supabase 대시보드 → Authentication → Providers에서 Google(및 카카오)을 활성화하고,
Authentication → URL Configuration의 Redirect URLs에 다음을 추가합니다.

- `http://localhost:4000/auth/callback`
- `https://<vercel-도메인>/auth/callback`

### 지도 도메인 등록

각 지도 콘솔의 허용 도메인에 `http://localhost:4000`과 Vercel 도메인을 등록해야 지도가 렌더링됩니다.

## 배포 (Vercel)

- **Root Directory**: `frontend`
- 위 표의 환경변수를 Vercel 프로젝트에 등록
- 마이그레이션은 빌드가 아니라 로컬/CI에서 실행합니다: `npm run db:deploy` (DIRECT_URL 사용)
- Supabase Auth Redirect URL과 지도 콘솔 허용 도메인에 배포 도메인을 추가

## 보안 메모

Prisma는 테이블 소유자로 접속하므로 Postgres RLS를 우회합니다. 소유권 검사는
애플리케이션 레이어에서 이뤄집니다 — 모든 API 라우트는 `requireUser()`로 세션을
검증하고 쿼리를 `userId`로 한정합니다. Supabase Data API를 통한 직접 노출을 막으려면
도메인 테이블에 정책 없는 RLS를 켜 두는 것을 권장합니다.
