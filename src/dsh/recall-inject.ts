/**
 * Recall injection for DSH (A6/D5/D11/H10/H21 + compaction drain).
 *
 * Two channels, split exactly like the pi extension's issue #92 contract:
 *
 * - STATIC footer via `ctx.systemPrompt.section()`: byte-stable text for the
 *   whole session (wiki identity + tool pointer). It is re-evaluated every
 *   step, so it must NEVER contain per-turn material — a changing section
 *   rewrites system node 0 and kills the provider prefix cache from the
 *   first token. It only varies with vault presence, which changes rarely.
 * - VOLATILE recall via the `agent/pre-step` waterfall, `step === 1` only
 *   (one injection per turn — D5): the decision from `next()` is SPREAD and
 *   the recall appended (`[...decision.messages, recall]`), never replaced.
 *   Returning `{ enter, messages: [recall] }` would drop the user's prompt
 *   (H10); returning `[]` on an empty turn would end the turn outright.
 *   Errors are caught — a throwing pre-step listener fails the whole turn.
 *
 * Compaction drain: the same pre-step listener measures pressure with
 * `ctx.tokenMeter` (the meter compaction-basic uses) and drains this
 * session's background tasks at ~90% of threshold, so a summary never
 * lands mid-write. `compaction/start` re-drains as backstop
 * (background.ts `watchCompaction`).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { WIKI_STATUS_BLOCK } from "../../extensions/llm-wiki/lib/inject.js";
import { rebuildMetadataLight } from "../../extensions/llm-wiki/lib/metadata.js";
import {
  formatRecallContext,
  searchWikiHybrid,
  shouldUseLinksFirst,
  vaultPageCount,
} from "../../extensions/llm-wiki/lib/recall.js";
import {
  autoRecallEnabled,
  personalVaultIsAmbient,
} from "../../extensions/llm-wiki/lib/task-config.js";
import { resolveProjectVaultRoot, resolveVaultPaths } from "../../extensions/llm-wiki/lib/utils.js";
import type { DshRuntime } from "./background.js";
import type { WikiLogger } from "./logger.js";
import type { DshAgent, DshContext, PreStepDecision } from "./types.js";
import { configForVault, takePendingRebuild } from "./vault-state.js";

/** Per-turn dedupe: at most one recall injection per (session, turn). */
const injectedTurns = new Set<string>();

function sessionIdOf(agent: DshAgent): string {
  return agent?.session?.id ?? "";
}

function agentCwdFor(ctx: DshContext, agent: DshAgent): string {
  try {
    const dir = ctx.workingDirectory?.get?.(agent.session);
    if (typeof dir === "string" && dir.length > 0) return dir;
  } catch {
    /* fall through */
  }
  return process.cwd();
}

/** Main-session check: subagents skip bootstrap/ambient recall (H27). */
export function isMainSession(agent: DshAgent): boolean {
  const header = (agent?.session?.header ?? {}) as {
    parentSession?: unknown;
    origin?: unknown;
    delegationDepth?: unknown;
  };
  if (header.parentSession) return false;
  if (header.origin === "subagent") return false;
  if (typeof header.delegationDepth === "number" && header.delegationDepth > 0) return false;
  return true;
}

function wikiAppliesTo(cwd: string, ambientPersonal: boolean): boolean {
  return resolveProjectVaultRoot(cwd) !== null || ambientPersonal;
}

export interface RecallInstaller {
  disposePreStep: () => void;
  disposeSection: () => void;
}

/**
 * Install the static section (once per plugin) + the pre-step listener.
 * The pre-step listener is ALSO installed per-agent on `agent/created`
 * (and for `agents.list()` survivors at apply) so HMR reloads never leave
 * old sessions unguarded — see index.ts.
 */
export function installRecallInjection(
  ctx: DshContext,
  runtime: DshRuntime,
  logger?: WikiLogger,
): RecallInstaller {
  try {
    ctx.systemPrompt?.section?.({
      name: "llm-wiki",
      order: 900,
      // Static, session-stable footer (A6). Vault presence is resolved
      // per evaluation but changes only when the user bootstraps mid-chat.
      text: () => WIKI_STATUS_BLOCK,
    });
  } catch (error) {
    logger?.warn(`systemPrompt.section failed: ${(error as Error).message}`);
  }

  const disposePreStep = installPreStepListener(ctx, runtime, logger);
  return { disposePreStep, disposeSection: () => undefined };
}

