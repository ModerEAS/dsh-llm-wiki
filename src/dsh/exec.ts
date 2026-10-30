/**
 * Subprocess execution with a self-managed deadline (H09/H32).
 *
 * Upstream ingest shells out to markitdown (uvx) / curl with a `timeout`
 * option, but that runs as a background spawn — NOT a model tool call — so
 * neither DSH's `spawn` (no timeout field) nor the tool-call timeout policy
 * (model tool calls only; and `defineTool.timeoutMs` is declarative, never
 * enforced) covers it. An ignored timeout hangs the single-flight ingest
 * lock for that label forever. The plugin therefore owns its deadline:
 * `AbortSignal.timeout(ms)` → `handle.terminate()`.
 *
 * Execution goes through `ctx.subprocess.spawn` (stays inside DSH's process
 * containment) with a Node `execFile` fallback for harnesses/tests without
 * the service. Env allow-listing is explicit: DSH scrubs `*KEY*`/`*TOKEN*`
 * and `DSH_*` from inherited env, so secrets must be passed via `env`.
 */
import { execFile } from "node:child_process";
import { type ApprovalPolicy, checkSpawn } from "./approval.js";
import type { DshContext } from "./types.js";

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  policy?: ApprovalPolicy;
  signal?: AbortSignal;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
}

const DEFAULT_TIMEOUT_MS = 180_000;

function toExecError(command: string, result: ExecResult): Error {
  if (result.killed) return new Error(`Command timed out or was aborted: ${command}`);
  const detail = result.stderr.trim();
  return new Error(
    `Command failed (${command} exited ${result.code})${detail ? `: ${detail}` : ""}`,
  );
}

async function runViaSubprocess(
  ctx: DshContext,
  command: string,
  args: string[],
  opts: ExecOptions,
  deadline: AbortSignal,
): Promise<ExecResult> {
  const handle = ctx.subprocess?.spawn?.({
    command,
    args,
    cwd: opts.cwd,
    env: opts.env,
    signal: deadline,
  });
  if (!handle) throw new Error("subprocess.spawn unavailable");
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  let code = 0;
  let killed = false;
  try {
    const outcome = (await handle.done) as
      | { stdout?: unknown; stderr?: unknown; exitCode?: unknown }
      | undefined;
    if (typeof outcome?.stdout === "string") stdoutChunks.push(outcome.stdout);
    if (typeof outcome?.stderr === "string") stderrChunks.push(outcome.stderr);
    if (typeof outcome?.exitCode === "number") code = outcome.exitCode;
  } catch (error) {
    // `done` rejects when spawn itself fails — that rejection does not prove
    // whether the target ran, so report it plainly and let the caller retry.
    killed = deadline.aborted;
    if (!killed) throw error instanceof Error ? error : new Error(String(error));
  } finally {
    if (deadline.aborted) {
      killed = true;
      try {
        handle.terminate?.();
      } catch {
        /* best effort */
      }
    }
  }
  void stdoutChunks;
  void stderrChunks;
  return { stdout: stdoutChunks.join(""), stderr: stderrChunks.join(""), code, killed };
}

function runViaNode(
  command: string,
  args: string[],
  opts: ExecOptions,
  deadline: AbortSignal,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    if (deadline.aborted) {
      resolve({ stdout: "", stderr: "", code: -1, killed: true });
      return;
    }
    const child = execFile(
      command,
      args,
      {
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
        maxBuffer: 32 * 1024 * 1024,
        signal: deadline,
      },
      (error, stdout, stderr) => {
        const killedFlag = (error as { killed?: unknown }).killed === true;
        if (error && (deadline.aborted || killedFlag)) {
          resolve({
            stdout: String(stdout ?? ""),
            stderr: String(stderr ?? ""),
            code: -1,
            killed: true,
          });
          return;
        }
        const code = error && "code" in error ? Number((error as { code: unknown }).code) || 1 : 0;
        resolve({
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          code,
          killed: false,
        });
      },
    );
    deadline.addEventListener("abort", () => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* best effort */
      }
      setTimeout(() => {
        try {
          if (!child.killed) child.kill("SIGKILL");
        } catch {
          /* best effort */
        }
      }, 2000).unref?.();
    });
    child.on("error", (error) => reject(error));
  });
}

/**
 * Raw variant: never throws on exit-code/timeout — reports them in the
 * result (same contract as `pi.exec`). Only spawn-level failures reject.
 * Used to adapt DSH execution to lib helpers that inspect `code`/`killed`
 * themselves (e.g. source capture extractors).
 */
export async function execRaw(
  ctx: DshContext,
  command: string,
  args: string[],
  opts: ExecOptions = {},
): Promise<ExecResult> {
  if (opts.policy && opts.cwd) {
    const verdict = checkSpawn(opts.policy, command, opts.cwd);
    if (!verdict.allowed) throw new Error(verdict.reason);
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = opts.signal
    ? AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  const useSubprocess = typeof ctx.subprocess?.spawn === "function";
  if (useSubprocess) {
    try {
      return await runViaSubprocess(ctx, command, args, opts, deadline);
    } catch (error) {
      if (deadline.aborted) throw error instanceof Error ? error : new Error(String(error));
      // A failed `done` that is NOT our own abort falls back to Node so a
      // half-wired subprocess service never wedges extraction.
    }
  }
  return runViaNode(command, args, opts, deadline);
}

/**
 * Run `command` with a plugin-owned deadline. Rejects on non-zero exit or
 * on timeout/abort (same contract as the pi `exec()` helper in lib/utils).
 */
export async function runCommand(
  ctx: DshContext,
  command: string,
  args: string[],
  opts: ExecOptions = {},
): Promise<ExecResult> {
  const result = await execRaw(ctx, command, args, opts);
  if (result.killed) throw new Error(`Command timed out or was aborted: ${command}`);
  if (result.code !== 0) throw toExecError(command, result);
  return result;
}
