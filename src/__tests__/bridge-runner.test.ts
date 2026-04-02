import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildBridgeDaemonEnv,
  buildBridgeScriptArgs,
  resolveBridgeDaemonScript,
} from "../bridges/codex-bridge-runner.js";

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

describe("resolveBridgeDaemonScript", () => {
  it("prefers the bundled daemon next to the runner in standalone installs", () => {
    const repoRoot = "D:/workspace/project";
    const runnerUrl = "file:///D:/tap/dist/bridges/codex-bridge-runner.mjs";
    const suffix = path.join("bridges", "codex-app-server-bridge.mjs");

    const resolved = resolveBridgeDaemonScript(repoRoot, runnerUrl, (candidate) =>
      candidate.endsWith(suffix),
    );

    expect(resolved).toBeTruthy();
    expect(resolved!.endsWith(suffix)).toBe(true);
  });

  it("falls back to the legacy monorepo script when no packaged daemon exists", () => {
    const repoRoot = "D:/repo";
    const runnerUrl =
      "file:///D:/repo/packages/tap-comms/src/bridges/codex-bridge-runner.ts";
    const suffix = path.join("scripts", "codex-app-server-bridge.ts");

    const resolved = resolveBridgeDaemonScript(repoRoot, runnerUrl, (candidate) =>
      candidate.endsWith(suffix),
    );

    expect(resolved).toBeTruthy();
    expect(resolved!.endsWith(suffix)).toBe(true);
  });
});

describe("buildBridgeDaemonEnv", () => {
  it("preserves tap identity env when layering runtime env", () => {
    const merged = buildBridgeDaemonEnv(
      {
        TAP_BRIDGE_INSTANCE_ID: "codex-worker",
        TAP_AGENT_ID: "codex-worker",
        TAP_AGENT_NAME: "해",
        CODEX_TAP_AGENT_NAME: "해",
        TAP_COMMS_DIR: "D:/hua-comms",
        TAP_STATE_DIR: "D:/repo/.tap-comms",
        TAP_RUNTIME_STATE_DIR: "D:/repo/.tmp/codex-app-server-bridge-codex-worker",
        TAP_REPO_ROOT: "D:/repo",
        PATH: "C:/Windows/System32",
      },
      {
        PATH: "D:/repo/.fnm/node;C:/Windows/System32",
      },
    );

    expect(merged).toMatchObject({
      TAP_BRIDGE_INSTANCE_ID: "codex-worker",
      TAP_AGENT_ID: "codex-worker",
      TAP_AGENT_NAME: "해",
      CODEX_TAP_AGENT_NAME: "해",
      TAP_COMMS_DIR: "D:/hua-comms",
      TAP_STATE_DIR: "D:/repo/.tap-comms",
      TAP_RUNTIME_STATE_DIR: "D:/repo/.tmp/codex-app-server-bridge-codex-worker",
      TAP_REPO_ROOT: "D:/repo",
      PATH: "D:/repo/.fnm/node;C:/Windows/System32",
    });
  });
});
