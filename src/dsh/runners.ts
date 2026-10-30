/**
 * Native DSH runners for the 18 wiki tools.
 *
 * Each runner is `(cwd, args, deps) => Promise<WikiToolValue>` and calls the
 * same host-independent lib cores as the pi extension (`bootstrapVault`,
 * `capture*`, `commitSynthesis`, `searchWikiHybrid`, …). Differences from
 * the pi tool bodies are mechanical and documented inline:
 *
 * - `cwd` comes from the calling agent's working directory (never
 *   `process.cwd()` at call time — the caller resolves it).
 * - Failures throw `WikiToolError` via `boundary()` instead of returning
 *   `{ …, isError: true }` (H06: DSH would read those as success).
 * - Background work dispatches on the DSH runtime (unowned detached tasks
 *   reporting via `agent.inject` to the origin session) instead of pi's
 *   `Runtime.launchTask` + `pi.sendMessage(nextTurn)`.
 * - Synthesis uses the DSH lane (`synthesize()`: subagents with the
 *   synthesis preset, `ctx.llm.stream` fallback) — never an apiKey
 *   (H03/H13/H16).
 * - Config reads go through the per-vault cache (`configForVault`, H05).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { bootstrapVault } from "../../extensions/llm-wiki/lib/bootstrap.js";
import { reindexEmbeddings, resolveEmbedder } from "../../extensions/llm-wiki/lib/embeddings.js";
import {
  CommitSynthesisSchema,
  commitSynthesis,
  INGEST_SYSTEM,
  type SynthesisData,
} from "../../extensions/llm-wiki/lib/ingest-worker.js";
import {
  createKnowledgeDocument,
  type KnowledgeValue,
  parseMarkdownFrontmatter,
  writeKnowledgeDocumentFile,
} from "../../extensions/llm-wiki/lib/knowledge-document.js";
import {
  applyWikilinkGate,
  buildWikilinkIndex,
} from "../../extensions/llm-wiki/lib/knowledge-links.js";
import { runWikiLint } from "../../extensions/llm-wiki/lib/lint.js";
import {
  appendEvent,
  type Registry,
  rebuildMetadata,
  rebuildMetadataLight,
} from "../../extensions/llm-wiki/lib/metadata.js";
import { saveObservation } from "../../extensions/llm-wiki/lib/observation.js";
import {
  formatRecallContext,
  searchWikiHybrid,
  searchWikiLayered,
  shouldUseLinksFirst,
  vaultPageCount,
} from "../../extensions/llm-wiki/lib/recall.js";
import { saveInsight } from "../../extensions/llm-wiki/lib/retro.js";
import {
  captureFile,
  captureText,
  captureUrl,
} from "../../extensions/llm-wiki/lib/source-packet.js";
import {
  noticesEnabled,
  parseModelRef,
  resolveWikilinkValidation,
  type TaskConfig,
} from "../../extensions/llm-wiki/lib/task-config.js";
import { buildPageBody, RESERVED_FRONTMATTER } from "../../extensions/llm-wiki/lib/tools.js";
import {
  captureTrajectory,
  type TrajectoryStep,
} from "../../extensions/llm-wiki/lib/trajectory.js";
import {
  detectVaultFormat,
  fmtDate,
  getVaultPaths,
  readJson,
  resolveVaultPaths,
  slugify,
  type VaultPaths,
} from "../../extensions/llm-wiki/lib/utils.js";
import {
  inspectVaultFormat,
  inspectWritableVault,
} from "../../extensions/llm-wiki/lib/vault-format.js";
import {
  getWikiStatus,
  reindexWiki,
  searchRegistry,
} from "../../extensions/llm-wiki/lib/wiki-service.js";
import type { DshRuntime } from "./background.js";
import { boundary, type PiStyleResult } from "./envelope.js";
import { execRaw } from "./exec.js";
import type { WikiLogger } from "./logger.js";
import { synthesize, toDshOutputSchema } from "./synthesis.js";
import type { DshAgent, DshContext, WikiToolValue } from "./types.js";
import { configForVault, withVaultWrite } from "./vault-state.js";

export interface RunnerDeps {
  ctx: DshContext;
  agent?: DshAgent;
  signal?: AbortSignal;
  logger: WikiLogger;
  runtime: DshRuntime;
}

function vaultCheck(paths: VaultPaths): { ok: true } | { ok: false; result: PiStyleResult } {
  const check = inspectWritableVault(paths);
  if (check.ok) return { ok: true };
  return {
    ok: false,
    result: {
      content: [{ type: "text", text: `Wiki vault error: ${check.diagnostics[0].message}` }],
      details: { error: check.diagnostics[0].code, diagnostics: check.diagnostics },
      isError: true,
    },
  };
}

function fail(result: PiStyleResult): never {
  throw boundary(result);
}

function scheduleLightRebuild(deps: RunnerDeps, paths: VaultPaths, label: string): void {
  void deps.runtime
    .launchTask({
      label: `${label}:${paths.root}`,
      agent: deps.agent,
      vaultRoot: paths.root,
      work: async () =>
        withVaultWrite(paths.root, () => {
          rebuildMetadataLight(paths);
          return null;
        }),
    })
    .catch(() => undefined);
}

function strArg(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// ─── wiki_bootstrap ─────────────────────────────────────

export async function runBootstrap(
  cwd: string,
  args: Record<string, unknown>,
): Promise<WikiToolValue> {
  const topic = strArg(args, "topic");
  if (!topic)
    fail({
      content: [{ type: "text", text: "Topic is required" }],
      details: { error: "missing_topic" },
      isError: true,
    });
  const mode = strArg(args, "mode") || "personal";
  const root = strArg(args, "root") ?? cwd;
  const paths = getVaultPaths(root);
  const result = bootstrapVault(paths, { topic, mode });
  if (!result.ok) {
    fail({
      content: [{ type: "text", text: `Wiki vault error: ${result.diagnostics[0].message}` }],
      details: { error: result.diagnostics[0].code, diagnostics: result.diagnostics },
      isError: true,
    });
  }
  if (!result.projection.ok) {
    return boundary({
      content: [
        {
          type: "text",
          text: `✅ Wiki bootstrapped but projection rebuild had issues: ${result.projection.diagnostics
            .map((d) => `${d.code}: ${d.message}`)
            .join("; ")}`,
        },
      ],
      details: { root, mode, topic, diagnostics: result.projection.diagnostics },
    });
  }
  return boundary({
    content: [
      {
        type: "text",
        text: [
          `✅ Wiki bootstrapped at \`${paths.root}\``,
          "**Scope:** project-local",
          "",
          "**Structure:**",
          "- .llm-wiki/raw/sources/ — immutable source packets",
          "- .llm-wiki/wiki/ — editable knowledge pages",
          "- .llm-wiki/meta/ — auto-generated metadata",
          "- .llm-wiki/ — config and templates",
          "- .llm-wiki/WIKI_SCHEMA.md — operating rules",
          "",
          "Next: Use wiki_capture_source to add your first source.",
        ].join("\n"),
      },
    ],
    details: { root, mode, topic },
  });
}

// ─── wiki_capture_source ────────────────────────────────

export async function runCaptureSource(
  cwd: string,
  args: Record<string, unknown>,
  deps: RunnerDeps,
): Promise<WikiToolValue> {
  const paths = resolveVaultPaths(cwd);
  const check = vaultCheck(paths);
  if (!check.ok) fail(check.result);

  const url = strArg(args, "url");
  const filePath = strArg(args, "file_path");
  const text = strArg(args, "text");
  const title = strArg(args, "title");

  // Adapts DSH execution to lib's `ExecApi` (`pi.exec` shape). Raw result —
  // the lib `exec()` wrapper inspects code/killed itself.
  const execApi = {
    exec: (
      command: string,
      execArgs: string[],
      options?: { signal?: AbortSignal; timeout?: number; cwd?: string },
    ) =>
      execRaw(deps.ctx, command, execArgs, {
        signal: options?.signal ?? deps.signal,
        timeoutMs: options?.timeout,
        cwd: options?.cwd ?? cwd,
      }),
  };

  let result: { sourceId: string; packetPath: string; sourcePagePath: string; extracted: string };
  if (url) result = await captureUrl(execApi, paths, url, deps.signal);
  else if (filePath) result = await captureFile(execApi, paths, filePath, deps.signal);
  else if (text) result = captureText(paths, text, title);
  else {
    fail({
      content: [{ type: "text", text: "❌ Provide one of: url, file_path, or text" }],
      details: { error: "missing_source" },
      isError: true,
    });
  }

  scheduleLightRebuild(deps, paths, "capture");
  return boundary({
    content: [
      {
        type: "text",
        text: [
          `✅ Captured source **${result.sourceId}**`,
          "",
          `- Packet: \`${result.packetPath}\``,
          `- Skeleton page: \`${result.sourcePagePath}\``,
          "",
          "**Next:** Read the extracted text and update the source page with a proper summary, entities, and concepts.",
        ].join("\n"),
      },
    ],
    details: {
      sourceId: result.sourceId,
      packetPath: result.packetPath,
      sourcePagePath: result.sourcePagePath,
      extractedPreview: result.extracted.slice(0, 300),
    },
  });
}

// ─── wiki_ingest ────────────────────────────────────────

interface IngestSource {
  id: string;
  extracted: string;
  manifest: Record<string, unknown>;
}

function listIngestBatch(
  paths: VaultPaths,
  sourceId: string | undefined,
  batchSize: number,
): { batch: IngestSource[]; remaining: number; total: number; ingested: number } {
  const packets = existsSync(paths.rawSources)
    ? readdirSync(paths.rawSources)
        .filter((d) => d.startsWith("SRC-"))
        .sort()
    : [];
  const registry = readJson<Registry>(join(paths.meta, "registry.json"), {
    version: "1.0",
    last_updated: "",
    pages: {},
  });
  const ingested = new Set<string>();
  for (const [id, entry] of Object.entries(registry.pages)) {
    if (entry.type === "source" && (entry as Record<string, unknown>).status !== "skeleton") {
      const base = id.split("/").pop();
      if (base) ingested.add(base);
    }
  }
  let toProcess = packets.filter((p) => !ingested.has(p));
  if (sourceId) {
    if (!toProcess.includes(sourceId) && !packets.includes(sourceId)) {
      fail({
        content: [{ type: "text", text: `Source ${sourceId} not found or already ingested.` }],
        details: { source_id: sourceId, status: "not_found" },
        isError: true,
      });
    }
    toProcess = [sourceId];
  }
  const batchIds = toProcess.slice(0, batchSize);
  const relRaw = relative(paths.root, paths.rawSources);
  const batch = batchIds.map((id) => ({
    id,
    extracted: existsSync(join(paths.rawSources, id, "extracted.md"))
      ? readFileSync(join(paths.rawSources, id, "extracted.md"), "utf-8")
      : "",
    manifest: readJson<Record<string, unknown>>(join(paths.rawSources, id, "manifest.json"), {}),
    relRaw,
  }));
  return {
    batch,
    remaining: toProcess.length - batchIds.length,
    total: packets.length,
    ingested: ingested.size,
  };
}

function coerceSynthesisData(structured: unknown, text: string): SynthesisData {
  if (structured && typeof structured === "object") {
    const data = structured as Record<string, unknown>;
    if (
      typeof data.summary === "string" &&
      Array.isArray(data.entities) &&
      Array.isArray(data.concepts)
    ) {
      return {
        summary: data.summary,
        key_takeaways: Array.isArray(data.key_takeaways) ? (data.key_takeaways as string[]) : [],
        entities: data.entities as SynthesisData["entities"],
        concepts: data.concepts as SynthesisData["concepts"],
        quotes: Array.isArray(data.quotes) ? (data.quotes as SynthesisData["quotes"]) : undefined,
        contradictions: Array.isArray(data.contradictions)
          ? (data.contradictions as SynthesisData["contradictions"])
          : undefined,
      };
    }
  }
  // Strict-JSON fallback: the child may answer in text when its provider
  // does not support structured output. Anything else is an observable
  // failure — never a silent "write it yourself" checklist.
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return coerceSynthesisData(JSON.parse(match[0]) as unknown, "");
    } catch {
      /* fall through to the error below */
    }
  }
  throw new Error("synthesis produced no structured data (and no parseable JSON fallback)");
}

