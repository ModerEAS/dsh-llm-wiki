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

Settings live in the Settings panel → **LLM Wiki** section (WebUI). It is the
primary control for every switch: `autoRecall`, `notices`, `trajectories`,
`proactiveCapture`, `observationReminder`, `reminderTurns`, `taskModel`,
`semanticWeight`, `recallLinksThreshold`, `ambientPersonalVault`.
Settings → Agent presets also lists **LLM Wiki synthesis** (child synthesis lane).

`/wiki-model` remains as a file-based shortcut for the background model. There is
no `/wiki-trajectories` command in DSH: trajectories is a GUI switch and nothing
else, so there is exactly one place to turn it on.

> Settings ≠ status sidebar. The Settings section edits behavior; the
> **sidebar status panel** (line-icon entry in `sidebar.panellist` → `main` page `wiki-status`)
> shows live vault state. It reads `GET /wiki/status.json` from the Host
> (`src/dsh/status-route.ts`, in-memory `WikiUiState` in `src/dsh/ui-state.ts`;
> verified live HTTP 200 on web). Path A won — fallback B (session slot +
> workspaceFiles) was not needed: the client bundle is web-only, and every
> profile that serves the WebUI composes `webServer`. A transient
> recall/background line also docks near the composer
> (`conversation.composer.dock`); it renders nothing when `notices: false`.
## Settings → runtime bridge

The panel edits the plugin **row config** — the `config` mapping under the
`llm-wiki` row of the profile's `cordis.patch.yml`. Writers: `configForms`
(client) → Host Loader → plugin. Readers used to be settings files only, so a
GUI save did nothing.

`apply(ctx, config)` now reads the row through `ctx.loader.entries()` (the entry
whose `options.id === "llm-wiki"`), because `options.config` holds **only
explicitly written keys** — schema defaults are not materialized there.
`setDshConfigOverrides()` keeps those keys, drops `undefined`, converts
`taskModel: "provider/id"` into a `{ provider, id }` spec, and clears the
per-vault `configForVault` cache. `configForVault()` then returns
`{ ...loadTaskConfig(vaultRoot), ...overrides }` — row values win per key, and a
key the user never saved still comes from `.dsh/.pi/.omp` settings files.

Consequences worth knowing:

- Saving in the panel re-applies the plugin (HMR). No restart, no command.
- The bridge is per process/profile, not per vault: files stay per vault, the
  row is shared. Two vaults never inherit each other's file values.
- A fresh install ships `config: {}` in `dsh/cordis.patch.yml` on purpose — a
  seeded default would mask an existing project's settings file.
- If the loader is unavailable, `apply` falls back to its `config` argument
  (which does carry schema defaults; that only matters on unknown hosts).

## Proactive capture (plugin-owned)

`src/dsh/recall-inject.ts` registers a second static system-prompt section,
`llm-wiki-policy` (`WIKI_POLICY_BLOCK`, order 890), next to the `<wiki_status>`
footer. It tells the model to recall before non-trivial work, to
`wiki_observe` / `wiki_retro` / `wiki_ensure_page` during and after it, to
`wiki_capture_source` → `wiki_ingest` for external material, what to skip, and
never to write secrets. It is byte-stable (no timestamps, cwd, or counts), so
the provider prefix cache stays warm. `proactiveCapture: false` removes it.

This replaces the earlier `~/.dsh/AGENTS.md` + `~/.dsh/skills/llm-wiki`
workaround, which only existed on one machine. Nothing in `src/dsh/` reads
those paths, and the repository does not ship them: every install gets the same
behavior from the plugin itself.

## Observation reminder

pi reminds at `agent_end` every 5 turns. DSH has no `agent_end`, so
`src/dsh/observe-reminder.ts` rebuilds the same nudge from the hooks DSH does
have:

| Hook | Role |
|---|---|
| `agent/pre-step` | Counts a turn at `step === 1`, deduped on `payload.turn` (a turn has many steps). At the interval, appends the reminder to `decision.messages`. |
| `tools/result` | `wiki_observe`, `wiki_retro`, `wiki_ensure_page`, `wiki_ingest`, or `wiki_capture_source` marks the session as "already wrote" → no further reminders. |
| `agent/created` / `agent/disposed` | Per-session state; disposed sessions drop their counter. |

