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
 *
 * DRAFT: assembled from the researched configForms/whileServed/slots
 * contract; NOT yet verified against a live Harness. If `configForms` or
 * the `settings.section` slot is absent, apply() no-ops and settings remain
 * editable via /wiki-model, /wiki-trajectories, and settings files.
 */
window.__ModuleLoader__.load({
  id: "dsh-llm-wiki",
  factory(require) {
    const React = require("react");
    const h = React.createElement;
    const NS = "llm-wiki";
    const ENTRY = "llm-wiki";

    // Locale dictionaries live inline: the browser module table only
    // serves baseline keys, so JSON files are not requireable here.
    const STRINGS = {
      en: {
        "meta.title": "LLM Wiki",
        "meta.description": "Self-maintaining, Obsidian-compatible knowledge base.",
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
      },
      zh: {
        "meta.title": "LLM Wiki",
        "meta.description": "自维护、兼容 Obsidian 的知识库。",
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
      },
    };

    const PANEL_ID = "wiki-status";

    const FIELDS = [
      {
        key: "autoRecall",
        label: "Automatic recall",
        type: "boolean",
        hint: "Inject relevant wiki pages before each turn.",
      },
      {
        key: "notices",
        label: "UI notices",
        type: "boolean",
        hint: "Show recall hits, reminders, and background reports.",
      },
      {
        key: "trajectories",
        label: "Agent trajectories",
        type: "boolean",
        hint: "Opt-in working memory: capture, distill, and recall skills.",
      },
      {
        key: "taskModel",
        label: "Synthesis model",
        type: "string",
        hint: "'provider/id'. Empty = session model.",
      },
      {
        key: "semanticWeight",
        label: "Semantic weight",
        type: "number",
        hint: "0 = pure lexical recall.",
      },
      {
        key: "recallLinksThreshold",
        label: "Links-first threshold",
        type: "number",
        hint: "Page count above which recall returns links.",
      },
      {
        key: "ambientPersonalVault",
        label: "Ambient personal vault",
        type: "boolean",
        hint: "Recall from the personal vault outside projects.",
      },
    ];

    function useForm(scope) {
      return React.useSyncExternalStore(
        (cb) => scope.subscribe(cb),
        () => scope.getSnapshot(),
      );
    }

    const rowStyle = { display: "flex", gap: 8, fontSize: 13 };
    const keyStyle = { color: "var(--dsw-alias-text-secondary, #888)", minWidth: 132 };

    function useStatusJson(url) {
      const [state, setState] = React.useState({ loading: true, data: null, error: null });
      const refresh = React.useCallback(() => {
        let cancelled = false;
        setState((s) => ({ ...s, loading: true, error: null }));
        fetch(url)
          .then((r) => r.json())
          .then((data) => {
            if (!cancelled) setState({ loading: false, data, error: null });
          })
          .catch((err) => {
            if (!cancelled) setState({ loading: false, data: null, error: String(err) });
          });
        return () => {
          cancelled = true;
        };
      }, [url]);
      React.useEffect(() => refresh(), [refresh]);
      return { ...state, refresh };
    }

    function SettingsSummary(props) {
      const { scope, t } = props;
      const snap = useForm(scope);
      const value = (snap && snap.value) || {};
      const on = (v) => (v ? "on" : "off");
      return h(
        "div",
        { style: { display: "grid", gap: 4, fontSize: 13 } },
        h(
          "div",
          { style: rowStyle },
          h("span", { style: keyStyle }, "Automatic recall"),
          h("span", null, on(value.autoRecall !== false)),
        ),
        h(
          "div",
          { style: rowStyle },
          h("span", { style: keyStyle }, "UI notices"),
          h("span", null, on(value.notices !== false)),
        ),
        h(
          "div",
          { style: rowStyle },
          h("span", { style: keyStyle }, "Trajectories"),
          h("span", null, on(value.trajectories === true)),
        ),
        h(
          "div",
          { style: rowStyle },
          h("span", { style: keyStyle }, "Synthesis model"),
          h("span", null, String(value.taskModel || "(session model)")),
        ),
        h(
          "small",
          { style: { color: "var(--dsw-alias-text-secondary, #888)" } },
          t ? t("panel.settingsHint") : "Edit in Settings → LLM Wiki",
        ),
      );
    }

    function WikiStatusIcon(props) {
      const size = (props && props.size) || 20;
      return h("span", { style: { fontSize: size, lineHeight: 1 }, title: "LLM Wiki" }, "🧠");
    }

    function WikiStatusPanel(props) {
      const { scope, t } = props;
      const [cwd, setCwd] = React.useState(null);
      const url = "/wiki/status.json" + (cwd ? "?cwd=" + encodeURIComponent(cwd) : "");
      const { loading, data, error, refresh } = useStatusJson(url);
      const rows = [];
      let body = null;
      if (loading && !data) {
        body = h("div", null, t ? t("panel.loading") : "Loading wiki status…");
      } else if (error || (data && data.ok === false)) {
        body = h(
          "div",
          { style: { display: "grid", gap: 4 } },
          h("div", null, t ? t("panel.noVault") : "No wiki vault here yet."),
          h(
            "small",
            { style: { color: "var(--dsw-alias-text-secondary, #888)" } },
            t ? t("panel.noVaultHint") : "Run /wiki-bootstrap <topic> in this project.",
          ),
        );
      } else if (data) {
        const st = data.status || {};
        const cap = st.capabilities || {};
        const qmd = st.qmd || {};
        const dash = data.dashboard || {};
        const ui = data.ui || {};
        const kv = (k, v) =>
          h(
            "div",
            { key: k, style: rowStyle },
            h("span", { style: keyStyle }, k),
            h("span", null, String(v)),
          );
        rows.push(
          kv("Topic", st.topic ?? "Unknown"),
          kv("Mode", st.mode ?? "personal"),
          kv("Pages", st.totalPages ?? 0),
          kv("Health", st.health ?? ""),
          kv("Orphans / Gaps", (st.orphans ?? 0) + " / " + (st.gaps ?? 0)),
          kv("Updated", st.lastUpdated || "Never"),
          kv(
            "QMD",
            String(qmd.state ?? "") +
              " · " +
              (qmd.totalDocuments ?? 0) +
              " docs · emb pending " +
              (qmd.needsEmbedding ?? 0),
          ),
          kv("Semantic", cap.semantic ?? "?"),
          kv("Jobs", cap.jobs ?? "?"),
          kv("Cwd", cap.cwd ?? data.vaultRoot ?? ""),
          kv(
            "Recall/Traj/Notices",
            [
              cap.autoRecall ? "recall:on" : "recall:off",
              cap.trajectories ? "traj:on" : "traj:off",
              cap.notices === false ? "notices:off" : "notices:on",
            ].join(" "),
          ),
          kv("Model", ui.modelLabel || cap.taskModel || "(session model)"),
          kv("Tools", ui.toolCount ?? 0),
          kv("Last recall", ui.lastRecallCount == null ? "—" : ui.lastRecallCount + " pages"),
          kv(
            "Background",
            ui.lastBackground ||
              (ui.background && ui.background.length
                ? ui.background[ui.background.length - 1].label + " …"
                : "—"),
          ),
          kv("Raw queue", dash.rawQueue ?? "?"),
          kv("Zero backlinks", dash.zeroBacklinks ?? "?"),
          kv("Stale 30d+", dash.staleCount ?? "?"),
        );
        if (ui.setupMessage) rows.push(kv("Notice", ui.setupMessage));
        body = h("div", { style: { display: "grid", gap: 4 } }, ...rows);
      }
      return h(
        "div",
        { style: { padding: 16, display: "grid", gap: 12, maxWidth: 560 } },
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: 8 } },
          h("h2", { style: { margin: 0, fontSize: 16 } }, "🧠 LLM Wiki"),
          h("span", { style: { flex: 1 } }),
          h("button", { onClick: refresh }, t ? t("panel.refresh") : "Refresh"),
        ),
        h(
          "p",
          { style: { margin: 0, color: "var(--dsw-alias-text-secondary, #888)", fontSize: 12 } },
          t ? t("panel.subtitle") : "Vault status, capabilities, and background jobs.",
        ),
        h(SettingsSummary, { scope, t }),
        data && data.vaults && data.vaults.length > 1
          ? h(
              "div",
              { style: { display: "flex", gap: 4, flexWrap: "wrap", fontSize: 12 } },
              ...data.vaults.map((root) =>
                h(
                  "button",
                  {
                    key: root,
                    disabled: root === data.vaultRoot,
                    onClick: () => setCwd(root),
                    title: root,
                  },
                  String(root).split("/").pop() || root,
                ),
              ),
            )
          : null,
        body,
      );
    }

    function WikiDockLine(props) {
      const sid = (props && (props.sessionId || (props.session && props.session.id))) || null;
      const url = "/wiki/status.json" + (sid ? "?session=" + encodeURIComponent(sid) : "");
      const [line, setLine] = React.useState(null);
      React.useEffect(() => {
        let cancelled = false;
        let timer = null;
        const load = () => {
          fetch(url)
            .then((r) => r.json())
            .then((data) => {
              if (cancelled) return;
              const lines = (data && data.transient) || [];
              setLine(lines.length ? lines[lines.length - 1].text : null);
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
      return h(
        "div",
        { style: { fontSize: 12, color: "var(--dsw-alias-text-secondary, #888)" } },
        "🧠 " + line,
      );
    }

    function WikiSection(props) {
      const { close, scope, t } = props;
      const snap = useForm(scope);
      const [draft, setDraft] = React.useState(null);
      const value = (draft ?? snap.value) || {};
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
        return h("div", { style: { padding: 24 } }, t ? t("unavailable") : "Settings unavailable");
      }

      return h(
        "div",
        { style: { padding: 24, display: "grid", gap: 16, maxWidth: 640 } },
        h("h2", { style: { margin: 0, fontSize: 18 } }, t ? t("title") : "LLM Wiki"),
        h(
          "p",
          { style: { margin: 0, color: "var(--dsw-alias-text-secondary, #888)" } },
          t ? t("subtitle") : "Knowledge-base behavior for this profile.",
        ),
        ...FIELDS.map((field) => {
          const current = value[field.key];
          const isDirty = dirty && field.key in draft;
          return h(
            "label",
            { key: field.key, style: { display: "grid", gap: 4 } },
            h("span", null, field.label, isDirty ? " ·overridden" : ""),
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
                  placeholder: field.hint,
                  onChange: (e) =>
                    setDraft({
                      ...(draft || {}),
                      [field.key]:
                        field.type === "number" ? Number(e.target.value) : e.target.value,
                    }),
                }),
            h("small", { style: { color: "var(--dsw-alias-text-secondary, #888)" } }, field.hint),
          );
        }),
        h(
          "div",
          { style: { display: "flex", gap: 8 } },
          h(
            "button",
            { disabled: !snap.writable || !dirty, onClick: save },
            t ? t("save") : "Save",
          ),
          h(
            "button",
            { disabled: !dirty, onClick: () => setDraft(null) },
            t ? t("discard") : "Discard",
          ),
          h("button", { onClick: close }, t ? t("close") : "Close"),
        ),
      );
    }

    return {
      inject: ["slots", "locale", "configForms"],
      apply(ctx) {
        const disposers = [];
        try {
          try {
            ctx.logger?.info?.("[llm-wiki] client apply: registering settings.section");
          } catch (_) {}
          const t = ctx.locale?.bind ? ctx.locale.bind(NS) : null;
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
            return () => {};
          }
          if (!ctx.configForms?.get) {
            try {
              ctx.logger?.warn?.("[llm-wiki] settings UI skipped: configForms unavailable");
            } catch (_) {}
            return () => {};
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
                      label: () => (t ? t("title") : "LLM Wiki"),
                      locale: NS,
                      inject: () => ({ scope, t }),
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
                      label: () => (t ? t("title") : "LLM Wiki"),
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
                      label: () => (t ? t("title") : "LLM Wiki"),
                      locale: NS,
                      inject: () => ({ scope, t }),
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
        return () => {
          for (const dispose of disposers.splice(0)) {
            try {
              if (typeof dispose === "function") dispose();
            } catch (_) {
              /* best effort */
            }
          }
        };
      },
    };
  },
});