async function ingestOneSource(
  deps: RunnerDeps,
  paths: VaultPaths,
  source: IngestSource,
  config: TaskConfig,
  modelOverride?: { provider: string; id: string },
): Promise<string> {
  const content = source.extracted.slice(0, 24_000);
  if (!content.trim()) return `LLM Wiki: ${source.id} has no extracted content — skipped`;
  const languageInstruction = config.synthesisLanguage
    ? `\n\nWrite all generated content in ${config.synthesisLanguage}, including titles, headings, summaries, descriptions, and concept/entity names. Only preserve code, API names, file paths, commands, exact technical identifiers, and verbatim quotations in their original form.`
    : "";
  const title = String(source.manifest.title ?? source.id);
  const prompt =
    `${INGEST_SYSTEM}${languageInstruction}\n\n` +
    `Synthesize this captured source into structured JSON matching the commit schema (do NOT call any commit tool — reply with the JSON object only).\n\n` +
    `SOURCE: ${title} (${source.id})\n\nEXTRACTED CONTENT:\n${content}`;
  const result = await synthesize(
    deps.ctx,
    deps.agent,
    {
      prompt,
      cwd: paths.root,
      outputSchema: toDshOutputSchema(JSON.parse(JSON.stringify(CommitSynthesisSchema)) as Record<string, unknown>),
      timeoutMs: 10 * 60_000,
      maxDepth: 1,
      ...(modelOverride
        ? { agentOptions: { provider: modelOverride.provider, model: modelOverride.id } }
        : {}),
    },
    deps.logger,
  );
  const data = coerceSynthesisData(result.structured, result.text);
  const outcome = commitSynthesis(
    paths,
    source.id,
    source.manifest,
    data,
    undefined,
    config.synthesisLanguage,
    config.wikilinkValidation,
  );
  if (!outcome.ok) {
    throw new Error(`commit failed for ${source.id}: ${outcome.diagnostics[0].message}`);
  }
  await withVaultWrite(paths.root, () => {
    rebuildMetadataLight(paths);
  });
  const wl = outcome.wikilinkDiagnostics?.length ?? 0;
  const wlNote = wl > 0 ? `, ${wl} wikilink issue${wl === 1 ? "" : "s"}` : "";
  return (
    `LLM Wiki: ingested ${source.id} → ${outcome.entitiesCreated.length} ` +
    `entit${outcome.entitiesCreated.length === 1 ? "y" : "ies"}, ` +
    `${outcome.conceptsCreated.length} concept${outcome.conceptsCreated.length === 1 ? "" : "s"}${wlNote}`
  );
}

