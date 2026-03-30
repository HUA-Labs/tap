---
date: 2026-03-30
author: 온(溫)
gen: 19
mission: M198/M199
pr: "#6"
---

# M198/M199 — Windows bridge liveness gate and standalone source sync

## 배경

Gen 19에서 tap 브릿지 연결 장애를 추적하면서 두 문제가 같이 드러났다.

- M198: Windows detached spawn이 즉시 죽어도 bridge start가 성공처럼 state를 저장하는 false-positive 경로
- M199: standalone `C:\tap` worktree가 monorepo 기준 경로 drift로 인해 local source/scripts 대신 어긋난 경로를 참조하는 문제

둘 다 로컬 재현과 bridge 연결 실패에 직접 영향을 줘서, standalone hotfix와 source sync를 같은 축에서 먼저 닫았다.

## 변경

### M198

- `src/engine/bridge-windows-spawn.ts`
  - Windows detached spawn liveness helper 추가
- `src/engine/bridge-startup.ts`
  - win32에서는 short liveness gate 통과 후에만 bridge state 저장
  - 즉시 사망 시 stderr log 경로를 포함한 오류로 실패 처리
- `src/engine/bridge.ts`
  - helper export 추가
- `src/__tests__/bridge.test.ts`
  - 기존 false-positive start 케이스를 failure expectation으로 갱신
- active dist hotfix
  - `dist/cli.mjs`
  - `dist/index.mjs`

### M199

- standalone wrapper/import 경로 복구
  - `src/mcp-server.ts`
  - `src/bridges/codex-app-server-bridge.ts`
- local script entrypoint 추가
  - `scripts/codex-app-server-bridge.ts`
  - `scripts/codex-app-server-probe.ts`
  - `scripts/tap-autopilot.mjs`
  - `scripts/lib/chain-review-router-core.mjs`
- legacy mirror resync
  - `channels/*`
  - `bridges/*`
- config backup/example 문서에 historical ops path 주석 추가
  - `configs/codex-config-example.toml`
  - `configs/README.md`
  - `configs/codex-session-bootstrap.md`

## 크로스리뷰

- 결: M198 local hotfix accept
  - residual risk는 liveness gate이지 full readiness gate는 아니라는 점
- 결: M199는 local runtime/source mirror 정합성 축에서 거의 닫힘
- 온 자체 정리 기준
  - `C:\tap` local hotfix/sync는 완료
  - 운영 `0.3.1` monorepo source-of-truth sync는 별도 follow-up

## 검증

- `node --check dist/cli.mjs`
- `node --check dist/index.mjs`
- source helper smoke
  - current pid -> true
  - dead pid -> false
- `bun` import smoke
  - `scripts/codex-app-server-bridge.ts`
  - `scripts/tap-autopilot.mjs`
  - `scripts/lib/chain-review-router-core.mjs`
  - `src/bridges/codex-app-server-bridge.ts`
- `bun test`
  - `packages/tap-plugin/channels/__tests__/tap-comms.test.ts`
  - `src/__tests__/bridge-ux.test.ts`

## 메모

- 로컬 산출물 `.npm-cache/`, `tap-config.json`은 커밋에서 제외
- PR #6은 standalone `C:\tap` 기준 hotfix/sync 범위만 포함
- 운영 monorepo 반영은 후속 작업으로 분리
