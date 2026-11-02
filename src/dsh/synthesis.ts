/**
 * Synthesis lane for DSH (H03/H13/H16/H23): subagents + `ctx.llm.stream`,
 * no apiKey, no pi-agent-core bundle, dedicated preset for commit tools.
 *
 * The pi extension synthesizes wiki pages by resolving the provider apiKey
 * and driving the model itself (`resolveModel` + `runAgentLoop` from
 * `pi-agent-core`). DSH never hands the apiKey to plugins — only
 * `ctx.llm.stream` — and ships no `pi-agent-core`. So synthesis here is:
 *
 * 1. Preferred: `ctx.subagents.startActivation` with `delivery: 'caller'`
 *    (no parent-session notification) and a **synthesis-only preset**
 *    (`SYNTHESIS_PRESET_ID`) whose toolset is pinned to reader tools plus
 *    the commit tool the child uses to hand back structured pages. The main
 *    session's standard preset never gains the commit tool, so the primary
 *    agent cannot misfire it (H13). If that preset is not registered yet,
 *    we retry without `agentPreset` (JSON `outputSchema` handoff still works
 *    for ingest — the prompt forbids calling commit tools).
 * 2. Fallback: a minimal single-shot `ctx.llm.stream` call with an explicit
 *    provider/model (from the request override or the parent agent options).
 *    `prepareCall` is awaited; floating rejections must not become fatal
 *    fiber crashes. A failed synthesis is ALWAYS surfaced as an error; the
 *    lane never silently degrades to "please write the pages by hand".
 */

import type { WikiLogger } from "./logger.js";
import type { DshAgent, DshContext } from "./types.js";

/**
 * Preset id used for synthesis child agents. It must exist in the profile
 * with a pinned toolset: vault readers + `wiki_commit_synthesis`. Declared
 * here (not invented per call) so reviewers can audit exactly which tools
 * a background child may touch.
 */
export const SYNTHESIS_PRESET_ID = "llm-wiki-synthesis";

/** Tools the synthesis child may call — readers plus the commit handoff. */
export const SYNTHESIS_PRESET_TOOLS = [
  "wiki_search",
  "wiki_recall",
  "wiki_ensure_page",
  "wiki_commit_synthesis",
] as const;

/** DSH structured-output subset rejects keywords like minLength. Strip them. */
const DSH_SCHEMA_STRIP = new Set([
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "default",
  "examples",
  "$schema",
  "$id",
]);

export function toDshOutputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== "object") return value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (DSH_SCHEMA_STRIP.has(key)) continue;
      out[key] = walk(child);
    }
    return out;
  };
  return walk(schema) as Record<string, unknown>;
}

export interface SynthesisRequest {
  prompt: string;
  cwd?: string;
  outputSchema?: Record<string, unknown>;
  timeoutMs?: number;
  maxDepth?: number;
  /** Per-call model override as `{ provider, model }` (issue #69 lane). */
  agentOptions?: { provider?: string; model?: string };
  /**
   * Detached background synthesis (T5.3/H28): skip the parent-bound
   * subagent lane entirely and use `ctx.llm.stream` directly. A subagent
   * child is disposed with its parent (`drainDescendants`), so archiving
   * the origin chat mid-synthesis aborts it; `llm.stream` runs in the
   * plugin fiber and survives. Callers should set this when the parent is
   * already known-gone at drain time.
   */
  detached?: boolean;
}

export interface SynthesisResult {
  text: string;
  structured?: unknown;
  lane: "subagent" | "llm-stream";
}

