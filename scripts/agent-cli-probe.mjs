import { execFile, spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SHA_PATTERN = /^[a-f0-9]{40}$/i;
const MARKERS = {
  codex: "PKR_CODEX_PROBE_OK",
  claude: "PKR_CLAUDE_PROBE_OK"
};
const CLI_NAMES = {
  codex: "codex",
  claude: "claude"
};

export async function probeAgentCli(options = {}) {
  const provider = normalizeProvider(options.provider ?? globalThis.process.argv[2]);
  const cwd = resolve(options.cwd ?? globalThis.process.cwd());
  const runCommand = options.runCommand ?? executeCommand;
  const resolveCli = options.resolveCli ?? ((name) => resolveCliCommand(name, runCommand, options.platform ?? globalThis.process.platform));
  const timeoutMs = options.timeoutMs ?? 180_000;
  const maxOutputBytes = options.maxOutputBytes ?? 1_048_576;
  const commandEnv = provider === "claude"
    ? buildClaudeEnvironment(globalThis.process.env, options.platform ?? globalThis.process.platform)
    : globalThis.process.env;

  const before = await readGitState(cwd, runCommand);
  if (!before.clean) {
    throw operationError("WORKTREE_NOT_CLEAN", "The capability probe requires a clean worktree.", {
      changed_paths: before.status.split(/\r?\n/).filter(Boolean).slice(0, 20)
    });
  }

  const cliPath = await resolveCli(CLI_NAMES[provider]);
  const versionResult = await runCommand(cliPath, ["--version"], { cwd, env: commandEnv, timeoutMs: 30_000, maxOutputBytes: 65_536 });
  assertCommandSucceeded(versionResult, "CLI_VERSION_FAILED", `${provider} --version failed.`);

  const globalHelp = await runCommand(cliPath, ["--help"], { cwd, env: commandEnv, timeoutMs: 30_000, maxOutputBytes: 262_144 });
  assertCommandSucceeded(globalHelp, "CLI_HELP_FAILED", `${provider} --help failed.`);

  const providerHelp = provider === "codex"
    ? await runCommand(cliPath, ["exec", "--help"], { cwd, env: commandEnv, timeoutMs: 30_000, maxOutputBytes: 262_144 })
    : globalHelp;
  assertCommandSucceeded(providerHelp, "CLI_HELP_FAILED", `${provider} non-interactive help failed.`);

  const capabilities = detectCapabilities(provider, `${globalHelp.stdout}\n${providerHelp.stdout}`);
  const invocation = buildProbeInvocation(provider, capabilities, cwd);
  const marker = MARKERS[provider];
  const prompt = `Do not modify files and do not run shell commands. Return the exact marker ${marker} and nothing else.`;
  const probeResult = await runCommand(cliPath, invocation.args, {
    cwd,
    input: prompt,
    env: commandEnv,
    timeoutMs,
    maxOutputBytes
  });
  assertCommandSucceeded(probeResult, "CLI_PROBE_FAILED", `${provider} non-interactive probe failed.`);
  validateProbeOutput(provider, probeResult.stdout, marker);

  const after = await readGitState(cwd, runCommand);
  if (after.head !== before.head) {
    throw operationError("PROBE_HEAD_CHANGED", "Repository HEAD changed during the read-only capability probe.", {
      before_head: before.head,
      after_head: after.head
    });
  }
  if (!after.clean) {
    throw operationError("PROBE_WORKTREE_CHANGED", "The read-only capability probe changed the worktree.", {
      changed_paths: after.status.split(/\r?\n/).filter(Boolean).slice(0, 20)
    });
  }

  return {
    ok: true,
    provider,
    mode: "capability_probe",
    cli: basename(cliPath),
    version: firstLine(versionResult.stdout),
    authentication: "verified_by_non_interactive_probe",
    capabilities,
    invocation: {
      command: basename(cliPath),
      args: invocation.redactedArgs,
      cwd_verified: true,
      read_only: true,
      structured_output: true
    },
    git: {
      head_sha: before.head,
      clean_before: before.clean,
      clean_after: after.clean
    },
    output: {
      complete: probeResult.complete,
      truncated: probeResult.truncated,
      marker_verified: true
    },
    warnings: []
  };
}

export function detectCapabilities(provider, helpText) {
  const value = String(helpText ?? "");
  if (provider === "codex") {
    return {
      exec: /(^|\s)exec(\s|$)/m.test(value),
      json: value.includes("--json"),
      sandbox: value.includes("--sandbox"),
      cd: value.includes("--cd") || /(^|\s)-C([,\s]|$)/m.test(value),
      cd_flag: value.includes("--cd") ? "--cd" : /(^|\s)-C([,\s]|$)/m.test(value) ? "-C" : null,
      output_schema: value.includes("--output-schema"),
      output_last_message: value.includes("--output-last-message")
    };
  }
  if (provider === "claude") {
    return {
      print: value.includes("--print") || /(^|\s)-p([,\s]|$)/m.test(value),
      output_format: value.includes("--output-format"),
      max_turns: value.includes("--max-turns"),
      permission_mode: value.includes("--permission-mode"),
      tools: value.includes("--tools"),
      allowed_tools: value.includes("--allowedTools"),
      disallowed_tools: value.includes("--disallowedTools"),
      json_schema: value.includes("--json-schema"),
      max_budget_usd: value.includes("--max-budget-usd"),
      no_session_persistence: value.includes("--no-session-persistence")
    };
  }
  throw operationError("PROVIDER_NOT_SUPPORTED", `Unsupported provider: ${provider}`);
}

export function buildProbeInvocation(provider, capabilities, cwd) {
  if (provider === "codex") {
    requireCapabilities(provider, capabilities, ["exec", "json", "sandbox", "cd"]);
    const args = ["exec", "--json", "--sandbox", "read-only"];
    args.push(capabilities.cd_flag ?? "--cd", cwd, "-");
    return {
      args,
      redactedArgs: args.map((value) => value === cwd ? "<repo-root>" : value)
    };
  }

  if (provider === "claude") {
    requireCapabilities(provider, capabilities, ["print", "output_format", "max_turns", "permission_mode", "disallowed_tools"]);
    const args = [
      "-p",
      "--output-format", "json",
      "--max-turns", "1",
      "--permission-mode", "plan",
      "--disallowedTools", "Bash,Edit,Write,NotebookEdit"
    ];
    if (capabilities.no_session_persistence) args.push("--no-session-persistence");
    return { args, redactedArgs: [...args] };
  }

  throw operationError("PROVIDER_NOT_SUPPORTED", `Unsupported provider: ${provider}`);
}

export function validateProbeOutput(provider, stdout, marker = MARKERS[provider]) {
  const output = String(stdout ?? "").trim();
  if (!output) {
    throw operationError("PROBE_OUTPUT_MISSING", `${provider} returned no structured output.`);
  }

  if (provider === "claude") {
    let parsed;
    try {
      parsed = JSON.parse(output);
    } catch {
      throw operationError("PROBE_OUTPUT_INVALID", "Claude returned invalid JSON output.");
    }
    if (parsed?.is_error === true || parsed?.subtype?.startsWith?.("error")) {
      throw operationError("PROBE_PROVIDER_ERROR", "Claude returned an error result.");
    }
    if (!String(parsed?.result ?? "").includes(marker)) {
      throw operationError("PROBE_MARKER_MISSING", "Claude output did not contain the required probe marker.");
    }
    return;
  }

  if (provider === "codex") {
    const lines = output.split(/\r?\n/).filter(Boolean);
    let parsedCount = 0;
    for (const line of lines) {
      try {
        JSON.parse(line);
        parsedCount += 1;
      } catch {
        throw operationError("PROBE_OUTPUT_INVALID", "Codex returned a non-JSONL output line.");
      }
    }
    if (parsedCount === 0) {
      throw operationError("PROBE_OUTPUT_MISSING", "Codex returned no JSONL events.");
    }
    if (!output.includes(marker)) {
      throw operationError("PROBE_MARKER_MISSING", "Codex output did not contain the required probe marker.");
    }
    return;
  }

  throw operationError("PROVIDER_NOT_SUPPORTED", `Unsupported provider: ${provider}`);
}

async function readGitState(cwd, runCommand) {
  const headResult = await runCommand("git", ["rev-parse", "HEAD"], { cwd, timeoutMs: 10_000, maxOutputBytes: 65_536 });
  assertCommandSucceeded(headResult, "GIT_HEAD_FAILED", "Could not read repository HEAD.");
  const head = String(headResult.stdout ?? "").trim().toLowerCase();
  if (!SHA_PATTERN.test(head)) {
    throw operationError("GIT_HEAD_INVALID", "Git did not return an exact 40-character HEAD SHA.");
  }

  const statusResult = await runCommand("git", ["status", "--porcelain=v1", "--untracked-files=normal"], {
    cwd,
    timeoutMs: 10_000,
    maxOutputBytes: 131_072
  });
  assertCommandSucceeded(statusResult, "GIT_STATUS_FAILED", "Could not read repository status.");
  const status = String(statusResult.stdout ?? "").trim();
  return { head, status, clean: status === "" };
}

async function resolveCliCommand(name, runCommand, platform) {
  if (name === "claude") {
    const packageEntry = await resolveGlobalNpmClaudeEntry(runCommand, platform);
    if (packageEntry) return packageEntry;
  }

  const locator = platform === "win32" ? "where.exe" : "which";
  const result = await runCommand(locator, [name], { timeoutMs: 10_000, maxOutputBytes: 65_536 });
  if (result?.timedOut || result?.truncated || result?.complete === false) {
    assertCommandSucceeded(result, "CLI_NOT_FOUND", `Could not locate ${name} on PATH.`);
  }

  const candidates = result?.exitCode === 0
    ? String(result.stdout ?? "")
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value) => !value.toLowerCase().endsWith(".ps1"))
    : [];

  for (const path of knownWindowsCliCandidates(name, platform, globalThis.process.env)) {
    if (existsSync(path) && !candidates.includes(path)) candidates.push(path);
  }

  const candidate = selectCliCandidate(name, candidates);
  if (!candidate) {
    throw operationError("CLI_NOT_FOUND", `Could not locate ${name} on PATH or in supported Windows install locations.`, {
      locator_exit_code: result?.exitCode ?? null
    });
  }
  return candidate;
}

