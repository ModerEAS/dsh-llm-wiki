import { describe, expect, it, vi } from "vitest";
import {
  configForVault,
  createWriteQueue,
  flagPendingRebuild,
  getVaultWriteQueue,
  invalidateVaultConfig,
  pendingRebuildCount,
  takePendingRebuild,
  withVaultWrite,
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

describe("withVaultWrite (process singleton, H30)", () => {
  it("exposes a stable singleton for test spies", () => {
    expect(getVaultWriteQueue()).toBe(getVaultWriteQueue());
  });

  it("serializes same-vault writes in order", async () => {
    const order: string[] = [];
    const root = `/with/${Date.now()}`;
    await Promise.all([
      withVaultWrite(root, async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push("first");
      }),
      withVaultWrite(root, () => {
        order.push("second");
      }),
    ]);
    expect(order).toEqual(["first", "second"]);
    expect(getVaultWriteQueue().pending()).toBe(0);
  });

  it("propagates fn errors but keeps the queue usable", async () => {
    const root = `/with-err/${Date.now()}`;
    await expect(
      withVaultWrite(root, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const seen: string[] = [];
    await withVaultWrite(root, () => {
      seen.push("after");
    });
    expect(seen).toEqual(["after"]);
  });

  it("returns fn values (incl. async)", async () => {
    const root = `/with-val/${Date.now()}`;
    await expect(withVaultWrite(root, () => 42)).resolves.toBe(42);
    await expect(withVaultWrite(root, async () => "ok")).resolves.toBe("ok");
  });

  it("runs different vaults concurrently", async () => {
    const base = `/with-conc/${Date.now()}`;
    let concurrent = 0;
    let maxConcurrent = 0;
    const work = async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 10));
      concurrent--;
    };
    await Promise.all([
      withVaultWrite(`${base}/a`, work),
      withVaultWrite(`${base}/b`, work),
    ]);
    expect(maxConcurrent).toBe(2);
  });

  it("enqueue spy observes production-shaped rebuild traffic", async () => {
    const queue = getVaultWriteQueue();
    const spy = vi.spyOn(queue, "enqueue");
    const root = `/with-spy/${Date.now()}`;
    try {
      await withVaultWrite(root, () => undefined);
      expect(spy).toHaveBeenCalledWith(root, expect.any(Function));
    } finally {
      spy.mockRestore();
    }
  });
});

describe("configForVault autoRecall isolation (T8.2/H05)", () => {
  it("keeps opposite autoRecall flags per vault without cross-cover", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "t82-cfg-"));
    const aRoot = path.join(base, "a");
    const bRoot = path.join(base, "b");
    const aDot = path.join(aRoot, ".llm-wiki");
    const bDot = path.join(bRoot, ".llm-wiki");
    const aPi = path.join(aRoot, ".pi");
    const bPi = path.join(bRoot, ".pi");
    await fs.mkdir(aDot, { recursive: true });
    await fs.mkdir(bDot, { recursive: true });
    await fs.mkdir(aPi, { recursive: true });
    await fs.mkdir(bPi, { recursive: true });
    await fs.writeFile(
      path.join(aPi, "settings.json"),
      JSON.stringify({ "llm-wiki": { autoRecall: false } }),
    );
    await fs.writeFile(
      path.join(bPi, "settings.json"),
      JSON.stringify({ "llm-wiki": { autoRecall: true } }),
    );
    // loadTaskConfig reads project settings via cwd; configForVault uses vaultRoot
    // as the loadTaskConfig argument (see vault-state.ts).
    const a = configForVault(aRoot, aDot, true);
    const b = configForVault(bRoot, bDot, true);
    expect(a.autoRecall).toBe(false);
    expect(b.autoRecall).toBe(true);
    // Mutate A's on-disk flag; B's cached value must stay true until its own invalidate.
    await fs.writeFile(
      path.join(aPi, "settings.json"),
      JSON.stringify({ "llm-wiki": { autoRecall: true } }),
    );
    invalidateVaultConfig(aRoot);
    const a2 = configForVault(aRoot, aDot, true);
    const bStill = configForVault(bRoot, bDot);
    expect(a2.autoRecall).toBe(true);
    expect(bStill.autoRecall).toBe(true);
    expect(bStill).toBe(b);
  });
});