export async function runIngest(
  cwd: string,
  args: Record<string, unknown>,
  deps: RunnerDeps,
): Promise<WikiToolValue> {
  const paths = resolveVaultPaths(cwd);
  const check = vaultCheck(paths);
  if (!check.ok) fail(check.result);
  const config = configForVault(paths.root, paths.dotWiki);

  const batchSize = Math.min(
    typeof args.batch_size === "number" ? Math.floor(args.batch_size) : 3,
    5,
  );
  const { batch, remaining } = listIngestBatch(paths, strArg(args, "source_id"), batchSize);
  if (batch.length === 0) {
    return boundary({
      content: [
        { type: "text", text: "✅ All sources ingested. Use wiki_capture_source to add new ones." },
      ],
      details: { background: false, dispatched: [] },
    });
  }

  const wantBackground = args.background !== false;
  if (wantBackground) {
    const modelRaw = strArg(args, "model");
    const override = modelRaw ? parseModelRef(modelRaw) : undefined;
    for (const source of batch) {
      const manifest = source.manifest;
      const s = { id: source.id, extracted: source.extracted, manifest };
      void deps.runtime
        .launchTask({
          label: `ingest:${s.id}`,
          agent: deps.agent,
          vaultRoot: paths.root,
          // Synthesis hits the model: enqueue until wrapped whenIdle drains
          // (mid-turn LLM → TRANSPORT; post-idle without wrap → headless exit race).
          needsLlm: true,
          work: async () => ingestOneSource(deps, paths, s, config, override ?? undefined),
        })
        .catch(() => undefined);
    }
    return boundary({
      content: [
        {
          type: "text",
          text: [
            `🔄 **Ingesting ${batch.length} source(s) in the background** (${remaining} remaining).`,
            "",
            ...batch.map((s) => `- **${s.id}**: ${String(s.manifest.title ?? s.id)}`),
            "",
            "Synthesis runs on the DSH synthesis lane (subagent + structured handoff) without blocking. " +
              "Completion is reported back into this session — do NOT synthesize these yourself.",
          ].join("\n"),
        },
      ],
      details: { background: true, dispatched: batch.map((s) => s.id), remaining },
    });
  }

  return boundary({
    content: [
      {
        type: "text",
        text: [
          `📥 **${batch.length} source(s) ready** (${remaining} remaining)`,
          "",
          ...batch.map((s) =>
            [
              `- **${s.id}**: ${String(s.manifest.title ?? s.id)}`,
              `  - Extracted: ${s.extracted.length} chars`,
              `  - Read: \`${relative(paths.root, paths.rawSources)}/${s.id}/extracted.md\``,
            ].join("\n"),
          ),
          "",
          "**Next steps for each source:**",
          "1. Read extracted.md",
          "2. Update the skeleton source page in wiki/sources/",
          "3. Create/update entity pages in wiki/entities/",
          "4. Create/update concept pages in wiki/concepts/",
          "5. Add [[wikilinks]] cross-references",
          "6. Flag contradictions",
          "",
          "The extension will auto-update metadata when you're done.",
        ].join("\n"),
      },
    ],
    details: { batch: batch.map((s) => s.id), remaining },
  });
}