It appends — never replaces — `decision.messages` (a replacement would drop the
user's prompt, H10), and tags the message `source: { kind: "llm-wiki-reminder" }`.
Main sessions only (subagents skip), and only when a wiki applies (project vault
or an ambient personal vault that is actually bootstrapped). Settings:
`observationReminder` (default on) and `reminderTurns` (default 5, minimum 1).

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
| Row config → runtime config bridge (GUI wins per key, cache cleared) | `src/dsh/index.ts` (`apply`), `src/dsh/vault-state.ts` (`setDshConfigOverrides`, `resolveRowConfig`) |
| Proactive-capture policy + observation reminder (plugin-owned, no env files) | `src/dsh/recall-inject.ts` (`WIKI_POLICY_BLOCK`), `src/dsh/observe-reminder.ts` |
| Approval: allow-listed programs + directories, else deny | `src/dsh/approval.ts` |
| Minimal `lib/**` patches (each marked `DSH-PATCH` with reason) | `lib/host.ts` (dsh host), `lib/utils.ts` (atomic `writeJson`), `lib/guardrails.ts` (pi-import-free) |

Vault format is frozen: `.llm-wiki/` layout, OKF v0.2 semantics, page
filenames, and `meta/` generated formats are unchanged — a vault moves
between the pi build and the DSH build freely. New settings keys are added
under `llm-wiki.*` only.

## Locale

DeepSeek Harness keeps two locale channels, and they do not share dictionaries.

| Channel | Where | What it localizes |
|---|---|---|
| Plugin list | `meta` in `dsh/locale/en.json`, `dsh/locale/zh.json` | `readPluginMeta` uses `meta.title` and `meta.description` only. |
| WebUI chrome | `STRINGS` in `dsh/client.js`, namespace `llm-wiki` | Settings, the card status panel, sidebar, and dock. Registered with `ctx.locale.register("llm-wiki", { en, zh })`. Slot entries set `locale: "llm-wiki"` and render with the framework `t` seat. |

The same screen keys are mirrored into `dsh/locale/{en,zh}.json` beside `meta`, for the host bundle. The browser cannot require those files, so the copy that actually renders is `STRINGS`. `test/dsh/ui-locale.test.ts` checks that the mirror, both languages, and the `{name}` placeholders stay aligned.

`inject()` must not pass `t`. The renderer spreads inject props over the framework seat, and a stable `locale.bind()` would keep memoized children on the previous language.

Dock lines and the status notice keep an English `text` and add a `code` (`dock.*`, `notice.*`) in that namespace. The client translates `code` and falls back to `text`. Model-written summaries stay as written. Vault narrative language is `synthesisLanguage`, not this UI locale.

A language pack can add another UI language with `ctx.locale.register("llm-wiki", "<id>", dict)` using the same keys. It cannot replace the shipped `en` or `zh` dictionaries. Plugin-list text for a third language has to ship as `dsh/locale/<id>.json` in this package; packs cannot fill display metadata.

## Draft status — verify live before merging

Logic is unit-covered (`test/dsh/**`, 61 tests, no Harness required), but
the following need a live DeepSeek Harness (`0.2.1-rc.3`, desktop profile):

- [ ] Plugin appears with title/description/icon (locale en + zh from `dsh/locale/*.json`). Settings, sidebar, and the status panel follow Settings → General → Language.
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
- [ ] Settings → LLM Wiki → `trajectories` ON registers the 3 trajectory tools
      on the next turn, OFF gates them again (row config → `configForVault`).
- [ ] Saving any panel field re-applies the plugin without restart and the new
      value is visible in `/wiki-status` capabilities.
- [ ] A fresh session in a vault starts with the `<wiki_policy>` section, with
      no `~/.dsh/AGENTS.md` and no user skill installed.
- [ ] `observationReminder` ON: after `reminderTurns` wiki-less turns exactly one
      reminder appears; after a `wiki_observe` call none appear again in that
      session. OFF: none at all.
