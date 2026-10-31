import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapVault } from "../../extensions/llm-wiki/lib/bootstrap.js";
import { getVaultPaths } from "../../extensions/llm-wiki/lib/utils.js";
import { registerStatusRoute, WIKI_STATUS_PATH } from "../../src/dsh/status-route.js";
import type { DshContext } from "../../src/dsh/types.js";
import { patchUiState, pushSessionLine, resetUiState } from "../../src/dsh/ui-state.js";

let root = "";
let wikiHome = "";
const originalWikiHome = process.env.WIKI_HOME;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dsh-route-"));
  wikiHome = mkdtempSync(join(tmpdir(), "dsh-route-home-"));
  process.env.WIKI_HOME = wikiHome;
  expect(bootstrapVault(getVaultPaths(root), { topic: "route", mode: "personal" }).ok).toBe(true);
  resetUiState();
});

afterEach(() => {
  if (originalWikiHome === undefined) delete process.env.WIKI_HOME;
  else process.env.WIKI_HOME = originalWikiHome;
  rmSync(root, { recursive: true, force: true });
  rmSync(wikiHome, { recursive: true, force: true });
  resetUiState();
});

type Handler = (req: unknown, res: unknown) => void | Promise<void>;

function fakeHost() {
  const routes = new Map<string, Handler>();
  const ctx = {
    webServer: {
      register: (route: { kind: string; path: string; handler: Handler }) => {
        routes.set(route.path, route.handler);
        return () => {
          routes.delete(route.path);
        };
      },
    },
  } as unknown as DshContext;
  return { ctx, routes };
}

function fakeRes() {
  const chunks: string[] = [];
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    end(data: string) {
      chunks.push(data);
    },
  };
  return { res, chunks };
}

describe("status route (G1)", () => {
  it("serves vault stats + dashboard + ui snapshot as JSON", async () => {
    const { ctx, routes } = fakeHost();
    const off = registerStatusRoute(ctx);
    expect(routes.has(WIKI_STATUS_PATH)).toBe(true);
    patchUiState(root, { loaded: true, toolCount: 18 });
    pushSessionLine("sess-1", "recalled 2 page(s) for this task");
    const { res, chunks } = fakeRes();
    await routes.get(WIKI_STATUS_PATH)?.(
      { url: `${WIKI_STATUS_PATH}?cwd=${encodeURIComponent(root)}&session=sess-1` },
      res,
    );
    expect(chunks).toHaveLength(1);
    expect(res.headers["content-type"]).toContain("application/json");
    const body = JSON.parse(chunks[0]);
    expect(body.ok).toBe(true);
    expect(body.vaultRoot).toBe(root);
    expect((body.status as { totalPages: number }).totalPages).toBeGreaterThanOrEqual(0);
    expect(body.status.capabilities).toBeTruthy();
    expect(body.dashboard).toBeTruthy();
    expect(body.ui.loaded).toBe(true);
    expect(body.transient).toHaveLength(1);
    expect(body.vaults).toContain(root);
    off();
    expect(routes.has(WIKI_STATUS_PATH)).toBe(false);
  });

  it("hides transient lines when notices are off", async () => {
    const { ctx, routes } = fakeHost();
    registerStatusRoute(ctx);
    patchUiState(root, { loaded: true, notices: false });
    pushSessionLine("sess-9", "recalled 1 page(s)");
    const { res, chunks } = fakeRes();
    await routes.get(WIKI_STATUS_PATH)?.(
      { url: `${WIKI_STATUS_PATH}?cwd=${encodeURIComponent(root)}&session=sess-9` },
      res,
    );
    const body = JSON.parse(chunks[0]);
    expect(body.transient).toEqual([]);
  });

  it("is a no-op without a webServer service (fallback B)", () => {
    expect(() => registerStatusRoute({} as DshContext)).not.toThrow();
  });
});