function blocksToText(output: Array<{ type?: string; text?: string }> | undefined): string {
  return (output ?? [])
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

/**
 * True when a subagent failure means the parent is gone (archive/stop):
 * retrying another parent-bound child would abort the same way — fall
 * straight through to the detached `llm.stream` lane.
 */
export function isParentGoneError(message: string): boolean {
  return /abort|dispos|parent.*unavailable|exact live parent|UNAUTHORIZED|ACTIVATION_CLOSING|was stopped|closing/i.test(
    message,
  );
}

/**
 * Capture the llm route synchronously while the origin is still alive
 * (T5.3/H28). Callers launching background work must snapshot at dispatch
 * time — reading `parent.options` after an await risks a disposed parent
 * whose options are gone, leaving the `llm.stream` fallback with no route.
 */
export function snapshotLlmRoute(
  parent: DshAgent | undefined,
  req: SynthesisRequest,
): { provider?: string; model?: string } {
  return resolveRoute(parent, req);
}

/** Live-parent check via the agents registry when available. Defensive:
 * missing service means "unknown", not "gone" — callers still try the
 * subagent lane and rely on the abort fallback. */
export function isParentLive(ctx: DshContext, parent: DshAgent | undefined): boolean {
  if (!parent) return false;
  try {
    const get = ctx.agents?.get;
    if (typeof get !== "function") return true;
    const sessionId = parent.session?.id;
    if (!sessionId) return true;
    return get.call(ctx.agents, sessionId) === parent;
  } catch {
    return true;
  }
}

function resolveRoute(
  parent: DshAgent | undefined,
  req: SynthesisRequest,
): { provider?: string; model?: string } {
  const fromReq = req.agentOptions;
  if (fromReq?.provider && fromReq?.model) {
    return { provider: fromReq.provider, model: fromReq.model };
  }
  const options = (parent as { options?: { provider?: string; model?: string } } | undefined)
    ?.options;
  if (options?.provider && options?.model) {
    return { provider: options.provider, model: options.model };
  }
  return {
    provider: fromReq?.provider ?? options?.provider,
    model: fromReq?.model ?? options?.model,
  };
}

async function synthesizeViaSubagent(
  ctx: DshContext,
  parent: DshAgent,
  req: SynthesisRequest,
  logger?: WikiLogger,
  usePreset = true,
): Promise<SynthesisResult> {
  const subagents = ctx.subagents;
  if (!subagents || typeof subagents.startActivation !== "function") {
    throw new Error("ctx.subagents unavailable");
  }
  const providers: string[] = (() => {
    try {
      return subagents.list?.() ?? [];
    } catch {
      return [];
    }
  })();
  const provider = providers.includes("spawn") ? "spawn" : (providers[0] ?? "spawn");
  // Preset path needs the agentPresets service. Access via soft get — reading
  // ctx.agentPresets without inject throws on the cordis proxy.
  const hasPresets = (() => {
    try {
      const soft = (ctx as { get?: (name: string) => unknown }).get?.("agentPresets");
      if (soft) return true;
    } catch {
      /* ignore */
    }
    try {
      return Boolean((ctx as { agentPresets?: unknown }).agentPresets);
    } catch {
      return false;
    }
  })();
  const preset = usePreset && hasPresets && provider === "spawn" ? SYNTHESIS_PRESET_ID : undefined;

  // Must call through the service object — extracting the method drops `this`
  // and crashes inside expectProvider.
  const receipt = await subagents.startActivation({
    provider,
    label: "llm-wiki synthesis",
    request: {
      parent,
      prompt: [{ type: "text", text: req.prompt }],
      ...(req.cwd ? { cwd: req.cwd } : {}),
      ...(preset ? { agentPreset: preset } : {}),
      ...(req.outputSchema ? { outputSchema: req.outputSchema } : {}),
      ...(req.agentOptions ? { agentOptions: req.agentOptions } : {}),
      maxDepth: req.maxDepth ?? 1,
    },
    signal: AbortSignal.timeout(req.timeoutMs ?? 10 * 60_000),
    delivery: "caller",
  });
  try {
    const result = await receipt.result;
    if (result.stopReason && result.stopReason !== "completed") {
      throw new Error(`synthesis child stopped: ${result.stopReason}`);
    }
    const text = blocksToText(result.output);
    if (!text && result.structured === undefined) {
      throw new Error("synthesis child returned no output");
    }
    return { text, structured: result.structured, lane: "subagent" };
  } finally {
    try {
      await receipt.dispose();
    } catch (error) {
      logger?.warn(`synthesis child dispose failed: ${(error as Error).message}`);
    }
  }
}

async function synthesizeViaLlmStream(
  ctx: DshContext,
  parent: DshAgent | undefined,
  req: SynthesisRequest,
  logger?: WikiLogger,
): Promise<SynthesisResult> {
  const llm = ctx.llm;
  if (!llm || typeof llm.stream !== "function") throw new Error("ctx.llm.stream unavailable");
  const route = resolveRoute(parent, req);
  if (!route.provider || !route.model) {
    throw new Error(
      "llm stream synthesis requires provider+model (parent.options or agentOptions)",
    );
  }

  const signal = AbortSignal.timeout(req.timeoutMs ?? 10 * 60_000);
  // T5.3 live: the stream lane has no outputSchema enforcement (unlike the
  // subagent lane), so the schema must travel IN the prompt or the model
  // returns prose with no parseable JSON (live stream-only probe failed this
  // way). Keep the original prompt intact; append the schema as a strict
  // JSON-only instruction.
  const effectivePrompt =
    req.outputSchema && !req.prompt.includes("JSON Schema")
      ? `${req.prompt}\n\nRespond with a single JSON object matching this JSON Schema (no markdown fences, no commentary, no tool calls):\n${JSON.stringify(req.outputSchema)}`
      : req.prompt;
  const options: Record<string, unknown> = {
    provider: route.provider,
    model: route.model,
    messages: [{ role: "user", content: [{ type: "text", text: effectivePrompt }] }],
    signal,
  };

  // H23: prepareCall when available; must be awaited so rejections cannot
  // escape as unhandled (fatal cordis fiber crashes).
  try {
    const prepareCall = (
      llm as {
        prepareCall?: (config: unknown, signal?: AbortSignal) => Promise<unknown>;
      }
    ).prepareCall;
    if (typeof prepareCall === "function") {
      const prepared = await prepareCall.call(
        llm,
        { provider: route.provider, model: route.model, maxTokens: 4096 },
        AbortSignal.timeout(10_000),
      );
      if (prepared && typeof prepared === "object") {
        Object.assign(options, prepared);
        options.signal = signal;
        options.messages = [{ role: "user", content: [{ type: "text", text: effectivePrompt }] }];
      }
    }
  } catch (error) {
    logger?.warn(
      `llm prepareCall unavailable, using default call shape: ${(error as Error).message}`,
    );
  }

  let text = "";
  let failure: string | undefined;
  for await (const chunk of llm.stream(options) as AsyncIterable<Record<string, unknown>>) {
    // T5.3 live fix: the real host yields `{ type, text }` (e.g.
    // `{ type: "text-delta", text }`, `{ type: "block-end", block }) while
    // unit fakes historically used `{ kind, delta }`. Accept both, or the
    // detached fallback silently collects nothing ("returned no text")
    // exactly as seen in the 2026-10-30 WebUI archive run.
    const kind = (chunk.type ?? chunk.kind) as string | undefined;
    if (kind === "text-delta" || kind === "text") {
      const delta = chunk.delta ?? chunk.text;
      if (typeof delta === "string") text += delta;
    } else if (kind === "block-end") {
      // Host sends deltas AND a closing block-end with the full text.
      // Appending both duplicates the JSON (live: two concatenated objects
      // → unparseable). Deltas already carry the content; only use
      // block-end as a fallback when no delta arrived (non-delta protocol).
      if (!text) {
        const block = chunk.block as { type?: string; text?: string } | undefined;
        if (block?.type === "text" && typeof block.text === "string") text += block.text;
      }
    } else if (kind === "error" || kind === "aborted") {
      const record = chunk.failure as { code?: string; message?: string } | undefined;
      failure = record?.message ?? record?.code ?? kind;
      break;
    } else if (kind === "finish") {
      // Host terminal: `{ type: "finish", reason: { kind } }`. An
      // error/aborted finish must fail, a clean stop just ends.
      const reason = chunk.reason as { kind?: string } | undefined;
      const record = chunk.failure as { code?: string; message?: string } | undefined;
      if (reason?.kind === "error" || reason?.kind === "aborted") {
        failure = record?.message ?? record?.code ?? reason.kind;
      } else if (record?.message ?? record?.code) {
        failure = record?.message ?? record?.code;
      }
      break;
    }
    if (signal.aborted) {
      failure = "aborted";
      break;
    }
  }
  if (failure) throw new Error(`llm stream synthesis failed: ${failure}`);
  if (!text) throw new Error("llm stream synthesis returned no text");
  return { text, lane: "llm-stream" };
}

/**
 * Synthesize wiki content. Subagent lane first (structured handoff via the
 * synthesis preset), `ctx.llm.stream` as fallback. Failures throw — callers
 * must surface them, never silently substitute a hand-written checklist.
 *
 * T5.3/H28 survival: the route is snapshotted synchronously at entry (before
 * any await) so the `llm.stream` fallback still has provider/model even when
 * the parent is archived/disposed mid-flight. A parent-gone abort skips the
 * second parent-bound retry and falls straight through to the detached
 * stream lane, which runs in the plugin fiber and is not disposed with the
 * origin session. `detached: true` (or a registry-confirmed gone parent)
 * skips the subagent lane entirely.
 */
export async function synthesize(
  ctx: DshContext,
  parent: DshAgent | undefined,
  req: SynthesisRequest,
  logger?: WikiLogger,
): Promise<SynthesisResult> {
  const errors: string[] = [];
  // Snapshot BEFORE any await: after archive, parent.options may be gone.
  const snapshot = snapshotLlmRoute(parent, req);
  const hasSnapshotRoute = Boolean(snapshot.provider && snapshot.model);
  const fallbackReq: SynthesisRequest =
    hasSnapshotRoute && !(req.agentOptions?.provider && req.agentOptions?.model)
      ? { ...req, agentOptions: { provider: snapshot.provider, model: snapshot.model } }
      : req;
  const detached = req.detached === true;
  const parentGoneAtEntry = parent ? !isParentLive(ctx, parent) : true;
  if (
    parent &&
    !detached &&
    !parentGoneAtEntry &&
    typeof ctx.subagents?.startActivation === "function"
  ) {
    // note: call synthesizeViaSubagent which binds via ctx.subagents.startActivation
    try {
      return await synthesizeViaSubagent(ctx, parent, req, logger, true);
    } catch (error) {
      const message = (error as Error).message;
      errors.push(`subagent+preset: ${message}`);
      if (isParentGoneError(message)) {
        logger?.warn(`subagent parent gone (${message}), falling through to detached llm.stream`);
      } else {
        logger?.warn(`subagent+preset failed, retrying without preset: ${message}`);
        try {
          return await synthesizeViaSubagent(ctx, parent, req, logger, false);
        } catch (retryError) {
          errors.push(`subagent: ${(retryError as Error).message}`);
          logger?.warn(
            `subagent synthesis failed, trying llm.stream: ${(retryError as Error).message}`,
          );
        }
      }
    }
  } else if (parent && (detached || parentGoneAtEntry)) {
    logger?.warn(
      `synthesis detached lane (detached=${detached}, parentGone=${parentGoneAtEntry}): skipping parent-bound subagent`,
    );
  }
  try {
    return await synthesizeViaLlmStream(ctx, parent, fallbackReq, logger);
  } catch (error) {
    errors.push(`llm-stream: ${(error as Error).message}`);
  }
  throw new Error(`wiki synthesis unavailable (${errors.join("; ") || "no lane"})`);
}
