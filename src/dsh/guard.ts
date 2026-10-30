/**
 * Filesystem guardrail for DSH (H01/D2/D3): `file_path` → `path` shim,
 * raw/meta deny, and a startup self-check.
 *
 * DSH's built-in `write`/`edit` take `file_path`; the wiki mutation scanner
 * ported from pi only reads `path`. Without normalization the guard sees
 * `undefined` and fail-closes (lib/utils `isProtectedPath` → "Cannot safely
 * resolve") — every write/edit denied, including innocent project files —
 * while `str_replace_editor` (which already uses `path`) would slip past a
 * guard that only watches write/edit. So before ANY check, for exactly the
 * three disk-mutating tools (`write`, `edit`, `str_replace_editor`), copy
 * `file_path` onto `path`. Nothing else is renamed and the official tool
 * signatures are untouched.
 *
 * Enforcement is two-layer, mirroring DSH guidance: a synchronous
 * `ctx.tools.guard` (monotonic deny, survives listener ordering) plus a
 * `tools/pre-execute` waterfall listener that returns `deny` (never `ask`:
 * with no approval channel `ask` degrades to deny anyway, and subagents
 * cannot escalate). Wiki edits additionally flag a per-vault rebuild
 * (vault-state, keyed — not the pi module-global boolean).
 */
import {
  extractMutationPaths,
  hasWikiMutation,
  mutationBlockReason,
} from "../../extensions/llm-wiki/lib/guardrails.js";
import { resolveVaultPaths } from "../../extensions/llm-wiki/lib/utils.js";
import type { WikiLogger } from "./logger.js";
import type { DshContext, DshToolExec } from "./types.js";
import { flagPendingRebuild } from "./vault-state.js";

export const GUARDED_TOOLS = new Set(["write", "edit", "str_replace_editor"]);

/**
 * Copy `file_path` onto `path` for disk-mutating tools. Returns a shallow
 * copy; the caller's original args object is never mutated (DSH freezes it).
 */
export function normalizeDshToolArgs(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (!GUARDED_TOOLS.has(toolName)) return args;
  if (typeof args.path === "string" && args.path.length > 0) return args;
  const filePath = (args as { file_path?: unknown }).file_path;
  if (typeof filePath === "string" && filePath.length > 0) {
    return { ...args, path: filePath };
  }
  return args;
}

export type GuardDecision = { kind: "allow" } | { kind: "deny"; reason: string };

/**
 * Pure decision function (unit-testable without a Harness): normalize, scan
 * mutation paths, deny on the first protected/generated/blocked target.
 * An edit whose targets cannot be determined is denied fail-closed, same as
 * the pi guard.
 */
export function decideMutation(
  toolName: string,
  rawArgs: Record<string, unknown>,
  cwd: string,
): GuardDecision {
  if (!GUARDED_TOOLS.has(toolName)) return { kind: "allow" };
  const args = normalizeDshToolArgs(toolName, rawArgs);
  const targets = extractMutationPaths(args);
  if (targets.length === 0) {
    return { kind: "deny", reason: "Cannot determine the files targeted by this edit." };
  }
  const paths = resolveVaultPaths(cwd);
  for (const target of targets) {
    const reason = mutationBlockReason(target, paths);
    if (reason) return { kind: "deny", reason };
  }
  return { kind: "allow" };
}

/** Resolve the agent's working directory without trusting `process.cwd()`. */
export function agentCwd(ctx: DshContext, exec: DshToolExec): string {
  try {
    const session = exec.agent?.session;
    if (session && typeof ctx.workingDirectory?.get === "function") {
      const dir = ctx.workingDirectory.get(session);
      if (typeof dir === "string" && dir.length > 0) return dir;
    }
  } catch {
    /* fall through to process.cwd() */
  }
  return process.cwd();
}

function recordWikiMutation(args: Record<string, unknown>, cwd: string): void {
  try {
    // Bookkeeping must never break the tool call.
    const paths = resolveVaultPaths(cwd);
    if (hasWikiMutation(args, paths.wiki)) flagPendingRebuild(paths.root);
  } catch {
    /* best effort */
  }
}

/**
 * Install both enforcement layers. Returns disposers; also registers them
 * in `ctx.effect` when available so HMR unload removes them.
 */
