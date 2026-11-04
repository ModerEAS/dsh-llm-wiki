import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DshContext } from "../../src/dsh/types.js";
import {
  configForVault,
  resolveRowConfig,
  setDshConfigOverrides,
} from "../../src/dsh/vault-state.js";

/**
 * The DSH settings bridge: Settings → LLM Wiki writes the plugin row config,
 * `apply` installs it as overrides, and `configForVault` merges
 * `{ ...fileConfig, ...overrides }` per key. Row values win; untouched keys
 * keep coming from the vault's settings files; nothing leaks between vaults.
 */

let base = "";

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "dsh-cfg-bridge-"));
});

afterEach(() => {
  setDshConfigOverrides(undefined);
  rmSync(base, { recursive: true, force: true });
});

function vault(name: string, settings: Record<string, unknown>) {
  const root = join(base, name);
  const dot = join(root, ".llm-wiki");
  mkdirSync(dot, { recursive: true });
  mkdirSync(join(root, ".dsh"), { recursive: true });
  writeFileSync(join(root, ".dsh", "settings.json"), JSON.stringify({ "llm-wiki": settings }));
  return { root, dot };
}

describe("row config overrides (settings bridge)", () => {
  it("wins over file config and invalidates the cached config", () => {
    const a = vault("a", { autoRecall: false, notices: false, trajectories: false });
    const before = configForVault(a.root, a.dot);
    expect(before.autoRecall).toBe(false);

    setDshConfigOverrides({ autoRecall: true, trajectories: true });

    const after = configForVault(a.root, a.dot);
    expect(after.autoRecall).toBe(true);
    expect(after.trajectories).toBe(true);
    // Untouched key still comes from the file underneath the overrides.
    expect(after.notices).toBe(false);
    expect(after).not.toBe(before);
  });

  it("drops undefined and empty values so files keep applying", () => {
    const a = vault("a", { autoRecall: false, notices: false });
    const applied = setDshConfigOverrides({ autoRecall: undefined, notices: true, taskModel: "" });
    expect(applied).toEqual({ notices: true });
    const config = configForVault(a.root, a.dot);
    expect(config.autoRecall).toBe(false);
    expect(config.taskModel).toBeUndefined();
  });

  it("converts the schema's taskModel string into a TaskConfig spec", () => {
    const applied = setDshConfigOverrides({ taskModel: "anthropic/claude-haiku" });
    expect(applied.taskModel).toEqual({ provider: "anthropic", id: "claude-haiku" });
    // Bare ids / partial refs are not valid model specs.
    expect(setDshConfigOverrides({ taskModel: "claude-haiku" })).toEqual({});
    expect(setDshConfigOverrides({ taskModel: "openrouter/meta/llama-3" }).taskModel).toEqual({
      provider: "openrouter",
      id: "meta/llama-3",
    });
  });

  it("carries the reminder and policy switches through the same bridge", () => {
    const applied = setDshConfigOverrides({
      proactiveCapture: false,
      observationReminder: false,
      reminderTurns: 2,
    });
    expect(applied).toEqual({
      proactiveCapture: false,
      observationReminder: false,
      reminderTurns: 2,
    });
  });

  it("never leaks one vault's file values into another", () => {
    const a = vault("a", { autoRecall: false });
    const b = vault("b", { autoRecall: true });
    setDshConfigOverrides({ notices: false });

    const aCfg = configForVault(a.root, a.dot);
    const bCfg = configForVault(b.root, b.dot);
    expect(aCfg.autoRecall).toBe(false);
    expect(bCfg.autoRecall).toBe(true);
    expect(aCfg.notices).toBe(false);
    expect(bCfg.notices).toBe(false);
    expect(bCfg).not.toBe(aCfg);

    // Re-reading one vault must not disturb the other's cached object.
    configForVault(a.root, a.dot, true);
    expect(configForVault(b.root, b.dot)).toBe(bCfg);
  });
});

describe("resolveRowConfig (explicit row config only)", () => {
  const withLoader = (entries: unknown[]): DshContext =>
    ({ loader: { entries: () => entries } }) as unknown as DshContext;

  it("returns the llm-wiki row config, not schema defaults", () => {
    const ctx = withLoader([
      { options: { id: "other", config: { trajectories: true } } },
      { options: { id: "llm-wiki", config: { autoRecall: false } } },
    ]);
    // `apply(ctx, {autoRecall: true, notices: true})` carries defaults; the
    // loader path must win so they cannot mask the user's GUI choice.
    expect(resolveRowConfig(ctx, { autoRecall: true, notices: true })).toEqual({
      autoRecall: false,
    });
  });

  it("treats a loader without our row as 'nothing explicit'", () => {
    const ctx = withLoader([{ options: { id: "some-other-plugin", config: { a: 1 } } }]);
    expect(resolveRowConfig(ctx, { autoRecall: true })).toEqual({});
  });

  it("falls back to the validated argument when no loader exists", () => {
    const ctx = {} as DshContext;
    expect(resolveRowConfig(ctx, { autoRecall: false })).toEqual({ autoRecall: false });
    expect(resolveRowConfig(ctx, undefined)).toBeUndefined();
  });

  it("survives a throwing loader", () => {
    const ctx = {
      loader: {
        entries: () => {
          throw new Error("no loader");
        },
      },
    } as unknown as DshContext;
    expect(resolveRowConfig(ctx, { notices: false })).toEqual({ notices: false });
  });
});
