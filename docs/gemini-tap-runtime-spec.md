# Gemini TAP Runtime Spec (Draft)

이 문서는 Gemini CLI(휘)가 TAP(Task Automation Platform) 환경에서 런타임으로 동작하기 위한 기술 규격을 정의한다.

## 1. Runtime Overview
Gemini CLI는 현재 공식적인 실시간 Push 채널(WebSocket 등)이 부재하므로, **`polling-first`** 전략을 기본으로 채택한다.

- **에이전트명**: `휘 (暉 / Hui)`
- **통신 방식**: MCP 서버(`tap-comms`)를 통한 파일 기반 폴링.
- **주기**: 기본 5초 (설정 가능).

## 2. Gemini Polling Runtime (GPR)
실시간 대응을 위해 Gemini CLI 세션 내에서 백그라운드로 동작하거나, 에이전트가 루프를 돌며 수행하는 로직을 정의한다.

### 2.1. 폴링 로직 (Pseudo-code)
```typescript
while (alive) {
  const unread = await mcp.callTool("tap_list_unread", { sources: ["inbox"] });
  if (unread.items.length > 0) {
    for (const msg of unread.items) {
      if (msg.to === "휘" || msg.to === "all") {
        // UI에 알림 표시 및 컨텍스트 주입 유도
        notifyUser(`New message from ${msg.from}: ${msg.subject}`);
      }
    }
  }
  await sleep(5000);
}
```

## 3. Fake IDE Bridge (Future)
실제 실시간 Push를 구현하기 위해, Gemini CLI를 속이는(?) 브릿지 레이어를 준비한다.

- **작동 원리**: 브릿지가 HTTP 서버(IDE Role)를 열고, Gemini CLI가 `GEMINI_CLI_IDE_SERVER_PORT`를 통해 여기에 접속하게 함.
- **메서드**: `ide/contextUpdate`를 사용하여 외부 메시지를 세션 컨텍스트로 강제 주입.
- **도전 과제**: 현재 TUI 세션에서 동적으로 포트를 바꿀 수 없으므로, **Launcher** 단계에서 이를 미리 셋업해야 함.

## 4. TAP Launcher Schema Extension
`docs/areas/tap/tap-launch-spec.md`의 `runtimeConfig`에 다음과 같이 Gemini 설정을 추가한다.

```json
"runtimeConfig": {
  "gemini": {
    "agentName": "휘",
    "pollingInterval": 5,
    "mcpServers": ["tap-comms"],
    "fakeIdePort": 8090,
    "model": "gemini-2.0-flash-exp"
  }
}
```

## 5. Implementation Roadmap
1.  **Phase 1 (Current)**: `tap_list_unread`를 수동/주기적으로 호출하는 매뉴얼 대응.
2.  **Phase 2**: `gemini-polling-bridge.ts`를 통해 터미널 알림(Bell/Toast) 연동.
3.  **Phase 3**: `Fake IDE Bridge`를 통한 완전 자동화된 메시지 주입.

---
**작성자**: 휘 (暉)
**일자**: 2026-03-22
