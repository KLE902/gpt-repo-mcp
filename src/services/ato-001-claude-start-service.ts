import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import {
  Ato001ExecutionStateSchema,
  type Ato001ClaudeStartResult,
  type Ato001ExecutionState
} from "../contracts/ato-001-claude.contract.js";
import { RepoReaderError } from "../runtime/errors.js";
import {
  launchAto001Runner,
  publicAto001Invocation,
  verifyAto001ClaudeCli,
  type Ato001CliEvidence
} from "./ato-001-claude-cli.js";
import {
  ATO001_ARTIFACT_DIRECTORY,
  ATO001_ARTIFACT_PATHS,
  ATO001_BRANCH,
  ATO001_CONTEXT,
  ATO001_CONTEXT_AGGREGATE_SHA256,
  ATO001_HEAD,
  ATO001_REPO_ID,
  ATO001_RUN_ID,
  ATO001_TASK_SHA256,
  ATO001_TASK_SOURCE_PATH,
  ato001ArtifactPaths
} from "./ato-001-claude-profile.js";
import { Ato001ReadLease } from "./ato-001-read-lease.js";
import { Ato001RepositoryVerifier, type Ato001RepositoryEvidence } from "./ato-001-repository-verifier.js";

type StartDependencies = {
  verifyRepository?: () => Promise<Ato001RepositoryEvidence>;
  verifyCli?: () => Promise<Ato001CliEvidence>;
  launchRunner?: (options: { runnerPath: string; repoRoot: string; taskPath: string; artifactDirectory: string }) => Promise<{ pid: number }>;
  terminateRunner?: (pid: number) => Promise<boolean>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  startupWaitMs?: number;
};

export class Ato001ClaudeStartService {
  private readonly verifyRepository: () => Promise<Ato001RepositoryEvidence>;
  private readonly verifyCli: () => Promise<Ato001CliEvidence>;
  private readonly launchRunner: StartDependencies["launchRunner"];
  private readonly terminateRunner: (pid: number) => Promise<boolean>;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly startupWaitMs: number;

