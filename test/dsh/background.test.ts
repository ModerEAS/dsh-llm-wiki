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
