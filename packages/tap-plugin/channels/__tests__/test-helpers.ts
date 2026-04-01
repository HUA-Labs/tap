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
  process.env.TAP_COMMS_DIR = TEST_DIR;
  process.env.TAP_AGENT_ID = "codex_1";
  process.env.TAP_AGENT_NAME = "담";
}

export function resetTestDir() {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
}