// ─── wiki_ensure_page ───────────────────────────────────

export async function runEnsurePage(
  cwd: string,
  args: Record<string, unknown>,
  deps: RunnerDeps,
): Promise<WikiToolValue> {
  const paths = resolveVaultPaths(cwd);
  const check = vaultCheck(paths);
  if (!check.ok) fail(check.result);
  const config: TaskConfig = configForVault(paths.root, paths.dotWiki);

  const folderMap: Record<string, string> = {
    entity: "entities",
    concept: "concepts",
    synthesis: "syntheses",
    analysis: "analyses",
    requirement: "requirements",
    skill: "skills",
    case: "cases",
    ...(config.customTypes ?? {}),
  };
  const type = strArg(args, "type");
  if (!type)
    fail({
      content: [{ type: "text", text: "Page type is required" }],
      details: { error: "missing_type" },
      isError: true,
    });
  const title = strArg(args, "title");
  if (!title)
    fail({
      content: [{ type: "text", text: "Page title is required" }],
      details: { error: "missing_title" },
      isError: true,
    });
  const slug = slugify(title);
  const folder = folderMap[type] || "concepts";
  const pagePath = join(paths.wiki, folder, `${slug}.md`);

  if (existsSync(pagePath)) {
    return boundary({
      content: [{ type: "text", text: `✅ Page already exists: \`${pagePath}\`` }],
      details: { path: pagePath, created: false },
    });
  }

  const today = fmtDate();
  let body = strArg(args, "content") ?? buildPageBody(type, title);
  const extraFrontmatter: Record<string, KnowledgeValue> = {};
  if (body.trimStart().startsWith("---")) {
    const parsed = parseMarkdownFrontmatter(body, `${folder}/${slug}.md`);
    if (parsed.ok) {
      for (const [key, value] of Object.entries(parsed.mapping)) {
        if (!RESERVED_FRONTMATTER.has(key)) extraFrontmatter[key] = value as KnowledgeValue;
      }
      body = parsed.body.trim() ? parsed.body : buildPageBody(type, title);
    }
  }

  const mode = resolveWikilinkValidation(config);
  let wikilinkIssues: string[] = [];
  if (mode !== "off") {
    const registry = readJson<{ pages: Record<string, unknown> }>(
      join(paths.meta, "registry.json"),
      { pages: {} },
    );
    const gate = applyWikilinkGate(
      body,
      buildWikilinkIndex(Object.keys(registry.pages)),
      `${folder}/${slug}`,
      mode,
    );
    wikilinkIssues = gate.diagnostics.map((d) => d.message);
    if (!gate.ok) {
      fail({
        content: [
          {
            type: "text",
            text: `Rejected write — unresolved/ambiguous wikilinks:\n${wikilinkIssues.map((m) => `- ${m}`).join("\n")}`,
          },
        ],
        details: { error: "link_validation", issues: wikilinkIssues },
        isError: true,
      });
    }
    if (mode === "normalize") body = gate.body;
  }

  const doc = createKnowledgeDocument(
    `${folder}/${slug}.md`,
    { type, title, created: today, updated: today, ...extraFrontmatter },
    body,
  );
  mkdirSync(join(paths.wiki, folder), { recursive: true });
  writeKnowledgeDocumentFile(pagePath, doc);
  appendEvent(paths, { kind: "ensure_page", page_type: type, title, path: `${folder}/${slug}` });
  scheduleLightRebuild(deps, paths, "ensure-page");

  const gateNote = wikilinkIssues.length
    ? `\n\n⚠️ ${wikilinkIssues.length} wikilink issue(s):\n${wikilinkIssues.map((m) => `- ${m}`).join("\n")}`
    : "";
  return boundary({
    content: [{ type: "text", text: `✅ Created ${type} page: \`${pagePath}\`${gateNote}` }],
    details: { path: pagePath, created: true, wikilinkIssues },
  });
}

// ─── wiki_search ────────────────────────────────────────

export async function runSearch(
  cwd: string,
  args: Record<string, unknown>,
): Promise<WikiToolValue> {
  const paths = resolveVaultPaths(cwd);
  const query = strArg(args, "query");
  if (!query)
    fail({
      content: [{ type: "text", text: "Search query is required" }],
      details: { error: "missing_query" },
      isError: true,
    });
  const result = searchRegistry(paths, query, strArg(args, "type"));
  if (result.matches.length === 0) {
    return boundary({
      content: [{ type: "text", text: `No pages found for "${query}"` }],
      details: { query, matches: [], diagnostics: result.diagnostics },
    });
  }
  return boundary({
    content: [
      {
        type: "text",
        text: [
          `🔍 **${result.matches.length} result(s)** for "${query}":`,
          "",
          ...result.matches.map((m) => `- [[${m.id}]] — *${m.type}* — ${m.title}`),
        ].join("\n"),
      },
    ],
    details: { query, matches: result.matches, diagnostics: result.diagnostics },
  });
}

// ─── wiki_lint ──────────────────────────────────────────