export function installDshGuardrails(ctx: DshContext, logger?: WikiLogger): () => void {
  const disposers: Array<() => void> = [];

  try {
    const guard = ctx.tools?.guard;
    if (typeof guard === "function") {
      const dispose = guard((exec: DshToolExec) => {
        try {
          const name = String(exec.name ?? "");
          if (!GUARDED_TOOLS.has(name)) return undefined;
          const cwd = agentCwd(ctx, exec);
          const decision = decideMutation(name, exec.arguments ?? {}, cwd);
          return decision.kind === "deny" ? decision.reason : undefined;
        } catch (error) {
          // Fail closed: an undecidable mutation must not slip through.
          return `wiki guard error: ${(error as Error).message}`;
        }
      });
      if (typeof dispose === "function") disposers.push(dispose);
    }
  } catch (error) {
    logger?.warn(`wiki guard registration failed: ${(error as Error).message}`);
  }

  try {
    if (typeof ctx.on === "function") {
      const off = ctx.on("tools/pre-execute", ((exec: DshToolExec, next: () => unknown) => {
        try {
          const name = String(exec?.name ?? "");
          if (!GUARDED_TOOLS.has(name)) return next();
          const cwd = agentCwd(ctx, exec);
          const decision = decideMutation(name, exec.arguments ?? {}, cwd);
          if (decision.kind === "deny") {
            return { kind: "deny", reason: decision.reason };
          }
          return next();
        } catch (error) {
          return { kind: "deny", reason: `wiki guard error: ${(error as Error).message}` };
        }
      }) as (...args: never[]) => unknown);
      if (typeof off === "function") disposers.push(off);
    }
  } catch (error) {
    logger?.warn(`wiki pre-execute listener failed: ${(error as Error).message}`);
  }

  try {
    if (typeof ctx.on === "function") {
      // Success observer: flag per-vault rebuilds when a wiki page changes.
      // Registered on the observe-only `tools/result` view (no return channel).
      const off = ctx.on("tools/result", ((exec: DshToolExec) => {
        try {
          const name = String(exec?.name ?? "");
          if (!GUARDED_TOOLS.has(name)) return;
          const cwd = agentCwd(ctx, exec);
          const args = normalizeDshToolArgs(name, exec.arguments ?? {});
          recordWikiMutation(args, cwd);
        } catch {
          /* best effort */
        }
      }) as (...args: never[]) => unknown);
      if (typeof off === "function") disposers.push(off);
    }
  } catch (error) {
    logger?.warn(`wiki result observer failed: ${(error as Error).message}`);
  }

  const cleanup = (): void => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose();
      } catch {
        /* best effort */
      }
    }
  };
  try {
    ctx.effect?.(() => cleanup, "llm-wiki guardrails");
  } catch {
    /* headless harnesses may lack ctx.effect */
  }
  return cleanup;
}

/**
 * Startup self-check (H01): drive the REAL decision function with fake
 * calls and assert the guard both blocks and permits. A guard that only
 * blocks raw/ (and fail-closes everything else) would pass a naive
 * "raw is blocked" test while breaking all project writes — so the
 * allow-case assertion is the one that matters.
 */
export function selfCheckGuardrails(
  cwd: string,
  logger?: WikiLogger,
): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const paths = resolveVaultPaths(cwd);
  const rawTarget = `${paths.raw}/probe-check.md`;
  const metaTarget = `${paths.meta}/probe-check.json`;
  const normalTarget = `${cwd.replace(/\\/g, "/")}/src/probe-check.ts`;

  const cases: Array<{
    tool: string;
    args: Record<string, unknown>;
    want: "deny" | "allow";
    label: string;
  }> = [
    {
      tool: "write",
      args: { file_path: rawTarget },
      want: "deny",
      label: "write raw/ via file_path",
    },
    {
      tool: "edit",
      args: { file_path: metaTarget },
      want: "deny",
      label: "edit meta/ via file_path",
    },
    {
      tool: "str_replace_editor",
      args: { path: rawTarget },
      want: "deny",
      label: "str_replace_editor raw/ via path",
    },
    {
      tool: "write",
      args: { file_path: normalTarget },
      want: "allow",
      label: "write project file via file_path",
    },
    {
      tool: "edit",
      args: { path: normalTarget },
      want: "allow",
      label: "edit project file via path",
    },
  ];

  for (const c of cases) {
    let decision: GuardDecision;
    try {
      decision = decideMutation(c.tool, c.args, cwd);
    } catch (error) {
      failures.push(`${c.label}: threw (${(error as Error).message})`);
      continue;
    }
    const got = decision.kind;
    if ((c.want === "deny" && got !== "deny") || (c.want === "allow" && got !== "allow")) {
      failures.push(`${c.label}: want ${c.want}, got ${got}`);
    }
  }

  const ok = failures.length === 0;
  if (!ok) logger?.warn(`wiki guard self-check failed: ${failures.join("; ")}`);
  else logger?.info("wiki guard self-check passed (raw/meta denied, project files allowed)");
  return { ok, failures };
}
