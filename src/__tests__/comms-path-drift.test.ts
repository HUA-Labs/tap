import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { detectCommsPathDrift } from "../config/comms-path-drift.js";

let tmpDir: string;
let tmpHome: string;
let originalHome: string | undefined;
let originalCodexHome: string | undefined;

function normalize(p: string): string {
  return path.resolve(p).replace(/\\/g, "/");
}

function writeMcpJson(repoRoot: string, commsDir: string | null): void {
  const content = commsDir
    ? {
        mcpServers: {
          tap: {
            command: "node",
            args: ["unused"],
            env: { TAP_COMMS_DIR: commsDir },
          },
        },
      }
    : { mcpServers: { tap: { command: "node", args: [] } } };
  fs.writeFileSync(
    path.join(repoRoot, ".mcp.json"),
    JSON.stringify(content, null, 2),
    "utf-8",
  );
}

function writeTapConfigJson(repoRoot: string, commsDir: string | null): void {
  const content = commsDir ? { commsDir } : {};
  fs.writeFileSync(
    path.join(repoRoot, "tap-config.json"),
    JSON.stringify(content, null, 2),
    "utf-8",
  );
}

function writeStateJson(
  repoRoot: string,
  stateDir: string,
  commsDir: string | null,
): void {
  fs.mkdirSync(stateDir, { recursive: true });
  const content = commsDir
    ? {
        schemaVersion: 3,
        commsDir,
        repoRoot,
        createdAt: "2026-04-23T00:00:00.000Z",
        updatedAt: "2026-04-23T00:00:00.000Z",
        packageVersion: "0.0.0",
        instances: {},
      }
    : { schemaVersion: 3, instances: {} };
  fs.writeFileSync(
    path.join(stateDir, "state.json"),
    JSON.stringify(content, null, 2),
    "utf-8",
  );
}

function writeCodexConfigToml(homeDir: string, commsDir: string | null): void {
  const codexDir = path.join(homeDir, ".codex");
  fs.mkdirSync(codexDir, { recursive: true });
  const content = commsDir
    ? `[mcp_servers.tap.env]\nTAP_COMMS_DIR = "${commsDir}"\n`
    : "";
  fs.writeFileSync(path.join(codexDir, "config.toml"), content, "utf-8");
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "m361-drift-"));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "m361-home-"));
  originalHome = process.env.HOME;
  originalCodexHome = process.env.CODEX_HOME;
  // os.homedir() reads HOME on Unix and USERPROFILE on Windows; set both.
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  // Clear CODEX_HOME so default tests land under tmpHome/.codex rather than
  // leaking onto the developer's real ~/.codex. The one case that needs the
  // override sets it explicitly.
  delete process.env.CODEX_HOME;
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  if (originalCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = originalCodexHome;
  }
  // USERPROFILE restore left best-effort — tests don't rely on it across runs.
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("detectCommsPathDrift", () => {
  it("returns empty status when no source has commsDir", () => {
    const result = detectCommsPathDrift(tmpDir);
    expect(result.status).toBe("empty");
    expect(result.effective).toBeNull();
    expect(result.mismatches).toEqual([]);
  });

  it("returns ok when all present sources agree", () => {
    const target = path.join(tmpDir, "hua-comms");
    fs.mkdirSync(target);
    writeMcpJson(tmpDir, target);
    writeTapConfigJson(tmpDir, target);
    writeCodexConfigToml(tmpHome, target);
    writeStateJson(tmpDir, path.join(tmpDir, ".tap-comms"), target);

    const result = detectCommsPathDrift(tmpDir);
    expect(result.status).toBe("ok");
    expect(result.effective).toBe(normalize(target));
    expect(result.mismatches).toEqual([]);
  });

  it("returns ok when only a subset of sources are present but consistent", () => {
    const target = path.join(tmpDir, "hua-comms");
    fs.mkdirSync(target);
    writeMcpJson(tmpDir, target);
    writeTapConfigJson(tmpDir, target);
    // state.json and codex config intentionally omitted

    const result = detectCommsPathDrift(tmpDir);
    expect(result.status).toBe("ok");
    expect(result.effective).toBe(normalize(target));
  });

  it("flags drift when sources resolve to different paths", () => {
    const primary = path.join(tmpDir, "hua-comms");
    const legacy = path.join(tmpDir, "legacy-comms");
    writeMcpJson(tmpDir, primary);
    writeTapConfigJson(tmpDir, primary);
    writeCodexConfigToml(tmpHome, legacy);

    const result = detectCommsPathDrift(tmpDir);
    expect(result.status).toBe("drifted");
    expect(result.effective).toBe(normalize(primary));
    expect(result.mismatches.some((m) => m.includes("codex-config.toml"))).toBe(
      true,
    );
  });

  it("resolves relative paths against repoRoot", () => {
    const target = path.join(tmpDir, "hua-comms");
    fs.mkdirSync(target);
    writeMcpJson(tmpDir, "./hua-comms");
    writeTapConfigJson(tmpDir, "./hua-comms");

    const result = detectCommsPathDrift(tmpDir);
    expect(result.status).toBe("ok");
    expect(result.effective).toBe(normalize(target));
  });

  it("reports missing source files explicitly in mismatches", () => {
    const primary = path.join(tmpDir, "hua-comms");
    const other = path.join(tmpDir, "other-comms");
    writeMcpJson(tmpDir, primary);
    writeTapConfigJson(tmpDir, other);

    const result = detectCommsPathDrift(tmpDir);
    expect(result.status).toBe("drifted");
    const mismatchText = result.mismatches.join("\n");
    expect(mismatchText).toContain("codex-config.toml missing");
    expect(mismatchText).toContain("state.json missing");
  });

  it("resolves codex-config.toml through CODEX_HOME override (PR #1161 P2)", () => {
    const primary = path.join(tmpDir, "hua-comms");
    fs.mkdirSync(primary);
    writeMcpJson(tmpDir, primary);
    writeTapConfigJson(tmpDir, primary);

    // CODEX_HOME layout: <codexHome>/config.toml directly (no .codex subdir).
    const codexHome = path.join(tmpDir, "isolated-codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      `[mcp_servers.tap.env]\nTAP_COMMS_DIR = "${primary}"\n`,
      "utf-8",
    );
    process.env.CODEX_HOME = codexHome;

    const result = detectCommsPathDrift(tmpDir);
    expect(result.status).toBe("ok");
    const codexSource = result.sources.find(
      (s) => s.name === "codex-config.toml",
    );
    expect(codexSource?.filePath).toBe(path.join(codexHome, "config.toml"));
    expect(codexSource?.raw).toBe(primary);
  });

  it("flags drift based on the CODEX_HOME config when it disagrees", () => {
    const primary = path.join(tmpDir, "hua-comms");
    const legacy = path.join(tmpDir, "legacy-comms");
    writeMcpJson(tmpDir, primary);
    writeTapConfigJson(tmpDir, primary);

    const codexHome = path.join(tmpDir, "isolated-codex-home");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      `[mcp_servers.tap.env]\nTAP_COMMS_DIR = "${legacy}"\n`,
      "utf-8",
    );
    process.env.CODEX_HOME = codexHome;

    const result = detectCommsPathDrift(tmpDir);
    expect(result.status).toBe("drifted");
    expect(
      result.mismatches.some((m) => m.includes("codex-config.toml")),
    ).toBe(true);
  });
});
