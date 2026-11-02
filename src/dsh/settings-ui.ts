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
 * `slots.inject('settings.section', …)` pattern. Live T1.2 showed Host
 * Config fields MUST be `.volatile()` or `settings.describe` omits the
 * namespace and whileServed never mounts the section — see DECISIONS A7.
 * Host half degrades cleanly when the client bundle is absent.
 */

import z from "@deepseek-ai/schemastery";
import type { WikiLogger } from "./logger.js";
import type { DshContext } from "./types.js";

/** Plugin row id — also the settings/configForms namespace. */
export const WIKI_NAMESPACE = "llm-wiki";

/**
 * Host Config schema for the `llm-wiki` plugin row. Must be a Schemastery
 * schema (cordis validates via Standard Schema `~standard.validate`; a plain
 * JSON Schema object fails activation with "Cannot read properties of
 * undefined (reading 'validate')"). Every field maps 1:1 onto a `TaskConfig`
 * key already read by the lib; no existing key semantics change.
 */
export const WikiConfigSchema = z.object({
  // Every settings-editable field must be `.volatile()` — Host `settings.describe`
  // drops namespaces with no volatile form, so whileServed(['llm-wiki']) never
  // mounts the client settings.section (T1.2 live failure).
  autoRecall: z.boolean().default(true).description("Automatic per-turn wiki recall injection.").volatile(),
  notices: z.boolean().default(true).description("Surface wiki activity (recall hits, reminders, reports) in the UI.").volatile(),
  trajectories: z.boolean().default(false).description("Opt-in agent-trajectory memory (capture / distill / recall skills).").volatile(),
  taskModel: z.string().description("Background synthesis model as 'provider/id'. Empty = session model.").volatile(),
  semanticWeight: z.number().default(0.5).description("Weight of the semantic signal in hybrid recall (0 = pure lexical).").volatile(),
  recallLinksThreshold: z.number().default(50).description("Vault page count above which recall returns links-first.").volatile(),
  ambientPersonalVault: z.boolean().description("Let the personal vault fire ambient recall outside project vaults.").volatile(),
});

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
  // Self-rendered settings.section: opt out of auto-generated schema pages.
  // Must be an effect under inject(['settings']) so a late/replaced Settings
  // service still picks the policy up (dsh-settings README).
  try {
    const inject = (ctx as { inject?: (deps: string[], fn: (c: DshContext) => void) => void }).inject;
    if (typeof inject === "function") {
      inject(["settings"], (settingsCtx) => {
        settingsCtx.effect?.(
          () => {
            settingsCtx.settings?.configure?.({ auto: false }, ctx.fiber);
            return () => undefined;
          },
          "llm-wiki settings auto:false",
        );
      });
    } else {
      ctx.settings?.configure?.({ auto: false }, ctx.fiber);
    }
  } catch (error) {
    logger?.warn(`settings.configure failed: ${(error as Error).message}`);
  }
  return () => undefined;
}
