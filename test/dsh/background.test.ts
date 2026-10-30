import { describe, expect, it } from "vitest";
import {
  createDshRuntime,
  ensureWhenIdleDrain,
  WIKI_REPORT_SOURCE,
  watchCompaction,
} from "../../src/dsh/background.js";
import type { WikiLogger } from "../../src/dsh/logger.js";
import type { DshAgent, DshContext } from "../../src/dsh/types.js";

function silentLogger(): WikiLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

describe("createDshRuntime", () => {
  it("injects completion reports into the ORIGIN session only", async () => {
    const seen: unknown[] = [];
    const origin = {
      session: { id: "sess-a" },
      inject: (input: unknown) => {
        seen.push(input);
      },
    } as unknown as DshAgent;
    const other = {
      session: { id: "sess-b" },
      inject: () => {
        throw new Error("must not inject into other session");
      },
    } as unknown as DshAgent;
    void other;
    const runtime = createDshRuntime({}, silentLogger());
    await runtime.launchTask({
      label: "t1",
      agent: origin,
      vaultRoot: "/v",
      work: async () => "hello report",
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      content: "hello report",
      source: { kind: WIKI_REPORT_SOURCE },
    });
    runtime.dispose();
  });

  it("never throws (and never leaks) when the origin session is gone", async () => {
    const runtime = createDshRuntime({}, silentLogger());
    const gone = {
      session: { id: "sess-gone" },
      inject: () => {
        throw new Error("session disposed");
      },
    } as unknown as DshAgent;
    await expect(
      runtime.launchTask({
        label: "t-gone",
        agent: gone,
        vaultRoot: "/v",
        work: async () => "hi",
      }),
    ).resolves.toBeUndefined();
    runtime.dispose();
  });

  it("dedupes by label", async () => {
    const runtime = createDshRuntime({}, silentLogger());
    let runs = 0;
    const work = async () => {
      runs++;
      await new Promise((r) => setTimeout(r, 20));
      return null;
    };
    const a = runtime.launchTask({ label: "same", agent: undefined, vaultRoot: "/v", work });
    const b = runtime.launchTask({ label: "same", agent: undefined, vaultRoot: "/v", work });
    await Promise.all([a, b]);
    expect(runs).toBe(1);
    runtime.dispose();
  });

  it("drainSession waits for matching session tasks", async () => {
    const runtime = createDshRuntime({}, silentLogger());
    const agent = { session: { id: "s1" } } as unknown as DshAgent;
    let finished = false;
    void runtime.launchTask({
      label: "slow",
      agent,
      vaultRoot: "/v",
      work: async () => {
        await new Promise((r) => setTimeout(r, 30));
        finished = true;
        return null;
      },
    });
    await runtime.drainSession("s1", 5_000);
    expect(finished).toBe(true);
    runtime.dispose();
  });

  it("reports failures back to the origin", async () => {
    const seen: unknown[] = [];
    const agent = {
      session: { id: "s-fail" },
      inject: (input: unknown) => {
        seen.push(input);
      },
    } as unknown as DshAgent;
    const runtime = createDshRuntime({}, silentLogger());
    await runtime.launchTask({
      label: "boom",
      agent,
      vaultRoot: "/v",
      work: async () => {
        throw new Error("synth failed");
      },
    });
    expect(String((seen[0] as { content?: string })?.content ?? "")).toMatch(/synth failed/);
    runtime.dispose();
  });

  it("registers cleanup in ctx.effect for HMR unload", () => {
    const cleanups: Array<() => void> = [];
    const ctx = { effect: (fn: () => () => void) => cleanups.push(fn()) } as unknown as DshContext;
    createDshRuntime(ctx, silentLogger());
    expect(cleanups).toHaveLength(1);
  });
});

describe("watchCompaction", () => {
  it("subscribes without throwing on a minimal ctx", () => {
    const offs: Array<() => void> = [];
    const ctx = {
      on: () => {
        const off = () => undefined;
        offs.push(off);
        return off;
      },
      effect: (fn: () => () => void) => fn(),
    } as unknown as DshContext;
    const runtime = createDshRuntime({}, silentLogger());
    expect(() => watchCompaction(ctx, runtime, silentLogger())).not.toThrow();
    runtime.dispose();
  });
});

