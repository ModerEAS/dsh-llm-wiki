#!/usr/bin/env node
// Build the DSH-native plugin (src/dsh + src/compat + reused lib cores)
// into dist/dsh/, the tree dsh/host-index.js re-exports.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

execFileSync("node_modules/.bin/tsc", ["-p", "tsconfig.dsh.json"], { stdio: "inherit" });

// DSH-PATCH (D8): `@earendil-works/pi-coding-agent` is not shipped in the
// DSH host process, but `lib/host.ts` statically imports `getAgentDir` from
// it (settings-file discovery). Rewriting that ONE import in the dist output
// to a local stub keeps the shipped source identical for pi/omp/tests while
// the DSH bundle stays loadable. Every host.ts call site already tolerates a
// throwing getAgentDir ("" / [] / HOME fallback), so the stub degrades to
// "no global settings file" — project settings (.dsh/settings.json) work.
const hostJs = join("dist", "dsh", "extensions", "llm-wiki", "lib", "host.js");
const stubJs = join("dist", "dsh", "pi-coding-agent-stub.js");
writeFileSync(
  stubJs,
  'export function getAgentDir() { throw new Error("getAgentDir unavailable in DSH"); }\n',
);
const source = readFileSync(hostJs, "utf-8");
const rewritten = source.replace(
  /from\s+"@earendil-works\/pi-coding-agent"/,
  'from "../../../pi-coding-agent-stub.js"',
);
if (rewritten === source) {
  throw new Error("build-dsh: expected pi-coding-agent import in dist host.js (drift?)");
}
writeFileSync(hostJs, rewritten);
console.log("dsh build complete → dist/dsh/ (install with plugin_manager install_bundle → dsh/)");
