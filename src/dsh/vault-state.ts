/**
 * Per-vault keyed state (H04/H05) + single-writer registry queue (H30).
 *
 * The pi extension keeps `pendingRebuild` as a module-level boolean consumed
 * with `process.cwd()`, and a single mutable `Runtime.config`: with several
 * sessions open in one DSH process, session A flags a rebuild that session B
 * consumes against B's directory (or the personal vault fallback), and one
 * project's settings briefly leak into another's. DSH is single-process,
 * multi-session, so all of this state is keyed by vault root here.
 *
 * Registry writes go through one serial queue per vault root: `writeJson`
 * is per-file tmp+rename (atomic), but a rebuild is a multi-file
 * read-modify-write (registry/backlinks/index/log), so concurrent rebuilds
 * — e.g. after HMR, when two plugin generations are briefly alive — can
 * still interleave. Serializing per vault removes the corruption without
 * a lockfile.
 */
import type { TaskConfig } from "../../extensions/llm-wiki/lib/task-config.js";
import { loadTaskConfig, parseModelRef } from "../../extensions/llm-wiki/lib/task-config.js";
import type { DshContext } from "./types.js";

/** Plugin row id in the profile's `cordis.patch.yml`. */
const ROW_ID = "llm-wiki";

/** Vault roots with a metadata rebuild owed (set by the guard layer). */
const pendingRebuilds = new Set<string>();

export function flagPendingRebuild(vaultRoot: string): void {
  pendingRebuilds.add(vaultRoot);
}

export function takePendingRebuild(vaultRoot: string): boolean {
  if (!pendingRebuilds.has(vaultRoot)) return false;
  pendingRebuilds.delete(vaultRoot);
  return true;
}

export function pendingRebuildCount(): number {
  return pendingRebuilds.size;
}

/** Per-vault config cache: read explicitly by key, never one shared field. */
const configCache = new Map<string, { config: TaskConfig; mtimeMs: number }>();

/**
 * Profile-wide values written by the Settings → LLM Wiki panel (the plugin
 * row's `config`). They WIN over settings files so a GUI edit takes effect
 * without restart; keys the user never touched stay absent, so file-based
 * configuration keeps working underneath.
 */
let dshConfigOverrides: Partial<TaskConfig> = {};

const OVERRIDE_BOOLEANS = [
  "autoRecall",
  "notices",
  "trajectories",
  "ambientPersonalVault",
  "proactiveCapture",
  "observationReminder",
] as const;

const OVERRIDE_NUMBERS = ["semanticWeight", "recallLinksThreshold", "reminderTurns"] as const;

/** Keep only the fields the schema exposes, coerced to their TaskConfig shape. */
function pickOverrides(config: unknown): Partial<TaskConfig> {
  const source = (config && typeof config === "object" ? config : {}) as Record<string, unknown>;
  const next: Partial<TaskConfig> = {};
  for (const key of OVERRIDE_BOOLEANS) {
    if (typeof source[key] === "boolean") next[key] = source[key];
  }
  for (const key of OVERRIDE_NUMBERS) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) next[key] = value;
  }
  // The schema stores taskModel as "provider/id"; TaskConfig wants a spec.
  if (typeof source.taskModel === "string") {
    const ref = parseModelRef(source.taskModel);
    if (ref) next.taskModel = ref;
  }
  return next;
}

/**
 * Install the profile's row config as runtime overrides (DSH config bridge).
 * Clears the per-vault cache so the next `configForVault` sees them, and
 * returns the applied overrides for callers that gate on them at apply time
 * (the static policy section has no session cwd to resolve against).
 */
export function setDshConfigOverrides(config: unknown): Partial<TaskConfig> {
  dshConfigOverrides = pickOverrides(config);
  configCache.clear();
  return dshConfigOverrides;
}

/**
 * Read the plugin row config EXACTLY as written by configForms. Schema
 * defaults are not materialized there (`options.config` holds only explicit
 * keys), so file-based settings keep working until the user saves a value in
 * the GUI. The `apply` argument DOES carry defaults — it is only a fallback
 * for hosts without a loader, where "default" and "explicit" cannot be told
 * apart anyway.
 */
export function resolveRowConfig(ctx: DshContext, fallback?: unknown): unknown {
  try {
    const entries = ctx.loader?.entries?.();
    if (Array.isArray(entries)) {
      const row = entries.find((entry) => entry?.options?.id === ROW_ID);
      if (row) return row.options?.config;
      if (entries.length > 0) return {};
    }
  } catch {
    /* loader unavailable → fall through to the validated argument */
  }
  return fallback;
}

export function configForVault(vaultRoot: string, dotWikiDir: string, fresh = false): TaskConfig {
  if (!fresh) {
    const cached = configCache.get(vaultRoot);
    if (cached) return cached.config;
  }
  void dotWikiDir;
  const config: TaskConfig = { ...loadTaskConfig(vaultRoot), ...dshConfigOverrides };
  configCache.set(vaultRoot, { config, mtimeMs: Date.now() });
  return config;
}

export function invalidateVaultConfig(vaultRoot: string): void {
  configCache.delete(vaultRoot);
}

/**
 * Serial write queue per key (registry files, one writer per vault).
 * `write` may be sync or async; calls for the same key run strictly in order.
 * Failures are swallowed for queue continuity — use `withVaultWrite` when
 * the caller must observe the error.
 */
export function createWriteQueue(): {
  enqueue: (key: string, write: () => void | Promise<void>) => Promise<void>;
  pending: (key?: string) => number;
} {
  const tails = new Map<string, Promise<void>>();
  const pending = new Map<string, number>();

  function enqueue(key: string, write: () => void | Promise<void>): Promise<void> {
    pending.set(key, (pending.get(key) ?? 0) + 1);
    const prior = tails.get(key) ?? Promise.resolve();
    const next = prior
      .catch(() => undefined)
      .then(write)
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        pending.set(key, Math.max(0, (pending.get(key) ?? 1) - 1));
        if (tails.get(key) === next) tails.delete(key);
      });
    tails.set(key, next);
    return next;
  }

  function pendingCount(key?: string): number {
    if (key !== undefined) return pending.get(key) ?? 0;
    let total = 0;
    for (const n of pending.values()) total += n;
    return total;
  }

  return { enqueue, pending: pendingCount };
}

/** Process-level queue singleton: every DSH metadata rebuild in this process
 * funnels through one instance so same-vault writes serialize (H30). */
const processQueue = createWriteQueue();

/** Test seam: the singleton behind {@link withVaultWrite} (spy only). */
export function getVaultWriteQueue(): {
  enqueue: (key: string, write: () => void | Promise<void>) => Promise<void>;
  pending: (key?: string) => number;
} {
  return processQueue;
}

/**
 * Run `fn` serialized per vault root; propagates `fn`'s error to the caller
 * (unlike `enqueue`, which swallows write errors to keep the chain alive).
 */
export async function withVaultWrite<T>(vaultRoot: string, fn: () => T | Promise<T>): Promise<T> {
  let result: T | undefined;
  let failed = false;
  let failure: unknown;
  await processQueue.enqueue(vaultRoot, async () => {
    try {
      result = await fn();
    } catch (error) {
      failed = true;
      failure = error;
    }
  });
  if (failed) throw failure;
  return result as T;
}
