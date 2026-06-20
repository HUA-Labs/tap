import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const packageJsonPath = fileURLToPath(
  new URL("../../package.json", import.meta.url),
);

describe("package metadata", () => {
  it("keeps stable Windows-friendly bin aliases", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, "utf-8"),
    ) as {
      bin?: Record<string, unknown>;
    };

    expect(packageJson.bin?.tap).toBe("bin/tap.mjs");
    expect(packageJson.bin?.["tap-comms"]).toBe("bin/tap.mjs");
  });

  it("declares no-move Codex standalone subpath exports", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, "utf-8"),
    ) as {
      exports?: Record<string, { types?: string; import?: string }>;
    };

    expect(packageJson.exports?.["./codex-a2a"]).toMatchObject({
      types: "./dist/codex-a2a/index.d.mts",
      import: "./dist/codex-a2a/index.mjs",
    });
    expect(packageJson.exports?.["./codex-ipc"]).toMatchObject({
      types: "./dist/codex-ipc/index.d.mts",
      import: "./dist/codex-ipc/index.mjs",
    });
    expect(packageJson.exports?.["./codex-health"]).toMatchObject({
      types: "./dist/codex-health/index.d.mts",
      import: "./dist/codex-health/index.mjs",
    });
  });
});
