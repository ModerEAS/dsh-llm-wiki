<div align="center">

# dsh-llm-wiki

**English** | <a href="./README.zh.md">中文</a> | <a href="./README.es.md">Español</a> | <a href="./README.ja.md">日本語</a> | <a href="./README.de.md">Deutsch</a> | <a href="./README.fr.md">Français</a> | <a href="./README.pt.md">Português</a> | <a href="./README.ru.md">Русский</a> | <a href="./README.ko.md">한국어</a> | <a href="./README.hi.md">हिंदी</a>

[![CI](https://github.com/ModerRAS/dsh-llm-wiki/actions/workflows/ci.yml/badge.svg)](https://github.com/ModerRAS/dsh-llm-wiki/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

</div>

<br/>

**LLM Wiki as a native [DeepSeek Harness (DSH)](docs/dsh.md) plugin: a self-maintaining,
Obsidian-compatible knowledge base that lives inside your project.**

Follows Andrej Karpathy's [LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f):
turn raw sources (URLs, PDFs, markdown, JSON, XML) into a durable, interlinked,
LLM-maintained wiki that **compounds** instead of being re-derived on every question.

This repository is the DSH fork of
[`zosmaai/pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki). The wiki format is
identical — a vault moves freely between the two builds.

### Native Open Knowledge Format (OKF) v0.2 support

- **Create portable OKF v0.2 documents** with canonical frontmatter, standard Markdown links, and stable source citations.
- **Read both legacy and OKF pages**, so existing vaults keep working without an automatic migration or rewrite.
- **Generate deterministic indexes and logs** from authoritative pages, keeping navigation and metadata reproducible.
- **Use the same knowledge model from DSH or MCP** — DeepSeek Harness natively, or Claude Code, Cursor, Codex, Zed and Cline over MCP.
- **Stay Obsidian-compatible** while keeping your knowledge ready for tools that support Open Knowledge Format.

See the [OKF Foundation specification](docs/superpowers/specs/2026-08-02-okf-foundation-design.md)
for implementation details.

---

## Demo

<div align="center">
  <img src="./assets/demo.gif" alt="dsh-llm-wiki demo" width="1920" />
</div>

---

## Quick Start — DeepSeek Harness

Requirements: Node ≥ 22, pnpm 9.

The plugin ships as a DSH **bundle** in [`dsh/`](dsh/). It is a local, private bundle
(`dsh-llm-wiki`) — there is no npm release of this fork yet.

```bash
git clone https://github.com/ModerRAS/dsh-llm-wiki.git
cd dsh-llm-wiki
pnpm install
pnpm build:dsh          # compiles src/dsh → dist/dsh/, which dsh/host-index.js re-exports
```

Then, in DeepSeek Harness:

1. Open `plugin_manager` → `install_bundle`.
2. Point it at the **absolute** path of the `dsh/` directory in your clone,
   e.g. `/Users/you/src/dsh-llm-wiki/dsh`.
3. The plugin row `llm-wiki` activates on HMR. Open any project — with or without a
   `.llm-wiki/` vault; it bootstraps silently.

You get, per project:

- the **LLM Wiki tools** (see [Tools](#tools)) available to the agent,
- a **sidebar status panel** (`sidebar.panellist` → `main` page `wiki-status`) with live
  vault state, backed by `GET /wiki/status.json`,
- a **Settings → LLM Wiki** section for behaviour, and an **LLM Wiki synthesis** agent
  preset for background work,
- `/wiki-*` slash commands (see [Slash Commands](#slash-commands)).

> **Full host documentation:** [`docs/dsh.md`](docs/dsh.md) — install, settings
> surfaces, locale channels, port decisions, and the live-verification checklist for
> this draft v1.

First run:

```
/wiki-bootstrap "AI Engineering"
/wiki-capture https://example.com/some-article
/wiki-ingest
/wiki-recall What are the key patterns?
```

---

## Other harnesses — MCP (not at the same time)

Everything outside DeepSeek Harness reaches the same vault through the packaged stdio
MCP server. Build it once:

```bash
pnpm install
pnpm build:mcp          # emits dist/mcp/index.js
```

Register the **absolute** path of `dist/mcp/index.js` as a local stdio server in your
client (Claude Code, Codex CLI, Cursor, Windsurf, Zed, Cline):

```json
{
  "mcpServers": {
    "llm-wiki": {
      "command": "node",
      "args": ["/absolute/path/to/dsh-llm-wiki/dist/mcp/index.js"],
      "env": { "WIKI_ROOT": "/absolute/path/to/my-wiki" }
    }
  }
}
```

`WIKI_ROOT` pins the vault; when unset the server resolves it from the client's working
directory. MCP clients spawn without a shell, so `~` is never expanded — always use
absolute paths. Client-specific JSON/TOML examples live in
[`docs/harnesses.md`](docs/harnesses.md).

> ### ⚠️ One writer per vault
> **The native DSH plugin and the MCP server must never run against the same vault at
> the same time.** Both write `meta/` projections and both guard `raw/`; two writers
> interleave rebuilds and confuse each other's locks. Use the native plugin inside
> DeepSeek Harness, and MCP for every other client. Never mount both on one vault.

The optional `@tobilu/qmd` package behind semantic search can be dropped silently by
npm when its `typescript` peer cannot be met — see
[`docs/qmd-compatibility.md`](docs/qmd-compatibility.md#installing-on-npm-hosts).

---

## Why a wiki instead of one-shot RAG?

Most file-based LLM workflows behave like one-shot RAG: the model re-reads raw documents
on every question and the synthesis is ephemeral.

**dsh-llm-wiki** inserts a durable middle layer:

- **Raw source packets** preserve source-of-truth inputs
- **Source pages** summarize what each source says
- **Canonical wiki pages** track what the wiki currently believes
- **Generated metadata** keeps everything searchable and navigable

The wiki accretes as you capture sources, ask questions, and file durable analyses.

---

## Features

| Capability | Description |
|------------|-------------|
| 🏠 **Personal fallback** | Always-on `~/.llm-wiki/` vault — knowledge compounds across projects even when no project wiki exists |
| 🔗 **Immutable source capture** | URLs, local files (PDF/md/txt/html/XML/JSON), or pasted text → structured source packets |
| 🧠 **Automated ingestion** | `wiki_ingest` batch-processes sources into concept, entity, synthesis & analysis pages |
| 🔍 **Full-text search** | Generated registry with keyword lookup across all pages and sources |
| 🩺 **Mechanical linting** | Orphans, broken links, duplicate aliases, coverage gaps, stale captures |
| 📊 **Dashboard** | `wiki_status` — counts, source states, recent activity; plus the WebUI sidebar panel |
| 🤖 **Auto-update watch** | `wiki_watch` — print a `crontab` line that runs the full cycle on a schedule |
| 🧠 **Layered recall** | Searches both personal (`~/.llm-wiki/`) and project (`.llm-wiki/`) vaults — personal knowledge follows you everywhere |
| 📝 **Auto-bootstrap** | The plugin suggests creating a wiki when none exists in the current directory |
| 💾 **Lightweight capture** | `wiki_retro` — save atomic insights as a single markdown file; full 4-layer pipeline also available via `wiki_capture_source` |
| 🧭 **Agent working-memory** _(opt-in)_ | `wiki_capture_trajectory` records *how* a task was solved (tool-call trajectory) → distill into reusable `skill`/`case` pages → `wiki_recall_skill` surfaces them next time. Off by default; enable with `/wiki-trajectories on` |
| 🌐 **OKF v0.2 native** | Portable Open Knowledge Format documents, dual-read legacy compatibility, deterministic projections |
| 🌐 **MCP Server** | Use the same OKF-aware wiki from Claude Code, Cursor, Windsurf via stdio MCP transport |
| 📝 **Obsidian-friendly** | Folder-qualified wikilinks, stable source-ID citations, compatible vault |
| 🛡️ **Guardrails** | Blocks direct edits to raw sources and generated metadata |
| 🔧 **Configurable PDF extraction** | MarkItDown timeout via `WIKI_MARKITDOWN_TIMEOUT_MS` env var |
| 🧪 **Quality checks** | TypeScript, Vitest, Biome, CodeQL |

---

## Tools

| Tool | Description |
|------|-------------|
| `wiki_bootstrap` | Initialize a new wiki vault with config, templates, schema, and metadata |
| `wiki_capture_source` | Capture a URL, local file, or pasted text into an immutable source packet |
| `wiki_recall` | Search wiki for task-relevant pages — searches both personal (`~/.llm-wiki/`) and project (`.llm-wiki/`) vaults, deduplicated |
| `wiki_retro` | Save atomic insights from completed tasks into the wiki |
| `wiki_ingest` | Process uningested source packets into wiki pages (batch) |
| `wiki_ensure_page` | Resolve or safely create entity / concept / synthesis / analysis pages |
| `wiki_search` | Search the generated wiki registry |
| `wiki_lint` | Deterministic health checks (orphans, gaps, contradictions, auto-fix) |
| `wiki_status` | Show counts, source states, and recent activity |
| `wiki_observe` | Record timestamped, searchable observations from the current session (decisions, findings, constraints) — later distilled into pages |
| `wiki_rebuild_meta` | Force a full metadata rebuild (registry, backlinks, index, log) |
| `wiki_reindex` | Rebuild/repair the generated QMD search index at `meta/qmd` (lexical is model-free; vectors may download ~2 GB) |
| `wiki_reindex_embeddings` | Refresh semantic embeddings for new or stale pages (no-op if no embedding provider is configured) |
| `wiki_log_event` | Append a structured event to the wiki activity log |
| `wiki_watch` | Print a `crontab` line for automatic wiki updates (daily / weekly / hourly) — does not install it |
| `wiki_capture_trajectory` _(opt-in)_ | Capture the completed task's tool-call trajectory (agent working-memory) |
| `wiki_distill_skills` _(opt-in)_ | Batch undistilled trajectories for synthesis into reusable skill pages |
| `wiki_recall_skill` _(opt-in)_ | Recall distilled skills + similar past cases — "have I done this before?" |

> The three agent-trajectory tools are **off by default**. Enable them with
> `/wiki-trajectories on` (sets `llm-wiki.trajectories`); when off they are not
> registered at all.

### Slash Commands

DeepSeek Harness slash commands are defined in
[`src/dsh/commands.ts`](src/dsh/commands.ts). Pure queries answer directly; commands that
start work queue a follow-up prompt so the agent keeps owning the write path.

| Command | Description |
|---------|-------------|
| `/wiki-status` | Report LLM Wiki health and stats for this project |
| `/wiki-search <query>` | Search the wiki registry for pages matching a query |
| `/wiki-recall <task>` | Recall wiki pages relevant to the given task or question |
| `/wiki-lint [--fix]` | Check wiki health (orphans, missing pages, gaps) |
| `/wiki-bootstrap <topic>` | Initialize an LLM Wiki vault here |
| `/wiki-capture <url \| path \| text>` | Capture a source into the wiki |
| `/wiki-ingest` | Ingest captured sources into wiki pages (background synthesis) |
| `/wiki-model [provider/id \| clear]` | Show or set the background synthesis model |
| `/wiki-trajectories [on \| off]` | Enable/disable agent working-memory (opt-in, off by default) |

<img src="./assets/wiki-dashboard.png" alt="wiki status panel: read-only vault health" width="100%" />

---

## Layered Vault Architecture

| Layer | Location | Purpose |
|-------|----------|---------|
| 🏠 **Personal** | `~/.llm-wiki/` | Always active. Zero setup. Knowledge compounds across all your sessions — regardless of which project you're in. |
| 📁 **Project** | `{project}/.llm-wiki/` | Explicit opt-in. Dedicated wiki per project, sharing personal knowledge when relevant. |
| 🏢 **Company** (future) | git-tracked | Shared wiki across a team. `wiki_publish` promotes personal/project pages to the company wiki. |

**How it works:**

1. `resolveVaultRoot()` checks: cwd → walk up for `.llm-wiki/` → `~/.llm-wiki/`
2. `wiki_recall` (layered) searches **both** personal and project vaults, merging results with vault labels
3. Personal results are shown first in recall output, tagged as "📓 personal"
4. `wiki_retro` writes to whichever vault is active (project takes priority)
5. Set `WIKI_HOME` env var to override the personal wiki location

So you can keep a project wiki for team documentation **and** a personal wiki for your
own notes, and recall searches both at once.

---

## Quick Start (Manual Walkthrough)

### 1) Create a new wiki

```bash
mkdir my-wiki && cd my-wiki && dsh
```

Then `/wiki-bootstrap "AI Research"`, which creates:

```
.llm-wiki/
├── config.json
├── templates/
├── raw/
├── wiki/
├── meta/
└── WIKI_SCHEMA.md
```

### 2) Capture a source

```
/wiki-capture https://example.com/some-article
/wiki-capture ./papers/context-windows.pdf
/wiki-capture <pasted notes>
```

### 3) Integrate the source

1. Capture the source
2. Read `.llm-wiki/wiki/sources/SRC-*.md`
3. Update that source page
4. Search for impacted canonical pages with `wiki_search`
5. Create missing pages with `wiki_ensure_page`
6. Update concept / entity / synthesis pages with citations
7. Mark the integration with `wiki_log_event kind=integrate`

### 4) Query the wiki

```
Based on the wiki, what are the main tradeoffs between long-context models and RAG?
```

By default, query mode is **read-only**. To file a durable answer, ask explicitly:

```
Answer the question and file the result as an analysis page.
```

---

## Vault Layout

```
my-wiki/
└─ .llm-wiki/
   ├─ config.json               # Vault config
   ├─ templates/                 # Page templates
   ├─ raw/
   │  └─ sources/
   │     └─ SRC-2026-05-11-001/
   │        ├─ manifest.json
   │        ├─ original/           # Original artifact
   │        ├─ extracted.md        # Normalized text
   │        └─ attachments/
   ├─ wiki/
   │  ├─ sources/                  # Source pages (what each source says)
   │  ├─ concepts/                 # Concepts and recurring ideas
   │  ├─ entities/                 # People, orgs, products, papers, systems
   │  ├─ syntheses/                # Cross-source theses and tensions
   │  └─ analyses/                 # Durable filed answers from queries
   ├─ meta/
   │  ├─ registry.json             # Auto-generated search index
   │  ├─ backlinks.json
   │  ├─ index.md
   │  ├─ events.jsonl              # Append-only event log
   │  ├─ log.md
   │  └─ lint-report.md
   └─ WIKI_SCHEMA.md               # Operating manual
```

### Ownership Model

| Path | Owner | Rule |
|------|-------|------|
| `.llm-wiki/raw/**` | Extension tools | Immutable after capture |
| `.llm-wiki/wiki/**` | Model + user | Editable knowledge pages |
| `.llm-wiki/meta/registry.json` | Extension | Generated |
| `.llm-wiki/meta/backlinks.json` | Extension | Generated |
| `.llm-wiki/meta/index.md` | Extension | Generated |
| `.llm-wiki/meta/events.jsonl` | Extension / tool | Authoritative append-only state; back up for activity continuity |
| `.llm-wiki/meta/log.md` | Extension | Generated from events |
| `.llm-wiki/meta/lint-report.md` | Extension | Generated |
| `.llm-wiki/WIKI_SCHEMA.md` | Human + explicit request | Operating manual |

### Activity history, backup, and portability

`meta/events.jsonl` is the authoritative source for recorded extension activity. Unlike
registry, backlinks, indexes, logs, and embeddings, it cannot be rebuilt from wiki pages
or raw packets. Preserve it when backing up or Git-synchronizing a complete vault.

`meta/log.md` and OKF-mode `wiki/log.md` are generated views. `wiki/log.md` can travel
with the OKF bundle as a readable snapshot, but it cannot reconstruct or resume the
originating JSONL stream. Manual page edits are intentionally absent, so this is selected
extension activity rather than a complete revision audit.

File-capture events omit machine-local paths from the public log projection. Callers of
`wiki_log_event` still control arbitrary detail fields and must not record secrets or
private host paths.

---

## Linking & Citation Style

### Internal Navigation

```markdown
[[concepts/retrieval-augmented-generation]]
[[entities/openai|OpenAI]]
[[syntheses/long-context-vs-rag]]
```

### Factual Citations

```markdown
[[sources/SRC-2026-04-04-001|SRC-2026-04-04-001]]
```

Stable source-page IDs keep provenance stable even if titles change.

---

## Guardrails

The plugin **blocks** direct tool-call edits to:

- `.llm-wiki/raw/**` — immutable source artifacts
- `.llm-wiki/meta/registry.json`
- `.llm-wiki/meta/backlinks.json`
- `.llm-wiki/meta/events.jsonl`
- `.llm-wiki/meta/index.md`
- `.llm-wiki/meta/log.md`
- `.llm-wiki/meta/lint-report.md`

If the model edits `.llm-wiki/wiki/**` with ordinary `write`/`edit` tools, generated
metadata is **rebuilt automatically** at the end of the agent turn.

---

## Source Packet Format

Each captured source is stored as a structured packet:

```
.llm-wiki/raw/sources/SRC-YYYY-MM-DD-NNN/
├─ manifest.json     # Capture metadata (title, URL, format, timestamp)
├─ original/         # Original artifact (preserved as-is)
├─ extracted.md      # Normalized text (PDF→md, XML→md, JSON→md, etc.)
└─ attachments/      # Future attachment downloads
```

This preserves both the **original artifact** and a **normalized extracted view** for
reading.

---

## Skill Behavior

The bundled `llm-wiki` skill teaches the model to:

- ❌ Never edit raw sources directly
- ❌ Never edit generated metadata files
- ✅ Capture first, integrate second
- ✅ Search before creating new canonical pages
- ✅ Cite facts using source-page IDs
- ✅ Keep query mode read-only by default
- ✅ Use "Tensions / caveats" and "Open questions" when evidence is mixed

---

## Architecture

### Four-Layer Page Model

```
.llm-wiki/raw/sources/SRC-*/     # Immutable source packets (extension-owned)
.llm-wiki/wiki/                  # Editable knowledge pages (you + LLM)
.llm-wiki/meta/                  # Durable event source + generated internal projections
.llm-wiki/                       # Config and templates
```

Read [docs/architecture.md](docs/architecture.md) for the full design document, and
[docs/dsh.md](docs/dsh.md) for how the DSH port maps onto the host (bundles, slots,
WebUI surfaces, synthesis lane).

---

## Documentation

| Document | What it covers |
|----------|---------------|
| [DeepSeek Harness plugin](docs/dsh.md) | **Start here** — DSH install, settings, sidebar, locale, port decisions |
| [Architecture](docs/architecture.md) | How the four layers work, ownership model |
| [Commands](docs/commands.md) | Slash commands and tool reference |
| [Obsidian Integration](docs/obsidian.md) | Vault setup and recommended plugins |
| [Configuration](docs/configuration.md) | Wiki modes, topics, environment variables |
| [API](docs/api.md) | Tool parameter reference |
| [Harnesses](docs/harnesses.md) | MCP client configuration for non-DSH harnesses |

---

## Project Status

The DSH plugin is **draft v1**: logic is unit-covered under [`test/dsh/`](test/dsh/) with
no harness required, while the host-interaction checklist in
[`docs/dsh.md`](docs/dsh.md#draft-status--verify-live-before-merging) still needs a live
DeepSeek Harness pass before it is promoted.

The upstream pi extension (`extensions/llm-wiki/`) and the MCP server (`mcp/`) remain in
the tree — MCP stays as the cross-harness path; the pi extension is kept for one release
cycle.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, test patterns, and PR
workflow.

---

## Credits & License

Built by [zosmaai](https://github.com/zosmaai) as
[`pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki); this fork maintains the native
DeepSeek Harness port. MIT licensed — see [LICENSE](LICENSE).

## Contributors

Thanks to everyone who has contributed upstream! This list is regenerated automatically
by [`.github/workflows/contributors.yml`](.github/workflows/contributors.yml).

<!-- readme: contributors -start -->
<table>
	<tbody>
		<tr>
            <td align="center">
                <a href="https://github.com/arjun-zosma">
                    <img src="https://avatars.githubusercontent.com/u/25246034?v=4" width="64;" alt="arjun-zosma"/>
                    <br />
                    <sub><b>Arjun Nayak</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/Shanvit7">
                    <img src="https://avatars.githubusercontent.com/u/64424817?v=4" width="64;" alt="Shanvit7"/>
                    <br />
                    <sub><b>Shanvit S Shetty</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/jfraser">
                    <img src="https://avatars.githubusercontent.com/u/165964?v=4" width="64;" alt="jfraser"/>
                    <br />
                    <sub><b>James Fraser</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/mkuhl">
                    <img src="https://avatars.githubusercontent.com/u/61073?v=4" width="64;" alt="mkuhl"/>
                    <br />
                    <sub><b>Mike P. Kuhl</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/prestalab">
                    <img src="https://avatars.githubusercontent.com/u/2825421?v=4" width="64;" alt="prestalab"/>
                    <br />
                    <sub><b>PrestaLab</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/wooksong">
                    <img src="https://avatars.githubusercontent.com/u/2772376?v=4" width="64;" alt="wooksong"/>
                    <br />
                    <sub><b>wooksong</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/CelestialCreator">
                    <img src="https://avatars.githubusercontent.com/u/177931942?v=4" width="64;" alt="CelestialCreator"/>
                    <br />
                    <sub><b>Akshay</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/xcsf">
                    <img src="https://avatars.githubusercontent.com/u/43439835?v=4" width="64;" alt="xcsf"/>
                    <br />
                    <sub><b>xcsf</b></sub>
                </a>
            </td>
		</tr>
		<tr>
            <td align="center">
                <a href="https://github.com/danielnaab">
                    <img src="https://avatars.githubusercontent.com/u/136512?v=4" width="64;" alt="danielnaab"/>
                    <br />
                    <sub><b>Daniel Naab</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/mdmayfield">
                    <img src="https://avatars.githubusercontent.com/u/26154258?v=4" width="64;" alt="mdmayfield"/>
                    <br />
                    <sub><b>Matt Mayfield</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/deestax">
                    <img src="https://avatars.githubusercontent.com/u/152369481?v=4" width="64;" alt="deestax"/>
                    <br />
                    <sub><b>Superdao</b></sub>
                </a>
            </td>
            <td align="center">
                <a href="https://github.com/mystery4f">
                    <img src="https://avatars.githubusercontent.com/u/40482524?v=4" width="64;" alt="mystery4f"/>
                    <br />
                    <sub><b>标准萌新</b></sub>
                </a>
            </td>
		</tr>
	<tbody>
</table>
<!-- readme: contributors -end -->

---

<div align="center">
  <sub>DSH port maintained at <a href="https://github.com/ModerRAS/dsh-llm-wiki">ModerRAS/dsh-llm-wiki</a> · upstream <a href="https://github.com/zosmaai/pi-llm-wiki">zosmaai/pi-llm-wiki</a> · <a href="https://github.com/ModerRAS/dsh-llm-wiki/issues">Issues</a></sub>
</div>
