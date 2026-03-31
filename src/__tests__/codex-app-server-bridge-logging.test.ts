import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureBridgeLogging,
  createBridgeLogger,
} from "../../../../scripts/bridge/bridge-logging.js";

describe("codex app-server bridge logging", () => {
  afterEach(() => {
    configureBridgeLogging("info");
    vi.restoreAllMocks();
  });

  it("suppresses debug logs above the configured level", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    configureBridgeLogging("info");

    createBridgeLogger("dispatch").debug("hidden message", {
      fileName: "candidate.md",
    });

    expect(logSpy).not.toHaveBeenCalled();
  });

  it("writes debug logs when the bridge log-level is debug", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    configureBridgeLogging("debug");

    createBridgeLogger("routing").debug("candidate scan completed", {
      scanned: 4,
      matched: 1,
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]?.[0]).toContain("DEBUG [routing] candidate scan completed");
    expect(logSpy.mock.calls[0]?.[0]).toContain("scanned=4");
    expect(logSpy.mock.calls[0]?.[0]).toContain("matched=1");
  });

  it("routes warn and error logs to the matching console methods", () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const logger = createBridgeLogger("bridge");

    logger.warn("reconnecting after bridge error", {
      reconnectSeconds: 5,
      threadId: "thread-1",
    });
    logger.error("bridge error", {
      error: "Failed to connect",
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain(
      "WARN [bridge] reconnecting after bridge error",
    );
    expect(warnSpy.mock.calls[0]?.[0]).toContain('threadId="thread-1"');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toContain("ERROR [bridge] bridge error");
    expect(errorSpy.mock.calls[0]?.[0]).toContain('error="Failed to connect"');
  });
});
