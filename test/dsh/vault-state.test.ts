import { describe, expect, it } from "vitest";
import {
  configForVault,
  createWriteQueue,
  flagPendingRebuild,
  invalidateVaultConfig,
  pendingRebuildCount,
  takePendingRebuild,
} from "../../src/dsh/vault-state.js";

describe("pendingRebuild (per-vault, H04)", () => {
  it("tracks vaults independently", () => {
    flagPendingRebuild("/vault/a");
    flagPendingRebuild("/vault/b");
    expect(pendingRebuildCount()).toBe(2);
    expect(takePendingRebuild("/vault/a")).toBe(true);
    expect(takePendingRebuild("/vault/a")).toBe(false);
    expect(takePendingRebuild("/vault/b")).toBe(true);
    expect(pendingRebuildCount()).toBe(0);
  });
});

describe("configForVault (per-vault cache, H05)", () => {
  it("caches per key and invalidates per key", () => {
    const a1 = configForVault("/vault/a", "/vault/a/.llm-wiki", true);
    const a2 = configForVault("/vault/a", "/vault/a/.llm-wiki");
    expect(a2).toBe(a1);
    invalidateVaultConfig("/vault/a");
    const a3 = configForVault("/vault/a", "/vault/a/.llm-wiki");
    expect(a3).not.toBe(a1);
    expect(a3).toEqual(a1);
  });
});

describe("createWriteQueue (single-writer per vault, H30)", () => {
  it("serializes writes for the same key in order", async () => {
    const queue = createWriteQueue();
    const order: string[] = [];
    const slow = queue.enqueue("/vault/a/registry.json", async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push("slow");
    });
    const fast = queue.enqueue("/vault/a/registry.json", () => {
      order.push("fast");
    });
    expect(queue.pending("/vault/a/registry.json")).toBe(2);
    await Promise.all([slow, fast]);
    expect(order).toEqual(["slow", "fast"]);
    expect(queue.pending()).toBe(0);
  });

  it("isolates failures between queued writes", async () => {
    const queue = createWriteQueue();
    const order: string[] = [];
    await queue.enqueue("/v/r.json", () => {
      throw new Error("disk hiccup");
    });
    await queue.enqueue("/v/r.json", () => {
      order.push("after");
    });
    expect(order).toEqual(["after"]);
  });

  it("runs different keys concurrently", async () => {
    const queue = createWriteQueue();
    let concurrent = 0;
    let maxConcurrent = 0;
    const work = async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 10));
      concurrent--;
    };
    await Promise.all([queue.enqueue("/v/a", work), queue.enqueue("/v/b", work)]);
    expect(maxConcurrent).toBe(2);
  });
});
