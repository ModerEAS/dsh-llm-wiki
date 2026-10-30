/**
 * The 18 wiki tools as DSH `defineTool` definitions (15 resident + 3
 * opt-in trajectory tools, always registered — H11).
 *
 * Model-facing names, descriptions and parameter meanings are kept identical
 * to the pi extension so prompts and muscle memory transfer. Three mechanical
 * adaptations (all per the verified dsh-tools contract):
 *
 * - `parameters` use DSH's schema DSL (`{ type, required?, description? }`),
 *   not TypeBox — and `def()` compiles the DSL map into the JSON Schema
 *   object root (`{ type: "object", properties, required? }`) that
 *   `ctx.tools.register` expects (`defineTool` does this in-tree; the raw
 *   DSL must never reach the host — it serializes with `type: null` and the
 *   model API rejects the function schema).
 * - `output` is mandatory: the uniform `{ text, data? }` envelope
 *   (`ENVELOPE_SCHEMA`), rendered from `text` only.
 * - `execute(args, exec)` returns the JSON value; failures propagate as
 *   rejections (runners throw `WikiToolError` instead of `isError: true`
 *   values — H06).
 *
 * Registration is duplicate-safe: if a tool name already exists in the
 * scope (e.g. a second install path — H12), we keep the existing one and
 * log instead of throwing the whole activation.
 */
import { trajectoriesEnabled } from "../../extensions/llm-wiki/lib/task-config.js";
import { resolveVaultPaths } from "../../extensions/llm-wiki/lib/utils.js";
import type { DshRuntime } from "./background.js";
import { ENVELOPE_SCHEMA, renderEnvelope, WikiToolError } from "./envelope.js";
import { agentCwd } from "./guard.js";
import type { WikiLogger } from "./logger.js";
import {
  type RunnerDeps,
  runBootstrap,
  runCaptureSource,
  runCaptureTrajectory,
  runDistillSkills,
  runEnsurePage,
  runIngest,
  runLint,
  runLogEvent,
  runObserve,
  runRebuildMeta,
  runRecall,
  runRecallSkill,
  runReindex,
  runReindexEmbeddings,
  runRetro,
  runSearch,
  runStatus,
  runWatch,
} from "./runners.js";
import type { DshContext, DshParameterSpec, DshToolDefinition, DshToolExec, WikiToolValue } from "./types.js";
import { configForVault } from "./vault-state.js";

export interface ToolHost {
  ctx: DshContext;
  runtime: DshRuntime;
  logger: WikiLogger;
}

function depsFor(host: ToolHost, exec: DshToolExec): RunnerDeps {
  return {
    ctx: host.ctx,
    agent: exec.agent,
    signal: exec.signal,
    logger: host.logger,
    runtime: host.runtime,
  };
}

function cwdFor(host: ToolHost, exec: DshToolExec): string {
  return agentCwd(host.ctx, exec);
}

type Runner = (
  cwd: string,
  args: Record<string, unknown>,
  deps: RunnerDeps,
) => Promise<WikiToolValue>;

