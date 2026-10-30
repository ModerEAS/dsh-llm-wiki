/**
 * Minimal structural types for the DeepSeek Harness (DSH) cordis plugin API.
 *
 * These mirror the shapes verified against the DSH 0.2.1-rc.3 implementation
 * (see docs/dsh.md). They are intentionally structural — not imported from
 * `@deepseek-ai/*` packages — so this plugin typechecks and unit-tests
 * without a live Harness. At runtime `apply()` receives the real cordis
 * context; every access below is defensive (`?.`) so the plugin degrades
 * instead of throwing on profiles that lack an optional service.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Recursively drop `undefined`/functions so tool values survive DSH's JSON snapshot. */
export function sanitizeJson<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, entry) => (typeof entry === "function" ? undefined : entry)),
  ) as T;
}

export interface DshMessageSource {
  kind: string;
  [key: string]: JsonValue | undefined;
}

export interface DshAgent {
  session: { id: string; header?: Record<string, unknown> };
  ctx?: {
    on?: (event: string, listener: (...args: never[]) => unknown) => () => void;
    effect?: (fn: () => unknown) => () => void;
  };
  inject?: (input: unknown) => unknown;
  followup?: (input: unknown) => unknown;
  steer?: (input: unknown) => unknown;
  [key: string]: unknown;
}

/** Waterfall decision for `agent/pre-step`. `messages` is a REPLACEMENT. */
export interface PreStepDecision {
  kind: "enter" | "reject";
  messages?: unknown[];
  startsRequestSeries?: boolean;
}

export interface DshContext {
  tools?: {
    register?: (definition: DshToolDefinition) => unknown;
    get?: (name: string) => unknown;
    guard?: (fn: (exec: DshToolExec) => string | undefined) => () => void;
    restrict?: (...args: unknown[]) => unknown;
  };
  agents?: {
    list?: () => DshAgent[];
    get?: (sessionId: string) => DshAgent | undefined;
  };
  systemPrompt?: {
    section?: (spec: {
      name: string;
      order?: number;
      text: string | ((ctx: unknown) => string);
      interpolate?: boolean;
      complete?: boolean;
    }) => unknown;
    context?: (spec: {
      name: string;
      order?: number;
      text: string | ((ctx: unknown) => string);
    }) => unknown;
  };
  commands?: {
    register?: (spec: {
      name: string;
      description: string;
      definitionId?: string;
      input?: { hint?: string };
      recordInput?: boolean;
      handler: (invocation: {
        agent: DshAgent;
        rawInput: string;
        signal?: AbortSignal;
      }) => unknown | Promise<unknown>;
    }) => unknown;
  };
  slots?: {
    inject?: (ownerKey: string, register: () => unknown) => unknown;
    register?: (...args: unknown[]) => unknown;
  };
  settings?: {
    configure?: (...args: unknown[]) => unknown;
  };
  logger?: {
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
    debug?: (message: string) => void;
  };
  llm?: {
    stream?: (options: Record<string, unknown>) => AsyncIterable<Record<string, unknown>>;
    prepareCall?: (...args: unknown[]) => unknown;
    listProviders?: () => unknown[];
  };
  subagents?: {
    startActivation?: (spec: Record<string, unknown>) => Promise<{
      childId: string;
      result: Promise<{
        output?: Array<{ type?: string; text?: string }>;
        stopReason?: string;
        structured?: unknown;
      }>;
      dispose: () => Promise<void>;
    }>;
    list?: () => string[];
  };
  subprocess?: {
    spawn?: (spec: Record<string, unknown>) => {
      done?: Promise<unknown>;
      terminate?: () => void;
      [key: string]: unknown;
    };
  };
  jobs?: {
    start?: (spec: Record<string, unknown>) => string;
    kill?: (id: string, ...rest: unknown[]) => unknown;
  };
  workingDirectory?: {
    get?: (session: unknown) => string;
  };
  sessionProjections?: {
    stateOf?: (session: unknown, key: string) => unknown;
  };
  tokenMeter?: {
    estimateMessage?: (message: unknown) => number;
    pressure?: (...args: unknown[]) => unknown;
  };
  on?: (event: string, listener: (...args: never[]) => unknown) => () => void;
  effect?: (fn: () => unknown, label?: string) => () => void;
  interval?: (fn: () => void, ms: number) => () => void;
  fiber?: { uid: number | null };
  [key: string]: unknown;
}

export interface DshToolExec {
  name?: string;
  arguments?: Record<string, unknown>;
  signal?: AbortSignal;
  agent?: DshAgent;
  callId?: string;
  deferContext?: (context: unknown) => void;
  concludeTurn?: () => void;
  [key: string]: unknown;
}

/** DSH `defineTool` shape (dsh-tools contract): value in, rendered text out. */
export interface DshToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, DshParameterSpec>;
  output: {
    schema: Record<string, unknown>;
    render: (
      args: Record<string, unknown>,
      value: WikiToolValue,
    ) => Array<{ type: "text"; text: string }>;
  };
  execute: (args: Record<string, unknown>, exec: DshToolExec) => Promise<WikiToolValue>;
  timeoutMs?: number;
  isConcurrencySafe?: boolean;
}

export interface DshParameterSpec {
  type: "string" | "number" | "integer" | "boolean" | "json" | "array" | "object";
  required?: boolean;
  description?: string;
  default?: JsonValue;
  items?: DshParameterSpec;
  properties?: Record<string, DshParameterSpec>;
}

/**
 * Uniform wiki tool envelope (DECISIONS A5): human-readable `text` for the
 * model transcript, optional structured `data` for UI/data reuse.
 */
export interface WikiToolValue {
  text: string;
  data?: JsonValue;
}
