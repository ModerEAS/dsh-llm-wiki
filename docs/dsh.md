# LLM Wiki — native DeepSeek Harness (DSH) plugin (draft, v1)

This directory documents the DSH-native plugin. New code lives in
[`src/dsh/`](../src/dsh/) (+ temporary bootstrap shims in
[`src/compat/`](../src/compat/)); the installable bundle manifest is
[`dsh/`](../dsh/). The pi extension (`extensions/llm-wiki/`) is kept for one
release cycle; the MCP server (`mcp/`) is kept as an alternative access path.

## Pick ONE lane per vault

> **The native DSH plugin and the MCP server must not run against the same
> vault at the same time.** Both write `meta/` projections and both guard
> `raw/`; two writers interleave rebuilds and confuse each other's locks.
> Use the native plugin inside DeepSeek Harness, and MCP for every other
> client (Claude Code, Cursor, Codex, Zed, Cline). Never mount both on one
> vault.

## Install (local, draft)

1. `pnpm build:dsh` — compiles `src/dsh` + `src/compat` + reused lib cores
   into `dist/dsh/` (the tree `dsh/host-index.js` re-exports). The build
   also rewrites the single pi-only import (`getAgentDir`, absent from the
   DSH host) to a local stub in dist only — shipped sources stay identical
   for pi/omp/tests.
2. In DeepSeek Harness: `plugin_manager` → `install_bundle` with the
   absolute `dsh/` directory.
3. The plugin row `llm-wiki` activates on HMR; open a project with (or
   without — it bootstraps silently) a `.llm-wiki/` vault.

Settings live in the Settings panel → **LLM Wiki** section (WebUI), with
`/wiki-model` and `/wiki-trajectories` as command-line equivalents.
Pure queries are slash commands (`/wiki-status`, `/wiki-search`,
`/wiki-recall`, `/wiki-lint`); work-initiating commands (`/wiki-bootstrap`,
`/wiki-capture`, `/wiki-ingest`) queue a followup prompt so upstream
semantics survive the "commands create no model message" rule.

## How the port decisions land in code

| Decision | Location |
|---|---|
| Completion reports: `agent.inject` + custom source (never steer/followup auto-start) | `src/dsh/background.ts` (`WIKI_REPORT_SOURCE`) |
| Synthesis via subagents + `ctx.llm.stream`; no apiKey; no pi-agent-core; synthesis preset pins commit tools | `src/dsh/synthesis.ts` (`SYNTHESIS_PRESET_ID`, `SYNTHESIS_PRESET_TOOLS`) |
| Compaction: pre-step pressure drain + `compaction/start` backstop | `src/dsh/recall-inject.ts` (`drainOnPressure`), `src/dsh/background.ts` (`watchCompaction`) |
| `file_path` → `path` shim (write/edit/str_replace_editor) + startup self-check | `src/dsh/guard.ts` |
| `isError: true` → throw at the port boundary | `src/dsh/envelope.ts` (`boundary`) |
| Exec timeout self-managed (`AbortSignal.timeout` → terminate) | `src/dsh/exec.ts` (`runCommand`/`execRaw`) |
| Long tasks unowned; survive session close; report only to the origin session | `src/dsh/background.ts` (`createDshRuntime`) |
| HMR: `agents.list()` backfill + effect cleanup | `src/dsh/index.ts` (`apply`) |
| Rebuild/config keyed by vault; registry serial write queue | `src/dsh/vault-state.ts` |
| Trajectory v1: fold/surface, shape convert, `tool_call_count > 0` | `src/dsh/trajectory-dsh.ts` |
| `console.warn` → `ctx.logger` | `src/dsh/logger.ts` |
| Former TUI settings → WebUI section; other commands stay slash; Config fields `.volatile()` for describe/whileServed | `src/dsh/settings-ui.ts`, `dsh/client.js`, `src/dsh/commands.ts` |
| Approval: allow-listed programs + directories, else deny | `src/dsh/approval.ts` |
| Minimal `lib/**` patches (each marked `DSH-PATCH` with reason) | `lib/host.ts` (dsh host), `lib/utils.ts` (atomic `writeJson`), `lib/guardrails.ts` (pi-import-free) |

Vault format is frozen: `.llm-wiki/` layout, OKF v0.2 semantics, page
filenames, and `meta/` generated formats are unchanged — a vault moves
between the pi build and the DSH build freely. New settings keys are added
under `llm-wiki.*` only.

## Draft status — verify live before merging

Logic is unit-covered (`test/dsh/**`, 61 tests, no Harness required), but
the following need a live DeepSeek Harness (`0.2.1-rc.3`, desktop profile):

- [ ] Plugin appears with title/description/icon (locale en + zh).
- [ ] `wiki_status` returns real data in a vault dir, and does not create
      one elsewhere (cwd resolution via `workingDirectory`).
- [ ] `write`/`str_replace_editor` to `.llm-wiki/raw/**` denied; ordinary
      project files writable (guard self-check passes at startup).
- [ ] Two consecutive turns inject recall at most once per turn.
- [ ] Background ingest completes WITHOUT opening a turn; the report lands
      in the originating session (inject, no wakeup).
- [ ] Failed synthesis is visible as an error, never a "write it yourself"
      checklist.
- [ ] After HMR reload, old sessions keep guard + recall (no bare sessions,
      no double registration).
- [ ] Two sessions on different vaults never cross rebuilds/config.
- [ ] Settings section renders (`package.json` must nest `dsh.client` under
      `dsh` — a top-level `"dsh.client"` key is ignored; Host Config fields
      need `.volatile()` so describe serves values into the section).
- [ ] With an approval policy composed, wiki tools allow/deny as
      documented; subagent synthesis cannot escalate.
