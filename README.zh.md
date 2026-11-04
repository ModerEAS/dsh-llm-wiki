<div align="center">

# dsh-llm-wiki

<a href="./README.md">English</a> | **中文** | <a href="./README.es.md">Español</a> | <a href="./README.ja.md">日本語</a> | <a href="./README.de.md">Deutsch</a> | <a href="./README.fr.md">Français</a> | <a href="./README.pt.md">Português</a> | <a href="./README.ru.md">Русский</a> | <a href="./README.ko.md">한국어</a> | <a href="./README.hi.md">हिंदी</a>

[![CI](https://github.com/ModerRAS/dsh-llm-wiki/actions/workflows/ci.yml/badge.svg)](https://github.com/ModerRAS/dsh-llm-wiki/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

</div>

<br/>

**作为原生 [DeepSeek Harness（DSH）](docs/dsh.md) 插件运行的 LLM Wiki：自维护、兼容 Obsidian、
直接长在项目里的知识库。**

遵循 Andrej Karpathy 的 [LLM Wiki 模式](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)：
把原始来源（网址、PDF、Markdown、JSON、XML）转化为持久、互联、由 LLM 维护的 Wiki，
让它**持续积累**，而不是每次提问都重新推导一遍。

本仓库是 [`zosmaai/pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki) 的 DSH 分支。
Vault 格式完全一致——同一个 vault 可以在两套构建之间自由迁移。

### 原生 Open Knowledge Format (OKF) v0.2 支持

- **创建可移植的 OKF v0.2 文档**，具有标准 frontmatter、标准 Markdown 链接和稳定的来源引用。
- **同时读取旧版和 OKF 页面**，现有 vault 无需自动迁移或重写即可继续工作。
- **从权威页面生成确定性索引和日志**，保持导航和元数据可重现。
- **在 DSH 或 MCP 中使用同一套知识模型**——DeepSeek Harness 原生接入，或通过 MCP 供 Claude Code、Cursor、Codex、Zed、Cline 使用。
- **保持 Obsidian 兼容性**，同时让知识准备好供支持 Open Knowledge Format 的工具使用。

实现细节见 [OKF Foundation 规范](docs/superpowers/specs/2026-08-02-okf-foundation-design.md)。

---

## 演示

<div align="center">
  <img src="./assets/demo.gif" alt="dsh-llm-wiki 演示" width="1920" />
</div>

---

## 快速开始 —— DeepSeek Harness

环境要求：Node ≥ 22，pnpm 9。

插件以 DSH **bundle** 的形式放在 [`dsh/`](dsh/) 中。它是本地私有 bundle
（`dsh-llm-wiki`）——这个分支目前**没有**发布到 npm。

```bash
git clone https://github.com/ModerRAS/dsh-llm-wiki.git
cd dsh-llm-wiki
pnpm install
pnpm build:dsh          # 编译 src/dsh → dist/dsh/，由 dsh/host-index.js 再导出
```

然后在 DeepSeek Harness 中：

1. 打开 `plugin_manager` → `install_bundle`。
2. 指向你克隆目录中 `dsh/` 的**绝对路径**，
   例如 `/Users/you/src/dsh-llm-wiki/dsh`。
3. 插件行 `llm-wiki` 会在 HMR 后激活。打开任意项目即可——有没有 `.llm-wiki/` vault
   都行，没有会静默初始化。

每个项目里你会得到：

- 可供 agent 使用的 **LLM Wiki 工具集**（见[工具](#工具)），
- **侧边栏状态面板**（`sidebar.panellist` → `main` 页 `wiki-status`），显示实时 vault 状态，
  数据来自 `GET /wiki/status.json`，
- **设置 → LLM Wiki** 配置区，以及后台任务用的 **LLM Wiki synthesis** agent preset，
- `/wiki-*` 斜杠命令（见[斜杠命令](#斜杠命令)）。

> **完整宿主文档：** [`docs/dsh.md`](docs/dsh.md) —— 安装、设置界面、语言通道、
> 移植决策，以及本 draft v1 的实机验证清单。

首次使用：

```
/wiki-bootstrap "AI Engineering"
/wiki-capture https://example.com/some-article
/wiki-ingest
/wiki-recall 关键模式有哪些？
```

---

## 其他宿主 —— MCP（不可同时启用）

DeepSeek Harness 之外的一切客户端都通过打包的 stdio MCP 服务器访问同一个 vault。
构建一次：

```bash
pnpm install
pnpm build:mcp          # 产出 dist/mcp/index.js
```

在客户端（Claude Code、Codex CLI、Cursor、Windsurf、Zed、Cline）中把
`dist/mcp/index.js` 的**绝对路径**注册为本地 stdio 服务器：

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

`WIKI_ROOT` 用于固定 vault；不设置时服务器会从客户端的工作目录推导。MCP 客户端
不经过 shell 启动，`~` 不会被展开——请一律使用绝对路径。各客户端的具体 JSON/TOML
示例见 [`docs/harnesses.md`](docs/harnesses.md)。

> ### ⚠️ 一个 vault 只能有一个写入方
> **原生 DSH 插件和 MCP 服务器绝不能同时作用于同一个 vault。** 两者都会写 `meta/`
> 投影、都会守护 `raw/`；两个写入方会交错重建、互相混淆对方的重建锁。在
> DeepSeek Harness 内使用原生插件，在其他客户端使用 MCP，绝不要同时挂载。

语义检索背后的可选包 `@tobilu/qmd` 可能因为 `typescript` peer 无法满足而被 npm
静默丢弃——见 [`docs/qmd-compatibility.md`](docs/qmd-compatibility.md#installing-on-npm-hosts)。

---

## 为什么要 Wiki，而不是一次性 RAG？

多数基于文件的 LLM 工作流本质上是一次性 RAG：每次提问都重新读原始文档，综合结果
转瞬即逝。

**dsh-llm-wiki** 插入了一层持久中间层：

- **原始来源包**保留事实来源的原始输入
- **来源页**总结每个来源说了什么
- **规范页面**记录 wiki 当前相信什么
- **生成的元数据**保证一切可搜索、可导航

随着你不断采集来源、提问、归档分析，wiki 会持续**增厚**。

---

## 功能特性

| 能力 | 说明 |
|------|------|
| 🏠 **个人兜底 vault** | 常驻 `~/.llm-wiki/` vault——即使项目没有 wiki，知识也能跨项目积累 |
| 🔗 **不可变来源采集** | 网址、本地文件（PDF/md/txt/html/XML/JSON）或粘贴文本 → 结构化来源包 |
| 🧠 **自动摄取** | `wiki_ingest` 批量把来源加工成 concept、entity、synthesis、analysis 页面 |
| 🔍 **全文检索** | 自动生成的 registry 支持跨页面与来源的关键词查找 |
| 🩺 **机械式体检** | 孤儿页、失效链接、重复别名、覆盖缺口、过期采集 |
| 📊 **仪表盘** | `wiki_status`——统计、来源状态、近期活动；外加 WebUI 侧边栏面板 |
| 🤖 **自动更新** | `wiki_watch`——打印一行 `crontab`，按计划跑完整流程 |
| 🧠 **分层召回** | 同时搜索个人（`~/.llm-wiki/`）与项目（`.llm-wiki/`）vault——个人知识跟着你走 |
| 📝 **自动初始化** | 当前目录没有 wiki 时，插件会提示创建 |
| 💾 **轻量记录** | `wiki_retro`——把原子洞察存成单个 markdown 文件；完整四层流程仍可用 `wiki_capture_source` |
| 🧭 **Agent 工作记忆** _(可选)_ | `wiki_capture_trajectory` 记录任务*如何*被解决（工具调用轨迹）→ 蒸馏成可复用的 `skill`/`case` 页 → 下次由 `wiki_recall_skill` 召回。默认关闭，用 `/wiki-trajectories on` 开启 |
| 🌐 **OKF v0.2 原生** | 可移植 Open Knowledge Format 文档、旧格式双读兼容、确定性投影 |
| 🌐 **MCP 服务器** | 通过 stdio MCP 在 Claude Code、Cursor、Windsurf 中复用同一套 OKF 感知 wiki |
| 📝 **Obsidian 友好** | 带目录前缀的 wikilink、稳定来源 ID 引用、兼容 vault |
| 🛡️ **护栏** | 阻止直接编辑原始来源与生成的元数据 |
| 🔧 **可配置 PDF 抽取** | 通过 `WIKI_MARKITDOWN_TIMEOUT_MS` 环境变量设置 MarkItDown 超时 |
| 🧪 **质量保障** | TypeScript、Vitest、Biome、CodeQL |

---

## 工具

| 工具 | 说明 |
|------|------|
| `wiki_bootstrap` | 初始化新的 wiki vault（config、模板、schema、元数据） |
| `wiki_capture_source` | 把 URL、本地文件或粘贴文本采集为不可变来源包 |
| `wiki_recall` | 搜索与任务相关的页面——同时检索个人（`~/.llm-wiki/`）与项目（`.llm-wiki/`）vault 并去重 |
| `wiki_retro` | 把已完成任务中的原子洞察存入 wiki |
| `wiki_ingest` | 批量把未摄取的来源包加工成 wiki 页面 |
| `wiki_ensure_page` | 解析或安全创建 entity / concept / synthesis / analysis 页面 |
| `wiki_search` | 搜索生成的 wiki registry |
| `wiki_lint` | 确定性健康检查（孤儿、缺口、矛盾、自动修复） |
| `wiki_status` | 显示统计、来源状态与近期活动 |
| `wiki_observe` | 记录当前会话中带时间戳、可搜索的观察（决策、发现、约束）——后续可蒸馏成页面 |
| `wiki_rebuild_meta` | 强制完整重建元数据（registry、backlinks、index、log） |
| `wiki_reindex` | 重建/修复 `meta/qmd` 下的 QMD 检索索引（lexical 无需模型；vectors 可能下载约 2 GB） |
| `wiki_reindex_embeddings` | 为新页面或过期页面刷新语义向量（未配置 embedding provider 时为空操作） |
| `wiki_log_event` | 向 wiki 活动日志追加结构化事件 |
| `wiki_watch` | 打印自动更新的 `crontab` 行（daily / weekly / hourly）——不会替你安装 |
| `wiki_capture_trajectory` _(可选)_ | 记录已完成任务的工具调用轨迹（agent 工作记忆） |
| `wiki_distill_skills` _(可选)_ | 批量取出未蒸馏轨迹，合成为可复用 skill 页 |
| `wiki_recall_skill` _(可选)_ | 召回已蒸馏的 skill 与相似历史案例——"这件事我以前做过吗？" |

> 三个 agent 轨迹工具**默认关闭**。用 `/wiki-trajectories on` 开启
> （设置 `llm-wiki.trajectories`）；关闭时它们根本不会被注册。

### 斜杠命令

DeepSeek Harness 的斜杠命令定义在 [`src/dsh/commands.ts`](src/dsh/commands.ts)。
纯查询类命令直接返回结果；会启动工作的命令会排队一条 follow-up prompt，
让 agent 继续负责写入路径。

| 命令 | 说明 |
|------|------|
| `/wiki-status` | 报告本项目的 LLM Wiki 健康度与统计 |
| `/wiki-search <query>` | 在 wiki registry 中搜索页面 |
| `/wiki-recall <task>` | 召回与给定任务或问题相关的页面 |
| `/wiki-lint [--fix]` | 检查 wiki 健康度（孤儿、缺失页面、缺口） |
| `/wiki-bootstrap <topic>` | 在这里初始化 LLM Wiki vault |
| `/wiki-capture <url \| path \| text>` | 采集一个来源到 wiki |
| `/wiki-ingest` | 把已采集来源摄取为 wiki 页面（后台合成） |
| `/wiki-model [provider/id \| clear]` | 查看或设置后台合成模型 |
| `/wiki-trajectories [on \| off]` | 启用/关闭 agent 工作记忆（默认关闭） |

<img src="./assets/wiki-dashboard.png" alt="wiki 状态面板：只读 vault 健康度" width="100%" />

---

## 分层 Vault 架构

| 层 | 位置 | 用途 |
|----|------|------|
| 🏠 **个人** | `~/.llm-wiki/` | 始终生效，零配置。无论你在哪个项目，知识都会跨会话积累。 |
| 📁 **项目** | `{project}/.llm-wiki/` | 显式选择启用。每个项目独立 wiki，需要时共享个人知识。 |
| 🏢 **公司**（未来） | git 跟踪 | 团队共享 wiki。`wiki_publish` 把个人/项目页面提升到公司 wiki。 |

**工作方式：**

1. `resolveVaultRoot()` 依次检查：cwd → 向上查找 `.llm-wiki/` → `~/.llm-wiki/`
2. `wiki_recall`（分层）同时搜索个人与项目 vault，并以 vault 标签合并结果
3. 召回输出中个人结果排在前，标记为 "📓 personal"
4. `wiki_retro` 写入当前生效的 vault（项目优先）
5. 用 `WIKI_HOME` 环境变量覆盖个人 wiki 位置

也就是说：你可以为团队文档保留一个项目 wiki，**同时**为自己的笔记保留一个个人 wiki，
召回会一次搜两边。

---

## 快速开始（手动流程）

### 1) 创建新 wiki

```bash
mkdir my-wiki && cd my-wiki && dsh
```

然后 `/wiki-bootstrap "AI Research"`，会生成：

```
.llm-wiki/
├── config.json
├── templates/
├── raw/
├── wiki/
├── meta/
└── WIKI_SCHEMA.md
```

### 2) 采集来源

```
/wiki-capture https://example.com/some-article
/wiki-capture ./papers/context-windows.pdf
/wiki-capture <粘贴的笔记>
```

### 3) 整合来源

1. 采集来源
2. 阅读 `.llm-wiki/wiki/sources/SRC-*.md`
3. 更新该来源页
4. 用 `wiki_search` 搜索受影响的规范页面
5. 用 `wiki_ensure_page` 创建缺失页面
6. 在 concept / entity / synthesis 页面中补上引用
7. 用 `wiki_log_event kind=integrate` 标记整合完成

### 4) 查询 wiki

```
基于这个 wiki，长上下文模型和 RAG 的主要取舍是什么？
```

默认情况下查询模式是**只读**的。要归档一个持久答案，请明确要求：

```
回答这个问题，并把结果作为 analysis 页面归档。
```

---

## Vault 结构

```
my-wiki/
└─ .llm-wiki/
   ├─ config.json               # Vault 配置
   ├─ templates/                 # 页面模板
   ├─ raw/
   │  └─ sources/
   │     └─ SRC-2026-05-11-001/
   │        ├─ manifest.json
   │        ├─ original/           # 原始产物
   │        ├─ extracted.md        # 归一化文本
   │        └─ attachments/
   ├─ wiki/
   │  ├─ sources/                  # 来源页（每个来源说了什么）
   │  ├─ concepts/                 # 概念与反复出现的想法
   │  ├─ entities/                 # 人物、组织、产品、论文、系统
   │  ├─ syntheses/                # 跨来源的论点与张力
   │  └─ analyses/                 # 由查询归档的持久答案
   ├─ meta/
   │  ├─ registry.json             # 自动生成的检索索引
   │  ├─ backlinks.json
   │  ├─ index.md
   │  ├─ events.jsonl              # 只追加事件日志
   │  ├─ log.md
   │  └─ lint-report.md
   └─ WIKI_SCHEMA.md               # 操作手册
```

### 归属模型

| 路径 | 归属 | 规则 |
|------|------|------|
| `.llm-wiki/raw/**` | 插件工具 | 采集后不可变 |
| `.llm-wiki/wiki/**` | 模型 + 用户 | 可编辑的知识页面 |
| `.llm-wiki/meta/registry.json` | 插件 | 生成物 |
| `.llm-wiki/meta/backlinks.json` | 插件 | 生成物 |
| `.llm-wiki/meta/index.md` | 插件 | 生成物 |
| `.llm-wiki/meta/events.jsonl` | 插件 / 工具 | 权威的只追加状态；备份以保证活动连续性 |
| `.llm-wiki/meta/log.md` | 插件 | 由事件生成 |
| `.llm-wiki/meta/lint-report.md` | 插件 | 生成物 |
| `.llm-wiki/WIKI_SCHEMA.md` | 人 + 明确要求 | 操作手册 |

### 活动历史、备份与可移植性

`meta/events.jsonl` 是插件活动记录的权威来源。与 registry、backlinks、index、log、
embedding 不同，它**无法**从 wiki 页面或原始来源包重建。备份或 Git 同步完整 vault 时
请务必保留它。

`meta/log.md` 与 OKF 模式下的 `wiki/log.md` 都是生成视图。`wiki/log.md` 可以随 OKF
bundle 作为可读快照一起流动，但它无法重建或续写原始的 JSONL 流。人工页面编辑是有意
不记录的，因此这只是选定范围的插件活动，而不是完整的修订审计。

文件采集事件会从公开日志投影中省略本机路径。`wiki_log_event` 的调用方仍可控制任意
detail 字段，请勿写入密钥或私有主机路径。

---

## 链接与引用风格

### 内部导航

```markdown
[[concepts/retrieval-augmented-generation]]
[[entities/openai|OpenAI]]
[[syntheses/long-context-vs-rag]]
```

### 事实引用

```markdown
[[sources/SRC-2026-04-04-001|SRC-2026-04-04-001]]
```

稳定的来源页 ID 让溯源在标题变化后依然可靠。

---

## 护栏

插件会**阻止**通过工具调用直接编辑：

- `.llm-wiki/raw/**` —— 不可变的来源产物
- `.llm-wiki/meta/registry.json`
- `.llm-wiki/meta/backlinks.json`
- `.llm-wiki/meta/events.jsonl`
- `.llm-wiki/meta/index.md`
- `.llm-wiki/meta/log.md`
- `.llm-wiki/meta/lint-report.md`

如果模型用普通 `write`/`edit` 工具编辑了 `.llm-wiki/wiki/**`，生成的元数据会在
agent 回合结束时**自动重建**。

---

## 来源包格式

每个采集的来源都存为结构化包：

```
.llm-wiki/raw/sources/SRC-YYYY-MM-DD-NNN/
├─ manifest.json     # 采集元数据（标题、URL、格式、时间戳）
├─ original/         # 原始产物（原样保留）
├─ extracted.md      # 归一化文本（PDF→md、XML→md、JSON→md 等）
└─ attachments/      # 未来的附件下载
```

这样同时保留了**原始产物**和**归一化的可读视图**。

---

## Skill 行为约定

随包的 `llm-wiki` skill 会教模型：

- ❌ 绝不直接编辑原始来源
- ❌ 绝不编辑生成的元数据文件
- ✅ 先采集，再整合
- ✅ 创建新的规范页面前先搜索
- ✅ 用来源页 ID 引用事实
- ✅ 查询模式默认只读
- ✅ 证据混杂时使用 "Tensions / caveats" 与 "Open questions"

---

## 架构

### 四层页面模型

```
.llm-wiki/raw/sources/SRC-*/     # 不可变来源包（插件所有）
.llm-wiki/wiki/                  # 可编辑知识页面（你 + LLM）
.llm-wiki/meta/                  # 持久事件源 + 生成的内部投影
.llm-wiki/                       # 配置与模板
```

完整设计见 [docs/architecture.md](docs/architecture.md)；DSH 移植如何映射到宿主
（bundle、slot、WebUI 界面、合成通道）见 [docs/dsh.md](docs/dsh.md)。

---

## 文档

| 文档 | 内容 |
|------|------|
| [DeepSeek Harness 插件](docs/dsh.md) | **从这里开始**——DSH 安装、设置、侧边栏、语言、移植决策 |
| [架构](docs/architecture.md) | 四层如何运作、归属模型 |
| [命令](docs/commands.md) | 斜杠命令与工具参考 |
| [Obsidian 集成](docs/obsidian.md) | Vault 配置与推荐插件 |
| [配置](docs/configuration.md) | Wiki 模式、主题、环境变量 |
| [API](docs/api.md) | 工具参数参考 |
| [宿主支持](docs/harnesses.md) | 非 DSH 宿主的 MCP 客户端配置 |

---

## 项目状态

DSH 插件目前是 **draft v1**：逻辑在 [`test/dsh/`](test/dsh/) 中有单元测试覆盖，
不需要宿主即可运行；但 [`docs/dsh.md`](docs/dsh.md#draft-status--verify-live-before-merging)
中的宿主交互清单仍需在实机 DeepSeek Harness 上过一遍，才能宣布稳定。

上游 pi 扩展（`extensions/llm-wiki/`）与 MCP 服务器（`mcp/`）仍留在仓库中——MCP 继续
作为跨宿主路径；pi 扩展再保留一个发布周期。

---

## 参与贡献

开发环境、测试模式与 PR 流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 致谢与许可

由 [zosmaai](https://github.com/zosmaai) 作为
[`pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki) 构建；本分支维护原生
DeepSeek Harness 移植。MIT 许可——见 [LICENSE](LICENSE)。

## 贡献者

感谢上游所有贡献者！此列表由
[`.github/workflows/contributors.yml`](.github/workflows/contributors.yml) 自动重新生成。

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
  <sub>DSH 移植维护于 <a href="https://github.com/ModerRAS/dsh-llm-wiki">ModerRAS/dsh-llm-wiki</a> · 上游 <a href="https://github.com/zosmaai/pi-llm-wiki">zosmaai/pi-llm-wiki</a> · <a href="https://github.com/ModerRAS/dsh-llm-wiki/issues">Issues</a></sub>
</div>
