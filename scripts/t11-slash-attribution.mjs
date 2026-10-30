/**
 * T11.1/T11.2: prove slash attribution via CommandRuntime.execute
 * (the same API interactive UI adapters call). Headless has no command
 * adapter, so typing "/wiki-status" into headless still goes to the model;
 * this harness is the discriminating execute→command/run|done path.
 */
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire("/workspace/scratch/coding/dsh-local-runtime/package.json");
const { Context } = await import(pathToFileURL(require.resolve("@deepseek-ai/cordis")).href);
const { default: CommandRuntime, parseCommand } = await import(
  pathToFileURL(require.resolve("@deepseek-ai/dsh-commands")).href
);
const { default: SessionStore, SessionId } = await import(
  pathToFileURL(require.resolve("@deepseek-ai/dsh-session")).href
);

const wikiRoot = "/workspace/projects/dsh-llm-wiki";
const { bootstrapVault } = await import(pathToFileURL(join(wikiRoot, "dist/dsh/extensions/llm-wiki/lib/bootstrap.js")).href);
const { getVaultPaths } = await import(pathToFileURL(join(wikiRoot, "dist/dsh/extensions/llm-wiki/lib/utils.js")).href);
const { createDshRuntime } = await import(pathToFileURL(join(wikiRoot, "dist/dsh/src/dsh/background.js")).href);
const { registerWikiCommands } = await import(pathToFileURL(join(wikiRoot, "dist/dsh/src/dsh/commands.js")).href);
const { createLogger } = await import(pathToFileURL(join(wikiRoot, "dist/dsh/src/dsh/logger.js")).href);

const vault = mkdtempSync(join(tmpdir(), "t11-slash-"));
const wikiHome = mkdtempSync(join(tmpdir(), "t11-slash-home-"));
process.env.WIKI_HOME = wikiHome;
const boot = bootstrapVault(getVaultPaths(vault), { topic: "T11 slash", mode: "personal" });
if (!boot.ok) throw new Error("bootstrap failed");

const ctx = new Context();
await ctx.plugin(SessionStore);
await ctx.plugin(CommandRuntime);

// Provide workingDirectory so agentCwd resolves to the vault (D1).
ctx.provide("workingDirectory", { get: () => vault });

const session = ctx.sessions.create(SessionId("t11-slash-attrib"));
const followups = [];
const agent = {
  id: session.id,
  session,
  followup: (input) => followups.push(input),
};

const logger = createLogger(undefined);
const runtime = createDshRuntime(ctx, logger);
const registered = registerWikiCommands({ ctx, runtime, logger });
if (registered.length < 8) throw new Error(`expected >=8 commands, got ${registered.length}: ${registered}`);

const signal = AbortSignal.timeout(30_000);

// T11.1 query path: /wiki-status → direct execute, command/run+done
const statusExec = await ctx.commands.execute(agent, "/wiki-status", [], signal);
if (!statusExec) throw new Error("wiki-status execute returned undefined (not registered?)");
const statusLifecycle = session
  .snapshotEvents()
  .filter((e) => e.type === "command/run" || e.type === "command/done")
  .map((e) => ({ type: e.type, name: e.data?.name, kind: e.data?.kind ?? e.data?.outcome?.kind }));

// T11.2 work path: /wiki-bootstrap → followup with llm-wiki-command source
const bootExec = await ctx.commands.execute(agent, "/wiki-bootstrap T11 attribution topic", [], signal);
if (!bootExec) throw new Error("wiki-bootstrap execute returned undefined");

const report = {
  parseStatus: parseCommand("/wiki-status"),
  parseBootstrap: parseCommand("/wiki-bootstrap T11 attribution topic"),
  registeredCount: registered.length,
  registered,
  status: {
    result: statusExec.result,
    commandId: statusExec.commandId,
    lifecycle: statusLifecycle.slice(0, 4),
  },
  bootstrap: {
    result: bootExec.result,
    followups,
  },
};
console.log(JSON.stringify(report, null, 2));

const out = "/workspace/artifacts/dsh-llm-wiki/test-results/T11-slash-attribution.json";
await import("node:fs/promises").then((fs) => fs.writeFile(out, JSON.stringify(report, null, 2)));

rmSync(vault, { recursive: true, force: true });
rmSync(wikiHome, { recursive: true, force: true });

if (statusExec.result?.kind !== "success") throw new Error("status not success");
if (!String(statusExec.result.text || "").includes("LLM Wiki Status")) {
  throw new Error("status text missing");
}
if (!statusLifecycle.some((e) => e.type === "command/run") || !statusLifecycle.some((e) => e.type === "command/done")) {
  throw new Error("missing command lifecycle events");
}
if (followups.length < 1 || followups[0]?.source?.kind !== "llm-wiki-command") {
  throw new Error(`expected llm-wiki-command followup, got ${JSON.stringify(followups)}`);
}
console.error("T11_SLASH_ATTRIBUTION_OK");
