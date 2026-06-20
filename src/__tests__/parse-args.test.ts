import { describe, expect, it } from "vitest";
import { parseArgs } from "../utils.js";

// M392 P2-1: parseArgs must support both `--key value` and `--key=value`
// forms. Help text and operator docs use the `=` form for value-bearing
// flags; before this fix those calls silently parsed as
// `flags["key=value"] = true`, dropping the value.

describe("parseArgs", () => {
  it("parses bare boolean flags", () => {
    const { flags } = parseArgs(["--no-server"]);
    expect(flags["no-server"]).toBe(true);
  });

  it("parses space-separated value flags", () => {
    const { flags } = parseArgs(["--busy-mode", "steer"]);
    expect(flags["busy-mode"]).toBe("steer");
  });

  it("parses `--key=value` form", () => {
    const { flags } = parseArgs(["--instance-id-suffix=abc123"]);
    expect(flags["instance-id-suffix"]).toBe("abc123");
  });

  it("parses `--key=value` with multiple `=` (split on first only)", () => {
    const { flags } = parseArgs(["--app-server-url=ws://host:4501/path?x=1"]);
    expect(flags["app-server-url"]).toBe("ws://host:4501/path?x=1");
  });

  it("parses `--key=` as empty string value", () => {
    const { flags } = parseArgs(["--routing-slot="]);
    expect(flags["routing-slot"]).toBe("");
  });

  it("collects positional args", () => {
    const { positional } = parseArgs(["start", "codex", "--agent-name", "진"]);
    expect(positional).toEqual(["start", "codex"]);
  });

  it("handles single-dash bare flags", () => {
    const { flags } = parseArgs(["-h"]);
    expect(flags["h"]).toBe(true);
  });

  it("does not consume next `--flag` as value (boolean fallback)", () => {
    const { flags } = parseArgs(["--no-server", "--no-auth"]);
    expect(flags["no-server"]).toBe(true);
    expect(flags["no-auth"]).toBe(true);
  });

  it("mixes `--key=value` and `--key value` in same call", () => {
    const { positional, flags } = parseArgs([
      "start",
      "codex",
      "--instance-id-suffix=xyz789",
      "--busy-mode",
      "wait",
      "--no-server",
    ]);
    expect(positional).toEqual(["start", "codex"]);
    expect(flags["instance-id-suffix"]).toBe("xyz789");
    expect(flags["busy-mode"]).toBe("wait");
    expect(flags["no-server"]).toBe(true);
  });
});
