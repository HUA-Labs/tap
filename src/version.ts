import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const FALLBACK_VERSION = "0.0.0";

export function resolvePackageVersion(
  metaUrl: string = import.meta.url,
): string {
  const moduleDir = path.dirname(fileURLToPath(metaUrl));
  const packageJsonPath = path.join(moduleDir, "..", "package.json");

  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as {
      version?: unknown;
    };
    if (typeof parsed.version === "string" && parsed.version.trim()) {
      return parsed.version;
    }
  } catch {
    // Fall through to the fixed fallback below.
  }

  return FALLBACK_VERSION;
}

export const version = resolvePackageVersion();
