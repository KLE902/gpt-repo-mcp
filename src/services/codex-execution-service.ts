import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile, spawn } from "node:child_process";
import {
  CodexExecutionStateSchema,
  CodexStartInputSchema,
  CodexTaskManifestSchema,
  type CodexExecutionState,
  type CodexStartInput,
  type CodexStartResult,
  type CodexTaskManifest
} from "../contracts/codex-task.contract.js";
import { RepoReaderError, type RepoReaderErrorCode } from "../runtime/errors.js";
import { GitService } from "./git-service.js";
import { OperationsPolicy } from "./operations-policy.js";
import { PathSandbox } from "./path-sandbox.js";
import { codexRunPaths } from "./codex-task-service.js";

const STARTUP_WAIT_MS = 15_000;
const POLL_MS = 50;
const BASE_BRANCHES = new Set(["main", "master"]);

type CliVerification = {
  command: string;
  version: string;
  cd_flag: "--cd" | "-C";
  sandbox_bootstrap_verified: true;
  sandboxed_operation_verified: true;
};
type RunnerLaunch = { pid: number };
type StartDependencies = {
  verifyCli?: (root: string) => Promise<CliVerification>;
  launchRunner?: (options: RunnerLaunchOptions) => Promise<RunnerLaunch>;
  terminateRunner?: (pid: number) => Promise<void>;
  processAlive?: (pid: number) => boolean;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  startupWaitMs?: number;
};
type RunnerLaunchOptions = {
  root: string;
  repoId: string;
  runId: string;
  timeoutMs: number;
  maxOutputBytes: number;
  inheritEnv: string[];
};
type LockRecord = { schema_version: 1; repo_id: string; run_id: string; pid: number; created_at: string };

export class CodexExecutionService {
  private readonly git: GitService;
  private readonly verifyCli: (root: string) => Promise<CliVerification>;
  private readonly launchRunner: (options: RunnerLaunchOptions) => Promise<RunnerLaunch>;
  private readonly terminateRunner: (pid: number) => Promise<void>;
  private readonly processAlive: (pid: number) => boolean;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly startupWaitMs: number;

