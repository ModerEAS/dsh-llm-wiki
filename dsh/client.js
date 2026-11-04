/**
 * LLM Wiki settings section — DSH WebUI client bundle (hand-written, no build step).
 *
 * Loaded by the browser module table as the `./client` export of the
 * `dsh-llm-wiki` bundle package (see dsh/package.json nested `dsh.client` +
 * `exports["./client"]`). Factory form only: registering work happens in
 * `apply()`, never at module top level.
 *
 * - React comes from the browser module table (`require('react')`).
 * - No Harness Client packages are imported (forbidden for plugins).
 * - Styling uses `var(--dsw-alias-*)` theme tokens + plain elements.
 * - Field keys mirror the Host `Config` schema (src/dsh/settings-ui.ts);
 *   namespace `llm-wiki` is the Host Loader row id.
 * - The sidebar status panel groups `/wiki/status.json` into cards. Its
 *   panellist glyph is an inline 1px stroke icon (same weight as the host
 *   clock / plugin glyphs), also used in the panel header.
 *
 * Locale is the DeepSeek Harness split:
 * - Plugin-list title/description are `meta.*` in `locale/{en,zh}.json`.
 *   `readPluginMeta` reads those fields and ignores every other key.
 * - The rest of those JSON files mirrors the screen dictionary for the host
 *   bundle. The browser module table cannot require them, so the same keys
 *   are inlined in `STRINGS` and registered with `ctx.locale`.
 * - Slot entries set `locale: "llm-wiki"` and render with the framework `t`
 *   seat. Do not pass `t` from `inject()` — that spread replaces the seat.
 *
 * DRAFT: assembled from the researched configForms/slots contract; NOT yet
 * verified against a live Harness. If `configForms` or the `settings.section`
 * slot is absent, apply() no-ops and the plugin row config keeps the schema
 * defaults (Settings → LLM Wiki is the primary surface, including
 * trajectories; /wiki-model stays as the file-based model shortcut).
 */