describe("createDshRuntime needsLlm whenIdle wrap (T5/T6)", () => {
  interface IdleHarness {
    agent: DshAgent;
    setDriving: (driving: boolean) => void;
    releaseIdle: () => void;
  }

  function idleAgent(sessionId: string, onInject?: (input: unknown) => void): IdleHarness {
    let driving = true;
    let idleWaiters: Array<() => void> = [];
    const agent = {
      session: { id: sessionId },
      get status() {
        return driving ? "running" : "idle";
      },
      whenIdle: () =>
        new Promise<void>((resolve) => {
          idleWaiters.push(resolve);
        }),
      inject: (input: unknown) => {
        onInject?.(input);
      },
    } as unknown as DshAgent;
    return {
      agent,
      setDriving: (d: boolean) => {
        driving = d;
      },
      releaseIdle: () => {
        const waiters = idleWaiters;
        idleWaiters = [];
        for (const resolve of waiters) resolve();
      },
    };
  }

  async function tick(ms = 10): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  it("does not start LLM work before the turn ends", async () => {
    const seen: unknown[] = [];
    const harness = idleAgent("sess-idle-1", (input) => seen.push(input));
    ensureWhenIdleDrain(harness.agent);
    const runtime = createDshRuntime({}, silentLogger());
    let started = false;
    const done = runtime.launchTask({
      label: "ingest:idle-1",
      agent: harness.agent,
      vaultRoot: "/v",
      needsLlm: true,
      work: async () => {
        started = true;
        return "synthesized";
      },
    });
    await tick(20);
    expect(started).toBe(false);
    expect(runtime.pendingCount("sess-idle-1")).toBe(1);
    harness.setDriving(false);
    // Simulate headless: await the (wrapped) whenIdle — drain runs inside.
    const idleDone = (harness.agent.whenIdle as () => Promise<void>)();
    harness.releaseIdle();
    await idleDone;
    await done;
    expect(started).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ source: { kind: WIKI_REPORT_SOURCE } });
    runtime.dispose();
  });

  it("headless-style whenIdle await settles only after synthesis (no deadlock)", async () => {
    const harness = idleAgent("sess-idle-2");
    ensureWhenIdleDrain(harness.agent);
    const runtime = createDshRuntime({}, silentLogger());
    let finished = false;
    const task = runtime.launchTask({
      label: "ingest:idle-2",
      agent: harness.agent,
      vaultRoot: "/v",
      needsLlm: true,
      work: async () => {
        await new Promise((r) => setTimeout(r, 30));
        finished = true;
        return "ok";
      },
    });
    harness.setDriving(false);
    const idleP = (harness.agent.whenIdle as () => Promise<void>)();
    harness.releaseIdle();
    await Promise.all([idleP, task]);
    expect(finished).toBe(true);
    runtime.dispose();
  });

  it("serializes concurrent needsLlm work on the process chain", async () => {
    const harness = idleAgent("sess-idle-3");
    harness.setDriving(false);
    ensureWhenIdleDrain(harness.agent);
    const runtime = createDshRuntime({}, silentLogger());
    const order: string[] = [];
    const first = runtime.launchTask({
      label: "ingest:idle-3a",
      agent: harness.agent,
      vaultRoot: "/v",
      needsLlm: true,
      work: async () => {
        order.push("first-start");
        await new Promise((r) => setTimeout(r, 20));
        order.push("first-end");
        return null;
      },
    });
    const second = runtime.launchTask({
      label: "ingest:idle-3b",
      agent: harness.agent,
      vaultRoot: "/v",
      needsLlm: true,
      work: async () => {
        order.push("second-start");
        return null;
      },
    });
    // Already idle → microtask drain
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
    runtime.dispose();
  });

  it("runs detached when the origin agent is gone but the process lives (H28)", async () => {
    const runtime = createDshRuntime({}, silentLogger());
    const gone = {
      session: { id: "sess-detached" },
      // no whenIdle
      inject: () => undefined,
    } as unknown as DshAgent;
    let ran = false;
    await runtime.launchTask({
      label: "ingest:detached",
      agent: gone,
      vaultRoot: "/v",
      needsLlm: true,
      work: async () => {
        ran = true;
        return "detached-ok";
      },
    });
    expect(ran).toBe(true);
    runtime.dispose();
  });

  it("patches agents listed at runtime construction (agent/created path)", async () => {
    const harness = idleAgent("sess-pre");
    const created: Array<(payload: { agent?: DshAgent }) => void> = [];
    const ctx = {
      agents: { list: () => [harness.agent] },
      on: (event: string, listener: (...args: never[]) => unknown) => {
        if (event === "agent/created")
          created.push(listener as (payload: { agent?: DshAgent }) => void);
        return () => undefined;
      },
    } as unknown as DshContext;
    const runtime = createDshRuntime(ctx, silentLogger());
    expect(created.length).toBe(1);
    // whenIdle should already be wrapped from list()
    let drained = false;
    const task = runtime.launchTask({
      label: "ingest:pre",
      agent: harness.agent,
      vaultRoot: "/v",
      needsLlm: true,
      work: async () => {
        drained = true;
        return null;
      },
    });
    harness.setDriving(false);
    const idleP = (harness.agent.whenIdle as () => Promise<void>)();
    harness.releaseIdle();
    await Promise.all([idleP, task]);
    expect(drained).toBe(true);
    runtime.dispose();
  });

  it("drains detached when the original whenIdle rejects (agent gone mid-turn, H28)", async () => {
    const runtime = createDshRuntime({}, silentLogger());
    const seen: unknown[] = [];
    const gone = {
      session: { id: "sess-gone-reject" },
      status: "running",
      whenIdle: () => Promise.reject(new Error("disposed")),
      inject: (input: unknown) => {
        seen.push(input);
      },
    } as unknown as DshAgent;
    let ran = false;
    await runtime.launchTask({
      label: "ingest:gone-reject",
      agent: gone,
      vaultRoot: "/v",
      needsLlm: true,
      work: async () => {
        ran = true;
        return "gone-ok";
      },
    });
    expect(ran).toBe(true);
    expect(seen).toHaveLength(1);
    runtime.dispose();
  });

  it("dispose settles a queued launchTask with no whenIdle caller (no hang)", async () => {
    const harness = idleAgent("sess-idle-dispose");
    const runtime = createDshRuntime({}, silentLogger());
    let started = false;
    const done = runtime.launchTask({
      label: "ingest:idle-dispose",
      agent: harness.agent,
      vaultRoot: "/v",
      needsLlm: true,
      work: async () => {
        started = true;
        return null;
      },
    });
    await tick(10);
    runtime.dispose();
    // Nobody ever calls whenIdle — the abort must still settle the task.
    await done;
    expect(started).toBe(false);
  });
  it("keeps needsLlm work running after origin inject is gone (T5.3/H28)", async () => {
    const logs: string[] = [];
    const logger: WikiLogger = {
      info: (m: string) => logs.push(`i:${m}`),
      warn: (m: string) => logs.push(`w:${m}`),
      error: (m: string) => logs.push(`e:${m}`),
    };
    const harness = idleAgent("sess-t53");
    ensureWhenIdleDrain(harness.agent);
    const runtime = createDshRuntime({}, logger);
    let started = false;
    let finished = false;
    const task = runtime.launchTask({
      label: "ingest:t53",
      agent: harness.agent,
      vaultRoot: "/v",
      needsLlm: true,
      work: async () => {
        started = true;
        await new Promise((r) => setTimeout(r, 40));
        finished = true;
        return "completed-after-dispose";
      },
    });
    harness.setDriving(false);
    const idleP = (harness.agent as { whenIdle: () => Promise<void> }).whenIdle();
    harness.releaseIdle();
    await new Promise((r) => setTimeout(r, 5));
    (harness.agent as { inject: (input: unknown) => void }).inject = () => {
      throw new Error("session disposed");
    };
    await Promise.all([idleP, task]);
    expect(started).toBe(true);
    expect(finished).toBe(true);
    expect(
      logs.some(
        (l) =>
          l.includes("inject report failed") ||
          l.includes("origin session closed") ||
          l.includes("completed-after-dispose"),
      ),
    ).toBe(true);
    runtime.dispose();
  });

});

