import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ignore from "ignore";
import {
  buildAgentEnvironment,
  detectCapabilities,
  executeCommand,
  redactAgentOutput,
  resolveCliCommand,
  resolveExecutableInvocation,
  sanitizeDiagnosticText,
  terminateProcessTree
} from "./agent-cli-probe.mjs";
import { spawn } from "node:child_process";

const RUN_ID = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z-[a-z0-9][a-z0-9-]{0,79}$/;
const SHA = /^[a-f0-9]{40}$/;
const MAX_RESULT_BYTES = 262_144;
const HARD_FORBIDDEN_PATTERNS = [
  ".env*",
  "**/.env*",
  ".git/**",
  ".chatgpt/**",
  "node_modules/**",
  "**/node_modules/**",
  "dist/**",
  "**/dist/**",
  "coverage/**",
  "**/coverage/**",
  "test-results/**",
  "**/test-results/**"
];
const ALLOWED_RUN_FILES = new Set(["PROMPT.md", "run.json", "execution.json", "stdout.jsonl", "stderr.log", "RESULT.md"]);

export async function runCodexTaskRunner(rawOptions = parseArgs(process.argv.slice(2)), dependencies = {}) {
  const options = validateOptions(rawOptions);
  const now = dependencies.now ?? (() => new Date());
  const spawnProcess = dependencies.spawnProcess ?? spawn;
  const runCommand = dependencies.runCommand ?? executeCommand;
  const resolveCli = dependencies.resolveCli ?? ((name) => resolveCliCommand(name, runCommand, process.platform));
  const terminateTree = dependencies.terminateTree ?? terminateProcessTree;
  const paths = runPaths(options.repoRoot, options.runId);
  let state;
  let stateIdentityVerified = false;
  let child;
  let output;
  let timer;
  let timedOut = false;
  let truncated = false;
  let malformedJsonl = false;

  try {
    state = await readJson(paths.execution);
    assertStateIdentity(state, options);
    stateIdentityVerified = true;
    const promptBuffer = await readFile(paths.prompt);
    const prompt = decodeUtf8(promptBuffer, "PROMPT.md");
    const manifestBuffer = await readFile(paths.manifest);
    const manifest = JSON.parse(decodeUtf8(manifestBuffer, "run.json"));
    validateManifest(manifest, options, paths, promptBuffer);
    const otherRunsBefore = await snapshotOtherRuns(options.repoRoot, options.runId);
    const branchRefsBefore = await inspectBranchRefs(options.repoRoot);
    const runIntegrityBefore = {
      promptSha256: createHash("sha256").update(promptBuffer).digest("hex"),
      manifestSha256: createHash("sha256").update(manifestBuffer).digest("hex"),
      executionSha256: null
    };

    const inheritedNames = parseInheritedEnvironmentNames(process.env.GPT_REPO_CODEX_INHERIT_ENV_NAMES);
    const env = buildAgentEnvironment("codex", process.env, process.platform, existsSync, inheritedNames);
    const cli = await resolveCli("codex");
    const version = await runCommand(cli, ["--version"], { cwd: options.repoRoot, env, timeoutMs: 30_000, maxOutputBytes: 65_536 });
    const globalHelp = await runCommand(cli, ["--help"], { cwd: options.repoRoot, env, timeoutMs: 30_000, maxOutputBytes: 262_144 });
    const execHelp = await runCommand(cli, ["exec", "--help"], { cwd: options.repoRoot, env, timeoutMs: 30_000, maxOutputBytes: 262_144 });
    for (const result of [version, globalHelp, execHelp]) assertCommandResult(result, "CODEX_CLI_UNAVAILABLE");
    const capabilities = detectCapabilities("codex", `${globalHelp.stdout}\n${execHelp.stdout}`);
    if (!capabilities.exec || !capabilities.json || !capabilities.sandbox || !capabilities.cd || !capabilities.cd_flag) {
      throw runnerError("CODEX_CLI_CAPABILITY_MISSING", "Codex CLI is missing required execution capabilities.");
    }

    await ensureNewOutputFiles(paths);
    output = createBoundedOutput(paths, options.maxOutputBytes, () => {
      truncated = true;
      if (child) terminateTree(child);
    });
    const args = ["exec", "--json", "--sandbox", "workspace-write", capabilities.cd_flag, options.repoRoot, "-"];
    const invocation = resolveExecutableInvocation(cli, args, process.platform);
    child = spawnProcess(invocation.command, invocation.args, {
      cwd: options.repoRoot,
      env,
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });
    if (!child.pid) throw runnerError("CODEX_PROCESS_START_FAILED", "Codex process did not return a process id.");

    const startedAt = now().toISOString();
    state = {
      ...state,
      status: "running",
      runner_pid: process.pid,
      process_pid: child.pid,
      started_at: startedAt,
      updated_at: startedAt,
      diagnostic: null,
      error_code: null
    };
    await writeJsonAtomic(paths.execution, state);
    runIntegrityBefore.executionSha256 = createHash("sha256").update(await readFile(paths.execution)).digest("hex");

    child.stdout?.on("data", (chunk) => {
      const result = output.writeStdout(chunk);
      malformedJsonl ||= result.malformed;
    });
    child.stderr?.on("data", (chunk) => output.writeStderr(chunk));
    const processResult = await new Promise((resolveProcess, rejectProcess) => {
      child.on("error", rejectProcess);
      child.on("close", (code) => resolveProcess({ exitCode: typeof code === "number" ? code : null }));
      timer = setTimeout(() => {
        timedOut = true;
        terminateTree(child);
      }, options.timeoutMs);
      child.stdin?.end(prompt);
    });
    clearTimeout(timer);
    await output.close();
    malformedJsonl ||= output.isMalformed();
    const outputSizes = output.sizes();

    const postflight = await inspectPostflight(options.repoRoot, manifest, paths, otherRunsBefore, branchRefsBefore, runIntegrityBefore, outputSizes);
    const result = await readResult(paths.result);
    const endedAt = now().toISOString();
    let terminalStatus = "completed";
    let errorCode = null;
    let diagnostic = null;

    if (timedOut) {
      terminalStatus = "timed_out";
      errorCode = "CODEX_PROCESS_TIMED_OUT";
      diagnostic = "Codex exceeded the server-owned runtime limit and its process tree was terminated.";
    } else if (truncated) {
      terminalStatus = "failed";
      errorCode = "CODEX_OUTPUT_TRUNCATED";
      diagnostic = "Codex output exceeded the server-owned byte limit.";
    } else if (malformedJsonl) {
      terminalStatus = "failed";
      errorCode = "CODEX_OUTPUT_INVALID";
      diagnostic = "Codex emitted malformed JSONL output.";
    } else if (processResult.exitCode !== 0) {
      terminalStatus = "failed";
      errorCode = "CODEX_PROCESS_NONZERO_EXIT";
      diagnostic = `Codex exited with code ${processResult.exitCode ?? "unknown"}.`;
    } else if (!result.valid) {
      terminalStatus = "failed";
      errorCode = result.errorCode;
      diagnostic = result.diagnostic;
    } else if (postflight.scopeViolations.length > 0 || postflight.forbiddenChanges.length > 0 || postflight.stagedPaths.length > 0 || postflight.branchRefChanges.length > 0 || postflight.runArtifactViolations.length > 0 || postflight.branch !== state.start_branch || postflight.head !== state.start_head_sha) {
      terminalStatus = "failed";
      errorCode = "CODEX_POSTFLIGHT_CONTRACT_VIOLATION";
      diagnostic = "Codex changed branch, HEAD, staged content, branch refs, protected run artifacts, a forbidden path, or a path outside the allowed scope.";
    } else {
      terminalStatus = result.status;
    }

    state = {
      ...state,
      status: terminalStatus,
      updated_at: endedAt,
      ended_at: endedAt,
      exit_code: processResult.exitCode,
      timed_out: timedOut,
      output_complete: !timedOut && !truncated,
      output_truncated: truncated,
      error_code: errorCode,
      diagnostic: diagnostic ? sanitizeDiagnosticText(diagnostic) : null,
      end_branch: postflight.branch,
      end_head_sha: postflight.head,
      worktree_clean_after: postflight.clean,
      changed_paths: postflight.changedPaths,
      staged_paths: postflight.stagedPaths,
      branch_ref_changes: postflight.branchRefChanges,
      run_artifact_violations: postflight.runArtifactViolations,
      scope_violations: postflight.scopeViolations,
      forbidden_path_changes: postflight.forbiddenChanges,
      result_sha256: result.valid ? result.sha256 : null,
      result_bytes: result.valid ? result.bytes : null,
      result_status: result.valid ? result.status : null
    };
    await writeJsonAtomic(paths.execution, state);
    return state;
  } catch (error) {
    if (timer) clearTimeout(timer);
    if (child) terminateTree(child);
    if (output) await output.close().catch(() => {});
    if (!stateIdentityVerified) throw error;
    const endedAt = now().toISOString();
    const postflight = await inspectGit(options.repoRoot).catch(() => ({ branch: null, head: null, clean: null, changedPaths: [] }));
    state = {
      ...state,
      status: "failed",
      runner_pid: process.pid,
      updated_at: endedAt,
      ended_at: endedAt,
      timed_out: timedOut,
      output_complete: false,
      output_truncated: truncated,
      error_code: typeof error?.code === "string" ? error.code : "CODEX_RUNNER_FAILED",
      diagnostic: sanitizeDiagnosticText(error instanceof Error ? error.message : String(error)),
      end_branch: postflight.branch,
      end_head_sha: postflight.head && SHA.test(postflight.head) ? postflight.head : null,
      worktree_clean_after: postflight.clean,
      changed_paths: postflight.changedPaths,
      scope_violations: [],
      forbidden_path_changes: []
    };
    await writeJsonAtomic(paths.execution, state).catch(() => {});
    return state;
  } finally {
    await releaseLock(paths.lock, options.runId);
  }
}

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw runnerError("RUNNER_ARGUMENT_INVALID", "Runner arguments are invalid.");
    values[key.slice(2)] = value;
  }
  return {
    repoRoot: values["repo-root"],
    repoId: values["repo-id"],
    runId: values["run-id"],
    timeoutMs: Number(values["timeout-ms"]),
    maxOutputBytes: Number(values["max-output-bytes"])
  };
}

