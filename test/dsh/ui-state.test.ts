import { describe, expect, it } from "vitest";
import {
  getSessionLines,
  getUiSnapshot,
  knownVaults,
  patchUiState,
  pushSessionLine,
  resetUiState,
} from "../../src/dsh/ui-state.js";

describe("ui-state (G4)", () => {
  it("starts blank and unknown", () => {
    resetUiState();
    const snap = getUiSnapshot("/nope");
    expect(snap.loaded).toBe(false);
    expect(snap.vaultRoot).toBe("/nope");
    expect(knownVaults()).toEqual([]);
  });

  it("patches merge and track last-active", () => {
    resetUiState();
    patchUiState("/v/a", { loaded: true, toolCount: 18 });
    patchUiState("/v/b", { loaded: true, toolCount: 5 });
    expect(knownVaults()[0]).toBe("/v/b");
    const snap = getUiSnapshot();
    expect(snap.vaultRoot).toBe("/v/b");
    expect(snap.toolCount).toBe(5);
    // Earlier vault keeps its own values.
    expect(getUiSnapshot("/v/a").toolCount).toBe(18);
  });

  it("tracks background job phases without losing history", () => {
    resetUiState();
    patchUiState("/v", { background: { label: "ingest:X", phase: "running", at: "t0" } });
    patchUiState("/v", {
      background: { label: "ingest:X", phase: "done", at: "t1", note: "ok" },
    });
    const snap = getUiSnapshot("/v");
    expect(snap.background).toHaveLength(1);
    expect(snap.background[0].phase).toBe("done");
    expect(snap.lastBackground).toBe("ok");
  });

  it("caps session lines and background jobs", () => {
    resetUiState();
    for (let i = 0; i < 5; i++) pushSessionLine("s1", `line ${i}`);
    expect(getSessionLines("s1")).toHaveLength(3);
    expect(getSessionLines("s1")[2].text).toBe("line 4");
    expect(getSessionLines("s2")).toEqual([]);
    for (let i = 0; i < 12; i++) {
      patchUiState("/v", { background: { label: `j${i}`, phase: "done", at: "t" } });
    }
    expect(getUiSnapshot("/v").background).toHaveLength(10);
  });

  it("ignores empty keys and resets", () => {
    resetUiState();
    patchUiState("/v", { loaded: true });
    resetUiState();
    expect(knownVaults()).toEqual([]);
    expect(getUiSnapshot("/v").loaded).toBe(false);
  });
});
