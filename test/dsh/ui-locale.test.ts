import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../..", import.meta.url);

function read(path: string): string {
  return readFileSync(new URL(path, root), "utf8");
}

function dictionaryJson(source: string): string {
  const start = source.indexOf("// UI_DICTIONARY_START");
  const end = source.indexOf("// UI_DICTIONARY_END");
  if (start < 0 || end < start) throw new Error("UI dictionary markers missing");
  const block = source.slice(start, end);
  const jsonStart = block.indexOf("{");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = jsonStart; i < block.length; i++) {
    const char = block[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return block.slice(jsonStart, i + 1);
    }
  }
  throw new Error("unterminated UI dictionary");
}

function dictionaries(): { en: Record<string, string>; zh: Record<string, string> } {
  // Biome leaves identifier keys unquoted, so the object is JavaScript, not JSON.
  return new Function(`return (${dictionaryJson(read("dsh/client.js"))})`)() as {
    en: Record<string, string>;
    zh: Record<string, string>;
  };
}

function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

describe("DSH locale", () => {
  it("mirrors the screen dictionary beside plugin-list meta", () => {
    const { en, zh } = dictionaries();
    for (const [lang, dict] of [
      ["en", en],
      ["zh", zh],
    ] as const) {
      const doc = JSON.parse(read(`dsh/locale/${lang}.json`)) as {
        meta?: { title?: string; description?: string };
      } & Record<string, unknown>;
      expect(doc.meta?.title).toBe(dict["meta.title"]);
      expect(doc.meta?.description).toBe(dict["meta.description"]);
      const screen = Object.keys(dict).filter((key) => !key.startsWith("meta."));
      expect(
        Object.keys(doc)
          .filter((key) => key !== "meta")
          .sort(),
      ).toEqual(screen.sort());
      for (const key of screen) expect(doc[key], `${lang}:${key}`).toBe(dict[key]);
    }
  });

  it("ships balanced en/zh screen dictionaries with the same placeholders", () => {
    const { en, zh } = dictionaries();
    const enKeys = Object.keys(en).sort();
    const zhKeys = Object.keys(zh).sort();
    expect(zhKeys).toEqual(enKeys);
    for (const key of enKeys) {
      expect(en[key].trim().length, key).toBeGreaterThan(0);
      expect(zh[key].trim().length, key).toBeGreaterThan(0);
      expect(placeholders(zh[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it("resolves every screen key the client asks to translate", () => {
    const source = read("dsh/client.js");
    const body = source.slice(source.indexOf("// UI_DICTIONARY_END"));
    const { en } = dictionaries();
    const keys = [
      ...body.matchAll(/tr\(\s*[^,]+,\s*"([^"]+)"/g),
      ...body.matchAll(/(?:label|hint)Key:\s*"([^"]+)"/g),
      ...body.matchAll(/"((?:status|field|panel|notice|dock)(?:\.[A-Za-z0-9]+)+)"/g),
    ].map((match) => match[1]);
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) expect(en, key).toHaveProperty(key);
    expect(body).not.toContain("inject: () => ({ scope, t })");
    expect(body).toContain("locale: NS");
  });

  it("covers every host locale code and matches the English fallback sentence", () => {
    const { en } = dictionaries();
    const host = [
      ...new Set(
        ["src/dsh/index.ts", "src/dsh/background.ts", "src/dsh/recall-inject.ts"].flatMap((file) =>
          [...read(file).matchAll(/(?:setupCode|code): "([^"]+)"/g)].map((match) => match[1]),
        ),
      ),
    ];
    expect(host.sort()).toEqual([
      "dock.backgroundFailed",
      "dock.backgroundStarted",
      "dock.recalled",
      "notice.blocked",
      "notice.created",
      "notice.layoutFixed",
    ]);
    for (const code of host) expect(en, code).toHaveProperty(code);
    expect(fill(en["dock.recalled"], { count: 2 })).toBe("recalled 2 page(s) for this task");
    expect(fill(en["dock.backgroundStarted"], { label: "ingest" })).toBe(
      "background ingest started",
    );
    expect(fill(en["dock.backgroundFailed"], { label: "ingest" })).toBe("background ingest failed");
    expect(fill(en["notice.layoutFixed"], { count: 3 })).toBe(
      "Personal wiki layout fixed: flattened 3 entries.",
    );
    expect(en["notice.created"]).toBe("Wiki created (topic pending).");
    expect(en["notice.blocked"]).toBe("Wiki setup blocked (bootstrap).");
  });

  it("recognizes the status tokens the host emits", () => {
    const runners = read("src/dsh/runners.ts");
    const client = read("dsh/client.js");
    const { en } = dictionaries();
    for (const token of ["🔴 Empty", "⚠️ Warning", "✅ Good", "available", "missing", "unknown"]) {
      expect(runners).toContain(token);
    }
    expect(client).toContain('tr(t, "panel.badge.empty", "Empty")');
    expect(client).toContain('tr(t, "panel.badge.warning", "Warning")');
    expect(client).toContain('tr(t, "panel.badge.good", "Good")');
    expect(en["panel.badge.available"]).toBe("Available");
    expect(en["panel.badge.missing"]).toBe("Missing");
    expect(en["panel.badge.unknown"]).toBe("Unknown");
  });
});