function validateOptions(value) {
  const repoRoot = resolve(String(value.repoRoot ?? ""));
  const repoId = String(value.repoId ?? "");
  const runId = String(value.runId ?? "");
  const timeoutMs = Number(value.timeoutMs);
  const maxOutputBytes = Number(value.maxOutputBytes);
  if (!repoRoot || !repoId || !RUN_ID.test(runId) || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 7_200_000 || !Number.isInteger(maxOutputBytes) || maxOutputBytes < 1024 || maxOutputBytes > 1_048_576) {
    throw runnerError("RUNNER_ARGUMENT_INVALID", "Runner arguments failed validation.");
  }
  return { repoRoot, repoId, runId, timeoutMs, maxOutputBytes };
}

function runPaths(root, runId) {
  const runDir = join(root, ".chatgpt", "codex-runs", runId);
  return {
    runDir,
    prompt: join(runDir, "PROMPT.md"),
    result: join(runDir, "RESULT.md"),
    manifest: join(runDir, "run.json"),
    execution: join(runDir, "execution.json"),
    stdout: join(runDir, "stdout.jsonl"),
    stderr: join(runDir, "stderr.log"),
    lock: join(root, ".chatgpt", "codex-runs", ".active-codex.lock")
  };
}

function assertStateIdentity(state, options) {
  if (state?.schema_version !== 1 || state?.status !== "starting" || state?.repo_id !== options.repoId || state?.run_id !== options.runId || (state?.runner_pid && state.runner_pid !== process.pid)) {
    throw runnerError("CODEX_EXECUTION_INVALID", "Starting execution state does not match this runner.");
  }
}

