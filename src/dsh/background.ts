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
 * - LLM-touching background work (`needsLlm`, e.g. ingest synthesis) must not
 *   start mid-turn (TRANSPORT contention, T5/T6). It also must not wait on
 *   `whenIdle` *outside* the headless runner's own `await whenIdle()` —
 *   headless registers first, then exits if `waitForChildren` is empty, so a
 *   post-idle start races process exit. Fix: shadow `agent.whenIdle` once so
 *   after the real idle settles we drain this agent's needsLlm queue *inside*
 *   that same whenIdle call (headless therefore waits for synthesis). Do NOT
 *   use `runMaintenance`: status maps maintenance → `"idle"`, so headless
 *   still exits without children. Concurrent needsLlm tasks share one
 *   process-wide promise chain. Disk-only work still starts immediately.
 */

import type { WikiLogger } from "./logger.js";
import type { DshAgent, DshContext } from "./types.js";
import { patchUiState, pushSessionLine } from "./ui-state.js";

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
    /** LLM-touching work: enqueue until wrapped `whenIdle` drains (no mid-turn
     * TRANSPORT; headless idle wait includes the drain). Disk-only omits this.
     * Detached fallback when idle primitives are missing or the origin agent
     * is gone (H28). */
    needsLlm?: boolean;
    work: (signal: AbortSignal) => Promise<string | null>;
    report?: (summary: string) => void;
  }): Promise<void>;
  drainSession(sessionId: string, timeoutMs?: number): Promise<void>;
  awaitAll(timeoutMs?: number): Promise<void>;
  pendingCount(sessionId?: string): number;
  dispose(): void;
}

type NeedsLlmJob = {
  signal: AbortSignal;
  work: (sig: AbortSignal) => Promise<string | null>;
  resolve: (value: string | null) => void;
  reject: (error: unknown) => void;
};

/** Process-wide serial chain for needsLlm background work (one transport). */
let llmChain: Promise<void> = Promise.resolve();

const patchedAgents = new WeakSet<object>();
const agentQueues = new WeakMap<object, NeedsLlmJob[]>();
const agentOrigWhenIdle = new WeakMap<object, () => Promise<void>>();
const drainingAgents = new WeakSet<object>();

function abortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  return reason instanceof Error ? reason : new Error("aborted");
}

function isDriving(agent: DshAgent | undefined): boolean {
  return (agent as { status?: unknown } | undefined)?.status === "running";
}

function runOnLlmChain<T>(fn: () => Promise<T>): Promise<T> {
  let result!: T;
  let failure: unknown;
  let failed = false;
  const turn = async () => {
    try {
      result = await fn();
    } catch (error) {
      failed = true;
      failure = error;
    }
  };
  const next = llmChain.then(turn, turn);
  llmChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next.then(() => {
    if (failed) throw failure;
    return result;
  });
}

async function drainAgentQueue(agent: object): Promise<void> {
  if (drainingAgents.has(agent)) return;
  drainingAgents.add(agent);
  try {
    for (;;) {
      const queue = agentQueues.get(agent);
      if (!queue || queue.length === 0) return;
      const job = queue.shift()!;
      if (job.signal.aborted) {
        job.reject(abortError(job.signal));
        continue;
      }
      try {
        const summary = await runOnLlmChain(() => job.work(job.signal));
        job.resolve(summary);
      } catch (error) {
        job.reject(error);
      }
    }
  } finally {
    drainingAgents.delete(agent);
  }
}

/**
 * Shadow `agent.whenIdle` so callers (especially headless) wait for our
 * needsLlm drain after true idle. Safe to call repeatedly.
 */
export function ensureWhenIdleDrain(agent: DshAgent): void {
  const whenIdle = (agent as { whenIdle?: unknown }).whenIdle;
  if (typeof whenIdle !== "function") return;
  if (patchedAgents.has(agent as object)) return;
  patchedAgents.add(agent as object);
  const orig = () => (whenIdle as () => Promise<void>).call(agent);
  agentOrigWhenIdle.set(agent as object, orig);
  if (!agentQueues.has(agent as object)) agentQueues.set(agent as object, []);
  (agent as unknown as { whenIdle: () => Promise<void> }).whenIdle = async () => {
    try {
      await orig();
    } catch {
      // Origin gone mid-turn (H28): fall through and drain detached.
    }
    await drainAgentQueue(agent as object);
  };
}

