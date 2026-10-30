/**
 * LLM Wiki settings section — DSH WebUI client bundle (hand-written, no build step).
 *
 * Loaded by the browser module table as the `./client` export of the
 * `dsh-llm-wiki` bundle package (see dsh/package.json `dsh.client` +
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
      },
    };

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
          const t = ctx.locale?.bind ? ctx.locale.bind(NS) : null;
          if (ctx.locale?.register) {
            disposers.push(
              ctx.effect(() => ctx.locale.register(NS, STRINGS), "wiki-ui: dictionaries"),
            );
          }
          const scope = ctx.configForms ? ctx.configForms.get(ENTRY) : null;
          if (!scope || !ctx.configForms?.whileServed || !ctx.slots?.inject) return;
          disposers.push(
            ctx.effect(
              () =>
                ctx.configForms.whileServed([ENTRY], () =>
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
                ),
              "wiki-ui: settings page",
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
