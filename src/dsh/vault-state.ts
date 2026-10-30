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
 * is an in-place `writeFileSync` (the "atomically" comment notwithstanding),
 * so concurrent rebuilds — e.g. after HMR, when two plugin generations are
 * briefly alive — can interleave and truncate `registry.json`. Serializing
 * per vault removes the corruption without a lockfile.
 */
import type { TaskConfig } from "../../extensions/llm-wiki/lib/task-config.js";
import { loadTaskConfig } from "../../extensions/llm-wiki/lib/task-config.js";

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

export function configForVault(vaultRoot: string, dotWikiDir: string, fresh = false): TaskConfig {
  if (!fresh) {
    const cached = configCache.get(vaultRoot);
    if (cached) return cached.config;
  }
  void dotWikiDir;
  const config = loadTaskConfig(vaultRoot);
  configCache.set(vaultRoot, { config, mtimeMs: Date.now() });
  return config;
}

export function invalidateVaultConfig(vaultRoot: string): void {
  configCache.delete(vaultRoot);
}

/**
 * Serial write queue per key (registry files, one writer per vault).
 * `write` may be sync or async; calls for the same key run strictly in order.
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
