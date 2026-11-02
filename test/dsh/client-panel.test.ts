import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const clientPath = join(root, "dsh/client.js");
const iconPath = join(root, "dsh/icon.svg");

interface Node {
  type: string;
  props: Record<string, unknown>;
  children: unknown[];
}

const hooks = { states: [] as unknown[], cursor: 0 };

function flatten(children: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const child of children) {
    if (Array.isArray(child)) out.push(...flatten(child));
    else if (child != null && child !== false && child !== true) out.push(child);
  }
  return out;
}

function createElement(
  type: unknown,
  props: Record<string, unknown> | null,
  ...children: unknown[]
) {
  const flat = flatten(children);
  const next: Record<string, unknown> = { ...(props ?? {}) };
  if (flat.length > 0 && next.children == null) next.children = flat.length === 1 ? flat[0] : flat;
  if (typeof type === "function") return type(next);
  return { type, props: next, children: flat } satisfies Node;
}

const react = {
  createElement,
  useState(init: unknown) {
    const value = hooks.cursor < hooks.states.length ? hooks.states[hooks.cursor] : init;
    hooks.cursor += 1;
    return [value, () => undefined] as const;
  },
  useRef(value: unknown) {
    return { current: value };
  },
  useCallback<T>(fn: T) {
    return fn;
  },
  useEffect() {
    return undefined;
  },
  useSyncExternalStore(_subscribe: unknown, getSnapshot: () => unknown) {
    return getSnapshot();
  },
};

function loadPlugin() {
  const code = readFileSync(clientPath, "utf8");
  let plugin: { apply: (ctx: unknown) => void } | undefined;
  const sandbox = {
    console,
    window: {
      __ModuleLoader__: {
        load(def: {
          factory: (require: (id: string) => unknown) => { apply: (ctx: unknown) => void };
        }) {
          plugin = def.factory((id) => {
            if (id === "react") return react;
            throw new Error(`unexpected require ${id}`);
          });
        },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "dsh/client.js" });
  if (!plugin) throw new Error("client factory did not load");
  return plugin;
}

function registered() {
  const found = new Map<string, (props: Record<string, unknown>) => unknown>();
  const scope = {
    subscribe: () => () => undefined,
    getSnapshot: () => ({
      status: "ready",
      writable: true,
      value: { autoRecall: true, notices: true, trajectories: false, taskModel: "" },
    }),
    set: async () => true,
  };
  loadPlugin().apply({
    locale: {
      bind: () => (key: string) => key,
      register: () => () => undefined,
    },
    configForms: { get: () => scope },
    slots: {
      inject(_name: string, fn: () => void) {
        fn();
        return () => undefined;
      },
      register(
        meta: { name: string; id?: string; key?: string },
        component: (props: Record<string, unknown>) => unknown,
      ) {
        found.set(`${meta.name}:${meta.id || meta.key || ""}`, component);
        return () => undefined;
      },
    },
    effect(fn: () => void) {
      return fn();
    },
    logger: { info() {}, warn() {} },
  });
  return { found, scope };
}

function render(
  component: (props: Record<string, unknown>) => unknown,
  props: Record<string, unknown>,
  states: unknown[],
) {
  hooks.states = states;
  hooks.cursor = 0;
  return component(props);
}

function texts(node: unknown, out: string[] = []): string[] {
  if (node == null || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) texts(child, out);
    return out;
  }
  if (typeof node === "object") {
    const record = node as { props?: Record<string, unknown>; children?: unknown };
    if (record.props) {
      for (const value of Object.values(record.props)) {
        if (typeof value === "string" || typeof value === "number") out.push(String(value));
        else texts(value, out);
      }
    }
    texts(record.children, out);
  }
  return out;
}

