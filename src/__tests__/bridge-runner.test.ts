import { describe, expect, it } from "vitest";
import { buildBridgeScriptArgs } from "../bridges/codex-bridge-runner.js";

describe("buildBridgeScriptArgs", () => {
  it("forwards agent name and state dir to the daemon script", () => {
    const args = buildBridgeScriptArgs("D:/repo/scripts/codex-app-server-bridge.ts", {
      repoRoot: "D:/repo",
      commsDir: "D:/hua-comms",
      appServerUrl: "ws://127.0.0.1:4510",
      gatewayTokenFile: "D:/repo/.tap-comms/secrets/gateway.token",
      stateDir: "D:/repo/.tmp/codex-app-server-bridge-reviewer",
      agentName: "결",
    });

    expect(args).toContain("--agent-name=결");
    expect(args).toContain("--state-dir=D:/repo/.tmp/codex-app-server-bridge-reviewer");
    expect(args).toContain("--repo-root=D:/repo");
    expect(args).toContain("--comms-dir=D:/hua-comms");
    expect(args).toContain("--app-server-url=ws://127.0.0.1:4510");
    expect(args).toContain("--gateway-token-file=D:/repo/.tap-comms/secrets/gateway.token");
  });
});
