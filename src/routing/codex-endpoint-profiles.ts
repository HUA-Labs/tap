const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export type CodexEndpointProfileRole =
  | "public"
  | "direct-local"
  | "upstream"
  | "remote-tui";

export type CodexEndpointProfileMode =
  | "auth-gateway"
  | "direct-no-auth-localhost-only"
  | "upstream-internal"
  | "ssh-forwarded-client";

export type CodexEndpointProfileStability =
  | "target"
  | "compatibility"
  | "custom";

export interface CodexEndpointProfile {
  id: string;
  role: CodexEndpointProfileRole;
  defaultUrl: string;
  mode: CodexEndpointProfileMode;
  operatorVisible: boolean;
  stability: CodexEndpointProfileStability;
  namespace: string;
  description: string;
}

export interface ParsedCodexEndpointUrl {
  raw: string;
  protocol: "ws:" | "wss:";
  hostname: string;
  port: number;
  loopback: boolean;
}

export interface CodexEndpointClassification {
  profile: CodexEndpointProfile | null;
  endpoint: ParsedCodexEndpointUrl | null;
  reason: string;
}

export interface ResolveCodexEndpointProfileOptions {
  profileId?: string;
  requestedUrl?: string | null;
  config?: Record<string, unknown>;
  env?: Record<string, string | undefined>;
}

export type ResolvedCodexEndpointProfile = CodexEndpointProfile & {
  profileId: string;
  requestedProfileId: string;
  resolvedUrl: string | null;
  source: "explicit" | "env" | "config" | "default" | "missing";
  valid: boolean;
  classification: string;
  classifiedProfileId?: string | null;
};

export const CODEX_ENDPOINT_PROFILE_ALIASES: Record<string, string> = {
  "direct-local": "direct-local-main",
};

export const CODEX_APP_SERVER_ENDPOINT_PROFILES: CodexEndpointProfile[] = [
  {
    id: "public-auth-gateway",
    role: "public",
    defaultUrl: "ws://127.0.0.1:4500",
    mode: "auth-gateway",
    operatorVisible: true,
    stability: "target",
    namespace: "canonical-public",
    description:
      "Canonical operator-facing gateway endpoint. Auth protection must only be claimed when the gateway path is actually healthy.",
  },
  {
    id: "public-auth-gateway-compat",
    role: "public",
    defaultUrl: "ws://127.0.0.1:4501",
    mode: "auth-gateway",
    operatorVisible: true,
    stability: "compatibility",
    namespace: "compat-public",
    description:
      "Historical tap public/default endpoint kept as a compatibility alias during migration.",
  },
  {
    id: "direct-local-main",
    role: "direct-local",
    defaultUrl: "ws://127.0.0.1:4510",
    mode: "direct-no-auth-localhost-only",
    operatorVisible: true,
    stability: "target",
    namespace: "direct-local",
    description:
      "Canonical no-auth localhost direct/debug endpoint for the main local profile.",
  },
  {
    id: "direct-local-worker-1",
    role: "direct-local",
    defaultUrl: "ws://127.0.0.1:4511",
    mode: "direct-no-auth-localhost-only",
    operatorVisible: true,
    stability: "target",
    namespace: "direct-local",
    description:
      "Worker/debug no-auth localhost direct endpoint in the 4510+ namespace.",
  },
  {
    id: "direct-local-worker-2",
    role: "direct-local",
    defaultUrl: "ws://127.0.0.1:4512",
    mode: "direct-no-auth-localhost-only",
    operatorVisible: true,
    stability: "target",
    namespace: "direct-local",
    description:
      "Second worker/debug no-auth localhost direct endpoint in the 4510+ namespace.",
  },
  {
    id: "direct-local-compat",
    role: "direct-local",
    defaultUrl: "ws://127.0.0.1:35089",
    mode: "direct-no-auth-localhost-only",
    operatorVisible: true,
    stability: "compatibility",
    namespace: "accidental-compat",
    description:
      "Temporary compatibility alias for the long-lived accidental/random direct app-server port.",
  },
  {
    id: "upstream-app-server",
    role: "upstream",
    defaultUrl: "dynamic loopback/high port",
    mode: "upstream-internal",
    operatorVisible: false,
    stability: "target",
    namespace: "internal-upstream",
    description:
      "Internal Codex app-server endpoint behind a public gateway; random or high ports must stay out of operator commands.",
  },
  {
    id: "remote-tui-forward",
    role: "remote-tui",
    defaultUrl: "profile-configured forwarded endpoint",
    mode: "ssh-forwarded-client",
    operatorVisible: true,
    stability: "target",
    namespace: "remote-forward",
    description:
      "Client-side endpoint used by remote TUI attach aliases; profile config should hide raw forwarded port details.",
  },
];

function cloneProfile(profile: CodexEndpointProfile): CodexEndpointProfile {
  return { ...profile };
}

export function normalizeCodexEndpointProfileId(
  profileId: string | null | undefined,
): string | null {
  if (typeof profileId !== "string" || !profileId.trim()) return null;
  const trimmed = profileId.trim();
  return CODEX_ENDPOINT_PROFILE_ALIASES[trimmed] ?? trimmed;
}

export function listCodexEndpointProfiles(): CodexEndpointProfile[] {
  return CODEX_APP_SERVER_ENDPOINT_PROFILES.map(cloneProfile);
}

