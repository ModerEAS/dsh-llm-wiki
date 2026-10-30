/**
 * DSH-native LLM Wiki plugin entry (cordis Host plugin).
 *
 * Form: `export const inject` + `export function apply(ctx, config)` +
 * `export const Config` (see the cordis-plugin-development skill,
 * references/host-plugin.md). Every registration below is owned by the
 * plugin fiber (`ctx.effect` / `ctx.on` auto-revoke on unload); jobs and
 * per-agent handles are tracked explicitly and torn down in our own effect
 * so HMR never stacks generations (H29/B8).
 *
 * HMR survival for ALREADY-OPEN sessions: `apply()` first walks
 * `ctx.agents.list()` and installs per-agent state for survivors, then
 * subscribes to `agent/created` for new ones. Registrations placed on
 * `agent.ctx` are additionally keyed in the plugin effect, because
 * unloading the plugin does not dispose `agent.ctx` by itself.
 *
 * The pi extension (`extensions/llm-wiki/`) is intentionally left running
 * for one release cycle (DECISIONS A1); all new code lives here (`src/dsh/`)
 * plus the temporary bootstrap shims in `src/compat/`.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { bootstrapVault } from "../../extensions/llm-wiki/lib/bootstrap.js";
import { recoverQmdIndex } from "../../extensions/llm-wiki/lib/qmd-indexing.js";
import { personalVaultIsAmbient } from "../../extensions/llm-wiki/lib/task-config.js";
import {
  migrateDoubledPersonalVault,
  resolveProjectVaultRoot,
  resolveVaultPaths,
} from "../../extensions/llm-wiki/lib/utils.js";
import { createDshRuntime, watchCompaction } from "./background.js";
import { registerWikiCommands } from "./commands.js";
import { installDshGuardrails, selfCheckGuardrails } from "./guard.js";
import { createLogger } from "./logger.js";
import { installPreStepListener, installRecallInjection, isMainSession } from "./recall-inject.js";
import { registerSettingsUi, WikiConfigSchema } from "./settings-ui.js";
import { registerWikiTools } from "./tool-defs.js";
import type { DshAgent, DshContext } from "./types.js";
import { configForVault } from "./vault-state.js";

export const PLUGIN_ID = "llm-wiki";

/** Core services every profile must compose; the rest is defensive-optional. */
export const inject = ["tools", "agents", "systemPrompt", "subagents", "llm", "workingDirectory", "commands", "settings", "tokenMeter"];

/** Row-config schema (validated at activation; see settings-ui.ts). */
export const Config = WikiConfigSchema;

function agentCwd(ctx: DshContext, agent: DshAgent): string {
  try {
    const dir = ctx.workingDirectory?.get?.(agent.session);
    if (typeof dir === "string" && dir.length > 0) return dir;
  } catch {
    /* fall through */
  }
  return process.cwd();
}

