import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildBridgeDaemonEnv,
  buildBridgeScriptArgs,
  resolveHeadlessReviewGeneration,
  resolveBridgeRoutingSlot,
  resolveBridgeDaemonScript,
  resolveRepoRootHintFromRunner,
} from "../bridges/codex-bridge-runner.js";

describe("buildBridgeScriptArgs", () => {
  it("forwards agent name and state dir to the daemon script", () => {
    const args = buildBridgeScriptArgs(
      "D:/repo/scripts/codex/codex-app-server-bridge.ts",
      {
        repoRoot: "D:/repo",
        commsDir: "D:/hua-comms",
        appServerUrl: "ws://127.0.0.1:4510",
        gatewayTokenFile: "D:/repo/.tap-comms/secrets/gateway.token",
        stateDir: "D:/repo/.tmp/codex-app-server-bridge-reviewer",
        agentName: "결",
      },
    );

    expect(args).toContain("--agent-name=결");
    expect(args).toContain(
      "--state-dir=D:/repo/.tmp/codex-app-server-bridge-reviewer",
    );
    expect(args).toContain("--repo-root=D:/repo");
    expect(args).toContain("--comms-dir=D:/hua-comms");
    expect(args).toContain("--app-server-url=ws://127.0.0.1:4510");
    expect(args).toContain(
      "--gateway-token-file=D:/repo/.tap-comms/secrets/gateway.token",
    );
  });
});

describe("resolveBridgeDaemonScript", () => {
  it("prefers the bundled daemon next to the runner in standalone installs", () => {
    const repoRoot = "D:/workspace/project";
    const runnerUrl = "file:///D:/tap/dist/bridges/codex-bridge-runner.mjs";
    const suffix = path.join("bridges", "codex-app-server-bridge.mjs");

    const resolved = resolveBridgeDaemonScript(
      repoRoot,
      runnerUrl,
      (candidate) => candidate.endsWith(suffix),
    );

    expect(resolved).toBeTruthy();
    expect(resolved!.endsWith(suffix)).toBe(true);
  });

  it("falls back to the legacy monorepo script when no packaged daemon exists", () => {
    const repoRoot = "D:/repo";
    const runnerUrl =
      "file:///D:/repo/packages/tap-comms/src/bridges/codex-bridge-runner.ts";
    const suffix = path.join("scripts", "codex-app-server-bridge.ts");

    const resolved = resolveBridgeDaemonScript(
      repoRoot,
      runnerUrl,
      (candidate) => candidate.endsWith(suffix),
    );

    expect(resolved).toBeTruthy();
    expect(resolved!.endsWith(suffix)).toBe(true);
  });
});

describe("resolveRepoRootHintFromRunner", () => {
  it("prefers TAP_REPO_ROOT when provided", () => {
    const repoRoot = path.join(process.cwd(), "workspace", "project");
    const resolved = resolveRepoRootHintFromRunner(
      pathToFileURL(
        path.join(
          process.cwd(),
          "tap",
          "dist",
          "bridges",
          "codex-bridge-runner.mjs",
        ),
      ).href,
      { TAP_REPO_ROOT: repoRoot },
      () => false,
    );

    expect(resolved).toBe(path.resolve(repoRoot));
  });

  it("recognizes the moved scripts/codex bridge marker while walking ancestors", () => {
    const repoRoot = path.join(process.cwd(), "repo");
    const runnerUrl = pathToFileURL(
      path.join(
        repoRoot,
        "packages",
        "tap-comms",
        "src",
        "bridges",
        "codex-bridge-runner.ts",
      ),
    ).href;
    const movedScript = path.join(
      repoRoot,
      "scripts",
      "codex",
      "codex-app-server-bridge.ts",
    );

    const resolved = resolveRepoRootHintFromRunner(
      runnerUrl,
      {},
      (candidate) => candidate === movedScript,
    );

    expect(resolved).toBe(path.resolve(repoRoot));
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
        TAP_RUNTIME_STATE_DIR:
          "D:/repo/.tmp/codex-app-server-bridge-codex-worker",
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
      TAP_RUNTIME_STATE_DIR:
        "D:/repo/.tmp/codex-app-server-bridge-codex-worker",
      TAP_REPO_ROOT: "D:/repo",
      PATH: "D:/repo/.fnm/node;C:/Windows/System32",
    });
  });
});

describe("resolveBridgeRoutingSlot", () => {
  it("derives stable slots from instance ids", () => {
    expect(
      resolveBridgeRoutingSlot("D:/repo", {
        TAP_BRIDGE_INSTANCE_ID: "codex-reviewer",
      }),
    ).toBe("reviewer");
    expect(
      resolveBridgeRoutingSlot("D:/repo", {
        TAP_INSTANCE_ID: "claude-wt1",
      }),
    ).toBe("wt-1");
    expect(
      resolveBridgeRoutingSlot("D:/repo", {
        TAP_INSTANCE_ID: "claude-wt3",
      }),
    ).toBe("wt-3");
  });

  it("falls back to worktree repo-root names when no instance id is present", () => {
    expect(resolveBridgeRoutingSlot("D:/repo/.tmp/wt-2", {})).toBe("wt-2");
    expect(resolveBridgeRoutingSlot("D:/repo/.tmp/wt-7", {})).toBe("wt-7");
  });
});

describe("resolveHeadlessReviewGeneration", () => {
  it("prefers explicit TAP_REVIEW_GENERATION when provided", () => {
    expect(
      resolveHeadlessReviewGeneration("D:/repo", null, {
        TAP_REVIEW_GENERATION: "gen42",
      }),
    ).toBe("gen42");
  });

  it("accepts TAP_GENERATION as a fresh-generation fallback", () => {
    expect(
      resolveHeadlessReviewGeneration("D:/repo", null, {
        TAP_GENERATION: "37",
      }),
    ).toBe("gen37");
  });

  it("falls back to the highest reviews/genN directory in the repo", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "headless-gen-"));
    try {
      fs.mkdirSync(path.join(repoRoot, "reviews", "gen11"), {
        recursive: true,
      });
      fs.mkdirSync(path.join(repoRoot, "reviews", "gen37"), {
        recursive: true,
      });
      fs.mkdirSync(path.join(repoRoot, "reviews", "misc"), {
        recursive: true,
      });

      expect(resolveHeadlessReviewGeneration(repoRoot, null, {})).toBe("gen37");
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("falls back to the highest comms generation when reviews/ is absent", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "headless-gen-"));
    const commsDir = fs.mkdtempSync(path.join(os.tmpdir(), "headless-comms-"));
    try {
      fs.mkdirSync(path.join(commsDir, "retros", "gen36"), { recursive: true });
      fs.mkdirSync(path.join(commsDir, "letters", "gen37"), { recursive: true });

      expect(resolveHeadlessReviewGeneration(repoRoot, commsDir, {})).toBe(
        "gen37",
      );
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
      fs.rmSync(commsDir, { recursive: true, force: true });
    }
  });
});
