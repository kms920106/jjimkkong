<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-19 | Updated: 2026-08-19 -->

# src/lib/ingest

## Purpose
제품의 핵심 파이프라인. `POST /api/ingest`가 이 세 모듈을 **이 순서대로** 부른다:
게시글 본문 수집 → LLM이 장소 이름 추출 → 네이버가 좌표 조회.

```
metadata.ts → extract.ts → geocode.ts
```

## Key Files
| File | Description |
|------|-------------|
| `metadata.ts` | `classifyUrl()`·`canonicalize()`·`fetchMetadata()`. 인스타/유튜브/지도 링크만 받고 나머지는 `UnsupportedUrlError` |
| `extract.ts` | `extractPlaces()` — OpenAI 호환 `/chat/completions`로 캡션에서 장소 이름 추출. `LlmRateLimitedError` |
| `geocode.ts` | `geocodeCandidates()` — 네이버 지역검색으로 이름 → 좌표 |

## For AI Agents

### Working In This Directory

**`metadata.ts` — 받는 링크는 정해져 있다.** 인스타그램 post/reel, 유튜브
watch/shorts, 네이버·카카오 지도 장소 링크(단축 `naver.me`/`kko.to` 포함)뿐이고 그 외는
400이다. `canonicalize()`가 트래킹 파라미터를 떼어 같은 게시글이 늘 한 행으로 저장되게
한다(`/reel/`·`/reels/`·`/tv/`·`/p/`가 하나의 퍼머링크로 수렴).

**지도 링크는 캡션이 아니라 장소 그 자체다.** 게시글은 장소를 *언급*하지만 지도 링크는
장소 하나를 *지목*한다. 그래서 여기서 og 태그의 이름을 `place`에 담아 주고, 인제스트
라우트는 LLM 추출을 건너뛰고 곧장 지오코딩한다. 이름을 읽는 자리가 제공자마다 다르다 —
네이버는 og:description(og:title은 늘 `네이버지도` 고정 문자열), 카카오는 og:title에
이름·og:description에 도로명 주소. 카카오의 주소는 지오코딩 힌트로 넘긴다.

**유튜브는 Data API v3가 유일하게 설명 전문을 준다.** 크리에이터가 장소를 나열하는 곳이
거기다. `YOUTUBE_API_KEY`가 없으면 oEmbed로 떨어지고 제목·작성자만 오므로
`needsManualCaption: true`가 된다.

**인스타그램 실패는 구체적인 `FailureReason`으로 로깅한다.** 조직적 차단, 셀렉터 파손,
타임아웃은 각각 정반대의 대응이 필요하다. 하나의 경고로 뭉뚱그리지 말 것.
`embed/captioned/`를 크롤러 UA로 먼저 시도하고, 실패하면 `og:description`으로 간다 —
거기 캡션이 통째로 있고 앞의 인게이지먼트 껍데기는 `parseOgCaption()`이 벗긴다.

**`extract.ts`의 제공자 교체 가능성을 깨뜨리지 말 것.** OpenAI 호환
`/chat/completions`면 무엇이든 동작하고, `LLM_API_KEY`/`LLM_BASE_URL`/`LLM_MODEL`만
바꾸면 코드 수정 없이 제공자가 바뀐다. `strict` json_schema를 걸어도 **응답은 Zod로
다시 검증한다** — 갈아끼운 제공자가 `response_format`을 무시할 수 있기 때문이다.
5xx·타임아웃은 재시도, 429는 재시도하지 않고 `LlmRateLimitedError`로 표면화한다.

**`geocode.ts`는 동시성 3의 제한된 병렬이다.** 네이버는 한 client id에서 몰아치는 요청을
거부하므로 `Promise.all`로 넓히지 말 것. 반대로 완전 순차로 되돌리지도 말 것 — 장소 5개면
최대 10회 직렬 왕복(왕복당 5s 타임아웃)이라 그것만으로 60s 예산을 넘긴다. 429가 보이면
`CONCURRENCY`를 내린다(신호는 `lookupFailed` 증가).

**결과는 `push`가 아니라 index로 채운다.** `POST /api/posts`가 이 배열을 위치로 짝지어
memo를 붙이므로, 완료 순서대로 밀어넣으면 memo가 다른 장소에 붙는다.

**같은 질의는 Runtime Cache에 10분(`CACHE_TTL_SECONDS`) 캐싱된다.** 저장 한 번이 이 모듈을
두 라운드 태우기 때문이다(ingest가 핀 표시용, posts가 클라이언트 좌표 불신으로 재실행).
두 번째 라운드는 보안 경계라 없앨 수 없어서 캐시로 답한다. **`LookupFailedError`는 캐싱하지
않는다**: 5xx 한 번이 TTL 내내 `lookupFailed`를 고정시키면 UI가 권하는 재시도가 캐시로
답해져 네이버에 닿지 않는다. 읽은 항목은 Zod로 다시 검증한다 — 캐시는 배포를 넘어 살아서
옛 형태의 항목이 새 코드에 읽힐 수 있고, 검증 없이는 그게 `toDegrees()`를 거쳐 공유 `Place`
행까지 흘러간다.

