# Codex App Server Bridge Runbook

> 사용자가 직접 켜고 끄는 기준의 실행 문서.

## 목적

이 문서는 `tap-comms` 메시지를 **보이는 Codex TUI** 안으로 실시간 주입하고 싶을 때 따라가는 가장 깔끔한 실행 순서를 정리한다.

대상 경로:

```text
inbox file -> codex-app-server-bridge -> Codex App Server -> remote Codex TUI
```

## 추천 기본값

- `App Server URL`: `ws://127.0.0.1:4501`
- `BusyMode`: `steer`
- `AgentName`: **세션 안에 들어간 에이전트가 직접 정한 이름과 정확히 같게**
- `MessageLookbackMinutes`: `1`

먼저 URL만 정하고 시작한다:

```powershell
$AppServerUrl = "ws://127.0.0.1:4501"
```

## 켜는 순서

### 1. App Server 실행

터미널 1:

```powershell
cd D:\HUA\hua-platform
codex app-server --listen $AppServerUrl
```

이 터미널은 켜둔다.

### 2. remote Codex TUI 실행

터미널 2:

```powershell
cd D:\HUA\hua-platform
codex --enable tui_app_server --remote $AppServerUrl
```

여기서 실제로 대화하는 TUI가 뜬다.

### 2.5. 세션 안에서 에이전트가 이름 정하기

이 프로젝트 룰상 이름은 **사용자가 미리 정하는 게 아니라, 세션에 들어온 에이전트가 직접 정한다.**

그래서 TUI가 뜨면 먼저 이렇게 진행한다:

1. 에이전트에게 미션/문맥을 읽게 한다
2. 에이전트가 자기 이름을 직접 정한다
3. `tap_set_name`을 호출하게 한다
4. 정한 이름을 사용자에게 한 줄로 말하게 한다

그 다음에만 아래 변수에 넣는다:

```powershell
$AgentName = "<세션이직접정한이름>"
```

### 3. App Server bridge daemon 실행

터미널 3:

```powershell
cd D:\HUA\hua-platform
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/codex-app-server-bridge-start.ps1 -AgentName $AgentName -AppServerUrl $AppServerUrl -MessageLookbackMinutes 1
```

정상이라면 대략 이런 정보가 보인다:

- `bridge started`
- `agent: <세션이직접정한이름>`
- `appserver: ws://127.0.0.1:4501`
- `state: D:\HUA\hua-platform\.tmp\codex-app-server-bridge-<세션이직접정한이름>`

## 확인 방법

브리지가 제대로 붙었는지 보고 싶으면:

```powershell
cd D:\HUA\hua-platform
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/codex-app-server-bridge-status.ps1 -AgentName $AgentName
```

여기서 볼 핵심 필드:

- `bridge status: running`
- `connected: True`
- `thread:` 값 존재
- `request:` 최근 들어온 inbox 파일명
- `dispatch:` `start` 또는 `steer`

### 더 넓게 자가진단하기

`status`는 bridge 메타/heartbeat 중심으로 보여준다.
문제가 있을 때는 `self-check`가 더 낫다.

```powershell
cd D:\HUA\hua-platform
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/codex-app-server-self-check.ps1 -AgentName $AgentName
```

이 스크립트는 한 번에 아래를 확인한다:

- agent 이름 해상 결과
- agent-scoped state dir 선택 결과
- `TAP_COMMS_DIR` / inbox 경로
- bridge pid 생존 여부
- heartbeat freshness
- 저장된 thread / active turn / last dispatch
- App Server TCP reachability
- 최근 inbox 항목
- 최근 로그 파일

특히 status만 보면 놓치기 쉬운 이런 상황을 빨리 찾을 수 있다:

- `-AgentName`이 달라서 다른 state dir를 보고 있는 경우
- bridge는 안 떠 있는데 state 디렉터리만 남아 있는 경우
- App Server URL은 맞지만 TCP 자체가 안 열리는 경우
- 최근 inbox는 들어오는데 dispatch가 안 남는 경우

### self-check 출력 해석

- `[OK] bridge process alive`
  - daemon 메타에 기록된 pid가 실제로 살아 있음
- `[OK] heartbeat fresh`
  - bridge가 최근까지 heartbeat를 갱신함
- `[INFO] active turn`
  - 지금 active turn이 있어 다음 inbox는 `steer`로 들어갈 가능성이 높음
- `[INFO] last dispatch`
  - 마지막으로 어떤 inbox 파일을 어떤 방식(`start` / `steer`)으로 넣었는지
- `[WARN] bridge metadata file is missing`
  - bridge를 아직 안 띄웠거나, 다른 이름/state를 보고 있을 가능성이 큼
- `[WARN] app-server TCP probe failed`
  - `codex app-server --listen ...`가 안 떠 있거나 URL/포트가 다를 수 있음

### self-check 한계

