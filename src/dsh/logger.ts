/**
 * Host logger adapter (H24).
 *
 * The pi extension reports important warnings via `console.warn` (doubled
 * dotdir migration skipped, QMD index recovery failed). Inside the DeepSeek
 * desktop app those land in the Electron main-process stdout — invisible in
 * chat and settings. Route them through the host `ctx.logger` (queryable
 * logs) and, for severe cases, let callers add a human-readable session
 * report on top. Never throws: logging must not break the caller.
 */
import type { DshContext } from "./types.js";

export interface WikiLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export function createLogger(ctx: DshContext | undefined): WikiLogger {
  const fallback = (level: "info" | "warn" | "error", message: string): void => {
    try {
      // Local/dev fallback only — the DSH desktop path goes through ctx.logger.
      console[level](`[llm-wiki] ${message}`);
    } catch {
      /* logging must never throw */
    }
  };
  return {
    info: (message) => {
      try {
        ctx?.logger?.info?.(`[llm-wiki] ${message}`);
      } catch {
        /* fall through */
      }
      if (!ctx?.logger?.info) fallback("info", message);
    },
    warn: (message) => {
      try {
        ctx?.logger?.warn?.(`[llm-wiki] ${message}`);
      } catch {
        /* fall through */
      }
      if (!ctx?.logger?.warn) fallback("warn", message);
    },
    error: (message) => {
      try {
        ctx?.logger?.error?.(`[llm-wiki] ${message}`);
      } catch {
        /* fall through */
      }
      if (!ctx?.logger?.error) fallback("error", message);
    },
  };
}
