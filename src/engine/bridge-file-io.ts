import * as fs from "node:fs";
import * as path from "node:path";

const APP_SERVER_AUTH_FILE_MODE = 0o600;

export function writeProtectedTextFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, content, {
    encoding: "utf-8",
    mode: APP_SERVER_AUTH_FILE_MODE,
  });
  fs.chmodSync(tmp, APP_SERVER_AUTH_FILE_MODE);
  fs.renameSync(tmp, filePath);
  fs.chmodSync(filePath, APP_SERVER_AUTH_FILE_MODE);
}

export function removeFileIfExists(filePath: string | null | undefined): void {
  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }

  try {
    fs.unlinkSync(filePath);
  } catch {
    // Best-effort cleanup only.
  }
}

export function toPowerShellSingleQuotedString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function toPowerShellStringArrayLiteral(values: string[]): string {
  return `@(${values.map(toPowerShellSingleQuotedString).join(", ")})`;
}
