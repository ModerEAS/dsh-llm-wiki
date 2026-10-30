import { describe, expect, it, vi } from "vitest";
import { createDshRuntime, WIKI_REPORT_SOURCE } from "../../src/dsh/background.js";
import { createLogger } from "../../src/dsh/logger.js";
import type { DshAgent, DshContext } from "../../src/dsh/types.js";

function silentLogger() {
  return createLogger(undefined);
}

function originAgent(sessionId: string, onInject?: (input: unknown) => void): DshAgent {
  return {
    session: { id: sessionId },
    inject: (input: unknown) => {
      onInject?.(input);
    },
  };
}

describe("createDshRuntime", () => {
  it("single-flights identical labels", async () => {
    const runtime = createDshRuntime({}, silentLogger());
    let runs = 0;
    const work = async () => {
      runs++;
      await new Promise((r) => setTimeout(r, 20));
      return null;
    };
    await Promise.all([
      runtime.launchTask({ label: "ingest:A", agent: undefined, vaultRoot: "/v", work }),
      runtime.launchTask({ label: "ingest:A", agent: undefined, vaultRoot: "/v", work }),
    ]);
    expect(runs).toBe(1);
    runtime.dispose();
  });

  it("injects completion reports into the ORIGIN session only", async () => {
    const seen: unknown[] = [];
    const origin = originAgent("sess-a", (input) => seen.push(input));
    const runtime = createDshRuntime({}, silentLogger());
    await runtime.launchTask({
      label: "ingest:B",
      agent: origin,
      vaultRoot: "/v",
      work: async () => "done summary",
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ source: { kind: WIKI_REPORT_SOURCE } });
    runtime.dispose();
  });

  it("never throws (and never leaks) when the origin session is gone", async () => {
    const gone: DshAgent = {
      session: { id: "sess-gone" },
      inject: () => {
        throw new Error("session disposed");
      },
    };
    const runtime = createDshRuntime({}, silentLogger());
    await expect(
      runtime.launchTask({
        label: "ingest:C",
        agent: gone,
        vaultRoot: "/v",
        work: async () => "hi",
      }),
    ).resolves.toBeUndefined();
    runtime.dispose();
  });

  it("drains per session and reports pending counts", async () => {
    const runtime = createDshRuntime({}, silentLogger());
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const pending = runtime.launchTask({
      label: "ingest:D",
      agent: originAgent("sess-d"),
      vaultRoot: "/v",
      work: async () => {
        await gate;
        return null;
      },
    });
    expect(runtime.pendingCount("sess-d")).toBe(1);
    expect(runtime.pendingCount("other")).toBe(0);
    release();
    await pending;
    expect(runtime.pendingCount()).toBe(0);
    runtime.dispose();
  });

  it("dispose cancels in-flight work", async () => {
    const runtime = createDshRuntime({}, silentLogger());
    const onAbort = vi.fn();
    void runtime.launchTask({
      label: "ingest:E",
      agent: undefined,
      vaultRoot: "/v",
      work: (signal) =>
        new Promise<null>((resolve) => {
          signal.addEventListener("abort", () => {
            onAbort();
            resolve(null);
          });
        }),
    });
    await new Promise((r) => setTimeout(r, 10));
    runtime.dispose();
    expect(onAbort).toHaveBeenCalled();
  });

  it("registers cleanup in ctx.effect for HMR unload", () => {
    const cleanups: Array<() => unknown> = [];
    const ctx = { effect: (fn: () => () => void) => cleanups.push(fn()) } as unknown as DshContext;
    createDshRuntime(ctx, silentLogger());
    expect(cleanups).toHaveLength(1);
  });
});

