import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapVault } from "../../extensions/llm-wiki/lib/bootstrap.js";
import { getVaultPaths } from "../../extensions/llm-wiki/lib/utils.js";
import { createDshRuntime } from "../../src/dsh/background.js";
import { buildWikiCommands } from "../../src/dsh/commands.js";
import { createLogger } from "../../src/dsh/logger.js";
import { buildWikiTools, registerWikiTools } from "../../src/dsh/tool-defs.js";
import type { DshContext } from "../../src/dsh/types.js";

let root = "";
let wikiHome = "";
const originalWikiHome = process.env.WIKI_HOME;
const warnings: string[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dsh-tools-"));
  wikiHome = mkdtempSync(join(tmpdir(), "dsh-tools-home-"));
  process.env.WIKI_HOME = wikiHome;
  warnings.length = 0;
  const result = bootstrapVault(getVaultPaths(root), { topic: "tools", mode: "personal" });
  expect(result.ok).toBe(true);
});

afterEach(() => {
  if (originalWikiHome === undefined) delete process.env.WIKI_HOME;
  else process.env.WIKI_HOME = originalWikiHome;
  rmSync(root, { recursive: true, force: true });
  rmSync(wikiHome, { recursive: true, force: true });
});

function host() {
  const ctx = {
    workingDirectory: { get: () => root },
  } as unknown as DshContext;
  const logger = {
    info: () => undefined,
    warn: (m: string) => warnings.push(m),
    error: () => undefined,
  };
  const runtime = createDshRuntime({}, logger);
  return { ctx, runtime, logger };
}

describe("buildWikiTools", () => {
  it("defines 18 tools with unique names and output contracts", () => {
    const tools = buildWikiTools(host());
    expect(tools).toHaveLength(18);
    expect(new Set(tools.map((t) => t.name)).size).toBe(18);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.output.schema).toBeTruthy();
      expect(typeof tool.output.render).toBe("function");
      expect(typeof tool.execute).toBe("function");
    }
    expect(tools.map((t) => t.name)).toContain("wiki_capture_trajectory");
  });

  it("parameters compile to a JSON Schema object root (register contract)", () => {
    const tools = buildWikiTools(host());
    for (const tool of tools) {
      const params = tool.parameters as Record<string, unknown>;
      // The host registry (and the model API behind it) needs a real object
      // root — the raw DSL map serializes with `type: null` and the model
      // API 400s the function schema.
      expect(params.type).toBe("object");
      expect(params.properties).toBeTypeOf("object");
      const props = params.properties as Record<string, Record<string, unknown>>;
      for (const [key, node] of Object.entries(props)) {
        // `required: true` hoists to the parent array, never stays on the node.
        expect(node.required, `${tool.name}.${key}.required`).toBeUndefined();
        if (node.type === "object") {
          expect(typeof node.additionalProperties, `${tool.name}.${key}`).toBe("boolean");
        }
      }
    }
    const bootstrap = tools.find((t) => t.name === "wiki_bootstrap");
    expect(bootstrap?.parameters).toMatchObject({
      type: "object",
      required: ["topic"],
    });
  });

  it("wiki_status returns structured data on a real vault", async () => {
    const h = host();
    const tools = buildWikiTools(h);
    const status = tools.find((t) => t.name === "wiki_status");
    const value = await status?.execute({}, { agent: { session: { id: "s" } } });
    expect(value?.text).toContain("LLM Wiki Status");
    expect(value?.data).toMatchObject({ totalPages: expect.any(Number) });
  });

  it("failing tools reject (never resolve isError-shaped success)", async () => {
    const h = host();
    const tools = buildWikiTools(h);
    const search = tools.find((t) => t.name === "wiki_search");
    await expect(search?.execute({}, { agent: { session: { id: "s" } } })).rejects.toThrow();
  });

  it("trajectory tools gate at runtime when the feature is off", async () => {
    const h = host();
    const tools = buildWikiTools(h);
    const capture = tools.find((t) => t.name === "wiki_capture_trajectory");
    const value = await capture?.execute({ steps: [] }, { agent: { session: { id: "s" } } });
    expect(value?.text).toContain("opt-in");
    expect(value?.data).toMatchObject({ enabled: false });
  });
});

describe("registerWikiTools (duplicate-safe, H12)", () => {
  it("keeps the existing tool and warns instead of throwing", () => {
    const registered = new Map<string, unknown>();
    const ctx = {
      workingDirectory: { get: () => root },
      tools: {
        get: (name: string) => registered.get(name),
        register: (def: { name: string }) => {
          registered.set(def.name, def);
        },
      },
    } as unknown as DshContext;
    const logger = {
      info: () => undefined,
      warn: (m: string) => warnings.push(m),
      error: () => undefined,
    };
    const runtime = createDshRuntime({}, logger);
    expect(registerWikiTools({ ctx, runtime, logger })).toHaveLength(18);
    warnings.length = 0;
    expect(registerWikiTools({ ctx, runtime, logger })).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe("buildWikiCommands", () => {
  it("registers query + work commands with the followup split (A7)", async () => {
    const h = host();
    const commands = buildWikiCommands(h);
    const names = commands.map((c) => c.name);
    for (const name of [
      "wiki-status",
      "wiki-search",
      "wiki-recall",
      "wiki-lint",
      "wiki-bootstrap",
      "wiki-ingest",
      "wiki-model",
      "wiki-trajectories",
    ]) {
      expect(names).toContain(name);
    }
    const status = commands.find((c) => c.name === "wiki-status");
    const result = await status?.handler({ agent: { session: { id: "s" } }, rawInput: "" });
    expect(result).toMatchObject({ kind: "success" });

    const followups: unknown[] = [];
    const agent = { session: { id: "s" }, followup: (input: unknown) => followups.push(input) };
    const bootstrap = commands.find((c) => c.name === "wiki-bootstrap");
    const queued = await bootstrap?.handler({ agent, rawInput: "my topic" });
    expect(queued).toMatchObject({ kind: "success" });
    expect(followups).toHaveLength(1);
  });

  it("wiki-model shows and sets the task model without TUI", async () => {
    const h = host();
    const commands = buildWikiCommands(h);
    const agent = { session: { id: "s" } };
    const model = commands.find((c) => c.name === "wiki-model");
    const shown = await model?.handler({ agent, rawInput: "" });
    expect(shown).toMatchObject({ kind: "success" });
    const bad = await model?.handler({ agent, rawInput: "not-a-ref" });
    expect(bad).toMatchObject({ kind: "error" });
  });

  it("wiki-trajectories toggles without reload (H11)", async () => {
    const h = host();
    const commands = buildWikiCommands(h);
    const agent = { session: { id: "s" } };
    const trajectories = commands.find((c) => c.name === "wiki-trajectories");
    expect(await trajectories?.handler({ agent, rawInput: "on" })).toMatchObject({
      kind: "success",
    });
    expect(await trajectories?.handler({ agent, rawInput: "off" })).toMatchObject({
      kind: "success",
    });
    expect(await trajectories?.handler({ agent, rawInput: "maybe" })).toMatchObject({
      kind: "error",
    });
  });

  it("createLogger never throws and falls back without ctx", () => {
    const logger = createLogger(undefined);
    expect(() => {
      logger.info("i");
      logger.warn("w");
      logger.error("e");
    }).not.toThrow();
  });
});