  constructor(
    private readonly root: string,
    private readonly sandbox: PathSandbox,
    private readonly operationsPolicy: OperationsPolicy,
    dependencies: StartDependencies = {}
  ) {
    this.git = new GitService(root);
    this.verifyCli = dependencies.verifyCli ?? verifyCodexCliCapabilities;
    this.launchRunner = dependencies.launchRunner ?? launchDetachedRunner;
    this.terminateRunner = dependencies.terminateRunner ?? terminateRunnerProcess;
    this.processAlive = dependencies.processAlive ?? isProcessAlive;
    this.now = dependencies.now ?? (() => new Date());
    this.sleep = dependencies.sleep ?? ((ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)));
    this.startupWaitMs = dependencies.startupWaitMs ?? STARTUP_WAIT_MS;
  }

  async start(rawInput: CodexStartInput): Promise<CodexStartResult> {
    const input = CodexStartInputSchema.parse(rawInput);
    const policy = this.operationsPolicy.getCodexTaskRunPolicy();
    const git = await this.git.status();
    assertGitStartState(git, input.expected_branch, input.expected_head_sha);

    const paths = codexRunPaths(input.run_id);
    await this.readVerifiedTask(input.repo_id, input.run_id, paths);
    await assertAbsent(this.sandbox, paths.resultPath, "CODEX_RESULT_EXISTS", "RESULT.md already exists for this run.");
    await assertAbsent(this.sandbox, paths.executionPath, "CODEX_EXECUTION_EXISTS", "execution.json already exists for this run.");
    await assertAbsent(this.sandbox, paths.stdoutPath, "CODEX_OUTPUT_EXISTS", "stdout.jsonl already exists for this run.");
    await assertAbsent(this.sandbox, paths.stderrPath, "CODEX_OUTPUT_EXISTS", "stderr.log already exists for this run.");
    await assertArtifactsIgnored(this.root, [paths.executionPath, paths.stdoutPath, paths.stderrPath, paths.lockPath]);

    const cli = await this.verifyCli(this.root);
    const gitAfterProbe = await this.git.status();
    assertGitStartState(gitAfterProbe, input.expected_branch, input.expected_head_sha);
    const lockInspection = await inspectLock(this.root, paths.lockPath, this.processAlive);
    if (lockInspection.active) {
      throw new RepoReaderError("CODEX_RUN_ACTIVE", `Another active Codex run already owns this repository (${lockInspection.runId}).`);
    }

    const invocation = {
      command: basename(cli.command),
      args: ["exec", "--json", "--sandbox", "workspace-write", cli.cd_flag, "<repo-root>", "-"],
      cwd_verified: true,
      prompt_via_stdin: true,
      structured_output: true,
      sandbox: "workspace-write" as const,
      sandbox_bootstrap_verified: cli.sandbox_bootstrap_verified,
      sandboxed_operation_verified: cli.sandboxed_operation_verified
    };
    const warnings = lockInspection.stale ? ["STALE_CODEX_LOCK_VERIFIED"] : [];

    if (input.dry_run) {
      return {
        ok: true,
        repo_id: input.repo_id,
        run_id: input.run_id,
        dry_run: true,
        validated: true,
        started: false,
        execution_path: paths.executionPath,
        stdout_path: paths.stdoutPath,
        stderr_path: paths.stderrPath,
        invocation,
        next_steps: ["Call repo_start_codex_task again with dry_run false to start the verified task."],
        warnings
      };
    }

    await acquireLock(this.root, paths.lockPath, input.repo_id, input.run_id, process.pid, this.now(), this.processAlive);
    const starting = createStartingState(input, paths, policy, cli, this.now);
    await writeExecutionStateAtomic(this.root, starting, true);

    let runner: RunnerLaunch;
    try {
      runner = await this.launchRunner({
        root: this.root,
        repoId: input.repo_id,
        runId: input.run_id,
        timeoutMs: policy.timeout_ms,
        maxOutputBytes: policy.max_output_bytes,
        inheritEnv: policy.inherit_env
      });
      await updateLock(this.root, paths.lockPath, input.repo_id, input.run_id, runner.pid, this.now());
    } catch (error) {
      const failed = terminalFailure(starting, "CODEX_RUNNER_START_FAILED", safeDiagnostic(error), this.now);
      await writeExecutionStateAtomic(this.root, failed, false);
      await releaseLock(this.root, paths.lockPath, input.run_id);
      throw new RepoReaderError("CODEX_RUNNER_START_FAILED", "The bounded Codex runner could not be started.");
    }

    const state = await this.waitForRunner(paths, runner.pid, input.run_id);
    const processActive = processStateActive(state, this.processAlive);
    if (!["starting", "running"].includes(state.status) && !processActive) {
      await releaseLock(this.root, paths.lockPath, input.run_id);
    }
    const reviewState = { ...state, process_active: processActive };
    return {
      ok: true,
      repo_id: input.repo_id,
      run_id: input.run_id,
      dry_run: false,
      validated: true,
      started: state.status === "running",
      execution_path: paths.executionPath,
      stdout_path: paths.stdoutPath,
      stderr_path: paths.stderrPath,
      execution_state: reviewState,
      invocation,
      next_steps: state.status === "running"
        ? ["Call repo_codex_review with this run_id to read durable status; repeat in a later turn if the run is still active."]
        : ["Call repo_codex_review with this run_id to inspect the terminal state, result, and Git review."],
      warnings
    };
  }

  private async readVerifiedTask(repoId: string, runId: string, paths: ReturnType<typeof codexRunPaths>): Promise<{ manifest: CodexTaskManifest; prompt: string }> {
    const promptResolved = await resolveRequiredFile(this.sandbox, paths.promptPath, "CODEX_TASK_MISSING");
    const manifestResolved = await resolveRequiredFile(this.sandbox, paths.manifestPath, "CODEX_TASK_MISSING");
    const promptBuffer = await readFile(promptResolved.absolutePath);
    const prompt = decodeUtf8(promptBuffer, paths.promptPath);
    const manifestText = decodeUtf8(await readFile(manifestResolved.absolutePath), paths.manifestPath);
    let manifest: CodexTaskManifest;
    try {
      manifest = CodexTaskManifestSchema.parse(JSON.parse(manifestText));
    } catch {
      throw new RepoReaderError("CODEX_TASK_INVALID", "run.json is malformed or does not use the executable task schema.");
    }
    if (manifest.repo_id !== repoId || manifest.run_id !== runId) {
      throw new RepoReaderError("CODEX_TASK_INVALID", "Task manifest repository or run identity does not match the requested task.");
    }
    if (manifest.prompt_path !== paths.promptPath || manifest.result_path !== paths.resultPath) {
      throw new RepoReaderError("CODEX_TASK_INVALID", "Task manifest paths do not match the exact run directory.");
    }
    const actualHash = createHash("sha256").update(promptBuffer).digest("hex");
    if (actualHash !== manifest.prompt_sha256) {
      throw new RepoReaderError("CODEX_TASK_INTEGRITY_FAILED", "PROMPT.md does not match the manifest SHA-256.");
    }
    if (manifest.allowed_paths.length === 0) {
      throw new RepoReaderError("CODEX_ALLOWED_PATHS_REQUIRED", "Executable Codex tasks require at least one allowed path.");
    }
    for (const pattern of manifest.allowed_paths) {
      validateTaskPattern(pattern);
      validateAllowedPattern(pattern);
    }
    for (const pattern of manifest.forbidden_paths) validateTaskPattern(pattern);
    return { manifest, prompt };
  }

  private async waitForRunner(paths: ReturnType<typeof codexRunPaths>, runnerPid: number, runId: string): Promise<CodexExecutionState> {
    const started = Date.now();
    while (Date.now() - started <= this.startupWaitMs) {
      const state = await readExecutionState(this.root, paths.executionPath);
      if (state.status !== "starting") return state;
      if (!this.processAlive(runnerPid)) {
        const failed = terminalFailure(state, "CODEX_RUNNER_EXITED_EARLY", "The runner exited before Codex entered running state.", this.now);
        await writeExecutionStateAtomic(this.root, failed, false);
        await releaseLock(this.root, paths.lockPath, runId);
        return failed;
      }
      await this.sleep(POLL_MS);
    }
    const current = await readExecutionState(this.root, paths.executionPath);
    if (current.status === "starting") {
      await this.terminateRunner(runnerPid);
      const failed = terminalFailure(current, "CODEX_START_TIMEOUT", "The runner did not confirm a started Codex process within the bounded startup window.", this.now);
      await writeExecutionStateAtomic(this.root, failed, false);
      await releaseLock(this.root, paths.lockPath, runId);
      throw new RepoReaderError("CODEX_START_TIMEOUT", "Codex runner startup did not complete within the bounded startup window.");
    }
    return current;
  }
}

