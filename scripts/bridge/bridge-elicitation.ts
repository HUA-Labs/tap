// bridge-elicitation.ts — Auto-respond to MCP elicitation requests in headless mode
//
// Codex app-server sends `mcpServer/elicitation/request` as a JSON-RPC request
// (with `id`) when an MCP tool needs user approval. In headless mode there is
// no human to answer, so the bridge auto-accepts form-style elicitations and
// cancels URL-style ones.
//
// Ported from 윤's dist hotfix (2026-04-09, Gen 32).

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function hasObjectShape(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

interface ElicitationParams {
  requestedSchema?: Record<string, unknown>;
  mode?: string;
  url?: string;
}

function isElicitationParams(value: unknown): value is ElicitationParams {
  if (!hasObjectShape(value)) {
    return false;
  }

  return "requestedSchema" in value || "mode" in value || "url" in value;
}

// ---------------------------------------------------------------------------
// Param resolution — elicitation params may be nested
// ---------------------------------------------------------------------------

function resolveElicitationParams(raw: unknown): ElicitationParams | null {
  if (!hasObjectShape(raw)) {
    return null;
  }

  const queue: unknown[] = [raw];
  const visited = new Set<unknown>();

  while (queue.length > 0) {
    const candidate = queue.shift();
    if (candidate == null || visited.has(candidate)) {
      continue;
    }
    visited.add(candidate);

    if (isElicitationParams(candidate)) {
      return candidate;
    }

    if (!hasObjectShape(candidate)) {
      continue;
    }

    for (const key of ["params", "request", "payload", "elicitation"]) {
      const nested = (candidate as Record<string, unknown>)[key];
      if (nested != null) {
        queue.push(nested);
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Schema-aware value builders
// ---------------------------------------------------------------------------

function firstEnumValue(values: unknown): string | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }

  for (const entry of values) {
    if (typeof entry === "string") {
      return entry;
    }
    if (hasObjectShape(entry) && typeof entry.const === "string") {
      return entry.const;
    }
  }

  return undefined;
}

function buildRequiredStringValue(schema: Record<string, unknown>): string {
  return typeof schema.title === "string" && schema.title.trim()
    ? schema.title.trim()
    : "approved";
}

function buildElicitationFieldValue(
  schema: Record<string, unknown>,
  required: boolean,
): unknown {
  const defaultValue = schema.default;
  if (
    typeof defaultValue === "string" ||
    typeof defaultValue === "number" ||
    typeof defaultValue === "boolean"
  ) {
    return defaultValue;
  }
  if (
    Array.isArray(defaultValue) &&
    defaultValue.every((entry) => typeof entry === "string")
  ) {
    return defaultValue;
  }

  const type = typeof schema.type === "string" ? schema.type : null;

  if (type === "boolean") {
    return true;
  }

  if (type === "number" || type === "integer") {
    return typeof schema.minimum === "number" ? schema.minimum : 0;
  }

  if (type === "string") {
    return (
      firstEnumValue(schema.enum) ??
      firstEnumValue(schema.anyOf) ??
      (required ? buildRequiredStringValue(schema) : "")
    );
  }

  if (type === "array") {
    const minItems =
      typeof schema.minItems === "number" ? schema.minItems : undefined;
    const itemSchema = hasObjectShape(schema.items) ? schema.items : {};
    const itemValue =
      firstEnumValue(itemSchema.enum) ?? firstEnumValue(itemSchema.anyOf);
    if (itemValue) {
      return required || (minItems ?? 0) > 0 ? [itemValue] : [];
    }
    return [];
  }

  return (
    firstEnumValue(schema.enum) ?? firstEnumValue(schema.anyOf) ?? undefined
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function isAutoElicitationRequestMethod(method: string): boolean {
  return (
    method === "elicitation/create" ||
    method === "mcpServer/elicitation/request"
  );
}

export interface ElicitationResult {
  action: "accept" | "cancel";
  content?: Record<string, unknown>;
}

export function buildAutoElicitationResult(
  rawParams: unknown,
): ElicitationResult | null {
  const params = resolveElicitationParams(rawParams);
  if (!params) {
    return null;
  }

  // URL-style elicitation: cancel (we can't open a browser in headless)
  if (params.mode === "url" || typeof params.url === "string") {
    return { action: "cancel" };
  }

  const requestedSchema = hasObjectShape(params.requestedSchema)
    ? params.requestedSchema
    : null;
  if (!requestedSchema) {
    return { action: "accept" };
  }

  const properties = hasObjectShape(requestedSchema.properties)
    ? requestedSchema.properties
    : {};
  const required = new Set(
    Array.isArray(requestedSchema.required)
      ? requestedSchema.required.filter(
          (entry: unknown) => typeof entry === "string",
        )
      : [],
  );

  const content: Record<string, unknown> = {};
  for (const [field, schema] of Object.entries(properties)) {
    if (!hasObjectShape(schema)) {
      continue;
    }
    const value = buildElicitationFieldValue(
      schema as Record<string, unknown>,
      required.has(field),
    );
    if (value !== undefined) {
      content[field] = value;
    }
  }

  return Object.keys(content).length > 0
    ? { action: "accept", content }
    : { action: "accept" };
}
