import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { resolvePackageVersion } from "../version.js";

describe("resolvePackageVersion", () => {
  it("reads the sibling package.json for source modules", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-version-test-"));

    try {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ version: "1.2.3" }),
        "utf-8",
      );
      fs.writeFileSync(path.join(tmpDir, "src", "version.ts"), "", "utf-8");

      const version = resolvePackageVersion(
        pathToFileURL(path.join(tmpDir, "src", "version.ts")).href,
      );

      expect(version).toBe("1.2.3");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("falls back when package.json is missing or invalid", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-version-test-"));

    try {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "version.ts"), "", "utf-8");

      const missing = resolvePackageVersion(
        pathToFileURL(path.join(tmpDir, "src", "version.ts")).href,
      );
      expect(missing).toBe("0.0.0");

      fs.writeFileSync(path.join(tmpDir, "package.json"), "{", "utf-8");

      const invalid = resolvePackageVersion(
        pathToFileURL(path.join(tmpDir, "src", "version.ts")).href,
      );
      expect(invalid).toBe("0.0.0");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
