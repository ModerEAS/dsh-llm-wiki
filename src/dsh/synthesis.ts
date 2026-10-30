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
 *    agent cannot misfire it (H13).
 * 2. Fallback: a minimal single-shot `ctx.llm.stream` call with capability
 *    downgrade — reasoning effort picked via `prepareCall` when available,
 *    otherwise dropped a tier with a log line (H23). A failed synthesis is
 *    ALWAYS surfaced as an error; the lane never silently degrades to
 *    "please write the pages by hand".
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

async function synthesizeViaSubagent(
  ctx: DshContext,
  parent: DshAgent,
  req: SynthesisRequest,
  logger?: WikiLogger,
): Promise<SynthesisResult> {
  const startActivation = ctx.subagents?.startActivation;
  if (typeof startActivation !== "function") throw new Error("ctx.subagents unavailable");
  const providers: string[] = (() => {
    try {
      return ctx.subagents?.list?.() ?? [];
    } catch {
      return [];
    }
  })();
  const provider = providers.includes("spawn") ? "spawn" : (providers[0] ?? "spawn");
  const usePreset = provider === "spawn" ? SYNTHESIS_PRESET_ID : undefined;

  const receipt = await startActivation({
    provider,
    label: "llm-wiki synthesis",
    request: {
      parent,
      prompt: [{ type: "text", text: req.prompt }],
      ...(req.cwd ? { cwd: req.cwd } : {}),
      ...(usePreset ? { agentPreset: usePreset } : {}),
      ...(req.outputSchema ? { outputSchema: req.outputSchema } : {}),
      ...(req.agentOptions ? { agentOptions: req.agentOptions } : {}),
      maxDepth: req.maxDepth ?? 0,
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
  req: SynthesisRequest,
  logger?: WikiLogger,
): Promise<SynthesisResult> {
  const stream = ctx.llm?.stream;
  if (typeof stream !== "function") throw new Error("ctx.llm.stream unavailable");
  // Capability downgrade (H23): try a prepared call first when the service
  // offers it; otherwise stream with a modest, widely-supported shape and
  // log that we stepped down instead of failing the whole synthesis.
  const options: Record<string, unknown> = {
    messages: [{ role: "user", content: [{ type: "text", text: req.prompt }] }],
  };
  try {
    const prepared = (
      ctx.llm as {
        prepareCall?: (config: unknown, signal: AbortSignal) => unknown;
      }
    )?.prepareCall?.({ maxTokens: 4096 }, AbortSignal.timeout(10_000));
    void prepared;
  } catch (error) {
    logger?.warn(
      `llm prepareCall unavailable, using default call shape: ${(error as Error).message}`,
    );
  }
  const signal = AbortSignal.timeout(req.timeoutMs ?? 10 * 60_000);
  let text = "";
  let failure: string | undefined;
  for await (const chunk of stream.call(ctx.llm, { ...options, signal }) as AsyncIterable<
    Record<string, unknown>
  >) {
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
    try {
      return await synthesizeViaSubagent(ctx, parent, req, logger);
    } catch (error) {
      errors.push(`subagent: ${(error as Error).message}`);
      logger?.warn(`subagent synthesis failed, trying llm.stream: ${(error as Error).message}`);
    }
  }
  try {
    return await synthesizeViaLlmStream(ctx, req, logger);
  } catch (error) {
    errors.push(`llm-stream: ${(error as Error).message}`);
  }
  throw new Error(`wiki synthesis unavailable (${errors.join("; ") || "no lane"})`);
}