export async function runLint(cwd: string, args: Record<string, unknown>): Promise<WikiToolValue> {
  const paths = resolveVaultPaths(cwd);
  const autoFix = args.auto_fix === true;
  const text = await runWikiLint(paths, autoFix);
  return boundary({ content: [{ type: "text", text }], details: { autoFix } });
}

// ─── wiki_status ────────────────────────────────────────

export async function runStatus(cwd: string): Promise<WikiToolValue> {
  const paths = resolveVaultPaths(cwd);
  if (detectVaultFormat(paths.root) === "none") {
    fail({
      content: [
        { type: "text", text: `No wiki found at ${paths.root}. Run wiki_bootstrap first.` },
      ],
      details: { error: `No wiki found at ${paths.root}. Run wiki_bootstrap first.` },
      isError: true,
    });
  }
  const status = await getWikiStatus(paths);
  const config = readJson<Record<string, unknown>>(join(paths.dotWiki, "config.json"), {});
  const backlinks = readJson<Record<string, string[]>>(join(paths.meta, "backlinks.json"), {});
  const orphanCount = Object.entries(backlinks).filter(
    ([, inbound]) => inbound.length === 0,
  ).length;
  const gaps = readJson<{ gaps?: unknown[] }>(join(paths.discoveries, "gaps.json"), { gaps: [] });
  const health = status.totalPages === 0 ? "🔴 Empty" : orphanCount > 5 ? "⚠️ Warning" : "✅ Good";
  const diagLines =
    status.blockingDiagnostics.length > 0
      ? [
          "",
          "⚠️ Blocking diagnostics:",
          ...status.blockingDiagnostics.map((d) => `  - ${d.code}: ${d.message}`),
        ]
      : [];
  const lines = [
    "📊 LLM Wiki Status",
    "══════════════════",
    `Topic: ${String(config.topic ?? "Unknown")}`,
    `Mode: ${String(config.mode ?? "personal")}`,
    `Knowledge format: ${status.knowledgeFormat}`,
    `Pages: ${status.totalPages}`,
    ...Object.entries(status.byType).map(([t, c]) => `  - ${t}s: ${c}`),
    `Orphans: ${orphanCount}`,
    `Gaps: ${gaps.gaps?.length || 0}`,
    `Health: ${health}`,
    `Last updated: ${status.lastUpdated || "Never"}`,
    `QMD index: ${status.qmd.state}`,
    `QMD documents: ${status.qmd.totalDocuments} (${status.qmd.canonicalDocuments} canonical, ${status.qmd.evidenceDocuments} evidence)`,
    `QMD embeddings pending: ${status.qmd.needsEmbedding}`,
    `QMD package: ${status.qmd.qmdVersion}`,
    ...diagLines,
  ];
  return boundary({
    content: [{ type: "text", text: lines.join("\n") }],
    details: {
      topic: config.topic,
      mode: config.mode,
      knowledgeFormat: status.knowledgeFormat,
      totalPages: status.totalPages,
      byType: status.byType,
      orphans: orphanCount,
      gaps: gaps.gaps?.length || 0,
      health,
      blockingDiagnostics: status.blockingDiagnostics,
      qmd: status.qmd,
    },
  });
}

// ─── wiki_rebuild_meta ──────────────────────────────────

export async function runRebuildMeta(
  cwd: string,
  _args: Record<string, unknown>,
  deps: RunnerDeps,
): Promise<WikiToolValue> {
  const paths = resolveVaultPaths(cwd);
  const check = vaultCheck(paths);
  if (!check.ok) fail(check.result);
  const result = await withVaultWrite(paths.root, () => rebuildMetadata(paths));
  const count = Object.keys(result.registry?.pages ?? {}).length;
  deps.logger.info(`metadata rebuilt for ${paths.root}: ${count} pages`);
  return boundary({
    content: [{ type: "text", text: `✅ Metadata rebuilt: ${count} page(s) indexed.` }],
    details: { pages: count, diagnostics: result.diagnostics },
  });
}

// ─── wiki_reindex_embeddings ────────────────────────────

export async function runReindexEmbeddings(
  cwd: string,
  args: Record<string, unknown>,
  deps: RunnerDeps,
): Promise<WikiToolValue> {
  const paths = resolveVaultPaths(cwd);
  const check = vaultCheck(paths);
  if (!check.ok) fail(check.result);
  const config = configForVault(paths.root, paths.dotWiki);
  const embedder = resolveEmbedder(config);
  if (!embedder) {
    return boundary({
      content: [
        {
          type: "text",
          text: 'ℹ️ No embedding provider configured — semantic embeddings are disabled. Set `llm-wiki.embeddingProvider` (e.g. "openai") in settings to enable.',
        },
      ],
      details: { enabled: false },
    });
  }
  const force = args.force === true;
  const label = `reindex_embeddings:${paths.root}`;
  void deps.runtime
    .launchTask({
      label,
      agent: deps.agent,
      vaultRoot: paths.root,
      // Remote embeddings hit the network like synthesis: same idle gate.
      needsLlm: true,
      work: async () => {
        const stats = await reindexEmbeddings(paths, embedder, { force });
        appendEvent(paths, {
          kind: "reindex_embeddings",
          embedded: stats.embedded,
          skipped: stats.skipped,
          pruned: stats.pruned,
          model: embedder.model,
        });
        return `✅ LLM Wiki: embeddings reindexed (${embedder.model}) — ${stats.embedded} embedded, ${stats.skipped} fresh, ${stats.pruned} pruned.`;
      },
    })
    .catch(() => undefined);
  return boundary({
    content: [
      {
        type: "text",
        text: `🧠 LLM Wiki: embedding reindex started in the background (${embedder.model}) — stats will be reported back into this session.`,
      },
    ],
    details: { enabled: true, model: embedder.model, background: true },
  });
}

