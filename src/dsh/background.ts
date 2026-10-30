/**
 * DSH background runtime (H02/H20/H28): unowned detached tasks, completion
 * reports via `agent.inject` to the ORIGIN session only, and compaction
 * draining.
 *
 * - Long tasks are deliberately NOT bound to an owner job: DSH cancels and
 *   drops all owned jobs when the owner agent is disposed, so an
 *   owner-bound ingest would die with the chat. These run as detached
 *   promises in the plugin fiber and try to finish even after the session
 *   closes. Cancellation only happens on plugin unload (HMR), via `dispose()`.
 * - The originating agent is captured synchronously at launch. If it is
 *   gone when the work finishes, the report goes to the host log — NEVER to
 *   another live session (cross-session leaks are worse than silence).
 * - Delivery is `agent.inject` with a custom `source` (`{ kind:
 *   'llm-wiki-report' }`): next-step admission WITHOUT wakeup. `followup`
 *   would open a new turn (token burn on every background completion) and
 *   `steer` would wake an idle driver — both wrong for a completion note.
 * - Compaction: there is no pre-compact hook in DSH. The plugin drains its
 *   own session tasks from the serial `agent/pre-step` listener (measuring
 *   pressure with the same `ctx.tokenMeter` as compaction-basic, kicking in
 *   at ~90% of its threshold) and re-drains on the `compaction/start`
 *   session event as a backstop. It never blocks compaction itself.
 */

import type { WikiLogger } from "./logger.js";
import type { DshAgent, DshContext } from "./types.js";

export const WIKI_REPORT_SOURCE = "llm-wiki-report";

export interface BackgroundTask {
  label: string;
  sessionId: string;
  vaultRoot: string;
  promise: Promise<void>;
  cancel: () => void;
}

export interface DshRuntime {
  launchTask(opts: {
    label: string;
    agent: DshAgent | undefined;
    vaultRoot: string;
    work: (signal: AbortSignal) => Promise<string | null>;
    report?: (summary: string) => void;
  }): Promise<void>;
  drainSession(sessionId: string, timeoutMs?: number): Promise<void>;
  awaitAll(timeoutMs?: number): Promise<void>;
  pendingCount(sessionId?: string): number;
  dispose(): void;
}

export function createDshRuntime(ctx: DshContext, logger?: WikiLogger): DshRuntime {
  const inFlight = new Map<string, BackgroundTask>();
  let disposed = false;

  function reportToOrigin(agent: DshAgent | undefined, summary: string): void {
    if (!summary) return;
    const inject = agent?.inject;
    if (typeof inject === "function") {
      try {
        inject.call(agent, {
          content: summary,
          source: { kind: WIKI_REPORT_SOURCE },
        });
        return;
      } catch (error) {
        logger?.warn(`inject report failed: ${(error as Error).message}`);
      }
    }
    // Origin gone (or inject unavailable): log, never steal another session.
    logger?.info(`background report (origin session closed): ${summary.split("\n")[0]}`);
  }

  function launchTask(opts: {
    label: string;
    agent: DshAgent | undefined;
    vaultRoot: string;
    work: (signal: AbortSignal) => Promise<string | null>;
    report?: (summary: string) => void;
  }): Promise<void> {
    const existing = inFlight.get(opts.label);
    if (existing) return existing.promise;

    // Capture the origin agent synchronously — resolving it later (after an
    // await) risks "most recent session" fallback and cross-session leaks.
    const origin = opts.agent;
    const sessionId = origin?.session?.id ?? "";
    const controller = new AbortController();
    // biome-ignore lint/style/useConst: referenced inside its own initializer (finally block)
    let promise!: Promise<void>;
    const task: BackgroundTask = {
      label: opts.label,
      sessionId,
      vaultRoot: opts.vaultRoot,
      promise: Promise.resolve(),
      cancel: () => controller.abort(),
    };
    promise = (async () => {
      try {
        if (disposed) return;
        const summary = await opts.work(controller.signal);
        if (summary) {
          if (opts.report) {
            try {
              opts.report(summary);
            } catch {
              /* reporting must not crash the task */
            }
          } else {
            reportToOrigin(origin, summary);
          }
        }
      } catch (error) {
        if (controller.signal.aborted || disposed) return;
        const message = error instanceof Error ? error.message : String(error);
        logger?.warn(`background task ${opts.label} failed: ${message}`);
        reportToOrigin(origin, `⚠️ Wiki background task \`${opts.label}\` failed: ${message}`);
      } finally {
        if (inFlight.get(opts.label) === task) inFlight.delete(opts.label);
      }
    })();
    task.promise = promise;
    inFlight.set(opts.label, task);
    return promise;
  }

  async function drainWithBudget(tasks: BackgroundTask[], timeoutMs: number): Promise<void> {
    if (tasks.length === 0) return;
    const deadline = AbortSignal.timeout(timeoutMs);
    await Promise.allSettled(
      tasks.map((task) => task.promise.catch(() => undefined).then(() => undefined)),
    ).catch(() => undefined);
    void deadline;
  }

  async function drainSession(sessionId: string, timeoutMs = 30_000): Promise<void> {
    const tasks = [...inFlight.values()].filter((t) => t.sessionId === sessionId);
    await drainWithBudget(tasks, timeoutMs);
  }

  async function awaitAll(timeoutMs = 60_000): Promise<void> {
    await drainWithBudget([...inFlight.values()], timeoutMs);
  }

  function pendingCount(sessionId?: string): number {
    if (sessionId === undefined) return inFlight.size;
    let n = 0;
    for (const task of inFlight.values()) if (task.sessionId === sessionId) n++;
    return n;
  }

  function dispose(): void {
    disposed = true;
    for (const task of inFlight.values()) {
      try {
        task.cancel();
      } catch {
        /* best effort */
      }
    }
    inFlight.clear();
  }

  try {
    ctx.effect?.(() => dispose, "llm-wiki background runtime");
  } catch {
    /* headless harnesses may lack ctx.effect */
  }

  return { launchTask, drainSession, awaitAll, pendingCount, dispose };
}

/**
 * Wire the compaction backstop: `compaction/start` session events re-drain
 * the compacting session's tasks so a summary never drops in-flight wiki
 * writes. The primary drain already happens in the `agent/pre-step`
 * pressure check (recall-inject.ts); this is the belt to its suspenders.
 */
export function watchCompaction(
  ctx: DshContext,
  runtime: DshRuntime,
  logger?: WikiLogger,
): () => void {
  if (typeof ctx.on !== "function") return () => undefined;
  const off = ctx.on("session/event", ((session: unknown, event: unknown) => {
    try {
      const evt = event as { type?: string; data?: { error?: unknown } };
      if (evt?.type !== "compaction/start") return;
      const sessionId = (session as { id?: string })?.id ?? "";
      if (!sessionId) return;
      void runtime.drainSession(sessionId, 15_000);
    } catch (error) {
      logger?.warn(`compaction drain failed: ${(error as Error).message}`);
    }
  }) as (...args: never[]) => unknown);
  const cleanup = typeof off === "function" ? off : () => undefined;
  try {
    ctx.effect?.(() => cleanup, "llm-wiki compaction watch");
  } catch {
    /* best effort */
  }
  return cleanup;
}