export function getCodexEndpointProfile(
  profileId: string | null | undefined,
): CodexEndpointProfile | null {
  const normalized = normalizeCodexEndpointProfileId(profileId);
  if (!normalized) return null;
  const profile =
    CODEX_APP_SERVER_ENDPOINT_PROFILES.find(
      (candidate) => candidate.id === normalized,
    ) ?? null;
  return profile ? cloneProfile(profile) : null;
}

export function parseCodexEndpointUrl(
  url: string | null | undefined,
): ParsedCodexEndpointUrl | null {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    const port = Number(parsed.port);
    if (!["ws:", "wss:"].includes(parsed.protocol) || !Number.isInteger(port)) {
      return null;
    }
    return {
      raw: parsed.toString().replace(/\/$/, ""),
      protocol: parsed.protocol as "ws:" | "wss:",
      hostname: parsed.hostname,
      port,
      loopback: LOOPBACK_HOSTS.has(parsed.hostname),
    };
  } catch {
    return null;
  }
}

export function classifyCodexEndpointUrl(
  url: string | null | undefined,
): CodexEndpointClassification {
  const endpoint = parseCodexEndpointUrl(url);
  if (!endpoint) {
    return {
      profile: null,
      endpoint,
      reason: "invalid-or-missing-url",
    };
  }

  const exact =
    CODEX_APP_SERVER_ENDPOINT_PROFILES.find(
      (profile) => profile.defaultUrl === endpoint.raw,
    ) ?? null;
  if (exact) {
    return {
      profile: cloneProfile(exact),
      endpoint,
      reason: "exact-default-url",
    };
  }

  if (endpoint.loopback && endpoint.port >= 4510 && endpoint.port <= 4599) {
    const direct = getCodexEndpointProfile("direct-local-main")!;
    return {
      profile: {
        ...direct,
        id: "direct-local-custom",
        defaultUrl: endpoint.raw,
        stability: "custom",
      },
      endpoint,
      reason: "direct-local-debug-namespace",
    };
  }

  if (endpoint.loopback) {
    const upstream = getCodexEndpointProfile("upstream-app-server")!;
    return {
      profile: {
        ...upstream,
        defaultUrl: endpoint.raw,
        stability: "custom",
      },
      endpoint,
      reason: "loopback-port-outside-operator-namespace",
    };
  }

  const remote = getCodexEndpointProfile("remote-tui-forward")!;
  return {
    profile: {
      ...remote,
      defaultUrl: endpoint.raw,
      stability: "custom",
    },
    endpoint,
    reason: "non-loopback-explicit-endpoint",
  };
}

function configuredEndpointUrl(
  profileId: string,
  config: Record<string, unknown>,
): string | null {
  const profiles = config.profiles;
  if (profiles && typeof profiles === "object") {
    const entry = (profiles as Record<string, unknown>)[profileId];
    if (entry && typeof entry === "object") {
      const url = (entry as Record<string, unknown>).url;
      if (typeof url === "string") return url;
    }
  }

  const directEntry = config[profileId];
  if (directEntry && typeof directEntry === "object") {
    const url = (directEntry as Record<string, unknown>).url;
    if (typeof url === "string") return url;
  }

  return null;
}

function envEndpointUrl(
  profileId: string,
  env: Record<string, string | undefined>,
): string | null {
  const key = `TAP_CODEX_ENDPOINT_${profileId.toUpperCase().replaceAll("-", "_")}`;
  const value = env[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function resolveCodexEndpointProfile(
  options: ResolveCodexEndpointProfileOptions = {},
): ResolvedCodexEndpointProfile {
  const requestedProfileId = options.profileId ?? "public-auth-gateway";
  const profileId = normalizeCodexEndpointProfileId(requestedProfileId);
  const baseProfile = getCodexEndpointProfile(profileId);
  if (!profileId || !baseProfile) {
    throw new Error(`Unknown Codex endpoint profile: ${requestedProfileId}`);
  }

  const env = options.env ?? process.env;
  const config = options.config ?? {};
  const candidates: Array<
    [ResolvedCodexEndpointProfile["source"], string | null | undefined]
  > = [
    ["explicit", options.requestedUrl],
    ["env", envEndpointUrl(profileId, env)],
    ["config", configuredEndpointUrl(profileId, config)],
    ["default", baseProfile.defaultUrl],
  ];
  const [source, selectedUrl] = candidates.find(
    ([, value]) => typeof value === "string" && value.trim(),
  ) ?? ["missing", null];
  const classified = classifyCodexEndpointUrl(selectedUrl);

  if (!classified.endpoint) {
    return {
      ...baseProfile,
      profileId: baseProfile.id,
      requestedProfileId,
      resolvedUrl: null,
      source,
      valid: false,
      classification: classified.reason,
      classifiedProfileId: null,
      operatorVisible: baseProfile.operatorVisible,
    };
  }

  return {
    ...baseProfile,
    profileId: baseProfile.id,
    requestedProfileId,
    resolvedUrl: classified.endpoint.raw,
    source,
    valid: true,
    classification: classified.reason,
    classifiedProfileId: classified.profile?.id ?? null,
    operatorVisible:
      classified.profile?.operatorVisible ?? baseProfile.operatorVisible,
  };
}
