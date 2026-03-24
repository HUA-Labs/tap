import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ArtifactKind } from "./types.js";

type BackupPayload =
  | {
      kind: "json-path";
      selector: string;
      existed: boolean;
      value?: unknown;
    }
  | {
      kind: "toml-table";
      selector: string;
      existed: boolean;
      content?: string;
    }
  | {
      kind: "file";
      selector: string;
      existed: boolean;
    };

function selectorHash(selector: string): string {
  return crypto.createHash("sha256").update(selector).digest("hex").slice(0, 12);
}

export function artifactBackupPath(
  backupDir: string,
  kind: ArtifactKind,
  selector: string,
): string {
  const safeKind = kind.replace(/[^a-z-]/gi, "-");
  return path.join(backupDir, `${safeKind}-${selectorHash(selector)}.json`);
}

export function writeArtifactBackup(
  backupPath: string,
  payload: BackupPayload,
): void {
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  const tmp = `${backupPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, backupPath);
}

export function readArtifactBackup(backupPath: string): BackupPayload | null {
  if (!fs.existsSync(backupPath)) return null;

  try {
    const raw = fs.readFileSync(backupPath, "utf-8");
    return JSON.parse(raw) as BackupPayload;
  } catch {
    return null;
  }
}