export function buildClaudeEnvironment(
  source = globalThis.process.env,
  platform = globalThis.process.platform,
  fileExists = existsSync
) {
  const result = { ...source };
  if (platform !== "win32") return result;
  const current = String(result.CLAUDE_CODE_GIT_BASH_PATH ?? "").trim().replace(/^"|"$/g, "");
  const candidates = [
    current,
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe"
  ].filter(Boolean);
  const bashPath = candidates.find((value) => fileExists(value));
  if (!bashPath) {
    throw operationError("CLAUDE_GIT_BASH_NOT_FOUND", "Claude Code on native Windows requires a verified Git Bash executable.");
  }
  result.CLAUDE_CODE_GIT_BASH_PATH = bashPath;
  return result;
}

export async function resolveGlobalNpmClaudeEntry(
  runCommand,
  platform = globalThis.process.platform,
  env = globalThis.process.env,
  fileExists = existsSync,
  nodeExecutable = globalThis.process.execPath
) {
  if (platform !== "win32") return null;
  const npmCliCandidates = [
    String(env.npm_execpath ?? "").trim(),
    join(dirname(nodeExecutable), "node_modules", "npm", "bin", "npm-cli.js")
  ].filter(Boolean);
  const npmCli = npmCliCandidates.find((value) => fileExists(value));
  if (!npmCli) return null;

  const result = await runCommand(nodeExecutable, [npmCli, "root", "-g"], {
    timeoutMs: 30_000,
    maxOutputBytes: 65_536
  });
  if (result?.exitCode !== 0 || result?.timedOut || result?.truncated || result?.complete === false) return null;
  const root = String(result.stdout ?? "").trim();
  if (!root || /[\r\n]/.test(root)) return null;
  const entry = join(root, "@anthropic-ai", "claude-code", "cli.js");
  return fileExists(entry) ? entry : null;
}