export function installPreStepListener(
  ctx: DshContext,
  runtime: DshRuntime,
  logger?: WikiLogger,
): () => void {
  if (typeof ctx.on !== "function") return () => undefined;
  const off = ctx.on("agent/pre-step", (async (
    payload: {
      agent?: DshAgent;
      messages?: unknown[];
      turn?: number;
      step?: number;
      signal?: AbortSignal;
    },
    next: () => Promise<PreStepDecision>,
  ) => {
    let decision: PreStepDecision;
    try {
      decision = await next();
    } catch (error) {
      logger?.warn(`pre-step downstream failed: ${(error as Error).message}`);
      throw error;
    }
    try {
      if (decision.kind !== "enter") return decision;
      const agent = payload.agent;
      if (!agent) return decision;
      const step = payload.step ?? 1;
      const turn = payload.turn ?? 0;
      const sessionId = sessionIdOf(agent);
      const cwd = agentCwdFor(ctx, agent);

      // Compaction drain (primary): same meter family as compaction-basic,
      // kick in at ~90% so background wiki writes settle before a summary.
      drainOnPressure(ctx, runtime, sessionId, logger);

      // Only the first step of a turn may inject (D5: pre-step runs per step,
      // pi's before_agent_start ran per turn).
      if (step !== 1) return decision;
      const turnKey = `${sessionId}:${turn}`;
      if (injectedTurns.has(turnKey)) return decision;
      injectedTurns.add(turnKey);
      if (injectedTurns.size > 5000) {
        const oldest = injectedTurns.values().next();
        if (!oldest.done) injectedTurns.delete(oldest.value);
      }

      // Per-vault pending rebuilds are consumed HERE (own vault only — H04):
      // a wiki edit earlier in this session rebuilds before recall runs.
      try {
        const paths = resolveVaultPaths(cwd);
        if (takePendingRebuild(paths.root)) rebuildMetadataLight(paths);
      } catch (error) {
        logger?.warn(`pending rebuild failed: ${(error as Error).message}`);
      }

      if (!isMainSession(agent)) return decision;
      const config = configForVault(resolveVaultPaths(cwd).root, resolveVaultPaths(cwd).dotWiki);
      if (!wikiAppliesTo(cwd, personalVaultIsAmbient(config))) return decision;

      const paths = resolveVaultPaths(cwd);
      if (!existsSync(join(paths.dotWiki, "config.json"))) return decision;

      const firstMessage = (decision.messages ?? [])[0] as { content?: unknown } | undefined;
      const prompt = textOf(firstMessage?.content);
      let recallBlock = "";
      if (prompt.trim() && autoRecallEnabled(config)) {
        const results = await searchWikiHybrid(paths, prompt, 3, 5, false, { config });
        if (results.length > 0) {
          const linksOnly = shouldUseLinksFirst(vaultPageCount(paths, false), config);
          const formatted = formatRecallContext(results, {
            linksOnly,
            skillInlineMax: config.recallSkillInlineMax,
          });
          if (formatted) recallBlock = formatted;
        }
      }
      if (!recallBlock) return decision;
      const recallMessage = {
        role: "user",
        content: [{ type: "text", text: recallBlock }],
        source: { kind: "llm-wiki-recall" },
      };
      return { ...decision, messages: [...(decision.messages ?? []), recallMessage] };
    } catch (error) {
      // A throwing pre-step listener fails the whole turn — degrade to the
      // downstream decision and log instead.
      logger?.warn(`recall injection skipped: ${(error as Error).message}`);
      return decision;
    }
  }) as (...args: never[]) => unknown);
  const cleanup = typeof off === "function" ? off : () => undefined;
  try {
    ctx.effect?.(() => cleanup, "llm-wiki recall pre-step");
  } catch {
    /* best effort */
  }
  return cleanup;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        b && typeof (b as { text?: unknown }).text === "string" ? (b as { text: string }).text : "",
      )
      .join("\n");
  }
  return "";
}

function drainOnPressure(
  ctx: DshContext,
  runtime: DshRuntime,
  sessionId: string,
  logger?: WikiLogger,
): void {
  try {
    if (!sessionId || runtime.pendingCount(sessionId) === 0) return;
    const meter = ctx.tokenMeter as
      | { threshold?: number; usage?: number; pressure?: number }
      | undefined;
    // Without meter internals, only drain when explicitly overfull is
    // unknowable — so drain opportunistically but bounded: the pre-step
    // path is frequent, tasks are short, and drainSession is budget-capped.
    const pressure =
      typeof meter?.pressure === "number"
        ? meter.pressure
        : typeof meter?.usage === "number" &&
            typeof meter?.threshold === "number" &&
            meter.threshold > 0
          ? meter.usage / meter.threshold
          : 0;
    if (pressure >= 0.9) {
      void runtime.drainSession(sessionId, 15_000).catch((error: unknown) => {
        logger?.warn(`pressure drain failed: ${(error as Error).message}`);
      });
    }
  } catch (error) {
    logger?.warn(`pressure check failed: ${(error as Error).message}`);
  }
}
