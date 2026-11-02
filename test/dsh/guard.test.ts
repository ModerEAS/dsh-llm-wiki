import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapVault } from "../../extensions/llm-wiki/lib/bootstrap.js";
import { getVaultPaths, resolveVaultPaths } from "../../extensions/llm-wiki/lib/utils.js";
import {
  decideMutation,
  GUARDED_TOOLS,
  normalizeDshToolArgs,
  selfCheckGuardrails,
} from "../../src/dsh/guard.js";

let root = "";
let wikiHome = "";
const originalWikiHome = process.env.WIKI_HOME;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dsh-guard-"));
  wikiHome = mkdtempSync(join(tmpdir(), "dsh-guard-home-"));
  process.env.WIKI_HOME = wikiHome;
  const result = bootstrapVault(getVaultPaths(root), { topic: "guards", mode: "personal" });
  expect(result.ok).toBe(true);
});

afterEach(() => {
  if (originalWikiHome === undefined) delete process.env.WIKI_HOME;
  else process.env.WIKI_HOME = originalWikiHome;
  rmSync(root, { recursive: true, force: true });
  rmSync(wikiHome, { recursive: true, force: true });
});

describe("normalizeDshToolArgs (file_path → path shim)", () => {
  it("copies file_path onto path for write/edit", () => {
    expect(normalizeDshToolArgs("write", { file_path: "a/b.ts" })).toEqual({
      file_path: "a/b.ts",
      path: "a/b.ts",
    });
    expect(normalizeDshToolArgs("edit", { file_path: "a/b.ts" })).toEqual({
      file_path: "a/b.ts",
      path: "a/b.ts",
    });
  });

  it("leaves str_replace_editor path input untouched", () => {
    const args = { path: "a/b.ts" };
    expect(normalizeDshToolArgs("str_replace_editor", args)).toBe(args);
  });

  it("does not touch other tools", () => {
    const args = { file_path: "a/b.ts" };
    expect(normalizeDshToolArgs("read", args)).toBe(args);
  });

  it("keeps an explicit path over file_path", () => {
    expect(normalizeDshToolArgs("write", { path: "p.ts", file_path: "f.ts" })).toEqual({
      path: "p.ts",
      file_path: "f.ts",
    });
  });

  it("covers exactly write/edit/str_replace_editor", () => {
    expect([...GUARDED_TOOLS].sort()).toEqual(["edit", "str_replace_editor", "write"]);
  });
});

describe("decideMutation", () => {
  it("denies raw/ and meta/ for all three tools", () => {
    const paths = resolveVaultPaths(root);
    for (const tool of ["write", "edit", "str_replace_editor"]) {
      expect(decideMutation(tool, { file_path: join(paths.raw, "x.md") }, root).kind).toBe("deny");
      expect(decideMutation(tool, { path: join(paths.meta, "registry.json") }, root).kind).toBe(
        "deny",
      );
    }
  });

  it("allows ordinary project files (no fail-closed regression)", () => {
    const target = join(root, "src", "index.ts");
    expect(decideMutation("write", { file_path: target }, root)).toEqual({ kind: "allow" });
    expect(decideMutation("edit", { path: target }, root)).toEqual({ kind: "allow" });
    expect(decideMutation("str_replace_editor", { path: target }, root)).toEqual({ kind: "allow" });
  });

  it("denies undecidable edits fail-closed", () => {
    expect(decideMutation("edit", {}, root).kind).toBe("deny");
  });

  it("ignores non-guarded tools", () => {
    expect(decideMutation("read", { file_path: join(root, "x") }, root)).toEqual({ kind: "allow" });
  });

  it("uses forward-slash-safe containment (vault root itself is writable)", () => {
    const page = join(resolveVaultPaths(root).wiki, "concepts", "a.md");
    expect(decideMutation("write", { file_path: page }, root).kind).toBe("allow");
    void sep;
  });
});

describe("selfCheckGuardrails", () => {
  it("passes on a healthy vault and asserts the allow-case", () => {
    const check = selfCheckGuardrails(root);
    expect(check.failures).toEqual([]);
    expect(check.ok).toBe(true);
  });
});
