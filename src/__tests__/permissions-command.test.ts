import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  __setPermissionsReloadProfileApplierForTests,
  permissionsCommand,
} from "../commands/permissions.js";

let tmpDir: string;
let originalCwd: string;
const originalCodexHome = process.env.CODEX_HOME;

function writeManagedBackup(content: string): string {
  const backupDir = path.join(tmpDir, ".tap-comms", "backups", "codex");
  const backupPath = path.join(backupDir, "config.toml.abc123.bak");
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(backupPath, content, "utf8");
  return backupPath;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-permissions-command-"));
  fs.writeFileSync(path.join(tmpDir, "package.json"), "{}", "utf8");
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  __setPermissionsReloadProfileApplierForTests(null);
  vi.restoreAllMocks();
  if (originalCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = originalCodexHome;
  }
});

describe("permissionsCommand", () => {
  it("dry-runs restoring a tap-managed Codex config backup", async () => {
    const backupPath = writeManagedBackup(
      '[sandbox]\nmode = "workspace-write"\n',
    );
    const codexHome = path.join(tmpDir, "codex-home");
    const targetPath = path.join(codexHome, "config.toml");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(targetPath, '[sandbox]\nmode = "danger-full-access"\n');
    process.env.CODEX_HOME = codexHome;

    const result = await permissionsCommand([
      "restore",
      "--backup",
      backupPath,
    ]);

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_PERMISSIONS_RESTORE_OK");
    expect(result.data).toMatchObject({
      mode: "dry-run",
      backupPath,
      targetPath,
      restored: false,
      preRestoreBackupPath: null,
      runtimeReloadRequired: false,
      profile: null,
      reloadProfile: null,
      reloadProfileAction: null,
      nextActions: [],
    });
    expect(fs.readFileSync(targetPath, "utf8")).toContain(
      'mode = "danger-full-access"',
    );
  });

  it("previews an explicit reload profile without restoring or applying it during dry-run", async () => {
    const backupPath = writeManagedBackup(
      '[sandbox]\nmode = "danger-full-access"\n',
    );
    const codexHome = path.join(tmpDir, "codex-home");
    const targetPath = path.join(codexHome, "config.toml");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(targetPath, '[sandbox]\nmode = "workspace-write"\n');
    process.env.CODEX_HOME = codexHome;
    const reloadRunner = vi.fn();
    __setPermissionsReloadProfileApplierForTests(reloadRunner);

    const result = await permissionsCommand([
      "restore",
      "--backup",
      backupPath,
      "--reload-profile",
      "sumback-yoon-appserver",
    ]);

    expect(result.ok).toBe(true);
    expect(reloadRunner).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({
      mode: "dry-run",
      restored: false,
      runtimeReloadRequired: false,
      reloadProfile: "sumback-yoon-appserver",
      reloadProfileAction: {
        profile: "sumback-yoon-appserver",
        status: "would-apply",
        command: "tap ready --profile sumback-yoon-appserver --apply --json",
      },
    });
    expect(fs.readFileSync(targetPath, "utf8")).toContain(
      'mode = "workspace-write"',
    );
  });

  it("applies a restore and backs up the current target first", async () => {
    const backupPath = writeManagedBackup(
      '[sandbox]\nmode = "workspace-write"\n',
    );
    const codexHome = path.join(tmpDir, "codex-home");
    const targetPath = path.join(codexHome, "config.toml");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(targetPath, '[sandbox]\nmode = "danger-full-access"\n');
    process.env.CODEX_HOME = codexHome;

    const result = await permissionsCommand([
      "restore",
      "--backup",
      backupPath,
      "--profile",
      "sumback-yoon",
      "--apply",
    ]);

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_PERMISSIONS_RESTORE_OK");
    const data = result.data as {
      restored: boolean;
      preRestoreBackupPath: string;
      runtimeReloadRequired: boolean;
      profile: string;
      nextActions: Array<{ label: string; command: string }>;
    };
    expect(data.restored).toBe(true);
    expect(data.runtimeReloadRequired).toBe(true);
    expect(data.profile).toBe("sumback-yoon");
    expect(data.nextActions).toEqual([
      {
        label: "Verify Codex profile readiness",
        command: "tap ready --profile sumback-yoon --json",
      },
      {
        label: "Apply reviewed ready profile after restore",
        command: "tap ready --profile sumback-yoon --apply --json",
      },
    ]);
    expect(data.preRestoreBackupPath).toContain("config.toml.");
    expect(fs.readFileSync(data.preRestoreBackupPath, "utf8")).toContain(
      'mode = "danger-full-access"',
    );
    expect(fs.readFileSync(targetPath, "utf8")).toContain(
      'mode = "workspace-write"',
    );
  });

  it("applies an explicit reload profile only after restoring the config", async () => {
    const backupPath = writeManagedBackup(
      '[sandbox]\nmode = "danger-full-access"\n',
    );
    const codexHome = path.join(tmpDir, "codex-home");
    const targetPath = path.join(codexHome, "config.toml");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(targetPath, '[sandbox]\nmode = "workspace-write"\n');
    process.env.CODEX_HOME = codexHome;
    const reloadRunner = vi.fn(async () => {
      expect(fs.readFileSync(targetPath, "utf8")).toContain(
        'mode = "danger-full-access"',
      );
      return {
        ok: true,
        command: "ready" as const,
        code: "TAP_STATUS_OK" as const,
        message: "ready profile applied",
        warnings: [],
        data: { status: "ready" },
      };
    });
    __setPermissionsReloadProfileApplierForTests(reloadRunner);

    const result = await permissionsCommand([
      "restore",
      "--backup",
      backupPath,
      "--reload-profile",
      "sumback-yoon-appserver",
      "--apply",
    ]);

    expect(result.ok).toBe(true);
    expect(reloadRunner).toHaveBeenCalledTimes(1);
    expect(reloadRunner).toHaveBeenCalledWith("sumback-yoon-appserver", null);
    expect(result.data).toMatchObject({
      restored: true,
      runtimeReloadRequired: true,
      reloadProfile: "sumback-yoon-appserver",
      reloadProfileAction: {
        profile: "sumback-yoon-appserver",
        status: "applied",
        command: "tap ready --profile sumback-yoon-appserver --apply --json",
        resultCode: "TAP_STATUS_OK",
        resultStatus: "ready",
      },
    });
  });

  it("reports a failed reload profile as a failed restore operation after preserving restore evidence", async () => {
    const backupPath = writeManagedBackup(
      '[sandbox]\nmode = "danger-full-access"\n',
    );
    const codexHome = path.join(tmpDir, "codex-home");
    const targetPath = path.join(codexHome, "config.toml");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(targetPath, '[sandbox]\nmode = "workspace-write"\n');
    process.env.CODEX_HOME = codexHome;
    __setPermissionsReloadProfileApplierForTests(async () => ({
      ok: false,
      command: "ready" as const,
      code: "TAP_VERIFY_FAILED" as const,
      message: "readyz failed",
      warnings: ["reload warning"],
      data: { status: "not-ready" },
    }));

    const result = await permissionsCommand([
      "restore",
      "--backup",
      backupPath,
      "--reload-profile",
      "sumback-yoon-appserver",
      "--apply",
    ]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_VERIFY_FAILED");
    expect(result.warnings).toEqual(["reload warning"]);
    expect(result.data).toMatchObject({
      restored: true,
      runtimeReloadRequired: true,
      reloadProfileAction: {
        status: "failed",
        resultCode: "TAP_VERIFY_FAILED",
        resultStatus: "not-ready",
      },
    });
    expect(fs.readFileSync(targetPath, "utf8")).toContain(
      'mode = "danger-full-access"',
    );
  });

  it("treats ok ready-command results with not-ready status as reload failures", async () => {
    const backupPath = writeManagedBackup(
      '[sandbox]\nmode = "danger-full-access"\n',
    );
    const codexHome = path.join(tmpDir, "codex-home");
    const targetPath = path.join(codexHome, "config.toml");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(targetPath, '[sandbox]\nmode = "workspace-write"\n');
    process.env.CODEX_HOME = codexHome;
    __setPermissionsReloadProfileApplierForTests(async () => ({
      ok: true,
      command: "ready" as const,
      code: "TAP_READY_OK" as const,
      message: "ready profile is not ready",
      warnings: [],
      data: {
        status: "not-ready",
        apply: {
          actions: [
            {
              name: "ready-profile",
              status: "failed",
              message: "readyz failed",
            },
          ],
        },
      },
    }));

    const result = await permissionsCommand([
      "restore",
      "--backup",
      backupPath,
      "--reload-profile",
      "sumback-yoon-appserver",
      "--apply",
    ]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_VERIFY_FAILED");
    expect(result.data).toMatchObject({
      restored: true,
      runtimeReloadRequired: true,
      reloadProfileAction: {
        status: "failed",
        resultCode: "TAP_READY_OK",
        resultStatus: "not-ready",
      },
    });
    expect(fs.readFileSync(targetPath, "utf8")).toContain(
      'mode = "danger-full-access"',
    );
  });

  it("rejects backup paths outside the tap-managed Codex backup directory", async () => {
    const outsideBackup = path.join(tmpDir, "outside.bak");
    fs.writeFileSync(outsideBackup, '[sandbox]\nmode = "workspace-write"\n');

    const result = await permissionsCommand([
      "restore",
      "--backup",
      outsideBackup,
      "--apply",
    ]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_INVALID_ARGUMENT");
    expect(result.message).toContain("expected a file under");
  });

  it("rejects explicit restore targets to avoid arbitrary file overwrite", async () => {
    const backupPath = writeManagedBackup(
      '[sandbox]\nmode = "workspace-write"\n',
    );

    const result = await permissionsCommand([
      "restore",
      "--backup",
      backupPath,
      "--target",
      path.join(tmpDir, "other.toml"),
      "--apply",
    ]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_INVALID_ARGUMENT");
    expect(result.message).toContain("--target is not supported");
  });

  it("accepts local restore guidance profile ids as operator-provided labels", async () => {
    const backupPath = writeManagedBackup(
      '[sandbox]\nmode = "workspace-write"\n',
    );

    const result = await permissionsCommand([
      "restore",
      "--backup",
      backupPath,
      "--profile",
      "someone-else",
      "--apply",
    ]);

    expect(result.ok).toBe(true);
    expect(result.code).toBe("TAP_PERMISSIONS_RESTORE_OK");
    expect(result.data).toMatchObject({
      profile: "someone-else",
      runtimeReloadRequired: true,
    });
  });

  it("passes local reload profile ids through to ready and reports failures", async () => {
    const backupPath = writeManagedBackup(
      '[sandbox]\nmode = "workspace-write"\n',
    );

    const result = await permissionsCommand([
      "restore",
      "--backup",
      backupPath,
      "--reload-profile",
      "sumback-yoon",
      "--apply",
    ]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_VERIFY_FAILED");
    expect(result.message).toContain("reload profile sumback-yoon failed");
  });
});