export function selectCliCandidate(name, candidates) {
  const packageEntry = candidates.find((value) =>
    value.toLowerCase().endsWith(join("@anthropic-ai", "claude-code", "cli.js").toLowerCase())
  );
  const commandShim = candidates.find((value) => /\.(cmd|bat)$/i.test(value));
  const executable = candidates.find((value) => value.toLowerCase().endsWith(".exe"));
  return name === "claude"
    ? packageEntry ?? commandShim ?? executable ?? candidates[0]
    : executable ?? commandShim ?? candidates[0];
}

export function knownWindowsCliCandidates(name, platform = globalThis.process.platform, env = globalThis.process.env) {
  if (platform !== "win32") return [];
  const userProfile = String(env.USERPROFILE ?? "").trim();
  const appData = String(env.APPDATA ?? "").trim();
  const localAppData = String(env.LOCALAPPDATA ?? "").trim();
  const candidates = [];
  if (userProfile) {
    candidates.push(join(userProfile, ".local", "bin", `${name}.exe`));
    candidates.push(join(userProfile, ".claude", "local", `${name}.exe`));
  }
  if (appData) {
    candidates.push(join(appData, "npm", `${name}.cmd`));
    if (name === "claude") {
      candidates.push(join(appData, "npm", "node_modules", "@anthropic-ai", "claude-code", "cli.js"));
    }
  }
  if (localAppData) candidates.push(join(localAppData, "Programs", name, `${name}.exe`));
  return candidates;
}

function requireCapabilities(provider, capabilities, required) {
  const missing = required.filter((name) => capabilities[name] !== true);
  if (missing.length > 0) {
    throw operationError("CLI_CAPABILITY_MISSING", `${provider} CLI is missing required non-interactive capabilities.`, {
      missing
    });
  }
}

