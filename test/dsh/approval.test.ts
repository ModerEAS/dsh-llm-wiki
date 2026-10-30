import { describe, expect, it } from "vitest";
import {
  checkSpawn,
  defaultPolicy,
  isPathAllowed,
  isProgramAllowed,
} from "../../src/dsh/approval.js";

describe("approval allow-list (H34)", () => {
  it("allows known extractor/indexer programs", () => {
    const policy = defaultPolicy(["/vault", "/proj"]);
    expect(isProgramAllowed(policy, "uvx")).toBe(true);
    expect(isProgramAllowed(policy, "curl")).toBe(true);
    expect(isProgramAllowed(policy, "/usr/bin/python3")).toBe(true);
    expect(isProgramAllowed(policy, "C:\\tools\\qmd.EXE")).toBe(true);
  });

  it("denies anything else by default", () => {
    const policy = defaultPolicy(["/vault"]);
    expect(isProgramAllowed(policy, "bash")).toBe(false);
    expect(isProgramAllowed(policy, "powershell")).toBe(false);
    expect(isProgramAllowed(policy, "evil-uvx")).toBe(false);
  });

  it("scopes filesystem paths to allow-listed roots (case-insensitive)", () => {
    const policy = defaultPolicy(["/VAULT"]);
    expect(isPathAllowed(policy, "/vault/wiki/a.md")).toBe(true);
    expect(isPathAllowed(policy, "/vault")).toBe(true);
    expect(isPathAllowed(policy, "/vault-other/a.md")).toBe(false);
    expect(isPathAllowed(policy, "/etc/passwd")).toBe(false);
  });

  it("checkSpawn denies with a reason naming the allow-list", () => {
    const policy = defaultPolicy(["/vault"]);
    const denied = checkSpawn(policy, "rm", "/vault");
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.reason).toContain("allow-list");
    const outside = checkSpawn(policy, "curl", "/tmp");
    expect(outside.allowed).toBe(false);
    expect(checkSpawn(policy, "curl", "/vault/raw")).toEqual({ allowed: true });
  });
});
