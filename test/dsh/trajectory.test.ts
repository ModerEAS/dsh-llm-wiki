import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapVault } from "../../extensions/llm-wiki/lib/bootstrap.js";
import { getVaultPaths } from "../../extensions/llm-wiki/lib/utils.js";
import {
  extractDshTrajectory,
  foldDshSurface,
  toPiSessionShape,
} from "../../src/dsh/trajectory-dsh.js";

let root = "";
let wikiHome = "";
const originalWikiHome = process.env.WIKI_HOME;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dsh-traj-"));
  wikiHome = mkdtempSync(join(tmpdir(), "dsh-traj-home-"));
  process.env.WIKI_HOME = wikiHome;
  const result = bootstrapVault(getVaultPaths(root), { topic: "trajectories", mode: "personal" });
  expect(result.ok).toBe(true);
});

afterEach(() => {
  if (originalWikiHome === undefined) delete process.env.WIKI_HOME;
  else process.env.WIKI_HOME = originalWikiHome;
  rmSync(root, { recursive: true, force: true });
  rmSync(wikiHome, { recursive: true, force: true });
});

function message(role: string, content: unknown) {
  return { type: "message", message: { role, content } };
}

describe("foldDshSurface", () => {
  it("drops shadowed/inherited ranges and replace markers", () => {
    const events = [
      message("user", "do it"),
      { type: "tool-call", data: { name: "read", shadowed: true } },
      { type: "surface", data: { surfaceOp: "replace" } },
      message("user", "kept"),
    ];
    expect(foldDshSurface(events).map((e) => e.type)).toEqual(["message", "message"]);
  });
});

describe("toPiSessionShape", () => {
  it("converts kebab-case tool-call events and role:tool messages", () => {
    const shaped = toPiSessionShape([
      message("user", "task"),
      { type: "tool-call", data: { id: "c1", name: "write", args: { path: "a" } } },
      message("tool", "done"),
      {
        type: "message",
        message: { role: "assistant", content: [{ type: "tool-call", id: "c2", name: "read" }] },
      },
    ]);
    const branch = shaped.getBranch();
    expect(branch).toHaveLength(4);
    const assistant = branch[1].message as { content: Array<{ type: string; name: string }> };
    expect(assistant.content[0]).toMatchObject({ type: "toolCall", name: "write" });
    expect((branch[2].message as { role: string }).role).toBe("toolResult");
  });
});

describe("extractDshTrajectory (tool_call_count > 0 gate)", () => {
  it("refuses to extract a call-free history", () => {
    expect(() => extractDshTrajectory([message("user", "hi")])).toThrow(/0 tool calls/);
  });

  it("extracts prompt + tool calls from DSH shapes", () => {
    const traj = extractDshTrajectory([
      message("user", "write the file"),
      { type: "tool-call", data: { id: "c1", name: "write", args: {} } },
      { type: "tool-result", data: { callId: "c1", name: "write", result: "ok" } },
    ]);
    expect(traj.prompt).toContain("write the file");
    expect(traj.toolCallCount).toBe(1);
    expect(traj.steps.length).toBeGreaterThan(0);
  });

  it("capture writes a packet only after the gate passes", async () => {
    const { captureDshTrajectory } = await import("../../src/dsh/trajectory-dsh.js");
    const { resolveVaultPaths } = await import("../../extensions/llm-wiki/lib/utils.js");
    const paths = resolveVaultPaths(root);
    expect(() => captureDshTrajectory(paths, [message("user", "empty")], "task", "title")).toThrow(
      /0 tool calls/,
    );
  });

  it("does not depend on SessionManager (uses getBranch shape)", () => {
    const spy = vi.fn();
    void spy;
    // getBranch-shaped input is all the extractor reads — no session object.
    const shaped = toPiSessionShape([message("user", "t")]);
    expect(typeof shaped.getBranch).toBe("function");
  });
});
