import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
  findBundledTapCommsSource,
  findTapCommsServerEntry,
} from "../adapters/common.js";
import type { AdapterContext } from "../types.js";

function makeContext(repoRoot: string): AdapterContext {
  return {
    commsDir: path.join(repoRoot, "tap-comms"),
    repoRoot,
    stateDir: path.join(repoRoot, ".tap-comms"),
    platform: process.platform === "win32" ? "win32" : "linux",
  };
}

describe("tap MCP server entry resolution", () => {
  it("prefers the bundled mcp-server entry when present", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-server-test-"));

    try {
      const distDir = path.join(tmpDir, "dist");
      fs.mkdirSync(distDir, { recursive: true });
      fs.writeFileSync(path.join(distDir, "cli.mjs"), "", "utf-8");
      fs.writeFileSync(path.join(distDir, "mcp-server.mjs"), "", "utf-8");

      const repoEntry = path.join(
        tmpDir,
        "packages",
        "tap-plugin",
        "channels",
        "tap-comms.ts",
      );
      fs.mkdirSync(path.dirname(repoEntry), { recursive: true });
      fs.writeFileSync(repoEntry, "", "utf-8");

      const resolved = findTapCommsServerEntry(
        makeContext(tmpDir),
        pathToFileURL(path.join(distDir, "cli.mjs")).href,
      );

      expect(resolved).toBe(path.join(distDir, "mcp-server.mjs"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("finds the source mcp-server entry in an unbuilt checkout", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-server-test-"));

    try {
      const adaptersDir = path.join(tmpDir, "src", "adapters");
      fs.mkdirSync(adaptersDir, { recursive: true });
      fs.writeFileSync(path.join(adaptersDir, "common.ts"), "", "utf-8");
      fs.writeFileSync(path.join(tmpDir, "src", "mcp-server.ts"), "", "utf-8");

      const bundled = findBundledTapCommsSource(
        pathToFileURL(path.join(adaptersDir, "common.ts")).href,
      );

      expect(bundled).toBe(path.join(tmpDir, "src", "mcp-server.ts"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("falls back to the repo-local tap-plugin entry when no bundled entry exists", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-server-test-"));

    try {
      const repoEntry = path.join(
        tmpDir,
        "packages",
        "tap-plugin",
        "channels",
        "tap-comms.ts",
      );
      fs.mkdirSync(path.dirname(repoEntry), { recursive: true });
      fs.writeFileSync(repoEntry, "", "utf-8");

      const fakeCli = path.join(tmpDir, "dist", "cli.mjs");
      fs.mkdirSync(path.dirname(fakeCli), { recursive: true });
      fs.writeFileSync(fakeCli, "", "utf-8");

      const resolved = findTapCommsServerEntry(
        makeContext(tmpDir),
        pathToFileURL(fakeCli).href,
      );

      expect(resolved).toBe(repoEntry);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
