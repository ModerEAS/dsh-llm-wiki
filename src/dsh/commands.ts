/**
 * Slash commands for DSH (A7): query commands execute directly and return
 * text (no model message is created by a command run); work-initiating
 * commands preserve upstream semantics by `followup()`-injecting the
 * expanded prompt. The former TUI surfaces are NOT commands: settings lives
 * in the WebUI section (settings-ui.ts); the dashboard stays out of v1.
 */
import {
  loadTaskConfig,
  parseModelRef,
  persistTaskModel,
  persistTrajectoriesEnabled,
} from "../../extensions/llm-wiki/lib/task-config.js";
import { resolveVaultPaths } from "../../extensions/llm-wiki/lib/utils.js";
import type { DshRuntime } from "./background.js";
import { agentCwd } from "./guard.js";
import type { WikiLogger } from "./logger.js";
import { type RunnerDeps, runLint, runRecall, runSearch, runStatus } from "./runners.js";
import type { DshAgent, DshContext } from "./types.js";
import { invalidateVaultConfig } from "./vault-state.js";

export interface CommandHost {
  ctx: DshContext;
  runtime: DshRuntime;
  logger: WikiLogger;
}

interface Invocation {
  agent: DshAgent;
  rawInput: string;
  signal?: AbortSignal;
}

type CommandResult = { kind: "success"; text?: string } | { kind: "error"; text: string };

function depsFor(host: CommandHost, invocation: Invocation): RunnerDeps {
  return {
    ctx: host.ctx,
    agent: invocation.agent,
    signal: invocation.signal,
    logger: host.logger,
    runtime: host.runtime,
  };
}

function cwdFor(host: CommandHost, agent: DshAgent): string {
  return agentCwd(host.ctx, { agent } as never);
}

function followup(agent: DshAgent, prompt: string, logger?: WikiLogger): CommandResult {
  try {
    agent.followup?.({ content: prompt, source: { kind: "llm-wiki-command" } });
    return { kind: "success", text: `Queued: ${prompt.split("\n")[0]}` };
  } catch (error) {
    logger?.warn(`command followup failed: ${(error as Error).message}`);
    return { kind: "error", text: `Could not queue followup: ${(error as Error).message}` };
  }
}

