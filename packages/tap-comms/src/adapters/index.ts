import type { RuntimeAdapter, RuntimeName } from "../types.js";
import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";
import { geminiAdapter } from "./gemini.js";

const adapters: Partial<Record<RuntimeName, RuntimeAdapter>> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter,
};

export function getAdapter(runtime: RuntimeName): RuntimeAdapter {
  const adapter = adapters[runtime];
  if (!adapter) {
    throw new Error(
      `Adapter for "${runtime}" is not yet available. ` +
        `Supported: ${Object.keys(adapters).join(", ")}`,
    );
  }
  return adapter;
}

export function listAdapters(): RuntimeName[] {
  return Object.keys(adapters) as RuntimeName[];
}
