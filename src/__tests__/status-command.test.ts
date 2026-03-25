import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { statusCommand } from "../commands/status.js";
import { version } from "../version.js";

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-status-test-"));
  fs.writeFileSync(path.join(tmpDir, "package.json"), "{}", "utf-8");
  fs.mkdirSync(path.join(tmpDir, ".tap-comms"), { recursive: true });

  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("statusCommand", () => {
  it("reports the current package version instead of stale state metadata", async () => {
    const state = {
      schemaVersion: 2,
      createdAt: "2026-03-24T00:00:00.000Z",
      updatedAt: "2026-03-24T00:00:00.000Z",
      commsDir: path.join(tmpDir, "tap-comms"),
      repoRoot: tmpDir,
      packageVersion: "stale-version",
      instances: {},
    };

    fs.writeFileSync(
      path.join(tmpDir, ".tap-comms", "state.json"),
      JSON.stringify(state, null, 2),
      "utf-8",
    );

    vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await statusCommand([]);

    expect(result.ok).toBe(true);
    expect(result.data).toHaveProperty("version", version);
  });
});