// ─── wiki_reindex ───────────────────────────────────────

export async function runReindex(
  cwd: string,
  args: Record<string, unknown>,
  deps: RunnerDeps,
): Promise<WikiToolValue> {
  const paths = resolveVaultPaths(cwd);
  const check = vaultCheck(paths);
  if (!check.ok) fail(check.result);
  const asStrings = (value: unknown): string[] | undefined =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : undefined;
  const rawComponents = asStrings(args.components) ?? ["lexical"];
  const components = rawComponents.filter(
    (c): c is "lexical" | "vectors" => c === "lexical" || c === "vectors",
  );
  const scopeRaw = strArg(args, "scope") ?? "changed";
  const scope: "changed" | "all" = scopeRaw === "all" ? "all" : "changed";
  const vaultRaw = strArg(args, "vault") ?? "active";
  const vault =
    vaultRaw === "active" || vaultRaw === "personal" || vaultRaw === "project" || vaultRaw === "all"
      ? vaultRaw
      : "active";
  const result = await reindexWiki(paths, {
    scope,
    components,
    force: args.force === true,
    vault,
    signal: deps.signal,
  });
  const ok = result.results.every((r) => r.result.ok);
  const lines = [
    ok ? "✅ QMD indexing complete" : "⚠️ QMD indexing completed with errors",
    ...result.results.map((r) => {
      const st = r.result.status;
      return `- ${r.label} (${r.root}): state=${st.state}, documents=${st.totalDocuments}, indexed=${r.result.documents.indexed}, updated=${r.result.documents.updated}, removed=${r.result.documents.removed}, vectors=${r.result.vectors.generated}`;
    }),
  ];
  if (components.length === 1 && components[0] === "lexical") {
    lines.push("Model-free lexical indexing — no model was downloaded.");
  }
  if (components.includes("vectors")) {
    lines.push("⚠️ Vector indexing may download approximately 2 GB of models on first use.");
  }
  for (const r of result.results) {
    for (const e of r.result.errors) lines.push(`- [${r.label}] ${e.code}: ${e.message}`);
    for (const w of r.result.warnings) lines.push(`- [${r.label}] ${w.code}: ${w.message}`);
  }
  return boundary({
    content: [{ type: "text", text: lines.join("\n") }],
    details: { scope, components, vault, results: result.results },
    ...(ok ? {} : { isError: true as const }),
  });
}

// ─── wiki_log_event ─────────────────────────────────────

export async function runLogEvent(
  cwd: string,
  args: Record<string, unknown>,
): Promise<WikiToolValue> {
  const paths = resolveVaultPaths(cwd);
  const check = vaultCheck(paths);
  if (!check.ok) fail(check.result);
  const kind = strArg(args, "kind");
  if (!kind) {
    fail({
      content: [{ type: "text", text: "Event kind must be a non-empty string" }],
      details: { error: "event_missing_kind" },
      isError: true,
    });
  }
  const details = (args.details && typeof args.details === "object" ? args.details : {}) as Record<
    string,
    unknown
  >;
  if (Object.hasOwn(details, "kind") || Object.hasOwn(details, "timestamp")) {
    fail({
      content: [{ type: "text", text: "Event details cannot override kind or timestamp" }],
      details: { error: "event_reserved_field" },
      isError: true,
    });
  }
  appendEvent(paths, { kind, ...details });
  await withVaultWrite(paths.root, () => {
    rebuildMetadata(paths);
  });
  return boundary({
    content: [{ type: "text", text: `✅ Event logged: ${kind}` }],
    details: { kind },
  });
}

// ─── wiki_watch ─────────────────────────────────────────

export async function runWatch(args: Record<string, unknown>): Promise<WikiToolValue> {
  const interval = strArg(args, "interval") ?? "daily";
  if (interval === "stop") {
    return boundary({
      content: [
        {
          type: "text",
          text: [
            "🛑 To stop wiki auto-updates, remove the cron line you installed earlier:",
            "",
            "```bash",
            "crontab -e   # then delete the line tagged '# llm-wiki-autoupdate'",
            "```",
            "",
            "Or list current jobs to confirm:",
            "",
            "```bash",
            "crontab -l | grep llm-wiki-autoupdate",
            "```",
          ].join("\n"),
        },
      ],
      details: { action: "stop_instructions" },
    });
  }
  const intervals: Record<string, { cron: string; label: string }> = {
    daily: { cron: "0 8 * * *", label: "Daily at 8:00 AM" },
    weekly: { cron: "0 9 * * 1", label: "Weekly on Monday at 9:00 AM" },
    hourly: { cron: "0 * * * *", label: "Hourly" },
  };
  const picked = intervals[interval] ?? intervals.daily;
  return boundary({
    content: [
      {
        type: "text",
        text: [
          `⏰ Wiki auto-update (${picked.label}). Paste into your crontab (\`crontab -e\`):`,
          "",
          "```bash",
          `${picked.cron} <path-to-agent> -p "/wiki-run"  # llm-wiki-autoupdate`,
          "```",
          "",
          "On DSH you can alternatively create a `ctx.schedule` reminder that followups this session with `/wiki-run`. " +
            "wiki_watch only PRINTS this line — it does not schedule anything itself.",
        ].join("\n"),
      },
    ],
    details: { action: "print_crontab", cron: picked.cron },
  });
}

// ─── wiki_recall ────────────────────────────────────────

