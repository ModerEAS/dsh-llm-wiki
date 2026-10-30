import { describe, expect, it } from "vitest";
import { detectHost } from "../../extensions/llm-wiki/lib/host.js";
import { WIKI_STATUS_BLOCK } from "../../extensions/llm-wiki/lib/inject.js";
import { defaultPolicy } from "../../src/dsh/approval.js";
import { runCommand } from "../../src/dsh/exec.js";
import { isMainSession } from "../../src/dsh/recall-inject.js";
import { synthesize } from "../../src/dsh/synthesis.js";

describe("runCommand (self-managed timeout, H09)", () => {
  it("rejects hung commands after the plugin-owned deadline", async () => {
    await expect(
      runCommand({}, process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { timeoutMs: 400 }),
    ).rejects.toThrow(/timed out or was aborted/);
  }, 15000);

  it("rejects non-zero exits with stderr detail", async () => {
    await expect(
      runCommand({}, process.execPath, ["-e", "console.error('kaput'); process.exit(3)"], {
        timeoutMs: 10000,
      }),
    ).rejects.toThrow(/exited 3.*kaput/);
  }, 15000);

  it("enforces the approval allow-list before spawning", async () => {
    await expect(
      runCommand({}, "definitely-not-a-wiki-program", ["--help"], {
        policy: defaultPolicy(["/tmp"]),
        cwd: "/tmp",
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/allow-list/);
  });
});

describe("isMainSession (H27: subagents skip bootstrap/ambient)", () => {
  it("detects main vs child sessions", () => {
    expect(isMainSession({ session: { id: "a", header: {} } })).toBe(true);
    expect(isMainSession({ session: { id: "b", header: { parentSession: "a" } } })).toBe(false);
    expect(isMainSession({ session: { id: "c", header: { origin: "subagent" } } })).toBe(false);
    expect(isMainSession({ session: { id: "d", header: { delegationDepth: 1 } } })).toBe(false);
  });
});

describe("static section footer (A6: byte-stable)", () => {
  it("is constant text safe for systemPrompt.section", () => {
    expect(typeof WIKI_STATUS_BLOCK).toBe("string");
    expect(WIKI_STATUS_BLOCK).toContain("wiki_recall");
    expect(WIKI_STATUS_BLOCK.length).toBeGreaterThan(0);
  });
});

describe("synthesize (no apiKey lane, H03)", () => {
  it("fails observably when no lane exists (never a silent checklist)", async () => {
    await expect(synthesize({}, undefined, { prompt: "hi" })).rejects.toThrow(
      /wiki synthesis unavailable/,
    );
  });

  it("uses the subagent lane with structured handoff when available", async () => {
    const ctx = {
      subagents: {
        list: () => ["spawn"],
        startActivation: async () => ({
          childId: "c1",
          result: Promise.resolve({
            output: [{ type: "text", text: '{"summary":"s"}' }],
            stopReason: "completed",
            structured: { summary: "s" },
          }),
          dispose: async () => undefined,
        }),
      },
    };
    const parent = { session: { id: "p" } };
    const result = await synthesize(ctx, parent, { prompt: "summarize" });
    expect(result.lane).toBe("subagent");
    expect(result.structured).toEqual({ summary: "s" });
  });

  it("surfaces child failures instead of swallowing them", async () => {
    const ctx = {
      subagents: {
        list: () => ["spawn"],
        startActivation: async () => ({
          childId: "c1",
          result: Promise.resolve({ output: [], stopReason: "error" }),
          dispose: async () => undefined,
        }),
      },
      llm: {},
    };
    await expect(synthesize(ctx, { session: { id: "p" } }, { prompt: "x" })).rejects.toThrow();
  });
});

describe("detectHost (dsh branch, H33)", () => {
  it("honors LLM_WIKI_HOST=dsh and DSH_PROFILE markers", () => {
    const prevHost = process.env.LLM_WIKI_HOST;
    const prevProfile = process.env.DSH_PROFILE;
    try {
      process.env.LLM_WIKI_HOST = "dsh";
      expect(detectHost()).toBe("dsh");
      delete process.env.LLM_WIKI_HOST;
      process.env.DSH_PROFILE = "desktop";
      expect(detectHost()).toBe("dsh");
    } finally {
      if (prevHost === undefined) delete process.env.LLM_WIKI_HOST;
      else process.env.LLM_WIKI_HOST = prevHost;
      if (prevProfile === undefined) delete process.env.DSH_PROFILE;
      else process.env.DSH_PROFILE = prevProfile;
    }
  });
});
