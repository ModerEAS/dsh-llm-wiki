import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapVault } from "../../extensions/llm-wiki/lib/bootstrap.js";
import { getVaultPaths } from "../../extensions/llm-wiki/lib/utils.js";
import {
  createReminderState,
  decideReminder,
  installObservationReminder,
  REMINDER_TEXT,
  type ReminderInput,
  WIKI_WRITE_TOOLS,
} from "../../src/dsh/observe-reminder.js";
import type { DshAgent, DshContext, PreStepDecision } from "../../src/dsh/types.js";
import { setDshConfigOverrides } from "../../src/dsh/vault-state.js";

function input(over: Partial<ReminderInput> = {}): ReminderInput {
  return {
    step: 1,
    turn: 1,
    main: true,
    applies: true,
    enabled: true,
    interval: 5,
    ...over,
  };
}

describe("decideReminder (pure turn counting)", () => {
  it("counts one turn per payload.turn, not one per step", () => {
    const state = createReminderState();
    expect(decideReminder(state, input({ turn: 7, step: 1 }))).toBe(false);
    for (let step = 2; step <= 6; step++) {
      expect(decideReminder(state, input({ turn: 7, step }))).toBe(false);
    }
    expect(state.turns).toBe(1);
    expect(decideReminder(state, input({ turn: 8, step: 1 }))).toBe(false);
    expect(state.turns).toBe(2);
  });

  it("reminds on the interval-th turn and resets the counter", () => {
    const state = createReminderState();
    const reminded = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter((turn) =>
      decideReminder(state, input({ turn, interval: 5 })),
    );
    expect(reminded).toEqual([5, 10]);
    expect(state.turns).toBe(0);
  });

  it("takes the interval from settings", () => {
    const state = createReminderState();
    const reminded = [1, 2, 3, 4].filter((turn) =>
      decideReminder(state, input({ turn, interval: 2 })),
    );
    expect(reminded).toEqual([2, 4]);
  });

  it("never reminds when disabled", () => {
    const state = createReminderState();
    for (let turn = 1; turn <= 20; turn++) {
      expect(decideReminder(state, input({ turn, enabled: false }))).toBe(false);
    }
    expect(state.turns).toBe(0);
  });

  it("skips subagents and wiki-less sessions without accumulating", () => {
    const state = createReminderState();
    for (const turn of [1, 2, 3, 4, 5]) {
      expect(decideReminder(state, input({ turn, main: false }))).toBe(false);
    }
    for (const turn of [6, 7, 8, 9, 10]) {
      expect(decideReminder(state, input({ turn, applies: false }))).toBe(false);
    }
    expect(state.turns).toBe(0);
    // Counting resumes from zero once a wiki applies again.
    for (const turn of [11, 12, 13, 14]) {
      expect(decideReminder(state, input({ turn }))).toBe(false);
    }
    expect(decideReminder(state, input({ turn: 15 }))).toBe(true);
  });

  it("stays silent once the session wrote to the wiki", () => {
    const state = createReminderState();
    state.wrote = true;
    for (let turn = 1; turn <= 20; turn++) {
      expect(decideReminder(state, input({ turn }))).toBe(false);
    }
    expect(state.turns).toBe(0);
  });

  it("ignores events without a turn counter", () => {
    const state = createReminderState();
    expect(decideReminder(state, input({ turn: null }))).toBe(false);
    expect(state.turns).toBe(0);
  });
});

