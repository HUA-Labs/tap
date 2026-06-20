import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));

// Each test file imports this module in its own module scope, so this
// suffix is unique per file — prevents parallel-execution race conditions
// on the shared filesystem when Vitest runs files concurrently.
const _suffix = randomBytes(4).toString("hex");

export const TEST_DIR = join(TESTS_DIR, `.test-tmp-${_suffix}`);

export function setTestEnv() {
  delete process.env.TAP_STATE_DIR;
  delete process.env.TAP_INSTANCE_ID;
  delete process.env.TAP_BRIDGE_INSTANCE_ID;
  delete process.env.CODEX_TAP_AGENT_NAME;
  delete process.env.CODEX_THREAD_ID;
  delete process.env.CLAUDE_PLUGIN_ROOT;
  delete process.env.TAP_CLAUDE_CHANNEL_PUSH;
  delete process.env.TAP_RUNTIME_STATE_DIR;
  delete process.env.TAP_ROUTING_SLOT;
  process.env.TAP_COMMS_DIR = TEST_DIR;
  process.env.TAP_AGENT_ID = "codex_1";
  process.env.TAP_AGENT_NAME = "담";
  process.env.TAP_CHANNEL_LOG_PATH = join(TEST_DIR, "logs", "tap-mcp.log");
}

export function resetTestDir() {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
}
