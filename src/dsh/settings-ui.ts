/**
 * Settings surface (A7): the former TUI settings (`/wiki-settings`) become
 * a WebUI section. Split across two halves:
 *
 * - HOST half (this file): the plugin `Config` JSON Schema — the row's
 *   `config` in cordis.patch.yml is validated against it, and the settings
 *   document serves the `llm-wiki` namespace from it. Field keys match the
 *   `llm-wiki.*` settings keys the lib already reads (E2: additive only).
 * - CLIENT half (`dsh/client.js`, hand-written, no build step): the
 *   `settings.section` React entry (`id: 'wiki'`) with plain controls.
 *   It deliberately imports no Harness Client packages.
 *
 * The client half follows the researched `configForms` + `whileServed` +
 * `slots.inject('settings.section', …)` pattern; it has NOT been verified
 * against a live Harness (no browser control in this environment) — see
 * docs/dsh.md §WebUI. The Host half degrades cleanly when the client
 * bundle is absent: every access below is defensive.
 */

import type { WikiLogger } from "./logger.js";
import type { DshContext } from "./types.js";

/** Plugin row id — also the settings/configForms namespace. */
export const WIKI_NAMESPACE = "llm-wiki";

/**
 * Host Config JSON Schema for the `llm-wiki` plugin row. Every field maps
 * 1:1 onto a `TaskConfig` key already read by the lib; no existing key
 * semantics change.
 */
export const WikiConfigSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    autoRecall: {
      type: "boolean",
      default: true,
      description: "Automatic per-turn wiki recall injection.",
    },
    notices: {
      type: "boolean",
      default: true,
      description: "Surface wiki activity (recall hits, reminders, reports) in the UI.",
    },
    trajectories: {
      type: "boolean",
      default: false,
      description: "Opt-in agent-trajectory memory (capture / distill / recall skills).",
    },
    taskModel: {
      type: "string",
      description: "Background synthesis model as 'provider/id'. Empty = session model.",
    },
    semanticWeight: {
      type: "number",
      default: 0.5,
      description: "Weight of the semantic signal in hybrid recall (0 = pure lexical).",
    },
    recallLinksThreshold: {
      type: "number",
      default: 50,
      description: "Vault page count above which recall returns links-first.",
    },
    ambientPersonalVault: {
      type: "boolean",
      description: "Let the personal vault fire ambient recall outside project vaults.",
    },
  },
};

/** Field list shared conceptually with the client section (kept in sync by hand). */
export const WIKI_SETTINGS_FIELDS = [
  "autoRecall",
  "notices",
  "trajectories",
  "taskModel",
  "semanticWeight",
  "recallLinksThreshold",
  "ambientPersonalVault",
] as const;

/**
 * Host-side settings wiring. With a self-rendered section the plugin opts
 * out of auto-generated forms; without the client bundle this is a no-op.
 */
export function registerSettingsUi(ctx: DshContext, logger?: WikiLogger): () => void {
  try {
    ctx.settings?.configure?.({ auto: false }, ctx.fiber);
  } catch (error) {
    logger?.warn(`settings.configure failed: ${(error as Error).message}`);
  }
  return () => undefined;
}