function assertCommandSucceeded(result, code, message) {
  if (result?.timedOut) {
    throw operationError("CLI_COMMAND_TIMED_OUT", message, { timed_out: true });
  }
  if (result?.truncated || result?.complete === false) {
    throw operationError("CLI_OUTPUT_INCOMPLETE", message, { truncated: Boolean(result?.truncated) });
  }
  if (result?.exitCode !== 0) {
    throw operationError(code, message, {
      exit_code: result?.exitCode ?? null,
      stderr: String(result?.stderr ?? "").slice(-4096)
    });
  }
}

function executeCommand(executable, args, options = {}) {
  return new Promise((resolveCommand) => {
    const platform = options.platform ?? globalThis.process.platform;
    const invocation = resolveExecutableInvocation(executable, args, platform);
    const maxOutputBytes = options.maxOutputBytes ?? 1_048_576;
    let stdout = "";
    let stderr = "";
    let totalBytes = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const child = spawn(invocation.command, invocation.args, {
      cwd: options.cwd,
      env: options.env ?? globalThis.process.env,
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const append = (target, chunk) => {
      if (truncated) return target;
      const text = String(chunk ?? "");
      const available = Math.max(0, maxOutputBytes - totalBytes);
      const bytes = Buffer.byteLength(text, "utf8");
      if (bytes <= available) {
        totalBytes += bytes;
        return target + text;
      }
      truncated = true;
      terminateProcessTree(child);
      return target + Buffer.from(text, "utf8").subarray(0, available).toString("utf8");
    };

    child.stdout?.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr?.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      resolveCommand({
        exitCode: 1,
        stdout,
        stderr: `${stderr}${error instanceof Error ? error.message : String(error)}`,
        timedOut,
        complete: false,
        truncated
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      resolveCommand({
        exitCode: typeof code === "number" ? code : timedOut ? null : 1,
        stdout,
        stderr,
        timedOut,
        complete: !timedOut && !truncated,
        truncated
      });
    });

    const timer = globalThis.setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
    }, options.timeoutMs ?? 120_000);

    if (options.input !== undefined) child.stdin?.end(String(options.input));
    else child.stdin?.end();
  });
}

export function resolveExecutableInvocation(
  executable,
  args,
  platform = globalThis.process.platform,
  fileExists = existsSync,
  nodeExecutable = globalThis.process.execPath
) {
  if (executable.toLowerCase().endsWith(join("@anthropic-ai", "claude-code", "cli.js").toLowerCase())) {
    return { command: nodeExecutable, args: [executable, ...args] };
  }

  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(executable)) {
    return { command: executable, args };
  }

  if (basename(executable).toLowerCase() === "claude.cmd") {
    const cliEntry = join(dirname(executable), "node_modules", "@anthropic-ai", "claude-code", "cli.js");
    if (fileExists(cliEntry)) {
      return { command: nodeExecutable, args: [cliEntry, ...args] };
    }
  }

  return windowsCommandInvocation(executable, args);
}

function windowsCommandInvocation(executable, args) {
  const values = [executable, ...args];
  for (const value of values) {
    if (String(value).includes(String.fromCharCode(0)) || /[\r\n&|<>^%!]/.test(value)) {
      throw operationError("UNSAFE_WINDOWS_ARGUMENT", "The fixed CLI invocation contains an unsafe Windows shell character.");
    }
  }
  const commandLine = values.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(" ");
  return {
    command: globalThis.process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", commandLine]
  };
}

function terminateProcessTree(child) {
  if (!child || child.killed) return;
  if (globalThis.process.platform === "win32" && child.pid) {
    execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
  }
  child.kill("SIGKILL");
}

function normalizeProvider(value) {
  const provider = String(value ?? "").trim().toLowerCase();
  if (provider !== "codex" && provider !== "claude") {
    throw operationError("PROVIDER_NOT_SUPPORTED", "Provider must be codex or claude.");
  }
  return provider;
}

function firstLine(value) {
  return String(value ?? "").trim().split(/\r?\n/, 1)[0].slice(0, 300);
}

function operationError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

const invokedPath = globalThis.process.argv[1]
  ? pathToFileURL(resolve(globalThis.process.argv[1])).href
  : "";

if (import.meta.url === invokedPath) {
  probeAgentCli()
    .then((result) => globalThis.console.log(JSON.stringify(result)))
    .catch((error) => {
      globalThis.console.error(JSON.stringify({
        ok: false,
        error: {
          code: typeof error?.code === "string" ? error.code : "UNEXPECTED_ERROR",
          message: error instanceof Error ? error.message : "Unexpected agent CLI capability-probe failure.",
          ...(error?.details === undefined ? {} : { details: error.details })
        }
      }));
      globalThis.process.exitCode = 1;
    });
}
