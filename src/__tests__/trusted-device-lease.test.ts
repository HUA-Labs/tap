import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  checkTrustedDeviceLease,
  checkTrustedDeviceLeaseGate,
  resolveTrustedDeviceLeasesDir,
  type TrustedDeviceLease,
} from "../transport/trusted-device-lease.js";

let tmpDir: string;
let commsDir: string;
let devicesDir: string;

function writeLease(
  name: string,
  overrides: Partial<TrustedDeviceLease> = {},
): string {
  const lease: TrustedDeviceLease = {
    deviceId: "sum-back",
    hostId: "/home/devin/hua-comms",
    label: "sum-back",
    publicKeyHash: "sha256:sum-back",
    tokenHash: null,
    operator: "Devin",
    allowedScopes: ["drive"],
    allowedTargets: ["self-owned"],
    issuedAt: "2026-06-01T00:00:00.000Z",
    expiresAt: "2026-07-01T00:00:00.000Z",
    lastSeenAt: "2026-06-01T00:05:00.000Z",
    revokedAt: null,
    ...overrides,
  };
  const filePath = path.join(devicesDir, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(lease, null, 2), "utf-8");
  return filePath;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tap-device-lease-test-"));
  commsDir = path.join(tmpDir, "hua-comms");
  devicesDir = path.join(commsDir, "devices");
  fs.mkdirSync(devicesDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("trusted device leases", () => {
  it("resolves the default devices directory from TAP_COMMS_DIR", () => {
    expect(resolveTrustedDeviceLeasesDir({ commsDir })).toBe(devicesDir);
  });

  it("accepts a valid Devin-owned device lease by host id", () => {
    const filePath = writeLease("sum-back");

    const result = checkTrustedDeviceLease({
      commsDir,
      hostId: "/home/devin/hua-comms",
      scope: "drive",
      target: "self-owned",
      now: "2026-06-01T00:10:00.000Z",
    });

    expect(result).toMatchObject({
      ok: true,
      reason: null,
      filePath,
      lease: {
        deviceId: "sum-back",
        hostId: "/home/devin/hua-comms",
      },
    });
  });

  it("requires deviceId and hostId to match the same lease when both are supplied", () => {
    writeLease("sum-mac", {
      deviceId: "sum-mac",
      hostId: "/Users/devin/HUA/hua-comms",
    });
    writeLease("windows", {
      deviceId: "windows-home",
      hostId: "D:\\HUA\\hua-comms",
    });

    expect(
      checkTrustedDeviceLease({
        commsDir,
        deviceId: "sum-mac",
        hostId: "/Users/devin/HUA/hua-comms",
        now: "2026-06-01T00:10:00.000Z",
      }),
    ).toMatchObject({
      ok: true,
      lease: {
        deviceId: "sum-mac",
      },
    });

    expect(
      checkTrustedDeviceLease({
        commsDir,
        deviceId: "sum-mac",
        hostId: "D:\\HUA\\hua-comms",
        now: "2026-06-01T00:10:00.000Z",
      }),
    ).toMatchObject({
      ok: false,
      reason: "missing",
    });
  });

  it("fails the cross-device gate when targetDeviceId and targetHostId diverge", () => {
    writeLease("requester", {
      deviceId: "requester",
      hostId: "/home/devin/hua-comms",
    });
    writeLease("sum-mac", {
      deviceId: "sum-mac",
      hostId: "/Users/devin/HUA/hua-comms",
    });
    writeLease("windows", {
      deviceId: "windows-home",
      hostId: "D:\\HUA\\hua-comms",
    });

    expect(
      checkTrustedDeviceLeaseGate({
        commsDir,
        requesterHostId: "/home/devin/hua-comms",
        targetDeviceId: "sum-mac",
        targetHostId: "D:\\HUA\\hua-comms",
        now: "2026-06-01T00:10:00.000Z",
      }),
    ).toMatchObject({
      ok: false,
      reason: "missing",
      message: expect.stringContaining("Target"),
    });
  });

  it("rejects expired and revoked leases", () => {
    writeLease("expired", {
      deviceId: "expired",
      expiresAt: "2026-05-31T00:00:00.000Z",
    });
    expect(
      checkTrustedDeviceLease({
        commsDir,
        deviceId: "expired",
        now: "2026-06-01T00:10:00.000Z",
      }),
    ).toMatchObject({
      ok: false,
      reason: "expired",
    });

    writeLease("revoked", {
      deviceId: "revoked",
      revokedAt: "2026-06-01T00:01:00.000Z",
    });
    expect(
      checkTrustedDeviceLease({
        commsDir,
        deviceId: "revoked",
        now: "2026-06-01T00:10:00.000Z",
      }),
    ).toMatchObject({
      ok: false,
      reason: "revoked",
    });
  });

  it("requires drive scope and self-owned target allowance", () => {
    writeLease("observe-only", {
      deviceId: "observe-only",
      allowedScopes: ["observe"],
    });
    expect(
      checkTrustedDeviceLease({
        commsDir,
        deviceId: "observe-only",
        scope: "drive",
        now: "2026-06-01T00:10:00.000Z",
      }),
    ).toMatchObject({
      ok: false,
      reason: "scope-not-allowed",
    });

    writeLease("wrong-target", {
      deviceId: "wrong-target",
      allowedTargets: ["other-owned"],
    });
    expect(
      checkTrustedDeviceLease({
        commsDir,
        deviceId: "wrong-target",
        target: "self-owned",
        now: "2026-06-01T00:10:00.000Z",
      }),
    ).toMatchObject({
      ok: false,
      reason: "target-not-allowed",
    });
  });

  it("requires requester and cross-device target leases for the gate", () => {
    writeLease("requester", {
      deviceId: "requester",
      hostId: "/home/devin/hua-comms",
    });
    writeLease("target", {
      deviceId: "target",
      hostId: "sum-mac:/Users/devin/HUA/hua-comms",
    });

    expect(
      checkTrustedDeviceLeaseGate({
        commsDir,
        requesterHostId: "/home/devin/hua-comms",
        targetHostId: "sum-mac:/Users/devin/HUA/hua-comms",
        now: "2026-06-01T00:10:00.000Z",
      }),
    ).toMatchObject({
      ok: true,
      requester: {
        lease: {
          deviceId: "requester",
        },
      },
      target: {
        lease: {
          deviceId: "target",
        },
      },
    });

    expect(
      checkTrustedDeviceLeaseGate({
        commsDir,
        requesterHostId: "/home/devin/hua-comms",
        targetHostId: "D:\\HUA\\hua-comms",
        now: "2026-06-01T00:10:00.000Z",
      }),
    ).toMatchObject({
      ok: false,
      reason: "missing",
      message: expect.stringContaining("Target"),
    });
  });
});
