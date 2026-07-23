import { existsSync } from "node:fs";

import {
  buildAgentEnvironment,
  executeCommand,
  knownWindowsCliCandidates,
  resolveGlobalNpmClaudeEntry,
  selectCliCandidate
} from "./agent-cli-probe.mjs";

async function runClaudeBounded(command, args, options = {}) {
  return executeCommand(command, args, {
    ...options,
    env: buildAgentEnvironment("claude")
  });
}

async function resolveClaudeBinary() {
  const npmEntry = await resolveGlobalNpmClaudeEntry(runClaudeBounded);
  const candidates = [
    npmEntry,
    ...knownWindowsCliCandidates("claude")
  ].filter((value) => typeof value === "string" && existsSync(value));
  const selected = selectCliCandidate("claude", candidates);
  if (!selected || !selected.toLowerCase().endsWith("claude.exe")) {
    throw new Error("No verified Claude Code native binary was found.");
  }
  return selected;
}

async function main() {
  if (globalThis.process.platform !== "win32") {
    throw new Error("The Claude Code login launcher currently supports Windows only.");
  }
  globalThis.console.log(await resolveClaudeBinary());
}

main().catch((error) => {
  globalThis.console.error(error instanceof Error ? error.message : String(error));
  globalThis.process.exitCode = 1;
});