export async function runRecall(
  cwd: string,
  args: Record<string, unknown>,
  _deps: RunnerDeps,
): Promise<WikiToolValue> {
  const paths = resolveVaultPaths(cwd);
  if (!existsSync(join(paths.dotWiki, "config.json"))) {
    fail({
      content: [
        {
          type: "text",
          text: "No wiki vault found at this location. Initialize one with wiki_bootstrap first.",
        },
      ],
      details: { error: "no_vault" },
      isError: true,
    });
  }
  const query = strArg(args, "query");
  if (!query)
    fail({
      content: [{ type: "text", text: "Search query is required" }],
      details: { error: "missing_query" },
      isError: true,
    });
  const maxResults = Math.min(
    typeof args.max_results === "number" ? Math.floor(args.max_results) : 5,
    10,
  );
  const config = configForVault(paths.root, paths.dotWiki);
  const vaultDiagnostics = inspectVaultFormat(paths).diagnostics;
  const diagnosticText = vaultDiagnostics.length
    ? `\n\nDiagnostics: ${vaultDiagnostics.map((d) => d.code).join(", ")}`
    : "";
  const results = await searchWikiHybrid(paths, query, maxResults, 0, true, { config });
  if (results.length === 0) {
    return boundary({
      content: [
        {
          type: "text",
          text: `No wiki pages found matching "${query}". The wiki is empty — use wiki_retro to start building knowledge.${diagnosticText}`,
        },
      ],
      details: { query, matches: [], diagnostics: vaultDiagnostics },
    });
  }
  const linksFirst = shouldUseLinksFirst(vaultPageCount(paths, true), config);
  const recallContext = formatRecallContext(results, {
    linksOnly: linksFirst,
    skillInlineMax: config.recallSkillInlineMax,
  });
  return boundary({
    content: [{ type: "text", text: recallContext || `No recall context for "${query}".` }],
    details: { query, matches: results, linksFirst, diagnostics: vaultDiagnostics },
  });
}

// ─── wiki_retro / wiki_observe ──────────────────────────

export async function runRetro(
  cwd: string,
  args: Record<string, unknown>,
  deps: RunnerDeps,
): Promise<WikiToolValue> {
  const paths = resolveVaultPaths(cwd);
  const check = vaultCheck(paths);
  if (!check.ok) fail(check.result);
  const slug = strArg(args, "slug");
  const title = strArg(args, "title");
  const body = strArg(args, "body");
  if (!slug || !title || !body) {
    fail({
      content: [{ type: "text", text: "slug, title, and body are all required" }],
      details: { error: "missing_fields" },
      isError: true,
    });
  }
  const saved = saveInsight(paths, slug, title, body, strArg(args, "category"), { rebuild: false });
  scheduleLightRebuild(deps, paths, "retro");
  return boundary({
    content: [{ type: "text", text: `✅ Insight saved: \`${saved.sourcePagePath}\`` }],
    details: { slug: saved.slug, path: saved.sourcePagePath },
  });
}

export async function runObserve(
  cwd: string,
  args: Record<string, unknown>,
  deps: RunnerDeps,
): Promise<WikiToolValue> {
  const paths = resolveVaultPaths(cwd);
  const check = vaultCheck(paths);
  if (!check.ok) fail(check.result);
  const title = strArg(args, "title");
  const content = strArg(args, "content");
  if (!title || !content) {
    fail({
      content: [{ type: "text", text: "title and content are both required" }],
      details: { error: "missing_fields" },
      isError: true,
    });
  }
  const relevanceRaw = strArg(args, "relevance") ?? "medium";
  const relevance = (["low", "medium", "high", "critical"] as const).includes(
    relevanceRaw as "medium",
  )
    ? (relevanceRaw as "low" | "medium" | "high" | "critical")
    : "medium";
  const saved = saveObservation(
    paths,
    {
      title,
      content,
      relevance,
      ...(strArg(args, "source_context")
        ? { source_context: strArg(args, "source_context") as string }
        : {}),
      ...(strArg(args, "tags") ? { tags: strArg(args, "tags") as string } : {}),
    },
    { rebuild: false },
  );
  scheduleLightRebuild(deps, paths, "observe");
  if (noticesEnabled(configForVault(paths.root, paths.dotWiki))) {
    deps.logger.info(`observation saved: ${saved.slug}`);
  }
  return boundary({
    content: [{ type: "text", text: `✅ Observation saved: \`${saved.pagePath}\`` }],
    details: { slug: saved.slug, path: saved.pagePath, relevance },
  });
}

// ─── trajectory tools (v1) ──────────────────────────────

export async function runCaptureTrajectory(
  cwd: string,
  args: Record<string, unknown>,
): Promise<WikiToolValue> {
  const paths = resolveVaultPaths(cwd);
  const check = vaultCheck(paths);
  if (!check.ok) fail(check.result);
  const steps = args.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    fail({
      content: [
        {
          type: "text",
          text:
            "Provide explicit `steps` (the tool-call sequence to capture). " +
            "DSH v1 does not auto-read the live session log — pass the steps your task just performed.",
        },
      ],
      details: { error: "missing_steps" },
      isError: true,
    });
  }
  const toolCallCount = (steps as Array<{ tool_calls?: unknown[] }>).reduce(
    (n, s) => n + (Array.isArray(s?.tool_calls) ? s.tool_calls.length : 0),
    0,
  );
  if (toolCallCount === 0) {
    fail({
      content: [
        {
          type: "text",
          text: "Trajectory capture refused: 0 tool calls in `steps` (empty captures poison distillation).",
        },
      ],
      details: { error: "empty_trajectory" },
      isError: true,
    });
  }
  const captured = captureTrajectory(paths, {
    steps: steps as TrajectoryStep[],
    ...(strArg(args, "task") ? { task: strArg(args, "task") as string } : {}),
    ...(strArg(args, "title") ? { title: strArg(args, "title") as string } : {}),
  });
  return boundary({
    content: [
      {
        type: "text",
        text: `✅ Trajectory captured: \`${captured.packetPath}\` (${captured.stepCount} steps)`,
      },
    ],
    details: {
      trajectoryId: captured.trajectoryId,
      packetPath: captured.packetPath,
      stepCount: captured.stepCount,
    },
  });
}