이 스크립트는 **보이는 live TUI 렌더링 자체는 확인하지 못한다.**
즉 아래까지는 본다:

- inbox 파일 존재
- bridge 상태
- App Server 포트 도달성
- thread / turn / dispatch 흔적

하지만 아래는 못 본다:

- 사용자가 보는 TUI 화면에 실제로 텍스트가 렌더링됐는지
- 다른 PC / 다른 터미널 세션 화면 상태
- bridge 밖에서 수동으로 바뀐 UI 상태

### 운영 대시보드

App Server bridge만 따로 보고, review bridge는 또 따로 보고, inbox는 또 따로 보면 판단이 느려진다.
운영 중에는 아래 대시보드가 더 편하다.

```powershell
cd D:\HUA\hua-platform
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tap-ops-dashboard.ps1 -AgentName $AgentName -Watch
```

이 화면은 한 번에 같이 보여준다:

- App Server bridge pid / heartbeat / thread / active turn / last dispatch
- review bridge pid / heartbeat / active worker
- 최근 inbox 항목
- App Server TCP reachability
- 현재 눈에 띄는 warning

`-Json` 옵션을 주면 같은 정보를 JSON으로도 뽑을 수 있어서, 나중에 Windows GUI wrapper를 얹을 때도 그대로 재사용할 수 있다.

## 실사용 규칙

- 다른 에이전트가 `to: "<세션이직접정한이름>"` 또는 `to: "전체"`로 보내면 bridge가 감지한다.
- TUI가 idle이면 `turn/start`
- TUI가 active면 `turn/steer`
- 상태 파일은 이름별로 분리된다:
  - `.tmp/codex-app-server-bridge-<name>`

즉 **이름만 정확히 맞추면** 다른 TUI 세션과 state가 섞이지 않는다.
중요한 건 그 이름을 **사용자가 지어주는 게 아니라, 세션이 먼저 정하고 그 값을 bridge에 그대로 넘긴다**는 점이다.

## 코드 수정 후 다시 띄우기

bridge 스크립트를 수정했으면 `-Restart`로 다시 띄우는 게 제일 간단하다.

```powershell
cd D:\HUA\hua-platform
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/codex-app-server-bridge-start.ps1 -AgentName $AgentName -AppServerUrl $AppServerUrl -MessageLookbackMinutes 1 -Restart
```

## 끄는 순서

### 1. bridge daemon 중지

```powershell
cd D:\HUA\hua-platform
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/codex-app-server-bridge-stop.ps1 -AgentName $AgentName
```

### 2. remote Codex TUI 종료

터미널 2에서 종료한다.

### 3. App Server 종료

터미널 1에서 종료한다.

## 가장 흔한 문제

### 메시지가 안 뜸

먼저 이걸 본다:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/codex-app-server-self-check.ps1 -AgentName $AgentName
```

확인 포인트:

- `[OK] bridge process alive` 인가
- `[OK] heartbeat fresh` 인가
- `[OK] app-server TCP reachable` 인가
- `last dispatch:` 에 방금 보낸 inbox 파일이 찍히는가
- `state:` 가 기대한 `.tmp/codex-app-server-bridge-<name>` 인가
- `AgentName` 이 실제 수신 이름과 같은가

### 잘못된 세션이 메시지를 먹음

원인은 거의 항상 이름/state 불일치다.

정리:

1. bridge 중지
2. 올바른 이름으로 다시 시작
3. `state:` 가 `.tmp/codex-app-server-bridge-<그이름>` 으로 잡히는지 확인

### 예전 메시지까지 너무 많이 다시 읽음

`-MessageLookbackMinutes` 값을 줄이면 된다.

권장:

- 평소: `1`
- 처음 붙을 때만 확인용: `5`
- 전체 backlog가 필요할 때만 `-ProcessExistingMessages`

## 선택 사항: 리뷰 자동화 bridge

보이는 TUI 주입과 별개로, headless 리뷰 자동화도 같이 켤 수 있다.

```powershell
cd D:\HUA\hua-platform
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/inbox-review-bridge-start.ps1 -AgentName "온" -MessageLookbackMinutes 15
```

상태 확인:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/inbox-review-bridge-status.ps1
```

중지:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/inbox-review-bridge-stop.ps1
```

이건 `codex exec` worker 자동 리뷰용이고, **보이는 TUI 실시간 주입**은 위의 App Server bridge가 담당한다.

## 한 번에 보는 요약

### 시작

```powershell
codex app-server --listen ws://127.0.0.1:4501
codex --enable tui_app_server --remote $AppServerUrl
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/codex-app-server-bridge-start.ps1 -AgentName $AgentName -AppServerUrl $AppServerUrl -MessageLookbackMinutes 1
```

### 확인

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/codex-app-server-bridge-status.ps1 -AgentName $AgentName
```

### 중지

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/codex-app-server-bridge-stop.ps1 -AgentName $AgentName
```
