import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  resolveLocalProjectionStatePath,
  runLocalProjection,
} from "../projection/local-receiver-projection.js";
import {
  mirrorRemoteProjectionTarget,
  pushRemoteProjectionTarget,
} from "../projection/remote-projection-target.js";
import { projectionCommand } from "../commands/projection.js";

function makeRoot(): {
  root: string;
  sourceCommsDir: string;
  targetCommsDir: string;
  stateDir: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tap-projection-"));
  const sourceCommsDir = path.join(root, "sum-back");
  const targetCommsDir = path.join(root, "local");
  const stateDir = path.join(root, ".tap-comms");
  fs.mkdirSync(path.join(sourceCommsDir, "inbox"), { recursive: true });
  fs.mkdirSync(path.join(targetCommsDir, "inbox"), { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  return { root, sourceCommsDir, targetCommsDir, stateDir };
}

function writeSource(
  sourceCommsDir: string,
  relativePath: string,
  content: string,
  mtime: Date,
): void {
  const filePath = path.join(sourceCommsDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  fs.utimesSync(filePath, mtime, mtime);
}

describe("local receiver projection", () => {
  it("dry-runs central inbox projection without writing target files or cursor", async () => {
    const { root, sourceCommsDir, targetCommsDir, stateDir } = makeRoot();
    try {
      writeSource(
        sourceCommsDir,
        "inbox/20260602-yoon-jun-projection.md",
        "From: 윤\nTo: 준\nSubject: projection\n\nhello",
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await runLocalProjection({
        mode: "check",
        sourceCommsDir,
        targetCommsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        now: new Date("2026-06-02T00:10:02.000Z"),
      });

      expect(result.status).toBe("pending");
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        relativePath: "inbox/20260602-yoon-jun-projection.md",
        from: "윤",
        to: "준",
        subject: "projection",
        projected: false,
        skipReason: "dry-run",
      });
      expect(result.stateWritten).toBe(false);
      expect(fs.existsSync(result.items[0].targetPath)).toBe(false);
      expect(fs.existsSync(result.statePath)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("applies central inbox projection into a local inbox path", async () => {
    const { root, sourceCommsDir, targetCommsDir, stateDir } = makeRoot();
    try {
      writeSource(
        sourceCommsDir,
        "inbox/20260602-yoon-jun-apply.md",
        [
          "---",
          "message_id: msg-apply",
          "from: codex",
          "from_name: 윤",
          "to: 준",
          "subject: apply",
          "---",
          "",
          "apply body",
        ].join("\n"),
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await runLocalProjection({
        mode: "apply",
        sourceCommsDir,
        targetCommsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        now: new Date("2026-06-02T00:10:02.000Z"),
      });
      const targetPath = path.join(
        targetCommsDir,
        "inbox",
        "20260602-yoon-jun-apply.md",
      );

      expect(result.status).toBe("projected");
      expect(result.items[0]).toMatchObject({
        projected: true,
        skipReason: null,
        messageId: "msg-apply",
      });
      expect(fs.readFileSync(targetPath, "utf8")).toContain("apply body");
      expect(fs.existsSync(result.statePath)).toBe(true);
      expect(
        JSON.parse(fs.readFileSync(result.statePath, "utf8")).projected[
          "msg-apply"
        ],
      ).toMatchObject({
        relativePath: "inbox/20260602-yoon-jun-apply.md",
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not project duplicate records repeatedly", async () => {
    const { root, sourceCommsDir, targetCommsDir, stateDir } = makeRoot();
    try {
      writeSource(
        sourceCommsDir,
        "inbox/20260602-yoon-jun-duplicate.md",
        "Message-Id: msg-duplicate\nFrom: 윤\nTo: 준\nSubject: duplicate\n\nfirst",
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const first = await runLocalProjection({
        mode: "apply",
        sourceCommsDir,
        targetCommsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        now: new Date("2026-06-02T00:10:02.000Z"),
      });
      const second = await runLocalProjection({
        mode: "apply",
        sourceCommsDir,
        targetCommsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        now: new Date("2026-06-02T00:10:03.000Z"),
      });

      expect(first.items).toHaveLength(1);
      expect(second.items).toHaveLength(0);
      expect(second.skipped.duplicate).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("bounds historical replay by the fresh cursor by default", async () => {
    const { root, sourceCommsDir, targetCommsDir, stateDir } = makeRoot();
    try {
      writeSource(
        sourceCommsDir,
        "inbox/20260602-yoon-jun-old.md",
        "From: 윤\nTo: 준\nSubject: old\n\nold",
        new Date("2026-06-02T00:00:00.000Z"),
      );

      const result = await runLocalProjection({
        mode: "apply",
        sourceCommsDir,
        targetCommsDir,
        stateDir,
        agent: "준",
        now: new Date("2026-06-02T00:10:00.000Z"),
      });

      expect(result.items).toHaveLength(0);
      expect(result.skipped.old).toBe(1);
      expect(result.stateWritten).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects mutable runtime state by only accepting append-only dirs", async () => {
    const { root, sourceCommsDir, targetCommsDir, stateDir } = makeRoot();
    try {
      writeSource(
        sourceCommsDir,
        "heartbeats.json",
        '{"준":{"agent":"준"}}',
        new Date("2026-06-02T00:10:01.000Z"),
      );
      writeSource(
        sourceCommsDir,
        "inbox/20260602-yoon-jun-safe.md",
        "From: 윤\nTo: 준\nSubject: safe\n\nsafe",
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await runLocalProjection({
        mode: "apply",
        sourceCommsDir,
        targetCommsDir,
        stateDir,
        agent: "준",
        dirs: ["heartbeats" as never, "inbox"],
        since: "2026-06-02T00:10:00.000Z",
        now: new Date("2026-06-02T00:10:02.000Z"),
      });

      expect(result.warnings.join("\n")).toContain(
        "disallowed projection dir(s); only append-only dirs are supported.",
      );
      expect(fs.existsSync(path.join(targetCommsDir, "heartbeats.json"))).toBe(
        false,
      );
      expect(
        fs.existsSync(
          path.join(targetCommsDir, "inbox", "20260602-yoon-jun-safe.md"),
        ),
      ).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not project unaddressed inbox records by default", async () => {
    const { root, sourceCommsDir, targetCommsDir, stateDir } = makeRoot();
    try {
      writeSource(
        sourceCommsDir,
        "inbox/manual-orphan.md",
        "Subject: orphan\n\norphan body",
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await runLocalProjection({
        mode: "check",
        sourceCommsDir,
        targetCommsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        now: new Date("2026-06-02T00:10:02.000Z"),
      });

      expect(result.status).toBe("idle");
      expect(result.items).toHaveLength(0);
      expect(result.skipped.notForAgent).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("can include all addressed-dir targets when explicitly requested", async () => {
    const { root, sourceCommsDir, targetCommsDir, stateDir } = makeRoot();
    try {
      writeSource(
        sourceCommsDir,
        "inbox/manual-orphan.md",
        "Subject: orphan\n\norphan body",
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await runLocalProjection({
        mode: "check",
        sourceCommsDir,
        targetCommsDir,
        stateDir,
        agent: "준",
        includeAllTargets: true,
        since: "2026-06-02T00:10:00.000Z",
        now: new Date("2026-06-02T00:10:02.000Z"),
      });

      expect(result.status).toBe("pending");
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        relativePath: "inbox/manual-orphan.md",
        to: null,
        skipReason: "dry-run",
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows explicitly selected unaddressed non-inbox append-only records", async () => {
    const { root, sourceCommsDir, targetCommsDir, stateDir } = makeRoot();
    try {
      writeSource(
        sourceCommsDir,
        "findings/20260602-jun-finding.md",
        "# Finding\n\nfinding body",
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await runLocalProjection({
        mode: "apply",
        sourceCommsDir,
        targetCommsDir,
        stateDir,
        agent: "준",
        dirs: ["findings"],
        since: "2026-06-02T00:10:00.000Z",
        now: new Date("2026-06-02T00:10:02.000Z"),
      });

      expect(result.status).toBe("projected");
      expect(result.items).toHaveLength(1);
      expect(
        fs.readFileSync(
          path.join(targetCommsDir, "findings", "20260602-jun-finding.md"),
          "utf8",
        ),
      ).toContain("finding body");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("exposes a projection command for operator use", async () => {
    const { root, sourceCommsDir, targetCommsDir } = makeRoot();
    const originalCwd = process.cwd();
    try {
      fs.writeFileSync(path.join(root, "package.json"), "{}", "utf8");
      process.chdir(root);
      writeSource(
        sourceCommsDir,
        "inbox/20260602-yoon-jun-command.md",
        "From: 윤\nTo: 준\nSubject: command\n\ncommand body",
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await projectionCommand([
        "apply",
        "--agent",
        "준",
        "--source-comms-dir",
        sourceCommsDir,
        "--target-comms-dir",
        targetCommsDir,
        "--since",
        "2026-06-02T00:10:00.000Z",
      ]);

      expect(result.ok).toBe(true);
      expect(result.command).toBe("projection");
      expect(result.code).toBe("TAP_PROJECTION_OK");
      expect(result.data).toMatchObject({
        adapter: "local-projection",
        receiveTransport: "polling",
        status: "projected",
      });
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("can mirror and push a remote projection target with rsync", () => {
    const { root } = makeRoot();
    const calls: Array<{ command: string; args: string[] }> = [];
    try {
      const mirror = mirrorRemoteProjectionTarget({
        sshTarget: "sum-mac",
        remoteCommsDir: "/Users/devin/HUA/hua-comms",
        localMirrorDir: path.join(root, "mirror"),
        dirs: ["inbox"],
        runner: (command, args) => {
          calls.push({ command, args });
          return {
            status: 0,
            stdout: ".d..t...... ./\n>f+++++++++ existing.md\n",
            stderr: "",
          };
        },
      });
      const push = pushRemoteProjectionTarget({
        sshTarget: "sum-mac",
        remoteCommsDir: "/Users/devin/HUA/hua-comms",
        localMirrorDir: path.join(root, "mirror"),
        dirs: ["inbox"],
        runner: (command, args) => {
          calls.push({ command, args });
          return {
            status: 0,
            stdout: "<f+++++++++ projected.md\n",
            stderr: "",
          };
        },
      });

      expect(calls).toHaveLength(2);
      expect(calls[0]).toMatchObject({
        command: "rsync",
        args: expect.arrayContaining([
          "--ignore-existing",
          "sum-mac:/Users/devin/HUA/hua-comms/inbox/",
        ]),
      });
      expect(calls[1]).toMatchObject({
        command: "rsync",
        args: expect.arrayContaining([
          "--ignore-existing",
          "sum-mac:/Users/devin/HUA/hua-comms/inbox/",
        ]),
      });
      expect(mirror[0]).toMatchObject({ dir: "inbox", changed: 1 });
      expect(push[0]).toMatchObject({ dir: "inbox", changed: 1 });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("pushes only projected files from a reused remote projection mirror", () => {
    const { root } = makeRoot();
    const mirrorDir = path.join(root, "mirror");
    const pushedSources: string[][] = [];
    try {
      fs.mkdirSync(path.join(mirrorDir, "inbox"), { recursive: true });
      fs.writeFileSync(
        path.join(mirrorDir, "inbox", "projected.md"),
        "projected",
        "utf8",
      );
      fs.writeFileSync(
        path.join(mirrorDir, "inbox", "stale-unfiltered.md"),
        "stale",
        "utf8",
      );

      const records = pushRemoteProjectionTarget({
        sshTarget: "sum-mac",
        remoteCommsDir: "/Users/devin/HUA/hua-comms",
        localMirrorDir: mirrorDir,
        dirs: ["inbox"],
        files: [{ dir: "inbox", filename: "projected.md" }],
        runner: (_command, args) => {
          const source = args.at(-2);
          expect(source).toBeTruthy();
          pushedSources.push(fs.readdirSync(source as string).sort());
          return {
            status: 0,
            stdout: "<f+++++++++ projected.md\n",
            stderr: "",
          };
        },
      });

      expect(records[0]).toMatchObject({ dir: "inbox", changed: 1 });
      expect(pushedSources).toEqual([["projected.md"]]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refreshes a remote projection target before scan and pushes before writing state", async () => {
    const { root, sourceCommsDir, stateDir } = makeRoot();
    const mirrorDir = path.join(root, "remote-target-mirror");
    const calls: string[] = [];
    try {
      writeSource(
        sourceCommsDir,
        "inbox/20260602-yoon-jun-remote-target.md",
        [
          "---",
          "message_id: msg-remote-target",
          "from: codex",
          "from_name: 윤",
          "to: 준",
          "subject: remote-target",
          "---",
          "",
          "remote target body",
        ].join("\n"),
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await runLocalProjection({
        mode: "apply",
        sourceCommsDir,
        targetCommsDir: mirrorDir,
        targetCommsDirLabel: "sum-mac:/Users/devin/HUA/hua-comms",
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        now: new Date("2026-06-02T00:10:02.000Z"),
        beforeScan: () => {
          calls.push("mirror");
          fs.mkdirSync(path.join(mirrorDir, "inbox"), { recursive: true });
        },
        afterApply: (items) => {
          calls.push(`push:${items[0]?.filename}`);
          expect(
            fs.existsSync(
              path.join(
                mirrorDir,
                "inbox",
                "20260602-yoon-jun-remote-target.md",
              ),
            ),
          ).toBe(true);
        },
      });

      expect(calls).toEqual([
        "mirror",
        "push:20260602-yoon-jun-remote-target.md",
      ]);
      expect(result.status).toBe("projected");
      expect(result.targetCommsDir).toBe("sum-mac:/Users/devin/HUA/hua-comms");
      expect(
        JSON.parse(fs.readFileSync(result.statePath, "utf8")).targetCommsDir,
      ).toBe("sum-mac:/Users/devin/HUA/hua-comms");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("exposes remote target projection through the tap CLI command", async () => {
    const { root, sourceCommsDir } = makeRoot();
    const originalCwd = process.cwd();
    const originalPath = process.env.PATH;
    const mirrorDir = path.join(root, "cli-remote-target");
    try {
      fs.writeFileSync(path.join(root, "package.json"), "{}", "utf8");
      const fakeBinDir = path.join(root, "bin");
      fs.mkdirSync(fakeBinDir, { recursive: true });
      const fakeRsync = path.join(fakeBinDir, "rsync");
      fs.writeFileSync(
        fakeRsync,
        [
          "#!/bin/sh",
          'last=""',
          'for arg in "$@"; do last="$arg"; done',
          'case "$last" in',
          "  *:*) ;;",
          '  *) mkdir -p "$last" ;;',
          "esac",
          "printf '.d..t...... ./\\n'",
        ].join("\n"),
        "utf8",
      );
      fs.chmodSync(fakeRsync, 0o755);
      process.env.PATH = `${fakeBinDir}${path.delimiter}${originalPath ?? ""}`;
      process.chdir(root);
      writeSource(
        sourceCommsDir,
        "inbox/20260602-yoon-jun-remote-command.md",
        "From: 윤\nTo: 준\nSubject: remote-command\n\ncommand body",
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await projectionCommand([
        "apply",
        "--agent",
        "준",
        "--source-comms-dir",
        sourceCommsDir,
        "--target-ssh",
        "sum-mac",
        "--target-comms-dir",
        "/Users/devin/HUA/hua-comms",
        "--dir",
        "heartbeats",
        "--mirror-dir",
        mirrorDir,
        "--keep-mirror",
        "--since",
        "2026-06-02T00:10:00.000Z",
      ]);

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        adapter: "local-projection",
        targetCommsDir: "sum-mac:/Users/devin/HUA/hua-comms",
        status: "projected",
        remoteTarget: {
          sshTarget: "sum-mac",
          commsDir: "/Users/devin/HUA/hua-comms",
          mirrorRecords: [{ dir: "inbox" }],
          pushRecords: [{ dir: "inbox" }],
        },
      });
      expect(result.warnings.join("\n")).toContain(
        "disallowed projection dir(s); only append-only dirs are supported.",
      );
    } finally {
      process.env.PATH = originalPath;
      process.chdir(originalCwd);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps projection cursor state outside both comms directories", () => {
    const { root, sourceCommsDir, targetCommsDir, stateDir } = makeRoot();
    try {
      const statePath = resolveLocalProjectionStatePath({
        stateDir,
        agent: "준",
      });

      expect(statePath.startsWith(path.join(stateDir, "projection"))).toBe(
        true,
      );
      expect(statePath.startsWith(sourceCommsDir)).toBe(false);
      expect(statePath.startsWith(targetCommsDir)).toBe(false);
      expect(path.basename(statePath)).toBe("local-projection-준.json");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
