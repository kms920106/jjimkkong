<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-25 | Updated: 2026-08-25 -->

# docs/youtube

## Purpose
유튜브 게시글의 설명 전문과 채널 아바타를 가져오는 데 쓰는 `YOUTUBE_API_KEY`
(YouTube Data API v3)를 발급하는 콘솔 절차. 코드는 이미 다 들어가 있고, 이 문서는 코드 밖에서
해야 하는 일만 다룬다.

## Key Files
| File | Description |
|------|-------------|
| `SETUP.md` | Google Cloud 프로젝트 준비 → API 활성화 → API 키 발급 → `.env` 채우기 순서 |

## For AI Agents

### Working In This Directory
- `YOUTUBE_API_KEY`는 **선택** 환경변수다. 없으면 유튜브 인제스트가 oEmbed로 떨어져
  `needsManualCaption: true`가 될 뿐 앱 전체가 막히지는 않는다 — 루트
  [AGENTS.md](../../AGENTS.md)의 "인제스트 파이프라인" 1번 참고. 아바타도 이 폴백에서는
  비는데, oEmbed가 사진을 주지 않기 때문이다(`AuthorAvatar`가 이니셜을 그린다).
- **이 키는 호출 두 개에 쓰인다: `videos.list`(설명 전문)와 `channels.list`(채널 아바타).**
  둘 다 API 활성화 하나로 덮이므로 콘솔 절차는 바뀌지 않지만, 할당량 계산은 저장당
  1 unit이 아니라 2 units이다 — `SETUP.md`의 "할당량" 절 참고.
- 이 키는 네이버 지역검색 키(`NAVER_CLIENT_ID`)나 네이버 로그인 키
  (`NAVER_LOGIN_CLIENT_ID`)와 전혀 다른 제공자·다른 콘솔이다. 섞어서 문서를 쓰지 말 것.
- 코드 쪽 이유(설명 전문이 필요한 이유, oEmbed 폴백의 한계)는 여기가 아니라 루트
  [AGENTS.md](../../AGENTS.md)와
  [frontend/src/lib/ingest/AGENTS.md](../../frontend/src/lib/ingest/AGENTS.md)에 있다. 이
  디렉터리는 콘솔 절차만 다룬다.

### Testing Requirements
키 없이도 유튜브 링크 저장은 된다 — 제목/작성자만 채워지고 캡션 입력을 요구한다. 키를
넣은 뒤에는 설명에 장소가 적힌 실제 유튜브 영상으로 캡션이 자동 채워지고 장소가 추출되는지
끝까지 확인해야 검증이 끝난 것이다.

## Dependencies

### Internal
- `frontend/src/lib/ingest/metadata.ts` — 이 문서가 설명하는 키의 구현체
- `frontend/.env.example` — 문서가 지시하는 환경변수의 정본

### External
- Google Cloud Console (https://console.cloud.google.com/)
- YouTube Data API v3

<!-- MANUAL: -->