window.__ModuleLoader__.load({
  id: "dsh-llm-wiki",
  factory(require) {
    const React = require("react");
    const h = React.createElement;
    const NS = "llm-wiki";
    const ENTRY = "llm-wiki";

    // UI_DICTIONARY_START
    // Inline because the browser module table cannot require locale JSON.
    // `dsh/locale/*.json` mirrors these strings; keep the two in lockstep.
    const STRINGS = {
      en: {
        "meta.title": "LLM Wiki",
        "meta.description":
          "Self-maintaining, Obsidian-compatible knowledge base: capture, ingest, recall, and trajectory memory.",
        title: "LLM Wiki",
        subtitle: "Knowledge-base behavior for this profile.",
        save: "Save",
        discard: "Discard",
        close: "Close",
        unavailable: "Settings unavailable",
        "panel.subtitle": "Vault status, capabilities, and background jobs.",
        "panel.refresh": "Refresh",
        "panel.loading": "Loading wiki status…",
        "panel.noVault": "No wiki vault here yet.",
        "panel.noVaultHint": "Run /wiki-bootstrap <topic> in this project.",
        "panel.settingsHint": "Edit in Settings → LLM Wiki",
        "panel.section.settings": "Settings",
        "panel.section.vault": "Vault",
        "panel.section.capabilities": "Capabilities",
        "panel.section.activity": "Activity",
        "panel.vaults": "Vaults",
        "panel.field.autoRecall": "Automatic recall",
        "panel.field.notices": "UI notices",
        "panel.field.trajectories": "Trajectories",
        "panel.field.model": "Synthesis model",
        "panel.field.runtimeModel": "Model",
        "panel.field.topic": "Topic",
        "panel.field.mode": "Mode",
        "panel.field.pages": "Pages",
        "panel.field.health": "Health",
        "panel.field.orphans": "Orphans",
        "panel.field.gaps": "Gaps",
        "panel.field.updated": "Updated",
        "panel.field.format": "Format",
        "panel.field.qmd": "QMD",
        "panel.field.documents": "Documents",
        "panel.field.embeddings": "Embeddings pending",
        "panel.field.embeddingsFlag": "Embeddings",
        "panel.field.semantic": "Semantic",
        "panel.field.jobs": "Jobs",
        "panel.field.cwd": "Cwd",
        "panel.field.recall": "Recall",
        "panel.field.tools": "Tools",
        "panel.field.lastRecall": "Last recall",
        "panel.field.background": "Background",
        "panel.field.rawQueue": "Raw queue",
        "panel.field.zeroBacklinks": "Zero backlinks",
        "panel.field.stale": "Stale 30d+",
        "panel.field.notice": "Notice",
        "panel.field.activity7d": "Last 7 days",
        "panel.field.package": "QMD package",
        "panel.field.indexed": "Indexed",
        "panel.badge.on": "On",
        "panel.badge.off": "Off",
        "panel.badge.good": "Good",
        "panel.badge.warning": "Warning",
        "panel.badge.empty": "Empty",
        "panel.badge.unknown": "Unknown",
        "panel.badge.available": "Available",
        "panel.badge.missing": "Missing",
        "panel.never": "Never",
        "panel.sessionModel": "(session model)",
        "panel.unknownTopic": "Unknown",
        "panel.pagesSuffix": "pages",
        "panel.canonical": "canonical",
        "panel.evidence": "evidence",
        "panel.phase.running": "Running",
        "panel.phase.done": "Done",
        "panel.phase.failed": "Failed",
        "panel.qmd.ready": "Ready",
        "panel.qmd.stale": "Stale",
        "panel.qmd.recovering": "Recovering",
        "panel.qmd.missing": "Missing",
        "panel.qmd.error": "Error",
        "panel.mode.personal": "personal",
        "panel.mode.company": "company",
        overridden: " · overridden",
        "field.autoRecall.label": "Automatic recall",
        "field.autoRecall.hint": "Inject relevant wiki pages before each turn.",
        "field.notices.label": "UI notices",
        "field.notices.hint": "Show recall hits, reminders, and background reports.",
        "field.trajectories.label": "Agent trajectories",
        "field.trajectories.hint": "Opt-in working memory: capture, distill, and recall skills.",
        "field.proactiveCapture.label": "Proactive capture",
        "field.proactiveCapture.hint":
          "Tell the agent to recall before work and record what it learns.",
        "field.observationReminder.label": "Observation reminder",
        "field.observationReminder.hint":
          "Nudge the agent to save insights after a few quiet turns.",
        "field.reminderTurns.label": "Reminder interval",
        "field.reminderTurns.hint": "Turns between reminders (default 5, minimum 1).",
        "field.taskModel.label": "Synthesis model",
        "field.taskModel.hint": "'provider/id'. Empty = session model.",
        "field.semanticWeight.label": "Semantic weight",
        "field.semanticWeight.hint": "0 = pure lexical recall.",
        "field.recallLinksThreshold.label": "Links-first threshold",
        "field.recallLinksThreshold.hint": "Page count above which recall returns links.",
        "field.ambientPersonalVault.label": "Ambient personal vault",
        "field.ambientPersonalVault.hint": "Recall from the personal vault outside projects.",
        "notice.layoutFixed": "Personal wiki layout fixed: flattened {count} entries.",
        "notice.created": "Wiki created (topic pending).",
        "notice.blocked": "Wiki setup blocked (bootstrap).",
        "dock.backgroundStarted": "background {label} started",
        "dock.backgroundFailed": "background {label} failed",
        "dock.recalled": "recalled {count} page(s) for this task",
      },
      zh: {
        "meta.title": "LLM Wiki",
        "meta.description": "自维护、兼容 Obsidian 的知识库：采集、入库、召回与轨迹记忆。",
        title: "LLM Wiki",
        subtitle: "此配置文件的知识库行为。",
        save: "保存",
        discard: "放弃",
        close: "关闭",
        unavailable: "设置不可用",
        "panel.subtitle": "知识库状态、能力自检与后台任务。",
        "panel.refresh": "刷新",
        "panel.loading": "正在加载知识库状态……",
        "panel.noVault": "此处还没有知识库。",
        "panel.noVaultHint": "在此项目运行 /wiki-bootstrap <topic>。",
        "panel.settingsHint": "去“设置 → LLM Wiki”修改",
        "panel.section.settings": "设置",
        "panel.section.vault": "知识库",
        "panel.section.capabilities": "能力",
        "panel.section.activity": "运行",
        "panel.vaults": "知识库切换",
        "panel.field.autoRecall": "自动召回",
        "panel.field.notices": "界面通知",
        "panel.field.trajectories": "轨迹记忆",
        "panel.field.model": "综合模型",
        "panel.field.runtimeModel": "模型",
        "panel.field.topic": "主题",
        "panel.field.mode": "模式",
        "panel.field.pages": "页面",
        "panel.field.health": "健康",
        "panel.field.orphans": "孤立页",
        "panel.field.gaps": "缺口",
        "panel.field.updated": "最近更新",
        "panel.field.format": "格式",
        "panel.field.qmd": "QMD",
        "panel.field.documents": "文档",
        "panel.field.embeddings": "待嵌入",
        "panel.field.embeddingsFlag": "嵌入",
        "panel.field.semantic": "语义",
        "panel.field.jobs": "任务服务",
        "panel.field.cwd": "工作目录",
        "panel.field.recall": "召回",
        "panel.field.tools": "工具",
        "panel.field.lastRecall": "最近召回",
        "panel.field.background": "后台",
        "panel.field.rawQueue": "原始队列",
        "panel.field.zeroBacklinks": "零反向链接",
        "panel.field.stale": "超过 30 天",
        "panel.field.notice": "通知",
        "panel.field.activity7d": "近 7 日",
        "panel.field.package": "QMD 版本",
        "panel.field.indexed": "索引时间",
        "panel.badge.on": "开启",
        "panel.badge.off": "关闭",
        "panel.badge.good": "良好",
        "panel.badge.warning": "警告",
        "panel.badge.empty": "空",
        "panel.badge.unknown": "未知",
        "panel.badge.available": "可用",
        "panel.badge.missing": "缺失",
        "panel.never": "从未",
        "panel.sessionModel": "（会话模型）",
        "panel.unknownTopic": "未知",
        "panel.pagesSuffix": "页",
        "panel.canonical": "规范",
        "panel.evidence": "证据",
        "panel.phase.running": "进行中",
        "panel.phase.done": "已完成",
        "panel.phase.failed": "失败",
        "panel.qmd.ready": "就绪",
        "panel.qmd.stale": "过期",
        "panel.qmd.recovering": "恢复中",
        "panel.qmd.missing": "缺失",
        "panel.qmd.error": "错误",
        "panel.mode.personal": "个人",
        "panel.mode.company": "公司",
        overridden: " · 已修改",
        "field.autoRecall.label": "自动召回",
        "field.autoRecall.hint": "每轮开始前注入相关知识库页面。",
        "field.notices.label": "界面提示",
        "field.notices.hint": "显示召回命中、提醒和后台报告。",
        "field.trajectories.label": "智能体轨迹",
        "field.trajectories.hint": "可选的工作记忆：采集、提炼与召回技能。",
        "field.proactiveCapture.label": "主动捕获",
        "field.proactiveCapture.hint": "让模型先召回、再做，并记录学到的内容。",
        "field.observationReminder.label": "记录提醒",
        "field.observationReminder.hint": "连续若干轮没有写入知识库时，提醒模型记录。",
        "field.reminderTurns.label": "提醒间隔",
        "field.reminderTurns.hint": "每多少轮提醒一次（默认 5，最小 1）。",
        "field.taskModel.label": "合成模型",
        "field.taskModel.hint": "“provider/id”。留空则使用当前会话模型。",
        "field.semanticWeight.label": "语义权重",
        "field.semanticWeight.hint": "0 表示纯词法召回。",
        "field.recallLinksThreshold.label": "链接优先阈值",
        "field.recallLinksThreshold.hint": "页面数超过该值后，召回只返回链接。",
        "field.ambientPersonalVault.label": "个人库常驻",
        "field.ambientPersonalVault.hint": "在项目之外也从个人知识库召回。",
        "notice.layoutFixed": "个人知识库目录已展平，整理了 {count} 项。",
        "notice.created": "知识库已创建（主题待定）。",
        "notice.blocked": "知识库初始化被阻止。",
        "dock.backgroundStarted": "后台 {label} 已开始",
        "dock.backgroundFailed": "后台 {label} 失败",
        "dock.recalled": "已为本轮任务召回 {count} 页",
      },
    };
    // UI_DICTIONARY_END

    const PANEL_ID = "wiki-status";
    // Open book, 16px box, 1px round stroke — same weight as
    // IconClockOutlineRegular / IconPluginPinwheelOutlineRegular.
    // Open book on the host 16px / 1px stroke grid (clock, plugin pinwheel).
    const WIKI_MARK_PATHS = [
      "M1.33 2h4a2.67 2.67 0 0 1 2.67 2.67v9.33a2 2 0 0 0-2-2H1.33z",
      "M14.67 2h-4a2.67 2.67 0 0 0-2.67 2.67v9.33a2 2 0 0 1 2-2h4.67z",
    ];

    const WIKI_PANEL_CSS = [
      // The panel root is the only child of the host's `.mainPanel` flex column
      // (the `main` slot anchor is `display: contents`). Without `flex: 1` +
      // `min-height: 0` it sizes to its content and overflows the center
      // column, which clips it (`overflow: hidden`) — so nothing can scroll.
      ".lwiki-page {",
      "  box-sizing: border-box;",
      "  width: 100%;",
      "  flex: 1;",
      "  min-height: 0;",
      "  overflow-x: hidden;",
      "  overflow-y: auto;",
      "  padding: 28px clamp(20px, 4vw, 48px) 48px;",
      "  color: var(--dsw-alias-label-primary, inherit);",
      "  font-size: 14px;",
      "  line-height: 22px;",
      "}",
      "[data-platform='darwin'] .lwiki-page {",
      "  padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px));",
      "}",
      ".lwiki-column {",
      "  max-width: 880px;",
      "  margin: 0 auto;",
      "  display: grid;",
      "  gap: 16px;",
      "}",
      ".lwiki-head {",
      "  display: flex;",
      "  align-items: flex-start;",
      "  justify-content: space-between;",
      "  gap: 16px;",
      "}",
      ".lwiki-titleblock {",
      "  display: flex;",
      "  gap: 10px;",
      "  min-width: 0;",
      "}",
      ".lwiki-mark {",
      "  display: flex;",
      "  flex: none;",
      "  margin-top: 4px;",
      "  color: var(--dsw-alias-label-primary, inherit);",
      "}",
      ".lwiki-titleblock h1 {",
      "  margin: 0;",
      "  font-size: 20px;",
      "  line-height: 28px;",
      "  font-weight: 500;",
      "}",
      ".lwiki-titleblock p {",
      "  margin: 2px 0 0;",
      "  font-size: 13px;",
      "  line-height: 20px;",
      "  color: var(--dsw-alias-label-secondary, rgb(97, 102, 107));",
      "}",
      ".lwiki-card {",
      "  border-radius: var(--dsw-radius-xl, 20px);",
      "  border: 0.5px solid var(",
      "    --dsw-alias-settings-card-stroke,",
      "    var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.16))",
      "  );",
      "  background: var(",
      "    --dsw-alias-settings-card-fill,",
      "    var(--dsw-alias-bg-layer-2, transparent)",
      "  );",
      "  padding: 14px 16px 12px;",
      "}",
      ".lwiki-card > h3 {",
      "  margin: 0 0 4px;",
      "  font-size: 13px;",
      "  line-height: 20px;",
      "  font-weight: 500;",
      "}",
      ".lwiki-fields { display: grid; }",
      ".lwiki-field {",
      "  display: flex;",
      "  align-items: baseline;",
      "  justify-content: space-between;",
      "  gap: 16px;",
      "  min-height: 32px;",
      "  padding: 7px 0;",
      "  border-top: 0.5px solid var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.16));",
      "}",
      ".lwiki-field:first-child { border-top: 0; padding-top: 2px; }",
      ".lwiki-field-label {",
      "  flex: none;",
      "  color: var(--dsw-alias-label-secondary, rgb(97, 102, 107));",
      "  font-size: 13px;",
      "  line-height: 20px;",
      "}",
      ".lwiki-field-value {",
      "  min-width: 0;",
      "  max-width: 70%;",
      "  text-align: right;",
      "  font-size: 13px;",
      "  line-height: 20px;",
      "  color: var(--dsw-alias-label-primary, inherit);",
      "}",
      ".lwiki-hint {",
      "  margin: 4px 0 0;",
      "  color: var(--dsw-alias-label-tertiary, rgb(129, 133, 140));",
      "  font-size: 12px;",
      "  line-height: 18px;",
      "}",
      ".lwiki-kicker {",
      "  font-size: 12px;",
      "  line-height: 18px;",
      "  color: var(--dsw-alias-label-secondary, rgb(97, 102, 107));",
      "}",
      ".lwiki-topic {",
      "  margin: 1px 0 0;",
      "  font-size: 18px;",
      "  line-height: 26px;",
      "  font-weight: 500;",
      "  overflow-wrap: anywhere;",
      "}",
      ".lwiki-vaulthead {",
      "  display: flex;",
      "  align-items: flex-start;",
      "  justify-content: space-between;",
      "  gap: 12px;",
      "}",
      ".lwiki-health {",
      "  display: grid;",
      "  justify-items: end;",
      "  gap: 4px;",
      "  flex: none;",
      "}",
      ".lwiki-meta {",
      "  display: flex;",
      "  flex-wrap: wrap;",
      "  gap: 8px 14px;",
      "  margin-top: 6px;",
      "  font-size: 13px;",
      "  line-height: 20px;",
      "}",
      ".lwiki-pair { display: inline-flex; gap: 6px; align-items: baseline; }",
      ".lwiki-stats {",
      "  display: grid;",
      "  grid-template-columns: repeat(4, minmax(0, 1fr));",
      "  gap: 12px 16px;",
      "  margin: 12px 0 2px;",
      "  padding-top: 12px;",
      "  border-top: 0.5px solid var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.16));",
      "}",
      "@media (max-width: 560px) {",
      "  .lwiki-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }",
      "}",
      ".lwiki-stat-label {",
      "  font-size: 12px;",
      "  line-height: 18px;",
      "  color: var(--dsw-alias-label-tertiary, rgb(129, 133, 140));",
      "}",
      ".lwiki-stat-value {",
      "  margin-top: 2px;",
      "  font-size: 18px;",
      "  line-height: 26px;",
      "  font-weight: 500;",
      "  font-variant-numeric: tabular-nums;",
      "}",
      ".lwiki-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }",
      ".lwiki-sub {",
      "  display: block;",
      "  margin-top: 2px;",
      "  font-size: 11px;",
      "  line-height: 16px;",
      "  color: var(--dsw-alias-label-tertiary, rgb(129, 133, 140));",
      "  font-variant-numeric: tabular-nums;",
      "}",
      ".lwiki-path {",
      "  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);",
      "  font-size: 12px;",
      "  line-height: 18px;",
      "  word-break: break-all;",
      "}",
      ".lwiki-note {",
      "  margin-top: 8px;",
      "  padding: 8px 10px;",
      "  border-radius: var(--dsw-radius-md, 12px);",
      "  background: color-mix(",
      "    in srgb,",
      "    var(--dsw-alias-state-warn-primary, rgb(245, 158, 11)) 12%,",
      "    transparent",
      "  );",
      "  color: var(--dsw-alias-label-primary, inherit);",
      "  font-size: 12px;",
      "  line-height: 18px;",
      "  overflow-wrap: anywhere;",
      "}",
      ".lwiki-jobs { display: grid; margin-top: 4px; }",
      ".lwiki-job {",
      "  display: flex;",
      "  align-items: center;",
      "  justify-content: space-between;",
      "  gap: 12px;",
      "  padding: 6px 0;",
      "  border-top: 0.5px solid var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.16));",
      "  font-size: 12px;",
      "  line-height: 18px;",
      "}",
      ".lwiki-job > span:first-child {",
      "  min-width: 0;",
      "  overflow: hidden;",
      "  text-overflow: ellipsis;",
      "  white-space: nowrap;",
      "  color: var(--dsw-alias-label-secondary, rgb(97, 102, 107));",
      "}",
      ".lwiki-diag {",
      "  margin: 8px 0 0;",
      "  padding: 0;",
      "  list-style: none;",
      "  display: grid;",
      "  gap: 6px;",
      "}",
      ".lwiki-diag li {",
      "  font-size: 12px;",
      "  line-height: 18px;",
      "  color: var(--dsw-alias-state-error-primary, rgb(236, 19, 19));",
      "  overflow-wrap: anywhere;",
      "}",
      ".lwiki-vaults {",
      "  display: flex;",
      "  flex-wrap: wrap;",
      "  align-items: center;",
      "  gap: 8px;",
      "}",
      ".lwiki-badge {",
      "  display: inline-flex;",
      "  align-items: center;",
      "  border-radius: 999px;",
      "  corner-shape: round;",
      "  padding: 1px 8px;",
      "  font-size: 11px;",
      "  line-height: 17px;",
      "  font-weight: 500;",
      "  white-space: nowrap;",
      "  vertical-align: baseline;",
      "}",
      '.lwiki-badge[data-tone="success"] {',
      "  background: color-mix(",
      "    in srgb,",
      "    var(--dsw-alias-state-success-primary, rgb(34, 197, 94)) 10%,",
      "    transparent",
      "  );",
      "  color: var(--dsw-alias-state-success-primary, rgb(34, 197, 94));",
      "}",
      '.lwiki-badge[data-tone="info"] {',
      "  background: color-mix(",
      "    in srgb,",
      "    var(--dsw-alias-state-business-primary, rgb(65, 118, 230)) 10%,",
      "    transparent",
      "  );",
      "  color: var(--dsw-alias-state-business-primary, rgb(65, 118, 230));",
      "}",
      '.lwiki-badge[data-tone="warning"] {',
      "  background: color-mix(",
      "    in srgb,",
      "    var(--dsw-alias-state-warn-primary, rgb(245, 158, 11)) 12%,",
      "    transparent",
      "  );",
      "  color: var(--dsw-alias-state-warn-primary, rgb(245, 158, 11));",
      "}",
      '.lwiki-badge[data-tone="danger"] {',
      "  background: color-mix(",
      "    in srgb,",
      "    var(--dsw-alias-state-error-primary, rgb(236, 19, 19)) 10%,",
      "    transparent",
      "  );",
      "  color: var(--dsw-alias-state-error-primary, rgb(236, 19, 19));",
      "}",
      '.lwiki-badge[data-tone="neutral"] {',
      "  background: var(--dsw-alias-bg-module-platform, rgb(245, 246, 247));",
      "  color: var(--dsw-alias-label-secondary, rgb(97, 102, 107));",
      "}",
      '.lwiki-badge[data-tone="quiet"] {',
      "  color: var(--dsw-alias-label-tertiary, rgb(129, 133, 140));",
      "  box-shadow: inset 0 0 0 0.5px var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.16));",
      "}",
      ".lwiki-btn {",
      "  box-sizing: border-box;",
      "  display: inline-flex;",
      "  align-items: center;",
      "  justify-content: center;",
      "  flex: none;",
      "  height: 28px;",
      "  padding: 0 10px;",
      "  border: 0.5px solid transparent;",
      "  border-radius: var(--dsw-radius-sm, 8px);",
      "  background: transparent;",
      "  box-shadow: inset 0 0 0 0.5px var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.12));",
      "  color: var(--dsw-alias-label-primary, inherit);",
      "  font: inherit;",
      "  font-size: 12px;",
      "  line-height: 18px;",
      "  cursor: pointer;",
      "}",
      ".lwiki-btn:disabled { cursor: not-allowed; opacity: 0.45; }",
      "@media (hover: hover) {",
      "  .lwiki-btn:hover:not(:disabled) {",
      "    background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));",
      "  }",
      "}",
      ".lwiki-btn:focus-visible {",
      "  outline: 2px solid var(",
      "    --dsw-focus-ring-color,",
      "    var(--dsw-alias-state-business-primary, rgb(65, 118, 230))",
      "  );",
      "  outline-offset: 2px;",
      "}",
      ".lwiki-pill {",
      "  box-sizing: border-box;",
      "  max-width: 220px;",
      "  height: 24px;",
      "  padding: 0 8px;",
      "  border: none;",
      "  border-radius: 999px;",
      "  corner-shape: round;",
      "  background: transparent;",
      "  box-shadow: inset 0 0 0 0.5px var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.16));",
      "  color: var(--dsw-alias-label-secondary, inherit);",
      "  font: inherit;",
      "  font-size: 12px;",
      "  line-height: 18px;",
      "  cursor: pointer;",
      "  overflow: hidden;",
      "  text-overflow: ellipsis;",
      "  white-space: nowrap;",
      "}",
      ".lwiki-pill.is-current,",
      ".lwiki-pill:disabled {",
      "  cursor: default;",
      "  opacity: 1;",
      "  color: var(--dsw-alias-label-primary, inherit);",
      "  background: var(--dsw-alias-button-ghost-active-fill, rgb(235, 238, 242));",
      "  box-shadow: inset 0 0 0 1px var(",
      "    --dsw-alias-button-ghost-active-border,",
      "    rgb(151, 157, 166)",
      "  );",
      "}",
      "@media (hover: hover) {",
      "  .lwiki-pill:hover:not(:disabled) {",
      "    background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));",
      "  }",
      "}",
      ".lwiki-pill:focus-visible {",
      "  outline: 2px solid var(",
      "    --dsw-focus-ring-color,",
      "    var(--dsw-alias-state-business-primary, rgb(65, 118, 230))",
      "  );",
      "  outline-offset: 2px;",
      "}",
    ].join("\n");

    const FIELDS = [
      {
        key: "autoRecall",
        labelKey: "field.autoRecall.label",
        hintKey: "field.autoRecall.hint",
        type: "boolean",
      },
      {
        key: "notices",
        labelKey: "field.notices.label",
        hintKey: "field.notices.hint",
        type: "boolean",
      },
      {
        key: "trajectories",
        labelKey: "field.trajectories.label",
        hintKey: "field.trajectories.hint",
        type: "boolean",
      },
      {
        key: "proactiveCapture",
        labelKey: "field.proactiveCapture.label",
        hintKey: "field.proactiveCapture.hint",
        type: "boolean",
      },
      {
        key: "observationReminder",
        labelKey: "field.observationReminder.label",
        hintKey: "field.observationReminder.hint",
        type: "boolean",
      },
      {
        key: "reminderTurns",
        labelKey: "field.reminderTurns.label",
        hintKey: "field.reminderTurns.hint",
        type: "number",
      },
      {
        key: "taskModel",
        labelKey: "field.taskModel.label",
        hintKey: "field.taskModel.hint",
        type: "string",
      },
      {
        key: "semanticWeight",
        labelKey: "field.semanticWeight.label",
        hintKey: "field.semanticWeight.hint",
        type: "number",
      },
      {
        key: "recallLinksThreshold",
        labelKey: "field.recallLinksThreshold.label",
        hintKey: "field.recallLinksThreshold.hint",
        type: "number",
      },
      {
        key: "ambientPersonalVault",
        labelKey: "field.ambientPersonalVault.label",
        hintKey: "field.ambientPersonalVault.hint",
        type: "boolean",
      },
    ];

    function fill(template, params) {
      if (!params || typeof params !== "object") return template;
      return template.replace(/\{(\w+)\}/g, (match, name) =>
        Object.hasOwn(params, name) ? String(params[name]) : match,
      );
    }

    // `fallback` is the English sentence used when the catalog misses the key
    // (the status panel passes one so a `t` that echoes keys still renders).
    // A params object may be the third argument, or the fourth when a fallback
    // string is present. `{name}` is filled here if `t` returns the template.
    function tr(t, key, fallback, params) {
      const vars = fallback && typeof fallback === "object" ? fallback : params;
      const fallbackText = typeof fallback === "string" ? fallback : STRINGS.en[key] || key;
      let template = fallbackText;
      if (typeof t === "function") {
        try {
          const value = vars ? t(key, vars) : t(key);
          if (typeof value === "string" && value && value !== key) template = value;
        } catch (_) {
          /* missing catalog key — use the English fallback */
        }
      }
      return fill(template, vars);
    }

    function useForm(scope) {
      return React.useSyncExternalStore(
        (cb) => scope.subscribe(cb),
        () => scope.getSnapshot(),
      );
    }

    function useStatusJson(url) {
      const [state, setState] = React.useState({ loading: true, data: null, error: null });
      const request = React.useRef(0);
      const refresh = React.useCallback(() => {
        const id = request.current + 1;
        request.current = id;
        setState((current) => ({ ...current, loading: true, error: null }));
        fetch(url)
          .then((response) => response.json())
          .then((data) => {
            if (request.current === id) setState({ loading: false, data, error: null });
          })
          .catch((err) => {
            if (request.current === id) {
              setState({ loading: false, data: null, error: String(err) });
            }
          });
      }, [url]);
      React.useEffect(() => {
        refresh();
      }, [refresh]);
      return { ...state, refresh };
    }

    function Badge(props) {
      return h(
        "span",
        {
          className: "lwiki-badge",
          "data-tone": props.tone || "neutral",
          title: props.title,
        },
        props.children,
      );
    }

    function onOffBadge(on, t) {
      return h(
        Badge,
        { tone: on ? "success" : "quiet" },
        on ? tr(t, "panel.badge.on", "On") : tr(t, "panel.badge.off", "Off"),
      );
    }

    function Field(props) {
      return h(
        "div",
        { className: "lwiki-field" },
        h("span", { className: "lwiki-field-label" }, props.label),
        h("span", { className: "lwiki-field-value", title: props.title }, props.value),
      );
    }

    function Fields(props) {
      const rows = (Array.isArray(props.rows) ? props.rows : []).filter(Boolean);
      return h(
        "div",
        { className: "lwiki-fields" },
        ...rows.map((row) =>
          h(Field, { key: row.key, label: row.label, value: row.value, title: row.title }),
        ),
      );
    }

    function Card(props) {
      return h(
        "section",
        { className: "lwiki-card" },
        props.title ? h("h3", null, props.title) : null,
        props.children,
      );
    }

    function shown(value, fallback) {
      if (value === null || value === undefined || value === "") return fallback;
      return String(value);
    }

    function count(value, fallback) {
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
      return shown(value, fallback);
    }

    function formatWhen(value, neverLabel) {
      if (value === null || value === undefined || value === "") return neverLabel;
      const raw = String(value);
      const parsed = Date.parse(raw);
      if (Number.isNaN(parsed)) return raw;
      const date = new Date(parsed);
      const pad = (n) => String(n).padStart(2, "0");
      const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function healthPresentation(raw, t) {
      const text = String(raw || "");
      const lower = text.toLowerCase();
      if (lower.includes("empty") || text.includes("🔴")) {
        return { tone: "danger", label: tr(t, "panel.badge.empty", "Empty") };
      }
      if (lower.includes("warning") || text.includes("⚠")) {
        return { tone: "warning", label: tr(t, "panel.badge.warning", "Warning") };
      }
      if (lower.includes("good") || text.includes("✅")) {
        return { tone: "success", label: tr(t, "panel.badge.good", "Good") };
      }
      return { tone: "neutral", label: text || "—" };
    }

    function qmdTone(state) {
      if (state === "ready") return "success";
      if (state === "stale" || state === "recovering") return "warning";
      if (state === "error" || state === "missing") return "danger";
      return "neutral";
    }

    function qmdLabel(state, t) {
      const known = {
        ready: ["panel.qmd.ready", "Ready"],
        stale: ["panel.qmd.stale", "Stale"],
        recovering: ["panel.qmd.recovering", "Recovering"],
        missing: ["panel.qmd.missing", "Missing"],
        error: ["panel.qmd.error", "Error"],
      };
      const entry = known[state];
      if (!entry) return shown(state, tr(t, "panel.badge.unknown", "Unknown"));
      return tr(t, entry[0], entry[1]);
    }

    function jobsTone(jobs) {
      if (jobs === "available") return "success";
      if (jobs === "missing") return "danger";
      return "neutral";
    }

    function jobsLabel(jobs, t) {
      if (jobs === "available") return tr(t, "panel.badge.available", "Available");
      if (jobs === "missing") return tr(t, "panel.badge.missing", "Missing");
      if (jobs === "unknown" || jobs == null || jobs === "") {
        return tr(t, "panel.badge.unknown", "Unknown");
      }
      return String(jobs);
    }

    function switchBadge(value, t) {
      if (value === "on" || value === true) return onOffBadge(true, t);
      if (value === "off" || value === false) return onOffBadge(false, t);
      return h(Badge, { tone: "neutral" }, shown(value, tr(t, "panel.badge.unknown", "Unknown")));
    }

    function phaseTone(phase) {
      if (phase === "running") return "info";
      if (phase === "done") return "success";
      if (phase === "failed") return "danger";
      return "neutral";
    }

    function phaseLabel(phase, t) {
      if (phase === "running") return tr(t, "panel.phase.running", "Running");
      if (phase === "done") return tr(t, "panel.phase.done", "Done");
      if (phase === "failed") return tr(t, "panel.phase.failed", "Failed");
      return phase ? String(phase) : tr(t, "panel.badge.unknown", "Unknown");
    }

    function issueList(items) {
      if (!Array.isArray(items) || items.length === 0) return null;
      return h(
        "ul",
        { className: "lwiki-diag" },
        ...items.map((item, index) => {
          const code = item?.code ? String(item.code) : "";
          const message = item?.message ? String(item.message) : "";
          const text = code && message ? `${code}: ${message}` : code || message;
          return h("li", { key: `${code}:${index}` }, text);
        }),
      );
    }

    function typeChips(byType) {
      if (!byType || typeof byType !== "object") return null;
      const entries = Object.entries(byType).filter((entry) => typeof entry[1] === "number");
      if (entries.length === 0) return null;
      entries.sort((a, b) => a[0].localeCompare(b[0]));
      return h(
        "div",
        { className: "lwiki-chips" },
        ...entries.map(([name, n]) => h(Badge, { key: name, tone: "neutral" }, `${name} ${n}`)),
      );
    }

    function kindSummary(byKind) {
      if (!byKind || typeof byKind !== "object") return "";
      const parts = Object.entries(byKind).filter(
        (entry) => typeof entry[1] === "number" && entry[1] > 0,
      );
      parts.sort((a, b) => a[0].localeCompare(b[0]));
      return parts.map((entry) => `${entry[0]} ${entry[1]}`).join(" · ");
    }

    function WikiMark(props) {
      const size = props && typeof props.size === "number" ? props.size : 16;
      return h(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 16 16",
          fill: "none",
          xmlns: "http://www.w3.org/2000/svg",
          stroke: "currentColor",
          strokeWidth: 1,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": true,
          focusable: "false",
          "data-icon": "llm-wiki",
          style: { display: "block", flex: "none" },
        },
        ...WIKI_MARK_PATHS.map((d) => h("path", { key: d, d })),
      );
    }

    // Direct SVG child: an inline wrapper becomes a line box and lifts the
    // glyph above the sidebar label (same rule as the host clock icon).
    function WikiStatusIcon(props) {
      const size = props && typeof props.size === "number" ? props.size : 16;
      return h(WikiMark, { size });
    }

    function SettingsSummary(props) {
      const { scope, t } = props;
      const snap = useForm(scope);
      const value = snap?.value || {};
      const model = String(value.taskModel || "").trim();
      return h(
        "div",
        null,
        h(Fields, {
          rows: [
            {
              key: "autoRecall",
              label: tr(t, "panel.field.autoRecall", "Automatic recall"),
              value: onOffBadge(value.autoRecall !== false, t),
            },
            {
              key: "notices",
              label: tr(t, "panel.field.notices", "UI notices"),
              value: onOffBadge(value.notices !== false, t),
            },
            {
              key: "trajectories",
              label: tr(t, "panel.field.trajectories", "Trajectories"),
              value: onOffBadge(value.trajectories === true, t),
            },
            {
              key: "model",
              label: tr(t, "panel.field.model", "Synthesis model"),
              value: model || tr(t, "panel.sessionModel", "(session model)"),
            },
          ],
        }),
        h(
          "p",
          { className: "lwiki-hint" },
          tr(t, "panel.settingsHint", "Edit in Settings → LLM Wiki"),
        ),
      );
    }

    function Stat(props) {
      return h(
        "div",
        null,
        h("div", { className: "lwiki-stat-label" }, props.label),
        h("div", { className: "lwiki-stat-value" }, props.value),
      );
    }

    function VaultCard(props) {
      const { data, t } = props;
      const st = data.status || {};
      const health = healthPresentation(st.health, t);
      const never = tr(t, "panel.never", "Never");
      const topic = shown(st.topic, tr(t, "panel.unknownTopic", "Unknown"));
      const modeValue = st.mode || "personal";
      const mode =
        modeValue === "personal" || modeValue === "company"
          ? tr(t, `panel.mode.${modeValue}`, modeValue)
          : shown(modeValue, tr(t, "panel.mode.personal", "personal"));
      const format = st.knowledgeFormat ? String(st.knowledgeFormat) : "";
      return h(
        Card,
        { title: tr(t, "panel.section.vault", "Vault") },
        h(
          "div",
          { className: "lwiki-vaulthead" },
          h(
            "div",
            { style: { minWidth: 0 } },
            h("div", { className: "lwiki-kicker" }, tr(t, "panel.field.topic", "Topic")),
            h("div", { className: "lwiki-topic" }, topic),
          ),
          h(
            "div",
            { className: "lwiki-health" },
            h("span", { className: "lwiki-kicker" }, tr(t, "panel.field.health", "Health")),
            h(
              Badge,
              { tone: health.tone, title: st.health ? String(st.health) : undefined },
              health.label,
            ),
          ),
        ),
        h(
          "div",
          { className: "lwiki-meta" },
          h(
            "span",
            { className: "lwiki-pair" },
            h("span", { className: "lwiki-kicker" }, tr(t, "panel.field.mode", "Mode")),
            h("span", null, mode),
          ),
          format
            ? h(
                "span",
                { className: "lwiki-pair" },
                h("span", { className: "lwiki-kicker" }, tr(t, "panel.field.format", "Format")),
                h("span", null, format),
              )
            : null,
        ),
        h(
          "div",
          { className: "lwiki-stats" },
          h(Stat, { label: tr(t, "panel.field.pages", "Pages"), value: count(st.totalPages, "0") }),
          h(Stat, {
            label: tr(t, "panel.field.orphans", "Orphans"),
            value: count(st.orphans, "0"),
          }),
          h(Stat, { label: tr(t, "panel.field.gaps", "Gaps"), value: count(st.gaps, "0") }),
          h(Stat, {
            label: tr(t, "panel.field.updated", "Updated"),
            value: formatWhen(st.lastUpdated, never),
          }),
        ),
        typeChips(st.byType),
        issueList(st.blockingDiagnostics),
      );
    }

    function CapabilityCard(props) {
      const { data, t } = props;
      const st = data.status || {};
      const cap = st.capabilities || {};
      const qmd = st.qmd || {};
      const cwd = cap.cwd || data.vaultRoot || "";
      const rows = [
        {
          key: "qmd",
          label: tr(t, "panel.field.qmd", "QMD"),
          value: h(
            Badge,
            { tone: qmdTone(qmd.state), title: qmd.state ? String(qmd.state) : undefined },
            qmdLabel(qmd.state, t),
          ),
        },
        {
          key: "documents",
          label: tr(t, "panel.field.documents", "Documents"),
          value: h(
            "span",
            null,
            count(qmd.totalDocuments, "0"),
            h(
              "span",
              { className: "lwiki-sub" },
              `${count(qmd.canonicalDocuments, "0")} ${tr(t, "panel.canonical", "canonical")} · ${count(qmd.evidenceDocuments, "0")} ${tr(t, "panel.evidence", "evidence")}`,
            ),
          ),
        },
        {
          key: "embeddings",
          label: tr(t, "panel.field.embeddings", "Embeddings pending"),
          value: count(qmd.needsEmbedding, "0"),
        },
      ];
      if (qmd.qmdVersion) {
        rows.push({
          key: "package",
          label: tr(t, "panel.field.package", "QMD package"),
          value: String(qmd.qmdVersion),
        });
      }
      if (qmd.lastIndexedAt) {
        rows.push({
          key: "indexed",
          label: tr(t, "panel.field.indexed", "Indexed"),
          value: formatWhen(qmd.lastIndexedAt, "—"),
        });
      }
      rows.push(
        {
          key: "semantic",
          label: tr(t, "panel.field.semantic", "Semantic"),
          value: switchBadge(cap.semantic, t),
        },
        {
          key: "jobs",
          label: tr(t, "panel.field.jobs", "Jobs"),
          value: h(Badge, { tone: jobsTone(cap.jobs) }, jobsLabel(cap.jobs, t)),
        },
        {
          key: "cwd",
          label: tr(t, "panel.field.cwd", "Cwd"),
          title: cwd ? String(cwd) : undefined,
          value: h("span", { className: "lwiki-path" }, shown(cwd, "—")),
        },
        {
          key: "recall",
          label: tr(t, "panel.field.recall", "Recall"),
          value: onOffBadge(Boolean(cap.autoRecall), t),
        },
        {
          key: "trajectories",
          label: tr(t, "panel.field.trajectories", "Trajectories"),
          value: onOffBadge(cap.trajectories === true, t),
        },
        {
          key: "notices",
          label: tr(t, "panel.field.notices", "UI notices"),
          value: onOffBadge(cap.notices !== false, t),
        },
      );
      return h(
        Card,
        { title: tr(t, "panel.section.capabilities", "Capabilities") },
        h(Fields, { rows }),
        issueList(qmd.issues),
      );
    }

    function backgroundValue(ui) {
      if (ui.lastBackground) return String(ui.lastBackground);
      if (ui.background?.length) {
        return `${ui.background[ui.background.length - 1].label} …`;
      }
      return "—";
    }

    function ActivityCard(props) {
      const { data, t } = props;
      const st = data.status || {};
      const cap = st.capabilities || {};
      const dash = data.dashboard || {};
      const ui = data.ui || {};
      const rawModel = ui.modelLabel || cap.taskModel || "";
      const model =
        !rawModel || rawModel === "(session model)"
          ? tr(t, "panel.sessionModel", "(session model)")
          : String(rawModel);
      const kinds = kindSummary(dash.last7dByKind);
      const rows = [
        { key: "model", label: tr(t, "panel.field.runtimeModel", "Model"), value: String(model) },
        {
          key: "tools",
          label: tr(t, "panel.field.tools", "Tools"),
          value: count(ui.toolCount, "0"),
        },
        {
          key: "recall",
          label: tr(t, "panel.field.lastRecall", "Last recall"),
          value:
            ui.lastRecallCount == null
              ? "—"
              : `${ui.lastRecallCount} ${tr(t, "panel.pagesSuffix", "pages")}`,
        },
        {
          key: "background",
          label: tr(t, "panel.field.background", "Background"),
          value: backgroundValue(ui),
        },
        {
          key: "raw",
          label: tr(t, "panel.field.rawQueue", "Raw queue"),
          value: count(dash.rawQueue, "?"),
        },
        {
          key: "backlinks",
          label: tr(t, "panel.field.zeroBacklinks", "Zero backlinks"),
          value: count(dash.zeroBacklinks, "?"),
        },
        {
          key: "stale",
          label: tr(t, "panel.field.stale", "Stale 30d+"),
          value: count(dash.staleCount, "?"),
        },
      ];
      if (typeof dash.embEnabled === "boolean") {
        rows.push({
          key: "emb",
          label: tr(t, "panel.field.embeddingsFlag", "Embeddings"),
          value: onOffBadge(dash.embEnabled, t),
        });
      }
      if (typeof dash.last7dTotal === "number") {
        rows.push({
          key: "week",
          label: tr(t, "panel.field.activity7d", "Last 7 days"),
          value: h(
            "span",
            null,
            String(dash.last7dTotal),
            kinds ? h("span", { className: "lwiki-sub" }, kinds) : null,
          ),
        });
      }
      const jobs = Array.isArray(ui.background) ? ui.background : [];
      const notice = ui.setupCode
        ? tr(
            t,
            ui.setupCode,
            ui.setupMessage || STRINGS.en[ui.setupCode] || "",
            ui.setupParams || undefined,
          )
        : ui.setupMessage;
      return h(
        Card,
        { title: tr(t, "panel.section.activity", "Activity") },
        h(Fields, { rows }),
        jobs.length
          ? h(
              "div",
              { className: "lwiki-jobs" },
              ...jobs.map((job, index) =>
                h(
                  "div",
                  { className: "lwiki-job", key: `${job?.label}:${index}` },
                  h("span", null, job?.label || "—"),
                  h(
                    Badge,
                    {
                      tone: phaseTone(job?.phase),
                      title: job?.note ? String(job.note) : undefined,
                    },
                    phaseLabel(job?.phase, t),
                  ),
                ),
              ),
            )
          : null,
        notice
          ? h(
              "div",
              { className: "lwiki-note" },
              h("div", { className: "lwiki-kicker" }, tr(t, "panel.field.notice", "Notice")),
              String(notice),
            )
          : null,
      );
    }

    function EmptyCard(props) {
      return h(
        Card,
        { title: tr(props.t, "panel.noVault", "No wiki vault here yet.") },
        h(
          "p",
          { className: "lwiki-hint" },
          tr(props.t, "panel.noVaultHint", "Run /wiki-bootstrap <topic> in this project."),
        ),
        props.error ? h("p", { className: "lwiki-hint" }, String(props.error)) : null,
      );
    }

    function PanelHeader(props) {
      const { t, loading, onRefresh } = props;
      return h(
        "div",
        { className: "lwiki-head" },
        h(
          "div",
          { className: "lwiki-titleblock" },
          h("span", { className: "lwiki-mark" }, h(WikiMark, { size: 20 })),
          h(
            "div",
            null,
            h("h1", null, tr(t, "title", "LLM Wiki")),
            h(
              "p",
              null,
              tr(t, "panel.subtitle", "Vault status, capabilities, and background jobs."),
            ),
          ),
        ),
        h(
          "button",
          {
            type: "button",
            className: "lwiki-btn",
            onClick: onRefresh,
            disabled: loading,
            "aria-busy": loading ? "true" : "false",
          },
          tr(t, "panel.refresh", "Refresh"),
        ),
      );
    }

    function VaultSwitcher(props) {
      const { t, vaults, selectedRoot, onSelect } = props;
      return h(
        "div",
        { className: "lwiki-vaults" },
        h("span", { className: "lwiki-kicker" }, tr(t, "panel.vaults", "Vaults")),
        ...vaults.map((root) => {
          const current = root === selectedRoot;
          const name = String(root).split("/").pop() || root;
          return h(
            "button",
            {
              key: root,
              type: "button",
              className: current ? "lwiki-pill is-current" : "lwiki-pill",
              disabled: current,
              "aria-pressed": current ? "true" : "false",
              title: root,
              onClick: () => onSelect(root),
            },
            name,
          );
        }),
      );
    }

    function WikiStatusPanel(props) {
      const { scope, t } = props;
      const [cwd, setCwd] = React.useState(null);
      const url = `/wiki/status.json${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`;
      const { loading, data, error, refresh } = useStatusJson(url);
      const selectedRoot = cwd || data?.vaultRoot || "";
      const vaults = data && Array.isArray(data.vaults) ? data.vaults : [];
      let body = null;
      if (loading && !data) {
        body = h(
          Card,
          { title: tr(t, "title", "LLM Wiki") },
          h("p", { className: "lwiki-hint" }, tr(t, "panel.loading", "Loading wiki status…")),
        );
      } else if (error || !data || data.ok === false) {
        body = h(EmptyCard, { t, error });
      } else {
        body = h(
          "div",
          { style: { display: "grid", gap: 16 } },
          h(VaultCard, { data, t }),
          h(CapabilityCard, { data, t }),
          h(ActivityCard, { data, t }),
        );
      }
      return h(
        "div",
        { className: "lwiki-page", "aria-busy": loading ? "true" : "false" },
        h("style", null, WIKI_PANEL_CSS),
        h(
          "div",
          { className: "lwiki-column" },
          h(PanelHeader, { t, loading, onRefresh: refresh }),
          h(
            Card,
            { title: tr(t, "panel.section.settings", "Settings") },
            h(SettingsSummary, { scope, t }),
          ),
          vaults.length > 1
            ? h(VaultSwitcher, { t, vaults, selectedRoot, onSelect: setCwd })
            : null,
          body,
        ),
      );
    }

    function WikiDockLine(props) {
      const sid = (props && (props.sessionId || props.session?.id)) || null;
      const url = `/wiki/status.json${sid ? `?session=${encodeURIComponent(sid)}` : ""}`;
      const [line, setLine] = React.useState(null);
      React.useEffect(() => {
        let cancelled = false;
        let timer = null;
        const load = () => {
          fetch(url)
            .then((response) => response.json())
            .then((data) => {
              if (cancelled) return;
              const lines = data?.transient || [];
              setLine(lines.length ? lines[lines.length - 1] : null);
            })
            .catch(() => {
              if (!cancelled) setLine(null);
            });
        };
        load();
        timer = setInterval(load, 10000);
        return () => {
          cancelled = true;
          if (timer) clearInterval(timer);
        };
      }, [url]);
      if (!line) return null;
      const text =
        typeof line === "string"
          ? line
          : line.code
            ? tr(props?.t, line.code, line.text || STRINGS.en[line.code] || "", line.params)
            : line.text;
      if (!text) return null;
      return h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            fontSize: 12,
            lineHeight: "18px",
            color: "var(--dsw-alias-label-secondary, var(--dsw-alias-text-secondary, #888))",
          },
        },
        h(WikiMark, { size: 14 }),
        h("span", { style: { minWidth: 0, overflowWrap: "anywhere" } }, text),
      );
    }

    function WikiSection(props) {
      const { close, scope, t } = props;
      const snap = useForm(scope);
      const [draft, setDraft] = React.useState(null);
      const dirty = draft !== null;

      const save = async () => {
        if (!draft) return;
        const entries = Object.entries(draft);
        for (const [k, v] of entries) {
          const ok = await scope.set(k, v === "" ? undefined : v);
          if (ok === false) break;
        }
        setDraft(null);
      };

      if (!snap || snap.status === "unavailable") {
        return h("div", { style: { padding: 24 } }, tr(t, "unavailable", "Settings unavailable"));
      }
      const value = (draft ?? snap.value) || {};

      return h(
        "div",
        { style: { padding: 24, display: "grid", gap: 16, maxWidth: 640 } },
        h("h2", { style: { margin: 0, fontSize: 18 } }, tr(t, "title", "LLM Wiki")),
        h(
          "p",
          { style: { margin: 0, color: "var(--dsw-alias-text-secondary, #888)" } },
          tr(t, "subtitle", "Knowledge-base behavior for this profile."),
        ),
        ...FIELDS.map((field) => {
          const current = value[field.key];
          const isDirty = dirty && field.key in draft;
          const hint = tr(t, field.hintKey, STRINGS.en[field.hintKey]);
          return h(
            "label",
            { key: field.key, style: { display: "grid", gap: 4 } },
            h(
              "span",
              null,
              tr(t, field.labelKey, STRINGS.en[field.labelKey]),
              isDirty ? tr(t, "overridden", STRINGS.en.overridden) : "",
            ),
            field.type === "boolean"
              ? h("input", {
                  type: "checkbox",
                  role: "switch",
                  "aria-checked": Boolean(current),
                  checked: Boolean(current),
                  disabled: !snap.writable,
                  onChange: (e) => setDraft({ ...(draft || {}), [field.key]: e.target.checked }),
                })
              : h("input", {
                  value: String(current ?? ""),
                  disabled: !snap.writable,
                  inputMode: field.type === "number" ? "numeric" : undefined,
                  placeholder: hint,
                  onChange: (e) =>
                    setDraft({
                      ...(draft || {}),
                      [field.key]:
                        field.type === "number" ? Number(e.target.value) : e.target.value,
                    }),
                }),
            h("small", { style: { color: "var(--dsw-alias-text-secondary, #888)" } }, hint),
          );
        }),
        h(
          "div",
          { style: { display: "flex", gap: 8 } },
          h("button", { disabled: !snap.writable || !dirty, onClick: save }, tr(t, "save", "Save")),
          h(
            "button",
            { disabled: !dirty, onClick: () => setDraft(null) },
            tr(t, "discard", "Discard"),
          ),
          h("button", { onClick: close }, tr(t, "close", "Close")),
        ),
      );
    }

    return {
      inject: ["slots", "locale", "configForms"],
      apply(ctx) {
        const disposers = [];
        const cleanup = () => {
          for (const dispose of disposers.splice(0)) {
            try {
              if (typeof dispose === "function") dispose();
            } catch (_) {
              /* best effort */
            }
          }
        };
        try {
          try {
            ctx.logger?.info?.("[llm-wiki] client apply: registering settings.section");
          } catch (_) {}
          const bound = ctx.locale?.bind ? ctx.locale.bind(NS) : null;
          if (ctx.locale?.register) {
            disposers.push(
              ctx.effect(() => ctx.locale.register(NS, STRINGS), "wiki-ui: dictionaries"),
            );
          }
          // Top-level Settings nav entries (Models, Agent presets, …) register
          // `settings.section` directly. `whileServed` is for `plugins.item`
          // cards inside Built-in plugins — gating the nav on it hid the page
          // entirely when the client finally loaded. Host Config still needs
          // `.volatile()` so describe serves values into configForms.get.
          if (!ctx.slots?.inject || !ctx.slots?.register) {
            try {
              ctx.logger?.warn?.("[llm-wiki] settings UI skipped: slots unavailable");
            } catch (_) {}
            return cleanup;
          }
          if (!ctx.configForms?.get) {
            try {
              ctx.logger?.warn?.("[llm-wiki] settings UI skipped: configForms unavailable");
            } catch (_) {}
            return cleanup;
          }
          const scope = ctx.configForms.get(ENTRY);
          disposers.push(
            ctx.effect(
              () =>
                ctx.slots.inject("settings.section", () =>
                  ctx.slots.register(
                    {
                      name: "settings.section",
                      id: "wiki",
                      order: 60,
                      label: () => tr(bound, "title", "LLM Wiki"),
                      locale: NS,
                      inject: () => ({ scope }),
                    },
                    WikiSection,
                  ),
                ),
              "wiki-ui: settings page",
            ),
          );
          // G1: sidebar status panel — icon in the panellist + keyed main
          // page. Root scope: no sessionId, so the panel reads the
          // last-active vault (host default) with a vault picker fallback.
          disposers.push(
            ctx.effect(
              () =>
                ctx.slots.inject("sidebar.panellist", () =>
                  ctx.slots.register(
                    {
                      name: "sidebar.panellist",
                      id: PANEL_ID,
                      order: 40,
                      label: () => tr(bound, "title", "LLM Wiki"),
                      locale: NS,
                      inject: () => ({}),
                    },
                    WikiStatusIcon,
                  ),
                ),
              "wiki-ui: sidebar icon",
            ),
          );
          disposers.push(
            ctx.effect(
              () =>
                ctx.slots.inject("main", () =>
                  ctx.slots.register(
                    {
                      name: "main",
                      key: PANEL_ID,
                      label: () => tr(bound, "title", "LLM Wiki"),
                      locale: NS,
                      inject: () => ({ scope }),
                    },
                    WikiStatusPanel,
                  ),
                ),
              "wiki-ui: status panel",
            ),
          );
          // G2: transient recall/background line near the composer (session
          // scope carries sessionId; renders nothing when notices are off).
          disposers.push(
            ctx.effect(
              () =>
                ctx.slots.inject("conversation.composer.dock", () =>
                  ctx.slots.register(
                    {
                      name: "conversation.composer.dock",
                      id: "wiki-dock",
                      order: 20,
                      locale: NS,
                      inject: () => ({}),
                    },
                    WikiDockLine,
                  ),
                ),
              "wiki-ui: composer dock",
            ),
          );
        } catch (err) {
          try {
            ctx.logger.warn(`[llm-wiki] settings UI failed: ${err.message}`);
          } catch (_) {
            /* best effort */
          }
        }
        return cleanup;
      },
    };
  },
});
