/**
 * Uniform tool envelope + error boundary + details sanitizer (A5/H06/H22).
 *
 * - Every wiki tool returns `{ text, data? }`: `render()` only reads `text`,
 *   while lint/status/search/recall additionally fill structured `data`.
 * - The pi codebase signals failure with `return { …, isError: true }`
 *   WITHOUT throwing. DSH's success path hardcodes `isError: false` and a
 *   subagent treats such a result as success and stops. So at the port
 *   boundary `isError === true` becomes a thrown `Error` (or an explicit
 *   error return the caller asked for): the failure stays visible.
 * - `details` payloads routinely carry `undefined`/non-JSON values; wash
 *   them before the DSH snapshot or the whole call fails with
 *   ToolOutputError / loses UI metadata.
 */
import { type JsonValue, sanitizeJson, type WikiToolValue } from "./types.js";

export interface PiStyleResult {
  content?: Array<{ type?: string; text?: string }>;
  details?: Record<string, unknown>;
  isError?: boolean;
}

export class WikiToolError extends Error {
  readonly data: JsonValue;
  constructor(message: string, data?: JsonValue) {
    super(message);
    this.name = "WikiToolError";
    this.data = sanitizeJson(data ?? { error: message });
  }
}

/** Build the `{ text, data }` envelope from a pi-style tool result. */
export function toEnvelope(result: PiStyleResult): WikiToolValue {
  const text = (result.content ?? [])
    .map((block) => (typeof block?.text === "string" ? block.text : ""))
    .join("\n");
  const data = sanitizeJson((result.details ?? {}) as JsonValue);
  return { text, data };
}

/**
 * Port-boundary error normalization: `isError === true` throws so DSH (and
 * any supervising subagent) observes a failure instead of a success-shaped
 * value. Pass `{ throwOnError: false }` only for tools whose contract
 * documents a soft-failure envelope.
 */
export function boundary(result: PiStyleResult, opts?: { throwOnError?: boolean }): WikiToolValue {
  if (result.isError && opts?.throwOnError !== false) {
    const envelope = toEnvelope(result);
    throw new WikiToolError(envelope.text || "wiki tool failed", envelope.data);
  }
  return toEnvelope(result);
}

/** DSH `output.render`: the model transcript reads `text` only. */
export function renderEnvelope(
  _args: Record<string, unknown>,
  value: WikiToolValue,
): Array<{ type: "text"; text: string }> {
  return [{ type: "text", text: value.text }];
}

/** DSH `output.schema` for the uniform envelope (stable, versioned once). */
export const ENVELOPE_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["text"],
  properties: {
    text: { type: "string" },
    data: { type: "object" },
  },
};