  constructor(
    private readonly repoRoot: string,
    private readonly projectRoot: string,
    dependencies: StartDependencies = {}
  ) {
    this.verifyRepository = dependencies.verifyRepository ?? (() => new Ato001RepositoryVerifier(repoRoot).verify());
    this.verifyCli = dependencies.verifyCli ?? (() => verifyAto001ClaudeCli());
    this.launchRunner = dependencies.launchRunner ?? launchAto001Runner;
    this.terminateRunner = dependencies.terminateRunner ?? terminateRunnerProcessTree;
    this.now = dependencies.now ?? (() => new Date());
    this.sleep = dependencies.sleep ?? ((ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms)));
    this.startupWaitMs = dependencies.startupWaitMs ?? 15_000;
  }

  async start(call: { call_id: string; recorded_at: string }): Promise<Ato001ClaudeStartResult> {
    await this.assertArtifactsAbsent();
    const repository = await this.verifyRepository();
    const taskSource = resolve(this.projectRoot, ...ATO001_TASK_SOURCE_PATH.split("/"));
    const taskBytes = await readFile(taskSource);
    assertFixedTaskBytes(taskBytes);
    await this.assertArtifactsIgnored();
    const cli = await this.verifyCli();
    const repositoryAfterCliProbe = await this.verifyRepository();
    if (repositoryAfterCliProbe.head !== repository.head) {
      throw new RepoReaderError("ATO001_REPOSITORY_DRIFT", "PKR changed during Claude preflight.");
    }

    const lease = new Ato001ReadLease(this.repoRoot);
    const startedAt = this.now();
    const artifactDirectory = this.absolute(ATO001_ARTIFACT_DIRECTORY);
    const state = initialState(startedAt);
    await lease.acquireForStart(startedAt, async () => {
      await mkdir(artifactDirectory, { recursive: true });
      await writeFile(this.absolute(ATO001_ARTIFACT_PATHS.task), taskBytes, { flag: "wx" });
      await writeJson(this.absolute(ATO001_ARTIFACT_PATHS.metadata), {
        schema_version: 1,
        run_id: ATO001_RUN_ID,
        repo_id: ATO001_REPO_ID,
        repository: {
          origin: repository.origin,
          branch: ATO001_BRANCH,
          head: ATO001_HEAD,
          clean: true,
          origin_synchronized: true
        },
        task: {
          source_path: ATO001_TASK_SOURCE_PATH,
          artifact_path: ATO001_ARTIFACT_PATHS.task,
          sha256: ATO001_TASK_SHA256,
          exact_utf8_no_newline: true
        },
        context: repository.context,
        context_aggregate_sha256: ATO001_CONTEXT_AGGREGATE_SHA256,
        invocation: publicAto001Invocation(cli),
        output_contract: "ato-001-pkr-004-semantic-result-v1",
        residual_risk: "The live-worktree lease blocks known MCP mutations only; external host processes remain outside MCP control.",
        created_at: startedAt.toISOString()
      });
      await writeJson(this.absolute(ATO001_ARTIFACT_PATHS.state), state);
      await writeJson(this.absolute(ATO001_ARTIFACT_PATHS.measurements), initialMeasurements(call));
    });

    let launched: { pid: number };
    try {
      launched = await this.launchRunner!({
        runnerPath: resolve(this.projectRoot, "scripts", "ato-001-claude-runner.mjs"),
        repoRoot: this.repoRoot,
        taskPath: this.absolute(ATO001_ARTIFACT_PATHS.task),
        artifactDirectory
      });
    } catch {
      const failed = {
        ...state,
        status: "unverifiable_read_boundary" as const,
        terminal: true,
        diagnostic_only: true,
        updated_at: this.now().toISOString(),
        ended_at: this.now().toISOString(),
        terminal_classification: "ATO001_RUNNER_START_FAILED",
        diagnostic: "The bounded Claude runner could not be started."
      };
      await writeJson(this.absolute(ATO001_ARTIFACT_PATHS.state), failed);
      throw new RepoReaderError("ATO001_RUNNER_START_FAILED", "The bounded ATO-001 Claude runner could not be started; call the fixed review tool to release the lease.");
    }

    let observed: Ato001ExecutionState;
    try {
      observed = await this.waitForStartup();
    } catch (error) {
      const normalized = error instanceof RepoReaderError ? error : null;
      if (normalized?.code === "ATO001_START_TIMEOUT") {
        const terminated = await this.terminateRunner(launched.pid);
        const endedAt = this.now().toISOString();
        const failed: Ato001ExecutionState = {
          ...state,
          status: "unverifiable_read_boundary",
          terminal: true,
          diagnostic_only: true,
          updated_at: endedAt,
          ended_at: endedAt,
          terminal_classification: "ATO001_START_TIMEOUT",
          diagnostic: "The bounded Claude runner did not confirm startup within the startup window.",
          process_tree_termination_outcome: terminated ? "verified_complete" : "requested_unverified"
        };
        await writeJson(this.absolute(ATO001_ARTIFACT_PATHS.state), failed);
      }
      throw error;
    }
    return {
      ok: true,
      run_id: ATO001_RUN_ID,
      repo_id: ATO001_REPO_ID,
      started: true,
      state: observed,
      task_sha256: ATO001_TASK_SHA256,
      context_aggregate_sha256: ATO001_CONTEXT_AGGREGATE_SHA256,
      artifact_paths: ato001ArtifactPaths(),
      invocation: publicAto001Invocation(cli),
      context: ATO001_CONTEXT.map(([path, sha256]) => ({ path, sha256 })),
      next_steps: ["Call repo_ato_001_claude_review to collect the fixed result; repeat later if execution is still running."],
      warnings: ["LIVE_WORKTREE_EXTERNAL_PROCESS_RISK"]
    };
  }

  private async waitForStartup(): Promise<Ato001ExecutionState> {
    const deadline = Date.now() + this.startupWaitMs;
    while (Date.now() <= deadline) {
      const state = await this.readState();
      if (state.status !== "starting") return state;
      await this.sleep(50);
    }
    throw new RepoReaderError("ATO001_START_TIMEOUT", "The fixed Claude runner did not confirm startup within 15 seconds; the lease remains active for review.");
  }

  private async readState(): Promise<Ato001ExecutionState> {
    try {
      return Ato001ExecutionStateSchema.parse(JSON.parse(await readFile(this.absolute(ATO001_ARTIFACT_PATHS.state), "utf8")));
    } catch {
      throw new RepoReaderError("ATO001_EXECUTION_INVALID", "ATO-001 execution state is missing or malformed.");
    }
  }

  private async assertArtifactsAbsent(): Promise<void> {
    for (const path of Object.values(ATO001_ARTIFACT_PATHS)) {
      try {
        await access(this.absolute(path));
        throw new RepoReaderError("ATO001_RUN_EXISTS", `Fixed ATO-001 artifact already exists: ${basename(path)}`);
      } catch (error) {
        if (isNotFound(error)) continue;
        throw error;
      }
    }
  }

  private async assertArtifactsIgnored(): Promise<void> {
    for (const path of ato001ArtifactPaths()) {
      const ignored = await new Promise<boolean>((resolveIgnored) => {
        execFile("git", ["check-ignore", "-q", "--", path], {
          cwd: this.repoRoot,
          windowsHide: true,
          timeout: 30_000
        }, (error) => resolveIgnored(!error));
      });
      if (!ignored) throw new RepoReaderError("ATO001_ARTIFACTS_NOT_IGNORED", `ATO-001 artifact path is not ignored by PKR Git: ${path}`);
    }
  }

  private absolute(path: string): string {
    return join(this.repoRoot, ...path.split("/"));
  }
}

