import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapVault } from "../../extensions/llm-wiki/lib/bootstrap.js";
import { getVaultPaths } from "../../extensions/llm-wiki/lib/utils.js";
import { buildWikiStatusPayload, runStatus } from "../../src/dsh/runners.js";
import type { DshContext } from "../../src/dsh/types.js";

let root = "";
let wikiHome = "";
const originalWikiHome = process.env.WIKI_HOME;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dsh-status-"));
  wikiHome = mkdtempSync(join(tmpdir(), "dsh-status-home-"));
  process.env.WIKI_HOME = wikiHome;
  expect(bootstrapVault(getVaultPaths(root), { topic: "caps", mode: "personal" }).ok).toBe(true);
});

afterEach(() => {
  if (originalWikiHome === undefined) delete process.env.WIKI_HOME;
  else process.env.WIKI_HOME = originalWikiHome;
  rmSync(root, { recursive: true, force: true });
  rmSync(wikiHome, { recursive: true, force: true });
});

describe("runStatus capabilities (G3/C8)", () => {
  it("reports semantic/jobs/cwd/switches in details and text", async () => {
    const ctx = { jobs: { start: () => "j" } } as unknown as DshContext;
    const { lines, details } = await buildWikiStatusPayload(root, ctx);
    const cap = details.capabilities as Record<string, unknown>;
    expect(cap.semantic).toBe("off");
    expect(cap.jobs).toBe("available");
    expect(cap.cwd).toBe(root);
    expect(cap.autoRecall).toBe(true);
    expect(cap.trajectories).toBe(false);
    expect(cap.notices).toBe(true);
    expect(cap.taskModel).toBe("(session model)");
    const text = lines.join("\n");
    for (const needle of ["Semantic:", "Jobs:", "Cwd:", "AutoRecall:", "Synthesis model:"]) {
      expect(text).toContain(needle);
    }
    const value = await runStatus(root, { ctx });
    const data = value.data as Record<string, unknown>;
    expect((data.capabilities as Record<string, unknown>).jobs).toBe("available");
  });

  it("marks jobs missing/unknown without a jobs service", async () => {
    const noStart = await buildWikiStatusPayload(root, { jobs: {} } as unknown as DshContext);
    expect((noStart.details.capabilities as Record<string, unknown>).jobs).toBe("missing");
    // An uninjected `jobs` service reads as a proxy throw → `unknown`.
    const throwing = await buildWikiStatusPayload(
      root,
      {
        get jobs(): unknown {
          throw new Error('cannot get property "jobs" without inject');
        },
      } as unknown as DshContext,
    );
    expect((throwing.details.capabilities as Record<string, unknown>).jobs).toBe("unknown");
    const bare = await buildWikiStatusPayload(root);
    expect((bare.details.capabilities as Record<string, unknown>).jobs).toBe("missing");
  });
});