describe("installObservationReminder (DSH hooks)", () => {
  let root = "";
  let wikiHome = "";
  const originalWikiHome = process.env.WIKI_HOME;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "dsh-reminder-"));
    wikiHome = mkdtempSync(join(tmpdir(), "dsh-reminder-home-"));
    process.env.WIKI_HOME = wikiHome;
    expect(bootstrapVault(getVaultPaths(root), { topic: "reminder", mode: "personal" }).ok).toBe(
      true,
    );
  });

  afterEach(() => {
    setDshConfigOverrides(undefined);
    if (originalWikiHome === undefined) delete process.env.WIKI_HOME;
    else process.env.WIKI_HOME = originalWikiHome;
    rmSync(root, { recursive: true, force: true });
    rmSync(wikiHome, { recursive: true, force: true });
  });

  function harness() {
    const listeners = new Map<string, (...args: never[]) => unknown>();
    const ctx = {
      workingDirectory: { get: () => root },
      on: (event: string, listener: (...args: never[]) => unknown) => {
        listeners.set(event, listener);
        return () => {
          listeners.delete(event);
        };
      },
      effect: () => undefined,
    } as unknown as DshContext;
    return { ctx, listeners };
  }

  const agent = (id: string, header: Record<string, unknown> = {}): DshAgent => ({
    session: { id, header },
  });

  async function preStep(
    listeners: Map<string, (...args: never[]) => unknown>,
    payload: Record<string, unknown>,
  ): Promise<PreStepDecision> {
    const listener = listeners.get("agent/pre-step") as (
      payload: Record<string, unknown>,
      next: () => Promise<PreStepDecision>,
    ) => Promise<PreStepDecision>;
    expect(listener).toBeTypeOf("function");
    return listener(payload, async () => ({
      kind: "enter",
      messages: [{ role: "user", content: "do the work" }],
    }));
  }

  it("appends the reminder after 5 quiet turns without dropping the prompt", async () => {
    const { ctx, listeners } = harness();
    installObservationReminder(ctx);

    for (let turn = 1; turn <= 4; turn++) {
      const decision = await preStep(listeners, { agent: agent("s1"), turn, step: 1 });
      expect(decision.messages).toHaveLength(1);
    }
    const fifth = await preStep(listeners, { agent: agent("s1"), turn: 5, step: 1 });
    expect(fifth.kind).toBe("enter");
    expect(fifth.messages).toHaveLength(2);
    expect(fifth.messages?.[0]).toMatchObject({ role: "user", content: "do the work" });
    expect(fifth.messages?.[1]).toMatchObject({
      role: "user",
      source: { kind: "llm-wiki-reminder" },
      content: [{ type: "text", text: REMINDER_TEXT }],
    });

    // A later step of the same turn must not append a second reminder.
    const sixthStep = await preStep(listeners, { agent: agent("s1"), turn: 5, step: 2 });
    expect(sixthStep.messages).toHaveLength(1);
  });

  it("stops reminding after a wiki write in the session", async () => {
    const { ctx, listeners } = harness();
    installObservationReminder(ctx);
    const session = agent("s2");
    (listeners.get("tools/result") as (exec: unknown) => void)({
      name: "wiki_observe",
      agent: session,
    });
    for (let turn = 1; turn <= 12; turn++) {
      const decision = await preStep(listeners, { agent: session, turn, step: 1 });
      expect(decision.messages).toHaveLength(1);
    }
  });

  it("ignores non-write tool results", async () => {
    const { ctx, listeners } = harness();
    installObservationReminder(ctx);
    const session = agent("s3");
    (listeners.get("tools/result") as (exec: unknown) => void)({ name: "read", agent: session });
    const decisions: PreStepDecision[] = [];
    for (let turn = 1; turn <= 5; turn++) {
      decisions.push(await preStep(listeners, { agent: session, turn, step: 1 }));
    }
    expect(decisions.at(-1)?.messages).toHaveLength(2);
  });

  it("honors observationReminder=false from settings", async () => {
    mkdirSync(join(root, ".dsh"), { recursive: true });
    writeFileSync(
      join(root, ".dsh", "settings.json"),
      JSON.stringify({ "llm-wiki": { observationReminder: false } }),
    );
    const off = harness();
    installObservationReminder(off.ctx);
    for (let turn = 1; turn <= 12; turn++) {
      const decision = await preStep(off.listeners, { agent: agent("s4"), turn, step: 1 });
      expect(decision.messages).toHaveLength(1);
    }
  });

  it("honors a custom reminderTurns from settings", async () => {
    mkdirSync(join(root, ".dsh"), { recursive: true });
    writeFileSync(
      join(root, ".dsh", "settings.json"),
      JSON.stringify({ "llm-wiki": { reminderTurns: 2 } }),
    );
    const on = harness();
    installObservationReminder(on.ctx);
    const first = await preStep(on.listeners, { agent: agent("s5"), turn: 1, step: 1 });
    expect(first.messages).toHaveLength(1);
    const second = await preStep(on.listeners, { agent: agent("s5"), turn: 2, step: 1 });
    expect(second.messages).toHaveLength(2);
  });

  it("takes the reminder switches from the GUI row config, not just files", async () => {
    setDshConfigOverrides({ reminderTurns: 1 });
    const { ctx, listeners } = harness();
    installObservationReminder(ctx);
    const decision = await preStep(listeners, { agent: agent("s6"), turn: 1, step: 1 });
    expect(decision.messages).toHaveLength(2);
  });

  it("skips subagent sessions", async () => {
    const { ctx, listeners } = harness();
    installObservationReminder(ctx);
    const sub = agent("s7", { parentSession: "main-1" });
    for (let turn = 1; turn <= 12; turn++) {
      const decision = await preStep(listeners, { agent: sub, turn, step: 1 });
      expect(decision.messages).toHaveLength(1);
    }
  });

  it("drops per-session state when the agent is disposed", () => {
    const { ctx, listeners } = harness();
    installObservationReminder(ctx);
    (listeners.get("agent/created") as (p: unknown) => void)({ agent: agent("s8") });
    (listeners.get("tools/result") as (exec: unknown) => void)({
      name: "wiki_retro",
      agent: agent("s8"),
    });
    expect(() =>
      (listeners.get("agent/disposed") as (p: unknown) => void)({ agent: agent("s8") }),
    ).not.toThrow();
  });

  it("knows which tools count as a wiki write", () => {
    expect([...WIKI_WRITE_TOOLS].sort()).toEqual([
      "wiki_capture_source",
      "wiki_ensure_page",
      "wiki_ingest",
      "wiki_observe",
      "wiki_retro",
    ]);
  });
});
