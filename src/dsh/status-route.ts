/**
 * WebUI sidebar data route (G1): `GET /wiki/status.json[?cwd=...][?session=...]`.
 *
 * Serves the same payload as `wiki_status`/`/wiki-status` (vault stats +
 * `capabilities` self-check, G3) plus the in-memory `WikiUiState` badges
 * (`WikiUiState` snapshot + per-session transient lines for the composer
 * dock, G2/G4) plus dashboard essentials (raw queue, zero-backlinks,
 * stale count, embedding flag, last-7d activity).
 *
 * Transport note (GAP N4): this is path A (`ctx.webServer.register`,
 * exact route). If the profile composes no `webServer` service (e.g.
 * headless), registration is skipped and the route simply does not exist —
 * the sidebar falls back to B (workspaceFiles/session slot, documented in
 * `docs/dsh.md`). Nothing throws; the plugin activates either way.
 */

import { collectDashboardStats } from "../../extensions/llm-wiki/lib/dashboard.js";
import { resolveVaultPaths } from "../../extensions/llm-wiki/lib/utils.js";
import type { WikiLogger } from "./logger.js";
import { buildWikiStatusPayload } from "./runners.js";
import type { DshContext } from "./types.js";
import { getSessionLines, getUiSnapshot, knownVaults } from "./ui-state.js";

export const WIKI_STATUS_PATH = "/wiki/status.json";

function json(res: { setHeader?: unknown; end?: unknown }, code: number, body: unknown): void {
  const text = JSON.stringify(body);
  try {
    (res as { statusCode?: number }).statusCode = code;
  } catch {
    /* best effort */
  }
  try {
    (res.setHeader as (name: string, value: string) => void)?.call(
      res,
      "content-type",
      "application/json; charset=utf-8",
    );
  } catch {
    /* best effort */
  }
  try {
    const end = res.end as ((data: string) => void) | undefined;
    if (typeof end === "function") {
      end.call(res, text);
      return;
    }
  } catch {
    /* fall through to throw below */
  }
  throw new Error(`status route: response unavailable (http ${code}) ${text.slice(0, 120)}`);
}

function queryOf(url: string | undefined): URLSearchParams {
  try {
    return new URL(url ?? WIKI_STATUS_PATH, "http://localhost").searchParams;
  } catch {
    return new URLSearchParams();
  }
}

/**
 * Register the exact GET route. Returns a disposer (or a no-op when
 * `webServer` is absent). Duplicate registration throws per the webServer
 * contract — callers must register once per plugin generation.
 */
export function registerStatusRoute(ctx: DshContext, logger?: WikiLogger): () => void {
  // NOTE: reading an uninjected service off the cordis proxy THROWS (even
  // behind `?.`), so the access itself must be guarded — headless profiles
  // compose no `webServer` and must degrade silently to fallback B.
  let register: unknown;
  try {
    register = (ctx as { webServer?: { register?: unknown } }).webServer?.register;
  } catch {
    register = undefined;
  }
  if (typeof register !== "function") {
    return () => undefined;
  }
  let dispose: (() => void) | undefined;
  try {
    dispose = (
      register as (route: {
        kind: "exact";
        path: string;
        handler: (req: unknown, res: unknown) => void | Promise<void>;
      }) => () => void
    ).call((ctx as { webServer: unknown }).webServer, {
      kind: "exact",
      path: WIKI_STATUS_PATH,
      handler: async (req: unknown, res: unknown) => {
        try {
          const request = req as { url?: string; method?: string };
          if (request.method && request.method !== "GET") {
            json(res as never, 405, { error: "method_not_allowed" });
            return;
          }
          const query = queryOf(request.url);
          const sessionId = query.get("session") ?? undefined;
          // Session-aware vault resolution: the composer dock (G2) passes
          // its session id; the panel passes ?cwd= from useWorkspaces.
          const sessionCwd = (() => {
            try {
              if (!sessionId) return undefined;
              const agent = ctx.agents?.get?.(sessionId);
              if (!agent) return undefined;
              const dir = ctx.workingDirectory?.get?.(agent.session);
              return typeof dir === "string" && dir.length > 0 ? dir : undefined;
            } catch {
              return undefined;
            }
          })();
          const cwd = query.get("cwd") ?? sessionCwd ?? process.cwd();
          const paths = resolveVaultPaths(cwd);
          const { details } = await buildWikiStatusPayload(cwd, ctx);
          let dashboard: Record<string, unknown> = {};
          try {
            const stats = await collectDashboardStats(cwd);
            dashboard = {
              rawQueue: stats.rawQueue,
              zeroBacklinks: stats.zeroBacklinks,
              staleCount: stats.staleCount,
              embEnabled: stats.embEnabled,
              last7dByKind: stats.last7dByKind,
              last7dTotal: stats.last7dTotal,
            };
          } catch (error) {
            logger?.warn?.(`status dashboard stats failed: ${(error as Error).message}`);
          }
          const ui = getUiSnapshot(paths.root);
          // Noisy transient lines honor `notices: false` (G2/G4).
          const transient = sessionId && ui.notices !== false ? getSessionLines(sessionId) : [];
          json(res as never, 200, {
            ok: true,
            vaultRoot: paths.root,
            status: details,
            dashboard,
            ui,
            transient,
            vaults: knownVaults(),
          });
        } catch (error) {
          logger?.warn?.(`status route failed: ${(error as Error).message}`);
          try {
            json(res as never, 500, { ok: false, error: (error as Error).message });
          } catch {
            /* response already gone */
          }
        }
      },
    });
  } catch (error) {
    logger?.warn?.(`status route registration failed: ${(error as Error).message}`);
    return () => undefined;
  }
  const cleanup = typeof dispose === "function" ? dispose : () => undefined;
  try {
    ctx.effect?.(() => cleanup, "llm-wiki status route");
  } catch {
    /* headless harnesses may lack ctx.effect */
  }
  return cleanup;
}
