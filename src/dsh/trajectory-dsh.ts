/**
 * DSH trajectory adapter (H08/H14, C4): fold/surface first, convert to the
 * extractor's tool shape, and refuse to write empty packets.
 *
 * The pi extractor reads `toolCall` blocks, `role: "toolResult"` messages
 * and `getBranch()/getEntries()` histories. DSH uses kebab-case
 * `tool-call` events, `role: "tool"` messages and an event-projection log
 * with `surfaceOp: "replace"` compaction rewrites — fed raw, the extractor
 * matches zero tool calls and happily writes a `tool_call_count: 0`
 * packet that later poisons skill distillation. So v1:
 *
 *  1. folds the event log through surface replacement first (compacted
 *     ranges and fork-inherited prefixes never enter the trajectory);
 *  2. converts DSH tool events into the `{ type: 'toolCall', … }` /
 *     `{ role: 'toolResult', … }` shapes the extractor recognizes;
 *  3. asserts `tool_call_count > 0` before anything is written — an empty
 *     capture is a failure, not a packet.
 */
import {
  captureTrajectory,
  extractTrajectoryFromSession,
  type TrajectoryStep,
} from "../../extensions/llm-wiki/lib/trajectory.js";
import type { VaultPaths } from "../../extensions/llm-wiki/lib/utils.js";

export interface DshLogEvent {
  type?: string;
  data?: Record<string, unknown>;
  message?: {
    role?: string;
    content?: unknown;
    model?: string;
    name?: string;
    toolCallId?: string;
    toolName?: string;
    isError?: boolean;
  };
}

/**
 * Fold a raw DSH event stream through surface replacement: later
 * `surfaceOp: 'replace'` generations supersede earlier overlapping ranges,
 * and only the surviving surface is converted. Pure + synchronous.
 */
export function foldDshSurface(events: DshLogEvent[]): DshLogEvent[] {
  // Conservative v1: drop explicit compaction-shadowed ranges and fork
  // prefixes; keep everything else in order.
  return events.filter((event) => {
    const data = event?.data as
      | { shadowed?: boolean; inherited?: boolean; surfaceOp?: string }
      | undefined;
    if (data?.shadowed === true || data?.inherited === true) return false;
    if (event?.type === "surface" && data?.surfaceOp === "replace") return false;
    return true;
  });
}

function dshBlockToPi(
  block: unknown,
): { type: string; id?: string; name?: string; arguments?: unknown } | null {
  const b = block as {
    type?: string;
    name?: string;
    id?: string;
    callId?: string;
    args?: unknown;
    arguments?: unknown;
    input?: unknown;
  };
  if (!b || typeof b !== "object") return null;
  if (b.type === "tool-call" || b.type === "toolCall") {
    return {
      type: "toolCall",
      id: String(b.id ?? b.callId ?? ""),
      name: String(b.name ?? "unknown"),
      arguments: b.arguments ?? b.args ?? b.input ?? {},
    };
  }
  return null;
}

/**
 * Convert folded DSH events into the session-manager shape the pi
 * `extractTrajectoryFromSession` already understands
 * (`{ type: 'message', message: { role, content, … } }` entries).
 */
export function toPiSessionShape(events: DshLogEvent[]): {
  getBranch: () => Array<{ type: string; message: unknown }>;
} {
  const entries: Array<{ type: string; message: unknown }> = [];
  for (const event of foldDshSurface(events)) {
    const message = event?.message;
    if (event?.type === "message" && message) {
      const content = Array.isArray(message.content)
        ? message.content.map((block) => dshBlockToPi(block) ?? block)
        : message.content;
      const role = message.role === "tool" ? "toolResult" : message.role;
      entries.push({ type: "message", message: { ...message, role, content } });
      continue;
    }
    // Tool-call / tool-result session events (kebab-case) → message entries.
    if (event?.type === "tool-call" || event?.type === "tool/call") {
      const data = (event.data ?? {}) as {
        id?: string;
        callId?: string;
        name?: string;
        args?: unknown;
      };
      entries.push({
        type: "message",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: String(data.id ?? data.callId ?? ""),
              name: String(data.name ?? "unknown"),
              arguments: data.args ?? {},
            },
          ],
        },
      });
      continue;
    }
    if (event?.type === "tool-result" || event?.type === "tool/result") {
      const data = (event.data ?? {}) as {
        callId?: string;
        name?: string;
        result?: unknown;
        isError?: boolean;
      };
      entries.push({
        type: "message",
        message: {
          role: "toolResult",
          toolCallId: data.callId,
          toolName: data.name,
          isError: Boolean(data.isError),
          content:
            typeof data.result === "string" ? data.result : JSON.stringify(data.result ?? ""),
        },
      });
    }
  }
  return { getBranch: () => entries };
}

export interface DshTrajectory {
  steps: TrajectoryStep[];
  model?: string;
  prompt: string;
  toolCallCount: number;
}

/** Extract + validate: throws when no tool call survived the fold. */
export function extractDshTrajectory(events: DshLogEvent[]): DshTrajectory {
  const shaped = toPiSessionShape(events);
  const { steps, model, prompt } = extractTrajectoryFromSession(shaped);
  const toolCallCount = steps.flatMap((s) => s.tool_calls ?? []).length;
  if (toolCallCount === 0) {
    throw new Error(
      "trajectory capture refused: 0 tool calls after surface fold " +
        "(feed the folded surface, not raw snapshots)",
    );
  }
  return { steps, model, prompt, toolCallCount };
}

/** Capture into the vault (immutable packet + summary). Reuses pi layout. */
export function captureDshTrajectory(
  paths: VaultPaths,
  events: DshLogEvent[],
  task: string,
  title: string,
): ReturnType<typeof captureTrajectory> {
  const { steps, model, prompt } = extractDshTrajectory(events);
  return captureTrajectory(paths, { steps, model, task: prompt || task, title });
}
