import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapVault } from "../../extensions/llm-wiki/lib/bootstrap.js";
import { getVaultPaths } from "../../extensions/llm-wiki/lib/utils.js";
import { createDshRuntime } from "../../src/dsh/background.js";
import { createLogger } from "../../src/dsh/logger.js";
import { installPreStepListener } from "../../src/dsh/recall-inject.js";
import { runEnsurePage, runLogEvent, runRebuildMeta } from "../../src/dsh/runners.js";
import type { DshContext, PreStepDecision } from "../../src/dsh/types.js";
import { flagPendingRebuild, getVaultWriteQueue } from "../../src/dsh/vault-state.js";

let root = "";
let wikiHome = "";
const originalWikiHome = process.env.WIKI_HOME;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dsh-wiring-"));
  wikiHome = mkdtempSync(join(tmpdir(), "dsh-wiring-home-"));
  process.env.WIKI_HOME = wikiHome;
  const result = bootstrapVault(getVaultPaths(root), { topic: "wiring", mode: "personal" });
  expect(result.ok).toBe(true);
});

afterEach(() => {
  if (originalWikiHome === undefined) delete process.env.WIKI_HOME;
  else process.env.WIKI_HOME = originalWikiHome;
  rmSync(root, { recursive: true, force: true });
  rmSync(wikiHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function depsWithCapturedTasks() {
  const captured: Array<() => Promise<string | null>> = [];
  const runtime = {
    launchTask: (opts: { work: () => Promise<string | null> }) => {
      captured.push(opts.work as () => Promise<string | null>);
      return Promise.resolve();
    },
  } as unknown as ReturnType<typeof createDshRuntime>;
  return {
    ctx: { workingDirectory: { get: () => root } } as unknown as DshContext,
    agent: undefined,
    logger: createLogger(undefined),
    runtime,
    captured,
  };
}

describe("metadata rebuilds funnel through withVaultWrite (H30 wiring)", () => {
  it("runRebuildMeta enqueues on the vault root", async () => {
    const spy = vi.spyOn(getVaultWriteQueue(), "enqueue");
    try {
      const deps = depsWithCapturedTasks();
      const value = await runRebuildMeta(root, {}, deps);
      expect(value.text).toContain("Metadata rebuilt");
      expect(spy).toHaveBeenCalledWith(root, expect.any(Function));
    } finally {
      spy.mockRestore();
    }
  });

  it("runLogEvent enqueues on the vault root", async () => {
    const spy = vi.spyOn(getVaultWriteQueue(), "enqueue");
    try {
      const value = await runLogEvent(root, { kind: "wiring-probe" });
      expect(value.text).toContain("Event logged");
      expect(spy).toHaveBeenCalledWith(root, expect.any(Function));
    } finally {
      spy.mockRestore();
    }
  });

  it("scheduleLightRebuild work (via runEnsurePage) enqueues", async () => {
    const spy = vi.spyOn(getVaultWriteQueue(), "enqueue");
    try {
      const deps = depsWithCapturedTasks();
      await runEnsurePage(root, { type: "concept", title: "Wiring Probe" }, deps);
      expect(deps.captured).toHaveLength(1);
      await deps.captured[0]();
      expect(spy).toHaveBeenCalledWith(root, expect.any(Function));
    } finally {
      spy.mockRestore();
    }
  });

  it("recall pre-step pending rebuild enqueues", async () => {
    const listeners = new Map<string, (...args: never[]) => unknown>();
    const ctx = {
      workingDirectory: { get: () => root },
      on: (event: string, listener: (...args: never[]) => unknown) => {
        listeners.set(event, listener);
        return () => undefined;
      },
      effect: () => undefined,
    } as unknown as DshContext;
    const runtime = createDshRuntime({}, createLogger(undefined));
    try {
      installPreStepListener(ctx, runtime);
      const spy = vi.spyOn(getVaultWriteQueue(), "enqueue");
      try {
        flagPendingRebuild(root);
        const listener = listeners.get("agent/pre-step") as (
          ...args: unknown[]
        ) => Promise<PreStepDecision>;
        const base: PreStepDecision = {
          kind: "enter",
          messages: [{ role: "user", content: "" }],
        };
        const decision = await listener(
          { agent: { session: { id: "s-wiring" } }, turn: 1, step: 1 },
          async () => base,
        );
        expect(decision.kind).toBe("enter");
        expect(spy).toHaveBeenCalledWith(root, expect.any(Function));
      } finally {
        spy.mockRestore();
      }
    } finally {
      runtime.dispose();
    }
  });
});
