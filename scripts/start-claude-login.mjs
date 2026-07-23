import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

import {
  knownWindowsCliCandidates,
  resolveGlobalNpmClaudeEntry,
  selectCliCandidate
} from "./agent-cli-probe.mjs";

function runBounded(command, args, options = {}) {
  return new Promise((resolveResult) => {
    const maxOutputBytes = options.maxOutputBytes ?? 65_536;
    let stdout = "";
    let stderr = "";
    let totalBytes = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const child = spawn(command, args, {
      env: globalThis.process.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      resolveResult(result);
    };

    const append = (target, chunk) => {
      const text = chunk.toString("utf8");
      totalBytes += globalThis.Buffer.byteLength(text, "utf8");
      if (totalBytes > maxOutputBytes) {
        truncated = true;
        child.kill("SIGKILL");
        return target;
      }
      return target + text;
    };

    child.stdout?.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });

    const timer = globalThis.setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs ?? 30_000);

    child.on("error", (error) => {
      finish({
        exitCode: null,
        timedOut,
        truncated,
        complete: false,
        stdout,
        stderr: `${stderr}${error instanceof Error ? error.message : String(error)}`
      });
    });
    child.on("close", (code) => {
      finish({
        exitCode: typeof code === "number" ? code : null,
        timedOut,
        truncated,
        complete: !timedOut && !truncated,
        stdout,
        stderr
      });
    });
  });
}

async function resolveClaudeBinary() {
  const npmEntry = await resolveGlobalNpmClaudeEntry(runBounded);
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