export async function readExecutionState(root: string, executionPath: string): Promise<CodexExecutionState> {
  try {
    return CodexExecutionStateSchema.parse(JSON.parse(await readFile(join(root, ...executionPath.split("/")), "utf8")));
  } catch (error) {
    if (error instanceof RepoReaderError) throw error;
    throw new RepoReaderError("CODEX_EXECUTION_INVALID", "execution.json is missing, malformed, or outside the supported schema.");
  }
}

export async function writeExecutionStateAtomic(root: string, state: CodexExecutionState, createOnly: boolean): Promise<void> {
  const parsed = CodexExecutionStateSchema.parse(state);
  const target = join(root, ...parsed.execution_path.split("/"));
  await mkdir(dirname(target), { recursive: true });
  const content = `${JSON.stringify(parsed, null, 2)}\n`;
  if (createOnly) {
    try {
      await writeFile(target, content, { encoding: "utf8", flag: "wx" });
      return;
    } catch (error) {
      if (isAlreadyExistsError(error)) throw new RepoReaderError("CODEX_EXECUTION_EXISTS", "execution.json already exists for this run.");
      throw error;
    }
  }
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
  await replaceFileSafely(temporary, target);
}

async function replaceFileSafely(temporary: string, target: string): Promise<void> {
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

function createStartingState(
  input: CodexStartInput,
  paths: ReturnType<typeof codexRunPaths>,
  policy: { timeout_ms: number; max_output_bytes: number },
  cli: CliVerification,
  now: () => Date
): CodexExecutionState {
  const timestamp = now().toISOString();
  return {
    schema_version: 1,
    status: "starting",
    repo_id: input.repo_id,
    run_id: input.run_id,
    prompt_path: paths.promptPath,
    result_path: paths.resultPath,
    execution_path: paths.executionPath,
    stdout_path: paths.stdoutPath,
    stderr_path: paths.stderrPath,
    start_branch: input.expected_branch,
    start_head_sha: input.expected_head_sha,
    runner_pid: null,
    process_pid: null,
    started_at: null,
    updated_at: timestamp,
    ended_at: null,
    timeout_ms: policy.timeout_ms,
    max_output_bytes: policy.max_output_bytes,
    exit_code: null,
    timed_out: false,
    output_complete: false,
    output_truncated: false,
    error_code: null,
    diagnostic: null,
    end_branch: null,
    end_head_sha: null,
    worktree_clean_before: true,
    worktree_clean_after: null,
    changed_paths: [],
    staged_paths: [],
    branch_ref_changes: [],
    run_artifact_violations: [],
    scope_violations: [],
    forbidden_path_changes: [],
    result_sha256: null,
    result_bytes: null,
    result_status: null,
    boundary_evidence_version: 1,
    sandbox_requested: "workspace-write",
    sandbox_bootstrap_verified: cli.sandbox_bootstrap_verified,
    sandbox_failure_detected: false,
    sandbox_failure_code: null,
    execution_boundary_verified: false,
    fallback_tool_violations: [],
    execution_warnings: []
  };
}

function terminalFailure(state: CodexExecutionState, code: string, diagnostic: string, now: () => Date): CodexExecutionState {
  const timestamp = now().toISOString();
  return { ...state, status: "failed", updated_at: timestamp, ended_at: timestamp, error_code: code, diagnostic };
}

function assertGitStartState(git: Awaited<ReturnType<GitService["status"]>>, expectedBranch: string, expectedHead: string): void {
  if (git.branch !== expectedBranch) throw new RepoReaderError("GIT_BRANCH_MISMATCH", `Current branch ${git.branch} does not match expected branch ${expectedBranch}.`);
  if (git.head_sha !== expectedHead) throw new RepoReaderError("GIT_HEAD_MISMATCH", "Repository HEAD changed since the task was prepared for execution.");
  if (BASE_BRANCHES.has(git.branch)) throw new RepoReaderError("GIT_DIRECT_BASE_PUSH_BLOCKED", "Codex task execution is not allowed on main or master.");
  if (!git.clean) throw new RepoReaderError("GIT_WORKTREE_DIRTY", "Codex task execution requires a clean worktree before start.");
}

function validateTaskPattern(value: string): void {
  const pattern = value.trim();
  if (!pattern || pattern.startsWith("/") || pattern.startsWith("!") || pattern.includes("\\") || pattern.includes("\0") || pattern.split("/").includes("..") || /[\r\n;&|<>`]/.test(pattern)) {
    throw new RepoReaderError("CODEX_TASK_INVALID", "Task path scope contains an invalid or unsafe pattern.");
  }
}

function validateAllowedPattern(value: string): void {
  const pattern = value.trim();
  const firstSegment = pattern.split("/", 1)[0] ?? "";
  const protectedRoots = new Set([".git", ".chatgpt", "node_modules", "dist", "coverage", "test-results"]);
  const wildcardRoot = [...firstSegment].some((character) => "*?[]{}".includes(character));
  if (!firstSegment || wildcardRoot || protectedRoots.has(firstSegment) || firstSegment.startsWith(".env")) {
    throw new RepoReaderError("CODEX_TASK_INVALID", "Executable Codex allowed paths require a literal non-protected repository root.");
  }
}

async function resolveRequiredFile(sandbox: PathSandbox, path: string, code: "CODEX_TASK_MISSING") {
  try {
    const resolved = await sandbox.resolve(path);
    if (!resolved.stat.isFile()) throw new RepoReaderError("UNSUPPORTED_FILE_TYPE", `Not a regular file: ${path}`);
    return resolved;
  } catch (error) {
    if (isNotFoundError(error)) throw new RepoReaderError(code, `Required Codex task file is missing: ${path}`);
    throw error;
  }
}

async function assertAbsent(sandbox: PathSandbox, path: string, code: "CODEX_RESULT_EXISTS" | "CODEX_EXECUTION_EXISTS" | "CODEX_OUTPUT_EXISTS", message: string): Promise<void> {
  try {
    await sandbox.resolve(path);
    throw new RepoReaderError(code, message);
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
}

async function assertArtifactsIgnored(root: string, paths: string[]): Promise<void> {
  for (const path of paths) {
    const ignored = await new Promise<boolean>((resolveIgnored) => {
      execFile("git", ["check-ignore", "-q", "--", path], { cwd: root, windowsHide: true, timeout: 30_000 }, (error) => {
        resolveIgnored(!error);
      });
    });
    if (!ignored) {
      throw new RepoReaderError("CODEX_ARTIFACTS_NOT_IGNORED", `Durable Codex execution artifact is not ignored by Git: ${path}`);
    }
  }
}

function decodeUtf8(buffer: Buffer, path: string): string {
  if (buffer.includes(0)) throw new RepoReaderError("BINARY_FILE_REJECTED", `Binary file blocked: ${path}`);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new RepoReaderError("BINARY_FILE_REJECTED", `Invalid UTF-8 file blocked: ${path}`);
  }
}

async function inspectLock(root: string, lockPath: string, processAlive: (pid: number) => boolean): Promise<{ active: boolean; stale: boolean; runId?: string }> {
  const absolute = join(root, ...lockPath.split("/"));
  try {
    const record = parseLock(await readFile(absolute, "utf8"));
    return processAlive(record.pid) ? { active: true, stale: false, runId: record.run_id } : { active: false, stale: true, runId: record.run_id };
  } catch (error) {
    if (isNotFoundError(error)) return { active: false, stale: false };
    if (error instanceof RepoReaderError) throw error;
    throw new RepoReaderError("CODEX_LOCK_INVALID", "The repository Codex execution lock is malformed and cannot be safely replaced.");
  }
}

async function acquireLock(root: string, lockPath: string, repoId: string, runId: string, pid: number, now: Date, processAlive: (pid: number) => boolean): Promise<void> {
  const absolute = join(root, ...lockPath.split("/"));
  await mkdir(dirname(absolute), { recursive: true });
  const record: LockRecord = { schema_version: 1, repo_id: repoId, run_id: runId, pid, created_at: now.toISOString() };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(absolute, "wx");
      await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
      await handle.close();
      return;
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      const inspection = await inspectLock(root, lockPath, processAlive);
      if (inspection.active) throw new RepoReaderError("CODEX_RUN_ACTIVE", `Another active Codex run already owns this repository (${inspection.runId}).`);
      if (!inspection.stale) throw new RepoReaderError("CODEX_LOCK_INVALID", "The repository Codex execution lock cannot be safely replaced.");
      await unlink(absolute);
    }
  }
  throw new RepoReaderError("CODEX_RUN_ACTIVE", "Could not acquire the repository Codex execution lock.");
}

async function updateLock(root: string, lockPath: string, repoId: string, runId: string, pid: number, now: Date): Promise<void> {
  const absolute = join(root, ...lockPath.split("/"));
  const current = parseLock(await readFile(absolute, "utf8"));
  if (current.repo_id !== repoId || current.run_id !== runId) throw new RepoReaderError("CODEX_RUN_ACTIVE", "The repository Codex execution lock changed before runner ownership was recorded.");
  await writeFile(absolute, `${JSON.stringify({ ...current, pid, created_at: now.toISOString() }, null, 2)}\n`, "utf8");
}

async function releaseLock(root: string, lockPath: string, runId: string): Promise<void> {
  const absolute = join(root, ...lockPath.split("/"));
  try {
    const current = parseLock(await readFile(absolute, "utf8"));
    if (current.run_id === runId) await unlink(absolute);
  } catch (error) {
    if (!isNotFoundError(error)) return;
  }
}

function parseLock(text: string): LockRecord {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new RepoReaderError("CODEX_LOCK_INVALID", "The repository Codex execution lock is malformed."); }
  if (!value || typeof value !== "object") throw new RepoReaderError("CODEX_LOCK_INVALID", "The repository Codex execution lock is malformed.");
  const record = value as Partial<LockRecord>;
  if (record.schema_version !== 1 || typeof record.repo_id !== "string" || typeof record.run_id !== "string" || !Number.isInteger(record.pid) || Number(record.pid) <= 0 || typeof record.created_at !== "string") {
    throw new RepoReaderError("CODEX_LOCK_INVALID", "The repository Codex execution lock is malformed.");
  }
  return record as LockRecord;
}

async function verifyCodexCliCapabilities(root: string): Promise<CliVerification> {
  const modulePath = resolveRunnerSupportPath("agent-cli-probe.mjs");
  const foundation = await import(pathToFileURL(modulePath).href) as {
    resolveCliCommand: (name: string, run: unknown, platform: string) => Promise<string>;
    executeCommand: (command: string, args: string[], options: Record<string, unknown>) => Promise<{ exitCode: number | null; timedOut: boolean; truncated: boolean; complete: boolean; stdout: string; stderr: string }>;
    buildAgentEnvironment: (provider: string, env: NodeJS.ProcessEnv, platform: string) => NodeJS.ProcessEnv;
    detectCapabilities: (provider: string, help: string) => { exec: boolean; json: boolean; sandbox: boolean; cd: boolean; cd_flag: "--cd" | "-C" | null };
    buildProbeInvocation: (provider: string, capabilities: Record<string, unknown>, cwd: string) => { args: string[]; redactedArgs: string[] };
    validateProbeOutput: (provider: string, stdout: string, marker?: string) => void;
    runCodexSandboxVerification: (options: Record<string, unknown>) => Promise<{
      sandbox_bootstrap_verified: true;
      sandboxed_operation_verified: true;
    }>;
  };
  const env = foundation.buildAgentEnvironment("codex", process.env, process.platform);
  const cli = await foundation.resolveCliCommand("codex", foundation.executeCommand, process.platform);
  const version = await foundation.executeCommand(cli, ["--version"], { cwd: root, env, timeoutMs: 30_000, maxOutputBytes: 65_536 });
  const globalHelp = await foundation.executeCommand(cli, ["--help"], { cwd: root, env, timeoutMs: 30_000, maxOutputBytes: 262_144 });
  const execHelp = await foundation.executeCommand(cli, ["exec", "--help"], { cwd: root, env, timeoutMs: 30_000, maxOutputBytes: 262_144 });
  for (const result of [version, globalHelp, execHelp]) {
    if (result.exitCode !== 0 || result.timedOut || result.truncated || !result.complete) throw new RepoReaderError("CODEX_CLI_UNAVAILABLE", "Codex CLI version or capability verification failed.");
  }
  const capabilities = foundation.detectCapabilities("codex", `${globalHelp.stdout}\n${execHelp.stdout}`);
  if (!capabilities.exec || !capabilities.json || !capabilities.sandbox || !capabilities.cd || !capabilities.cd_flag) {
    throw new RepoReaderError("CODEX_CLI_CAPABILITY_MISSING", "Codex CLI is missing required non-interactive JSONL, sandbox, or repository-root capabilities.");
  }

  const authenticationMarker = "MCP_AGENT_CLI_CODEX_PROBE_OK";
  const authenticationInvocation = foundation.buildProbeInvocation("codex", capabilities, root);
  const authentication = await foundation.executeCommand(cli, authenticationInvocation.args, {
    cwd: root,
    input: `Do not modify files and do not run shell commands. Return the exact marker ${authenticationMarker} and nothing else.`,
    env,
    timeoutMs: 180_000,
    maxOutputBytes: 1_048_576
  });
  if (authentication.exitCode !== 0 || authentication.timedOut || authentication.truncated || !authentication.complete) {
    throw new RepoReaderError("CODEX_AUTHENTICATION_PROBE_FAILED", "Codex non-interactive authentication verification failed.");
  }
  try {
    foundation.validateProbeOutput("codex", authentication.stdout, authenticationMarker);
  } catch {
    throw new RepoReaderError("CODEX_AUTHENTICATION_PROBE_FAILED", "Codex authentication verification returned invalid structured output.");
  }

  let sandboxVerification;
  try {
    sandboxVerification = await foundation.runCodexSandboxVerification({
      cliPath: cli,
      cwd: root,
      capabilities,
      env,
      runCommand: foundation.executeCommand,
      timeoutMs: 180_000,
      maxOutputBytes: 1_048_576
    });
  } catch (error) {
    const code = codexProbeErrorCode(error);
    throw new RepoReaderError(code, error instanceof Error ? error.message : "Codex workspace-write sandbox verification failed.");
  }

  return {
    command: cli,
    version: version.stdout.trim().split(/\r?\n/, 1)[0] ?? "unknown",
    cd_flag: capabilities.cd_flag,
    sandbox_bootstrap_verified: sandboxVerification.sandbox_bootstrap_verified,
    sandboxed_operation_verified: sandboxVerification.sandboxed_operation_verified
  };
}

function codexProbeErrorCode(error: unknown): RepoReaderErrorCode {
  const raw = typeof (error as { code?: unknown })?.code === "string" ? String((error as { code?: unknown }).code) : "";
  const allowed = new Set<RepoReaderErrorCode>([
    "CODEX_SANDBOX_BOOTSTRAP_FAILED",
    "CODEX_SANDBOX_PROBE_TIMED_OUT",
    "CODEX_SANDBOX_PROBE_OUTPUT_INCOMPLETE",
    "CODEX_SANDBOX_PROBE_FAILED",
    "CODEX_SANDBOX_OPERATION_NOT_VERIFIED",
    "CODEX_EXECUTION_BOUNDARY_UNVERIFIED"
  ]);
  return allowed.has(raw as RepoReaderErrorCode) ? raw as RepoReaderErrorCode : "CODEX_SANDBOX_BOOTSTRAP_FAILED";
}

async function launchDetachedRunner(options: RunnerLaunchOptions): Promise<RunnerLaunch> {
  const runner = resolveRunnerSupportPath("codex-task-runner.mjs");
  const env = buildRunnerEnvironment(options.inheritEnv);
  const child = spawn(process.execPath, [
    runner,
    "--repo-root", options.root,
    "--repo-id", options.repoId,
    "--run-id", options.runId,
    "--timeout-ms", String(options.timeoutMs),
    "--max-output-bytes", String(options.maxOutputBytes)
  ], {
    cwd: options.root,
    env,
    detached: true,
    windowsHide: true,
    shell: false,
    stdio: "ignore"
  });
  if (!child.pid) throw new RepoReaderError("CODEX_RUNNER_START_FAILED", "Node did not return a runner process id.");
  child.unref();
  return { pid: child.pid };
}

async function terminateRunnerProcess(pid: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolveTermination) => {
      execFile("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 30_000 }, () => resolveTermination());
    });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try { process.kill(pid, "SIGKILL"); } catch { return; }
  }
}

function resolveRunnerSupportPath(file: string): string {
  const entry = process.argv[1] ? resolve(dirname(process.argv[1]), "..", "scripts", file) : "";
  const cwd = resolve(process.cwd(), "scripts", file);
  const candidates = [entry, cwd].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new RepoReaderError("CODEX_RUNNER_START_FAILED", `Required runner support file is unavailable: scripts/${file}`);
  return found;
}

function buildRunnerEnvironment(inheritEnv: string[]): NodeJS.ProcessEnv {
  const normalizedInheritedNames = [...new Set(inheritEnv)].sort();
  const names = new Set(["PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "TMPDIR", "SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "LANG", "LC_ALL", "XDG_CONFIG_HOME", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "OPENAI_API_KEY", "CODEX_HOME", ...normalizedInheritedNames]);
  const env: NodeJS.ProcessEnv = {
    GPT_REPO_CODEX_INHERIT_ENV_NAMES: JSON.stringify(normalizedInheritedNames)
  };
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.length > 0) env[name] = value;
  }
  return env;
}

export function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function processStateActive(state: CodexExecutionState, processAlive: (pid: number) => boolean): boolean {
  return [state.process_pid, state.runner_pid].some((pid) => typeof pid === "number" && processAlive(pid));
}

function safeDiagnostic(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\b(Bearer|Basic)\s+\S+/gi, "$1 <redacted>").slice(0, 2048);
}

function isReplaceConflict(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && ["EEXIST", "EPERM", "EACCES"].includes(String((error as { code?: unknown }).code)));
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}

function isAlreadyExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "EEXIST");
}
