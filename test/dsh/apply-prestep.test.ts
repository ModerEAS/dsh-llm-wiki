import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapVault } from "../../extensions/llm-wiki/lib/bootstrap.js";
import { getVaultPaths } from "../../extensions/llm-wiki/lib/utils.js";
import { createDshRuntime } from "../../src/dsh/background.js";
import { apply } from "../../src/dsh/index.js";
import { createLogger } from "../../src/dsh/logger.js";
import { installPreStepListener } from "../../src/dsh/recall-inject.js";
import type { DshAgent, DshContext, PreStepDecision } from "../../src/dsh/types.js";

let root = "";
let wikiHome = "";
const originalWikiHome = process.env.WIKI_HOME;
const originalCwd = process.cwd();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dsh-apply-"));
  wikiHome = mkdtempSync(join(tmpdir(), "dsh-apply-home-"));
  process.env.WIKI_HOME = wikiHome;
  const result = bootstrapVault(getVaultPaths(root), { topic: "apply", mode: "personal" });
  expect(result.ok).toBe(true);
});

afterEach(async () => {
  process.chdir(originalCwd);
  if (originalWikiHome === undefined) delete process.env.WIKI_HOME;
  else process.env.WIKI_HOME = originalWikiHome;
  // apply() fires a background QMD recovery into the vault; allow it a
  // beat to settle, then remove with retries instead of flaking ENOTEMPTY.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(root, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  rmSync(wikiHome, { recursive: true, force: true });
});

function agent(id: string, header: Record<string, unknown> = {}): DshAgent {
  return { session: { id, header } };
}

describe("installPreStepListener (D5/D11/H10)", () => {
  function harness() {
    const listeners = new Map<string, (...args: never[]) => unknown>();
    const effects: Array<() => unknown> = [];
    const ctx = {
      workingDirectory: { get: () => root },
      on: (event: string, listener: (...args: never[]) => unknown) => {
        listeners.set(event, listener);
        return () => {
          listeners.delete(event);
        };
      },
      effect: (fn: () => () => void) => {
        effects.push(fn());
      },
    } as unknown as DshContext;
    const runtime = createDshRuntime({}, createLogger(undefined));
    return { ctx, listeners, effects, runtime };
  }

  async function fire(
    listeners: Map<string, (...args: never[]) => unknown>,
    payload: Record<string, unknown>,
  ): Promise<PreStepDecision> {
    const listener = listeners.get("agent/pre-step");
    expect(listener).toBeTypeOf("function");
    const baseDecision: PreStepDecision = {
      kind: "enter",
      messages: [{ role: "user", content: "hello world" }],
    };
    return (await (listener as (...args: unknown[]) => Promise<PreStepDecision>)(
      payload,
      async () => baseDecision,
    )) as PreStepDecision;
  }

  it("passes non-first steps through untouched (one injection per turn)", async () => {
    const { ctx, listeners, runtime } = harness();
    installPreStepListener(ctx, runtime);
    const decision = await fire(listeners, { agent: agent("s1"), messages: [], turn: 3, step: 2 });
    expect(decision.messages).toHaveLength(1);
  });

  it("never replaces user messages (append-only, H10)", async () => {
    const { ctx, listeners, runtime } = harness();
    installPreStepListener(ctx, runtime);
    const decision = await fire(listeners, { agent: agent("s2"), messages: [], turn: 1, step: 1 });
    expect(decision.kind).toBe("enter");
    const first = (decision.messages ?? [])[0] as { role: string };
    expect(first.role).toBe("user");
  });

  it("degrades to the downstream decision when recall throws", async () => {
    const { listeners, runtime } = harness();
    const bad = {
      workingDirectory: {
        get: () => {
          throw new Error("nope");
        },
      },
      on: (event: string, listener: (...args: never[]) => unknown) => {
        listeners.set(event, listener);
        return () => undefined;
      },
      effect: () => undefined,
    } as unknown as DshContext;
    // process.cwd() fallback keeps even a broken workingDirectory service safe.
    process.chdir(root);
    installPreStepListener(bad, runtime);
    const decision = await fire(listeners, { agent: agent("s3"), messages: [], turn: 1, step: 1 });
    expect(decision.kind).toBe("enter");
  });
});

describe("apply (HMR backfill + unload, H29/B8)", () => {
  function fullCtx(survivors: DshAgent[]) {
    const tools = new Map<string, unknown>();
    const commands = new Map<string, unknown>();
    const events = new Map<string, (...args: never[]) => unknown>();
    const sections: unknown[] = [];
    const ctx = {
      workingDirectory: { get: () => root },
      tools: {
        get: (name: string) => tools.get(name),
        register: (def: { name: string }) => tools.set(def.name, def),
      },
      agents: { list: () => survivors },
      systemPrompt: { section: (spec: unknown) => sections.push(spec) },
      commands: { register: (spec: { name: string }) => commands.set(spec.name, spec) },
      on: (event: string, listener: (...args: never[]) => unknown) => {
        events.set(event, listener);
        return () => {
          events.delete(event);
        };
      },
      effect: () => undefined,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    } as unknown as DshContext;
    return { ctx, tools, commands, events, sections };
  }

  it("installs tools/commands/section and backfills surviving agents", () => {
    const survivor = agent("survivor-1");
    const { ctx, tools, commands, sections, events } = fullCtx([survivor]);
    const cleanup = apply(ctx);
    expect(tools.size).toBe(18);
    expect(commands.size).toBeGreaterThan(0);
    expect(sections).toHaveLength(1);
    expect(events.has("agent/created")).toBe(true);
    expect(events.has("agent/pre-step")).toBe(true);
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("late agent/created sessions get installed too", () => {
    const { ctx, events } = fullCtx([]);
    apply(ctx);
    const created = events.get("agent/created");
    expect(() => (created as (p: unknown) => void)({ agent: agent("late-1") })).not.toThrow();
  });
});
