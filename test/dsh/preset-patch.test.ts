import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as YAML from "yaml";
import { SYNTHESIS_PRESET_ID } from "../../src/dsh/synthesis.js";

/** Shipped bundle patch must register the synthesis preset for the
 * Settings → Agent presets UI without poisoning the host default (T6.3). */

function loadPatch(): unknown[] {
  const raw = readFileSync(join(__dirname, "../../dsh/cordis.patch.yml"), "utf-8");
  return YAML.parse(raw) as unknown[];
}

describe("synthesis preset patch (T6.3 / H13)", () => {
  it("registers llm-wiki-synthesis with a visible name/description", () => {
    const patch = loadPatch();
    const rows = patch.flatMap((entry) =>
      Array.isArray((entry as { insert?: unknown[] }).insert)
        ? (entry as { insert: Record<string, unknown>[] }).insert
        : [],
    );
    const preset = rows.find((row) => row.id === "preset-llm-wiki-synthesis") as
      | { name?: string; config?: Record<string, unknown> }
      | undefined;
    expect(preset).toBeDefined();
    expect(preset?.name).toBe("@deepseek-ai/dsh-agent-preset");
    const config = preset?.config as Record<string, unknown>;
    expect(config.id).toBe(SYNTHESIS_PRESET_ID);
    expect(config.id).toBe("llm-wiki-synthesis");
    expect(typeof config.name).toBe("string");
    expect(String(config.name).length).toBeGreaterThan(0);
    expect(typeof config.description).toBe("string");
    expect(String(config.description).length).toBeGreaterThan(0);
    expect(typeof config.order).toBe("number");
  });

  it("never sets the registry default to the synthesis preset", () => {
    const raw = readFileSync(join(__dirname, "../../dsh/cordis.patch.yml"), "utf-8");
    expect(raw).not.toMatch(/default:\s*llm-wiki-synthesis/);
    const patch = loadPatch();
    const rows = patch.flatMap((entry) =>
      Array.isArray((entry as { insert?: unknown[] }).insert)
        ? (entry as { insert: Record<string, unknown>[] }).insert
        : [],
    );
    for (const row of rows) {
      const config = (row as { config?: Record<string, unknown> }).config;
      if (config && "default" in config) {
        expect(config.default).not.toBe("llm-wiki-synthesis");
      }
    }
  });

  it("does not touch the main Standard preset (H13: no commit tools in main mode)", () => {
    const patch = loadPatch();
    const rows = patch.flatMap((entry) =>
      Array.isArray((entry as { insert?: unknown[] }).insert)
        ? (entry as { insert: Record<string, unknown>[] }).insert
        : [],
    );
    const ids = rows.map((row) => (row as { id?: string }).id);
    expect(ids).not.toContain("preset-standard");
    expect(ids).not.toContain("agent-preset-registry");
  });

  it("keeps the synthesis preset persona-only (outputSchema handoff, no tool grants)", () => {
    const patch = loadPatch();
    const rows = patch.flatMap((entry) =>
      Array.isArray((entry as { insert?: unknown[] }).insert)
        ? (entry as { insert: Record<string, unknown>[] }).insert
        : [],
    );
    const preset = rows.find((row) => row.id === "preset-llm-wiki-synthesis") as {
      config?: { plugins?: { id?: string; name?: string }[] };
    };
    const plugins = preset?.config?.plugins ?? [];
    // Proven T6.3 v2 shape: persona only. Tools would widen the child;
    // commit tools in particular must never leak to Standard (H13).
    expect(plugins.length).toBeGreaterThan(0);
    for (const plugin of plugins) {
      expect(plugin.name).not.toMatch(/tool/i);
    }
    expect(plugins.some((p) => p.id === "persona")).toBe(true);
  });
});
