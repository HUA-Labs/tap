import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { flowDoctorCommand } from "../commands/flow-doctor.js";

let root: string;
let sourceCommsDir: string;
let targetCommsDir: string;
let stateDir: string;
let originalCwd: string;
const originalTapAgentName = process.env.TAP_AGENT_NAME;
const originalCodexTapAgentName = process.env.CODEX_TAP_AGENT_NAME;
const originalTapCommsDir = process.env.TAP_COMMS_DIR;
const originalTapStateDir = process.env.TAP_STATE_DIR;

function writeRecord(
  commsDir: string,
  relativePath: string,
  content: string,
  mtime = new Date("2026-06-16T00:00:00.000Z"),
): string {
  const filePath = path.join(commsDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  fs.utimesSync(filePath, mtime, mtime);
  return filePath;
}

function writePresence(
  commsDir: string,
  agent: string,
  record: Record<string, unknown>,
): string {
  const filePath = path.join(commsDir, "presence", `${agent}.json`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return filePath;
}

function writeHeartbeats(
  commsDir: string,
  records: Record<string, Record<string, unknown>>,
): string {
  const filePath = path.join(commsDir, "heartbeats.json");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  return filePath;
}

function freshConsentPresence(agent: string): Record<string, unknown> {
  return {
    agent,
    timestamp: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    receiveTransports: ["consent-drive"],
    capabilities: {
      receiveTransports: ["consent-drive"],
      conversationId: `conv-${agent}`,
      ownerClientId: `owner-${agent}`,
    },
  };
}

function freshPollingPresence(agent: string): Record<string, unknown> {
  return {
    agent,
    timestamp: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    receiveTransports: ["polling"],
  };
}

function agedPollingPresence(
  agent: string,
  ageHours: number,
): Record<string, unknown> {
  const timestamp = new Date(
    Date.now() - ageHours * 60 * 60 * 1000,
  ).toISOString();
  return {
    agent,
    timestamp,
    lastActivity: timestamp,
    receiveTransports: ["polling"],
  };
}

function agedConsentPresence(
  agent: string,
  ageMinutes: number,
): Record<string, unknown> {
  const timestamp = new Date(Date.now() - ageMinutes * 60 * 1000).toISOString();
  return {
    ...freshConsentPresence(agent),
    timestamp,
    lastActivity: timestamp,
  };
}

function freshBridgePresenceWithOldActivity(
  agent: string,
  lastActivityAgeHours: number,
): Record<string, unknown> {
  return {
    ...freshConsentPresence(agent),
    source: "bridge-dispatch",
    timestamp: new Date().toISOString(),
    lastActivity: new Date(
      Date.now() - lastActivityAgeHours * 60 * 60 * 1000,
    ).toISOString(),
  };
}

function stalePresence(agent: string): Record<string, unknown> {
  return {
    agent,
    timestamp: "2026-06-01T00:00:00.000Z",
    lastActivity: "2026-06-01T00:00:00.000Z",
    receiveTransports: ["consent-drive"],
    capabilities: {
      receiveTransports: ["consent-drive"],
      conversationId: `conv-${agent}`,
      ownerClientId: `owner-${agent}`,
    },
  };
}

function baseArgs(
  extra: string[] = [],
  options: { all?: boolean } = {},
): string[] {
  const args = [
    "--agent",
    "준",
    "--source-comms-dir",
    sourceCommsDir,
    "--target-comms-dir",
    targetCommsDir,
    "--state-dir",
    stateDir,
  ];
  if (options.all ?? true) args.push("--all");
  args.push(...extra);
  return args;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tap-flow-doctor-"));
  sourceCommsDir = path.join(root, "mac");
  targetCommsDir = path.join(root, "sum-back");
  stateDir = path.join(root, ".tap-comms");
  fs.mkdirSync(path.join(sourceCommsDir, "inbox"), { recursive: true });
  fs.mkdirSync(path.join(targetCommsDir, "inbox"), { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), "{}\n", "utf8");
  originalCwd = process.cwd();
  process.chdir(root);
  process.env.TAP_COMMS_DIR = sourceCommsDir;
  process.env.TAP_STATE_DIR = stateDir;
  delete process.env.TAP_AGENT_NAME;
  delete process.env.CODEX_TAP_AGENT_NAME;
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(root, { recursive: true, force: true });
  if (originalTapAgentName === undefined) {
    delete process.env.TAP_AGENT_NAME;
  } else {
    process.env.TAP_AGENT_NAME = originalTapAgentName;
  }
  if (originalCodexTapAgentName === undefined) {
    delete process.env.CODEX_TAP_AGENT_NAME;
  } else {
    process.env.CODEX_TAP_AGENT_NAME = originalCodexTapAgentName;
  }
  if (originalTapCommsDir === undefined) {
    delete process.env.TAP_COMMS_DIR;
  } else {
    process.env.TAP_COMMS_DIR = originalTapCommsDir;
  }
  if (originalTapStateDir === undefined) {
    delete process.env.TAP_STATE_DIR;
  } else {
    process.env.TAP_STATE_DIR = originalTapStateDir;
  }
});

describe("flowDoctorCommand", () => {
  it("distinguishes receiver success from return-uplink notFromAgent identity drift", async () => {
    writeRecord(
      sourceCommsDir,
      "inbox/20260616-yoon-jun-review-request.md",
      "From: 윤\nTo: 준\nSubject: review request\n\nplease review",
    );
    writeRecord(
      sourceCommsDir,
      "inbox/20260616-unknown-yoon-r2-review-clean.md",
      "From: unknown\nTo: 윤\nSubject: r2 review clean\n\nclean",
    );

    const result = await flowDoctorCommand([
      ...baseArgs(["--runtime-agent", "unknown"]),
    ]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TAP_FLOW_DOCTOR_OK");
    expect(result.data.identity).toMatchObject({
      expectedAgent: "준",
      runtimeAgent: "unknown",
      status: "unknown",
    });
    expect(result.data.receiver).toMatchObject({
      status: "pending",
      scanned: 2,
      activeTurn: {
        status: "not-observed",
        queued: null,
        blocked: null,
      },
    });
    expect(
      result.data.returnUplink.skipped.notFromAgent,
    ).toBeGreaterThanOrEqual(2);
    expect(result.data.returnUplink.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: "inbox/20260616-unknown-yoon-r2-review-clean.md",
          presence: "source-only",
          returnEligibility: "notFromAgent",
        }),
      ]),
    );
    expect(result.data.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "repair-runtime-identity" }),
        expect.objectContaining({ id: "review-not-from-agent" }),
      ]),
    );
    expect(fs.existsSync(path.join(targetCommsDir, "inbox"))).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          targetCommsDir,
          "inbox",
          "20260616-unknown-yoon-r2-review-clean.md",
        ),
      ),
    ).toBe(false);
    expect(fs.readdirSync(stateDir)).toHaveLength(0);
  });

  it("reports return-uplink collisions without mutating target evidence", async () => {
    writeRecord(
      sourceCommsDir,
      "inbox/20260616-jun-yoon-review.md",
      "From: 준\nTo: 윤\nSubject: review\n\nsource",
    );
    writeRecord(
      targetCommsDir,
      "inbox/20260616-jun-yoon-review.md",
      "From: 준\nTo: 윤\nSubject: review\n\ntarget",
    );

    const result = await flowDoctorCommand([
      ...baseArgs(["--runtime-agent", "준"]),
    ]);

    expect(result.ok).toBe(false);
    expect(result.data.identity.status).toBe("ready");
    expect(result.data.returnUplink.status).toBe("blocked");
    expect(result.data.returnUplink.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: "inbox/20260616-jun-yoon-review.md",
          presence: "collision",
          returnEligibility: "collision",
        }),
      ]),
    );
    expect(result.data.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "review-uplink-collision" }),
      ]),
    );
    expect(
      fs.readFileSync(
        path.join(targetCommsDir, "inbox", "20260616-jun-yoon-review.md"),
        "utf8",
      ),
    ).toContain("target");
    expect(fs.readdirSync(stateDir)).toHaveLength(0);
  });

  it("reports both/source/target evidence presence without broad unknown uplink", async () => {
    const bothContent = "From: 준\nTo: 윤\nSubject: both\n\nsame";
    writeRecord(sourceCommsDir, "inbox/20260616-jun-yoon-both.md", bothContent);
    writeRecord(targetCommsDir, "inbox/20260616-jun-yoon-both.md", bothContent);
    writeRecord(
      targetCommsDir,
      "reviews/20260616-jun-yoon-target-only.md",
      "From: 준\nTo: 윤\nSubject: target only\n\nregistered",
    );

    const result = await flowDoctorCommand([
      ...baseArgs(["--runtime-agent", "준"]),
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe("ready");
    expect(result.data.returnUplink.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: "inbox/20260616-jun-yoon-both.md",
          presence: "both",
          returnEligibility: "target-exists",
        }),
        expect.objectContaining({
          relativePath: "reviews/20260616-jun-yoon-target-only.md",
          presence: "target-only",
          returnEligibility: "target-only",
        }),
      ]),
    );
    expect(result.data.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "no-action-required" }),
      ]),
    );
  });

  it("uses the uplink default scan window instead of treating stale archive evidence as current blockers", async () => {
    writeRecord(
      sourceCommsDir,
      "inbox/20260601-unknown-yoon-stale-old-review-clean.md",
      "From: unknown\nTo: 윤\nSubject: stale old review\n\nold",
      new Date("2026-06-01T00:00:00.000Z"),
    );

    const result = await flowDoctorCommand([
      ...baseArgs(["--runtime-agent", "준"], { all: false }),
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe("ready");
    expect(result.data.returnUplink).toMatchObject({
      status: "idle",
      skipped: expect.objectContaining({ old: 1, notFromAgent: 0 }),
      evidence: [],
    });
    expect(result.data.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "no-action-required" }),
      ]),
    );

    const allResult = await flowDoctorCommand([
      ...baseArgs(["--runtime-agent", "준"]),
    ]);

    expect(allResult.ok).toBe(false);
    expect(allResult.data.returnUplink.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: "inbox/20260601-unknown-yoon-stale-old-review-clean.md",
          returnEligibility: "notFromAgent",
        }),
      ]),
    );
  });

  it("reports a fresh lane as ready when source and central presence are fresh-for-routing", async () => {
    writePresence(sourceCommsDir, "준", freshConsentPresence("준"));
    writePresence(targetCommsDir, "준", freshConsentPresence("준"));

    const result = await flowDoctorCommand([
      ...baseArgs(
        [
          "--runtime-agent",
          "준",
          "--presence-source-comms-dir",
          sourceCommsDir,
          "--presence-target-comms-dir",
          targetCommsDir,
        ],
        { all: false },
      ),
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe("ready");
    expect(result.data.lane).toMatchObject({
      status: "ready",
      presence: {
        source: {
          freshness: "fresh-for-routing",
          freshForRouting: true,
        },
        target: {
          freshness: "fresh-for-routing",
          freshForRouting: true,
        },
      },
      stalePresence: {
        status: "ready",
        candidates: [],
      },
    });
    expect(result.data.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "no-action-required" }),
      ]),
    );
  });

  it("uses fresh bridge timestamps instead of old activity for consent-drive lane freshness", async () => {
    writePresence(
      sourceCommsDir,
      "준",
      freshBridgePresenceWithOldActivity("준", 16),
    );
    writePresence(
      targetCommsDir,
      "준",
      freshBridgePresenceWithOldActivity("준", 16),
    );
    writeHeartbeats(targetCommsDir, {
      준: freshBridgePresenceWithOldActivity("준", 16),
    });

    const result = await flowDoctorCommand([
      ...baseArgs(
        [
          "--runtime-agent",
          "준",
          "--presence-source-comms-dir",
          sourceCommsDir,
          "--presence-target-comms-dir",
          targetCommsDir,
        ],
        { all: false },
      ),
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe("ready");
    expect(result.data.lane.presence.source).toMatchObject({
      freshness: "fresh-for-routing",
      consentDriveStatus: "ready",
      freshForRouting: true,
    });
    expect(result.data.lane.presence.target).toMatchObject({
      freshness: "fresh-for-routing",
      consentDriveStatus: "ready",
      freshForRouting: true,
    });
    expect(result.data.lane.stalePresence).toMatchObject({
      status: "ready",
      candidates: [],
    });
    expect(result.data.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "no-action-required" }),
      ]),
    );
  });

  it("keeps guarded presence publish fail-closed when source presence is only visible", async () => {
    writePresence(sourceCommsDir, "준", freshPollingPresence("준"));
    writePresence(targetCommsDir, "준", stalePresence("준"));
    writeRecord(
      sourceCommsDir,
      "inbox/20260616-yoon-jun-runtime-check.md",
      "From: 윤\nTo: 준\nSubject: runtime check\n\nping",
      new Date(),
    );

    const result = await flowDoctorCommand([
      ...baseArgs(
        [
          "--runtime-agent",
          "준",
          "--presence-source-comms-dir",
          sourceCommsDir,
          "--presence-target-comms-dir",
          targetCommsDir,
          "--since",
          "2026-06-16T00:00:00.000Z",
        ],
        { all: false },
      ),
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe("warn");
    expect(result.data.receiver.status).toBe("pending");
    expect(result.data.returnUplink.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: "inbox/20260616-yoon-jun-runtime-check.md",
          returnEligibility: "inbound",
        }),
      ]),
    );
    expect(result.data.lane.presence.source).toMatchObject({
      freshness: "visible",
      freshForRouting: false,
    });
    expect(result.data.lane.presence.target).toMatchObject({
      freshness: "stale-visible",
      freshForRouting: false,
    });
    expect(result.data.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "publish-guarded-polling-presence" }),
      ]),
    );
    expect(result.data.nextActions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "publish-fresh-presence" }),
      ]),
    );
    expect(result.data.nextActions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "review-not-from-agent" }),
      ]),
    );
  });

  it("keeps polling-only lanes visible within the 17-hour visibility window", async () => {
    writePresence(sourceCommsDir, "준", agedPollingPresence("준", 16));
    writePresence(targetCommsDir, "준", agedPollingPresence("준", 16));

    const result = await flowDoctorCommand([
      ...baseArgs(
        [
          "--runtime-agent",
          "준",
          "--presence-source-comms-dir",
          sourceCommsDir,
          "--presence-target-comms-dir",
          targetCommsDir,
        ],
        { all: false },
      ),
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe("warn");
    expect(result.data.environment).toMatchObject({
      freshMinutes: 30,
      pollingFreshMinutes: 1020,
    });
    expect(result.data.lane.presence.source).toMatchObject({
      freshness: "visible",
      freshForRouting: false,
      receiveTransports: ["polling"],
    });
    expect(result.data.lane.presence.target).toMatchObject({
      freshness: "visible",
      freshForRouting: false,
      receiveTransports: ["polling"],
    });
    expect(result.data.lane.stalePresence).toMatchObject({
      status: "ready",
      candidates: [],
    });
    expect(result.data.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "accept-durable-inbox-only-fallback",
        }),
      ]),
    );
  });

  it("marks polling-only lanes stale after the 17-hour visibility window", async () => {
    writePresence(sourceCommsDir, "준", agedPollingPresence("준", 18));
    writePresence(targetCommsDir, "준", agedPollingPresence("준", 18));

    const result = await flowDoctorCommand([
      ...baseArgs(
        [
          "--runtime-agent",
          "준",
          "--presence-source-comms-dir",
          sourceCommsDir,
          "--presence-target-comms-dir",
          targetCommsDir,
        ],
        { all: false },
      ),
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe("warn");
    expect(result.data.lane.presence.source).toMatchObject({
      freshness: "stale-visible",
      freshForRouting: false,
    });
    expect(result.data.lane.presence.target).toMatchObject({
      freshness: "stale-visible",
      freshForRouting: false,
    });
    expect(result.data.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "warm-target-runtime" }),
      ]),
    );
  });

  it("points missing central polling presence to guarded polling publish", async () => {
    writePresence(sourceCommsDir, "준", agedPollingPresence("준", 16));

    const result = await flowDoctorCommand([
      ...baseArgs(
        [
          "--runtime-agent",
          "준",
          "--presence-source-comms-dir",
          sourceCommsDir,
          "--presence-target-comms-dir",
          targetCommsDir,
        ],
        { all: false },
      ),
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe("warn");
    expect(result.data.lane.presence.source).toMatchObject({
      freshness: "visible",
      freshForRouting: false,
      receiveTransports: ["polling"],
    });
    expect(result.data.lane.presence.target).toMatchObject({
      exists: false,
      freshness: "missing",
      freshForRouting: false,
    });
    expect(result.data.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "publish-guarded-polling-presence",
          command: expect.stringContaining("--apply-polling-presence-publish"),
          risk: "safe-publish",
        }),
      ]),
    );
  });

  it("applies guarded polling presence publish without syncing heartbeats", async () => {
    writePresence(sourceCommsDir, "준", agedPollingPresence("준", 16));
    writePresence(targetCommsDir, "준", stalePresence("준"));
    writeHeartbeats(targetCommsDir, {
      준: stalePresence("준"),
      other: freshPollingPresence("other"),
    });

    const result = await flowDoctorCommand([
      ...baseArgs(
        [
          "--runtime-agent",
          "준",
          "--presence-source-comms-dir",
          sourceCommsDir,
          "--presence-target-comms-dir",
          targetCommsDir,
          "--apply-polling-presence-publish",
        ],
        { all: false },
      ),
    ]);

    const targetPresence = JSON.parse(
      fs.readFileSync(path.join(targetCommsDir, "presence", "준.json"), "utf8"),
    ) as Record<string, unknown>;
    const heartbeats = JSON.parse(
      fs.readFileSync(path.join(targetCommsDir, "heartbeats.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(result.data.lane.pollingPresencePublish).toMatchObject({
      status: "applied",
      applied: true,
      error: null,
    });
    expect(result.data.lane.presence.target).toMatchObject({
      freshness: "visible",
      receiveTransports: ["polling"],
    });
    expect(targetPresence).toMatchObject({
      agent: "준",
      receiveTransports: ["polling"],
    });
    expect(heartbeats).toMatchObject({
      준: expect.objectContaining({
        timestamp: "2026-06-01T00:00:00.000Z",
      }),
      other: expect.any(Object),
    });
  });

  it("refuses guarded polling presence publish when source identity mismatches the lane", async () => {
    writePresence(sourceCommsDir, "준", agedPollingPresence("봄", 16));
    writePresence(targetCommsDir, "준", stalePresence("준"));

    const result = await flowDoctorCommand([
      ...baseArgs(
        [
          "--runtime-agent",
          "준",
          "--presence-source-comms-dir",
          sourceCommsDir,
          "--presence-target-comms-dir",
          targetCommsDir,
          "--apply-polling-presence-publish",
        ],
        { all: false },
      ),
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.lane.pollingPresencePublish).toMatchObject({
      status: "blocked",
      applied: false,
      error: "source presence identity mismatch",
    });
    expect(result.data.lane.pollingPresencePublish.message).toContain(
      "does not match the requested lane",
    );
    expect(result.data.nextActions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "publish-guarded-polling-presence" }),
      ]),
    );
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(targetCommsDir, "presence", "준.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ agent: "준" });
  });

  it("refuses guarded polling presence publish from a stale source", async () => {
    writePresence(sourceCommsDir, "준", agedPollingPresence("준", 18));

    const result = await flowDoctorCommand([
      ...baseArgs(
        [
          "--runtime-agent",
          "준",
          "--presence-source-comms-dir",
          sourceCommsDir,
          "--presence-target-comms-dir",
          targetCommsDir,
          "--apply-polling-presence-publish",
        ],
        { all: false },
      ),
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.lane.pollingPresencePublish).toMatchObject({
      status: "blocked",
      applied: false,
      error: "source presence is not fresh polling visibility",
    });
    expect(
      fs.existsSync(path.join(targetCommsDir, "presence", "준.json")),
    ).toBe(false);
    expect(result.data.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "retire-absent-runtime" }),
      ]),
    );
  });

  it("keeps consent-drive live routing strict at the 30-minute window", async () => {
    writePresence(sourceCommsDir, "준", agedConsentPresence("준", 40));
    writePresence(targetCommsDir, "준", agedConsentPresence("준", 40));

    const result = await flowDoctorCommand([
      ...baseArgs(
        [
          "--runtime-agent",
          "준",
          "--presence-source-comms-dir",
          sourceCommsDir,
          "--presence-target-comms-dir",
          targetCommsDir,
        ],
        { all: false },
      ),
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe("warn");
    expect(result.data.lane.presence.source).toMatchObject({
      freshness: "stale-visible",
      consentDriveStatus: "stale",
      freshForRouting: false,
    });
    expect(result.data.lane.presence.target).toMatchObject({
      freshness: "stale-visible",
      consentDriveStatus: "stale",
      freshForRouting: false,
    });
    expect(result.data.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "warm-target-runtime" }),
      ]),
    );
  });

  it("keeps presence publish guidance manual instead of emitting a repo-local script command", async () => {
    writePresence(sourceCommsDir, "준", freshConsentPresence("준"));
    writePresence(targetCommsDir, "준", stalePresence("준"));

    const result = await flowDoctorCommand([
      ...baseArgs(
        [
          "--runtime-agent",
          "준",
          "--presence-source-comms-dir",
          sourceCommsDir,
          "--presence-target-comms-dir",
          targetCommsDir,
        ],
        { all: false },
      ),
    ]);

    const action = result.data.nextActions.find(
      (nextAction) => nextAction.id === "publish-fresh-presence",
    );
    expect(result.ok).toBe(true);
    expect(result.data.status).toBe("warn");
    expect(action).toMatchObject({
      id: "publish-fresh-presence",
      risk: "manual",
    });
    expect(action?.command).toBeUndefined();
    expect(JSON.stringify(result.data.nextActions)).not.toContain(
      "scripts/tap-presence-publish.mjs",
    );
  });

  it("preserves repeated keep-presence-agent flags during cleanup apply", async () => {
    const archiveDir = path.join(root, "presence-archive-keep");
    writePresence(sourceCommsDir, "준", freshConsentPresence("준"));
    writePresence(targetCommsDir, "준", freshConsentPresence("준"));
    writePresence(targetCommsDir, "봄", stalePresence("봄"));
    writePresence(targetCommsDir, "윤", stalePresence("윤"));

    const result = await flowDoctorCommand([
      ...baseArgs(
        [
          "--runtime-agent",
          "준",
          "--presence-source-comms-dir",
          sourceCommsDir,
          "--presence-target-comms-dir",
          targetCommsDir,
          "--keep-presence-agent",
          "봄",
          "--keep-presence-agent",
          "윤",
          "--apply-stale-presence-cleanup",
          "--cleanup-archive-dir",
          archiveDir,
        ],
        { all: false },
      ),
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.lane.stalePresence).toMatchObject({
      status: "ready",
      applied: false,
      candidates: [],
      archived: [],
      prunedHeartbeats: [],
    });
    expect(
      fs.existsSync(path.join(targetCommsDir, "presence", "봄.json")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(targetCommsDir, "presence", "윤.json")),
    ).toBe(true);
    expect(fs.existsSync(archiveDir)).toBe(false);
  });

  it("archives stale non-lane central presence with a manifest and prunes matching stale heartbeats", async () => {
    const archiveDir = path.join(root, "presence-archive");
    writePresence(sourceCommsDir, "준", freshConsentPresence("준"));
    writePresence(targetCommsDir, "준", freshConsentPresence("준"));
    writePresence(targetCommsDir, "unknown", stalePresence("unknown"));
    writePresence(targetCommsDir, "legacy", stalePresence("legacy"));
    writePresence(
      targetCommsDir,
      "fresh-agent",
      freshConsentPresence("fresh-agent"),
    );
    writeHeartbeats(targetCommsDir, {
      준: {
        agent: "준",
        lastActivity: new Date().toISOString(),
      },
      unknown: {
        agent: "unknown",
        lastActivity: "2026-06-01T00:00:00.000Z",
      },
      legacy: {
        agent: "legacy",
        timestamp: "2026-06-01T00:00:00.000Z",
      },
      "fresh-agent": {
        agent: "fresh-agent",
        lastActivity: new Date().toISOString(),
      },
    });

    const result = await flowDoctorCommand([
      ...baseArgs(
        [
          "--runtime-agent",
          "준",
          "--presence-source-comms-dir",
          sourceCommsDir,
          "--presence-target-comms-dir",
          targetCommsDir,
          "--apply-stale-presence-cleanup",
          "--cleanup-archive-dir",
          archiveDir,
        ],
        { all: false },
      ),
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.lane.stalePresence).toMatchObject({
      status: "applied",
      applied: true,
      prunedHeartbeats: expect.arrayContaining(["unknown", "legacy"]),
    });
    expect(result.data.nextActions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "archive-stale-presence" }),
      ]),
    );
    expect(
      fs.existsSync(path.join(targetCommsDir, "presence", "unknown.json")),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(targetCommsDir, "presence", "legacy.json")),
    ).toBe(false);
    expect(fs.existsSync(path.join(archiveDir, "unknown.json"))).toBe(true);
    expect(fs.existsSync(path.join(archiveDir, "legacy.json"))).toBe(true);
    expect(fs.existsSync(path.join(archiveDir, "manifest.json"))).toBe(true);
    expect(
      fs.existsSync(path.join(targetCommsDir, "presence", "준.json")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(targetCommsDir, "presence", "fresh-agent.json")),
    ).toBe(true);
    const heartbeats = JSON.parse(
      fs.readFileSync(path.join(targetCommsDir, "heartbeats.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(Object.keys(heartbeats).sort()).toEqual(["fresh-agent", "준"]);
  });

  it("archives stale duplicate unknown-session presence when fresh kept lane presence exists", async () => {
    const archiveDir = path.join(root, "presence-archive-duplicate");
    writePresence(sourceCommsDir, "준", freshConsentPresence("준"));
    writePresence(targetCommsDir, "준", freshConsentPresence("준"));
    writePresence(targetCommsDir, "unknown", {
      ...stalePresence("준"),
      id: "unknown",
      address: {
        routingAddress: "준",
        aliases: ["준", "codex", "unknown"],
      },
    });
    writeHeartbeats(targetCommsDir, {
      준: {
        agent: "준",
        lastActivity: new Date().toISOString(),
      },
      unknown: {
        id: "unknown",
        agent: "준",
        timestamp: "2026-06-01T00:00:00.000Z",
        address: {
          routingAddress: "준",
          aliases: ["준", "codex", "unknown"],
        },
      },
    });

    const result = await flowDoctorCommand([
      ...baseArgs(
        [
          "--runtime-agent",
          "준",
          "--presence-source-comms-dir",
          sourceCommsDir,
          "--presence-target-comms-dir",
          targetCommsDir,
          "--apply-stale-presence-cleanup",
          "--cleanup-archive-dir",
          archiveDir,
        ],
        { all: false },
      ),
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.lane.stalePresence).toMatchObject({
      status: "applied",
      applied: true,
      prunedHeartbeats: ["unknown"],
    });
    expect(result.data.lane.stalePresence.candidates[0].reason).toContain(
      "stale duplicate",
    );
    expect(
      fs.existsSync(path.join(targetCommsDir, "presence", "준.json")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(targetCommsDir, "presence", "unknown.json")),
    ).toBe(false);
    expect(fs.existsSync(path.join(archiveDir, "unknown.json"))).toBe(true);
    const heartbeats = JSON.parse(
      fs.readFileSync(path.join(targetCommsDir, "heartbeats.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(Object.keys(heartbeats)).toEqual(["준"]);
  });

  it("does not archive the canonical kept lane presence file as a duplicate", async () => {
    const archiveDir = path.join(root, "presence-archive-canonical");
    writePresence(sourceCommsDir, "준", stalePresence("준"));
    writePresence(targetCommsDir, "준", stalePresence("준"));
    writePresence(targetCommsDir, "unknown", freshConsentPresence("준"));

    const result = await flowDoctorCommand([
      ...baseArgs(
        [
          "--runtime-agent",
          "준",
          "--presence-source-comms-dir",
          sourceCommsDir,
          "--presence-target-comms-dir",
          targetCommsDir,
          "--apply-stale-presence-cleanup",
          "--cleanup-archive-dir",
          archiveDir,
        ],
        { all: false },
      ),
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.lane.stalePresence).toMatchObject({
      status: "ready",
      applied: false,
      candidates: [],
      archived: [],
    });
    expect(
      fs.existsSync(path.join(targetCommsDir, "presence", "준.json")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(targetCommsDir, "presence", "unknown.json")),
    ).toBe(true);
    expect(fs.existsSync(archiveDir)).toBe(false);
  });

  it("reports flow supervisors on the owning host instead of running host-incompatible commands", async () => {
    writePresence(sourceCommsDir, "준", freshConsentPresence("준"));
    writePresence(targetCommsDir, "준", freshConsentPresence("준"));

    const result = await flowDoctorCommand([
      "--lane-profile",
      "mac-jun-ssh-tui",
      "--source-comms-dir",
      sourceCommsDir,
      "--target-comms-dir",
      targetCommsDir,
      "--presence-source-comms-dir",
      sourceCommsDir,
      "--presence-target-comms-dir",
      targetCommsDir,
      "--runtime-agent",
      "준",
      "--all",
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe("warn");
    expect(result.data.lane.flowSupervisors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "mac-jun-projection",
          host: "sum-back",
          status: "wrong-host",
          statusCommand: expect.stringContaining("tap-flow-supervisor.sh"),
        }),
        expect.objectContaining({
          id: "mac-jun-uplink",
          host: "sum-back",
          status: "wrong-host",
        }),
      ]),
    );
    expect(result.data.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "inspect-mac-jun-projection-on-sum-back",
          command: expect.stringContaining("mac-jun-projection --status"),
        }),
      ]),
    );
  });

  it("surfaces active-turn state as queued evidence instead of a receiver failure", async () => {
    writePresence(sourceCommsDir, "준", freshConsentPresence("준"));
    writePresence(targetCommsDir, "준", freshConsentPresence("준"));
    writeHeartbeats(sourceCommsDir, {
      준: {
        agent: "준",
        lastActivity: new Date().toISOString(),
        turnStartedAt: new Date().toISOString(),
        activeTurnId: "turn-123",
      },
    });

    const result = await flowDoctorCommand([
      ...baseArgs(
        [
          "--runtime-agent",
          "준",
          "--presence-source-comms-dir",
          sourceCommsDir,
          "--presence-target-comms-dir",
          targetCommsDir,
        ],
        { all: false },
      ),
    ]);

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe("warn");
    expect(result.data.receiver.activeTurn).toMatchObject({
      status: "active",
      queued: true,
      blocked: true,
      activeTurnId: "turn-123",
    });
    expect(result.data.lane.activeTurn).toMatchObject({
      status: "active",
      queued: true,
      blocked: true,
    });
    expect(result.data.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "wait-for-active-turn-idle" }),
      ]),
    );
  });
});
