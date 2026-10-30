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
 * - LLM-touching background work (`needsLlm`, e.g. ingest synthesis) never
 *   starts mid-turn: it waits for the origin agent to go idle, then runs
 *   inside `agent.runMaintenance`, so no new turn opens, no model request
 *   contends with the foreground turn on the single transport (T5/T6), and
 *   concurrent background LLM calls serialize on the exclusive maintenance
 *   phase. Disk-only work (light rebuilds) still starts immediately.
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
    /** LLM-touching work: wait for the origin agent to go idle, then run as
     * a maintenance task (no new turn, no transport contention, serialized
     * with other background LLM work). Disk-only work omits this and starts
     * immediately. Falls back to an immediate detached run when the origin
     * agent offers no idle primitives (unknown host) or is gone while the
     * process lives (H28). */
    needsLlm?: boolean;
    work: (signal: AbortSignal) => Promise<string | null>;
    report?: (summary: string) => void;
  }): Promise<void>;
  drainSession(sessionId: string, timeoutMs?: number): Promise<void>;
  awaitAll(timeoutMs?: number): Promise<void>;
  pendingCount(sessionId?: string): number;
  dispose(): void;
}

/** Idle primitives observed on a live DSH agent (all optional in the wild). */
interface IdleCapable {
  whenIdle(): Promise<void>;
  runMaintenance<T>(job: (signal: AbortSignal) => Promise<T>): Promise<T>;
  isDriving(): boolean;
}

function asIdleCapable(agent: DshAgent | undefined): IdleCapable | undefined {
  const whenIdle = (agent as { whenIdle?: unknown } | undefined)?.whenIdle;
  const runMaintenance = (agent as { runMaintenance?: unknown } | undefined)?.runMaintenance;
  if (typeof whenIdle !== "function" || typeof runMaintenance !== "function") {
    return undefined;
  }
  const whenIdleFn = whenIdle as () => Promise<void>;
  const runMaintenanceFn = runMaintenance as <T>(
    job: (signal: AbortSignal) => Promise<T>,
  ) => Promise<T>;
  return {
    whenIdle: () => whenIdleFn.call(agent),
    // `.call` on a generic function infers `unknown`, so re-assert per instantiation.
    runMaintenance: <T>(job: (signal: AbortSignal) => Promise<T>): Promise<T> =>
      runMaintenanceFn.call(agent, job) as Promise<T>,
    isDriving: () => (agent as { status?: unknown })?.status === "running",
  };
}

function abortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  return reason instanceof Error ? reason : new Error("aborted");
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Abort when EITHER the task is cancelled (unload) or the maintenance phase ends. */
function linkSignals(parent: AbortSignal, maint: AbortSignal): AbortSignal {
  if (parent.aborted) return parent;
  if (maint.aborted) return maint;
  const controller = new AbortController();
  const onAbort = () => {
    try {
      controller.abort(parent.aborted ? parent.reason : maint.reason);
    } catch {
      /* abort() itself never throws usefully here */
    }
    parent.removeEventListener("abort", onAbort);
    maint.removeEventListener("abort", onAbort);
  };
  parent.addEventListener("abort", onAbort, { once: true });
  maint.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}

function idleOrAborted(idle: IdleCapable, signal: AbortSignal): Promise<void> {
  return Promise.race([
    idle.whenIdle(),
    new Promise<never>((_resolve, reject) => {
      if (signal.aborted) reject(abortError(signal));
      else signal.addEventListener("abort", () => reject(abortError(signal)), { once: true });
    }),
  ]);
}

/**
 * Run LLM-touching `work` only once the origin agent is idle, claimed as a
 * maintenance task: no new turn opens, no model request contends with the
 * foreground turn on the single transport, and concurrent background LLM
 * calls serialize on the exclusive maintenance phase (T5/T6). A lost claim
 * race (a new turn, or another maintenance, won the phase) re-waits; a
 * gone/inconsistent agent with a live process runs detached instead (H28)
 * — never on another session.
 */
async function runAfterIdle(
  idle: IdleCapable,
  signal: AbortSignal,
  work: (sig: AbortSignal) => Promise<string | null>,
  logger?: WikiLogger,
): Promise<string | null> {
  // Consecutive claim failures while NOT driving are logically impossible on
  // a consistent agent (single thread: the phase cannot change between the
  // throw and the status read, so an idle status means another maintenance
  // holds the phase and our re-wait follows it to completion). Cap them so
  // a dead/inconsistent agent can never microtask-spin the process.
  let idleClaimFailures = 0;
  for (;;) {
    signal.throwIfAborted();
    try {
      await idleOrAborted(idle, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      if (idle.isDriving()) {
        // Pathological (whenIdle itself failed mid-turn): back off, re-wait.
        await abortableSleep(500, signal);
        continue;
      }
      logger?.info("background task: origin agent gone, running detached");
      return work(signal);
    }
    let claimed: Promise<string | null>;
    try {
      claimed = idle.runMaintenance((maintSignal) => work(linkSignals(signal, maintSignal)));
    } catch {
      if (signal.aborted) throw abortError(signal);
      if (!idle.isDriving() && ++idleClaimFailures >= 100) {
        logger?.info("background task: origin agent unclaimable, running detached");
        return work(signal);
      }
      continue;
    }
    return claimed;
  }
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
    needsLlm?: boolean;
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
        const idle = opts.needsLlm === true ? asIdleCapable(origin) : undefined;
        const summary = idle
          ? await runAfterIdle(idle, controller.signal, opts.work, logger)
          : await opts.work(controller.signal);
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
