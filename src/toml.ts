function splitLines(content: string): string[] {
  return content.replace(/\r\n/g, "\n").split("\n");
}

function tableHeader(selector: string): string {
  return `[${selector}]`;
}

function findTableRange(
  lines: string[],
  selector: string,
): { start: number; end: number } | null {
  const header = tableHeader(selector);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== header) continue;

    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const trimmed = lines[j].trim();
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        end = j;
        break;
      }
    }
    return { start: i, end };
  }
  return null;
}

function escapeBasicString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function renderValue(value: string | string[]): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => `"${escapeBasicString(item)}"`).join(", ")}]`;
  }
  return `"${escapeBasicString(value)}"`;
}

export function extractTomlTable(
  content: string,
  selector: string,
): string | null {
  const lines = splitLines(content);
  const range = findTableRange(lines, selector);
  if (!range) return null;
  return `${lines.slice(range.start, range.end).join("\n")}\n`;
}

export function removeTomlTable(content: string, selector: string): string {
  const lines = splitLines(content);
  const range = findTableRange(lines, selector);
  if (!range) return content;

  const next = [...lines.slice(0, range.start), ...lines.slice(range.end)];
  return `${trimTomlDocument(next.join("\n"))}\n`;
}

export function replaceTomlTable(
  content: string,
  selector: string,
  replacement: string,
): string {
  const lines = splitLines(content);
  const range = findTableRange(lines, selector);
  const replacementLines = replacement.replace(/\r\n/g, "\n").trimEnd().split("\n");

  if (!range) {
    const doc = trimTomlDocument(content);
    if (!doc) return `${replacement.trimEnd()}\n`;
    return `${doc}\n\n${replacement.trimEnd()}\n`;
  }

  const next = [
    ...lines.slice(0, range.start),
    ...replacementLines,
    ...lines.slice(range.end),
  ];
  return `${trimTomlDocument(next.join("\n"))}\n`;
}

export function renderTomlTable(
  selector: string,
  entries: Record<string, string | string[]>,
  existingContent?: string | null,
): string {
  const preserved = parseTomlAssignments(existingContent ?? "");
  const merged: Record<string, string | string[]> = { ...preserved, ...entries };

  const lines = [tableHeader(selector)];
  for (const [key, value] of Object.entries(merged)) {
    lines.push(`${key} = ${renderValue(value)}`);
  }
  return `${lines.join("\n")}\n`;
}

export function parseTomlAssignments(
  tableContent: string,
): Record<string, string | string[]> {
  const lines = splitLines(tableContent);
  const values: Record<string, string | string[]> = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || (line.startsWith("[") && line.endsWith("]"))) {
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    const value = rawValue.trim();

    if (value.startsWith("[") && value.endsWith("]")) {
      const items = value
        .slice(1, -1)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .map(unquoteTomlString);
      values[key] = items;
      continue;
    }

    values[key] = unquoteTomlString(value);
  }

  return values;
}

export function trimTomlDocument(content: string): string {
  return content.replace(/\s+$/g, "").replace(/\n{3,}/g, "\n\n");
}

function unquoteTomlString(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    const inner = value.slice(1, -1);
    return value.startsWith('"')
      ? inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\")
      : inner;
  }
  return value;
}
