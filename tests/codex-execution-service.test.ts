import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { CodexExecutionService, readExecutionState, writeExecutionStateAtomic } from "../src/services/codex-execution-service.js";
import { OperationsPolicy } from "../src/services/operations-policy.js";
import { PathSandbox } from "../src/services/path-sandbox.js";
import { CodexTaskService, codexRunPaths } from "../src/services/codex-task-service.js";
import { WritePolicy } from "../src/services/write-policy.js";

const execFileAsync = promisify(execFile);
const RUN_ID = "2026-07-23T120000Z-durable-start";
const NOW = new Date("2026-07-23T12:00:00.000Z");

describe("CodexExecutionService", () => {
  test("starts an existing verified task with a fixed invocation and durable running state", async () => {
    const fixture = await createExecutionFixture();
    const service = createService(fixture, {
      launchRunner: async ({ root, runId }) => {
        const paths = codexRunPaths(runId);
        const starting = await readExecutionState(root, paths.executionPath);
        await writeExecutionStateAtomic(root, {
          ...starting,
          status: "running",
          runner_pid: 24001,
          process_pid: 24002,
          started_at: NOW.toISOString(),
          updated_at: NOW.toISOString()
        }, false);
        return { pid: 24001 };
      }
    });

    const result = await service.start(startInput(fixture));

    expect(result).toMatchObject({
      ok: true,
      dry_run: false,
      validated: true,
      started: true,
      invocation: {
        command: "codex",
        args: ["exec", "--json", "--sandbox", "workspace-write", "--cd", "<repo-root>", "-"],
        cwd_verified: true,
        prompt_via_stdin: true,
        structured_output: true,
        sandbox: "workspace-write"
      },
      execution_state: {
        status: "running",
        repo_id: "demo",
        run_id: RUN_ID,
        start_branch: "feat/durable-test",
        start_head_sha: fixture.head,
        runner_pid: 24001,
        process_pid: 24002,
        process_active: true
      }
    });
    expect(result.invocation.args.join(" ")).not.toMatch(/model|reasoning|timeout|commit|push|merge/i);
    await expect(readExecutionState(fixture.root, result.execution_path)).resolves.toMatchObject({ status: "running" });
  });

  test("dry run validates task, policy, Git state, lock state, and CLI without creating execution artifacts", async () => {
    const fixture = await createExecutionFixture();
    let launched = false;
    const result = await createService(fixture, {
      launchRunner: async () => {
        launched = true;
        return { pid: 1 };
      }
    }).start({ ...startInput(fixture), dry_run: true });

    expect(result).toMatchObject({ dry_run: true, validated: true, started: false });
    expect(launched).toBe(false);
    await expect(access(join(fixture.root, result.execution_path))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("fails closed when sandbox verification leaves the repository dirty", async () => {
    const fixture = await createExecutionFixture();
    const service = createService(fixture, {
      verifyCli: async () => {
        await writeFile(join(fixture.root, "src", "app.ts"), "export const probeLeak = true;\n");
        return {
          command: "codex",
          version: "codex 1.0.0",
          cd_flag: "--cd",
          sandbox_bootstrap_verified: true,
          sandboxed_operation_verified: true
        };
      }
    });

    await expect(service.start({ ...startInput(fixture), dry_run: true })).rejects.toMatchObject({ code: "GIT_WORKTREE_DIRTY" });
    await expect(access(join(fixture.root, codexRunPaths(RUN_ID).executionPath))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("dedicated execution policy is disabled by default", async () => {
    const fixture = await createExecutionFixture();
    const service = createService(fixture, {}, new OperationsPolicy({ enabled: true }));

    await expect(service.start({ ...startInput(fixture), dry_run: true })).rejects.toMatchObject({ code: "CODEX_TASK_RUN_DISABLED" });
  });

  test("rejects wrong repository identity and unknown run id", async () => {
    const fixture = await createExecutionFixture();
    const service = createService(fixture);

    await expect(service.start({ ...startInput(fixture), repo_id: "other", dry_run: true })).rejects.toMatchObject({ code: "CODEX_TASK_INVALID" });
    await expect(service.start({ ...startInput(fixture), run_id: "2026-07-23T120001Z-missing", dry_run: true })).rejects.toMatchObject({ code: "CODEX_TASK_MISSING" });
  });

  test("rejects branch, HEAD, base-branch, and dirty-worktree mismatches", async () => {
    const branchFixture = await createExecutionFixture();
    await expect(createService(branchFixture).start({ ...startInput(branchFixture), expected_branch: "feat/other", dry_run: true })).rejects.toMatchObject({ code: "GIT_BRANCH_MISMATCH" });

    const headFixture = await createExecutionFixture();
    await expect(createService(headFixture).start({ ...startInput(headFixture), expected_head_sha: "f".repeat(40), dry_run: true })).rejects.toMatchObject({ code: "GIT_HEAD_MISMATCH" });

    const baseFixture = await createExecutionFixture();
    await git(baseFixture.root, ["switch", "main"]);
    await expect(createService(baseFixture).start({ ...startInput(baseFixture), expected_branch: "main", dry_run: true })).rejects.toMatchObject({ code: "GIT_DIRECT_BASE_PUSH_BLOCKED" });

    const dirtyFixture = await createExecutionFixture();
    await writeFile(join(dirtyFixture.root, "src", "app.ts"), "export const changed = true;\n");
    await expect(createService(dirtyFixture).start({ ...startInput(dirtyFixture), dry_run: true })).rejects.toMatchObject({ code: "GIT_WORKTREE_DIRTY" });
  });

  test("rejects missing or manipulated task files and empty allowed paths", async () => {
    const missingFixture = await createExecutionFixture();
    await rm(join(missingFixture.root, codexRunPaths(RUN_ID).manifestPath));
    await expect(createService(missingFixture).start({ ...startInput(missingFixture), dry_run: true })).rejects.toMatchObject({ code: "CODEX_TASK_MISSING" });

    const hashFixture = await createExecutionFixture();
    await writeFile(join(hashFixture.root, codexRunPaths(RUN_ID).promptPath), "tampered\n");
    await expect(createService(hashFixture).start({ ...startInput(hashFixture), dry_run: true })).rejects.toMatchObject({ code: "CODEX_TASK_INTEGRITY_FAILED" });

    const emptyFixture = await createExecutionFixture({ allowedPaths: [] });
    await expect(createService(emptyFixture).start({ ...startInput(emptyFixture), dry_run: true })).rejects.toMatchObject({ code: "CODEX_ALLOWED_PATHS_REQUIRED" });

    const broadFixture = await createExecutionFixture({ allowedPaths: ["**"] });
    await expect(createService(broadFixture).start({ ...startInput(broadFixture), dry_run: true })).rejects.toMatchObject({ code: "CODEX_TASK_INVALID" });

    const protectedFixture = await createExecutionFixture({ allowedPaths: [".chatgpt/**"] });
    await expect(createService(protectedFixture).start({ ...startInput(protectedFixture), dry_run: true })).rejects.toMatchObject({ code: "CODEX_TASK_INVALID" });
  });

  test("rejects existing result, execution, stdout, or stderr artifacts", async () => {
    for (const artifact of ["RESULT.md", "execution.json", "stdout.jsonl", "stderr.log"]) {
      const fixture = await createExecutionFixture();
      const path = join(fixture.root, codexRunPaths(RUN_ID).runDir, artifact);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, artifact === "execution.json" ? "{}\n" : "existing\n");
      const expectedCode = artifact === "RESULT.md" ? "CODEX_RESULT_EXISTS" : artifact === "execution.json" ? "CODEX_EXECUTION_EXISTS" : "CODEX_OUTPUT_EXISTS";
      await expect(createService(fixture).start({ ...startInput(fixture), dry_run: true })).rejects.toMatchObject({ code: expectedCode });
    }
  });

  test("rejects unignored execution artifacts", async () => {
    const fixture = await createExecutionFixture();
    await writeFile(join(fixture.root, ".gitignore"), "node_modules/\n");
    await git(fixture.root, ["add", ".gitignore"]);
    const paths = codexRunPaths(RUN_ID);
    await git(fixture.root, ["add", "-f", "--", paths.promptPath, paths.manifestPath]);
    await git(fixture.root, ["commit", "-m", "track task artifacts without ignore policy"]);
    const head = await git(fixture.root, ["rev-parse", "HEAD"]);

    await expect(createService({ ...fixture, head }).start({ ...startInput({ ...fixture, head }), dry_run: true })).rejects.toMatchObject({ code: "CODEX_ARTIFACTS_NOT_IGNORED" });
  });

  test("enforces single-writer lock and only accepts a verified stale lock", async () => {
    const activeFixture = await createExecutionFixture();
    const activeLock = join(activeFixture.root, codexRunPaths(RUN_ID).lockPath);
    await mkdir(dirname(activeLock), { recursive: true });
    await writeFile(activeLock, JSON.stringify({ schema_version: 1, repo_id: "demo", run_id: "2026-07-23T120002Z-active", pid: process.pid, created_at: NOW.toISOString() }));
    await expect(createService(activeFixture).start({ ...startInput(activeFixture), dry_run: true })).rejects.toMatchObject({ code: "CODEX_RUN_ACTIVE" });

    const staleFixture = await createExecutionFixture();
    const staleLock = join(staleFixture.root, codexRunPaths(RUN_ID).lockPath);
    await mkdir(dirname(staleLock), { recursive: true });
    await writeFile(staleLock, JSON.stringify({ schema_version: 1, repo_id: "demo", run_id: "2026-07-23T120003Z-stale", pid: 45001, created_at: NOW.toISOString() }));
    const result = await createService(staleFixture, { processAlive: () => false }).start({ ...startInput(staleFixture), dry_run: true });
    expect(result.warnings).toContain("STALE_CODEX_LOCK_VERIFIED");
  });

  test("releases the repository lock when a fast runner reaches terminal state before start returns", async () => {
    const fixture = await createExecutionFixture();
    const service = createService(fixture, {
      launchRunner: async ({ root, runId }) => {
        const paths = codexRunPaths(runId);
        const starting = await readExecutionState(root, paths.executionPath);
        await writeExecutionStateAtomic(root, {
          ...starting,
          status: "blocked",
          runner_pid: 47001,
          process_pid: 47002,
          started_at: NOW.toISOString(),
          updated_at: NOW.toISOString(),
          ended_at: NOW.toISOString(),
          exit_code: 0,
          output_complete: true,
          result_status: "blocked"
        }, false);
        return { pid: 47001 };
      },
      processAlive: () => false
    });

    const result = await service.start(startInput(fixture));

    expect(result).toMatchObject({ started: false, execution_state: { status: "blocked", process_active: false } });
    await expect(access(join(fixture.root, codexRunPaths(RUN_ID).lockPath))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("startup timeout terminates the detached runner tree, records failure, and does not report success", async () => {
    const fixture = await createExecutionFixture();
    let terminatedPid: number | undefined;
    const service = createService(fixture, {
      launchRunner: async () => ({ pid: 46001 }),
      processAlive: () => true,
      terminateRunner: async (pid) => { terminatedPid = pid; },
      sleep: async () => undefined,
      startupWaitMs: 0
    });

    await expect(service.start(startInput(fixture))).rejects.toMatchObject({ code: "CODEX_START_TIMEOUT" });
    expect(terminatedPid).toBe(46001);
    await expect(readExecutionState(fixture.root, codexRunPaths(RUN_ID).executionPath)).resolves.toMatchObject({
      status: "failed",
      error_code: "CODEX_START_TIMEOUT",
      output_complete: false
    });
  });

  test("task writer records schema v2 prompt integrity and refuses run reuse", async () => {
    const fixture = await createExecutionFixture();
    const paths = codexRunPaths(RUN_ID);
    const manifest = JSON.parse(await readFile(join(fixture.root, paths.manifestPath), "utf8")) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      schema_version: 2,
      repo_id: "demo",
      run_id: RUN_ID,
      prompt_path: paths.promptPath,
      result_path: paths.resultPath,
      allowed_paths: ["src/**"]
    });
    expect(manifest.prompt_sha256).toMatch(/^[a-f0-9]{64}$/);

    await expect(taskWriter(fixture.root).write(taskInput(["src/**"]))).rejects.toMatchObject({ code: "CODEX_TASK_EXISTS" });
  });
});

type ExecutionFixture = { root: string; head: string; branch: string };
type ServiceOverrides = {
  verifyCli?: () => Promise<{
    command: string;
    version: string;
    cd_flag: "--cd" | "-C";
    sandbox_bootstrap_verified: true;
    sandboxed_operation_verified: true;
  }>;
  launchRunner?: (options: { root: string; repoId: string; runId: string; timeoutMs: number; maxOutputBytes: number; inheritEnv: string[] }) => Promise<{ pid: number }>;
  processAlive?: (pid: number) => boolean;
  terminateRunner?: (pid: number) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  startupWaitMs?: number;
};

async function createExecutionFixture(options: { allowedPaths?: string[] } = {}): Promise<ExecutionFixture> {
  const root = await mkdtemp(join(tmpdir(), "codex-execution-service-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), "export const app = true;\n");
  await writeFile(join(root, ".gitignore"), ".chatgpt/\n");
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await git(root, ["config", "user.name", "Test User"]);
  await git(root, ["add", "--", ".gitignore", "src/app.ts"]);
  await git(root, ["commit", "-m", "initial"]);
  await git(root, ["switch", "-c", "feat/durable-test"]);
  await taskWriter(root).write(taskInput(options.allowedPaths ?? ["src/**"]));
  return {
    root,
    branch: "feat/durable-test",
    head: await git(root, ["rev-parse", "HEAD"])
  };
}

function taskWriter(root: string) {
  return new CodexTaskService(root, new PathSandbox(root), new WritePolicy({
    enabled: true,
    allowed_globs: [".chatgpt/codex-runs/**"]
  }), () => NOW);
}

function taskInput(allowedPaths: string[]) {
  return {
    repo_id: "demo",
    run_id: RUN_ID,
    title: "Durable start",
    objective: "Update the allowed source path and report the result.",
    allowed_paths: allowedPaths,
    forbidden_paths: ["docs/**"],
    verification_commands: ["npm test"]
  };
}

function startInput(fixture: ExecutionFixture) {
  return {
    repo_id: "demo",
    run_id: RUN_ID,
    expected_branch: fixture.branch,
    expected_head_sha: fixture.head,
    dry_run: false,
    reason: "Execute the existing verified task."
  };
}

function createService(fixture: ExecutionFixture, overrides: ServiceOverrides = {}, policy = enabledPolicy()) {
  return new CodexExecutionService(
    fixture.root,
    new PathSandbox(fixture.root),
    policy,
    {
      verifyCli: overrides.verifyCli ?? (async () => ({
        command: "codex",
        version: "codex 1.0.0",
        cd_flag: "--cd",
        sandbox_bootstrap_verified: true,
        sandboxed_operation_verified: true
      })),
      launchRunner: overrides.launchRunner ?? (async ({ root, runId }) => {
        const paths = codexRunPaths(runId);
        const starting = await readExecutionState(root, paths.executionPath);
        await writeExecutionStateAtomic(root, {
          ...starting,
          status: "running",
          runner_pid: 24001,
          process_pid: 24002,
          started_at: NOW.toISOString(),
          updated_at: NOW.toISOString()
        }, false);
        return { pid: 24001 };
      }),
      terminateRunner: overrides.terminateRunner,
      processAlive: overrides.processAlive ?? (() => true),
      now: () => NOW,
      sleep: overrides.sleep ?? (async () => undefined),
      startupWaitMs: overrides.startupWaitMs ?? 100
    }
  );
}

function enabledPolicy() {
  return new OperationsPolicy({
    enabled: true,
    codex_task_run_enabled: true,
    codex_task_max_runtime_ms: 60_000,
    codex_task_max_output_bytes: 64_000,
    codex_task_inherit_env: ["LANG"]
  });
}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    env: { PATH: process.env.PATH ?? "" },
    windowsHide: true
  });
  return stdout.trim();
}
