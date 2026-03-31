import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const packageJsonPath = fileURLToPath(
  new URL("../../package.json", import.meta.url),
);

describe("package metadata", () => {
  it("keeps stable Windows-friendly bin aliases", () => {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as {
      bin?: Record<string, unknown>;
    };

    expect(packageJson.bin?.tap).toBe("bin/tap.mjs");
    expect(packageJson.bin?.["tap-comms"]).toBe("bin/tap.mjs");
  });
});