export function apply(ctx: DshContext, _config?: unknown): () => void {
  const logger = createLogger(ctx);
  const runtime = createDshRuntime(ctx, logger);
  const host = { ctx, runtime, logger };
  const disposers: Array<() => void> = [];
  const installedAgents = new Set<object>();
  const agentDisposers = new Map<object, () => void>();
  let selfChecked = false;
  let migrationDone = false;

  const track = (dispose: () => void): void => {
    disposers.push(dispose);
  };

  // ── Shared (profile-wide) surfaces ──────────────────────
  try {
    const tools = registerWikiTools(host);
    logger.info(`registered ${tools.length} wiki tools`);
  } catch (error) {
    logger.warn(`tool registration failed: ${(error as Error).message}`);
  }
  try {
    track(installDshGuardrails(ctx, logger));
  } catch (error) {
    logger.warn(`guard install failed: ${(error as Error).message}`);
  }
  try {
    installRecallInjection(ctx, runtime, logger);
  } catch (error) {
    logger.warn(`recall injection failed: ${(error as Error).message}`);
  }
  try {
    track(watchCompaction(ctx, runtime, logger));
  } catch (error) {
    logger.warn(`compaction watch failed: ${(error as Error).message}`);
  }
  try {
    const commands = registerWikiCommands(host);
    logger.info(`registered ${commands.length} wiki commands`);
  } catch (error) {
    logger.warn(`command registration failed: ${(error as Error).message}`);
  }
  try {
    registerSettingsUi(ctx, logger);
  } catch (error) {
    logger.warn(`settings UI failed: ${(error as Error).message}`);
  }

  // ── Per-agent surfaces (survivors + newcomers) ──────────
  function ensureAgent(agent: DshAgent): void {
    if (!agent || installedAgents.has(agent)) return;
    installedAgents.add(agent);
    const perAgent: Array<() => void> = [];
    agentDisposers.set(agent, () => {
      for (const dispose of perAgent.splice(0)) {
        try {
          dispose();
        } catch {
          /* best effort */
        }
      }
    });
    try {
      const cwd = agentCwd(ctx, agent);

      // Startup self-check, once per plugin generation (H01): the decision
      // function is pure, so any cwd exercises it.
      if (!selfChecked) {
        selfChecked = true;
        const check = selfCheckGuardrails(cwd, logger);
        if (!check.ok) {
          logger.warn(`guard self-check FAILED: ${check.failures.join("; ")}`);
        }
      }

      // installPreStepListener is global; per-agent registration keeps the
      // behavior scoped if the host ever partitions pre-step by agent.ctx.
      // The disposers are keyed here so EITHER teardown removes them.
      try {
        const dispose = installPreStepListener(scopedCtx(ctx, agent), runtime, logger);
        perAgent.push(dispose);
      } catch (error) {
        logger.warn(`per-agent pre-step failed: ${(error as Error).message}`);
      }

      if (!isMainSession(agent)) return;

      if (!migrationDone) {
        migrationDone = true;
        try {
          const migration = migrateDoubledPersonalVault();
          if (migration && migration.moved.length > 0) {
            logger.warn(
              `personal wiki layout fixed: flattened ${migration.moved.length} entries out of ${migration.from}`,
            );
            try {
              agent.inject?.({
                content: `🧠 Personal wiki layout fixed: flattened ${migration.moved.length} entries (see CHANGELOG).`,
                source: { kind: "llm-wiki-notice" },
              });
            } catch {
              /* notice is best-effort */
            }
          }
        } catch (error) {
          logger.warn(`doubled-dotdir migration skipped: ${(error as Error).message}`);
        }
      }

      const vaultConfig = configForVault(cwd, resolveVaultPaths(cwd).dotWiki);
      const applies = resolveProjectVaultRoot(cwd) !== null || personalVaultIsAmbient(vaultConfig);
      if (!applies) return;

      const paths = resolveVaultPaths(cwd);
      if (!existsSync(join(paths.dotWiki, "config.json"))) {
        try {
          const result = bootstrapVault(paths, { topic: "pending", mode: "personal" });
          if (result.ok && result.projection.ok) {
            try {
              agent.inject?.({
                content:
                  "🧠 Wiki created (topic pending). Tell me what this project is about and I will configure it — or run /wiki-bootstrap <topic>.",
                source: { kind: "llm-wiki-notice" },
              });
            } catch {
              /* notice is best-effort */
            }
          } else {
            logger.warn(`auto-bootstrap blocked at ${paths.root}`);
          }
        } catch (error) {
          logger.warn(`auto-bootstrap failed: ${(error as Error).message}`);
        }
        return;
      }

      // Fire-and-forget QMD recovery (generated state only; never blocks).
      void runtime
        .launchTask({
          label: `qmd-recovery:${paths.root}`,
          agent,
          vaultRoot: paths.root,
          work: async () => {
            try {
              await recoverQmdIndex(paths);
            } catch (error) {
              logger.warn(`QMD index recovery failed: ${(error as Error).message}`);
            }
            return null;
          },
        })
        .catch(() => undefined);
    } catch (error) {
      logger.warn(`ensureAgent failed: ${(error as Error).message}`);
    }
  }

  /** Narrow a context to one agent when the host supports agent.ctx. */
  function scopedCtx(base: DshContext, agent: DshAgent): DshContext {
    try {
      const agentCtx = (agent as { ctx?: Record<string, unknown> }).ctx;
      if (agentCtx && typeof agentCtx === "object") {
        return new Proxy(base, {
          get(target, prop, receiver) {
            if (prop === "on" || prop === "effect") {
              const scoped = (agentCtx as Record<string, unknown>)[prop as string];
              if (typeof scoped === "function") return scoped;
            }
            return Reflect.get(target, prop, receiver);
          },
        });
      }
    } catch {
      /* fall through to the shared context */
    }
    return base;
  }

  try {
    for (const agent of ctx.agents?.list?.() ?? []) ensureAgent(agent);
  } catch (error) {
    logger.warn(`agents.list() backfill failed: ${(error as Error).message}`);
  }
  try {
    if (typeof ctx.on === "function") {
      const offCreated = ctx.on("agent/created", ((payload: { agent?: DshAgent }) => {
        try {
          if (payload?.agent) ensureAgent(payload.agent);
        } catch (error) {
          logger.warn(`agent/created handler failed: ${(error as Error).message}`);
        }
      }) as (...args: never[]) => unknown);
      if (typeof offCreated === "function") track(offCreated);
      const offDisposed = ctx.on("agent/disposed", ((payload: { agent?: DshAgent }) => {
        try {
          const agent = payload?.agent;
          if (agent) {
            installedAgents.delete(agent);
            agentDisposers.get(agent)?.();
            agentDisposers.delete(agent);
          }
        } catch {
          /* best effort */
        }
      }) as (...args: never[]) => unknown);
      if (typeof offDisposed === "function") track(offDisposed);
    }
  } catch (error) {
    logger.warn(`agent lifecycle subscription failed: ${(error as Error).message}`);
  }

  // ── Unload: cancel background work, release everything ──
  const cleanup = (): void => {
    try {
      runtime.dispose();
    } catch {
      /* best effort */
    }
    for (const dispose of agentDisposers.values()) {
      try {
        dispose();
      } catch {
        /* best effort */
      }
    }
    agentDisposers.clear();
    installedAgents.clear();
    for (const dispose of disposers.splice(0)) {
      try {
        dispose();
      } catch {
        /* best effort */
      }
    }
  };
  try {
    ctx.effect?.(() => cleanup, "llm-wiki unload");
  } catch {
    /* headless harnesses may lack ctx.effect */
  }
  return cleanup;
}
