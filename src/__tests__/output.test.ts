import { beforeEach, describe, expect, it, vi } from "vitest";

const logSuccessMock = vi.fn();
const logWarnMock = vi.fn();
const logErrorMock = vi.fn();
const wasWarningLoggedMock = vi.fn();

vi.mock("../utils.js", () => ({
  logSuccess: logSuccessMock,
  logWarn: logWarnMock,
  logError: logErrorMock,
  wasWarningLogged: wasWarningLoggedMock,
}));

const { emitResult } = await import("../output.js");

describe("emitResult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wasWarningLoggedMock.mockReturnValue(false);
  });

  it("dedupes warnings and skips ones already logged during command execution", () => {
    wasWarningLoggedMock.mockImplementation((warning: string) => {
      return warning === "already logged";
    });

    emitResult(
      {
        ok: true,
        command: "status",
        code: "TAP_STATUS_OK",
        message: "ok",
        warnings: ["duplicate", "duplicate", "already logged", "unique"],
        data: {},
      },
      false,
    );

    expect(logWarnMock.mock.calls.map(([warning]) => warning)).toEqual([
      "duplicate",
      "unique",
    ]);
  });
});
