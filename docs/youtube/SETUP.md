# YouTube Data API v3 설정 가이드

코드는 이미 다 들어가 있다. 이 문서는 **콘솔에서 해야 하는 일**과 그 결과를 어디에
넣는지만 다룬다. 코드 쪽 이유는 루트 [AGENTS.md](../../AGENTS.md)의 "인제스트 파이프라인"과
[frontend/src/lib/ingest/AGENTS.md](../../frontend/src/lib/ingest/AGENTS.md)에 있다.

`YOUTUBE_API_KEY`는 선택 항목이다. 없어도 앱은 정상 동작하지만, 유튜브 게시글에서
설명 전문을 못 읽어 `needsManualCaption: true`가 되고 사용자가 캡션을 직접 붙여넣어야 한다.

## 1. Google Cloud 프로젝트 준비

https://console.cloud.google.com/ 로그인 → 상단 프로젝트 선택 드롭다운 → 기존 프로젝트를
쓰거나 "새 프로젝트"로 하나 만든다(예: `jjimkkong`).

## 2. YouTube Data API v3 활성화

좌측 메뉴 "API 및 서비스" → "라이브러리" → "YouTube Data API v3" 검색 → 클릭 → "사용" 버튼.
**이 단계를 건너뛰면 3단계의 API 제한사항 드롭다운에 YouTube Data API v3가 나타나지 않는다.**

## 3. API 키 생성

"API 및 서비스" → "사용자 인증 정보" → "사용자 인증 정보 만들기" → "API 키".

| 항목 | 값 |
|------|-----|
| 이름 | 식별용, 아무 이름(예: `jjimkkong-youtube-key`) |
| API 제한사항 선택 | **YouTube Data API v3** 하나만 체크 |
| 서비스 계정을 통해 API 호출 인증 | 체크하지 않음 — Vertex/Gemini API용 옵션이라 이 키와 무관 |
| 애플리케이션 제한사항 | 없음 — 서버(Next.js API 라우트)에서만 쓰는 키라 IP/도메인 제한을 걸 필요가 없다 |

"만들기"를 누르면 키 값이 나온다. 이 값을 복사한다.

**이 키를 지역검색용 네이버 키와 혼동하지 말 것.** 이 프로젝트에는 이미 다른 용도로 만들어진
API 키가 있을 수 있다 — 이름 없이 "Bound account"로 표시되는 키는 대개 다른 서비스(Vertex
등)에 바인딩된 것이니 재사용하지 않는다.

## 4. 로컬 환경변수

`frontend/.env`의 다음 줄에 붙여넣는다:

```
YOUTUBE_API_KEY=
```

## 5. 확인

키를 넣지 않고도 앱은 켜진다 — 유튜브 링크를 붙여넣으면 oEmbed로 제목/작성자만 가져오고
`CaptionPrompt`가 캡션을 직접 입력하라고 뜬다. 키를 넣은 뒤에는 설명에 장소가 적힌 유튜브
영상 링크(watch 또는 shorts)를 붙여넣어 캡션이 자동으로 채워지고 장소가 추출되는지 확인한다.

## 6. 할당량

무료 할당량은 프로젝트당 하루 10,000 units이고, 이 앱이 쓰는 `videos.list` 호출은
1 unit이다. 이 서비스 규모에서는 넉넉하지만, 여러 프로젝트에서 같은 Google Cloud 프로젝트를
공유하면 할당량을 나눠 쓰게 된다는 점은 알아 둔다.