**`keyHashFunction`을 SHA-256으로 지정한 것은 보안 장치다.** 라이브러리 기본값은 djb2-xor를
32비트로 자른 값이고 저장되는 키에 질의 문자열이 들어가지 않아 second preimage가 자유롭다
(`"6foblaih"` ≡ `"성수동 대림창고"` → `f7eeb594`, 실측). 이 캐시를 읽는 곳이 `POST /api/posts`의
재지오코딩이므로, 키를 위조하면 남의 저장이 해석될 좌표를 고를 수 있다 — 루트 AGENTS.md의
"클라이언트가 보낸 좌표는 절대 믿지 않는다"가 한 층 아래에서 뚫리는 것이다. 기본값으로
되돌리지 말 것. namespace(`naver-local-v1`)에 버전이 붙은 이유는 저장 형태가 바뀌었을 때
옛 항목을 읽지 않기 위해서다.

**`set`에 `name`을 명시적으로 넘긴다. 빼면 캐시가 한글 질의에 대해 통째로 무동작이 된다.**
라이브러리는 `name`을 `options?.name ?? key`로 채우고 — 즉 **해싱 전 원본 질의를** —
`x-vercel-cache-item-name` HTTP 헤더로 보낸다. 헤더 값은 ByteString이라 255를 넘는 코드포인트가
있으면 `fetch` 안에서 throw하고, `BuildCache.set`이 그걸 자기 try/catch로 삼켜 정상 resolve한다.
그래서 **`.catch()`도 안 걸리고 에러도 안 보이며 `get`은 영원히 미스한다.** 이 앱이 지오코딩하는
이름은 거의 전부 한글이므로 기본값을 쓰면 프로덕션에서 캐시가 아무 일도 하지 않는다 — 그런데
`next dev`는 in-memory 폴백이 `name`을 무시하고 잘 저장하므로 **로컬에서는 정상으로 보인다.**
넘기는 값은 digest다(SHA-256 키 해싱이 하는 두 번째 일이 이것 — 질의를 키에서만이 아니라
전송 계층에서도 빼낸다).

**캐시가 없으면 라이브러리가 in-memory 캐시로 대체한다**(경고 한 번을 찍는다). 우회가
아니므로 `next dev`·스크립트에서는 프로세스 수명 동안 항목이 쌓이고, 두 라운드 사이의
적중은 배포 환경에서만 확인된다. `try/catch`가 실제로 막는 것은 진짜 장애와 옛 형태의
항목이며, 판단 자체는 `post-thumbnail.ts`와 같다 — 캐시 장애는 느린 저장이어야 하고
실패한 저장이어서는 안 된다. `getCache()`를 모듈 스코프로 올리지 말 것: 생성 실패 시
import 시점에 throw하고, 그건 어떤 per-call catch로도 못 막는다.

**`cachedSearch`는 진행 중인 동일 질의를 합친다.** 캐시는 fetch가 끝나야 채워지므로 동시
동일 질의는 전부 미스가 되고, 동시성 3이 그걸 이론이 아니라 흔한 일로 만든다.

질의에 지역 힌트를 먼저 붙인다(`대림창고`보다 `성수동 대림창고`).
`mapx`/`mapy`는 WGS84 도 단위 × 1e7이다.

**`matched: false`와 `lookupFailed: true`를 합치지 말 것.** "지도에 없음"과
"검색이 일시적으로 죽음"은 UI 문구가 다르다.

### Testing Requirements
실제 링크를 붙여넣어야 검증된다. 최소한 (1) 인스타 릴스, (2) 유튜브 shorts,
(3) 네이버 지도 단축 링크, (4) 지원하지 않는 도메인(400) 네 가지를 돌린다.
인스타그램은 차단이 상시적이므로 `needsManualCaption` 경로도 함께 본다.

### Common Patterns
모든 외부 호출에 타임아웃(`FETCH_TIMEOUT_MS` / `ATTEMPT_TIMEOUT_MS`)이 걸려 있다.
새 호출을 추가하면 타임아웃도 함께 붙인다 — 없으면 Vercel 함수가 그냥 매달린다.

## Dependencies

### Internal
- `../../app/api/ingest/route.ts` — 세 모듈을 순서대로 부르는 유일한 호출자
- `../../app/api/posts/route.ts` — 저장 시 `geocode.ts`를 다시 부른다(클라이언트 좌표 불신)
- `../types.ts` — `IngestResponse`, `IngestCandidate`

### External
- `node-html-parser` — og 태그·embed 파싱
- YouTube Data API v3 (선택), 네이버 지역검색 API, OpenAI 호환 LLM 엔드포인트

<!-- MANUAL: -->
