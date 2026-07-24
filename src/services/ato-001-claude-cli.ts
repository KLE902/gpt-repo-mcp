import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { RepoReaderError, type RepoReaderErrorCode } from "../runtime/errors.js";
import {
  ATO001_MAX_OUTPUT_BYTES,
  ATO001_RESULT_JSON_SCHEMA,
  ATO001_TIMEOUT_MS
} from "./ato-001-claude-profile.js";

type CommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  complete: boolean;
  truncated: boolean;
};

export type Ato001CliEvidence = {
  executable: string;
  command_name: string;
  version: string;
  capabilities: {
    print: true;
    output_format: true;
    max_turns: true;
    permission_mode: true;
    tools: true;
    disallowed_tools: true;
    json_schema: true;
    no_session_persistence: boolean;
  };
  authenticated: true;
};

export type Ato001CliDependencies = {
  resolveCli?: () => Promise<string>;
  runCommand?: (command: string, args: string[], options: {
    cwd?: string;
    input?: string;
    timeoutMs: number;
    maxOutputBytes: number;
  }) => Promise<CommandResult>;
};

export async function verifyAto001ClaudeCli(dependencies: Ato001CliDependencies = {}): Promise<Ato001CliEvidence> {
  const probe = await import(pathToFileURL(resolve(process.cwd(), "scripts", "agent-cli-probe.mjs")).href);
  const runCommand = dependencies.runCommand ?? probe.executeCommand;
  const executable = dependencies.resolveCli
    ? await dependencies.resolveCli()
    : await probe.resolveCliCommand("claude", runCommand, process.platform);

  const versionResult = await runCommand(executable, ["--version"], {
    timeoutMs: 30_000,
    maxOutputBytes: 65_536
  });
  assertCompleteSuccess(versionResult, "ATO001_CLAUDE_VERSION_UNVERIFIED", "Claude version verification failed.");
  const version = versionResult.stdout.trim().split(/\r?\n/, 1)[0]?.replace(/^claude\s+/i, "") ?? "";
  if (version.length < 1 || version.length > 128 || /[\r\n]/.test(version)) {
    throw new RepoReaderError("ATO001_CLAUDE_VERSION_UNVERIFIED", "Claude returned an invalid or empty version identity.");
  }

  const helpResult = await runCommand(executable, ["--help"], {
    timeoutMs: 30_000,
    maxOutputBytes: 131_072
  });
  assertCompleteSuccess(helpResult, "ATO001_CLAUDE_CAPABILITY_UNVERIFIED", "Claude capability verification failed.");
  const help = helpResult.stdout;
  const capabilities = {
    print: help.includes("--print") || /(^|\s)-p([,\s]|$)/m.test(help),
    output_format: help.includes("--output-format"),
    max_turns: help.includes("--max-turns"),
    permission_mode: help.includes("--permission-mode"),
    tools: help.includes("--tools"),
    disallowed_tools: help.includes("--disallowedTools"),
    json_schema: help.includes("--json-schema"),
    no_session_persistence: help.includes("--no-session-persistence")
  };
  const missing = Object.entries(capabilities)
    .filter(([name, present]) => name !== "no_session_persistence" && !present)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new RepoReaderError("ATO001_CLAUDE_CAPABILITY_UNVERIFIED", `Claude is missing fixed ATO-001 capabilities: ${missing.join(", ")}.`);
  }

  const authResult = await runCommand(executable, ["auth", "status", "--json"], {
    timeoutMs: 30_000,
    maxOutputBytes: 65_536
  });
  assertCompleteSuccess(authResult, "ATO001_CLAUDE_AUTHENTICATION_FAILED", "Claude non-interactive authentication verification failed.");
  let auth: unknown;
  try {
    auth = JSON.parse(authResult.stdout);
  } catch {
    throw new RepoReaderError("ATO001_CLAUDE_AUTHENTICATION_FAILED", "Claude authentication status was not structured JSON.");
  }
  if (!isAuthenticated(auth)) {
    throw new RepoReaderError("ATO001_CLAUDE_AUTHENTICATION_FAILED", "Claude did not report an authenticated non-interactive session.");
  }

  return {
    executable,
    command_name: basename(executable),
    version,
    capabilities: capabilities as Ato001CliEvidence["capabilities"],
    authenticated: true
  };
}

export function buildAto001ClaudeArgs(noSessionPersistence: boolean): string[] {
  const args = [
    "-p",
    "--output-format", "json",
    "--max-turns", "1",
    "--permission-mode", "plan",
    "--tools", "Read,Glob,Grep",
    "--disallowedTools", "Bash,Edit,Write,NotebookEdit",
    "--json-schema", JSON.stringify(ATO001_RESULT_JSON_SCHEMA)
  ];
  if (noSessionPersistence) args.push("--no-session-persistence");
  return args;
}

export function publicAto001Invocation(evidence: Ato001CliEvidence) {
  const args = buildAto001ClaudeArgs(evidence.capabilities.no_session_persistence);
  const schemaIndex = args.indexOf("--json-schema") + 1;
  if (schemaIndex > 0) args[schemaIndex] = "<fixed-semantic-result-schema>";
  return {
    provider: "claude" as const,
    version: evidence.version,
    command: evidence.command_name,
    args,
    cwd: "<premium-komga-reader-root>" as const,
    prompt_via_stdin: true as const,
    max_turns: 1 as const,
    permission_mode: "plan" as const,
    allowed_tools: ["Read", "Glob", "Grep"] as Array<"Read" | "Glob" | "Grep">,
    disallowed_tools: ["Bash", "Edit", "Write", "NotebookEdit"] as Array<"Bash" | "Edit" | "Write" | "NotebookEdit">,
    timeout_ms: ATO001_TIMEOUT_MS,
    max_output_bytes: ATO001_MAX_OUTPUT_BYTES
  };
}

export async function launchAto001Runner(options: {
  runnerPath: string;
  repoRoot: string;
  taskPath: string;
  artifactDirectory: string;
}): Promise<{ pid: number }> {
  const child = spawn(process.execPath, [
    options.runnerPath,
    "--repo-root", options.repoRoot,
    "--task-path", options.taskPath,
    "--artifact-directory", options.artifactDirectory
  ], {
    cwd: options.repoRoot,
    detached: true,
    windowsHide: true,
    shell: false,
    stdio: "ignore",
    env: allowlistedRunnerEnvironment()
  });
  child.unref();
  if (!child.pid) {
    throw new RepoReaderError("ATO001_RUNNER_START_FAILED", "The bounded ATO-001 Claude runner did not return a process id.");
  }
  return { pid: child.pid };
}

function allowlistedRunnerEnvironment(): NodeJS.ProcessEnv {
  const names = [
    "PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "TMPDIR",
    "SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "LANG", "LC_ALL", "XDG_CONFIG_HOME",
    "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_GIT_BASH_PATH", "npm_execpath"
  ];
  return Object.fromEntries(names.flatMap((name) => {
    const value = process.env[name];
    return typeof value === "string" && value.length > 0 ? [[name, value]] : [];
  }));
}

function assertCompleteSuccess(result: CommandResult, code: RepoReaderErrorCode, message: string): void {
  if (result.exitCode !== 0 || result.timedOut || result.truncated || !result.complete) {
    throw new RepoReaderError(code, message);
  }
}

function isAuthenticated(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.loggedIn === true
    || record.authenticated === true
    || record.isAuthenticated === true
    || ["logged_in", "authenticated"].includes(String(record.status ?? "").toLowerCase());
}
