import { describe, expect, it } from "vitest";
import { createDshRuntime } from "../../src/dsh/background.js";
import type { WikiLogger } from "../../src/dsh/logger.js";
import {
  isParentGoneError,
  isParentLive,
  snapshotLlmRoute,
  synthesize,
} from "../../src/dsh/synthesis.js";
import type { DshAgent, DshContext } from "../../src/dsh/types.js";

function silentLogger(): WikiLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

function streamCtx(text: string, route?: { provider: string; model: string }): DshContext {
  async function* stream() {
    yield { kind: "text-delta", delta: text };
    yield { kind: "finish" };
  }
  return {
    llm: {
      stream: (options: Record<string, unknown>) => {
        // Nitpicky: the detached lane must carry an explicit route — never
        // rely on a disposed parent at stream time.
        expect(options.provider).toBe(route?.provider ?? "deepseek");
        expect(options.model).toBe(route?.model ?? "deepseek-chat");
        return stream();
      },
    },
  } as unknown as DshContext;
}

describe("llm.stream host chunk shape (T5.3 live: type/text, not kind/delta)", () => {
  it("collects real-host { type: text-delta, text } + block-end + finish", async () => {
    async function* hostStream() {
      yield { type: "block-start", index: 0, blockType: "text" };
      yield { type: "text-delta", index: 0, text: '{"summary":"' };
      yield { type: "text-delta", index: 0, text: 'host-ok"}' };
      yield { type: "block-end", index: 0, block: { type: "text", text: '{"summary":"host-ok"}' } };
      yield { type: "usage", usage: { inputTokens: 1, outputTokens: 1 } };
      yield { type: "finish", reason: { kind: "stop" } };
    }
    const ctx = {
      llm: { stream: () => hostStream() },
    } as unknown as DshContext;
    const parent = {
      session: { id: "p-host" },
      options: { provider: "deepseek", model: "deepseek-chat" },
    } as unknown as DshAgent;
    const result = await synthesize(ctx, parent, { prompt: "hi" }, silentLogger());
    expect(result.lane).toBe("llm-stream");
    expect(result.text).toBe('{"summary":"host-ok"}');
  });

  it("fails on host error finish, not silent empty text", async () => {
    async function* errStream() {
      yield { type: "finish", reason: { kind: "aborted" }, failure: { message: "boom" } };
    }
    const ctx = {
      llm: { stream: () => errStream() },
    } as unknown as DshContext;
    const parent = {
      session: { id: "p-err" },
      options: { provider: "deepseek", model: "deepseek-chat" },
    } as unknown as DshAgent;
    await expect(synthesize(ctx, parent, { prompt: "hi" }, silentLogger())).rejects.toThrow(
      /boom|aborted/,
    );
  });
});

describe("isParentGoneError (T5.3/H28)", () => {
  it("matches archive/stop aborts, not ordinary child errors", () => {
    expect(isParentGoneError("synthesis child stopped: aborted")).toBe(true);
    expect(isParentGoneError('subagent parent "abc" is being disposed')).toBe(true);
    expect(isParentGoneError("subagent creation requires the exact live parent agent")).toBe(true);
    expect(isParentGoneError("ACTIVATION_CLOSING")).toBe(true);
    expect(isParentGoneError("synthesis child stopped: error")).toBe(false);
    expect(isParentGoneError("synthesis child returned no output")).toBe(false);
  });
});

describe("snapshotLlmRoute (T5.3/H28)", () => {
  it("prefers explicit agentOptions over parent.options", () => {
    const parent = {
      session: { id: "p" },
      options: { provider: "deepseek", model: "deepseek-chat" },
    } as unknown as DshAgent;
    const route = snapshotLlmRoute(parent, {
      prompt: "hi",
      agentOptions: { provider: "other", model: "other-model" },
    });
    expect(route).toEqual({ provider: "other", model: "other-model" });
  });

  it("falls back to parent.options when no override", () => {
    const parent = {
      session: { id: "p" },
      options: { provider: "deepseek", model: "deepseek-chat" },
    } as unknown as DshAgent;
    expect(snapshotLlmRoute(parent, { prompt: "hi" })).toEqual({
      provider: "deepseek",
      model: "deepseek-chat",
    });
  });
});

describe("isParentLive (T5.3/H28)", () => {
  it("returns true when the agents service is absent (unknown, not gone)", () => {
    const parent = { session: { id: "p" } } as unknown as DshAgent;
    expect(isParentLive({}, parent)).toBe(true);
  });

  it("returns false when the registry no longer holds the exact parent", () => {
    const parent = { session: { id: "p" } } as unknown as DshAgent;
    const ctx = {
      agents: { get: () => undefined },
    } as unknown as DshContext;
    expect(isParentLive(ctx, parent)).toBe(false);
  });

  it("returns true when the registry still holds the exact parent", () => {
    const parent = { session: { id: "p" } } as unknown as DshAgent;
    const ctx = {
      agents: { get: (id: string) => (id === "p" ? parent : undefined) },
    } as unknown as DshContext;
    expect(isParentLive(ctx, parent)).toBe(true);
  });

  it("returns false without a parent", () => {
    expect(isParentLive({}, undefined)).toBe(false);
  });
});

