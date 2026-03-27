export const TAP_MCP_SERVER_KEY = "tap";
export const LEGACY_TAP_MCP_SERVER_KEY = "tap-comms";

export function getJsonMcpServerSelector(
  key: string = TAP_MCP_SERVER_KEY,
): string {
  return `mcpServers.${key}`;
}

export function getCodexMcpSelector(
  key: string = TAP_MCP_SERVER_KEY,
): string {
  return `mcp_servers.${key}`;
}

export function getCodexEnvSelector(
  key: string = TAP_MCP_SERVER_KEY,
): string {
  return `mcp_servers.${key}.env`;
}

export function readNestedKey(
  obj: Record<string, unknown>,
  keyPath: string,
): unknown {
  let current: unknown = obj;
  for (const key of keyPath.split(".")) {
    if (typeof current !== "object" || current === null || !(key in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function setNestedKey(
  obj: Record<string, unknown>,
  keyPath: string,
  value: unknown,
): void {
  const keys = keyPath.split(".");
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (typeof current[key] !== "object" || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

export function deleteNestedKey(
  obj: Record<string, unknown>,
  keyPath: string,
): boolean {
  const keys = keyPath.split(".");
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (typeof current[key] !== "object" || current[key] === null) {
      return false;
    }
    current = current[key] as Record<string, unknown>;
  }

  const lastKey = keys[keys.length - 1];
  if (!(lastKey in current)) return false;
  delete current[lastKey];
  return true;
}

export function cleanEmptyParents(
  obj: Record<string, unknown>,
  keyPath: string,
): void {
  const keys = keyPath.split(".");
  for (let depth = keys.length - 2; depth >= 0; depth--) {
    let current = obj;
    for (let i = 0; i < depth; i++) {
      current = current[keys[i]] as Record<string, unknown>;
      if (!current) return;
    }

    const key = keys[depth];
    const value = current[key];
    if (
      typeof value === "object" &&
      value !== null &&
      Object.keys(value).length === 0
    ) {
      delete current[key];
    }
  }
}