describe("createDshRuntime needsLlm idle gate (T5/T6)", () => {
  interface IdleHarness {
    agent: DshAgent;
    setDriving: (driving: boolean) => void;
    releaseIdle: () => void;
  }

  /** Fake agent with real runMaintenance exclusivity semantics. */
  function idleAgent(sessionId: string, onInject?: (input: unknown) => void): IdleHarness {
    let driving = true;
    let maintenanceActive = false;
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
      runMaintenance: (job: (signal: AbortSignal) => Promise<string | null>) => {
        if (driving || maintenanceActive) throw new Error(`agent "${sessionId}" busy`);
        maintenanceActive = true;
        return (async () => {
          try {
            return await job(new AbortController().signal);
          } finally {
            maintenanceActive = false;
          }
        })();
      },
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
        waiters.forEach((resolve) => {
          resolve();
        });
      },
    };
  }

  async function tick(ms = 10): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  it("does not start LLM work before the turn ends", async () => {
    const seen: unknown[] = [];
    const harness = idleAgent("sess-idle-1", (input) => seen.push(input));
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
    harness.releaseIdle();
    await done;
    expect(started).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ source: { kind: WIKI_REPORT_SOURCE } });
    runtime.dispose();
  });

  it("re-waits when a new turn wins the maintenance claim race", async () => {
    const harness = idleAgent("sess-idle-2");
    const runtime = createDshRuntime({}, silentLogger());
    let runs = 0;
    const done = runtime.launchTask({
      label: "ingest:idle-2",
      agent: harness.agent,
      vaultRoot: "/v",
      needsLlm: true,
      work: async () => {
        runs++;
        return "ok";
      },
    });
    await tick(10);
    // Turn still driving: first idle observation resolves but the claim loses.
    harness.releaseIdle();
    await tick(10);
    expect(runs).toBe(0);
    harness.setDriving(false);
    harness.releaseIdle();
    await done;
    expect(runs).toBe(1);
    runtime.dispose();
  });

  it("serializes concurrent LLM work on the maintenance phase", async () => {
    const harness = idleAgent("sess-idle-3");
    harness.setDriving(false);
    const runtime = createDshRuntime({}, silentLogger());
    const order: string[] = [];
    const gate = () => new Promise<void>((r) => setTimeout(r, 20));
    const first = runtime.launchTask({
      label: "ingest:idle-3a",
      agent: harness.agent,
      vaultRoot: "/v",
      needsLlm: true,
      work: async () => {
        order.push("first-start");
        await gate();
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
    harness.releaseIdle();
    await first;
    // Second lost the claim race while the first held maintenance; it
    // re-waits on a fresh idle observation instead of running detached.
    expect(order).toEqual(["first-start", "first-end"]);
    harness.releaseIdle();
    await second;
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
    runtime.dispose();
  });

  it("runs detached when the origin agent is gone but the process lives (H28)", async () => {
    const runtime = createDshRuntime({}, silentLogger());
    const gone = {
      session: { id: "sess-gone-idle" },
      status: "idle",
      whenIdle: () => Promise.reject(new Error("disposed")),
      runMaintenance: () => {
        throw new Error("disposed");
      },
    } as unknown as DshAgent;
    let ran = false;
    await runtime.launchTask({
      label: "ingest:idle-4",
      agent: gone,
      vaultRoot: "/v",
      needsLlm: true,
      work: async () => {
        ran = true;
        return null;
      },
    });
    expect(ran).toBe(true);
    runtime.dispose();
  });

  it("drops the wait silently on dispose", async () => {
    const harness = idleAgent("sess-idle-5");
    const runtime = createDshRuntime({}, silentLogger());
    let ran = false;
    const done = runtime.launchTask({
      label: "ingest:idle-5",
      agent: harness.agent,
      vaultRoot: "/v",
      needsLlm: true,
      work: async () => {
        ran = true;
        return "late";
      },
    });
    await tick(10);
    runtime.dispose();
    await done;
    expect(ran).toBe(false);
  });

  it("starts immediately without needsLlm even on an idle-capable agent", async () => {
    const harness = idleAgent("sess-idle-6");
    const runtime = createDshRuntime({}, silentLogger());
    let ran = false;
    await runtime.launchTask({
      label: "rebuild:idle-6",
      agent: harness.agent,
      vaultRoot: "/v",
      work: async () => {
        ran = true;
        return null;
      },
    });
    expect(ran).toBe(true);
    runtime.dispose();
  });
});
