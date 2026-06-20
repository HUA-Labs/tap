import { tmpdir } from "node:os";

export const DEFAULT_CODEX_IPC_WINDOWS_PIPE_PATH = String.raw`\\.\pipe\codex-ipc`;

export interface ResolveCodexIpcPathOptions {
  platform?: NodeJS.Platform;
  tmpDir?: string | null;
  uid?: number | null;
  env?: NodeJS.ProcessEnv;
}

function normalizeDirectory(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

export function resolveCodexIpcPath(
  options: ResolveCodexIpcPathOptions = {},
): string {
  const env = options.env ?? process.env;
  const explicit = env.TAP_CODEX_IPC_PATH?.trim();
  if (explicit) return explicit;

  const platform = options.platform ?? process.platform;
  if (platform === "win32") return DEFAULT_CODEX_IPC_WINDOWS_PIPE_PATH;

  if (platform === "darwin") {
    const baseTmp = normalizeDirectory(
      options.tmpDir?.trim() || env.TMPDIR?.trim() || tmpdir(),
    );
    const uid =
      typeof options.uid === "number" && Number.isFinite(options.uid)
        ? options.uid
        : typeof process.getuid === "function"
          ? process.getuid()
          : null;
    if (uid == null) {
      throw new Error("Cannot resolve macOS Codex IPC socket without a uid.");
    }
    return `${baseTmp}/codex-ipc/ipc-${uid}.sock`;
  }

  return DEFAULT_CODEX_IPC_WINDOWS_PIPE_PATH;
}

export function isCodexIpcDefaultSupported(
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32" || platform === "darwin";
}
