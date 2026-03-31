// bridge-logging.ts — Structured bridge logging with scoped levels

import { LogLevel } from "./bridge-types.js";

export type LogContext = Record<string, unknown>;

export interface BridgeLogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let currentLogLevel: LogLevel = "info";

export function configureBridgeLogging(level: LogLevel): void {
  currentLogLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLogLevel];
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  if (value === null) {
    return "null";
  }

  return JSON.stringify(value);
}

function formatContext(context?: LogContext): string {
  if (!context) {
    return "";
  }

  const entries = Object.entries(context).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) {
    return "";
  }

  return ` ${entries
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(" ")}`;
}

export function logBridge(
  level: LogLevel,
  message: string,
  context?: LogContext,
): void {
  if (!shouldLog(level)) {
    return;
  }

  const ts = new Date().toISOString().replace("T", " ").replace("Z", " UTC");
  const line = `[${ts}] ${level.toUpperCase()} ${message}${formatContext(context)}`;

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}

export function createBridgeLogger(scope: string): BridgeLogger {
  const scopedMessage = (message: string) => `[${scope}] ${message}`;

  return {
    debug(message, context) {
      logBridge("debug", scopedMessage(message), context);
    },
    info(message, context) {
      logBridge("info", scopedMessage(message), context);
    },
    warn(message, context) {
      logBridge("warn", scopedMessage(message), context);
    },
    error(message, context) {
      logBridge("error", scopedMessage(message), context);
    },
  };
}