function validateManifest(manifest, options, paths, promptBuffer) {
  const expectedPrompt = relative(options.repoRoot, paths.prompt).replaceAll("\\", "/");
  const expectedResult = relative(options.repoRoot, paths.result).replaceAll("\\", "/");
  if (manifest?.schema_version !== 2 || manifest.repo_id !== options.repoId || manifest.run_id !== options.runId || manifest.prompt_path !== expectedPrompt || manifest.result_path !== expectedResult || !Array.isArray(manifest.allowed_paths) || manifest.allowed_paths.length === 0 || !Array.isArray(manifest.forbidden_paths)) {
    throw runnerError("CODEX_TASK_INVALID", "Task manifest identity, paths, or scope are invalid.");
  }
  const hash = createHash("sha256").update(promptBuffer).digest("hex");
  if (manifest.prompt_sha256 !== hash) throw runnerError("CODEX_TASK_INTEGRITY_FAILED", "PROMPT.md hash no longer matches run.json.");
  for (const pattern of manifest.allowed_paths) {
    validateTaskPattern(pattern);
    validateAllowedPattern(pattern);
  }
  for (const pattern of manifest.forbidden_paths) validateTaskPattern(pattern);
}

function validateTaskPattern(value) {
  const pattern = String(value ?? "").trim();
  if (!pattern || pattern.startsWith("/") || pattern.startsWith("!") || pattern.includes("\\") || pattern.includes("\0") || pattern.split("/").includes("..") || /[\r\n;&|<>`]/.test(pattern)) {
    throw runnerError("CODEX_TASK_INVALID", "Task path scope contains an invalid or unsafe pattern.");
  }
}

function validateAllowedPattern(value) {
  const pattern = String(value ?? "").trim();
  const firstSegment = pattern.split("/", 1)[0] ?? "";
  const protectedRoots = new Set([".git", ".chatgpt", "node_modules", "dist", "coverage", "test-results"]);
  const wildcardRoot = [...firstSegment].some((character) => "*?[]{}".includes(character));
  if (!firstSegment || wildcardRoot || protectedRoots.has(firstSegment) || firstSegment.startsWith(".env")) {
    throw runnerError("CODEX_TASK_INVALID", "Executable Codex allowed paths require a literal non-protected repository root.");
  }
}

function parseInheritedEnvironmentNames(value) {
  if (!value) return [];
  let names;
  try { names = JSON.parse(value); } catch { throw runnerError("RUNNER_ARGUMENT_INVALID", "Runner environment allowlist is invalid."); }
  if (!Array.isArray(names) || names.length > 64 || names.some((name) => typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) {
    throw runnerError("RUNNER_ARGUMENT_INVALID", "Runner environment allowlist failed validation.");
  }
  return [...new Set(names)].sort();
}

async function ensureNewOutputFiles(paths) {
  await mkdir(paths.runDir, { recursive: true });
  await writeFile(paths.stdout, "", { encoding: "utf8", flag: "wx" }).catch((error) => { throw runnerError("CODEX_OUTPUT_EXISTS", error.message); });
  await writeFile(paths.stderr, "", { encoding: "utf8", flag: "wx" }).catch((error) => { throw runnerError("CODEX_OUTPUT_EXISTS", error.message); });
}

function createBoundedOutput(paths, maxBytes, onLimit) {
  const stdout = createWriteStream(paths.stdout, { flags: "a", encoding: "utf8" });
  const stderr = createWriteStream(paths.stderr, { flags: "a", encoding: "utf8" });
  let bytes = 0;
  let stdoutBytes = 0;
  let stderrBytes = 0;
  const stdoutHash = createHash("sha256");
  const stderrHash = createHash("sha256");
  let malformed = false;
  let stdoutPending = "";
  let closed = false;
  let limited = false;

  const writeBounded = (stream, text, outputName) => {
    if (limited || !text) return;
    const sanitized = redactAgentOutput(text);
    const size = Buffer.byteLength(sanitized, "utf8");
    const available = Math.max(0, maxBytes - bytes);
    const written = Math.min(size, available);
    if (written > 0) {
      const value = written === size ? sanitized : Buffer.from(sanitized, "utf8").subarray(0, written);
      stream.write(value);
      bytes += written;
      if (outputName === "stdout") stdoutHash.update(value);
      else stderrHash.update(value);
      if (outputName === "stdout") stdoutBytes += written;
      else stderrBytes += written;
    }
    if (written < size) {
      bytes = maxBytes;
      limited = true;
      onLimit();
    }
  };

  return {
    writeStdout(chunk) {
      stdoutPending += String(chunk ?? "");
      let malformedInChunk = false;
      const lines = stdoutPending.split(/\r?\n/);
      stdoutPending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        try { JSON.parse(line); } catch { malformed = true; malformedInChunk = true; }
        writeBounded(stdout, `${line}\n`, "stdout");
      }
      return { malformed: malformedInChunk };
    },
    writeStderr(chunk) { writeBounded(stderr, String(chunk ?? ""), "stderr"); },
    async close() {
      if (closed) return;
      closed = true;
      if (stdoutPending) {
        try { JSON.parse(stdoutPending); } catch { malformed = true; }
        writeBounded(stdout, `${stdoutPending}\n`, "stdout");
      }
      await Promise.all([endStream(stdout), endStream(stderr)]);
    },
    isMalformed() {
      return malformed;
    },
    sizes() {
      return {
        stdoutBytes,
        stderrBytes,
        stdoutSha256: stdoutHash.digest("hex"),
        stderrSha256: stderrHash.digest("hex")
      };
    }
  };
}

async function inspectPostflight(root, manifest, paths, otherRunsBefore, branchRefsBefore, runIntegrityBefore, outputSizes) {
  const git = await inspectGit(root);
  const changedPaths = [...new Set(git.changedPaths)].sort();
  const allowed = ignore().add(manifest.allowed_paths);
  const forbidden = ignore().add([...HARD_FORBIDDEN_PATTERNS, ...manifest.forbidden_paths]);
  const resultPath = relative(root, paths.result).replaceAll("\\", "/");
  const scopeViolations = changedPaths.filter((path) => path !== resultPath && !allowed.ignores(path));
  const forbiddenChanges = changedPaths.filter((path) => path !== resultPath && forbidden.ignores(path));
  const otherRunsAfter = await snapshotOtherRuns(root, manifest.run_id);
  for (const path of changedSnapshotPaths(otherRunsBefore, otherRunsAfter)) {
    scopeViolations.push(path);
    forbiddenChanges.push(path);
  }
  const branchRefsAfter = await inspectBranchRefs(root);
  const branchRefChanges = changedBranchRefs(branchRefsBefore, branchRefsAfter);
  const runArtifactViolations = await inspectCurrentRunArtifacts(paths, runIntegrityBefore, outputSizes);
  return {
    branch: git.branch,
    head: git.head,
    clean: git.clean,
    changedPaths,
    stagedPaths: [...new Set(git.stagedPaths)].sort(),
    branchRefChanges,
    runArtifactViolations,
    scopeViolations: [...new Set(scopeViolations)].sort(),
    forbiddenChanges: [...new Set(forbiddenChanges)].sort()
  };
}

async function inspectGit(root) {
  const branch = await runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const head = await runGit(root, ["rev-parse", "HEAD"]);
  const status = await runGit(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const parsed = parsePorcelainZ(status);
  return { branch: branch.trim(), head: head.trim(), clean: parsed.changedPaths.length === 0, ...parsed };
}

async function runGit(root, args) {
  const result = await executeCommand("git", args, { cwd: root, env: { PATH: process.env.PATH ?? "" }, timeoutMs: 30_000, maxOutputBytes: 1_048_576 });
  assertCommandResult(result, "GIT_ERROR");
  return result.stdout;
}

function parsePorcelainZ(value) {
  const entries = String(value ?? "").split("\0").filter(Boolean);
  const changedPaths = [];
  const stagedPaths = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const status = entry.slice(0, 2);
    let path = entry.slice(3).replaceAll("\\", "/");
    if (status[0] === "R" || status[0] === "C") {
      const destination = entries[index + 1];
      if (destination) {
        path = destination.replaceAll("\\", "/");
        index += 1;
      }
    }
    if (!path) continue;
    changedPaths.push(path);
    if (status[0] !== " " && status[0] !== "?") stagedPaths.push(path);
  }
  return { changedPaths, stagedPaths };
}

async function inspectBranchRefs(root) {
  const output = await runGit(root, ["for-each-ref", "--format=%(refname):%(objectname)", "refs/heads"]);
  const refs = new Map();
  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    const separator = line.lastIndexOf(":");
    if (separator <= 0) continue;
    refs.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return refs;
}

function changedBranchRefs(before, after) {
  const changes = [];
  const names = new Set([...before.keys(), ...after.keys()]);
  for (const name of [...names].sort()) {
    const previous = before.get(name);
    const current = after.get(name);
    if (previous === current) continue;
    const kind = previous === undefined ? "created" : current === undefined ? "deleted" : "updated";
    changes.push(`${name}:${kind}`);
  }
  return changes;
}

async function inspectCurrentRunArtifacts(paths, before, outputSizes) {
  const violations = [];
  await compareFileHash(paths.prompt, before.promptSha256, "PROMPT.md", violations);
  await compareFileHash(paths.manifest, before.manifestSha256, "run.json", violations);
  await compareFileHash(paths.execution, before.executionSha256, "execution.json", violations);
  await compareFileEvidence(paths.stdout, outputSizes.stdoutBytes, outputSizes.stdoutSha256, "stdout.jsonl", violations);
  await compareFileEvidence(paths.stderr, outputSizes.stderrBytes, outputSizes.stderrSha256, "stderr.log", violations);

  const entries = await listRunEntries(paths.runDir);
  for (const entry of entries) {
    if (!ALLOWED_RUN_FILES.has(entry)) violations.push(`${entry}:unexpected`);
  }
  return [...new Set(violations)].sort();
}

async function compareFileHash(path, expected, label, violations) {
  try {
    const actual = createHash("sha256").update(await readFile(path)).digest("hex");
    if (!expected || actual !== expected) violations.push(`${label}:modified`);
  } catch (error) {
    violations.push(`${label}:${error?.code === "ENOENT" ? "missing" : "unreadable"}`);
  }
}

async function compareFileEvidence(path, expectedSize, expectedSha256, label, violations) {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size !== expectedSize) {
      violations.push(`${label}:modified`);
      return;
    }
    const actualSha256 = createHash("sha256").update(await readFile(path)).digest("hex");
    if (actualSha256 !== expectedSha256) violations.push(`${label}:modified`);
  } catch (error) {
    violations.push(`${label}:${error?.code === "ENOENT" ? "missing" : "unreadable"}`);
  }
}

async function listRunEntries(runDir) {
  const result = [];
  async function recurse(directory, prefix) {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        result.push(`${name}:symlink`);
      } else if (entry.isDirectory()) {
        result.push(`${name}/`);
        await recurse(path, name);
      } else if (entry.isFile()) {
        result.push(name);
      } else {
        result.push(`${name}:unsupported`);
      }
    }
  }
  await recurse(runDir, "");
  return result;
}

async function readResult(path) {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_RESULT_BYTES) {
      return { valid: false, status: null, sha256: null, bytes: null, errorCode: "CODEX_RESULT_TOO_LARGE", diagnostic: "RESULT.md exceeds the bounded result size." };
    }
    const buffer = await readFile(path);
    const text = decodeUtf8(buffer, "RESULT.md");
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const bytes = buffer.length;
    if (!text.includes("# CODEX_RESULT")) return { valid: false, status: null, sha256, bytes, errorCode: "CODEX_RESULT_MALFORMED", diagnostic: "RESULT.md does not contain the required result header." };
    const match = text.match(/^status:\s*(completed|blocked)\s*$/im);
    if (!match) return { valid: false, status: null, sha256, bytes, errorCode: "CODEX_RESULT_MALFORMED", diagnostic: "RESULT.md does not contain a valid completed or blocked status." };
    return { valid: true, status: match[1].toLowerCase(), sha256, bytes, errorCode: null, diagnostic: null };
  } catch (error) {
    if (error?.code === "ENOENT") return { valid: false, status: null, sha256: null, bytes: null, errorCode: "CODEX_RESULT_MISSING", diagnostic: "Codex exited without writing RESULT.md." };
    return { valid: false, status: null, sha256: null, bytes: null, errorCode: "CODEX_RESULT_MALFORMED", diagnostic: error instanceof Error ? error.message : String(error) };
  }
}

async function snapshotOtherRuns(root, currentRunId) {
  const base = join(root, ".chatgpt", "codex-runs");
  const result = new Map();
  let entriesSeen = 0;
  let bytes = 0;

  async function recurse(directory, prefix = "") {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (!prefix && (entry.name === currentRunId || entry.name === ".active-codex.lock")) continue;
      const absolute = join(directory, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      const rel = `.chatgpt/codex-runs/${name}`;
      entriesSeen += 1;
      if (entriesSeen > 5000) throw runnerError("CODEX_RUN_SNAPSHOT_LIMIT", "Other-run integrity snapshot exceeded its bounded entry limit.");

      if (entry.isSymbolicLink()) {
        result.set(rel, "symlink");
      } else if (entry.isDirectory()) {
        result.set(`${rel}/`, "directory");
        await recurse(absolute, name);
      } else if (entry.isFile()) {
        const info = await stat(absolute);
        bytes += info.size;
        if (bytes > 32 * 1024 * 1024) throw runnerError("CODEX_RUN_SNAPSHOT_LIMIT", "Other-run integrity snapshot exceeded its bounded byte limit.");
        const data = await readFile(absolute);
        result.set(rel, `file:${createHash("sha256").update(data).digest("hex")}`);
      } else {
        result.set(rel, "unsupported");
      }
    }
  }

  try {
    await recurse(base);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return result;
}

function changedSnapshotPaths(before, after) {
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys].filter((key) => before.get(key) !== after.get(key)).sort();
}

async function releaseLock(lockPath, runId) {
  try {
    const lock = await readJson(lockPath);
    if (lock?.run_id === runId && (lock?.pid === process.pid || !isProcessAlive(lock?.pid))) await unlink(lockPath);
  } catch (error) {
    if (error?.code !== "ENOENT") return;
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await replaceFileSafely(temporary, path);
}

async function replaceFileSafely(temporary, target) {
  try {
    await rename(temporary, target);
    return;
  } catch (error) {
    if (!isReplaceConflict(error) || !existsSync(target)) throw error;
  }
  const backup = `${target}.${process.pid}.${Date.now()}.bak-swap`;
  await rename(target, backup);
  try {
    await rename(temporary, target);
    await unlink(backup);
  } catch (error) {
    if (!existsSync(target) && existsSync(backup)) await rename(backup, target);
    throw error;
  }
}

function isReplaceConflict(error) {
  return Boolean(error && typeof error === "object" && "code" in error && ["EEXIST", "EPERM", "EACCES"].includes(String(error.code)));
}

function decodeUtf8(buffer, label) {
  if (buffer.includes(0)) throw runnerError("BINARY_FILE_REJECTED", `${label} contains NUL bytes.`);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { throw runnerError("BINARY_FILE_REJECTED", `${label} is not valid UTF-8.`); }
}

function assertCommandResult(result, code) {
  if (result?.exitCode !== 0 || result?.timedOut || result?.truncated || result?.complete === false) throw runnerError(code, "A required fixed command failed or returned incomplete output.");
}

function endStream(stream) {
  return new Promise((resolveEnd) => stream.end(resolveEnd));
}

function runnerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  runCodexTaskRunner()
    .then((state) => { process.exitCode = state.status === "completed" || state.status === "blocked" ? 0 : 1; })
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: { code: error?.code ?? "CODEX_RUNNER_FAILED", message: sanitizeDiagnosticText(error instanceof Error ? error.message : String(error)) } }));
      process.exitCode = 1;
    });
}
