/**
 * Periodic observation reminder — the DSH port of pi's
 * `registerObservationReminder` (`extensions/llm-wiki/lib/observation.ts`).
 *
 * pi checks at `agent_end`; DSH has no such hook. The split here:
 *
 * - `agent/pre-step` (`step === 1`) counts ONE turn per `payload.turn`. A turn
 *   runs several pre-steps (D5), so an un-deduped counter would nag every few
 *   steps instead of every N turns.
 * - `tools/result` (observe-only view) records that this session wrote to the
 *   wiki. Any write — observe/retro/ensure/ingest/capture — silences the
 *   reminder for the rest of the session, so a model that already recorded
 *   something never gets nagged about it.
 * - The reminder is APPENDED to `decision.messages`; `messages` is a
 *   replacement channel, so replacing it would drop the user's prompt (H10).
 *
 * Settings (Settings → LLM Wiki): `observationReminder` (default true) and
 * `reminderTurns` (default 5, min 1). Both are read per turn from
 * `configForVault`, so a GUI save takes effect on the next turn.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  observationReminderEnabled,
  personalVaultIsAmbient,
  resolveReminderTurns,
} from "../../extensions/llm-wiki/lib/task-config.js";
import { resolveProjectVaultRoot, resolveVaultPaths } from "../../extensions/llm-wiki/lib/utils.js";
import type { WikiLogger } from "./logger.js";
import { agentCwdFor, isMainSession } from "./recall-inject.js";
import type { DshAgent, DshContext, PreStepDecision } from "./types.js";
import { configForVault } from "./vault-state.js";

/** Tools whose use counts as "this session already wrote to the wiki". */
export const WIKI_WRITE_TOOLS: ReadonlySet<string> = new Set([
  "wiki_observe",
  "wiki_retro",
  "wiki_ensure_page",
  "wiki_ingest",
  "wiki_capture_source",
]);

export interface ReminderState {
  /** Turns counted since the last reminder. */
  turns: number;
  /** A wiki tool already ran in this session → never remind again. */
  wrote: boolean;
  /** Last `payload.turn` counted (one count per turn, not per step). */
  lastTurn: number | null;
}

export function createReminderState(): ReminderState {
  return { turns: 0, wrote: false, lastTurn: null };
}

export interface ReminderInput {
  /** `agent/pre-step` step index (1 = the turn's first step). */
  step: number;
  /** Turn counter from the payload; `null` disables counting for the event. */
  turn: number | null;
  /** Main session only — subagents never get reminders. */
  main: boolean;
  /** A vault applies here (project vault, or an ambient personal vault). */
  applies: boolean;
  /** `observationReminder` setting. */
  enabled: boolean;
  /** `reminderTurns` setting (already clamped >= 1). */
  interval: number;
}

/**
 * Pure turn counter + reminder decision.
 *
 * Returns `true` when the reminder must be appended to this turn's messages
 * and resets the counter, so reminders arrive every `interval` counted turns
 * rather than on every subsequent turn. Counting is skipped (without a
 * reminder) for non-first steps, repeated turns, subagents, and sessions where
 * no wiki applies — pi avoids accumulating a pending nag in exactly these
 * cases.
 */
export function decideReminder(state: ReminderState, input: ReminderInput): boolean {
  if (!input.enabled || input.turn === null) return false;
  if (input.step !== 1) return false;
  if (state.lastTurn === input.turn) return false;
  state.lastTurn = input.turn;
  if (!input.main || !input.applies) return false;
  if (state.wrote) return false;
  state.turns += 1;
  if (state.turns < Math.max(1, Math.floor(input.interval))) return false;
  state.turns = 0;
  return true;
}

/** Reminder text. English like every other model-facing prompt in the plugin. */
export const REMINDER_TEXT =
  "🧠 LLM Wiki: if this task produced a reusable insight, call wiki_observe or wiki_retro now — do not wait for the user to ask.";

/**
 * Install the reminder for the plugin generation. State is per session;
 * `agent/created` seeds it and `agent/disposed` drops it (a closed session
 * cannot accumulate a stale counter).
 */
export function installObservationReminder(ctx: DshContext, logger?: WikiLogger): () => void {
  const states = new Map<string, ReminderState>();

  const stateOf = (sessionId: string): ReminderState => {
    let state = states.get(sessionId);
    if (!state) {
      state = createReminderState();
      states.set(sessionId, state);
    }
    return state;
  };

  if (typeof ctx.on !== "function") return () => undefined;
  const disposers: Array<() => void> = [];
  const listen = (event: string, listener: (...args: never[]) => unknown): void => {
    try {
      const off = ctx.on?.(event, listener);
      if (typeof off === "function") disposers.push(off);
    } catch (error) {
      logger?.warn(
        `observation reminder: ${event} subscription failed: ${(error as Error).message}`,
      );
    }
  };

  listen("agent/created", ((payload: { agent?: DshAgent }) => {
    const id = payload?.agent?.session?.id;
    if (id) stateOf(id);
  }) as (...args: never[]) => unknown);

  listen("agent/disposed", ((payload: { agent?: DshAgent }) => {
    const id = payload?.agent?.session?.id;
    if (id) states.delete(id);
  }) as (...args: never[]) => unknown);

  listen("tools/result", ((exec: { name?: string; agent?: DshAgent }) => {
    try {
      const name = String(exec?.name ?? "");
      if (!WIKI_WRITE_TOOLS.has(name)) return;
      const id = exec?.agent?.session?.id;
      if (id) stateOf(id).wrote = true;
    } catch {
      /* best effort — a throwing observer must not fail the tool call */
    }
  }) as (...args: never[]) => unknown);

  listen("agent/pre-step", (async (
    payload: { agent?: DshAgent; turn?: number; step?: number },
    next: () => Promise<PreStepDecision>,
  ) => {
    let decision: PreStepDecision;
    try {
      decision = await next();
    } catch (error) {
      logger?.warn(`reminder pre-step downstream failed: ${(error as Error).message}`);
      throw error;
    }
    try {
      if (decision.kind !== "enter") return decision;
      const agent = payload?.agent;
      const sessionId = agent?.session?.id ?? "";
      if (!agent || !sessionId) return decision;
      const cwd = agentCwdFor(ctx, agent);
      const paths = resolveVaultPaths(cwd);
      const config = configForVault(paths.root, paths.dotWiki);
      const applies =
        existsSync(join(paths.dotWiki, "config.json")) &&
        (resolveProjectVaultRoot(cwd) !== null || personalVaultIsAmbient(config));
      const remind = decideReminder(stateOf(sessionId), {
        step: payload.step ?? 1,
        turn: typeof payload.turn === "number" ? payload.turn : null,
        main: isMainSession(agent),
        applies,
        enabled: observationReminderEnabled(config),
        interval: resolveReminderTurns(config),
      });
      if (!remind) return decision;
      const reminder = {
        role: "user",
        content: [{ type: "text", text: REMINDER_TEXT }],
        source: { kind: "llm-wiki-reminder" },
      };
      return { ...decision, messages: [...(decision.messages ?? []), reminder] };
    } catch (error) {
      // A throwing pre-step listener fails the whole turn — degrade instead.
      logger?.warn(`observation reminder skipped: ${(error as Error).message}`);
      return decision;
    }
  }) as (...args: never[]) => unknown);

  const cleanup = (): void => {
    states.clear();
    for (const dispose of disposers.splice(0)) {
      try {
        dispose();
      } catch {
        /* best effort */
      }
    }
  };
  try {
    ctx.effect?.(() => cleanup, "llm-wiki observation reminder");
  } catch {
    /* best effort */
  }
  return cleanup;
}