function wrap(name: string, run: Runner): Runner {
  return async (cwd, args, deps) => {
    try {
      return await run(cwd, args, deps);
    } catch (error) {
      // Last-resort observable failure: runners already throw WikiToolError
      // with envelope data; unexpected throws become one too (never a
      // silent empty result, never an isError-shaped success).
      if (error instanceof WikiToolError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new WikiToolError(`wiki_${name} failed: ${message}`, {
        tool: `wiki_${name}`,
        error: message,
      });
    }
  };
}

/** Runtime gate for the 3 opt-in trajectory tools (H11: register always, gate at runtime). */
function gatedTrajectories(host: ToolHost, exec: DshToolExec): boolean {
  try {
    const cwd = cwdFor(host, exec);
    const paths = resolveVaultPaths(cwd);
    return trajectoriesEnabled(configForVault(paths.root, paths.dotWiki));
  } catch {
    return false;
  }
}

function trajectoryGateText(tool: string): WikiToolValue {
  return {
    text:
      `ℹ️ \`${tool}\` is opt-in and currently off. ` +
      `Enable it in Settings → LLM Wiki → "Agent trajectories", then retry. ` +
      `Query tools (wiki_search / wiki_recall) work regardless.`,
    data: { enabled: false, tool },
  };
}

/**
 * Compile the authoring DSL map into the JSON Schema object root the host
 * registry (and the model API behind it) expects. Mirrors the in-tree
 * `parameterSchemaSpecToJsonSchema` semantics: per-property `required: true`
 * hoists into the parent `required` array; annotations (`description`,
 * `default`) pass through; the author-only `json` type becomes an
 * annotation-only node; object nodes get explicit `additionalProperties`
 * (our object params are free-form, so the open default `true` applies).
 */
export function compileParameters(
  params: Record<string, DshParameterSpec>,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, spec] of Object.entries(params)) {
    const { required: req, ...node } = spec;
    properties[key] = compileNode(node as DshParameterSpec);
    if (req === true) required.push(key);
  }
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function compileNode(spec: DshParameterSpec): Record<string, unknown> {
  const { required: _req, items, properties, additionalProperties, ...rest } = spec;
  void _req;
  if (spec.type === "json") {
    const { type: _type, ...annotations } = rest;
    void _type;
    return annotations as Record<string, unknown>;
  }
  const node: Record<string, unknown> = { ...rest };
  if (spec.type === "array" && items) node.items = compileNode(items);
  if (spec.type === "object") {
    node.additionalProperties = additionalProperties ?? true;
    if (properties) {
      const sub: Record<string, unknown> = {};
      const subRequired: string[] = [];
      for (const [key, value] of Object.entries(properties)) {
        const { required: req, ...restValue } = value;
        sub[key] = compileNode(restValue as DshParameterSpec);
        if (req === true) subRequired.push(key);
      }
      node.properties = sub;
      if (subRequired.length > 0) node.required = subRequired;
    }
  }
  return node;
}

function def(
  host: ToolHost,
  definition: Omit<DshToolDefinition, "output" | "execute" | "parameters"> & {
    parameters: Record<string, DshParameterSpec>;
    run: Runner;
    trajectoryGated?: boolean;
  },
): DshToolDefinition {
  const run = wrap(definition.name, definition.run);
  return {
    name: definition.name,
    description: definition.description,
    parameters: compileParameters(definition.parameters),
    output: { schema: ENVELOPE_SCHEMA, render: renderEnvelope },
    execute: async (args: Record<string, unknown>, exec: DshToolExec) => {
      if (definition.trajectoryGated && !gatedTrajectories(host, exec)) {
        return trajectoryGateText(definition.name);
      }
      return run(cwdFor(host, exec), args, depsFor(host, exec));
    },
  };
}

const S = (description: string, required = false) => ({
  type: "string" as const,
  description,
  ...(required ? { required: true } : {}),
});
const N = (description: string, def?: number) => ({
  type: "number" as const,
  description,
  ...(def !== undefined ? { default: def } : {}),
});
const B = (description: string, def?: boolean) => ({
  type: "boolean" as const,
  description,
  ...(def !== undefined ? { default: def } : {}),
});