async function direct(
  fn: () => Promise<{ text: string }>,
  logger?: WikiLogger,
): Promise<CommandResult> {
  try {
    const value = await fn();
    return { kind: "success", text: value.text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.warn(`command failed: ${message}`);
    return { kind: "error", text: message };
  }
}

export interface WikiCommand {
  name: string;
  description: string;
  hint?: string;
  handler: (invocation: Invocation) => CommandResult | Promise<CommandResult>;
}

export function buildWikiCommands(host: CommandHost): WikiCommand[] {
  return [
    {
      name: "wiki-status",
      description: "Report LLM Wiki health and stats for this project.",
      handler: (invocation) => direct(() => runStatus(cwdFor(host, invocation.agent)), host.logger),
    },
    {
      name: "wiki-search",
      description: "Search the wiki registry for pages matching a query.",
      hint: "<query>",
      handler: (invocation) =>
        direct(
          () => runSearch(cwdFor(host, invocation.agent), { query: invocation.rawInput.trim() }),
          host.logger,
        ),
    },
    {
      name: "wiki-recall",
      description: "Recall wiki pages relevant to the given task or question.",
      hint: "<task description>",
      handler: (invocation) =>
        direct(
          () =>
            runRecall(
              cwdFor(host, invocation.agent),
              { query: invocation.rawInput.trim() },
              depsFor(host, invocation),
            ),
          host.logger,
        ),
    },
    {
      name: "wiki-lint",
      description: "Check wiki health (orphans, missing pages, gaps). Add --fix to auto-fix.",
      hint: "[--fix]",
      handler: (invocation) =>
        direct(
          () =>
            runLint(cwdFor(host, invocation.agent), {
              auto_fix: /(^|\s)--fix(\s|$)/.test(invocation.rawInput),
            }),
          host.logger,
        ),
    },
    {
      name: "wiki-bootstrap",
      description: "Initialize an LLM Wiki vault here (topic + mode).",
      hint: "<topic>",
      handler: (invocation) => {
        const topic = invocation.rawInput.trim();
        if (!topic) return { kind: "error", text: "Usage: /wiki-bootstrap <topic>" };
        return followup(
          invocation.agent,
          `Use wiki_bootstrap with topic "${topic}" (mode personal) to initialize the LLM Wiki vault here, then confirm the structure.`,
          host.logger,
        );
      },
    },
    {
      name: "wiki-capture",
      description: "Capture a source (URL, file, or pasted text) into the wiki.",
      hint: "<url | file path | text>",
      handler: (invocation) => {
        const input = invocation.rawInput.trim();
        if (!input) return { kind: "error", text: "Usage: /wiki-capture <url | file path | text>" };
        return followup(
          invocation.agent,
          `Use wiki_capture_source to capture this source into the wiki, then summarize what was captured: ${input}`,
          host.logger,
        );
      },
    },
    {
      name: "wiki-ingest",
      description: "Ingest captured sources into wiki pages (background synthesis).",
      handler: (invocation) =>
        followup(
          invocation.agent,
          "Use wiki_ingest to process all uningested source packets (background synthesis). Report each completion briefly.",
          host.logger,
        ),
    },
    {
      name: "wiki-model",
      description: "Show or set the background synthesis model (provider/id).",
      hint: "[provider/id | clear]",
      handler: (invocation) => {
        const cwd = cwdFor(host, invocation.agent);
        const arg = invocation.rawInput.trim();
        try {
          if (!arg) {
            const config = loadTaskConfig(cwd);
            const current = config.taskModel
              ? `${config.taskModel.provider}/${config.taskModel.id}`
              : "(session model)";
            return { kind: "success", text: `Background synthesis model: ${current}` };
          }
          if (arg === "clear") {
            persistTaskModel(cwd, undefined);
            return {
              kind: "success",
              text: "Background synthesis model cleared (now: session model).",
            };
          }
          const ref = parseModelRef(arg);
          if (!ref)
            return {
              kind: "error",
              text: `Usage: /wiki-model [provider/id | clear] — got "${arg}"`,
            };
          persistTaskModel(cwd, ref);
          return {
            kind: "success",
            text: `Background synthesis model set to ${ref.provider}/${ref.id}.`,
          };
        } catch (error) {
          return { kind: "error", text: (error as Error).message };
        }
      },
    },
    {
      name: "wiki-trajectories",
      description: "Enable or disable agent-trajectory memory (capture/distill/recall skills).",
      hint: "[on | off]",
      handler: (invocation) => {
        const cwd = cwdFor(host, invocation.agent);
        const arg = invocation.rawInput.trim().toLowerCase();
        try {
          if (!arg) {
            const config = loadTaskConfig(cwd);
            const on = Boolean(config.trajectories);
            return {
              kind: "success",
              text: `Agent trajectories: ${on ? "enabled" : "disabled"}. Usage: /wiki-trajectories [on | off] (takes effect immediately — no reload needed).`,
            };
          }
          if (arg !== "on" && arg !== "off") {
            return { kind: "error", text: "Usage: /wiki-trajectories [on | off]" };
          }
          persistTrajectoriesEnabled(cwd, arg === "on");
          try {
            invalidateVaultConfig(resolveVaultPaths(cwd).root);
          } catch {
            /* best effort */
          }
          return {
            kind: "success",
            text: `Agent trajectories ${arg === "on" ? "enabled" : "disabled"}.`,
          };
        } catch (error) {
          return { kind: "error", text: (error as Error).message };
        }
      },
    },
  ];
}

/** Register every command. Duplicate-safe like tools (H12). */
export function registerWikiCommands(host: CommandHost): string[] {
  const registered: string[] = [];
  for (const command of buildWikiCommands(host)) {
    try {
      host.ctx.commands?.register?.({
        name: command.name,
        description: command.description,
        definitionId: `llm-wiki:${command.name}`,
        ...(command.hint ? { input: { hint: command.hint } } : {}),
        recordInput: false,
        handler: command.handler as never,
      });
      registered.push(command.name);
    } catch (error) {
      host.logger.warn(`command ${command.name} registration failed: ${(error as Error).message}`);
    }
  }
  return registered;
}
