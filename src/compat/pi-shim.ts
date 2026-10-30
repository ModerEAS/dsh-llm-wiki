/**
 * TEMPORARY bootstrap layer — delete as tools migrate to native DSH calls.
 *
 * Purpose (DECISIONS A3): the fastest probe for the B1–B8 API assumptions.
 * It adapts DSH services to the narrow shapes the pi lib helpers expect
 * (`ExecApi`, cwd strings, normalized tool args) so migrated code can reuse
 * lib cores without dragging `pi-coding-agent` into the DSH process.
 *
 * It must NEVER grow pi-API fidelity: no `ExtensionAPI` re-implementation,
 * no event re-dispatch, no TUI. New capability belongs in `src/dsh/`, not
 * here. Each export documents which native module replaces it.
 */
import { execRaw } from "../dsh/exec.js";
import { agentCwd, normalizeDshToolArgs } from "../dsh/guard.js";
import type { DshContext, DshToolExec } from "../dsh/types.js";

/** Narrow `pi.exec` shape (`lib/utils.ts ExecApi`) backed by DSH execution. */
export interface ShimExecApi {
  exec: (
    command: string,
    args: string[],
    options?: { signal?: AbortSignal; timeout?: number; cwd?: string },
  ) => Promise<{ stdout: string; stderr: string; code: number; killed: boolean }>;
}

/**
 * Build an `ExecApi` over DSH execution for lib helpers that inspect
 * `code`/`killed` themselves (source extractors). Native replacement:
 * `runCommand`/`execRaw` in `src/dsh/exec.ts` (already used directly by
 * new code — this adapter is only for unmigrated call sites).
 */
export function makeExecApi(
  ctx: DshContext,
  opts?: { signal?: AbortSignal; cwd?: string },
): ShimExecApi {
  return {
    exec: (command, args, options) =>
      execRaw(ctx, command, args, {
        signal: options?.signal ?? opts?.signal,
        timeoutMs: options?.timeout,
        cwd: options?.cwd ?? opts?.cwd,
      }),
  };
}

/**
 * Resolve the calling agent's working directory (never `process.cwd()`).
 * Native replacement: resolve once per tool call in `src/dsh/tool-defs.ts`.
 */
export function shimCwd(ctx: DshContext, exec: DshToolExec): string {
  return agentCwd(ctx, exec);
}

/**
 * Normalize DSH fs-tool args to the `path` shape lib scanners read.
 * Native replacement: `normalizeDshToolArgs` (already called by the DSH
 * guard before any check — this re-export is only for unmigrated code).
 */
export function shimNormalizeArgs(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  return normalizeDshToolArgs(toolName, args);
}