/** All 18 tool definitions, in pi registration order. */
export function buildWikiTools(host: ToolHost): DshToolDefinition[] {
  return [
    def(host, {
      name: "wiki_bootstrap",
      description:
        "Initialize a new LLM Wiki vault with the 4-layer architecture. Creates config, templates, schema, and metadata scaffolding.",
      parameters: {
        topic: S("Main topic of the wiki", true),
        mode: S("personal or company (default: personal)"),
        root: S("Root directory (default: current directory)"),
      },
      run: (cwd, args) => runBootstrap(cwd, args),
    }),
    def(host, {
      name: "wiki_capture_source",
      description:
        "Capture a URL, local file, or pasted text into an immutable source packet and skeleton source page.",
      parameters: {
        url: S("URL to capture"),
        file_path: S("Local file path to capture"),
        text: S("Pasted text content"),
        title: S("Title for pasted text"),
      },
      run: (cwd, args, deps) => runCaptureSource(cwd, args, deps),
    }),
    def(host, {
      name: "wiki_ingest",
      description:
        "Process uningested source packets. By default synthesis runs in the background (non-blocking) on the DSH synthesis lane; pass background=false to return extracted content for the main agent to synthesize itself.",
      parameters: {
        source_id: S("Specific source ID to ingest. Leave empty for all new."),
        batch_size: N("Max sources to process (default: 3, max: 5)", 3),
        background: B(
          "Synthesize in the background without blocking (default: true). Set false to return extracted content for the main agent to synthesize.",
          true,
        ),
        model: S(
          "Per-call model override as 'provider/id'. Overrides the configured wiki taskModel for this call.",
        ),
      },
      run: (cwd, args, deps) => runIngest(cwd, args, deps),
    }),
    def(host, {
      name: "wiki_ensure_page",
      description: "Resolve or safely create a canonical wiki page. Returns the page path.",
      parameters: {
        type: S(
          "Page type: entity | concept | synthesis | analysis | requirement | skill | case (built-in) or any user-defined type from llm-wiki.customTypes config",
          true,
        ),
        title: S("Page title", true),
        content: S(
          "Optional Markdown body. May begin with a YAML frontmatter block, whose fields are merged into the page frontmatter; generated fields (type, title, created, updated, sources) are reserved and ignored.",
        ),
      },
      run: (cwd, args, deps) => runEnsurePage(cwd, args, deps),
    }),
    def(host, {
      name: "wiki_search",
      description: "Search the wiki registry for pages matching a query.",
      parameters: {
        query: S("Search term", true),
        type: S("Filter by page type"),
      },
      run: (cwd, args) => runSearch(cwd, args),
    }),
    def(host, {
      name: "wiki_lint",
      description:
        "Health check the wiki. Scans for orphans, missing pages, contradictions, gaps. Optionally auto-fixes.",
      parameters: {
        auto_fix: B("Auto-fix orphans and missing pages", false),
      },
      run: (cwd, args) => runLint(cwd, args),
    }),
    def(host, {
      name: "wiki_status",
      description: "Report wiki health and stats instantly from generated registry.",
      parameters: {},
      run: (cwd) => runStatus(cwd),
    }),
    def(host, {
      name: "wiki_rebuild_meta",
      description: "Force a full metadata rebuild (registry, backlinks, index, log).",
      parameters: {},
      run: (cwd, args, deps) => runRebuildMeta(cwd, args, deps),
    }),
    def(host, {
      name: "wiki_reindex_embeddings",
      description:
        "Backfill / refresh semantic embeddings for the vault. Embeds pages that are new or stale (content changed); pass force to re-embed everything. No-op when no embedding provider is configured.",
      parameters: {
        force: B("Re-embed every page, ignoring staleness (default: false)", false),
      },
      run: (cwd, args, deps) => runReindexEmbeddings(cwd, args, deps),
    }),
    def(host, {
      name: "wiki_reindex",
      description:
        "Rebuild or repair the generated QMD index (meta/qmd) for the vault. Lexical indexing is model-free.",
      parameters: {
        components: {
          type: "array" as const,
          description: "lexical and/or vectors",
          items: { type: "string" as const, description: "index component" },
        },
        scope: S("changed or all (default: changed)"),
        force: B("Rebuild everything (default: false)", false),
        vault: S("active, personal, project, or all (default: active)"),
      },
      run: (cwd, args, deps) => runReindex(cwd, args, deps),
    }),
    def(host, {
      name: "wiki_log_event",
      description: "Append a structured event to meta/events.jsonl and regenerate meta/log.md.",
      parameters: {
        kind: S("Event kind (e.g., ingest, query, decision)", true),
        details: { type: "object" as const, description: "Additional event fields" },
      },
      run: (cwd, args) => runLogEvent(cwd, args),
    }),
    def(host, {
      name: "wiki_watch",
      description:
        "Print a ready-to-paste crontab line for scheduling automatic wiki updates (discover → ingest → lint). Does NOT schedule anything itself — it returns the command for the user to install.",
      parameters: {
        interval: S("daily, weekly, hourly, or stop", true),
      },
      run: (_cwd, args) => runWatch(args),
    }),
    def(host, {
      name: "wiki_recall",
      description:
        "Search the wiki for pages relevant to a query. Returns matching page IDs, titles, types, and content previews (small vaults) or a ranked list of links to expand with `read` (large vaults, two-stage recall). Called automatically at session start — use explicitly to dig deeper.",
      parameters: {
        query: S("Search query — use the user's full request or key terms", true),
        max_results: N("Max results (default: 5, max: 10)", 5),
      },
      run: (cwd, args, deps) => runRecall(cwd, args, deps),
    }),
    def(host, {
      name: "wiki_retro",
      description:
        "Save an atomic insight from a completed task into the wiki. Creates a source packet and source page. The insight will be surfaced automatically by wiki_recall in future sessions.",
      parameters: {
        slug: S("Unique kebab-case identifier (e.g. 'jwt-revocation-pattern')", true),
        title: S("Short descriptive title (60 chars max). Noun phrase, not a sentence.", true),
        body: S(
          "Markdown body with [[wikilinks]] to related wiki pages. Explain what was learned.",
          true,
        ),
        category: S("Optional category (e.g. frontend, architecture, devops, bugfix, design)"),
      },
      run: (cwd, args, deps) => runRetro(cwd, args, deps),
    }),
    def(host, {
      name: "wiki_observe",
      description:
        "Record an atomic observation from the current session into the wiki. Observations are timestamped, relevance-rated facts about decisions made, findings discovered, constraints established, or work completed.",
      parameters: {
        title: S("Short descriptive title (≤80 chars). Noun phrase, not a sentence.", true),
        content: S("The observation in plain prose.", true),
        relevance: S("low, medium, high, or critical (default: medium)"),
        source_context: S("What was being worked on."),
        tags: S("Optional space-separated tags for categorization."),
      },
      run: (cwd, args, deps) => runObserve(cwd, args, deps),
    }),
    def(host, {
      name: "wiki_capture_trajectory",
      description:
        "Capture the just-completed task's tool-call trajectory into an immutable packet. Pass the explicit `steps` your task performed (DSH v1 does not auto-read the live session log). The working-memory counterpart to wiki_capture_source.",
      parameters: {
        task: S("The task/prompt that started the work."),
        title: S("Short descriptive title for the task (≤60 chars)."),
        steps: {
          type: "array" as const,
          description:
            "Explicit trajectory steps (role/text/tool_calls). Must contain at least one tool call.",
          items: { type: "object" as const, description: "trajectory step" },
        },
      },
      run: (cwd, args) => runCaptureTrajectory(cwd, args),
      trajectoryGated: true,
    }),
    def(host, {
      name: "wiki_distill_skills",
      description:
        "Return a batch of captured trajectories (agent working-memory) that have not yet been distilled into skill pages. Read each packet and synthesize reusable skill pages (and/or refine case pages) that cite the trajectory IDs.",
      parameters: {
        trajectory_id: S("Specific trajectory ID to distill. Omit for all undistilled."),
        batch_size: N("Max trajectories to return (default: 3, max: 5)", 3),
      },
      run: (cwd, args) => runDistillSkills(cwd, args),
      trajectoryGated: true,
    }),
    def(host, {
      name: "wiki_recall_skill",
      description:
        "Search distilled skills and past cases (agent working-memory) for patterns relevant to the current task — answers 'have I done something like this before?'. Filters layered recall to skill and case pages.",
      parameters: {
        query: S("Search query — use the task description or key terms", true),
        kind: S("Filter to skills, cases, or both (default: any)."),
        max_results: N("Max results (default: 5, max: 10)", 5),
      },
      run: (cwd, args) => runRecallSkill(cwd, args),
      trajectoryGated: true,
    }),
  ];
}

/**
 * Register every tool. Duplicate-safe (H12): an already-registered name is
 * kept and logged, never thrown — a double install path must degrade, not
 * fail activation.
 */
export function registerWikiTools(host: ToolHost): string[] {
  const registered: string[] = [];
  for (const definition of buildWikiTools(host)) {
    try {
      const existing = host.ctx.tools?.get?.(definition.name);
      if (existing) {
        host.logger.warn(`tool ${definition.name} already registered — keeping the existing one`);
        continue;
      }
      (host.ctx.tools?.register as ((def: DshToolDefinition) => unknown) | undefined)?.(definition);
      registered.push(definition.name);
    } catch (error) {
      host.logger.warn(`tool ${definition.name} registration failed: ${(error as Error).message}`);
    }
  }
  return registered;
}
