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

**`geocode.ts`는 병렬이 아니라 순차다.** 네이버는 한 client id에서 몰아치는 요청을
거부한다. 질의에 지역 힌트를 먼저 붙인다(`대림창고`보다 `성수동 대림창고`).
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
