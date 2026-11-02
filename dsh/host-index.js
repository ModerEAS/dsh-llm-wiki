/**
 * DSH bundle Host entry — static re-export of the built plugin.
 *
 * Build first: `pnpm build:dsh` (tsc → ../dist/dsh/). This file stays
 * hand-written and version-controlled; only the dist output is generated.
 * Kept as a thin edge so stack traces point at the real modules.
 */
export { apply, inject, Config, PLUGIN_ID } from "../dist/dsh/src/dsh/index.js";
