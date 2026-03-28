import { exec } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const MAX_TRAVERSAL_DEPTH = 32;
const WINDOWS_PROCESS_TABLE_COMMAND =
  "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress";

interface ProcessEntry {
  pid: number;
  parentPid: number;
  name: string;
  command: string;
}

async function getWindowsProcessTable(): Promise<Map<number, ProcessEntry>> {
  const processMap = new Map<number, ProcessEntry>();

  try {
    const { stdout } = await execAsync(
      `powershell "${WINDOWS_PROCESS_TABLE_COMMAND}"`,
      {
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    if (!stdout.trim()) {
      return processMap;
    }

    let processes: unknown = JSON.parse(stdout);
    if (!Array.isArray(processes)) {
      processes = [processes];
    }

    for (const processInfo of processes as unknown[]) {
      if (
        !processInfo ||
        typeof processInfo !== "object" ||
        typeof (processInfo as { ProcessId?: unknown }).ProcessId !== "number"
      ) {
        continue;
      }

      const processId = (processInfo as { ProcessId: number }).ProcessId;
      processMap.set(processId, {
        pid: processId,
        parentPid:
          typeof (processInfo as { ParentProcessId?: unknown })
            .ParentProcessId === "number"
            ? ((processInfo as { ParentProcessId: number }).ParentProcessId ??
              0)
            : 0,
        name:
          typeof (processInfo as { Name?: unknown }).Name === "string"
            ? (processInfo as { Name: string }).Name
            : "",
        command:
          typeof (processInfo as { CommandLine?: unknown }).CommandLine ===
          "string"
            ? (processInfo as { CommandLine: string }).CommandLine
            : "",
      });
    }
  } catch {
    return processMap;
  }

  return processMap;
}

async function getUnixProcessInfo(pid: number): Promise<ProcessEntry | null> {
  try {
    const { stdout } = await execAsync(`ps -o ppid=,command= -p ${pid}`);
    const trimmed = stdout.trim();
    if (!trimmed) {
      return null;
    }

    const [parentPidText, ...commandParts] = trimmed.split(/\s+/);
    const parentPid = Number.parseInt(parentPidText ?? "", 10);
    const command = commandParts.join(" ").trim();

    return {
      pid,
      parentPid: Number.isFinite(parentPid) ? parentPid : 0,
      name: path.basename(command.split(" ")[0] ?? ""),
      command,
    };
  } catch {
    return null;
  }
}

async function detectWindowsIdePid(): Promise<number> {
  const processMap = await getWindowsProcessTable();
  const currentProcess = processMap.get(process.pid);

  if (!currentProcess) {
    return process.pid;
  }

  const ancestors: ProcessEntry[] = [];
  let current: ProcessEntry | undefined = currentProcess;

  for (let i = 0; i < MAX_TRAVERSAL_DEPTH && current; i += 1) {
    ancestors.push(current);

    if (current.parentPid === 0 || !processMap.has(current.parentPid)) {
      break;
    }

    current = processMap.get(current.parentPid);
  }

  if (ancestors.length >= 3) {
    return ancestors[ancestors.length - 3]?.pid ?? process.pid;
  }

  return ancestors[ancestors.length - 1]?.pid ?? process.pid;
}

async function detectUnixIdePid(): Promise<number> {
  const shells = new Set([
    "zsh",
    "bash",
    "sh",
    "tcsh",
    "csh",
    "ksh",
    "fish",
    "dash",
  ]);
  let currentPid = process.pid;

  for (let i = 0; i < MAX_TRAVERSAL_DEPTH; i += 1) {
    const processInfo = await getUnixProcessInfo(currentPid);
    if (!processInfo) {
      break;
    }

    if (shells.has(processInfo.name)) {
      let idePid = processInfo.parentPid;
      const grandParentInfo =
        processInfo.parentPid > 1
          ? await getUnixProcessInfo(processInfo.parentPid)
          : null;

      if (grandParentInfo && grandParentInfo.parentPid > 1) {
        idePid = grandParentInfo.parentPid;
      }

      return idePid > 0 ? idePid : currentPid;
    }

    if (processInfo.parentPid <= 1) {
      break;
    }

    currentPid = processInfo.parentPid;
  }

  return currentPid;
}

export async function detectGeminiIdeProcessPid(): Promise<number> {
  const explicitPid = Number.parseInt(process.env.GEMINI_CLI_IDE_PID ?? "", 10);
  if (Number.isFinite(explicitPid) && explicitPid > 0) {
    return explicitPid;
  }

  if (os.platform() === "win32") {
    return detectWindowsIdePid();
  }

  return detectUnixIdePid();
}