describe("synthesize detached survival (T5.3/H28)", () => {
  it("keeps the live-parent subagent/preset lane (T6 must not break)", async () => {
    let activations = 0;
    const ctx = {
      agents: { get: (id: string) => (id === "p-live" ? parent : undefined) },
      subagents: {
        list: () => ["spawn"],
        startActivation: async () => {
          activations++;
          return {
            childId: "c1",
            result: Promise.resolve({
              output: [{ type: "text", text: '{"summary":"live"}' }],
              stopReason: "completed",
              structured: { summary: "live" },
            }),
            dispose: async () => undefined,
          };
        },
      },
      llm: {
        stream: () => {
          throw new Error("must not reach llm.stream when subagent succeeds");
        },
      },
    } as unknown as DshContext;
    const parent = { session: { id: "p-live" } } as unknown as DshAgent;
    const result = await synthesize(ctx, parent, { prompt: "summarize" }, silentLogger());
    expect(result.lane).toBe("subagent");
    expect(activations).toBe(1);
  });

  it("aborting the parent mid-flight falls through to detached llm.stream", async () => {
    // First (and only) parent-bound attempt aborts the way Archive does:
    // `drainDescendants` disposes the child → stopReason aborted.
    let activations = 0;
    const parent = {
      session: { id: "p-archived" },
      options: { provider: "deepseek", model: "deepseek-chat" },
    } as unknown as DshAgent;
    const ctx = {
      agents: { get: () => parent },
      subagents: {
        list: () => ["spawn"],
        startActivation: async () => {
          activations++;
          return {
            childId: "c-aborted",
            result: Promise.resolve({ output: [], stopReason: "aborted" }),
            dispose: async () => undefined,
          };
        },
      },
      ...streamCtx('{"summary":"detached-ok"}'),
    } as unknown as DshContext;
    const warnings: string[] = [];
    const logger: WikiLogger = {
      info: () => undefined,
      warn: (m: string) => warnings.push(m),
      error: () => undefined,
    };
    const result = await synthesize(ctx, parent, { prompt: "summarize" }, logger);
    expect(result.lane).toBe("llm-stream");
    expect(result.text).toContain("detached-ok");
    // Parent-gone abort must NOT waste a second parent-bound retry.
    expect(activations).toBe(1);
    expect(warnings.some((w) => /parent gone/i.test(w))).toBe(true);
  });

  it("uses the dispatch-time snapshot even after the parent object is disposed", async () => {
    // Simulate: route captured at dispatch, then the origin agent object is
    // mutated by disposal (options deleted) before the drain runs.
    const liveParent = {
      session: { id: "p-snap" },
      options: { provider: "deepseek", model: "deepseek-chat" },
    } as unknown as DshAgent & { options?: unknown };
    const dispatchSnapshot = snapshotLlmRoute(liveParent, { prompt: "hi" });
    expect(dispatchSnapshot).toEqual({ provider: "deepseek", model: "deepseek-chat" });
    // Dispose mutates the parent: options gone, registry drops it.
    delete liveParent.options;
    const ctx = {
      agents: { get: () => undefined },
      subagents: {
        list: () => ["spawn"],
        startActivation: async () => {
          throw new Error("must not start a parent-bound child after dispose");
        },
      },
      ...streamCtx('{"summary":"snapshot-ok"}', { provider: "deepseek", model: "deepseek-chat" }),
    } as unknown as DshContext;
    const result = await synthesize(
      ctx,
      liveParent,
      {
        prompt: "hi",
        agentOptions: { provider: dispatchSnapshot.provider, model: dispatchSnapshot.model },
      },
      silentLogger(),
    );
    expect(result.lane).toBe("llm-stream");
    expect(result.text).toContain("snapshot-ok");
  });

  it("detached:true skips subagent entirely (no parent-bound child to abort)", async () => {
    let activations = 0;
    const parent = {
      session: { id: "p-detached" },
      options: { provider: "deepseek", model: "deepseek-chat" },
    } as unknown as DshAgent;
    const ctx = {
      subagents: {
        list: () => ["spawn"],
        startActivation: async () => {
          activations++;
          throw new Error("must not be called in detached mode");
        },
      },
      ...streamCtx('{"summary":"detached-only"}'),
    } as unknown as DshContext;
    const result = await synthesize(ctx, parent, { prompt: "hi", detached: true }, silentLogger());
    expect(result.lane).toBe("llm-stream");
    expect(activations).toBe(0);
  });

  it("parent already gone at entry skips subagent via the agents registry", async () => {
    let activations = 0;
    const parent = {
      session: { id: "p-gone" },
      options: { provider: "deepseek", model: "deepseek-chat" },
    } as unknown as DshAgent;
    const ctx = {
      agents: { get: () => undefined },
      subagents: {
        list: () => ["spawn"],
        startActivation: async () => {
          activations++;
          throw new Error("must not be called when parent is gone");
        },
      },
      ...streamCtx('{"summary":"gone-at-entry"}'),
    } as unknown as DshContext;
    const warnings: string[] = [];
    const logger: WikiLogger = {
      info: () => undefined,
      warn: (m: string) => warnings.push(m),
      error: () => undefined,
    };
    const result = await synthesize(ctx, parent, { prompt: "hi" }, logger);
    expect(result.lane).toBe("llm-stream");
    expect(activations).toBe(0);
    expect(warnings.some((w) => /detached lane/i.test(w))).toBe(true);
  });

  it("ordinary child errors still retry without preset before llm.stream", async () => {
    // Non-abort failure ("error") must keep the old two-step subagent path
    // so transient preset issues still recover without losing structure.
    const calls: string[] = [];
    const parent = { session: { id: "p-retry" } } as unknown as DshAgent;
    const ctx = {
      subagents: {
        list: () => ["spawn"],
        startActivation: async (spec: Record<string, unknown>) => {
          const req = spec.request as { agentPreset?: string };
          calls.push(req.agentPreset ?? "no-preset");
          return {
            childId: "c",
            result: Promise.resolve({ output: [], stopReason: "error" }),
            dispose: async () => undefined,
          };
        },
      },
      llm: {},
    } as unknown as DshContext;
    await expect(synthesize(ctx, parent, { prompt: "x" }, silentLogger())).rejects.toThrow(
      /wiki synthesis unavailable/,
    );
    expect(calls.length).toBe(2);
  });
});

