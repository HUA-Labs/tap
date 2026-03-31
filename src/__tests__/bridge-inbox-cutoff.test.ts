import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Inline the function under test since it lives in scripts/bridge/ (not the package)
// and we want to verify the cutoff priority logic without importing the full bridge.
function getGeneralInboxCutoff(
  stateDir: string,
  lookbackMinutes: number,
  processExistingMessages: boolean,
): Date {
  if (processExistingMessages) {
    return new Date(0);
  }

  const lookbackCutoff =
    lookbackMinutes > 0
      ? new Date(Date.now() - lookbackMinutes * 60_000)
      : null;

  const cutoffPath = path.join(stateDir, "general-inbox-cutoff.txt");
  if (fs.existsSync(cutoffPath)) {
    try {
      const saved = new Date(fs.readFileSync(cutoffPath, "utf8").trim());
      if (!isNaN(saved.getTime())) {
        if (lookbackCutoff && lookbackCutoff > saved) {
          return lookbackCutoff;
        }
        return saved;
      }
    } catch {
      // fall through
    }
  }

  if (lookbackCutoff) {
    return lookbackCutoff;
  }

  const cutoff = new Date();
  fs.writeFileSync(cutoffPath, `${cutoff.toISOString()}\n`, "utf8");
  return cutoff;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-cutoff-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("getGeneralInboxCutoff", () => {
  it("returns epoch when processExistingMessages is true", () => {
    const cutoff = getGeneralInboxCutoff(tmpDir, 10, true);
    expect(cutoff.getTime()).toBe(0);
  });

  it("uses lookback window when no saved cutoff exists", () => {
    const before = Date.now() - 10 * 60_000;
    const cutoff = getGeneralInboxCutoff(tmpDir, 10, false);
    const after = Date.now() - 10 * 60_000;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before);
    expect(cutoff.getTime()).toBeLessThanOrEqual(after + 1000);
  });

  it("prefers saved cutoff over lookback when saved is more recent", () => {
    // Saved cutoff = 2 minutes ago (more recent than 10-minute lookback)
    const twoMinutesAgo = new Date(Date.now() - 2 * 60_000);
    fs.writeFileSync(
      path.join(tmpDir, "general-inbox-cutoff.txt"),
      `${twoMinutesAgo.toISOString()}\n`,
    );
    const cutoff = getGeneralInboxCutoff(tmpDir, 10, false);
    expect(cutoff.getTime()).toBe(twoMinutesAgo.getTime());
  });

  it("uses lookback when saved cutoff is older than lookback window", () => {
    // Saved cutoff = 60 minutes ago (older than 10-minute lookback)
    const sixtyMinutesAgo = new Date(Date.now() - 60 * 60_000);
    fs.writeFileSync(
      path.join(tmpDir, "general-inbox-cutoff.txt"),
      `${sixtyMinutesAgo.toISOString()}\n`,
    );
    const before = Date.now() - 10 * 60_000;
    const cutoff = getGeneralInboxCutoff(tmpDir, 10, false);
    // Should use lookback (10min ago), not saved (60min ago)
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("prevents message flood on restart — saved cutoff blocks old messages", () => {
    // Simulate: bridge ran for a while, cutoff was saved at 1 minute ago
    const oneMinuteAgo = new Date(Date.now() - 1 * 60_000);
    fs.writeFileSync(
      path.join(tmpDir, "general-inbox-cutoff.txt"),
      `${oneMinuteAgo.toISOString()}\n`,
    );
    // On restart with default 10-minute lookback, should use saved (1min ago)
    // not lookback (10min ago) — preventing 9 minutes of old messages
    const cutoff = getGeneralInboxCutoff(tmpDir, 10, false);
    expect(cutoff.getTime()).toBe(oneMinuteAgo.getTime());
  });
});