describe("watchCompaction drain (T10.9/H20)", () => {
  it("compaction/start drains the compacting session's pending tasks", async () => {
    let listener: ((session: unknown, event: unknown) => void) | undefined;
    const ctx = {
      on: (_event: string, fn: (...args: never[]) => unknown) => {
        listener = fn as (session: unknown, event: unknown) => void;
        return () => undefined;
      },
      effect: (fn: () => () => void) => fn(),
    } as unknown as DshContext;
    const runtime = createDshRuntime({}, silentLogger());
    const reports: unknown[] = [];
    const agent = {
      session: { id: "sess-compact" },
      inject: (input: unknown) => reports.push(input),
    } as unknown as DshAgent;
    let ran = false;
    const done = runtime.launchTask({
      label: "bg-before-compact",
      agent,
      vaultRoot: "/v",
      work: async () => {
        ran = true;
        return "drained-on-compact";
      },
    });
    // Task already ran (non-needsLlm). Launch a queued needsLlm one while "busy".
    ensureWhenIdleDrain(agent);
    let driving = true;
    (agent as { status?: string }).status = "running";
    (agent as { whenIdle?: () => Promise<void> }).whenIdle = () =>
      new Promise((resolve) => {
        if (!driving) resolve();
        else setTimeout(() => resolve(), 5);
      });
    watchCompaction(ctx, runtime, silentLogger());
    expect(listener).toBeTypeOf("function");
    // Fire compaction while a pending needsLlm task exists
    let started = false;
    const pending = runtime.launchTask({
      label: "needs-llm-compact",
      agent,
      vaultRoot: "/v",
      needsLlm: true,
      work: async () => {
        started = true;
        return "compact-drain-ok";
      },
    });
    expect(runtime.pendingCount("sess-compact")).toBeGreaterThanOrEqual(1);
    // compaction/start backstop
    listener?.({ id: "sess-compact" }, { type: "compaction/start" });
    // release idle so drain can finish if whenIdle wrap cooperates
    driving = false;
    (agent as { status?: string }).status = "idle";
    await runtime.drainSession("sess-compact", 2000);
    await pending;
    await done;
    expect(ran).toBe(true);
    expect(started).toBe(true);
    runtime.dispose();
  });
});
