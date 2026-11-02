/**
 * Approval policy (H34): wiki tools allow-list programs + directories,
 * everything else is denied by default.
 *
 * DSH's `tools/pre-execute` degrades `ask` to `deny` when no approval
 * channel is composed (or the call has no agent), and subagents can never
 * escalate — so the wiki lane must be decidable synchronously from the
 * call itself: known-safe subprocess programs and vault-scoped filesystem
 * paths pass, anything else gets a deny with a reason instead of hanging
 * on an approval round-trip that can never arrive.
 */

export interface ApprovalPolicy {
  /** Program basenames the wiki lane may spawn (extractors, indexers). */
  programs: string[];
  /** Directory roots wiki file tools may read/write (vault + project). */
  directories: string[];
}

const DEFAULT_PROGRAMS = ["uvx", "uv", "python3", "python", "curl", "qmd", "node", "markitdown"];

export function defaultPolicy(extraDirs: string[] = []): ApprovalPolicy {
  return { programs: [...DEFAULT_PROGRAMS], directories: [...extraDirs] };
}

function basenameOf(command: string): string {
  const normalized = command.replace(/\\/g, "/");
  const base = normalized.split("/").pop() ?? normalized;
  return base.replace(/\.exe$/i, "").toLowerCase();
}

function normalizeDir(dir: string): string {
  return dir.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** True when `command` resolves to an allow-listed program. */
export function isProgramAllowed(policy: ApprovalPolicy, command: string): boolean {
  const base = basenameOf(command);
  return policy.programs.some((p) => p.toLowerCase() === base);
}

/** True when `absPath` sits inside one of the allow-listed directories. */
export function isPathAllowed(policy: ApprovalPolicy, absPath: string): boolean {
  const candidate = normalizeDir(absPath);
  return policy.directories.some((dir) => {
    const root = normalizeDir(dir);
    return candidate === root || candidate.startsWith(`${root}/`);
  });
}

export type ApprovalVerdict = { allowed: true } | { allowed: false; reason: string };

/** Synchronous gate for a subprocess spawn from the wiki lane. */
export function checkSpawn(policy: ApprovalPolicy, command: string, cwd: string): ApprovalVerdict {
  if (!isProgramAllowed(policy, command)) {
    return {
      allowed: false,
      reason:
        `wiki lane denies program "${basenameOf(command)}" ` +
        `(allow-list: ${policy.programs.join(", ")}). ` +
        `Run it yourself outside the wiki tools if you trust it.`,
    };
  }
  if (cwd && policy.directories.length > 0 && !isPathAllowed(policy, cwd)) {
    return {
      allowed: false,
      reason: `wiki lane denies working directory "${cwd}" (outside allow-listed roots).`,
    };
  }
  return { allowed: true };
}
