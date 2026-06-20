import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  resolvePackagedBridgeAsset,
  unwrapNpmCmdShim,
  splitResolvedCommand,
} from "../engine/bridge-codex-command.js";

describe("unwrapNpmCmdShim", () => {
  const createdFiles: string[] = [];

  function createTempCmd(content: string, scriptExists = true): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-cmd-test-"));
    const cmdPath = path.join(dir, "codex.cmd");
    fs.writeFileSync(cmdPath, content, "utf-8");

    if (scriptExists) {
      const scriptDir = path.join(
        dir,
        "node_modules",
        "@openai",
        "codex",
        "bin",
      );
      fs.mkdirSync(scriptDir, { recursive: true });
      fs.writeFileSync(path.join(scriptDir, "codex.js"), "// stub", "utf-8");
    }

    createdFiles.push(dir);
    return cmdPath;
  }

  it("parses a standard npm .cmd shim", () => {
    const cmdPath = createTempCmd(
      [
        "@ECHO off",
        "GOTO start",
        ":find_dp0",
        "SET dp0=%~dp0",
        "EXIT /b",
        ":start",
        "SETLOCAL",
        "CALL :find_dp0",
        "",
        'IF EXIST "%dp0%\\node.exe" (',
        '  SET "_prog=%dp0%\\node.exe"',
        ") ELSE (",
        '  SET "_prog=node"',
        "  SET PATHEXT=%PATHEXT:;.JS;=;%",
        ")",
        "",
        'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
      ].join("\r\n"),
    );

    const result = unwrapNpmCmdShim(cmdPath);
    expect(result).not.toBeNull();
    expect(result).toContain("\0");
    expect(result).toContain("codex.js");
  });

  it("returns null for non-npm shim format", () => {
    const cmdPath = createTempCmd("@echo hello world\r\n");
    expect(unwrapNpmCmdShim(cmdPath)).toBeNull();
  });

  it("returns null when script file does not exist", () => {
    const cmdPath = createTempCmd(
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\missing\\script.js" %*\r\n',
      false,
    );
    expect(unwrapNpmCmdShim(cmdPath)).toBeNull();
  });

  it("returns null for nonexistent .cmd file", () => {
    expect(unwrapNpmCmdShim("/nonexistent/codex.cmd")).toBeNull();
  });
});

describe("splitResolvedCommand", () => {
  it("splits NUL-separated command into command + prefixArgs", () => {
    const result = splitResolvedCommand("node\0C:\\path\\to\\codex.js");
    expect(result.command).toBe("node");
    expect(result.prefixArgs).toEqual(["C:\\path\\to\\codex.js"]);
  });

  it("returns original command with empty prefixArgs when no NUL", () => {
    const result = splitResolvedCommand("codex.exe");
    expect(result.command).toBe("codex.exe");
    expect(result.prefixArgs).toEqual([]);
  });

  it("handles paths with spaces", () => {
    const result = splitResolvedCommand(
      "C:\\Program Files\\node.exe\0C:\\Users\\test\\codex.js",
    );
    expect(result.command).toBe("C:\\Program Files\\node.exe");
    expect(result.prefixArgs).toEqual(["C:\\Users\\test\\codex.js"]);
  });
});

describe("resolvePackagedBridgeAsset", () => {
  it("finds bridge assets in an ancestor monorepo dist from a worktree repoRoot", () => {
    const workspaceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "tap-bridge-asset-test-"),
    );

    try {
      const repoRoot = path.join(workspaceDir, ".tmp", "wt-2");
      const assetPath = path.join(
        workspaceDir,
        "packages",
        "tap-comms",
        "dist",
        "bridges",
        "codex-bridge-runner.mjs",
      );
      fs.mkdirSync(path.dirname(assetPath), { recursive: true });
      fs.writeFileSync(assetPath, "// stub", "utf-8");

      const resolved = resolvePackagedBridgeAsset(
        repoRoot,
        "codex-bridge-runner.mjs",
        "file:///D:/repo/packages/tap-comms/src/engine/bridge-codex-command.ts",
      );

      expect(resolved).toBe(assetPath);
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("falls back to the installed npm package dist when present", () => {
    const workspaceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "tap-bridge-package-test-"),
    );

    try {
      const repoRoot = path.join(workspaceDir, "repos", "project");
      const assetPath = path.join(
        workspaceDir,
        "node_modules",
        "@hua-labs",
        "tap",
        "dist",
        "bridges",
        "codex-app-server-auth-gateway.mjs",
      );
      fs.mkdirSync(path.dirname(assetPath), { recursive: true });
      fs.writeFileSync(assetPath, "// stub", "utf-8");

      const resolved = resolvePackagedBridgeAsset(
        repoRoot,
        "codex-app-server-auth-gateway.mjs",
        "file:///D:/repo/packages/tap-comms/src/engine/bridge-codex-command.ts",
      );

      expect(resolved).toBe(assetPath);
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });
});