export function assertFixedTaskBytes(bytes: Buffer): void {
  if (bytes.includes(0) || bytes.at(-1) === 0x0a || bytes.at(-1) === 0x0d) {
    throw new RepoReaderError("ATO001_TASK_IDENTITY_INVALID", "The fixed ATO-001 task must be UTF-8 with no trailing newline.");
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RepoReaderError("ATO001_TASK_IDENTITY_INVALID", "The fixed ATO-001 task is not valid UTF-8.");
  }
  if (createHash("sha256").update(bytes).digest("hex") !== ATO001_TASK_SHA256) {
    throw new RepoReaderError("ATO001_TASK_IDENTITY_INVALID", "The fixed ATO-001 task SHA-256 does not match ratification.");
  }
}

function initialState(now: Date): Ato001ExecutionState {
  return {
    schema_version: 1,
    run_id: ATO001_RUN_ID,
    status: "starting",
    terminal: false,
    valid_for_pkr_intake: false,
    diagnostic_only: false,
    started_at: null,
    updated_at: now.toISOString(),
    ended_at: null,
    runner_pid: null,
    process_pid: null,
    exit_code: null,
    provider_runtime_ms: null,
    timed_out: false,
    output_complete: false,
    output_truncated: false,
    terminal_classification: null,
    diagnostic: null,
    boundary: {
      repository: true,
      branch: true,
      head: true,
      clean: true,
      origin_synchronized: true,
      task_identity: true,
      context_hashes: true,
      context_aggregate: true,
      cli_resolution: true,
      cli_version: true,
      authentication: true,
      capabilities: true,
      read_only_invocation: true,
      complete_output: false,
      result_schema: false
    },
    provider_usage: null,
    provider_cost_usd: null,
    provider_turns: null,
    result_sha256: null,
    process_tree_termination_outcome: "not_required"
  };
}

function initialMeasurements(call: { call_id: string; recorded_at: string }) {
  return {
    owner_prompt_relay_count: 0,
    owner_result_relay_count: 0,
    chatgpt_mcp_start_calls: [{ ...call, tool: "repo_start_ato_001_claude" }],
    chatgpt_mcp_review_calls: [],
    measured_start_via_chatgpt_mcp: true,
    measured_result_retrieval_via_chatgpt_mcp: false,
    owner_actions: { terminal: 0, powershell: 0, filesystem: 0, attachment: 0, claude_ui: 0 },
    prospective_active_owner_administration_ms: null,
    total_elapsed_ms: null,
    task_runtime_ms: null,
    measured_attempt_count: 1,
    narrow_repair_used: false,
    timeout_outcome: "pending",
    process_tree_termination_outcome: "not_required",
    output_complete: false,
    parsing_validation_outcome: "pending",
    repository_context_boundary_outcome: "start_verified",
    read_lease_outcome: "acquired",
    turns: null,
    usage: null,
    reported_cost_usd: null,
    remaining_recurring_setup_steps: [],
    owner_perceived_administrative_burden: "not_recorded",
    valid_for_pkr_interim_intake: false,
    recommendation: "pending"
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

async function terminateRunnerProcessTree(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (process.platform === "win32") {
    return await new Promise<boolean>((resolveTermination) => {
      execFile("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 30_000 }, (error) => resolveTermination(!error));
    });
  }
  try {
    process.kill(-pid, "SIGKILL");
    return true;
  } catch {
    try {
      process.kill(pid, "SIGKILL");
      return true;
    } catch {
      return false;
    }
  }
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