const fixture = {
  ok: true,
  vaultRoot: "/home/box",
  vaults: ["/home/box", "/home/box/other"],
  status: {
    topic: "MiruPlay",
    mode: "personal",
    knowledgeFormat: "okf-0.2",
    totalPages: 2275,
    byType: { concept: 12 },
    orphans: 254,
    gaps: 745,
    health: "⚠️ Warning",
    lastUpdated: "",
    blockingDiagnostics: [{ code: "E_TEST", message: "broken link" }],
    qmd: {
      state: "recovering",
      totalDocuments: 8,
      canonicalDocuments: 6,
      evidenceDocuments: 2,
      needsEmbedding: 8,
      qmdVersion: "2.8.3",
      issues: [{ code: "QMD_TEST", message: "index torn" }],
    },
    capabilities: {
      semantic: "off",
      jobs: "unknown",
      cwd: "/home/box",
      autoRecall: true,
      trajectories: false,
      notices: true,
      taskModel: "(session model)",
    },
  },
  dashboard: {
    rawQueue: 3,
    zeroBacklinks: 254,
    staleCount: 0,
    embEnabled: false,
    last7dTotal: 4,
    last7dByKind: { observe: 4 },
  },
  ui: {
    modelLabel: "",
    toolCount: 18,
    lastRecallCount: 2,
    lastBackground: "ingest finished",
    background: [{ label: "ingest", phase: "running", note: "page 1" }],
    setupMessage: "Wiki created",
  },
};

describe("dsh webui status panel", () => {
  it("ships a monochrome stroke icon instead of the brain emoji", () => {
    const source = readFileSync(clientPath, "utf8");
    const icon = readFileSync(iconPath, "utf8");
    expect(source).not.toContain("🧠");
    expect(icon).not.toContain("🧠");
    expect(icon).toContain('stroke="currentColor"');
    expect(icon).toContain('stroke-width="1"');
    expect(source).toContain(icon.match(/d="([^"]+)"/)?.[1]);

    const { found } = registered();
    const glyph = render(
      found.get("sidebar.panellist:wiki-status") as (props: Record<string, unknown>) => Node,
      { size: 16 },
      [],
    );
    expect(glyph.type).toBe("svg");
    expect(glyph.props.stroke).toBe("currentColor");
    expect(glyph.props.strokeWidth).toBe(1);
    expect(glyph.props.width).toBe(16);
    expect(glyph.children).toHaveLength(2);
    expect(JSON.stringify(glyph)).not.toContain("🧠");
  });

  it("renders the status payload as sectioned cards and keeps refresh", () => {
    const { found, scope } = registered();
    const panel = found.get("main:wiki-status");
    expect(panel).toBeTypeOf("function");
    const tree = render(
      panel as (props: Record<string, unknown>) => unknown,
      { scope, t: (key: string) => key },
      [null, { loading: false, data: fixture, error: null }],
    );
    const blob = texts(tree).join("\n");
    for (const needle of [
      "Refresh",
      "Settings",
      "Vault",
      "Capabilities",
      "Activity",
      "MiruPlay",
      "Warning",
      "2275",
      "254",
      "745",
      "Never",
      "concept 12",
      "E_TEST",
      "broken link",
      "Recovering",
      "2.8.3",
      "canonical",
      "QMD_TEST",
      "/home/box",
      "other",
      "Unknown",
      "18",
      "2 pages",
      "ingest finished",
      "Running",
      "Wiki created",
      "observe 4",
      "Edit in Settings → LLM Wiki",
      "(session model)",
    ]) {
      expect(blob, needle).toContain(needle);
    }
    expect(blob).not.toContain("🧠");
    expect(JSON.stringify(tree)).toContain("⚠️ Warning");
  });

  it("keeps the empty and loading states", () => {
    const { found, scope } = registered();
    const panel = found.get("main:wiki-status") as (props: Record<string, unknown>) => unknown;
    const props = { scope, t: (key: string) => key };
    const loading = texts(
      render(panel, props, [null, { loading: true, data: null, error: null }]),
    ).join("\n");
    expect(loading).toContain("Loading wiki status…");
    const missing = texts(
      render(panel, props, [null, { loading: false, data: { ok: false }, error: null }]),
    ).join("\n");
    expect(missing).toContain("No wiki vault here yet.");
    expect(missing).toContain("/wiki-bootstrap <topic>");
    expect(missing).not.toContain("MiruPlay");
  });

  it("docks a transient line with the line icon and hides when empty", () => {
    const { found } = registered();
    const dock = found.get("conversation.composer.dock:wiki-dock") as (
      props: Record<string, unknown>,
    ) => unknown;
    expect(render(dock, {}, [null])).toBeNull();
    const tree = render(dock, { sessionId: "sess-1" }, ["recalled 2 page(s) for this task"]);
    const blob = JSON.stringify(tree);
    expect(blob).toContain("recalled 2 page(s) for this task");
    expect(blob).toContain("llm-wiki");
    expect(blob).not.toContain("🧠");
  });
});
