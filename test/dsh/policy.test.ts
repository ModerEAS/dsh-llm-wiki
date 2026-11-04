import { describe, expect, it } from "vitest";
import { proactiveCaptureEnabled } from "../../extensions/llm-wiki/lib/task-config.js";
import { installPolicySection, WIKI_POLICY_BLOCK } from "../../src/dsh/recall-inject.js";
import type { DshContext } from "../../src/dsh/types.js";

/**
 * The proactive-capture policy replaces the deleted `~/.dsh/AGENTS.md` +
 * `~/.dsh/skills/llm-wiki` workaround: it belongs to the plugin, so every
 * install carries it, and it is a static system-prompt section so the provider
 * prefix cache stays warm.
 */
describe("WIKI_POLICY_BLOCK", () => {
  it("states the whole capture contract", () => {
    for (const needle of [
      "wiki_recall",
      "wiki_observe",
      "wiki_retro",
      "wiki_ensure_page",
      "wiki_capture_source",
      "wiki_ingest",
      "Skip pure chat",
      "Never write passwords",
      "not complete until",
    ]) {
      expect(WIKI_POLICY_BLOCK).toContain(needle);
    }
  });

  it("is byte-stable across turns (no dates, cwd, or template holes)", () => {
    expect(WIKI_POLICY_BLOCK).toBe(WIKI_POLICY_BLOCK);
    expect(WIKI_POLICY_BLOCK).not.toContain("${");
    expect(WIKI_POLICY_BLOCK).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(WIKI_POLICY_BLOCK).not.toContain(process.cwd());
    expect(WIKI_POLICY_BLOCK.trim()).toBe(WIKI_POLICY_BLOCK);
  });
});

describe("installPolicySection", () => {
  it("registers one static section before the status footer", () => {
    const sections: Array<{ name?: string; order?: number; text?: unknown }> = [];
    const ctx = {
      systemPrompt: {
        section: (spec: { name?: string; order?: number; text?: unknown }) => {
          sections.push(spec);
          return () => undefined;
        },
      },
    } as unknown as DshContext;

    const dispose = installPolicySection(ctx);
    expect(typeof dispose).toBe("function");
    expect(sections).toHaveLength(1);
    expect(sections[0].name).toBe("llm-wiki-policy");
    expect(sections[0].order).toBeGreaterThan(0);
    expect(sections[0].order).toBeLessThan(900);
    expect((sections[0].text as () => string)()).toBe(WIKI_POLICY_BLOCK);
  });

  it("degrades when the host has no systemPrompt service", () => {
    const dispose = installPolicySection({} as DshContext);
    expect(typeof dispose).toBe("function");
    expect(() => dispose()).not.toThrow();
  });
});

describe("proactiveCapture gate", () => {
  it("is on by default and only an explicit false turns it off", () => {
    expect(proactiveCaptureEnabled(undefined)).toBe(true);
    expect(proactiveCaptureEnabled({})).toBe(true);
    expect(proactiveCaptureEnabled({ proactiveCapture: true })).toBe(true);
    expect(proactiveCaptureEnabled({ proactiveCapture: false })).toBe(false);
  });
});
