/**
 * In-memory Wiki UI state (G4): the Host half of the WebUI sidebar status
 * panel (G1) and composer dock (G2). Ports the pi extension's
 * `ctx.ui.setStatus(...)` call sites — which are no-ops in DSH — into
 * per-vault snapshots served at `/wiki/status.json` and read by
 * `dsh/client.js`.
 *
 * - Keyed by vault root (sidebar is root scope: no sessionId). The most
 *   recently patched vault is the panel default when no `?cwd=` is given.
 * - Per-session transient lines back the composer dock (session scope);
 *   capped so one chatty session cannot grow memory.
 * - `notices: false` gates only the *noisy* transient lines (recall hits,
 *   background start/end notes). Static vault stats are always served —
 *   opening the panel must never show an empty shell.
 */

export interface BackgroundJobState {
  label: string;
  phase: "running" | "done" | "failed";
  at: string;
  note?: string;
}

export interface WikiUiSnapshot {
  vaultRoot: string | null;
  loaded: boolean;
  toolCount: number;
  trajectoriesOn: boolean;
  modelLabel: string | null;
  lastRecallCount: number | null;
  lastRecallAt: string | null;
  setupMessage: string | null;
  lastBackground: string | null;
  background: BackgroundJobState[];
  notices: boolean;
  updatedAt: string;
}

export interface SessionLine {
  text: string;
  at: string;
}

const EMPTY_SNAPSHOT: WikiUiSnapshot = {
  vaultRoot: null,
  loaded: false,
  toolCount: 0,
  trajectoriesOn: false,
  modelLabel: null,
  lastRecallCount: null,
  lastRecallAt: null,
  setupMessage: null,
  lastBackground: null,
  background: [],
  notices: true,
  updatedAt: "",
};

const vaults = new Map<string, WikiUiSnapshot>();
const sessionLines = new Map<string, SessionLine[]>();
let lastActiveVault: string | null = null;

const MAX_SESSION_LINES = 3;
const MAX_BACKGROUND_JOBS = 10;

function now(): string {
  return new Date().toISOString();
}

function blank(vaultRoot: string): WikiUiSnapshot {
  return { ...EMPTY_SNAPSHOT, vaultRoot, background: [], updatedAt: now() };
}

/** Patch (merge) the snapshot for one vault; unknown keys are ignored. */
export function patchUiState(
  vaultRoot: string,
  patch: Partial<Omit<WikiUiSnapshot, "vaultRoot" | "background">> & {
    background?: BackgroundJobState;
  },
): WikiUiSnapshot {
  if (!vaultRoot) return { ...EMPTY_SNAPSHOT };
  const current = vaults.get(vaultRoot) ?? blank(vaultRoot);
  const next: WikiUiSnapshot = { ...current, updatedAt: now() };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "background" || key === "vaultRoot") continue;
    if (value !== undefined) (next as unknown as Record<string, unknown>)[key] = value;
  }
  if (patch.background) {
    const jobs = [...next.background];
    const idx = jobs.findIndex((j) => j.label === patch.background?.label);
    const job = { ...patch.background, at: patch.background.at ?? now() };
    if (idx >= 0) jobs[idx] = job;
    else jobs.push(job);
    next.background = jobs.slice(-MAX_BACKGROUND_JOBS);
    if (patch.background.phase !== "running") next.lastBackground = job.note ?? job.label;
  }
  vaults.set(vaultRoot, next);
  lastActiveVault = vaultRoot;
  return next;
}

/** Snapshot for one vault, the last-active vault, or a blank when unknown. */
export function getUiSnapshot(vaultRoot?: string | null): WikiUiSnapshot {
  if (vaultRoot && vaults.has(vaultRoot)) return vaults.get(vaultRoot) as WikiUiSnapshot;
  if (!vaultRoot && lastActiveVault && vaults.has(lastActiveVault)) {
    return vaults.get(lastActiveVault) as WikiUiSnapshot;
  }
  if (vaultRoot) return blank(vaultRoot);
  return { ...EMPTY_SNAPSHOT };
}

/** Vault roots with state, most-recently-active first. */
export function knownVaults(): string[] {
  const roots = [...vaults.keys()];
  if (lastActiveVault) {
    roots.sort((a, b) => (a === lastActiveVault ? -1 : b === lastActiveVault ? 1 : 0));
  }
  return roots;
}

/** Append a transient per-session line for the composer dock (G2). */
export function pushSessionLine(sessionId: string, text: string): SessionLine[] {
  if (!sessionId || !text) return [];
  const lines = sessionLines.get(sessionId) ?? [];
  lines.push({ text, at: now() });
  const capped = lines.slice(-MAX_SESSION_LINES);
  sessionLines.set(sessionId, capped);
  return capped;
}

/** Recent transient lines for one session (newest last). */
export function getSessionLines(sessionId: string): SessionLine[] {
  return sessionLines.get(sessionId) ?? [];
}

/** Test seam: clear all in-memory UI state. */
export function resetUiState(): void {
  vaults.clear();
  sessionLines.clear();
  lastActiveVault = null;
}