describe("background needsLlm survives origin archive (T5.3/H28 integration)", () => {
  it("finishes detached synthesis and logs instead of injecting into another session", async () => {
    const logs: string[] = [];
    const logger: WikiLogger = {
      info: (m: string) => logs.push(m),
      warn: (m: string) => logs.push(m),
      error: (m: string) => logs.push(m),
    };
    // Origin starts alive (whenIdle gates the drain), then Archive disposes
    // it mid-synthesis: inject throws, registry drops it.
    let driving = true;
    const idleWaiters: Array<() => void> = [];
    const origin = {
      session: { id: "sess-archive" },
      options: { provider: "deepseek", model: "deepseek-chat" },
      get status() {
        return driving ? "running" : "idle";
      },
      whenIdle: () =>
        new Promise<void>((resolve) => {
          idleWaiters.push(resolve);
        }),
      inject: (_input: unknown) => undefined,
    } as unknown as DshAgent & { options: { provider: string; model: string } };
    const otherInjects: unknown[] = [];
    const other = {
      session: { id: "sess-other" },
      inject: (input: unknown) => {
        otherInjects.push(input);
      },
    } as unknown as DshAgent;
    void other;
    const subagentCalls: number[] = [];
    const ctx = {
      agents: {
        // After archive the origin is no longer the exact live agent.
        get: (id: string) => (id === "sess-archive" && !archived ? origin : undefined),
      },
      subagents: {
        list: () => ["spawn"],
        startActivation: async () => {
          subagentCalls.push(1);
          if (!archived) throw new Error("should only run after archive in this probe");
          return {
            childId: "c",
            result: Promise.resolve({ output: [], stopReason: "aborted" }),
            dispose: async () => undefined,
          };
        },
      },
      llm: {
        stream: () => {
          async function* gen() {
            yield { kind: "text-delta", delta: '{"summary":"survived"}' };
            yield { kind: "finish" };
          }
          return gen();
        },
      },
    } as unknown as DshContext;
    let archived = false;
    const runtime = createDshRuntime(ctx, logger);
    // Snapshot the route at dispatch (origin still alive) the way
    // runIngest now does: override > taskModel > parent.options.
    const dispatchRoute = { ...origin.options };
    const task = runtime.launchTask({
      label: "ingest:SRC-ARCHIVE",
      agent: origin,
      vaultRoot: "/v",
      needsLlm: true,
      work: async () => {
        const result = await synthesize(
          ctx,
          origin,
          {
            prompt: "summarize",
            agentOptions: { provider: dispatchRoute.provider, model: dispatchRoute.model },
          },
          logger,
        );
        expect(result.lane).toBe("llm-stream");
        return `LLM Wiki: ingested SRC-ARCHIVE → 1 entity, 1 concept`;
      },
    });
    // Let the needsLlm queue register while driving, then go idle.
    await new Promise((r) => setTimeout(r, 10));
    driving = false;
    const idleP = (origin.whenIdle as () => Promise<void>)();
    for (const w of idleWaiters.splice(0)) w();
    await idleP;
    // Archive mid-flight: inject now throws, registry drops the origin.
    archived = true;
    (origin as { inject: (input: unknown) => void }).inject = () => {
      throw new Error("session disposed");
    };
    await task;
    expect(logs.some((l) => /origin session closed/i.test(l))).toBe(true);
    expect(otherInjects).toHaveLength(0);
    runtime.dispose();
  });
});