function enqueueNeedsLlm(
  agent: DshAgent,
  signal: AbortSignal,
  work: (sig: AbortSignal) => Promise<string | null>,
): Promise<string | null> {
  ensureWhenIdleDrain(agent);
  // Pre-wrap original for the progress fiber below (never the wrapper: awaiting
  // that here would deadlock with its own drain).
  const originalIdle = agentOrigWhenIdle.get(agent as object);
  return new Promise<string | null>((resolve, reject) => {
    const queue = agentQueues.get(agent as object) ?? [];
    agentQueues.set(agent as object, queue);
    const job: NeedsLlmJob = { signal, work, resolve, reject };
    const onAbort = () => {
      const idx = queue.indexOf(job);
      if (idx >= 0) queue.splice(idx, 1);
      reject(abortError(signal));
    };
    // Abort (dispose) must settle even if no drain ever runs — otherwise
    // launchTask/drainSession hang forever on a queue nobody drains.
    if (signal.aborted) {
      reject(abortError(signal));
      return;
    }
    queue.push(job);
    signal.addEventListener("abort", onAbort, { once: true });
    // Already idle: nobody will call whenIdle until the next turn — drain now.
    if (!isDriving(agent)) {
      queueMicrotask(() => {
        if (signal.aborted) return;
        void drainAgentQueue(agent as object).catch(() => undefined);
      });
    } else if (originalIdle) {
      // Detached progress fiber: a turn that ends with nobody awaiting the
      // wrapped whenIdle (interactive sessions) still drains.
      void (async () => {
        try {
          await originalIdle();
        } catch {
          // H28: agent gone — drain detached anyway.
        }
        if (signal.aborted) return;
        try {
          await drainAgentQueue(agent as object);
        } catch {
          // Per-item errors already settle their jobs; never crash the fiber.
        }
      })();
    }
  });
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
        // Former `setStatus` site (G4): sidebar shows running/done/failed;
        // the dock line is transient (client hides it when notices are off).
        try {
          if (opts.vaultRoot) {
            patchUiState(opts.vaultRoot, {
              background: { label: opts.label, phase: "running", at: new Date().toISOString() },
            });
          }
          if (sessionId) pushSessionLine(sessionId, `background ${opts.label} started`);
        } catch {
          /* UI state must never break background work */
        }
        let summary: string | null;
        if (opts.needsLlm === true) {
          const whenIdle = (origin as { whenIdle?: unknown } | undefined)?.whenIdle;
          if (origin && typeof whenIdle === "function") {
            summary = await enqueueNeedsLlm(origin, controller.signal, opts.work);
          } else {
            logger?.info("background task: origin agent gone, running detached");
            summary = await runOnLlmChain(() => opts.work(controller.signal));
          }
        } else {
          summary = await opts.work(controller.signal);
        }
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
          try {
            if (opts.vaultRoot) {
              patchUiState(opts.vaultRoot, {
                background: {
                  label: opts.label,
                  phase: "done",
                  at: new Date().toISOString(),
                  note: summary.split("\n")[0],
                },
              });
            }
            if (sessionId) pushSessionLine(sessionId, summary.split("\n")[0]);
          } catch {
            /* UI state must never break background work */
          }
        }
      } catch (error) {
        if (controller.signal.aborted || disposed) return;
        const message = error instanceof Error ? error.message : String(error);
        logger?.warn(`background task ${opts.label} failed: ${message}`);
        reportToOrigin(origin, `⚠️ Wiki background task \`${opts.label}\` failed: ${message}`);
        try {
          if (opts.vaultRoot) {
            patchUiState(opts.vaultRoot, {
              background: {
                label: opts.label,
                phase: "failed",
                at: new Date().toISOString(),
                note: message,
              },
            });
          }
          if (sessionId) pushSessionLine(sessionId, `background ${opts.label} failed`);
        } catch {
          /* UI state must never break background work */
        }
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

  // Patch whenIdle at agent birth so headless's in-flight await includes our drain.
  function patchAgent(agent: DshAgent | undefined): void {
    if (!agent) return;
    try {
      ensureWhenIdleDrain(agent);
    } catch (error) {
      logger?.warn(`whenIdle drain patch failed: ${(error as Error).message}`);
    }
  }
  try {
    for (const agent of ctx.agents?.list?.() ?? []) patchAgent(agent);
  } catch {
    /* optional service */
  }
  try {
    if (typeof ctx.on === "function") {
      ctx.on("agent/created", ((payload: { agent?: DshAgent }) => {
        patchAgent(payload?.agent);
      }) as (...args: never[]) => unknown);
    }
  } catch {
    /* best effort */
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
