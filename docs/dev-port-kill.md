<!-- Parent: ./AGENTS.md -->

# 개발 서버 포트(4000) 점유 해제

`npm run dev`는 `next dev -p 4000`이라 4000번 포트를 쓴다. 이전에 뜬 dev 서버가
그대로 남아 있으면 `EADDRINUSE: address already in use :::4000`가 난다.

## 원인 프로세스 찾기

```bash
lsof -nP -iTCP:4000 -sTCP:LISTEN
```

`COMMAND`/`PID` 컬럼을 확인한다. 보통 `node`(next dev)다.

## 종료

```bash
# 위에서 확인한 PID로 종료 (SIGTERM)
kill <PID>

# 안 죽으면 강제 종료 (SIGKILL) — 저장 안 된 상태가 있다면 먼저 확인
kill -9 <PID>
```

한 번에 찾아서 죽이려면:

```bash
lsof -tiTCP:4000 -sTCP:LISTEN | xargs kill
```

## 주의

- `kill -9`는 프로세스를 즉시 강제 종료한다. dev 서버 외 다른 중요한 프로세스가
  같은 포트를 쓰고 있는 게 아닌지 `lsof` 출력의 `COMMAND`로 먼저 확인할 것.
- 포트를 바꿔서 우회하지 않는다 — 지도 SDK(네이버/카카오/구글) 콘솔에 등록된 허용
  도메인이 `http://localhost:4000`으로 고정되어 있어서, 다른 포트로 띄우면 지도가
  조용히 렌더링에 실패한다(루트 [AGENTS.md](../AGENTS.md)의 "지도" 절 참고).
