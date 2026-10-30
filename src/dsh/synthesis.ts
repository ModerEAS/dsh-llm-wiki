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

function resolveRoute(
  parent: DshAgent | undefined,
  req: SynthesisRequest,
): { provider?: string; model?: string } {
  const fromReq = req.agentOptions;
  if (fromReq?.provider && fromReq?.model) {
    return { provider: fromReq.provider, model: fromReq.model };
  }
  const options = (parent as { options?: { provider?: string; model?: string } } | undefined)?.options;
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
  const preset = usePreset && provider === "spawn" ? SYNTHESIS_PRESET_ID : undefined;

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
    throw new Error("llm stream synthesis requires provider+model (parent.options or agentOptions)");
  }

  const signal = AbortSignal.timeout(req.timeoutMs ?? 10 * 60_000);
  const options: Record<string, unknown> = {
    provider: route.provider,
    model: route.model,
    messages: [{ role: "user", content: [{ type: "text", text: req.prompt }] }],
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
        options.messages = [{ role: "user", content: [{ type: "text", text: req.prompt }] }];
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
    const kind = chunk.kind as string | undefined;
    if (kind === "text-delta" && typeof chunk.delta === "string") text += chunk.delta;
    else if (kind === "text" && typeof chunk.text === "string") text += chunk.text;
    else if (kind === "error" || kind === "aborted") {
      const record = chunk.failure as { code?: string; message?: string } | undefined;
      failure = record?.message ?? record?.code ?? kind;
      break;
    } else if (kind === "finish") break;
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
 */
export async function synthesize(
  ctx: DshContext,
  parent: DshAgent | undefined,
  req: SynthesisRequest,
  logger?: WikiLogger,
): Promise<SynthesisResult> {
  const errors: string[] = [];
  if (parent && typeof ctx.subagents?.startActivation === "function") {
    // note: call synthesizeViaSubagent which binds via ctx.subagents.startActivation
    try {
      return await synthesizeViaSubagent(ctx, parent, req, logger, true);
    } catch (error) {
      const message = (error as Error).message;
      errors.push(`subagent+preset: ${message}`);
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
  try {
    return await synthesizeViaLlmStream(ctx, parent, req, logger);
  } catch (error) {
    errors.push(`llm-stream: ${(error as Error).message}`);
  }
  throw new Error(`wiki synthesis unavailable (${errors.join("; ") || "no lane"})`);
}
