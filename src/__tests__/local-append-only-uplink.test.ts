import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { uplinkCommand } from "../commands/uplink.js";
import {
  resolveLocalUplinkStatePath,
  runLocalUplink,
} from "../uplink/local-append-only-uplink.js";
import { mirrorRemoteUplinkSource } from "../uplink/remote-uplink-source.js";

function makeRoot(): {
  root: string;
  sourceCommsDir: string;
  targetCommsDir: string;
  stateDir: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tap-uplink-"));
  const sourceCommsDir = path.join(root, "local");
  const targetCommsDir = path.join(root, "sum-back");
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
): string {
  const filePath = path.join(sourceCommsDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  fs.utimesSync(filePath, mtime, mtime);
  return filePath;
}

describe("local append-only uplink", () => {
  it("dry-runs local own inbox uplink without writing target files or cursor", async () => {
    const { root, sourceCommsDir, targetCommsDir, stateDir } = makeRoot();
    try {
      writeSource(
        sourceCommsDir,
        "inbox/20260602-jun-yoon-uplink.md",
        "From: 준\nTo: 윤\nSubject: uplink\n\nhello",
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await runLocalUplink({
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
        relativePath: "inbox/20260602-jun-yoon-uplink.md",
        from: "준",
        fromName: null,
        to: "윤",
        subject: "uplink",
        uploaded: false,
        skipReason: "dry-run",
      });
      expect(result.stateWritten).toBe(false);
      expect(fs.existsSync(result.items[0].targetPath)).toBe(false);
      expect(fs.existsSync(result.statePath)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("applies local own inbox records to the central target and writes cursor state", async () => {
    const { root, sourceCommsDir, targetCommsDir, stateDir } = makeRoot();
    try {
      writeSource(
        sourceCommsDir,
        "inbox/20260602-jun-yoon-apply.md",
        [
          "---",
          "message_id: msg-uplink-apply",
          "from: 준",
          "to: 윤",
          "subject: apply",
          "---",
          "",
          "apply body",
        ].join("\n"),
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await runLocalUplink({
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
        "20260602-jun-yoon-apply.md",
      );

      expect(result.status).toBe("uploaded");
      expect(result.items[0]).toMatchObject({
        uploaded: true,
        skipReason: null,
        messageId: "msg-uplink-apply",
      });
      expect(fs.readFileSync(targetPath, "utf8")).toContain("apply body");
      expect(fs.existsSync(result.statePath)).toBe(true);
      expect(
        JSON.parse(fs.readFileSync(result.statePath, "utf8")).uploaded[
          "msg-uplink-apply"
        ],
      ).toMatchObject({
        relativePath: "inbox/20260602-jun-yoon-apply.md",
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not re-upload duplicate local records", async () => {
    const { root, sourceCommsDir, targetCommsDir, stateDir } = makeRoot();
    try {
      writeSource(
        sourceCommsDir,
        "inbox/20260602-jun-yoon-duplicate.md",
        "Message-Id: msg-uplink-duplicate\nFrom: 준\nTo: 윤\nSubject: duplicate\n\nfirst",
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const first = await runLocalUplink({
        mode: "apply",
        sourceCommsDir,
        targetCommsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        now: new Date("2026-06-02T00:10:02.000Z"),
      });
      const second = await runLocalUplink({
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

  it("skips projected inbound inbox messages by default", async () => {
    const { root, sourceCommsDir, targetCommsDir, stateDir } = makeRoot();
    try {
      writeSource(
        sourceCommsDir,
        "inbox/20260602-yoon-jun-inbound.md",
        "From: 윤\nTo: 준\nSubject: inbound\n\ninbound",
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await runLocalUplink({
        mode: "apply",
        sourceCommsDir,
        targetCommsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        now: new Date("2026-06-02T00:10:02.000Z"),
      });

      expect(result.items).toHaveLength(0);
      expect(result.skipped.notFromAgent).toBe(1);
      expect(
        fs.existsSync(
          path.join(targetCommsDir, "inbox", "20260602-yoon-jun-inbound.md"),
        ),
      ).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("matches local sender by from_name when routing from is unknown", async () => {
    const { root, sourceCommsDir, targetCommsDir, stateDir } = makeRoot();
    try {
      writeSource(
        sourceCommsDir,
        "inbox/20260602-unknown-codex-from-name.md",
        [
          "---",
          "message_id: msg-from-name",
          "from: unknown",
          "from_name: 준",
          "to: codex",
          "subject: from-name",
          "---",
          "",
          "from name body",
        ].join("\n"),
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await runLocalUplink({
        mode: "apply",
        sourceCommsDir,
        targetCommsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        now: new Date("2026-06-02T00:10:02.000Z"),
      });

      expect(result.status).toBe("uploaded");
      expect(result.items[0]).toMatchObject({
        from: "unknown",
        fromName: "준",
        uploaded: true,
      });
      expect(
        fs.existsSync(
          path.join(
            targetCommsDir,
            "inbox",
            "20260602-unknown-codex-from-name.md",
          ),
        ),
      ).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not let from_name override a different concrete sender", async () => {
    const { root, sourceCommsDir, targetCommsDir, stateDir } = makeRoot();
    try {
      writeSource(
        sourceCommsDir,
        "inbox/20260602-yoon-jun-from-name-spoof.md",
        [
          "---",
          "message_id: msg-from-name-spoof",
          "from: 윤",
          "from_name: 준",
          "to: 준",
          "subject: from-name-spoof",
          "---",
          "",
          "spoof body",
        ].join("\n"),
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await runLocalUplink({
        mode: "apply",
        sourceCommsDir,
        targetCommsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        now: new Date("2026-06-02T00:10:02.000Z"),
      });

      expect(result.status).toBe("idle");
      expect(result.items).toHaveLength(0);
      expect(result.skipped.notFromAgent).toBe(1);
      expect(
        fs.existsSync(
          path.join(
            targetCommsDir,
            "inbox",
            "20260602-yoon-jun-from-name-spoof.md",
          ),
        ),
      ).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("matches guarded broad runtime sender by from_name and structured aliases", async () => {
    const { root, sourceCommsDir, targetCommsDir, stateDir } = makeRoot();
    try {
      writeSource(
        sourceCommsDir,
        "inbox/20260618-codex-yoon-bom-uplink.md",
        [
          "---",
          "message_id: msg-bom-codex-uplink",
          "from: codex",
          "from_name: 봄",
          "to: 윤",
          'from_address: {"routingAddress":"codex","aliases":["codex","봄"]}',
          "subject: bom-uplink",
          "---",
          "",
          "bom uplink body",
        ].join("\n"),
        new Date("2026-06-18T11:18:29.000Z"),
      );

      const result = await runLocalUplink({
        mode: "apply",
        sourceCommsDir,
        targetCommsDir,
        stateDir,
        agent: "봄",
        since: "2026-06-18T11:18:00.000Z",
        now: new Date("2026-06-18T11:19:00.000Z"),
      });

      expect(result.status).toBe("uploaded");
      expect(result.skipped.notFromAgent).toBe(0);
      expect(result.items[0]).toMatchObject({
        from: "codex",
        fromName: "봄",
        uploaded: true,
      });
      expect(
        fs.existsSync(
          path.join(
            targetCommsDir,
            "inbox",
            "20260618-codex-yoon-bom-uplink.md",
          ),
        ),
      ).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not treat arbitrary broad codex senders as local own-source records", async () => {
    const { root, sourceCommsDir, targetCommsDir, stateDir } = makeRoot();
    try {
      writeSource(
        sourceCommsDir,
        "inbox/20260618-codex-yoon-unrelated.md",
        [
          "---",
          "message_id: msg-codex-unrelated",
          "from: codex",
          "from_name: 봄",
          "to: 윤",
          'from_address: {"routingAddress":"codex","aliases":["codex"]}',
          "subject: unrelated",
          "---",
          "",
          "unrelated body",
        ].join("\n"),
        new Date("2026-06-18T11:18:29.000Z"),
      );

      const result = await runLocalUplink({
        mode: "apply",
        sourceCommsDir,
        targetCommsDir,
        stateDir,
        agent: "봄",
        since: "2026-06-18T11:18:00.000Z",
        now: new Date("2026-06-18T11:19:00.000Z"),
      });

      expect(result.status).toBe("idle");
      expect(result.items).toHaveLength(0);
      expect(result.skipped.notFromAgent).toBe(1);
      expect(
        fs.existsSync(
          path.join(
            targetCommsDir,
            "inbox",
            "20260618-codex-yoon-unrelated.md",
          ),
        ),
      ).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not let env codex aliases bypass the guarded broad sender rule", async () => {
    const { root, sourceCommsDir, targetCommsDir, stateDir } = makeRoot();
    const previousTapAgentId = process.env.TAP_AGENT_ID;
    const previousTapAgentName = process.env.TAP_AGENT_NAME;
    const previousCodexTapAgentName = process.env.CODEX_TAP_AGENT_NAME;
    try {
      process.env.TAP_AGENT_ID = "codex";
      delete process.env.TAP_AGENT_NAME;
      delete process.env.CODEX_TAP_AGENT_NAME;
      writeSource(
        sourceCommsDir,
        "inbox/20260618-codex-yoon-env-alias.md",
        [
          "---",
          "message_id: msg-codex-env-alias",
          "from: codex",
          "from_name: 봄",
          "to: 윤",
          'from_address: {"routingAddress":"codex","aliases":["codex"]}',
          "subject: env-alias",
          "---",
          "",
          "env alias body",
        ].join("\n"),
        new Date("2026-06-18T11:18:29.000Z"),
      );

      const result = await runLocalUplink({
        mode: "check",
        sourceCommsDir,
        targetCommsDir,
        stateDir,
        agent: "봄",
        all: true,
        resetCursor: true,
        now: new Date("2026-06-18T11:19:00.000Z"),
      });

      expect(result.aliases).toEqual(["봄", "codex"]);
      expect(result.status).toBe("idle");
      expect(result.items).toHaveLength(0);
      expect(result.skipped.notFromAgent).toBe(1);
    } finally {
      if (previousTapAgentId === undefined) {
        delete process.env.TAP_AGENT_ID;
      } else {
        process.env.TAP_AGENT_ID = previousTapAgentId;
      }
      if (previousTapAgentName === undefined) {
        delete process.env.TAP_AGENT_NAME;
      } else {
        process.env.TAP_AGENT_NAME = previousTapAgentName;
      }
      if (previousCodexTapAgentName === undefined) {
        delete process.env.CODEX_TAP_AGENT_NAME;
      } else {
        process.env.CODEX_TAP_AGENT_NAME = previousCodexTapAgentName;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects broad runtime senders when from_name is also broad", async () => {
    const { root, sourceCommsDir, targetCommsDir, stateDir } = makeRoot();
    const previousTapAgentId = process.env.TAP_AGENT_ID;
    const previousTapAgentName = process.env.TAP_AGENT_NAME;
    const previousCodexTapAgentName = process.env.CODEX_TAP_AGENT_NAME;
    try {
      process.env.TAP_AGENT_ID = "codex";
      delete process.env.TAP_AGENT_NAME;
      delete process.env.CODEX_TAP_AGENT_NAME;
      writeSource(
        sourceCommsDir,
        "inbox/20260618-codex-yoon-broad-name.md",
        [
          "---",
          "message_id: msg-codex-broad-name",
          "from: codex",
          "from_name: codex",
          "to: 윤",
          'from_address: {"routingAddress":"codex","aliases":["codex"]}',
          "subject: broad-name",
          "---",
          "",
          "broad name body",
        ].join("\n"),
        new Date("2026-06-18T11:18:29.000Z"),
      );

      const result = await runLocalUplink({
        mode: "check",
        sourceCommsDir,
        targetCommsDir,
        stateDir,
        agent: "봄",
        all: true,
        resetCursor: true,
        now: new Date("2026-06-18T11:19:00.000Z"),
      });

      expect(result.aliases).toEqual(["봄", "codex"]);
      expect(result.status).toBe("idle");
      expect(result.items).toHaveLength(0);
      expect(result.skipped.notFromAgent).toBe(1);
    } finally {
      if (previousTapAgentId === undefined) {
        delete process.env.TAP_AGENT_ID;
      } else {
        process.env.TAP_AGENT_ID = previousTapAgentId;
      }
      if (previousTapAgentName === undefined) {
        delete process.env.TAP_AGENT_NAME;
      } else {
        process.env.TAP_AGENT_NAME = previousTapAgentName;
      }
      if (previousCodexTapAgentName === undefined) {
        delete process.env.CODEX_TAP_AGENT_NAME;
      } else {
        process.env.CODEX_TAP_AGENT_NAME = previousCodexTapAgentName;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects broad runtime senders when structured routing address points elsewhere", async () => {
    const { root, sourceCommsDir, targetCommsDir, stateDir } = makeRoot();
    try {
      writeSource(
        sourceCommsDir,
        "inbox/20260618-codex-yoon-routing-mismatch.md",
        [
          "---",
          "message_id: msg-routing-mismatch",
          "from: codex",
          "from_name: 봄",
          "to: 윤",
          'from_address: {"routingAddress":"윤","aliases":["윤","봄"]}',
          "subject: routing-mismatch",
          "---",
          "",
          "routing mismatch body",
        ].join("\n"),
        new Date("2026-06-18T11:18:29.000Z"),
      );

      const result = await runLocalUplink({
        mode: "apply",
        sourceCommsDir,
        targetCommsDir,
        stateDir,
        agent: "봄",
        all: true,
        resetCursor: true,
        now: new Date("2026-06-18T11:19:00.000Z"),
      });

      expect(result.status).toBe("idle");
      expect(result.items).toHaveLength(0);
      expect(result.skipped.notFromAgent).toBe(1);
      expect(
        fs.existsSync(
          path.join(
            targetCommsDir,
            "inbox",
            "20260618-codex-yoon-routing-mismatch.md",
          ),
        ),
      ).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("can include non-own inbox messages only when explicitly requested", async () => {
    const { root, sourceCommsDir, targetCommsDir, stateDir } = makeRoot();
    try {
      writeSource(
        sourceCommsDir,
        "inbox/20260602-yoon-jun-include.md",
        "From: 윤\nTo: 준\nSubject: include\n\ninclude",
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await runLocalUplink({
        mode: "apply",
        sourceCommsDir,
        targetCommsDir,
        stateDir,
        agent: "준",
        includeAllSources: true,
        since: "2026-06-02T00:10:00.000Z",
        now: new Date("2026-06-02T00:10:02.000Z"),
      });

      expect(result.status).toBe("uploaded");
      expect(result.items[0].uploaded).toBe(true);
      expect(
        fs.existsSync(
          path.join(targetCommsDir, "inbox", "20260602-yoon-jun-include.md"),
        ),
      ).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("marks same-content target files as idempotently uploaded", async () => {
    const { root, sourceCommsDir, targetCommsDir, stateDir } = makeRoot();
    try {
      const content = "From: 준\nTo: 윤\nSubject: exists\n\nexists";
      writeSource(
        sourceCommsDir,
        "inbox/20260602-jun-yoon-exists.md",
        content,
        new Date("2026-06-02T00:10:01.000Z"),
      );
      writeSource(
        targetCommsDir,
        "inbox/20260602-jun-yoon-exists.md",
        content,
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const first = await runLocalUplink({
        mode: "apply",
        sourceCommsDir,
        targetCommsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        now: new Date("2026-06-02T00:10:02.000Z"),
      });
      const second = await runLocalUplink({
        mode: "apply",
        sourceCommsDir,
        targetCommsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        now: new Date("2026-06-02T00:10:03.000Z"),
      });

      expect(first.status).toBe("pending");
      expect(first.items[0]).toMatchObject({
        uploaded: false,
        skipReason: "target-exists",
      });
      expect(second.items).toHaveLength(0);
      expect(second.skipped.duplicate).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed on target filename collisions without overwriting central evidence", async () => {
    const { root, sourceCommsDir, targetCommsDir, stateDir } = makeRoot();
    try {
      writeSource(
        sourceCommsDir,
        "inbox/20260602-jun-yoon-collision.md",
        "From: 준\nTo: 윤\nSubject: collision\n\nlocal",
        new Date("2026-06-02T00:10:01.000Z"),
      );
      writeSource(
        targetCommsDir,
        "inbox/20260602-jun-yoon-collision.md",
        "From: 준\nTo: 윤\nSubject: collision\n\ncentral",
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await runLocalUplink({
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
        "20260602-jun-yoon-collision.md",
      );

      expect(result.status).toBe("blocked");
      expect(result.items[0]).toMatchObject({
        uploaded: false,
        skipReason: "collision",
      });
      expect(fs.readFileSync(targetPath, "utf8")).toContain("central");
      expect(
        JSON.parse(fs.readFileSync(result.statePath, "utf8")).uploaded,
      ).toEqual({});
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
        "inbox/20260602-jun-yoon-safe.md",
        "From: 준\nTo: 윤\nSubject: safe\n\nsafe",
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await runLocalUplink({
        mode: "apply",
        sourceCommsDir,
        targetCommsDir,
        stateDir,
        agent: "준",
        dirs: ["heartbeats" as never, "inbox"],
        since: "2026-06-02T00:10:00.000Z",
        now: new Date("2026-06-02T00:10:02.000Z"),
      });

      expect(result.warnings[0]).toContain("disallowed uplink dir");
      expect(result.items).toHaveLength(1);
      expect(fs.existsSync(path.join(targetCommsDir, "heartbeats.json"))).toBe(
        false,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not fall back to inbox when only mutable dirs are requested", async () => {
    const { root, sourceCommsDir, targetCommsDir, stateDir } = makeRoot();
    try {
      writeSource(
        sourceCommsDir,
        "inbox/20260602-jun-yoon-should-not-upload.md",
        "From: 준\nTo: 윤\nSubject: should-not-upload\n\nsafe but not requested",
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await runLocalUplink({
        mode: "apply",
        sourceCommsDir,
        targetCommsDir,
        stateDir,
        agent: "준",
        dirs: ["heartbeats" as never],
        since: "2026-06-02T00:10:00.000Z",
        now: new Date("2026-06-02T00:10:02.000Z"),
      });

      expect(result.dirs).toEqual([]);
      expect(result.status).toBe("idle");
      expect(result.items).toHaveLength(0);
      expect(result.scanned).toBe(0);
      expect(result.warnings[0]).toContain("disallowed uplink dir");
      expect(
        fs.existsSync(
          path.join(
            targetCommsDir,
            "inbox",
            "20260602-jun-yoon-should-not-upload.md",
          ),
        ),
      ).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("watches until a local file appears after receiver start by default", async () => {
    const { root, sourceCommsDir, targetCommsDir, stateDir } = makeRoot();
    try {
      const watched = runLocalUplink({
        mode: "watch",
        sourceCommsDir,
        targetCommsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        intervalMs: 10,
        now: new Date("2026-06-02T00:10:02.000Z"),
      });
      setTimeout(() => {
        writeSource(
          sourceCommsDir,
          "inbox/20260602-jun-yoon-watch.md",
          "From: 준\nTo: 윤\nSubject: watch\n\nwatch",
          new Date("2026-06-02T00:10:03.000Z"),
        );
      }, 30);

      const result = await watched;

      expect(result.status).toBe("uploaded");
      expect(result.items).toHaveLength(1);
      expect(
        fs.existsSync(
          path.join(targetCommsDir, "inbox", "20260602-jun-yoon-watch.md"),
        ),
      ).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("can refresh the source before every watch scan", async () => {
    const { root, sourceCommsDir, targetCommsDir, stateDir } = makeRoot();
    try {
      let scans = 0;
      const result = await runLocalUplink({
        mode: "watch",
        sourceCommsDir,
        targetCommsDir,
        stateDir,
        agent: "준",
        since: "2026-06-02T00:10:00.000Z",
        intervalMs: 10,
        maxIterations: 3,
        now: new Date("2026-06-02T00:10:02.000Z"),
        beforeScan: () => {
          scans += 1;
          if (scans === 2) {
            writeSource(
              sourceCommsDir,
              "inbox/20260602-jun-yoon-before-scan.md",
              "From: 준\nTo: 윤\nSubject: before-scan\n\nbefore scan",
              new Date("2026-06-02T00:10:03.000Z"),
            );
          }
        },
      });

      expect(scans).toBe(2);
      expect(result.status).toBe("uploaded");
      expect(result.items[0].relativePath).toBe(
        "inbox/20260602-jun-yoon-before-scan.md",
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("mirrors remote append-only source dirs with rsync", () => {
    const { root } = makeRoot();
    try {
      const mirrorDir = path.join(root, "mirror");
      const calls: Array<{ command: string; args: string[] }> = [];
      const records = mirrorRemoteUplinkSource({
        sshTarget: "sum-mac",
        remoteCommsDir: "/Users/devin/HUA/hua-comms",
        localMirrorDir: mirrorDir,
        dirs: ["inbox", "reviews"],
        runner: (command, args) => {
          calls.push({ command, args });
          return {
            status: 0,
            stdout: ">f+++++++++ 20260602-jun-yoon-review.md\n",
            stderr: "",
          };
        },
      });

      expect(records).toHaveLength(2);
      expect(calls[0]).toMatchObject({
        command: "rsync",
      });
      expect(calls[0].args).toContain("--ignore-existing");
      expect(calls[0].args).toContain("--include=*.md");
      expect(calls[0].args).toContain("--include=*.json");
      expect(calls[0].args).toContain("--exclude=*");
      expect(calls[0].args).toContain(
        "sum-mac:/Users/devin/HUA/hua-comms/inbox/",
      );
      expect(fs.existsSync(path.join(mirrorDir, "inbox"))).toBe(true);
      expect(records[0]).toMatchObject({
        dir: "inbox",
        changed: 1,
        status: 0,
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("exposes uplink through the tap CLI command", async () => {
    const { root, sourceCommsDir, targetCommsDir, stateDir } = makeRoot();
    const previousTapStateDir = process.env.TAP_STATE_DIR;
    try {
      process.env.TAP_STATE_DIR = stateDir;
      writeSource(
        sourceCommsDir,
        "inbox/20260602-jun-yoon-command.md",
        "From: 준\nTo: 윤\nSubject: command\n\ncommand",
        new Date("2026-06-02T00:10:01.000Z"),
      );

      const result = await uplinkCommand([
        "apply",
        "--agent",
        "준",
        "--source-comms-dir",
        sourceCommsDir,
        "--target-comms-dir",
        targetCommsDir,
        "--since",
        "2026-06-02T00:10:00.000Z",
        "--state-name",
        "uplink-command-test",
      ]);

      expect(result).toMatchObject({
        ok: true,
        command: "uplink",
        code: "TAP_UPLINK_OK",
      });
      expect(
        fs.existsSync(
          path.join(targetCommsDir, "inbox", "20260602-jun-yoon-command.md"),
        ),
      ).toBe(true);
      expect(
        fs.existsSync(
          resolveLocalUplinkStatePath({
            stateDir,
            agent: "준",
            stateName: "uplink-command-test",
          }),
        ),
      ).toBe(true);
    } finally {
      if (previousTapStateDir === undefined) {
        delete process.env.TAP_STATE_DIR;
      } else {
        process.env.TAP_STATE_DIR = previousTapStateDir;
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