export async function runDistillSkills(
  cwd: string,
  args: Record<string, unknown>,
): Promise<WikiToolValue> {
  const paths = resolveVaultPaths(cwd);
  if (!existsSync(join(paths.dotWiki, "config.json"))) {
    fail({
      content: [
        {
          type: "text",
          text: "No wiki vault found at this location. Initialize one with wiki_bootstrap first.",
        },
      ],
      details: { error: "no_vault" },
      isError: true,
    });
  }
  const batchSize = Math.min(
    typeof args.batch_size === "number" ? Math.floor(args.batch_size) : 3,
    5,
  );
  if (!existsSync(paths.rawTrajectories)) {
    return boundary({
      content: [
        {
          type: "text",
          text: "No raw/trajectories/ directory. Capture trajectories first with wiki_capture_trajectory.",
        },
      ],
      details: { error: "no_trajectories" },
    });
  }
  const packets = readdirSync(paths.rawTrajectories)
    .filter((d) => d.startsWith("TRJ-"))
    .sort();
  const backlinks = readJson<Record<string, string[]>>(join(paths.meta, "backlinks.json"), {});
  const distilled = new Set<string>();
  for (const [pageId, inbound] of Object.entries(backlinks)) {
    if (!pageId.startsWith("trajectories/")) continue;
    if (inbound.some((src) => src.startsWith("skills/")))
      distilled.add(pageId.split("/").pop() as string);
  }
  let toProcess = packets.filter((p) => !distilled.has(p));
  const trajectoryId = strArg(args, "trajectory_id");
  if (trajectoryId) {
    if (!packets.includes(trajectoryId)) {
      fail({
        content: [{ type: "text", text: `Trajectory ${trajectoryId} not found.` }],
        details: { trajectory_id: trajectoryId, status: "not_found" },
        isError: true,
      });
    }
    toProcess = [trajectoryId];
  }
  const batch = toProcess.slice(0, batchSize);
  if (batch.length === 0) {
    return boundary({
      content: [
        {
          type: "text",
          text: "✅ All trajectories distilled. Capture more with wiki_capture_trajectory.",
        },
      ],
      details: { distilled: distilled.size, total: packets.length },
    });
  }
  const trajectories = batch.map((id) => ({
    id,
    readme: existsSync(join(paths.rawTrajectories, id, "extracted.md"))
      ? readFileSync(join(paths.rawTrajectories, id, "extracted.md"), "utf-8")
      : "",
    manifest: readJson<Record<string, unknown>>(
      join(paths.rawTrajectories, id, "manifest.json"),
      {},
    ),
  }));
  return boundary({
    content: [
      {
        type: "text",
        text: [
          `🧪 **${batch.length} trajectory(ies) ready** (${toProcess.length - batch.length} remaining)`,
          "",
          ...trajectories.map((t) =>
            [
              `- **${t.id}**: ${String(t.manifest.title ?? t.id)}`,
              `  - Tool calls: ${String(t.manifest.tool_call_count ?? "?")}, steps: ${String(t.manifest.step_count ?? "?")}`,
              `  - Packet: \`raw/trajectories/${t.id}/packet.json\``,
              `  - Summary: \`raw/trajectories/${t.id}/extracted.md\``,
            ].join("\n"),
          ),
          "",
          "**Next steps for each trajectory:**",
          "1. Read packet.json (full tool-call sequence) and extracted.md (summary)",
          "2. Create/refine reusable skill pages via wiki_ensure_page(type='skill')",
          "3. Optionally write a case page (a specific past task) via wiki_ensure_page(type='case')",
          "4. Cite the trajectory with [[trajectories/TRJ-...]] in each skill's 'Distilled From'",
          "",
          "The extension auto-updates metadata when you're done.",
        ].join("\n"),
      },
    ],
    details: { batch: trajectories.map((t) => t.id), remaining: toProcess.length - batch.length },
  });
}

export async function runRecallSkill(
  cwd: string,
  args: Record<string, unknown>,
): Promise<WikiToolValue> {
  const paths = resolveVaultPaths(cwd);
  if (!existsSync(join(paths.dotWiki, "config.json"))) {
    fail({
      content: [
        {
          type: "text",
          text: "No wiki vault found at this location. Initialize one with wiki_bootstrap first.",
        },
      ],
      details: { error: "no_vault" },
      isError: true,
    });
  }
  const query = strArg(args, "query");
  if (!query)
    fail({
      content: [{ type: "text", text: "Search query is required" }],
      details: { error: "missing_query" },
      isError: true,
    });
  const maxResults = Math.min(
    typeof args.max_results === "number" ? Math.floor(args.max_results) : 5,
    10,
  );
  const kind = strArg(args, "kind") ?? "any";
  const raw = searchWikiLayered(paths, query, maxResults * 4, 0);
  const wanted = kind === "any" ? ["skill", "case"] : [kind];
  const results = raw.filter((r) => wanted.includes(r.type)).slice(0, maxResults);
  if (results.length === 0) {
    return boundary({
      content: [
        {
          type: "text",
          text: `No ${kind === "any" ? "skills or cases" : `${kind}s`} found matching "${query}". Capture work with wiki_capture_trajectory and distill it with wiki_distill_skills.`,
        },
      ],
      details: { query, kind, matches: [] },
    });
  }
  return boundary({
    content: [
      {
        type: "text",
        text: `Found ${results.length} ${kind === "any" ? "skill/case" : kind} page(s) matching "${query}":\n\n${results
          .map((r) => {
            const vault = r.vaultLabel ? ` ${r.vaultLabel}` : "";
            return `## [[${r.id}]] — ${r.title}${vault}\nType: ${r.type}\nPath: ${r.path}\n\n${r.preview}`;
          })
          .join("\n\n---\n\n")}`,
      },
    ],
    details: { query, kind, matches: results },
  });
}
